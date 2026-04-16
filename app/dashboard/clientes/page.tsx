"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import PageHeader from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button, LinkButton } from "@/components/ui/button";
import Badge from "@/components/ui/badge";
import { FormField, Input, Select, Textarea, SearchInput } from "@/components/ui/form-fields";
import EmptyState from "@/components/ui/empty-state";

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

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ name: "", email: "", phone: "", company: "", notes: "", status: "lead" });
  const supabase = createClient();

  useEffect(() => { fetchClients(); }, []);

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
    if (confirm("Estás seguro de eliminar este cliente?")) {
      await supabase.from("clients").delete().eq("id", id);
      await fetchClients();
    }
  };

  const filtered = clients.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.email && c.email.toLowerCase().includes(search.toLowerCase())) ||
    (c.company && c.company.toLowerCase().includes(search.toLowerCase()))
  );

  const statusVariant = (s: string): "green" | "blue" | "gray" =>
    s === "active" ? "green" : s === "lead" ? "blue" : "gray";
  const statusLabel = (s: string) => s === "active" ? "Activo" : s === "lead" ? "Lead" : "Inactivo";

  return (
    <>
      <PageHeader
        title="Clientes"
        count={clients.length}
        countLabel={`contacto${clients.length !== 1 ? "s" : ""} en total`}
        actions={
          <Button
            onClick={() => {
              setShowForm(true);
              setEditingClient(null);
              setForm({ name: "", email: "", phone: "", company: "", notes: "", status: "lead" });
            }}
          >
            + Nuevo cliente
          </Button>
        }
      />

      {showForm && (
        <Card className="mb-8">
          <h2 className="text-lg font-bold text-navy-900 mb-6">{editingClient ? "Editar cliente" : "Nuevo cliente"}</h2>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <FormField label="Nombre" required>
                <Input
                  type="text"
                  value={form.name}
                  onChange={e => setForm({...form, name: e.target.value})}
                  required
                  placeholder="Nombre del cliente"
                />
              </FormField>
              <FormField label="Email">
                <Input
                  type="email"
                  value={form.email}
                  onChange={e => setForm({...form, email: e.target.value})}
                  placeholder="email@ejemplo.com"
                />
              </FormField>
              <FormField label="Teléfono">
                <Input
                  type="tel"
                  value={form.phone}
                  onChange={e => setForm({...form, phone: e.target.value})}
                  placeholder="+34 600 000 000"
                />
              </FormField>
              <FormField label="Empresa">
                <Input
                  type="text"
                  value={form.company}
                  onChange={e => setForm({...form, company: e.target.value})}
                  placeholder="Nombre de la empresa"
                />
              </FormField>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <FormField label="Estado">
                <Select
                  value={form.status}
                  onChange={e => setForm({...form, status: e.target.value})}
                >
                  <option value="lead">Lead</option>
                  <option value="active">Activo</option>
                  <option value="inactive">Inactivo</option>
                </Select>
              </FormField>
              <FormField label="Notas">
                <Textarea
                  value={form.notes}
                  onChange={e => setForm({...form, notes: e.target.value})}
                  placeholder="Notas adicionales"
                  rows={1}
                />
              </FormField>
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowForm(false);
                  setEditingClient(null);
                }}
              >
                Cancelar
              </Button>
              <Button type="submit">
                {editingClient ? "Guardar cambios" : "Agregar cliente"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <div className="mb-6">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar por nombre, email o empresa..."
          className="max-w-md"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={search ? "Sin resultados" : "Sin clientes todavía"}
          description={search ? "Prueba con otro término" : "Agrega tu primer cliente para empezar"}
        />
      ) : (
        <Card padding={false} className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-navy-100 dark:border-zinc-800 bg-navy-50/60 dark:bg-zinc-900/50">
                  <th className="text-left px-6 py-3 text-xs font-semibold text-navy-500 dark:text-zinc-400 uppercase tracking-wider">Nombre</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-navy-500 dark:text-zinc-400 uppercase tracking-wider hidden md:table-cell">Email</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-navy-500 dark:text-zinc-400 uppercase tracking-wider hidden lg:table-cell">Teléfono</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-navy-500 dark:text-zinc-400 uppercase tracking-wider hidden md:table-cell">Empresa</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-navy-500 dark:text-zinc-400 uppercase tracking-wider">Estado</th>
                  <th className="text-right px-6 py-3 text-xs font-semibold text-navy-500 dark:text-zinc-400 uppercase tracking-wider">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(client => (
                  <tr key={client.id} className="border-b border-navy-50 dark:border-zinc-800/60 hover:bg-navy-50/40 dark:hover:bg-zinc-800/50 transition-colors">
                    <td className="px-6 py-4 text-sm font-medium text-navy-900 dark:text-white">{client.name}</td>
                    <td className="px-6 py-4 text-sm text-navy-600 dark:text-zinc-400 hidden md:table-cell">{client.email || "—"}</td>
                    <td className="px-6 py-4 text-sm text-navy-600 dark:text-zinc-400 hidden lg:table-cell">{client.phone || "—"}</td>
                    <td className="px-6 py-4 text-sm text-navy-600 dark:text-zinc-400 hidden md:table-cell">{client.company || "—"}</td>
                    <td className="px-6 py-4">
                      <Badge variant={statusVariant(client.status)}>
                        {statusLabel(client.status)}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
                      <button onClick={() => handleEdit(client)} className="text-sm text-brand-green hover:text-brand-green-dark font-medium transition-colors">Editar</button>
                      <button onClick={() => handleDelete(client.id)} className="text-sm text-red-600 hover:text-red-700 font-medium transition-colors">Eliminar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
