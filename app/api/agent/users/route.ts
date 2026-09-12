import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Días sin actividad a partir de los cuales una cuenta se considera dormida. */
const DEFAULT_INACTIVE_DAYS = 14;

interface EligibleUserRow {
  user_id: string;
  business_name: string | null;
  business_type: string | null;
  city: string | null;
  agent_status: string | null;
  agent_last_run_at: string | null;
  last_activity_at: string | null;
  activity_source: string | null;
  is_active: boolean;
}

/**
 * Umbral de inactividad en días. Se puede ajustar sin tocar el código:
 *   - `?inactive_days=N` en la llamada (gana sobre todo lo demás)
 *   - `AGENT_INACTIVE_DAYS` en el entorno
 *   - 14 días por defecto
 * Un 0 (o negativo) desactiva el filtro y devuelve todas las cuentas con el
 * agente activo, útil para depurar o forzar una ejecución completa.
 */
function resolveInactiveDays(req: NextRequest): number {
  const raw =
    req.nextUrl.searchParams.get("inactive_days") ??
    process.env.AGENT_INACTIVE_DAYS;
  if (raw == null || raw.trim() === "") return DEFAULT_INACTIVE_DAYS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_INACTIVE_DAYS;
  return Math.max(0, Math.trunc(parsed));
}

/**
 * GET /api/agent/users?sector=comercio_local[&inactive_days=14]
 *
 * Devuelve los usuarios con agent_enabled=true del sector que además han dado
 * señales de vida recientemente (último login de auth.users, profiles
 * .last_login_at o su última acción en activity_log). Las cuentas dormidas se
 * saltan para no gastar llamadas al modelo en quien no va a leer el briefing.
 *
 * Deliberadamente NO se filtra por agent_last_run_at: eso excluiría a los
 * usuarios nuevos, que todavía no han generado ningún briefing.
 *
 * El cálculo vive en la función agent_eligible_users porque el último login
 * real está en auth.users, un esquema que PostgREST no expone.
 */
export async function GET(req: NextRequest) {
  try {
    // Auth check
    const authHeader = req.headers.get("authorization");
    const expectedKey = process.env.AGENT_API_KEY;
    if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sector = req.nextUrl.searchParams.get("sector") || "comercio_local";
    const inactiveDays = resolveInactiveDays(req);

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase.rpc("agent_eligible_users", {
      p_sector: sector,
      p_inactive_days: inactiveDays,
    });

    if (error) {
      console.error("[agent/users] Supabase error:", error.message);
      return NextResponse.json(
        { error: "Database error", detail: error.message },
        { status: 500 },
      );
    }

    const rows = (data || []) as EligibleUserRow[];
    const active = rows.filter((u) => u.is_active);
    const skipped = rows.filter((u) => !u.is_active);

    if (skipped.length > 0) {
      console.log(
        `[agent/users] ${skipped.length} cuenta(s) dormida(s) saltada(s) ` +
          `(sector=${sector}, umbral=${inactiveDays}d): ` +
          skipped
            .map(
              (u) =>
                `${u.business_name || u.user_id}@${u.last_activity_at || "sin actividad"}`,
            )
            .join(", "),
      );
    }

    return NextResponse.json({
      ok: true,
      sector,
      inactive_days: inactiveDays,
      count: active.length,
      skipped_inactive: skipped.length,
      users: active.map((u) => ({
        user_id: u.user_id,
        business_name: u.business_name || "Sin nombre",
        business_type: u.business_type || "comercio",
        city: u.city || "",
        agent_status: u.agent_status || "idle",
        agent_last_run_at: u.agent_last_run_at,
        last_activity_at: u.last_activity_at,
        activity_source: u.activity_source,
      })),
      // Visible para depurar por qué un usuario no ha recibido briefing hoy.
      skipped: skipped.map((u) => ({
        user_id: u.user_id,
        business_name: u.business_name || "Sin nombre",
        last_activity_at: u.last_activity_at,
        activity_source: u.activity_source,
      })),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[agent/users] Unhandled error:", message);
    return NextResponse.json(
      { error: "Internal server error", detail: message },
      { status: 500 },
    );
  }
}
