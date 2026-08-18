"use client";

/**
 * "¿Qué?" — plantillas, asunto opcional, cuerpo con las variables resaltadas
 * y los botones para insertarlas. El preview de la derecha lo pone cada canal
 * (la burbuja de WhatsApp o la bandeja de Gmail) a través de `preview`.
 *
 * El resaltado funciona superponiendo un textarea transparente sobre una capa
 * pintada: el usuario escribe en el textarea y ve la capa de debajo.
 */

import React, { useRef } from "react";
import { VAR_TOKENS, card, highlightSegments, sectionTitle } from "./shared";

export default function Composer({
  icon,
  templates,
  template,
  onTemplatePick,
  subject,
  bodyLabel,
  bodyMinHeight = 128,
  text,
  onTextChange,
  charLabel,
  footnote,
  previewWidth = 320,
  preview,
  previewCaption,
}: {
  icon: React.ReactNode;
  templates: { name: string }[];
  template: string;
  onTemplatePick: (name: string) => void;
  /** Si se pasa, se pinta el campo "Asunto" sobre el cuerpo. */
  subject?: { value: string; onChange: (next: string) => void; placeholder: string };
  bodyLabel?: string;
  bodyMinHeight?: number;
  text: string;
  onTextChange: (next: string) => void;
  charLabel: string;
  footnote?: string;
  previewWidth?: number;
  preview: React.ReactNode;
  previewCaption: React.ReactNode;
}) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const segments = highlightSegments(text);

  /* Inserta la variable donde está el cursor, no al final. */
  const insertVar = (token: string) => {
    const ta = taRef.current;
    const at = ta ? (ta.selectionStart ?? text.length) : text.length;
    onTextChange(text.slice(0, at) + token + text.slice(at));
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      const p = at + token.length;
      ta.setSelectionRange(p, p);
    });
  };

  const body = (
    <div style={{ position: "relative", border: "1px solid var(--msg-bd)", borderRadius: 12, background: "var(--msg-panel-2)", overflow: "hidden" }}>
      <div style={{ whiteSpace: "pre-wrap", overflowWrap: "break-word", padding: "14px 16px", minHeight: bodyMinHeight, fontSize: 15, lineHeight: "25px", fontWeight: 500 }}>
        {segments.map((s, i) => (
          <span key={i} style={{ borderRadius: 5, background: s.bg, color: s.fg, fontWeight: s.fw }}>{s.t}</span>
        ))}
      </div>
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        spellCheck={false}
        aria-label={bodyLabel || "Mensaje"}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", padding: "14px 16px", fontSize: 15, lineHeight: "25px", fontWeight: 500, border: 0, outline: "none", resize: "none", background: "transparent", color: "transparent", caretColor: "var(--msg-brand)" }}
      />
    </div>
  );

  return (
    <section data-msg-compose style={{ ...card, display: "grid", gridTemplateColumns: `minmax(0,1fr) ${previewWidth}px`, gap: 28 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          {icon}
          <h2 style={sectionTitle}>¿Qué?</h2>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--msg-brand-tx)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18" />
              <path d="M9 21V9" />
            </svg>
            <select
              value={template}
              onChange={(e) => onTemplatePick(e.target.value)}
              aria-label="Plantillas guardadas"
              style={{ border: "1px solid var(--msg-bd)", borderRadius: 9, background: "var(--msg-panel-2)", color: "var(--msg-tx)", fontSize: 13, fontWeight: 600, padding: "7px 10px", outline: "none", cursor: "pointer" }}
            >
              <option value="">Plantillas guardadas…</option>
              {templates.map((t) => (
                <option key={t.name} value={t.name}>{t.name}</option>
              ))}
            </select>
          </div>
        </div>

        {subject && (
          <label style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <span style={{ fontSize: 12.5, color: "var(--msg-mut)", fontWeight: 700 }}>Asunto</span>
            <input
              value={subject.value}
              onChange={(e) => subject.onChange(e.target.value)}
              placeholder={subject.placeholder}
              style={{ width: "100%", padding: "11px 14px", border: "1px solid var(--msg-bd)", borderRadius: 11, background: "var(--msg-panel-2)", color: "var(--msg-tx)", fontSize: 14.5, fontWeight: 600, outline: "none" }}
            />
          </label>
        )}

        {bodyLabel ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <span style={{ fontSize: 12.5, color: "var(--msg-mut)", fontWeight: 700 }}>{bodyLabel}</span>
            {body}
          </div>
        ) : (
          body
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: "var(--msg-mut)", fontWeight: 600 }}>Insertar variable</span>
          {VAR_TOKENS.map((token) => (
            <button
              key={token}
              type="button"
              onClick={() => insertVar(token)}
              style={{ padding: "5px 10px", border: "1px dashed var(--msg-brand)", borderRadius: 7, background: "var(--msg-brand-soft)", color: "var(--msg-brand-tx)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, fontWeight: 500, cursor: "pointer" }}
            >
              {token}
            </button>
          ))}
          <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--msg-mut)" }}>{charLabel}</span>
        </div>

        {footnote && <span style={{ fontSize: 12, color: "var(--msg-mut)" }}>{footnote}</span>}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {preview}
        <span style={{ fontSize: 12, color: "var(--msg-mut)", lineHeight: 1.5, textAlign: "center" }}>{previewCaption}</span>
      </div>
    </section>
  );
}
