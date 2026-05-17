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

interface AgentDataValue {
  loading: boolean;
  hasSession: boolean;
  summary: DailySummary | null;
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

export function AgentBriefingHero() {
  const { loading, summary } = useAgentData();

  if (loading) return <BriefingSkeleton />;

  if (!summary) return <BriefingFallback />;

  const ai = summary.raw_payload?.daily_summary?.ai_briefing;
  const aiOk = !!ai && !ai.error;
  const impactDot = (impact?: string) =>
    impact === "alto"
      ? "bg-red-500"
      : impact === "medio"
      ? "bg-yellow-500"
      : "bg-brand-green";

  return (
    <section className="relative overflow-hidden rounded-2xl border border-brand-green/20 bg-gradient-to-br from-white to-brand-green/5 shadow-sm dark:border-brand-green/20 dark:from-zinc-900 dark:to-brand-green/5">
      <div className="p-6">
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-500 dark:text-zinc-500 mb-1">
              Resumen del día · {fmtDate(summary.execution_date)}
              {aiOk && (
                <span className="ml-2 text-brand-green normal-case tracking-normal">
                  · generado por IA
                </span>
              )}
            </p>
            <h2 className="text-[18px] font-semibold text-navy-900 dark:text-white">
              {aiOk && ai!.headline ? ai!.headline : summary.headline}
            </h2>
          </div>
          <div className="flex items-center gap-1 bg-navy-50 dark:bg-zinc-800/60 rounded-full px-3 py-1 shrink-0">
            <span className="text-xs text-navy-500 dark:text-zinc-400">Score</span>
            <span className="text-sm font-bold text-navy-900 dark:text-white">
              {summary.score}
            </span>
            <span className="text-xs text-navy-400 dark:text-zinc-500">/100</span>
          </div>
        </div>

        {aiOk && ai!.narrative && (
          <p className="text-sm text-navy-700 dark:text-zinc-300 whitespace-pre-line mb-4">
            {ai!.narrative}
          </p>
        )}

        {aiOk && ai!.top_actions && ai!.top_actions.length > 0 ? (
          <div className="space-y-2">
            {ai!.top_actions.map((a, i) => (
              <div key={i} className="flex items-start gap-2">
                <span
                  className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${impactDot(a.impact)}`}
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-navy-900 dark:text-white">
                    {a.action}
                  </div>
                  <div className="text-xs text-navy-500 dark:text-zinc-500">
                    {a.why}
                    {a.when && <span className="ml-1">· {a.when}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          summary.priority_actions.length > 0 && (
            <div className="space-y-1.5">
              {summary.priority_actions.map((action, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="mt-0.5 h-2 w-2 rounded-full bg-brand-green shrink-0" />
                  <span className="text-sm text-navy-700 dark:text-zinc-300">
                    {action}
                  </span>
                </div>
              ))}
            </div>
          )
        )}

        {aiOk &&
          (((ai!.opportunities?.length ?? 0) > 0) ||
            ((ai!.watch_outs?.length ?? 0) > 0)) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 pt-3 border-t border-brand-green/10 dark:border-zinc-700/50">
              {(ai!.opportunities?.length ?? 0) > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-navy-500 dark:text-zinc-500 mb-1">
                    Oportunidades
                  </div>
                  <ul className="space-y-1">
                    {ai!.opportunities!.map((o, i) => (
                      <li
                        key={i}
                        className="text-xs text-navy-700 dark:text-zinc-300"
                      >
                        • {o}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(ai!.watch_outs?.length ?? 0) > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-navy-500 dark:text-zinc-500 mb-1">
                    A vigilar
                  </div>
                  <ul className="space-y-1">
                    {ai!.watch_outs!.map((w, i) => (
                      <li
                        key={i}
                        className="text-xs text-navy-700 dark:text-zinc-300"
                      >
                        • {w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

        <div className="flex flex-wrap gap-4 mt-4 pt-3 border-t border-brand-green/10 dark:border-zinc-700/50">
          <span className="text-xs text-navy-500 dark:text-zinc-500">
            {summary.opportunities_count} oportunidades
          </span>
          <span className="text-xs text-navy-500 dark:text-zinc-500">
            {summary.risks_count} riesgos
          </span>
          {aiOk && ai!.mood && (
            <span className="text-xs text-navy-400 dark:text-zinc-500 ml-auto">
              tono: {ai!.mood}
            </span>
          )}
        </div>
      </div>
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
    <div className="rounded-2xl border border-brand-green/20 bg-brand-green/5 p-6 shadow-sm dark:border-brand-green/10 dark:bg-brand-green/5 flex flex-col sm:flex-row items-center justify-between gap-4">
      <div>
        <h2 className="text-[16px] font-semibold text-navy-900 dark:text-white flex items-center gap-2 mb-1">
          <span className="text-xl">✨</span> Aún no tienes el agente conectado
        </h2>
        <p className="text-[13.5px] text-navy-600 dark:text-zinc-400">
          Cuando lo conectes verás aquí cada mañana el resumen, las
          oportunidades y las acciones que te tocan hoy.
        </p>
      </div>
      <Link
        href="/dashboard/settings/integrations"
        className="shrink-0 px-4 py-2 rounded-lg bg-brand-green text-white hover:bg-brand-green/90 text-sm font-medium transition-colors"
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
