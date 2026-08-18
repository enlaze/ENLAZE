/* eslint-disable react-hooks/set-state-in-effect */
"use client";

/**
 * Superficie de WhatsApp: el envío se plantea como tres preguntas
 * — ¿a quién?, ¿qué? y ¿cuándo? — con vista previa de cómo le llega
 * el mensaje al cliente, más una pestaña con la cola de programados
 * y el historial.
 *
 * El motor (selector de audiencia, composer y programador) es el de
 * components/messaging/, compartido con Emails; aquí solo viven el canal,
 * la burbuja de WhatsApp y las etiquetas propias.
 *
 * OJO: la cola de "Programados" es estado local — todavía no hay
 * tabla ni worker que despache envíos diferidos. El envío inmediato
 * sí es real (POST /api/whatsapp/send-bulk + filas en `messages`).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { useToast } from "@/components/ui/toast";
import AudienceSelector from "@/components/messaging/AudienceSelector";
import Composer from "@/components/messaging/Composer";
import ConfirmBar from "@/components/messaging/ConfirmBar";
import Scheduler from "@/components/messaging/Scheduler";
import ScheduledTab from "@/components/messaging/ScheduledTab";
import {
  FilterKey,
  HistoryRow,
  MODES,
  MessagingClient,
  Mode,
  OPEN_BUDGET_STATUSES,
  QueueItem,
  TabBar,
  fmtDate,
  initials,
  personalize,
  scheduleSummary,
  todayISO,
} from "@/components/messaging/shared";

const TEMPLATES: { name: string; body: string }[] = [
  { name: "Recordatorio de presupuesto", body: "Hola {nombre}, tu presupuesto de {importe} sigue disponible. ¿Lo confirmamos?" },
  { name: "Aviso de factura vencida", body: "Hola {nombre}, tenemos pendiente la factura de {importe} de {empresa}. ¿Te ayudo con el pago?" },
  { name: "Confirmación de cita", body: "Hola {nombre}, te confirmo la visita de mañana. Cualquier cambio, dímelo por aquí." },
  { name: "Seguimiento trimestral", body: "Hola {nombre}, ¿cómo va todo en {empresa}? Te escribo por si necesitáis algo este trimestre." },
];

export default function WhatsAppSurface() {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();

  const [clients, setClients] = useState<MessagingClient[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState<"nuevo" | "programados">("nuevo");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("todos");
  const [showMore, setShowMore] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const [text, setText] = useState(TEMPLATES[0].body);
  const [template, setTemplate] = useState("");

  const [mode, setMode] = useState<Mode>("semana");
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState("09:00");
  const [weekdays, setWeekdays] = useState<number[]>([0]);
  const [monthday, setMonthday] = useState(1);

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [sending, setSending] = useState(false);

  /* ── Datos ───────────────────────────────────────────────── */

  const loadHistory = useCallback(async () => {
    const { data } = await supabase
      .from("messages")
      .select("id, content, status, created_at, clients(name)")
      .eq("channel", "whatsapp")
      .order("created_at", { ascending: false })
      .limit(30);
    if (!data) return;
    setHistory(
      (data as unknown as { id: string; content: string; status: string; created_at: string; clients: { name: string } | null }[]).map((m) => ({
        id: m.id,
        name: m.clients?.name || "Cliente",
        titulo: (m.content || "").replace(/\s+/g, " ").trim() + " · WhatsApp",
        when: new Date(m.created_at).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
        status: m.status === "sent" || m.status === "delivered" ? "Enviado" : "Fallido",
      }))
    );
  }, [supabase]);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      const [clientsRes, budgetsRes, invoicesRes, connRes] = await Promise.all([
        supabase.from("clients").select("id, name, phone, company, status").order("name"),
        supabase.from("budgets").select("client_id, status, total"),
        supabase.from("issued_invoices").select("client_id, total, due_date, payment_status, status"),
        fetch("/api/integrations/whatsapp").then((r) => r.json()).catch(() => null),
      ]);
      if (!alive) return;

      const pending = new Map<string, number>();
      for (const b of (budgetsRes.data || []) as { client_id: string | null; status: string; total: number | null }[]) {
        if (!b.client_id || !OPEN_BUDGET_STATUSES.includes(b.status)) continue;
        pending.set(b.client_id, (pending.get(b.client_id) || 0) + Number(b.total || 0));
      }

      const now = Date.now();
      const overdue = new Map<string, number>();
      for (const i of (invoicesRes.data || []) as { client_id: string | null; total: number | null; due_date: string | null; payment_status: string; status: string }[]) {
        if (!i.client_id || !i.due_date) continue;
        if (i.payment_status === "paid" || i.status === "cancelled") continue;
        if (new Date(i.due_date).getTime() >= now) continue;
        overdue.set(i.client_id, (overdue.get(i.client_id) || 0) + Number(i.total || 0));
      }

      const rows: MessagingClient[] = ((clientsRes.data || []) as { id: string; name: string; phone: string | null; company: string | null; status: string | null }[])
        .filter((c) => (c.phone || "").trim().length > 0)
        .map((c) => ({
          id: c.id,
          name: c.name,
          address: c.phone as string,
          company: c.company || "",
          status: c.status || "",
          pending: pending.get(c.id) || 0,
          overdue: overdue.get(c.id) || 0,
        }));

      setClients(rows);
      setSelected(rows.map((c) => c.id));
      setConnected(Boolean(connRes?.connected));
      setLoading(false);
    };

    load();
    loadHistory();
    return () => {
      alive = false;
    };
  }, [supabase, loadHistory]);

  /* ── Derivados ───────────────────────────────────────────── */

  const byId = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const sel = useMemo(() => selected.map((id) => byId.get(id)).filter(Boolean) as MessagingClient[], [selected, byId]);
  const n = sel.length;

  const preview = sel[0] || clients[0] || null;
  const previewName = preview?.name || "Tu cliente";
  const previewText = preview ? personalize(text, preview) : text;
  const isNow = mode === "ahora";
  const canSend = connected === true && n > 0 && !sending;
  const summary = scheduleSummary(mode, date, time, weekdays, monthday, n, { one: "mensaje", many: "mensajes" });

  /* ── Acciones ────────────────────────────────────────────── */

  const sendNow = async () => {
    setSending(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    /* Un único request para toda la lista: el fan-out ocurre en el servidor,
       si no el límite de 10 peticiones/minuto tumbaría los envíos grandes. */
    const bodies = new Map(sel.map((c) => [c.id, personalize(text, c)]));
    const res = await fetch("/api/whatsapp/send-bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipients: sel.map((c) => ({ client_id: c.id, to: c.address, message: bodies.get(c.id) })),
      }),
    }).catch(() => null);
    const payload = res ? await res.json().catch(() => null) : null;

    if (!res || !res.ok) {
      setSending(false);
      toast.error(payload?.error || "No se pudo completar el envío.");
      return;
    }

    const outcomes: { client_id: string | null; sent: boolean; error?: string }[] = payload?.results || [];
    const rows = outcomes
      .filter((o) => o.client_id && bodies.has(o.client_id))
      .map((o) => ({
        user_id: user?.id,
        client_id: o.client_id,
        channel: "whatsapp",
        content: bodies.get(o.client_id as string),
        status: o.sent ? "sent" : "failed",
        sent_at: o.sent ? new Date().toISOString() : null,
      }));
    if (rows.length) await supabase.from("messages").insert(rows);

    await loadHistory();
    setSending(false);

    const ok = payload?.sent ?? 0;
    const failMsg = outcomes.find((o) => !o.sent)?.error || "Algunos mensajes no salieron.";
    if (ok === sel.length) toast.success(ok + (ok === 1 ? " mensaje enviado" : " mensajes enviados"));
    else if (ok > 0) toast.error(ok + " de " + sel.length + " enviados. " + failMsg);
    else toast.error(failMsg);
  };

  const confirm = () => {
    if (connected !== true) {
      toast.info("Conecta WhatsApp Business en Ajustes → Integraciones para poder enviar.");
      return;
    }
    if (!n) {
      toast.error("Selecciona al menos un cliente");
      return;
    }
    if (isNow) {
      sendNow();
      return;
    }
    const label = MODES.find((m) => m[0] === mode)![1];
    setQueue((prev) => [
      {
        id: "q" + Date.now(),
        canal: "WhatsApp",
        titulo: template || "Envío sin título",
        recips: n + (n === 1 ? " cliente" : " clientes"),
        next: fmtDate(date) + " · " + time,
        rec: label,
        status: "Activo",
      },
      ...prev,
    ]);
    setTab("programados");
    toast.success("Envío programado — " + summary.toLowerCase());
  };

  return (
    <div data-msg-surface style={{ maxWidth: 1180, display: "flex", flexDirection: "column", gap: 22, fontSize: 14 }}>
      {connected === false && (
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "15px 18px", border: "1px solid var(--msg-warn-bd)", borderRadius: 14, background: "var(--msg-warn-soft)" }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--msg-warn)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "0 0 auto" }}>
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginRight: "auto" }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Conecta WhatsApp Business para enviar</span>
            <span style={{ fontSize: 13, color: "var(--msg-tx-2)" }}>
              Para enviar mensajes reales necesitas conectar tu cuenta de Meta Business.
            </span>
          </div>
          <Link href="/dashboard/settings/integrations" style={{ display: "flex", alignItems: "center", gap: 7, padding: "10px 15px", border: "1px solid var(--msg-bd-2)", borderRadius: 10, background: "var(--msg-panel)", color: "var(--msg-tx)", fontWeight: 700, fontSize: 13, whiteSpace: "nowrap" }}>
            Ir a Integraciones
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </Link>
        </div>
      )}

      <TabBar
        active={tab}
        onPick={setTab}
        tabs={[
          { key: "nuevo" as const, label: "Nuevo envío" },
          { key: "programados" as const, label: "Programados", badge: queue.length },
        ]}
      />

      {tab === "nuevo" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <AudienceSelector
            clients={clients}
            selected={selected}
            onSelectedChange={setSelected}
            filter={filter}
            onFilterChange={setFilter}
            query={query}
            onQueryChange={setQuery}
            showMore={showMore}
            onShowMoreChange={setShowMore}
            loading={loading}
            searchPlaceholder="Busca por nombre, empresa o teléfono…"
            secondaryOf={(c) => c.company}
            emptyHint="Ningún cliente tiene teléfono. Añádelos en la sección Clientes."
          />

          <Composer
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--msg-brand-tx)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            }
            templates={TEMPLATES}
            template={template}
            onTemplatePick={(name) => {
              const t = TEMPLATES.find((x) => x.name === name);
              setTemplate(name);
              if (t) setText(t.body);
            }}
            text={text}
            onTextChange={setText}
            charLabel={`${text.length} caracteres · ${n} ${n === 1 ? "mensaje" : "mensajes"}`}
            previewCaption={`Variables resueltas con datos de ${previewName}. Cada cliente recibe su versión.`}
            preview={
              <>
                <span style={{ fontSize: 12.5, color: "var(--msg-mut)", textAlign: "center", fontWeight: 600 }}>Así lo recibe tu cliente</span>
                <div style={{ borderRadius: 16, overflow: "hidden", border: "1px solid var(--msg-bd-2)", background: "var(--msg-bub-bg)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "11px 13px", background: "#075e54" }}>
                    <span style={{ width: 26, height: 26, borderRadius: "50%", display: "grid", placeItems: "center", background: "rgba(255,255,255,.18)", color: "#fff", fontSize: 10.5, fontWeight: 800 }}>{initials(previewName)}</span>
                    <span style={{ color: "#fff", fontSize: 13, fontWeight: 700 }}>{previewName}</span>
                    <span style={{ marginLeft: "auto", color: "rgba(255,255,255,.6)", fontSize: 11 }}>en línea</span>
                  </div>
                  <div style={{ padding: "16px 13px 20px", display: "flex", flexDirection: "column", gap: 8, minHeight: 196, justifyContent: "flex-end" }}>
                    <div style={{ alignSelf: "flex-end", maxWidth: "88%", borderRadius: "12px 12px 3px 12px", background: "var(--msg-bub)", color: "var(--msg-bub-tx)", padding: "9px 11px 6px", fontSize: 13.5, lineHeight: "20px", boxShadow: "0 1px 1px rgba(0,0,0,.18)", whiteSpace: "pre-wrap" }}>
                      {previewText}
                      <span style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, marginTop: 3, fontSize: 10.5, opacity: 0.62 }}>
                        {isNow ? "ahora" : time}
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 6 7 17l-4-4" />
                          <path d="m22 10-7.5 7.5L13 16" />
                        </svg>
                      </span>
                    </div>
                  </div>
                </div>
              </>
            }
          />

          <Scheduler
            mode={mode}
            onModeChange={setMode}
            date={date}
            onDateChange={setDate}
            time={time}
            onTimeChange={setTime}
            weekdays={weekdays}
            onWeekdaysChange={setWeekdays}
            monthday={monthday}
            onMonthdayChange={setMonthday}
            summary={summary}
          />

          <ConfirmBar
            recap={`${n} ${n === 1 ? "destinatario" : "destinatarios"} · ${isNow ? "envío inmediato" : MODES.find((m) => m[0] === mode)![1].toLowerCase()}`}
            label={sending ? "Enviando…" : connected !== true ? "Conecta WhatsApp" : isNow ? "Enviar ahora" : "Programar envío"}
            enabled={canSend}
            busy={sending}
            onConfirm={confirm}
          />
        </div>
      )}

      {tab === "programados" && (
        <ScheduledTab
          queue={queue}
          onQueueChange={setQueue}
          history={history}
          emptyBody="Responde a las tres preguntas — a quién, qué y cuándo — y tu primer envío quedará en cola."
          historyTitle="Historial de mensajes"
          historyEmpty="Todavía no has enviado ningún mensaje de WhatsApp."
          onCreateFirst={() => setTab("nuevo")}
          onEdit={() => {
            setTab("nuevo");
            toast.info("Cargado en «Nuevo envío» para editar");
          }}
          onCancel={() => toast.success("Envío cancelado")}
        />
      )}
    </div>
  );
}
