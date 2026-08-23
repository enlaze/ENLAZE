import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { generateBudgetPDFHTML } from "@/lib/pdf-generator";
import {
  computeBudgetTotals,
  checkBudgetTotalsConsistency,
  hasCurrentTotalsContract,
} from "@/lib/budget-totals";

interface FiscalSettings {
  nif?: string | null;
  cif?: string | null;
  address?: string | null;
  fiscal_address?: string | null;
  phone?: string | null;
}

type PDFMode = "client" | "internal";

function normalizedConcept(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findInternalCost(item: Record<string, unknown>, wizardState: unknown) {
  if (!wizardState || typeof wizardState !== "object") return Number(item.subtotal) || 0;
  const state = wizardState as { partidas?: unknown; materials?: unknown };
  const candidates = item.category === "material" && Array.isArray(state.materials)
    ? state.materials
    : Array.isArray(state.partidas)
      ? state.partidas
      : [];
  const target = normalizedConcept(item.concept);
  const match = candidates.find((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    const record = candidate as Record<string, unknown>;
    return normalizedConcept(record.concept || record.name) === target;
  }) as Record<string, unknown> | undefined;
  if (!match) return Number(item.subtotal) || 0;
  const cost = Number(match.subtotal_cost ?? match.subtotal);
  return Number.isFinite(cost) && cost >= 0 ? cost : Number(item.subtotal) || 0;
}

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
    const body = await request.json() as { budgetId?: unknown; mode?: unknown };
    const budgetId = typeof body.budgetId === "string" ? body.budgetId : "";
    const mode: PDFMode = body.mode === "internal" ? "internal" : "client";
    if (!budgetId) {
      return NextResponse.json({ error: "budgetId requerido" }, { status: 400 });
    }

    // Load budget
    const { data: budget, error: bErr } = await supabase
      .from("budgets")
      .select("*")
      .eq("id", budgetId)
      .eq("user_id", user.id)
      .single();

    if (bErr || !budget) {
      return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });
    }

    const { data: selectedClient } = budget.client_id
      ? await supabase
          .from("clients")
          .select("name, email, phone")
          .eq("id", budget.client_id)
          .eq("user_id", user.id)
          .maybeSingle()
      : { data: null };
    const clientSnapshot = {
      name: budget.client_name || selectedClient?.name || "",
      email: budget.client_email || selectedClient?.email || "",
      phone: budget.client_phone || selectedClient?.phone || "",
      address: budget.client_address || "",
      nif: budget.client_nif || "",
    };

    // Load items
    const { data: items } = await supabase
      .from("budget_items")
      .select("*")
      .eq("budget_id", budgetId)
      .order("created_at", { ascending: true });

    // Load company info from profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, business_name, logo_url")
      .eq("id", user.id)
      .maybeSingle();

    // Try to get fiscal settings for NIF and address
    let fiscal: FiscalSettings | null = null;
    try {
      const { data: f } = await supabase
        .from("fiscal_settings")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      fiscal = f as FiscalSettings | null;
    } catch {
      // fiscal_settings may not exist
    }

    const company = {
      name: profile?.business_name || profile?.full_name || "Mi Empresa",
      logo_url: profile?.logo_url || "",
      nif: fiscal?.nif || fiscal?.cif || "",
      address: fiscal?.address || fiscal?.fiscal_address || "",
      phone: fiscal?.phone || "",
      email: user.email || "",
    };

    // ── Puerta de cuadre antes de renderizar ────────────────────────────────
    //
    // El PDF es un renderizador puro: imprime lo que hay guardado y no
    // recalcula precios ni vuelve a preguntar al modelo. Pero justamente por
    // eso tiene que negarse a imprimir un documento incoherente, porque es la
    // última pantalla antes de que el importe llegue al cliente.
    //
    // Se comprueba que la suma de las líneas guardadas en `budget_items` sea
    // exactamente el subtotal de la fila `budgets`, que es el que alimenta la
    // caja de totales.
    const pdfLines = (items || []).map((item) => ({
      quantity: Number(item.quantity) || 0,
      unit_price: Number(item.unit_price) || 0,
    }));
    const recomputedTotals = computeBudgetTotals({
      lines: pdfLines,
      ivaPercent: Number(budget.iva_percent) || 21,
      discountType: (budget.discount_type as "percent" | "amount") || "percent",
      discountPercent: Number(budget.discount_percent) || 0,
      discountAmount: Number(budget.discount_amount) || 0,
    });
    const consistency = checkBudgetTotalsConsistency(
      Number(budget.subtotal) || 0,
      recomputedTotals,
    );

    if (!consistency.ok) {
      if (hasCurrentTotalsContract(budget.wizard_state)) {
        // Presupuesto creado bajo el contrato actual: un descuadre aquí es un
        // defecto real, no una herencia. Se bloquea.
        return NextResponse.json(
          {
            error:
              "BUDGET_TOTAL_MISMATCH: la suma de las partidas no coincide con la base imponible " +
              `(desviacion ${consistency.deltaEuros.toFixed(2)} EUR). ` +
              "No se genera el PDF. Vuelve a abrir el presupuesto y recalcula.",
            code: "BUDGET_TOTAL_MISMATCH",
            expected: consistency.expectedCents / 100,
            actual: consistency.actualCents / 100,
            delta: consistency.deltaEuros,
          },
          { status: 409 },
        );
      }

      // Presupuesto heredado (guardado antes de la Fase 1, con los materiales
      // como líneas adicionales). Su descuadre es conocido y esperado: se
      // registra y se deja pasar para no romper documentos ya emitidos.
      console.warn(
        `[PDF] Presupuesto heredado con totales descuadrados: ${budget.budget_number}. ` +
          `Desviacion ${consistency.deltaEuros.toFixed(2)} EUR. ` +
          "Se renderiza igualmente por compatibilidad; al reabrir y guardar se corregira.",
      );
    }

    const html = generateBudgetPDFHTML(
      {
        budget_number: budget.budget_number,
        title: budget.title,
        client_name: clientSnapshot.name,
        client_email: clientSnapshot.email,
        client_phone: clientSnapshot.phone,
        client_address: clientSnapshot.address,
        client_nif: clientSnapshot.nif,
        service_type: budget.service_type,
        status: budget.status,
        created_at: budget.created_at,
        valid_until: budget.valid_until,
        subtotal: Number(budget.subtotal) || 0,
        iva_percent: Number(budget.iva_percent) || 21,
        iva_amount: Number(budget.iva_amount) || 0,
        total: Number(budget.total) || 0,
        notes: budget.notes || "",
        deposit_percent: Number(budget.deposit_percent) || 30,
        payment_method: budget.payment_method || "Transferencia bancaria",
        payment_iban: budget.payment_iban || "",
        discount_type: budget.discount_type || "percent",
        discount_percent: Number(budget.discount_percent) || 0,
        discount_amount: Number(budget.discount_amount) || 0,
        payment_schedule: Array.isArray(budget.payment_schedule) ? budget.payment_schedule : [],
        warranty_text: budget.warranty_text || "",
        execution_deadline_text: budget.execution_deadline_text || "",
        observations: budget.observations || "",
        conditions_text: budget.conditions_text || "",
        company_name: company.name,
        company_logo_url: company.logo_url,
        company_nif: company.nif,
        company_address: company.address,
        company_phone: company.phone,
        company_email: company.email,
      },
      (items || []).map((item) => ({
        concept: item.concept,
        description: item.description,
        category: item.category,
        chapter: item.chapter || item.category,
        quantity: Number(item.quantity) || 0,
        unit: item.unit,
        unit_price: Number(item.unit_price) || 0,
        subtotal: Number(item.subtotal) || 0,
        subtotal_cost: findInternalCost(item as Record<string, unknown>, budget.wizard_state),
      })),
      mode,
    );

    // The browser prints this document using its native PDF engine. This keeps
    // production independent from Python/pip and matches the wizard export.
    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Enlaze-PDF-Mode": "browser-print",
        "X-Enlaze-PDF-Variant": mode,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error interno";
    console.error("[PDF] Error:", error);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
