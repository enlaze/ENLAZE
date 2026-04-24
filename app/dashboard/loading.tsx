/* ─────────────────────────────────────────────────────────────────────
 *  Dashboard Loading Skeleton
 *
 *  Server component shown by Next.js while a dashboard route's
 *  async data resolves. Mirrors the visual rhythm of the real shell
 *  (page header + cards/table) so the transition feels instant rather
 *  than blank.
 * ───────────────────────────────────────────────────────────────────── */

export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-navy-50 px-6 py-10 md:px-12 md:py-14">
      <div className="mx-auto max-w-7xl space-y-8">
        {/* Page header */}
        <div className="space-y-3">
          <div className="h-8 w-64 animate-pulse rounded-lg bg-navy-100" />
          <div className="h-4 w-96 max-w-full animate-pulse rounded bg-navy-100/70" />
        </div>

        {/* KPI / stat cards row */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border border-navy-100 bg-white p-5 shadow-sm"
            >
              <div className="h-3 w-20 animate-pulse rounded bg-navy-100" />
              <div className="mt-3 h-7 w-28 animate-pulse rounded bg-navy-100" />
              <div className="mt-2 h-3 w-16 animate-pulse rounded bg-navy-100/70" />
            </div>
          ))}
        </div>

        {/* Main content card with table-ish rows */}
        <div className="rounded-2xl border border-navy-100 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-navy-100 p-5">
            <div className="h-5 w-40 animate-pulse rounded bg-navy-100" />
            <div className="h-9 w-32 animate-pulse rounded-lg bg-navy-100" />
          </div>
          <div className="divide-y divide-navy-100">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-4 p-5"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-navy-100" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-1/3 animate-pulse rounded bg-navy-100" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-navy-100/70" />
                </div>
                <div className="hidden h-4 w-20 animate-pulse rounded bg-navy-100 sm:block" />
                <div className="hidden h-8 w-24 animate-pulse rounded-lg bg-navy-100 md:block" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Visually hidden status for screen readers */}
      <span className="sr-only" role="status" aria-live="polite">
        Cargando…
      </span>
    </div>
  );
}
