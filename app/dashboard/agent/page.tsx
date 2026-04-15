"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import Link from "next/link";
import PageHeader from "@/components/ui/page-header";
import { Card, StatCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Badge from "@/components/ui/badge";
import Loading from "@/components/ui/loading";
import EmptyState from "@/components/ui/empty-state";

/* ─── Types ─── */

interface DailySummary {
  id: string;
  headline: string;
  priority_actions: string[];
  opportunities_count: number;
  risks_count: number;
  score: number;
  execution_date: string;
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

/* ─── Helpers ─── */

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

const priorityColors: Record<string, string> = {
  hot: "red",
  warm: "yellow",
  cold: "blue",
  urgent: "red",
  high: "red",
  medium: "yellow",
  low: "blue",
};

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("es-ES", { day: "numeric", month: "short" }) : "—";

/* ─── Page ─── */

export default function AgentDashboardPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [news, setNews] = useState<AgentNews[]>([]);
  const [signals, setSignals] = useState<AgentSignal[]>([]);
  const [reviews, setReviews] = useState<AgentReview[]>([]);
  const [campaigns, setCampaigns] = useState<AgentCampaign[]>([]);
  const [leads, setLeads] = useState<AgentLead[]>([]);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [activeTab, setActiveTab] = useState<"resumen" | "noticias" | "senales" | "resenas" | "marketing" | "leads" | "tareas">("resumen");

  useEffect(() => {
    async function load() {
      const [summaryRes, newsRes, signalsRes, reviewsRes, campaignsRes, leadsRes, tasksRes] = await Promise.all([
        supabase.from("agent_daily_summary").select("*").order("execution_date", { ascending: false }).limit(1),
        supabase.from("agent_news").select("*").order("created_at", { ascending: false }).limit(20),
        supabase.from("agent_signals").select("*").order("created_at", { ascending: false }).limit(20),
        supabase.from("agent_reviews").select("*").order("created_at", { ascending: false }).limit(10),
        supabase.from("agent_campaigns").select("*").order("created_at", { ascending: false }).limit(10),
        supabase.from("agent_leads").select("*").order("score", { ascending: false }).limit(20),
        supabase.from("agent_tasks").select("*").eq("status", "pending").order("created_at", { ascending: false }).limit(15),
      ]);

      setSummary(summaryRes.data?.[0] as DailySummary || null); // eslint-disable-line react-hooks/set-state-in-effect
      setNews((newsRes.data || []) as AgentNews[]); // eslint-disable-line react-hooks/set-state-in-effect
      setSignals((signalsRes.data || []) as AgentSignal[]); // eslint-disable-line react-hooks/set-state-in-effect
      setReviews((reviewsRes.data || []) as AgentReview[]); // eslint-disable-line react-hooks/set-state-in-effect
      setCampaigns((campaignsRes.data || []) as AgentCampaign[]); // eslint-disable-line react-hooks/set-state-in-effect
      setLeads((leadsRes.data || []) as AgentLead[]); // eslint-disable-line react-hooks/set-state-in-effect
      setTasks((tasksRes.data || []) as AgentTask[]); // eslint-disable-line react-hooks/set-state-in-effect
      setLoading(false); // eslint-disable-line react-hooks/set-state-in-effect
    }
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function markNewsRead(id: string) {
    await supabase.from("agent_news").update({ read: true }).eq("id", id);
    setNews(news.map(n => n.id === id ? { ...n, read: true } : n));
  }

  async function acknowledgeSignal(id: string) {
    await supabase.from("agent_signals").update({ acknowledged: true }).eq("id", id);
    setSignals(signals.map(s => s.id === id ? { ...s, acknowledged: true } : s));
  }

  async function completeTask(id: string) {
    await supabase.from("agent_tasks").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", id);
    setTasks(tasks.filter(t => t.id !== id));
  }

  async function updateLeadStatus(id: string, status: string) {
    await supabase.from("agent_leads").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
    setLeads(leads.map(l => l.id === id ? { ...l, status } : l));
  }

  if (loading) return <Loading />;

  const tabs = [
    { key: "resumen", label: "Resumen", count: 0 },
    { key: "noticias", label: "Noticias", count: news.filter(n => !n.read).length },
    { key: "senales", label: "Señales", count: signals.filter(s => !s.acknowledged).length },
    { key: "resenas", label: "Reseñas", count: reviews.filter(r => r.urgent && !r.responded).length },
    { key: "marketing", label: "Marketing", count: campaigns.filter(c => c.status === "idea").length },
    { key: "leads", label: "Leads", count: leads.filter(l => l.status === "new").length },
    { key: "tareas", label: "Tareas", count: tasks.length },
  ] as const;

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Asistente inteligente"
        description="Tu radar diario: entorno, oportunidades, reputación y acciones"
      />

      {/* Daily summary */}
      {summary && (
        <Card className="mb-6 border-l-4 border-l-brand-green">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-xs text-navy-500 uppercase tracking-wider mb-1">Resumen del día · {fmtDate(summary.execution_date)}</p>
              <p className="text-navy-900 font-medium">{summary.headline}</p>
            </div>
            <div className="flex items-center gap-1 bg-navy-50 rounded-full px-3 py-1">
              <span className="text-xs text-navy-500">Score</span>
              <span className="text-sm font-bold text-navy-900">{summary.score}</span>
              <span className="text-xs text-navy-400">/100</span>
            </div>
          </div>
          {summary.priority_actions.length > 0 && (
            <div className="space-y-1.5">
              {summary.priority_actions.map((action, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="mt-0.5 h-2 w-2 rounded-full bg-brand-green shrink-0" />
                  <span className="text-sm text-navy-700">{action}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-4 mt-3 pt-3 border-t border-navy-100">
            <span className="text-xs text-navy-500">{summary.opportunities_count} oportunidades</span>
            <span className="text-xs text-navy-500">{summary.risks_count} riesgos</span>
          </div>
        </Card>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Noticias nuevas" value={news.filter(n => !n.read).length} accent="blue" />
        <StatCard label="Señales activas" value={signals.filter(s => !s.acknowledged).length} accent="yellow" />
        <StatCard label="Reseñas urgentes" value={reviews.filter(r => r.urgent && !r.responded).length} accent={reviews.some(r => r.urgent && !r.responded) ? "red" : "green"} />
        <StatCard label="Leads calientes" value={leads.filter(l => l.priority === "hot").length} accent="green" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 overflow-x-auto pb-1">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition ${
              activeTab === t.key
                ? "bg-navy-900 text-white"
                : "bg-navy-50 text-navy-600 hover:bg-navy-100"
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

      {/* Tab content */}
      {activeTab === "resumen" && <SummaryTab news={news} signals={signals} reviews={reviews} leads={leads} tasks={tasks} campaigns={campaigns} />}
      {activeTab === "noticias" && <NewsTab items={news} onMarkRead={markNewsRead} />}
      {activeTab === "senales" && <SignalsTab items={signals} onAcknowledge={acknowledgeSignal} />}
      {activeTab === "resenas" && <ReviewsTab items={reviews} />}
      {activeTab === "marketing" && <MarketingTab items={campaigns} />}
      {activeTab === "leads" && <LeadsTab items={leads} onUpdateStatus={updateLeadStatus} />}
      {activeTab === "tareas" && <TasksTab items={tasks} onComplete={completeTask} />}
    </div>
  );
}

/* ─── Tab Components ─── */

function SummaryTab({ news, signals, reviews, leads, tasks, campaigns }: {
  news: AgentNews[]; signals: AgentSignal[]; reviews: AgentReview[];
  leads: AgentLead[]; tasks: AgentTask[]; campaigns: AgentCampaign[];
}) {
  const hasData = news.length + signals.length + reviews.length + leads.length > 0;

  if (!hasData) {
    return (
      <EmptyState
        title="Tu asistente está listo"
        description="Cuando el agente se ejecute, aquí verás noticias, señales, reseñas, leads y oportunidades de marketing adaptadas a tu negocio."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Recent news */}
      <Card>
        <h3 className="text-sm font-semibold text-brand-green uppercase tracking-wider mb-3">Últimas noticias</h3>
        {news.slice(0, 5).map(n => (
          <div key={n.id} className={`py-2 border-b border-navy-50 last:border-0 ${n.read ? "opacity-60" : ""}`}>
            <p className="text-sm text-navy-900 font-medium">{n.title}</p>
            <p className="text-xs text-navy-500 mt-0.5">{n.source} · {fmtDate(n.created_at)}</p>
          </div>
        ))}
      </Card>

      {/* Active signals */}
      <Card>
        <h3 className="text-sm font-semibold text-brand-green uppercase tracking-wider mb-3">Señales activas</h3>
        {signals.filter(s => !s.acknowledged).slice(0, 5).map(s => {
          const st = signalTypeLabels[s.signal_type] || { label: s.signal_type, icon: "📡" };
          return (
            <div key={s.id} className="py-2 border-b border-navy-50 last:border-0">
              <div className="flex items-center gap-2">
                <span>{st.icon}</span>
                <p className="text-sm text-navy-900 font-medium flex-1">{s.title}</p>
              </div>
              {s.detail && <p className="text-xs text-navy-500 mt-0.5 ml-6">{s.detail}</p>}
            </div>
          );
        })}
        {signals.filter(s => !s.acknowledged).length === 0 && (
          <p className="text-sm text-navy-400 py-3 text-center">Sin señales pendientes</p>
        )}
      </Card>

      {/* Pending tasks */}
      <Card>
        <h3 className="text-sm font-semibold text-brand-green uppercase tracking-wider mb-3">Tareas pendientes</h3>
        {tasks.slice(0, 5).map(t => (
          <div key={t.id} className="py-2 border-b border-navy-50 last:border-0 flex items-center gap-2">
            <Badge variant={priorityColors[t.priority] as "red" | "yellow" | "blue" || "gray"}>{t.priority}</Badge>
            <p className="text-sm text-navy-900 flex-1">{t.title}</p>
          </div>
        ))}
        {tasks.length === 0 && <p className="text-sm text-navy-400 py-3 text-center">Sin tareas pendientes</p>}
      </Card>

      {/* Hot leads */}
      <Card>
        <h3 className="text-sm font-semibold text-brand-green uppercase tracking-wider mb-3">Leads destacados</h3>
        {leads.filter(l => l.priority === "hot" || l.priority === "warm").slice(0, 5).map(l => (
          <div key={l.id} className="py-2 border-b border-navy-50 last:border-0">
            <div className="flex items-center gap-2">
              <Badge variant={l.priority === "hot" ? "red" : "yellow"}>{l.score}</Badge>
              <p className="text-sm text-navy-900 font-medium">{l.name}</p>
              {l.zone && <span className="text-xs text-navy-400">{l.zone}</span>}
            </div>
            {l.recommendation && <p className="text-xs text-navy-500 mt-0.5 ml-10 line-clamp-2">{l.recommendation}</p>}
          </div>
        ))}
        {leads.filter(l => l.priority === "hot" || l.priority === "warm").length === 0 && (
          <p className="text-sm text-navy-400 py-3 text-center">Sin leads destacados</p>
        )}
      </Card>
    </div>
  );
}

function NewsTab({ items, onMarkRead }: { items: AgentNews[]; onMarkRead: (id: string) => void }) {
  if (items.length === 0) return <EmptyState title="Sin noticias" description="El agente aún no ha recopilado noticias." />;
  return (
    <div className="space-y-3">
      {items.map(n => (
        <Card key={n.id} className={n.read ? "opacity-60" : ""}>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                {n.category && <Badge variant="blue">{n.category}</Badge>}
                <span className="text-xs text-navy-400">{n.source} · {fmtDate(n.created_at)}</span>
              </div>
              <h4 className="text-sm font-medium text-navy-900">{n.title}</h4>
              {n.summary && <p className="text-xs text-navy-600 mt-1 line-clamp-2">{n.summary}</p>}
            </div>
            <div className="flex gap-2 ml-3 shrink-0">
              {n.url && <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-green hover:underline">Ver</a>}
              {!n.read && <button onClick={() => onMarkRead(n.id)} className="text-xs text-navy-400 hover:text-navy-600">Leído</button>}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function SignalsTab({ items, onAcknowledge }: { items: AgentSignal[]; onAcknowledge: (id: string) => void }) {
  if (items.length === 0) return <EmptyState title="Sin señales" description="El agente aún no ha detectado señales relevantes." />;
  return (
    <div className="space-y-3">
      {items.map(s => {
        const st = signalTypeLabels[s.signal_type] || { label: s.signal_type, icon: "📡" };
        return (
          <Card key={s.id} className={s.acknowledged ? "opacity-60" : ""}>
            <div className="flex items-start gap-3">
              <span className="text-xl">{st.icon}</span>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant={s.severity === "warning" ? "yellow" : s.severity === "error" ? "red" : "blue"}>{st.label}</Badge>
                  <span className="text-xs text-navy-400">{fmtDate(s.created_at)}</span>
                </div>
                <h4 className="text-sm font-medium text-navy-900">{s.title}</h4>
                {s.detail && <p className="text-xs text-navy-600 mt-1">{s.detail}</p>}
                {s.action_suggested && (
                  <p className="text-xs text-brand-green mt-1 font-medium">Acción: {s.action_suggested}</p>
                )}
                {s.opportunity && <p className="text-xs text-navy-500 mt-1">Oportunidad: {s.opportunity}</p>}
              </div>
              {!s.acknowledged && (
                <button onClick={() => onAcknowledge(s.id)} className="text-xs text-navy-400 hover:text-navy-600 shrink-0">Entendido</button>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function ReviewsTab({ items }: { items: AgentReview[] }) {
  if (items.length === 0) return <EmptyState title="Sin reseñas" description="El agente aún no ha recopilado reseñas." />;
  return (
    <div className="space-y-3">
      {items.map(r => (
        <Card key={r.id} className={r.urgent ? "border-l-4 border-l-red-400" : ""}>
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-sm">{"⭐".repeat(r.rating)}</span>
              <span className="text-sm font-medium text-navy-900">{r.author || "Anónimo"}</span>
              {r.urgent && <Badge variant="red">Urgente</Badge>}
            </div>
            <span className="text-xs text-navy-400">{fmtDate(r.created_at)}</span>
          </div>
          {r.text_content && <p className="text-sm text-navy-700 mb-2">{r.text_content}</p>}
          {r.suggested_response && (
            <div className="bg-green-50 border border-green-100 rounded-lg p-3 mt-2">
              <p className="text-xs text-green-800 font-medium mb-1">Respuesta sugerida:</p>
              <p className="text-xs text-green-700">{r.suggested_response}</p>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function MarketingTab({ items }: { items: AgentCampaign[] }) {
  if (items.length === 0) return <EmptyState title="Sin ideas de marketing" description="El agente generará ideas de campañas y contenido." />;
  return (
    <div className="space-y-3">
      {items.map(c => (
        <Card key={c.id}>
          <div className="flex items-start justify-between mb-2">
            <h4 className="text-sm font-medium text-navy-900">{c.title}</h4>
            <Badge variant={c.status === "idea" ? "blue" : c.status === "planned" ? "yellow" : "green"}>{c.status}</Badge>
          </div>
          {c.reason && <p className="text-xs text-navy-500 mb-2">{c.reason}</p>}
          {c.channel.length > 0 && (
            <div className="flex gap-1 mb-2">
              {c.channel.map(ch => <span key={ch} className="text-xs bg-navy-50 rounded px-2 py-0.5 text-navy-600">{ch}</span>)}
            </div>
          )}
          {c.message_draft && (
            <div className="bg-navy-50/60 rounded-lg p-3">
              <p className="text-xs text-navy-400 mb-1">Borrador:</p>
              <p className="text-sm text-navy-700">{c.message_draft}</p>
            </div>
          )}
          {c.suggested_date && <p className="text-xs text-navy-400 mt-2">Fecha sugerida: {fmtDate(c.suggested_date)}</p>}
        </Card>
      ))}
    </div>
  );
}

function LeadsTab({ items, onUpdateStatus }: { items: AgentLead[]; onUpdateStatus: (id: string, status: string) => void }) {
  if (items.length === 0) return <EmptyState title="Sin leads" description="El agente detectará negocios que podrían ser tus clientes." />;
  return (
    <div className="space-y-3">
      {items.map(l => (
        <Card key={l.id}>
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white ${
                l.priority === "hot" ? "bg-red-500" : l.priority === "warm" ? "bg-yellow-500" : "bg-blue-400"
              }`}>{l.score}</span>
              <div>
                <h4 className="text-sm font-medium text-navy-900">{l.name}</h4>
                <p className="text-xs text-navy-500">{[l.business_type, l.zone].filter(Boolean).join(" · ")}</p>
              </div>
            </div>
            <Badge variant={l.status === "new" ? "blue" : l.status === "contacted" ? "yellow" : l.status === "converted" ? "green" : "gray"}>
              {l.status}
            </Badge>
          </div>
          {l.issues.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {l.issues.map(issue => (
                <span key={issue} className="text-xs bg-red-50 text-red-600 rounded px-2 py-0.5">{issue.replace(/_/g, " ")}</span>
              ))}
            </div>
          )}
          {l.recommendation && <p className="text-xs text-navy-600 mb-2">{l.recommendation}</p>}
          {l.status === "new" && (
            <div className="flex gap-2 pt-2 border-t border-navy-50">
              <Button size="sm" onClick={() => onUpdateStatus(l.id, "contacted")}>Contactado</Button>
              <Button size="sm" variant="secondary" onClick={() => onUpdateStatus(l.id, "dismissed")}>Descartar</Button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function TasksTab({ items, onComplete }: { items: AgentTask[]; onComplete: (id: string) => void }) {
  if (items.length === 0) return <EmptyState title="Sin tareas pendientes" description="El agente creará tareas de seguimiento cuando detecte acciones necesarias." />;
  return (
    <div className="space-y-3">
      {items.map(t => (
        <Card key={t.id}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onComplete(t.id)}
              className="h-5 w-5 rounded-full border-2 border-navy-300 hover:border-brand-green hover:bg-brand-green/10 transition shrink-0"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-medium text-navy-900">{t.title}</h4>
                <Badge variant={priorityColors[t.priority] as "red" | "yellow" | "blue" || "gray"}>{t.priority}</Badge>
              </div>
              {t.description && <p className="text-xs text-navy-500 mt-0.5">{t.description}</p>}
            </div>
            {t.due_date && <span className="text-xs text-navy-400 shrink-0">{fmtDate(t.due_date)}</span>}
          </div>
        </Card>
      ))}
    </div>
  );
}
