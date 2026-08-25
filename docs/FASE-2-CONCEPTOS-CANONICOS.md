# Fase 2 — Identificadores canónicos y detección de duplicados

**Estado: CONGELADO (v5) — 2026-08-24**

Documento de diseño cerrado. A partir de esta fecha no se admite rediseño salvo que
aparezca un problema crítico durante la implementación. Cualquier cambio posterior debe
registrarse como enmienda al final de este documento, con fecha y motivo.

Fases previas: Fase 0 y Fase 1 cerradas en el commit `a90e20c` (Opción A, fuente
matemática única en `lib/budget-totals.ts`, aritmética en céntimos enteros en
`lib/money.ts`, marcador `totals_contract: "v2-partidas-only"`).

---

## 1. Objetivo y alcance

Introducir un identificador canónico estable que permita a Enlaze reconocer que dos
descripciones distintas representan el mismo concepto económico, y detectar
automáticamente duplicados y dobles imputaciones.

**Fase 2 es observadora.** No bloquea el guardado, ni la finalización, ni la generación
de PDF. No modifica ningún importe. Su criterio de salida es cobertura canónica sobre
las filas existentes con cero variación económica.

Fuera de alcance (Fase 3 y posteriores): el Scope/Rules Engine que decide *cuándo*
procede un concepto, la unificación de los cuatro emisores de residuos, y el rediseño de
la persistencia del escandallo (`is_client_line`, `parent_item_id`, composiciones por
empresa).

### 1.1 Defectos reales que motivan la fase

Verificados sobre datos de producción:

- Presupuesto `55082c1b`: cuatro líneas de residuos solapadas, con
  "Contenedor y transporte a gestor autorizado" y "Contenedores y transporte" idénticas
  (6 ud × 717,50 = 4.305,02 € duplicados).
- Presupuesto `03d6b1b0`: "Contenedores y transporte" y
  "Servicio de contenedor de escombros 6 m³" con la misma cantidad, unidad y precio
  (3 ud × 348,00), distinto nombre y distinta categoría.
- El mismo cubo de pintura de 15 L aparece a 7,80, 42,00 y 52,80 € en presupuestos
  distintos, bajo nombres distintos.
- `technical_price_items.item_code` colisiona entre bancos: `02.001` es
  "Tubería multicapa 16 mm" en `enlaze_base` y "ud Instalación punto de agua" en
  `public_bc3`.
- `budget_items.concept` es copia literal de `budget_items.name` en las 807 filas:
  no aporta información.
- `pb_normalized_concepts` **no existe**. `lib/normalized-concepts.ts` y el tipo
  `PBNormalizedConcept` apuntan a una tabla fantasma. `pb_products.concept_id` existe
  como `uuid` sin FK y está a NULL en las 42.221 filas.

---

## 2. Gramática de identificadores

```
<KIND>.<DOMAIN>.<FAMILY>.<CONCEPT>[.<VARIANT>]
```

Idéntica para los tres tipos. Cuatro segmentos obligatorios, un quinto opcional.

```
^(WORK|MAT|SRV)(\.[A-Z0-9][A-Z0-9_]*){3,4}$
```

- **KIND** — `WORK` (unidad de obra ejecutada), `MAT` (material o producto),
  `SRV` (servicio contratado a un tercero).
- **DOMAIN** — vocabulario cerrado de 20 valores en `canonical_domains`. Para
  `kind = 'WORK'` se corresponde **1:1** con el `chapter_code` de `VALID_CHAPTERS`
  (`lib/budget-analysis.ts:154-159`), garantizado por la unicidad de
  `canonical_domains.chapter_code`.
- **FAMILY** — agrupación funcional dentro del dominio.
- **CONCEPT** — el concepto económico.
- **VARIANT** — solo cuando altera el precio unitario de forma estructural
  (`2COATS`, `6M3`).

En `MAT` y `SRV`, `DOMAIN` es el **dominio de origen**, no una restricción de uso:
`MAT.CLADDING.ADHESIVE.CEMENT` puede usarlo una partida de `FLOORING`. El uso cruzado se
expresa con relaciones `includes`, sin límite de dominio. Un material transversal
(tornillería, silicona) va a `OTHER`.

**No forman parte de la identidad**: el formato de envase (vive en `pb_products`), el
precio, el ámbito económico (`price_type`), la marca y el proveedor.

### 2.1 Vocabulario de dominios

| DOMAIN | chapter_code | DOMAIN | chapter_code |
|---|---|---|---|
| PROTECT | protecciones | PAINT | pintura |
| DEMO | demoliciones | JOINERY_INT | carpinteria_interior |
| MASONRY | albanileria | JOINERY_EXT | carpinteria_exterior |
| PLUMBING | fontaneria | SANITARY | sanitarios |
| ELECTRIC | electricidad | KITCHEN | cocina |
| WATERPROOF | impermeabilizacion | HVAC | climatizacion |
| CLADDING | revestimientos | CEILING | falsos_techos |
| FLOORING | pavimentos | WASTE | residuos |
| SKIRTING | rodapie | CLEANING | limpieza |
| | | SAFETY | seguridad |
| | | OTHER | otros |

---

## 3. Modelo de datos

### 3.1 Clave dual

`canonical_concepts` tiene `id uuid` (clave técnica) y `canonical_id text unique`
(clave semántica). No es redundancia: `pb_products.concept_id` ya es `uuid`, así que se
reutiliza tal cual con una FK hacia `id`, sin rename ni cambio de tipo ni backfill.
`budget_items` referencia en cambio el **texto**, porque es el registro económico
auditable donde un identificador legible permite detectar un duplicado a simple vista, y
porque el contrato del TEST 2 está escrito con literales de texto.

### 3.2 Vocabulario global e inmutable

`canonical_concepts`, `canonical_domains` y `canonical_concept_relations` **no llevan
`company_id`**. El vocabulario es único para todas las empresas; si no lo fuera, el
identificador no serviría para comparar precios entre empresas ni para alimentar el banco
de precios, que es su razón de ser. RLS: `select` para `authenticated`, sin políticas de
escritura. Solo `service_role` modifica, vía migración.

La personalización de empresa vive exclusivamente en `canonical_aliases.company_id`, en
las tarifas ya existentes, y en las composiciones que llegarán en Fase 4.

### 3.3 Ámbito económico variable

El mismo trabajo puede presupuestarse como mano de obra sola o como suministro más
ejecución. El concepto declara `default_price_type` y `allowed_price_types[]`; la línea
declara en `budget_items.price_type` el ámbito realmente usado.

Valores: `LABOR_ONLY`, `MATERIAL_ONLY`, `LABOR_AND_MATERIAL`, `SERVICE`.

### 3.4 Relaciones

Solo tres, todas descriptivas: `includes`, `provides`, `variant_of`. `excludes` y
`requires_any` quedan **fuera**: son reglas de alcance y pertenecen al Scope/Rules Engine
de Fase 3. El registro canónico describe *qué es* un concepto, no *cuándo* procede. La
sustitución de conceptos obsoletos se resuelve con `superseded_by`, no con una relación.

### 3.5 Alias: exactos frente a sinónimos

Un **alias exacto** identifica un concepto sin ambigüedad, con confianza 1.00, y resuelve
automáticamente. Un **sinónimo** es material para el matcher difuso, puede ser ambiguo por
naturaleza, y su techo es `review`.

Caso real de ambigüedad: "Cinta de enmascarar y plastico protector" designa a la vez
`MAT.PAINT.MASKING.TAPE` y `MAT.PAINT.MASKING.FILM`, con precios de 0,37 € y 38,40 € en
producción. El modelo debe **poder representar** esa ambigüedad, no prohibirla. Cuando la
búsqueda por sinónimo devuelve más de un concepto, el resultado es `ambiguous` con
`canonical_id` a NULL. Un sinónimo ambiguo no resuelve nunca automáticamente.

### 3.6 Procedencia y fuente concreta

`canonical_aliases.source` es la **clase de procedencia** (vocabulario cerrado de cinco
valores que gobierna la precedencia general). `canonical_aliases.source_ref` es la
**instancia concreta**: `cype`, `public_bc3`, `enlaze_base`, `obramat`. Obligatorio para
`import` y `provider`, prohibido para `manual`, `curated` y `engine`.

Sin `source_ref` volveríamos a mezclar CYPE, BC3 y proveedores bajo una misma identidad,
que es el defecto ya verificado del `item_code` colisionante.

### 3.7 Aislamiento multiempresa

`canonical_aliases.company_id uuid NULL`: NULL = alias global de Enlaze; UUID = alias
privado de una empresa. Se replica la convención ya establecida en `pb_providers` y
`pb_price_sources`, donde `company_id` se compara contra `auth.uid()` y no tiene FK.

El aislamiento se apoya en **tres capas independientes**: la RLS
(`company_id is null or company_id = auth.uid()`), un **predicado explícito de tenant en
cada consulta del resolver** (porque el backfill corre como `service_role` y salta la
RLS), y una **aserción en memoria** que lanza `TENANT_LEAK` si alguna fila devuelta trae
un `company_id` ajeno.

> **Deuda técnica DT-002.** La convención existente es `company_id = auth.uid()`: la
> empresa *es* el usuario. Para un cliente objetivo de 1 a 10 empleados eso se rompe en
> cuanto hay un segundo usuario. Se replica ahora por coherencia con `pb_providers` y
> `pb_price_sources`; el día que exista una tabla de empresas real habrá que migrar las
> tres a la vez. No es bloqueante para Fase 2.

---

## 4. Precedencia y resolución

### 4.1 Precedencia general

| `general_rank` | `source` | `source_specific` | `requires_source_ref` |
|---|---|---|---|
| 1 | `manual` | no | no |
| 2 | `curated` | no | no |
| 3 | `engine` | **sí** | no |
| 4 | `import` | **sí** | **sí** |
| 5 | `provider` | **sí** | **sí** |

La prioridad efectiva es la tupla `(general_rank, tenant_class)` ascendente, donde
`tenant_class = 0` si `company_id IS NOT NULL` y `1` si es NULL: dentro de la misma
procedencia, lo privado de la empresa gana a lo global.

`provider` va última porque el nombre comercial es la fuente más ruidosa y la que más
colisiona entre catálogos.

### 4.2 Resolución en dos niveles

**Nivel 1 — identidad de la fuente.** Cuando conocemos el origen y es determinista
(`engine`, `import`, `provider`), se resuelve **exclusivamente** dentro de esa
procedencia. Para `import` y `provider`, además, dentro de `source + source_ref`. Si no
conocemos `source_ref`, el nivel 1 se **omite**: no se inventa y no se busca "en todos los
bancos".

**Nivel 2 — precedencia general.** Se aplica cuando el origen es `free_text` o `ai` (ver
E-004: `ai` no es una procedencia de alias, así que nunca entra en el nivel 1), o cuando el
nivel 1 no encontró nada. Aquí no se filtra por `source_ref`, así que si un texto coincide
con un alias de CYPE y otro de BC3 apuntando a conceptos distintos, ambos empatan en
`general_rank = 4` y el resultado es `ambiguous`. Sin conocer el banco, la respuesta
correcta es no elegir.

### 4.3 Regla dura sobre el origen `engine`

**Para `origin = 'engine'`, el resolver fuerza `effective_company_id = null` en todas sus
consultas, en los dos niveles y en todas las etapas.** Una partida emitida por
`budget-engine.ts` no puede ser reinterpretada por ningún alias privado de ninguna
empresa, ni exacto ni sinónimo. Si el mapeo de un literal del engine está mal, se corrige
en el seed de Enlaze.

Residual conocido y aceptado: si una empresa teclea como **texto libre** una cadena que
coincide con un literal del engine y tiene un alias manual para ella, ese alias gana. La
línea tiene `origin = 'free_text'`, no fue generada determinísticamente, y queda
registrada como `canonical_source = 'exact_manual'`, así que es auditable.

### 4.4 Origen `legacy`

No podemos afirmar que las 807 filas históricas sean output puro del engine: puede haber
presupuestos editados o procedentes de pipelines anteriores. **Un histórico sin
procedencia demostrable no debe recibir una procedencia inventada.**

`origin = 'legacy'`:

- usa `effective_company_id = null`: solo aliases globales, nunca privados;
- **omite el nivel 1** salvo que exista evidencia persistida del origen
  (`canonical_origin` no nulo y, si procede, `canonical_source_ref` no nulo);
- restringe el nivel 2 a las procedencias con `requires_source_ref = false`
  (`manual` global, `curated`, `engine`); los aliases exactos de `import` y `provider`
  quedan excluidos, porque sin saber el banco `02.001` es literalmente dos conceptos;
- **nunca produce `resolved` desde una fuente source-specific**; ante la duda, `review` o
  `unmatched`.

Que una fila `legacy` resuelva por un alias `engine` y quede con
`canonical_source = 'exact_engine'` no es inventarle procedencia: `canonical_source`
describe *qué alias ganó*, mientras que la procedencia de la fila vive en
`canonical_origin` y dirá `legacy`, que es la verdad.

### 4.5 Algoritmo

```
resolveCanonical(input, ctx):

  ctx = { company_id: string|null,
          origin: 'engine'|'ai'|'import'|'provider'|'free_text'|'legacy',
          source_ref?: string|null }

  effective_company = (ctx.origin in {engine, legacy}) ? null : ctx.company_id

  ── NIVEL 1 · SOURCE-SPECIFIC ────────────────────────────────
  aplicable si ctx.origin in {engine, import, provider}
            y (origin == engine  o  ctx.source_ref is not null)
  para legacy: solo si hay evidencia persistida en la fila

      rows = exactAliases(norm, source = ctx.origin,
                          source_ref = ctx.source_ref,
                          effective_company)
      assertNoTenantLeak(rows, effective_company)
      winners = rows con tenant_class mínimo
      ids     = distinct(winners.canonical_id)
      |ids| == 1  → resolved,  1.00, source 'exact_' || ctx.origin
      |ids| >  1  → ambiguous,       source 'exact_' || ctx.origin
      vacío       → continúa al nivel 2

  ── NIVEL 2 · GENERAL ────────────────────────────────────────
  para legacy: solo procedencias con requires_source_ref = false

      rows = exactAliases(norm, todas las procedencias, effective_company)
      assertNoTenantLeak(rows, effective_company)
      winners = rows con (general_rank, tenant_class) mínimo
      ids     = distinct(winners.canonical_id)
      |ids| == 1  → resolved,  1.00, source 'exact_' || winner.source
      |ids| >  1  → ambiguous,       source 'exact_' || winner.source

      rows = synonymAliases(norm, effective_company)   -- misma tupla
      assertNoTenantLeak(rows, effective_company)
      |ids| == 1  → review,    confidence del alias, source 'synonym'
      |ids| >  1  → ambiguous,                       source 'synonym'

      fingerprint(input, presupuesto)   -- cantidad, unidad, precio ±2 %
      acierta     → review,    0.60,   source 'fingerprint'

  → unmatched
```

Ninguna consulta carece de `ORDER BY` completo. El último criterio de orden
(`canonical_id asc`) es **presentacional**: nunca decide, porque la decisión está
bloqueada por el guard de ambigüedad.

### 4.6 Normalización: una sola fuente de verdad

`alias_norm` es una **columna generada** por la función SQL inmutable
`canonical_normalize(text)`. El resolver consulta con
`where a.alias_norm = canonical_normalize($1)`, de modo que la normalización vive en un
único sitio y el seed no puede desincronizarse de ella. Un test de paridad verifica que
`normalizeForMatching` de `lib/normalized-concepts.ts` produce el mismo resultado para un
corpus de cadenas reales.

---

## 5. Contratos de estado

### 5.1 Confianza

| mecanismo | confidence | status |
|---|---|---|
| exacto (incl. `override`, `generator`) | `= 1.00` | `resolved` |
| sinónimo | `>= 0.50` y `< 0.85` | `review` |
| huella numérica | `>= 0.50` y `< 0.85` | `review` |

La franja `[0.85, 1.00)` queda **vacía por diseño**. Los sinónimos del seed se reescalan
a 0.80 (coincidencia exacta del matcher) y 0.70 (substring); los scores crudos 0.95 y 0.88
de `lib/normalized-concepts.ts` son puntuaciones del matcher, no confidences
persistibles.

### 5.2 Combinaciones legales en `budget_items`

| `canonical_status` | `canonical_id` | `canonical_confidence` | `canonical_source` |
|---|---|---|---|
| `unmatched` | NULL | NULL | NULL |
| `resolved` | NOT NULL | `= 1.00` | `override`, `generator`, `exact_manual`, `exact_curated`, `exact_engine`, `exact_import`, `exact_provider` |
| `review` | NOT NULL | `>= 0.50` y `< 0.85` | `synonym`, `fingerprint` |
| `ambiguous` | NULL | NULL | `synonym`, `fingerprint`, `exact_*` |

`ambiguous` fuerza `canonical_id` a NULL: aunque el resolver tuviera un fallo, la base de
datos rechaza la fila. `review` exige candidato, porque un estado de revisión sin
candidato es indistinguible de `unmatched`.

### 5.3 Origen y fuente concreta en `budget_items`

| `canonical_origin` | `canonical_source_ref` |
|---|---|
| `import`, `provider` | **obligatorio** |
| `engine`, `ai`, `free_text`, `legacy` | **prohibido** |
| NULL (transición) | **prohibido** |

Ambos CHECK se implementan con `CASE ... ELSE false`, no con `OR` encadenados, para que
la lógica trivaluada de SQL no deje pasar filas con NULL. Un `OR` de disyuntivos que
evalúan a NULL satisface un CHECK en PostgreSQL; el `CASE` lo impide.

### 5.4 Códigos de error del validador

- `DUPLICATE_CANONICAL_ID` — dos líneas con el mismo `canonical_id`.
- `OVERLAPPING_CANONICAL_SCOPE` — coexisten un concepto y otro que lo `includes`.
- `MATERIAL_DOUBLE_IMPUTATION` — A `includes` B, B existe como línea independiente y
  `A.price_type ∈ {LABOR_AND_MATERIAL, SERVICE}`. Con `A.price_type = LABOR_ONLY` **no hay
  error**: B complementa a A. Con ambas `MATERIAL_ONLY` y el mismo id, el error es
  `DUPLICATE_CANONICAL_ID`.
- `PRICE_TYPE_NOT_ALLOWED` — el `price_type` de la línea no está en
  `allowed_price_types` del concepto.

Como la Opción A de Fase 1 ya impide insertar materiales como líneas económicas
independientes, `MATERIAL_DOUBLE_IMPUTATION` no debería dispararse nunca hoy: actúa como
**canario de regresión** del contrato de Fase 1.

---

## 6. Catálogo inicial (20 conceptos)

### 6.1 Pintura — obra

| canonical_id | Nombre | Ud | default_price_type |
|---|---|---|---|
| `WORK.PAINT.PREP.MASKING` | Protección de superficies y mobiliario | PA | LABOR_AND_MATERIAL |
| `WORK.PAINT.PREP.SURFACE` | Preparación y reparación de paramentos | m2 | LABOR_AND_MATERIAL |
| `WORK.PAINT.PRIMER.APPLY` | Imprimación de paredes y techos | m2 | LABOR_AND_MATERIAL |
| `WORK.PAINT.EMULSION.WALL.2COATS` | Pintura plástica en paredes, dos manos | m2 | LABOR_AND_MATERIAL |
| `WORK.PAINT.EMULSION.CEILING.2COATS` | Pintura plástica en techos, dos manos | m2 | LABOR_AND_MATERIAL |

### 6.2 Pintura — materiales

| canonical_id | Nombre | Ud | MATERIAL_SPECS |
|---|---|---|---|
| `MAT.PAINT.EMULSION.INTERIOR_MATT` | Pintura plástica mate interior | l | `paint-white-matt-15` |
| `MAT.PAINT.PRIMER.ACRYLIC` | Imprimación / fondo fijador acrílico | l | `primer-water-15` |
| `MAT.PAINT.FILLER.POWDER` | Plaste en polvo para renovación | kg | `interior-repair-putty-15` |
| `MAT.PAINT.MASKING.TAPE` | Cinta de enmascarar | ud | `masking-tape-50-50` |
| `MAT.PAINT.MASKING.FILM` | Plástico cubretodo protector | ud | `protective-film-4-5` |
| `MAT.PAINT.TOOL.ROLLER` | Rodillo de pintura | ud | `paint-roller-22` |
| `MAT.PAINT.TOOL.BRUSH` | Brocha de pintura | ud | `paint-brush-40` |
| `MAT.PAINT.TOOL.TRAY` | Cubeta de pintura con rejilla | ud | `paint-tray-16` |

Todos `MATERIAL_ONLY`.

### 6.3 Residuos y protecciones

| canonical_id | Nombre | Ud | Emisor actual |
|---|---|---|---|
| `WORK.WASTE.MANAGEMENT.FULL` | Gestión integral de residuos | PA | `budget-engine.ts:611` |
| `WORK.WASTE.CONTAINER.HAUL` | Contenedor y transporte a gestor autorizado | ud | `:696` y `:779` |
| `WORK.WASTE.CONTAINER.HAUL.6M3` | Contenedor 6 m³ y transporte a gestor | ud | variante dimensional |
| `WORK.WASTE.FEE.DISPOSAL` | Tasas, pesaje y justificantes de vertido | PA | `:780` |
| `SRV.WASTE.CONTAINER.HAUL` | Servicio de contenedor y retirada | ud | — |
| `SRV.WASTE.CONTAINER.HAUL.6M3` | Servicio de contenedor de escombros 6 m³ | ud | `MATERIAL_SPECS` |
| `WORK.PROTECT.SITE.COVERING` | Protección de zonas conservadas | PA | compartido |

### 6.4 Contenedor de obra frente a servicio de contenedor

`WORK.WASTE.CONTAINER.HAUL.6M3` y `SRV.WASTE.CONTAINER.HAUL.6M3` **no comparten
`canonical_id`**. Son el mismo hecho físico visto desde dos lados del margen: la partida
que se factura al cliente a 348 € y el servicio que se compra al gestor a 290 €.
Fundirlos destruiría la trazabilidad `technical_price_items.14.001 → 290 × 1,20 = 348`.
Se relacionan con `provides`.

### 6.5 Relaciones del seed

```
SRV.WASTE.CONTAINER.HAUL.6M3    --provides-->   WORK.WASTE.CONTAINER.HAUL.6M3
SRV.WASTE.CONTAINER.HAUL        --provides-->   WORK.WASTE.CONTAINER.HAUL
WORK.WASTE.CONTAINER.HAUL.6M3   --variant_of--> WORK.WASTE.CONTAINER.HAUL
SRV.WASTE.CONTAINER.HAUL.6M3    --variant_of--> SRV.WASTE.CONTAINER.HAUL
WORK.WASTE.MANAGEMENT.FULL      --includes-->   WORK.WASTE.CONTAINER.HAUL
WORK.WASTE.MANAGEMENT.FULL      --includes-->   WORK.WASTE.FEE.DISPOSAL
WORK.PAINT.EMULSION.WALL.2COATS --includes-->   MAT.PAINT.EMULSION.INTERIOR_MATT
WORK.PAINT.EMULSION.CEILING.2COATS --includes--> MAT.PAINT.EMULSION.INTERIOR_MATT
WORK.PAINT.PRIMER.APPLY         --includes-->   MAT.PAINT.PRIMER.ACRYLIC
WORK.PAINT.PREP.SURFACE         --includes-->   MAT.PAINT.FILLER.POWDER
WORK.PAINT.PREP.MASKING         --includes-->   MAT.PAINT.MASKING.TAPE
WORK.PAINT.PREP.MASKING         --includes-->   MAT.PAINT.MASKING.FILM
```

---

## 7. Orden de implementación

| # | Paso | Artefacto |
|---|---|---|
| 1 | Congelar diseño y marcador `concepts_contract: "v1-canonical"` | este documento |
| 2 | Vocabulario de dominios | `20260824095335_canonical_domains.sql` |
| 3 | Registro canónico | `20260824095816_canonical_concepts.sql` |
| 4 | Procedencias y precedencia | `20260824101019_canonical_alias_sources.sql` |
| 5 | Alias y normalizador | `20260824101548_canonical_aliases.sql` |
| 6 | Relaciones | `20260824112605_canonical_relations.sql` |
| 7 | Seed pintura y residuos | `20260824120500_canonical_seed_paint_waste.sql` |
| 8 | Columnas canónicas en `budget_items` | `20260824120600_budget_items_canonical.sql` |
| 9 | FK de `pb_products` | `20260824120700_pb_products_canonical_fk.sql` |
| 10 | Tipos y gramática | `lib/types/canonical.ts` |
| 11 | Carga del registro | `lib/canonical/registry.ts` |
| 12 | Resolver de dos niveles | `lib/canonical/resolver.ts` |
| 13 | Validador observador | `lib/validation/validators.ts` |
| 14 | Cableado y persistencia del origen | punto de escritura de `budget_items` |
| 15 | Tests | `__tests__/` |
| 16 | Backfill `legacy` de las 807 filas | script one-shot |
| 17 | Invariantes de cierre y recálculo de totales | verificación |

---

## 8. Tests obligatorios

**Gramática e integridad.** Los 20 IDs del seed cumplen el regex. Todo concepto `WORK`
tiene un `domain` con `chapter_code` no nulo. `canonical_id` se reconstruye desde sus
partes.

**Aislamiento de tenant.** La empresa A nunca resuelve por un alias privado de B, ni
siquiera ejecutando el resolver como `service_role`. Los aliases globales resuelven para
A, para B y para contexto sin `company_id`. Inyectar una fila con `company_id` ajeno
lanza `TENANT_LEAK`.

**Precedencia.** `manual` de empresa gana a `engine` global en texto libre. `provider`
pierde contra todo. Un empate de igual prioridad devuelve `ambiguous` y nunca elige
(guard defensivo del camino `service_role`, donde la RLS no filtra).

**Origen.** Con `origin='engine'` y un alias manual de empresa apuntando a otro concepto,
resuelve al del engine. Con `origin='engine'` y sin alias engine, nunca produce
`exact_manual`. `origin='import'` prioriza `import`; `origin='provider'`, `provider`.
`origin='free_text'` sí usa `manual` por encima de `curated`.

**Fuente concreta.** Un alias exacto de `cype` y otro de `public_bc3` con el mismo
`alias_norm` y distinto concepto coexisten. Con `source_ref='cype'` resuelve al de CYPE.
Sin `source_ref`, el nivel 1 se omite y el nivel 2 devuelve `ambiguous`.

**Contratos de estado.** Un `synonym` con `confidence = 0.95` es rechazado por la base de
datos. Las combinaciones ilegales de la sección 5.2 son rechazadas. La matriz de
`ck_origin_source_ref` de la sección 5.3 se verifica en sus ocho casos.

**Legacy.** Sin evidencia persistida no ejecuta nivel 1, no usa aliases privados ni como
`service_role`, y nunca resuelve por `import` o `provider`.

**Duplicados (TEST 2, contrato existente).** `validateDuplicates` emite
`DUPLICATE_CANONICAL_ID` para dos líneas con `WORK.WASTE.CONTAINER.HAUL.6M3`.
`MATERIAL_DOUBLE_IMPUTATION` en sus tres casos de `price_type`. La relación `provides` no
dispara `DUPLICATE_CANONICAL_ID`.

**Canario intacto.** El TEST 1c sigue exigiendo **cuatro** emisores de residuos sin
unificar: unificarlos es Fase 3.

---

## 9. Criterio de salida

1. Las 807 filas tienen estado canónico asignado y `canonical_origin = 'legacy'`.
2. Los duplicados de `55082c1b` y `03d6b1b0` aparecen en el informe de validación.
3. `select count(*) from budget_items where canonical_source = 'exact_manual'` → **0**.
4. `select count(*) from budget_items where canonical_origin = 'legacy' and
   canonical_source in ('exact_import','exact_provider')` → **0**.
5. `select count(*) from budget_items where canonical_status = 'resolved' and
   canonical_confidence <> 1.00` → **0**.
6. Recálculo completo con `lib/budget-totals.ts`: 0 diferencias, 0
   `BUDGET_TOTAL_MISMATCH`, ni un importe alterado.

---

## 10. Enmiendas posteriores al congelado

Este documento queda **congelado el 2026-08-24**. A partir de aquí no se rediseña: solo se
anotan enmiendas si aparece un problema crítico durante la implementación, y cada una debe
justificar por qué no podía resolverse dentro del diseño.

### E-001 — `ck_origin_source_ref` y `ck_canonical_coherence` se escriben con `CASE`

**Fecha:** 2026-08-24. **Estado:** aplicada en la migración.

La forma disyuntiva propuesta

```sql
(canonical_origin in ('import','provider')           and canonical_source_ref is not null)
or (canonical_origin in ('engine','free_text','legacy') and canonical_source_ref is null)
or (canonical_origin is null                          and canonical_source_ref is null)
```

**acepta** la fila `(canonical_origin = NULL, canonical_source_ref = 'cype')`. Con
`canonical_origin` a NULL, la primera rama da `NULL AND true = NULL`, la segunda
`NULL AND false = false` y la tercera `true AND false = false`; el `OR` global da NULL, y
en PostgreSQL **un CHECK que evalúa a NULL se considera satisfecho**. Es decir, la
restricción destinada a impedir una fuente concreta sin procedencia dejaba pasar
exactamente ese caso.

Se sustituye por `CASE ... ELSE false`, que siempre devuelve `true` o `false`. La
semántica pedida no cambia en ninguno de los ocho casos exigidos; lo único que cambia es
que ahora las combinaciones no contempladas se rechazan en lugar de colarse. El mismo
razonamiento se aplica a `ck_canonical_coherence`, donde la forma disyuntiva dejaba pasar
`canonical_status = 'resolved'` con `canonical_source = NULL`.

La verificación está en `docs/fase2/verify_checks.py`: los ocho casos, el producto
cartesiano completo y la divergencia entre ambas formas.

### E-002 — `alias_norm` pasa a ser columna generada

**Fecha:** 2026-08-24. **Estado:** aplicada en la migración.

La sección 4.6 exigía una sola fuente de normalización. Escribir `alias_norm` a mano en el
seed lo incumple en cuanto alguien inserta un alias sin normalizar. Se introduce la función
`public.canonical_normalize(text)` (IMMUTABLE) y `alias_norm` se declara
`GENERATED ALWAYS AS (public.canonical_normalize(alias_value)) STORED`. El resolver
consulta con `where alias_norm = canonical_normalize($1)`, de modo que la normalización es
literalmente el mismo código en la escritura y en la lectura.

Contrapartida: aparece una dependencia real entre `normalizeForMatching()` de
`lib/normalized-concepts.ts` y esta función SQL. El test de paridad del paso 15 deja de ser
opcional.

### E-003 — `pb_products` no recibe CHECK de coherencia

**Fecha:** 2026-08-24. **Estado:** aplicada en la migración.

Se añaden FK, vocabulario de `concept_match_type` e índice, pero **no** un CHECK que ligue
`concept_match_type` con la presencia de `concept_id`. Ese CHECK sería deseable, pero es
una restricción sobre el comportamiento del resolver, no sobre la identidad canónica, y
exige haber confirmado antes que ninguna de las 42.221 filas tiene `concept_match_type`
NULL. Se pospone al paso de vinculación, que es cuando esa columna empieza a escribirse.

### E-004 — `canonical_origin` admite `ai`

**Fecha:** 2026-08-25. **Estado:** migración escrita, pendiente de aplicar.

El vocabulario congelado no contemplaba las líneas propuestas por el modelo. Quedaban con
`canonical_origin` NULL, indistinguibles de un histórico sin procedencia, y el diseño exige
que un origen desconocido no reciba una procedencia inventada. Las alternativas dentro del
vocabulario existente eran las dos peores posibles: marcarlas `engine` les concedería el
nivel 1 privilegiado de la sección 4.3 —ganar un concepto por delante de la curación
manual de la empresa— sin haberlo acreditado, y marcarlas `free_text` afirmaría que las
escribió una persona.

Se añade `ai` con esta semántica: **la línea la propuso originalmente el modelo**. Describe
procedencia, no fiabilidad; una línea `ai` puede acabar `resolved` con evidencia canónica
fuerte, igual que una `provider` puede quedarse `unmatched`. Son dimensiones distintas y
viven en columnas distintas.

`ai` **no** entra en `canonical_alias_sources` ni en el vocabulario de `canonical_source`:
no existe `exact_ai`. Es la propiedad que lo mantiene sin privilegio. Como no es una
procedencia de alias, `originAsAliasSource` devuelve NULL, el nivel 1 se omite entero y la
línea resuelve por el nivel 2 general, respetando `general_rank` y el aislamiento por
empresa como cualquier otro texto. A diferencia de `legacy`, `ai` **sí** conserva su
`company_id`: sabemos quién pidió el presupuesto, así que puede beneficiarse legítimamente
de la curación privada de esa empresa. El resolver no necesitó ningún cambio de lógica.

En `ck_origin_source_ref`, `ai` cae en la rama de `source_ref` **prohibido**: una propuesta
del modelo no procede de ningún banco ni tarifa citable. Hubo que tocar las dos
restricciones y no sólo el vocabulario, precisamente por el `CASE ... ELSE false` de E-001:
un valor nuevo que no aparezca en ninguna rama se rechaza siempre, así que ampliar sólo
`ck_budget_items_canonical_origin` habría dejado `ai` aceptado por una restricción y
prohibido por la otra.

Ninguna fila existente cambia: ambos CHECK nuevos son superconjuntos estrictos de los que
sustituyen. Cero UPDATE, cero backfill, cero cambios de importes.

El discriminador vive en `lib/canonical/analysis-origin.ts` y es puro. `suggested_items` no
siempre viene del modelo: cuando el enriquecimiento externo falla, lo rellena
`buildDeterministicBudgetAnalysis` con la salida del motor. Sólo se admiten dos señales
—`analysis_mode = 'deterministic_engine'` **y** `data_sources.using_ai_fallback = true`—,
ambas emitidas por el propio fallback en el acto de fabricar las líneas. Si discrepan o
falta una, el resultado es `ai`, porque es el origen sin privilegio: errar hacia `engine`
concede autoridad no acreditada, errar hacia `ai` sólo obliga a competir en igualdad.
