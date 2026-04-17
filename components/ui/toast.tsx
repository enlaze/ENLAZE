"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from "react";

// ─────────────────────────────────────────────────────────────
// Toast system — Sonner-style
//
//   const toast = useToast();
//   toast.success("Cliente creado");
//   toast.error("Algo fue mal", { description: "Inténtalo de nuevo" });
//   toast.info("Guardando cambios…");
//   toast({
//     title: "Archivo eliminado",
//     description: "Se eliminó correctamente",
//     variant: "success",
//     action: { label: "Deshacer", onClick: () => restore() },
//   });
// ─────────────────────────────────────────────────────────────

export type ToastVariant = "default" | "success" | "error" | "info" | "warning";

export interface ToastOptions {
  title?: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number; // ms
  action?: { label: string; onClick: () => void };
}

interface Toast extends Required<Pick<ToastOptions, "variant" | "duration">> {
  id: string;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

interface ToastContextValue {
  toast: (opts: ToastOptions | string) => string;
  success: (title: string, opts?: Omit<ToastOptions, "variant" | "title">) => string;
  error: (title: string, opts?: Omit<ToastOptions, "variant" | "title">) => string;
  info: (title: string, opts?: Omit<ToastOptions, "variant" | "title">) => string;
  warning: (title: string, opts?: Omit<ToastOptions, "variant" | "title">) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let idCounter = 0;
const genId = () => `toast-${++idCounter}-${Date.now()}`;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (input: ToastOptions | string): string => {
      const opts: ToastOptions = typeof input === "string" ? { title: input } : input;
      const id = genId();
      const t: Toast = {
        id,
        title: opts.title ?? "",
        description: opts.description,
        variant: opts.variant ?? "default",
        duration: opts.duration ?? (opts.action ? 6000 : 4000),
        action: opts.action,
      };
      setToasts((prev) => [...prev, t]);
      const timer = setTimeout(() => dismiss(id), t.duration);
      timers.current.set(id, timer);
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const current = timers.current;
    return () => {
      current.forEach((t) => clearTimeout(t));
      current.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      toast: push,
      success: (title, opts) => push({ ...opts, title, variant: "success" }),
      error: (title, opts) => push({ ...opts, title, variant: "error" }),
      info: (title, opts) => push({ ...opts, title, variant: "info" }),
      warning: (title, opts) => push({ ...opts, title, variant: "warning" }),
      dismiss,
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

// ─────────────────────────────────────────────────────────────

const variantStyles: Record<ToastVariant, { bar: string; icon: string; iconBg: string }> = {
  default: {
    bar: "bg-navy-500 dark:bg-zinc-500",
    icon: "●",
    iconBg: "bg-navy-100 text-navy-700 dark:bg-zinc-800 dark:text-zinc-300",
  },
  success: {
    bar: "bg-emerald-500",
    icon: "✓",
    iconBg:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  },
  error: {
    bar: "bg-red-500",
    icon: "✕",
    iconBg: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  },
  info: {
    bar: "bg-sky-500",
    icon: "i",
    iconBg: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  },
  warning: {
    bar: "bg-amber-500",
    icon: "!",
    iconBg:
      "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  },
};

function ToastViewport({
  toasts,
  dismiss,
}: {
  toasts: Toast[];
  dismiss: (id: string) => void;
}) {
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2 sm:bottom-6 sm:right-6"
    >
      {toasts.map((t) => {
        const style = variantStyles[t.variant];
        return (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-xl border border-navy-100 bg-white p-4 shadow-lg shadow-black/5 animate-in fade-in slide-in-from-bottom-2 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/40"
            style={{ animation: "toast-in 180ms ease-out" }}
          >
            <span className={`absolute left-0 top-0 h-full w-1 ${style.bar}`} aria-hidden />
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${style.iconBg}`}
              aria-hidden
            >
              {style.icon}
            </span>
            <div className="min-w-0 flex-1 pr-2">
              {t.title && (
                <p className="text-sm font-semibold text-navy-900 dark:text-white">
                  {t.title}
                </p>
              )}
              {t.description && (
                <p className="mt-0.5 text-sm text-navy-600 dark:text-zinc-400">
                  {t.description}
                </p>
              )}
              {t.action && (
                <button
                  onClick={() => {
                    t.action?.onClick();
                    dismiss(t.id);
                  }}
                  className="mt-2 text-xs font-semibold text-brand-green hover:underline"
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Cerrar notificación"
              className="shrink-0 rounded-md p-1 text-navy-400 hover:bg-navy-50 hover:text-navy-700 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        );
      })}
      <style jsx>{`
        @keyframes toast-in {
          from {
            opacity: 0;
            transform: translateY(8px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  );
}
