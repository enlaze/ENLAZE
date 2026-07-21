import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// This endpoint is called after price sync (from webhook or cron)
// It checks all active alerts against current prices and creates notifications
export async function POST(request: Request) {
  // Use service role for cross-user operations
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    const body = await request.json().catch(() => ({}));
    const { provider_id } = body; // optionally filter by provider

    // 1. Get all active alerts
    const alertQuery = supabase
      .from("price_alerts")
      .select("*")
      .eq("is_active", true);

    const { data: alerts, error: alertErr } = await alertQuery;
    if (alertErr) throw alertErr;
    if (!alerts || alerts.length === 0) {
      return NextResponse.json({ processed: 0, triggered: 0 });
    }

    // 2. Get current prices for products with alerts
    const productIds = alerts
      .map((a) => a.product_id)
      .filter(Boolean);

    let currentPrices: Record<string, number> = {};
    if (productIds.length > 0) {
      const { data: products } = await supabase
        .from("pb_products")
        .select("id, unit_price, commercial_name, provider_id, pb_providers(name)")
        .in("id", productIds);

      for (const p of products || []) {
        currentPrices[p.id] = Number(p.unit_price) || 0;
      }
    }

    // 3. Check each alert
    let triggered = 0;
    const notifications: any[] = [];
    const alertUpdates: any[] = [];
    const alertNotifRecords: any[] = [];

    for (const alert of alerts) {
      if (!alert.product_id || !currentPrices[alert.product_id]) continue;

      const currentPrice = currentPrices[alert.product_id];
      const referencePrice = Number(alert.reference_price) || Number(alert.last_price) || 0;

      if (referencePrice === 0 || currentPrice === referencePrice) continue;

      const changePct = ((currentPrice - referencePrice) / referencePrice) * 100;
      const absChangePct = Math.abs(changePct);
      const direction = changePct > 0 ? "up" : "down";

      let shouldTrigger = false;

      switch (alert.alert_type) {
        case "any_change":
          shouldTrigger = absChangePct > 0.01;
          break;
        case "threshold_pct":
          shouldTrigger = absChangePct >= (Number(alert.threshold_pct) || 5);
          break;
        case "price_above":
          shouldTrigger = currentPrice > (Number(alert.threshold_price) || Infinity);
          break;
        case "price_below":
          shouldTrigger = currentPrice < (Number(alert.threshold_price) || 0);
          break;
      }

      // Don't re-trigger if we already notified for this price
      if (shouldTrigger && Number(alert.last_price) !== currentPrice) {
        triggered++;

        const dirLabel = direction === "up" ? "subido" : "bajado";
        const title = `${alert.product_name} ha ${dirLabel} ${absChangePct.toFixed(1)}%`;
        const body = `${referencePrice.toFixed(2)} EUR → ${currentPrice.toFixed(2)} EUR${alert.provider_name ? ` (${alert.provider_name})` : ""}`;

        // In-app notification
        notifications.push({
          user_id: alert.user_id,
          type: "price_alert",
          title,
          body,
          severity: direction === "up" ? "warning" : "success",
          entity_type: "price_alert",
          entity_id: alert.id,
          action_url: "/dashboard/prices",
        });

        // Alert notification record
        alertNotifRecords.push({
          alert_id: alert.id,
          user_id: alert.user_id,
          product_id: alert.product_id,
          product_name: alert.product_name,
          provider_name: alert.provider_name,
          old_price: referencePrice,
          new_price: currentPrice,
          change_pct: Number(changePct.toFixed(2)),
          direction,
        });

        // Update alert with last price
        alertUpdates.push({
          id: alert.id,
          last_price: currentPrice,
          last_notified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    }

    // 4. Insert notifications and alert records in batch
    if (notifications.length > 0) {
      await supabase.from("notifications").insert(notifications);
    }
    if (alertNotifRecords.length > 0) {
      await supabase.from("price_alert_notifications").insert(alertNotifRecords);
    }

    // 5. Update alerts with last known price
    for (const update of alertUpdates) {
      await supabase
        .from("price_alerts")
        .update({
          last_price: update.last_price,
          last_notified_at: update.last_notified_at,
          updated_at: update.updated_at,
        })
        .eq("id", update.id);
    }

    // 6. Send email notifications
    if (triggered > 0) {
      try {
        await sendAlertEmails(supabase, notifications);
      } catch (emailErr) {
        console.error("[process-alerts] Email error:", emailErr);
      }
    }

    return NextResponse.json({
      processed: alerts.length,
      triggered,
    });
  } catch (err: any) {
    console.error("[process-alerts] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

async function sendAlertEmails(supabase: any, notifications: any[]) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.log("[process-alerts] No RESEND_API_KEY, skipping email");
    return;
  }

  // Group notifications by user
  const byUser: Record<string, any[]> = {};
  for (const n of notifications) {
    if (!byUser[n.user_id]) byUser[n.user_id] = [];
    byUser[n.user_id].push(n);
  }

  for (const [userId, userNotifs] of Object.entries(byUser)) {
    // Get user email
    const { data: userData } = await supabase.auth.admin.getUserById(userId);
    const email = userData?.user?.email;
    if (!email) continue;

    const alertsHtml = userNotifs
      .map(
        (n: any) =>
          `<tr>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">${n.title}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b;">${n.body}</td>
          </tr>`
      )
      .join("");

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #0a1628; padding: 20px 24px; border-radius: 12px 12px 0 0;">
          <h1 style="color: #00c896; margin: 0; font-size: 22px;">enlaze</h1>
        </div>
        <div style="padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
          <h2 style="color: #0a1628; font-size: 18px; margin: 0 0 16px;">Alertas de precios</h2>
          <p style="color: #475569; margin: 0 0 16px;">Se han detectado ${userNotifs.length} cambio${userNotifs.length !== 1 ? "s" : ""} de precio en tus materiales:</p>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <thead>
              <tr style="background: #f8fafc;">
                <th style="padding: 8px 12px; text-align: left; font-weight: 600; color: #334155;">Alerta</th>
                <th style="padding: 8px 12px; text-align: left; font-weight: 600; color: #334155;">Detalle</th>
              </tr>
            </thead>
            <tbody>${alertsHtml}</tbody>
          </table>
          <div style="margin-top: 24px; text-align: center;">
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
          subject: `Enlaze: ${userNotifs.length} alerta${userNotifs.length !== 1 ? "s" : ""} de precios`,
          html,
        }),
      });
    } catch (e) {
      console.error(`[process-alerts] Email to ${email} failed:`, e);
    }
  }
}
