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

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const productId = searchParams.get("product_id");
  const days = parseInt(searchParams.get("days") || "90");

  if (!productId) {
    return NextResponse.json({ error: "product_id requerido" }, { status: 400 });
  }

  try {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const { data, error } = await supabase
      .from("pb_price_observations")
      .select("id, price_excl_vat, checked_at, is_available, discount_pct")
      .eq("product_id", productId)
      .gte("checked_at", since.toISOString())
      .order("checked_at", { ascending: true })
      .limit(500);

    if (error) throw error;

    // Also get the product info
    const { data: product } = await supabase
      .from("pb_products")
      .select("id, commercial_name, unit_price, sale_unit, brand, provider_id, pb_providers(name)")
      .eq("id", productId)
      .single();

    return NextResponse.json({
      product: product || null,
      history: data || [],
      days,
    });
  } catch (err: any) {
    console.error("[price-history] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
