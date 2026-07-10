# Arquitectura del Generador de Presupuestos v2

ENLAZE - Plataforma SaaS para autonomos y pymes de construccion

Fecha: 2026-07-10
Version: 1.0

---

## 1. Flujo completo de creacion del presupuesto

El flujo se divide en 6 fases secuenciales. Las fases 1 y 2 son llamadas a Claude. Las fases 3 a 6 son logica determinista en TypeScript (sin IA).

```
Usuario introduce datos (wizard)
        |
        v
  FASE 1: ANALISIS DEL PROYECTO (Claude)
  Input:  datos formulario + descripcion libre + contexto sector
  Output: ProjectAnalysis (JSON estructurado)
        |
        v
  FASE 2: GENERACION DE PARTIDAS (Claude)
  Input:  ProjectAnalysis + banco precios tecnico + precios usuario
  Output: GeneratedBudgetItems[] (JSON estructurado)
        |
        v
  FASE 3: RESOLUCION DE PRECIOS (TypeScript)
  Input:  GeneratedBudgetItems + price-resolver (6 niveles)
  Output: PricedBudgetItems[] con fuente, confianza, alternativas
        |
        v
  FASE 4: CALCULO ECONOMICO (TypeScript)
  Input:  PricedBudgetItems + margen + config usuario
  Output: BudgetEconomics (costes, margenes, rentabilidad)
        |
        v
  FASE 5: PLANIFICACION TEMPORAL (TypeScript)
  Input:  PricedBudgetItems + dependencias + rendimientos
  Output: BudgetTimeline (duracion, fases, dependencias, cuadrilla)
        |
        v
  FASE 6: VALIDACION FINAL (TypeScript)
  Input:  todo lo anterior
  Output: ValidationReport (warnings, missing, infravaloracion)
        |
        v
  Resultado final: BudgetResult
  Se genera: presupuesto cliente + presupuesto interno
```

Latencia esperada: Fase 1 (~3s) + Fase 2 (~5s) + Fases 3-6 (~1s) = ~9s total.
Coste API: 2 llamadas a Claude Sonnet por presupuesto.

### Prioridad de datos del formulario

Los datos estructurados del formulario (superficie, num_banos, estancias, actuaciones) tienen PRIORIDAD ABSOLUTA sobre la descripcion libre. Si el formulario dice 2 banos, se generan partidas para 2 banos aunque la descripcion mencione solo 1. La descripcion libre complementa pero nunca contradice.


## 2. Arquitectura tecnica

### 2.1. Modulos existentes (se mantienen)

```
lib/budget-engine.ts       -> BudgetScope, ScopeQuantities, normalizeBudgetItemsToScope,
                              adjustToMarket, estimateRealisticTimeline,
                              buildClientView, buildInternalView
lib/price-resolver.ts      -> resolveMaterialPrice, resolvePricesForBudget (cadena 6 niveles)
lib/agent-prompts.ts       -> sectorConfigs, prompts por sector
lib/bc3-parser.ts          -> parseBC3, classifyConcepts, inferComponentType
lib/technical-price-importer.ts -> importBC3ToDatabase
```

### 2.2. Modulos nuevos

```
lib/budget-analysis.ts     -> FASE 1: prompt de analisis + parser de respuesta
lib/budget-generator.ts    -> FASE 2: prompt de generacion + parser de respuesta
lib/budget-economics.ts    -> FASE 4: calculo coste/margen/rentabilidad/infravaloracion
lib/budget-planner.ts      -> FASE 5: planificacion temporal con dependencias
lib/budget-validator.ts    -> FASE 6: validacion final pre-entrega
lib/types/budget-v2.ts     -> todos los tipos/interfaces del sistema v2
```

### 2.3. Endpoints nuevos

```
POST /api/budgets/analyze    -> FASE 1 (Claude)
POST /api/budgets/generate   -> FASES 1-6 completas (para wizard, usa analyze internamente)
POST /api/budgets/reprice    -> recalcular precios sin regenerar partidas
POST /api/budgets/validate   -> FASE 6 aislada (validar presupuesto editado)
```

### 2.4. Endpoints existentes (se modifican)

```
POST /api/prices/resolve     -> añadir technical_bank como nivel 2
GET  /api/prices/resolve     -> (sin cambios)
```

### 2.5. Diagrama de dependencias

```
                    budget-analysis.ts
                          |
                    budget-generator.ts
                       /     \
         price-resolver.ts   budget-engine.ts (existente)
              |                    |
    technical_price_items    normalizeBudgetItemsToScope
    price_items (user)       adjustToMarket
    sector_data (n8n)            |
    resolved_prices         budget-economics.ts
    web_search                   |
                            budget-planner.ts
                                 |
                            budget-validator.ts
                                 |
                    buildClientView / buildInternalView
```


## 3. Endpoints necesarios

### 3.1. POST /api/budgets/analyze (NUEVO)

Fase 1 aislada. Util para preview rapido antes de generar.

```
Request:
{
  scope: BudgetScope,            // datos estructurados del formulario
  description: string,           // descripcion libre del usuario
  sector: string,                // "construccion"
  preferences: {
    quality: "basica" | "media" | "alta",
    margin_percent: number,
    include_alternatives: boolean
  }
}

Response:
{
  ok: true,
  analysis: ProjectAnalysis      // ver seccion 5 (JSON)
}
```

### 3.2. POST /api/budgets/generate (REFACTOR del existente)

Flujo completo fases 1-6. Sustituye al actual `/api/agent/budgets/generate`.

```
Request:
{
  scope: BudgetScope,
  description: string,
  sector: string,
  preferences: {
    quality: "basica" | "media" | "alta",
    margin_percent: number,
    indirect_costs_percent: number,    // default 6%
    tax_percent: number,               // default 21% (IVA)
    workers_count: number | null,      // null = auto
    start_date: string | null,         // ISO date
    deadline_date: string | null       // ISO date
  },
  client: {
    name: string,
    nif: string,
    address: string,
    email: string,
    phone: string
  } | null
}

Response:
{
  ok: true,
  budget: BudgetResult              // ver seccion 5
}
```

### 3.3. POST /api/budgets/reprice (NUEVO)

Actualizar solo precios sin regenerar partidas.

```
Request:
{
  budget_id: string,
  items: BudgetItem[],               // partidas actuales
  force_refresh: boolean             // ignorar cache
}

Response:
{
  ok: true,
  changes: PriceChange[],           // precio anterior vs nuevo
  impact: {
    total_before: number,
    total_after: number,
    difference: number,
    difference_percent: number,
    margin_before: number,
    margin_after: number
  }
}
```

### 3.4. POST /api/budgets/validate (NUEVO)

Validacion aislada de un presupuesto editado.

```
Request:
{
  scope: BudgetScope,
  items: BudgetItem[],
  economics: BudgetEconomics
}

Response:
{
  ok: true,
  validation: ValidationReport
}
```


## 4. Tablas de base de datos

### 4.1. Tablas existentes (sin cambios)

```
profiles              -> datos empresa/usuario
budgets               -> presupuestos guardados
budget_items          -> partidas de presupuestos
price_items           -> banco precios usuario (nivel 1)
margin_config         -> configuracion margenes por servicio
sector_data           -> datos sector desde n8n (nivel 3)
resolved_prices       -> cache de precios resueltos (48h TTL)
supplier_catalogs     -> catalogos proveedores
technical_chapters    -> capitulos banco tecnico
technical_price_items -> partidas banco tecnico (nivel 2 NUEVO en resolver)
technical_price_components -> descompuestos
technical_import_logs -> log importaciones BC3
```

### 4.2. Tabla nueva: budget_analysis_cache

Cache de analisis para evitar repetir la FASE 1 si el scope no cambia.

```sql
CREATE TABLE IF NOT EXISTS budget_analysis_cache (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope_hash      text NOT NULL,           -- SHA-256 del BudgetScope serializado
  analysis        jsonb NOT NULL,           -- ProjectAnalysis completo
  created_at      timestamptz DEFAULT now(),
  expires_at      timestamptz NOT NULL,     -- +24h

  CONSTRAINT uq_analysis_cache UNIQUE (user_id, scope_hash)
);

CREATE INDEX idx_analysis_cache_lookup
  ON budget_analysis_cache(user_id, scope_hash)
  WHERE expires_at > now();
```

### 4.3. Tabla nueva: budget_snapshots

Guardar versiones internas completas del presupuesto (para comparar, deshacer).

```sql
CREATE TABLE IF NOT EXISTS budget_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id       uuid NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  version         smallint NOT NULL DEFAULT 1,
  snapshot_type   text NOT NULL CHECK (snapshot_type IN ('generated', 'edited', 'repriced')),
  client_view     jsonb NOT NULL,
  internal_view   jsonb NOT NULL,
  economics       jsonb NOT NULL,
  timeline        jsonb,
  validation      jsonb,
  created_at      timestamptz DEFAULT now(),

  CONSTRAINT uq_budget_version UNIQUE (budget_id, version)
);
```

### 4.4. Columnas nuevas en budgets (ALTER TABLE)

```sql
ALTER TABLE budgets
  ADD COLUMN IF NOT EXISTS analysis       jsonb,           -- ProjectAnalysis
  ADD COLUMN IF NOT EXISTS economics      jsonb,           -- BudgetEconomics
  ADD COLUMN IF NOT EXISTS timeline       jsonb,           -- BudgetTimeline
  ADD COLUMN IF NOT EXISTS validation     jsonb,           -- ValidationReport
  ADD COLUMN IF NOT EXISTS version        smallint DEFAULT 1,
  ADD COLUMN IF NOT EXISTS quality_tier   text DEFAULT 'media',
  ADD COLUMN IF NOT EXISTS scope_data     jsonb;           -- BudgetScope original
```


## 5. Esquema JSON definitivo

### 5.1. ProjectAnalysis (salida de FASE 1)

```json
{
  "project_summary": {
    "project_type": "reforma_integral",
    "work_category": "residencial",
    "location": "Madrid",
    "surface_m2": 85,
    "quality_level": "media",
    "complexity": "media",
    "risk_level": "bajo"
  },
  "phases": [
    {
      "order": 1,
      "name": "Trabajos previos y protecciones",
      "trades": ["peon", "encargado"],
      "estimated_days": 1
    },
    {
      "order": 2,
      "name": "Demoliciones",
      "trades": ["peon", "oficial_albanil"],
      "estimated_days": 3,
      "depends_on": [1]
    }
  ],
  "required_chapters": [
    {
      "code": "protecciones",
      "name": "Protecciones y trabajos previos",
      "reason": "Obligatorio en obra con zonas comunes",
      "estimated_weight_percent": 2
    },
    {
      "code": "demoliciones",
      "name": "Demoliciones y retiradas",
      "reason": "Reforma integral requiere derribo de tabiqueria y revestimientos",
      "estimated_weight_percent": 8
    }
  ],
  "required_items": [
    {
      "chapter": "demoliciones",
      "concept": "Demolicion de tabiqueria interior no portante",
      "unit": "m2",
      "quantity_formula": "superficie_m2 * 0.4",
      "quantity_estimated": 34,
      "priority": "obligatoria"
    }
  ],
  "auxiliary_items": [
    {
      "chapter": "residuos",
      "concept": "Contenedor de escombros 6m3 con transporte a vertedero",
      "reason": "Generado por demoliciones estimadas"
    }
  ],
  "commonly_forgotten": [
    "Impermeabilizacion de zonas humedas antes de alicatado",
    "Proteccion de zonas comunes del edificio",
    "Regularizacion de superficies antes de revestimiento",
    "Gestion de residuos y tasa de vertedero"
  ],
  "permits_needed": [
    "Licencia de obra menor del ayuntamiento",
    "Comunicacion a la comunidad de propietarios"
  ],
  "assumptions": [
    "Se asume estructura portante en buen estado",
    "Las instalaciones generales del edificio no requieren intervencion",
    "Acceso normal (sin necesidad de grua o medios especiales)"
  ],
  "missing_information": [
    "Altura de techos (asumida 2.50m)",
    "Estado real de instalaciones ocultas",
    "Tipo de calefaccion existente"
  ],
  "incompatibilities": [],
  "trades_needed": [
    { "trade": "oficial_albanil", "estimated_days": 12 },
    { "trade": "fontanero", "estimated_days": 5 },
    { "trade": "electricista", "estimated_days": 4 },
    { "trade": "pintor", "estimated_days": 4 },
    { "trade": "peon", "estimated_days": 15 },
    { "trade": "alicatador", "estimated_days": 6 }
  ]
}
```

### 5.2. BudgetItem (salida de FASE 2, enriquecida en FASES 3-4)

```json
{
  "id": "dem-001",
  "chapter": "demoliciones",
  "code": "01.DEM.001",
  "name": "Demolicion de alicatado ceramico existente en paredes",
  "description": "Picado de alicatado ceramico en paredes de bano, incluyendo enfoscado base. Medido segun perimetro de bano (3.2m x 2.5m altura) x 2 banos.",
  "unit": "m2",
  "quantity": 32,
  "quantity_calculation": "perimetro_bano * altura * num_banos = (2*(2.0+1.6)) * 2.5 * 2 = 36 m2, ajustado -10% por puerta",
  "trade": "peon_especialista",
  "estimated_hours": 8,

  "material_cost": 0,
  "labor_cost_per_unit": 11.00,
  "labor_hours_per_unit": 0.25,
  "machinery_cost_per_unit": 0,
  "unit_cost": 11.00,
  "unit_price_sale": 14.30,
  "subtotal_cost": 352.00,
  "subtotal_sale": 457.60,

  "margin_percent": 30,
  "confidence_score": 0.85,
  "price_source": "technical_bank",
  "price_source_detail": "BC3 IVE 2025 - partida DEM.010",
  "supplier": null,

  "dependencies": ["protecciones"],
  "priority": "obligatoria",
  "materials": []
}
```

### 5.3. BudgetEconomics (salida de FASE 4)

```json
{
  "cost_breakdown": {
    "materials": 8450.00,
    "labor": 6200.00,
    "machinery": 350.00,
    "transport": 280.00,
    "waste_management": 580.00,
    "direct_cost": 15860.00,
    "indirect_costs_percent": 6,
    "indirect_costs": 951.60,
    "total_cost": 16811.60,
    "margin_percent": 25,
    "margin_amount": 4202.90,
    "sale_price_before_tax": 21014.50,
    "tax_percent": 21,
    "tax_amount": 4413.05,
    "total_sale_price": 25427.55,
    "profit": 4202.90,
    "profitability_percent": 20.0
  },
  "per_m2": {
    "cost": 197.78,
    "sale": 299.15,
    "market_reference_min": 250,
    "market_reference_max": 450,
    "is_within_market": true
  },
  "undervaluation_check": {
    "is_undervalued": false,
    "warnings": [],
    "score": 0
  },
  "chapter_breakdown": [
    {
      "chapter": "demoliciones",
      "chapter_label": "Demoliciones y retiradas",
      "direct_cost": 1520.00,
      "sale_price": 1976.00,
      "weight_percent": 9.4,
      "margin_percent": 30,
      "confidence_avg": 0.82
    }
  ],
  "price_confidence": {
    "overall": 0.78,
    "from_user_catalog": 0,
    "from_technical_bank": 12,
    "from_enlaze_base": 8,
    "from_n8n_market": 3,
    "from_web_search": 2,
    "estimated": 3,
    "total_items": 28
  }
}
```

### 5.4. BudgetTimeline (salida de FASE 5)

```json
{
  "estimated_duration": {
    "working_days_min": 22,
    "working_days_max": 30,
    "calendar_days_min": 30,
    "calendar_days_max": 42,
    "weeks_min": 5,
    "weeks_max": 6
  },
  "recommended_crew": {
    "workers_total": 3,
    "breakdown": [
      { "trade": "oficial_albanil", "count": 1, "days": 12 },
      { "trade": "peon", "count": 1, "days": 18 },
      { "trade": "fontanero", "count": 1, "days": 5 },
      { "trade": "electricista", "count": 1, "days": 4 }
    ]
  },
  "phases": [
    {
      "order": 1,
      "name": "Protecciones y trabajos previos",
      "start_day": 1,
      "end_day": 1,
      "duration_days": 1,
      "depends_on": [],
      "can_parallel": false,
      "items": ["prot-001", "prot-002"]
    },
    {
      "order": 2,
      "name": "Demoliciones",
      "start_day": 2,
      "end_day": 4,
      "duration_days": 3,
      "depends_on": [1],
      "can_parallel": false,
      "items": ["dem-001", "dem-002", "dem-003"]
    },
    {
      "order": 3,
      "name": "Albanileria y tabiqueria",
      "start_day": 5,
      "end_day": 9,
      "duration_days": 5,
      "depends_on": [2],
      "can_parallel": false,
      "items": ["alb-001", "alb-002"]
    },
    {
      "order": 4,
      "name": "Instalaciones (fontaneria + electricidad)",
      "start_day": 7,
      "end_day": 12,
      "duration_days": 6,
      "depends_on": [2],
      "can_parallel": true,
      "items": ["fon-001", "ele-001"]
    }
  ],
  "critical_path": [
    "Protecciones", "Demoliciones", "Albanileria",
    "Revestimientos", "Pintura", "Limpieza"
  ],
  "drying_times": [
    { "after": "Impermeabilizacion", "hours": 24, "note": "Secado lamina impermeabilizante" },
    { "after": "Enfoscado paredes", "hours": 48, "note": "Fraguado del mortero antes de alicatar" },
    { "after": "Primera mano pintura", "hours": 12, "note": "Secado entre manos" }
  ],
  "risks": [
    "Instalaciones ocultas en mal estado pueden añadir 2-3 dias",
    "Plazo de entrega de ventanas a medida: 15-20 dias laborables"
  ],
  "start_date": null,
  "end_date_estimated": null,
  "assumptions": [
    "Jornada laboral de 8 horas",
    "5 dias laborables por semana",
    "Materiales disponibles sin plazo de espera excepto ventanas"
  ]
}
```

### 5.5. ValidationReport (salida de FASE 6)

```json
{
  "is_valid": true,
  "score": 87,
  "checks": [
    {
      "category": "completeness",
      "check": "Capitulos requeridos presentes",
      "status": "pass",
      "detail": "15/15 capitulos presentes"
    },
    {
      "category": "completeness",
      "check": "Partidas duplicadas",
      "status": "pass",
      "detail": "0 duplicados encontrados"
    },
    {
      "category": "quantities",
      "check": "Coherencia m2 pavimento vs superficie",
      "status": "pass",
      "detail": "85 m2 pavimento para 85 m2 de vivienda"
    },
    {
      "category": "pricing",
      "check": "Precios actualizados",
      "status": "warning",
      "detail": "3 partidas con precios estimados (confianza < 0.50)"
    },
    {
      "category": "profitability",
      "check": "Margen suficiente",
      "status": "pass",
      "detail": "Margen global 25%, minimo recomendado 15%"
    },
    {
      "category": "duration",
      "check": "Duracion realista",
      "status": "pass",
      "detail": "5-6 semanas para 85m2, rango normal"
    },
    {
      "category": "undervaluation",
      "check": "Presupuesto no infravalorado",
      "status": "pass",
      "detail": "299 EUR/m2, rango mercado 250-450 EUR/m2"
    }
  ],
  "warnings": [
    {
      "severity": "medium",
      "category": "pricing",
      "message": "3 partidas con precio estimado (confianza < 0.50). Recomendamos actualizar precios de mercado.",
      "affected_items": ["ele-003", "clim-001", "coc-002"]
    }
  ],
  "suggestions": [
    "Considerar añadir partida de regularizacion de suelos si el pavimento existente esta irregular",
    "Verificar necesidad de refuerzo acustico en tabiqueria medianera (CTE DB-HR)"
  ],
  "estimated_items": [
    {
      "item_id": "ele-003",
      "concept": "Mecanismo electrico empotrado",
      "reason": "Sin precio verificado en banco tecnico ni proveedor",
      "estimated_price": 8.50,
      "confidence": 0.40
    }
  ],
  "contradictions": []
}
```

### 5.6. BudgetResult (objeto final completo)

```json
{
  "ok": true,
  "budget_id": "uuid",
  "version": 1,
  "analysis": { "...ProjectAnalysis" },
  "items": [ "...BudgetItem[]" ],
  "economics": { "...BudgetEconomics" },
  "timeline": { "...BudgetTimeline" },
  "validation": { "...ValidationReport" },
  "client_view": { "...BudgetClientView (existente)" },
  "internal_view": { "...BudgetInternalView (existente)" }
}
```


## 6. Logica de busqueda y seleccion de precios

### 6.1. Cadena de resolucion (price-resolver.ts actualizado)

```
Nivel 1: user_catalog     -> price_items del usuario         -> confianza 0.95
Nivel 2: technical_bank   -> technical_price_items (NUEVO)    -> confianza 0.80-0.90
Nivel 3: enlaze_base      -> INTERNAL_PRICE_DB hardcoded      -> confianza 0.50
Nivel 4: n8n_market       -> sector_data sincronizado por n8n  -> confianza 0.75
Nivel 5: web_search       -> SerpAPI / scraping proveedores    -> confianza 0.45-0.70
Nivel 6: estimated        -> estimacion sin fuente verificada  -> confianza 0.10-0.40
```

### 6.2. Integracion del banco tecnico (cambio en price-resolver.ts)

Añadir entre nivel 1 y nivel 3 actual:

```typescript
// Nivel 2: Technical price bank (BC3/FIEBDC imports)
if (!match && technicalPrices && technicalPrices.length > 0) {
  const techMatch = technicalPrices.find(p => fuzzyMatch(p.name, request.materialName));
  if (techMatch) {
    const confidence = techMatch.confidence_score || 0.80;
    return buildResult(request, normalized, techMatch.unit_price,
      `Banco tecnico (${techMatch.source})`, "", "technical_bank",
      confidence, now, alternatives);
  }
}
```

Los datos vienen de `technical_price_items` via Supabase query:

```typescript
const { data: technicalPrices } = await supabase
  .from('technical_price_items')
  .select('name, item_code, unit, unit_price, confidence_score, source, region')
  .eq('region', location || 'espana')
  .eq('is_active', true);
```

### 6.3. Seleccion de precio recomendado

Cuando hay multiples fuentes, se selecciona segun:

```
1. Fuente de mayor confianza (user_catalog > technical_bank > enlaze_base > ...)
2. Si misma confianza, el precio que mejor se ajuste a la calidad solicitada
3. Multiplicadores de calidad: basica (0.55-0.75x), media (1.0x), alta (1.3-2.2x)
4. Si el precio esta fuera del rango min-max conocido, warning automatico
```

### 6.4. Horquilla de precios

Cada precio resuelto incluye:

```
priceMin     -> menor precio encontrado entre todas las fuentes
priceMedian  -> mediana de precios
priceMax     -> mayor precio encontrado
selected     -> precio elegido segun calidad + confianza
```


## 7. Logica para calcular costes, margenes y rentabilidad

### 7.1. Desglose de coste unitario

Cada partida tiene un coste unitario compuesto:

```
unit_cost = material_cost + labor_cost + machinery_cost + auxiliary_cost
```

Cuando el banco tecnico tiene descompuestos (technical_price_components), se usan directamente:

```
material_cost  = SUM(component.yield * component.unit_price) WHERE type='material'
labor_cost     = SUM(component.yield * component.unit_price) WHERE type='labor'
machinery_cost = SUM(component.yield * component.unit_price) WHERE type='machinery'
```

Cuando NO hay descompuestos, se estiman por coeficientes segun capitulo:

```
Capitulo           Material%  Labor%  Maquinaria%  Residuos%
demoliciones         5%       80%        10%          5%
albanileria         40%       50%         5%          5%
fontaneria          55%       40%         3%          2%
electricidad        50%       45%         2%          3%
revestimientos      45%       48%         2%          5%
pavimentos          50%       42%         3%          5%
pintura             30%       65%         2%          3%
sanitarios          70%       25%         2%          3%
carpinteria_int     65%       30%         2%          3%
carpinteria_ext     70%       25%         2%          3%
cocina              75%       20%         2%          3%
climatizacion       60%       30%         8%          2%
residuos            10%       30%        60%          0%
```

### 7.2. Costes indirectos

```
indirect_costs = direct_cost * indirect_costs_percent
```

Default: 6% (incluye seguros, amortizacion herramienta, desplazamientos, gestion).
El usuario puede configurar entre 3% y 15%.

### 7.3. Precio de venta

```
sale_price = (direct_cost + indirect_costs) * (1 + margin_percent / 100)
```

### 7.4. Deteccion de infravaloracion

El sistema comprueba 5 indicadores. Solo muestra warning si al menos 2 indicadores son positivos:

```
1. EUR/m2 por debajo del minimo de mercado para el tipo de obra
   - Reforma integral basica: minimo 200 EUR/m2
   - Reforma integral media:  minimo 350 EUR/m2
   - Reforma integral alta:   minimo 550 EUR/m2

2. Margen global por debajo del 10%

3. Horas de mano de obra insuficientes para las cantidades
   - Rendimiento referencia: 0.3 h/m2 demolicion, 0.5 h/m2 alicatado, etc.
   - Si horas calculadas < 70% del rendimiento esperado -> warning

4. Materiales con precio por debajo del 60% del minimo de mercado

5. Duracion incompatible con cuadrilla
   - Si (horas_totales / trabajadores / 8) > dias_calendario * 1.2 -> warning
```

### 7.5. Recalculo automatico

Al editar cualquier partida (cantidad, precio, margen), se recalcula:

```
subtotal_cost   = quantity * unit_cost
subtotal_sale   = quantity * unit_sale
chapter_totals  -> recalculo
economics       -> recalculo completo
timeline        -> recalculo si cambian cantidades significativas
validation      -> re-ejecutar checks de infravaloracion y coherencia
```


## 8. Logica para calcular la duracion

### 8.1. Rendimientos base (horas por unidad)

```typescript
const RENDIMIENTOS: Record<string, Record<string, number>> = {
  demoliciones:     { m2: 0.30, ud: 0.50, m3: 2.0, pa: 4.0 },
  albanileria:      { m2: 0.60, ud: 0.80, ml: 0.20 },
  fontaneria:       { ud: 2.50, ml: 0.30, punto: 1.50, pa: 8.0 },
  electricidad:     { ud: 0.80, punto: 1.20, ml: 0.15, pa: 6.0 },
  revestimientos:   { m2: 0.55, ml: 0.20 },
  pavimentos:       { m2: 0.45, ml: 0.15 },
  pintura:          { m2: 0.15, ml: 0.10 },
  carpinteria_int:  { ud: 2.00 },
  carpinteria_ext:  { ud: 3.00 },
  sanitarios:       { ud: 2.00, pa: 6.0 },
  cocina:           { pa: 16.0 },
  climatizacion:    { ud: 8.00 },
  impermeabilizacion: { m2: 0.35 },
  falsos_techos:    { m2: 0.40 },
  residuos:         { ud: 1.00, m3: 0.50 },
  limpieza:         { m2: 0.10, pa: 4.0 },
  protecciones:     { pa: 3.0, ud: 0.50 },
};
```

### 8.2. Dependencias entre fases

```
protecciones      -> (inicio)
demoliciones      -> protecciones
albanileria       -> demoliciones
fontaneria        -> demoliciones (puede paralelo con electricidad)
electricidad      -> demoliciones (puede paralelo con fontaneria)
impermeabilizacion -> albanileria + fontaneria
revestimientos    -> impermeabilizacion (+ secado 48h)
pavimentos        -> fontaneria + electricidad (+ secado si nivelacion)
falsos_techos     -> electricidad
carpinteria_int   -> albanileria
carpinteria_ext   -> albanileria (plazo entrega 15-20 dias)
sanitarios        -> revestimientos + fontaneria
cocina            -> revestimientos + electricidad + fontaneria
pintura           -> albanileria + carpinteria_int (+ secado 12h entre manos)
climatizacion     -> electricidad
limpieza          -> todo lo anterior
residuos          -> paralelo a todo (contenedor permanente)
```

### 8.3. Calculo de duracion

```
1. Para cada capitulo: horas = SUM(quantity * rendimiento)
2. Dias = horas / (trabajadores_asignados * 8)
3. Aplicar dependencias: no empieza hasta que sus dependencias acaben
4. Aplicar tiempos de secado (24-48h adicionales)
5. Fases paralelas: fontaneria + electricidad simultaneas
6. Ruta critica: la secuencia mas larga determina la duracion total
7. Multiplicar dias_laborables * 1.4 para obtener dias_calendario
```


## 9. Sistema de validacion

### 9.1. Checks automaticos (FASE 6)

```
COMPLETENESS (se ejecutan siempre):
  - Todos los capitulos requeridos del analisis estan presentes
  - No hay partidas duplicadas (mismo concepto + capitulo)
  - Cada capitulo tiene al menos 1 partida

QUANTITIES (se ejecutan siempre):
  - m2 de pavimento compatible con superficie del scope
  - m2 de pintura compatible con superficie del scope
  - Numero de sanitarios compatible con num_banos
  - Unidades correctas (no m2 para sanitarios, no ud para pavimentos)

PRICING (se ejecutan siempre):
  - Ningun precio unitario es 0
  - Ningun precio esta por debajo del 30% del minimo de mercado
  - Precios actualizados (< 90 dias desde ultima verificacion)
  - Confianza promedio >= 0.50

PROFITABILITY (se ejecutan siempre):
  - Margen global >= 10% (warning si < 15%)
  - Ningun capitulo con margen negativo
  - Costes indirectos incluidos

DURATION (se ejecuta si hay timeline):
  - Duracion estimada >= (horas_totales / trabajadores / 8)
  - No hay fases con duracion 0
  - Las dependencias son coherentes (no hay ciclos)

CONSISTENCY (se ejecutan siempre):
  - Subtotales = quantity * unit_price
  - Total capitulos = sum de partidas
  - Total general = sum de capitulos
  - IVA calculado correctamente
```

### 9.2. Cuando NO mostrar warnings

- Si el margen es >= 15% y todos los precios tienen confianza >= 0.60, NO mostrar warning generico de infravaloracion
- Si una partida es "opcional", no incluirla en los checks de completitud
- Si el usuario ha editado manualmente un precio, no advertir sobre diferencia con mercado (el usuario sabe lo que hace)


## 10. Prompts para cada fase

### 10.1. FASE 1: Prompt de analisis

```
SYSTEM:
Eres un técnico presupuestador profesional con 25 años de experiencia en
construcción y reformas en España. Tu trabajo es ANALIZAR un proyecto antes
de presupuestarlo.

REGLAS:
1. Los datos del FORMULARIO tienen PRIORIDAD ABSOLUTA sobre la descripción libre.
   Si el formulario dice 2 baños, analizas para 2 baños.
2. Identifica TODOS los trabajos necesarios, incluyendo los que normalmente
   se olvidan (impermeabilización, regularización, protecciones, residuos).
3. Clasifica cada trabajo por capítulo estándar.
4. Estima cantidades usando fórmulas basadas en los datos del formulario.
5. Identifica dependencias entre fases.
6. Señala qué información falta y qué has asumido.
7. NO inventes precios. Solo analiza trabajos, cantidades y fases.

CAPÍTULOS ESTÁNDAR (úsalos como referencia):
protecciones, demoliciones, albanileria, fontaneria, electricidad,
impermeabilizacion, revestimientos, pavimentos, pintura, carpinteria_interior,
carpinteria_exterior, sanitarios, cocina, climatizacion, falsos_techos,
residuos, limpieza, seguridad

Responde ÚNICAMENTE con JSON válido siguiendo el esquema ProjectAnalysis.

USER:
DATOS DEL FORMULARIO (PRIORIDAD):
{scope JSON}

DESCRIPCIÓN DEL USUARIO (complementaria):
{description}

Analiza este proyecto y devuelve el ProjectAnalysis completo.
```

### 10.2. FASE 2: Prompt de generacion

```
SYSTEM:
Eres un presupuestador profesional. A partir del análisis de proyecto que recibes,
genera las partidas detalladas con cantidades calculadas.

REGLAS:
1. Genera EXACTAMENTE las partidas identificadas en el análisis. No omitas ninguna.
2. Cada partida debe tener descripción técnica profesional (no genérica).
3. Las cantidades deben calcularse con fórmulas explícitas basadas en los datos
   del formulario. Incluye quantity_calculation explicando de dónde sale.
4. Usa los precios del BANCO DE PRECIOS TÉCNICO cuando exista coincidencia.
   Si no hay coincidencia, usa los precios de referencia proporcionados.
5. Marca la fuente de cada precio: technical_bank, reference, estimated.
6. Para precios estimados, reduce confidence_score a 0.40.
7. Separa coste de material vs mano de obra cuando sea posible.
8. Incluye trade (oficio) y estimated_hours por partida.
9. El código de partida sigue el formato: NN.CAP.NNN (ej: 01.DEM.001)

BANCO DE PRECIOS TÉCNICO DISPONIBLE:
{technical_prices JSON - solo partidas relevantes}

PRECIOS DEL USUARIO:
{user_prices JSON}

PRECIOS DE REFERENCIA ENLAZE:
{enlaze_prices JSON}

Responde ÚNICAMENTE con un array JSON de BudgetItem[].

USER:
ANÁLISIS DEL PROYECTO:
{analysis JSON}

DATOS DEL FORMULARIO:
{scope JSON}

Genera todas las partidas detalladas.
```


## 11. Estrategia de implementacion por etapas

### ETAPA 1: MVP (2 semanas)

Objetivo: el generador usa 2 fases de Claude y consulta el banco tecnico.

```
Semana 1:
  - Crear lib/types/budget-v2.ts con todos los interfaces
  - Crear lib/budget-analysis.ts (FASE 1: prompt + parser)
  - Modificar price-resolver.ts para añadir technical_bank como nivel 2
  - Crear endpoint POST /api/budgets/analyze

Semana 2:
  - Crear lib/budget-generator.ts (FASE 2: prompt + parser)
  - Refactorizar endpoint /api/budgets/generate para usar 2 fases
  - Integrar con BudgetGenerateProvider existente
  - Test end-to-end con wizard actual
```

Resultado: presupuestos con analisis previo, banco tecnico como fuente de precios, partidas mas completas.

### ETAPA 2: Motor economico (1 semana)

```
  - Crear lib/budget-economics.ts (FASE 4)
  - Implementar deteccion de infravaloracion (5 indicadores)
  - Añadir desglose coste/margen/rentabilidad a BudgetInternalView
  - Crear endpoint POST /api/budgets/reprice
```

Resultado: presupuesto interno con escandallo completo, deteccion de infravaloracion real.

### ETAPA 3: Planificacion temporal (1 semana)

```
  - Crear lib/budget-planner.ts (FASE 5)
  - Implementar rendimientos, dependencias, ruta critica
  - Integrar tiempos de secado
  - Añadir timeline al presupuesto generado
```

Resultado: duraciones realistas con fases y dependencias.

### ETAPA 4: Validacion y calidad (1 semana)

```
  - Crear lib/budget-validator.ts (FASE 6)
  - Implementar 6 categorias de checks
  - Integrar warnings en el wizard
  - Crear endpoint POST /api/budgets/validate
  - Crear migracion para budget_snapshots
```

Resultado: validacion automatica pre-entrega, warnings inteligentes.

### ETAPA 5: Edicion y actualizacion (1 semana)

```
  - Boton "Actualizar precios de mercado" con diff visual
  - Recalculo automatico al editar cualquier campo
  - Cambiar proveedor y recalcular sin perder seleccion anterior
  - Guardar snapshots por version
```

Resultado: presupuesto editable con recalculo en tiempo real.

### ETAPA 6: Integraciones avanzadas (ongoing)

```
  - Importar mas BC3 reales (IVE, CYPE, bancos regionales)
  - Mejorar scraping de proveedores via n8n
  - Historial de presupuestos como fuente de precios
  - Generacion de PDF/DOCX profesional
  - Calendario interactivo con Gantt simplificado
```


## 12. Posibles errores y riesgos

### Riesgos tecnicos

```
1. Latencia: 2 llamadas a Claude suman ~8-10s.
   Mitigacion: cache de analisis (24h), streaming de respuesta.

2. JSON malformado de Claude: puede devolver JSON invalido.
   Mitigacion: ya existe extractJson() + llamada de reparacion.
   Mejorar: validacion con zod antes de usar.

3. Precios desactualizados: INTERNAL_PRICE_DB es estatica.
   Mitigacion: technical_bank (BC3) tiene precios mas recientes.
   El nivel 2 (technical_bank) reemplaza progresivamente al nivel 3 (hardcoded).

4. Cantidades incorrectas calculadas por Claude.
   Mitigacion: normalizeBudgetItemsToScope (ya existe) corrige
   cantidades segun scope. Se ejecuta DESPUES del prompt.

5. Token limit: proyectos grandes pueden exceder el contexto.
   Mitigacion: filtrar precios del banco tecnico a solo capitulos
   relevantes (los del analisis). No enviar todo.
```

### Riesgos de negocio

```
6. Presupuestos muy diferentes entre ejecuciones para el mismo input.
   Mitigacion: temperature=0 en Claude, cache de analisis,
   normalizacion determinista post-AI.

7. Usuario confia ciegamente en el presupuesto generado.
   Mitigacion: validacion explicita, confidence_score visible,
   warnings de infravaloracion, seccion "assumptions".

8. Costes API de Claude.
   Mitigacion: ~$0.02-0.04 por presupuesto (2 llamadas Sonnet).
   Cache de analisis reduce llamadas en iteraciones.
```


## 13. Como evitar alucinaciones de la IA

### 13.1. Principios

```
1. SEPARAR ANALISIS DE PRECIOS
   Claude analiza y genera estructura. Los precios vienen del banco tecnico
   y del price-resolver. Claude NO inventa precios finales.

2. VALIDACION POST-IA DETERMINISTA
   Todo lo que sale de Claude pasa por funciones TypeScript deterministas:
   - normalizeBudgetItemsToScope -> corrige cantidades
   - resolveMaterialPrice -> busca precios reales
   - budget-validator -> detecta incoherencias

3. DATOS ESTRUCTURADOS SOBRE TEXTO LIBRE
   El formulario (BudgetScope) es la fuente de verdad. Si Claude genera
   10 m2 de pavimento para un piso de 85 m2, normalizeBudgetItemsToScope
   corrige a 85 m2.

4. CONFIDENCE SCORE TRANSPARENTE
   Cada precio muestra su nivel de confianza y fuente.
   "technical_bank (BC3 IVE 2025)" vs "estimated (sin verificar)".

5. FORZAR JSON ESTRUCTURADO
   Claude debe devolver JSON con esquema predefinido.
   Si falla, se intenta reparar. Si sigue fallando, error explicito.

6. CANTIDADES CON FORMULA
   Cada partida incluye quantity_calculation que explica de donde
   sale la cantidad. Si no hay formula, se marca como "estimada".
```

### 13.2. Capas de proteccion

```
Capa 1: Prompt constraintivo  -> Claude no inventa precios, solo estructura
Capa 2: normalizeBudgetItemsToScope -> corrige cantidades imposibles
Capa 3: price-resolver        -> precios de fuentes verificadas
Capa 4: budget-economics      -> detecta margenes negativos/irreales
Capa 5: budget-validator      -> checks finales de coherencia
Capa 6: UI transparency       -> usuario ve confianza y puede editar todo
```


## 14. Integracion Supabase + n8n + Claude + fuentes externas

### 14.1. Flujo de datos

```
                     SUPABASE
              ┌─────────────────────┐
              │  profiles           │
              │  price_items ◄──────┼──── Usuario configura precios
              │  margin_config      │
              │  technical_*  ◄─────┼──── BC3 importados via endpoint
              │  resolved_prices    │
              │  budgets            │
              │  budget_items       │
              │  budget_snapshots   │
              │  sector_data ◄──────┼──── n8n sincroniza periodicamente
              └────────┬────────────┘
                       │ lectura
                       v
              ┌─────────────────────┐
              │  NEXT.JS (Vercel)   │
              │                     │
              │  /api/budgets/*     │──── FASE 1-2: Claude API
              │  /api/prices/*      │──── FASE 3: price-resolver
              │  budget-engine.ts   │──── FASE 4-6: logica TS
              │  budget-economics   │
              │  budget-planner     │
              │  budget-validator   │
              └────────┬────────────┘
                       │
                       v
              ┌─────────────────────┐
              │  CLAUDE API         │
              │  (Sonnet 4)         │
              │                     │
              │  FASE 1: analyze    │──── Solo estructura, no precios
              │  FASE 2: generate   │──── Partidas con precios de banco
              └─────────────────────┘

              ┌─────────────────────┐
              │  n8n (orquestador)  │
              │                     │
              │  Workflow 1:        │──── Importar BC3 al banco tecnico
              │  technical-bc3-     │     POST /api/technical-prices/import
              │  import.json        │
              │                     │
              │  Workflow 2:        │──── Sincronizar precios proveedores
              │  Enlaze-Construccion│     Leroy / Obramat -> sector_data
              │  -reformas.json     │
              │                     │
              │  Workflow 3 (futuro)│──── Actualizar resolved_prices
              │  price-refresh      │     cuando cache expire (48h)
              └─────────────────────┘
```

### 14.2. Que hace cada pieza

```
SUPABASE:
  - Almacenamiento persistente de todos los datos
  - RLS: datos del usuario aislados, banco tecnico global (read-only)
  - resolved_prices como cache compartido de precios verificados
  - budget_snapshots para versiones e historial

CLAUDE (Sonnet 4):
  - SOLO analisis y generacion de estructura
  - NO es fuente de precios (los precios vienen del banco tecnico/resolver)
  - 2 llamadas por presupuesto, temperatura 0
  - Prompt constraintivo con JSON schema estricto

n8n:
  - Orquestador de tareas periodicas y manuales
  - Importar BC3 al banco tecnico via endpoint
  - Sincronizar precios de proveedores (Leroy, Obramat)
  - NO calcula precios, NO genera presupuestos
  - Solo mueve datos entre fuentes y Supabase

NEXT.JS:
  - Toda la logica de negocio
  - Endpoints API para wizard y edicion
  - Motores de calculo (economics, planner, validator)
  - price-resolver con cadena de 6 niveles
  - Rendering del presupuesto (cliente + interno)

FUENTES EXTERNAS:
  - BC3/FIEBDC: archivos importados manualmente o via n8n
  - Leroy Merlin / Obramat: scraping via n8n (existente)
  - SerpAPI: busqueda web de precios (nivel 5)
  - Proveedores directos: futuro via API o catalogo
```

### 14.3. Que NO hace cada pieza

```
Claude NO:     inventa precios, accede a base de datos, recuerda estado
n8n NO:        genera presupuestos, calcula margenes, parsea BC3
Supabase NO:   ejecuta logica de negocio (solo almacena + RLS)
Next.js NO:    scraping directo (eso lo hace n8n o web-price-search)
```

---

## Apendice: archivos a crear/modificar por etapa

### Etapa 1 (MVP)

```
CREAR:
  lib/types/budget-v2.ts
  lib/budget-analysis.ts
  lib/budget-generator-v2.ts
  app/api/budgets/analyze/route.ts
  app/api/budgets/generate-v2/route.ts

MODIFICAR:
  lib/price-resolver.ts  (añadir nivel 2: technical_bank)
  app/api/prices/resolve/route.ts  (pasar technicalPrices al resolver)
```

### Etapa 2

```
CREAR:
  lib/budget-economics.ts
  app/api/budgets/reprice/route.ts
```

### Etapa 3

```
CREAR:
  lib/budget-planner.ts
```

### Etapa 4

```
CREAR:
  lib/budget-validator.ts
  app/api/budgets/validate/route.ts
  supabase/migrations/YYYYMMDD_budget_snapshots.sql
```
