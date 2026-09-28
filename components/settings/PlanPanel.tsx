"use client";

/**
 * Ajustes → Plan y facturación.
 *
 * Enseña el plan y su estado en palabras normales, el uso del periodo frente a
 * los límites (los mismos contadores que el muro: /api/billing/status →
 * billing_usage_summary) y los botones para pagar (/api/billing/checkout) o
 * gestionar la suscripción (/api/billing/portal). Precios, límites y nombres
 * salen de lib/plans.ts.
 *
 * Al volver de Stripe (?billing=success) el webhook puede tardar un poco: se
 * espera a ver el plan activo en vez de enseñar el viejo.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useBilling } from "@/components/billing/BillingProvider";
import { useToast } from "@/components/ui/toast";
import { CARD, GhostButton, PanelHeader, PrimaryButton, Spinner } from "@/components/settings/ui";
import { readOnlyCause, readOnlyNextStep } from "@/lib/billing-messages";
import { daysLeftText, formatLongDate, isInTrial, trialDaysLeft, type BillingStatus, type UsageLine } from "@/lib/billing-status";
import {
  FEATURE_LABELS,
  LIMITED_RESOURCES,
  PAID_PLAN_IDS,
  PLAN_FEATURES,
  PLAN_LABELS,
  RECOMMENDED_PLAN,
  RESOURCE_LABELS,
  VAT_SUFFIX,
  annualSavingsCents,
  formatEuros,
  planLimit,
  priceCents,
  type BillingInterval,
  type LimitedResource,
  type PaidPlanId,
} from "@/lib/plans";

const WAIT_TIMEOUT_MS = 30_000;
const WAIT_STEP_MS = 1_500;

// Las generaciones con IA comparten número con los presupuestos (planLimit):
// se enseñan juntas para no confundir con dos filas iguales.
const USAGE_ORDER: LimitedResource[] = LIMITED_RESOURCES.filter((r) => r !== "generaciones_ia");

type Phase = "idle" | "waiting" | "confirmed" | "slow" | "canceled";

function statusText(s: BillingStatus): { label: string; tone: "ok" | "warn" | "muted" } {
  if (isInTrial(s)) return { label: "En prueba", tone: "ok" };
  if (s.status === "active" && s.cancel_at_period_end) return { label: "Cancelado", tone: "warn" };
  if (s.status === "active") return { label: "Activo", tone: "ok" };
  if (s.status === "past_due") return { label: "Pago pendiente", tone: "warn" };
  if (s.status === "canceled") return { label: "Cancelado", tone: "warn" };
  return { label: "Prueba terminada", tone: "warn" };
}

function periodWord(line: UsageLine): string {
  if (line.period === "month") return "este mes";
  if (line.period === "trial") return "en la prueba";
  return "ahora mismo";
}

export default function PlanPanel() {
  const { status, refresh } = useBilling();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>("idle");
  const [interval, setBillingInterval] = useState<BillingInterval>("month");
  const [busy, setBusy] = useState<string | null>(null);
  const waitStarted = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Vuelta de Stripe: ?billing=success | cancel. Se limpia de la URL para que
  // recargar no repita el mensaje. Solo se lee una vez (waitStarted), y el
  // sondeo se corta si el panel se desmonta.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("billing");
    if (!result || waitStarted.current) return;
    waitStarted.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    if (result === "cancel") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPhase("canceled");
      return;
    }
    if (result !== "success") return;
    setPhase("waiting");
    const started = Date.now();
    const poll = async () => {
      if (!mounted.current) return;
      const next = await refresh();
      if (next && next.status === "active" && next.access_level === "full") {
        setPhase("confirmed");
        return;
      }
      if (Date.now() - started > WAIT_TIMEOUT_MS) {
        setPhase("slow");
        return;
      }
      setTimeout(poll, WAIT_STEP_MS);
    };
    poll();
  }, [refresh]);

  const goTo = useCallback(
    async (endpoint: "checkout" | "portal", body?: Record<string, string>, key: string = endpoint) => {
      setBusy(key);
      try {
        const res = await fetch(`/api/billing/${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.url) {
          window.location.href = data.url;
          return;
        }
        if (data.code === "use_portal") {
          toast.info("Ya tienes una suscripción", { description: "Cambia de plan desde «Gestionar suscripción»." });
        } else {
          toast.error(data.error || "No se ha podido abrir el pago. Inténtalo de nuevo.");
        }
      } catch {
        toast.error("Sin conexión. No se ha abierto el pago.");
      }
      setBusy(null);
    },
    [toast],
  );

  if (!status || phase === "waiting") {
    return (
      <div>
        <PanelHeader title="Plan y facturación" description="Tu plan, lo que llevas usado y los pagos." />
        <div style={{ ...CARD, marginTop: 32, padding: 28, display: "flex", alignItems: "center", gap: 12, color: "var(--st-text-2)", fontSize: 14.5 }}>
          <Spinner size={16} />
          {phase === "waiting"
            ? "Pago recibido. Estamos activando tu plan, tarda unos segundos…"
            : "Cargando tu plan…"}
        </div>
      </div>
    );
  }

  const st = statusText(status);
  const inTrial = isInTrial(status);
  const paying = status.has_stripe_customer && (status.status === "active" || status.status === "past_due");
  const canChoose = !paying;
  const periodEnd = status.current_period_end ? formatLongDate(status.current_period_end) : null;

  return (
    <div>
      <PanelHeader title="Plan y facturación" description="Tu plan, lo que llevas usado y los pagos." />

      {phase === "confirmed" && (
        <Notice tone="ok">
          Pago recibido. Ya tienes el plan {PLAN_LABELS[status.plan]} activo.
        </Notice>
      )}
      {phase === "slow" && (
        <Notice tone="warn">
          Pago recibido, pero tu plan aún se está activando. Recarga la página en un minuto. Si sigue igual,
          escríbenos: el cobro está hecho y lo arreglamos.
        </Notice>
      )}
      {phase === "canceled" && <Notice tone="muted">Has salido del pago. No se ha cobrado nada.</Notice>}

      {/* ── Plan actual ── */}
      <div style={{ ...CARD, marginTop: 24, padding: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--st-muted)" }}>Tu plan</div>
          <StatusPill {...st} />
        </div>
        <div style={{ marginTop: 6, fontSize: 28, fontWeight: 800, letterSpacing: "-.02em", color: "var(--st-text)" }}>
          {PLAN_LABELS[status.plan]}
        </div>

        <p style={{ margin: "10px 0 0", fontSize: 14.5, lineHeight: 1.6, color: "var(--st-text-2)", maxWidth: "62ch" }}>
          {inTrial && (
            <>
              {daysLeftText(trialDaysLeft(status))}
              {status.trial_ends_at ? ` (hasta el ${formatLongDate(status.trial_ends_at)})` : ""}. Tienes todo
              desbloqueado. Cuando termine, la cuenta pasa a solo lectura: no se borra nada.
            </>
          )}
          {status.access_level === "read_only" && (
            <>
              {readOnlyCause(status.status)} Puedes ver y exportar tus datos. {readOnlyNextStep(status.status)}
            </>
          )}
          {status.status === "active" && status.cancel_at_period_end && periodEnd && (
            <>Has cancelado la suscripción. Tu plan sigue activo hasta el {periodEnd}; después la cuenta pasa a solo lectura.</>
          )}
          {status.status === "active" && !status.cancel_at_period_end && (
            <>
              {status.interval === "year" ? "Pagas al año." : status.interval === "month" ? "Pagas al mes." : ""}
              {periodEnd ? ` Se renueva el ${periodEnd}.` : ""}
            </>
          )}
        </p>

        {status.has_stripe_customer && (
          <div style={{ marginTop: 20, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <GhostButton onClick={() => goTo("portal")} disabled={busy !== null}>
              {busy === "portal" ? "Abriendo…" : "Gestionar suscripción"}
            </GhostButton>
            <span style={{ alignSelf: "center", fontSize: 12.5, color: "var(--st-muted)" }}>
              Cambiar de plan, cambiar la tarjeta, ver facturas o cancelar.
            </span>
          </div>
        )}
      </div>

      {/* ── Uso ── */}
      <div style={{ ...CARD, marginTop: 24, padding: 28 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--st-text)" }}>
          {status.plan === "prueba" ? "Lo que llevas usado en la prueba" : "Lo que llevas usado este mes"}
        </div>
        <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "var(--st-muted)" }}>
          Los clientes cuentan los que tienes guardados; lo demás, lo creado o enviado
          {status.plan === "prueba" ? " desde que empezaste la prueba" : " desde el día 1 del mes"}.
        </p>
        <div data-st-grid2 style={{ marginTop: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 32px" }}>
          {USAGE_ORDER.map((r) => {
            const line = status.usage[r];
            return line ? <UsageRow key={r} resource={r} line={line} /> : null;
          })}
        </div>
      </div>

      {/* ── Elegir plan ── */}
      {canChoose && (
        <div style={{ ...CARD, marginTop: 24, padding: 28 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--st-text)" }}>Elige tu plan</div>
              <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "var(--st-muted)" }}>
                Pago con tarjeta. Cancelas cuando quieras y conservas el acceso hasta el final de lo pagado.
              </p>
            </div>
            <IntervalSwitch value={interval} onChange={setBillingInterval} />
          </div>
          <div data-st-grid2 style={{ marginTop: 20, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            {PAID_PLAN_IDS.map((p) => (
              <PlanChoice
                key={p}
                plan={p}
                interval={interval}
                current={status.plan === p && status.access_level === "full" && !inTrial}
                busy={busy === `checkout:${p}`}
                disabled={busy !== null}
                onChoose={() => goTo("checkout", { plan: p, interval }, `checkout:${p}`)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Piezas ───────────────────────────────────────────────────────────── */

function Notice({ tone, children }: { tone: "ok" | "warn" | "muted"; children: React.ReactNode }) {
  const color = tone === "ok" ? "var(--st-accent-ink)" : tone === "warn" ? "var(--color-warning-ink)" : "var(--st-text-2)";
  const bg =
    tone === "ok"
      ? "var(--st-accent-soft)"
      : tone === "warn"
        ? "color-mix(in srgb, var(--color-warning) 10%, transparent)"
        : "var(--st-field-alt)";
  return (
    <div role="status" style={{ marginTop: 24, padding: "14px 18px", borderRadius: 14, background: bg, border: "1px solid var(--st-border)", color, fontSize: 14.5, fontWeight: 600, lineHeight: 1.5 }}>
      {children}
    </div>
  );
}

function StatusPill({ label, tone }: { label: string; tone: "ok" | "warn" | "muted" }) {
  const ok = tone === "ok";
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: ".06em",
        textTransform: "uppercase",
        padding: "3px 9px",
        borderRadius: 999,
        color: ok ? "var(--st-accent-ink)" : "var(--color-warning-ink)",
        background: ok ? "var(--st-accent-soft)" : "color-mix(in srgb, var(--color-warning) 14%, transparent)",
      }}
    >
      {label}
    </span>
  );
}

function UsageRow({ resource, line }: { resource: LimitedResource; line: UsageLine }) {
  const what = RESOURCE_LABELS[resource];
  const unlimited = line.limit === null;
  const pct = unlimited ? 0 : Math.min(100, line.limit ? (line.used / line.limit) * 100 : 100);
  const full = !unlimited && line.used >= (line.limit ?? 0);
  const near = !unlimited && pct >= 80;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, fontSize: 14 }}>
        <span style={{ color: "var(--st-text)", fontWeight: 600 }}>
          {unlimited ? `${line.used} ${what}` : `${line.used} de ${line.limit} ${what}`}
        </span>
        <span style={{ fontSize: 12.5, color: full ? "var(--color-warning-ink)" : "var(--st-muted)", fontWeight: full ? 700 : 500 }}>
          {unlimited ? "sin límite" : full ? "límite alcanzado" : periodWord(line)}
        </span>
      </div>
      {!unlimited && (
        <div style={{ marginTop: 7, height: 6, borderRadius: 3, background: "var(--st-field-alt)", overflow: "hidden" }}>
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              borderRadius: 3,
              background: near ? "var(--color-warning)" : "var(--st-accent)",
            }}
          />
        </div>
      )}
    </div>
  );
}

function IntervalSwitch({ value, onChange }: { value: BillingInterval; onChange: (v: BillingInterval) => void }) {
  const opts: { id: BillingInterval; label: string }[] = [
    { id: "month", label: "Mensual" },
    { id: "year", label: "Anual" },
  ];
  return (
    <div role="radiogroup" aria-label="Forma de pago" style={{ display: "inline-flex", padding: 4, borderRadius: 999, background: "var(--st-field-alt)", border: "1px solid var(--st-border)" }}>
      {opts.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.id)}
            style={{
              padding: "7px 16px",
              borderRadius: 999,
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 13.5,
              fontWeight: 700,
              background: active ? "var(--st-panel)" : "transparent",
              color: active ? "var(--st-text)" : "var(--st-muted)",
              boxShadow: active ? "0 1px 2px rgba(0,0,0,.08)" : "none",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function PlanChoice({
  plan,
  interval,
  current,
  busy,
  disabled,
  onChoose,
}: {
  plan: PaidPlanId;
  interval: BillingInterval;
  current: boolean;
  busy: boolean;
  disabled: boolean;
  onChoose: () => void;
}) {
  const recommended = plan === RECOMMENDED_PLAN;
  const total = priceCents(plan, interval);
  const perMonth = interval === "year" ? Math.round(total / 12) : total;
  const extras = PLAN_FEATURES[plan].filter((f) => !PLAN_FEATURES.basico.includes(f));
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 20,
        borderRadius: 14,
        background: recommended ? "var(--st-accent-soft)" : "var(--st-panel)",
        border: `1.5px solid ${recommended ? "var(--st-accent)" : "var(--st-border)"}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--st-text)" }}>{PLAN_LABELS[plan]}</div>
        {recommended && (
          <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".06em", color: "var(--st-accent-ink)" }}>RECOMENDADO</span>
        )}
      </div>
      <div style={{ color: "var(--st-text)" }}>
        <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.02em" }}>{formatEuros(perMonth)}</span>
        <span style={{ fontSize: 13, color: "var(--st-muted)" }}> /mes {VAT_SUFFIX}</span>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--st-muted)", minHeight: 18 }}>
        {interval === "year"
          ? `${formatEuros(total)} al año ${VAT_SUFFIX}. Ahorras ${formatEuros(annualSavingsCents(plan))}.`
          : "Se cobra cada mes."}
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 13, color: "var(--st-text-2)", display: "grid", gap: 4 }}>
        <li>{planLimit(plan, "presupuestos")} presupuestos al mes</li>
        <li>{planLimit(plan, "facturas") === null ? "Facturas sin límite" : `${planLimit(plan, "facturas")} facturas al mes`}</li>
        <li>{planLimit(plan, "clientes") === null ? "Clientes sin límite" : `Hasta ${planLimit(plan, "clientes")} clientes`}</li>
        {extras.length > 0 && <li>Además: {extras.map((f) => FEATURE_LABELS[f].toLowerCase()).join(", ")}</li>}
      </ul>
      <div style={{ marginTop: "auto", paddingTop: 6 }}>
        {current ? (
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--st-accent-ink)" }}>Es tu plan</div>
        ) : (
          <PrimaryButton onClick={onChoose} disabled={disabled}>
            {busy ? "Abriendo el pago…" : `Elegir ${PLAN_LABELS[plan]}`}
          </PrimaryButton>
        )}
      </div>
    </div>
  );
}
