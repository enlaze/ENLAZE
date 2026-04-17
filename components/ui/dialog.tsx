"use client";

import { ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

// ─────────────────────────────────────────────────────────────
// Base Dialog — used by ConfirmDialog, ShortcutsOverlay, etc.
// Handles overlay, focus trap, Esc-to-close, scroll lock.
// ─────────────────────────────────────────────────────────────

interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  labelledBy?: string;
  describedBy?: string;
  widthClass?: string; // e.g. "max-w-md"
  dismissable?: boolean; // Esc + overlay click close
}

export function Dialog({
  open,
  onClose,
  children,
  labelledBy,
  describedBy,
  widthClass = "max-w-md",
  dismissable = true,
}: DialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Scroll lock + Escape handler
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKey(e: KeyboardEvent) {
      if (dismissable && e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      // Trap focus (basic — Tab/Shift+Tab cycle inside dialog)
      if (e.key === "Tab" && contentRef.current) {
        const focusables = contentRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);

    // Focus first focusable inside dialog
    const t = setTimeout(() => {
      const el = contentRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      el?.focus();
    }, 20);

    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
      clearTimeout(t);
    };
  }, [open, onClose, dismissable]);

  if (!open || typeof window === "undefined") return null;

  return createPortal(
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onClick={(e) => {
        if (dismissable && e.target === overlayRef.current) onClose();
      }}
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 px-4 pb-6 pt-16 backdrop-blur-sm sm:items-center sm:p-6"
      style={{ animation: "dialog-overlay-in 150ms ease-out" }}
    >
      <div
        ref={contentRef}
        className={`relative w-full ${widthClass} rounded-2xl border border-navy-100 bg-white p-6 shadow-2xl shadow-black/10 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/50`}
        style={{ animation: "dialog-content-in 180ms cubic-bezier(0.16,1,0.3,1)" }}
      >
        {children}
      </div>
      <style jsx global>{`
        @keyframes dialog-overlay-in {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes dialog-content-in {
          from {
            opacity: 0;
            transform: translateY(10px) scale(0.97);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>,
    document.body,
  );
}

export function DialogHeader({ children }: { children: ReactNode }) {
  return <div className="mb-4">{children}</div>;
}

export function DialogTitle({
  id,
  children,
}: {
  id?: string;
  children: ReactNode;
}) {
  return (
    <h2
      id={id}
      className="text-lg font-semibold text-navy-900 dark:text-white"
    >
      {children}
    </h2>
  );
}

export function DialogDescription({
  id,
  children,
}: {
  id?: string;
  children: ReactNode;
}) {
  return (
    <p id={id} className="mt-1.5 text-sm text-navy-600 dark:text-zinc-400">
      {children}
    </p>
  );
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return (
    <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      {children}
    </div>
  );
}
