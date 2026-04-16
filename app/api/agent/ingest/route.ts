import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

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

    const results: Record<string, { inserted: number; errors: number }> = {};

    // 1. Daily summary
    if (payload.daily_summary) {
      const { error } = await supabase.from("agent_daily_summary").insert({
        user_id: userId,
        business_id: payload.business_id || null,
        execution_date: new Date().toISOString().split("T")[0],
        headline: payload.daily_summary.headline,
        priority_actions: payload.daily_summary.priority_actions || [],
        opportunities_count: payload.daily_summary.opportunities_count || 0,
        risks_count: payload.daily_summary.risks_count || 0,
        score: payload.daily_summary.score || 0,
        raw_payload: payload,
      });
      results.daily_summary = { inserted: error ? 0 : 1, errors: error ? 1 : 0 };
    }

    // 2. News
    if (payload.radar?.news?.length) {
      const rows = payload.radar.news.map((n: Record<string, unknown>) => ({
        user_id: userId,
        external_id: n.id || null,
        title: n.title,
        summary: n.summary || null,
        source: n.source || null,
        url: n.url || null,
        published_date: n.date || null,
        category: n.category || null,
        relevance: n.relevance || 5,
        tags: n.tags || [],
      }));
      const { error } = await supabase.from("agent_news").insert(rows);
      results.news = { inserted: error ? 0 : rows.length, errors: error ? 1 : 0 };
    }

    // 3. Regulations + Subsidies → signals
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
      const { error } = await supabase.from("agent_signals").insert(signals);
      results.signals = { inserted: error ? 0 : signals.length, errors: error ? 1 : 0 };
    }

    // 4. Reviews
    if (payload.reputation?.reviews?.urgent?.length) {
      const rows = payload.reputation.reviews.urgent.map((r: Record<string, unknown>) => ({
        user_id: userId,
        platform: "google",
        author: r.author,
        rating: r.rating,
        text_content: r.text,
        review_date: r.date || null,
        sentiment: "negative",
        themes: r.themes || [],
        responded: r.responded || false,
        suggested_response: r.suggested_response || null,
        urgent: true,
      }));
      const { error } = await supabase.from("agent_reviews").insert(rows);
      results.reviews = { inserted: error ? 0 : rows.length, errors: error ? 1 : 0 };
    }

    // 5. Campaigns
    if (payload.reputation?.campaigns?.length) {
      const rows = payload.reputation.campaigns.map((c: Record<string, unknown>) => ({
        user_id: userId,
        title: c.title,
        type: c.type || null,
        channel: c.channel || [],
        target_audience: c.target_audience || null,
        suggested_date: c.suggested_date || null,
        message_draft: c.message_draft || null,
        reason: c.reason || null,
      }));
      const { error } = await supabase.from("agent_campaigns").insert(rows);
      results.campaigns = { inserted: error ? 0 : rows.length, errors: error ? 1 : 0 };
    }

    // 6. Leads
    if (payload.crm?.leads?.length) {
      for (const lead of payload.crm.leads) {
        // Upsert by place_id to avoid duplicates
        if (lead.place_id) {
          const { data: existing } = await supabase
            .from("agent_leads")
            .select("id")
            .eq("user_id", userId)
            .eq("place_id", lead.place_id)
            .maybeSingle();

          if (existing) {
            await supabase.from("agent_leads").update({
              score: lead.score,
              priority: lead.priority,
              issues: lead.issues || [],
              opportunity: lead.opportunity,
              recommendation: lead.recommendation,
              updated_at: new Date().toISOString(),
            }).eq("id", existing.id);
          } else {
            await supabase.from("agent_leads").insert({
              user_id: userId,
              name: lead.name,
              business_type: lead.type || lead.business_type,
              city: lead.city,
              zone: lead.zone,
              place_id: lead.place_id,
              score: lead.score || 0,
              priority: lead.priority || "cold",
              issues: lead.issues || [],
              opportunity: lead.opportunity,
              recommendation: lead.recommendation,
            });
          }
        }
      }
      results.leads = { inserted: payload.crm.leads.length, errors: 0 };
    }

    // 7. Tasks
    if (payload.crm?.tasks?.length) {
      const rows = payload.crm.tasks.map((t: Record<string, unknown>) => ({
        user_id: userId,
        type: t.type || "follow_up",
        entity_type: t.entity_type || null,
        entity_id: t.entity_id || null,
        title: t.title,
        description: t.description || null,
        priority: t.priority || "medium",
        due_date: t.due_date || null,
      }));
      const { error } = await supabase.from("agent_tasks").insert(rows);
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
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
