import StatusBadge, { BudgetStatus } from "./StatusBadge";

export type BudgetRow = {
  id: string;
  client: string;
  /** Iniciales para el avatar circular (2-3 letras) */
  clientInitials?: string;
  /** Texto libre bajo el nombre del cliente (ej: referencia del presupuesto) */
  reference?: string;
  date: string; // ya formateado, ej: "8 abr 2026"
  amount: string; // ya formateado, ej: "€3.240,00"
  status: BudgetStatus;
};

type BudgetsTableProps = {
  rows: BudgetRow[];
  title?: string;
  description?: string;
  footerHref?: string;
  footerLabel?: string;
};

/**
 * Tabla de presupuestos recientes — nivel startup top.
 * Rows ultra respirables, dividers casi invisibles, hover sedoso,
 * tipografía refinada en dos niveles.
 */
export default function BudgetsTable({
  rows,
  title = "Presupuestos recientes",
  description = "Últimos presupuestos emitidos a tus clientes.",
  footerHref,
  footerLabel = "Ver todos",
}: BudgetsTableProps) {
  return (
    <section
      className="
        overflow-hidden rounded-2xl border border-navy-100 bg-white
        shadow-[0_1px_2px_rgba(10,25,41,0.04)]
      "
    >
      {/* Header de la sección */}
      <header className="flex items-start justify-between gap-4 px-8 pt-7 pb-6">
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight text-navy-900">
            {title}
          </h2>
          <p className="mt-1 text-sm text-navy-500">{description}</p>
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-navy-100/80 bg-navy-50/40 text-left">
              <th className="px-8 py-3.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-navy-500">
                Cliente
              </th>
              <th className="px-8 py-3.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-navy-500">
                Fecha
              </th>
              <th className="px-8 py-3.5 text-right text-[10.5px] font-semibold uppercase tracking-[0.1em] text-navy-500">
                Importe
              </th>
              <th className="px-8 py-3.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-navy-500">
                Estado
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="
                  group border-b border-navy-50 last:border-0
                  transition-colors duration-200 ease-out
                  hover:bg-navy-50/60
                "
              >
                {/* Cliente */}
                <td className="px-8 py-6">
                  <div className="flex items-center gap-4">
                    <div
                      className="
                        flex h-10 w-10 shrink-0 items-center justify-center
                        rounded-full bg-navy-50 text-[12px] font-semibold text-navy-700
                        ring-1 ring-inset ring-navy-100
                        transition-colors duration-200
                        group-hover:bg-white group-hover:ring-navy-200
                      "
                    >
                      {row.clientInitials ??
                        row.client
                          .split(" ")
                          .map((w) => w[0])
                          .slice(0, 2)
                          .join("")
                          .toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-medium text-navy-900">
                        {row.client}
                      </p>
                      {row.reference && (
                        <p className="truncate text-[12px] text-navy-500">
                          {row.reference}
                        </p>
                      )}
                    </div>
                  </div>
                </td>

                {/* Fecha */}
                <td className="px-8 py-6 text-[13.5px] text-navy-600 tabular-nums">
                  {row.date}
                </td>

                {/* Importe */}
                <td className="px-8 py-6 text-right text-[14px] font-semibold tabular-nums text-navy-900">
                  {row.amount}
                </td>

                {/* Estado */}
                <td className="px-8 py-6">
                  <StatusBadge status={row.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {footerHref && (
        <footer className="flex justify-end border-t border-navy-100 bg-navy-50/30 px-8 py-4">
          <a
            href={footerHref}
            className="
              group/link inline-flex items-center gap-1.5 text-sm font-medium
              text-navy-600 transition-colors hover:text-brand-green
            "
          >
            {footerLabel}
            <span
              aria-hidden
              className="transition-transform duration-200 group-hover/link:translate-x-0.5"
            >
              →
            </span>
          </a>
        </footer>
      )}
    </section>
  );
}
