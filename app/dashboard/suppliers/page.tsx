"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useSector } from "@/lib/sector-context";
import Link from "next/link";
import PageHeader from "@/components/ui/page-header";
import { Card, StatCard } from "@/components/ui/card";
import { FormField, Input, Select } from "@/components/ui/form-fields";
import { Button } from "@/components/ui/button";
import Badge from "@/components/ui/badge";
import EmptyState from "@/components/ui/empty-state";
import Loading from "@/components/ui/loading";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import DataTable, { type Column, type FilterDef } from "@/components/ui/data-table";

interface Supplier {
  id: string;
  user_id: string;
  name: string;
  nif: string;
  email: string;
  phone: string;
  address: string;
  contact_person: string;
  trade: string;
  specialty: string;
  type: string;
  hourly_rate: number;
  notes: string;
  status: string;
  rating: number;
  total_invoiced: number;
  total_paid: number;
  created_at: string;
}

/* Default trade options (used as fallback when sector config not loaded) */
const defaultTradeOptions = [
  "Albañilería","Fontanería","Electricidad","Pintura","Carpintería",
  "Climatización","Cerrajería","Cristalería","Impermeabilización",
  "Demolición","Estructuras","Escayola / Pladur","Solados y alicatados",
  "Material de construcción","Ferretería","Contenedores / residuos",
  "Transporte","Maquinaria","Seguridad y PRL","General",
];

const typeOptions = [
  { value: "proveedor", label: "Proveedor" },
  { value: "subcontrata", label: "Subcontrata" },
];

const emptyForm = {
  name: "", nif: "", email: "", phone: "", address: "",
  contact_person: "", trade: "general", specialty: "",
  type: "proveedor", hourly_rate: 0, notes: "", status: "active",
  rating: 0,
};

export default function SuppliersPage() {
  const supabase = createClient();
  const { label, options } = useSector();
  const confirm = useConfirm();
  const toast = useToast();

  const [userId, setUserId] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  // Dynamic trade/specialty options from sector config
  const sectorTrades = options("trades");
  const sectorSpecialties = options("specialties");
  const sectorCategories = options("categories");
  const dynamicOptions = sectorTrades.length > 0 ? sectorTrades : sectorSpecialties.length > 0 ? sectorSpecialties : sectorCategories.length > 0 ? sectorCategories : defaultTradeOptions;
  const tradeOptions = dynamicOptions.map(t => ({ value: t.toLowerCase().replace(/[\s/]+/g, "_"), label: t }));
  const tradeMap = Object.fromEntries(tradeOptions.map(t => [t.value, t.label]));

  async function loadSuppliers() {
    const { data } = await supabase.from("suppliers").select("*").order("name");
    setSuppliers(data || []);
  }

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setUserId(user.id);
      await loadSuppliers();
      setLoading(false);
    }
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function resetForm() {
    setForm(emptyForm); setEditingId(null); setShowForm(false);
  }

  function startEdit(s: Supplier) {
    setForm({
      name: s.name, nif: s.nif || "", email: s.email || "", phone: s.phone || "",
      address: s.address || "", contact_person: s.contact_person || "",
      trade: s.trade || "general", specialty: s.specialty || "",
      type: s.type || "proveedor", hourly_rate: Number(s.hourly_rate || 0),
      notes: s.notes || "", status: s.status || "active", rating: s.rating || 0,
    });
    setEditingId(s.id); setShowForm(true);
  }

  async function handleSave() {
    if (!userId) return;
    if (!form.name.trim()) { alert("El nombre es obligatorio."); return; }

    const payload = {
      user_id: userId, name: form.name.trim(), nif: form.nif, email: form.email,
      phone: form.phone, address: form.address, contact_person: form.contact_person,
      trade: form.trade, specialty: form.specialty, type: form.type,
      hourly_rate: form.hourly_rate, notes: form.notes, status: form.status,
      rating: form.rating, updated_at: new Date().toISOString(),
    };

    if (editingId) {
      await supabase.from("suppliers").update(payload).eq("id", editingId);
    } else {
      await supabase.from("suppliers").insert(payload);
    }
    resetForm(); await loadSuppliers();
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: "Eliminar proveedor",
      description: "¿Eliminar este proveedor/subcontrata?",
      variant: "danger",
      confirmLabel: "Eliminar",
    });
    if (!ok) return;
    try {
      await supabase.from("suppliers").delete().eq("id", id);
      await loadSuppliers();
      toast.success("Proveedor eliminado");
    } catch (error) {
      toast.error("Error al eliminar el proveedor");
    }
  }

  const totalProveedores = suppliers.filter((s) => s.type === "proveedor").length;
  const totalSubcontratas = suppliers.filter((s) => s.type === "subcontrata").length;

  const fmtMoney = (n: number) =>
    new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n || 0);

  const columns: Column<Supplier>[] = [
    {
      key: "name",
      header: "Nombre",
      sortable: true,
      alwaysVisible: true,
      exportValue: (s) => s.name,
      render: (s) => (
        <div>
          <p className="text-sm font-medium text-navy-900 dark:text-white">{s.name}</p>
          {s.nif && <p className="text-xs text-navy-600 dark:text-zinc-400">{s.nif}</p>}
          {s.specialty && <p className="text-xs text-navy-500 dark:text-zinc-500">{s.specialty}</p>}
        </div>
      ),
    },
    {
      key: "type",
      header: "Tipo",
      align: "center",
      sortable: true,
      exportValue: (s) => s.type,
      render: (s) =>
        s.type === "subcontrata" ? (
          <Badge variant="orange">Subcontrata</Badge>
        ) : (
          <Badge variant="blue">Proveedor</Badge>
        ),
    },
    {
      key: "trade",
      header: "Oficio",
      align: "center",
      hidden: "hidden md:table-cell",
      sortable: true,
      exportValue: (s) => tradeMap[s.trade] || s.trade,
      render: (s) => (
        <span className="text-xs text-navy-600 dark:text-zinc-400">
          {tradeMap[s.trade] || s.trade}
        </span>
      ),
    },
    {
      key: "contact",
      header: "Contacto",
      hidden: "hidden lg:table-cell",
      exportValue: (s) => [s.contact_person, s.phone, s.email].filter(Boolean).join(" · "),
      render: (s) => (
        <div>
          {s.contact_person && <p className="text-sm text-navy-800 dark:text-zinc-200">{s.contact_person}</p>}
          {s.phone && <p className="text-xs text-navy-600 dark:text-zinc-400">{s.phone}</p>}
          {s.email && <p className="text-xs text-navy-600 dark:text-zinc-400">{s.email}</p>}
        </div>
      ),
    },
    {
      key: "hourly_rate",
      header: "€/h",
      align: "center",
      sortable: true,
      hidden: "hidden sm:table-cell",
      exportValue: (s) => Number(s.hourly_rate || 0),
      render: (s) => (
        <span className="text-sm text-navy-700 dark:text-zinc-300">
          {Number(s.hourly_rate || 0) > 0 ? `${Number(s.hourly_rate).toFixed(0)}€` : "—"}
        </span>
      ),
    },
    {
      key: "total_invoiced",
      header: "Facturado",
      align: "right",
      sortable: true,
      hidden: "hidden md:table-cell",
      exportValue: (s) => Number(s.total_invoiced || 0),
      render: (s) => (
        <div>
          <p className="text-sm font-medium text-navy-900 dark:text-white">
            {fmtMoney(Number(s.total_invoiced || 0))}
          </p>
          {Number(s.total_invoiced || 0) > Number(s.total_paid || 0) && (
            <p className="text-xs text-orange-600">
              Pdte: {fmtMoney(Number(s.total_invoiced || 0) - Number(s.total_paid || 0))}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "rating",
      header: "Valoración",
      align: "center",
      sortable: true,
      defaultHidden: true,
      exportValue: (s) => s.rating,
      render: (s) =>
        s.rating > 0 ? (
          <span className="text-sm text-yellow-600">
            {"★".repeat(s.rating)}
            {"☆".repeat(5 - s.rating)}
          </span>
        ) : (
          <span className="text-xs text-navy-400 dark:text-zinc-500">—</span>
        ),
    },
    {
      key: "actions",
      header: "Acciones",
      align: "right",
      alwaysVisible: true,
      render: (s) => (
        <div className="space-x-3" onClick={(e) => e.stopPropagation()}>
          <Link
            href={`/dashboard/suppliers/${s.id}`}
            className="text-xs text-brand-green hover:underline"
          >
            Ver
          </Link>
          <button
            onClick={() => startEdit(s)}
            className="text-xs text-navy-600 dark:text-zinc-400 hover:underline"
          >
            Editar
          </button>
          <button
            onClick={() => handleDelete(s.id)}
            className="text-xs text-red-600 hover:underline"
          >
            Eliminar
          </button>
        </div>
      ),
    },
  ];

  const filters: FilterDef<Supplier>[] = [
    {
      key: "type",
      label: "Tipo",
      options: [
        { label: "Proveedores", value: "proveedor" },
        { label: "Subcontratas", value: "subcontrata" },
      ],
      matches: (s, v) => s.type === v,
    },
    {
      key: "trade",
      label: "Oficio",
      options: tradeOptions.map((t) => ({ label: t.label, value: t.value })),
      matches: (s, v) => s.trade === v,
    },
  ];

  if (loading) {
    return <Loading />;
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <PageHeader
        title={label("suppliers")}
        description="Gestiona tu red de proveedores, subcontratas y oficios"
        actions={
          <Button onClick={() => { resetForm(); setShowForm(true); }}>
            + Nuevo proveedor
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard label="Total" value={suppliers.length} accent="blue" />
        <StatCard label={label("suppliers")} value={totalProveedores} accent="green" />
        <StatCard label="Subcontratas" value={totalSubcontratas} accent="yellow" />
      </div>

      {/* Form */}
      {showForm && (
        <Card className="mb-6">
          <div className="p-5">
            <h3 className="text-sm font-semibold text-brand-green uppercase tracking-wider mb-4">
              {editingId ? "Editar proveedor" : "Nuevo proveedor / subcontrata"}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <FormField label="Nombre / Razón social *">
                  <Input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Ej: Fontanería García S.L."
                  />
                </FormField>
              </div>
              <div>
                <FormField label="Tipo">
                  <Select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                  >
                    {typeOptions.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </Select>
                </FormField>
              </div>
              <div>
                <FormField label="NIF / CIF">
                  <Input
                    type="text"
                    value={form.nif}
                    onChange={(e) => setForm({ ...form, nif: e.target.value })}
                    placeholder="B12345678"
                  />
                </FormField>
              </div>
              <div>
                <FormField label="Persona de contacto">
                  <Input
                    type="text"
                    value={form.contact_person}
                    onChange={(e) => setForm({ ...form, contact_person: e.target.value })}
                    placeholder="Nombre del contacto"
                  />
                </FormField>
              </div>
              <div>
                <FormField label="Teléfono">
                  <Input
                    type="text"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="600 000 000"
                  />
                </FormField>
              </div>
              <div>
                <FormField label="Email">
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="email@empresa.com"
                  />
                </FormField>
              </div>
              <div>
                <FormField label="Oficio">
                  <Select
                    value={form.trade}
                    onChange={(e) => setForm({ ...form, trade: e.target.value })}
                  >
                    {tradeOptions.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </Select>
                </FormField>
              </div>
              <div>
                <FormField label="Precio/hora (€)">
                  <Input
                    type="number"
                    min="0"
                    step="0.5"
                    value={form.hourly_rate || ""}
                    onChange={(e) => setForm({ ...form, hourly_rate: parseFloat(e.target.value) || 0 })}
                    placeholder="0.00"
                  />
                </FormField>
              </div>
              <div className="md:col-span-3">
                <FormField label="Dirección">
                  <Input
                    type="text"
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    placeholder="Dirección completa"
                  />
                </FormField>
              </div>
              <div className="md:col-span-2">
                <FormField label="Especialidad">
                  <Input
                    type="text"
                    value={form.specialty}
                    onChange={(e) => setForm({ ...form, specialty: e.target.value })}
                    placeholder="Ej: Reformas de baño, Instalación solar..."
                  />
                </FormField>
              </div>
              <div>
                <FormField label="Valoración (1-5)">
                  <Input
                    type="number"
                    min="0"
                    max="5"
                    value={form.rating || ""}
                    onChange={(e) => setForm({ ...form, rating: parseInt(e.target.value) || 0 })}
                    placeholder="0"
                  />
                </FormField>
              </div>
              <div className="md:col-span-3">
                <FormField label="Notas">
                  <textarea
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    className="w-full rounded-xl border border-navy-200 dark:border-zinc-800 bg-navy-50 dark:bg-zinc-900/60 px-4 py-2.5 text-sm text-navy-900 dark:text-white placeholder:text-navy-400 focus:border-brand-green/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-green/20 transition-colors min-h-[80px]"
                    placeholder="Observaciones, condiciones, plazos..."
                  />
                </FormField>
              </div>
            </div>
            <div className="flex gap-3 mt-4">
              <Button onClick={handleSave}>
                {editingId ? "Guardar cambios" : "Crear proveedor"}
              </Button>
              <Button variant="secondary" onClick={resetForm}>
                Cancelar
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Table */}
      {suppliers.length === 0 ? (
        <EmptyState
          title="Sin proveedores todavía"
          description="Pulsa 'Nuevo proveedor' para empezar."
        />
      ) : (
        <DataTable<Supplier>
          columns={columns}
          data={suppliers}
          rowKey={(s) => s.id}
          searchable
          searchPlaceholder="Buscar por nombre, NIF, contacto, especialidad..."
          searchFields={(s) => [s.name, s.nif, s.contact_person, s.specialty, s.email, s.phone]}
          filters={filters}
          initialSort={{ key: "name", dir: "asc" }}
          pageSize={25}
          exportable
          exportFileName="proveedores"
          toggleableColumns
          emptyMessage="Sin resultados. Prueba con otro término."
        />
      )}
    </div>
  );
}
