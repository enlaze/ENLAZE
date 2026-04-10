import { ReactNode } from "react";

type Trend = {
  /** Porcentaje de variación (ej: 12.4 o -3.1) */
  value: number;
  /** Texto corto que describe el periodo comparado */
  label?: string;
};

type KpiCardProps = {
  label: string;
  value: string;
  icon?: ReactNode;
  trend?: Trend;
  /** Texto auxiliar bajo el valor (si no usas `trend`) */
  hint?: string;
  /**
   * `featured` aplica un acento brand-green sutil para marcar la KPI
   * más relevante del grid (ej: ingresos del mes).
   */
  variant?: "default" | "featured";
};

/**
 * KPI Card — estilo startup top (Linear · Stripe · Vercel).
 *
 * Jerarquía clara: label pequeño arriba, número protagonista,
 * trend/hint discreto abajo. La variante `featured` introduce un
 * acento brand-green sin cambiar la estructura.
 */
export default function KpiCard({
  label,
  value,
  icon,
  trend,
  hint,
  variant = "default",
}: KpiCardProps) {
  const isFeatured = variant === "featured";
  const trendPositive = trend ? trend.value >= 0 : false;

  return (
    <div
      className={`
        group relative flex flex-col justify-between overflow-hidden
        rounded-2xl border bg-white
        p-7 lg:p-8
        shadow-[0_1px_2px_rgba(10,25,41,0.04)]
        transition-all duration-300 ease-out
        hover:-translate-y-[2px]
        hover:shadow-[0_12px_32px_-16px_rgba(10,25,41,0.18)]
        ${
          isFeatured
            ? "border-brand-green/20 hover:border-brand-green/30"
            : "border-navy-100 hover:border-navy-200"
        }
      `}
    >
      {/* Acento superior para la KPI destacada */}
      {isFeatured && (
        <>
          <span
            aria-hidden
            className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-green/60 to-transparent"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-brand-green/[0.06] blur-2xl"
          />
        </>
      )}

      {/* Fila superior: label + icono */}
      <div className="relative flex items-center justify-between gap-4">
        <p
          className={`text-[11px] font-semibold uppercase tracking-[0.1em] ${
            isFeatured ? "text-brand-green" : "text-navy-500"
          }`}
        >
          {label}
        </p>

        {icon && (
          <div
            className={`
              flex h-10 w-10 shrink-0 items-center justify-center
              rounded-xl transition-all duration-300
              ${
                isFeatured
                  ? "bg-brand-green/10 text-brand-green ring-1 ring-inset ring-brand-green/15"
                  : "bg-navy-50 text-navy-600 ring-1 ring-inset ring-navy-100 group-hover:bg-navy-100/80"
              }
            `}
          >
            {icon}
          </div>
        )}
      </div>

      {/* Número protagonista */}
      <p
        className="
          relative mt-8
          text-[2.75rem] lg:text-[3rem]
          font-semibold leading-none tracking-[-0.02em]
          text-navy-900
          tabular-nums
        "
      >
        {value}
      </p>

      {/* Trend / hint discreto */}
      <div className="relative mt-6 flex items-center gap-2 text-xs">
        {trend ? (
          <>
            <span
              className={`
                inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold
                ${
                  trendPositive
                    ? "bg-brand-green/10 text-brand-green"
                    : "bg-red-50 text-red-600"
                }
              `}
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={trendPositive ? "" : "rotate-180"}
                aria-hidden
              >
                <path d="m6 15 6-6 6 6" />
              </svg>
              {Math.abs(trend.value).toFixed(1)}%
            </span>
            {trend.label && <span className="text-navy-500">{trend.label}</span>}
          </>
        ) : (
          hint && <span className="text-navy-500">{hint}</span>
        )}
      </div>
    </div>
  );
}
