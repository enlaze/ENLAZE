import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { writeFileSync, readFileSync, unlinkSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

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
    const { budgetId } = await request.json();
    if (!budgetId) {
      return NextResponse.json({ error: "budgetId requerido" }, { status: 400 });
    }

    // Load budget
    const { data: budget, error: bErr } = await supabase
      .from("budgets")
      .select("*")
      .eq("id", budgetId)
      .single();

    if (bErr || !budget) {
      return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });
    }

    // Load items
    const { data: items } = await supabase
      .from("budget_items")
      .select("*")
      .eq("budget_id", budgetId)
      .order("created_at", { ascending: true });

    // Load company info from profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, business_name")
      .eq("id", user.id)
      .maybeSingle();

    // Try to get fiscal settings for NIF and address
    let fiscal = null;
    try {
      const { data: f } = await supabase
        .from("fiscal_settings")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      fiscal = f;
    } catch {
      // fiscal_settings may not exist
    }

    const company = {
      name: profile?.business_name || profile?.full_name || "Mi Empresa",
      nif: (fiscal as any)?.nif || (fiscal as any)?.cif || "",
      address: (fiscal as any)?.address || (fiscal as any)?.fiscal_address || "",
      phone: (fiscal as any)?.phone || "",
      email: user.email || "",
    };

    const pdfData = {
      budget: {
        budget_number: budget.budget_number,
        title: budget.title,
        client_name: budget.client_name,
        client_email: budget.client_email,
        client_phone: budget.client_phone,
        client_address: budget.client_address,
        service_type: budget.service_type,
        status: budget.status,
        created_at: budget.created_at,
        valid_until: budget.valid_until,
        subtotal: Number(budget.subtotal) || 0,
        iva_percent: Number(budget.iva_percent) || 21,
        iva_amount: Number(budget.iva_amount) || 0,
        total: Number(budget.total) || 0,
        notes: budget.notes || "",
      },
      items: (items || []).map((i: any) => ({
        concept: i.concept,
        description: i.description,
        category: i.category,
        chapter: i.chapter || i.category,
        quantity: Number(i.quantity) || 0,
        unit: i.unit,
        unit_price: Number(i.unit_price) || 0,
        subtotal: Number(i.subtotal) || 0,
      })),
      company,
    };

    // Write JSON input, run Python, read PDF output
    const tmpDir = tmpdir();
    const id = randomUUID();
    const jsonPath = join(tmpDir, `budget-${id}.json`);
    const pdfPath = join(tmpDir, `budget-${id}.pdf`);

    writeFileSync(jsonPath, JSON.stringify(pdfData, null, 2));

    const scriptPath = join(process.cwd(), "scripts", "generate-budget-pdf.py");

    // Ensure reportlab is installed
    try {
      execSync("python3 -c \"import reportlab\"", { timeout: 5000, stdio: "pipe" });
    } catch {
      console.log("[PDF] Installing reportlab...");
      try {
        execSync("pip3 install reportlab --break-system-packages -q", {
          timeout: 60000,
          stdio: "pipe",
        });
      } catch {
        // Try without --break-system-packages for older pip
        execSync("pip3 install reportlab -q", { timeout: 60000, stdio: "pipe" });
      }
    }

    try {
      execSync(`python3 "${scriptPath}" "${jsonPath}" "${pdfPath}"`, {
        timeout: 30000,
        encoding: "utf-8",
      });
    } catch (execErr: any) {
      console.error("[PDF] Python error:", execErr.stderr || execErr.message);
      return NextResponse.json(
        { error: "Error generando PDF: " + (execErr.stderr || execErr.message) },
        { status: 500 }
      );
    }

    // Read the PDF and return it
    const pdfBuffer = readFileSync(pdfPath);

    // Cleanup
    try { unlinkSync(jsonPath); } catch {}
    try { unlinkSync(pdfPath); } catch {}

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${budget.budget_number || "presupuesto"}.pdf"`,
      },
    });
  } catch (error: any) {
    console.error("[PDF] Error:", error);
    return NextResponse.json(
      { error: error.message || "Error interno" },
      { status: 500 }
    );
  }
}
