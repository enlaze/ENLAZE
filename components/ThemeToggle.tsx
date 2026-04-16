"use client";

import { useState, useRef, useEffect } from "react";
import { useTheme } from "@/lib/theme-context";

export default function ThemeToggle() {
  const { theme, setTheme, isLoading } = useTheme();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  if (isLoading) {
    return (
      <button
        disabled
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-navy-100 text-navy-400 bg-navy-50/50 dark:border-zinc-800 dark:text-zinc-500 dark:bg-zinc-900"
        aria-label="Cargando tema"
      >
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-navy-300 border-t-brand-green dark:border-zinc-800 dark:border-t-brand-green" />
      </button>
    );
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-navy-100 bg-navy-50/50 text-navy-700 transition-colors hover:border-navy-200 hover:bg-navy-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
        aria-label="Cambiar tema"
        aria-expanded={open}
      >
        {theme === "light" || (theme === "system" && !isLoading) ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-48 overflow-hidden rounded-lg border border-navy-100 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/40">
            <div className="p-2 space-y-1">
              <button
                onClick={() => {
                  setTheme("light");
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  theme === "light"
                    ? "bg-navy-50 text-navy-900 dark:bg-zinc-800 dark:text-white"
                    : "text-navy-600 hover:bg-navy-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
                <span>Claro</span>
              </button>

              <button
                onClick={() => {
                  setTheme("dark");
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  theme === "dark"
                    ? "bg-navy-50 text-navy-900 dark:bg-zinc-800 dark:text-white"
                    : "text-navy-600 hover:bg-navy-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
                <span>Oscuro</span>
              </button>

              <button
                onClick={() => {
                  setTheme("system");
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  theme === "system"
                    ? "bg-navy-50 text-navy-900 dark:bg-zinc-800 dark:text-white"
                    : "text-navy-600 hover:bg-navy-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 9V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
                  <line x1="8" y1="9" x2="8" y2="15" />
                  <line x1="16" y1="9" x2="16" y2="15" />
                </svg>
                <span>Sistema</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
