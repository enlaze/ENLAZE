"use client";

/**
 * Primitivas visuales del rediseño de Ajustes.
 *
 * El diseño original viene con estilos inline y su propia paleta; aquí esa
 * paleta son las variables `--st-*` que declara app/globals.css bajo
 * `[data-settings-surface]`. Se mantienen los estilos inline (en vez de
 * traducirlos a Tailwind) para no perder fidelidad y para que claro/oscuro
 * dependan de un único juego de tokens.
 */

import type { CSSProperties, ReactNode } from "react";

/* ── Iconos (del diseño, trazo 1.9–2.4) ───────────────────────────────── */

type IconProps = { size?: number; stroke?: string; strokeWidth?: number };

function svgProps({ size = 17, stroke = "currentColor", strokeWidth = 1.9 }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke,
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

export const IcoCompany = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="M4 21V6l7-3v18M11 10h7a2 2 0 012 2v9" />
    <path d="M15 14h2M15 17.5h2M7 8h1M7 12h1M7 16h1" />
  </svg>
);

export const IcoBell = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="M18 8a6 6 0 10-12 0c0 7-2 9-2 9h16s-2-2-2-9" />
    <path d="M10.5 21a2 2 0 003 0" />
  </svg>
);

export const IcoPlug = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="M9 3v5M15 3v5M6.5 8h11v4a5.5 5.5 0 01-11 0z" />
    <path d="M12 17.5V21" />
  </svg>
);

export const IcoAccount = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M4.5 20c1-3.8 3.9-5.6 7.5-5.6s6.5 1.8 7.5 5.6" />
  </svg>
);

export const IcoSparkle = (p: IconProps) => (
  <svg {...svgProps({ size: 13, strokeWidth: 2.2, ...p })}>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
  </svg>
);

export const IcoCheck = (p: IconProps) => (
  <svg {...svgProps({ size: 13, strokeWidth: 2.4, ...p })}>
    <path d="M4 12.5l5 5L20 6.5" />
  </svg>
);

export const IcoWarning = (p: IconProps) => (
  <svg {...svgProps({ size: 13, strokeWidth: 2.4, ...p })}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.3v.2" />
  </svg>
);

export const IcoPin = (p: IconProps) => (
  <svg {...svgProps({ size: 15, strokeWidth: 2.2, ...p })}>
    <path d="M12 21s7-5.6 7-11a7 7 0 10-14 0c0 5.4 7 11 7 11z" />
    <circle cx="12" cy="10" r="2.4" />
  </svg>
);

export const IcoLock = (p: IconProps) => (
  <svg {...svgProps({ size: 15, strokeWidth: 2, ...p })}>
    <rect x="4" y="10.5" width="16" height="10" rx="2.5" />
    <path d="M8 10.5V8a4 4 0 018 0v2.5" />
  </svg>
);

export const IcoSun = (p: IconProps) => (
  <svg {...svgProps({ size: 19, strokeWidth: 2, ...p })}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
  </svg>
);

export const IcoMoon = (p: IconProps) => (
  <svg {...svgProps({ size: 19, strokeWidth: 2, ...p })}>
    <path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" />
  </svg>
);

export const IcoChevronDown = (p: IconProps) => (
  <svg {...svgProps({ size: 12, strokeWidth: 2.6, ...p })}>
    <path d="M5 9l7 7 7-7" />
  </svg>
);

export const IcoMail = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="M3.8 7l8.2 6 8.2-6" />
  </svg>
);

export const IcoCalendar = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
    <path d="M3.5 10h17M8 3v3.5M16 3v3.5" />
  </svg>
);

export const IcoSheet = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <rect x="4" y="3" width="16" height="18" rx="2.5" />
    <path d="M4 9h16M10 9v12" />
  </svg>
);

export const IcoMonitor = (p: IconProps) => (
  <svg {...svgProps({ size: 19, strokeWidth: 2, ...p })}>
    <rect x="3" y="4" width="18" height="12" rx="2.5" />
    <path d="M9 20h6M12 16v4" />
  </svg>
);

/* ── Estilos compartidos ──────────────────────────────────────────────── */

export const CARD: CSSProperties = {
  border: "1px solid var(--st-border)",
  borderRadius: 18,
  background: "var(--st-panel)",
  overflow: "hidden",
};

export const LABEL: CSSProperties = { fontSize: 13, fontWeight: 700, color: "var(--st-text)" };

export const HINT: CSSProperties = { fontSize: 12.5, color: "var(--st-muted)" };

export const PILL: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 800,
  letterSpacing: ".06em",
  color: "var(--st-accent-ink)",
  background: "var(--st-accent-soft)",
  padding: "3px 8px",
  borderRadius: 999,
};

export function fieldStyle(valid = true): CSSProperties {
  return {
    width: "100%",
    height: 44,
    padding: "0 14px",
    border: `1px solid ${valid ? "var(--st-border-strong)" : "var(--st-danger)"}`,
    borderRadius: 11,
    background: "var(--st-field)",
    color: "var(--st-text)",
    fontSize: 14.5,
    fontWeight: 500,
    outline: "none",
    ...(valid ? {} : { boxShadow: "0 0 0 3px rgba(209,68,75,.14)" }),
  };
}

/* ── Bloques de layout ────────────────────────────────────────────────── */

/** Sección del panel: columna de título a la izquierda, campos a la derecha. */
export function SplitSection({
  title,
  description,
  badge,
  aside,
  alt = false,
  first = false,
  children,
}: {
  title: string;
  description?: string;
  badge?: string;
  aside?: ReactNode;
  alt?: boolean;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      data-st-split
      style={{
        display: "grid",
        gridTemplateColumns: "284px 1fr",
        gap: 52,
        padding: "36px 40px",
        ...(first ? {} : { borderTop: "1px solid var(--st-border)" }),
        ...(alt ? { background: "var(--st-panel-2)" } : {}),
      }}
    >
      <div>
        {badge && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "4px 10px",
              borderRadius: 999,
              background: "var(--st-accent-soft)",
              color: "var(--st-accent-ink)",
              fontSize: 10.5,
              fontWeight: 800,
              letterSpacing: ".1em",
              marginBottom: 12,
            }}
          >
            {badge}
          </div>
        )}
        <h2
          style={{
            margin: 0,
            fontSize: badge ? 22 : 18,
            fontWeight: badge ? 800 : 700,
            letterSpacing: badge ? "-.02em" : "-.01em",
            color: "var(--st-text)",
          }}
        >
          {title}
        </h2>
        {description && (
          <p style={{ margin: "9px 0 0", fontSize: 13.5, lineHeight: 1.6, color: "var(--st-muted)" }}>
            {description}
          </p>
        )}
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Rejilla de dos columnas para los campos de una SplitSection. */
export function FieldGrid({ children }: { children: ReactNode }) {
  return (
    <div data-st-grid2 style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "22px 24px" }}>
      {children}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  full = false,
  suffix,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  full?: boolean;
  /** Pastilla a la derecha de la etiqueta (p. ej. AUTOCOMPLETADO). */
  suffix?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 7,
        ...(full ? { gridColumn: "1/-1" } : {}),
      }}
    >
      {suffix ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <label style={LABEL}>{label}</label>
          {suffix}
        </div>
      ) : (
        <label style={LABEL}>{label}</label>
      )}
      {children}
      {error ? (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12.5,
            color: "var(--st-danger)",
            fontWeight: 600,
          }}
        >
          <IcoWarning />
          {error}
        </span>
      ) : (
        hint && <span style={HINT}>{hint}</span>
      )}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  invalid = false,
  inputMode,
  maxLength,
  type = "text",
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  invalid?: boolean;
  inputMode?: "numeric" | "text" | "email" | "tel";
  maxLength?: number;
  type?: string;
  style?: CSSProperties;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      inputMode={inputMode}
      maxLength={maxLength}
      aria-invalid={invalid || undefined}
      style={{ ...fieldStyle(!invalid), ...style }}
    />
  );
}

export function SelectInput({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div style={{ position: "relative" }}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          ...fieldStyle(true),
          padding: "0 38px 0 14px",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {children}
      </select>
      <span style={{ position: "absolute", right: 14, top: 17, pointerEvents: "none", lineHeight: 0 }}>
        <IcoChevronDown stroke="var(--st-muted)" />
      </span>
    </div>
  );
}

/** Interruptor del diseño (46×27, knob 21). */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        flex: "none",
        width: 46,
        height: 27,
        borderRadius: 999,
        border: `1px solid ${checked ? "var(--st-accent)" : "var(--st-border-strong)"}`,
        background: checked ? "var(--st-accent)" : "var(--st-field-alt)",
        padding: 2,
        cursor: disabled ? "not-allowed" : "pointer",
        display: "flex",
        justifyContent: checked ? "flex-end" : "flex-start",
        alignItems: "center",
        transition: "all .16s",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <span
        style={{
          display: "block",
          width: 21,
          height: 21,
          borderRadius: "50%",
          background: checked ? "var(--st-accent-contrast)" : "var(--st-muted)",
          transition: "all .16s",
        }}
      />
    </button>
  );
}

/** Fila "texto + interruptor(es)" usada en Notificaciones y en los toggles fiscales. */
export function ToggleRow({
  title,
  description,
  badge,
  boxed = false,
  first = false,
  children,
}: {
  title: string;
  description?: string;
  badge?: string;
  /** true = tarjeta con borde (dentro de una FieldGrid); false = fila de lista. */
  boxed?: boolean;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      style={
        boxed
          ? {
              gridColumn: "1/-1",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 24,
              padding: "18px 20px",
              border: "1px solid var(--st-border)",
              borderRadius: 14,
              background: "var(--st-panel-2)",
            }
          : {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 24,
              padding: "22px 28px",
              ...(first ? {} : { borderTop: "1px solid var(--st-border)" }),
            }
      }
    >
      <div style={{ maxWidth: "60ch" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <span style={{ fontSize: boxed ? 14.5 : 15, fontWeight: 700, color: "var(--st-text)" }}>{title}</span>
          {badge && <span style={PILL}>{badge}</span>}
        </div>
        {description && (
          <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.6, color: "var(--st-muted)" }}>
            {description}
          </p>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 18, flex: "none" }}>{children}</div>
    </div>
  );
}

/** Cabecera de panel: título grande + subtítulo (+ pastilla opcional). */
export function PanelHeader({
  title,
  description,
  pill,
  children,
}: {
  title: string;
  description: string;
  pill?: string;
  children?: ReactNode;
}) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 24, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <h1
            style={{
              margin: 0,
              fontSize: 34,
              lineHeight: 1.1,
              fontWeight: 800,
              letterSpacing: "-.03em",
              textWrap: "pretty",
              color: "var(--st-text)",
            }}
          >
            {title}
          </h1>
          <p
            style={{
              margin: "12px 0 0",
              fontSize: 16,
              lineHeight: 1.6,
              color: "var(--st-muted)",
              maxWidth: "62ch",
              textWrap: "pretty",
            }}
          >
            {description}
          </p>
        </div>
        {pill && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 14px",
              borderRadius: 999,
              background: "var(--st-accent-soft)",
              border: "1px solid var(--st-border)",
              color: "var(--st-accent-ink)",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            <IcoSparkle size={14} />
            {pill}
          </div>
        )}
      </div>
      {children}
    </>
  );
}

/* ── Botones ──────────────────────────────────────────────────────────── */

export function PrimaryButton({
  onClick,
  disabled = false,
  children,
  type = "button",
}: {
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      data-st-hover="brighten"
      style={{
        height: 40,
        padding: "0 20px",
        borderRadius: 11,
        border: "none",
        background: disabled ? "var(--st-border-strong)" : "var(--st-accent)",
        color: disabled ? "var(--st-muted)" : "var(--st-accent-contrast)",
        fontSize: 14,
        fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  onClick,
  disabled = false,
  children,
  tone = "neutral",
}: {
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
  tone?: "neutral" | "danger";
}) {
  const danger = tone === "danger";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-st-hover={danger ? "danger" : "subtle"}
      style={{
        height: 40,
        padding: "0 16px",
        borderRadius: 11,
        border: `1px solid ${danger ? "var(--st-danger)" : "var(--st-border-strong)"}`,
        background: "transparent",
        color: danger ? "var(--st-danger)" : "var(--st-text-2)",
        fontSize: 14,
        fontWeight: danger ? 700 : 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        fontFamily: "inherit",
        transition: "all .16s",
      }}
    >
      {children}
    </button>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        border: "2px solid var(--st-border-strong)",
        borderTopColor: "var(--st-accent)",
        animation: "st-spin .7s linear infinite",
        display: "inline-block",
      }}
    />
  );
}

/* ── Barra flotante de guardado ───────────────────────────────────────── */

export function SaveBar({
  dirty,
  saving,
  canSave,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  saving: boolean;
  canSave: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  if (!dirty) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 40,
        display: "flex",
        justifyContent: "center",
        padding: 18,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 20,
          padding: "12px 14px 12px 22px",
          borderRadius: 14,
          background: "var(--st-panel)",
          border: "1px solid var(--st-border-strong)",
          boxShadow: "0 8px 28px rgba(6,20,18,.12)",
          pointerEvents: "auto",
          flexWrap: "wrap",
        }}
      >
        {saving ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 9,
              fontSize: 13.5,
              fontWeight: 600,
              color: "var(--st-text)",
            }}
          >
            <Spinner />
            Guardando cambios…
          </span>
        ) : canSave ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 9,
              fontSize: 13.5,
              fontWeight: 600,
              color: "var(--st-text)",
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--st-accent)" }} />
            Tienes cambios sin guardar
          </span>
        ) : (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 9,
              fontSize: 13.5,
              fontWeight: 600,
              color: "var(--st-danger)",
            }}
          >
            <IcoWarning size={15} strokeWidth={2.3} />
            Revisa los campos marcados
          </span>
        )}
        <div style={{ display: "flex", gap: 9 }}>
          <GhostButton onClick={onDiscard} disabled={saving}>
            Descartar
          </GhostButton>
          <PrimaryButton onClick={onSave} disabled={!canSave || saving}>
            Guardar cambios
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

/** Aviso de estado sobre el formulario ("Editando…" / "Todos los cambios guardados"). */
export function DirtyIndicator({ dirty, justSaved }: { dirty: boolean; justSaved: boolean }) {
  if (!dirty && !justSaved) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginTop: 22,
        fontSize: 13,
        fontWeight: 600,
        color: "var(--st-muted)",
      }}
    >
      {dirty ? (
        <span
          style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "var(--st-accent-ink)" }}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--st-accent)" }} />
          Editando · tienes cambios sin guardar
        </span>
      ) : (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <IcoCheck size={14} />
          Todos los cambios guardados
        </span>
      )}
    </div>
  );
}
