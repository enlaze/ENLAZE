/**
 * POST /api/budgets/compare-providers
 *
 * Compare providers for one or multiple budget concepts.
 *
 * Body:
 *   mode: "single" | "bulk"
 *
 *   For mode="single":
 *     concept_id, concept_name, quantity_needed, province?, weights?
 *
 *   For mode="bulk":
 *     items: Array<{ concept_id, concept_name, quantity_needed }>
 *     province?, weights?
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  compareProviders,
  bulkCompareProviders,
  type ComparisonInput,
  type ComparisonData,
} from "@/lib/provider-comparison";

export async function POST(request: Request) {
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

  try {
    const body = await request.json();
    const mode = body.mode || "single";

    // Get company_id
    const { data: profile } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", user.id)
      .single();

    const company_id = profile?.company_id ?? null;

    // Fetch comparison data (products, providers, current prices)
    const [
      { data: products },
      { data: providers },
      { data: currentPrices },
    ] = await Promise.all([
      supabase
        .from("pb_products")
        .select("*")
        .eq("is_active", true),
      supabase
        .from("pb_providers")
        .select("*")
        .eq("is_active", true)
        .or(`company_id.is.null${company_id ? `,company_id.eq.${company_id}` : ""}`),
      supabase
        .from("pb_price_current")
        .select("*"),
    ]);

    const data: ComparisonData = {
      products: products || [],
      providers: providers || [],
      current_prices: currentPrices || [],
    };

    if (mode === "single") {
      const input: ComparisonInput = {
        concept_id: body.concept_id,
        concept_name: body.concept_name,
        quantity_needed: body.quantity_needed || 1,
        province: body.province,
        weights: body.weights,
      };

      if (!input.concept_id || !input.concept_name) {
        return NextResponse.json(
          { error: "concept_id y concept_name son obligatorios" },
          { status: 400 },
        );
      }

      const result = compareProviders(input, data);
      return NextResponse.json({ ...result, mode: "single" });
    }

    if (mode === "bulk") {
      if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
        return NextResponse.json(
          { error: "items es obligatorio para mode=bulk" },
          { status: 400 },
        );
      }

      const result = bulkCompareProviders(
        {
          items: body.items,
          province: body.province,
          weights: body.weights,
        },
        data,
      );

      return NextResponse.json({ ...result, mode: "bulk" });
    }

    return NextResponse.json(
      { error: `mode inválido: ${mode}. Usa "single" o "bulk"` },
      { status: 400 },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[CompareProviders] Error:", message);
    return NextResponse.json(
      { error: message || "Error interno" },
      { status: 500 },
    );
  }
}
