"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase-browser";
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
  dismissNotification,
  notificationIcons,
  severityColors,
  type Notification,
  type NotificationSeverity,
} from "@/lib/notifications";
import Link from "next/link";

const ITEMS_PER_PAGE = 20;

type FilterType = "all" | "unread" | "info" | "warning" | "error" | "success";

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function NotificationsPage() {
  const supabase = createClient();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>("all");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const loadNotifications = useCallback(
    async (pageNum: number, append: boolean = false) => {
      setLoading(true);
      const data = await getNotifications(
        supabase,
        ITEMS_PER_PAGE,
        pageNum * ITEMS_PER_PAGE
      );
      if (append) {
        setNotifications((prev) => [...prev, ...data]);
      } else {
        setNotifications(data);
      }
      setHasMore(data.length === ITEMS_PER_PAGE);
      setLoading(false);
    },
    [supabase]
  );

  useEffect(() => {
    loadNotifications(0); // eslint-disable-line react-hooks/set-state-in-effect
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleMarkRead(n: Notification) {
    if (n.read_at) return;
    await markAsRead(supabase, n.id);
    setNotifications((prev) =>
      prev.map((item) =>
        item.id === n.id
          ? { ...item, read_at: new Date().toISOString() }
          : item
      )
    );
  }

  async function handleMarkAllRead() {
    await markAllAsRead(supabase);
    setNotifications((prev) =>
      prev.map((n) => ({
        ...n,
        read_at: n.read_at || new Date().toISOString(),
      }))
    );
  }

  async function handleDismiss(notifId: string) {
    await dismissNotification(supabase, notifId);
    setNotifications((prev) => prev.filter((n) => n.id !== notifId));
  }

  function handleLoadMore() {
    const nextPage = page + 1;
    setPage(nextPage);
    loadNotifications(nextPage, true);
  }

  // Apply filter
  const filtered = notifications.filter((n) => {
    if (filter === "all") return true;
    if (filter === "unread") return !n.read_at;
    return n.severity === filter;
  });

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  const filterOptions: { value: FilterType; label: string }[] = [
    { value: "all", label: "Todas" },
    { value: "unread", label: `Sin leer (${unreadCount})` },
    { value: "success", label: "Éxito" },
    { value: "info", label: "Info" },
    { value: "warning", label: "Aviso" },
    { value: "error", label: "Error" },
  ];

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-navy-900 dark:text-white">Notificaciones</h1>
          <p className="text-sm text-navy-500 dark:text-zinc-500 mt-1">
            {unreadCount > 0
              ? `${unreadCount} notificación${unreadCount !== 1 ? "es" : ""} sin leer`
              : "Todas las notificaciones leídas"}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            className="self-start rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-800"
          >
            Marcar todo como leído
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        {filterOptions.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setFilter(opt.value)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === opt.value
                ? "bg-navy-900 text-white"
                : "bg-navy-50 text-navy-600 dark:text-zinc-400 hover:bg-navy-100"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Notification list */}
      {loading && notifications.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-navy-200 dark:border-zinc-800 border-t-brand-green" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 py-16 text-center">
          <p className="text-4xl mb-3">🔔</p>
          <p className="text-sm text-navy-500 dark:text-zinc-500">
            {filter === "all"
              ? "No hay notificaciones todavía"
              : "No hay notificaciones con este filtro"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((n) => {
            const icon = notificationIcons[n.type] || "🔔";
            const colors =
              severityColors[n.severity as NotificationSeverity] ||
              severityColors.info;
            const isUnread = !n.read_at;

            return (
              <div
                key={n.id}
                className={`group flex items-start gap-4 rounded-xl border p-4 transition-colors ${
                  isUnread
                    ? "border-brand-green/20 bg-brand-green/[0.02]"
                    : "border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900"
                }`}
              >
                <span
                  className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg ${colors}`}
                >
                  {icon}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      {n.action_url ? (
                        <Link
                          href={n.action_url}
                          onClick={() => handleMarkRead(n)}
                          className={`text-sm leading-snug hover:underline ${
                            isUnread
                              ? "font-semibold text-navy-900 dark:text-white"
                              : "text-navy-700 dark:text-zinc-300"
                          }`}
                        >
                          {n.title}
                        </Link>
                      ) : (
                        <p
                          className={`text-sm leading-snug ${
                            isUnread
                              ? "font-semibold text-navy-900 dark:text-white"
                              : "text-navy-700 dark:text-zinc-300"
                          }`}
                        >
                          {n.title}
                        </p>
                      )}
                      {n.body && (
                        <p className="mt-1 text-xs text-navy-500 dark:text-zinc-500">{n.body}</p>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {isUnread && (
                        <span className="h-2.5 w-2.5 rounded-full bg-brand-green" />
                      )}
                    </div>
                  </div>

                  <div className="mt-2 flex items-center gap-3">
                    <span className="text-[11px] text-navy-400 dark:text-zinc-500">
                      {formatDate(n.created_at)}
                    </span>
                    {n.entity_type && (
                      <span className="rounded bg-navy-50 px-1.5 py-0.5 text-[10px] font-medium text-navy-500 dark:text-zinc-500 uppercase">
                        {n.entity_type}
                      </span>
                    )}
                    <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {isUnread && (
                        <button
                          onClick={() => handleMarkRead(n)}
                          className="rounded px-2 py-1 text-[11px] text-navy-500 dark:text-zinc-500 hover:bg-navy-50 dark:hover:bg-zinc-800/50 hover:text-navy-700 dark:text-zinc-300"
                        >
                          Marcar leída
                        </button>
                      )}
                      <button
                        onClick={() => handleDismiss(n.id)}
                        className="rounded px-2 py-1 text-[11px] text-navy-500 dark:text-zinc-500 hover:bg-red-50 hover:text-red-600"
                      >
                        Descartar
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Load more */}
          {hasMore && (
            <div className="pt-4 text-center">
              <button
                onClick={handleLoadMore}
                disabled={loading}
                className="rounded-lg bg-navy-50 px-6 py-2 text-sm font-medium text-navy-600 dark:text-zinc-400 transition-colors hover:bg-navy-100 disabled:opacity-50"
              >
                {loading ? "Cargando..." : "Cargar más"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
