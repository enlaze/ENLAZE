/* eslint-disable react-hooks/set-state-in-effect */
"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import PageHeader from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { FormField, Select, Textarea } from "@/components/ui/form-fields";
import { Button } from "@/components/ui/button";
import Badge from "@/components/ui/badge";
import EmptyState from "@/components/ui/empty-state";

type Client = { id: string; name: string; phone: string };
type Message = { id: string; client_id: string; content: string; status: string; created_at: string; clients: { name: string; phone: string } };

export default function MessagesPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedClient, setSelectedClient] = useState("");
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState("");
  const supabase = createClient();

  const fetchClients = async () => {
    const { data } = await supabase.from("clients").select("id, name, phone").order("name");
    if (data) setClients(data);
  };

  const fetchMessages = async () => {
    const { data } = await supabase.from("messages").select("*, clients(name, phone)").eq("channel", "whatsapp").order("created_at", { ascending: false }).limit(50);
    if (data) setMessages(data as Message[]);
  };

  useEffect(() => {
    fetchClients();
    fetchMessages();
  }, []);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient || !content) return;
    setSending(true);
    setSuccess("");
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("messages").insert({
      user_id: user?.id,
      client_id: selectedClient,
      channel: "whatsapp",
      content,
      status: "pending",
    });
    setContent("");
    setSelectedClient("");
    setSending(false);
    setSuccess("Mensaje guardado. Se enviará cuando conectes la API de WhatsApp Business.");
    await fetchMessages();
    setTimeout(() => setSuccess(""), 5000);
  };

  const statusBadge = (s: string) => {
    if (s === "sent" || s === "delivered") return <Badge variant="green">{s === "sent" ? "Enviado" : "Entregado"}</Badge>;
    if (s === "pending") return <Badge variant="yellow">Pendiente</Badge>;
    return <Badge variant="red">Error</Badge>;
  };

  const clientsWithPhone = clients.filter(c => c.phone);

  return (
    <>
      <PageHeader title="WhatsApp" description="Envía mensajes a tus clientes por WhatsApp" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <h2 className="text-base font-semibold text-navy-900 dark:text-white mb-5">Nuevo mensaje</h2>
            <form onSubmit={handleSend} className="space-y-4">
              <FormField label="Cliente" required>
                <Select value={selectedClient} onChange={e => setSelectedClient(e.target.value)} required>
                  <option value="">Seleccionar cliente...</option>
                  {clientsWithPhone.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.phone})</option>
                  ))}
                </Select>
                {clients.length > 0 && clientsWithPhone.length === 0 && (
                  <p className="mt-2 text-xs text-amber-600">Ningún cliente tiene teléfono. Agrega teléfonos en la sección Clientes.</p>
                )}
              </FormField>
              <FormField label="Mensaje" required>
                <Textarea value={content} onChange={e => setContent(e.target.value)} required rows={4} placeholder="Escribe tu mensaje..." />
              </FormField>
              {success && <p className="text-sm text-brand-green font-medium">{success}</p>}
              <Button type="submit" disabled={sending} className="w-full">
                {sending ? "Enviando..." : "Enviar mensaje"}
              </Button>
            </form>

            <div className="mt-6 rounded-xl bg-navy-50/60 dark:bg-zinc-900/50 border border-navy-100 dark:border-zinc-800 p-4">
              <p className="text-xs font-semibold text-navy-700 dark:text-zinc-200 mb-1">Conectar WhatsApp Business API</p>
              <p className="text-xs text-navy-500 dark:text-zinc-400">Para enviar mensajes reales necesitas una cuenta de Meta Business verificada. Los mensajes se guardarán como pendientes hasta que conectes la API.</p>
            </div>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card padding={false} className="overflow-hidden">
            <CardHeader title="Historial de mensajes" />
            {messages.length === 0 ? (
              <div className="py-16 text-center">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto text-navy-300 dark:text-zinc-600 mb-3"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                <h3 className="text-base font-semibold text-navy-900 dark:text-white">Sin mensajes todavía</h3>
                <p className="mt-1 text-sm text-navy-500 dark:text-zinc-400">Envía tu primer mensaje de WhatsApp</p>
              </div>
            ) : (
              <div className="divide-y divide-navy-50 dark:divide-zinc-800">
                {messages.map(msg => (
                  <div key={msg.id} className="px-6 py-4 hover:bg-navy-50/40 dark:hover:bg-zinc-800/50 transition-colors">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-navy-900 dark:text-white">{msg.clients?.name || "Cliente"}</span>
                      {statusBadge(msg.status)}
                    </div>
                    <p className="text-sm text-navy-600">{msg.content}</p>
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
