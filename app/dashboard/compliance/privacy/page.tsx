"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { SupabaseClient } from "@supabase/supabase-js";

interface LegalAcceptance {
  terms: boolean;
  privacy: boolean;
  cookies: boolean;
  dpa: boolean;
}

interface Subprocessor {
  id: string;
  name: string;
  service: string;
  country: string;
  dpa_signed: boolean;
  privacy_url: string;
}

interface ProcessingActivity {
  id: string;
  activity_name: string;
  purpose: string;
  legal_basis: string;
  data_categories: string;
  data_subjects: string;
  retention_period: string;
}

interface DataSubjectRequest {
  id: string;
  requester_name: string;
  requester_email: string;
  request_type: "access" | "rectification" | "erasure" | "portability" | "objection" | "restriction";
  status: "pending" | "in_progress" | "completed" | "denied";
  description: string;
  created_at: string;
}

async function loadLegalAcceptances(supabase: SupabaseClient, userId: string): Promise<LegalAcceptance> {
  const { data } = await supabase
    .from("user_settings")
    .select("terms_accepted, privacy_accepted, cookies_accepted, dpa_accepted")
    .eq("user_id", userId)
    .single();

  return {
    terms: data?.terms_accepted || false,
    privacy: data?.privacy_accepted || false,
    cookies: data?.cookies_accepted || false,
    dpa: data?.dpa_accepted || false,
  };
}

async function loadSubprocessors(supabase: SupabaseClient, userId: string): Promise<Subprocessor[]> {
  const { data } = await supabase
    .from("subprocessors")
    .select("id, name, service, country, dpa_signed, privacy_url")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  return data || [];
}

async function loadProcessingActivities(supabase: SupabaseClient, userId: string): Promise<ProcessingActivity[]> {
  const { data } = await supabase
    .from("processing_activities")
    .select("id, activity_name, purpose, legal_basis, data_categories, data_subjects, retention_period")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  return data || [];
}

async function loadDataSubjectRequests(supabase: SupabaseClient, userId: string): Promise<DataSubjectRequest[]> {
  const { data } = await supabase
    .from("data_subject_requests")
    .select("id, requester_name, requester_email, request_type, status, description, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  return data || [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadAllData(supabase: any) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const [legalAcceptances, subprocessors, processingActivities, dataSubjectRequests] = await Promise.all([
    loadLegalAcceptances(supabase, user.id),
    loadSubprocessors(supabase, user.id),
    loadProcessingActivities(supabase, user.id),
    loadDataSubjectRequests(supabase, user.id),
  ]);

  return { legalAcceptances, subprocessors, processingActivities, dataSubjectRequests };
}

export default function PrivacyCompliancePage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const [loading, setLoading] = useState(true);
  const [legalAcceptances, setLegalAcceptances] = useState<LegalAcceptance>({
    terms: false,
    privacy: false,
    cookies: false,
    dpa: false,
  });
  const [subprocessors, setSubprocessors] = useState<Subprocessor[]>([]);
  const [processingActivities, setProcessingActivities] = useState<ProcessingActivity[]>([]);
  const [dataSubjectRequests, setDataSubjectRequests] = useState<DataSubjectRequest[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<DataSubjectRequest | null>(null);
  const [showNewRequestForm, setShowNewRequestForm] = useState(false);

  useEffect(() => {
    async function fetch() {
      const data = await loadAllData(supabase);
      if (data) {
        setLegalAcceptances(data.legalAcceptances);
        setSubprocessors(data.subprocessors);
        setProcessingActivities(data.processingActivities);
        setDataSubjectRequests(data.dataSubjectRequests);
      }
      setLoading(false);
    }
    fetch();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-brand-green)]"></div>
      </div>
    );
  }

  const acceptanceItems = [
    { key: "terms", label: "Términos de Servicio", accepted: legalAcceptances.terms },
    { key: "privacy", label: "Política de Privacidad", accepted: legalAcceptances.privacy },
    { key: "cookies", label: "Política de Cookies", accepted: legalAcceptances.cookies },
    { key: "dpa", label: "Data Processing Agreement (DPA)", accepted: legalAcceptances.dpa },
  ];

  const requestTypeLabels: Record<string, string> = {
    access: "Acceso",
    rectification: "Rectificación",
    erasure: "Supresión",
    portability: "Portabilidad",
    objection: "Objeción",
    restriction: "Restricción",
  };

  const statusLabels: Record<string, string> = {
    pending: "Pendiente",
    in_progress: "En progreso",
    completed: "Completada",
    denied: "Denegada",
  };

  const statusColors: Record<string, string> = {
    pending: "bg-yellow-500/20 text-yellow-300",
    in_progress: "bg-blue-500/20 text-blue-300",
    completed: "bg-emerald-500/20 text-emerald-300",
    denied: "bg-red-500/20 text-red-300",
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-navy-50)]">Compliance de Privacidad</h1>
        <p className="text-[var(--color-navy-400)] text-sm">Gestión de aceptaciones legales, subprocesadores y solicitudes de interesados</p>
      </div>

      {/* Legal Acceptances */}
      <div className="bg-[var(--color-navy-800)] rounded-xl p-6">
        <h2 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-4">
          Aceptaciones Legales
        </h2>
        <div className="space-y-3">
          {acceptanceItems.map((item) => (
            <div key={item.key} className="flex items-center justify-between p-4 rounded-lg bg-[var(--color-navy-750)] hover:bg-[var(--color-navy-700)] transition">
              <span className="text-[var(--color-navy-200)]">{item.label}</span>
              <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${
                item.accepted
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "bg-red-500/20 text-red-300"
              }`}>
                {item.accepted ? "✓ Aceptado" : "✗ Pendiente"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Subprocessors Registry */}
      <div className="bg-[var(--color-navy-800)] rounded-xl p-6">
        <h2 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-4">
          Registro de Subprocesadores
        </h2>
        {subprocessors.length === 0 ? (
          <p className="text-[var(--color-navy-400)] text-sm">No hay subprocesadores registrados.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--color-navy-700)]">
                <tr>
                  <th className="text-left px-4 py-3 text-[var(--color-navy-300)] font-semibold">Nombre</th>
                  <th className="text-left px-4 py-3 text-[var(--color-navy-300)] font-semibold">Servicio</th>
                  <th className="text-left px-4 py-3 text-[var(--color-navy-300)] font-semibold">País</th>
                  <th className="text-left px-4 py-3 text-[var(--color-navy-300)] font-semibold">DPA Firmado</th>
                  <th className="text-left px-4 py-3 text-[var(--color-navy-300)] font-semibold">Política de Privacidad</th>
                </tr>
              </thead>
              <tbody>
                {subprocessors.map((sp) => (
                  <tr key={sp.id} className="border-b border-[var(--color-navy-700)] hover:bg-[var(--color-navy-750)] transition">
                    <td className="px-4 py-3 text-[var(--color-navy-200)]">{sp.name}</td>
                    <td className="px-4 py-3 text-[var(--color-navy-300)]">{sp.service}</td>
                    <td className="px-4 py-3 text-[var(--color-navy-300)]">{sp.country}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        sp.dpa_signed
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-yellow-500/20 text-yellow-300"
                      }`}>
                        {sp.dpa_signed ? "✓ Sí" : "Pendiente"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {sp.privacy_url ? (
                        <a href={sp.privacy_url} target="_blank" rel="noopener noreferrer" className="text-[var(--color-brand-green)] hover:underline text-xs">
                          Ver política
                        </a>
                      ) : (
                        <span className="text-[var(--color-navy-500)] text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Processing Activities */}
      <div className="bg-[var(--color-navy-800)] rounded-xl p-6">
        <h2 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-4">
          Actividades de Tratamiento
        </h2>
        {processingActivities.length === 0 ? (
          <p className="text-[var(--color-navy-400)] text-sm">No hay actividades de tratamiento registradas.</p>
        ) : (
          <div className="space-y-3">
            {processingActivities.map((activity) => (
              <div key={activity.id} className="p-4 rounded-lg bg-[var(--color-navy-750)] hover:bg-[var(--color-navy-700)] transition">
                <div className="mb-2">
                  <h4 className="font-semibold text-[var(--color-navy-50)]">{activity.activity_name}</h4>
                  <p className="text-sm text-[var(--color-navy-400)] mt-1">{activity.purpose}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs mt-3 pt-3 border-t border-[var(--color-navy-600)]">
                  <div>
                    <p className="text-[var(--color-navy-400)]">Base Legal</p>
                    <p className="text-[var(--color-navy-200)]">{activity.legal_basis}</p>
                  </div>
                  <div>
                    <p className="text-[var(--color-navy-400)]">Período de Retención</p>
                    <p className="text-[var(--color-navy-200)]">{activity.retention_period}</p>
                  </div>
                  <div>
                    <p className="text-[var(--color-navy-400)]">Categorías de Datos</p>
                    <p className="text-[var(--color-navy-200)]">{activity.data_categories}</p>
                  </div>
                  <div>
                    <p className="text-[var(--color-navy-400)]">Interesados</p>
                    <p className="text-[var(--color-navy-200)]">{activity.data_subjects}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Data Subject Requests */}
      <div className="bg-[var(--color-navy-800)] rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider">
            Solicitudes de Interesados
          </h2>
          <button
            onClick={() => setShowNewRequestForm(!showNewRequestForm)}
            className="px-3 py-1 text-sm font-medium text-[var(--color-navy-900)] bg-[var(--color-brand-green)] rounded-lg hover:opacity-90 transition"
          >
            + Nueva Solicitud
          </button>
        </div>

        {showNewRequestForm && (
          <div className="p-4 rounded-lg bg-[var(--color-navy-750)] mb-4">
            <p className="text-[var(--color-navy-400)] text-sm">Formulario para registrar nueva solicitud (integración próxima)</p>
          </div>
        )}

        {dataSubjectRequests.length === 0 ? (
          <p className="text-[var(--color-navy-400)] text-sm">No hay solicitudes registradas.</p>
        ) : (
          <div className="space-y-3">
            {dataSubjectRequests.map((request) => (
              <div
                key={request.id}
                onClick={() => setSelectedRequest(selectedRequest?.id === request.id ? null : request)}
                className="p-4 rounded-lg bg-[var(--color-navy-750)] hover:bg-[var(--color-navy-700)] transition cursor-pointer"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h4 className="font-semibold text-[var(--color-navy-50)]">{request.requester_name}</h4>
                    <p className="text-xs text-[var(--color-navy-400)]">{request.requester_email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-[var(--color-brand-green)]/20 text-[var(--color-brand-green)]">
                      {requestTypeLabels[request.request_type]}
                    </span>
                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${statusColors[request.status]}`}>
                      {statusLabels[request.status]}
                    </span>
                  </div>
                </div>

                {selectedRequest?.id === request.id && (
                  <div className="mt-3 pt-3 border-t border-[var(--color-navy-600)]">
                    <p className="text-sm text-[var(--color-navy-200)]">{request.description}</p>
                    <p className="text-xs text-[var(--color-navy-500)] mt-2">
                      {new Date(request.created_at).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
