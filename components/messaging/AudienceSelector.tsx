"use client";

/**
 * "¿A quién?" — buscador, filtros rápidos y chips de seleccionados.
 * Igual en WhatsApp y Emails; solo cambian el texto del buscador, el dato
 * secundario que se enseña en el desplegable (empresa o email) y la nota
 * de la derecha con los clientes que quedan fuera.
 */

import {
  FILTERS,
  MessagingClient,
  FilterKey,
  card,
  chipOff,
  chipOn,
  idsForFilter,
  initials,
  sectionTitle,
  shortName,
} from "./shared";

export default function AudienceSelector({
  clients,
  selected,
  onSelectedChange,
  filter,
  onFilterChange,
  query,
  onQueryChange,
  showMore,
  onShowMoreChange,
  loading,
  searchPlaceholder,
  /** Qué se enseña bajo el nombre en el desplegable de resultados. */
  secondaryOf,
  /** Texto cuando no hay ningún cliente contactable. */
  emptyHint,
  /** Nota opcional alineada a la derecha (p. ej. "3 clientes sin email"). */
  trailingNote,
}: {
  clients: MessagingClient[];
  selected: string[];
  onSelectedChange: (next: string[] | ((prev: string[]) => string[])) => void;
  filter: FilterKey;
  onFilterChange: (next: FilterKey) => void;
  query: string;
  onQueryChange: (next: string) => void;
  showMore: boolean;
  onShowMoreChange: (next: boolean) => void;
  loading: boolean;
  searchPlaceholder: string;
  secondaryOf: (c: MessagingClient) => string;
  emptyHint: string;
  trailingNote?: string;
}) {
  const byId = new Map(clients.map((c) => [c.id, c]));
  const sel = selected.map((id) => byId.get(id)).filter(Boolean) as MessagingClient[];
  const n = sel.length;

  const q = query.trim().toLowerCase();
  const results = !q
    ? []
    : clients
        .filter((c) => (c.name + " " + c.company + " " + c.address).toLowerCase().includes(q))
        .slice(0, 6);

  const shown = showMore ? sel : sel.slice(0, 2);

  const applyFilter = (k: FilterKey) => {
    onFilterChange(k);
    onSelectedChange(idsForFilter(k, clients));
    onShowMoreChange(false);
  };

  return (
    <section style={{ ...card, display: "flex", flexDirection: "column", gap: 15 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--msg-brand-tx)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        <h2 style={sectionTitle}>¿A quién?</h2>
        <span style={{ marginLeft: "auto", padding: "5px 12px", borderRadius: 20, background: "var(--msg-brand-soft)", color: "var(--msg-brand-tx)", fontSize: 12.5, fontWeight: 700 }}>
          {n === 1 ? "1 cliente seleccionado" : n + " clientes seleccionados"}
        </span>
      </div>

      <div style={{ position: "relative" }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--msg-mut)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ position: "absolute", left: 14, top: 12 }}>
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={searchPlaceholder}
          style={{ width: "100%", padding: "11px 14px 11px 39px", border: "1px solid var(--msg-bd)", borderRadius: 11, background: "var(--msg-panel-2)", color: "var(--msg-tx)", fontSize: 14, outline: "none" }}
        />
        {results.length > 0 && (
          <div style={{ position: "absolute", zIndex: 5, top: 47, left: 0, right: 0, border: "1px solid var(--msg-bd-2)", borderRadius: 12, background: "var(--msg-panel)", boxShadow: "var(--msg-pop-sh)", overflow: "hidden", maxHeight: 252, overflowY: "auto" }}>
            {results.map((r) => (
              <div
                key={r.id}
                data-msg-row
                data-msg-hover
                onClick={() => {
                  onSelectedChange((prev) => (prev.includes(r.id) ? prev : prev.concat(r.id)));
                  onQueryChange("");
                }}
                style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid var(--msg-bd)" }}
              >
                <span style={{ width: 29, height: 29, flex: "0 0 auto", borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--msg-brand-soft)", color: "var(--msg-brand-tx)", fontSize: 11, fontWeight: 800 }}>{initials(r.name)}</span>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{r.name}</span>
                <span style={{ fontSize: 12.5, color: "var(--msg-mut)" }}>{secondaryOf(r)}</span>
                <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: r.overdue > 0 ? "var(--msg-dang)" : "var(--msg-mut)" }}>
                  {selected.includes(r.id) ? "ya añadido" : r.overdue > 0 ? "factura vencida" : r.pending > 0 ? "presupuesto pendiente" : "al día"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {FILTERS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => applyFilter(k)}
            style={{ padding: "8px 15px", borderRadius: 20, fontSize: 13.5, fontWeight: 700, cursor: "pointer", borderWidth: 1, borderStyle: "solid", ...(filter === k ? chipOn : chipOff) }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", minHeight: 36 }}>
        {shown.map((c) => (
          <span key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px 5px 5px", border: "1px solid var(--msg-bd)", borderRadius: 20, background: "var(--msg-panel-2)" }}>
            <span style={{ width: 25, height: 25, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--msg-brand-soft)", color: "var(--msg-brand-tx)", fontSize: 10.5, fontWeight: 800 }}>{initials(c.name)}</span>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{shortName(c.name)}</span>
            <button
              type="button"
              aria-label={"Quitar " + c.name}
              onClick={() => {
                onSelectedChange((prev) => prev.filter((i) => i !== c.id));
                onFilterChange("");
              }}
              style={{ display: "grid", placeItems: "center", width: 16, height: 16, padding: 0, border: 0, background: "transparent", color: "var(--msg-mut)", cursor: "pointer" }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </span>
        ))}
        {sel.length > 2 && (
          <button type="button" onClick={() => onShowMoreChange(!showMore)} style={{ padding: "6px 10px", border: 0, background: "transparent", color: "var(--msg-brand-tx)", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>
            {showMore ? "Ver menos" : "+" + (sel.length - 2) + " más"}
          </button>
        )}
        {n === 0 && (
          <span style={{ fontSize: 13.5, color: "var(--msg-mut)" }}>
            {loading
              ? "Cargando clientes…"
              : clients.length === 0
                ? emptyHint
                : "Nadie seleccionado todavía — usa un filtro o el buscador."}
          </span>
        )}
        {trailingNote && (
          <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--msg-mut)" }}>{trailingNote}</span>
        )}
      </div>
    </section>
  );
}
