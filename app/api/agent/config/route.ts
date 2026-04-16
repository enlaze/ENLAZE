import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/* ── Business-type context maps ── */
const BUSINESS_KEYWORDS: Record<string, string[]> = {
  bar: ["hostelería", "cerveza", "terraza", "tapas", "horarios", "sanidad", "licencia apertura", "ruido", "consumo"],
  restaurante: ["hostelería", "restauración", "menú", "cocina", "sanidad", "alérgenos", "terraza", "reseñas"],
  cafeteria: ["cafetería", "desayuno", "brunch", "café", "bollería", "terraza", "horarios"],
  panaderia: ["panadería", "harina", "bollería", "pan", "obrador", "normativa alimentaria", "celíaco"],
  peluqueria: ["peluquería", "estética", "belleza", "tratamiento", "cita previa", "productos capilares"],
  estetica: ["estética", "belleza", "tratamiento", "spa", "depilación", "cosmética", "sanidad"],
  tienda: ["comercio minorista", "retail", "escaparate", "stock", "rebajas", "temporada", "IVA"],
  floristeria: ["floristería", "plantas", "decoración", "eventos", "bodas", "temporada"],
  farmacia: ["farmacia", "parafarmacia", "salud", "medicamento", "turno", "normativa sanitaria"],
  gimnasio: ["fitness", "deporte", "cuota", "clase", "entrenamiento", "salud"],
};

const BUSINESS_RSS_HINTS: Record<string, string[]> = {
  bar: ["hostelería", "bares", "licencia", "terraza"],
  restaurante: ["restauración", "hostelería", "alérgenos", "gastronomía"],
  cafeteria: ["hostelería", "café", "turismo"],
  panaderia: ["alimentación", "harina", "gluten", "obrador"],
  peluqueria: ["estética", "belleza", "peluquería"],
  estetica: ["estética", "belleza", "cosmética", "sanidad"],
  tienda: ["comercio minorista", "retail", "IVA", "rebajas"],
};

const MARKETING_HINTS: Record<string, string[]> = {
  bar: ["happy hour", "cata", "menú especial", "tapas", "fútbol", "terraza verano"],
  restaurante: ["menú degustación", "cena temática", "maridaje", "showcooking", "menú del día"],
  cafeteria: ["desayuno especial", "brunch", "café de especialidad", "merienda"],
  panaderia: ["pan del día", "taller", "producto nuevo", "cesta regalo"],
  peluqueria: ["descuento martes", "pack novias", "tratamiento nuevo", "color temporada"],
  estetica: ["bono sesiones", "tratamiento estacional", "pack pareja", "facial express"],
  tienda: ["liquidación", "escaparate temático", "venta flash", "fidelización"],
};

function resolveBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "https://enlaze.vercel.app";
}

/**
 * GET /api/agent/config?user_id=xxx
 * Returns the full business configuration needed by the n8n agent,
 * enriched with business-type-specific context.
 */
export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const expectedKey = process.env.AGENT_API_KEY;
    if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = req.nextUrl.searchParams.get("user_id");
    if (!userId) {
      return NextResponse.json(
        { error: "user_id query parameter is required" },
        { status: 400 },
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: profile, error } = await supabase
      .from("profiles")
      .select(
        "id, email, full_name, company_name, business_name, business_sector, business_type, city, google_place_id, coordinates, agent_keywords, competitors, agent_enabled, agent_status",
      )
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      console.error("[agent/config] Supabase error:", error.message);
      return NextResponse.json(
        { error: "Database error", detail: error.message },
        { status: 500 },
      );
    }

    if (!profile) {
      return NextResponse.json(
        { error: "Profile not found for user_id" },
        { status: 404 },
      );
    }

    const bizType = (profile.business_type || "comercio").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    // Merge user-defined keywords with business-type defaults
    const defaultKw = BUSINESS_KEYWORDS[bizType] || ["comercio local", "pyme", "autónomo"];
    const userKw: string[] = profile.agent_keywords || [];
    const mergedKeywords = [...new Set([...userKw, ...defaultKw])];

    // Update agent_status to running
    await supabase
      .from("profiles")
      .update({ agent_status: "running" })
      .eq("id", userId);

    return NextResponse.json({
      ok: true,
      user_id: userId,
      business_id: profile.id,
      business_name: profile.business_name || profile.company_name || "Mi Negocio",
      business_type: profile.business_type || "comercio",
      business_type_normalized: bizType,
      sector: profile.business_sector || "comercio_local",
      city: profile.city || "",
      google_place_id: profile.google_place_id || null,
      coordinates: profile.coordinates || null,
      keywords: mergedKeywords,
      rss_filter_hints: BUSINESS_RSS_HINTS[bizType] || ["comercio local", "pyme"],
      marketing_hints: MARKETING_HINTS[bizType] || ["promoción", "descuento", "evento"],
      competitors: profile.competitors || [],
      agent_enabled: profile.agent_enabled ?? false,
      ENLAZE_BASE_URL: resolveBaseUrl(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[agent/config] Unhandled error:", message);
    return NextResponse.json(
      { error: "Internal server error", detail: message },
      { status: 500 },
    );
  }
}
