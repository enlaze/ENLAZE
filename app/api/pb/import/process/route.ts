/**
 * POST /api/pb/import/process
 *
 * Confirms and processes validated import rows into pb_* tables.
 *
 * Body (JSON):
 *   - rows: ImportRow[]  (validated rows from analyze step)
 *   - provider_name: string
 *   - provider_id?: string (optional, link to existing)
 *   - source_name?: string
 *   - region?: string
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { processImport, type ImportRow } from "@/lib/price-import";

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

  // Get company_id
  const { data: profile } = await supabase
    .from("profiles")
    .select("company_id")
    .eq("id", user.id)
    .single();

  const company_id = profile?.company_id ?? null;
  if (!company_id) {
    return NextResponse.json({ error: "Usuario sin empresa asociada" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const {
      rows,
      provider_name,
      provider_id,
      source_name,
      region,
    } = body as {
      rows: ImportRow[];
      provider_name: string;
      provider_id?: string;
      source_name?: string;
      region?: string;
    };

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "No hay filas para importar" }, { status: 400 });
    }

    if (!provider_name && !provider_id) {
      return NextResponse.json(
        { error: "Indica provider_name o provider_id" },
        { status: 400 },
      );
    }

    const result = await processImport(supabase, {
      rows,
      provider_name: provider_name || "Importación",
      provider_id,
      company_id,
      source_name: source_name || `CSV Import - ${provider_name}`,
      region,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ImportProcess] Error:", message);
    return NextResponse.json(
      { error: message || "Error al procesar importación" },
      { status: 500 },
    );
  }
}
