"use client";

/**
 * Ficha de cliente — la vista "ficha" del rediseño.
 *
 * TODO lo que se pinta sale de la base de datos. Lo que el diseño traía
 * inventado y NO tiene modelo detrás no se dibuja:
 *
 *  - El panel "Datos fiscales" (CIF, dirección, forma de pago, IRPF/IVA) se
 *    omite: ninguna de esas columnas existe en `clients`. Sí existen como
 *    instantánea por documento en `issued_invoices` / `budgets`, pero eso es
 *    el dato de una factura concreta, no el del cliente, y enseñarlo como
 *    ficha del cliente sería mentir.
 *  - "Actividad reciente" no sale de `activity_log` —esa tabla no registra
 *    nada con `entity_type = 'client'`— sino de las fechas reales de los
 *    documentos del propio cliente. Si no hay ninguna, el panel no aparece.
 *  - Las notas son el campo `clients.notes`, un texto único: no hay tabla de
 *    notas con autor y fecha, así que no se finge una lista.
 */

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import Loading from "@/components/ui/loading";
import { useToast } from "@/components/ui/toast";
import {
  Avatar,
  CliCard,
  CliLabel,
  Icon,
  ICONS,
  KpiTile,
  StatusPill,
  ToneDot,
  cliBtnPrimary,
  cliBtnSecondary,
  cliBtnWarning,
  type CliTone,
} from "./ui";
import {
  EMPTY_CLIENT_TOTALS,
  budgetStatusLabels,
  clientStatusLabels,
  eur,
  fmtDate,
  getClientInvoiceTotals,
  initials,
  invoiceStatusLabels,
  messageStatusLabels,
  projectStatusLabels,
  timeAgo,
  type Client,
  type ClientInvoiceTotals,
} from "@/lib/clients";

/* ─── Filas de las pestañas ───────────────────────────────────────────── */

interface TabRow {
  id: string;
  /** El "P-142" del diseño: referencia corta a la izquierda. */
  ref: string;
  title: string;
  sub: string;
  badge?: string;
  tone: CliTone;
  amount?: string;
  href?: string;
}

interface ActivityItem {
  at: string;
  text: string;
  tone: CliTone;
}

/* ─── Tonos por estado, con el vocabulario real de cada tabla ─────────── */

function budgetTone(status: string): CliTone {
  if (["aceptado", "accepted"].includes(status)) return "success";
  if (["rechazado", "rejected"].includes(status)) return "danger";
  if (["enviado", "sent"].includes(status)) return "info";
  if (["pendiente", "pending"].includes(status)) return "warning";
  return "neutral";
}

function invoiceTone(status: string, paymentStatus: string): CliTone {
  if (paymentStatus === "paid" || status === "paid") return "success";
  if (status === "overdue") return "danger";
  if (status === "cancelled") return "neutral";
  if (status === "sent") return "info";
  return "warning";
}

function projectTone(status: string): CliTone {
  if (["completed"].includes(status)) return "success";
  if (["cancelled"].includes(status)) return "danger";
  if (["in_progress", "active"].includes(status)) return "info";
  if (["paused"].includes(status)) return "warning";
  return "neutral";
}

function messageTone(status: string): CliTone {
  if (status === "sent") return "success";
  if (status === "failed") return "danger";
  return "warning";
}

const clientStatusTone: Record<string, CliTone> = {
  active: "success",
  lead: "info",
  inactive: "neutral",
};

/* ─── Formas mínimas de cada tabla ────────────────────────────────────── */

interface BudgetRow {
  id: string; budget_number: string | null; title: string | null; status: string | null;
  total: number | null; created_at: string; sent_at: string | null;
  accepted_at: string | null; rejected_at: string | null; valid_until: string | null;
}
interface InvoiceRow {
  id: string; invoice_number: string | null; status: string | null; payment_status: string | null;
  total: number | null; amount_paid: number | null; issue_date: string | null;
  due_date: string | null; payment_date: string | null; notes: string | null;
}
interface MessageRow {
  id: string; channel: string | null; content: string | null; status: string | null;
  sent_at: string | null; created_at: string | null;
}
interface ProjectRow {
  id: string; name: string; status: string | null; address: string | null;
  budget_amount: number | null; start_date: string | null; end_date: string | null;
}
interface EventRow {
  id: string; title: string; event_date: string; status: string | null;
}

type TabId = "presupuestos" | "facturas" | "mensajes" | "obras" | "notas";

export default function ClientDetail({ clientId }: { clientId: string }) {
  const supabase = createClient();
  const router = useRouter();
  const toast = useToast();

  const [client, setClient] = useState<Client | null>(null);
  const [budgets, setBudgets] = useState<BudgetRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [totals, setTotals] = useState<ClientInvoiceTotals>(EMPTY_CLIENT_TOTALS);
  /* null = todavía no se ha elegido. Al terminar la carga se abre la primera
     pestaña que tenga algo: entrar en una ficha y ver "Sin presupuestos"
     mientras las Facturas tienen contenido es la peor primera impresión
     posible. Si el cliente está vacío del todo, se queda en Presupuestos. */
  const [tab, setTab] = useState<TabId | null>(null);
  const [loading, setLoading] = useState(true);

  /* Edición de etiquetas en la propia ficha. */
  const [tagDraft, setTagDraft] = useState("");
  const [addingTag, setAddingTag] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      const { data: c } = await supabase.from("clients").select("*").eq("id", clientId).single();
      if (!alive) return;
      if (!c) {
        router.push("/dashboard/clientes");
        return;
      }
      setClient(c as Client);

      /* Todo lo que cuelga del cliente, en paralelo: son consultas
         independientes y encadenarlas multiplicaba la espera por cinco. */
      const [b, i, m, p, ev, t] = await Promise.all([
        supabase
          .from("budgets")
          .select("id, budget_number, title, status, total, created_at, sent_at, accepted_at, rejected_at, valid_until")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false }),
        supabase
          .from("issued_invoices")
          .select("id, invoice_number, status, payment_status, total, amount_paid, issue_date, due_date, payment_date, notes")
          .eq("client_id", clientId)
          .order("issue_date", { ascending: false }),
        supabase
          .from("messages")
          .select("id, channel, content, status, sent_at, created_at")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false }),
        supabase
          .from("projects")
          .select("id, name, status, address, budget_amount, start_date, end_date")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false }),
        supabase
          .from("events")
          .select("id, title, event_date, status")
          .eq("client_id", clientId)
          .order("event_date", { ascending: false }),
        getClientInvoiceTotals(supabase, clientId),
      ]);

      if (!alive) return;
      setBudgets((b.data || []) as BudgetRow[]);
      setInvoices((i.data || []) as InvoiceRow[]);
      setMessages((m.data || []) as MessageRow[]);
      setProjects((p.data || []) as ProjectRow[]);
      setEvents((ev.data || []) as EventRow[]);
      setTotals(t);
      setLoading(false);
    }
    load();
    return () => {
      alive = false;
    };
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ─── Filas por pestaña ─────────────────────────────────────────────── */

  const budgetRows: TabRow[] = useMemo(
    () =>
      budgets.map((b) => {
        const status = b.status || "";
        const when =
          b.accepted_at ? `Aceptado el ${fmtDate(b.accepted_at)}`
          : b.rejected_at ? `Rechazado el ${fmtDate(b.rejected_at)}`
          : b.sent_at ? `Enviado el ${fmtDate(b.sent_at)}`
          : `Creado el ${fmtDate(b.created_at)}`;
        return {
          id: b.id,
          ref: b.budget_number || "—",
          title: b.title || "Presupuesto sin título",
          sub: b.valid_until ? `${when} · Válido hasta ${fmtDate(b.valid_until)}` : when,
          badge: budgetStatusLabels[status] || status || undefined,
          tone: budgetTone(status),
          amount: b.total !== null ? eur(b.total) : undefined,
          href: `/dashboard/budgets/${b.id}`,
        };
      }),
    [budgets]
  );

  const invoiceRows: TabRow[] = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return invoices.map((inv) => {
      const settled = inv.payment_status === "paid" || inv.status === "paid";
      const overdue = !settled && !!inv.due_date && inv.due_date < today && inv.status !== "cancelled";
      const sub = settled
        ? `Cobrada el ${fmtDate(inv.payment_date || inv.issue_date)}`
        : overdue
          ? `Vencida el ${fmtDate(inv.due_date)}`
          : inv.due_date
            ? `Vence el ${fmtDate(inv.due_date)}`
            : `Emitida el ${fmtDate(inv.issue_date)}`;
      return {
        id: inv.id,
        ref: inv.invoice_number || "—",
        title: inv.notes?.trim() || `Factura ${inv.invoice_number || ""}`.trim(),
        sub,
        badge: overdue ? "Vencida" : invoiceStatusLabels[inv.status || ""] || inv.status || undefined,
        tone: overdue ? "danger" : invoiceTone(inv.status || "", inv.payment_status || ""),
        amount: inv.total !== null ? eur(inv.total) : undefined,
        href: `/dashboard/issued-invoices/${inv.id}`,
      };
    });
  }, [invoices]);

  const messageRows: TabRow[] = useMemo(
    () =>
      messages.map((m) => {
        const when = m.sent_at || m.created_at;
        const channel = m.channel === "whatsapp" ? "WhatsApp" : m.channel === "email" ? "Email" : m.channel || "";
        return {
          id: m.id,
          ref: m.channel === "whatsapp" ? "WA" : "@",
          title: (m.content || "").trim().slice(0, 120) || "Mensaje sin contenido",
          sub: [channel, timeAgo(when)].filter(Boolean).join(" · "),
          badge: messageStatusLabels[m.status || ""] || m.status || undefined,
          tone: messageTone(m.status || ""),
        };
      }),
    [messages]
  );

  const projectRows: TabRow[] = useMemo(
    () =>
      projects.map((p) => ({
        id: p.id,
        ref: "OBRA",
        title: p.name,
        sub: [p.address, p.start_date ? `Inicio ${fmtDate(p.start_date)}` : null]
          .filter(Boolean)
          .join(" · ") || "Sin dirección",
        badge: projectStatusLabels[p.status || ""] || p.status || undefined,
        tone: projectTone(p.status || ""),
        amount: p.budget_amount ? eur(p.budget_amount) : undefined,
        href: `/dashboard/projects/${p.id}`,
      })),
    [projects]
  );

  /* ─── Actividad derivada de fechas reales ──────────────────────────── */

  const activity: ActivityItem[] = useMemo(() => {
    const items: ActivityItem[] = [];
    for (const b of budgets) {
      const n = b.budget_number || "sin número";
      if (b.accepted_at) items.push({ at: b.accepted_at, text: `Presupuesto ${n} aceptado`, tone: "success" });
      if (b.rejected_at) items.push({ at: b.rejected_at, text: `Presupuesto ${n} rechazado`, tone: "danger" });
      if (b.sent_at) items.push({ at: b.sent_at, text: `Presupuesto ${n} enviado`, tone: "info" });
    }
    for (const inv of invoices) {
      const n = inv.invoice_number || "sin número";
      if (inv.payment_date) items.push({ at: inv.payment_date, text: `Factura ${n} cobrada`, tone: "success" });
      if (inv.issue_date) items.push({ at: inv.issue_date, text: `Factura ${n} emitida`, tone: "neutral" });
    }
    for (const m of messages) {
      const when = m.sent_at || m.created_at;
      if (!when) continue;
      const ch = m.channel === "whatsapp" ? "WhatsApp" : "Email";
      items.push({
        at: when,
        text: `${ch} ${m.status === "failed" ? "fallido" : "enviado"}`,
        tone: m.status === "failed" ? "danger" : "success",
      });
    }
    for (const e of events) {
      items.push({ at: e.event_date, text: `Cita en agenda: ${e.title}`, tone: "info" });
    }
    return items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 6);
  }, [budgets, invoices, messages, events]);

  /* ─── Etiquetas ─────────────────────────────────────────────────────── */

  async function saveTags(next: string[]) {
    if (!client) return;
    const previous = client.tags ?? [];
    setClient({ ...client, tags: next });
    const { error } = await supabase.from("clients").update({ tags: next }).eq("id", client.id);
    if (error) {
      setClient({ ...client, tags: previous });
      toast.error("No se pudieron guardar las etiquetas");
    }
  }

  if (loading) return <Loading />;
  if (!client) return null;

  const tags = client.tags ?? [];
  const tone = clientStatusTone[client.status] ?? "neutral";
  const since = new Date(client.created_at).getFullYear();

  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: "presupuestos", label: "Presupuestos", count: budgetRows.length },
    { id: "facturas", label: "Facturas", count: invoiceRows.length },
    { id: "mensajes", label: "Mensajes", count: messageRows.length },
    { id: "obras", label: "Obras", count: projectRows.length },
    { id: "notas", label: "Notas", count: client.notes?.trim() ? 1 : 0 },
  ];

  /* Se resuelve al pintar, no en un efecto: los contadores dependen de los
     cinco `useMemo` de arriba y un efecto añadiría un render intermedio con
     la pestaña equivocada. */
  const activeTab: TabId = tab ?? tabs.find((t) => t.count > 0)?.id ?? "presupuestos";

  const rowsByTab: Record<Exclude<TabId, "notas">, TabRow[]> = {
    presupuestos: budgetRows,
    facturas: invoiceRows,
    mensajes: messageRows,
    obras: projectRows,
  };

  const tabCopy: Record<TabId, { title: string; subtitle: string; action?: { label: string; href: string } }> = {
    presupuestos: {
      title: "Presupuestos",
      subtitle: `${budgetRows.length} presupuesto${budgetRows.length === 1 ? "" : "s"} de este cliente`,
      action: { label: "Nuevo presupuesto", href: "/dashboard/budgets/new" },
    },
    facturas: {
      title: "Facturas",
      subtitle:
        totals.overdue_count > 0
          ? `${totals.overdue_count} vencida${totals.overdue_count === 1 ? "" : "s"} · ${totals.pending_count} pendiente${totals.pending_count === 1 ? "" : "s"}`
          : `${invoiceRows.length} factura${invoiceRows.length === 1 ? "" : "s"} emitida${invoiceRows.length === 1 ? "" : "s"}`,
      action: { label: "Ir a Facturación", href: "/dashboard/facturacion" },
    },
    mensajes: {
      title: "Mensajes",
      subtitle: messageRows.length
        ? `Último contacto ${timeAgo(messages[0]?.sent_at || messages[0]?.created_at)}`
        : "Sin mensajes todavía",
      action: { label: "Enviar mensaje", href: "/dashboard/messages" },
    },
    obras: {
      title: "Obras",
      subtitle: `${projectRows.length} obra${projectRows.length === 1 ? "" : "s"} ligada${projectRows.length === 1 ? "" : "s"}`,
      action: { label: "Ir a Obras", href: "/dashboard/projects" },
    },
    notas: { title: "Notas", subtitle: "Visibles solo para tu equipo" },
  };

  const copy = tabCopy[activeTab];
  /* La factura vencida más antigua: es a la que lleva "Reclamar cobro". */
  const overdueInvoice = invoiceRows.find((r) => r.tone === "danger");

  const pct = (n: number) => (totals.invoiced > 0 ? Math.round((n / totals.invoiced) * 100) : 0);

  return (
    <div data-cli-surface className="mx-auto max-w-6xl">
      <Link
        href="/dashboard/clientes"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-navy-500 transition-colors hover:text-navy-900 dark:text-zinc-400 dark:hover:text-white"
      >
        <Icon path={ICONS.back} size={15} />
        Clientes
      </Link>

      {/* ── Cabecera ── */}
      <CliCard className="mb-5">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar size="lg">{initials(client.name)}</Avatar>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="truncate text-xl font-bold tracking-tight text-navy-900 dark:text-white">
                {client.name}
              </h1>
              <StatusPill tone={tone}>{clientStatusLabels[client.status] || client.status}</StatusPill>
              <span
                className="text-[12.5px] text-navy-400 dark:text-zinc-500"
                title={`Alta el ${fmtDate(client.created_at)}`}
              >
                Cliente desde {since}
              </span>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13.5px] text-navy-600 dark:text-zinc-400">
              {client.email && (
                <a
                  href={`mailto:${client.email}`}
                  className="inline-flex items-center gap-1.5 transition-colors hover:text-navy-900 dark:hover:text-white"
                >
                  <Icon path={ICONS.mail} /> {client.email}
                </a>
              )}
              {client.phone && (
                <span className="inline-flex items-center gap-1.5">
                  <Icon path={ICONS.phone} /> {client.phone}
                </span>
              )}
              {client.company && (
                <span className="inline-flex items-center gap-1.5">
                  <Icon path={ICONS.building} /> {client.company}
                </span>
              )}
            </div>
          </div>

          {/* Acciones: solo destinos reales del dashboard. */}
          <div className="flex flex-wrap items-center gap-2.5">
            <Link href="/dashboard/messages" className={cliBtnPrimary}>
              <Icon path={ICONS.whatsapp} size={16} /> WhatsApp
            </Link>
            <Link href="/dashboard/emails" className={cliBtnSecondary}>
              <Icon path={ICONS.mail} size={16} /> Email
            </Link>
            <Link href="/dashboard/budgets/new" className={cliBtnSecondary}>
              <Icon path={ICONS.doc} size={16} /> Presupuesto
            </Link>
            {overdueInvoice && (
              <Link href={overdueInvoice.href!} className={cliBtnWarning}>
                <Icon path={ICONS.euro} size={16} /> Reclamar cobro
              </Link>
            )}
          </div>
        </div>
      </CliCard>

      {/* ── Resumen ── */}
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiTile
          label="Te debe"
          value={eur(totals.overdue)}
          tone={totals.overdue > 0 ? "danger" : "neutral"}
          pct={pct(totals.overdue)}
          detail={
            totals.overdue_count > 0
              ? `${totals.overdue_count} factura${totals.overdue_count === 1 ? "" : "s"} vencida${totals.overdue_count === 1 ? "" : "s"} desde el ${fmtDate(totals.oldest_overdue_date)}`
              : "Sin facturas vencidas"
          }
        />
        <KpiTile
          label="Total facturado"
          value={eur(totals.invoiced)}
          tone="neutral"
          pct={totals.invoiced > 0 ? 100 : 0}
          detail={
            totals.invoice_count > 0
              ? `${totals.invoice_count} factura${totals.invoice_count === 1 ? "" : "s"} desde ${since}`
              : "Sin facturas emitidas"
          }
        />
        <KpiTile
          label="Pendiente"
          value={eur(totals.pending)}
          tone={totals.pending > 0 ? "warning" : "neutral"}
          pct={pct(totals.pending)}
          detail={
            totals.next_due_date
              ? `Vence el ${fmtDate(totals.next_due_date)}`
              : totals.pending > 0
                ? "Sin fecha de vencimiento"
                : "Nada pendiente de cobro"
          }
        />
      </div>

      {/* ── Pestañas + panel lateral ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <CliCard padded={false} className="overflow-hidden">
          <div className="flex flex-wrap gap-1.5 border-b border-navy-100 p-3 dark:border-zinc-800">
            {tabs.map((t) => {
              const on = t.id === activeTab;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  aria-pressed={on}
                  className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-[13.5px] font-bold transition-colors ${
                    on
                      ? "bg-brand-green/12 text-success-ink"
                      : "text-navy-500 hover:bg-navy-50 hover:text-navy-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
                  }`}
                >
                  {t.label}
                  <span
                    className={`rounded-full px-1.5 py-px text-[11px] font-bold tabular-nums ${
                      on
                        ? "bg-brand-green text-white"
                        : "bg-navy-100 text-navy-500 dark:bg-zinc-800 dark:text-zinc-400"
                    }`}
                  >
                    {t.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="min-w-0">
              <div className="text-[15px] font-bold text-navy-900 dark:text-white">{copy.title}</div>
              <div className="text-[12.5px] text-navy-500 dark:text-zinc-400">{copy.subtitle}</div>
            </div>
            {copy.action && (
              <Link
                href={copy.action.href}
                className="inline-flex items-center gap-1.5 rounded-lg border border-navy-200 px-3 py-1.5 text-[12.5px] font-semibold text-navy-600 transition-colors hover:border-brand-green hover:text-success-ink dark:border-zinc-700 dark:text-zinc-300"
              >
                <Icon path={ICONS.plus} size={13} />
                {copy.action.label}
              </Link>
            )}
          </div>

          {activeTab === "notas" ? (
            <div className="border-t border-navy-100 px-5 py-5 dark:border-zinc-800">
              {client.notes?.trim() ? (
                <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-navy-700 dark:text-zinc-300">
                  {client.notes}
                </p>
              ) : (
                <EmptyRow text="Sin notas para este cliente." />
              )}
            </div>
          ) : rowsByTab[activeTab].length === 0 ? (
            <div className="border-t border-navy-100 px-5 py-5 dark:border-zinc-800">
              <EmptyRow text={`Sin ${copy.title.toLowerCase()} para este cliente.`} />
            </div>
          ) : (
            <ul className="border-t border-navy-100 dark:border-zinc-800">
              {rowsByTab[activeTab].map((r) => (
                <li key={r.id}>
                  <RowBody row={r} />
                </li>
              ))}
            </ul>
          )}
        </CliCard>

        <div className="flex flex-col gap-5">
          {/* ── Etiquetas ── */}
          <CliCard>
            <CliLabel>Etiquetas</CliLabel>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex h-6 items-center gap-1 rounded-full bg-info/12 px-2.5 text-[11.5px] font-bold text-info-ink ring-1 ring-inset ring-info/30"
                >
                  {t}
                  <button
                    type="button"
                    onClick={() => saveTags(tags.filter((x) => x !== t))}
                    aria-label={`Quitar etiqueta ${t}`}
                    className="ml-0.5 text-info-ink/70 transition-opacity hover:opacity-100"
                  >
                    ×
                  </button>
                </span>
              ))}

              {addingTag ? (
                <input
                  autoFocus
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onBlur={() => {
                    const t = tagDraft.trim();
                    if (t) saveTags([...tags, t]);
                    setTagDraft("");
                    setAddingTag(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") {
                      setTagDraft("");
                      setAddingTag(false);
                    }
                  }}
                  placeholder="Nombre"
                  aria-label="Nueva etiqueta"
                  className="h-6 w-24 rounded-full border border-brand-green bg-transparent px-2.5 text-[11.5px] font-semibold text-navy-900 outline-none dark:text-white"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setAddingTag(true)}
                  className="inline-flex h-6 items-center rounded-full border border-dashed border-navy-300 px-2.5 text-[11.5px] font-bold text-navy-500 transition-colors hover:border-brand-green hover:text-success-ink dark:border-zinc-700 dark:text-zinc-400"
                >
                  + Añadir
                </button>
              )}

              {tags.length === 0 && !addingTag && (
                <span className="text-[12.5px] text-navy-400 dark:text-zinc-500">
                  Sin etiquetas todavía.
                </span>
              )}
            </div>
          </CliCard>

          {/* ── Actividad reciente: solo si hay hechos reales ── */}
          {activity.length > 0 && (
            <CliCard>
              <CliLabel>Actividad reciente</CliLabel>
              <ul className="mt-3 flex flex-col gap-3">
                {activity.map((a, idx) => (
                  <li key={`${a.at}-${idx}`} className="flex gap-2.5">
                    <ToneDot tone={a.tone} className="mt-1.5 h-2 w-2" />
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-navy-800 dark:text-zinc-200">
                        {a.text}
                      </div>
                      <div className="text-[11.5px] text-navy-400 dark:text-zinc-500">
                        {timeAgo(a.at)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </CliCard>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Piezas de fila ──────────────────────────────────────────────────── */

function EmptyRow({ text }: { text: string }) {
  return <p className="text-[13.5px] text-navy-400 dark:text-zinc-500">{text}</p>;
}

function RowBody({ row }: { row: TabRow }) {
  const content = (
    <div className="flex items-center gap-3.5 border-b border-navy-100 px-5 py-4 transition-colors last:border-b-0 hover:bg-navy-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50">
      {/* El diseño asumía referencias cortas ("P-142"). Las reales son
          "F-2026/0004" o "PRE-2026-001" y se salían del recuadro fijo de
          44px: ancho flexible con mínimo y máximo, y el valor completo en el
          title para lo que no quepa. */}
      <span
        title={row.ref}
        className="flex h-9 min-w-11 max-w-[84px] shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-navy-100 bg-navy-50 px-1.5 text-[11px] font-bold text-navy-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
      >
        <span className="truncate">{row.ref}</span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-semibold text-navy-900 dark:text-white">
          {row.title}
        </div>
        <div className="truncate text-[12px] text-navy-500 dark:text-zinc-400">{row.sub}</div>
      </div>
      {row.badge && <StatusPill tone={row.tone}>{row.badge}</StatusPill>}
      {row.amount && (
        <span className="w-24 shrink-0 text-right text-[13.5px] font-bold tabular-nums text-navy-900 dark:text-white">
          {row.amount}
        </span>
      )}
    </div>
  );

  return row.href ? (
    <Link href={row.href} className="block">
      {content}
    </Link>
  ) : (
    content
  );
}
