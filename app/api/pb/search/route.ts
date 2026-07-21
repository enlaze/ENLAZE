/**
 * GET /api/pb/search?q=cemento&limit=10
 *
 * Fast product search for budget autocomplete.
 * Returns products with provider name and price.
 */
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

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(20, Math.max(1, parseInt(url.searchParams.get("limit") || "8", 10)));

  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  // Search products by commercial_name, join provider for name
  const { data, error } = await supabase
    .from("pb_products")
    .select(`
      id,
      commercial_name,
      sale_unit,
      unit_price,
      brand,
      sku,
      provider_id,
      pb_providers ( name )
    `)
    .eq("is_active", true)
    .eq("is_available", true)
    .ilike("commercial_name", `%${q}%`)
    .order("commercial_name")
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = (data || []).map((p) => ({
    id: p.id,
    name: p.commercial_name,
    unit: p.sale_unit,
    price: Number(p.unit_price),
    brand: p.brand,
    sku: p.sku,
    provider_id: p.provider_id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provider_name: (p as any).pb_providers?.name || "—",
  }));

  return NextResponse.json({ results });
}
