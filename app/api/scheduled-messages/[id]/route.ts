/**
 * Acciones sobre un envío programado concreto.
 *
 *   PATCH  → pausar ({"status":"paused"}) y reanudar ({"status":"active"}).
 *   DELETE → cancelar: la fila se borra, no se archiva.
 *
 * Al reanudar NO se recupera el disparo perdido: se recalcula `next_run_at`
 * desde ahora. Si no, reactivar un envío pausado tres semanas dispararía de
 * golpe una tanda que el usuario ya no espera.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { isValidUuid } from "@/lib/sanitize";
import { computeNextRun, type ScheduleSpec } from "@/lib/scheduled-messages";

type RouteContext = { params: Promise<{ id: string }> };

const COLUMNS =
  "id, channel, title, audience, subject, body, schedule_type, send_time, days_of_week, day_of_month, start_date, next_run_at, last_run_at, last_error, status, created_at, updated_at";

export async function PATCH(request: Request, context: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Envío no encontrado." }, { status: 404 });
  }

  const payload = await request.json().catch(() => null);
  const wanted = (payload as { status?: unknown } | null)?.status;
  if (wanted !== "active" && wanted !== "paused") {
    return NextResponse.json(
      { error: "Solo se puede pausar o reanudar un envío programado." },
      { status: 400 }
    );
  }

  const { data: current } = await supabase
    .from("scheduled_messages")
    .select(COLUMNS)
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!current) {
    return NextResponse.json({ error: "Envío no encontrado." }, { status: 404 });
  }

  /* Un envío ya terminado o fallado no se reanuda: se crea uno nuevo. */
  if (current.status === "done" || current.status === "failed") {
    return NextResponse.json(
      { error: "Este envío ya ha terminado. Crea uno nuevo desde «Nuevo envío»." },
      { status: 409 }
    );
  }
  /* Mientras el dispatcher lo tiene reservado, pausarlo dejaría la fila en un
     estado inconsistente cuando termine de enviar. */
  if (current.status === "sending") {
    return NextResponse.json(
      { error: "El envío se está mandando ahora mismo. Inténtalo en un minuto." },
      { status: 409 }
    );
  }

  const patch: Record<string, unknown> = {
    status: wanted,
    updated_at: new Date().toISOString(),
  };

  if (wanted === "active") {
    const nextRun = computeNextRun(current as unknown as ScheduleSpec, new Date());
    if (!nextRun) {
      /* Un "una vez" cuya fecha se quedó atrás mientras estaba pausado. */
      const { data: closed } = await supabase
        .from("scheduled_messages")
        .update({ status: "done", next_run_at: null, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", user.id)
        .select(COLUMNS)
        .single();
      return NextResponse.json(
        {
          error: "La fecha de este envío ya ha pasado. Prográmalo de nuevo con una fecha futura.",
          scheduled: closed,
        },
        { status: 409 }
      );
    }
    patch.next_run_at = nextRun.toISOString();
    patch.last_error = null;
  }

  const { data, error } = await supabase
    .from("scheduled_messages")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select(COLUMNS)
    .single();

  if (error) {
    console.error("[scheduled-messages] patch failed", error.message);
    return NextResponse.json({ error: "No se pudo actualizar el envío." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, scheduled: data });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Envío no encontrado." }, { status: 404 });
  }

  const { error } = await supabase
    .from("scheduled_messages")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    console.error("[scheduled-messages] delete failed", error.message);
    return NextResponse.json({ error: "No se pudo cancelar el envío." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
