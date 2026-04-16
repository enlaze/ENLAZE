"use client";

import React from "react";

/* ─── DataTable ────────────────────────────────────────────────────── */

interface Column<T> {
  key: string;
  header: string;
  align?: "left" | "center" | "right";
  hidden?: string; // responsive class, e.g. "hidden md:table-cell"
  render: (row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
}

export default function DataTable<T>({
  columns,
  data,
  rowKey,
  onRowClick,
}: DataTableProps<T>) {
  const alignClass = (a?: string) =>
    a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";

  return (
    <div className="rounded-2xl border border-navy-100 bg-white shadow-sm overflow-hidden dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-navy-100 bg-navy-50/60 dark:border-zinc-800 dark:bg-zinc-950/40">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy-500 dark:text-zinc-400 ${alignClass(
                    col.align
                  )} ${col.hidden || ""}`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={() => onRowClick?.(row)}
                className={`border-b border-navy-50 transition-colors hover:bg-navy-50/50 dark:border-zinc-800 dark:hover:bg-zinc-800/50 ${
                  onRowClick ? "cursor-pointer" : ""
                }`}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-5 py-3.5 text-sm dark:text-zinc-300 ${alignClass(
                      col.align
                    )} ${col.hidden || ""}`}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
