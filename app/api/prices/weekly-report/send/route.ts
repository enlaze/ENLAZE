import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// POST /api/prices/weekly-report/send
// Called by cron (every Monday) or manually to generate and email weekly reports to all users with alerts
export async function POST() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return NextResponse.json({ error: "No RESEND_API_KEY configured" }, { status: 500 });
  }

  try {
    // 1. Find all users who have active price alerts (they opted in to price tracking)
    const { data: alertUsers } = await supabase
      .from("price_alerts")
      .select("user_id")
      .eq("is_active", true);

    const userIds = Array.from(new Set((alertUsers || []).map((a) => a.user_id)));
    if (userIds.length === 0) {
      return NextResponse.json({ sent: 0, message: "No users with active alerts" });
    }

    // 2. Calculate current week boundaries (last 7 days)
    const weekEnd = new Date();
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);
    weekStart.setHours(0, 0, 0, 0);

    // 3. Get all price observations from the last week
    const { data: observations } = await supabase
      .from("pb_price_observations")
      .select(`
        id, product_id, price_excl_vat, checked_at,
        pb_products ( commercial_name, unit_price, provider_id, pb_providers ( name ) )
      `)
      .gte("checked_at", weekStart.toISOString())
      .lte("checked_at", weekEnd.toISOString())
      .order("checked_at", { ascending: true })
      .limit(5000);

    if (!observations || observations.length === 0) {
      return NextResponse.json({ sent: 0, message: "No observations this week" });
    }

    // 4. Group by product and calculate changes
    const productChanges: Record<string, { name: string; provider: string; prices: number[] }> = {};
    for (const obs of observations) {
      const pid = obs.product_id;
      const product = obs.pb_products as any;
      if (!productChanges[pid]) {
        productChanges[pid] = {
          name: product?.commercial_name || "Desconocido",
          provider: product?.pb_providers?.name || "—",
          prices: [],
        };
      }
      productChanges[pid].prices.push(Number(obs.price_excl_vat) || 0);
    }

    const changes: any[] = [];
    let totalChangePct = 0;
    let changedCount = 0;

    for (const [, data] of Object.entries(productChanges)) {
      if (data.prices.length < 2) continue;
      const first = data.prices[0];
      const last = data.prices[data.prices.length - 1];
      if (first === 0) continue;
      const changePct = ((last - first) / first) * 100;

      if (Math.abs(changePct) > 0.01) {
        changedCount++;
        totalChangePct += changePct;
        changes.push({
          product_name: data.name,
          provider: data.provider,
          old_price: first,
          new_price: last,
          change_pct: Number(changePct.toFixed(2)),
          direction: changePct > 0 ? "up" : "down",
        });
      }
    }

    changes.sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct));

    const totalProducts = Object.keys(productChanges).length;
    const avgChangePct = changedCount > 0 ? (totalChangePct / changedCount) : 0;
    const topChanges = changes.slice(0, 10);

    if (changes.length === 0) {
      return NextResponse.json({ sent: 0, message: "No price changes this week" });
    }

    // 5. Send email to each user with active alerts
    let sent = 0;
    for (const userId of userIds) {
      const { data: userData } = await supabase.auth.admin.getUserById(userId);
      const email = userData?.user?.email;
      if (!email) continue;

      // Build email
      const changesHtml = topChanges
        .map(
          (c) =>
            `<tr>
              <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 500;">${c.product_name}</td>
              <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b;">${c.provider}</td>
              <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; text-align: right;">${Number(c.old_price).toFixed(2)}</td>
              <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 600;">${Number(c.new_price).toFixed(2)}</td>
              <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 700; color: ${c.direction === "up" ? "#ef4444" : "#10b981"};">
                ${c.direction === "up" ? "+" : ""}${c.change_pct.toFixed(1)}%
              </td>
            </tr>`
        )
        .join("");

      const dateRange = `${weekStart.toLocaleDateString("es-ES", { day: "2-digit", month: "long" })} - ${weekEnd.toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" })}`;

      const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 0 auto;">
          <div style="background: #0a1628; padding: 20px 24px; border-radius: 12px 12px 0 0;">
            <h1 style="color: #00c896; margin: 0; font-size: 22px;">enlaze</h1>
          </div>
          <div style="padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
            <h2 style="color: #0a1628; font-size: 18px; margin: 0 0 4px;">Informe semanal de precios</h2>
            <p style="color: #94a3b8; font-size: 13px; margin: 0 0 20px;">${dateRange}</p>

            <!-- KPIs -->
            <div style="display: flex; gap: 12px; margin-bottom: 20px;">
              <div style="flex: 1; background: #f8fafc; border-radius: 8px; padding: 12px; text-align: center;">
                <div style="font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600;">Productos</div>
                <div style="font-size: 24px; font-weight: 700; color: #00c896;">${totalProducts}</div>
              </div>
              <div style="flex: 1; background: #f8fafc; border-radius: 8px; padding: 12px; text-align: center;">
                <div style="font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600;">Con cambios</div>
                <div style="font-size: 24px; font-weight: 700; color: #f59e0b;">${changedCount}</div>
              </div>
              <div style="flex: 1; background: #f8fafc; border-radius: 8px; padding: 12px; text-align: center;">
                <div style="font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600;">Cambio medio</div>
                <div style="font-size: 24px; font-weight: 700; color: ${avgChangePct > 0 ? "#ef4444" : avgChangePct < 0 ? "#10b981" : "#64748b"};">
                  ${avgChangePct > 0 ? "+" : ""}${avgChangePct.toFixed(1)}%
                </div>
              </div>
            </div>

            <!-- Changes table -->
            ${topChanges.length > 0 ? `
            <h3 style="color: #0a1628; font-size: 14px; margin: 0 0 8px;">Principales cambios</h3>
            <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 20px;">
              <thead>
                <tr style="background: #f8fafc;">
                  <th style="padding: 8px 12px; text-align: left; font-weight: 600; color: #334155;">Producto</th>
                  <th style="padding: 8px 12px; text-align: left; font-weight: 600; color: #334155;">Proveedor</th>
                  <th style="padding: 8px 12px; text-align: right; font-weight: 600; color: #334155;">Antes</th>
                  <th style="padding: 8px 12px; text-align: right; font-weight: 600; color: #334155;">Ahora</th>
                  <th style="padding: 8px 12px; text-align: right; font-weight: 600; color: #334155;">Cambio</th>
                </tr>
              </thead>
              <tbody>${changesHtml}</tbody>
            </table>
            ` : ""}

            <div style="text-align: center; margin-top: 24px;">
              <a href="${process.env.NEXT_PUBLIC_APP_URL || "https://enlaze.es"}/dashboard/prices"
                 style="display: inline-block; background: #00c896; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">
                Ver rastreador de precios
              </a>
            </div>

            <p style="color: #94a3b8; font-size: 12px; margin-top: 24px; text-align: center;">
              Enlaze - Gestion inteligente para empresas de construccion
            </p>
          </div>
        </div>
      `;

      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL || "Enlaze <noreply@enlaze.es>",
            to: email,
            subject: `Enlaze: Informe semanal de precios (${changedCount} cambio${changedCount !== 1 ? "s" : ""})`,
            html,
          }),
        });
        sent++;
      } catch (e) {
        console.error(`[weekly-report/send] Email to ${email} failed:`, e);
      }

      // Also create in-app notification
      await supabase.from("notifications").insert({
        user_id: userId,
        type: "price_report",
        title: `Informe semanal: ${changedCount} cambio${changedCount !== 1 ? "s" : ""} de precio`,
        body: `${totalProducts} productos rastreados, cambio medio ${avgChangePct > 0 ? "+" : ""}${avgChangePct.toFixed(1)}%`,
        severity: "info",
        entity_type: "price_report",
        action_url: "/dashboard/prices",
      });
    }

    return NextResponse.json({ sent, totalChanges: changes.length });
  } catch (err: any) {
    console.error("[weekly-report/send] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
