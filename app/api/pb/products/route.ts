/**
 * GET  /api/pb/products       — List products (with provider + concept joins)
 * POST /api/pb/products       — Create a new product
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

async function getSupabaseAndUser() {
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

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { supabase, user: null, company_id: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("company_id")
    .eq("id", user.id)
    .single();

  return { supabase, user, company_id: profile?.company_id ?? null };
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { supabase, user, company_id } = await getSupabaseAndUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const url = new URL(request.url);
  const search = url.searchParams.get("search") || "";
  const providerId = url.searchParams.get("provider_id") || "";
  const conceptId = url.searchParams.get("concept_id") || "";
  const availableOnly = url.searchParams.get("available") !== "false";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10)));
  const offset = (page - 1) * limit;

  // Products belong to providers; filter by providers the user can see
  let query = supabase
    .from("pb_products")
    .select(`
      *,
      pb_providers!inner ( id, name, is_preferred, company_id ),
      pb_normalized_concepts ( id, canonical_name, category )
    `, { count: "exact" })
    .or(`pb_providers.company_id.is.null,pb_providers.company_id.eq.${company_id}`)
    .eq("is_active", true);

  if (availableOnly) query = query.eq("is_available", true);
  if (providerId) query = query.eq("provider_id", providerId);
  if (conceptId) query = query.eq("concept_id", conceptId);
  if (search) query = query.ilike("commercial_name", `%${search}%`);

  query = query
    .order("commercial_name", { ascending: true })
    .range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    data,
    pagination: {
      page,
      limit,
      total: count ?? 0,
      pages: Math.ceil((count ?? 0) / limit),
    },
  });
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const { supabase, user, company_id } = await getSupabaseAndUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!company_id) return NextResponse.json({ error: "Usuario sin empresa asociada" }, { status: 403 });

  try {
    const body = await request.json();

    if (!body.provider_id || !body.commercial_name) {
      return NextResponse.json(
        { error: "provider_id y commercial_name son obligatorios" },
        { status: 400 }
      );
    }

    // Verify provider belongs to user's company
    const { data: provider } = await supabase
      .from("pb_providers")
      .select("id, company_id")
      .eq("id", body.provider_id)
      .single();

    if (!provider) {
      return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });
    }

    if (provider.company_id && provider.company_id !== company_id) {
      return NextResponse.json({ error: "Proveedor no pertenece a tu empresa" }, { status: 403 });
    }

    const product = {
      provider_id: body.provider_id,
      concept_id: body.concept_id ?? null,
      concept_match_type: body.concept_match_type ?? "none",
      commercial_name: body.commercial_name,
      description: body.description ?? "",
      brand: body.brand ?? null,
      model: body.model ?? null,
      sku: body.sku ?? null,
      ean: body.ean ?? null,
      sale_unit: body.sale_unit ?? "ud",
      units_per_package: body.units_per_package ?? 1,
      unit_price: body.unit_price ?? 0,
      vat_rate: body.vat_rate ?? 21,
      url: body.url ?? null,
      region: body.region ?? "ES",
      is_available: body.is_available ?? true,
      checked_at: new Date().toISOString(),
      is_active: true,
    };

    const { data, error } = await supabase
      .from("pb_products")
      .insert(product)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Cuerpo de solicitud inválido" }, { status: 400 });
  }
}
