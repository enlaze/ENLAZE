/* eslint-disable react-hooks/set-state-in-effect */
"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import PageHeader from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { FormField, Input, Select, Textarea } from "@/components/ui/form-fields";
import { Button } from "@/components/ui/button";
import Badge from "@/components/ui/badge";

type Client = { id: string; name: string; email: string };
type Message = { id: string; client_id: string; content: string; status: string; created_at: string; clients: { name: string; email: string } };

const templates = [
  { name: "Bienvenida", subject: "Bienvenido a {empresa}", body: "Hola {nombre},\n\nGracias por confiar en nosotros. Estamos encantados de tenerte como cliente.\n\nSi tienes cualquier duda, no dudes en escribirnos.\n\nUn saludo" },
  { name: "Recordatorio cita", subject: "Recordatorio de tu cita", body: "Hola {nombre},\n\nTe recordamos que tienes una cita programada con nosotros.\n\nSi necesitas cambiarla, contáctanos con antelación.\n\nUn saludo" },
  { name: "Seguimiento", subject: "¿Cómo va todo?", body: "Hola {nombre},\n\nQueríamos saber cómo va todo y si podemos ayudarte en algo.\n\nEstamos a tu disposición.\n\nUn saludo" },
];

export default function EmailsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedClient, setSelectedClient] = useState("");
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState({ type: "", text: "" });
  const supabase = createClient();

  const fetchClients = async () => {
    const { data } = await supabase.from("clients").select("id, name, email").order("name");
    if (data) setClients(data);
  };

  const fetchMessages = async () => {
    const { data } = await supabase.from("messages").select("*, clients(name, email)").eq("channel", "email").order("created_at", { ascending: false }).limit(50);
    if (data) setMessages(data as Message[]);
  };

  useEffect(() => { fetchClients(); fetchMessages(); }, []);

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

  return (
    <>
      <PageHeader title="Emails" description="Envía emails automáticos a tus clientes" />
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
            <CardHeader title="Historial de emails" />
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
    </>
  );
}
