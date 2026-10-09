/** Rebuild G3 L1b SQL from the last deployed bodies, without reformatting them. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

export const sourcePaths = {
  replace: "supabase/migrations/20260908111706_replace_budget_items_persist_cost.sql",
  update: "supabase/migrations/20260901120000_budget_items_sort_order.sql",
  internal: "supabase/migrations/20260915160000_budget_revision_rpcs.sql",
};

export function extractFunction(sql, signature, closing) {
  const start = sql.indexOf(signature);
  assert.ok(start >= 0, `missing ${signature}`);
  const end = sql.indexOf(closing, start);
  assert.ok(end > start, `missing ${closing}`);
  return sql.slice(start, end + closing.length);
}

export function replaceOnce(body, oldText, newText) {
  const first = body.indexOf(oldText);
  assert.ok(first >= 0, `missing SQL anchor: ${oldText}`);
  assert.equal(body.indexOf(oldText, first + oldText.length), -1, `duplicate SQL anchor: ${oldText}`);
  return body.slice(0, first) + newText + body.slice(first + oldText.length);
}

export function originalBodies() {
  return {
    replace: extractFunction(read(sourcePaths.replace),
      "create or replace function public.replace_budget_items(", "$function$;"),
    update: extractFunction(read(sourcePaths.update),
      "create or replace function public.update_budget_with_items(", "$$;"),
    internal: extractFunction(read(sourcePaths.internal),
      "create function budget_internal.replace_items(", "$fn$;"),
    duplicate: extractFunction(read(sourcePaths.internal),
      "create function public.duplicate_budget(", "$fn$;"),
  };
}

export function deployableOriginalBodies() {
  const bodies = originalBodies();
  return {
    ...bodies,
    internal: replaceOnce(bodies.internal,
      "create function budget_internal.replace_items(",
      "create or replace function budget_internal.replace_items("),
    duplicate: replaceOnce(bodies.duplicate,
      "create function public.duplicate_budget(",
      "create or replace function public.duplicate_budget("),
  };
}

export function upgradedBodies() {
  const original = originalBodies();
  let replacement = replaceOnce(original.replace,
    "    price_type\n  )", "    price_type,\n    price_source_type,\n    price_confidence,\n    price_checked_at\n  )");
  replacement = replaceOnce(replacement,
    "         nullif(t.item->>'price_type', '')\n",
    "         nullif(t.item->>'price_type', ''),\n" +
    "         nullif(t.item->>'price_source_type', ''),\n" +
    "         nullif(t.item->>'price_confidence', '')::numeric,\n" +
    "         nullif(t.item->>'price_checked_at', '')::timestamptz\n");

  let update = replaceOnce(original.update,
    "    price_type\n  )", "    price_type,\n    price_source_type,\n    price_confidence,\n    price_checked_at\n  )");
  update = replaceOnce(update,
    "         nullif(item->>'price_type', '')\n",
    "         nullif(item->>'price_type', ''),\n" +
    "         nullif(item->>'price_source_type', ''),\n" +
    "         nullif(item->>'price_confidence', '')::numeric,\n" +
    "         nullif(item->>'price_checked_at', '')::timestamptz\n");
  let internal = deployableOriginalBodies().internal;
  internal = replaceOnce(internal,
    "    canonical_source_ref, price_type)",
    "    canonical_source_ref, price_type, price_source_type,\n" +
    "    price_confidence, price_checked_at)");
  internal = replaceOnce(internal,
    "    nullif(t.item->>'canonical_source_ref', ''), nullif(t.item->>'price_type', '')\n",
    "    nullif(t.item->>'canonical_source_ref', ''), nullif(t.item->>'price_type', ''),\n" +
    "    nullif(t.item->>'price_source_type', ''),\n" +
    "    nullif(t.item->>'price_confidence', '')::numeric,\n" +
    "    nullif(t.item->>'price_checked_at', '')::timestamptz\n");
  let duplicate = deployableOriginalBodies().duplicate;
  duplicate = replaceOnce(duplicate,
    "    canonical_confidence, canonical_source, canonical_origin, canonical_source_ref, price_type)",
    "    canonical_confidence, canonical_source, canonical_origin, canonical_source_ref, price_type,\n" +
    "    price_source_type, price_confidence, price_checked_at)");
  duplicate = replaceOnce(duplicate,
    "    i.canonical_confidence, i.canonical_source, i.canonical_origin, i.canonical_source_ref, i.price_type\n",
    "    i.canonical_confidence, i.canonical_source, i.canonical_origin, i.canonical_source_ref, i.price_type,\n" +
    "    i.price_source_type, i.price_confidence, i.price_checked_at\n");
  return { replace: replacement, update, internal, duplicate };
}

export function migrationText() {
  const bodies = upgradedBodies();
  return `-- G3 lote 1b: transportar procedencia sin cambiar importes ni versiones.\n` +
    `-- Los cuerpos proceden literalmente de 20260908111706, 20260901120000\n` +
    `-- y 20260915160000; la funcion interna conserva firma y dependencias.\n` +
    `-- Solo cambian las tres columnas y expresiones de sus INSERT.\n` +
    `${bodies.replace}\n\n${bodies.update}\n\n${bodies.internal}\n\n${bodies.duplicate}\n\n` +
    `comment on column public.budget_items.price_source_type is\n` +
    `  'G3. Nivel que eligio el resolutor para el precio, o user_edited si la persona cambio el importe. Valores esperados: manual_locked, private_tariff, negotiated, historical_approved, preferred_supplier, provider_updated, private_bc3, technical_bank, enlaze_base, market_estimate, estimated, user_edited. NULL = partida anterior a G3; no significa que careciera de fuente.';\n` +
    `notify pgrst, 'reload schema';\n`;
}

export function rollbackBlock() {
  const bodies = deployableOriginalBodies();
  return `-- BEGIN ROLLBACK_G3_L1B\n` +
    `-- Reponer estos cuatro cuerpos ANTES de ROLLBACK_G3_L1A: las funciones de\n` +
    `-- G3 L1b no compilan sin las tres columnas. El orden NO es intercambiable.\n` +
    `begin;\n${bodies.replace}\n\n${bodies.update}\n\n${bodies.internal}\n\n${bodies.duplicate}\n\n` +
    `comment on column public.budget_items.price_source_type is\n` +
    `  'G3. Nivel que eligio el resolutor para el precio. Valores esperados: manual_locked, private_tariff, negotiated, historical_approved, preferred_supplier, provider_updated, private_bc3, technical_bank, enlaze_base, market_estimate, estimated. NULL = partida anterior a G3; no significa que careciera de fuente.';\n` +
    `notify pgrst, 'reload schema';\ncommit;\n-- END ROLLBACK_G3_L1B\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(join(root, "supabase/migrations/20261008130000_budget_items_price_provenance_writers.sql"), migrationText());
  const rollbackPath = join(root, "docs/fase2/ROLLBACK.sql");
  let rollback = readFileSync(rollbackPath, "utf8");
  rollback = rollback.replace(/-- BEGIN ROLLBACK_G3_L1B[\s\S]*?-- END ROLLBACK_G3_L1B\n?/, "").trimEnd() + "\n";
  assert.ok(rollback.includes("-- BEGIN ROLLBACK_G3_L1A"));
  writeFileSync(rollbackPath, rollback.replace("-- BEGIN ROLLBACK_G3_L1A",
    () => rollbackBlock() + "\n-- BEGIN ROLLBACK_G3_L1A"));
}
