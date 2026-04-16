"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

interface SearchResult {
  id: string;
  type: "client" | "budget" | "invoice" | "project" | "payment" | "supplier" | "received_invoice";
  title: string;
  subtitle: string;
  icon: string;
  href: string;
}

const typeLabels: Record<string, string> = {
  client: "Clientes",
  budget: "Presupuestos",
  invoice: "Facturas emitidas",
  project: "Obras",
  payment: "Pagos",
  supplier: "Proveedores",
  received_invoice: "Facturas recibidas",
};

const quickActions = [
  { label: "Nuevo presupuesto", href: "/dashboard/budgets/new", icon: "📋", keys: "N P" },
  { label: "Nueva factura", href: "/dashboard/issued-invoices/new", icon: "🧾", keys: "N F" },
  { label: "Ver clientes", href: "/dashboard/clientes", icon: "👥", keys: "G C" },
  { label: "Ver pagos", href: "/dashboard/payments", icon: "💵", keys: "G P" },
  { label: "Compliance", href: "/dashboard/compliance", icon: "🛡️", keys: "G X" },
  { label: "Proveedores", href: "/dashboard/suppliers", icon: "🔧", keys: "G V" },
  { label: "Facturas recibidas", href: "/dashboard/suppliers/invoices", icon: "🧾", keys: "G R" },
  { label: "Asistente IA", href: "/dashboard/agent", icon: "🤖", keys: "G A" },
  { label: "Ajustes", href: "/dashboard/settings", icon: "⚙️", keys: "G S" },
];

export default function SearchCommand() {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Cmd+K / Ctrl+K to open
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Focus input when modal opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
    }
  }, [open]);

  // Debounced search
  const search = useCallback(
    async (q: string) => {
      if (q.length < 2) {
        setResults([]);
        setLoading(false);
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(q)}&user_id=${user.id}`
        );
        const data = await res.json();
        setResults(data.results || []);
      } catch {
        setResults([]);
      }
      setLoading(false);
    },
    [supabase]
  );

  function handleQueryChange(value: string) {
    setQuery(value);
    setSelectedIndex(0);
    setLoading(true);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 250);
  }

  // All navigable items: results + quick actions (when no query)
  const items: { label: string; subtitle?: string; icon: string; href: string; type?: string }[] =
    query.length >= 2
      ? results.map((r) => ({
          label: r.title,
          subtitle: r.subtitle,
          icon: r.icon,
          href: r.href,
          type: r.type,
        }))
      : quickActions.map((a) => ({
          label: a.label,
          icon: a.icon,
          href: a.href,
        }));

  function navigate(href: string) {
    setOpen(false);
    router.push(href);
  }

  // Keyboard navigation
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && items[selectedIndex]) {
      e.preventDefault();
      navigate(items[selectedIndex].href);
    }
  }

  // Group results by type
  const grouped: Record<string, typeof items> = {};
  if (query.length >= 2) {
    for (const item of items) {
      const key = item.type || "other";
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(item);
    }
  }

  if (!open) return null;

  let flatIndex = -1;

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />

      {/* Modal */}
      <div className="relative mx-auto mt-[15vh] w-full max-w-lg px-4">
        <div className="overflow-hidden rounded-2xl border border-navy-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
          {/* Search input */}
          <div className="flex items-center gap-3 border-b border-navy-100 px-4 py-3 dark:border-zinc-800">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0 text-navy-400 dark:text-zinc-500"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Buscar clientes, presupuestos, facturas…"
              className="flex-1 bg-transparent text-sm text-navy-900 placeholder:text-navy-400 focus:outline-none dark:text-white dark:placeholder:text-zinc-500"
            />
            {loading && (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-navy-200 border-t-brand-green dark:border-zinc-800 dark:border-t-brand-green" />
            )}
            <kbd className="hidden sm:inline-flex h-5 items-center rounded border border-navy-200 bg-navy-50 px-1.5 text-[10px] font-medium text-navy-400 dark:border-zinc-800 dark:bg-zinc-800 dark:text-zinc-400">
              ESC
            </kbd>
          </div>

          {/* Results */}
          <div className="max-h-[50vh] overflow-y-auto dark:bg-zinc-900">
            {query.length >= 2 ? (
              results.length === 0 && !loading ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-sm text-navy-400 dark:text-zinc-500">
                    No se encontraron resultados para &quot;{query}&quot;
                  </p>
                </div>
              ) : (
                Object.entries(grouped).map(([type, groupItems]) => (
                  <div key={type}>
                    <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-navy-400 dark:text-zinc-500">
                      {typeLabels[type] || type}
                    </p>
                    {groupItems.map((item) => {
                      flatIndex++;
                      const idx = flatIndex;
                      const isSelected = idx === selectedIndex;
                      return (
                        <button
                          key={`${type}-${idx}`}
                          onClick={() => navigate(item.href)}
                          onMouseEnter={() => setSelectedIndex(idx)}
                          className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                            isSelected ? "bg-brand-green/10 dark:bg-brand-green/20" : "hover:bg-navy-50 dark:hover:bg-zinc-800"
                          }`}
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-sm dark:bg-zinc-800">
                            {item.icon}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p
                              className={`truncate text-sm ${
                                isSelected
                                  ? "font-semibold text-navy-900 dark:text-white"
                                  : "font-medium text-navy-800 dark:text-zinc-300"
                              }`}
                            >
                              {item.label}
                            </p>
                            {item.subtitle && (
                              <p className="truncate text-[11px] text-navy-400 dark:text-zinc-500">
                                {item.subtitle}
                              </p>
                            )}
                          </div>
                          {isSelected && (
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              className="shrink-0 text-brand-green"
                            >
                              <path d="M9 18l6-6-6-6" />
                            </svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))
              )
            ) : (
              /* Quick actions when no query */
              <div>
                <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-navy-400 dark:text-zinc-500">
                  Acciones rápidas
                </p>
                {quickActions.map((a, i) => {
                  const isSelected = i === selectedIndex;
                  return (
                    <button
                      key={a.href}
                      onClick={() => navigate(a.href)}
                      onMouseEnter={() => setSelectedIndex(i)}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        isSelected ? "bg-brand-green/10 dark:bg-brand-green/20" : "hover:bg-navy-50 dark:hover:bg-zinc-800"
                      }`}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-sm dark:bg-zinc-800">
                        {a.icon}
                      </span>
                      <span
                        className={`flex-1 text-sm ${
                          isSelected
                            ? "font-semibold text-navy-900 dark:text-white"
                            : "font-medium text-navy-700 dark:text-zinc-300"
                        }`}
                      >
                        {a.label}
                      </span>
                      <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-navy-200 bg-navy-50 px-1.5 py-0.5 text-[10px] font-mono text-navy-400 dark:border-zinc-800 dark:bg-zinc-800 dark:text-zinc-400">
                        {a.keys}
                      </kbd>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-navy-100 px-4 py-2 dark:border-zinc-800">
            <div className="flex items-center gap-3 text-[10px] text-navy-400 dark:text-zinc-500">
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-navy-200 bg-navy-50 px-1 py-0.5 font-mono dark:border-zinc-800 dark:bg-zinc-800">↑↓</kbd>
                Navegar
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-navy-200 bg-navy-50 px-1 py-0.5 font-mono dark:border-zinc-800 dark:bg-zinc-800">↵</kbd>
                Abrir
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-navy-200 bg-navy-50 px-1 py-0.5 font-mono dark:border-zinc-800 dark:bg-zinc-800">esc</kbd>
                Cerrar
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
