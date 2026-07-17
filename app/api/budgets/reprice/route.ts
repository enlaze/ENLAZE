/**
 * POST /api/budgets/reprice
 *
 * Re-resolves prices for an existing budget's items.
 * Uses V2 resolver when pb_* data exists, falls back to V1.
 *
 * Body:
 *   - budget_id: string
 *   - items: BudgetItemV2[]  (current items to reprice)
 *   - location: string
 *   - quality: "basica" | "media" | "alta"
 *   - margin_percent: number
 *
 * Returns: updated items with new prices + summary of changes.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  resolvePricesForBudget,
  type TechnicalPriceEntry,
  type ResolvedPrice,
  normalizeMaterialName,
} from "@/lib/price-resolver";
import {
  resolveForBudget as resolveForBudgetV2,
  type PrefetchedPriceData,
  type CurrentPriceRow,
  type ManualPriceRow,
  type TechnicalPriceRow,
  type EnlazePriceRow,
} from "@/lib/price-resolver-v2";
import type { BudgetItemV2, PriceSourceV2 } from "@/lib/types/budget-v2";

// ─── POST ─────────────────────────────────────────────────────────────────────

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
    const body = await request.json();
    const {
      budget_id,
      items,
      location = "",
      quality = "media",
      margin_percent = 25,
    } = body as {
      budget_id: string;
      items: BudgetItemV2[];
      location: string;
      quality: "basica" | "media" | "alta";
      margin_percent: number;
    };

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "Faltan las partidas (items)" }, { status: 400 });
    }

    // Get company_id
    const { data: profile } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", user.id)
      .single();

    const company_id = profile?.company_id ?? null;

    // Parallel pre-fetch: V1 + V2 data
    const [
      { data: techPriceRows },
      { data: userPriceRows },
      { data: sectorData },
      { count: pbCount },
      { data: pbCurrentRows },
      { data: pbManualRows },
      { data: pbTechnicalRows },
      { data: pbEnlazeRows },
    ] = await Promise.all([
      supabase
        .from("technical_price_items")
        .select("name, item_code, unit, unit_price, confidence_score, source, region")
        .eq("is_active", true),
      supabase
        .from("price_items")
        .select("name, unit_price, unit, supplier_name, source_type, is_locked")
        .eq("user_id", user.id)
        .eq("is_active", true),
      supabase
        .from("sector_data")
        .select("title, value, unit, source, category")
        .eq("data_type", "price")
        .order("last_updated", { ascending: false }),
      supabase
        .from("pb_price_current")
        .select("*", { count: "exact", head: true }),
      supabase
        .from("pb_price_current")
        .select(`
          product_id, price_excl_vat, effective_price, confidence_score,
          source_type, is_available, checked_at,
          pb_products!inner (
            id, commercial_name, concept_id, brand, sku, sale_unit,
            units_per_package, unit_price,
            pb_normalized_concepts ( id, canonical_name )
          ),
          pb_providers!inner (
            id, name, province, supply_zones, is_preferred,
            shipping_cost_flat, minimum_order, delivery_days_min, delivery_days_max,
            company_id
          )
        `)
        .or(`pb_providers.company_id.is.null${company_id ? `,pb_providers.company_id.eq.${company_id}` : ""}`),
      supabase
        .from("price_items")
        .select("name, unit_price, unit, supplier_name, source_type, is_locked")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .eq("is_locked", true),
      supabase
        .from("technical_price_items")
        .select("name, item_code, unit, unit_price, confidence_score, source, region, company_id")
        .eq("is_active", true),
      supabase
        .from("sector_data")
        .select("title, value, unit, source, category")
        .eq("data_type", "price")
        .in("source", ["enlaze", "base"]),
    ]);

    const hasPBData = (pbCount ?? 0) > 0 && company_id;
    let resolverUsed: "v1" | "v2" = "v1";
    let updatedItems: BudgetItemV2[];

    if (hasPBData) {
      // ── V2 Path ──
      resolverUsed = "v2";

      const v2Data: PrefetchedPriceData = {
        current_prices: (pbCurrentRows || []).map((row: Record<string, unknown>): CurrentPriceRow => {
          const prod = row.pb_products as Record<string, unknown> | null;
          const prov = row.pb_providers as Record<string, unknown> | null;
          const concept = prod?.pb_normalized_concepts as Record<string, unknown> | null;
          return {
            product_id: String(prod?.id ?? ""),
            product_name: String(prod?.commercial_name ?? ""),
            concept_id: concept?.id ? String(concept.id) : null,
            concept_name: concept?.canonical_name ? String(concept.canonical_name) : null,
            provider_id: String(prov?.id ?? ""),
            provider_name: String(prov?.name ?? ""),
            provider_province: prov?.province ? String(prov.province) : null,
            provider_supply_zones: Array.isArray(prov?.supply_zones) ? prov.supply_zones as string[] : [],
            is_preferred: Boolean(prov?.is_preferred),
            brand: prod?.brand ? String(prod.brand) : null,
            sku: prod?.sku ? String(prod.sku) : null,
            unit: String(prod?.sale_unit ?? "ud"),
            units_per_package: Number(prod?.units_per_package) || 1,
            price_excl_vat: Number(row.price_excl_vat) || 0,
            effective_price: row.effective_price ? Number(row.effective_price) : null,
            shipping_cost: Number(prov?.shipping_cost_flat) || 0,
            minimum_order: Number(prov?.minimum_order) || 0,
            delivery_days_min: Number(prov?.delivery_days_min) || 1,
            delivery_days_max: Number(prov?.delivery_days_max) || 7,
            is_available: Boolean(row.is_available),
            confidence_score: Number(row.confidence_score) || 0.5,
            source_type: String(row.source_type ?? "provider_catalog"),
            checked_at: row.checked_at ? String(row.checked_at) : null,
            price_changed_at: null,
            is_private_tariff: false,
            is_negotiated: false,
          };
        }),
        manual_prices: (pbManualRows || []).map((p): ManualPriceRow => ({
          name: String(p.name || ""),
          unit: String(p.unit || "ud"),
          unit_price: Number(p.unit_price) || 0,
          supplier_name: String(p.supplier_name || ""),
          source_type: String(p.source_type || "manual"),
          is_locked: Boolean(p.is_locked),
        })),
        historical_prices: [],
        technical_prices: (pbTechnicalRows || []).map((r): TechnicalPriceRow => ({
          name: String(r.name || ""),
          item_code: String(r.item_code || ""),
          unit: String(r.unit || "ud"),
          unit_price: Number(r.unit_price) || 0,
          confidence_score: Number(r.confidence_score) || 0.80,
          source: String(r.source || ""),
          region: String(r.region || "espana"),
          is_private: Boolean(r.company_id),
        })),
        enlaze_prices: (pbEnlazeRows || []).map((sd): EnlazePriceRow => ({
          name: String(sd.title || ""),
          unit: String(sd.unit || "ud"),
          unit_price: Number(sd.value) || 0,
          chapter: String(sd.category || ""),
          supplier_ref: String(sd.source || "Banco ENLAZE"),
        })),
      };

      const v2Result = resolveForBudgetV2({
        items: items.map((item) => ({
          concept_name: item.name,
          category: item.chapter,
          unit: item.unit,
          quantity: item.quantity,
        })),
        context: {
          company_id,
          province: location,
          quality_tier: quality,
        },
        data: v2Data,
      });

      updatedItems = items.map((item, idx) => {
        const r = v2Result.results[idx];
        if (!r || r.unit_price === 0) return item;

        const unitCost = r.effective_price > 0 ? r.effective_price : r.unit_price;
        const unitPriceSale = Number((unitCost * (1 + margin_percent / 100)).toFixed(2));
        const mappedSource = mapV2SourceToV1(r.source_type);

        return {
          ...item,
          unit_cost: Number(unitCost.toFixed(2)),
          unit_price_sale: unitPriceSale,
          subtotal_cost: Number((item.quantity * unitCost).toFixed(2)),
          subtotal_sale: Number((item.quantity * unitPriceSale).toFixed(2)),
          confidence_score: r.confidence_score,
          price_source: mappedSource,
          price_source_detail: r.provider_name || r.selection_reason,
          supplier: r.provider_name || null,
        };
      });
    } else {
      // ── V1 Path ──
      const technicalPrices: TechnicalPriceEntry[] = (techPriceRows || []).map((r) => ({
        name: String(r.name || ""),
        item_code: String(r.item_code || ""),
        unit: String(r.unit || "ud"),
        unit_price: Number(r.unit_price) || 0,
        confidence_score: Number(r.confidence_score) || 0.80,
        source: String(r.source || ""),
        region: String(r.region || "espana"),
      }));

      const userPrices = (userPriceRows || []).map((p) => ({
        name: String(p.name || ""),
        unit_price: Number(p.unit_price) || 0,
        unit: String(p.unit || "ud"),
        supplier_name: String(p.supplier_name || ""),
        source_type: String(p.source_type || "manual"),
      }));

      const enlazePrices = (sectorData || [])
        .filter((sd) => sd.source === "enlaze" || sd.source === "base")
        .map((sd) => ({
          name: String(sd.title || ""),
          unit_price: Number(sd.value) || 0,
          unit: String(sd.unit || "ud"),
          supplier_name: String(sd.source || "Banco ENLAZE"),
        }));

      const n8nPrices = (sectorData || [])
        .filter((sd) => sd.source !== "enlaze" && sd.source !== "base")
        .map((sd) => ({
          title: String(sd.title || ""),
          value: Number(sd.value) || 0,
          unit: String(sd.unit || "ud"),
          source: String(sd.source || "n8n market"),
        }));

      const priceRequests = items.map((item) => ({
        materialName: item.name,
        category: item.chapter,
        unit: item.unit,
        quantity: item.quantity,
        qualityTier: quality,
        location,
      }));

      const { resolved } = resolvePricesForBudget({
        materials: priceRequests,
        userPrices,
        enlazePrices,
        n8nPrices,
        technicalPrices,
      });

      const resolvedMap = new Map<string, ResolvedPrice>(
        resolved.map((r) => [r.materialName, r])
      );

      updatedItems = items.map((item) => {
        const resolvedPrice = resolvedMap.get(item.name);
        if (resolvedPrice && resolvedPrice.selectedPrice > 0) {
          const unitCost = resolvedPrice.selectedPrice;
          const unitPriceSale = Number((unitCost * (1 + margin_percent / 100)).toFixed(2));
          return {
            ...item,
            unit_cost: Number(unitCost.toFixed(2)),
            unit_price_sale: unitPriceSale,
            subtotal_cost: Number((item.quantity * unitCost).toFixed(2)),
            subtotal_sale: Number((item.quantity * unitPriceSale).toFixed(2)),
            confidence_score: resolvedPrice.confidenceScore,
            price_source: resolvedPrice.sourceType as BudgetItemV2["price_source"],
            price_source_detail: resolvedPrice.selectedSupplier,
            supplier: resolvedPrice.selectedSupplier || null,
          };
        }
        return item;
      });
    }

    // Build change summary
    const changes = updatedItems.reduce(
      (acc, item, idx) => {
        const original = items[idx];
        if (item.unit_cost !== original.unit_cost) {
          acc.price_changed++;
          acc.total_delta += (item.subtotal_cost - original.subtotal_cost);
        }
        if (item.price_source !== original.price_source) {
          acc.source_changed++;
        }
        return acc;
      },
      { price_changed: 0, source_changed: 0, total_delta: 0 }
    );

    const totalCost = updatedItems.reduce((sum, i) => sum + i.subtotal_cost, 0);
    const totalSale = updatedItems.reduce((sum, i) => sum + i.subtotal_sale, 0);

    return NextResponse.json({
      ok: true,
      resolver_used: resolverUsed,
      budget_id,
      items: updatedItems,
      summary: {
        total_items: updatedItems.length,
        total_cost: Number(totalCost.toFixed(2)),
        total_sale: Number(totalSale.toFixed(2)),
        items_repriced: changes.price_changed,
        items_source_changed: changes.source_changed,
        cost_delta: Number(changes.total_delta.toFixed(2)),
        price_sources: {
          user_catalog: updatedItems.filter((i) => i.price_source === "user_catalog").length,
          technical_bank: updatedItems.filter((i) => i.price_source === "technical_bank").length,
          enlaze_base: updatedItems.filter((i) => i.price_source === "enlaze_base").length,
          n8n_market: updatedItems.filter((i) => i.price_source === "n8n_market").length,
          web_search: updatedItems.filter((i) => i.price_source === "web_search").length,
          estimated: updatedItems.filter((i) => i.price_source === "estimated").length,
        },
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Reprice] Error:", message);
    return NextResponse.json(
      { error: message || "Error interno al re-preciar" },
      { status: 500 },
    );
  }
}

// ─── Helper ──────────────────────────────────────────────────────────────────

function mapV2SourceToV1(sourceType: string): PriceSourceV2 {
  const mapping: Record<string, PriceSourceV2> = {
    manual_locked: "user_catalog",
    private_tariff: "user_catalog",
    negotiated: "user_catalog",
    historical_approved: "user_catalog",
    preferred_supplier: "user_catalog",
    provider_updated: "n8n_market",
    private_bc3: "technical_bank",
    technical_bank: "technical_bank",
    enlaze_base: "enlaze_base",
    market_estimate: "n8n_market",
    ai_estimate: "estimated",
  };
  return mapping[sourceType] ?? "estimated";
}
