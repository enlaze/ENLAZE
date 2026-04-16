"use client";

import React, { useState } from "react";

/* ─────────────────────────────────────────────────────────────────────
 *  ErrorAlert — Reusable inline error/warning component
 *
 *  Used for form errors, missing data, and other inline notifications.
 *  Dismissible by default. Appears above content.
 * ───────────────────────────────────────────────────────────────────── */

interface ErrorAlertProps {
  title: string;
  message: string;
  /** "error" | "warning" | "info" */
  variant?: "error" | "warning" | "info";
  /** Show close button */
  dismissible?: boolean;
  /** Callback when dismissed */
  onDismiss?: () => void;
  /** Optional action button */
  action?: {
    label: string;
    onClick: () => void | Promise<void>;
  };
  /** Custom className for container */
  className?: string;
}

export function ErrorAlert({
  title,
  message,
  variant = "error",
  dismissible = true,
  onDismiss,
  action,
  className = "",
}: ErrorAlertProps) {
  const [isDismissed, setIsDismissed] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);

  if (isDismissed) return null;

  /* ── Color scheme by variant ─────────────────────────────────── */
  const variantStyles = {
    error: {
      bg: "bg-red-50 dark:bg-red-950/30",
      border: "border-red-200 dark:border-red-900/50",
      title: "text-red-900 dark:text-red-200",
      text: "text-red-700 dark:text-red-300/90",
      icon: "text-red-500 dark:text-red-400",
      button: "hover:bg-red-100 text-red-600 dark:hover:bg-red-900/40 dark:text-red-400",
      action: "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-200 dark:hover:bg-red-900/60",
    },
    warning: {
      bg: "bg-amber-50 dark:bg-amber-950/30",
      border: "border-amber-200 dark:border-amber-900/50",
      title: "text-amber-900 dark:text-amber-200",
      text: "text-amber-700 dark:text-amber-300/90",
      icon: "text-amber-500 dark:text-amber-400",
      button: "hover:bg-amber-100 text-amber-600 dark:hover:bg-amber-900/40 dark:text-amber-400",
      action: "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:hover:bg-amber-900/60",
    },
    info: {
      bg: "bg-sky-50 dark:bg-sky-950/30",
      border: "border-sky-200 dark:border-sky-900/50",
      title: "text-sky-900 dark:text-sky-200",
      text: "text-sky-700 dark:text-sky-300/90",
      icon: "text-sky-500 dark:text-sky-400",
      button: "hover:bg-sky-100 text-sky-600 dark:hover:bg-sky-900/40 dark:text-sky-400",
      action: "bg-sky-100 text-sky-700 hover:bg-sky-200 dark:bg-sky-900/40 dark:text-sky-200 dark:hover:bg-sky-900/60",
    },
  };

  const styles = variantStyles[variant];

  /* ── Icon by variant ────────────────────────────────────────── */
  const getIcon = () => {
    if (variant === "error") {
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4" />
          <path d="M12 16h.01" />
        </svg>
      );
    }
    if (variant === "warning") {
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m10.3 2.3.4.7-8.3 14.3a1.7 1.7 0 0 0 1.5 2.6h16.4a1.7 1.7 0 0 0 1.5-2.6L13.3 3a1.7 1.7 0 0 0-3 0z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
      );
    }
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
      </svg>
    );
  };

  const handleDismiss = () => {
    setIsDismissed(true);
    onDismiss?.();
  };

  const handleAction = async () => {
    if (!action) return;
    setIsActionLoading(true);
    try {
      await action.onClick();
    } finally {
      setIsActionLoading(false);
    }
  };

  return (
    <div
      className={`
        rounded-xl border ${styles.bg} ${styles.border}
        p-4 shadow-sm
        ${className}
      `}
      role="alert"
    >
      <div className="flex gap-3">
        {/* Icon */}
        <div className={`flex shrink-0 items-start pt-0.5 ${styles.icon}`}>
          {getIcon()}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h3 className={`text-sm font-semibold ${styles.title}`}>
            {title}
          </h3>
          <p className={`mt-1 text-sm leading-relaxed ${styles.text}`}>
            {message}
          </p>

          {/* Action button */}
          {action && (
            <button
              onClick={handleAction}
              disabled={isActionLoading}
              className={`
                mt-3 inline-flex items-center gap-2 rounded-lg px-3 py-1.5
                text-sm font-medium transition-colors
                ${styles.action}
                disabled:opacity-50 disabled:cursor-not-allowed
              `}
            >
              {isActionLoading ? (
                <>
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Cargando...
                </>
              ) : (
                action.label
              )}
            </button>
          )}
        </div>

        {/* Close button */}
        {dismissible && (
          <button
            onClick={handleDismiss}
            aria-label="Cerrar alerta"
            className={`
              flex shrink-0 items-start pt-0.5 px-1 py-1 rounded-md
              transition-colors ${styles.button}
            `}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M18 6l-12 12" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

export default ErrorAlert;
