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
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";

// ─────────────────────────────────────────────────────────────
// ConfirmDialog — replace browser confirm() with a custom modal.
//
// Usage:
//   const confirm = useConfirm();
//
//   const ok = await confirm({
//     title: "Eliminar cliente",
//     description: "Esta acción no se puede deshacer.",
//     variant: "danger",
//     confirmLabel: "Eliminar",
//   });
//   if (ok) doDelete();
//
// Para acciones irreversibles se puede exigir que el usuario escriba una
// palabra exacta antes de habilitar el botón de confirmar:
//
//   await confirm({ ..., requireText: "ELIMINAR" });
// ─────────────────────────────────────────────────────────────

export type ConfirmVariant = "default" | "danger" | "warning";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  /** Contenido extra entre la descripción y el pie (p. ej. lista de datos afectados). */
  details?: ReactNode;
  /**
   * Si se indica, el usuario debe escribir este texto exacto para habilitar
   * el botón de confirmar. Pensado para acciones irreversibles.
   */
  requireText?: string;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [typedText, setTypedText] = useState("");
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    setOpts(options);
    setTypedText("");
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const resolve = useCallback((v: boolean) => {
    setOpen(false);
    resolver.current?.(v);
    resolver.current = null;
  }, []);

  // El Dialog enfoca su primer elemento focusable; con requireText queremos
  // que sea el input de confirmación.
  useEffect(() => {
    if (!open || !opts?.requireText) return;
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open, opts?.requireText]);

  const value = useMemo(() => confirm, [confirm]);

  const variant = opts?.variant ?? "default";
  const confirmClass =
    variant === "danger"
      ? "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600"
      : variant === "warning"
        ? "bg-amber-500 text-navy-900 hover:bg-amber-600 focus-visible:ring-amber-500"
        : "bg-brand-green text-white hover:bg-brand-green-dark focus-visible:ring-brand-green";

  const iconConfig = {
    default: {
      bg: "bg-brand-green/10 text-brand-green",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
      ),
    },
    danger: {
      bg: "bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          <path d="M10 11v6M14 11v6" />
        </svg>
      ),
    },
    warning: {
      bg: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" />
        </svg>
      ),
    },
  }[variant];

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Dialog
        open={open}
        onClose={() => resolve(false)}
        widthClass="max-w-md"
        labelledBy="confirm-title"
        describedBy="confirm-desc"
      >
        {opts && (
          <>
            <div className="flex gap-4">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${iconConfig.bg}`}>
                {iconConfig.icon}
              </div>
              <DialogHeader>
                <DialogTitle id="confirm-title">{opts.title}</DialogTitle>
                {opts.description && (
                  <DialogDescription id="confirm-desc">
                    {opts.description}
                  </DialogDescription>
                )}
              </DialogHeader>
            </div>
            {opts.details}
            {opts.requireText && (
              <div className="mt-4 flex flex-col gap-1.5">
                <label
                  htmlFor="confirm-require-text"
                  className="text-[13.5px] text-navy-700 dark:text-zinc-300"
                >
                  Escribe <span className="font-bold tracking-wide">{opts.requireText}</span> para
                  confirmar
                </label>
                <input
                  id="confirm-require-text"
                  ref={inputRef}
                  type="text"
                  value={typedText}
                  onChange={(e) => setTypedText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && typedText === opts.requireText) resolve(true);
                  }}
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby="confirm-desc"
                  className="w-full rounded-[10px] border border-navy-200 bg-white px-3.5 py-2.5 text-[14.5px] tracking-wide text-navy-900 outline-none placeholder:text-navy-400 focus:border-red-500 focus:ring-[3px] focus:ring-red-500/15 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder:text-zinc-600"
                  placeholder={opts.requireText}
                />
              </div>
            )}
            <DialogFooter>
              <button
                type="button"
                onClick={() => resolve(false)}
                className="inline-flex items-center justify-center rounded-xl border border-navy-200 bg-white px-4 py-2.5 text-sm font-medium text-navy-800 transition-colors hover:bg-navy-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400 focus-visible:ring-offset-2 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus-visible:ring-zinc-600 dark:focus-visible:ring-offset-zinc-900"
              >
                {opts.cancelLabel ?? "Cancelar"}
              </button>
              <button
                type="button"
                autoFocus={!opts.requireText}
                disabled={!!opts.requireText && typedText !== opts.requireText}
                onClick={() => resolve(true)}
                className={`inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 dark:focus-visible:ring-offset-zinc-900 ${confirmClass}`}
              >
                {opts.confirmLabel ?? "Confirmar"}
              </button>
            </DialogFooter>
          </>
        )}
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ctx;
}
