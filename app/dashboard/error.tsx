"use client";

import React, { useEffect } from "react";
import { logError, formatErrorForUI } from "@/lib/error-handler";

/* ─────────────────────────────────────────────────────────────────────
 *  Dashboard Error Boundary
 *
 *  Catches errors within the dashboard subtree.
 *  Shows error message while maintaining navigation/layout.
 *
 *  Used for: Dashboard page errors, data loading failures.
 * ───────────────────────────────────────────────────────────────────── */

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function DashboardError({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log error for monitoring
    logError(error, {
      component: "dashboard",
      context: {
        digest: error.digest,
      },
    });
  }, [error]);

  const formatted = formatErrorForUI(error);

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-navy-50 px-6 py-10 md:px-12 md:py-14">
      <div className="mx-auto max-w-2xl space-y-8">
        {/* Header */}
        <div className="space-y-3">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-red-100 text-red-600">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4" />
              <path d="M12 16h.01" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-navy-900 dark:text-white">
            {formatted.title}
          </h1>
          <p className="text-base text-navy-600 dark:text-zinc-400">
            {formatted.message}
          </p>
        </div>

        {/* Error details card */}
        <div className="rounded-2xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm">
          <div className="space-y-4">
            {/* What happened */}
            <div>
              <h2 className="text-sm font-semibold text-navy-900 dark:text-white">Qué sucedió</h2>
              <p className="mt-2 text-sm text-navy-600 dark:text-zinc-400">
                Hubo un problema al cargar los datos. Esto puede deberse a:
              </p>
              <ul className="mt-2 space-y-1 text-sm text-navy-600 dark:text-zinc-400">
                <li>Una conexión de red inestable</li>
                <li>Un problema temporal con nuestros servidores</li>
                <li>Datos que ya no están disponibles</li>
              </ul>
            </div>

            {/* Error code if available */}
            {formatted.code && (
              <div className="border-t border-navy-100 dark:border-zinc-800 pt-4">
                <p className="text-xs text-navy-500 dark:text-zinc-500">
                  <span className="font-semibold">Referencia de error:</span>{" "}
                  <code className="font-mono text-navy-600 dark:text-zinc-400">{formatted.code}</code>
                </p>
              </div>
            )}

            {/* Technical details in development */}
            {process.env.NODE_ENV === "development" && (
              <div className="border-t border-navy-100 dark:border-zinc-800 pt-4">
                <details className="cursor-pointer">
                  <summary className="text-xs font-semibold text-navy-600 dark:text-zinc-400 hover:text-navy-900 dark:text-white">
                    Detalles técnicos
                  </summary>
                  <pre className="mt-2 overflow-auto rounded bg-navy-50 p-3 text-xs text-navy-700 dark:text-zinc-300 font-mono">
                    {error.stack || error.message}
                  </pre>
                </details>
              </div>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            onClick={() => reset()}
            className="
              flex-1 rounded-xl bg-brand-green py-3 px-4
              text-sm font-semibold text-white
              transition-all duration-200
              hover:shadow-lg hover:-translate-y-[1px]
              active:translate-y-0
              shadow-md
            "
          >
            Intentar de nuevo
          </button>
          <button
            onClick={() => window.location.href = "/dashboard"}
            className="
              flex-1 rounded-xl border border-navy-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 py-3 px-4
              text-sm font-semibold text-navy-700 dark:text-zinc-300
              transition-colors duration-200
              hover:bg-navy-50 dark:hover:bg-zinc-800/50
            "
          >
            Volver al dashboard
          </button>
        </div>

        {/* Help section */}
        <div className="rounded-xl bg-sky-50 border border-sky-200 p-4">
          <p className="text-sm text-sky-900">
            <span className="font-semibold">¿Necesitas ayuda?</span> Si el problema persiste,{" "}
            <a
              href="mailto:support@enlaze.es"
              className="font-medium text-sky-700 hover:underline"
            >
              contacta con soporte
            </a>
            {" "}e incluye el código de referencia.
          </p>
        </div>
      </div>
    </div>
  );
}
