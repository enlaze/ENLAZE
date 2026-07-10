import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { analyzeProject, buildScopeHash } from "@/lib/budget-analysis";
import type { BudgetScopeV2 } from "@/lib/types/budget-v2";

/**
 * POST /api/budgets/analyze
 *
 * FASE 1 aislada: analiza un proyecto y devuelve ProjectAnalysis.
 * Util para preview rapido antes de generar presupuesto completo.
 *
 * Incluye cache de 24h basado en scope hash.
 * Solo llamar en accion explicita del usuario (boton "Analizar"),
 * NUNCA en render ni en useEffect.
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
    const { scope, forceRefresh } = body as {
      scope: BudgetScopeV2;
      forceRefresh?: boolean;
    };

    if (!scope || !scope.project_type || !scope.surface_m2) {
      return NextResponse.json(
        { error: "Faltan datos del proyecto (scope)" },
        { status: 400 },
      );
    }

    // ── Check cache ──
    const scopeHash = buildScopeHash(scope);

    if (!forceRefresh) {
      const { data: cached } = await supabase
        .from("budget_analysis_cache")
        .select("analysis, created_at")
        .eq("user_id", user.id)
        .eq("scope_hash", scopeHash)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();

      if (cached?.analysis) {
        return NextResponse.json({
          ok: true,
          analysis: cached.analysis,
          cached: true,
          cached_at: cached.created_at,
        });
      }
    }

    // ── Run FASE 1 ──
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY no configurada" },
        { status: 500 },
      );
    }

    const result = await analyzeProject(scope, { apiKey });

    if (!result.ok || !result.analysis) {
      return NextResponse.json(
        { error: result.error || "Error al analizar el proyecto" },
        { status: 500 },
      );
    }

    // ── Save to cache (24h TTL) ──
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await supabase
      .from("budget_analysis_cache")
      .upsert(
        {
          user_id: user.id,
          scope_hash: scopeHash,
          analysis: result.analysis,
          created_at: new Date().toISOString(),
          expires_at: expiresAt,
        },
        { onConflict: "user_id,scope_hash" },
      )
      .then(({ error }) => {
        if (error) {
          // Non-fatal — cache miss next time is fine
          console.error("[BudgetAnalyze] Cache save error:", error.message);
        }
      });

    return NextResponse.json({
      ok: true,
      analysis: result.analysis,
      cached: false,
      duration_ms: result.durationMs,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[BudgetAnalyze] Error:", message);
    return NextResponse.json(
      { error: message || "Error interno al analizar el proyecto" },
      { status: 500 },
    );
  }
}
