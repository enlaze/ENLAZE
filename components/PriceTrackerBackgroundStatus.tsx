"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface TrackerRequest {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  progress?: {
    completed?: number;
    total?: number;
    label?: string;
  } | null;
  result?: {
    products?: number;
  } | null;
  error?: string | null;
}

const POLL_INTERVAL_MS = 5000;
const TERMINAL_VISIBLE_MS = 12000;

export default function PriceTrackerBackgroundStatus() {
  const pathname = usePathname();
  const activeRequestId = useRef<string | null>(null);
  const [request, setRequest] = useState<TrackerRequest | null>(null);

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;

    const schedule = (callback: () => void, milliseconds: number) => {
      timer = window.setTimeout(callback, milliseconds);
    };

    const poll = async () => {
      try {
        const requestId = activeRequestId.current;
        const endpoint = requestId
          ? `/api/prices/n8n-sync?id=${encodeURIComponent(requestId)}`
          : "/api/prices/n8n-sync?active=1";
        const response = await fetch(endpoint, { cache: "no-store" });

        if (disposed) return;

        if (response.status === 404) {
          activeRequestId.current = null;
          setRequest(null);
          schedule(poll, POLL_INTERVAL_MS);
          return;
        }

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.request) {
          schedule(poll, POLL_INTERVAL_MS);
          return;
        }

        const nextRequest = payload.request as TrackerRequest;
        setRequest(nextRequest);

        if (
          nextRequest.status === "pending" ||
          nextRequest.status === "running"
        ) {
          activeRequestId.current = nextRequest.id;
          schedule(poll, POLL_INTERVAL_MS);
          return;
        }

        activeRequestId.current = null;
        schedule(() => {
          if (disposed) return;
          setRequest(null);
          poll();
        }, TERMINAL_VISIBLE_MS);
      } catch {
        if (!disposed) schedule(poll, POLL_INTERVAL_MS);
      }
    };

    poll();

    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  if (!request || pathname === "/dashboard/prices") return null;

  const total = Math.max(1, request.progress?.total ?? 5);
  const completed =
    request.status === "completed"
      ? total
      : Math.min(total, Math.max(0, request.progress?.completed ?? 0));
  const percentage = Math.round((completed / total) * 100);
  const isFailed = request.status === "failed";
  const isCompleted = request.status === "completed";

  const title = isFailed
    ? "El rastreo necesita atención"
    : isCompleted
      ? "Rastreo completado"
      : "Rastreando el mercado";

  const description = isFailed
    ? request.error || "No se pudo completar el rastreo"
    : isCompleted
      ? `${request.result?.products || 0} precios procesados`
      : request.progress?.label || "El rastreador sigue trabajando";

  return (
    <aside
      aria-live="polite"
      className={`fixed bottom-5 right-5 z-50 w-[min(360px,calc(100vw-2.5rem))] rounded-2xl border bg-white p-4 shadow-xl dark:bg-zinc-900 ${
        isFailed
          ? "border-red-200 dark:border-red-900"
          : "border-brand-green/30 dark:border-brand-green/30"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
            isFailed
              ? "bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400"
              : "bg-brand-green/10 text-brand-green"
          }`}
        >
          {isCompleted ? (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m5 12 4 4L19 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : isFailed ? (
            <span className="text-lg font-bold">!</span>
          ) : (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-navy-900 dark:text-white">
              {title}
            </p>
            {!isFailed && (
              <span className="text-xs font-semibold tabular-nums text-brand-green">
                {percentage}%
              </span>
            )}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-navy-500 dark:text-zinc-400">
            {description}
          </p>

          {!isFailed && (
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-navy-100 dark:bg-zinc-800">
              <div
                className="h-full rounded-full bg-brand-green transition-[width] duration-500"
                style={{ width: `${percentage}%` }}
              />
            </div>
          )}

          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-[11px] text-navy-400 dark:text-zinc-500">
              {isCompleted || isFailed
                ? "Proceso finalizado"
                : "Puedes seguir usando ENLAZE"}
            </span>
            <Link
              href="/dashboard/prices"
              className="text-xs font-semibold text-brand-green hover:underline"
            >
              Ver rastreador
            </Link>
          </div>
        </div>
      </div>
    </aside>
  );
}
