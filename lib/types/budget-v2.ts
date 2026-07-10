/**
 * budget-v2.ts
 *
 * Tipos e interfaces para el generador de presupuestos v2.
 * Sistema de 6 fases: Analisis -> Generacion -> Precios -> Economia -> Planificacion -> Validacion
 *
 * Convenciones:
 *   - Todos los importes en EUR, 2 decimales
 *   - Porcentajes como numeros enteros (25 = 25%)
 *   - Fechas como ISO 8601 strings
 *   - Confianza como 0.00-1.00
 */

// ─── Enums y tipos base ─────────────────────────────────────────────────────

export type QualityTier = "basica" | "media" | "alta";

export type ProjectType =
  | "reforma_integral"
  | "reforma_parcial"
  | "reforma_bano"
  | "reforma_cocina"
  | "obra_nueva"
  | "rehabilitacion"
  | "mantenimiento"
  | "instalacion"
  | "otro";

export type WorkCategory = "residencial" | "comercial" | "industrial" | "comunitario";

export type ComplexityLevel = "baja" | "media" | "alta";

export type RiskLevel = "bajo" | "medio" | "alto";

export type ItemPriority = "obligatoria" | "recomendada" | "opcional";

export type PriceSourceV2 =
  | "user_catalog"
  | "technical_bank"
  | "enlaze_base"
  | "n8n_market"
  | "web_search"
  | "estimated";

export type SnapshotType = "generated" | "edited" | "repriced";

export type ValidationStatus = "pass" | "warning" | "fail";

export type ValidationCategory =
  | "completeness"
  | "quantities"
  | "pricing"
  | "profitability"
  | "duration"
  | "consistency";

export type WarningSeverity = "low" | "medium" | "high";

/** Capitulos estandar de construccion */
export type ChapterCode =
  | "protecciones"
  | "demoliciones"
  | "albanileria"
  | "fontaneria"
  | "electricidad"
  | "impermeabilizacion"
  | "revestimientos"
  | "pavimentos"
  | "rodapie"
  | "pintura"
  | "carpinteria_interior"
  | "carpinteria_exterior"
  | "sanitarios"
  | "cocina"
  | "climatizacion"
  | "falsos_techos"
  | "residuos"
  | "limpieza"
  | "seguridad"
  | "otros";

/** Oficios de construccion */
export type TradeCode =
  | "oficial_albanil"
  | "peon"
  | "peon_especialista"
  | "fontanero"
  | "electricista"
  | "pintor"
  | "alicatador"
  | "carpintero"
  | "cerrajero"
  | "cristalero"
  | "climatizador"
  | "encargado"
  | "subcontrata";

// ─── Input del usuario (scope) ──────────────────────────────────────────────

/** Datos estructurados del formulario del wizard (PRIORIDAD sobre descripcion) */
export interface BudgetScopeV2 {
  /** Tipo general de trabajo */
  project_type: ProjectType;
  /** Categoria del inmueble */
  work_category: WorkCategory;
  /** Ubicacion de la obra (ciudad o provincia) */
  location: string;
  /** Superficie total en metros cuadrados */
  surface_m2: number;
  /** Numero de banos a intervenir */
  num_bathrooms: number;
  /** Numero de habitaciones / estancias */
  num_rooms: number;
  /** Incluye intervencion en cocina */
  includes_kitchen: boolean;
  /** Incluye sustitucion de ventanas */
  includes_windows: boolean;
  /** Incluye climatizacion */
  includes_hvac: boolean;
  /** Estado actual del inmueble */
  current_state: "buen_estado" | "necesita_reforma" | "muy_deteriorado" | "obra_nueva";
  /** Nivel de calidad deseado */
  quality: QualityTier;
  /** Lista de estancias a intervenir */
  rooms: string[];
  /** Trabajos especificos solicitados */
  works_requested: string[];
  /** Fecha prevista de inicio (ISO) */
  start_date: string | null;
  /** Fecha limite o deadline (ISO) */
  deadline_date: string | null;
  /** Descripcion libre del usuario (complementaria, NUNCA contradice los campos anteriores) */
  description: string;
  /** Datos del cliente final */
  client: ClientData | null;
}

export interface ClientData {
  name: string;
  nif: string;
  address: string;
  email: string;
  phone: string;
}

/** Preferencias del usuario para la generacion */
export interface BudgetPreferences {
  quality: QualityTier;
  margin_percent: number;
  indirect_costs_percent: number;
  tax_percent: number;
  workers_count: number | null;
  include_alternatives: boolean;
}

// ─── FASE 1: Analisis del proyecto (salida de Claude) ───────────────────────

export interface ProjectAnalysis {
  project_summary: ProjectSummary;
  phases: ProjectPhase[];
  required_chapters: RequiredChapter[];
  required_items: RequiredItem[];
  auxiliary_items: AuxiliaryItem[];
  commonly_forgotten: string[];
  permits_needed: string[];
  assumptions: string[];
  missing_information: string[];
  incompatibilities: string[];
  trades_needed: TradeEstimate[];
}

export interface ProjectSummary {
  project_type: ProjectType;
  work_category: WorkCategory;
  location: string;
  surface_m2: number;
  quality_level: QualityTier;
  complexity: ComplexityLevel;
  risk_level: RiskLevel;
}

export interface ProjectPhase {
  order: number;
  name: string;
  trades: TradeCode[];
  estimated_days: number;
  depends_on: number[];
}

export interface RequiredChapter {
  code: ChapterCode;
  name: string;
  reason: string;
  estimated_weight_percent: number;
}

export interface RequiredItem {
  chapter: ChapterCode;
  concept: string;
  unit: string;
  quantity_formula: string;
  quantity_estimated: number;
  priority: ItemPriority;
}

export interface AuxiliaryItem {
  chapter: ChapterCode;
  concept: string;
  reason: string;
}

export interface TradeEstimate {
  trade: TradeCode;
  estimated_days: number;
}

// ─── FASE 2: Partidas generadas (salida de Claude, enriquecida en fases 3-4)

export interface BudgetItemV2 {
  id: string;
  chapter: ChapterCode;
  code: string;
  name: string;
  description: string;
  unit: string;
  quantity: number;
  /** Formula o explicacion de como se calculo la cantidad */
  quantity_calculation: string;
  trade: TradeCode;
  estimated_hours: number;
  priority: ItemPriority;
  dependencies: ChapterCode[];

  // --- Costes (rellenados en FASE 3-4) ---
  material_cost_per_unit: number;
  labor_cost_per_unit: number;
  labor_hours_per_unit: number;
  machinery_cost_per_unit: number;
  unit_cost: number;
  unit_price_sale: number;
  subtotal_cost: number;
  subtotal_sale: number;

  // --- Margen y confianza ---
  margin_percent: number;
  confidence_score: number;
  price_source: PriceSourceV2;
  price_source_detail: string;
  supplier: string | null;

  // --- Materiales asociados ---
  materials: BudgetItemMaterial[];
}

export interface BudgetItemMaterial {
  name: string;
  quantity: number;
  unit: string;
  unit_price: number;
  subtotal: number;
  supplier: string;
  source: PriceSourceV2;
  confidence: number;
}

// ─── FASE 3: Precios resueltos ──────────────────────────────────────────────

/** Cambio de precio detectado al re-preciar */
export interface PriceChange {
  item_id: string;
  item_name: string;
  chapter: ChapterCode;
  price_before: number;
  price_after: number;
  difference: number;
  difference_percent: number;
  source_before: PriceSourceV2;
  source_after: PriceSourceV2;
  supplier_before: string | null;
  supplier_after: string | null;
  updated_at: string;
}

/** Impacto de un re-preciado en el presupuesto */
export interface RepriceImpact {
  total_before: number;
  total_after: number;
  difference: number;
  difference_percent: number;
  margin_before: number;
  margin_after: number;
  items_changed: number;
  items_unchanged: number;
}

// ─── FASE 4: Calculo economico ──────────────────────────────────────────────

export interface BudgetEconomics {
  cost_breakdown: CostBreakdownV2;
  per_m2: PerM2Analysis;
  undervaluation_check: UndervaluationCheck;
  chapter_breakdown: ChapterEconomics[];
  price_confidence: PriceConfidenceSummary;
}

export interface CostBreakdownV2 {
  materials: number;
  labor: number;
  machinery: number;
  transport: number;
  waste_management: number;
  direct_cost: number;
  indirect_costs_percent: number;
  indirect_costs: number;
  total_cost: number;
  margin_percent: number;
  margin_amount: number;
  sale_price_before_tax: number;
  tax_percent: number;
  tax_amount: number;
  total_sale_price: number;
  profit: number;
  profitability_percent: number;
}

export interface PerM2Analysis {
  cost: number;
  sale: number;
  market_reference_min: number;
  market_reference_max: number;
  is_within_market: boolean;
}

export interface UndervaluationCheck {
  is_undervalued: boolean;
  /** Numero de indicadores positivos (warning si >= 2) */
  score: number;
  warnings: UndervaluationWarning[];
}

export interface UndervaluationWarning {
  indicator: string;
  detail: string;
  severity: WarningSeverity;
}

export interface ChapterEconomics {
  chapter: ChapterCode;
  chapter_label: string;
  direct_cost: number;
  sale_price: number;
  weight_percent: number;
  margin_percent: number;
  confidence_avg: number;
}

export interface PriceConfidenceSummary {
  overall: number;
  from_user_catalog: number;
  from_technical_bank: number;
  from_enlaze_base: number;
  from_n8n_market: number;
  from_web_search: number;
  estimated: number;
  total_items: number;
}

// ─── FASE 5: Planificacion temporal ─────────────────────────────────────────

export interface BudgetTimeline {
  estimated_duration: DurationEstimate;
  recommended_crew: CrewRecommendation;
  phases: TimelinePhaseV2[];
  critical_path: string[];
  drying_times: DryingTime[];
  risks: string[];
  start_date: string | null;
  end_date_estimated: string | null;
  assumptions: string[];
}

export interface DurationEstimate {
  working_days_min: number;
  working_days_max: number;
  calendar_days_min: number;
  calendar_days_max: number;
  weeks_min: number;
  weeks_max: number;
}

export interface CrewRecommendation {
  workers_total: number;
  breakdown: CrewMember[];
}

export interface CrewMember {
  trade: TradeCode;
  count: number;
  days: number;
}

export interface TimelinePhaseV2 {
  order: number;
  name: string;
  start_day: number;
  end_day: number;
  duration_days: number;
  depends_on: number[];
  can_parallel: boolean;
  items: string[];
}

export interface DryingTime {
  after: string;
  hours: number;
  note: string;
}

// ─── FASE 6: Validacion ─────────────────────────────────────────────────────

export interface ValidationReport {
  is_valid: boolean;
  /** Puntuacion global 0-100 */
  score: number;
  checks: ValidationCheck[];
  warnings: ValidationWarning[];
  suggestions: string[];
  estimated_items: EstimatedItemInfo[];
  contradictions: string[];
}

export interface ValidationCheck {
  category: ValidationCategory;
  check: string;
  status: ValidationStatus;
  detail: string;
}

export interface ValidationWarning {
  severity: WarningSeverity;
  category: ValidationCategory;
  message: string;
  affected_items: string[];
}

export interface EstimatedItemInfo {
  item_id: string;
  concept: string;
  reason: string;
  estimated_price: number;
  confidence: number;
}

// ─── Resultado final ────────────────────────────────────────────────────────

export interface BudgetResult {
  ok: boolean;
  budget_id: string;
  version: number;
  analysis: ProjectAnalysis;
  items: BudgetItemV2[];
  economics: BudgetEconomics;
  timeline: BudgetTimeline;
  validation: ValidationReport;
}

// ─── Vistas (cliente / interno) ─────────────────────────────────────────────

/** Vista para el cliente: sin costes internos, sin margenes, sin proveedores */
export interface ClientView {
  company: { name: string; nif: string; address: string; phone: string; email: string };
  client: ClientData;
  project: {
    description: string;
    location: string;
    budget_number: string;
    date: string;
    validity_days: number;
  };
  chapters: ClientChapter[];
  subtotal: number;
  tax_percent: number;
  tax_amount: number;
  total: number;
  payment_terms: string;
  conditions: string[];
  exclusions: string[];
}

export interface ClientChapter {
  name: string;
  order: number;
  items: ClientItem[];
  subtotal: number;
}

export interface ClientItem {
  code: string;
  name: string;
  description: string;
  unit: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

/** Vista interna: escandallo completo con costes, margenes, proveedores */
export interface InternalView {
  chapters: InternalChapter[];
  totals: InternalTotals;
  timeline_summary: {
    duration_weeks: string;
    workers: number;
    critical_risks: string[];
  };
  confidence: {
    overall: number;
    high_risk_items: string[];
  };
}

export interface InternalChapter {
  chapter: ChapterCode;
  chapter_label: string;
  items: InternalItem[];
  subtotal_cost: number;
  subtotal_sale: number;
  margin_percent: number;
  confidence_avg: number;
}

export interface InternalItem {
  code: string;
  name: string;
  unit: string;
  quantity: number;
  // Costes
  material_cost: number;
  labor_cost: number;
  labor_hours: number;
  machinery_cost: number;
  unit_cost: number;
  subtotal_cost: number;
  // Venta
  unit_price_sale: number;
  subtotal_sale: number;
  // Rentabilidad
  margin_percent: number;
  profit: number;
  // Fuente
  supplier: string | null;
  price_source: PriceSourceV2;
  confidence: number;
  // Riesgo
  risk: RiskLevel;
}

export interface InternalTotals {
  direct_cost: number;
  materials_cost: number;
  labor_cost: number;
  machinery_cost: number;
  waste_cost: number;
  indirect_costs: number;
  total_cost: number;
  sale_subtotal: number;
  tax_amount: number;
  sale_total: number;
  profit: number;
  margin_percent: number;
  total_hours: number;
  duration_weeks_estimate: string;
  workers_recommended: number;
  high_risk_items: string[];
}

// ─── Cache y snapshots ──────────────────────────────────────────────────────

export interface AnalysisCacheEntry {
  scope_hash: string;
  analysis: ProjectAnalysis;
  created_at: string;
  expires_at: string;
}

export interface BudgetSnapshot {
  budget_id: string;
  version: number;
  snapshot_type: SnapshotType;
  client_view: ClientView;
  internal_view: InternalView;
  economics: BudgetEconomics;
  timeline: BudgetTimeline | null;
  validation: ValidationReport | null;
  created_at: string;
}

// ─── Rendimientos para planificacion ────────────────────────────────────────

/** Horas por unidad de trabajo, por capitulo y unidad */
export type RendimientosTable = Record<ChapterCode, Partial<Record<string, number>>>;

// ─── Coeficientes de desglose de coste por capitulo ─────────────────────────

export interface CostCoefficients {
  material_pct: number;
  labor_pct: number;
  machinery_pct: number;
  waste_pct: number;
}

export type CostCoefficientsTable = Record<ChapterCode, CostCoefficients>;

// ─── Rangos de mercado EUR/m2 por tipo de obra y calidad ────────────────────

export interface MarketRange {
  project_type: ProjectType;
  quality: QualityTier;
  min_eur_m2: number;
  max_eur_m2: number;
}
