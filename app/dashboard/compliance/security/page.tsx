"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import PageHeader from "@/components/ui/page-header";
import { Card, StatCard } from "@/components/ui/card";
import Loading from "@/components/ui/loading";

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
  const supabase = createClient();

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

  if (loading) return <Loading />;

  const severityColors: Record<string, string> = {
    low: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900",
    medium: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900",
    high: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/50 dark:text-orange-300 dark:border-orange-900",
    critical: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-900",
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
      <PageHeader
        title="Cumplimiento de seguridad"
        description="Gestión de incidentes de seguridad y brechas de datos."
      />

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total de incidentes" value={stats.total} />
        <StatCard label="Incidentes abiertos" value={stats.open} accent={stats.open > 0 ? "yellow" : "green"} />
        <StatCard label="Críticos" value={stats.critical} accent={stats.critical > 0 ? "red" : "green"} />
        <StatCard label="Usuarios afectados" value={stats.totalAffectedUsers} accent="green" />
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {["all", "open", "resolved"].map((status) => (
          <button
            key={status}
            onClick={() => setFilterStatus(status as "all" | "open" | "resolved")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition border ${
              filterStatus === status
                ? "bg-brand-green text-navy-900 border-brand-green"
                : "bg-white text-navy-700 border-navy-200 hover:bg-navy-50 dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-800 dark:hover:bg-zinc-800"
            }`}
          >
            {status === "all" && "Todos"}
            {status === "open" && "Abiertos"}
            {status === "resolved" && "Resueltos"}
          </button>
        ))}
      </div>

      {/* Incidents List */}
      <Card>
        <h2 className="text-sm font-semibold text-brand-green uppercase tracking-wider mb-4">
          Incidentes de seguridad
        </h2>

        {filteredIncidents.length === 0 ? (
          <p className="text-navy-500 dark:text-zinc-400 text-sm">
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
                className="p-4 rounded-xl border border-navy-100 bg-navy-50 hover:bg-white hover:shadow-sm transition cursor-pointer border-l-4 dark:border-zinc-800 dark:bg-zinc-800/50 dark:hover:bg-zinc-800"
                style={{
                  borderLeftColor:
                    incident.severity === "critical"
                      ? "#ef4444"
                      : incident.severity === "high"
                      ? "#f97316"
                      : incident.severity === "medium"
                      ? "#eab308"
                      : "#3b82f6",
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-navy-900 dark:text-white">{incident.title}</h4>
                    <p className="text-xs text-navy-500 dark:text-zinc-400 mt-1">
                      Detectado: {new Date(incident.detected_at).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}
                      {incident.resolved_at && (
                        <>
                          {" · Resuelto: "}
                          {new Date(incident.resolved_at).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border ${severityColors[incident.severity]}`}>
                      {severityLabels[incident.severity]}
                    </span>
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border ${
                        incident.resolved_at
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900"
                          : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900"
                      }`}
                    >
                      {incident.resolved_at ? "Resuelto" : "Abierto"}
                    </span>
                  </div>
                </div>

                {selectedIncident?.id === incident.id && (
                  <div className="mt-4 pt-4 border-t border-navy-200 dark:border-zinc-700 space-y-3">
                    <div>
                      <p className="text-xs text-navy-500 dark:text-zinc-400 uppercase tracking-wider">Descripción</p>
                      <p className="text-sm text-navy-800 dark:text-zinc-200 mt-1">{incident.description}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-navy-500 dark:text-zinc-400 uppercase tracking-wider">Datos afectados</p>
                        <p className="text-sm text-navy-800 dark:text-zinc-200 mt-1">{incident.affected_data}</p>
                      </div>
                      <div>
                        <p className="text-xs text-navy-500 dark:text-zinc-400 uppercase tracking-wider">Usuarios afectados</p>
                        <p className="text-sm text-navy-800 dark:text-zinc-200 mt-1">{incident.affected_users}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-navy-500 dark:text-zinc-400 uppercase tracking-wider">AEPD notificada</p>
                        <p className="text-sm text-navy-800 dark:text-zinc-200 mt-1">
                          {incident.notified_aepd ? "✓ Sí" : "✗ No"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-navy-500 dark:text-zinc-400 uppercase tracking-wider">Usuarios notificados</p>
                        <p className="text-sm text-navy-800 dark:text-zinc-200 mt-1">
                          {incident.notified_users ? "✓ Sí" : "✗ No"}
                        </p>
                      </div>
                    </div>

                    {incident.resolution && (
                      <div>
                        <p className="text-xs text-navy-500 dark:text-zinc-400 uppercase tracking-wider">Resolución</p>
                        <p className="text-sm text-navy-800 dark:text-zinc-200 mt-1">{incident.resolution}</p>
                      </div>
                    )}
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
