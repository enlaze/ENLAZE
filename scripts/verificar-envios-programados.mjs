/**
 * Comprueba que la migración de envíos programados ha entrado bien.
 *
 * Solo lee: pregunta a PostgREST por el esquema y por la cola. No crea ni
 * dispara nada, así que se puede lanzar contra producción sin miedo.
 *
 *   node scripts/verificar-envios-programados.mjs
 */

import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}
const headers = { apikey: key, Authorization: `Bearer ${key}` };

const ESPERADAS = [
  "id", "user_id", "channel", "title", "audience", "subject", "body",
  "schedule_type", "send_time", "days_of_week", "day_of_month", "start_date",
  "next_run_at", "last_run_at", "last_error", "status", "created_at", "updated_at",
];

const schema = await fetch(`${url}/rest/v1/`, { headers }).then((r) => r.json());
const tabla = schema.definitions?.scheduled_messages;

if (!tabla) {
  console.error("✗ La tabla scheduled_messages no está expuesta todavía.");
  console.error("  Ejecuta supabase/migrations/20260820_scheduled_messages.sql en el SQL Editor");
  console.error("  y, si sigue sin verse, lanza:  notify pgrst, 'reload schema';");
  process.exit(1);
}

const faltan = ESPERADAS.filter((c) => !(c in tabla.properties));
if (faltan.length) {
  console.error("✗ La tabla existe pero le faltan columnas:", faltan.join(", "));
  process.exit(1);
}
console.log("✓ scheduled_messages con sus", ESPERADAS.length, "columnas");

const cola = await fetch(
  `${url}/rest/v1/scheduled_messages?select=id,channel,title,status,next_run_at,last_run_at,last_error&order=next_run_at.asc.nullslast&limit=20`,
  { headers }
).then((r) => r.json());

if (!Array.isArray(cola)) {
  console.error("✗ No se pudo leer la cola:", cola);
  process.exit(1);
}

console.log(`✓ Cola legible — ${cola.length} envío(s) programado(s)`);
const vencidos = cola.filter((r) => r.status === "active" && r.next_run_at && new Date(r.next_run_at) <= new Date());
for (const r of cola) {
  const cuando = r.next_run_at
    ? new Date(r.next_run_at).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })
    : "—";
  console.log(`   · [${r.channel}] ${r.title || "(sin título)"} — ${r.status}, próximo: ${cuando}${r.last_error ? ` (${r.last_error})` : ""}`);
}
if (vencidos.length) {
  console.log(`\n→ ${vencidos.length} envío(s) ya vencido(s): el dispatcher los mandará en la próxima llamada.`);
}
