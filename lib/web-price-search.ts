/**
 * web-price-search.ts
 *
 * Modular web price search for construction materials in Spain.
 *
 * Strategy (in order):
 *   1. SerpAPI Google Shopping  — if SERP_API_KEY is set
 *   2. Direct retailer scraping — future (Leroy Merlin, Obramat open APIs)
 *   3. Empty result             — caller keeps "estimated" sourceType
 *
 * IMPORTANT:
 *   - This module is server-side only (uses env vars + fetch)
 *   - Never import from client components
 *   - Each search result MUST include a real URL or it won't count as web_search
 */

import type { PriceAlternative, QualityTier } from "./price-resolver";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WebSearchRequest {
  materialName: string;
  category: string;
  unit: string;
  qualityTier: QualityTier;
  location: string;
}

export interface WebSearchResult {
  alternatives: PriceAlternative[];
  searchEngine: string;
  queryUsed: string;
  searchedAt: string;
}

// ─── SerpAPI Google Shopping ────────────────────────────────────────────────

function buildSearchQuery(req: WebSearchRequest): string {
  // Build a targeted search for Spanish construction material retailers
  const tierLabel =
    req.qualityTier === "alta" ? "premium" :
    req.qualityTier === "basica" ? "económico" : "";

  const parts = [req.materialName, tierLabel, "precio", "España"].filter(Boolean);
  return parts.join(" ");
}

async function searchViaSerpAPI(req: WebSearchRequest): Promise<WebSearchResult | null> {
  const apiKey = process.env.SERP_API_KEY;
  if (!apiKey) return null;

  const query = buildSearchQuery(req);
  const params = new URLSearchParams({
    api_key: apiKey,
    engine: "google_shopping",
    q: query,
    gl: "es",
    hl: "es",
    num: "10",
  });

  try {
    const response = await fetch(`https://serpapi.com/search.json?${params.toString()}`, {
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      console.warn(`[WebPriceSearch] SerpAPI returned ${response.status}`);
      return null;
    }

    const data = await response.json();
    const results: PriceAlternative[] = [];

    const shoppingResults = data.shopping_results || [];
    for (const item of shoppingResults.slice(0, 8)) {
      const price = parsePrice(item.extracted_price ?? item.price);
      if (price <= 0) continue;

      const url = item.link || item.product_link || "";
      if (!url) continue; // Must have real URL to count as web_search

      results.push({
        supplier: item.source || item.seller || "Google Shopping",
        title: item.title || req.materialName,
        price,
        unit: req.unit,
        qualityTier: req.qualityTier,
        url,
      });
    }

    return {
      alternatives: results,
      searchEngine: "serpapi_google_shopping",
      queryUsed: query,
      searchedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[WebPriceSearch] SerpAPI error:", err);
    return null;
  }
}

// ─── Direct Retailer Search (Leroy Merlin / Obramat open pages) ─────────

async function searchViaRetailerAPIs(req: WebSearchRequest): Promise<WebSearchResult | null> {
  // Leroy Merlin España tiene una API semi-pública de búsqueda de productos.
  // Obramat (Bricomart) tiene búsqueda web indexable.
  // Aquí implementamos búsqueda en Leroy Merlin vía su endpoint de autocompletar.
  const query = req.materialName;

  try {
    const leroyUrl = `https://www.leroymerlin.es/api/search/v2/products?q=${encodeURIComponent(query)}&pageSize=5&sort=relevance`;
    const response = await fetch(leroyUrl, {
      headers: {
        "User-Agent": "ENLAZE-PriceBot/1.0 (price-comparison; enlaze.es)",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(6000),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const products = data.products || data.results || [];
    const results: PriceAlternative[] = [];

    for (const p of products.slice(0, 5)) {
      const price = parsePrice(p.price?.value ?? p.price?.current ?? p.price);
      if (price <= 0) continue;

      const productUrl = p.url
        ? (p.url.startsWith("http") ? p.url : `https://www.leroymerlin.es${p.url}`)
        : "";
      if (!productUrl) continue;

      results.push({
        supplier: "Leroy Merlin",
        title: p.name || p.title || req.materialName,
        price,
        unit: req.unit,
        qualityTier: req.qualityTier,
        url: productUrl,
      });
    }

    if (results.length > 0) {
      return {
        alternatives: results,
        searchEngine: "leroy_merlin_api",
        queryUsed: query,
        searchedAt: new Date().toISOString(),
      };
    }
  } catch (err) {
    // Silently fail — retailer APIs are optional
    console.warn("[WebPriceSearch] Retailer API error:", err);
  }

  return null;
}

// ─── n8n webhook search (future — propuesta para el usuario) ────────────

/**
 * PROPUESTA n8n:
 * Crear un workflow en n8n que:
 *   1. Reciba POST con { materialName, category, qualityTier, location }
 *   2. Busque en Google Shopping / comparadores españoles
 *   3. Devuelva array de { supplier, title, price, unit, url }
 *
 * Endpoint sugerido: N8N_PRICE_SEARCH_WEBHOOK_URL
 * No se toca n8n en este PR — solo se deja preparado el conector.
 */
async function searchViaN8nWebhook(req: WebSearchRequest): Promise<WebSearchResult | null> {
  const webhookUrl = process.env.N8N_PRICE_SEARCH_WEBHOOK_URL;
  if (!webhookUrl) return null;

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        materialName: req.materialName,
        category: req.category,
        qualityTier: req.qualityTier,
        location: req.location,
        unit: req.unit,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const items = Array.isArray(data) ? data : data.results || [];
    const results: PriceAlternative[] = [];

    for (const item of items.slice(0, 8)) {
      const price = parsePrice(item.price);
      if (price <= 0 || !item.url) continue;

      results.push({
        supplier: item.supplier || "n8n search",
        title: item.title || req.materialName,
        price,
        unit: item.unit || req.unit,
        qualityTier: req.qualityTier,
        url: item.url,
      });
    }

    if (results.length > 0) {
      return {
        alternatives: results,
        searchEngine: "n8n_webhook",
        queryUsed: req.materialName,
        searchedAt: new Date().toISOString(),
      };
    }
  } catch (err) {
    console.warn("[WebPriceSearch] n8n webhook error:", err);
  }

  return null;
}

// ─── Main Search Orchestrator ───────────────────────────────────────────

/**
 * Search for real web prices for a construction material.
 *
 * Tries sources in priority order. Returns null if no source found —
 * caller must keep "estimated" sourceType.
 *
 * RULE: Only returns results that have a real URL.
 *       Without URL → not "web_search", stays "estimated".
 */
export async function searchWebPrices(
  req: WebSearchRequest
): Promise<WebSearchResult | null> {
  // 1. SerpAPI (most comprehensive)
  const serpResult = await searchViaSerpAPI(req);
  if (serpResult && serpResult.alternatives.length > 0) return serpResult;

  // 2. n8n webhook (user's own pipeline)
  const n8nResult = await searchViaN8nWebhook(req);
  if (n8nResult && n8nResult.alternatives.length > 0) return n8nResult;

  // 3. Direct retailer APIs
  const retailerResult = await searchViaRetailerAPIs(req);
  if (retailerResult && retailerResult.alternatives.length > 0) return retailerResult;

  // No source available — caller keeps "estimated"
  return null;
}

/**
 * Batch search for multiple materials. Runs in parallel with concurrency limit.
 */
export async function searchWebPricesBatch(
  requests: WebSearchRequest[],
  concurrency: number = 3
): Promise<Map<string, WebSearchResult>> {
  const results = new Map<string, WebSearchResult>();

  // Process in chunks to respect rate limits
  for (let i = 0; i < requests.length; i += concurrency) {
    const chunk = requests.slice(i, i + concurrency);
    const promises = chunk.map(async (req) => {
      const result = await searchWebPrices(req);
      if (result) {
        results.set(req.materialName, result);
      }
    });
    await Promise.all(promises);
  }

  return results;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function parsePrice(raw: unknown): number {
  if (typeof raw === "number") return raw > 0 ? raw : 0;
  if (typeof raw !== "string") return 0;

  // Handle Spanish price formats: "12,50 €", "12.50€", "12,50"
  const cleaned = raw
    .replace(/[€$\s]/g, "")
    .replace(/\.(?=\d{3})/g, "")   // Remove thousands dots
    .replace(",", ".");             // Comma → decimal point

  const val = parseFloat(cleaned);
  return isNaN(val) || val <= 0 ? 0 : val;
}
