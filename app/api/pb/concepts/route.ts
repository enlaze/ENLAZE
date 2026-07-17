/**
 * GET  /api/pb/concepts       — List normalized concepts
 * POST /api/pb/concepts       — Create a new concept
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
  const category = url.searchParams.get("category") || "";
  const status = url.searchParams.get("status") || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10)));
  const offset = (page - 1) * limit;

  let query = supabase
    .from("pb_normalized_concepts")
    .select("*", { count: "exact" })
    .or(`company_id.is.null,company_id.eq.${company_id}`);

  if (search) query = query.ilike("canonical_name", `%${search}%`);
  if (category) query = query.eq("category", category);
  if (status) query = query.eq("review_status", status);

  query = query
    .order("category", { ascending: true })
    .order("canonical_name", { ascending: true })
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

    if (!body.canonical_name || !body.category) {
      return NextResponse.json(
        { error: "canonical_name y category son obligatorios" },
        { status: 400 }
      );
    }

    const concept = {
      company_id,
      canonical_name: body.canonical_name,
      description: body.description ?? "",
      category: body.category,
      subcategory: body.subcategory ?? "",
      base_unit: body.base_unit ?? "ud",
      synonyms: body.synonyms ?? [],
      specifications: body.specifications ?? {},
      review_status: "draft" as const,
    };

    // Check for duplicates within same company scope
    const { data: existing } = await supabase
      .from("pb_normalized_concepts")
      .select("id, canonical_name")
      .or(`company_id.is.null,company_id.eq.${company_id}`)
      .ilike("canonical_name", concept.canonical_name)
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json(
        {
          error: "Ya existe un concepto con ese nombre",
          existing: existing[0],
        },
        { status: 409 }
      );
    }

    const { data, error } = await supabase
      .from("pb_normalized_concepts")
      .insert(concept)
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
