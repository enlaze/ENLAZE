"use strict";
/**
 * price-resolver.ts
 * Resolves material/partida prices through a priority chain:
 * 1. User's own prices (price_items)
 * 2. Technical price bank (BC3/FIEBDC imports — technical_price_items)
 * 3. ENLAZE base price bank (INTERNAL_PRICE_DB hardcoded)
 * 4. n8n synced prices (sector_data)
 * 5. Authorized suppliers/providers
 * 6. Web search (on-demand, not per-render)
 * 7. Internal estimate with low confidence
 *
 * Pure logic where possible. Supabase calls isolated to resolve functions.
 * Web search only triggered explicitly, never on render.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeUnit = normalizeUnit;
exports.classifyQualityTier = classifyQualityTier;
exports.getQualityMultiplier = getQualityMultiplier;
exports.normalizeMaterialName = normalizeMaterialName;
exports.resolveMaterialPrice = resolveMaterialPrice;
exports.resolvePricesForBudget = resolvePricesForBudget;
exports.buildCacheEntry = buildCacheEntry;
exports.isCacheValid = isCacheValid;
exports.buildCacheRow = buildCacheRow;
exports.resolveMarketPrices = resolveMarketPrices;
// ─── Unit Normalization ─────────────────────────────────────────────────────
const UNIT_ALIASES = {
    "m²": "m2", "metros cuadrados": "m2", "metro cuadrado": "m2",
    "ml": "ml", "metros lineales": "ml", "metro lineal": "ml",
    "m³": "m3", "metros cubicos": "m3",
    "ud": "ud", "uds": "ud", "unidad": "ud", "unidades": "ud",
    "saco": "saco", "sacos": "saco",
    "rollo": "rollo", "rollos": "rollo",
    "cubo": "cubo", "cubos": "cubo", "bidon": "cubo",
    "lote": "lote", "kit": "lote", "conjunto": "lote",
    "pa": "pa", "partida alzada": "pa", "global": "pa",
    "kg": "kg", "kilogramo": "kg",
    "l": "l", "litro": "l", "litros": "l",
    "h": "h", "hora": "h", "horas": "h",
    "jornada": "jornada", "jornadas": "jornada",
    "punto": "punto", "puntos": "punto",
};
function normalizeUnit(unit) {
    const lower = unit.toLowerCase().trim();
    return UNIT_ALIASES[lower] || lower;
}
const TIER_KEYWORDS = {
    pavimentos: {
        basica: ["economico", "basico", "ac3", "ac4", "vinilico", "pvc suelo"],
        alta: ["premium", "rectificado", "gran formato", "madera maciza", "marmol", "porcelanico premium", "120x120", "160"],
    },
    sanitarios: {
        basica: ["estandar", "basico", "economico", "compacto"],
        alta: ["premium", "suspendido", "rimless", "roca inspira", "duravit", "geberit", "hansgrohe", "grohe atrio", "empotrada"],
    },
    revestimientos: {
        basica: ["economico", "basico", "20x20", "blanco liso"],
        alta: ["premium", "rectificado", "gran formato", "porcelanico slim", "60x120", "mosaico", "piedra natural"],
    },
    carpinteria_exterior: {
        basica: ["pvc basico", "aluminio sin rpt", "vidrio simple"],
        alta: ["premium", "rpt premium", "bajo emisivo", "control solar", "triple acristalamiento", "madera-aluminio", "schuco", "cortizo premium"],
    },
    carpinteria_interior: {
        basica: ["hueca", "economica", "melamina"],
        alta: ["maciza", "lacada premium", "roble", "cristal", "corredera empotrada", "garofoli", "artevi premium"],
    },
    pintura: {
        basica: ["economica", "plastica basica", "vinilica"],
        alta: ["premium", "lavable extra", "antimanchas", "ecologica premium", "monocapa alta gama"],
    },
    cocina: {
        basica: ["melamina", "basica", "economica", "encimera laminada"],
        alta: ["lacada", "premium", "silestone", "dekton", "corian", "neolith", "madera maciza", "electrodomesticos premium", "neff", "siemens iq700"],
    },
    climatizacion: {
        basica: ["basico", "on-off", "clase b", "clase c"],
        alta: ["premium", "inverter premium", "por conductos", "daikin", "mitsubishi", "r32", "wifi", "clase a+++"],
    },
};
/**
 * Classify a material/product into a quality tier based on its name/description.
 * If no clear signal, returns the requested tier.
 */
function classifyQualityTier(name, chapter, requestedTier) {
    const lower = name.toLowerCase();
    const keywords = TIER_KEYWORDS[chapter];
    if (!keywords)
        return requestedTier;
    for (const kw of keywords.alta) {
        if (lower.includes(kw))
            return "alta";
    }
    for (const kw of keywords.basica) {
        if (lower.includes(kw))
            return "basica";
    }
    return requestedTier;
}
// ─── Quality Multipliers for base prices ────────────────────────────────────
const QUALITY_MULTIPLIERS = {
    pavimentos: { basica: 0.55, media: 1.0, alta: 1.8 },
    revestimientos: { basica: 0.55, media: 1.0, alta: 1.7 },
    sanitarios: { basica: 0.60, media: 1.0, alta: 2.0 },
    carpinteria_interior: { basica: 0.55, media: 1.0, alta: 1.9 },
    carpinteria_exterior: { basica: 0.60, media: 1.0, alta: 1.7 },
    cocina: { basica: 0.55, media: 1.0, alta: 2.2 },
    pintura: { basica: 0.70, media: 1.0, alta: 1.5 },
    climatizacion: { basica: 0.65, media: 1.0, alta: 1.6 },
    electricidad: { basica: 0.75, media: 1.0, alta: 1.4 },
    fontaneria: { basica: 0.75, media: 1.0, alta: 1.3 },
    default: { basica: 0.75, media: 1.0, alta: 1.35 },
};
function getQualityMultiplier(chapter, tier) {
    const map = QUALITY_MULTIPLIERS[chapter] || QUALITY_MULTIPLIERS.default;
    return map[tier];
}
/**
 * Internal reference prices for common construction materials in Spain (2024-2026).
 * These are used as last-resort fallback when no other source is available.
 * Prices represent cost to contractor (before margin).
 */
const INTERNAL_PRICE_DB = [
    // Albanileria
    { name: "Mortero cemento M-7.5 saco 25kg", chapter: "albanileria", unit: "saco", price_basica: 2.80, price_media: 3.50, price_alta: 4.50, supplier_ref: "Referencia mercado" },
    { name: "Placa yeso laminado 13mm", chapter: "albanileria", unit: "ud", price_basica: 4.20, price_media: 5.80, price_alta: 8.50, supplier_ref: "Referencia mercado" },
    { name: "Perfil metalico montante 48mm", chapter: "albanileria", unit: "ud", price_basica: 2.40, price_media: 3.20, price_alta: 4.80, supplier_ref: "Referencia mercado" },
    // Fontaneria
    { name: "Tuberia multicapa 16mm rollo 50m", chapter: "fontaneria", unit: "rollo", price_basica: 32.0, price_media: 42.0, price_alta: 58.0, supplier_ref: "Saltoki" },
    { name: "Tuberia PVC evacuacion 110mm 3m", chapter: "fontaneria", unit: "ud", price_basica: 6.50, price_media: 8.50, price_alta: 12.0, supplier_ref: "Saltoki" },
    // Electricidad
    { name: "Cable H07V-K 2.5mm2 rollo 100m", chapter: "electricidad", unit: "rollo", price_basica: 24.0, price_media: 32.0, price_alta: 45.0, supplier_ref: "Leroy Merlin" },
    { name: "Cuadro electrico + protecciones", chapter: "electricidad", unit: "ud", price_basica: 160.0, price_media: 220.0, price_alta: 350.0, supplier_ref: "Saltoki" },
    { name: "Mecanismo electrico (enchufe/interruptor)", chapter: "electricidad", unit: "ud", price_basica: 4.50, price_media: 8.50, price_alta: 18.0, supplier_ref: "Leroy Merlin" },
    // Revestimientos / Pavimentos
    { name: "Azulejo porcelanico pared", chapter: "revestimientos", unit: "m2", price_basica: 10.0, price_media: 18.50, price_alta: 35.0, supplier_ref: "Leroy Merlin" },
    { name: "Cemento cola porcelanico saco 25kg", chapter: "revestimientos", unit: "saco", price_basica: 8.0, price_media: 12.0, price_alta: 18.0, supplier_ref: "Obramat" },
    { name: "Pavimento ceramico/laminado", chapter: "pavimentos", unit: "m2", price_basica: 12.0, price_media: 22.0, price_alta: 45.0, supplier_ref: "Leroy Merlin" },
    { name: "Rodapie", chapter: "rodapie", unit: "ml", price_basica: 2.50, price_media: 4.50, price_alta: 9.0, supplier_ref: "Leroy Merlin" },
    // Pintura
    { name: "Pintura plastica blanca mate cubo 15L", chapter: "pintura", unit: "cubo", price_basica: 22.0, price_media: 35.0, price_alta: 55.0, supplier_ref: "Leroy Merlin" },
    { name: "Imprimacion fijadora cubo 15L", chapter: "pintura", unit: "cubo", price_basica: 18.0, price_media: 28.0, price_alta: 42.0, supplier_ref: "Leroy Merlin" },
    // Sanitarios
    { name: "Inodoro compacto", chapter: "sanitarios", unit: "ud", price_basica: 85.0, price_media: 155.0, price_alta: 350.0, supplier_ref: "Leroy Merlin" },
    { name: "Lavabo + monomando", chapter: "sanitarios", unit: "ud", price_basica: 65.0, price_media: 130.0, price_alta: 320.0, supplier_ref: "Leroy Merlin" },
    { name: "Plato ducha resina", chapter: "sanitarios", unit: "ud", price_basica: 110.0, price_media: 195.0, price_alta: 380.0, supplier_ref: "Obramat" },
    { name: "Mampara ducha", chapter: "sanitarios", unit: "ud", price_basica: 120.0, price_media: 220.0, price_alta: 450.0, supplier_ref: "Leroy Merlin" },
    { name: "Griferia monomando", chapter: "sanitarios", unit: "ud", price_basica: 35.0, price_media: 85.0, price_alta: 200.0, supplier_ref: "Leroy Merlin" },
    // Carpinteria
    { name: "Puerta interior lacada", chapter: "carpinteria_interior", unit: "ud", price_basica: 85.0, price_media: 155.0, price_alta: 320.0, supplier_ref: "Leroy Merlin" },
    { name: "Ventana aluminio RPT", chapter: "carpinteria_exterior", unit: "ud", price_basica: 350.0, price_media: 650.0, price_alta: 1100.0, supplier_ref: "Referencia mercado" },
    // Impermeabilizacion
    { name: "Lamina impermeabilizante rollo 20m2", chapter: "impermeabilizacion", unit: "rollo", price_basica: 28.0, price_media: 42.0, price_alta: 65.0, supplier_ref: "Obramat" },
    // Residuos
    { name: "Contenedor escombros 6m3", chapter: "residuos", unit: "ud", price_basica: 220.0, price_media: 290.0, price_alta: 350.0, supplier_ref: "Referencia mercado" },
    // Cocina
    { name: "Mobiliario cocina completo", chapter: "cocina", unit: "pa", price_basica: 2800.0, price_media: 5500.0, price_alta: 12000.0, supplier_ref: "Referencia mercado" },
    { name: "Encimera cocina", chapter: "cocina", unit: "pa", price_basica: 400.0, price_media: 1200.0, price_alta: 3000.0, supplier_ref: "Referencia mercado" },
    // Climatizacion
    { name: "Split aire acondicionado", chapter: "climatizacion", unit: "ud", price_basica: 650.0, price_media: 1200.0, price_alta: 2000.0, supplier_ref: "Referencia mercado" },
    // Auxiliares
    { name: "Silicona neutra sanitaria cartucho", chapter: "sanitarios", unit: "ud", price_basica: 3.50, price_media: 5.50, price_alta: 9.0, supplier_ref: "Leroy Merlin" },
    { name: "Falso techo placa yeso laminado", chapter: "falsos_techos", unit: "m2", price_basica: 18.0, price_media: 28.0, price_alta: 42.0, supplier_ref: "Referencia mercado" },
];
// ─── Name Normalization ─────────────────────────────────────────────────────
/**
 * Normalize material name for matching against price DB.
 * Strips accents, extra spaces, common suffixes.
 */
function normalizeMaterialName(name) {
    return name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .replace(/\(.*?\)/g, "")
        .trim();
}
function resolveMaterialPrice(request, userPrices, enlazePrices, n8nPrices, webResults, technicalPrices) {
    const normalized = normalizeMaterialName(request.materialName);
    const normalizedUnit = normalizeUnit(request.unit);
    const now = new Date().toISOString();
    const alternatives = [];
    // Helper: fuzzy match name
    const fuzzyMatch = (a, b) => {
        const na = normalizeMaterialName(a);
        const nb = normalizeMaterialName(b);
        // Exact containment
        if (na.includes(nb) || nb.includes(na))
            return true;
        // Word overlap (min 3 chars per word)
        const wordsA = na.split(" ").filter(w => w.length > 2);
        const wordsB = nb.split(" ").filter(w => w.length > 2);
        if (wordsA.length === 0 || wordsB.length === 0)
            return false;
        const overlap = wordsA.filter(w => wordsB.some(wb => wb.includes(w) || w.includes(wb)));
        // For short names (1-2 significant words), require 1 match; for longer, require 2
        const threshold = Math.min(wordsA.length, wordsB.length) <= 2 ? 1 : 2;
        return overlap.length >= threshold;
    };
    // Level 1: User's own prices
    if (userPrices && userPrices.length > 0) {
        const match = userPrices.find(p => fuzzyMatch(p.name, request.materialName));
        if (match) {
            alternatives.push({
                supplier: match.supplier_name || "Catalogo propio",
                title: match.name,
                price: match.unit_price,
                unit: match.unit,
                qualityTier: request.qualityTier,
                url: undefined,
            });
            return buildResult(request, normalized, match.unit_price, match.supplier_name || "Catalogo propio", "", "user_catalog", 0.95, now, alternatives);
        }
    }
    // Level 2: Technical price bank (BC3/FIEBDC imports)
    if (technicalPrices && technicalPrices.length > 0) {
        const techMatch = technicalPrices.find(p => fuzzyMatch(p.name, request.materialName));
        if (techMatch) {
            const confidence = techMatch.confidence_score || 0.80;
            alternatives.push({
                supplier: `Banco tecnico (${techMatch.source})`,
                title: techMatch.name,
                price: techMatch.unit_price,
                unit: techMatch.unit,
                qualityTier: request.qualityTier,
            });
            return buildResult(request, normalized, techMatch.unit_price, `Banco tecnico (${techMatch.source})`, "", "technical_bank", confidence, now, alternatives);
        }
    }
    // Level 3: ENLAZE base bank
    if (enlazePrices && enlazePrices.length > 0) {
        const match = enlazePrices.find(p => fuzzyMatch(p.name, request.materialName));
        if (match) {
            alternatives.push({
                supplier: match.supplier_name || "Banco ENLAZE",
                title: match.name,
                price: match.unit_price,
                unit: match.unit,
                qualityTier: request.qualityTier,
            });
            return buildResult(request, normalized, match.unit_price, "Banco ENLAZE", "", "enlaze_base", 0.80, now, alternatives);
        }
    }
    // Level 4: n8n synced prices
    if (n8nPrices && n8nPrices.length > 0) {
        const match = n8nPrices.find(p => fuzzyMatch(p.title, request.materialName));
        if (match) {
            alternatives.push({
                supplier: match.source || "n8n market",
                title: match.title,
                price: match.value,
                unit: match.unit,
                qualityTier: request.qualityTier,
            });
            return buildResult(request, normalized, match.value, match.source || "n8n market", "", "n8n_market", 0.75, now, alternatives);
        }
    }
    // Level 5: Authorized suppliers (from n8n with specific supplier tags)
    // Covered by level 3 for now; when we add specific supplier APIs, they go here.
    // Level 6: Web search results (passed in, not fetched here)
    if (webResults && webResults.length > 0) {
        // Add all as alternatives
        webResults.forEach(wr => alternatives.push(wr));
        // Select by quality tier
        const sorted = [...webResults].sort((a, b) => a.price - b.price);
        let selected;
        if (request.qualityTier === "basica") {
            // Pick 25th percentile (not absolute cheapest — avoid suspicious prices)
            const idx = Math.max(0, Math.floor(sorted.length * 0.25));
            selected = sorted[idx];
        }
        else if (request.qualityTier === "alta") {
            // Pick 75th percentile
            const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75));
            selected = sorted[idx];
        }
        else {
            // Median
            const idx = Math.floor(sorted.length / 2);
            selected = sorted[idx];
        }
        const confidence = webResults.length >= 3 ? 0.70 : webResults.length >= 2 ? 0.55 : 0.45;
        return buildResult(request, normalized, selected.price, selected.supplier, selected.url || "", "web_search", confidence, now, alternatives);
    }
    // Level 7: Internal estimate (fallback)
    const dbMatch = INTERNAL_PRICE_DB.find(p => fuzzyMatch(p.name, request.materialName));
    if (dbMatch) {
        const price = request.qualityTier === "alta" ? dbMatch.price_alta
            : request.qualityTier === "basica" ? dbMatch.price_basica
                : dbMatch.price_media;
        alternatives.push({
            supplier: dbMatch.supplier_ref,
            title: dbMatch.name,
            price: dbMatch.price_basica,
            unit: dbMatch.unit,
            qualityTier: "basica",
        });
        alternatives.push({
            supplier: dbMatch.supplier_ref,
            title: dbMatch.name,
            price: dbMatch.price_media,
            unit: dbMatch.unit,
            qualityTier: "media",
        });
        alternatives.push({
            supplier: dbMatch.supplier_ref,
            title: dbMatch.name,
            price: dbMatch.price_alta,
            unit: dbMatch.unit,
            qualityTier: "alta",
        });
        return buildResult(request, normalized, price, dbMatch.supplier_ref, "", "estimated", 0.40, now, alternatives);
    }
    // Absolute fallback: return zero with very low confidence
    return buildResult(request, normalized, 0, "Sin fuente", "", "estimated", 0.10, now, []);
}
function buildResult(req, normalizedName, selectedPrice, supplier, sourceUrl, sourceType, confidence, capturedAt, alternatives) {
    const prices = alternatives.map(a => a.price).filter(p => p > 0);
    const sorted = [...prices].sort((a, b) => a - b);
    return {
        materialName: req.materialName,
        normalizedName,
        category: req.category,
        unit: normalizeUnit(req.unit),
        quantity: req.quantity,
        qualityTier: req.qualityTier,
        selectedPrice,
        priceMin: sorted.length > 0 ? sorted[0] : selectedPrice,
        priceMedian: sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : selectedPrice,
        priceMax: sorted.length > 0 ? sorted[sorted.length - 1] : selectedPrice,
        selectedSupplier: supplier,
        sourceUrl,
        sourceType,
        confidenceScore: confidence,
        capturedAt,
        alternatives,
    };
}
/**
 * Resolve prices for all materials in a budget.
 * Returns resolved prices and a list of materials that need web search.
 */
function resolvePricesForBudget(input) {
    const resolved = [];
    const needsWebSearch = [];
    for (const mat of input.materials) {
        const result = resolveMaterialPrice(mat, input.userPrices, input.enlazePrices, input.n8nPrices, undefined, // webResults (resolved externally)
        input.technicalPrices);
        if (result.sourceType === "estimated" && result.confidenceScore < 0.5) {
            needsWebSearch.push(mat);
        }
        resolved.push(result);
    }
    return { resolved, needsWebSearch };
}
// ─── Cache Helpers ──────────────────────────────────────────────────────────
const CACHE_TTL_HOURS = 48;
function buildCacheEntry(resolved, location) {
    const now = new Date();
    const expires = new Date(now.getTime() + CACHE_TTL_HOURS * 60 * 60 * 1000);
    return {
        materialName: resolved.materialName,
        normalizedName: resolved.normalizedName,
        unit: resolved.unit,
        qualityTier: resolved.qualityTier,
        location,
        resolvedPrice: resolved,
        cachedAt: now.toISOString(),
        expiresAt: expires.toISOString(),
    };
}
function isCacheValid(entry) {
    return new Date(entry.expiresAt) > new Date();
}
// ─── Supabase integration helpers (to be called from API routes) ────────────
/**
 * Build a row for upserting into the `resolved_prices` Supabase table.
 * Table created via migration: 20260521_resolved_prices.sql
 * The actual Supabase call should be done in the API route, not here.
 */
function buildCacheRow(resolved, userId, location) {
    const now = new Date();
    return {
        user_id: userId,
        material_name: resolved.materialName,
        normalized_name: resolved.normalizedName,
        unit: resolved.unit,
        quality_tier: resolved.qualityTier,
        location,
        selected_price: resolved.selectedPrice,
        price_min: resolved.priceMin,
        price_median: resolved.priceMedian,
        price_max: resolved.priceMax,
        selected_supplier: resolved.selectedSupplier,
        source_url: resolved.sourceUrl,
        source_type: resolved.sourceType,
        confidence_score: resolved.confidenceScore,
        alternatives: resolved.alternatives,
        captured_at: resolved.capturedAt,
        expires_at: new Date(now.getTime() + CACHE_TTL_HOURS * 60 * 60 * 1000).toISOString(),
    };
}
/**
 * Call the server-side /api/prices/resolve endpoint.
 *
 * USE THIS from client components (BudgetGenerateProvider, ProvidersStep).
 * It triggers the full priority chain including web search + cache.
 *
 * WHEN TO CALL:
 *   - During budget generation (after AI analysis produces materials list)
 *   - When user clicks "Actualizar precios de mercado"
 *   - Never on render, never on mount, never in useEffect without user action
 */
async function resolveMarketPrices(input) {
    try {
        const response = await fetch("/api/prices/resolve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                materials: input.materials,
                location: input.location,
                forceRefresh: input.forceRefresh || false,
            }),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: "Error de red" }));
            return {
                ok: false,
                resolved: [],
                summary: {
                    total: 0, fromUserCatalog: 0, fromEnlaze: 0, fromN8n: 0,
                    fromWebSearch: 0, fromCache: 0, estimated: 0,
                    webSearchesPerformed: 0, webSearchesSuccessful: 0,
                },
                cachedUntil: "",
                error: err.error || `HTTP ${response.status}`,
            };
        }
        return await response.json();
    }
    catch (err) {
        return {
            ok: false,
            resolved: [],
            summary: {
                total: 0, fromUserCatalog: 0, fromEnlaze: 0, fromN8n: 0,
                fromWebSearch: 0, fromCache: 0, estimated: 0,
                webSearchesPerformed: 0, webSearchesSuccessful: 0,
            },
            cachedUntil: "",
            error: err.message || "Error de conexion",
        };
    }
}
