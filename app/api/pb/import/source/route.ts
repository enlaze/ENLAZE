/**
 * POST /api/pb/import/source
 *
 * Import prices from a recognized Spanish construction price database.
 * Supports: BEDEC (ITeC), PREOC, CYPE Generador de Precios.
 *
 * Body: multipart/form-data
 *   - file: CSV/TXT export from the source
 *   - source: "bedec" | "preoc" | "cype" | "auto"
 *   - region: optional region override (e.g., "Cataluña", "Madrid")
 *   - provider_name: optional provider name override
 *
 * Flow:
 *   1. Parse file using the appropriate adapter
 *   2. Convert adapted rows to ImportRow format
 *   3. Process into pb_* tables via the standard import pipeline
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  adaptPriceSource,
  adaptedRowsToImportRows,
  type PriceSourceAdapter,
} from "@/lib/price-source-adapter";
import { processImport } from "@/lib/price-import";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB for source files
const VALID_EXTENSIONS = [".csv", ".tsv", ".txt"];

const SOURCE_DISPLAY_NAMES: Record<string, string> = {
  bedec: "BEDEC (ITeC)",
  preoc: "PREOC",
  cype: "CYPE Generador de Precios",
  auto: "Auto-detectado",
};

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

  const { data: profile } = await supabase
    .from("profiles")
    .select("company_id")
    .eq("id", user.id)
    .single();

  const companyId = profile?.company_id ?? null;
  if (!companyId) {
    return NextResponse.json({ error: "Usuario sin empresa asociada" }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const sourceHint = (formData.get("source") as string) || "auto";
    const region = (formData.get("region") as string) || undefined;
    const providerNameOverride = formData.get("provider_name") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No se proporcionó archivo" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `Archivo demasiado grande (máx ${MAX_FILE_SIZE / 1024 / 1024} MB)` },
        { status: 400 }
      );
    }

    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!VALID_EXTENSIONS.includes(ext)) {
      return NextResponse.json(
        { error: `Formato no soportado. Usa: ${VALID_EXTENSIONS.join(", ")}` },
        { status: 400 }
      );
    }

    // Read and parse
    const content = await file.text();
    const adapter = sourceHint === "auto" ? undefined : (sourceHint as PriceSourceAdapter);
    const result = adaptPriceSource(content, adapter, region);

    if (!result.ok && result.rows.length === 0) {
      return NextResponse.json({
        ok: false,
        source: result.source,
        source_name: SOURCE_DISPLAY_NAMES[result.source] || result.source,
        total_parsed: result.total_parsed,
        total_valid: result.total_valid,
        total_skipped: result.total_skipped,
        warnings: result.warnings,
        errors: result.errors,
      }, { status: 400 });
    }

    // Convert to import rows
    const importRows = adaptedRowsToImportRows(result.rows);

    // Determine provider name
    const providerName = providerNameOverride
      || SOURCE_DISPLAY_NAMES[result.source]
      || `Importación ${result.source}`;

    // Process into DB
    const importResult = await processImport(supabase, {
      rows: importRows,
      provider_name: providerName,
      company_id: companyId,
      source_name: `${SOURCE_DISPLAY_NAMES[result.source] || result.source} - ${file.name}`,
      region: region || "ES",
    });

    return NextResponse.json({
      ok: importResult.ok,
      source: result.source,
      source_name: SOURCE_DISPLAY_NAMES[result.source] || result.source,
      file_name: file.name,
      adapter_stats: {
        total_parsed: result.total_parsed,
        total_valid: result.total_valid,
        total_skipped: result.total_skipped,
      },
      import_stats: {
        products_created: importResult.products_created,
        observations_created: importResult.observations_created,
        current_prices_created: importResult.current_prices_created,
        skipped: importResult.skipped,
      },
      provider_id: importResult.provider_id,
      warnings: result.warnings,
      errors: [...result.errors, ...importResult.errors],
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ImportSource] Error:", message);
    return NextResponse.json(
      { error: message || "Error al importar desde fuente" },
      { status: 500 }
    );
  }
}
