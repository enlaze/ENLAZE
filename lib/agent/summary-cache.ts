/**
 * Caché con TTL para los resúmenes de módulos del agente.
 *
 * Los resúmenes que pasan por un modelo (hoy Gmail, que clasifica la bandeja
 * con Haiku) se recalculaban en cada montaje del panel: abrir Emails tres veces
 * en una mañana costaba tres clasificaciones completas. Con esta caché la
 * primera visita paga y las siguientes ~15 minutos leen de base de datos.
 *
 * Vive en Postgres y no en memoria del proceso a propósito: en serverless cada
 * instancia tendría su propio Map y la caché acertaría casi nunca.
 *
 * Todo aquí falla en silencio: si la caché no está disponible, se recalcula.
 * Un resumen es siempre preferible a un error.
 *
 * Tabla: public.agent_summary_cache (migración 20260912093000).
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_TTL_MINUTES = 15;

const LOG = "[agent/summary-cache]";

/**
 * Cliente con service role: la caché es infraestructura del servidor, no un
 * dato del usuario. Con RLS, el cliente del navegador sólo puede leer su fila;
 * escribir es exclusivo de este módulo, así que nadie puede envenenar su propio
 * resumen (y con él, el prompt del briefing).
 */
function serviceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/** TTL en minutos, configurable con AGENT_SUMMARY_CACHE_TTL_MINUTES. */
export function cacheTtlMinutes(): number {
  const raw = process.env.AGENT_SUMMARY_CACHE_TTL_MINUTES;
  if (!raw || raw.trim() === "") return DEFAULT_TTL_MINUTES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_TTL_MINUTES;
  return Math.trunc(parsed);
}

export interface CachedSummary<T> {
  payload: T;
  cached_at: string;
  expires_at: string;
}

/**
 * Devuelve la entrada vigente, o null si no hay, ha caducado o la caché está
 * desactivada (TTL 0) o inaccesible.
 */
export async function readSummaryCache<T>(
  userId: string,
  moduleName: string,
): Promise<CachedSummary<T> | null> {
  if (cacheTtlMinutes() <= 0) return null;
  const supabase = serviceClient();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from("agent_summary_cache")
      .select("payload, cached_at, expires_at")
      .eq("user_id", userId)
      .eq("module", moduleName)
      .maybeSingle();

    if (error || !data) return null;
    const row = data as { payload: T; cached_at: string; expires_at: string };
    if (new Date(row.expires_at).getTime() <= Date.now()) return null;

    return {
      payload: row.payload,
      cached_at: row.cached_at,
      expires_at: row.expires_at,
    };
  } catch (err) {
    console.log(`${LOG} read failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Guarda (o reemplaza) la entrada del par (usuario, módulo).
 * Devuelve el instante de caducidad aplicado, o null si no se guardó nada.
 */
export async function writeSummaryCache(
  userId: string,
  moduleName: string,
  payload: unknown,
): Promise<{ cached_at: string; expires_at: string } | null> {
  const ttl = cacheTtlMinutes();
  if (ttl <= 0) return null;
  const supabase = serviceClient();
  if (!supabase) return null;

  const now = new Date();
  const entry = {
    cached_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttl * 60_000).toISOString(),
  };

  try {
    const { error } = await supabase.from("agent_summary_cache").upsert(
      { user_id: userId, module: moduleName, payload, ...entry },
      { onConflict: "user_id,module" },
    );
    if (error) {
      console.log(`${LOG} write failed: ${error.message}`);
      return null;
    }
    return entry;
  } catch (err) {
    console.log(`${LOG} write failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Invalida la entrada del par (usuario, módulo). Útil tras reconectar. */
export async function invalidateSummaryCache(
  userId: string,
  moduleName: string,
): Promise<void> {
  const supabase = serviceClient();
  if (!supabase) return;
  try {
    await supabase
      .from("agent_summary_cache")
      .delete()
      .eq("user_id", userId)
      .eq("module", moduleName);
  } catch (err) {
    console.log(`${LOG} invalidate failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
