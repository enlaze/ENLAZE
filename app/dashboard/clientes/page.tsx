"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import PageHeader from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import DataTable, { type Column } from "@/components/ui/data-table";
import InfoFlipCard from "@/components/ui/InfoFlipCard";
import ClientForm from "@/components/clientes/ClientForm";
import { Avatar, StatusPill, type CliTone } from "@/components/clientes/ui";
import {
  EMPTY_CLIENT_TOTALS,
  clientStatusLabels,
  eur,
  getClientsInvoiceTotals,
  initials,
  type Client,
  type ClientInvoiceTotals,
} from "@/lib/clients";

const statusTone: Record<string, CliTone> = {
  active: "success",
  lead: "info",
  inactive: "neutral",
};

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [totals, setTotals] = useState<Map<string, ClientInvoiceTotals>>(new Map());
  const [showForm, setShowForm] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const supabase = createClient();
  const confirm = useConfirm();
  const toast = useToast();
  const router = useRouter();

  const fetchClients = useCallback(async () => {
    const { data } = await supabase
      .from("clients")
      .select("*")
      .order("created_at", { ascending: false });
    const rows = (data || []) as Client[];
    setClients(rows);
    /* El saldo no está en `clients`: se suma sobre las facturas emitidas, de
       todos los clientes en una sola consulta (no una por fila). */
    setTotals(await getClientsInvoiceTotals(supabase, rows.map((c) => c.id)));
  }, [supabase]);

  /* La carga va dentro de una función async del propio efecto, como en la
     ficha y en la página de proveedores: los `setState` ocurren después de un
     `await`, nunca de forma síncrona durante el efecto. */
  useEffect(() => {
    async function load() {
      await fetchClients();
    }
    load();
  }, [fetchClients]);

  const closeForm = () => {
    setShowForm(false);
    setEditingClient(null);
  };

  const handleEdit = (client: Client) => {
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
    const { error } = await supabase.from("clients").delete().eq("id", id);
    if (error) {
      toast.error("Error al eliminar el cliente");
      return;
    }
    await fetchClients();
    toast.success("Cliente eliminado");
  };

  const handleBulkDelete = async (rows: Client[]) => {
    const ok = await confirm({
      title: `Eliminar ${rows.length} cliente${rows.length === 1 ? "" : "s"}`,
      description: "Esta acción no se puede deshacer.",
      variant: "danger",
      confirmLabel: "Eliminar",
    });
    if (!ok) return;
    const { error } = await supabase
      .from("clients")
      .delete()
      .in("id", rows.map((r) => r.id));
    if (error) {
      toast.error("Error al eliminar los clientes");
      return;
    }
    await fetchClients();
    toast.success(`${rows.length} cliente${rows.length === 1 ? "" : "s"} eliminado${rows.length === 1 ? "" : "s"}`);
  };

  /* Todas las etiquetas en uso: alimentan el filtro y las sugerencias del
     formulario, para que el usuario reutilice las que ya tiene en vez de
     inventar una variante nueva cada vez. */
  const allTags = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of clients) {
      for (const t of c.tags ?? []) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b, "es"));
  }, [clients]);

  const totalsFor = (id: string) => totals.get(id) ?? EMPTY_CLIENT_TOTALS;

  const columns: Column<Client>[] = [
    {
      key: "name",
      header: "Cliente",
      sortable: true,
      exportValue: (c) => c.name,
      alwaysVisible: true,
      render: (c) => (
        <div className="flex items-center gap-3">
          <Avatar>{initials(c.name)}</Avatar>
          <div className="min-w-0">
            <div className="truncate font-medium text-navy-900 dark:text-white">{c.name}</div>
            <div className="truncate text-xs text-navy-500 dark:text-zinc-400">
              {[c.company, c.phone].filter(Boolean).join(" · ") || "—"}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "tags",
      header: "Etiquetas",
      hidden: "hidden lg:table-cell",
      exportValue: (c) => (c.tags ?? []).join(", "),
      render: (c) => {
        const tags = c.tags ?? [];
        if (tags.length === 0) return <span className="text-navy-400 dark:text-zinc-500">—</span>;
        return (
          <div className="flex flex-wrap gap-1.5">
            {tags.slice(0, 2).map((t) => (
              <StatusPill key={t} tone="info">
                {t}
              </StatusPill>
            ))}
            {tags.length > 2 && (
              <StatusPill tone="neutral">+{tags.length - 2}</StatusPill>
            )}
          </div>
        );
      },
    },
    {
      key: "email",
      header: "Email",
      sortable: true,
      /* Oculta por defecto: con Etiquetas y Saldo añadidas, el email empujaba
         la columna de acciones fuera del ancho visible. Sigue disponible en
         el selector de columnas, en el buscador y en la exportación. */
      defaultHidden: true,
      hidden: "hidden xl:table-cell",
      exportValue: (c) => c.email ?? "",
      render: (c) => (
        <span className="text-navy-600 dark:text-zinc-400">{c.email || "—"}</span>
      ),
    },
    {
      key: "balance",
      header: "Saldo",
      align: "right",
      sortable: true,
      /* Número, no cadena: `exportValue` es también el criterio de orden
         (ver el accessor de DataTable), y "1000" ordena antes que "900" si
         se compara como texto. */
      exportValue: (c) => totalsFor(c.id).overdue + totalsFor(c.id).pending,
      render: (c) => {
        const t = totalsFor(c.id);
        const owed = t.overdue + t.pending;
        return (
          <div className="text-right">
            <div
              className={`text-sm font-bold tabular-nums ${
                t.overdue > 0
                  ? "text-danger-ink"
                  : t.pending > 0
                    ? "text-warning-ink"
                    : "text-navy-500 dark:text-zinc-400"
              }`}
            >
              {eur(owed)}
            </div>
            <div className="text-xs text-navy-400 dark:text-zinc-500">
              {t.overdue_count > 0
                ? `${t.overdue_count} vencida${t.overdue_count === 1 ? "" : "s"}`
                : t.pending_count > 0
                  ? `${t.pending_count} pendiente${t.pending_count === 1 ? "" : "s"}`
                  : t.invoice_count > 0
                    ? "Al día"
                    : "Sin facturas"}
            </div>
          </div>
        );
      },
    },
    {
      key: "status",
      header: "Estado",
      sortable: true,
      exportValue: (c) => clientStatusLabels[c.status] ?? c.status,
      render: (c) => (
        <StatusPill tone={statusTone[c.status] ?? "neutral"}>
          {clientStatusLabels[c.status] ?? c.status}
        </StatusPill>
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
        <span className="tabular-nums text-navy-500 dark:text-zinc-500">
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
            className="text-sm font-medium text-brand-green transition-colors hover:text-brand-green-dark"
          >
            Editar
          </button>
          <button
            onClick={() => handleDelete(c.id)}
            className="text-sm font-medium text-danger-ink transition-colors hover:opacity-80"
          >
            Eliminar
          </button>
        </div>
      ),
    },
  ];

  return (
    <div data-cli-surface>
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
              setEditingClient(null);
              setShowForm(true);
            }}
          >
            + Nuevo cliente
          </Button>
        }
      />

      {showForm && (
        <ClientForm
          client={editingClient}
          suggestedTags={allTags}
          onCancel={closeForm}
          onSaved={() => {
            closeForm();
            fetchClients();
          }}
        />
      )}

      {clients.length === 0 ? (
        <EmptyState title="Sin clientes todavía" description="Agrega tu primer cliente para empezar" />
      ) : (
        <DataTable<Client>
          columns={columns}
          data={clients}
          rowKey={(c) => c.id}
          onRowClick={(c) => router.push(`/dashboard/clientes/${c.id}`)}
          searchable
          searchPlaceholder="Buscar por nombre, email o empresa..."
          searchFields={(c) => [c.name, c.email ?? "", c.company ?? "", c.phone ?? "", ...(c.tags ?? [])]}
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
            ...(allTags.length > 0
              ? [
                  {
                    /* Tiene que ser el id de la columna: DataTable engancha
                       cada filtro a su columna por esta clave. Con "tag" la
                       tabla avisaba "Column with id 'tag' does not exist" y
                       el filtro no hacía nada. */
                    key: "tags",
                    label: "Etiqueta",
                    options: allTags.map((t) => ({ label: t, value: t })),
                    matches: (c: Client, v: string) => (c.tags ?? []).includes(v),
                  },
                ]
              : []),
          ]}
          initialSort={{ key: "created_at", dir: "desc" }}
          pageSize={25}
          selectable
          bulkActions={[{ label: "Eliminar", variant: "danger", onClick: handleBulkDelete }]}
          exportable
          exportFileName="clientes"
          toggleableColumns
          emptyMessage="Sin resultados. Prueba con otro término."
        />
      )}
    </div>
  );
}
