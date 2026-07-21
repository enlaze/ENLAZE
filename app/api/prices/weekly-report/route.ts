import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
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

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const weeksBack = parseInt(searchParams.get("weeks") || "1");

  try {
    // Check if we have a stored report
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - (7 * weeksBack));
    weekStart.setHours(0, 0, 0, 0);
    // Set to Monday
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    // Check for existing report
    const { data: existingReport } = await supabase
      .from("price_weekly_reports")
      .select("*")
      .eq("user_id", user.id)
      .eq("week_start", weekStart.toISOString().split("T")[0])
      .maybeSingle();

    if (existingReport) {
      return NextResponse.json({ report: existingReport });
    }

    // Generate report from pb_price_observations
    // Get all observations from the week
    const { data: observations } = await supabase
      .from("pb_price_observations")
      .select(`
        id, product_id, price_excl_vat, checked_at, is_available,
        pb_products ( commercial_name, unit_price, provider_id, pb_providers ( name ) )
      `)
      .gte("checked_at", weekStart.toISOString())
      .lte("checked_at", weekEnd.toISOString())
      .order("checked_at", { ascending: true })
      .limit(5000);

    if (!observations || observations.length === 0) {
      return NextResponse.json({
        report: {
          week_start: weekStart.toISOString().split("T")[0],
          week_end: weekEnd.toISOString().split("T")[0],
          total_products_tracked: 0,
          products_changed: 0,
          avg_change_pct: 0,
          biggest_increase: null,
          biggest_decrease: null,
          summary_data: [],
        },
      });
    }

    // Group observations by product and detect price changes
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

    for (const [pid, data] of Object.entries(productChanges)) {
      if (data.prices.length < 2) continue;
      const first = data.prices[0];
      const last = data.prices[data.prices.length - 1];
      if (first === 0) continue;
      const changePct = ((last - first) / first) * 100;

      if (Math.abs(changePct) > 0.01) {
        changedCount++;
        totalChangePct += changePct;
        changes.push({
          product_id: pid,
          product_name: data.name,
          provider: data.provider,
          old_price: first,
          new_price: last,
          change_pct: Number(changePct.toFixed(2)),
          direction: changePct > 0 ? "up" : "down",
        });
      }
    }

    // Sort by absolute change
    changes.sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct));

    const biggest_increase = changes.find((c) => c.direction === "up") || null;
    const biggest_decrease = changes.find((c) => c.direction === "down") || null;

    const report = {
      user_id: user.id,
      week_start: weekStart.toISOString().split("T")[0],
      week_end: weekEnd.toISOString().split("T")[0],
      total_products_tracked: Object.keys(productChanges).length,
      products_changed: changedCount,
      avg_change_pct: changedCount > 0 ? Number((totalChangePct / changedCount).toFixed(2)) : 0,
      biggest_increase,
      biggest_decrease,
      summary_data: changes.slice(0, 20), // Top 20 changes
    };

    // Store the report
    await supabase.from("price_weekly_reports").insert(report);

    return NextResponse.json({ report });
  } catch (err: any) {
    console.error("[weekly-report] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
