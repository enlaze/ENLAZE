"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { Card } from "@/components/ui/card";
import { FormField, Select, SearchInput } from "@/components/ui/form-fields";
import { Button } from "@/components/ui/button";
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

type IconName =
  | "wallet"
  | "fileText"
  | "send"
  | "clipboardList"
  | "refreshCw"
  | "users"
  | "pin";

/* Inline icon paths (lucide-style), matching the rest of the app's SVG icons. */
const iconPaths: Record<IconName, React.ReactNode> = {
  wallet: (
    <>
      <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
      <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
    </>
  ),
  fileText: (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
      <path d="M10 9H8" />
    </>
  ),
  send: (
    <>
      <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
      <path d="m21.854 2.147-10.94 10.939" />
    </>
  ),
  clipboardList: (
    <>
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M12 11h4" />
      <path d="M12 16h4" />
      <path d="M8 11h.01" />
      <path d="M8 16h.01" />
    </>
  ),
  refreshCw: (
    <>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  pin: (
    <>
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </>
  ),
};

function EntityIcon({ name }: { name: IconName }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconPaths[name]}
    </svg>
  );
}

const entityIcons: Record<string, IconName> = {
  budget: "wallet",
  invoice: "fileText",
  issued_invoice: "send",
  project: "clipboardList",
  project_change: "refreshCw",
  client: "users",
};

const entityLabels: Record<string, string> = {
  budget: "Presupuesto",
  invoice: "Factura Recibida",
  issued_invoice: "Factura Emitida",
  project: "Proyecto",
  project_change: "Cambio de Proyecto",
  client: "Cliente",
};

type EntityColor = "green" | "blue" | "yellow" | "red" | "gray" | "purple" | "orange";

const entityVariant: Record<string, EntityColor> = {
  budget: "green",
  invoice: "blue",
  issued_invoice: "purple",
  project: "orange",
  project_change: "yellow",
  client: "gray",
};

/* Pill badge, per entity colour. Green/gray hexes come from the design. */
const badgeStyles: Record<EntityColor, string> = {
  green: "bg-[#e6faf4] text-[#00795b] border-[#bdeede] dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60",
  blue: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/60",
  yellow: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60",
  red: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800/60",
  gray: "bg-[#eef2f6] text-[#475569] border-[#e2e8f0] dark:bg-zinc-800/60 dark:text-zinc-300 dark:border-zinc-800",
  purple: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800/60",
  orange: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800/60",
};

/* Tinted circle behind the row icon, following the same entity colour. */
const iconWrapStyles: Record<EntityColor, string> = {
  green: "bg-[#e6faf4] text-[#00a37b] dark:bg-emerald-950/40 dark:text-emerald-300",
  blue: "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300",
  yellow: "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300",
  red: "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300",
  gray: "bg-[#eef2f6] text-[#64748b] dark:bg-zinc-800/60 dark:text-zinc-300",
  purple: "bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-300",
  orange: "bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-300",
};

export default function AuditLogPage() {
  const supabase = createClient();

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

  const getEntityIcon = (entityType: string): IconName =>
    entityIcons[entityType] || "pin";

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
    <div className="mx-auto max-w-[880px]">
      <h1 className="text-[32px] font-bold tracking-[-0.02em] text-[#0f172a] dark:text-white">
        Registro de Actividad
      </h1>
      <p className="mb-7 mt-2 text-[15px] text-[#64748b] dark:text-zinc-400">
        Historial de cambios en tu cuenta
      </p>

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
          <div className="flex flex-col gap-3">
            {activities.map((activity) => {
              const color = entityVariant[activity.entity_type] || "gray";
              return (
                <div
                  key={activity.id}
                  className="flex items-start gap-[18px] rounded-[14px] border border-[#e8edf2] bg-white px-6 py-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none"
                >
                  <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${iconWrapStyles[color]}`}>
                    <EntityIcon name={getEntityIcon(activity.entity_type)} />
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h3 className="font-mono text-[15.5px] font-semibold text-[#0f172a] dark:text-white">
                        {activity.action}
                      </h3>
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-[3px] text-[12.5px] font-semibold ${badgeStyles[color]}`}>
                        {getEntityLabel(activity.entity_type)}
                      </span>
                    </div>

                    <p className="font-mono text-[13px] text-[#94a3b8] dark:text-zinc-500">
                      ID: {activity.entity_id}
                    </p>

                    <div className="overflow-x-auto rounded-[10px] border border-[#eef2f6] bg-[#f6f8fa] px-4 py-3 dark:border-zinc-800 dark:bg-zinc-800/40">
                      <code className="block break-all font-mono text-[13px] text-[#475569] dark:text-zinc-300">
                        {getMetadataPreview(activity.metadata)}
                      </code>
                    </div>

                    <p className="text-[13px] text-[#94a3b8] dark:text-zinc-500">
                      {formatTimestamp(activity.created_at)}
                    </p>
                  </div>
                </div>
              );
            })}
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
    </div>
  );
}
