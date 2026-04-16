"use client";

import React, { useEffect } from "react";
import { logError, formatErrorForUI } from "@/lib/error-handler";

/* ─────────────────────────────────────────────────────────────────────
 *  Global Error Boundary
 *
 *  Catches unhandled errors in the entire app (outside dashboard).
 *  Displays a friendly error message with retry option.
 *
 *  Used for: Root-level errors, layout errors, non-dashboard pages.
 *  (Dashboard has its own error.tsx for dashboard-specific errors)
 * ───────────────────────────────────────────────────────────────────── */

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log error for monitoring
    logError(error, {
      context: {
        digest: error.digest,
      },
    });
  }, [error]);

  const formatted = formatErrorForUI(error);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-navy-50 to-navy-100 px-4 py-12">
      {/* Container */}
      <div className="w-full max-w-md space-y-8 text-center">
        {/* Icon */}
        <div className="flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-100 text-red-600">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4" />
              <path d="M12 16h.01" />
            </svg>
          </div>
        </div>

        {/* Title and message */}
        <div className="space-y-3">
          <h1 className="text-3xl font-bold text-navy-900">
            {formatted.title}
          </h1>
          <p className="text-lg text-navy-600 leading-relaxed">
            {formatted.message}
          </p>
        </div>

        {/* Error code */}
        {formatted.code && (
          <div className="rounded-lg bg-navy-50 px-4 py-3">
            <p className="text-xs font-mono text-navy-500">
              Código: <span className="font-semibold">{formatted.code}</span>
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-col gap-3 pt-4">
          <button
            onClick={() => reset()}
            className="
              w-full rounded-xl bg-brand-green py-3 px-4
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
            onClick={() => window.location.href = "/"}
            className="
              w-full rounded-xl border border-navy-200 bg-white py-3 px-4
              text-sm font-semibold text-navy-700
              transition-colors duration-200
              hover:bg-navy-50
            "
          >
            Ir a inicio
          </button>
        </div>

        {/* Help text */}
        <p className="text-sm text-navy-500">
          Si el problema persiste,{" "}
          <a
            href="mailto:support@enlaze.es"
            className="text-brand-green font-medium hover:underline"
          >
            contacta con soporte
          </a>
        </p>
      </div>

      {/* Background decoration */}
      <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-brand-green/5 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-navy-900/5 blur-3xl" />
      </div>
    </div>
  );
}
