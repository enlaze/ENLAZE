"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import PageHeader from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Badge from "@/components/ui/badge";
import { FormField, Input, Select, Textarea } from "@/components/ui/form-fields";
import EmptyState from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import DataTable, { type Column } from "@/components/ui/data-table";
import InfoFlipCard from "@/components/ui/InfoFlipCard";

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
  const [form, setForm] = useState({ name: "", email: "", phone: "", company: "", notes: "", status: "lead" });
  const supabase = createClient();
  const confirm = useConfirm();
  const toast = useToast();

  const fetchClients = async () => {
    const { data } = await supabase.from("clients").select("*").order("created_at", { ascending: false });
    if (data) setClients(data);
  };

  useEffect(() => { fetchClients(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

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
    toast.success(editingClient ? "Cliente actualizado" : "Cliente creado");
  };

  const handleEdit = (client: Client) => {
    setForm({ name: client.name, email: client.email || "", phone: client.phone || "", company: client.company || "", notes: client.notes || "", status: client.status });
    setEditingClient(client);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: "Eliminar cliente",
      description: "Estás seguro de eliminar este cliente?",
      variant: "danger",
      confirmLabel: "Eliminar",
    });
    if (!ok) return;
    try {
      await supabase.from("clients").delete().eq("id", id);
      await fetchClients();
      toast.success("Cliente eliminado");
    } catch (error) {
      toast.error("Error al eliminar el cliente");
    }
  };

  const handleBulkDelete = async (rows: Client[]) => {
    const ok = await confirm({
      title: `Eliminar ${rows.length} cliente${rows.length === 1 ? "" : "s"}`,
      description: "Esta acción no se puede deshacer.",
      variant: "danger",
      confirmLabel: "Eliminar",
    });
    if (!ok) return;
    try {
      const ids = rows.map((r) => r.id);
      await supabase.from("clients").delete().in("id", ids);
      await fetchClients();
      toast.success(`${rows.length} cliente${rows.length === 1 ? "" : "s"} eliminado${rows.length === 1 ? "" : "s"}`);
    } catch {
      toast.error("Error al eliminar los clientes");
    }
  };

  const statusVariant = (s: string): "green" | "blue" | "gray" =>
    s === "active" ? "green" : s === "lead" ? "blue" : "gray";
  const statusLabel = (s: string) => s === "active" ? "Activo" : s === "lead" ? "Lead" : "Inactivo";

  const columns: Column<Client>[] = [
    {
      key: "name",
      header: "Nombre",
      sortable: true,
      exportValue: (c) => c.name,
      alwaysVisible: true,
      render: (c) => (
        <span className="font-medium text-navy-900 dark:text-white">{c.name}</span>
      ),
    },
    {
      key: "email",
      header: "Email",
      sortable: true,
      hidden: "hidden md:table-cell",
      exportValue: (c) => c.email,
      render: (c) => (
        <span className="text-navy-600 dark:text-zinc-400">{c.email || "—"}</span>
      ),
    },
    {
      key: "phone",
      header: "Teléfono",
      hidden: "hidden lg:table-cell",
      exportValue: (c) => c.phone,
      render: (c) => (
        <span className="text-navy-600 dark:text-zinc-400">{c.phone || "—"}</span>
      ),
    },
    {
      key: "company",
      header: "Empresa",
      sortable: true,
      hidden: "hidden md:table-cell",
      exportValue: (c) => c.company,
      render: (c) => (
        <span className="text-navy-600 dark:text-zinc-400">{c.company || "—"}</span>
      ),
    },
    {
      key: "status",
      header: "Estado",
      sortable: true,
      exportValue: (c) => statusLabel(c.status),
      render: (c) => (
        <Badge variant={statusVariant(c.status)}>{statusLabel(c.status)}</Badge>
      ),
    },
    {
      key: "created_at",
      header: "Creado",
      sortable: true,
      defaultHidden: true,
      hidden: "hidden lg:table-cell",
      exportValue: (c) => c.created_at,
      render: (c) => (
        <span className="text-navy-500 dark:text-zinc-500 tabular-nums">
          {c.created_at ? new Date(c.created_at).toLocaleDateString("es-ES") : "—"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Acciones",
      align: "right",
      alwaysVisible: true,
      render: (c) => (
        <div className="space-x-3" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => handleEdit(c)}
            className="text-sm text-brand-green hover:text-brand-green-dark font-medium transition-colors"
          >
            Editar
          </button>
          <button
            onClick={() => handleDelete(c.id)}
            className="text-sm text-red-600 hover:text-red-700 font-medium transition-colors"
          >
            Eliminar
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Clientes"
        count={clients.length}
        countLabel={`contacto${clients.length !== 1 ? "s" : ""} en total`}
        titleAdornment={
          <InfoFlipCard
            label="Información sobre Clientes"
            what="Tu agenda de contactos inteligente. Aquí viven todos tus clientes y leads — con su información de contacto, estado y todo el historial de lo que ha pasado con cada uno."
            howTo="Para tener controlado quién es quién en tu negocio. Puedes ver de un vistazo qué clientes están activos, cuáles son leads que aún no han contratado, añadir notas, buscar cualquier contacto en segundos y acceder a todo lo que has hecho con ellos — presupuestos, facturas, conversaciones — sin buscar en el móvil ni en el correo."
          />
        }
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
          <h2 className="text-lg font-bold text-navy-900 mb-6 dark:text-white">{editingClient ? "Editar cliente" : "Nuevo cliente"}</h2>
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

      {clients.length === 0 ? (
        <EmptyState
          title="Sin clientes todavía"
          description="Agrega tu primer cliente para empezar"
        />
      ) : (
        <DataTable<Client>
          columns={columns}
          data={clients}
          rowKey={(c) => c.id}
          searchable
          searchPlaceholder="Buscar por nombre, email o empresa..."
          searchFields={(c) => [c.name, c.email, c.company, c.phone]}
          filters={[
            {
              key: "status",
              label: "Estado",
              options: [
                { label: "Leads", value: "lead" },
                { label: "Activos", value: "active" },
                { label: "Inactivos", value: "inactive" },
              ],
              matches: (c, v) => c.status === v,
            },
          ]}
          initialSort={{ key: "created_at", dir: "desc" }}
          pageSize={25}
          selectable
          bulkActions={[
            {
              label: "Eliminar",
              variant: "danger",
              onClick: handleBulkDelete,
            },
          ]}
          exportable
          exportFileName="clientes"
          toggleableColumns
          emptyMessage="Sin resultados. Prueba con otro término."
        />
      )}
    </>
  );
}
