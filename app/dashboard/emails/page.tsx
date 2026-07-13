/* eslint-disable react-hooks/set-state-in-effect */
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import PageHeader from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { FormField, Input, Select, Textarea } from "@/components/ui/form-fields";
import { Button } from "@/components/ui/button";
import Badge from "@/components/ui/badge";
import InfoFlipCard from "@/components/ui/InfoFlipCard";

type Client = { id: string; name: string; email: string };
type Message = { id: string; client_id: string; content: string; status: string; created_at: string; clients: { name: string; email: string } };

type Importance = "critical" | "important" | "normal" | "noise";
type ClassifiedThread = {
  thread_id: string;
  from_name: string;
  from_email: string;
  subject: string;
  snippet: string;
  hours_waiting: number;
  category: string;
  priority_signal: string;
  importance: Importance;
  importance_reason: string;
  classified_by: string;
};
type InboxData = {
  ok?: boolean;
  connected?: boolean;
  status?: string;
  error_message?: string | null;
  total_unread?: number;
  importance_counts?: Record<Importance, number>;
  classified_threads?: ClassifiedThread[];
  summary?: string;
};

const templates = [
  { name: "Bienvenida", subject: "Bienvenido a {empresa}", body: "Hola {nombre},\n\nGracias por confiar en nosotros. Estamos encantados de tenerte como cliente.\n\nSi tienes cualquier duda, no dudes en escribirnos.\n\nUn saludo" },
  { name: "Recordatorio cita", subject: "Recordatorio de tu cita", body: "Hola {nombre},\n\nTe recordamos que tienes una cita programada con nosotros.\n\nSi necesitas cambiarla, contáctanos con antelación.\n\nUn saludo" },
  { name: "Seguimiento", subject: "¿Cómo va todo?", body: "Hola {nombre},\n\nQueríamos saber cómo va todo y si podemos ayudarte en algo.\n\nEstamos a tu disposición.\n\nUn saludo" },
];

const IMPORTANCE_META: Record<Importance, { label: string; variant: "red" | "orange" | "blue" | "gray" }> = {
  critical: { label: "Crítico", variant: "red" },
  important: { label: "Importante", variant: "orange" },
  normal: { label: "Normal", variant: "blue" },
  noise: { label: "Ruido", variant: "gray" },
};

function formatWaiting(hours: number): string {
  if (hours < 1) return "hace un momento";
  if (hours < 24) return `hace ${hours}h`;
  const d = Math.round(hours / 24);
  return `hace ${d} día${d === 1 ? "" : "s"}`;
}

const CATEGORY_LABEL: Record<string, string> = {
  customer: "Cliente",
  supplier: "Proveedor",
  lead: "Oportunidad",
  internal: "Interno",
  spam: "Promo",
  unknown: "Sin clasificar",
};

export default function EmailsPage() {
  const [tab, setTab] = useState<"bandeja" | "enviar">("bandeja");

  // --- Send (outbound) state ---
  const [clients, setClients] = useState<Client[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedClient, setSelectedClient] = useState("");
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState({ type: "", text: "" });

  // --- Inbox (Gmail classified) state ---
  const [inbox, setInbox] = useState<InboxData | null>(null);
  const [inboxLoading, setInboxLoading] = useState(true);

  const supabase = createClient();

  const fetchClients = async () => {
    const { data } = await supabase.from("clients").select("id, name, email").order("name");
    if (data) setClients(data);
  };

  const fetchMessages = async () => {
    const { data } = await supabase.from("messages").select("*, clients(name, email)").eq("channel", "email").order("created_at", { ascending: false }).limit(50);
    if (data) setMessages(data as Message[]);
  };

  const fetchInbox = async () => {
    setInboxLoading(true);
    try {
      const res = await fetch("/api/agent/gmail/summary");
      const json = (await res.json()) as InboxData;
      setInbox(json);
    } catch {
      setInbox(null);
    }
    setInboxLoading(false);
  };

  useEffect(() => { fetchClients(); fetchMessages(); fetchInbox(); }, []);

  const applyTemplate = (t: typeof templates[0]) => {
    const client = clients.find(c => c.id === selectedClient);
    const name = client?.name || "{nombre}";
    setSubject(t.subject.replace("{empresa}", "Enlaze").replace("{nombre}", name));
    setContent(t.body.replace(/{nombre}/g, name));
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient || !subject || !content) return;
    setSending(true);
    setResult({ type: "", text: "" });
    const client = clients.find(c => c.id === selectedClient);
    const { data: { user } } = await supabase.auth.getUser();
    const res = await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: client?.email, subject, message: content, clientName: client?.name }),
    });
    const json = await res.json();
    const status = json.success ? "sent" : "failed";
    await supabase.from("messages").insert({ user_id: user?.id, client_id: selectedClient, channel: "email", content: subject + " | " + content, status, sent_at: json.success ? new Date().toISOString() : null });
    if (json.success) {
      setResult({ type: "success", text: "Email enviado correctamente a " + client?.email });
      setContent(""); setSubject(""); setSelectedClient("");
    } else {
      setResult({ type: "error", text: json.error || "Error al enviar. Verifica tu API key de Resend." });
    }
    setSending(false);
    await fetchMessages();
    setTimeout(() => setResult({ type: "", text: "" }), 5000);
  };

  const clientsWithEmail = clients.filter(c => c.email);

  const statusBadge = (s: string) => {
    if (s === "sent" || s === "delivered") return <Badge variant="green">{s === "sent" ? "Enviado" : "Entregado"}</Badge>;
    if (s === "pending") return <Badge variant="yellow">Pendiente</Badge>;
    return <Badge variant="red">Error</Badge>;
  };

  const counts = inbox?.importance_counts || { critical: 0, important: 0, normal: 0, noise: 0 };
  const threads = inbox?.classified_threads || [];
  const actionable = threads.filter(t => t.importance !== "noise");
  const noise = threads.filter(t => t.importance === "noise");

  const renderThread = (t: ClassifiedThread, i: number) => {
    const meta = IMPORTANCE_META[t.importance] || IMPORTANCE_META.normal;
    return (
      <div key={t.thread_id || i} className="px-6 py-4 hover:bg-navy-50/40 dark:hover:bg-zinc-800/50 transition-colors">
        <div className="flex items-center justify-between gap-3 mb-1">
          <span className="text-sm font-medium text-navy-900 dark:text-white truncate">{t.from_name || t.from_email}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <Badge variant={meta.variant}>{meta.label}</Badge>
            <Badge variant="gray">{CATEGORY_LABEL[t.category] || t.category}</Badge>
          </div>
        </div>
        <p className="text-sm font-medium text-navy-800 dark:text-zinc-200 truncate">{t.subject}</p>
        <p className="text-sm text-navy-500 dark:text-zinc-400 truncate">{t.snippet}</p>
        <p className="mt-1 text-xs text-navy-400">
          {formatWaiting(t.hours_waiting)} · {t.importance_reason}
          {t.classified_by === "haiku" ? " · IA" : ""}
        </p>
      </div>
    );
  };

  const renderInbox = () => {
    if (inboxLoading) {
      return <div className="py-16 text-center text-sm text-navy-500">Cargando bandeja…</div>;
    }
    if (!inbox || inbox.connected === false) {
      const notConnected = !inbox || inbox.status === "not_connected";
      return (
        <div className="py-16 text-center px-6">
          <h3 className="text-base font-semibold text-navy-900 dark:text-white">
            {notConnected ? "Gmail no conectado" : "Gmail no disponible ahora mismo"}
          </h3>
          <p className="mt-1 text-sm text-navy-500 max-w-md mx-auto">
            {notConnected
              ? "Conecta tu cuenta de Gmail para ver aquí tus correos entrantes clasificados por importancia."
              : `No se ha podido leer la bandeja (${inbox?.status || "error"}). Prueba a reconectar Gmail.`}
          </p>
          <Link href="/dashboard/settings/integrations" className="inline-block mt-4">
            <Button>{notConnected ? "Conectar Gmail" : "Ir a Integraciones"}</Button>
          </Link>
        </div>
      );
    }
    return (
      <>
        <div className="px-6 py-4 border-b border-navy-50 dark:border-zinc-800 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-navy-500">{inbox.total_unread ?? 0} sin leer ·</span>
          <Badge variant="red">{counts.critical} críticos</Badge>
          <Badge variant="orange">{counts.important} importantes</Badge>
          <Badge variant="blue">{counts.normal} normales</Badge>
          <Badge variant="gray">{counts.noise} ruido</Badge>
        </div>
        {threads.length === 0 ? (
          <div className="py-16 text-center">
            <h3 className="text-base font-semibold text-navy-900 dark:text-white">Todo al día</h3>
            <p className="mt-1 text-sm text-navy-500">No hay correos entrantes pendientes en los últimos 7 días.</p>
          </div>
        ) : (
          <>
            {actionable.length === 0 ? (
              <div className="px-6 py-6 text-sm text-navy-500">Sin correos importantes — solo notificaciones y ruido.</div>
            ) : (
              <div className="divide-y divide-navy-50 dark:divide-zinc-800">
                {actionable.map(renderThread)}
              </div>
            )}
            {noise.length > 0 && (
              <details className="border-t border-navy-50 dark:border-zinc-800">
                <summary className="px-6 py-3 cursor-pointer text-sm text-navy-500 hover:text-navy-700">
                  Ver {noise.length} correos de baja prioridad
                </summary>
                <div className="divide-y divide-navy-50 dark:divide-zinc-800 opacity-75">
                  {noise.map(renderThread)}
                </div>
              </details>
            )}
          </>
        )}
      </>
    );
  };

  return (
    <>
      <PageHeader
        title="Emails"
        description="Tu bandeja de Gmail clasificada por importancia y el envío de emails a clientes"
        titleAdornment={
          <InfoFlipCard
            label="Información sobre Emails"
            what="Aquí ves tu bandeja de Gmail clasificada por importancia (críticos, importantes, normales y ruido) y puedes enviar emails a tus clientes, todo en un solo sitio."
            howTo="En 'Bandeja' el agente analiza tus correos entrantes y los ordena por importancia para que no se te escape nada de clientes o proveedores. En 'Enviar' redactas y mandas emails a tus clientes con plantillas rápidas."
          />
        }
      />

      <div className="mb-6 flex gap-1 border-b border-navy-100 dark:border-zinc-800">
        <button
          onClick={() => setTab("bandeja")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === "bandeja" ? "border-brand-green text-navy-900 dark:text-white" : "border-transparent text-navy-500 hover:text-navy-700"}`}
        >
          Bandeja{actionable.length > 0 ? ` (${actionable.length})` : ""}
        </button>
        <button
          onClick={() => setTab("enviar")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === "enviar" ? "border-brand-green text-navy-900 dark:text-white" : "border-transparent text-navy-500 hover:text-navy-700"}`}
        >
          Enviar
        </button>
      </div>

      {tab === "bandeja" ? (
        <Card padding={false} className="overflow-hidden">
          <CardHeader title="Bandeja de entrada (Gmail)" />
          {renderInbox()}
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-6">
            <Card>
              <h2 className="text-base font-semibold text-navy-900 mb-5">Nuevo email</h2>
              <form onSubmit={handleSend} className="space-y-4">
                <FormField label="Cliente" required>
                  <Select value={selectedClient} onChange={e => setSelectedClient(e.target.value)} required>
                    <option value="">Seleccionar cliente...</option>
                    {clientsWithEmail.map(c => (<option key={c.id} value={c.id}>{c.name} ({c.email})</option>))}
                  </Select>
                </FormField>
                <FormField label="Plantilla rápida">
                  <div className="flex flex-wrap gap-2">
                    {templates.map((t, i) => (
                      <Button key={i} type="button" variant="secondary" size="sm" onClick={() => applyTemplate(t)}>{t.name}</Button>
                    ))}
                  </div>
                </FormField>
                <FormField label="Asunto" required>
                  <Input type="text" value={subject} onChange={e => setSubject(e.target.value)} required placeholder="Asunto del email" />
                </FormField>
                <FormField label="Mensaje" required>
                  <Textarea value={content} onChange={e => setContent(e.target.value)} required rows={5} placeholder="Escribe tu mensaje..." />
                </FormField>
                {result.text && <p className={`text-sm font-medium ${result.type === "success" ? "text-brand-green" : "text-red-600"}`}>{result.text}</p>}
                <Button type="submit" disabled={sending} className="w-full">
                  {sending ? "Enviando..." : "Enviar email"}
                </Button>
              </form>
            </Card>
          </div>
          <div className="lg:col-span-2">
            <Card padding={false} className="overflow-hidden">
              <CardHeader title="Historial de emails enviados" />
              {messages.length === 0 ? (
                <div className="py-16 text-center">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto text-navy-300 mb-3"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                  <h3 className="text-base font-semibold text-navy-900">Sin emails todavía</h3>
                  <p className="mt-1 text-sm text-navy-500">Envía tu primer email automático</p>
                </div>
              ) : (
                <div className="divide-y divide-navy-50 dark:divide-zinc-800">
                  {messages.map(msg => (
                    <div key={msg.id} className="px-6 py-4 hover:bg-navy-50/40 dark:hover:bg-zinc-800/50 transition-colors">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-navy-900 dark:text-white">{msg.clients?.name || "Cliente"}</span>
                        {statusBadge(msg.status)}
                      </div>
                      <p className="text-sm text-navy-600 dark:text-zinc-400 truncate">{msg.content}</p>
                      <p className="mt-1 text-xs text-navy-400">{new Date(msg.created_at).toLocaleString("es-ES")}</p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
