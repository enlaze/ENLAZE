# Análisis de arquitectura del generador de presupuestos

**Fecha:** 2026-08-23
**Estado:** análisis de solo lectura. No se ha modificado ni un archivo del proyecto.
**Objetivo:** responder a las cinco preguntas planteadas y proponer un plan por fases para aprobación.

---

## 1. Cuál es el flujo actual

### 1.1 El hallazgo más importante: hay tres generadores y solo uno está vivo

Antes de nada, conviene aclarar algo que condiciona todo el resto del análisis. En el repositorio conviven **tres pipelines de generación de presupuestos**, y el que está bien diseñado no es el que se ejecuta.

| Pipeline | Endpoint | ¿Quién lo llama? | Estado |
|---|---|---|---|
| Legacy V1 | `app/api/generate-budget/route.ts` | Nadie | Muerto |
| V2 (el "bueno") | `app/api/budgets/generate-v2/route.ts` | Nadie | Muerto |
| **Producción** | `app/api/agent/budget-analysis/route.ts` | `BudgetGenerateProvider.tsx:1754` | **Vivo** |

Lo verifiqué buscando llamadas `fetch` en todo el árbol: la única invocación desde la UI es

```
app/dashboard/budgets/generate/_components/BudgetGenerateProvider.tsx:1754
    const res = await fetch("/api/agent/budget-analysis", { ... })
```

`generate-v2` no tiene ni una sola referencia fuera de su propio comentario de cabecera. `generate-budget` solo aparece citado en un comentario de `app/api/agent/budgets/generate/route.ts:29`.

Esto importa muchísimo porque `generate-v2` ya implementa buena parte de lo que se pide: separación FASE 1 (análisis) / FASE 2 (generación) / FASE 3 (resolución determinista de precios), caché de análisis por hash de scope, prefetch paralelo de las tablas de precios, y una cascada de 11 niveles que **nunca inventa un precio**. Es decir: parte del trabajo ya está hecho, pero está desconectado. Cuando decida qué construir, buena parte será *reconectar y endurecer*, no escribir de cero.

### 1.2 El flujo que sí se ejecuta hoy

```
Usuario rellena el wizard (sector, actuaciones, superficie, descripción)
        │
        ▼
POST /api/agent/budget-analysis         ← Claude genera partidas Y precios
        │   devuelve suggested_items[] + suggested_materials[]
        │   con chapter, quantity, unit, unit_cost
        ▼
BudgetGenerateProvider.tsx (cliente)
        │
        ├─ 1678  inferBudgetActions()      si no hay actuaciones explícitas
        ├─ 1794  chapter: item.chapter || "Otros"
        ├─ 1888  si sector=construccion Y hay superficie detectada:
        │           normalizeBudgetItemsToScope()     ← filtro de scope
        ├─ 1956  si finalPartidas.length < 5:
        │           buildDeterministicBudgetItems()   ← presupuesto integral completo
        │
        ├─  936  recálculo de totales  → state.totals.clientPrice
        ├─  104  calculateBudgetFinancials()  → subtotal / base / IVA / total
        │
        ▼
Supabase
        ├─ tabla `budgets`       ← subtotal, iva_amount, total   (SOLO partidas)
        └─ tabla `budget_items`  ← partidas + materiales          (AMBOS)
        │
        ▼
POST /api/budgets/pdf
        ├─ líneas del PDF   ← budget_items   (partidas + materiales)
        └─ caja de totales  ← budgets        (solo partidas)
        ▼
lib/pdf-generator.ts → HTML → impresión nativa del navegador
```

### 1.3 Capa de precios

Existen dos resolvers deterministas, ambos correctos en su diseño:

- `lib/price-resolver.ts` — cascada de 7 niveles sobre `price_items`, `sector_data`, `technical_price_items`. Fallback final: precio 0 con confianza 0.10 (`price-resolver.ts:471-473`). No inventa.
- `lib/price-resolver-v2.ts` — cascada de 11 niveles (`manual_locked → private_tariff → negotiated → historical_approved → preferred_supplier → provider_updated → private_bc3 → technical_bank → enlaze_base → market_estimate → ai_estimate`) sobre las tablas `pb_*`. El nivel `ai_estimate` está explícitamente cableado a `return null` (`price-resolver-v2.ts:200`), y el fallback absoluto devuelve 0 con confianza 0.05 y un warning (`:166-175`). Tampoco inventa.

El requisito 4 ("nunca inventes un precio en silencio") **ya está implementado a nivel de librería**. El problema no está en los resolvers, está en que el pipeline vivo no los usa.

---

## 2. Dónde se está produciendo el problema

### 2.1 Defecto crítico: la suma de subtotales no cuadra con la base imponible

Este está localizado con precisión quirúrgica y tiene una única causa raíz.

En `BudgetGenerateProvider.tsx:936-960`, el recálculo de totales separa partidas de materiales:

```ts
state.partidas.forEach(p => {
  if (p.status !== "opcional") { directCost += p.subtotal_cost; clientPrice += p.subtotal_client; }
});
state.materials.forEach(m => {
  if (m.included) { materialsCost += m.subtotal; }     // ← nunca entra en clientPrice
});
```

`clientPrice` acumula **solo partidas**. Los materiales van a un contador aparte que jamás se suma.

Después, en `:1279-1285` (borrador) y `:1460-1466` (finalización):

```ts
const financials = calculateBudgetFinancials(
  state.totals.clientPrice,   // ← partidas only
  state.ivaPercent, state.discountType, state.discountPercent, state.discountAmount
);
```

Ese valor es el que se escribe en `budgets.subtotal`, `budgets.iva_amount` y `budgets.total`.

Pero en `:1390-1414` (saveDraft) y `:1477-1501` (finalizeBudget), la tabla `budget_items` recibe **partidas y materiales**:

```ts
const itemsToInsert = [...partidasToInsert, ...materialsToInsert];
```

Y `app/api/budgets/pdf/route.ts` imprime las líneas desde `budget_items` (`:171-181`) y la caja de totales desde la fila `budgets` (`:148-151`).

**Conclusión:** la desviación es exactamente `materialsCost × marginMultiplier`. No es un error de redondeo, es un error de origen de datos: dos fuentes de verdad distintas alimentando la misma página del PDF.

### 2.2 El mismo camino es también una doble imputación

Esto agrava el punto anterior. `applyMaterialBasketToItems` en `lib/budget-engine.ts:977-1057` existe precisamente para evitar contar los materiales dos veces: pliega el coste de la cesta de materiales dentro del coste de material de cada capítulo. El comentario del propio código lo dice: *"The basket is evidence for the chapter cost, not an extra charge"*.

Y sin embargo, el paso de persistencia vuelve a insertar esos mismos materiales como líneas independientes de cara al cliente, con margen aplicado. Los materiales se cobran una vez dentro de las partidas y otra vez como filas propias.

Es decir: el requisito 6 (evitar doble imputación) tiene el mecanismo construido y correcto, y lo estamos anulando en la última milla.

### 2.3 Defecto de gestión de residuos en un trabajo de pintura

Aquí no hay una causa, hay cuatro emisores independientes de coste de residuos y tres agujeros estructurales que dejan pasar cualquiera de ellos.

**Los cuatro emisores** (todos producen coste funcionalmente idéntico bajo nombres visibles distintos — exactamente el problema de `canonical_id` que se describe en el requisito 7):

| Ubicación | Concepto visible | Precio |
|---|---|---|
| `budget-engine.ts:611` | "Gestion de residuos y contenedores" | 290 €/ud |
| `budget-engine.ts:696` (caso `demoliciones`) | "Contenedor y transporte a gestor autorizado" | 310 €/ud |
| `budget-engine.ts:779-780` (caso `gestion_residuos`) | "Contenedores y transporte" + "Tasas y documentación" | 310 €/ud + PA |
| `budget-engine.ts:941` (`MATERIAL_SPECS`) | "Servicio de contenedor de escombros 6 m3" | 290 €/ud |

**Los tres agujeros estructurales:**

Primero, `getRequestedChapters()` (`budget-engine.ts:224-233`) devuelve `null` cuando `scope.actuaciones` está vacío. Todos los filtros del motor tienen la forma `!requestedChapters || requestedChapters.has(...)`, así que un `null` convierte cada filtro en un no-op y se emite la lista completa de capítulos integrales, residuos incluido.

Segundo, la normalización del motor solo se ejecuta bajo condición (`BudgetGenerateProvider.tsx:1888`):

```ts
if (state.sector === "construccion" && detectedArea && detectedArea > 0) { ... }
```

Sin superficie detectada, las partidas crudas de la IA se persisten sin normalizar.

Tercero, hay un desajuste de tipos en el código de capítulo. El prompt devuelve etiquetas humanas (`"Demoliciones"`), el provider aplica `chapter: item.chapter || "Otros"` (`:1794`) con O mayúscula, `detectChapter()` no llega a ejecutarse porque la etiqueta ya es truthy, y el filtro compara contra códigos canónicos en minúscula. Resultado: se descartan silenciosamente partidas legítimas de la IA, salta el fallback `finalPartidas.length < 5` (`:1956`) y `buildDeterministicBudgetItems` regenera un presupuesto integral completo — con residuos.

**Y un cuarto factor de fondo:** `wasteContainersEstimated` no puede valer 0 en un edificio existente. En `budget-engine.ts:320-322`, `demolitionRatio` vale 0.55 por defecto (`conservation_strategy = "balanced"`) y la fórmula tiene un suelo de 1 contenedor:

```ts
wasteContainersEstimated: projectContext === "new_build"
  ? Math.max(Math.ceil(area / 55), 1)
  : Math.max(Math.ceil(Math.max(demolitionArea, area * 0.15) / 30), 1),
```

Un piso de ~90 m² a pintar produce ≈2 contenedores por construcción, con `demolition = false` o sin él.

**Y un quinto, que apareció al verificar los anteriores:** `budget-engine.ts:438-439`, dentro de `normalizeBudgetItemsToScope`, sobrescribe la cantidad de *cualquier* partida del capítulo `residuos` medida en `ud`:

```ts
if (ch === "residuos" && (u === "ud" || u === "uds")) {
  newQty = q.wasteContainersEstimated;
}
```

Aunque la IA propusiera 0 o 1 contenedor, el motor la eleva a la estimación geométrica. La cantidad del modelo se descarta sin dejar rastro.

Los €2.400 del ejemplo son, por tanto, el resultado esperable del código actual, no una alucinación del modelo. Merece la pena decirlo con claridad porque cambia dónde hay que intervenir: el problema no es principalmente que la IA tenga demasiada libertad, es que el motor determinista tiene reglas cableadas que dan por supuesta una obra con demolición.

### 2.4 Dónde sí puede la IA inventar un precio

En el pipeline vivo, siempre: `agent/budget-analysis` pide a Claude un `unit_cost` ("precio unitario REALISTA de mercado espanol") y ese valor se usa directamente.

En el pipeline v2 (muerto, pero relevante para cuando lo reactivemos) queda un hueco en `app/api/budgets/generate-v2/route.ts:355`:

```ts
if (!r || r.unit_price === 0) return item;
```

Cuando el resolver no encuentra precio, el item **conserva el `unit_cost` inventado por la IA**, sin marca ni bloqueo. La cascada hace lo correcto y la línea de merge lo deshace.

---

## 3. Qué partes reutilizaría

Bastantes más de las que parece. Esta es la razón por la que no hace falta un refactor masivo.

**`lib/budget-engine.ts` (2.517 líneas)** — Es ya el motor determinista que se pide. Contiene `buildScopeQuantities` (Quantity Engine), la taxonomía de capítulos con `detectChapter`, `calculateItemCostBreakdown` (descompuestos del requisito 5), `getMarketRange`/`adjustToMarket` (semilla del `PRICE_OUTLIER` del requisito 11), `applyMaterialBasketToItems` (anti-doble-imputación del requisito 6) y **`buildClientView` / `buildInternalView`, que cubren el requisito 12 casi por completo**. El patrón del helper `add()` en `:486-505`, que comprueba capítulo permitido y capítulo ya existente antes de emitir, es exactamente la forma correcta — solo que vive dentro de una función en vez de ser la única puerta de salida.

**`lib/normalized-concepts.ts` (157 líneas)** — Matcher determinista puro, sin dependencias, con niveles de confianza (exacto 1.0 / alta ≥0.85 / revisión 0.50–0.84 / ninguna). Junto con la tabla `pb_normalized_concepts` es la semilla natural del sistema de `canonical_id` del requisito 7. No hay que escribirlo, hay que darle un registro canónico encima.

**`lib/price-resolver-v2.ts`** — La cascada de 11 niveles ya implementa "nunca inventes un precio". Reutilizable tal cual.

**`lib/budget-analysis.ts` (348 líneas)** — Es lo más parecido a un contrato de Scope Engine que ya existe: tiene un `VALID_CHAPTERS` real, sanea códigos inválidos a `"otros"`, y devuelve `required_chapters`, `required_items`, `auxiliary_items` con `quantity_formula` / `quantity_estimated` / `priority`. Ese shape es prácticamente el JSON estructurado del requisito 1.

**`lib/budget-units.ts`** — Ya tiene un `Set` de unidades canónicas con normalizador. Es el precedente de estilo a copiar para el registro de `canonical_id`.

**`state.isUndervalued` (`BudgetGenerateProvider.tsx:1447-1451`)** — Ya existe un bloqueo de finalización con toast de error. Es el gancho exacto donde enchufar la puerta de validación del requisito 14, sin inventar UI nueva.

**`lib/budget-snapshots.ts` y `lib/document-versions.ts`** — Soportan el flujo "snapshot aprobado → PDF" del requisito 13.

**`lib/effective-cost.ts`, `lib/geographic-costs.ts`, `lib/price-traceability.ts`** — Piezas de apoyo ya escritas y probadas.

**Los 26 suites `.test.mjs` de `__tests__/`** — En particular `budget-finalization`, `budget-realism`, `budget-recalculation`, `budget-ai-pdf-completion`, `atomic-materials`, `basket-price-comparison`, `price-resolution-selection`. Los 8 tests obligatorios se extienden sobre esta base, no se crea un framework nuevo.

**Lo único que no existe en absoluto** es una capa de validación. No hay ningún `lib/validation*`, ni `rules*`, ni `scope*` como módulo independiente. Eso sí hay que escribirlo.

---

## 4. Qué archivos, tablas y endpoints habría que tocar

### Archivos nuevos (aditivos, sin riesgo de regresión)

```
lib/canonical/registry.ts          registro de canonical_id + resolución desde concepto
lib/scope/scope-engine.ts          obligatorio / opcional / incompatible / prohibido por oficio
lib/scope/rules/painting.ts        primer oficio; el resto se añade después
lib/validation/validators.ts       scope, cantidad, precio, duplicado, compatibilidad, matemática
lib/validation/types.ts            { valid, errors[], warnings[], checks{} }
lib/money.ts                       aritmética monetaria en enteros de céntimo
```

### Archivos existentes a modificar (ediciones acotadas)

| Archivo | Cambio | Riesgo |
|---|---|---|
| `BudgetGenerateProvider.tsx:936-960` | incluir materiales en `clientPrice` **o** dejar de insertarlos como líneas | Medio — decisión de producto, ver §6 |
| `BudgetGenerateProvider.tsx:1794` | usar código canónico en minúscula, no `"Otros"` | Bajo |
| `BudgetGenerateProvider.tsx:1888` | quitar la condición de superficie; normalizar siempre | Medio |
| `BudgetGenerateProvider.tsx:1447` | añadir la puerta de validación junto a `isUndervalued` | Bajo |
| `budget-engine.ts:224-233` | `getRequestedChapters` devuelve conjunto vacío explícito, no `null` | **Alto** — cambia el comportamiento de todos los filtros |
| `budget-engine.ts:611,696,779,941` | unificar los 4 emisores bajo `WASTE.CONTAINER.6M3` | Medio |
| `budget-engine.ts:320-322` | `wasteContainersEstimated = 0` cuando no hay demolición | Medio |
| `budget-engine.ts:438-439` | no sobrescribir la cantidad de residuos si el scope la veta | Medio |
| `app/api/agent/budget-analysis/route.ts` | el prompt deja de pedir `unit_cost`; devuelve solo estructura | Medio |
| `app/api/budgets/pdf/route.ts` | leer totales y líneas del mismo snapshot | Bajo |
| `app/api/budgets/generate-v2/route.ts:355` | no conservar el precio de la IA cuando el resolver falla | Bajo — está muerto |

### Tablas Supabase

Ninguna migración destructiva. Solo columnas nuevas anulables, todas retrocompatibles:

- `budget_items`: `canonical_id TEXT NULL`, `quantity_source TEXT NULL`, `price_type TEXT NULL`, `price_confidence NUMERIC NULL`
- `budgets`: `validation_report JSONB NULL`, `validated_at TIMESTAMPTZ NULL`
- Tabla nueva `canonical_concepts` (id, familia, oficio, unidad por defecto, `price_type`) — es un catálogo, no toca nada existente.

Sin renombrados, sin cambios de tipo, sin `NOT NULL` en columnas nuevas. Todo el código actual sigue funcionando ignorando esas columnas.

### Endpoints

No propongo crear ni renombrar ningún endpoint público en las primeras fases. La validación se expone como función de librería llamada desde el provider, y opcionalmente más adelante como `POST /api/budgets/validate` si la UI lo necesita en tiempo real.

---

## 5. Arquitectura propuesta

El principio rector que planteas —*"LLM propone. Backend decide. Base de datos aporta evidencia. Validador autoriza"*— se traduce en cuatro fronteras duras:

```
  USUARIO
     │  texto libre + parámetros del wizard
     ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. AI INTERPRETATION LAYER                                  │
│    Claude → JSON estructurado                               │
│    trade, project_type, rooms[], walls, ceilings,           │
│    wall_condition, demolition, coats                        │
│    PROHIBIDO devolver: precios, importes, IVA, partidas     │
└─────────────────────────────────────────────────────────────┘
     │  FRONTERA 1: aquí muere la libertad del modelo
     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. SCOPE ENGINE                (determinista, backend)      │
│    reglas por oficio → canonical_id[]                       │
│    mandatory / optional / incompatible / FORBIDDEN          │
│    pintura + demolition=false ⇒ WASTE.CONTAINER.6M3 vetado  │
└─────────────────────────────────────────────────────────────┘
     ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. QUANTITY ENGINE                                          │
│    toda cantidad lleva quantitySource:                      │
│    USER | MEASUREMENT | CALCULATED | ESTIMATED | AI_ESTIMATE│
│    + confidence + requires_confirmation                     │
└─────────────────────────────────────────────────────────────┘
     ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. PRICE ENGINE          (price-resolver-v2, ya existe)     │
│    cascada 11 niveles · nunca inventa · devuelve priceType  │
│    sin precio ⇒ "PENDIENTE", nunca un número plausible      │
└─────────────────────────────────────────────────────────────┘
     ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. RULES ENGINE                                             │
│    reglas declarativas por oficio, no ifs dispersos         │
│    registro extensible: pintura, albañilería, baños, ...    │
└─────────────────────────────────────────────────────────────┘
     ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. VALIDATION ENGINE                                        │
│    scope · cantidad · precio · duplicado · compatibilidad · │
│    matemática · outlier                                     │
│    → { valid, errors[], warnings[], checks{} }              │
│    ERROR bloquea · WARNING permite con revisión             │
└─────────────────────────────────────────────────────────────┘
     │  FRONTERA 2: sin autorización no se pasa
     ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. BUDGET ENGINE                                            │
│    lineTotal = qty × unitPrice   (céntimos enteros)         │
│    subtotal = Σ lineTotals                                  │
│    taxBase  = subtotal − descuento                          │
│    VAT      = taxBase × tipo                                │
│    total    = taxBase + VAT                                 │
│    assert(displayedSubtotal === calculatedSubtotal)         │
│    else → BUDGET_TOTAL_MISMATCH, se bloquea                 │
└─────────────────────────────────────────────────────────────┘
     │  FRONTERA 3: snapshot inmutable
     ▼
┌─────────────────────────────────────────────────────────────┐
│ 8. PDF RENDERER                                             │
│    lee el snapshot y nada más                               │
│    no recalcula · no consulta precios · no llama al LLM     │
└─────────────────────────────────────────────────────────────┘
```

Tres decisiones de diseño que quiero destacar porque resuelven problemas concretos que hemos encontrado:

**Una sola puerta de emisión de partidas.** El patrón `add()` de `budget-engine.ts:486-505` pasa a ser la *única* forma de que una partida entre en un presupuesto, y comprueba `canonical_id` contra el veredicto del Scope Engine. Los cuatro emisores de residuos dejan de ser cuatro caminos y pasan a ser cuatro llamadas a la misma puerta con el mismo `canonical_id` — con lo cual el duplicado es detectable por construcción, no por heurística de texto.

**Aritmética en céntimos enteros.** `calculateBudgetFinancials` mezcla `Math.round(x*100)/100` en unos sitios y coma flotante cruda en otros (el IVA en `:104-126` no se redondea). Con enteros de céntimo el `assert` del requisito 9 se puede exigir con igualdad estricta en vez de con épsilon.

**Un único snapshot alimenta el PDF.** Hoy hay cuatro totales independientes circulando (fila `budgets`, suma de `budget_items`, `clientView.total`, `internalView.totals`). El snapshot los colapsa a uno.

---

## 6. Plan de implementación por fases

Ordenado por relación valor/riesgo. Cada fase es entregable y testeable por separado. **Ninguna fase empieza sin tu visto bueno explícito.**

### Fase 0 — Red de seguridad (sin cambios de comportamiento)

Escribir los 8 tests obligatorios contra el código *actual*. Siete fallarán. Eso es el objetivo: fijar por escrito qué está roto antes de tocar nada, y tener detección de regresión desde el minuto uno.

Coste estimado: bajo. Riesgo: nulo.

### Fase 1 — Cuadrar las matemáticas

El defecto crítico, y el más barato de arreglar.

Hay una decisión de producto que necesito de ti antes de escribir código, porque las dos salidas son válidas y llevan a PDFs distintos:

- **Opción A** — los materiales dejan de insertarse en `budget_items` como líneas de cliente. Coherente con `applyMaterialBasketToItems`: el material ya está dentro del precio de la partida. El PDF del cliente muestra partidas de obra, que es lo habitual en el sector. Elimina la doble imputación.
- **Opción B** — los materiales siguen siendo líneas visibles y se suman a `clientPrice`. El presupuesto es más transparente para el cliente, pero hay que restar su coste del coste de material de las partidas para no cobrarlo dos veces.

Mi recomendación es la **A**: es menos código, elimina el defecto y la doble imputación de un golpe, y es lo que espera un cliente de reformas. Pero es tu decisión comercial, no mía.

Además, en esta fase: `lib/money.ts` con enteros de céntimo, y el `assert` `BUDGET_TOTAL_MISMATCH` bloqueando guardado y PDF.

Coste: bajo. Riesgo: medio (toca persistencia). Cubre TEST 4 y TEST 5.

### Fase 2 — Identificadores canónicos y detección de duplicados

Crear `canonical_concepts` y `lib/canonical/registry.ts`. Etiquetar los conceptos que ya emite el motor, empezando por los cuatro de residuos. Añadir `canonical_id` a `budget_items` como columna anulable. Validador de duplicados sobre `canonical_id`, apoyado en `normalized-concepts.ts` para el matching de lo que aún no esté etiquetado.

Coste: medio. Riesgo: bajo (todo aditivo). Cubre TEST 2.

### Fase 3 — Scope Engine para pintura

Un solo oficio, para validar la arquitectura de reglas antes de generalizar. Reglas declarativas para pintura, `WASTE.CONTAINER.6M3` prohibido cuando `demolition = false`. Cerrar los tres agujeros: `getRequestedChapters` con conjunto vacío explícito, normalización incondicional, códigos de capítulo canónicos. Y `wasteContainersEstimated = 0` cuando no hay demolición.

Coste: medio. Riesgo: **alto** — el cambio en `getRequestedChapters` altera el comportamiento de todos los filtros del motor. Aquí es donde los tests de la Fase 0 se ganan el sueldo.

Cubre TEST 1.

### Fase 4 — Validation Engine y puerta pre-PDF

`lib/validation/validators.ts` con los seis validadores. El checklist visual (✓ Alcance válido, ✓ Cantidades verificadas, ...) enganchado al mecanismo existente de `isUndervalued`. Botón "Generar PDF 🔒 — N errores" cuando hay errores críticos.

Coste: medio. Riesgo: bajo. Cubre TEST 3.

### Fase 5 — Endurecer el prompt y la capa de interpretación

El prompt de `agent/budget-analysis` deja de pedir `unit_cost` y `chapter` en etiqueta humana, y pasa a devolver el JSON estructurado del requisito 1. Introducir `quantitySource` y `requires_confirmation`.

Esta fase va deliberadamente al final: cambiar el prompt sin la red determinista debajo es sustituir un comportamiento impredecible por otro.

Coste: medio. Riesgo: medio. Cubre TEST 6 y TEST 7.

### Fase 6 — Outliers y resto de oficios

Percentiles P25/P50/P75/P95 sobre histórico, aprovechando `getMarketRange`. `PRICE_OUTLIER` como warning, no como bloqueo. Y replicar el patrón de reglas de la Fase 3 al resto de oficios.

Coste: alto. Riesgo: bajo. Cubre TEST 8.

### Consideración transversal: reconectar V2

En algún punto entre las fases 3 y 5 hay que decidir qué hacemos con `generate-v2`. Tiene la forma correcta y está muerto. Las opciones son migrar el wizard hacia él, absorber sus piezas en el camino vivo, o borrarlo. Mantener 519 líneas de pipeline paralelo sin usar tiene un coste de mantenimiento y de confusión que ya estamos pagando. Lo dejo señalado para que lo decidas cuando lleguemos.

---

## 7. Los 8 tests obligatorios

| # | Escenario | Resultado esperado | Fase |
|---|---|---|---|
| 1 | Pintura interior sin demolición | `WASTE.CONTAINER.6M3` rechazado | 3 |
| 2 | Dos líneas con el mismo `canonical_id` | duplicado detectado | 2 |
| 3 | Línea con precio que incluye material + mismo material aparte | doble imputación detectada | 4 |
| 4 | Σ líneas ≠ subtotal | bloqueo `BUDGET_TOTAL_MISMATCH` | 1 |
| 5 | subtotal + IVA ≠ total | bloqueo | 1 |
| 6 | Cantidad estimada por IA | `requires_confirmation = true` | 5 |
| 7 | Precio no encontrado en BD | no se inventa; se marca pendiente | 5 |
| 8 | Presupuesto muy por encima del histórico | `PRICE_OUTLIER` | 6 |

Se escriben todos en la Fase 0 y se van poniendo en verde fase a fase.

---

## Qué necesito de ti para continuar

1. **Aprobación del plan por fases**, o los ajustes de orden que prefieras.
2. **La decisión Opción A vs Opción B de la Fase 1** — es la única que no puedo tomar yo, porque cambia lo que ve el cliente en el PDF.
3. Confirmación de que puedo empezar por la **Fase 0**, que no modifica ningún comportamiento y solo añade archivos en `__tests__/`.

No he tocado ni un archivo del proyecto. Nada se mueve hasta que digas.
