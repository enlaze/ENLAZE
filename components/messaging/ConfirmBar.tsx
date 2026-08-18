"use client";

/** La barra final: recap de destinatarios y el botón que confirma el envío. */

export default function ConfirmBar({
  recap,
  label,
  enabled,
  busy,
  onConfirm,
}: {
  recap: string;
  label: string;
  /** Pinta el botón en verde; en gris significa "aún no puedes enviar". */
  enabled: boolean;
  busy: boolean;
  onConfirm: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", padding: "17px 22px", border: "1px solid var(--msg-bd)", borderRadius: 16, background: "var(--msg-panel)", boxShadow: "var(--msg-sh)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--msg-mut)", fontSize: 13.5, fontWeight: 600 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        <span>Vista previa antes de confirmar</span>
      </div>
      <span style={{ fontSize: 13.5, color: "var(--msg-tx-2)", marginLeft: "auto" }}>{recap}</span>
      <button
        type="button"
        onClick={onConfirm}
        disabled={busy}
        style={{ display: "flex", alignItems: "center", gap: 9, padding: "13px 22px", border: 0, borderRadius: 12, fontSize: 14.5, fontWeight: 800, cursor: busy ? "wait" : "pointer", background: enabled ? "var(--msg-brand-deep)" : "var(--msg-chip)", color: enabled ? "#ffffff" : "var(--msg-mut)" }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m22 2-7 20-4-9-9-4Z" />
          <path d="M22 2 11 13" />
        </svg>
        {label}
      </button>
    </div>
  );
}
