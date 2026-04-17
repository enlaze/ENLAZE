"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ─────────────────────────────────────────────────────────────
// Global keyboard shortcuts overlay.
// Press `?` anywhere (except while typing) to open.
// ─────────────────────────────────────────────────────────────

type ShortcutGroup = {
  title: string;
  items: { keys: string[]; label: string }[];
};

const GROUPS: ShortcutGroup[] = [
  {
    title: "General",
    items: [
      { keys: ["?"], label: "Abrir esta ayuda" },
      { keys: ["⌘", "K"], label: "Buscar globalmente" },
      { keys: ["Esc"], label: "Cerrar modal / cancelar" },
    ],
  },
  {
    title: "Crear",
    items: [
      { keys: ["N", "P"], label: "Nuevo presupuesto" },
      { keys: ["N", "F"], label: "Nueva factura emitida" },
      { keys: ["N", "C"], label: "Nuevo cliente" },
    ],
  },
  {
    title: "Navegación",
    items: [
      { keys: ["G", "D"], label: "Ir a Dashboard" },
      { keys: ["G", "C"], label: "Ir a Clientes" },
      { keys: ["G", "P"], label: "Ir a Pagos" },
      { keys: ["G", "V"], label: "Ir a Proveedores" },
      { keys: ["G", "R"], label: "Ir a Facturas recibidas" },
      { keys: ["G", "A"], label: "Ir a Asistente IA" },
      { keys: ["G", "S"], label: "Ir a Ajustes" },
      { keys: ["G", "X"], label: "Ir a Compliance" },
    ],
  },
];

export default function ShortcutsOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ignore when typing
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const editing =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable;
      if (editing) return;

      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      widthClass="max-w-xl"
      labelledBy="shortcuts-title"
    >
      <DialogHeader>
        <DialogTitle id="shortcuts-title">Atajos de teclado</DialogTitle>
        <DialogDescription>
          Navega y crea sin soltar las manos del teclado.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
        {GROUPS.map((group) => (
          <div key={group.title}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-navy-500 dark:text-zinc-500">
              {group.title}
            </p>
            <ul className="mt-2 divide-y divide-navy-100 rounded-xl border border-navy-100 bg-navy-50/40 dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950/50">
              {group.items.map((item, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between px-4 py-2.5 text-sm"
                >
                  <span className="text-navy-700 dark:text-zinc-300">
                    {item.label}
                  </span>
                  <span className="flex items-center gap-1">
                    {item.keys.map((k, j) => (
                      <kbd
                        key={j}
                        className="inline-flex min-w-[24px] items-center justify-center rounded-md border border-navy-200 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-navy-700 shadow-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:shadow-none"
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="mt-5 text-xs text-navy-500 dark:text-zinc-500">
        Pulsa <kbd className="inline-flex items-center rounded border border-navy-200 bg-white px-1 text-[10px] font-semibold dark:border-zinc-700 dark:bg-zinc-800">Esc</kbd> para cerrar.
      </p>
    </Dialog>
  );
}
