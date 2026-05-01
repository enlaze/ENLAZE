"use client";

import { useEffect, useRef, useState } from "react";

interface InfoFlipCardProps {
  what: string;
  howTo: string;
  label?: string;
}

const InfoIcon = ({ size = 14 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </svg>
);

const CloseIcon = ({ size = 14 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

const FLIP_MS = 550;

export default function InfoFlipCard({
  what,
  howTo,
  label = "Más información sobre esta sección",
}: InfoFlipCardProps) {
  const [open, setOpen] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  const clearCloseTimer = () => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const openCard = () => {
    clearCloseTimer();
    setOpen(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setFlipped(true));
    });
  };

  const closeCard = () => {
    setFlipped(false);
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = null;
    }, FLIP_MS);
  };

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        closeCard();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeCard();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => clearCloseTimer, []);

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => (open ? closeCard() : openCard())}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-navy-400 transition-colors hover:bg-navy-50 hover:text-brand-green focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/40 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-brand-green"
      >
        <InfoIcon size={14} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={label}
          className="absolute left-0 top-full z-30 mt-2 w-[340px] [perspective:1200px]"
        >
          <div
            className={`relative w-full transition-transform [transform-style:preserve-3d] ${
              flipped ? "[transform:rotateY(180deg)]" : "[transform:rotateY(0deg)]"
            }`}
            style={{
              transitionDuration: `${FLIP_MS}ms`,
              transitionTimingFunction: "cubic-bezier(0.22, 0.7, 0.18, 1)",
            }}
          >
            <div
              aria-hidden
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border border-navy-100 bg-white p-6 shadow-[0_1px_2px_rgba(10,25,41,0.04),0_18px_44px_-22px_rgba(10,25,41,0.22)] [backface-visibility:hidden] [-webkit-backface-visibility:hidden] dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-green/10 text-brand-green ring-1 ring-inset ring-brand-green/20">
                <InfoIcon size={22} />
              </div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-navy-400 dark:text-zinc-500">
                Información
              </p>
            </div>

            <div
              className="relative flex flex-col overflow-hidden rounded-2xl border border-navy-100 bg-white p-5 shadow-[0_1px_2px_rgba(10,25,41,0.04),0_18px_44px_-22px_rgba(10,25,41,0.22)] [transform:rotateY(180deg)] [backface-visibility:hidden] [-webkit-backface-visibility:hidden] dark:border-zinc-800 dark:bg-zinc-900"
            >
              <button
                type="button"
                onClick={closeCard}
                aria-label="Cerrar"
                className="absolute right-3 top-3 inline-flex h-6 w-6 items-center justify-center rounded-full text-navy-400 transition-colors hover:bg-navy-50 hover:text-navy-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/40 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                <CloseIcon size={14} />
              </button>

              <div className="pr-6">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-green">
                  ¿Qué es?
                </p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-navy-500 dark:text-zinc-400">
                  {what}
                </p>
              </div>

              <div className="my-3 h-px bg-navy-100 dark:bg-zinc-800" />

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-green">
                  ¿Para qué sirve?
                </p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-navy-500 dark:text-zinc-400">
                  {howTo}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
