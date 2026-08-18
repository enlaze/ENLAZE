"use client";

/**
 * "¿Cuándo?" — el selector de frecuencia (ahora / una vez / día / semana /
 * mes / año) con los campos que cada modo necesita y el resumen en una frase.
 * Idéntico en WhatsApp y Emails.
 */

import { DAYNAMES, DAYS, MODES, Mode, card, chipOff, chipOn, field, labelCol, sectionTitle } from "./shared";

export default function Scheduler({
  mode,
  onModeChange,
  date,
  onDateChange,
  time,
  onTimeChange,
  weekdays,
  onWeekdaysChange,
  monthday,
  onMonthdayChange,
  summary,
}: {
  mode: Mode;
  onModeChange: (next: Mode) => void;
  date: string;
  onDateChange: (next: string) => void;
  time: string;
  onTimeChange: (next: string) => void;
  weekdays: number[];
  onWeekdaysChange: (next: number[] | ((prev: number[]) => number[])) => void;
  monthday: number;
  onMonthdayChange: (next: number) => void;
  summary: string;
}) {
  return (
    <section style={{ ...card, display: "flex", flexDirection: "column", gap: 15 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--msg-brand-tx)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3.5 2" />
        </svg>
        <h2 style={sectionTitle}>¿Cuándo?</h2>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 3, padding: 3, border: "1px solid var(--msg-bd)", borderRadius: 12, background: "var(--msg-panel-2)", width: "fit-content" }}>
        {MODES.map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => onModeChange(k)}
            style={{ padding: "9px 16px", border: 0, borderRadius: 9, fontSize: 13.5, fontWeight: 700, cursor: "pointer", background: mode === k ? "var(--msg-brand-deep)" : "transparent", color: mode === k ? "#ffffff" : "var(--msg-mut)" }}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "unavez" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <label style={labelCol}>Fecha<input type="date" value={date} onChange={(e) => onDateChange(e.target.value)} style={field} /></label>
          <label style={labelCol}>Hora<input type="time" value={time} onChange={(e) => onTimeChange(e.target.value)} style={field} /></label>
        </div>
      )}

      {mode === "semana" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12.5, color: "var(--msg-mut)", fontWeight: 700 }}>
              Días de la semana <span style={{ fontWeight: 600 }}>(puedes elegir varios)</span>
            </span>
            <div style={{ display: "flex", gap: 5 }}>
              {DAYS.map((label, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={DAYNAMES[i]}
                  onClick={() => onWeekdaysChange((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : prev.concat(i)))}
                  style={{ width: 39, height: 38, borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer", borderWidth: 1, borderStyle: "solid", ...(weekdays.includes(i) ? chipOn : chipOff) }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <label style={labelCol}>Hora<input type="time" value={time} onChange={(e) => onTimeChange(e.target.value)} style={field} /></label>
          <label style={labelCol}>Empieza el<input type="date" value={date} onChange={(e) => onDateChange(e.target.value)} style={field} /></label>
        </div>
      )}

      {mode === "mes" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <label style={labelCol}>
            Día del mes
            <select value={monthday} onChange={(e) => onMonthdayChange(Number(e.target.value))} style={{ ...field, cursor: "pointer" }}>
              {Array.from({ length: 28 }, (_, i) => (
                <option key={i + 1} value={i + 1}>Día {i + 1}</option>
              ))}
            </select>
          </label>
          <label style={labelCol}>Hora<input type="time" value={time} onChange={(e) => onTimeChange(e.target.value)} style={field} /></label>
        </div>
      )}

      {mode === "ano" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <label style={labelCol}>Cada año el<input type="date" value={date} onChange={(e) => onDateChange(e.target.value)} style={field} /></label>
          <label style={labelCol}>Hora<input type="time" value={time} onChange={(e) => onTimeChange(e.target.value)} style={field} /></label>
        </div>
      )}

      {mode === "dia" && (
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
          <label style={labelCol}>Hora<input type="time" value={time} onChange={(e) => onTimeChange(e.target.value)} style={field} /></label>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "13px 15px", border: "1px solid var(--msg-bd)", borderRadius: 12, background: "var(--msg-panel-2)" }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--msg-brand-tx)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "0 0 auto" }}>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4" />
          <path d="M8 2v4" />
          <path d="M3 10h18" />
        </svg>
        <span style={{ fontSize: 14, fontWeight: 700 }}>{summary}</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--msg-mut)" }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 14h6v7l9-11h-6V3z" />
        </svg>
        <span>Los disparadores por evento (factura vencida → recordatorio) llegan en la fase 2.</span>
      </div>
    </section>
  );
}
