"use client";

import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase-browser";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select } from "@/components/ui/form-fields";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import EmptyState from "@/components/ui/empty-state";

/* ─── Types ─── */

interface Chapter {
  id: string;
  code: string;
  name: string;
}

interface Item {
  id: string;
  chapter_id: string;
  code: string;
  name: string;
  unit: string;
  quantity: number;
  unit_price: number;
  executed_qty: number;
  progress_pct: number;
}

interface Certification {
  id: string;
  project_id: string;
  cert_number: number;
  period: string;
  cert_date: string;
  notes: string;
  status: string;
  created_at: string;
}

interface CertLine {
  id: string;
  certification_id: string;
  item_id: string;
  prev_qty: number;
  current_qty: number;
  unit_price: number;
}

function eur(n: number) {
  return Number(n || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

const certStatusMap: Record<string, { label: string; color: string }> = {
  draft: { label: "Borrador", color: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  sent: { label: "Enviada", color: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
  approved: { label: "Aprobada", color: "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300" },
  paid: { label: "Cobrada", color: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
};

/* ─── Component ─── */

export default function ProgressPanel({
  projectId,
  userId,
  budgetAmount,
}: {
  projectId: string;
  userId: string;
  budgetAmount: number;
}) {
  const supabase = createClient();
  const confirm = useConfirm();
  const toast = useToast();

  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [certifications, setCertifications] = useState<Certification[]>([]);
  const [certLines, setCertLines] = useState<CertLine[]>([]);
  const [loading, setLoading] = useState(true);

  // Progress editing
  const [editingProgress, setEditingProgress] = useState(false);
  const [progressEdits, setProgressEdits] = useState<Record<string, { qty: number; pct: number }>>({});

  // Certification form
  const [showCertForm, setShowCertForm] = useState(false);
  const [certForm, setCertForm] = useState({
    period: new Date().toISOString().slice(0, 7),
    cert_date: new Date().toISOString().split("T")[0],
    notes: "",
  });

  async function loadData() {
    const [chRes, itemRes, certRes, lineRes] = await Promise.all([
      supabase.from("project_chapters").select("id, code, name")
        .eq("project_id", projectId).order("sort_order"),
      supabase.from("project_items").select("id, chapter_id, code, name, unit, quantity, unit_price, executed_qty, progress_pct")
        .eq("project_id", projectId).order("sort_order"),
      supabase.from("project_certifications").select("*")
        .eq("project_id", projectId).order("cert_number", { ascending: false }),
      supabase.from("project_certification_lines").select("*")
        .in("certification_id",
          (await supabase.from("project_certifications").select("id").eq("project_id", projectId))
            .data?.map((c: { id: string }) => c.id) || []
        ),
    ]);

    setChapters((chRes.data as Chapter[]) || []);
    setItems((itemRes.data as Item[]) || []);
    setCertifications((certRes.data as Certification[]) || []);
    setCertLines((lineRes.data as CertLine[]) || []);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, [projectId]);

  // Group items by chapter
  const itemsByChapter = useMemo(() => {
    const map: Record<string, Item[]> = {};
    for (const item of items) {
      if (!map[item.chapter_id]) map[item.chapter_id] = [];
      map[item.chapter_id].push(item);
    }
    return map;
  }, [items]);

  // KPIs
  const totalPresupuesto = items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0);
  const totalEjecutado = items.reduce((s, i) => s + Number(i.executed_qty) * Number(i.unit_price), 0);
  const globalProgress = totalPresupuesto > 0 ? Math.round((totalEjecutado / totalPresupuesto) * 100) : 0;
  const desviacion = totalEjecutado - (budgetAmount > 0 ? (budgetAmount * globalProgress / 100) : totalEjecutado);

  /* ── Progress editing ── */

  function startEditProgress() {
    const edits: Record<string, { qty: number; pct: number }> = {};
    for (const item of items) {
      edits[item.id] = { qty: Number(item.executed_qty), pct: item.progress_pct };
    }
    setProgressEdits(edits);
    setEditingProgress(true);
  }

  function updateItemProgress(itemId: string, field: "qty" | "pct", value: number) {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;

    setProgressEdits((prev) => {
      const edit = { ...prev[itemId] };
      if (field === "qty") {
        edit.qty = value;
        edit.pct = Number(item.quantity) > 0 ? Math.min(100, Math.round((value / Number(item.quantity)) * 100)) : 0;
      } else {
        edit.pct = Math.min(100, Math.max(0, value));
        edit.qty = Number(item.quantity) * edit.pct / 100;
      }
      return { ...prev, [itemId]: edit };
    });
  }

  async function saveProgress() {
    const updates = Object.entries(progressEdits).map(([id, edit]) =>
      supabase.from("project_items").update({
        executed_qty: edit.qty,
        progress_pct: edit.pct,
        updated_at: new Date().toISOString(),
      }).eq("id", id)
    );
    await Promise.all(updates);
    setEditingProgress(false);
    await loadData();
    toast.success("Avance actualizado");
  }

  /* ── Certification CRUD ── */

  async function handleCreateCert() {
    if (!certForm.period) { toast.error("Indica el periodo."); return; }

    const certNumber = certifications.length + 1;
    const { data: newCert, error } = await supabase.from("project_certifications").insert({
      project_id: projectId,
      user_id: userId,
      cert_number: certNumber,
      period: certForm.period,
      cert_date: certForm.cert_date,
      notes: certForm.notes,
      status: "draft",
    }).select("id").single();

    if (error || !newCert) {
      toast.error("Error al crear certificación");
      return;
    }

    // Create lines from current item progress
    const lines = items.map((item) => {
      // Previous qty = sum of all cert lines for this item in prior certs
      const prevLines = certLines.filter((cl) => cl.item_id === item.id);
      const prevQty = prevLines.reduce((s, cl) => s + Number(cl.current_qty), 0);
      const currentQty = Math.max(0, Number(item.executed_qty) - prevQty);

      return {
        certification_id: newCert.id,
        item_id: item.id,
        prev_qty: prevQty,
        current_qty: currentQty,
        unit_price: Number(item.unit_price),
      };
    }).filter((l) => l.current_qty > 0);

    if (lines.length > 0) {
      await supabase.from("project_certification_lines").insert(lines);
    }

    setShowCertForm(false);
    setCertForm({
      period: new Date().toISOString().slice(0, 7),
      cert_date: new Date().toISOString().split("T")[0],
      notes: "",
    });
    await loadData();
    toast.success(`Certificación #${certNumber} creada con ${lines.length} partidas`);
  }

  async function handleDeleteCert(id: string) {
    const ok = await confirm({
      title: "Eliminar certificación",
      description: "Se eliminarán las líneas asociadas. ¿Continuar?",
      variant: "danger",
      confirmLabel: "Eliminar",
    });
    if (!ok) return;
    await supabase.from("project_certifications").delete().eq("id", id);
    await loadData();
    toast.success("Certificación eliminada");
  }

  async function updateCertStatus(id: string, status: string) {
    await supabase.from("project_certifications").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
    await loadData();
    toast.success("Estado actualizado");
  }

  // Cert totals
  function certTotal(certId: string) {
    return certLines
      .filter((cl) => cl.certification_id === certId)
      .reduce((s, cl) => s + Number(cl.current_qty) * Number(cl.unit_price), 0);
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

  if (items.length === 0) {
    return (
      <EmptyState
        title="Sin partidas"
        description="Primero crea capítulos y partidas en la pestaña de Presupuesto para poder controlar el avance."
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="rounded-xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <p className="text-xs text-navy-500 dark:text-zinc-500 uppercase tracking-wider font-semibold">Avance global</p>
          <div className="flex items-center gap-3 mt-2">
            <div className="flex-1 h-2.5 rounded-full bg-navy-100 dark:bg-zinc-700 overflow-hidden">
              <div className="h-full rounded-full bg-brand-green transition-all" style={{ width: `${globalProgress}%` }} />
            </div>
            <span className="text-lg font-bold text-brand-green">{globalProgress}%</span>
          </div>
        </div>
        <div className="rounded-xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <p className="text-xs text-navy-500 dark:text-zinc-500 uppercase tracking-wider font-semibold">Presupuestado</p>
          <p className="text-2xl font-bold text-navy-900 dark:text-white mt-1">{eur(totalPresupuesto)}</p>
        </div>
        <div className="rounded-xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <p className="text-xs text-navy-500 dark:text-zinc-500 uppercase tracking-wider font-semibold">Ejecutado</p>
          <p className="text-2xl font-bold text-navy-900 dark:text-white mt-1">{eur(totalEjecutado)}</p>
        </div>
        <div className="rounded-xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <p className="text-xs text-navy-500 dark:text-zinc-500 uppercase tracking-wider font-semibold">Certificaciones</p>
          <p className="text-2xl font-bold text-navy-900 dark:text-white mt-1">{certifications.length}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        {!editingProgress ? (
          <Button onClick={startEditProgress}>Actualizar avance</Button>
        ) : (
          <>
            <Button onClick={saveProgress}>Guardar avance</Button>
            <Button variant="secondary" onClick={() => setEditingProgress(false)}>Cancelar</Button>
          </>
        )}
        <Button variant="secondary" onClick={() => setShowCertForm(true)}>
          + Certificación
        </Button>
      </div>

      {/* Certification form */}
      {showCertForm && (
        <Card className="border-brand-green/30">
          <div className="border-b border-navy-100 dark:border-zinc-800 pb-3 mb-4">
            <h3 className="text-sm font-semibold text-brand-green uppercase tracking-wider">
              Nueva certificación #{certifications.length + 1}
            </h3>
            <p className="text-xs text-navy-500 dark:text-zinc-500 mt-1">
              Se creará automáticamente con las cantidades ejecutadas desde la última certificación.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <FormField label="Periodo">
              <Input
                type="month"
                value={certForm.period}
                onChange={(e) => setCertForm({ ...certForm, period: e.target.value })}
              />
            </FormField>
            <FormField label="Fecha certificación">
              <Input
                type="date"
                value={certForm.cert_date}
                onChange={(e) => setCertForm({ ...certForm, cert_date: e.target.value })}
              />
            </FormField>
            <FormField label="Notas">
              <Input
                type="text"
                value={certForm.notes}
                onChange={(e) => setCertForm({ ...certForm, notes: e.target.value })}
                placeholder="Observaciones"
              />
            </FormField>
          </div>
          <div className="flex gap-3 pt-3 border-t border-navy-100 dark:border-zinc-800">
            <Button onClick={handleCreateCert}>Crear certificación</Button>
            <Button variant="secondary" onClick={() => setShowCertForm(false)}>Cancelar</Button>
          </div>
        </Card>
      )}

      {/* Progress table by chapter */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-navy-900 dark:text-white uppercase tracking-wider">
          Avance por partida
        </h3>

        {chapters.map((ch) => {
          const chItems = itemsByChapter[ch.id] || [];
          if (chItems.length === 0) return null;

          return (
            <div key={ch.id} className="rounded-2xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
              <div className="px-5 py-3 bg-navy-50/50 dark:bg-zinc-800/30 border-b border-navy-100 dark:border-zinc-800">
                <span className="text-xs font-mono text-navy-400 mr-2">{ch.code}</span>
                <span className="text-sm font-semibold text-navy-900 dark:text-white">{ch.name}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-navy-50/30 dark:bg-zinc-800/20">
                      <th className="text-left text-[10px] font-semibold text-navy-500 uppercase px-5 py-2">Partida</th>
                      <th className="text-center text-[10px] font-semibold text-navy-500 uppercase px-3 py-2">Ud</th>
                      <th className="text-right text-[10px] font-semibold text-navy-500 uppercase px-3 py-2">Medición</th>
                      <th className="text-right text-[10px] font-semibold text-navy-500 uppercase px-3 py-2">Ejecutado</th>
                      <th className="text-center text-[10px] font-semibold text-navy-500 uppercase px-3 py-2">% Avance</th>
                      <th className="text-right text-[10px] font-semibold text-navy-500 uppercase px-5 py-2">Importe ejec.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chItems.map((item) => {
                      const edit = progressEdits[item.id];
                      const qty = editingProgress && edit ? edit.qty : Number(item.executed_qty);
                      const pct = editingProgress && edit ? edit.pct : item.progress_pct;
                      const importeEjec = qty * Number(item.unit_price);

                      return (
                        <tr key={item.id} className="border-t border-navy-50 dark:border-zinc-800">
                          <td className="px-5 py-2.5">
                            <span className="text-xs font-mono text-navy-400 mr-2">{item.code}</span>
                            <span className="text-sm text-navy-900 dark:text-white">{item.name}</span>
                          </td>
                          <td className="px-3 py-2.5 text-center text-xs text-navy-500">{item.unit}</td>
                          <td className="px-3 py-2.5 text-right text-sm">{Number(item.quantity).toLocaleString("es-ES", { maximumFractionDigits: 3 })}</td>
                          <td className="px-3 py-2.5 text-right">
                            {editingProgress ? (
                              <input
                                type="number"
                                min="0"
                                step="0.001"
                                value={edit?.qty ?? 0}
                                onChange={(e) => updateItemProgress(item.id, "qty", Number(e.target.value) || 0)}
                                className="w-20 text-right text-sm rounded-lg border border-navy-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1"
                              />
                            ) : (
                              <span className="text-sm">{qty.toLocaleString("es-ES", { maximumFractionDigits: 3 })}</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {editingProgress ? (
                              <input
                                type="number"
                                min="0"
                                max="100"
                                value={edit?.pct ?? 0}
                                onChange={(e) => updateItemProgress(item.id, "pct", Number(e.target.value) || 0)}
                                className="w-16 text-center text-sm rounded-lg border border-navy-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1"
                              />
                            ) : (
                              <div className="flex items-center justify-center gap-1.5">
                                <div className="w-12 h-1.5 rounded-full bg-navy-100 dark:bg-zinc-700 overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-emerald-500" : pct >= 50 ? "bg-brand-green" : "bg-yellow-500"}`}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-navy-500">{pct}%</span>
                              </div>
                            )}
                          </td>
                          <td className="px-5 py-2.5 text-right text-sm font-semibold">
                            {eur(importeEjec)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>

      {/* Certifications list */}
      {certifications.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-navy-900 dark:text-white uppercase tracking-wider">
            Certificaciones
          </h3>

          <div className="rounded-2xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-navy-50/50 dark:bg-zinc-800/30">
                  <th className="text-left text-[10px] font-semibold text-navy-500 uppercase px-5 py-2">#</th>
                  <th className="text-left text-[10px] font-semibold text-navy-500 uppercase px-3 py-2">Periodo</th>
                  <th className="text-center text-[10px] font-semibold text-navy-500 uppercase px-3 py-2">Fecha</th>
                  <th className="text-center text-[10px] font-semibold text-navy-500 uppercase px-3 py-2">Estado</th>
                  <th className="text-right text-[10px] font-semibold text-navy-500 uppercase px-3 py-2">Importe</th>
                  <th className="text-right text-[10px] font-semibold text-navy-500 uppercase px-5 py-2">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {certifications.map((cert) => {
                  const st = certStatusMap[cert.status] || certStatusMap.draft;
                  const total = certTotal(cert.id);
                  return (
                    <tr key={cert.id} className="border-t border-navy-50 dark:border-zinc-800 hover:bg-navy-50/50 dark:hover:bg-zinc-800/30">
                      <td className="px-5 py-3 font-semibold">#{cert.cert_number}</td>
                      <td className="px-3 py-3">{cert.period}</td>
                      <td className="px-3 py-3 text-center text-xs text-navy-500">
                        {new Date(cert.cert_date).toLocaleDateString("es-ES")}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${st.color}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right font-semibold">{eur(total)}</td>
                      <td className="px-5 py-3 text-right space-x-2">
                        {cert.status === "draft" && (
                          <button onClick={() => updateCertStatus(cert.id, "sent")} className="text-xs text-blue-600 hover:underline">
                            Enviar
                          </button>
                        )}
                        {cert.status === "sent" && (
                          <button onClick={() => updateCertStatus(cert.id, "approved")} className="text-xs text-green-600 hover:underline">
                            Aprobar
                          </button>
                        )}
                        {cert.status === "approved" && (
                          <button onClick={() => updateCertStatus(cert.id, "paid")} className="text-xs text-emerald-600 hover:underline">
                            Cobrada
                          </button>
                        )}
                        <button onClick={() => handleDeleteCert(cert.id)} className="text-xs text-red-600 hover:underline">
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
