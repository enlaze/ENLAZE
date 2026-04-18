"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { SupabaseClient } from "@supabase/supabase-js";
import PageHeader from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import Loading from "@/components/ui/loading";

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

  if (loading) return <Loading />;

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
    pending: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900",
    in_progress: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900",
    completed: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900",
    denied: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-900",
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="Cumplimiento de privacidad"
        description="Gestión de aceptaciones legales, subprocesadores y solicitudes de interesados."
      />

      {/* Legal Acceptances */}
      <Card>
        <h2 className="text-sm font-semibold text-brand-green uppercase tracking-wider mb-4">
          Aceptaciones legales
        </h2>
        <div className="space-y-2">
          {acceptanceItems.map((item) => (
            <div
              key={item.key}
              className="flex items-center justify-between p-4 rounded-xl border border-navy-100 bg-gray-50 hover:bg-white hover:shadow-sm transition dark:border-zinc-800 dark:bg-zinc-800/50 dark:hover:bg-zinc-800"
            >
              <span className="text-navy-800 dark:text-zinc-200">{item.label}</span>
              <span
                className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium border ${
                  item.accepted
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900"
                    : "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-900"
                }`}
              >
                {item.accepted ? "✓ Aceptado" : "✗ Pendiente"}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* Subprocessors Registry */}
      <Card padding={false}>
        <div className="p-6 pb-4">
          <h2 className="text-sm font-semibold text-brand-green uppercase tracking-wider">
            Registro de subprocesadores
          </h2>
        </div>
        {subprocessors.length === 0 ? (
          <p className="px-6 pb-6 text-navy-500 dark:text-zinc-400 text-sm">No hay subprocesadores registrados.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-y border-navy-100 dark:bg-zinc-800/50 dark:border-zinc-800">
                <tr>
                  <th className="text-left px-4 py-3 text-navy-700 dark:text-zinc-300 font-semibold">Nombre</th>
                  <th className="text-left px-4 py-3 text-navy-700 dark:text-zinc-300 font-semibold">Servicio</th>
                  <th className="text-left px-4 py-3 text-navy-700 dark:text-zinc-300 font-semibold">País</th>
                  <th className="text-left px-4 py-3 text-navy-700 dark:text-zinc-300 font-semibold">DPA firmado</th>
                  <th className="text-left px-4 py-3 text-navy-700 dark:text-zinc-300 font-semibold">Política de privacidad</th>
                </tr>
              </thead>
              <tbody>
                {subprocessors.map((sp) => (
                  <tr
                    key={sp.id}
                    className="border-b border-navy-100 last:border-0 hover:bg-gray-50 transition dark:border-zinc-800 dark:hover:bg-zinc-800/50"
                  >
                    <td className="px-4 py-3 text-navy-800 dark:text-zinc-200">{sp.name}</td>
                    <td className="px-4 py-3 text-navy-600 dark:text-zinc-400">{sp.service}</td>
                    <td className="px-4 py-3 text-navy-600 dark:text-zinc-400">{sp.country}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border ${
                          sp.dpa_signed
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900"
                            : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900"
                        }`}
                      >
                        {sp.dpa_signed ? "✓ Sí" : "Pendiente"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {sp.privacy_url ? (
                        <a
                          href={sp.privacy_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-brand-green hover:underline text-xs"
                        >
                          Ver política
                        </a>
                      ) : (
                        <span className="text-navy-400 dark:text-zinc-500 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Processing Activities */}
      <Card>
        <h2 className="text-sm font-semibold text-brand-green uppercase tracking-wider mb-4">
          Actividades de tratamiento
        </h2>
        {processingActivities.length === 0 ? (
          <p className="text-navy-500 dark:text-zinc-400 text-sm">No hay actividades de tratamiento registradas.</p>
        ) : (
          <div className="space-y-3">
            {processingActivities.map((activity) => (
              <div
                key={activity.id}
                className="p-4 rounded-xl border border-navy-100 bg-gray-50 hover:bg-white hover:shadow-sm transition dark:border-zinc-800 dark:bg-zinc-800/50 dark:hover:bg-zinc-800"
              >
                <div className="mb-2">
                  <h4 className="font-semibold text-navy-900 dark:text-white">{activity.activity_name}</h4>
                  <p className="text-sm text-navy-500 dark:text-zinc-400 mt-1">{activity.purpose}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs mt-3 pt-3 border-t border-navy-200 dark:border-zinc-700">
                  <div>
                    <p className="text-navy-500 dark:text-zinc-400">Base legal</p>
                    <p className="text-navy-800 dark:text-zinc-200">{activity.legal_basis}</p>
                  </div>
                  <div>
                    <p className="text-navy-500 dark:text-zinc-400">Período de retención</p>
                    <p className="text-navy-800 dark:text-zinc-200">{activity.retention_period}</p>
                  </div>
                  <div>
                    <p className="text-navy-500 dark:text-zinc-400">Categorías de datos</p>
                    <p className="text-navy-800 dark:text-zinc-200">{activity.data_categories}</p>
                  </div>
                  <div>
                    <p className="text-navy-500 dark:text-zinc-400">Interesados</p>
                    <p className="text-navy-800 dark:text-zinc-200">{activity.data_subjects}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Data Subject Requests */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-brand-green uppercase tracking-wider">
            Solicitudes de interesados
          </h2>
          <button
            onClick={() => setShowNewRequestForm(!showNewRequestForm)}
            className="px-3 py-1.5 text-sm font-medium text-navy-900 bg-brand-green rounded-lg hover:opacity-90 transition"
          >
            + Nueva solicitud
          </button>
        </div>

        {showNewRequestForm && (
          <div className="p-4 rounded-xl border border-navy-100 bg-gray-50 mb-4 dark:border-zinc-800 dark:bg-zinc-800/50">
            <p className="text-navy-500 dark:text-zinc-400 text-sm">
              Formulario para registrar nueva solicitud (integración próxima)
            </p>
          </div>
        )}

        {dataSubjectRequests.length === 0 ? (
          <p className="text-navy-500 dark:text-zinc-400 text-sm">No hay solicitudes registradas.</p>
        ) : (
          <div className="space-y-3">
            {dataSubjectRequests.map((request) => (
              <div
                key={request.id}
                onClick={() => setSelectedRequest(selectedRequest?.id === request.id ? null : request)}
                className="p-4 rounded-xl border border-navy-100 bg-gray-50 hover:bg-white hover:shadow-sm transition cursor-pointer dark:border-zinc-800 dark:bg-zinc-800/50 dark:hover:bg-zinc-800"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-navy-900 dark:text-white">{request.requester_name}</h4>
                    <p className="text-xs text-navy-500 dark:text-zinc-400">{request.requester_email}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900">
                      {requestTypeLabels[request.request_type]}
                    </span>
                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border ${statusColors[request.status]}`}>
                      {statusLabels[request.status]}
                    </span>
                  </div>
                </div>

                {selectedRequest?.id === request.id && (
                  <div className="mt-3 pt-3 border-t border-navy-200 dark:border-zinc-700">
                    <p className="text-sm text-navy-800 dark:text-zinc-200">{request.description}</p>
                    <p className="text-xs text-navy-500 dark:text-zinc-400 mt-2">
                      {new Date(request.created_at).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
