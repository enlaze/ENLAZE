"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select } from "@/components/ui/form-fields";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import EmptyState from "@/components/ui/empty-state";
import SignatureFlow from "@/components/SignatureFlow";

/* ─── Types ─── */

interface Signature {
  id: string;
  entity_type: string;
  entity_id: string;
  signer_name: string;
  signer_email: string;
  signer_role: string;
  status: string;
  signed_at: string | null;
  otp_verified: boolean;
  created_at: string;
  signature_image: string;
}

interface ProjectAct {
  id: string;
  project_id: string;
  act_type: string;
  title: string;
  description: string;
  act_date: string;
  attendees: string;
  notes: string;
  status: string;
  created_at: string;
}

const actTypes = [
  { value: "inicio", label: "Acta de inicio" },
  { value: "replanteo", label: "Acta de replanteo" },
  { value: "recepcion", label: "Acta de recepción" },
  { value: "fin", label: "Acta de fin de obra" },
  { value: "incidencia", label: "Acta de incidencia" },
];

const actStatusMap: Record<string, { label: string; color: string }> = {
  draft: { label: "Borrador", color: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  pending_signature: { label: "Pendiente firma", color: "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300" },
  signed: { label: "Firmada", color: "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300" },
};

const sigStatusMap: Record<string, { label: string; color: string }> = {
  pending: { label: "Pendiente", color: "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300" },
  signed: { label: "Firmada", color: "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300" },
  revoked: { label: "Revocada", color: "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300" },
};

const roleLabels: Record<string, string> = {
  cliente: "Cliente",
  encargado: "Encargado",
  director_obra: "Director de obra",
  propiedad: "Promotor",
};

const entityLabels: Record<string, string> = {
  budget: "Presupuesto",
  certification: "Certificación",
  work_report: "Parte de trabajo",
  project_act: "Acta de obra",
};

const emptyActForm = {
  act_type: "inicio",
  title: "",
  description: "",
  act_date: new Date().toISOString().split("T")[0],
  attendees: "",
  notes: "",
};

/* ─── Component ─── */

export default function SignaturePanel({
  projectId,
  userId,
}: {
  projectId: string;
  userId: string;
}) {
  const supabase = createClient();
  const confirm = useConfirm();
  const toast = useToast();

  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [acts, setActs] = useState<ProjectAct[]>([]);
  const [loading, setLoading] = useState(true);

  // Act form
  const [showActForm, setShowActForm] = useState(false);
  const [actForm, setActForm] = useState(emptyActForm);
  const [editingActId, setEditingActId] = useState<string | null>(null);

  // Signature flow
  const [showSignFlow, setShowSignFlow] = useState(false);
  const [signTarget, setSignTarget] = useState<{ type: string; id: string; title: string } | null>(null);

  // Link copied
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function loadData() {
    const [sigRes, actRes] = await Promise.all([
      supabase
        .from("digital_signatures")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      supabase
        .from("project_acts")
        .select("*")
        .eq("project_id", projectId)
        .order("act_date", { ascending: false }),
    ]);

    // Filter signatures related to this project's entities
    const allSigs = (sigRes.data as Signature[]) || [];
    const actIds = new Set(((actRes.data as ProjectAct[]) || []).map((a) => a.id));
    // We'll show all sigs for now - in production you'd filter by project
    setSignatures(allSigs);
    setActs((actRes.data as ProjectAct[]) || []);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, [projectId]);

  /* ── Act CRUD ── */

  function resetActForm() {
    setActForm(emptyActForm);
    setEditingActId(null);
    setShowActForm(false);
  }

  async function handleSaveAct() {
    if (!actForm.title.trim()) {
      toast.error("El título del acta es obligatorio.");
      return;
    }

    if (editingActId) {
      await supabase.from("project_acts").update({
        ...actForm,
        title: actForm.title.trim(),
        updated_at: new Date().toISOString(),
      }).eq("id", editingActId);
    } else {
      await supabase.from("project_acts").insert({
        project_id: projectId,
        user_id: userId,
        ...actForm,
        title: actForm.title.trim(),
        status: "draft",
      });
    }

    resetActForm();
    await loadData();
    toast.success(editingActId ? "Acta actualizada" : "Acta creada");
  }

  function startEditAct(act: ProjectAct) {
    setActForm({
      act_type: act.act_type,
      title: act.title,
      description: act.description,
      act_date: act.act_date,
      attendees: act.attendees,
      notes: act.notes,
    });
    setEditingActId(act.id);
    setShowActForm(true);
  }

  async function handleDeleteAct(id: string) {
    const ok = await confirm({
      title: "Eliminar acta",
      description: "¿Eliminar esta acta?",
      variant: "danger",
      confirmLabel: "Eliminar",
    });
    if (!ok) return;
    await supabase.from("project_acts").delete().eq("id", id);
    await loadData();
    toast.success("Acta eliminada");
  }

  /* ── Request signature ── */

  function startSignature(entityType: string, entityId: string, title: string) {
    setSignTarget({ type: entityType, id: entityId, title });
    setShowSignFlow(true);
  }

  async function handleSignComplete(signatureId: string) {
    setShowSignFlow(false);
    setSignTarget(null);

    // If signing an act, update its status
    if (signTarget?.type === "project_act") {
      await supabase.from("project_acts").update({
        status: "signed",
        updated_at: new Date().toISOString(),
      }).eq("id", signTarget.id);
    }

    await loadData();
  }

  function copySignLink(signatureId: string) {
    const url = `${window.location.origin}/firmar/${signatureId}`;
    navigator.clipboard.writeText(url);
    setCopiedId(signatureId);
    toast.success("Enlace de firma copiado");
    setTimeout(() => setCopiedId(null), 3000);
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

  // Signature flow modal
  if (showSignFlow && signTarget) {
    return (
      <Card>
        <SignatureFlow
          userId={userId}
          entityType={signTarget.type as "budget" | "certification" | "work_report" | "project_act"}
          entityId={signTarget.id}
          documentTitle={signTarget.title}
          onComplete={handleSignComplete}
          onCancel={() => { setShowSignFlow(false); setSignTarget(null); }}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="rounded-xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <p className="text-xs text-navy-500 dark:text-zinc-500 uppercase tracking-wider font-semibold">Actas</p>
          <p className="text-2xl font-bold text-navy-900 dark:text-white mt-1">{acts.length}</p>
        </div>
        <div className="rounded-xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <p className="text-xs text-navy-500 dark:text-zinc-500 uppercase tracking-wider font-semibold">Firmas totales</p>
          <p className="text-2xl font-bold text-navy-900 dark:text-white mt-1">{signatures.length}</p>
        </div>
        <div className="rounded-xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <p className="text-xs text-navy-500 dark:text-zinc-500 uppercase tracking-wider font-semibold">Firmadas</p>
          <p className="text-2xl font-bold text-green-600 mt-1">
            {signatures.filter((s) => s.status === "signed").length}
          </p>
        </div>
        <div className="rounded-xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <p className="text-xs text-navy-500 dark:text-zinc-500 uppercase tracking-wider font-semibold">Pendientes</p>
          <p className="text-2xl font-bold text-yellow-600 mt-1">
            {signatures.filter((s) => s.status === "pending").length}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <Button onClick={() => { resetActForm(); setShowActForm(true); }}>
          + Nueva acta
        </Button>
      </div>

      {/* Act form */}
      {showActForm && (
        <Card className="border-brand-green/30">
          <div className="border-b border-navy-100 dark:border-zinc-800 pb-3 mb-4">
            <h3 className="text-sm font-semibold text-brand-green uppercase tracking-wider">
              {editingActId ? "Editar acta" : "Nueva acta"}
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <FormField label="Tipo de acta">
              <Select
                value={actForm.act_type}
                onChange={(e) => setActForm({ ...actForm, act_type: e.target.value })}
              >
                {actTypes.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </Select>
            </FormField>
            <FormField label="Título" required className="md:col-span-2">
              <Input
                type="text"
                value={actForm.title}
                onChange={(e) => setActForm({ ...actForm, title: e.target.value })}
                placeholder="Ej: Acta de inicio de obra - Reforma C/ Mayor 5"
              />
            </FormField>
            <FormField label="Fecha">
              <Input
                type="date"
                value={actForm.act_date}
                onChange={(e) => setActForm({ ...actForm, act_date: e.target.value })}
              />
            </FormField>
            <FormField label="Asistentes" className="md:col-span-2">
              <Input
                type="text"
                value={actForm.attendees}
                onChange={(e) => setActForm({ ...actForm, attendees: e.target.value })}
                placeholder="Nombres de los asistentes"
              />
            </FormField>
            <FormField label="Descripción" className="md:col-span-3">
              <Input
                type="text"
                value={actForm.description}
                onChange={(e) => setActForm({ ...actForm, description: e.target.value })}
                placeholder="Contenido del acta"
              />
            </FormField>
            <FormField label="Notas" className="md:col-span-3">
              <Input
                type="text"
                value={actForm.notes}
                onChange={(e) => setActForm({ ...actForm, notes: e.target.value })}
                placeholder="Observaciones"
              />
            </FormField>
          </div>
          <div className="flex gap-3 pt-3 border-t border-navy-100 dark:border-zinc-800">
            <Button onClick={handleSaveAct}>{editingActId ? "Guardar" : "Crear acta"}</Button>
            <Button variant="secondary" onClick={resetActForm}>Cancelar</Button>
          </div>
        </Card>
      )}

      {/* Acts list */}
      {acts.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-navy-900 dark:text-white uppercase tracking-wider">
            Actas de obra
          </h3>
          <div className="rounded-2xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-navy-50/50 dark:bg-zinc-800/30">
                  <th className="text-left text-[10px] font-semibold text-navy-500 uppercase px-5 py-2">Acta</th>
                  <th className="text-center text-[10px] font-semibold text-navy-500 uppercase px-3 py-2">Tipo</th>
                  <th className="text-center text-[10px] font-semibold text-navy-500 uppercase px-3 py-2">Fecha</th>
                  <th className="text-center text-[10px] font-semibold text-navy-500 uppercase px-3 py-2">Estado</th>
                  <th className="text-right text-[10px] font-semibold text-navy-500 uppercase px-5 py-2">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {acts.map((act) => {
                  const st = actStatusMap[act.status] || actStatusMap.draft;
                  const typeLabel = actTypes.find((t) => t.value === act.act_type)?.label || act.act_type;

                  return (
                    <tr key={act.id} className="border-t border-navy-50 dark:border-zinc-800 hover:bg-navy-50/50 dark:hover:bg-zinc-800/30">
                      <td className="px-5 py-3">
                        <p className="font-medium text-navy-900 dark:text-white">{act.title}</p>
                        {act.attendees && <p className="text-xs text-navy-500 mt-0.5">{act.attendees}</p>}
                      </td>
                      <td className="px-3 py-3 text-center text-xs text-navy-600 dark:text-zinc-400">{typeLabel}</td>
                      <td className="px-3 py-3 text-center text-xs text-navy-500">
                        {new Date(act.act_date).toLocaleDateString("es-ES")}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${st.color}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right space-x-2">
                        {act.status !== "signed" && (
                          <button
                            onClick={() => startSignature("project_act", act.id, act.title)}
                            className="text-xs text-brand-green hover:underline"
                          >
                            Firmar
                          </button>
                        )}
                        <button onClick={() => startEditAct(act)} className="text-xs text-brand-green hover:underline">
                          Editar
                        </button>
                        <button onClick={() => handleDeleteAct(act.id)} className="text-xs text-red-600 hover:underline">
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

      {/* All signatures */}
      {signatures.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-navy-900 dark:text-white uppercase tracking-wider">
            Historial de firmas
          </h3>
          <div className="rounded-2xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-navy-50/50 dark:bg-zinc-800/30">
                  <th className="text-left text-[10px] font-semibold text-navy-500 uppercase px-5 py-2">Firmante</th>
                  <th className="text-center text-[10px] font-semibold text-navy-500 uppercase px-3 py-2">Documento</th>
                  <th className="text-center text-[10px] font-semibold text-navy-500 uppercase px-3 py-2">Estado</th>
                  <th className="text-center text-[10px] font-semibold text-navy-500 uppercase px-3 py-2">Fecha</th>
                  <th className="text-center text-[10px] font-semibold text-navy-500 uppercase px-3 py-2">OTP</th>
                  <th className="text-right text-[10px] font-semibold text-navy-500 uppercase px-5 py-2">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {signatures.map((sig) => {
                  const st = sigStatusMap[sig.status] || sigStatusMap.pending;

                  return (
                    <tr key={sig.id} className="border-t border-navy-50 dark:border-zinc-800">
                      <td className="px-5 py-3">
                        <p className="font-medium text-navy-900 dark:text-white">{sig.signer_name}</p>
                        <p className="text-xs text-navy-500">{sig.signer_email} · {roleLabels[sig.signer_role] || sig.signer_role}</p>
                      </td>
                      <td className="px-3 py-3 text-center text-xs text-navy-600 dark:text-zinc-400">
                        {entityLabels[sig.entity_type] || sig.entity_type}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${st.color}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center text-xs text-navy-500">
                        {sig.signed_at
                          ? new Date(sig.signed_at).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })
                          : new Date(sig.created_at).toLocaleDateString("es-ES")}
                      </td>
                      <td className="px-3 py-3 text-center">
                        {sig.otp_verified ? (
                          <span className="text-green-600 text-xs font-semibold">Verificado</span>
                        ) : (
                          <span className="text-yellow-600 text-xs">Pendiente</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {sig.status === "pending" && (
                          <button
                            onClick={() => copySignLink(sig.id)}
                            className="text-xs text-brand-green hover:underline"
                          >
                            {copiedId === sig.id ? "Copiado" : "Copiar enlace"}
                          </button>
                        )}
                        {sig.status === "signed" && sig.signature_image && (
                          <span className="text-[10px] text-navy-400">Completada</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {acts.length === 0 && signatures.length === 0 && (
        <EmptyState
          title="Sin actas ni firmas"
          description="Crea una acta de obra y solicita la firma del cliente o la propiedad."
          action={
            <Button onClick={() => { resetActForm(); setShowActForm(true); }}>
              + Nueva acta
            </Button>
          }
        />
      )}
    </div>
  );
}
