/**
 * GET    /api/pb/providers/[id]  — Get single provider
 * PATCH  /api/pb/providers/[id]  — Update provider
 * DELETE /api/pb/providers/[id]  — Soft-delete provider (is_active = false)
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

type RouteContext = { params: Promise<{ id: string }> };

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(_request: Request, context: RouteContext) {
  const { supabase, user } = await getSupabaseAndUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await context.params;

  const { data, error } = await supabase
    .from("pb_providers")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, data });
}

// ─── PATCH ────────────────────────────────────────────────────────────────────

export async function PATCH(request: Request, context: RouteContext) {
  const { supabase, user, company_id } = await getSupabaseAndUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!company_id) return NextResponse.json({ error: "Usuario sin empresa asociada" }, { status: 403 });

  const { id } = await context.params;

  try {
    const body = await request.json();

    // Only allow updating own providers (company_id match enforced by RLS)
    const allowedFields = [
      "name", "trade_name", "legal_name", "nif", "website",
      "country", "autonomous_community", "province", "supply_zones",
      "shipping_cost_flat", "shipping_cost_per_kg", "free_shipping_min",
      "minimum_order", "delivery_days_min", "delivery_days_max",
      "payment_terms_days", "is_preferred", "is_active",
    ];

    const updates: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (field in body) updates[field] = body[field];
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No hay campos para actualizar" }, { status: 400 });
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("pb_providers")
      .update(updates)
      .eq("id", id)
      .eq("company_id", company_id)
      .select()
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "No se pudo actualizar el proveedor" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, data });
  } catch {
    return NextResponse.json({ error: "Cuerpo de solicitud inválido" }, { status: 400 });
  }
}

// ─── DELETE ───────────────────────────────────────────────────────────────────

export async function DELETE(_request: Request, context: RouteContext) {
  const { supabase, user, company_id } = await getSupabaseAndUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!company_id) return NextResponse.json({ error: "Usuario sin empresa asociada" }, { status: 403 });

  const { id } = await context.params;

  // Soft delete
  const { data, error } = await supabase
    .from("pb_providers")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("company_id", company_id)
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "No se pudo eliminar el proveedor" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, deleted: id });
}
