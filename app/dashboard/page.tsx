"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";

type Client = {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  notes: string;
  status: string;
  created_at: string;
};

const LinkIcon = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#00c896" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

export default function DashboardPage() {
  const [user, setUser] = useState<any>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ name: "", email: "", phone: "", company: "", notes: "", status: "lead" });
  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      setUser(user);
      await fetchClients();
      setLoading(false);
    };
    init();
  }, []);

  const fetchClients = async () => {
    const { data } = await supabase.from("clients").select("*").order("created_at", { ascending: false });
    if (data) setClients(data);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingClient) {
      await supabase.from("clients").update(form).eq("id", editingClient.id);
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from("clients").insert({ ...form, user_id: user?.id });
    }
    setForm({ name: "", email: "", phone: "", company: "", notes: "", status: "lead" });
    setShowForm(false);
    setEditingClient(null);
    await fetchClients();
  };

  const handleEdit = (client: Client) => {
    setForm({ name: client.name, email: client.email || "", phone: client.phone || "", company: client.company || "", notes: client.notes || "", status: client.status });
    setEditingClient(client);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (confirm("Estas seguro de eliminar este cliente?")) {
      await supabase.from("clients").delete().eq("id", id);
      await fetchClients();
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  const filtered = clients.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.email && c.email.toLowerCase().includes(search.toLowerCase())) ||
    (c.company && c.company.toLowerCase().includes(search.toLowerCase()))
  );

  const statusColor = (s: string) => s === "active" ? "bg-brand-green/10 text-brand-green" : s === "lead" ? "bg-blue-50 text-blue-600" : "bg-navy-100 text-navy-500";
  const statusLabel = (s: string) => s === "active" ? "Activo" : s === "lead" ? "Lead" : "Inactivo";

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-navy-50">
        <div className="text-navy-600">Cargando...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-navy-50">
      <header className="bg-white border-b border-navy-100">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-navy-800 flex items-center justify-center"><LinkIcon /></div>
            <span className="text-xl font-bold text-navy-900">Enlaze</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-navy-600 hidden sm:block">{user?.email}</span>
            <button onClick={handleLogout} className="px-4 py-2 rounded-xl border border-navy-200 text-sm font-medium text-navy-700 hover:bg-navy-50 transition-colors">Cerrar sesion</button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-navy-900">Clientes</h1>
            <p className="mt-1 text-navy-600">{clients.length} contacto{clients.length !== 1 ? "s" : ""} en total</p>
          </div>
          <button onClick={() => { setShowForm(true); setEditingClient(null); setForm({ name: "", email: "", phone: "", company: "", notes: "", status: "lead" }); }} className="px-5 py-2.5 rounded-xl bg-brand-green text-white font-semibold shadow-lg shadow-brand-green/25 hover:bg-brand-green-dark transition-colors">
            + Nuevo cliente
          </button>
        </div>

        {showForm && (
          <div className="mb-8 rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-navy-900 mb-4">{editingClient ? "Editar cliente" : "Nuevo cliente"}</h2>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-navy-700 mb-1">Nombre *</label>
                <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-50 text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50" placeholder="Nombre del cliente" />
              </div>
              <div>
                <label className="block text-sm font-medium text-navy-700 mb-1">Email</label>
                <input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-50 text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50" placeholder="email@ejemplo.com" />
              </div>
              <div>
                <label className="block text-sm font-medium text-navy-700 mb-1">Telefono</label>
                <input type="tel" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-50 text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50" placeholder="+34 600 000 000" />
              </div>
              <div>
                <label className="block text-sm font-medium text-navy-700 mb-1">Empresa</label>
                <input type="text" value={form.company} onChange={e => setForm({...form, company: e.target.value})} className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-50 text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50" placeholder="Nombre de la empresa" />
              </div>
              <div>
                <label className="block text-sm font-medium text-navy-700 mb-1">Estado</label>
                <select value={form.status} onChange={e => setForm({...form, status: e.target.value})} className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-50 text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50">
                  <option value="lead">Lead</option>
                  <option value="active">Activo</option>
                  <option value="inactive">Inactivo</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-navy-700 mb-1">Notas</label>
                <input type="text" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-50 text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50" placeholder="Notas adicionales" />
              </div>
              <div className="md:col-span-2 flex gap-3 justify-end">
                <button type="button" onClick={() => { setShowForm(false); setEditingClient(null); }} className="px-5 py-2.5 rounded-xl border border-navy-200 text-sm font-medium text-navy-700 hover:bg-navy-50">Cancelar</button>
                <button type="submit" className="px-5 py-2.5 rounded-xl bg-brand-green text-white text-sm font-semibold hover:bg-brand-green-dark transition-colors">{editingClient ? "Guardar cambios" : "Agregar cliente"}</button>
              </div>
            </form>
          </div>
        )}

        <div className="mb-6">
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} className="w-full max-w-md px-4 py-3 rounded-xl border border-navy-200 bg-white text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50" placeholder="Buscar por nombre, email o empresa..." />
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-navy-100 bg-white p-12 text-center">
            <p className="text-4xl mb-4">👥</p>
            <h3 className="text-lg font-bold text-navy-900">{search ? "Sin resultados" : "Sin clientes todavia"}</h3>
            <p className="mt-2 text-navy-600">{search ? "Prueba con otro termino de busqueda" : "Agrega tu primer cliente para empezar"}</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-navy-100 bg-white shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-navy-100 bg-navy-50">
                    <th className="text-left px-6 py-3 text-xs font-semibold text-navy-500 uppercase tracking-wider">Nombre</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-navy-500 uppercase tracking-wider hidden md:table-cell">Email</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-navy-500 uppercase tracking-wider hidden lg:table-cell">Telefono</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-navy-500 uppercase tracking-wider hidden md:table-cell">Empresa</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-navy-500 uppercase tracking-wider">Estado</th>
                    <th className="text-right px-6 py-3 text-xs font-semibold text-navy-500 uppercase tracking-wider">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(client => (
                    <tr key={client.id} className="border-b border-navy-50 hover:bg-navy-50/50 transition-colors">
                      <td className="px-6 py-4 text-sm font-medium text-navy-900">{client.name}</td>
                      <td className="px-6 py-4 text-sm text-navy-600 hidden md:table-cell">{client.email || "—"}</td>
                      <td className="px-6 py-4 text-sm text-navy-600 hidden lg:table-cell">{client.phone || "—"}</td>
                      <td className="px-6 py-4 text-sm text-navy-600 hidden md:table-cell">{client.company || "—"}</td>
                      <td className="px-6 py-4"><span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-semibold ${statusColor(client.status)}`}>{statusLabel(client.status)}</span></td>
                      <td className="px-6 py-4 text-right">
                        <button onClick={() => handleEdit(client)} className="text-sm text-brand-green hover:underline mr-3">Editar</button>
                        <button onClick={() => handleDelete(client.id)} className="text-sm text-red-500 hover:underline">Eliminar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
