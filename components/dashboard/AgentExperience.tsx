"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Badge from "@/components/ui/badge";
import EmptyState from "@/components/ui/empty-state";
import DailyBriefingCard, {
  type BriefingAction,
  type BriefingPriority,
} from "@/components/dashboard/DailyBriefingCard";

/* ─── Types ─────────────────────────────────────────────────────────── */

interface AIAction {
  action: string;
  why: string;
  when?: string;
  impact?: "alto" | "medio" | "bajo" | string;
}

interface AIBriefing {
  headline?: string;
  narrative?: string;
  top_actions?: AIAction[];
  watch_outs?: string[];
  opportunities?: string[];
  mood?: string;
  model?: string;
  generated_at?: string;
  error?: string;
}

interface DailySummary {
  id: string;
  headline: string;
  priority_actions: string[];
  opportunities_count: number;
  risks_count: number;
  score: number;
  execution_date: string;
  raw_payload?: {
    daily_summary?: {
      ai_briefing?: AIBriefing;
    };
  };
}

interface AgentNews {
  id: string;
  title: string;
  summary: string | null;
  source: string | null;
  url: string | null;
  category: string | null;
  relevance: number;
  read: boolean;
  created_at: string;
}

interface AgentSignal {
  id: string;
  signal_type: string;
  source_entity: string | null;
  title: string;
  detail: string | null;
  severity: string;
  opportunity: string | null;
  action_suggested: string | null;
  acknowledged: boolean;
  created_at: string;
}

interface AgentReview {
  id: string;
  author: string | null;
  rating: number;
  text_content: string | null;
  sentiment: string;
  suggested_response: string | null;
  urgent: boolean;
  responded: boolean;
  created_at: string;
}

interface AgentCampaign {
  id: string;
  title: string;
  type: string | null;
  channel: string[];
  suggested_date: string | null;
  message_draft: string | null;
  reason: string | null;
  status: string;
}

interface AgentLead {
  id: string;
  name: string;
  business_type: string | null;
  zone: string | null;
  score: number;
  priority: string;
  issues: string[];
  recommendation: string | null;
  status: string;
}

interface AgentTask {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  due_date: string | null;
  status: string;
  type: string;
}

type TabKey =
  | "noticias"
  | "senales"
  | "resenas"
  | "marketing"
  | "leads"
  | "tareas";

/**
 * Live connection state pulled from `agent_connections`. We carry this in
 * context so the briefing hero can override stale claims like "tienes 4
 * módulos sin conectar" when the user has actually connected them since the
 * last agent run. The briefing is generated once per day; this lets the UI
 * tell the truth without waiting for the next run.
 */
interface LiveConnections {
  gmail: boolean;
  calendar: boolean;
  sheets: boolean;
  reputation: boolean;
}

interface AgentDataValue {
  loading: boolean;
  hasSession: boolean;
  summary: DailySummary | null;
  connections: LiveConnections;
  news: AgentNews[];
  signals: AgentSignal[];
  reviews: AgentReview[];
  campaigns: AgentCampaign[];
  leads: AgentLead[];
  tasks: AgentTask[];
  markNewsRead: (id: string) => Promise<void>;
  acknowledgeSignal: (id: string) => Promise<void>;
  completeTask: (id: string) => Promise<void>;
  updateLeadStatus: (id: string, status: string) => Promise<void>;
}

const NO_CONNECTIONS: LiveConnections = { gmail: false, calendar: false, sheets: false, reputation: false };

/* ─── Helpers ───────────────────────────────────────────────────────── */

const signalTypeLabels: Record<string, { label: string; icon: string }> = {
  regulation: { label: "Normativa", icon: "📜" },
  subsidy: { label: "Ayuda", icon: "💰" },
  competitor: { label: "Competencia", icon: "🏪" },
  rating_change: { label: "Rating", icon: "⭐" },
  local_event: { label: "Evento", icon: "📅" },
  stock_alert: { label: "Stock", icon: "📦" },
  margin_alert: { label: "Margen", icon: "📊" },
  supplier_alert: { label: "Proveedor", icon: "🔧" },
};

const priorityColors: Record<string, "red" | "yellow" | "blue" | "gray"> = {
  hot: "red",
  warm: "yellow",
  cold: "blue",
  urgent: "red",
  high: "red",
  medium: "yellow",
  low: "blue",
};

const fmtDate = (d: string | null) =>
  d
    ? new Date(d).toLocaleDateString("es-ES", { day: "numeric", month: "short" })
    : "—";

/* ─── Context / provider ────────────────────────────────────────────── */

const AgentDataContext = createContext<AgentDataValue | null>(null);

function useAgentData(): AgentDataValue {
  const ctx = useContext(AgentDataContext);
  if (!ctx) {
    throw new Error("AgentExperience components must be wrapped in <AgentDataProvider>");
  }
  return ctx;
}

export function AgentDataProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [connections, setConnections] = useState<LiveConnections>(NO_CONNECTIONS);
  const [news, setNews] = useState<AgentNews[]>([]);
  const [signals, setSignals] = useState<AgentSignal[]>([]);
  const [reviews, setReviews] = useState<AgentReview[]>([]);
  const [campaigns, setCampaigns] = useState<AgentCampaign[]>([]);
  const [leads, setLeads] = useState<AgentLead[]>([]);
  const [tasks, setTasks] = useState<AgentTask[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        setHasSession(false);
        setLoading(false);
        return;
      }
      setHasSession(true);

      // All queries explicitly filter by user_id to be safe regardless of RLS
      // posture on the agent_* tables (see commit notes).
      const [
        summaryRes,
        connectionsRes,
        newsRes,
        signalsRes,
        reviewsRes,
        campaignsRes,
        leadsRes,
        tasksRes,
      ] = await Promise.all([
        supabase
          .from("agent_daily_summary")
          .select("*")
          .eq("user_id", user.id)
          .order("execution_date", { ascending: false })
          .limit(1),
        supabase
          .from("agent_connections")
          .select("module, connected")
          .eq("user_id", user.id),
        supabase
          .from("agent_news")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("agent_signals")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("agent_reviews")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(10),
        supabase
          .from("agent_campaigns")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(10),
        supabase
          .from("agent_leads")
          .select("*")
          .eq("user_id", user.id)
          .order("score", { ascending: false })
          .limit(20),
        supabase
          .from("agent_tasks")
          .select("*")
          .eq("user_id", user.id)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(15),
      ]);

      if (cancelled) return;

      setSummary((summaryRes.data?.[0] as DailySummary) || null);

      const connMap: Record<string, boolean> = {};
      for (const c of (connectionsRes.data || []) as { module: string; connected: boolean | null }[]) {
        connMap[c.module] = c.connected === true;
      }
      setConnections({
        gmail: connMap["gmail"] === true,
        calendar: connMap["google_calendar"] === true,
        sheets: connMap["google_sheets"] === true,
        // "google_business" is the OAuth module key; some flows treat the
        // mere presence of google_place_id as reputation being "set up".
        reputation: connMap["google_business"] === true,
      });

      setNews((newsRes.data || []) as AgentNews[]);
      setSignals((signalsRes.data || []) as AgentSignal[]);
      setReviews((reviewsRes.data || []) as AgentReview[]);
      setCampaigns((campaignsRes.data || []) as AgentCampaign[]);
      setLeads((leadsRes.data || []) as AgentLead[]);
      setTasks((tasksRes.data || []) as AgentTask[]);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const markNewsRead = useCallback(
    async (id: string) => {
      await supabase.from("agent_news").update({ read: true }).eq("id", id);
      setNews((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    },
    [supabase],
  );

  const acknowledgeSignal = useCallback(
    async (id: string) => {
      await supabase
        .from("agent_signals")
        .update({ acknowledged: true })
        .eq("id", id);
      setSignals((prev) =>
        prev.map((s) => (s.id === id ? { ...s, acknowledged: true } : s)),
      );
    },
    [supabase],
  );

  const completeTask = useCallback(
    async (id: string) => {
      await supabase
        .from("agent_tasks")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
    },
    [supabase],
  );

  const updateLeadStatus = useCallback(
    async (id: string, status: string) => {
      await supabase
        .from("agent_leads")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", id);
      setLeads((prev) =>
        prev.map((l) => (l.id === id ? { ...l, status } : l)),
      );
    },
    [supabase],
  );

  const value = useMemo<AgentDataValue>(
    () => ({
      loading,
      hasSession,
      summary,
      connections,
      news,
      signals,
      reviews,
      campaigns,
      leads,
      tasks,
      markNewsRead,
      acknowledgeSignal,
      completeTask,
      updateLeadStatus,
    }),
    [
      loading,
      hasSession,
      summary,
      connections,
      news,
      signals,
      reviews,
      campaigns,
      leads,
      tasks,
      markNewsRead,
      acknowledgeSignal,
      completeTask,
      updateLeadStatus,
    ],
  );

  return (
    <AgentDataContext.Provider value={value}>
      {children}
    </AgentDataContext.Provider>
  );
}

/* ─── Hero briefing ─────────────────────────────────────────────────── */

/**
 * Words/phrases the briefing should never show to a 50-year-old autónomo.
 * The agent's narrative is generated once a day and we can't re-run it on the
 * fly, so we strip these client-side until the next run uses the new prompt.
 *
 * Phrase replacements run first (longer first to avoid leaving stray "score"
 * after "health score" was meant to go), then sentence-level removal kicks in
 * for paragraphs that still carry residue.
 */
const PHRASE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bbusiness[- ]?health[- ]?score\b/gi, "estado"],
  [/\bhealth[- ]?score\b/gi, "estado"],
  [/\bscore\b/gi, ""],
  [/\bKPI(s)?\b/gi, "indicadores"],
  [/\bpipeline\b/gi, "flujo"],
  [/\bchurn\b/gi, "bajas"],
  [/\bleads?\b/gi, "clientes potenciales"],
  [/\bdashboard\b/gi, "panel"],
  [/\bbenchmark\b/gi, "referencia"],
  [/\bbriefing\b/gi, "resumen"],
];

function sanitizeProse(text: string): string {
  let out = text;
  for (const [rx, sub] of PHRASE_REPLACEMENTS) out = out.replace(rx, sub);
  // tidy double spaces / orphan punctuation from blanked-out words
  out = out.replace(/\s+([,.;:!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
  // Drop dangling number+slash leftovers like "de 62, que está en zona" → keep,
  // but remove obviously broken bits like " de 62 /100" produced by stripping.
  out = out.replace(/de\s+\d+\s*\/\s*100/gi, "");
  return out;
}

/**
 * Per-module name variants Claude tends to use.
 * `correos`/`emails`/`bandeja` are intentionally tied to Gmail because the
 * agent often refers to Gmail by its content, not by the brand.
 */
const MODULE_TERMS: Record<keyof LiveConnections, RegExp> = {
  gmail: /\b(gmail|correos?|emails?|bandeja\s+de\s+entrada)\b/i,
  calendar: /\b(calendar(?:io)?|agenda|google\s+calendar)\b/i,
  sheets: /\b(sheets|hojas?\s+de\s+c[aá]lculo|google\s+sheets|hoja\s+de\s+ventas)\b/i,
  reputation: /\b(reputaci[oó]n|rese[ñn]as|google\s+business|google\s+my\s+business|ficha\s+de\s+google)\b/i,
};

/**
 * Patterns that, *together with a module name*, mean the sentence is talking
 * about the module not being set up — even when the literal substring
 * "no conectado" never appears. We discovered the hard way that Claude writes
 * "No tienes Gmail conectado" (no = first word, conectado = last word), so a
 * naive `/no conectad/` misses it. These patterns target the *grammar of
 * absence* instead of exact strings.
 */
const ABSENCE_PATTERNS: RegExp[] = [
  // "No <stuff> conectad…" — covers "No tienes Gmail conectado", "no está conectado", etc.
  /\bno\b[^.!?]{0,60}\bconectad/i,
  // "Sin <stuff> conectad…" — covers "Sin el módulo de reputación conectado", "Sin Sheets conectado".
  /\bsin\b[^.!?]{0,60}\bconectad/i,
  // "<module> sin conectar"
  /\bsin\s+conectar\b/i,
  // Imperative "conecta tu X" / "conéctalo" / "vincula tu X" / "activa tu X".
  /\bconecta(?:r|los?|las?)?\b/i,
  /\bcon[eé]ctal(?:o|a|os|as)\b/i,
  /\bvincular?\b/i,
  /\bactivar?\b/i,
  // "Falta(n) conectar/vincular/activar"
  /\bfalta(?:n)?\s+(?:por\s+)?(?:conectar|vincular|activar)\b/i,
  // "X pendiente(s) de conectar"
  /\bpendientes?\s+de\s+(?:conectar|vincular|activar)\b/i,
  // "X deshabilitad…" / "desconectad…" / "inhabilitad…"
  /\bdes(?:conectad|habilitad)[oa]s?\b/i,
  /\binhabilitad[oa]s?\b/i,
];

/**
 * Generic "X módulos sin conectar" / "módulos pendientes" / "tienes 4 módulos
 * desconectados". These claims are always wrong as soon as ANY module is live,
 * regardless of which specific module Claude was thinking about.
 */
const GENERIC_MODULES_DISCONNECTED_RX = /m[oó]dulos?\s+(?:sin\s+(?:conectar|activar|vincular)|pendientes?(?:\s+de\s+(?:conectar|activar|vincular))?|no\s+conectados?|desconectad[oa]s?)|\d+\s+m[oó]dulos?\s+(?:sin|pendientes?|de(?:s)?conectad)/i;

function shouldHideForConnections(text: string, conn: LiveConnections): boolean {
  if (!text) return false;
  const someLive = conn.gmail || conn.calendar || conn.sheets || conn.reputation;
  // Generic "tienes 4 módulos sin conectar" / "módulos pendientes" — wrong by
  // definition as soon as ANY module is connected.
  if (someLive && GENERIC_MODULES_DISCONNECTED_RX.test(text)) return true;
  // Per-module: drop only if the sentence names a module the user has AND any
  // absence pattern hits. Tested against the literal phrasings Claude produced
  // ("No tienes Gmail conectado", "Sin el módulo de reputación conectado",
  // "Conecta tu Gmail o Reputación", "Vincula tus Sheets", …).
  const keys = Object.keys(MODULE_TERMS) as (keyof LiveConnections)[];
  for (const key of keys) {
    if (!conn[key]) continue;
    if (!MODULE_TERMS[key].test(text)) continue;
    if (ABSENCE_PATTERNS.some((p) => p.test(text))) return true;
  }
  return false;
}

function filterStaleConnectionParagraphs(narrative: string, conn: LiveConnections): string {
  return narrative
    .split(/\n+/)
    .map((paragraph) =>
      paragraph
        .split(/(?<=[.!?])\s+/)
        .filter((s) => !shouldHideForConnections(s, conn))
        .join(" "),
    )
    .filter((p) => p.trim().length > 0)
    .join("\n\n");
}

/** Real briefing impact levels → the card's badge priority. */
const IMPACT_TO_PRIORITY: Record<string, BriefingPriority | undefined> = {
  alto: "alta",
  medio: "media",
  bajo: "baja",
};

export function AgentBriefingHero() {
  const { loading, summary, connections } = useAgentData();

  if (loading) return <BriefingSkeleton />;

  if (!summary) return <BriefingFallback />;

  const ai = summary.raw_payload?.daily_summary?.ai_briefing;
  const aiOk = !!ai && !ai.error;

  const allConnectedLive =
    connections.gmail && connections.calendar && connections.sheets && connections.reputation;

  // Strip leftover anglicisms / score talk from stale Claude output, plus
  // sentences that lie about the user's connection state.
  const rawNarrative = aiOk ? ai!.narrative ?? "" : "";
  const displayNarrative = filterStaleConnectionParagraphs(
    sanitizeProse(rawNarrative),
    connections,
  );

  const displayHeadline = sanitizeProse(
    (aiOk && ai!.headline ? ai!.headline : summary.headline) || "",
  );

  // Drop actions / watch_outs / opportunities that talk about connecting a
  // module the user already has live. The check runs per-item even when only
  // ONE module is live — we don't need every module connected to know the
  // statement "Gmail no conectado" is false when gmail.connected === true.
  const filteredActions = (aiOk ? ai!.top_actions || [] : []).filter((a) => {
    const blob = `${a.action || ""} ${a.why || ""}`;
    return !shouldHideForConnections(blob, connections);
  });

  const filteredWatchOuts = (aiOk ? ai!.watch_outs || [] : [])
    .filter((w) => !shouldHideForConnections(w, connections))
    .map(sanitizeProse);
  const filteredOpportunities = (aiOk ? ai!.opportunities || [] : [])
    .filter((o) => !shouldHideForConnections(o, connections))
    .map(sanitizeProse);

  // Map the app's data shape onto the redesigned card's action shape.
  //   action -> título, why -> subtexto, when -> pill, impact -> badge
  // On the mechanical fallback (aiOk === false) we feed priority_actions as
  // bare titles — no reason/moment/priority — so the card degrades gracefully.
  const cardActions: BriefingAction[] = aiOk
    ? filteredActions.map((a) => ({
        title: sanitizeProse(a.action),
        reason: a.why ? sanitizeProse(a.why) : undefined,
        moment: a.when || undefined,
        priority: IMPACT_TO_PRIORITY[a.impact ?? ""],
      }))
    : summary.priority_actions.map((action) => ({
        title: sanitizeProse(action),
      }));

  return (
    <section>
      {allConnectedLive && (
        <div className="mb-3 rounded-lg border border-brand-green/30 bg-brand-green/10 px-3 py-2 text-[12.5px] text-brand-green dark:border-brand-green/30 dark:bg-brand-green/15 dark:text-brand-green-light">
          ✓ Tienes Gmail, Calendar, Sheets y reputación conectados. Si el
          resumen menciona conectar integraciones es de ayer — se actualizará
          mañana.
        </div>
      )}

      <DailyBriefingCard
        summaryId={summary.id}
        date={fmtDate(summary.execution_date)}
        headline={displayHeadline}
        narrative={displayNarrative}
        actions={cardActions}
        opportunities={filteredOpportunities}
        watch_outs={filteredWatchOuts}
        aiWritten={aiOk}
      />
    </section>
  );
}

function BriefingSkeleton() {
  return (
    <div className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 animate-pulse">
      <div className="flex items-center gap-2 mb-4">
        <div className="h-4 w-40 rounded bg-navy-100 dark:bg-zinc-800" />
      </div>
      <div className="space-y-2 mb-4">
        <div className="h-5 w-2/3 rounded bg-navy-100 dark:bg-zinc-800" />
        <div className="h-4 w-full rounded bg-navy-50 dark:bg-zinc-800" />
        <div className="h-4 w-3/4 rounded bg-navy-50 dark:bg-zinc-800" />
      </div>
      <div className="flex gap-3">
        <div className="h-3 w-24 rounded bg-navy-50 dark:bg-zinc-800" />
        <div className="h-3 w-24 rounded bg-navy-50 dark:bg-zinc-800" />
      </div>
    </div>
  );
}

function BriefingFallback() {
  return (
    <div className="flex flex-col items-start gap-4 rounded-2xl border border-[#c8f0e2] bg-[#e9faf4] px-6 py-[22px] sm:flex-row sm:items-center sm:gap-[18px] dark:border-brand-green/25 dark:bg-brand-green/[0.06]">
      {/* Icon chip — lucide triangle-alert */}
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#c8f0e2] bg-white dark:border-brand-green/25 dark:bg-zinc-900">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00c896" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
      </div>

      <div className="flex flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-[17px] font-bold text-[#0f1e1a] dark:text-white">
            Aún no tienes el agente conectado
          </h2>
          <span className="rounded-full border border-[#c8f0e2] bg-white px-2.5 py-[3px] text-[11px] font-bold uppercase tracking-[0.06em] text-brand-green-dark dark:border-brand-green/25 dark:bg-zinc-900 dark:text-brand-green">
            Prioridad
          </span>
        </div>
        <p className="text-[14.5px] leading-relaxed text-[#4a5f58] dark:text-zinc-400">
          Cuando lo conectes verás aquí cada mañana el resumen, las
          oportunidades y las acciones que te tocan hoy.
        </p>
      </div>

      <Link
        href="/dashboard/settings/integrations"
        className="shrink-0 rounded-[10px] bg-brand-green px-5 py-3 text-[14.5px] font-semibold text-white transition-colors hover:bg-[#00b586] dark:text-zinc-950"
      >
        Conectar herramientas
      </Link>
    </div>
  );
}

/* ─── Tabs panel ────────────────────────────────────────────────────── */

export function AgentTabsPanel() {
  const {
    loading,
    hasSession,
    summary,
    news,
    signals,
    reviews,
    campaigns,
    leads,
    tasks,
    markNewsRead,
    acknowledgeSignal,
    completeTask,
    updateLeadStatus,
  } = useAgentData();
  const [activeTab, setActiveTab] = useState<TabKey>("noticias");

  if (loading || !hasSession) return null;

  const hasAny =
    summary ||
    news.length > 0 ||
    signals.length > 0 ||
    reviews.length > 0 ||
    campaigns.length > 0 ||
    leads.length > 0 ||
    tasks.length > 0;
  if (!hasAny) return null;

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: "noticias", label: "Noticias", count: news.filter((n) => !n.read).length },
    {
      key: "senales",
      label: "Señales",
      count: signals.filter((s) => !s.acknowledged).length,
    },
    {
      key: "resenas",
      label: "Reseñas",
      count: reviews.filter((r) => r.urgent && !r.responded).length,
    },
    {
      key: "marketing",
      label: "Marketing",
      count: campaigns.filter((c) => c.status === "idea").length,
    },
    { key: "leads", label: "Leads", count: leads.filter((l) => l.status === "new").length },
    { key: "tareas", label: "Tareas", count: tasks.length },
  ];

  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-3">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-navy-400 dark:text-zinc-500">
          Tu agente · esta semana
        </h2>
      </div>
      <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition ${
              activeTab === t.key
                ? "bg-navy-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "bg-navy-50 text-navy-600 hover:bg-navy-100 dark:bg-zinc-800/60 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-green text-[10px] font-bold text-white px-1">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === "noticias" && (
        <NewsTab items={news} onMarkRead={markNewsRead} />
      )}
      {activeTab === "senales" && (
        <SignalsTab items={signals} onAcknowledge={acknowledgeSignal} />
      )}
      {activeTab === "resenas" && <ReviewsTab items={reviews} />}
      {activeTab === "marketing" && <MarketingTab items={campaigns} />}
      {activeTab === "leads" && (
        <LeadsTab items={leads} onUpdateStatus={updateLeadStatus} />
      )}
      {activeTab === "tareas" && (
        <TasksTab items={tasks} onComplete={completeTask} />
      )}
    </section>
  );
}

/* ─── Tab sub-components ─────────────────────────────────────────────── */

function NewsTab({
  items,
  onMarkRead,
}: {
  items: AgentNews[];
  onMarkRead: (id: string) => void;
}) {
  if (items.length === 0)
    return (
      <EmptyState
        title="Sin noticias"
        description="El agente aún no ha recopilado noticias."
      />
    );
  return (
    <div className="space-y-3">
      {items.map((n) => (
        <Card key={n.id} className={n.read ? "opacity-60" : ""}>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                {n.category && <Badge variant="blue">{n.category}</Badge>}
                <span className="text-xs text-navy-400 dark:text-zinc-500">
                  {n.source} · {fmtDate(n.created_at)}
                </span>
              </div>
              <h4 className="text-sm font-medium text-navy-900 dark:text-white">
                {n.title}
              </h4>
              {n.summary && (
                <p className="text-xs text-navy-600 dark:text-zinc-400 mt-1 line-clamp-2">
                  {n.summary}
                </p>
              )}
            </div>
            <div className="flex gap-2 ml-3 shrink-0">
              {n.url && (
                <a
                  href={n.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-brand-green hover:underline"
                >
                  Ver
                </a>
              )}
              {!n.read && (
                <button
                  onClick={() => onMarkRead(n.id)}
                  className="text-xs text-navy-400 hover:text-navy-600 dark:text-zinc-500 dark:hover:text-zinc-300"
                >
                  Leído
                </button>
              )}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function SignalsTab({
  items,
  onAcknowledge,
}: {
  items: AgentSignal[];
  onAcknowledge: (id: string) => void;
}) {
  if (items.length === 0)
    return (
      <EmptyState
        title="Sin señales"
        description="El agente aún no ha detectado señales relevantes."
      />
    );
  return (
    <div className="space-y-3">
      {items.map((s) => {
        const st = signalTypeLabels[s.signal_type] || {
          label: s.signal_type,
          icon: "📡",
        };
        const badgeVariant =
          s.severity === "warning"
            ? "yellow"
            : s.severity === "error"
            ? "red"
            : "blue";
        return (
          <Card key={s.id} className={s.acknowledged ? "opacity-60" : ""}>
            <div className="flex items-start gap-3">
              <span className="text-xl">{st.icon}</span>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant={badgeVariant}>{st.label}</Badge>
                  <span className="text-xs text-navy-400 dark:text-zinc-500">
                    {fmtDate(s.created_at)}
                  </span>
                </div>
                <h4 className="text-sm font-medium text-navy-900 dark:text-white">
                  {s.title}
                </h4>
                {s.detail && (
                  <p className="text-xs text-navy-600 dark:text-zinc-400 mt-1">
                    {s.detail}
                  </p>
                )}
                {s.action_suggested && (
                  <p className="text-xs text-brand-green mt-1 font-medium">
                    Acción: {s.action_suggested}
                  </p>
                )}
                {s.opportunity && (
                  <p className="text-xs text-navy-500 dark:text-zinc-400 mt-1">
                    Oportunidad: {s.opportunity}
                  </p>
                )}
              </div>
              {!s.acknowledged && (
                <button
                  onClick={() => onAcknowledge(s.id)}
                  className="text-xs text-navy-400 hover:text-navy-600 dark:text-zinc-500 dark:hover:text-zinc-300 shrink-0"
                >
                  Entendido
                </button>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function ReviewsTab({ items }: { items: AgentReview[] }) {
  if (items.length === 0)
    return (
      <EmptyState
        title="Sin reseñas"
        description="El agente aún no ha recopilado reseñas."
      />
    );
  return (
    <div className="space-y-3">
      {items.map((r) => (
        <Card
          key={r.id}
          className={r.urgent ? "border-l-4 border-l-red-400" : ""}
        >
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-sm">{"⭐".repeat(r.rating)}</span>
              <span className="text-sm font-medium text-navy-900 dark:text-white">
                {r.author || "Anónimo"}
              </span>
              {r.urgent && <Badge variant="red">Urgente</Badge>}
            </div>
            <span className="text-xs text-navy-400 dark:text-zinc-500">
              {fmtDate(r.created_at)}
            </span>
          </div>
          {r.text_content && (
            <p className="text-sm text-navy-700 dark:text-zinc-300 mb-2">
              {r.text_content}
            </p>
          )}
          {r.suggested_response && (
            <div className="bg-green-50 border border-green-100 rounded-lg p-3 mt-2 dark:bg-emerald-900/10 dark:border-emerald-900/30">
              <p className="text-xs text-green-800 dark:text-emerald-300 font-medium mb-1">
                Respuesta sugerida:
              </p>
              <p className="text-xs text-green-700 dark:text-emerald-200">
                {r.suggested_response}
              </p>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function MarketingTab({ items }: { items: AgentCampaign[] }) {
  if (items.length === 0)
    return (
      <EmptyState
        title="Sin ideas de marketing"
        description="El agente generará ideas de campañas y contenido."
      />
    );
  return (
    <div className="space-y-3">
      {items.map((c) => (
        <Card key={c.id}>
          <div className="flex items-start justify-between mb-2">
            <h4 className="text-sm font-medium text-navy-900 dark:text-white">
              {c.title}
            </h4>
            <Badge
              variant={
                c.status === "idea"
                  ? "blue"
                  : c.status === "planned"
                  ? "yellow"
                  : "green"
              }
            >
              {c.status}
            </Badge>
          </div>
          {c.reason && (
            <p className="text-xs text-navy-500 dark:text-zinc-400 mb-2">
              {c.reason}
            </p>
          )}
          {c.channel.length > 0 && (
            <div className="flex gap-1 mb-2">
              {c.channel.map((ch) => (
                <span
                  key={ch}
                  className="text-xs bg-navy-50 dark:bg-zinc-800/60 rounded px-2 py-0.5 text-navy-600 dark:text-zinc-300"
                >
                  {ch}
                </span>
              ))}
            </div>
          )}
          {c.message_draft && (
            <div className="bg-navy-50/60 dark:bg-zinc-800/40 rounded-lg p-3">
              <p className="text-xs text-navy-400 dark:text-zinc-500 mb-1">
                Borrador:
              </p>
              <p className="text-sm text-navy-700 dark:text-zinc-300">
                {c.message_draft}
              </p>
            </div>
          )}
          {c.suggested_date && (
            <p className="text-xs text-navy-400 dark:text-zinc-500 mt-2">
              Fecha sugerida: {fmtDate(c.suggested_date)}
            </p>
          )}
        </Card>
      ))}
    </div>
  );
}

function LeadsTab({
  items,
  onUpdateStatus,
}: {
  items: AgentLead[];
  onUpdateStatus: (id: string, status: string) => void;
}) {
  if (items.length === 0)
    return (
      <EmptyState
        title="Sin leads"
        description="El agente detectará negocios que podrían ser tus clientes."
      />
    );
  return (
    <div className="space-y-3">
      {items.map((l) => (
        <Card key={l.id}>
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white ${
                  l.priority === "hot"
                    ? "bg-red-500"
                    : l.priority === "warm"
                    ? "bg-yellow-500"
                    : "bg-blue-400"
                }`}
              >
                {l.score}
              </span>
              <div>
                <h4 className="text-sm font-medium text-navy-900 dark:text-white">
                  {l.name}
                </h4>
                <p className="text-xs text-navy-500 dark:text-zinc-400">
                  {[l.business_type, l.zone].filter(Boolean).join(" · ")}
                </p>
              </div>
            </div>
            <Badge
              variant={
                l.status === "new"
                  ? "blue"
                  : l.status === "contacted"
                  ? "yellow"
                  : l.status === "converted"
                  ? "green"
                  : "gray"
              }
            >
              {l.status}
            </Badge>
          </div>
          {l.issues.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {l.issues.map((issue) => (
                <span
                  key={issue}
                  className="text-xs bg-red-50 text-red-600 rounded px-2 py-0.5 dark:bg-red-900/20 dark:text-red-300"
                >
                  {issue.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          )}
          {l.recommendation && (
            <p className="text-xs text-navy-600 dark:text-zinc-400 mb-2">
              {l.recommendation}
            </p>
          )}
          {l.status === "new" && (
            <div className="flex gap-2 pt-2 border-t border-navy-50 dark:border-zinc-800">
              <Button size="sm" onClick={() => onUpdateStatus(l.id, "contacted")}>
                Contactado
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onUpdateStatus(l.id, "dismissed")}
              >
                Descartar
              </Button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function TasksTab({
  items,
  onComplete,
}: {
  items: AgentTask[];
  onComplete: (id: string) => void;
}) {
  if (items.length === 0)
    return (
      <EmptyState
        title="Sin tareas pendientes"
        description="El agente creará tareas de seguimiento cuando detecte acciones necesarias."
      />
    );
  return (
    <div className="space-y-3">
      {items.map((t) => (
        <Card key={t.id}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onComplete(t.id)}
              aria-label="Marcar como completada"
              className="h-5 w-5 rounded-full border-2 border-navy-300 hover:border-brand-green hover:bg-brand-green/10 transition shrink-0"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-medium text-navy-900 dark:text-white">
                  {t.title}
                </h4>
                <Badge variant={priorityColors[t.priority] || "gray"}>
                  {t.priority}
                </Badge>
              </div>
              {t.description && (
                <p className="text-xs text-navy-500 dark:text-zinc-400 mt-0.5">
                  {t.description}
                </p>
              )}
            </div>
            {t.due_date && (
              <span className="text-xs text-navy-400 dark:text-zinc-500 shrink-0">
                {fmtDate(t.due_date)}
              </span>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
