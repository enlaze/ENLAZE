"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";

type Client = { id: string; name: string; email: string };
type Message = { id: string; client_id: string; content: string; status: string; created_at: string; clients: { name: string; email: string } };

const templates = [
  { name: "Bienvenida", subject: "Bienvenido a {empresa}", body: "Hola {nombre},\n\nGracias por confiar en nosotros. Estamos encantados de tenerte como cliente.\n\nSi tienes cualquier duda, no dudes en escribirnos.\n\nUn saludo" },
  { name: "Recordatorio cita", subject: "Recordatorio de tu cita", body: "Hola {nombre},\n\nTe recordamos que tienes una cita programada con nosotros.\n\nSi necesitas cambiarla, contactanos con antelacion.\n\nUn saludo" },
  { name: "Seguimiento", subject: "Como va todo?", body: "Hola {nombre},\n\nQueriamos saber como va todo y si podemos ayudarte en algo.\n\nEstamos a tu disposicion.\n\nUn saludo" },
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

  useEffect(() => { fetchClients(); fetchMessages(); }, []);

  const fetchClients = async () => {
    const { data } = await supabase.from("clients").select("id, name, email").order("name");
    if (data) setClients(data);
  };

  const fetchMessages = async () => {
    const { data } = await supabase.from("messages").select("*, clients(name, email)").eq("channel", "email").order("created_at", { ascending: false }).limit(50);
    if (data) setMessages(data as any);
  };

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
  const statusColor = (s: string) => s === "sent" || s === "delivered" ? "bg-brand-green/10 text-brand-green" : s === "pending" ? "bg-yellow-50 text-yellow-600" : "bg-red-50 text-red-500";
  const statusLabel = (s: string) => s === "sent" ? "Enviado" : s === "delivered" ? "Entregado" : s === "pending" ? "Pendiente" : "Error";

  return (
    <>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-navy-900">Emails</h1>
        <p className="mt-1 text-navy-600">Envia emails automaticos a tus clientes</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <div className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-navy-900 mb-4">Nuevo email</h2>
            <form onSubmit={handleSend} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-navy-700 mb-1">Cliente</label>
                <select value={selectedClient} onChange={e => setSelectedClient(e.target.value)} required className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-50 text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50">
                  <option value="">Seleccionar cliente...</option>
                  {clientsWithEmail.map(c => (<option key={c.id} value={c.id}>{c.name} ({c.email})</option>))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-navy-700 mb-1">Plantilla rapida</label>
                <div className="flex flex-wrap gap-2">
                  {templates.map((t, i) => (<button key={i} type="button" onClick={() => applyTemplate(t)} className="px-3 py-1.5 rounded-lg border border-navy-200 text-xs font-medium text-navy-700 hover:bg-navy-50 transition-colors">{t.name}</button>))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-navy-700 mb-1">Asunto</label>
                <input type="text" value={subject} onChange={e => setSubject(e.target.value)} required className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-50 text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50" placeholder="Asunto del email" />
              </div>
              <div>
                <label className="block text-sm font-medium text-navy-700 mb-1">Mensaje</label>
                <textarea value={content} onChange={e => setContent(e.target.value)} required rows={5} className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-50 text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50 resize-none" placeholder="Escribe tu mensaje..." />
              </div>
              {result.text && <p className={`text-sm ${result.type === "success" ? "text-brand-green" : "text-red-500"}`}>{result.text}</p>}
              <button type="submit" disabled={sending} className="w-full py-3 rounded-xl bg-brand-green text-white font-semibold shadow-lg shadow-brand-green/25 hover:bg-brand-green-dark transition-colors disabled:opacity-50">{sending ? "Enviando..." : "Enviar email"}</button>
            </form>
          </div>
        </div>
        <div className="lg:col-span-2">
          <div className="rounded-2xl border border-navy-100 bg-white shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-navy-100"><h2 className="font-bold text-navy-900">Historial de emails</h2></div>
            {messages.length === 0 ? (
              <div className="p-12 text-center"><p className="text-4xl mb-4">📧</p><h3 className="text-lg font-bold text-navy-900">Sin emails todavia</h3><p className="mt-2 text-navy-600">Envia tu primer email automatico</p></div>
            ) : (
              <div className="divide-y divide-navy-50">
                {messages.map(msg => (
                  <div key={msg.id} className="px-6 py-4 hover:bg-navy-50/50 transition-colors">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-semibold text-navy-900">{msg.clients?.name || "Cliente"}</span>
                      <span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-semibold ${statusColor(msg.status)}`}>{statusLabel(msg.status)}</span>
                    </div>
                    <p className="text-sm text-navy-600 truncate">{msg.content}</p>
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
