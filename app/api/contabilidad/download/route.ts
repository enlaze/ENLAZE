import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { exec } from "child_process";
import { readFile, unlink, writeFile } from "fs/promises";
import { promisify } from "util";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get("user_id");
    const type = url.searchParams.get("type") || "all";
    const period = url.searchParams.get("period") || "year";
    const year = parseInt(url.searchParams.get("year") || new Date().getFullYear().toString());
    const month = url.searchParams.get("month") || "";
    const quarter = url.searchParams.get("quarter") || "";

    if (!userId) {
      return NextResponse.json({ error: "Falta user_id" }, { status: 400 });
    }

    // Fetch data via internal API call
    const apiUrl = new URL("/api/contabilidad/pdf", url.origin);
    apiUrl.searchParams.set("user_id", userId);
    apiUrl.searchParams.set("type", type);
    apiUrl.searchParams.set("period", period);
    apiUrl.searchParams.set("year", year.toString());
    if (month) apiUrl.searchParams.set("month", month);
    if (quarter) apiUrl.searchParams.set("quarter", quarter);

    const dataRes = await fetch(apiUrl.toString());
    if (!dataRes.ok) {
      const err = await dataRes.json();
      return NextResponse.json(err, { status: dataRes.status });
    }

    const data = await dataRes.json();

    // Write JSON to temp file
    const tmpDir = os.tmpdir();
    const jsonPath = path.join(tmpDir, `accounting-${Date.now()}.json`);
    const pdfPath = path.join(tmpDir, `contabilidad-${Date.now()}.pdf`);

    await writeFile(jsonPath, JSON.stringify(data), "utf-8");

    // Generate PDF using Python script
    const scriptPath = path.join(process.cwd(), "scripts", "generate-accounting-pdf.py");

    try {
      await execAsync(`cat "${jsonPath}" | python3 "${scriptPath}" "${pdfPath}"`, {
        timeout: 30000,
      });
    } catch (execErr) {
      // Cleanup
      try { await unlink(jsonPath); } catch { /* ignore */ }
      console.error("PDF generation error:", execErr);
      return NextResponse.json({ error: "Error generando PDF" }, { status: 500 });
    }

    // Read generated PDF
    const pdfBuffer = await readFile(pdfPath);

    // Cleanup temp files
    try { await unlink(jsonPath); } catch { /* ignore */ }
    try { await unlink(pdfPath); } catch { /* ignore */ }

    // Build filename
    let filename = `contabilidad-${year}`;
    if (period === "quarter" && quarter) filename += `-${quarter}T`;
    if (period === "month" && month) filename += `-${month.padStart(2, "0")}`;
    filename += ".pdf";

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("Download error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error interno" },
      { status: 500 }
    );
  }
}
