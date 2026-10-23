"use client";

import React, { useState } from "react";

/** Passive, inline collection: no modal, prompt, or finalization gate. */
export function OwnPriceInput({ unit, onSave, disabled = false }: {
  unit: string;
  onSave: (price: number) => Promise<void>;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="mt-2 rounded-lg border border-amber-200 p-2 dark:border-amber-900">
      <label className="block text-xs text-navy-600 dark:text-zinc-300">
        Tu coste por {unit} (€ sin IVA)
        <input type="number" min="0.01" step="0.01" value={value}
          aria-label={`Tu precio por ${unit}`} disabled={disabled || saving}
          onChange={event => setValue(event.target.value)}
          className="mt-1 w-28 rounded border border-navy-200 bg-transparent px-2 py-1 dark:border-zinc-700" />
      </label>
      <button type="button" disabled={disabled || saving || !value}
        className="mt-2 rounded bg-brand-green px-2 py-1 text-xs font-semibold text-navy-900 disabled:opacity-50"
        onClick={async () => {
          const price = Number(value);
          if (!Number.isFinite(price) || price <= 0) { setError("Introduce un precio mayor que cero."); return; }
          setSaving(true); setError("");
          try { await onSave(price); }
          catch (failure) { setError(failure instanceof Error ? failure.message : "No se ha podido guardar tu precio."); }
          finally { setSaving(false); }
        }}>{saving ? "Guardando tu precio…" : "Guardar mi precio"}</button>
      {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
