export type BudgetStatus = "pending" | "accepted" | "rejected";

const STYLES: Record<
  BudgetStatus,
  { wrap: string; dot: string; label: string }
> = {
  pending: {
    wrap: "bg-amber-50/80 text-amber-700 ring-1 ring-inset ring-amber-200/50 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800/50",
    dot: "bg-amber-500",
    label: "Pendiente",
  },
  accepted: {
    wrap: "bg-brand-green/10 text-brand-green ring-1 ring-inset ring-brand-green/20 dark:bg-brand-green/15 dark:ring-brand-green/30",
    dot: "bg-brand-green",
    label: "Aceptado",
  },
  rejected: {
    wrap: "bg-red-50/80 text-red-600 ring-1 ring-inset ring-red-200/50 dark:bg-red-950/40 dark:text-red-400 dark:ring-red-800/50",
    dot: "bg-red-500",
    label: "Rechazado",
  },
};

/**
 * Badge de estado — refinado, estilo SaaS premium.
 * Forma de píldora, punto de estado animado suavemente.
 */
export default function StatusBadge({ status }: { status: BudgetStatus }) {
  const s = STYLES[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide ${s.wrap}`}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${s.dot} ${
          status === "pending" ? "animate-pulse" : ""
        }`}
      />
      {s.label}
    </span>
  );
}
