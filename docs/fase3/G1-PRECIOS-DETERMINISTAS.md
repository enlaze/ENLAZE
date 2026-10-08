# G1 — Precios deterministas en la ruta viva

Fecha: 2026-09-28 (revisión 6). Estado: **diseño y matriz de pruebas. Sin código de producción.**
Rama: `codex/g1-deterministic-pricing-design`, contrastada con `origin/main` `9b37877`.

La revisión 1 inventó dos contratos en lugar de leerlos. La revisión 2 los
corrigió contra el código, pero se dejó un nivel de la cadena y confundió el
último. La revisión 3 los lista completos, verificados uno a uno contra
`lib/price-resolver-v2.ts`. La revisión 4 corrigió qué hace realmente el PDF
con `maquinaria`; la revisión 5 registró la decisión de ampliar el vocabulario;
y esta revisión 6 recoge su despliegue, separa `source_type` de `price_source` y
alinea la propuesta de umbral con los dos controles que ya existen.

## El hallazgo que define el bloque

Hay **dos generadores en paralelo**, y el bueno es el que nadie llama.

| Ruta | Cómo fija el precio | ¿La usa la interfaz? |
|---|---|---|
| `/api/agent/budget-analysis` (662 líneas) | mete el catálogo en el *prompt* y pide al modelo un `unit_cost` «realista de mercado español» | **sí** |
| `/api/budgets/generate-v2` (525 líneas) | llama a `resolvePricesForBudget()` del resolutor determinista | **no** (borrada el 2026-10-08) |
| `/api/budgets/analyze`, `/api/budgets/reprice` | — | **no** (`reprice` borrada el 2026-10-08) |

El prompt de la ruta viva llega a admitirlo: «los `unit_cost` son provisionales:
no los presentes como precios comprobados». Son 1.383 líneas de generador sin
ningún consumidor desde la interfaz.

**G1 no es construir precios deterministas: ya están construidos y probados**
(`price-resolution-selection`, `price-catalog-search`, `price-resolver-batching`,
`basket-price-comparison`, `budget-realism`). G1 es llevarlos a la ruta que se
ejecuta de verdad.

## Decisión de arquitectura: absorber, no promover

Dos caminos posibles:

**Promover** `generate-v2` a ruta oficial y retirar `/api/agent/budget-analysis`.
Más limpio de leer, y mucho más arriesgado: activa de golpe 525 líneas que nunca
han corrido en producción y retira 662 que sí, incluida toda la lógica de
contexto por sector, rastreador y ubicación que la viva ha ido acumulando.

**Absorber** — la recomendación. Llevar la llamada a `resolvePricesForBudget()`
dentro de `/api/agent/budget-analysis`, dejando que el modelo siga proponiendo
*qué partidas* hay y quitándole la decisión de *cuánto cuestan*. `generate-v2`
se queda como referencia hasta que G2 cierre, y entonces se borra.

El motivo de fondo: el modelo es bueno identificando alcance y malo poniendo
precios, y la separación entre las dos cosas es justamente lo que hace el
resolutor. Absorber respeta esa división sin apostar la ruta viva a un camino
sin rodaje.

## El defecto que apareció al verificar: `maquinaria`

`app/api/agent/budget-analysis/route.ts:326` le dice al modelo:

```
- category: "mano_obra", "material", "maquinaria", "otros"
```

Antes de `20260927120000`, el CHECK de la base decía otra cosa:

```sql
budget_items_category_check
  CHECK (category = ANY (ARRAY['material', 'mano_obra', 'otros']))
```

**El generador vivo ofrecía una categoría que la base rechazaba.** Una partida
que el modelo clasificara como `maquinaria` llegaba intacta al escritor —
`app/dashboard/budgets/generate/_components/BudgetGenerateProvider.tsx:187`
hace `text(row.category, "otros")`, y ese `"otros"` es solo el valor por
defecto para cadenas vacías, no una normalización — y antes del despliegue
reventaba con `23514`.

Comprobación previa al despliegue: de 911 partidas, **0 eran `maquinaria`** (583
material, 310 mano_obra, 18 otros). Era coherente con el rechazo.

`maquinaria` sí es legítima en otro sitio: es un `business_subsector` del banco
de precios (`pb_products`), con su propio vocabulario. El defecto es que el
prompt de partidas tomó prestado el vocabulario del banco de precios.

**Decisión ejecutada: opción (a), ampliar el vocabulario.** La rama
`codex/budget-items-maquinaria-category` se fusionó en `main` como `711193f` y
`20260927120000_budget_items_allow_maquinaria.sql` se aplicó en producción el
2026-09-28. `CHECK_MAQUINARIA_AUDIT` devolvió `OK`: las 911 partidas y su
distribución quedaron intactas (583 `material`, 310 `mano_obra`, 18 `otros`).
El CHECK vivo acepta ya los cuatro valores. Las dos opciones que se barajaron:

- **(a) Añadir `maquinaria` al CHECK** — la elegida. Migración que amplía de
  tres valores a cuatro sin tocar ninguna fila y sin relajar la restricción.
- **(b) Quitarla del prompt** y mapear maquinaria a `otros`. Sin migración, pero
  entierra en «otros» un coste que en obra se mira aparte.

Pesó que el resto del sistema ya conocía la categoría: el PDF **reconoce su
etiqueta «Maquinaria»** (`lib/pdf-generator.ts:110`), aunque todavía **suma su
importe bajo «Otros»**, porque el desglose agrupa en material, mano de obra y
todo lo demás (`:916-922`, rotulado en `:995`).

Queda vivo, por tanto, lo que (a) **no** resuelve: maquinaria se ve en cada
línea pero no tiene subtotal propio. Añadir un cuarto grupo cambia la cara del
PDF que ve el cliente y es una decisión aparte, todavía sin tomar.

## Contrato real del resolutor: `source_type`

La revisión 1 proponía cuatro valores inventados —`catalog`, `tracker`,
`technical_bank`, `unresolved`—. El resolutor real (`lib/price-resolver-v2.ts`)
no funciona así: hay **once `source_type` posibles**, cada uno con su
`confidence_score`. Son los diez nombres que coinciden con su nivel de
prioridad, más `estimated`, que es lo que sale al exterior en lugar de la
prioridad interna `ai_estimate`.

La cadena tiene **once niveles de prioridad**, y el resolutor los documenta en su
propia cabecera (`lib/price-resolver-v2.ts:7-18`) y los recorre en ese orden
(`:147-152`).

| # | Prioridad interna | `source_type` devuelto | `confidence_score` | Qué es |
|---|---|---|---|---|
| 1 | `manual_locked` | `manual_locked` | **1.00** | precio fijado a mano y bloqueado |
| 2 | `private_tariff` | `private_tariff` | ≤ 0.95 | tarifa privada del usuario |
| 3 | `negotiated` | `negotiated` | ≤ 0.93 | precio negociado con proveedor |
| 4 | `historical_approved` | `historical_approved` | 0.88 / 0.78 / 0.65 | aprobado antes; decae a los 30 y 60 días |
| 5 | `preferred_supplier` | `preferred_supplier` | ≤ 0.85 | proveedor preferente |
| 6 | `provider_updated` | `provider_updated` | ≈ 0.82 | actualización del proveedor |
| 7 | `private_bc3` | `private_bc3` | **≈ 0.80** | BC3 privado del usuario |
| 8 | `technical_bank` | `technical_bank` | 0.78 | banco técnico global (CYPE/BC3) |
| 9 | `enlaze_base` | `enlaze_base` | 0.45 | banco general de Enlaze |
| 10 | `market_estimate` | `market_estimate` | 0.35 | estimación de mercado |
| 11 | `ai_estimate` | **`estimated`** | **0.05** | último recurso: no hay fuente |

### El nivel 11 se llama distinto por dentro que por fuera

`ai_estimate` es el nombre de la **prioridad interna**, y nunca sale como
`source_type`: su resolutor es literalmente `case "ai_estimate": return null`
(`:200`). Cuando la cadena se agota sin resultado, la función cae al bloque
`// Absolute fallback` (`:165-175`) y devuelve `source_type: "estimated"` con
`confidence_score: 0.05`.

Quien consuma la salida verá **`estimated`**, nunca `ai_estimate`. Cualquier
validación, filtro o umbral debe escribirse contra `estimated`; una escrita
contra `ai_estimate` no casaría nunca y dejaría pasar justo el caso que quiere
frenar.

Y un matiz que mejora el diseño: ese fallback devuelve `unit_price: 0` y
`effective_price: 0` con el aviso «No se encontró precio en ninguna fuente».
**El resolutor no inventa una cifra**, la deja a cero y lo dice. El riesgo real
no es un número inventado colándose como firme, sino un cero pasando por precio.

**No existe `unresolved`.** Su equivalente es `estimated` con confianza 0.05 y
precio 0.

## Segundo defecto: `source_type` no es `price_source`

El título anterior de esta sección confundía dos vocabularios distintos. La
tabla de once niveles describe el **`source_type` del resolutor**, no el
`price_source` que hoy recibe el consumidor. Tanto `generate-v2` (`:372`) como
`reprice` (`:244`) pasan `r.source_type` por `mapV2SourceToV1()` antes de
persistirlo.

Ese adaptador colapsa los once orígenes al vocabulario V1 de seis valores —
`user_catalog`, `technical_bank`, `enlaze_base`, `n8n_market`, `web_search` y
`estimated`—, aunque este mapeo concreto no produce `web_search`. Por ejemplo,
`private_bc3` y `technical_bank` terminan ambos como `price_source:
"technical_bank"`; por eso que **`private_bc3` gane a `technical_bank` solo es
observable y comprobable contra `source_type`**, no contra `price_source`.

Además, el mismo defecto de vocabulario interno/externo ya está materializado
en las dos copias literales del adaptador (`generate-v2:510` y `reprice:391`):

```ts
ai_estimate: "estimated",                    // clave muerta: nunca llega
return mapping[sourceType] ?? "estimated";   // esto es lo que resuelve el caso
```

El resolutor nunca devuelve `ai_estimate`; devuelve `estimated`, que no es una
clave del mapa. El resultado funciona por accidente gracias al `??`, no gracias
a la entrada declarada. G1 debe preservar `source_type` como procedencia
canónica y tratar `price_source` solo como compatibilidad V1 mientras exista el
adaptador; las pruebas de prioridad se escriben contra el primero.

## Umbral de confianza: una sola política

Eso reescribe la regla de G1. «Impedir precios inventados» no es distinguir
resuelto de no resuelto, es **fijar un umbral de confianza por debajo del cual
un precio no puede presentarse como firme**. Los candidatos naturales son
`market_estimate` (0.35) y `estimated` (0.05), que es además el único que llega
con precio 0.

**Segunda decisión de producto**: dónde va el umbral y qué pasa debajo. Propongo
**0.40**, en el hueco entre `enlaze_base` (0.45) y `market_estimate` (0.35), sin
la ambigüedad de usar 0.45 y depender de si la comparación es `>=` o `>`.

El umbral puede marcar partidas de **cualquier nivel**, no solo los últimos.
La confianza no es monótona con la prioridad: seis de los once niveles usan
`Math.min(...)` o `match.confidence_score || defecto`, sobre una puntuación de
solapamiento sin suelo (`lib/price-resolver-v2.ts:243`). Una
`private_tariff`, aunque sea prioridad 2, puede quedar bajo el umbral si casa
mal.

Ya existen dos cortes de **0.50** con este mismo significado:
`lib/price-resolver-v2.ts:705` incrementa `needs_review`, y
`app/api/budgets/generate-v2/route.ts:389` selecciona partidas estimadas para
la siguiente vía (esa ruta se borró el 2026-10-08 por no tener llamantes; queda
solo el corte del resolutor). La decisión no debe añadir un tercer número: debe sustituir
los tres usos por una política única. Si se aprueba 0.40, esos dos 0.50 y el
nuevo control deben leer el mismo valor. El número final lo decide quien firma
los presupuestos, después de medirlo con presupuestos reales.

## Contrato propuesto para el modelo

El modelo deja de emitir `unit_cost`. Emite, por partida:

```
{ concept, description, quantity, unit, category, chapter, price_hint? }
```

`price_hint` es opcional y **no se usa para calcular**: se registra para poder
medir después cuánto se desviaba el modelo del precio real.

El resolutor decide el precio y cada partida viaja con su `source_type` y su
`confidence_score` hasta la interfaz. `price_source` puede mantenerse como
compatibilidad V1, pero no sustituye la procedencia canónica porque colapsa
niveles distintos. Por debajo del umbral, la partida se marca y **no se presenta
como precio comprobado**; qué se hace exactamente con ella es la puerta de G2.

`category` debe pertenecer al vocabulario vivo del CHECK —hoy cuatro valores:
`material`, `mano_obra`, `maquinaria`, `otros`—, y la validación debe leer el
vocabulario de un solo sitio, no repetirlo en el prompt y en el escritor.

## Criterios de entrada y de terminado

**Entrada**: no depende de S3. Puede empezar en cuanto haya una rama libre.

**Terminado**:
1. Un presupuesto generado por la interfaz no contiene ni un `unit_price` que no
   provenga del resolutor.
2. Cada partida lleva `source_type` y `confidence_score` hasta la interfaz, y
   las que quedan por debajo del umbral están marcadas y **no** se presentan
   como precio comprobado.
3. Cero partidas con una `category` que el CHECK rechace. El vocabulario se lee
   de un único sitio.
4. La tasa de partidas por debajo del umbral está **medida** sobre presupuestos
   reales antes de cambiar la ruta viva.
5. La línea base estática no empeora: hoy son **568 pruebas, 531 pasan y 23
   fallan**, medido con `node --import tsx --test "__tests__/**/*.test.mjs"`.
6. `generate-v2` sigue existiendo pero con fecha y responsable de retirada.

## Matriz de pruebas

| Área | Casos |
|---|---|
| **Determinismo** | dos generaciones con la misma entrada y el mismo catálogo dan los mismos precios; cambiar el catálogo cambia el precio; cambiar solo la redacción del proyecto no lo cambia |
| **Origen y confianza** | cada partida lleva `source_type` y `confidence_score`; la cadena respeta sus **once** niveles en orden (`manual_locked` > `private_tariff` > `negotiated` > `historical_approved` > `preferred_supplier` > `provider_updated` > **`private_bc3`** > `technical_bank` > `enlaze_base` > `market_estimate` > `ai_estimate`); `private_bc3` gana a `technical_bank` cuando ambos casan, afirmación que se prueba contra `source_type` porque `price_source` funde ambos en `technical_bank`; `historical_approved` decae con los días (0.88 / 0.78 / 0.65) |
| **Precios no inventados** | con el catálogo vacío todo cae al fallback: `source_type` = `estimated`, confianza 0.05, `unit_price` 0 y su aviso, y **ninguna** partida se presenta como firme; un `price_hint` del modelo nunca acaba en `unit_price`; el umbral se aplica en el servidor, no solo al pintar; un cero con confianza 0.05 no se muestra como «gratis» |
| **Nombre interno frente a externo** | la salida nunca contiene `source_type: "ai_estimate"`; una validación escrita contra `ai_estimate` debe fallar la prueba, porque no casaría nunca en producción |
| **Categorías** | una `category` fuera del vocabulario del CHECK se rechaza **antes** de llegar al escritor, con mensaje accionable; `maquinaria` es válida —decisión (a), ya implementada— y la prueba debe fallar si prompt y CHECK vuelven a divergir |
| **Cálculo** | el total es reproducible y coincide con la suma de las partidas tal como se hayan contabilizado; ninguna partida bajo umbral entra en el total **en silencio**: o suma y está marcada, o no suma y se dice. **Qué de las dos cosas es la decisión de G2 y esta fila se cierra cuando llegue**; hasta entonces la prueba fija el invariante, no la política |
| **Regresión de la ruta viva** | el contexto por sector, rastreador y ubicación sigue llegando al prompt; el asistente sigue terminando en un presupuesto guardado |
| **Mutantes obligatorios** | devolver el `price_hint` como `unit_price` → debe fallar; saltarse la validación de categoría → debe fallar; tratar una partida bajo umbral como precio firme → debe fallar; bajar el umbral a 0 → debe fallar; quitar `private_bc3` de la cadena → debe fallar; comprobar el umbral contra `ai_estimate` en vez de `estimated` → debe fallar; retirar el `?? "estimated"` del adaptador mientras siga recibiendo `estimated` → debe fallar |
| **E2E** | generar desde la interfaz, revisar las partidas marcadas, corregirlas a mano, guardar y exportar |

Las siete pruebas de mutante no son opcionales: sin ellas, una suite que solo
comprueba «hay precio» pasaría con el modelo inventándolo.

## Riesgos

- **Cobertura del catálogo, y es el riesgo que decide el bloque.** Si el
  resolutor no cubre lo que el modelo propone, el presupuesto sale lleno de
  partidas marcadas y la herramienta parece peor que antes, aunque sea más
  honesta. Hay que medir la distribución de `confidence_score` sobre
  presupuestos reales **antes** de tocar la ruta viva: si la mayoría cae en
  `market_estimate` o `estimated`, G1 no se despliega, se pospone y primero se
  amplía el catálogo.
- **Dos decisiones de producto abiertas**, ambas al abrir G1 y no al cerrarlo:
  dónde va el umbral de confianza —unificando los dos 0.50 existentes, no
  añadiendo un tercer corte—, y qué se hace con una partida por debajo —bloquear
  el PDF, dejarla marcada a cero, o pedir el precio al usuario. La segunda es
  la puerta de G2. La de `maquinaria` ya se tomó y desplegó: opción (a).
- **Sigue sin subtotal propio de maquinaria en el PDF.** La opción (a) hace que
  la categoría se pueda guardar y se vea en cada línea, no que tenga su propia
  línea de totales. Decisión aparte, sin tomar.
- **`generate-v2` acumula deuda mientras siga ahí.** Si G1 se alarga, quedan dos
  generadores divergiendo. Poner fecha de retirada desde el primer día.
