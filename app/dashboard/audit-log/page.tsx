"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import PageHeader from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { FormField, Select, SearchInput } from "@/components/ui/form-fields";
import { Button } from "@/components/ui/button";
import Badge from "@/components/ui/badge";
import EmptyState from "@/components/ui/empty-state";
import Loading from "@/components/ui/loading";

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

const entityVariant: Record<
  string,
  "green" | "blue" | "yellow" | "red" | "gray" | "purple" | "orange"
> = {
  budget: "green",
  invoice: "blue",
  issued_invoice: "purple",
  project: "orange",
  project_change: "yellow",
  client: "gray",
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

  const getEntityIcon = (entityType: string): string =>
    entityIcons[entityType] || "📌";

  const getEntityLabel = (entityType: string): string =>
    entityLabels[entityType] || entityType;

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
    if (!metadata || Object.keys(metadata).length === 0) return "—";
    const preview = JSON.stringify(metadata);
    return preview.length > 140 ? preview.substring(0, 140) + "…" : preview;
  };

  return (
    <>
      <PageHeader
        title="Registro de Actividad"
        description="Historial de cambios en tu cuenta"
      />

      <Card className="mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Filtrar por tipo">
            <Select
              value={selectedEntityType}
              onChange={(e) => handleFilterChange(e.target.value)}
            >
              <option value="all">Todos los tipos</option>
              <option value="budget">Presupuesto</option>
              <option value="invoice">Factura Recibida</option>
              <option value="issued_invoice">Factura Emitida</option>
              <option value="project">Proyecto</option>
              <option value="project_change">Cambio de Proyecto</option>
              <option value="client">Cliente</option>
            </Select>
          </FormField>

          <FormField label="Buscar acción">
            <SearchInput
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder="Escribe para buscar..."
            />
          </FormField>
        </div>
      </Card>

      {loading && activities.length === 0 ? (
        <Loading />
      ) : activities.length === 0 ? (
        <EmptyState
          title="Sin actividad"
          description="No hay actividad registrada que coincida con los filtros"
        />
      ) : (
        <>
          <div className="space-y-3">
            {activities.map((activity) => (
              <div
                key={activity.id}
                className="rounded-2xl border border-navy-100 bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none"
              >
                <div className="flex items-start gap-4">
                  <div className="mt-0.5 flex-shrink-0 text-2xl leading-none">
                    {getEntityIcon(activity.entity_type)}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-navy-900 dark:text-white">
                        {activity.action}
                      </h3>
                      <Badge variant={entityVariant[activity.entity_type] || "gray"}>
                        {getEntityLabel(activity.entity_type)}
                      </Badge>
                    </div>

                    <p className="mb-2 font-mono text-xs text-navy-500 dark:text-zinc-500">
                      ID: {activity.entity_id}
                    </p>

                    <div className="mb-2 rounded-lg border border-navy-100 bg-navy-50/60 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-800/40">
                      <code className="block break-all font-mono text-xs text-navy-700 dark:text-zinc-300">
                        {getMetadataPreview(activity.metadata)}
                      </code>
                    </div>

                    <p className="text-xs text-navy-500 dark:text-zinc-500">
                      {formatTimestamp(activity.created_at)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {hasMore && (
            <div className="flex justify-center pt-6">
              <Button
                onClick={handleLoadMore}
                disabled={loading}
                variant="secondary"
              >
                {loading ? "Cargando..." : "Cargar más"}
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
