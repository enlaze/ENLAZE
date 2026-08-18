/* eslint-disable react-hooks/set-state-in-effect */
"use client";

/**
 * Superficie de Emails: la bandeja de Gmail clasificada por importancia y el
 * envío automatizado, planteado como las mismas tres preguntas que WhatsApp
 * — ¿a quién?, ¿qué? y ¿cuándo? — con vista previa de cómo llega el email.
 *
 * El motor (selector de audiencia, composer y programador) es el de
 * components/messaging/, compartido con WhatsApp; aquí viven el asunto, el
 * preview de bandeja y la clasificación del correo entrante.
 *
 * OJO: la cola de "Programados" es estado local — todavía no hay tabla ni
 * worker que despache envíos diferidos. El envío inmediato sí es real
 * (POST /api/email/send-bulk + filas en `messages`).
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
  card,
  fmtDate,
  initials,
  personalize,
  scheduleSummary,
  sectionTitle,
  todayISO,
} from "@/components/messaging/shared";

/* ── Bandeja ─────────────────────────────────────────────────── */

type Importance = "critical" | "important" | "normal" | "noise";

type ClassifiedThread = {
  thread_id: string;
  from_name: string;
  from_email: string;
  subject: string;
  snippet: string;
  hours_waiting: number;
  category: string;
  importance: Importance;
};

type InboxData = {
  connected?: boolean;
  status?: string;
  error_message?: string | null;
  total_unread?: number;
  classified_threads?: ClassifiedThread[];
  summary?: string;
};

const CATEGORY_LABEL: Record<string, string> = {
  customer: "Cliente",
  supplier: "Proveedor",
  lead: "Oportunidad",
  internal: "Interno",
  spam: "Promo",
  unknown: "Sin clasificar",
};

/**
 * Los tres cajones del diseño sobre las cuatro importancias del clasificador:
 * lo crítico e importante pide respuesta, lo normal es seguimiento y el ruido
 * (boletines, promos) queda abajo.
 */
const GRUPOS: { key: "alta" | "media" | "baja"; label: string; hint: string; dot: string; has: (i: Importance) => boolean }[] = [
  { key: "alta", label: "Importantes", hint: "requieren tu respuesta", dot: "var(--msg-dang)", has: (i) => i === "critical" || i === "important" },
  { key: "media", label: "Seguimiento", hint: "conversaciones en curso", dot: "var(--msg-brand)", has: (i) => i === "normal" },
  { key: "baja", label: "Resto", hint: "boletines y avisos", dot: "var(--msg-mut)", has: (i) => i === "noise" },
];

/** Estados de Gmail que el diseño distingue. */
type GmailState = "connected" | "expired" | "disconnected" | "error";

const EXPIRED_STATUSES = ["expired_token", "auth_expired", "decrypt_failed", "refresh_failed", "no_refresh_token"];

function gmailStateOf(inbox: InboxData | null): GmailState {
  if (!inbox) return "error";
  if (inbox.connected) return "connected";
  if (EXPIRED_STATUSES.includes(inbox.status || "")) return "expired";
  if (inbox.status === "not_connected" || inbox.status === "no_credentials") return "disconnected";
  return "error";
}

function formatWaiting(hours: number): string {
  if (hours < 1) return "hace un momento";
  if (hours < 24) return `hace ${hours}h`;
  const d = Math.round(hours / 24);
  return `hace ${d} día${d === 1 ? "" : "s"}`;
}

/* ── Plantillas ──────────────────────────────────────────────── */

/* El pie con el nombre del negocio lo añade el propio envío (lib/gmail-send),
   por eso las plantillas cierran sin firma. */
const TEMPLATES: { name: string; subject: string; body: string }[] = [
  {
    name: "Recordatorio de presupuesto",
    subject: "Tu presupuesto de {importe} sigue disponible",
    body: "Hola {nombre},\n\nTe recuerdo que el presupuesto que preparamos para {empresa} sigue disponible por {importe}.\n\nSi quieres, lo revisamos juntos esta semana.\n\nUn saludo",
  },
  {
    name: "Aviso de factura vencida",
    subject: "Factura pendiente de {empresa}",
    body: "Hola {nombre},\n\nTenemos pendiente la factura de {importe} de {empresa}. ¿Te ayudo con el pago o prefieres otra forma?\n\nGracias",
  },
  {
    name: "Resumen mensual de trabajos",
    subject: "Resumen del mes para {empresa}",
    body: "Hola {nombre},\n\nTe paso el resumen de los trabajos de este mes en {empresa}, con el detalle de importes y próximos pasos.\n\nCualquier duda, respóndeme a este correo.\n\nUn saludo",
  },
  {
    name: "Seguimiento trimestral",
    subject: "¿Cómo va todo en {empresa}?",
    body: "Hola {nombre},\n\n¿Cómo va todo en {empresa}? Te escribo por si necesitáis algo este trimestre.\n\nUn saludo",
  },
];

export default function EmailSurface() {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();

  const [clients, setClients] = useState<MessagingClient[]>([]);
  const [withoutEmail, setWithoutEmail] = useState(0);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [inbox, setInbox] = useState<InboxData | null>(null);
  const [inboxLoading, setInboxLoading] = useState(true);

  const [senderEmail, setSenderEmail] = useState("");
  const [senderName, setSenderName] = useState("Tu empresa");

  const [tab, setTab] = useState<"bandeja" | "nuevo" | "programados">("bandeja");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("todos");
  const [showMore, setShowMore] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const [subject, setSubject] = useState(TEMPLATES[0].subject);
  const [text, setText] = useState(TEMPLATES[0].body);
  const [template, setTemplate] = useState(TEMPLATES[0].name);

  const [mode, setMode] = useState<Mode>("mes");
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState("08:30");
  const [weekdays, setWeekdays] = useState<number[]>([0]);
  const [monthday, setMonthday] = useState(1);

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [sending, setSending] = useState(false);

  /* ── Datos ───────────────────────────────────────────────── */

  const loadHistory = useCallback(async () => {
    const { data } = await supabase
      .from("messages")
      .select("id, content, status, created_at, clients(name)")
      .eq("channel", "email")
      .order("created_at", { ascending: false })
      .limit(30);
    if (!data) return;
    setHistory(
      (data as unknown as { id: string; content: string; status: string; created_at: string; clients: { name: string } | null }[]).map((m) => ({
        id: m.id,
        /* El contenido se guarda como "asunto | cuerpo"; en el historial
           interesa el asunto. */
        name: m.clients?.name || "Cliente",
        titulo: (m.content || "").split(" | ")[0].replace(/\s+/g, " ").trim() + " · Email",
        when: new Date(m.created_at).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
        status: m.status === "sent" || m.status === "delivered" ? "Enviado" : "Fallido",
      }))
    );
  }, [supabase]);

  const loadInbox = useCallback(async () => {
    setInboxLoading(true);
    const json = await fetch("/api/agent/gmail/summary")
      .then((r) => r.json())
      .catch(() => null);
    setInbox(json);
    setInboxLoading(false);
  }, []);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const [clientsRes, budgetsRes, invoicesRes, profileRes, connRes] = await Promise.all([
        supabase.from("clients").select("id, name, email, company, status").order("name"),
        supabase.from("budgets").select("client_id, status, total"),
        supabase.from("issued_invoices").select("client_id, total, due_date, payment_status, status"),
        user
          ? supabase.from("profiles").select("business_name, full_name").eq("id", user.id).maybeSingle()
          : Promise.resolve({ data: null }),
        user
          ? supabase.from("agent_connections").select("credentials_ref").eq("user_id", user.id).eq("module", "gmail").maybeSingle()
          : Promise.resolve({ data: null }),
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

      const all = (clientsRes.data || []) as { id: string; name: string; email: string | null; company: string | null; status: string | null }[];
      const rows: MessagingClient[] = all
        .filter((c) => (c.email || "").trim().length > 0)
        .map((c) => ({
          id: c.id,
          name: c.name,
          address: c.email as string,
          company: c.company || "",
          status: c.status || "",
          pending: pending.get(c.id) || 0,
          overdue: overdue.get(c.id) || 0,
        }));

      /* El email de la cuenta de Gmail conectada va en claro dentro de
         credentials_ref (el token sí está cifrado); si no hay conexión,
         el del usuario es la mejor aproximación para el preview. */
      let gmailAddress = user?.email || "";
      const rawCreds = (connRes.data as { credentials_ref?: unknown } | null)?.credentials_ref;
      if (rawCreds) {
        try {
          const parsed = typeof rawCreds === "string" ? JSON.parse(rawCreds) : rawCreds;
          if (parsed?.email) gmailAddress = parsed.email;
        } catch {
          /* credentials_ref ilegible: nos quedamos con el email del usuario. */
        }
      }

      const profile = profileRes.data as { business_name?: string | null; full_name?: string | null } | null;

      setClients(rows);
      setWithoutEmail(all.length - rows.length);
      setSelected(rows.map((c) => c.id));
      setSenderEmail(gmailAddress);
      setSenderName(profile?.business_name || profile?.full_name || "Tu empresa");
      setLoading(false);
    };

    load();
    loadHistory();
    loadInbox();
    return () => {
      alive = false;
    };
  }, [supabase, loadHistory, loadInbox]);

  /* ── Derivados ───────────────────────────────────────────── */

  const byId = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const sel = useMemo(() => selected.map((id) => byId.get(id)).filter(Boolean) as MessagingClient[], [selected, byId]);
  const n = sel.length;

  const gmailState = gmailStateOf(inbox);
  const connected = gmailState === "connected";

  const preview = sel[0] || clients[0] || null;
  const previewName = preview?.name || "Tu cliente";
  const previewEmail = preview?.address || "su email";
  const previewSubject = (preview ? personalize(subject, preview) : subject) || "(sin asunto)";
  const previewText = preview ? personalize(text, preview) : text;
  const previewSnippet = previewText.replace(/\n+/g, " ").slice(0, 90);
  const isNow = mode === "ahora";
  const canSend = connected && n > 0 && !sending;
  const summary = scheduleSummary(mode, date, time, weekdays, monthday, n, { one: "email", many: "emails" });

  const groups = useMemo(() => {
    const threads = inbox?.classified_threads || [];
    return GRUPOS.map((g) => ({
      ...g,
      items: threads.filter((t) => g.has(t.importance)),
    })).filter((g) => g.items.length > 0);
  }, [inbox]);

  /* ── Acciones ────────────────────────────────────────────── */

  const sendNow = async () => {
    setSending(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    /* Un único request para toda la lista: el fan-out ocurre en el servidor,
       si no el límite de 10 peticiones/minuto tumbaría los envíos grandes. */
    const drafts = new Map(
      sel.map((c) => [c.id, { subject: personalize(subject, c), body: personalize(text, c) }])
    );
    const res = await fetch("/api/email/send-bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipients: sel.map((c) => ({
          client_id: c.id,
          to: c.address,
          subject: drafts.get(c.id)!.subject,
          message: drafts.get(c.id)!.body,
        })),
      }),
    }).catch(() => null);
    const payload = res ? await res.json().catch(() => null) : null;

    if (!res || !res.ok) {
      setSending(false);
      toast.error(payload?.error || "No se pudo completar el envío.");
      if (payload?.code === "gmail_reconnect_required") loadInbox();
      return;
    }

    const outcomes: { client_id: string | null; sent: boolean; error?: string }[] = payload?.results || [];
    const rows = outcomes
      .filter((o) => o.client_id && drafts.has(o.client_id))
      .map((o) => {
        const draft = drafts.get(o.client_id as string)!;
        return {
          user_id: user?.id,
          client_id: o.client_id,
          channel: "email",
          /* Mismo formato "asunto | cuerpo" que ya usaba la pantalla anterior. */
          content: draft.subject + " | " + draft.body,
          status: o.sent ? "sent" : "failed",
          sent_at: o.sent ? new Date().toISOString() : null,
        };
      });
    if (rows.length) await supabase.from("messages").insert(rows);

    await loadHistory();
    setSending(false);

    const ok = payload?.sent ?? 0;
    const failMsg = outcomes.find((o) => !o.sent)?.error || "Algunos emails no salieron.";
    if (ok === sel.length) toast.success(ok + (ok === 1 ? " email enviado" : " emails enviados") + " por Gmail");
    else if (ok > 0) toast.error(ok + " de " + sel.length + " enviados. " + failMsg);
    else toast.error(failMsg);
  };

  const confirm = () => {
    if (!connected) {
      toast.info(
        gmailState === "expired"
          ? "La sesión de Gmail ha caducado. Reconéctala en Ajustes → Integraciones."
          : "Conecta Gmail en Ajustes → Integraciones para poder enviar."
      );
      return;
    }
    if (!n) {
      toast.error("Selecciona al menos un cliente con email");
      return;
    }
    if (!subject.trim()) {
      toast.error("El asunto no puede estar vacío");
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
        canal: "Email",
        titulo: template || subject || "Envío sin título",
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

  /* ── Bandeja ─────────────────────────────────────────────── */

  const lockedCopy =
    gmailState === "expired"
      ? {
          title: "Sesión de Gmail caducada",
          body: "Vuelve a autorizar la cuenta para recuperar tu bandeja clasificada por importancia.",
          cta: "Reconectar Gmail",
        }
      : gmailState === "disconnected"
        ? {
            title: "Gmail no conectado",
            body: "Conecta tu cuenta de Gmail para ver aquí tus correos entrantes clasificados por importancia.",
            cta: "Conectar Gmail",
          }
        : {
            title: "Gmail no disponible ahora mismo",
            body: inbox?.error_message || `No se ha podido leer la bandeja (${inbox?.status || "error"}). Prueba a reconectar Gmail.`,
            cta: "Ir a Integraciones",
          };

  const tagStyle = (t: ClassifiedThread) =>
    t.importance === "critical"
      ? { bg: "var(--msg-dang-soft)", fg: "var(--msg-dang)" }
      : t.category === "customer" || t.category === "lead"
        ? { bg: "var(--msg-brand-soft)", fg: "var(--msg-brand-tx)" }
        : { bg: "var(--msg-chip)", fg: "var(--msg-tx-2)" };

  const renderInbox = () => {
    if (inboxLoading) {
      return (
        <div style={{ ...card, padding: "70px 24px", textAlign: "center", fontSize: 14, color: "var(--msg-mut)" }}>
          Cargando bandeja…
        </div>
      );
    }

    if (!connected) {
      return (
        <div style={{ ...card, padding: "70px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, display: "grid", placeItems: "center", background: "var(--msg-brand-soft)" }}>
            <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="var(--msg-brand-tx)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m2 7 10 6 10-6" />
            </svg>
          </div>
          <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.02em" }}>{lockedCopy.title}</span>
          <span style={{ fontSize: 14, color: "var(--msg-mut)", maxWidth: 400, lineHeight: 1.6 }}>{lockedCopy.body}</span>
          <Link href="/dashboard/settings/integrations" style={{ marginTop: 8, padding: "12px 20px", borderRadius: 12, background: "var(--msg-brand-deep)", color: "#fff", fontSize: 14, fontWeight: 800 }}>
            {lockedCopy.cta}
          </Link>
        </div>
      );
    }

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={sectionTitle}>Bandeja de entrada (Gmail)</h2>
          <span style={{ fontSize: 13, color: "var(--msg-mut)" }}>clasificada por importancia</span>
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 7, padding: "5px 11px", borderRadius: 20, background: "var(--msg-brand-soft)", color: "var(--msg-brand-tx)", fontSize: 12.5, fontWeight: 700 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 7 17l-4-4" />
            </svg>
            Gmail conectado
          </span>
        </div>

        {groups.length === 0 ? (
          <div style={{ ...card, padding: "64px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
            <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.02em" }}>Todo al día</span>
            <span style={{ fontSize: 14, color: "var(--msg-mut)" }}>No hay correos entrantes pendientes en los últimos 7 días.</span>
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.key} style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: g.dot }} />
                <span style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: "-.01em" }}>{g.label}</span>
                <span style={{ fontSize: 12.5, color: "var(--msg-mut)" }}>{g.hint}</span>
                <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--msg-mut)", fontWeight: 600 }}>
                  {g.items.length} {g.items.length === 1 ? "correo" : "correos"}
                </span>
              </div>
              <div style={{ border: "1px solid var(--msg-bd)", borderRadius: 15, background: "var(--msg-panel)", boxShadow: "var(--msg-sh)", overflow: "hidden" }}>
                {g.items.map((m, i) => {
                  const tag = tagStyle(m);
                  /* Lo que pide respuesta se pinta en negrita, como el no leído. */
                  const fw = m.importance === "critical" || m.importance === "important" ? 800 : 600;
                  return (
                    <div key={m.thread_id || i} data-msg-row style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "14px 18px", borderBottom: "1px solid var(--msg-bd)" }}>
                      <span style={{ width: 31, height: 31, flex: "0 0 auto", borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--msg-chip)", color: "var(--msg-tx-2)", fontSize: 11, fontWeight: 800 }}>
                        {initials(m.from_name || m.from_email || "?")}
                      </span>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          <span style={{ fontSize: 14, fontWeight: fw }}>{m.from_name || m.from_email}</span>
                          <span style={{ padding: "2px 8px", borderRadius: 6, background: tag.bg, color: tag.fg, fontSize: 11, fontWeight: 700 }}>
                            {CATEGORY_LABEL[m.category] || m.category}
                          </span>
                        </div>
                        <span style={{ fontSize: 13.5, fontWeight: fw, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.subject}</span>
                        <span style={{ fontSize: 12.5, color: "var(--msg-mut)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.snippet}</span>
                      </div>
                      <span style={{ fontSize: 12.5, color: "var(--msg-mut)", whiteSpace: "nowrap", paddingTop: 2 }}>{formatWaiting(m.hours_waiting)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    );
  };

  return (
    <div data-msg-surface style={{ maxWidth: 1180, display: "flex", flexDirection: "column", gap: 22, fontSize: 14 }}>
      {gmailState === "expired" && (
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "15px 18px", border: "1px solid var(--msg-warn-bd)", borderRadius: 14, background: "var(--msg-warn-soft)" }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--msg-warn)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "0 0 auto" }}>
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <path d="M21 3v6h-6" />
          </svg>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginRight: "auto" }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>La sesión de Gmail ha caducado</span>
            <span style={{ fontSize: 13, color: "var(--msg-tx-2)" }}>
              Vuelve a autorizar la cuenta para seguir leyendo la bandeja y enviando emails.
            </span>
          </div>
          <Link href="/dashboard/settings/integrations" style={{ display: "flex", alignItems: "center", gap: 7, padding: "10px 15px", borderRadius: 10, background: "var(--msg-brand-deep)", color: "#fff", fontWeight: 800, fontSize: 13, whiteSpace: "nowrap" }}>
            Reconectar Gmail
          </Link>
        </div>
      )}

      {gmailState === "disconnected" && (
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "15px 18px", border: "1px solid var(--msg-warn-bd)", borderRadius: 14, background: "var(--msg-warn-soft)" }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--msg-warn)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "0 0 auto" }}>
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginRight: "auto" }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Conecta Gmail para enviar</span>
            <span style={{ fontSize: 13, color: "var(--msg-tx-2)" }}>
              Puedes preparar el envío ahora, pero hace falta conectar la cuenta para que salga.
            </span>
          </div>
          <Link href="/dashboard/settings/integrations" style={{ display: "flex", alignItems: "center", gap: 7, padding: "10px 15px", border: "1px solid var(--msg-bd-2)", borderRadius: 10, background: "var(--msg-panel)", color: "var(--msg-tx)", fontWeight: 700, fontSize: 13, whiteSpace: "nowrap" }}>
            Conectar Gmail
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
          { key: "bandeja" as const, label: "Bandeja" },
          { key: "nuevo" as const, label: "Nuevo envío" },
          { key: "programados" as const, label: "Programados", badge: queue.length },
        ]}
      />

      {tab === "bandeja" && renderInbox()}

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
            searchPlaceholder="Busca por nombre, empresa o email…"
            secondaryOf={(c) => c.address}
            emptyHint="Ningún cliente tiene email. Añádelos en la sección Clientes."
            trailingNote={withoutEmail > 0 ? `${withoutEmail} ${withoutEmail === 1 ? "cliente sin email queda fuera" : "clientes sin email quedan fuera"}` : undefined}
          />

          <Composer
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--msg-brand-tx)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="m2 7 10 6 10-6" />
              </svg>
            }
            templates={TEMPLATES}
            template={template}
            onTemplatePick={(name) => {
              const t = TEMPLATES.find((x) => x.name === name);
              setTemplate(name);
              if (t) {
                setText(t.body);
                setSubject(t.subject);
              }
            }}
            subject={{ value: subject, onChange: setSubject, placeholder: "Asunto del email…" }}
            bodyLabel="Cuerpo"
            bodyMinHeight={172}
            text={text}
            onTextChange={setText}
            charLabel={`${text.length} caracteres · ${n} ${n === 1 ? "email" : "emails"}`}
            footnote="Las variables también funcionan en el asunto."
            previewWidth={372}
            previewCaption={`Variables resueltas con datos de ${previewName}. Cada cliente recibe su versión.`}
            preview={
              <>
                <span style={{ fontSize: 12.5, color: "var(--msg-mut)", textAlign: "center", fontWeight: 600 }}>Así llega a su bandeja</span>
                <div style={{ border: "1px solid var(--msg-bd-2)", borderRadius: 16, overflow: "hidden", background: "var(--msg-panel)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 13px", borderBottom: "1px solid var(--msg-bd)", background: "var(--msg-panel-2)" }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#ff5f57" }} />
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#febc2e" }} />
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#28c840" }} />
                    <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--msg-mut)", fontWeight: 600 }}>Recibidos</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: 13, borderBottom: "1px solid var(--msg-bd)" }}>
                    <span style={{ width: 30, height: 30, flex: "0 0 auto", borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--msg-brand)", color: "#04221a", fontSize: 11, fontWeight: 800 }}>{initials(senderName)}</span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: 13, fontWeight: 800 }}>{senderName}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{previewSubject}</span>
                      <span style={{ fontSize: 12, color: "var(--msg-mut)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{previewSnippet}</span>
                    </div>
                    <span style={{ fontSize: 11.5, color: "var(--msg-mut)", whiteSpace: "nowrap" }}>{isNow ? "ahora" : time}</span>
                  </div>
                  <div style={{ padding: "15px 16px 18px", display: "flex", flexDirection: "column", gap: 11 }}>
                    <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-.02em", lineHeight: 1.35 }}>{previewSubject}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "var(--msg-mut)" }}>
                      <span style={{ fontWeight: 700, color: "var(--msg-tx-2)" }}>{senderEmail || "tu Gmail"}</span>
                      <span>para {previewEmail}</span>
                    </div>
                    <span style={{ whiteSpace: "pre-wrap", overflowWrap: "break-word", fontSize: 13.5, lineHeight: "21px", color: "var(--msg-tx-2)" }}>{previewText}</span>
                    <div style={{ borderTop: "1px solid var(--msg-bd)", paddingTop: 10, display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: "var(--msg-mut)" }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--msg-brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="8" height="8" rx="2.5" />
                        <rect x="13" y="13" width="8" height="8" rx="2.5" />
                        <path d="M11 7h4a2 2 0 0 1 2 2v4" />
                      </svg>
                      Enviado con Enlaze
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
            label={
              sending
                ? "Enviando…"
                : gmailState === "expired"
                  ? "Reconecta Gmail"
                  : !connected
                    ? "Conecta Gmail"
                    : isNow
                      ? "Enviar ahora"
                      : "Programar envío"
            }
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
          emptyBody="Responde a las tres preguntas — a quién, qué y cuándo — y tu primer email quedará en cola."
          historyTitle="Historial de emails"
          historyEmpty="Todavía no has enviado ningún email desde aquí."
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
