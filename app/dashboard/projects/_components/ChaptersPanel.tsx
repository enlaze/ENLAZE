"use client";

import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase-browser";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select, Textarea } from "@/components/ui/form-fields";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import EmptyState from "@/components/ui/empty-state";

/* ─── Types ─── */

interface Chapter {
  id: string;
  project_id: string;
  code: string;
  name: string;
  description: string;
  sort_order: number;
}

interface Item {
  id: string;
  chapter_id: string;
  project_id: string;
  code: string;
  name: string;
  description: string;
  unit: string;
  quantity: number;
  unit_price: number;
  executed_qty: number;
  progress_pct: number;
  sort_order: number;
}

const UNITS = [
  { value: "ud", label: "ud" },
  { value: "m2", label: "m²" },
  { value: "m3", label: "m³" },
  { value: "ml", label: "ml" },
  { value: "kg", label: "kg" },
  { value: "h", label: "h" },
  { value: "pa", label: "PA" },
  { value: "%", label: "%" },
  { value: "l", label: "L" },
  { value: "t", label: "t" },
];

const emptyChapter = { code: "", name: "", description: "" };
const emptyItem = {
  code: "", name: "", description: "", unit: "ud",
  quantity: 1, unit_price: 0,
};

function eur(n: number) {
  return Number(n || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

/* ─── Component ─── */

export default function ChaptersPanel({
  projectId,
  userId,
}: {
  projectId: string;
  userId: string;
}) {
  const supabase = createClient();
  const confirm = useConfirm();
  const toast = useToast();

  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  // Chapter form
  const [showChapterForm, setShowChapterForm] = useState(false);
  const [chapterForm, setChapterForm] = useState(emptyChapter);
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);

  // Item form
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [showItemForm, setShowItemForm] = useState(false);
  const [itemForm, setItemForm] = useState(emptyItem);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

  // Expanded chapters
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  async function loadData() {
    const [chapRes, itemRes] = await Promise.all([
      supabase
        .from("project_chapters")
        .select("*")
        .eq("project_id", projectId)
        .order("sort_order", { ascending: true }),
      supabase
        .from("project_items")
        .select("*")
        .eq("project_id", projectId)
        .order("sort_order", { ascending: true }),
    ]);
    setChapters((chapRes.data as Chapter[]) || []);
    setItems((itemRes.data as Item[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, [projectId]);

  // Group items by chapter
  const itemsByChapter = useMemo(() => {
    const map: Record<string, Item[]> = {};
    for (const item of items) {
      if (!map[item.chapter_id]) map[item.chapter_id] = [];
      map[item.chapter_id].push(item);
    }
    return map;
  }, [items]);

  // Totals
  const totalPresupuesto = items.reduce(
    (sum, i) => sum + Number(i.quantity) * Number(i.unit_price),
    0
  );
  const totalEjecutado = items.reduce(
    (sum, i) => sum + Number(i.executed_qty) * Number(i.unit_price),
    0
  );

  function chapterTotal(chId: string) {
    return (itemsByChapter[chId] || []).reduce(
      (sum, i) => sum + Number(i.quantity) * Number(i.unit_price),
      0
    );
  }

  function chapterExecuted(chId: string) {
    return (itemsByChapter[chId] || []).reduce(
      (sum, i) => sum + Number(i.executed_qty) * Number(i.unit_price),
      0
    );
  }

  function chapterProgress(chId: string) {
    const total = chapterTotal(chId);
    if (total === 0) return 0;
    return Math.round((chapterExecuted(chId) / total) * 100);
  }

  function toggleExpand(chId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(chId)) next.delete(chId);
      else next.add(chId);
      return next;
    });
  }

  /* ── Chapter CRUD ── */

  function resetChapterForm() {
    setChapterForm(emptyChapter);
    setEditingChapterId(null);
    setShowChapterForm(false);
  }

  async function handleSaveChapter() {
    if (!chapterForm.name.trim()) {
      toast.error("El nombre del capítulo es obligatorio.");
      return;
    }

    const code = chapterForm.code || `C${String(chapters.length + 1).padStart(2, "0")}`;

    if (editingChapterId) {
      await supabase
        .from("project_chapters")
        .update({
          code,
          name: chapterForm.name.trim(),
          description: chapterForm.description,
          updated_at: new Date().toISOString(),
        })
        .eq("id", editingChapterId);
    } else {
      await supabase.from("project_chapters").insert({
        project_id: projectId,
        user_id: userId,
        code,
        name: chapterForm.name.trim(),
        description: chapterForm.description,
        sort_order: chapters.length,
      });
    }

    resetChapterForm();
    await loadData();
    toast.success(editingChapterId ? "Capítulo actualizado" : "Capítulo creado");
  }

  function startEditChapter(ch: Chapter) {
    setChapterForm({ code: ch.code, name: ch.name, description: ch.description });
    setEditingChapterId(ch.id);
    setShowChapterForm(true);
  }

  async function handleDeleteChapter(id: string) {
    const ok = await confirm({
      title: "Eliminar capítulo",
      description: "Se eliminarán también todas las partidas de este capítulo. ¿Continuar?",
      variant: "danger",
      confirmLabel: "Eliminar",
    });
    if (!ok) return;
    await supabase.from("project_chapters").delete().eq("id", id);
    await loadData();
    toast.success("Capítulo eliminado");
  }

  /* ── Item CRUD ── */

  function resetItemForm() {
    setItemForm(emptyItem);
    setEditingItemId(null);
    setShowItemForm(false);
    setActiveChapterId(null);
  }

  function startAddItem(chapterId: string) {
    resetItemForm();
    setActiveChapterId(chapterId);
    setShowItemForm(true);
    // Auto-expand
    setExpanded((prev) => new Set(prev).add(chapterId));
  }

  function startEditItem(item: Item) {
    setItemForm({
      code: item.code,
      name: item.name,
      description: item.description,
      unit: item.unit,
      quantity: item.quantity,
      unit_price: item.unit_price,
    });
    setEditingItemId(item.id);
    setActiveChapterId(item.chapter_id);
    setShowItemForm(true);
  }

  async function handleSaveItem() {
    if (!activeChapterId) return;
    if (!itemForm.name.trim()) {
      toast.error("El nombre de la partida es obligatorio.");
      return;
    }

    const chapterItems = itemsByChapter[activeChapterId] || [];
    const chapterCode = chapters.find((c) => c.id === activeChapterId)?.code || "C01";
    const code =
      itemForm.code ||
      `${chapterCode}.${String(chapterItems.length + 1).padStart(2, "0")}`;

    if (editingItemId) {
      await supabase
        .from("project_items")
        .update({
          code,
          name: itemForm.name.trim(),
          description: itemForm.description,
          unit: itemForm.unit,
          quantity: Number(itemForm.quantity),
          unit_price: Number(itemForm.unit_price),
          updated_at: new Date().toISOString(),
        })
        .eq("id", editingItemId);
    } else {
      await supabase.from("project_items").insert({
        chapter_id: activeChapterId,
        project_id: projectId,
        user_id: userId,
        code,
        name: itemForm.name.trim(),
        description: itemForm.description,
        unit: itemForm.unit,
        quantity: Number(itemForm.quantity),
        unit_price: Number(itemForm.unit_price),
        sort_order: chapterItems.length,
      });
    }

    resetItemForm();
    await loadData();
    toast.success(editingItemId ? "Partida actualizada" : "Partida creada");
  }

  async function handleDeleteItem(id: string) {
    const ok = await confirm({
      title: "Eliminar partida",
      description: "¿Eliminar esta partida?",
      variant: "danger",
      confirmLabel: "Eliminar",
    });
    if (!ok) return;
    await supabase.from("project_items").delete().eq("id", id);
    await loadData();
    toast.success("Partida eliminada");
  }

  /* ── Render ── */

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl bg-navy-100 dark:bg-zinc-800" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="rounded-xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <p className="text-xs text-navy-500 dark:text-zinc-500 uppercase tracking-wider font-semibold">Capítulos</p>
          <p className="text-2xl font-bold text-navy-900 dark:text-white mt-1">{chapters.length}</p>
        </div>
        <div className="rounded-xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <p className="text-xs text-navy-500 dark:text-zinc-500 uppercase tracking-wider font-semibold">Partidas</p>
          <p className="text-2xl font-bold text-navy-900 dark:text-white mt-1">{items.length}</p>
        </div>
        <div className="rounded-xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <p className="text-xs text-navy-500 dark:text-zinc-500 uppercase tracking-wider font-semibold">Presupuesto</p>
          <p className="text-2xl font-bold text-brand-green mt-1">{eur(totalPresupuesto)}</p>
        </div>
        <div className="rounded-xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <p className="text-xs text-navy-500 dark:text-zinc-500 uppercase tracking-wider font-semibold">Ejecutado</p>
          <p className="text-2xl font-bold text-navy-900 dark:text-white mt-1">{eur(totalEjecutado)}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <Button onClick={() => { resetChapterForm(); setShowChapterForm(true); }}>
          + Capítulo
        </Button>
      </div>

      {/* Chapter form */}
      {showChapterForm && (
        <Card className="border-brand-green/30">
          <div className="border-b border-navy-100 dark:border-zinc-800 pb-3 mb-4">
            <h3 className="text-sm font-semibold text-brand-green uppercase tracking-wider">
              {editingChapterId ? "Editar capítulo" : "Nuevo capítulo"}
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            <FormField label="Código">
              <Input
                type="text"
                value={chapterForm.code}
                onChange={(e) => setChapterForm({ ...chapterForm, code: e.target.value })}
                placeholder="C01"
              />
            </FormField>
            <FormField label="Nombre" required className="md:col-span-3">
              <Input
                type="text"
                value={chapterForm.name}
                onChange={(e) => setChapterForm({ ...chapterForm, name: e.target.value })}
                placeholder="Ej: Albañilería"
              />
            </FormField>
            <FormField label="Descripción" className="md:col-span-4">
              <Input
                type="text"
                value={chapterForm.description}
                onChange={(e) => setChapterForm({ ...chapterForm, description: e.target.value })}
                placeholder="Descripción del capítulo"
              />
            </FormField>
          </div>
          <div className="flex gap-3 pt-3 border-t border-navy-100 dark:border-zinc-800">
            <Button onClick={handleSaveChapter}>
              {editingChapterId ? "Guardar" : "Crear capítulo"}
            </Button>
            <Button variant="secondary" onClick={resetChapterForm}>Cancelar</Button>
          </div>
        </Card>
      )}

      {/* Item form (shown under active chapter) */}
      {showItemForm && activeChapterId && (
        <Card className="border-blue-300/30">
          <div className="border-b border-navy-100 dark:border-zinc-800 pb-3 mb-4">
            <h3 className="text-sm font-semibold text-blue-600 uppercase tracking-wider">
              {editingItemId ? "Editar partida" : "Nueva partida"} —{" "}
              {chapters.find((c) => c.id === activeChapterId)?.name}
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-4 mb-4">
            <FormField label="Código">
              <Input
                type="text"
                value={itemForm.code}
                onChange={(e) => setItemForm({ ...itemForm, code: e.target.value })}
                placeholder="01.01"
              />
            </FormField>
            <FormField label="Nombre" required className="md:col-span-3">
              <Input
                type="text"
                value={itemForm.name}
                onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                placeholder="Ej: Ladrillo hueco doble"
              />
            </FormField>
            <FormField label="Unidad">
              <Select
                value={itemForm.unit}
                onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })}
              >
                {UNITS.map((u) => (
                  <option key={u.value} value={u.value}>{u.label}</option>
                ))}
              </Select>
            </FormField>
            <FormField label="Cantidad">
              <Input
                type="number"
                min="0"
                step="0.001"
                value={itemForm.quantity}
                onChange={(e) => setItemForm({ ...itemForm, quantity: Number(e.target.value) || 0 })}
              />
            </FormField>
            <FormField label="Precio unitario (€)">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={itemForm.unit_price}
                onChange={(e) => setItemForm({ ...itemForm, unit_price: Number(e.target.value) || 0 })}
              />
            </FormField>
            <FormField label="Importe" className="flex items-end">
              <p className="text-lg font-bold text-navy-900 dark:text-white py-2">
                {eur(Number(itemForm.quantity) * Number(itemForm.unit_price))}
              </p>
            </FormField>
            <FormField label="Descripción" className="md:col-span-4">
              <Input
                type="text"
                value={itemForm.description}
                onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })}
                placeholder="Descripción de la partida"
              />
            </FormField>
          </div>
          <div className="flex gap-3 pt-3 border-t border-navy-100 dark:border-zinc-800">
            <Button onClick={handleSaveItem}>
              {editingItemId ? "Guardar" : "Crear partida"}
            </Button>
            <Button variant="secondary" onClick={resetItemForm}>Cancelar</Button>
          </div>
        </Card>
      )}

      {/* Chapters list */}
      {chapters.length === 0 ? (
        <EmptyState
          title="Sin capítulos"
          description="Crea el primer capítulo para empezar a desglosar el presupuesto de esta obra."
          action={
            <Button onClick={() => { resetChapterForm(); setShowChapterForm(true); }}>
              + Crear capítulo
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {chapters.map((ch) => {
            const isExpanded = expanded.has(ch.id);
            const chItems = itemsByChapter[ch.id] || [];
            const total = chapterTotal(ch.id);
            const pct = chapterProgress(ch.id);

            return (
              <div
                key={ch.id}
                className="rounded-2xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden"
              >
                {/* Chapter header */}
                <button
                  type="button"
                  onClick={() => toggleExpand(ch.id)}
                  className="w-full flex items-center gap-4 px-5 py-4 hover:bg-navy-50 dark:hover:bg-zinc-800/50 transition-colors text-left"
                >
                  <svg
                    className={`h-4 w-4 text-navy-400 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                  <span className="text-xs font-mono text-navy-400 dark:text-zinc-500 min-w-[3rem]">
                    {ch.code}
                  </span>
                  <span className="flex-1 text-sm font-semibold text-navy-900 dark:text-white">
                    {ch.name}
                  </span>
                  <span className="text-xs text-navy-500 dark:text-zinc-400">
                    {chItems.length} partida{chItems.length !== 1 ? "s" : ""}
                  </span>

                  {/* Mini progress bar */}
                  <div className="w-20 h-1.5 rounded-full bg-navy-100 dark:bg-zinc-700 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-brand-green transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs text-navy-500 dark:text-zinc-400 w-10 text-right">
                    {pct}%
                  </span>

                  <span className="text-sm font-semibold text-navy-900 dark:text-white min-w-[6rem] text-right">
                    {eur(total)}
                  </span>
                </button>

                {/* Expanded: items table */}
                {isExpanded && (
                  <div className="border-t border-navy-50 dark:border-zinc-800">
                    {chItems.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-navy-50/50 dark:bg-zinc-800/30">
                              <th className="text-left text-[10px] font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider px-5 py-2">Código</th>
                              <th className="text-left text-[10px] font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider px-3 py-2">Partida</th>
                              <th className="text-center text-[10px] font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider px-3 py-2">Ud</th>
                              <th className="text-right text-[10px] font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider px-3 py-2">Cantidad</th>
                              <th className="text-right text-[10px] font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider px-3 py-2">P. Unit.</th>
                              <th className="text-right text-[10px] font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider px-3 py-2">Importe</th>
                              <th className="text-center text-[10px] font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider px-3 py-2">Avance</th>
                              <th className="text-right text-[10px] font-semibold text-navy-500 dark:text-zinc-500 uppercase tracking-wider px-5 py-2">Acciones</th>
                            </tr>
                          </thead>
                          <tbody>
                            {chItems.map((item) => (
                              <tr key={item.id} className="border-t border-navy-50 dark:border-zinc-800 hover:bg-navy-50/50 dark:hover:bg-zinc-800/30">
                                <td className="px-5 py-2.5 text-xs font-mono text-navy-400">{item.code}</td>
                                <td className="px-3 py-2.5">
                                  <p className="text-sm text-navy-900 dark:text-white">{item.name}</p>
                                  {item.description && (
                                    <p className="text-xs text-navy-500 dark:text-zinc-500 mt-0.5">{item.description}</p>
                                  )}
                                </td>
                                <td className="px-3 py-2.5 text-center text-xs text-navy-500">{item.unit}</td>
                                <td className="px-3 py-2.5 text-right text-sm">{Number(item.quantity).toLocaleString("es-ES", { maximumFractionDigits: 3 })}</td>
                                <td className="px-3 py-2.5 text-right text-sm">{eur(item.unit_price)}</td>
                                <td className="px-3 py-2.5 text-right text-sm font-semibold">{eur(Number(item.quantity) * Number(item.unit_price))}</td>
                                <td className="px-3 py-2.5 text-center">
                                  <div className="flex items-center justify-center gap-1.5">
                                    <div className="w-12 h-1.5 rounded-full bg-navy-100 dark:bg-zinc-700 overflow-hidden">
                                      <div
                                        className="h-full rounded-full bg-brand-green"
                                        style={{ width: `${item.progress_pct}%` }}
                                      />
                                    </div>
                                    <span className="text-[10px] text-navy-500">{item.progress_pct}%</span>
                                  </div>
                                </td>
                                <td className="px-5 py-2.5 text-right space-x-2">
                                  <button
                                    onClick={() => startEditItem(item)}
                                    className="text-xs text-brand-green hover:underline"
                                  >
                                    Editar
                                  </button>
                                  <button
                                    onClick={() => handleDeleteItem(item.id)}
                                    className="text-xs text-red-600 hover:underline"
                                  >
                                    Eliminar
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t border-navy-100 dark:border-zinc-700 bg-navy-50/50 dark:bg-zinc-800/30">
                              <td colSpan={5} className="px-5 py-2 text-xs font-semibold text-navy-500 uppercase">
                                Total {ch.name}
                              </td>
                              <td className="px-3 py-2 text-right text-sm font-bold text-navy-900 dark:text-white">
                                {eur(total)}
                              </td>
                              <td colSpan={2} />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}

                    {/* Chapter actions */}
                    <div className="flex items-center gap-3 px-5 py-3 border-t border-navy-50 dark:border-zinc-800 bg-navy-50/30 dark:bg-zinc-800/20">
                      <Button size="sm" onClick={() => startAddItem(ch.id)}>
                        + Partida
                      </Button>
                      <button
                        onClick={() => startEditChapter(ch)}
                        className="text-xs text-brand-green hover:underline"
                      >
                        Editar capítulo
                      </button>
                      <button
                        onClick={() => handleDeleteChapter(ch.id)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Eliminar capítulo
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Grand total */}
          <div className="rounded-2xl border-2 border-brand-green/30 bg-brand-green/5 dark:bg-brand-green/10 p-5 flex items-center justify-between">
            <span className="text-sm font-semibold text-navy-900 dark:text-white uppercase tracking-wider">
              Total presupuesto de obra
            </span>
            <span className="text-xl font-bold text-brand-green">{eur(totalPresupuesto)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
