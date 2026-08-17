"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import PageHeader from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Badge from "@/components/ui/badge";
import EmptyState from "@/components/ui/empty-state";
import Loading from "@/components/ui/loading";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";

type TrashEntityType =
  | "budget"
  | "project"
  | "invoice"
  | "issued_invoice"
  | "received_invoice";

interface TrashItem {
  entity_type: TrashEntityType;
  entity_id: string;
  title: string;
  subtitle: string | null;
  amount: number | null;
  deleted_at: string;
}

const entityMeta: Record<
  TrashEntityType,
  { singular: string; plural: string; variant: "blue" | "green" | "purple" | "orange" }
> = {
  budget: { singular: "Presupuesto", plural: "Presupuestos", variant: "blue" },
  project: { singular: "Obra", plural: "Obras", variant: "green" },
  invoice: { singular: "Factura", plural: "Facturas", variant: "orange" },
  issued_invoice: {
    singular: "Factura emitida",
    plural: "Facturas emitidas",
    variant: "purple",
  },
  received_invoice: {
    singular: "Factura recibida",
    plural: "Facturas recibidas",
    variant: "orange",
  },
};

function formatAmount(value: number | null) {
  if (value == null) return null;
  return Number(value).toLocaleString("es-ES", {
    style: "currency",
    currency: "EUR",
  });
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-10 w-10 text-navy-300 dark:text-zinc-600"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 7h16" />
      <path d="M9 3h6l1 4H8l1-4Z" />
      <path d="m6 7 1 14h10l1-14" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

export default function TrashPage() {
  const supabase = createClient();
  const confirm = useConfirm();
  const toast = useToast();
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  async function loadTrash() {
    setLoading(true);
    const { data, error } = await supabase.rpc("list_trash_items");

    if (error) {
      console.error("[trash] No se pudo cargar la papelera", error);
      toast.error("No se pudo cargar la papelera");
      setItems([]);
    } else {
      setItems((data || []) as TrashItem[]);
    }
    setSelectedKeys(new Set());
    setLoading(false);
  }

  useEffect(() => {
    loadTrash();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function restoreItem(item: TrashItem) {
    const meta = entityMeta[item.entity_type];
    const ok = await confirm({
      title: `Restaurar ${meta.singular.toLowerCase()}`,
      description: `"${item.title}" volverá a aparecer en su sección original.`,
      confirmLabel: "Restaurar",
      variant: "default",
    });
    if (!ok) return;

    setRestoringId(item.entity_id);
    try {
      const { data, error } = await supabase.rpc("restore_trash_item", {
        p_entity_type: item.entity_type,
        p_entity_id: item.entity_id,
      });
      if (error) throw error;
      if (!data) throw new Error("No se encontró el elemento");

      setItems((current) =>
        current.filter(
          (entry) =>
            !(
              entry.entity_type === item.entity_type &&
              entry.entity_id === item.entity_id
            )
        )
      );
      setSelectedKeys((current) => {
        const next = new Set(current);
        next.delete(`${item.entity_type}:${item.entity_id}`);
        return next;
      });
      toast.success(`${meta.singular} restaurado correctamente`);
    } catch (error) {
      console.error("[trash] Error al restaurar", error);
      toast.error(`No se pudo restaurar ${meta.singular.toLowerCase()}`);
    } finally {
      setRestoringId(null);
    }
  }

  const trashKey = (item: TrashItem) =>
    `${item.entity_type}:${item.entity_id}`;
  const canDeletePermanently = (item: TrashItem) =>
    item.entity_type === "budget" || item.entity_type === "project";
  const deletableItems = items.filter(canDeletePermanently);
  const selectedItems = deletableItems.filter((item) =>
    selectedKeys.has(trashKey(item))
  );
  const allDeletableSelected =
    deletableItems.length > 0 &&
    deletableItems.every((item) => selectedKeys.has(trashKey(item)));

  function toggleItem(item: TrashItem) {
    if (!canDeletePermanently(item)) return;
    const key = trashKey(item);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (allDeletableSelected) {
        deletableItems.forEach((item) => next.delete(trashKey(item)));
      } else {
        deletableItems.forEach((item) => next.add(trashKey(item)));
      }
      return next;
    });
  }

  async function permanentlyDeleteSelected() {
    if (selectedItems.length === 0) return;

    const ok = await confirm({
      title: `Eliminar definitivamente ${selectedItems.length} elemento${
        selectedItems.length === 1 ? "" : "s"
      }`,
      description:
        "Esta acción eliminará los presupuestos u obras seleccionados y sus datos relacionados. No se podrán recuperar.",
      confirmLabel: "Eliminar definitivamente",
      variant: "danger",
      requireText: "ELIMINAR",
      details: (
        <p className="text-xs text-red-600 dark:text-red-400">
          Las facturas no se incluyen porque están protegidas por conservación fiscal.
        </p>
      ),
    });
    if (!ok) return;

    setDeleting(true);
    try {
      const { data, error } = await supabase.rpc(
        "permanently_delete_trash_items",
        {
          p_items: selectedItems.map((item) => ({
            entity_type: item.entity_type,
            entity_id: item.entity_id,
          })),
          p_confirmation: "ELIMINAR",
        }
      );
      if (error) throw error;

      const deletedCount = Number(data || 0);
      await loadTrash();
      toast.success(
        `${deletedCount} elemento${deletedCount === 1 ? "" : "s"} eliminado${
          deletedCount === 1 ? "" : "s"
        } definitivamente`
      );
    } catch (error) {
      console.error("[trash] Error en el borrado definitivo", error);
      toast.error("No se pudieron eliminar los elementos seleccionados");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Papelera"
        description="Recupera presupuestos, facturas u obras eliminados por error. Sus datos relacionados también se conservan."
        count={items.length}
        countLabel={`elemento${items.length === 1 ? "" : "s"}`}
        actions={
          items.length > 0 ? (
            <div className="flex flex-wrap items-center justify-end gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-navy-600 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={allDeletableSelected}
                  disabled={deletableItems.length === 0 || deleting}
                  onChange={toggleAll}
                  className="h-4 w-4 rounded border-navy-300 accent-emerald-500"
                />
                Seleccionar todo
              </label>
              <Button
                variant="danger"
                size="sm"
                loading={deleting}
                disabled={selectedItems.length === 0}
                onClick={permanentlyDeleteSelected}
              >
                Eliminar seleccionados
                {selectedItems.length > 0 ? ` (${selectedItems.length})` : ""}
              </Button>
            </div>
          ) : undefined
        }
      />

      {loading ? (
        <Loading />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<TrashIcon />}
          title="La papelera está vacía"
          description="Los presupuestos, facturas y obras que elimines aparecerán aquí y podrás restaurarlos."
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const meta = entityMeta[item.entity_type];
            const amount = formatAmount(item.amount);
            return (
              <Card
                key={`${item.entity_type}-${item.entity_id}`}
                className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedKeys.has(trashKey(item))}
                    disabled={!canDeletePermanently(item) || deleting}
                    onChange={() => toggleItem(item)}
                    aria-label={`Seleccionar ${meta.singular.toLowerCase()} ${item.title}`}
                    title={
                      canDeletePermanently(item)
                        ? "Seleccionar para eliminar definitivamente"
                        : "Protegido por conservación fiscal"
                    }
                    className="mt-1 h-4 w-4 shrink-0 rounded border-navy-300 accent-emerald-500"
                  />
                  <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={meta.variant}>{meta.singular}</Badge>
                    {!canDeletePermanently(item) && (
                      <Badge variant="gray">Conservación fiscal</Badge>
                    )}
                    <span className="text-xs text-navy-400 dark:text-zinc-500">
                      Eliminado el{" "}
                      {new Date(item.deleted_at).toLocaleString("es-ES", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>
                  <h2 className="mt-2 truncate text-sm font-semibold text-navy-900 dark:text-white">
                    {item.title}
                  </h2>
                  {(item.subtitle || amount) && (
                    <p className="mt-1 text-xs text-navy-500 dark:text-zinc-400">
                      {[item.subtitle, amount].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
                </div>

                <Button
                  variant="secondary"
                  size="sm"
                  loading={restoringId === item.entity_id}
                  disabled={restoringId !== null || deleting}
                  onClick={() => restoreItem(item)}
                >
                  Restaurar
                </Button>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
