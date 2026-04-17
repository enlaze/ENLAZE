"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type VisibilityState,
  type RowSelectionState,
  type PaginationState,
  type FilterFn,
  type Row,
  type RowData,
} from "@tanstack/react-table";
import { exportRowsToCsv, type CsvColumn } from "@/lib/csv";

/* ─── Module augmentation for column meta ───────────────────────────── */

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: "left" | "center" | "right";
    /** Tailwind responsive class, e.g. "hidden md:table-cell". */
    responsiveClass?: string;
    width?: string;
  }
}

/* ─── Public API (unchanged) ────────────────────────────────────────── */

export type SortDir = "asc" | "desc";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  align?: "left" | "center" | "right";
  /** Tailwind classes to hide the column at breakpoints (e.g. "hidden md:table-cell"). */
  hidden?: string;
  sortable?: boolean;
  sortFn?: (a: T, b: T) => number;
  exportValue?: (row: T) => string | number | Date | null | undefined;
  defaultHidden?: boolean;
  width?: string;
  alwaysVisible?: boolean;
}

export interface FilterOption {
  label: string;
  value: string;
}

export interface FilterDef<T> {
  key: string;
  label: string;
  options: FilterOption[];
  /** Predicate: returns true if row matches the selected value. */
  matches: (row: T, value: string) => boolean;
}

export interface BulkAction<T> {
  label: string;
  icon?: React.ReactNode;
  variant?: "default" | "danger";
  onClick: (rows: T[]) => void | Promise<void>;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;

  /* Search */
  searchable?: boolean;
  searchPlaceholder?: string;
  searchFields?: (row: T) => Array<string | number | null | undefined>;

  /* Sorting */
  initialSort?: { key: string; dir: SortDir };

  /* Filters */
  filters?: FilterDef<T>[];

  /* Pagination */
  pageSize?: number;
  pageSizeOptions?: number[];

  /* Selection */
  selectable?: boolean;
  bulkActions?: BulkAction<T>[];

  /* Export */
  exportable?: boolean;
  exportFileName?: string;

  /* Column visibility */
  toggleableColumns?: boolean;

  /* Empty state */
  emptyMessage?: string;
  emptyIcon?: React.ReactNode;

  /** Extra content rendered next to the search bar (e.g. a "New" button). */
  toolbarExtra?: React.ReactNode;

  /* ─── Server-side support (opt-in, future) ────────────────────── */
  /** When true, component expects data to be already paginated server-side. */
  manualPagination?: boolean;
  /** When true, component expects data to be already sorted server-side. */
  manualSorting?: boolean;
  /** When true, component expects data to be already filtered server-side. */
  manualFiltering?: boolean;
  /** Total row count (used by manual pagination to render page numbers). */
  rowCount?: number;
  /** Observed when sorting state changes (for server-side fetches). */
  onSortingChange?: (sorting: SortingState) => void;
  /** Observed when pagination state changes (for server-side fetches). */
  onPaginationChange?: (pagination: PaginationState) => void;
  /** Observed when global search changes (for server-side fetches). */
  onGlobalFilterChange?: (value: string) => void;
  /** Observed when column filters change (for server-side fetches). */
  onColumnFiltersChange?: (filters: ColumnFiltersState) => void;
}

/* ─── Icons ──────────────────────────────────────────────────────────── */

const SortIcon = ({ dir }: { dir?: false | "asc" | "desc" }) => (
  <svg
    width="10"
    height="14"
    viewBox="0 0 10 14"
    fill="none"
    aria-hidden
    className="ml-1 inline-block shrink-0"
  >
    <path
      d="M5 1 L1 5 H9 Z"
      className={
        dir === "asc"
          ? "fill-navy-900 dark:fill-zinc-100"
          : "fill-navy-300 dark:fill-zinc-600"
      }
    />
    <path
      d="M5 13 L1 9 H9 Z"
      className={
        dir === "desc"
          ? "fill-navy-900 dark:fill-zinc-100"
          : "fill-navy-300 dark:fill-zinc-600"
      }
    />
  </svg>
);

const SearchIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

const ChevronDown = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const DownloadIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" x2="12" y1="15" y2="3" />
  </svg>
);

const ColumnsIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M9 3v18" />
    <path d="M15 3v18" />
  </svg>
);

/* ─── Helpers ────────────────────────────────────────────────────────── */

const alignClass = (a?: string) =>
  a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";

function defaultSearchFields<T>(row: T): Array<string | number | null | undefined> {
  if (row == null || typeof row !== "object") return [];
  const out: Array<string | number | null | undefined> = [];
  for (const val of Object.values(row as Record<string, unknown>)) {
    if (val == null) continue;
    if (typeof val === "string" || typeof val === "number") out.push(val);
  }
  return out;
}

/* ─── Dropdown (for columns menu) ───────────────────────────────────── */

function Dropdown({
  label,
  icon,
  children,
  align = "right",
}: {
  label: React.ReactNode;
  icon?: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-xl border border-navy-200 bg-white px-3 py-2 text-sm font-medium text-navy-700 hover:bg-navy-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        aria-expanded={open}
        aria-haspopup="true"
      >
        {icon}
        {label}
        <ChevronDown />
      </button>
      {open && (
        <div
          className={`absolute z-20 mt-2 min-w-[220px] overflow-hidden rounded-xl border border-navy-100 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900 ${
            align === "right" ? "right-0" : "left-0"
          }`}
          role="menu"
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/* ─── Main ───────────────────────────────────────────────────────────── */

export default function DataTable<T>({
  columns,
  data,
  rowKey,
  onRowClick,
  searchable = false,
  searchPlaceholder = "Buscar...",
  searchFields,
  initialSort,
  filters,
  pageSize: initialPageSize,
  pageSizeOptions = [25, 50, 100],
  selectable = false,
  bulkActions,
  exportable = false,
  exportFileName = "export",
  toggleableColumns = false,
  emptyMessage = "No hay resultados",
  emptyIcon,
  toolbarExtra,
  manualPagination = false,
  manualSorting = false,
  manualFiltering = false,
  rowCount,
  onSortingChange: onSortingChangeExternal,
  onPaginationChange: onPaginationChangeExternal,
  onGlobalFilterChange: onGlobalFilterChangeExternal,
  onColumnFiltersChange: onColumnFiltersChangeExternal,
}: DataTableProps<T>) {
  const hasPagination = !!initialPageSize;

  /* ─── Internal controlled state ─── */
  const [sorting, setSorting] = useState<SortingState>(() =>
    initialSort ? [{ id: initialSort.key, desc: initialSort.dir === "desc" }] : [],
  );
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() =>
    Object.fromEntries(
      columns.filter((c) => c.defaultHidden).map((c) => [c.key, false]),
    ),
  );
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: initialPageSize ?? 25,
  });

  /* ─── Build filter predicate map (key → matches) ─── */
  const filterPredicates = useMemo(() => {
    const map = new Map<string, (row: T, value: string) => boolean>();
    for (const f of filters ?? []) map.set(f.key, f.matches);
    return map;
  }, [filters]);

  /* ─── Adapt Column<T> → ColumnDef<T> ─── */
  const tanstackColumns = useMemo<ColumnDef<T, unknown>[]>(() => {
    return columns.map<ColumnDef<T, unknown>>((col) => {
      const filterPredicate = filterPredicates.get(col.key);

      // Accessor: prefer exportValue (used for sort fallback + CSV)
      const accessorFn: ((row: T) => unknown) | undefined = col.exportValue
        ? (row: T) => {
            const v = col.exportValue!(row);
            if (v instanceof Date) return v.getTime();
            return v ?? "";
          }
        : undefined;

      // Custom sort comparator
      const sortingFn = col.sortFn
        ? (rowA: Row<T>, rowB: Row<T>) =>
            col.sortFn!(rowA.original, rowB.original)
        : undefined;

      // Column-level filter (dropdown filter)
      const filterFn: FilterFn<T> | undefined = filterPredicate
        ? (row, _id, value) => {
            if (value == null || value === "") return true;
            return filterPredicate(row.original, String(value));
          }
        : undefined;

      const def: ColumnDef<T, unknown> = {
        id: col.key,
        header: col.header,
        cell: ({ row }) => col.render(row.original),
        enableSorting: !!col.sortable,
        enableHiding: !col.alwaysVisible,
        meta: {
          align: col.align,
          responsiveClass: col.hidden,
          width: col.width,
        },
        ...(accessorFn ? { accessorFn } : {}),
        ...(sortingFn ? { sortingFn } : {}),
        ...(filterFn ? { filterFn } : {}),
      };

      return def;
    });
  }, [columns, filterPredicates]);

  /* ─── Global filter with searchFields support ─── */
  const globalFilterFn = useCallback<FilterFn<T>>(
    (row, _columnId, filterValue) => {
      if (!filterValue || typeof filterValue !== "string" || !filterValue.trim()) {
        return true;
      }
      const q = filterValue.trim().toLowerCase();
      const fields = searchFields
        ? searchFields(row.original)
        : defaultSearchFields(row.original);
      return fields.some((v) => v != null && String(v).toLowerCase().includes(q));
    },
    [searchFields],
  );

  /* ─── Create TanStack table instance ─── */
  const table = useReactTable<T>({
    data,
    columns: tanstackColumns,
    getRowId: (row) => rowKey(row),

    /* Row models */
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
    getFilteredRowModel: manualFiltering ? undefined : getFilteredRowModel(),
    getPaginationRowModel:
      hasPagination && !manualPagination ? getPaginationRowModel() : undefined,

    /* Controlled state */
    state: {
      sorting,
      globalFilter,
      columnFilters,
      columnVisibility,
      rowSelection,
      pagination: hasPagination ? pagination : undefined,
    },

    /* State updaters */
    onSortingChange: (updater) => {
      setSorting((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        onSortingChangeExternal?.(next);
        return next;
      });
    },
    onGlobalFilterChange: (updater) => {
      setGlobalFilter((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        onGlobalFilterChangeExternal?.(next);
        return next;
      });
      // Reset page when global filter changes (client-side mode only)
      if (!manualPagination) {
        setPagination((p) => ({ ...p, pageIndex: 0 }));
      }
    },
    onColumnFiltersChange: (updater) => {
      setColumnFilters((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        onColumnFiltersChangeExternal?.(next);
        return next;
      });
      if (!manualPagination) {
        setPagination((p) => ({ ...p, pageIndex: 0 }));
      }
    },
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onPaginationChange: (updater) => {
      setPagination((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        onPaginationChangeExternal?.(next);
        return next;
      });
    },

    /* Filters */
    globalFilterFn,

    /* Selection */
    enableRowSelection: selectable,

    /* Server-side flags */
    manualPagination,
    manualSorting,
    manualFiltering,
    ...(manualPagination && rowCount != null ? { rowCount } : {}),
  });

  /* ─── Derived values for the UI ─── */
  const headerCells = table.getHeaderGroups()[0]?.headers ?? [];
  const visibleLeafCount = table.getVisibleLeafColumns().length;
  const bodyRows = table.getRowModel().rows;
  const selectedRowsArr = table.getSelectedRowModel().rows;
  const selectedCount = selectedRowsArr.length;

  const totalFilteredRows = manualPagination
    ? (rowCount ?? data.length)
    : table.getFilteredRowModel().rows.length;
  const pageCount = hasPagination ? table.getPageCount() : 1;
  const currentPageIndex = pagination.pageIndex;

  /* ─── Export CSV ─── */
  const handleExport = useCallback(() => {
    // Filtered + sorted, pre-pagination
    const source = manualPagination
      ? data // server-side: only the current page is available
      : table.getSortedRowModel().rows.map((r) => r.original);

    // Use the original Column<T>[] for export mapping (preserves order & exportValue)
    const visibleColumnIds = new Set(
      table.getVisibleLeafColumns().map((c) => c.id),
    );
    const exportCols: CsvColumn<T>[] = columns
      .filter((c) => visibleColumnIds.has(c.key))
      .map((c) => ({
        header: c.header,
        value: (row: T) => {
          if (c.exportValue) return c.exportValue(row);
          const node = c.render(row);
          if (node == null || typeof node === "boolean") return "";
          if (typeof node === "string" || typeof node === "number") return node;
          return "";
        },
      }));
    exportRowsToCsv(exportFileName, source, exportCols);
  }, [table, columns, data, exportFileName, manualPagination]);

  /* ─── UI render ─── */
  const hasToolbar =
    searchable ||
    (filters && filters.length > 0) ||
    exportable ||
    toggleableColumns ||
    toolbarExtra;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      {hasToolbar && (
        <div className="flex flex-wrap items-center gap-3">
          {searchable && (
            <div className="relative flex-1 min-w-[220px]">
              <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-navy-400 dark:text-zinc-500">
                <SearchIcon />
              </div>
              <input
                type="search"
                value={globalFilter}
                onChange={(e) => table.setGlobalFilter(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full rounded-xl border border-navy-200 bg-white py-2 pl-9 pr-3 text-sm text-navy-900 placeholder:text-navy-400 focus:outline-none focus:ring-2 focus:ring-brand-green/50 focus:border-brand-green dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                aria-label="Buscar en la tabla"
              />
            </div>
          )}

          {filters?.map((f) => {
            const tsCol = table.getColumn(f.key);
            const currentValue = (tsCol?.getFilterValue() as string | undefined) ?? "";
            return (
              <select
                key={f.key}
                value={currentValue}
                onChange={(e) => tsCol?.setFilterValue(e.target.value || undefined)}
                className="rounded-xl border border-navy-200 bg-white px-3 py-2 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-brand-green/50 focus:border-brand-green dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
                aria-label={f.label}
              >
                <option value="">{f.label}: Todos</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            );
          })}

          <div className="ml-auto flex items-center gap-2">
            {toolbarExtra}

            {toggleableColumns && (
              <Dropdown label="Columnas" icon={<ColumnsIcon />}>
                {() => (
                  <div className="max-h-80 overflow-y-auto p-1">
                    {table.getAllLeafColumns().map((tsCol) => {
                      const canHide = tsCol.getCanHide();
                      const original = columns.find((c) => c.key === tsCol.id);
                      return (
                        <label
                          key={tsCol.id}
                          className={`flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-navy-50 dark:hover:bg-zinc-800 ${
                            !canHide ? "opacity-50 cursor-not-allowed" : ""
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-navy-300 text-brand-green focus:ring-brand-green/50 dark:border-zinc-700 dark:bg-zinc-800"
                            checked={tsCol.getIsVisible()}
                            disabled={!canHide}
                            onChange={tsCol.getToggleVisibilityHandler()}
                          />
                          <span className="text-navy-800 dark:text-zinc-200">
                            {original?.header ?? tsCol.id}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </Dropdown>
            )}

            {exportable && (
              <button
                type="button"
                onClick={handleExport}
                className="inline-flex items-center gap-2 rounded-xl border border-navy-200 bg-white px-3 py-2 text-sm font-medium text-navy-700 hover:bg-navy-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                title="Exportar a CSV"
              >
                <DownloadIcon />
                Exportar
              </button>
            )}
          </div>
        </div>
      )}

      {/* Bulk actions bar */}
      {selectable && selectedCount > 0 && bulkActions && bulkActions.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-green/30 bg-brand-green/5 px-4 py-3 dark:border-brand-green/30 dark:bg-brand-green/10">
          <span className="text-sm font-semibold text-navy-900 dark:text-zinc-100">
            {selectedCount} seleccionado{selectedCount === 1 ? "" : "s"}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {bulkActions.map((a, i) => (
              <button
                key={i}
                type="button"
                onClick={() => a.onClick(selectedRowsArr.map((r) => r.original))}
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  a.variant === "danger"
                    ? "bg-red-600 text-white hover:bg-red-700"
                    : "border border-navy-200 bg-white text-navy-700 hover:bg-navy-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                }`}
              >
                {a.icon}
                {a.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => table.resetRowSelection()}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-navy-600 hover:bg-navy-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              Limpiar
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-2xl border border-navy-100 bg-white shadow-sm overflow-hidden dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-navy-100 bg-navy-50/60 dark:border-zinc-800 dark:bg-zinc-950/40">
                {selectable && (
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-navy-300 text-brand-green focus:ring-brand-green/50 dark:border-zinc-700 dark:bg-zinc-800"
                      checked={table.getIsAllPageRowsSelected()}
                      ref={(el) => {
                        if (el) {
                          el.indeterminate =
                            !table.getIsAllPageRowsSelected() &&
                            table.getIsSomePageRowsSelected();
                        }
                      }}
                      onChange={table.getToggleAllPageRowsSelectedHandler()}
                      aria-label="Seleccionar todo"
                    />
                  </th>
                )}
                {headerCells.map((h) => {
                  const meta = h.column.columnDef.meta;
                  const canSort = h.column.getCanSort();
                  const sortDir = h.column.getIsSorted();
                  const headerLabel = h.isPlaceholder
                    ? null
                    : flexRender(h.column.columnDef.header, h.getContext());
                  return (
                    <th
                      key={h.id}
                      style={meta?.width ? { width: meta.width } : undefined}
                      className={`px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy-500 dark:text-zinc-400 ${alignClass(
                        meta?.align,
                      )} ${meta?.responsiveClass || ""}`}
                      aria-sort={
                        sortDir === "asc"
                          ? "ascending"
                          : sortDir === "desc"
                            ? "descending"
                            : canSort
                              ? "none"
                              : undefined
                      }
                    >
                      {canSort ? (
                        <button
                          type="button"
                          onClick={h.column.getToggleSortingHandler()}
                          className={`inline-flex items-center gap-0.5 select-none hover:text-navy-800 dark:hover:text-zinc-200 ${
                            meta?.align === "right" ? "flex-row-reverse" : ""
                          }`}
                        >
                          {headerLabel}
                          <SortIcon dir={sortDir} />
                        </button>
                      ) : (
                        headerLabel
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {bodyRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={visibleLeafCount + (selectable ? 1 : 0)}
                    className="px-5 py-16 text-center"
                  >
                    <div className="flex flex-col items-center gap-3 text-navy-500 dark:text-zinc-500">
                      {emptyIcon}
                      <span className="text-sm">{emptyMessage}</span>
                    </div>
                  </td>
                </tr>
              ) : (
                bodyRows.map((row) => {
                  const isSelected = row.getIsSelected();
                  return (
                    <tr
                      key={row.id}
                      onClick={() => onRowClick?.(row.original)}
                      className={`border-b border-navy-50 transition-colors dark:border-zinc-800 ${
                        isSelected
                          ? "bg-brand-green/5 hover:bg-brand-green/10 dark:bg-brand-green/10"
                          : "hover:bg-navy-50/50 dark:hover:bg-zinc-800/50"
                      } ${onRowClick ? "cursor-pointer" : ""}`}
                    >
                      {selectable && (
                        <td
                          className="w-10 px-4 py-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-navy-300 text-brand-green focus:ring-brand-green/50 dark:border-zinc-700 dark:bg-zinc-800"
                            checked={isSelected}
                            onChange={row.getToggleSelectedHandler()}
                            aria-label="Seleccionar fila"
                          />
                        </td>
                      )}
                      {row.getVisibleCells().map((cell) => {
                        const meta = cell.column.columnDef.meta;
                        return (
                          <td
                            key={cell.id}
                            className={`px-5 py-3.5 text-sm dark:text-zinc-300 ${alignClass(
                              meta?.align,
                            )} ${meta?.responsiveClass || ""}`}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {hasPagination && totalFilteredRows > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <div className="flex items-center gap-3 text-xs text-navy-500 dark:text-zinc-400">
            <span>
              Mostrando{" "}
              <span className="font-semibold text-navy-800 dark:text-zinc-200">
                {currentPageIndex * pagination.pageSize + 1}
                {"–"}
                {Math.min(
                  (currentPageIndex + 1) * pagination.pageSize,
                  totalFilteredRows,
                )}
              </span>{" "}
              de{" "}
              <span className="font-semibold text-navy-800 dark:text-zinc-200">
                {totalFilteredRows}
              </span>
            </span>
            {pageSizeOptions.length > 1 && (
              <label className="flex items-center gap-2">
                <span>Filas:</span>
                <select
                  value={pagination.pageSize}
                  onChange={(e) => table.setPageSize(Number(e.target.value))}
                  className="rounded-lg border border-navy-200 bg-white px-2 py-1 text-xs text-navy-700 focus:outline-none focus:ring-2 focus:ring-brand-green/50 focus:border-brand-green dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
                >
                  {pageSizeOptions.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="rounded-lg border border-navy-200 bg-white px-3 py-1.5 text-xs font-medium text-navy-700 hover:bg-navy-50 disabled:opacity-40 disabled:cursor-not-allowed dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Anterior
            </button>
            <span className="px-3 text-xs text-navy-600 dark:text-zinc-400 tabular-nums">
              {currentPageIndex + 1} / {Math.max(1, pageCount)}
            </span>
            <button
              type="button"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="rounded-lg border border-navy-200 bg-white px-3 py-1.5 text-xs font-medium text-navy-700 hover:bg-navy-50 disabled:opacity-40 disabled:cursor-not-allowed dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
