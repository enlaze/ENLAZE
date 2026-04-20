import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { syncUserPrices } from "@/lib/services/price-sync";
import { getSectorAliases } from "@/lib/price-defaults";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
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
    const sector = body.sector;
    if (!sector) {
      return NextResponse.json({ error: "Falta el sector" }, { status: 400 });
    }

    const sectorAliases = getSectorAliases(sector);

    // Obtener precios del mercado
    const { data: marketPrices, error: marketError } = await supabase
      .from("sector_data")
      .select("*")
      .eq("data_type", "price")
      .in("sector", sectorAliases)
      .order("last_updated", { ascending: false });

    if (marketError) throw marketError;

    if (!marketPrices || marketPrices.length === 0) {
      return NextResponse.json(
        { error: "No hay precios de mercado disponibles." },
        { status: 404 }
      );
    }

    // Ejecutar lógica de sincronización
    const results = await syncUserPrices(supabase, user.id, sector, marketPrices, "manual");

    return NextResponse.json({
      success: true,
      message: `Precios sincronizados: ${results.added} nuevos, ${results.updated} actualizados, ${results.skipped} omitidos.`,
      results
    });
  } catch (error: any) {
    console.error("[ManualSync API] Error:", error);
    return NextResponse.json({ error: error.message || "Error interno del servidor" }, { status: 500 });
  }
}
