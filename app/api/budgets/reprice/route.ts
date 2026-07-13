import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  resolvePricesForBudget,
  type TechnicalPriceEntry,
} from "@/lib/price-resolver";
import { calculateRepriceImpact, recalculateItem } from "@/lib/budget-economics";
import type { BudgetItemV2 } from "@/lib/types/budget-v2";

/**
 * POST /api/budgets/reprice
 *
 * Recalculate prices for existing budget items without regenerating them.
 * Runs price-resolver chain on all items, compares with previous prices,
 * and returns a diff with impact summary.
 *
 * Use case: "Actualizar precios de mercado" button.
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
      items,
      location,
      margin_percent,
      force_refresh,
    } = body as {
      items: BudgetItemV2[];
      location?: string;
      margin_percent?: number;
      force_refresh?: boolean;
    };

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "Falta la lista de partidas (items)" },
        { status: 400 },
      );
    }

    const marginPercent = margin_percent ?? 25;

    // ── Fetch price sources ──

    // User prices (level 1)
    const { data: userPriceItems } = await supabase
      .from("price_items")
      .select("name, unit_price, unit, supplier_name, source_type")
      .eq("user_id", user.id)
      .eq("is_active", true);

    const userPrices = (userPriceItems || []).map(p => ({
      name: String(p.name || ""),
      unit_price: Number(p.unit_price) || 0,
      unit: String(p.unit || "ud"),
      supplier_name: String(p.supplier_name || ""),
      source_type: String(p.source_type || "manual"),
    }));

    // Technical prices (level 2)
    const { data: techPriceRows } = await supabase
      .from("technical_price_items")
      .select("name, item_code, unit, unit_price, confidence_score, source, region")
      .eq("is_active", true);

    const technicalPrices: TechnicalPriceEntry[] = (techPriceRows || []).map(r => ({
      name: String(r.name || ""),
      item_code: String(r.item_code || ""),
      unit: String(r.unit || "ud"),
      unit_price: Number(r.unit_price) || 0,
      confidence_score: Number(r.confidence_score) || 0.80,
      source: String(r.source || ""),
      region: String(r.region || "espana"),
    }));

    // Enlaze + n8n prices (levels 3-4)
    const { data: sectorData } = await supabase
      .from("sector_data")
      .select("title, value, unit, source, category")
      .eq("data_type", "price")
      .order("last_updated", { ascending: false });

    const enlazePrices = (sectorData || [])
      .filter(sd => sd.source === "enlaze" || sd.source === "base")
      .map(sd => ({
        name: String(sd.title || ""),
        unit_price: Number(sd.value) || 0,
        unit: String(sd.unit || "ud"),
        supplier_name: String(sd.source || "Banco ENLAZE"),
      }));

    const n8nPrices = (sectorData || [])
      .filter(sd => sd.source !== "enlaze" && sd.source !== "base")
      .map(sd => ({
        title: String(sd.title || ""),
        value: Number(sd.value) || 0,
        unit: String(sd.unit || "ud"),
        source: String(sd.source || "n8n market"),
      }));

    // ── Build price requests from all items ──
    const priceRequests = items.map(item => ({
      materialName: item.name,
      category: item.chapter,
      unit: item.unit,
      quantity: item.quantity,
      qualityTier: "media" as const,
      location: location || "",
    }));

    // ── Resolve prices ──
    const { resolved } = resolvePricesForBudget({
      materials: priceRequests,
      userPrices,
      enlazePrices,
      n8nPrices,
      technicalPrices,
    });

    // ── Build new items with resolved prices ──
    const resolvedMap = new Map(resolved.map(r => [r.materialName, r]));

    const newItems = items.map(item => {
      const resolvedPrice = resolvedMap.get(item.name);
      if (resolvedPrice && resolvedPrice.selectedPrice > 0) {
        return recalculateItem(item, {
          unit_cost: resolvedPrice.selectedPrice,
          margin_percent: marginPercent,
        });
      }
      return item;
    });

    // ── Calculate impact ──
    const { changes, impact } = calculateRepriceImpact(items, newItems, marginPercent);

    return NextResponse.json({
      ok: true,
      items: newItems,
      changes,
      impact,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[BudgetReprice] Error:", message);
    return NextResponse.json(
      { error: message || "Error interno al re-preciar presupuesto" },
      { status: 500 },
    );
  }
}
