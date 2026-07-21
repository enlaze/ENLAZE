import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

async function getSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return cookieStore.get(name)?.value; },
        set() {},
        remove() {},
      },
    }
  );
}

// GET — List user's alerts + unread notifications
export async function GET() {
  const supabase = await getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const [alertsRes, notifsRes] = await Promise.all([
      supabase
        .from("price_alerts")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("price_alert_notifications")
        .select("*")
        .eq("user_id", user.id)
        .eq("is_read", false)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    return NextResponse.json({
      alerts: alertsRes.data || [],
      notifications: notifsRes.data || [],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST — Create a new alert
export async function POST(request: Request) {
  const supabase = await getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const body = await request.json();
    const { product_id, product_name, provider_name, alert_type, threshold_pct, threshold_price } = body;

    if (!product_name) {
      return NextResponse.json({ error: "product_name requerido" }, { status: 400 });
    }

    // Get current price as reference
    let reference_price = null;
    if (product_id) {
      const { data: product } = await supabase
        .from("pb_products")
        .select("unit_price")
        .eq("id", product_id)
        .single();
      reference_price = product?.unit_price || null;
    }

    const { data, error } = await supabase
      .from("price_alerts")
      .insert({
        user_id: user.id,
        product_id: product_id || null,
        product_name,
        provider_name: provider_name || null,
        alert_type: alert_type || "threshold_pct",
        threshold_pct: threshold_pct ?? 5,
        threshold_price: threshold_price || null,
        reference_price,
        last_price: reference_price,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ alert: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE — Remove an alert
export async function DELETE(request: Request) {
  const supabase = await getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const alertId = searchParams.get("id");
    if (!alertId) return NextResponse.json({ error: "id requerido" }, { status: 400 });

    const { error } = await supabase
      .from("price_alerts")
      .delete()
      .eq("id", alertId)
      .eq("user_id", user.id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PATCH — Mark notifications as read
export async function PATCH(request: Request) {
  const supabase = await getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const body = await request.json();

    if (body.mark_all_read) {
      await supabase
        .from("price_alert_notifications")
        .update({ is_read: true })
        .eq("user_id", user.id)
        .eq("is_read", false);
    } else if (body.notification_id) {
      await supabase
        .from("price_alert_notifications")
        .update({ is_read: true })
        .eq("id", body.notification_id)
        .eq("user_id", user.id);
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
