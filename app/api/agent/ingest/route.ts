import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { beginAccountWriteLease, endAccountWriteLease } from "@/lib/account-write-lease";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// A full payload can touch up to ~8 tables in sequence over separate
// round-trips; the lease TTL below (180s) must stay comfortably above this.
export const maxDuration = 60;

/**
 * POST /api/agent/ingest
 * Receives the full payload from the n8n agent and stores it in Supabase.
 * Protected by a simple API key in the Authorization header.
 */
export async function POST(req: NextRequest) {
  // Auth check — expects "Bearer <AGENT_API_KEY>"
  const authHeader = req.headers.get("authorization");
  const expectedKey = process.env.AGENT_API_KEY;
  if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const payload = await req.json();
    const userId = payload.user_id;
    if (!userId) {
      return NextResponse.json({ error: "user_id is required" }, { status: 400 });
    }

    const leaseId = await beginAccountWriteLease(supabase, userId, 180);
    try {
      return await ingestPayload(supabase, userId, payload);
    } finally {
      await endAccountWriteLease(supabase, leaseId);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.includes("proceso de eliminación") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * Fecha de ejecución del agente (YYYY-MM-DD).
 *
 * Se prefiere la que trae el propio payload — `execution_date` explícito o el
 * `timestamp` que sella el workflow al arrancar — sobre "hoy". Así un reintento
 * que cruza la medianoche UTC sigue apuntando al mismo día que el intento
 * original y el upsert lo reconoce como la misma ejecución en lugar de crear
 * filas nuevas.
 *
 * La BD está en UTC (comprobado), así que el fallback `toISOString()` coincide
 * con el `current_date` que usan las columnas `execution_date` por defecto.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveExecutionDate(payload: any): string {
  const candidates = [payload?.execution_date, payload?.timestamp];
  for (const raw of candidates) {
    if (typeof raw !== "string") continue;
    const day = raw.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day))) {
      return day;
    }
  }
  return new Date().toISOString().split("T")[0];
}

/**
 * Quita repetidos DENTRO del propio lote antes de mandarlo.
 *
 * Imprescindible con upsert: Postgres aborta la sentencia entera con «ON
 * CONFLICT DO UPDATE command cannot affect row a second time» si un mismo
 * INSERT trae dos filas con la misma clave. El payload del agente puede traer
 * la misma noticia o la misma tarea dos veces (varias fuentes, o el mismo
 * producto en dos listas), y eso no puede tumbar el guardado completo.
 *
 * Gana la última aparición, igual que en el upsert: el dato más reciente manda.
 */
function dedupeRows<T extends Record<string, unknown>>(
  rows: T[],
  keyOf: (row: T) => string,
): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) byKey.set(keyOf(row), row);
  return [...byKey.values()];
}

async function ingestPayload(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any
) {
    const results: Record<
      string,
      { inserted: number; errors: number; skipped_without_place_id?: number }
    > = {};

    // Una sola fecha para todo el payload: es lo que ata entre sí las filas de
    // una misma ejecución y lo que hace que un reintento las reconozca.
    const executionDate = resolveExecutionDate(payload);

    // 1. Daily summary
    //
    // Upsert, no insert: la clave (user_id, execution_date) tiene un índice
    // UNIQUE (migración 20260912133537), así que un reintento del workflow
    // sobrescribe el briefing del día en lugar de añadir un duplicado — y no
    // se paga dos veces por el mismo día.
    if (payload.daily_summary) {
      const { error } = await supabase
        .from("agent_daily_summary")
        .upsert(
          {
            user_id: userId,
            business_id: payload.business_id || null,
            execution_date: executionDate,
            headline: payload.daily_summary.headline,
            priority_actions: payload.daily_summary.priority_actions || [],
            opportunities_count: payload.daily_summary.opportunities_count || 0,
            risks_count: payload.daily_summary.risks_count || 0,
            score: payload.daily_summary.score || 0,
            raw_payload: payload,
          },
          { onConflict: "user_id,execution_date" },
        );
      if (error) {
        console.error("[agent/ingest] daily_summary upsert failed:", error.message);
      }
      results.daily_summary = { inserted: error ? 0 : 1, errors: error ? 1 : 0 };
    }

    // 2. News
    //
    // Clave (user_id, execution_date, dedupe_key), donde dedupe_key es la URL
    // (o el título si no hay URL). La fecha forma parte de la clave porque una
    // noticia sigue en el feed varios días y volver a guardarla mañana es
    // legítimo. `read` no viaja en el payload, así que marcar una noticia como
    // leída sobrevive a un reintento.
    if (payload.radar?.news?.length) {
      const rows = dedupeRows(
        payload.radar.news.map((n: Record<string, unknown>) => ({
          user_id: userId,
          execution_date: executionDate,
          external_id: n.id || null,
          title: n.title,
          summary: n.summary || null,
          source: n.source || null,
          url: n.url || null,
          published_date: n.date || null,
          category: n.category || null,
          relevance: n.relevance || 5,
          tags: n.tags || [],
        })),
        (r) => String(r.url || r.title || ""),
      );
      const { error } = await supabase
        .from("agent_news")
        .upsert(rows, { onConflict: "user_id,execution_date,dedupe_key" });
      if (error) console.error("[agent/ingest] news upsert failed:", error.message);
      results.news = { inserted: error ? 0 : rows.length, errors: error ? 1 : 0 };
    }

    // 3. Regulations + Subsidies → signals
    //
    // Las siete familias de señal se acumulan aquí con formas distintas (unas
    // traen severity, otras opportunity, otras action_suggested). Antes de
    // guardarlas se normalizan a un mismo juego de columnas: con upsert importa,
    // porque la actualización escribe exactamente las columnas del lote y no
    // queremos que una familia deje a medias las columnas de otra.
    const signals: Record<string, unknown>[] = [];

    if (payload.radar?.regulations?.length) {
      for (const r of payload.radar.regulations) {
        signals.push({
          user_id: userId,
          signal_type: "regulation",
          source_entity: r.type || "normativa",
          title: r.title,
          detail: r.summary || null,
          severity: r.impact === "high" ? "warning" : "info",
          action_suggested: r.action_required || null,
        });
      }
    }

    if (payload.radar?.subsidies?.length) {
      for (const s of payload.radar.subsidies) {
        signals.push({
          user_id: userId,
          signal_type: "subsidy",
          source_entity: "ayuda",
          title: s.title,
          detail: `${s.amount_range || ""} — Plazo: ${s.deadline || "sin plazo"} — ${s.target || ""}`.trim(),
          severity: "info",
          opportunity: s.url || null,
        });
      }
    }

    if (payload.radar?.competitor_signals?.length) {
      for (const c of payload.radar.competitor_signals) {
        signals.push({
          user_id: userId,
          signal_type: c.signal_type || "competitor",
          source_entity: c.competitor_name || c.name,
          title: `${c.competitor_name || c.name}: ${c.signal_type || "señal"}`,
          detail: c.detail,
          opportunity: c.opportunity || null,
        });
      }
    }

    if (payload.radar?.local_events?.length) {
      for (const e of payload.radar.local_events) {
        signals.push({
          user_id: userId,
          signal_type: "local_event",
          source_entity: e.name,
          title: e.name,
          detail: `Fecha: ${e.date || "?"} — Tráfico esperado: ${e.expected_traffic || "?"}`,
          action_suggested: e.recommendation || null,
        });
      }
    }

    if (payload.operations?.stock_signals?.length) {
      for (const s of payload.operations.stock_signals) {
        signals.push({
          user_id: userId,
          signal_type: "stock_alert",
          source_entity: s.product,
          title: `Stock bajo: ${s.product}`,
          detail: `Actual: ${s.current_stock}, Mínimo: ${s.min_stock}`,
          severity: s.urgency === "critical" ? "warning" : "info",
          action_suggested: s.action || null,
        });
      }
    }

    if (payload.operations?.margin_signals?.length) {
      for (const m of payload.operations.margin_signals) {
        signals.push({
          user_id: userId,
          signal_type: "margin_alert",
          source_entity: m.product,
          title: `Margen bajo: ${m.product} (${m.current_margin_pct}%)`,
          detail: m.issue,
          action_suggested: m.suggestion || null,
          severity: "warning",
        });
      }
    }

    if (payload.operations?.supplier_signals?.length) {
      for (const sp of payload.operations.supplier_signals) {
        signals.push({
          user_id: userId,
          signal_type: "supplier_alert",
          source_entity: sp.supplier,
          title: `${sp.supplier}: ${sp.signal}`,
          detail: sp.detail,
          opportunity: sp.alternative || null,
        });
      }
    }

    if (signals.length > 0) {
      // Clave (user_id, execution_date, signal_type + title): los dos únicos
      // campos presentes y NOT NULL en las siete familias. `source_entity` se
      // queda fuera porque en las ayudas es la constante 'ayuda' para todas
      // (colisionarían entre sí) y en las de competencia puede venir vacío.
      // `acknowledged` no viaja en el payload: dar por vista una señal aguanta
      // un reintento.
      const rows = dedupeRows(
        signals.map((s) => ({
          user_id: userId,
          execution_date: executionDate,
          signal_type: s.signal_type,
          source_entity: s.source_entity ?? null,
          title: s.title,
          detail: s.detail ?? null,
          severity: s.severity ?? "info",
          opportunity: s.opportunity ?? null,
          action_suggested: s.action_suggested ?? null,
        })),
        (r) => `${r.signal_type}|${r.title}`,
      );
      const { error } = await supabase
        .from("agent_signals")
        .upsert(rows, { onConflict: "user_id,execution_date,dedupe_key" });
      if (error) console.error("[agent/ingest] signals upsert failed:", error.message);
      results.signals = { inserted: error ? 0 : rows.length, errors: error ? 1 : 0 };
    }

    // 4. Reviews
    //
    // Es la única tabla sin identificador externo: no llega ningún review id de
    // Google y el `id` del payload es circular (reputation/summary lee de esta
    // misma tabla y reemite nuestro uuid). La identidad se toma del contenido
    // —plataforma, autor, fecha y texto—, que es lo que define una reseña, en
    // una columna generada con coalesce para que los NULL de `author` y
    // `review_date` no rompan la unicidad. Ver migración 20260912141703.
    //
    // Sin fecha de ejecución en la clave: una reseña es un objeto externo fijo,
    // no una foto del día. Una fila por reseña, que se actualiza.
    if (payload.reputation?.reviews?.urgent?.length) {
      const rows = dedupeRows(
        payload.reputation.reviews.urgent.map((r: Record<string, unknown>) => ({
          user_id: userId,
          platform: "google",
          author: r.author ?? null,
          rating: r.rating ?? null,
          text_content: r.text ?? null,
          review_date: r.date || null,
          sentiment: "negative",
          themes: r.themes || [],
          responded: r.responded || false,
          suggested_response: r.suggested_response || null,
          urgent: true,
        })),
        (r) =>
          `${r.platform}|${r.author ?? ""}|${r.review_date ?? ""}|${r.text_content ?? ""}`,
      );
      const { error } = await supabase
        .from("agent_reviews")
        .upsert(rows, { onConflict: "user_id,dedupe_key" });
      if (error) console.error("[agent/ingest] reviews upsert failed:", error.message);
      results.reviews = { inserted: error ? 0 : rows.length, errors: error ? 1 : 0 };
    }

    // 5. Campaigns (v4: reputation.campaigns, v5: marketing.campaigns)
    const campaignSource =
      payload.marketing?.campaigns?.length
        ? payload.marketing.campaigns
        : payload.reputation?.campaigns?.length
          ? payload.reputation.campaigns
          : null;
    if (campaignSource) {
      // Clave (user_id, execution_date, type + title). Es la tabla que más
      // duplicados tenía acumulados: 53 filas para 26 campañas reales, con hasta
      // 6 copias de la misma el mismo día. `status` no viaja en el payload, así
      // que si el usuario ha movido una campaña de 'idea' a otro estado, un
      // reintento no lo revierte.
      const rows = dedupeRows(
        campaignSource.map((c: Record<string, unknown>) => ({
          user_id: userId,
          execution_date: executionDate,
          title: c.title,
          type: c.type || null,
          channel: c.channel || [],
          target_audience: c.target_audience || null,
          suggested_date: c.suggested_date || null,
          message_draft: c.message_draft || null,
          reason: c.reason || null,
        })),
        (r) => `${r.type ?? ""}|${r.title}`,
      );
      const { error } = await supabase
        .from("agent_campaigns")
        .upsert(rows, { onConflict: "user_id,execution_date,dedupe_key" });
      if (error) console.error("[agent/ingest] campaigns upsert failed:", error.message);
      results.campaigns = { inserted: error ? 0 : rows.length, errors: error ? 1 : 0 };
    }

    // 6. Leads
    //
    // Clave (user_id, place_id), SIN fecha: un lead es un negocio concreto que
    // persiste y se va actualizando, no una foto del día. Con la fecha dentro
    // tendríamos una copia por cada día que el agente lo vuelve a ver y el
    // `status` que le pone el usuario se perdería cada mañana.
    //
    // Antes esto era un SELECT y luego UPDATE o INSERT por cada lead, uno a uno:
    // N+1 round-trips y una carrera entre el SELECT y el INSERT. Ahora es un solo
    // upsert atómico para todo el lote. `status` y `contacted_at` no viajan en el
    // payload, así que no se pisan.
    if (payload.crm?.leads?.length) {
      // Los leads sin place_id no se pueden identificar; ya se ignoraban antes,
      // pero se contaban como insertados. Ahora se informan aparte.
      const withPlace = payload.crm.leads.filter(
        (l: Record<string, unknown>) => l.place_id,
      );
      const skipped = payload.crm.leads.length - withPlace.length;

      const rows = dedupeRows(
        withPlace.map((lead: Record<string, unknown>) => ({
          user_id: userId,
          name: lead.name,
          business_type: lead.type || lead.business_type,
          city: lead.city,
          zone: lead.zone,
          place_id: lead.place_id,
          score: lead.score || 0,
          priority: lead.priority || "cold",
          issues: lead.issues || [],
          opportunity: lead.opportunity ?? null,
          recommendation: lead.recommendation ?? null,
          updated_at: new Date().toISOString(),
        })),
        (r) => String(r.place_id),
      );

      let error = null;
      if (rows.length > 0) {
        ({ error } = await supabase
          .from("agent_leads")
          .upsert(rows, { onConflict: "user_id,place_id" }));
        if (error) console.error("[agent/ingest] leads upsert failed:", error.message);
      }
      results.leads = {
        inserted: error ? 0 : rows.length,
        errors: error ? 1 : 0,
        ...(skipped > 0 ? { skipped_without_place_id: skipped } : {}),
      };
    }

    // 7. Tasks (v4: crm.tasks, v5: top-level tasks array)
    const taskSource =
      payload.tasks?.length
        ? payload.tasks
        : payload.crm?.tasks?.length
          ? payload.crm.tasks
          : null;
    if (taskSource) {
      // Clave (user_id, execution_date, type + entity_id + title). `entity_id`
      // entra para distinguir dos tareas del mismo tipo y titular sobre
      // entidades distintas (dos «responde al correo» de remitentes distintos).
      // La fecha entra porque las tareas se regeneran cada día: la de mañana es
      // una fila nueva con su propio estado. `status` y `completed_at` no viajan
      // en el payload, así que completar una tarea aguanta un reintento.
      const rows = dedupeRows(
        taskSource.map((t: Record<string, unknown>) => ({
          user_id: userId,
          execution_date: executionDate,
          type: t.type || "follow_up",
          entity_type: t.entity_type || t.source || null,
          entity_id: t.entity_id || null,
          title: t.title,
          description: t.description || null,
          priority: t.priority || "medium",
          due_date: t.due_date || null,
        })),
        (r) => `${r.type}|${r.entity_id ?? ""}|${r.title}`,
      );
      const { error } = await supabase
        .from("agent_tasks")
        .upsert(rows, { onConflict: "user_id,execution_date,dedupe_key" });
      if (error) console.error("[agent/ingest] tasks upsert failed:", error.message);
      results.tasks = { inserted: error ? 0 : rows.length, errors: error ? 1 : 0 };
    }

    // Update agent run metadata on profile
    await supabase
      .from("profiles")
      .update({
        agent_last_run_at: new Date().toISOString(),
        agent_status: "idle",
      })
      .eq("id", userId);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      user_id: userId,
      results,
    });
}
