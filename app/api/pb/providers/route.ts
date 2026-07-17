/**
 * GET  /api/pb/providers       — List providers (filtered by company)
 * POST /api/pb/providers       — Create a new provider
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

  // Get company_id from user profile
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
  const activeOnly = url.searchParams.get("active") !== "false";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10)));
  const offset = (page - 1) * limit;

  let query = supabase
    .from("pb_providers")
    .select("*", { count: "exact" })
    .or(`company_id.is.null,company_id.eq.${company_id}`);

  if (activeOnly) query = query.eq("is_active", true);
  if (search) query = query.ilike("name", `%${search}%`);

  query = query.order("is_preferred", { ascending: false })
    .order("name", { ascending: true })
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

    const provider = {
      company_id,
      name: body.name,
      trade_name: body.trade_name ?? null,
      legal_name: body.legal_name ?? null,
      nif: body.nif ?? null,
      website: body.website ?? null,
      country: body.country ?? "ES",
      autonomous_community: body.autonomous_community ?? null,
      province: body.province ?? null,
      supply_zones: body.supply_zones ?? [],
      shipping_cost_flat: body.shipping_cost_flat ?? 0,
      shipping_cost_per_kg: body.shipping_cost_per_kg ?? 0,
      free_shipping_min: body.free_shipping_min ?? null,
      minimum_order: body.minimum_order ?? 0,
      delivery_days_min: body.delivery_days_min ?? 1,
      delivery_days_max: body.delivery_days_max ?? 5,
      payment_terms_days: body.payment_terms_days ?? 30,
      is_preferred: body.is_preferred ?? false,
      is_active: true,
    };

    if (!provider.name) {
      return NextResponse.json({ error: "El nombre es obligatorio" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("pb_providers")
      .insert(provider)
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
