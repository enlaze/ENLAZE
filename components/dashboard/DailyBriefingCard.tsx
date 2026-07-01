"use client";

/**
 * DailyBriefingCard — faithful integration of the redesigned daily briefing.
 *
 * The design was delivered as a standalone HTML artifact that themes itself
 * through CSS variables (a light and a dark palette) rather than Tailwind
 * `dark:` classes, and draws its icons as inline SVGs. We reproduce it exactly:
 * the same variables, spacing, radii and SVG paths. Light/dark is driven by the
 * app's own theme (`useTheme().isDark`) instead of the standalone toggle button.
 *
 * Data is expected ALREADY FILTERED by the caller (AgentExperience). This
 * component does no sanitizing of its own.
 */

import { useEffect, useState } from "react";

export type BriefingPriority = "alta" | "media" | "baja";

export interface BriefingAction {
  /** Título de la acción (mapea desde `action`). */
  title: string;
  /** Subtexto/razón (mapea desde `why`). */
  reason?: string;
  /** Momento sugerido, pill de reloj (mapea desde `when`). */
  moment?: string;
  /** Prioridad → badge. alta=rojo, media=ámbar, baja=azul, undefined=sin badge. */
  priority?: BriefingPriority;
}

export interface DailyBriefingCardProps {
  /** Clave estable para persistir el estado de las casillas (p.ej. summary.id). */
  summaryId: string;
  date: string;
  headline: string;
  /** Narrativa ya filtrada; si viene vacía no se renderiza. */
  narrative?: string;
  actions: BriefingAction[];
  opportunities: string[];
  watch_outs: string[];
  /** Muestra el sello "escrito por tu asistente" (solo cuando la IA generó el texto). */
  aiWritten?: boolean;
}

/* ── Theme palettes (copied verbatim from the design) ─────────────────── */

const LIGHT_VARS: Record<string, string> = {
  "--card": "#ffffff",
  "--text": "#0a1929",
  "--body": "#3c4d5c",
  "--muted": "#5b6b7b",
  "--faint": "#c3ccd4",
  "--border": "rgba(10,25,41,.08)",
  "--row": "#fcfdfd",
  "--pill": "#f0f3f5",
  "--accent": "#00c896",
  "--accent-dark": "#00a67a",
  "--accent-light": "#00e6ac",
  "--accent-soft": "rgba(0,200,150,.12)",
  "--alta-bg": "#fee2e2",
  "--media-bg": "#fef3c7",
  "--baja-bg": "#dbeafe",
  "--opp-bg": "#f0fdf8",
  "--opp-border": "rgba(0,166,122,.22)",
  "--opp-icon-bg": "#d6f7ec",
  "--watch-bg": "#fffbeb",
  "--watch-border": "rgba(217,119,6,.24)",
  "--watch-icon-bg": "#fef0cd",
  "--shadow": "0 1px 2px rgba(10,25,41,.04), 0 18px 44px -20px rgba(10,25,41,.18)",
};

const DARK_VARS: Record<string, string> = {
  "--card": "#09090b",
  "--text": "#e4e4e7",
  "--body": "#c2c5cc",
  "--muted": "#8b8b95",
  "--faint": "#3f3f46",
  "--border": "rgba(255,255,255,.09)",
  "--row": "rgba(255,255,255,.02)",
  "--pill": "rgba(255,255,255,.05)",
  "--accent": "#00e6ac",
  "--accent-dark": "#00e6ac",
  "--accent-light": "#00c896",
  "--accent-soft": "rgba(0,230,172,.14)",
  "--alta-bg": "rgba(239,68,68,.16)",
  "--media-bg": "rgba(245,158,11,.16)",
  "--baja-bg": "rgba(59,130,246,.18)",
  "--opp-bg": "rgba(0,200,150,.07)",
  "--opp-border": "rgba(0,230,172,.25)",
  "--opp-icon-bg": "rgba(0,230,172,.16)",
  "--watch-bg": "rgba(245,158,11,.08)",
  "--watch-border": "rgba(245,158,11,.28)",
  "--watch-icon-bg": "rgba(245,158,11,.18)",
  "--shadow": "0 1px 2px rgba(0,0,0,.5), 0 18px 44px -20px rgba(0,0,0,.7)",
};

const FONT_STACK = "'Plus Jakarta Sans', system-ui, sans-serif";

const BADGE: Record<BriefingPriority, { label: string; color: string; bg: string }> = {
  alta: { label: "Alta", color: "#dc2626", bg: "var(--alta-bg,#fee2e2)" },
  media: { label: "Media", color: "#d97706", bg: "var(--media-bg,#fef3c7)" },
  baja: { label: "Baja", color: "#2563eb", bg: "var(--baja-bg,#dbeafe)" },
};

/* ── Inline icons (verbatim SVG paths from the design) ────────────────── */

function ListChecksIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 17 2 2 4-4" />
      <path d="m3 7 2 2 4-4" />
      <path d="M13 6h8" />
      <path d="M13 12h8" />
      <path d="M13 18h8" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function TrendingUpIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  );
}

function TriangleAlertIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/**
 * Tracks the app's active theme by reading the `.dark` class the anti-FOWT
 * script sets on <html> before hydration. We read the DOM directly (instead of
 * the theme context) because the context resolves `isDark` asynchronously after
 * a Supabase round-trip, which would flash the card in light first. Starts
 * `false` to stay hydration-safe, then syncs on mount and on live theme toggles.
 */
function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setIsDark(root.classList.contains("dark"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}

/* ── Component ────────────────────────────────────────────────────────── */

export default function DailyBriefingCard({
  summaryId,
  date,
  headline,
  narrative,
  actions,
  opportunities,
  watch_outs,
  aiWritten = false,
}: DailyBriefingCardProps) {
  const isDark = useIsDark();
  const vars = isDark ? DARK_VARS : LIGHT_VARS;
  const accent = isDark ? "#00e6ac" : "#00a67a";

  // Per-briefing checklist state. Persisted as an array of done indices under a
  // key that already changes every day (summary.id), so it resets on its own.
  const storageKey = `enlaze:briefing-done:${summaryId}`;
  const [done, setDone] = useState<Record<number, boolean>>({});

  // Hydrate the checklist from localStorage on mount / when the briefing (key)
  // changes. Read is synchronous; we start empty so server and client render
  // identically, then sync here — matching how `useIsDark` subscribes.
  useEffect(() => {
    const hydrate = () => {
      try {
        const raw = window.localStorage.getItem(storageKey);
        const idxs = raw ? (JSON.parse(raw) as number[]) : [];
        const map: Record<number, boolean> = {};
        for (const i of idxs) map[i] = true;
        setDone(map);
      } catch {
        setDone({});
      }
    };
    hydrate();
  }, [storageKey]);

  const toggle = (i: number) => {
    setDone((prev) => {
      const next = { ...prev, [i]: !prev[i] };
      try {
        const idxs = Object.keys(next)
          .filter((k) => next[Number(k)])
          .map(Number);
        window.localStorage.setItem(storageKey, JSON.stringify(idxs));
      } catch {
        /* ignore quota / private-mode errors */
      }
      return next;
    });
  };

  const hasSideCards = opportunities.length > 0 || watch_outs.length > 0;

  return (
    <div
      style={{
        ...(vars as React.CSSProperties),
        background: "var(--card,#fff)",
        border: "1px solid var(--border,rgba(10,25,41,.08))",
        borderRadius: "24px",
        boxShadow: "var(--shadow)",
        overflow: "hidden",
        fontFamily: FONT_STACK,
        WebkitFontSmoothing: "antialiased",
      }}
    >
      {/* accent hairline */}
      <div
        style={{
          height: "3px",
          background:
            "linear-gradient(90deg,var(--accent-light,#00e6ac),var(--accent,#00c896) 45%,var(--accent-dark,#00a67a))",
        }}
      />

      <div style={{ padding: "34px 40px 38px" }}>
        {/* eyebrow */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "9px",
            marginBottom: "18px",
            flexWrap: "wrap",
          }}
        >
          <span style={eyebrowStyle}>RESUMEN DE HOY</span>
          <span style={{ color: "var(--faint,#c3ccd4)" }}>·</span>
          <span style={eyebrowStyle}>{date}</span>
          {aiWritten && (
            <>
              <span style={{ color: "var(--faint,#c3ccd4)" }}>·</span>
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: 700,
                  letterSpacing: ".05em",
                  textTransform: "uppercase",
                  color: "var(--accent-dark,#00a67a)",
                }}
              >
                escrito por tu asistente
              </span>
            </>
          )}
        </div>

        {/* headline */}
        <h1
          style={{
            margin: "0 0 14px",
            fontSize: "30px",
            lineHeight: 1.18,
            fontWeight: 800,
            letterSpacing: "-.02em",
            color: "var(--text,#0a1929)",
            maxWidth: "26ch",
          }}
        >
          {headline}
        </h1>

        {/* narrative */}
        {narrative && (
          <p
            style={{
              margin: 0,
              fontSize: "16px",
              lineHeight: 1.7,
              color: "var(--body,#3c4d5c)",
              maxWidth: "78ch",
              whiteSpace: "pre-line",
            }}
          >
            {narrative}
          </p>
        )}

        {/* ===== QUÉ HACER HOY ===== */}
        {actions.length > 0 && (
          <div style={{ marginTop: "32px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
              <span style={{ ...iconBadgeStyle, background: "var(--accent-soft,rgba(0,200,150,.12))", color: "var(--accent-dark,#00a67a)" }}>
                <ListChecksIcon />
              </span>
              <h2 style={{ margin: 0, fontSize: "15px", fontWeight: 700, letterSpacing: ".01em", color: "var(--text,#0a1929)" }}>
                Qué hacer hoy
              </h2>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {actions.map((a, i) => {
                const isDone = !!done[i];
                const badge = a.priority ? BADGE[a.priority] : null;
                return (
                  <div
                    key={i}
                    onClick={() => toggle(i)}
                    role="checkbox"
                    aria-checked={isDone}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggle(i);
                      }
                    }}
                    style={{
                      display: "flex",
                      gap: "14px",
                      alignItems: "flex-start",
                      padding: "16px 18px",
                      border: "1px solid var(--border)",
                      borderRadius: "14px",
                      background: isDone ? "var(--accent-soft)" : "var(--row)",
                      cursor: "pointer",
                      userSelect: "none",
                      transition: "background .15s ease, opacity .15s ease",
                      opacity: isDone ? 0.72 : 1,
                    }}
                  >
                    <span
                      style={{
                        marginTop: "2px",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "20px",
                        height: "20px",
                        borderRadius: "6px",
                        flexShrink: 0,
                        transition: "all .15s ease",
                        border: isDone ? `1.5px solid ${accent}` : "1.5px solid var(--faint)",
                        background: isDone ? accent : "transparent",
                      }}
                    >
                      {isDone && <CheckIcon />}
                    </span>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: a.reason ? "5px" : 0 }}>
                        <span
                          style={{
                            fontSize: "15.5px",
                            fontWeight: 700,
                            lineHeight: 1.3,
                            color: "var(--text)",
                            textDecoration: isDone ? "line-through" : "none",
                            textDecorationColor: isDone ? "var(--muted)" : undefined,
                          }}
                        >
                          {a.title}
                        </span>
                        {badge && (
                          <span
                            style={{
                              fontSize: "11px",
                              fontWeight: 700,
                              letterSpacing: ".03em",
                              textTransform: "uppercase",
                              padding: "3px 9px",
                              borderRadius: "999px",
                              color: badge.color,
                              background: badge.bg,
                            }}
                          >
                            {badge.label}
                          </span>
                        )}
                      </div>
                      {a.reason && (
                        <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.55, color: "var(--body,#3c4d5c)" }}>
                          {a.reason}
                        </p>
                      )}
                    </div>

                    {a.moment && (
                      <span
                        style={{
                          flexShrink: 0,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                          fontSize: "12px",
                          fontWeight: 600,
                          color: "var(--muted,#5b6b7b)",
                          background: "var(--pill,#f0f3f5)",
                          border: "1px solid var(--border,rgba(10,25,41,.06))",
                          padding: "5px 11px",
                          borderRadius: "999px",
                          whiteSpace: "nowrap",
                          alignSelf: "flex-start",
                        }}
                      >
                        <ClockIcon />
                        {a.moment}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ===== APROVECHA / OJO CON ===== */}
        {hasSideCards && (
          <div style={{ marginTop: "26px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            {opportunities.length > 0 && (
              <div
                style={{
                  border: "1px solid var(--opp-border,rgba(0,166,122,.22))",
                  background: "var(--opp-bg,#f0fdf8)",
                  borderRadius: "16px",
                  padding: "20px 22px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                  <span style={{ ...iconBadgeStyle, background: "var(--opp-icon-bg,#d6f7ec)", color: "var(--accent-dark,#00a67a)" }}>
                    <TrendingUpIcon />
                  </span>
                  <h2 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "var(--text,#0a1929)" }}>
                    Aprovecha hoy
                  </h2>
                </div>
                <ul style={listStyle}>
                  {opportunities.map((o, i) => (
                    <li key={i} style={listItemStyle}>
                      <svg style={{ flexShrink: 0, marginTop: "3px" }} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent-dark,#00a67a)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                      <span>{o}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {watch_outs.length > 0 && (
              <div
                style={{
                  border: "1px solid var(--watch-border,rgba(217,119,6,.24))",
                  background: "var(--watch-bg,#fffbeb)",
                  borderRadius: "16px",
                  padding: "20px 22px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                  <span style={{ ...iconBadgeStyle, background: "var(--watch-icon-bg,#fef0cd)", color: "#d97706" }}>
                    <TriangleAlertIcon />
                  </span>
                  <h2 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "var(--text,#0a1929)" }}>
                    Ojo con
                  </h2>
                </div>
                <ul style={listStyle}>
                  {watch_outs.map((w, i) => (
                    <li key={i} style={listItemStyle}>
                      <svg style={{ flexShrink: 0, marginTop: "3px" }} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" x2="12" y1="8" y2="12" />
                        <line x1="12" x2="12.01" y1="16" y2="16" />
                      </svg>
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Shared style fragments ───────────────────────────────────────────── */

const eyebrowStyle: React.CSSProperties = {
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: ".09em",
  textTransform: "uppercase",
  color: "var(--muted,#5b6b7b)",
};

const iconBadgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "30px",
  height: "30px",
  borderRadius: "9px",
};

const listStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: "none",
  display: "flex",
  flexDirection: "column",
  gap: "11px",
};

const listItemStyle: React.CSSProperties = {
  display: "flex",
  gap: "10px",
  alignItems: "flex-start",
  fontSize: "14px",
  lineHeight: 1.55,
  color: "var(--body,#3c4d5c)",
};
