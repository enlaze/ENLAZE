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
  const searchTerm = searchParams.get("q");

  if (!searchTerm || searchTerm.length < 2) {
    return NextResponse.json({ error: "Busqueda demasiado corta (min 2 caracteres)" }, { status: 400 });
  }

  try {
    // Search products by name across all providers
    const { data: products, error } = await supabase
      .from("pb_products")
      .select(`
        id, commercial_name, description, brand, sale_unit,
        unit_price, is_available, updated_at,
        provider_id, pb_providers ( id, name, website )
      `)
      .ilike("commercial_name", `%${searchTerm}%`)
      .eq("is_active", true)
      .order("commercial_name")
      .limit(50);

    if (error) throw error;

    // Group by similar product name (fuzzy grouping)
    const groups: Record<string, any[]> = {};
    for (const p of (products || [])) {
      // Normalize name for grouping: lowercase, remove brand, trim
      const normalized = (p.commercial_name || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();

      // Find existing group with similar name
      let matched = false;
      for (const key of Object.keys(groups)) {
        if (normalized.includes(key) || key.includes(normalized) ||
            levenshteinSimilarity(normalized, key) > 0.6) {
          groups[key].push(p);
          matched = true;
          break;
        }
      }
      if (!matched) {
        groups[normalized] = [p];
      }
    }

    // Sort groups by number of providers (most comparable first)
    const comparisons = Object.entries(groups)
      .map(([key, items]) => ({
        product_name: items[0].commercial_name,
        providers: items.map((p: any) => ({
          provider_id: p.pb_providers?.id || p.provider_id,
          provider_name: p.pb_providers?.name || "Desconocido",
          provider_website: p.pb_providers?.website,
          product_id: p.id,
          product_name: p.commercial_name,
          brand: p.brand,
          unit_price: Number(p.unit_price) || 0,
          sale_unit: p.sale_unit,
          is_available: p.is_available,
          updated_at: p.updated_at,
        })),
        min_price: Math.min(...items.map((p: any) => Number(p.unit_price) || Infinity)),
        max_price: Math.max(...items.map((p: any) => Number(p.unit_price) || 0)),
        price_spread_pct: items.length > 1
          ? ((Math.max(...items.map((p: any) => Number(p.unit_price) || 0)) -
              Math.min(...items.map((p: any) => Number(p.unit_price) || Infinity)) ) /
             Math.min(...items.map((p: any) => Number(p.unit_price) || 1)) * 100).toFixed(1)
          : "0",
      }))
      .sort((a, b) => b.providers.length - a.providers.length);

    return NextResponse.json({ comparisons });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function levenshteinSimilarity(a: string, b: string): number {
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1;

  const matrix: number[][] = [];
  for (let i = 0; i <= shorter.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= longer.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= shorter.length; i++) {
    for (let j = 1; j <= longer.length; j++) {
      if (shorter[i - 1] === longer[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return 1 - matrix[shorter.length][longer.length] / longer.length;
}
