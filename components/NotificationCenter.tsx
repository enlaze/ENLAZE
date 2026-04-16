"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase-browser";
import Link from "next/link";
import {
  getUnreadCount,
  getNotifications,
  markAsRead,
  markAllAsRead,
  dismissNotification,
  notificationIcons,
  severityColors,
  type Notification,
  type NotificationSeverity,
} from "@/lib/notifications";

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 60) return "ahora";
  if (diffSec < 3600) return `hace ${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `hace ${Math.floor(diffSec / 3600)}h`;
  if (diffSec < 604800) return `hace ${Math.floor(diffSec / 86400)}d`;
  return new Date(dateStr).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
  });
}

export default function NotificationCenter() {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);

  const refreshCount = useCallback(async () => {
    const count = await getUnreadCount(supabase);
    setUnreadCount(count);
  }, [supabase]);

  // Poll unread count every 30s
  useEffect(() => {
    refreshCount(); // eslint-disable-line react-hooks/set-state-in-effect
    const interval = setInterval(refreshCount, 30000);
    return () => clearInterval(interval);
  }, [refreshCount]);

  // Load notifications when dropdown opens
  useEffect(() => {
    if (open) {
      setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect
      getNotifications(supabase, 10).then((data) => {
        setNotifications(data);
        setLoading(false);
      });
    }
  }, [open, supabase]);

  async function handleMarkAllRead() {
    await markAllAsRead(supabase);
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() }))
    );
    setUnreadCount(0);
  }

  async function handleClickNotification(n: Notification) {
    if (!n.read_at) {
      await markAsRead(supabase, n.id);
      setNotifications((prev) =>
        prev.map((item) =>
          item.id === n.id ? { ...item, read_at: new Date().toISOString() } : item
        )
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    }
    setOpen(false);
  }

  async function handleDismiss(e: React.MouseEvent, notifId: string) {
    e.stopPropagation();
    e.preventDefault();
    await dismissNotification(supabase, notifId);
    setNotifications((prev) => prev.filter((n) => n.id !== notifId));
    // Refresh count in case we dismissed an unread one
    refreshCount();
  }

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notificaciones"
        className="relative flex h-10 w-10 items-center justify-center rounded-xl text-navy-600 transition-colors hover:bg-navy-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute right-1.5 top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand-green px-1 text-[10px] font-bold text-white ring-2 ring-white dark:ring-zinc-950">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-80 sm:w-96 overflow-hidden rounded-xl border border-navy-100 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/40">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-navy-100 px-4 py-3 dark:border-zinc-800">
              <h3 className="text-sm font-semibold text-navy-900 dark:text-white">
                Notificaciones
              </h3>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    className="text-xs text-brand-green hover:underline dark:hover:text-brand-green-light"
                  >
                    Marcar todo leído
                  </button>
                )}
                <Link
                  href="/dashboard/notifications"
                  onClick={() => setOpen(false)}
                  className="text-xs text-navy-500 hover:text-navy-700 dark:text-zinc-400 dark:hover:text-zinc-300"
                >
                  Ver todas
                </Link>
              </div>
            </div>

            {/* List */}
            <div className="max-h-80 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-navy-200 border-t-brand-green dark:border-zinc-800 dark:border-t-brand-green" />
                </div>
              ) : notifications.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-sm text-navy-400 dark:text-zinc-500">
                    No hay notificaciones
                  </p>
                </div>
              ) : (
                notifications.map((n) => {
                  const icon = notificationIcons[n.type] || "🔔";
                  const colors =
                    severityColors[n.severity as NotificationSeverity] ||
                    severityColors.info;
                  const isUnread = !n.read_at;

                  const content = (
                    <div
                      className={`group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-navy-50 dark:hover:bg-zinc-800 ${
                        isUnread ? "bg-brand-green/[0.03] dark:bg-brand-green/[0.05]" : ""
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm ${colors}`}
                      >
                        {icon}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-sm leading-snug ${
                            isUnread
                              ? "font-semibold text-navy-900 dark:text-white"
                              : "text-navy-700 dark:text-zinc-300"
                          }`}
                        >
                          {n.title}
                        </p>
                        {n.body && (
                          <p className="mt-0.5 text-xs text-navy-500 line-clamp-2 dark:text-zinc-400">
                            {n.body}
                          </p>
                        )}
                        <p className="mt-1 text-[11px] text-navy-400 dark:text-zinc-500">
                          {timeAgo(n.created_at)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {isUnread && (
                          <span className="h-2 w-2 rounded-full bg-brand-green" />
                        )}
                        <button
                          onClick={(e) => handleDismiss(e, n.id)}
                          className="hidden h-6 w-6 items-center justify-center rounded text-navy-400 hover:bg-navy-100 hover:text-navy-600 group-hover:flex dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                          title="Descartar"
                        >
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M18 6 6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  );

                  if (n.action_url) {
                    return (
                      <Link
                        key={n.id}
                        href={n.action_url}
                        onClick={() => handleClickNotification(n)}
                      >
                        {content}
                      </Link>
                    );
                  }

                  return (
                    <div
                      key={n.id}
                      onClick={() => handleClickNotification(n)}
                      className="cursor-pointer"
                    >
                      {content}
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            {notifications.length > 0 && (
              <div className="border-t border-navy-100 px-4 py-2 dark:border-zinc-800">
                <Link
                  href="/dashboard/notifications"
                  onClick={() => setOpen(false)}
                  className="block text-center text-xs text-navy-500 hover:text-brand-green dark:text-zinc-400 dark:hover:text-brand-green"
                >
                  Ver todas las notificaciones
                </Link>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
