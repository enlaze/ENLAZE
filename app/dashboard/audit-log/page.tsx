"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

interface ActivityLog {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

const ITEMS_PER_PAGE = 25;

const entityIcons: Record<string, string> = {
  budget: "💰",
  invoice: "📄",
  issued_invoice: "📮",
  project: "📋",
  project_change: "🔄",
  client: "👥",
};

const entityLabels: Record<string, string> = {
  budget: "Presupuesto",
  invoice: "Factura Recibida",
  issued_invoice: "Factura Emitida",
  project: "Proyecto",
  project_change: "Cambio de Proyecto",
  client: "Cliente",
};

export default function AuditLogPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [selectedEntityType, setSelectedEntityType] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [displayCount, setDisplayCount] = useState(ITEMS_PER_PAGE);

  async function getCurrentUser() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id || null;
  }

  async function loadActivities(
    entityFilter: string,
    search: string,
    limit: number
  ) {
    const currentUserId = await getCurrentUser();
    if (!currentUserId) {
      setLoading(false);
      return;
    }

    let query = supabase
      .from("activity_log")
      .select("*", { count: "exact" })
      .eq("user_id", currentUserId)
      .order("created_at", { ascending: false });

    if (entityFilter !== "all") {
      query = query.eq("entity_type", entityFilter);
    }

    if (search.trim()) {
      query = query.ilike("action", `%${search}%`);
    }

    const { data, count, error } = await query.range(0, limit - 1);

    if (error) {
      console.error("Error loading activities:", error);
      setActivities([]);
      setHasMore(false);
    } else {
      setActivities(data || []);
      setHasMore((count || 0) > limit);
    }

    setLoading(false);
  }

  async function handleFilterChange(entityType: string) {
    setSelectedEntityType(entityType);
    setDisplayCount(ITEMS_PER_PAGE);
    setLoading(true);
    await loadActivities(entityType, searchQuery, ITEMS_PER_PAGE);
  }

  async function handleSearchChange(query: string) {
    setSearchQuery(query);
    setDisplayCount(ITEMS_PER_PAGE);
    setLoading(true);
    await loadActivities(selectedEntityType, query, ITEMS_PER_PAGE);
  }

  async function handleLoadMore() {
    const newCount = displayCount + ITEMS_PER_PAGE;
    setDisplayCount(newCount);
    setLoading(true);
    await loadActivities(selectedEntityType, searchQuery, newCount);
  }

  useEffect(() => {
    loadActivities(selectedEntityType, searchQuery, ITEMS_PER_PAGE); // eslint-disable-line react-hooks/set-state-in-effect
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const getEntityIcon = (entityType: string): string => {
    return entityIcons[entityType] || "📌";
  };

  const getEntityLabel = (entityType: string): string => {
    return entityLabels[entityType] || entityType;
  };

  const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "hace unos segundos";
    if (diffMins < 60) return `hace ${diffMins} min`;
    if (diffHours < 24) return `hace ${diffHours} h`;
    if (diffDays < 7) return `hace ${diffDays} días`;

    return date.toLocaleDateString("es-ES", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getMetadataPreview = (metadata: Record<string, unknown>): string => {
    const preview = JSON.stringify(metadata);
    return preview.length > 100 ? preview.substring(0, 100) + "..." : preview;
  };

  return (
    <>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[var(--color-navy-900)]">
          Registro de Actividad
        </h1>
        <p className="mt-1 text-[var(--color-navy-600)]">
          Historial de cambios en tu cuenta
        </p>
      </div>

      <div className="space-y-6">
        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--color-navy-700)] mb-2">
              Filtrar por tipo
            </label>
            <select
              value={selectedEntityType}
              onChange={(e) => handleFilterChange(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-[var(--color-navy-200)] bg-[var(--color-navy-50)] text-[var(--color-navy-900)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-green)]/50"
            >
              <option value="all">Todos los tipos</option>
              <option value="budget">Presupuesto</option>
              <option value="invoice">Factura Recibida</option>
              <option value="issued_invoice">Factura Emitida</option>
              <option value="project">Proyecto</option>
              <option value="project_change">Cambio de Proyecto</option>
              <option value="client">Cliente</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--color-navy-700)] mb-2">
              Buscar acción
            </label>
            <input
              type="text"
              placeholder="Escribe para buscar..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-[var(--color-navy-200)] bg-[var(--color-navy-50)] text-[var(--color-navy-900)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-green)]/50 placeholder-[var(--color-navy-500)]"
            />
          </div>
        </div>

        {/* Loading state */}
        {loading && activities.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-brand-green)]"></div>
          </div>
        ) : activities.length === 0 ? (
          <div className="rounded-2xl border border-[var(--color-navy-100)] bg-[var(--color-navy-800)] p-8 text-center">
            <p className="text-[var(--color-navy-400)]">
              No hay actividad registrada que coincida con los filtros
            </p>
          </div>
        ) : (
          <>
            {/* Activity list */}
            <div className="space-y-3">
              {activities.map((activity) => (
                <div
                  key={activity.id}
                  className="rounded-xl border border-[var(--color-navy-100)] bg-[var(--color-navy-800)] p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start gap-4">
                    <div className="text-2xl flex-shrink-0 mt-0.5">
                      {getEntityIcon(activity.entity_type)}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <h3 className="text-sm font-semibold text-[var(--color-navy-100)]">
                          {activity.action}
                        </h3>
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[var(--color-brand-green)]/20 text-[var(--color-brand-green)]">
                          {getEntityLabel(activity.entity_type)}
                        </span>
                      </div>

                      <p className="text-xs text-[var(--color-navy-500)] mb-2">
                        ID: {activity.entity_id}
                      </p>

                      <div className="bg-[var(--color-navy-900)] rounded-lg p-2 mb-2">
                        <code className="text-xs text-[var(--color-navy-400)] font-mono break-all">
                          {getMetadataPreview(activity.metadata)}
                        </code>
                      </div>

                      <p className="text-xs text-[var(--color-navy-500)]">
                        {formatTimestamp(activity.created_at)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Load More button */}
            {hasMore && (
              <div className="flex justify-center pt-6">
                <button
                  onClick={handleLoadMore}
                  disabled={loading}
                  className="px-6 py-2.5 rounded-xl bg-[var(--color-brand-green)] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {loading ? "Cargando..." : "Cargar más"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
