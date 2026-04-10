/* eslint-disable react-hooks/set-state-in-effect */
"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";

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
    setSuccess("Mensaje guardado. Se enviara cuando conectes la API de WhatsApp Business.");
    await fetchMessages();
    setTimeout(() => setSuccess(""), 5000);
  };

  const statusColor = (s: string) => {
    if (s === "sent" || s === "delivered") return "bg-brand-green/10 text-brand-green";
    if (s === "pending") return "bg-yellow-50 text-yellow-600";
    return "bg-red-50 text-red-500";
  };
  const statusLabel = (s: string) => {
    if (s === "sent") return "Enviado";
    if (s === "delivered") return "Entregado";
    if (s === "pending") return "Pendiente";
    return "Error";
  };

  const clientsWithPhone = clients.filter(c => c.phone);

  return (
    <>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-navy-900">WhatsApp</h1>
        <p className="mt-1 text-navy-600">Envia mensajes a tus clientes por WhatsApp</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <div className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-navy-900 mb-4">Nuevo mensaje</h2>
            <form onSubmit={handleSend} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-navy-700 mb-1">Cliente</label>
                <select value={selectedClient} onChange={e => setSelectedClient(e.target.value)} required className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-50 text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50">
                  <option value="">Seleccionar cliente...</option>
                  {clientsWithPhone.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.phone})</option>
                  ))}
                </select>
                {clients.length > 0 && clientsWithPhone.length === 0 && (
                  <p className="mt-2 text-xs text-yellow-600">Ningun cliente tiene telefono. Agrega telefonos en la seccion Clientes.</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-navy-700 mb-1">Mensaje</label>
                <textarea value={content} onChange={e => setContent(e.target.value)} required rows={4} className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-50 text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50 resize-none" placeholder="Escribe tu mensaje..." />
              </div>
              {success && <p className="text-sm text-brand-green">{success}</p>}
              <button type="submit" disabled={sending} className="w-full py-3 rounded-xl bg-brand-green text-white font-semibold shadow-lg shadow-brand-green/25 hover:bg-brand-green-dark transition-colors disabled:opacity-50">
                {sending ? "Enviando..." : "Enviar mensaje"}
              </button>
            </form>

            <div className="mt-6 p-4 rounded-xl bg-navy-50 border border-navy-100">
              <p className="text-xs font-semibold text-navy-700 mb-1">Conectar WhatsApp Business API</p>
              <p className="text-xs text-navy-500">Para enviar mensajes reales necesitas una cuenta de Meta Business verificada. Los mensajes se guardaran como pendientes hasta que conectes la API.</p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="rounded-2xl border border-navy-100 bg-white shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-navy-100">
              <h2 className="font-bold text-navy-900">Historial de mensajes</h2>
            </div>
            {messages.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-4xl mb-4">💬</p>
                <h3 className="text-lg font-bold text-navy-900">Sin mensajes todavia</h3>
                <p className="mt-2 text-navy-600">Envia tu primer mensaje de WhatsApp</p>
              </div>
            ) : (
              <div className="divide-y divide-navy-50">
                {messages.map(msg => (
                  <div key={msg.id} className="px-6 py-4 hover:bg-navy-50/50 transition-colors">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-semibold text-navy-900">{msg.clients?.name || "Cliente"}</span>
                      <span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-semibold ${statusColor(msg.status)}`}>{statusLabel(msg.status)}</span>
                    </div>
                    <p className="text-sm text-navy-600">{msg.content}</p>
                    <p className="mt-1 text-xs text-navy-400">{new Date(msg.created_at).toLocaleString("es-ES")}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
