import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateBudget } from "@/lib/budget-validator";
import { calculateEconomics } from "@/lib/budget-economics";
import type {
  BudgetItemV2,
  BudgetScopeV2,
  BudgetPreferences,
  ProjectAnalysis,
  BudgetEconomics,
  BudgetTimeline,
} from "@/lib/types/budget-v2";

/**
 * POST /api/budgets/validate
 *
 * FASE 6 aislada: validate an edited budget before delivery.
 * Runs all 6 categories of checks and returns ValidationReport.
 *
 * Can be called after user edits to check if budget is still valid.
 * Only call on explicit user action, NEVER on render.
 */
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

  // ── Auth ──
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      scope,
      items,
      analysis,
      preferences,
      economics: providedEconomics,
      timeline,
    } = body as {
      scope: BudgetScopeV2;
      items: BudgetItemV2[];
      analysis: ProjectAnalysis;
      preferences?: BudgetPreferences;
      economics?: BudgetEconomics;
      timeline?: BudgetTimeline;
    };

    if (!scope || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "Faltan datos: scope e items son obligatorios" },
        { status: 400 },
      );
    }

    if (!analysis) {
      return NextResponse.json(
        { error: "Falta el analysis (ProjectAnalysis) para validar" },
        { status: 400 },
      );
    }

    // Calculate economics if not provided
    const prefs: BudgetPreferences = preferences || {
      quality: scope.quality || "media",
      margin_percent: 25,
      indirect_costs_percent: 6,
      tax_percent: 21,
      workers_count: null,
      include_alternatives: false,
    };

    const economics = providedEconomics || calculateEconomics(
      items,
      prefs,
      scope.project_type,
      scope.surface_m2,
    );

    // Run validation
    const validation = validateBudget(
      items,
      economics,
      analysis,
      scope,
      timeline || null,
    );

    return NextResponse.json({
      ok: true,
      validation,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[BudgetValidate] Error:", message);
    return NextResponse.json(
      { error: message || "Error interno al validar presupuesto" },
      { status: 500 },
    );
  }
}
