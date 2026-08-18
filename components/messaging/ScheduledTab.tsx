"use client";

/**
 * Pestaña "Programados": la cola de envíos con su línea de tiempo y, debajo,
 * el historial de lo ya enviado.
 *
 * OJO: la cola es estado local del canal — todavía no hay tabla ni cron que
 * despache envíos diferidos. El motor persistente es un paso aparte.
 */

import { HistoryRow, QueueItem, initials, queueBtn, sectionTitle } from "./shared";

export default function ScheduledTab({
  queue,
  onQueueChange,
  history,
  emptyBody,
  historyTitle,
  historyEmpty,
  onCreateFirst,
  onEdit,
  onCancel,
}: {
  queue: QueueItem[];
  onQueueChange: (next: QueueItem[] | ((prev: QueueItem[]) => QueueItem[])) => void;
  history: HistoryRow[];
  emptyBody: string;
  historyTitle: string;
  historyEmpty: string;
  onCreateFirst: () => void;
  onEdit: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {queue.length === 0 ? (
        <div style={{ border: "1px solid var(--msg-bd)", borderRadius: 16, background: "var(--msg-panel)", boxShadow: "var(--msg-sh)", padding: "64px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, display: "grid", placeItems: "center", background: "var(--msg-brand-soft)" }}>
            <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="var(--msg-brand-tx)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4" />
              <path d="M8 2v4" />
              <path d="M3 10h18" />
              <path d="M12 14v4" />
              <path d="M10 16h4" />
            </svg>
          </div>
          <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.02em" }}>Sin envíos programados</span>
          <span style={{ fontSize: 14, color: "var(--msg-mut)", maxWidth: 380, lineHeight: 1.6 }}>{emptyBody}</span>
          <button type="button" onClick={onCreateFirst} style={{ marginTop: 8, padding: "12px 20px", border: 0, borderRadius: 12, background: "var(--msg-brand-deep)", color: "#fff", fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
            Crear el primer envío
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {queue.map((q) => {
            const active = q.status === "Activo";
            return (
              <div key={q.id} style={{ display: "flex", gap: 14 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 24, flex: "0 0 10px" }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: active ? "var(--msg-brand)" : "var(--msg-warn)" }} />
                  <span style={{ flex: 1, width: 1, background: "var(--msg-bd)" }} />
                </div>
                <div style={{ flex: 1, minWidth: 0, border: "1px solid var(--msg-bd)", borderRadius: 15, background: "var(--msg-panel)", boxShadow: "var(--msg-sh)", padding: "17px 19px", display: "flex", flexDirection: "column", gap: 13 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ padding: "4px 10px", borderRadius: 7, background: "var(--msg-brand-soft)", color: "var(--msg-brand-tx)", fontSize: 11.5, fontWeight: 800 }}>{q.canal}</span>
                    <span style={{ fontSize: 15.5, fontWeight: 800, letterSpacing: "-.02em" }}>{q.titulo}</span>
                    <span style={{ padding: "4px 11px", borderRadius: 20, background: active ? "var(--msg-brand-soft)" : "var(--msg-warn-soft)", color: active ? "var(--msg-brand-tx)" : "var(--msg-warn)", fontSize: 11.5, fontWeight: 800, marginLeft: "auto" }}>{q.status}</span>
                  </div>
                  <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 13, color: "var(--msg-tx-2)", fontWeight: 600 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--msg-mut)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
                      {q.recips}
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--msg-mut)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></svg>
                      {q.next}
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--msg-mut)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 2l4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></svg>
                      {q.rec}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid var(--msg-bd)", paddingTop: 13 }}>
                    <button
                      type="button"
                      onClick={() => onQueueChange((prev) => prev.map((x) => (x.id === q.id ? { ...x, status: x.status === "Pausado" ? "Activo" : "Pausado" } : x)))}
                      style={queueBtn}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                      {q.status === "Pausado" ? "Reanudar" : "Pausar"}
                    </button>
                    <button type="button" onClick={onEdit} style={queueBtn}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onQueueChange((prev) => prev.filter((x) => x.id !== q.id));
                        onCancel();
                      }}
                      style={{ ...queueBtn, background: "transparent", color: "var(--msg-dang)", marginLeft: "auto" }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                      Cancelar
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={sectionTitle}>{historyTitle}</h2>
          <span style={{ fontSize: 13, color: "var(--msg-mut)" }}>enviados y fallidos</span>
        </div>
        <div style={{ border: "1px solid var(--msg-bd)", borderRadius: 15, background: "var(--msg-panel)", boxShadow: "var(--msg-sh)", overflow: "hidden" }}>
          {history.length === 0 ? (
            <div style={{ padding: "40px 20px", textAlign: "center", fontSize: 13.5, color: "var(--msg-mut)" }}>{historyEmpty}</div>
          ) : (
            history.map((h) => (
              <div key={h.id} data-msg-row style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 19px", borderBottom: "1px solid var(--msg-bd)" }}>
                <span style={{ width: 29, height: 29, flex: "0 0 auto", borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--msg-chip)", color: "var(--msg-tx-2)", fontSize: 10.5, fontWeight: 800 }}>{initials(h.name)}</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{h.name}</span>
                  <span style={{ fontSize: 12.5, color: "var(--msg-mut)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.titulo}</span>
                </div>
                <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--msg-mut)", whiteSpace: "nowrap" }}>{h.when}</span>
                <span style={{ padding: "4px 11px", borderRadius: 20, background: h.status === "Enviado" ? "var(--msg-brand-soft)" : "var(--msg-dang-soft)", color: h.status === "Enviado" ? "var(--msg-brand-tx)" : "var(--msg-dang)", fontSize: 11.5, fontWeight: 800, whiteSpace: "nowrap" }}>{h.status}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
