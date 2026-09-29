# G2 — Precios deterministas por descompuesto

Fecha: 2026-09-29. Estado: **diseño. Sin código de producción.**
Rama: `codex/g2-descompuestos-design`, desde `origin/main` `eddc834`.

G1 dejó una recomendación: absorber `resolvePricesForBudget()` dentro de
`/api/agent/budget-analysis` y quitarle al modelo la decisión del precio. Su
criterio de terminado número 4 exigía **medir la cobertura antes de tocar la
ruta viva**. Se midió. El resultado dice que no se haga, y por un motivo que no
se arregla con más catálogo.

Este documento recoge la medición y rediseña el bloque.

## La medición que cambia el plan

### El generador y el resolutor hablan de cosas distintas

El modelo produce, hoy, partidas como estas —son conceptos reales de los 911
`budget_items` de producción—:

```
Pintura plástica en paredes              m2
Colocación de pavimento                  m2
Guarnecido y regularización de paramentos m2
Ayudas de albañilería para fontanería    pa
Contenedor y transporte a gestor autorizado ud
```

Son **unidades de obra**: describen ejecutar un trabajo. El catálogo contiene
**productos comerciales**: `ESMALTE SINTÉTICO (10832493)`, `400ML BLANCO`,
`(1) KG BOTE`.

No es solo que los nombres no casen. **El precio de un bote de pintura no es el
precio de un m² pintado**, que incluye mano de obra, preparación, medios
auxiliares y rendimiento. Son magnitudes distintas, no dos nombres de la misma
magnitud.

### Las unidades lo confirman

De las 911 partidas reales, por unidad, frente a lo que el catálogo puede
ofrecer en esa misma unidad:

| Unidad | Partidas | Conceptos | Productos del catálogo |
|---|---|---|---|
| ud | 362 | 107 | 33.633 |
| **m²** | **190** | 41 | **279** |
| **pa** (partida alzada) | **124** | 18 | **0** |
| ml | 63 | 11 | 252 |
| lote | 62 | 10 | 410 |
| **sacos** | **46** | 16 | **0** |
| **rollos** | **21** | 5 | **0** |
| **cubos** | **20** | 4 | **0** |
| **punto** | **16** | 2 | **0** |
| kg | 4 | 2 | 89 |
| m³ | 2 | 1 | 9 |

**228 partidas —el 25%— piden una unidad que el catálogo no puede servir de
ninguna manera.** Y las de m², que son el corazón de una reforma, tienen 279
candidatos frente a 41 conceptos distintos.

### El resolutor no mentiría: devolvería cero

`commercialProductMatch()` filtra por `isExact`, que exige identidad, formato,
**unidad compatible**, precio coherente, ausencia de empaquetado y accesorios
engañosos, **y puntuación ≥ 0,8** (`lib/commercial-product-match.ts:525-545`).
Es una puerta dura y está bien puesta.

Conectar G1 hoy no produciría precios equivocados. Produciría **ceros**: casi
toda partida caería al bloque `// Absolute fallback` de
`lib/price-resolver-v2.ts:165-175`, con `source_type: "estimated"`, confianza
0,05 y `unit_price: 0`.

Hoy el modelo inventa cifras plausibles. Mañana enseñaría ceros honestos. Más
correcto y peor de usar: un presupuesto a cero enviado a un cliente no es un
fallo que se parchea el lunes.

**El criterio 4 de G1 funcionó.** Paró un despliegue midiendo, antes de tocar la
ruta viva. Eso es lo que tenía que pasar.

## Lo que falta es una capa, y ya está construida

Entre la unidad de obra y el producto falta el **descompuesto**:

```
"Pintura plástica en paredes"  ·  1 m²
   0,25 L  pintura plástica        → precio real de tu proveedor
   0,15 h  oficial 1ª pintor       → tabla del convenio provincial
   0,05 h  peón ordinario          → tabla del convenio provincial
   +5%     medios auxiliares
   = X €/m²
```

Eso es exactamente lo que publican la base del **IVE** (Instituto Valenciano de
la Edificación), BEDEC del ITeC, CYPE y PREOC. Y resulta que la infraestructura
para ingerirlo **ya existe en este repositorio**:

| Pieza | Tamaño | Estado |
|---|---|---|
| `technical_price_items` | tabla | `material_cost`, `labor_cost`, `machinery_cost`, `indirect_cost`, `waste_pct`, `region`, `edition`, `valid_from/until`. **34 filas** |
| `lib/bc3-parser.ts` | 632 líneas | parser BC3/FIEBDC-3 |
| `lib/technical-price-importer.ts` | 575 líneas | importa a `technical_price_items` |
| `/api/technical-prices/import` | — | documenta `source: "ive"` y `region: "comunitat_valenciana"` **como opciones previstas** |
| `lib/budget-engine.ts` | 2.517 líneas | funciones puras, **en uso por la ruta viva** |

Y las 34 filas cuentan la historia entera:

- **4** con `source: public_bc3`, `region: "test"`, y descompuesto completo
  —material, mano de obra y maquinaria—. Es el fixture del importador.
  **Demuestra que la tubería BC3 funciona de punta a punta.**
- **29** con `source: enlaze_base`, sin ningún coste desglosado: precios planos
  sembrados a mano. Sus unidades (`pa`, `saco`, `rollo`, `cubo`, `m2`) son
  justamente las que el generador usa.
- 1 de `cype`, `barcelona`.

O sea: **G2 no es construir una capa. Es llenar la que hay y conectarla.**

## Arquitectura

```
modelo  →  unidad de obra  →  descompuesto  →  componentes  →  precio
                              (IVE / BC3)      material: catálogo propio
                                               mano de obra: convenio
                                               maquinaria: alquiler
```

El modelo sigue haciendo lo que ya hace bien —identificar **qué** partidas tiene
la obra y en qué unidad— y deja de poner precios. El descompuesto aporta la
receta y los rendimientos. Los componentes se valoran con datos propios.

### El encaje es la ventaja competitiva

Una base de precios da la receta **y** un precio teórico de material. Nosotros
tenemos 42.208 productos con **el precio real del proveedor al que compra el
usuario**.

**Recomponer** —tomar el rendimiento de la base y sustituir el precio del
material por el del catálogo propio— da un precio por m² que ninguna base
publica y que CYPE o Presto no pueden dar. Es la diferencia del producto, y solo
es posible teniendo las dos capas.

## Lo que hay que construir

Ordenado por dependencia.

### 1. Datos (no es ingeniería, es adquisición)

- **Base del IVE** en BC3. Es la referencia oficial de la Comunitat Valenciana.
  Sin ella no hay descompuestos y no hay G2.
- **Tablas del convenio provincial de la construcción** de Valencia, Castellón y
  Alicante, publicadas en BOP.

  Aviso que hay que incorporar al modelo de datos desde el principio: **el coste
  hora para la empresa no es el salario del convenio.** Hay que sumar Seguridad
  Social, pagas, vacaciones y días no trabajados. Un oficial de 1ª con salario
  de convenio de ~12-13 €/h le cuesta a la empresa del orden de 22-26 €/h.
  Guardar el salario como si fuera el coste hace que **todos** los presupuestos
  salgan un 40% baratos. Se guarda `coste_empresa`, no `salario`.

### 2. Emparejar unidad de obra con partida del banco

Es el trabajo de ingeniería de verdad, y **es un problema distinto** del que
resuelve `commercial-product-match.ts`. Allí se comparan nombre de producto
contra nombre de producto. Aquí se compara un concepto generado por un modelo
—`"Pintura plástica en paredes"`— contra el código y el texto de una partida de
banco —`"RPP010 Pintura plástica sobre paramentos interiores"`—.

Hay una pieza a medio hacer que encaja aquí: `canonical_concepts` (20 filas),
`canonical_aliases` (37) y `canonical_concept_relations` (12). Esa es la tabla
natural para fijar el vocabulario de unidades de obra y sus sinónimos. Hoy
**ningún producto tiene `concept_id`** —0 de 42.208—, lo que explica por qué esa
capa no está haciendo nada.

### 3. Recomposición con precios propios

Para cada componente material del descompuesto, buscar el producto equivalente
en el catálogo y sustituir el precio. Aquí sí sirve
`commercial-product-match.ts` tal como está: es comparar producto con producto,
que es para lo que se escribió.

Si no hay equivalente, se conserva el precio de la base y se dice.

### 4. Composición de la confianza

Un precio compuesto necesita su propia confianza. Propuesta: **el mínimo de los
componentes, penalizado por la calidad del emparejamiento de la unidad de obra**.

```
confianza(partida) = min(
    confianza_emparejamiento_unidad_obra,
    min(confianza de cada componente valorado)
)
```

El mínimo y no la media, porque una partida con la mano de obra bien valorada y
el material inventado no es «medio fiable»: es tan mala como su peor pata.

Esto reabre, con mejor información, la decisión del umbral que G1 dejó abierta.
El umbral se aplica al **precio compuesto**, no al del catálogo.

## Contrato

El modelo emite, por partida:

```
{ concept, description, quantity, unit, category, chapter, price_hint? }
```

`price_hint` se registra y **no se usa para calcular**: sirve para medir después
cuánto se desviaba el modelo.

El motor devuelve, por partida:

```
{ unit_price, source: "descompuesto",
  breakdown: { material, mano_obra, maquinaria, indirectos, merma },
  bank: { source, region, edition, item_code },
  substitutions: [ { componente, precio_base, precio_propio, producto } ],
  confidence_score, warnings[] }
```

El desglose no es decorativo: es lo que permite a un constructor discutir el
precio con su cliente, y lo que permite auditar por qué salió esa cifra.

## Criterios de terminado

1. Ninguna partida generada por la interfaz lleva un `unit_price` que no
   provenga de un descompuesto o de una sustitución explícita.
2. Toda partida viaja con su `breakdown`, su `bank` y su `confidence_score`
   hasta la interfaz y hasta el PDF.
3. **La tasa de partidas resueltas está medida sobre presupuestos reales antes
   de tocar la ruta viva.** Mismo criterio que salvó a G1; se aplica igual aquí.
4. Cero partidas con `category` fuera del vocabulario vivo del CHECK
   —`material`, `mano_obra`, `maquinaria`, `otros`— leído de un solo sitio.
5. El coste de mano de obra guardado es coste empresa, y hay una prueba que
   falla si alguien guarda el salario de convenio a secas.
6. La línea base estática no empeora.

## Matriz de pruebas

| Área | Casos |
|---|---|
| **Determinismo** | dos generaciones con la misma entrada y el mismo banco dan el mismo precio; cambiar la edición del banco cambia el precio; cambiar la redacción del proyecto no lo cambia |
| **Descompuesto** | el precio de la partida es igual a la suma de sus componentes más indirectos y merma, con el redondeo declarado; quitar un componente cambia el total |
| **Recomposición** | sustituir el material por el del catálogo cambia el precio y queda registrado en `substitutions`; sin equivalente, se conserva el de la base y se avisa |
| **Mano de obra** | el coste/hora usado es coste empresa; una prueba con el salario de convenio a pelo **debe fallar** |
| **Emparejamiento** | una unidad de obra sin partida equivalente **no** se valora con una partida parecida: se marca sin precio; un `pa` no casa con un producto en `ud` |
| **Confianza** | la confianza compuesta es el mínimo, no la media; una partida con un componente a 0,30 no puede salir por encima de 0,30 |
| **Unidades** | una partida en m² nunca toma el precio de un producto en ud; las unidades sin equivalencia en el banco se marcan, no se aproximan |
| **Vigencia** | una partida de una edición caducada (`valid_until` pasado) no se usa sin avisar |
| **Regresión de la ruta viva** | el contexto por sector, rastreador y ubicación sigue llegando al prompt; el asistente sigue terminando en un presupuesto guardado |
| **Mutantes obligatorios** | devolver el `price_hint` como `unit_price` → debe fallar; usar la media en vez del mínimo para la confianza → debe fallar; valorar una unidad de obra con una partida de unidad distinta → debe fallar; usar salario en vez de coste empresa → debe fallar; ignorar `waste_pct` → debe fallar; aceptar una edición caducada en silencio → debe fallar |

## Decisiones abiertas

1. **Qué base se licencia y en qué edición.** Es el bloqueo duro. Sin base no
   hay G2.
2. **Qué pasa con una partida sin descompuesto equivalente.** Marcarla sin
   precio, dejarla al criterio del usuario, o pedirle el precio. Decide la
   experiencia entera del generador.
3. **Dónde cae el umbral de confianza**, ahora sobre el precio compuesto. Y
   sigue en pie lo que G1 dejó dicho: hay que **unificar** los dos cortes de
   0,50 que ya existen en el código, no añadir un tercero.
4. **Si el PDF gana un cuarto subtotal para maquinaria.** Heredada de G1, sin
   tomar.

## Riesgos

- **La licencia de la base es el camino crítico y no depende de ingeniería.**
  Todo lo demás se puede preparar en paralelo, pero nada se puede terminar sin
  ella.
- **El emparejamiento unidad de obra ↔ partida de banco es el trabajo difícil**,
  y es el mismo tipo de problema que ya salió mal una vez: parecerá que funciona
  en pruebas con diez conceptos y fallará con doscientos. Hay que medirlo con los
  218 conceptos reales antes de darlo por bueno.
- **Las tablas de convenio caducan cada año.** Hay que modelar la vigencia desde
  el principio, igual que `valid_from`/`valid_until` en el banco. Los workflows
  de n8n que ya leen el BOE pueden leer el BOP provincial.
- **`pb_products` no sirve para mano de obra, residuos, tasas ni transporte.**
  Una hora de oficial no tiene SKU ni proveedor, y el ICIO de un municipio
  tampoco. Hacen falta familias de precio separadas, cada una con su unidad, su
  origen y su caducidad. Sin eso, G2 cubre el material y deja fuera la mitad que
  más pesa en un presupuesto de obra.
