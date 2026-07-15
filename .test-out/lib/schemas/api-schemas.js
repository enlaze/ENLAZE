"use strict";
/**
 * api-schemas.ts
 *
 * Zod schemas for API route input validation.
 *
 * These schemas validate request bodies at runtime,
 * providing clear error messages instead of silent failures
 * from invalid data propagating through the pipeline.
 *
 * Convention: schema names match the route they validate.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.priceObservationCreateSchema = exports.conceptListSchema = exports.conceptUpdateSchema = exports.conceptCreateSchema = exports.productListSchema = exports.productUpdateSchema = exports.productCreateSchema = exports.providerListSchema = exports.providerUpdateSchema = exports.providerCreateSchema = exports.importProcessOptionsSchema = exports.importAnalyzeSchema = exports.snapshotCompareSchema = exports.budgetPdfSchema = exports.budgetEditSchema = void 0;
exports.parseBody = parseBody;
const zod_1 = require("zod");
// ─── Shared enums ───────────────────────────────────────────────────────────
const chapterCodeSchema = zod_1.z.enum([
    "protecciones", "demoliciones", "albanileria", "fontaneria",
    "electricidad", "impermeabilizacion", "revestimientos", "pavimentos",
    "rodapie", "pintura", "carpinteria_interior", "carpinteria_exterior",
    "sanitarios", "cocina", "climatizacion", "falsos_techos",
    "residuos", "limpieza", "seguridad", "otros",
]);
const qualityTierSchema = zod_1.z.enum(["basica", "media", "alta"]);
const projectTypeSchema = zod_1.z.enum([
    "reforma_integral", "reforma_parcial", "reforma_bano", "reforma_cocina",
    "obra_nueva", "rehabilitacion", "mantenimiento", "instalacion", "otro",
]);
const priceSourceSchema = zod_1.z.enum([
    "user_catalog", "technical_bank", "enlaze_base",
    "n8n_market", "web_search", "estimated",
]);
const prioritySchema = zod_1.z.enum(["obligatoria", "recomendada", "opcional"]);
const tradeCodeSchema = zod_1.z.enum([
    "oficial_albanil", "peon", "peon_especialista", "fontanero",
    "electricista", "pintor", "alicatador", "carpintero",
    "cerrajero", "cristalero", "climatizador", "encargado", "subcontrata",
]);
// ─── Shared sub-schemas ─────────────────────────────────────────────────────
const clientDataSchema = zod_1.z.object({
    name: zod_1.z.string(),
    nif: zod_1.z.string(),
    address: zod_1.z.string(),
    email: zod_1.z.string(),
    phone: zod_1.z.string(),
}).nullable();
const scopeSchema = zod_1.z.object({
    project_type: projectTypeSchema,
    work_category: zod_1.z.enum(["residencial", "comercial", "industrial", "comunitario"]),
    location: zod_1.z.string().min(1),
    surface_m2: zod_1.z.number().positive(),
    num_bathrooms: zod_1.z.number().int().min(0),
    num_rooms: zod_1.z.number().int().min(0),
    includes_kitchen: zod_1.z.boolean(),
    includes_windows: zod_1.z.boolean(),
    includes_hvac: zod_1.z.boolean(),
    current_state: zod_1.z.enum(["buen_estado", "necesita_reforma", "muy_deteriorado", "obra_nueva"]),
    quality: qualityTierSchema,
    rooms: zod_1.z.array(zod_1.z.string()),
    works_requested: zod_1.z.array(zod_1.z.string()),
    start_date: zod_1.z.string().nullable(),
    deadline_date: zod_1.z.string().nullable(),
    description: zod_1.z.string(),
    client: clientDataSchema,
});
const preferencesSchema = zod_1.z.object({
    quality: qualityTierSchema,
    margin_percent: zod_1.z.number().min(0).max(100),
    indirect_costs_percent: zod_1.z.number().min(0).max(100),
    tax_percent: zod_1.z.number().min(0).max(100),
    workers_count: zod_1.z.number().int().positive().nullable(),
    include_alternatives: zod_1.z.boolean(),
});
const materialSchema = zod_1.z.object({
    name: zod_1.z.string(),
    quantity: zod_1.z.number(),
    unit: zod_1.z.string(),
    unit_price: zod_1.z.number(),
    subtotal: zod_1.z.number(),
    supplier: zod_1.z.string(),
    source: priceSourceSchema,
    confidence: zod_1.z.number().min(0).max(1),
});
const budgetItemSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    chapter: chapterCodeSchema,
    code: zod_1.z.string(),
    name: zod_1.z.string().min(1),
    description: zod_1.z.string(),
    unit: zod_1.z.string().min(1),
    quantity: zod_1.z.number().min(0),
    quantity_calculation: zod_1.z.string(),
    trade: tradeCodeSchema,
    estimated_hours: zod_1.z.number().min(0),
    priority: prioritySchema,
    dependencies: zod_1.z.array(chapterCodeSchema),
    material_cost_per_unit: zod_1.z.number().min(0),
    labor_cost_per_unit: zod_1.z.number().min(0),
    labor_hours_per_unit: zod_1.z.number().min(0),
    machinery_cost_per_unit: zod_1.z.number().min(0),
    unit_cost: zod_1.z.number().min(0),
    unit_price_sale: zod_1.z.number().min(0),
    subtotal_cost: zod_1.z.number().min(0),
    subtotal_sale: zod_1.z.number().min(0),
    margin_percent: zod_1.z.number(),
    confidence_score: zod_1.z.number().min(0).max(1),
    price_source: priceSourceSchema,
    price_source_detail: zod_1.z.string(),
    supplier: zod_1.z.string().nullable(),
    materials: zod_1.z.array(materialSchema),
});
// ─── Route-specific schemas ─────────────────────────────────────────────────
/** POST /api/budgets/edit */
exports.budgetEditSchema = zod_1.z.object({
    budget_id: zod_1.z.string().uuid(),
    action: zod_1.z.enum(["edit", "add", "remove"]),
    item_id: zod_1.z.string().optional(),
    edits: zod_1.z.object({
        name: zod_1.z.string().optional(),
        description: zod_1.z.string().optional(),
        unit: zod_1.z.string().optional(),
        quantity: zod_1.z.number().min(0).optional(),
        material_cost_per_unit: zod_1.z.number().min(0).optional(),
        labor_cost_per_unit: zod_1.z.number().min(0).optional(),
        machinery_cost_per_unit: zod_1.z.number().min(0).optional(),
        unit_cost: zod_1.z.number().min(0).optional(),
        margin_percent: zod_1.z.number().optional(),
        priority: prioritySchema.optional(),
        supplier: zod_1.z.string().nullable().optional(),
    }).optional(),
    items: zod_1.z.array(budgetItemSchema),
    scope: scopeSchema,
    preferences: preferencesSchema,
    new_item: budgetItemSchema.optional(),
});
/** POST /api/budgets/pdf */
exports.budgetPdfSchema = zod_1.z.object({
    budget_id: zod_1.z.string().uuid(),
    type: zod_1.z.enum(["client", "internal"]).default("client"),
    version: zod_1.z.number().int().positive().optional(),
});
/** POST /api/budgets/snapshots (compare) */
exports.snapshotCompareSchema = zod_1.z.object({
    budget_id: zod_1.z.string().uuid(),
    version_a: zod_1.z.number().int().positive(),
    version_b: zod_1.z.number().int().positive(),
});
/** POST /api/imports/analyze */
exports.importAnalyzeSchema = zod_1.z.object({
    source: zod_1.z.string().min(1).optional(),
    region: zod_1.z.string().optional(),
    edition: zod_1.z.string().optional(),
});
/** POST /api/imports/process */
exports.importProcessOptionsSchema = zod_1.z.object({
    source: zod_1.z.string().min(1).optional(),
    region: zod_1.z.string().optional(),
    edition: zod_1.z.string().optional(),
    merge_strategy: zod_1.z.enum(["overwrite", "keep_existing", "keep_newer", "merge_components"]).optional(),
    dry_run: zod_1.z.boolean().optional(),
    provider_name: zod_1.z.string().optional(),
    tariff_name: zod_1.z.string().optional(),
    duplicate_strategy: zod_1.z.enum(["skip", "overwrite", "update_price"]).optional(),
});
// ─── Price Bank V2: Provider schemas ────────────────────────────────────────
const spanishProvinces = [
    "A Coruna", "Alava", "Albacete", "Alicante", "Almeria", "Asturias",
    "Avila", "Badajoz", "Barcelona", "Burgos", "Caceres", "Cadiz",
    "Cantabria", "Castellon", "Ciudad Real", "Cordoba", "Cuenca",
    "Girona", "Granada", "Guadalajara", "Guipuzcoa", "Huelva", "Huesca",
    "Illes Balears", "Jaen", "La Rioja", "Las Palmas", "Leon", "Lleida",
    "Lugo", "Madrid", "Malaga", "Murcia", "Navarra", "Ourense",
    "Palencia", "Pontevedra", "Salamanca", "Santa Cruz de Tenerife",
    "Segovia", "Sevilla", "Soria", "Tarragona", "Teruel", "Toledo",
    "Valencia", "Valladolid", "Vizcaya", "Zamora", "Zaragoza", "Ceuta", "Melilla",
];
/** POST /api/providers — create provider */
exports.providerCreateSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(200),
    trade_name: zod_1.z.string().max(200).nullable().optional(),
    legal_name: zod_1.z.string().max(200).nullable().optional(),
    nif: zod_1.z.string().max(20).nullable().optional(),
    website: zod_1.z.string().url().nullable().optional(),
    country: zod_1.z.string().default("ES"),
    autonomous_community: zod_1.z.string().nullable().optional(),
    province: zod_1.z.string().nullable().optional(),
    supply_zones: zod_1.z.array(zod_1.z.string()).default([]),
    shipping_cost_flat: zod_1.z.number().min(0).default(0),
    shipping_cost_per_kg: zod_1.z.number().min(0).default(0),
    free_shipping_min: zod_1.z.number().min(0).nullable().optional(),
    minimum_order: zod_1.z.number().min(0).default(0),
    delivery_days_min: zod_1.z.number().int().min(0).default(1),
    delivery_days_max: zod_1.z.number().int().min(0).default(5),
    payment_terms_days: zod_1.z.number().int().min(0).default(30),
    is_preferred: zod_1.z.boolean().default(false),
});
/** PATCH /api/providers/[id] — update provider */
exports.providerUpdateSchema = exports.providerCreateSchema.partial();
/** GET /api/providers — list filters */
exports.providerListSchema = zod_1.z.object({
    search: zod_1.z.string().optional(),
    province: zod_1.z.string().optional(),
    is_preferred: zod_1.z.coerce.boolean().optional(),
    is_active: zod_1.z.coerce.boolean().optional(),
    page: zod_1.z.coerce.number().int().min(1).default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(25),
});
// ─── Price Bank V2: Product schemas ─────────────────────────────────────────
/** POST /api/products — create product */
exports.productCreateSchema = zod_1.z.object({
    provider_id: zod_1.z.string().uuid(),
    concept_id: zod_1.z.string().uuid().nullable().optional(),
    concept_match_type: zod_1.z.enum(["exact", "high_confidence", "review_recommended", "none", "conflict"]).default("none"),
    commercial_name: zod_1.z.string().min(1).max(500),
    description: zod_1.z.string().default(""),
    brand: zod_1.z.string().max(200).nullable().optional(),
    model: zod_1.z.string().max(200).nullable().optional(),
    sku: zod_1.z.string().max(100).nullable().optional(),
    ean: zod_1.z.string().max(20).nullable().optional(),
    sale_unit: zod_1.z.string().min(1).default("ud"),
    units_per_package: zod_1.z.number().min(1).default(1),
    unit_price: zod_1.z.number().min(0),
    vat_rate: zod_1.z.number().min(0).max(100).default(21),
    url: zod_1.z.string().url().nullable().optional(),
    region: zod_1.z.string().default("ES"),
    is_available: zod_1.z.boolean().default(true),
});
/** PATCH /api/products/[id] — update product */
exports.productUpdateSchema = exports.productCreateSchema.partial();
/** GET /api/products — list filters */
exports.productListSchema = zod_1.z.object({
    search: zod_1.z.string().optional(),
    provider_id: zod_1.z.string().uuid().optional(),
    concept_id: zod_1.z.string().uuid().optional(),
    is_available: zod_1.z.coerce.boolean().optional(),
    min_price: zod_1.z.coerce.number().min(0).optional(),
    max_price: zod_1.z.coerce.number().min(0).optional(),
    page: zod_1.z.coerce.number().int().min(1).default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(25),
});
// ─── Price Bank V2: Normalized Concept schemas ──────────────────────────────
const conceptReviewStatusSchema = zod_1.z.enum(["draft", "reviewed", "approved", "deprecated"]);
/** POST /api/concepts — create concept */
exports.conceptCreateSchema = zod_1.z.object({
    canonical_name: zod_1.z.string().min(1).max(300),
    description: zod_1.z.string().default(""),
    category: zod_1.z.string().min(1),
    subcategory: zod_1.z.string().default(""),
    base_unit: zod_1.z.string().min(1).default("ud"),
    synonyms: zod_1.z.array(zod_1.z.string()).default([]),
    specifications: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).default({}),
    review_status: conceptReviewStatusSchema.default("draft"),
});
/** PATCH /api/concepts/[id] — update concept */
exports.conceptUpdateSchema = exports.conceptCreateSchema.partial();
/** GET /api/concepts — list filters */
exports.conceptListSchema = zod_1.z.object({
    search: zod_1.z.string().optional(),
    category: zod_1.z.string().optional(),
    review_status: conceptReviewStatusSchema.optional(),
    page: zod_1.z.coerce.number().int().min(1).default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(25),
});
// ─── Price Bank V2: Price Observation schema ────────────────────────────────
/** POST /api/prices/observations — record a price observation */
exports.priceObservationCreateSchema = zod_1.z.object({
    product_id: zod_1.z.string().uuid(),
    provider_id: zod_1.z.string().uuid(),
    source_id: zod_1.z.string().uuid().nullable().optional(),
    price_excl_vat: zod_1.z.number().min(0),
    vat_pct: zod_1.z.number().min(0).max(100).default(21),
    price_incl_vat: zod_1.z.number().min(0).nullable().optional(),
    shipping_cost: zod_1.z.number().min(0).default(0),
    other_costs: zod_1.z.number().min(0).default(0),
    discount_pct: zod_1.z.number().min(0).max(100).default(0),
    discount_amount: zod_1.z.number().min(0).default(0),
    effective_price: zod_1.z.number().min(0).nullable().optional(),
    is_available: zod_1.z.boolean().default(true),
    region: zod_1.z.string().default("ES"),
    confidence_score: zod_1.z.number().min(0).max(1).default(0.5),
    raw_data: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).nullable().optional(),
});
// ─── Helpers ────────────────────────────────────────────────────────────────
/**
 * Parse and validate a request body with a Zod schema.
 * Returns { ok, data, error } to avoid throwing.
 */
function parseBody(schema, body) {
    const result = schema.safeParse(body);
    if (result.success) {
        return { ok: true, data: result.data };
    }
    const messages = result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .slice(0, 5)
        .join("; ");
    return { ok: false, error: `Datos invalidos: ${messages}` };
}
