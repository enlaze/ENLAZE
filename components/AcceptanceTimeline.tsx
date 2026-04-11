"use client";

/**
 * AcceptanceTimeline — Reusable component showing the lifecycle
 * of a document: Created → Sent → Viewed → Accepted/Rejected
 *
 * Works for budgets, project changes, or any entity with timestamp fields.
 */

interface TimelineEvent {
  label: string;
  date: string | null | undefined;
  detail?: string | null;
  status?: "positive" | "negative" | "neutral";
}

interface AcceptanceTimelineProps {
  events: TimelineEvent[];
  /** Compact inline mode (single row) vs vertical timeline */
  mode?: "vertical" | "inline";
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "";
  const date = new Date(d);
  return date.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const statusColors: Record<string, { dot: string; text: string }> = {
  positive: {
    dot: "bg-[var(--color-brand-green)]",
    text: "text-[var(--color-brand-green)]",
  },
  negative: {
    dot: "bg-red-500",
    text: "text-red-400",
  },
  neutral: {
    dot: "bg-[var(--color-navy-500)]",
    text: "text-[var(--color-navy-400)]",
  },
};

export default function AcceptanceTimeline({
  events,
  mode = "vertical",
}: AcceptanceTimelineProps) {
  if (mode === "inline") {
    return <InlineTimeline events={events} />;
  }

  return (
    <div className="space-y-0">
      {events.map((ev, idx) => {
        const happened = !!ev.date;
        const colors = statusColors[ev.status || "neutral"];
        const isLast = idx === events.length - 1;

        return (
          <div key={idx} className="flex gap-3">
            {/* Line + dot */}
            <div className="flex flex-col items-center">
              <div
                className={`w-3 h-3 rounded-full flex-shrink-0 mt-1 ${
                  happened ? colors.dot : "border-2 border-[var(--color-navy-600)] bg-transparent"
                }`}
              />
              {!isLast && (
                <div
                  className={`w-0.5 flex-1 min-h-[24px] ${
                    happened ? "bg-[var(--color-navy-600)]" : "bg-[var(--color-navy-700)]"
                  }`}
                />
              )}
            </div>

            {/* Content */}
            <div className="pb-4 min-w-0">
              <p
                className={`text-sm font-medium ${
                  happened ? "text-[var(--color-navy-100)]" : "text-[var(--color-navy-500)]"
                }`}
              >
                {ev.label}
              </p>
              {happened ? (
                <p className={`text-xs mt-0.5 ${colors.text}`}>
                  {fmtDate(ev.date)}
                </p>
              ) : (
                <p className="text-xs text-[var(--color-navy-600)] mt-0.5">
                  Pendiente
                </p>
              )}
              {ev.detail && happened && (
                <p className="text-xs text-[var(--color-navy-500)] mt-0.5 italic">
                  {ev.detail}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function InlineTimeline({ events }: { events: TimelineEvent[] }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {events.map((ev, idx) => {
        const happened = !!ev.date;
        const colors = statusColors[ev.status || "neutral"];
        const isLast = idx === events.length - 1;

        return (
          <div key={idx} className="flex items-center gap-1">
            <div
              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                happened ? colors.dot : "border border-[var(--color-navy-600)] bg-transparent"
              }`}
            />
            <span
              className={`text-xs ${
                happened ? "text-[var(--color-navy-300)]" : "text-[var(--color-navy-600)]"
              }`}
              title={happened ? fmtDate(ev.date) : "Pendiente"}
            >
              {ev.label}
              {happened && (
                <span className={`ml-1 ${colors.text}`}>
                  {new Date(ev.date!).toLocaleDateString("es-ES", {
                    day: "2-digit",
                    month: "short",
                  })}
                </span>
              )}
            </span>
            {!isLast && (
              <span className="text-[var(--color-navy-700)] mx-0.5">→</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
