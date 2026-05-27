import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { parseBC3 } from "@/lib/bc3-parser";
import { importBC3ToDatabase } from "@/lib/technical-price-importer";

/**
 * POST /api/technical-prices/import
 *
 * Import a BC3/FIEBDC-3 file into the technical price bank.
 *
 * Auth: Bearer AGENT_API_KEY or WEBHOOK_SECRET
 *
 * Body: multipart/form-data
 *   - file:      .bc3 or .fiebdc file
 *   - source:    "cype" | "ive" | "public_bc3" | "enlaze_base" | "manual"
 *   - region:    "comunitat_valenciana" | "espana" | "madrid" | etc.
 *   - edition:   string (e.g. "2026")
 *   - overwrite: "true" | "false" (optional, default false)
 *
 * Returns: import summary with counts and errors.
 *
 * IMPORTANT:
 *   - Uses SUPABASE_SERVICE_ROLE_KEY for writes (tables have no INSERT RLS).
 *   - Never touches price_items, sector_data, or supplier tables.
 *   - source is explicit — never auto-detected as "cype".
 *
 * Example curl:
 *   curl -X POST https://your-domain/api/technical-prices/import \
 *     -H "Authorization: Bearer YOUR_AGENT_API_KEY" \
 *     -F "file=@/path/to/bank.bc3" \
 *     -F "source=public_bc3" \
 *     -F "region=comunitat_valenciana" \
 *     -F "edition=2026" \
 *     -F "overwrite=false"
 */

const VALID_SOURCES = ["cype", "ive", "public_bc3", "enlaze_base", "manual"];
const VALID_EXTENSIONS = [".bc3", ".fiebdc"];
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

export async function POST(request: Request) {
  // ── Auth ──
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const validTokens = [
    process.env.WEBHOOK_SECRET,
    process.env.AGENT_API_KEY,
  ].filter(Boolean);

  if (!token || !validTokens.includes(token)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    // ── Parse multipart form ──
    const formData = await request.formData();

    const file = formData.get("file") as File | null;
    const source = (formData.get("source") as string) || "";
    const region = (formData.get("region") as string) || "espana";
    const edition = (formData.get("edition") as string) || "";
    const overwrite = (formData.get("overwrite") as string) === "true";

    // ── Validate inputs ──
    if (!file) {
      return NextResponse.json(
        { error: "Falta el archivo BC3 (campo 'file')" },
        { status: 400 }
      );
    }

    if (!source || !VALID_SOURCES.includes(source)) {
      return NextResponse.json(
        {
          error: `source invalido: "${source}". Valores permitidos: ${VALID_SOURCES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Validate file extension
    const fileName = file.name.toLowerCase();
    const hasValidExtension = VALID_EXTENSIONS.some((ext) =>
      fileName.endsWith(ext)
    );
    if (!hasValidExtension) {
      return NextResponse.json(
        {
          error: `Extension de archivo no soportada: "${file.name}". Se aceptan: ${VALID_EXTENSIONS.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          error: `Archivo demasiado grande (${Math.round(file.size / 1024 / 1024)} MB). Maximo: 50 MB`,
        },
        { status: 400 }
      );
    }

    if (file.size === 0) {
      return NextResponse.json(
        { error: "El archivo esta vacio" },
        { status: 400 }
      );
    }

    // ── Read file content ──
    const buffer = await file.arrayBuffer();
    // Try UTF-8 first, then Latin-1 (ISO-8859-1) which is common in Spanish BC3 files
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      content = new TextDecoder("iso-8859-1").decode(buffer);
    }

    // ── Parse BC3 ──
    const parsed = parseBC3(content);

    if (parsed.concepts.length === 0) {
      return NextResponse.json(
        {
          error:
            "El archivo BC3 no contiene conceptos (~C). Verifica que es un archivo FIEBDC valido.",
          stats: parsed.stats,
          warnings: parsed.warnings.slice(0, 10),
        },
        { status: 400 }
      );
    }

    // ── Create admin Supabase client ──
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) {
      console.error(
        "[technical-prices/import] SUPABASE_SERVICE_ROLE_KEY not configured"
      );
      return NextResponse.json(
        { error: "Configuracion del servidor incompleta (service role key)" },
        { status: 500 }
      );
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey
    );

    // ── Import into database ──
    const result = await importBC3ToDatabase(supabaseAdmin, parsed, {
      source,
      region,
      edition,
      fileName: file.name,
      overwrite,
      importedBy: undefined, // No user context in API key auth
    });

    const httpStatus = result.ok ? 200 : result.errors.length > 0 ? 207 : 500;

    return NextResponse.json(
      {
        ok: result.ok,
        logId: result.logId,
        summary: {
          chapters_created: result.chapters_created,
          chapters_updated: result.chapters_updated,
          items_created: result.items_created,
          items_updated: result.items_updated,
          components_created: result.components_created,
          items_skipped: result.items_skipped,
        },
        parser_stats: parsed.stats,
        errors: result.errors.length > 0 ? result.errors : undefined,
        warnings:
          parsed.warnings.length > 0
            ? parsed.warnings.slice(0, 20)
            : undefined,
      },
      { status: httpStatus }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[technical-prices/import] Error:", message);
    return NextResponse.json(
      { error: "Error interno al importar archivo BC3", detail: message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/technical-prices/import
 * Returns endpoint documentation for n8n / developers.
 */
export async function GET() {
  return NextResponse.json({
    name: "ENLAZE Technical Price Bank Import",
    version: "1.0",
    method: "POST",
    contentType: "multipart/form-data",
    auth: "Bearer AGENT_API_KEY in Authorization header",
    fields: {
      file: "BC3/FIEBDC file (.bc3 or .fiebdc)",
      source: `Required. One of: ${VALID_SOURCES.join(", ")}`,
      region:
        'Optional. Default: "espana". Examples: comunitat_valenciana, madrid, andalucia',
      edition: 'Optional. Example: "2026"',
      overwrite:
        'Optional. "true" to update existing entries, "false" (default) to skip them',
    },
    maxFileSize: "50 MB",
    notes: [
      "source='cype' should only be used when the BC3 comes from a real CYPE export",
      "This endpoint writes to technical_* tables only, never to price_items or sector_data",
      "Uses SUPABASE_SERVICE_ROLE_KEY for writes — tables have read-only RLS for regular users",
    ],
  });
}
