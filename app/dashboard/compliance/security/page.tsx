"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

interface SecurityIncident {
  id: string;
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  affected_data: string;
  affected_users: number;
  detected_at: string;
  resolved_at: string | null;
  notified_aepd: boolean;
  notified_users: boolean;
  resolution: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadSecurityIncidents(supabase: any, userId: string): Promise<SecurityIncident[]> {
  const { data } = await supabase
    .from("security_incidents")
    .select("id, title, severity, description, affected_data, affected_users, detected_at, resolved_at, notified_aepd, notified_users, resolution")
    .eq("user_id", userId)
    .order("detected_at", { ascending: false });

  return data || [];
}

export default function SecurityCompliancePage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const [loading, setLoading] = useState(true);
  const [incidents, setIncidents] = useState<SecurityIncident[]>([]);
  const [filterStatus, setFilterStatus] = useState<"all" | "open" | "resolved">("all");
  const [selectedIncident, setSelectedIncident] = useState<SecurityIncident | null>(null);

  useEffect(() => {
    async function fetch() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const data = await loadSecurityIncidents(supabase, user.id);
      setIncidents(data);
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

  const severityColors: Record<string, string> = {
    low: "bg-blue-500/20 text-blue-300",
    medium: "bg-yellow-500/20 text-yellow-300",
    high: "bg-orange-500/20 text-orange-300",
    critical: "bg-red-500/20 text-red-300",
  };

  const severityLabels: Record<string, string> = {
    low: "Bajo",
    medium: "Medio",
    high: "Alto",
    critical: "Crítico",
  };

  const filteredIncidents = incidents.filter((incident) => {
    if (filterStatus === "open") return !incident.resolved_at;
    if (filterStatus === "resolved") return incident.resolved_at;
    return true;
  });

  const stats = {
    total: incidents.length,
    open: incidents.filter((i) => !i.resolved_at).length,
    critical: incidents.filter((i) => i.severity === "critical").length,
    totalAffectedUsers: incidents.reduce((sum, i) => sum + (i.affected_users || 0), 0),
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-navy-50)]">Compliance de Seguridad</h1>
        <p className="text-[var(--color-navy-400)] text-sm">Gestión de incidentes de seguridad y brechas de datos</p>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Total de Incidentes" value={String(stats.total)} color="text-[var(--color-navy-100)]" />
        <KpiCard label="Incidentes Abiertos" value={String(stats.open)} color="text-yellow-400" />
        <KpiCard label="Críticos" value={String(stats.critical)} color="text-red-400" />
        <KpiCard label="Usuarios Afectados" value={String(stats.totalAffectedUsers)} color="text-[var(--color-brand-green)]" />
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {["all", "open", "resolved"].map((status) => (
          <button
            key={status}
            onClick={() => setFilterStatus(status as "all" | "open" | "resolved")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              filterStatus === status
                ? "bg-[var(--color-brand-green)] text-[var(--color-navy-900)]"
                : "bg-[var(--color-navy-800)] text-[var(--color-navy-300)] hover:bg-[var(--color-navy-750)]"
            }`}
          >
            {status === "all" && "Todos"}
            {status === "open" && "Abiertos"}
            {status === "resolved" && "Resueltos"}
          </button>
        ))}
      </div>

      {/* Incidents List */}
      <div className="bg-[var(--color-navy-800)] rounded-xl p-6">
        <h2 className="text-sm font-semibold text-[var(--color-brand-green)] uppercase tracking-wider mb-4">
          Incidentes de Seguridad
        </h2>

        {filteredIncidents.length === 0 ? (
          <p className="text-[var(--color-navy-400)] text-sm">
            {filterStatus === "open" && "No hay incidentes abiertos."}
            {filterStatus === "resolved" && "No hay incidentes resueltos."}
            {filterStatus === "all" && "No hay incidentes registrados."}
          </p>
        ) : (
          <div className="space-y-3">
            {filteredIncidents.map((incident) => (
              <div
                key={incident.id}
                onClick={() => setSelectedIncident(selectedIncident?.id === incident.id ? null : incident)}
                className="p-4 rounded-lg bg-[var(--color-navy-750)] hover:bg-[var(--color-navy-700)] transition cursor-pointer border-l-4"
                style={{
                  borderLeftColor: incident.severity === "critical" ? "#ef4444" : incident.severity === "high" ? "#f97316" : incident.severity === "medium" ? "#eab308" : "#3b82f6",
                }}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h4 className="font-semibold text-[var(--color-navy-50)]">{incident.title}</h4>
                    <p className="text-xs text-[var(--color-navy-400)] mt-1">
                      Detectado: {new Date(incident.detected_at).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}
                      {incident.resolved_at && (
                        <>
                          {" · Resuelto: "}
                          {new Date(incident.resolved_at).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${severityColors[incident.severity]}`}>
                      {severityLabels[incident.severity]}
                    </span>
                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                      incident.resolved_at
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-yellow-500/20 text-yellow-300"
                    }`}>
                      {incident.resolved_at ? "Resuelto" : "Abierto"}
                    </span>
                  </div>
                </div>

                {selectedIncident?.id === incident.id && (
                  <div className="mt-4 pt-4 border-t border-[var(--color-navy-600)] space-y-3">
                    <div>
                      <p className="text-xs text-[var(--color-navy-400)] uppercase tracking-wider">Descripción</p>
                      <p className="text-sm text-[var(--color-navy-200)] mt-1">{incident.description}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-[var(--color-navy-400)] uppercase tracking-wider">Datos Afectados</p>
                        <p className="text-sm text-[var(--color-navy-200)] mt-1">{incident.affected_data}</p>
                      </div>
                      <div>
                        <p className="text-xs text-[var(--color-navy-400)] uppercase tracking-wider">Usuarios Afectados</p>
                        <p className="text-sm text-[var(--color-navy-200)] mt-1">{incident.affected_users}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-[var(--color-navy-400)] uppercase tracking-wider">AEPD Notificada</p>
                        <p className="text-sm text-[var(--color-navy-200)] mt-1">
                          {incident.notified_aepd ? "✓ Sí" : "✗ No"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-[var(--color-navy-400)] uppercase tracking-wider">Usuarios Notificados</p>
                        <p className="text-sm text-[var(--color-navy-200)] mt-1">
                          {incident.notified_users ? "✓ Sí" : "✗ No"}
                        </p>
                      </div>
                    </div>

                    {incident.resolution && (
                      <div>
                        <p className="text-xs text-[var(--color-navy-400)] uppercase tracking-wider">Resolución</p>
                        <p className="text-sm text-[var(--color-navy-200)] mt-1">{incident.resolution}</p>
                      </div>
                    )}
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

function KpiCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-[var(--color-navy-800)] rounded-xl p-4 text-center">
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      <p className="text-xs text-[var(--color-navy-400)] mt-1">{label}</p>
    </div>
  );
}
