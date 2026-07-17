/**
 * POST /api/pb/import/analyze
 *
 * Uploads a CSV file and returns a preview with validation + column mapping.
 *
 * Body: multipart/form-data
 *   - file: CSV file (.csv, .tsv, .txt)
 *   - mapping: optional JSON string with column mapping overrides
 *
 * Returns: ImportAnalysis with preview rows, detected columns, suggested mapping.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { analyzeCSV, type ColumnMapping } from "@/lib/price-import";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const VALID_EXTENSIONS = [".csv", ".tsv", ".txt"];

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
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const mappingStr = formData.get("mapping") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No se proporcionó archivo" }, { status: 400 });
    }

    // Validate file
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `Archivo demasiado grande (máx ${MAX_FILE_SIZE / 1024 / 1024} MB)` },
        { status: 400 },
      );
    }

    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!VALID_EXTENSIONS.includes(ext)) {
      return NextResponse.json(
        { error: `Formato no soportado. Usa: ${VALID_EXTENSIONS.join(", ")}` },
        { status: 400 },
      );
    }

    // Parse custom mapping if provided
    let customMapping: Partial<ColumnMapping> | undefined;
    if (mappingStr) {
      try {
        customMapping = JSON.parse(mappingStr);
      } catch {
        return NextResponse.json({ error: "Mapping JSON inválido" }, { status: 400 });
      }
    }

    // Read file content
    const content = await file.text();

    // Analyze
    const analysis = analyzeCSV(content, customMapping);

    return NextResponse.json({
      ...analysis,
      file_name: file.name,
      file_size: file.size,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ImportAnalyze] Error:", message);
    return NextResponse.json(
      { error: message || "Error al analizar archivo" },
      { status: 500 },
    );
  }
}
