# G1 — Precios deterministas en la ruta viva

Fecha: 2026-09-27 (revisión 4). Estado: **diseño y matriz de pruebas. Sin código de producción.**
Rama: `codex/g1-deterministic-pricing-design`, con `origin/main` `ec4958e` integrado.

La revisión 1 inventó dos contratos en lugar de leerlos. La revisión 2 los
corrigió contra el código, pero se dejó un nivel de la cadena y confundió el
último. La revisión 3 los lista completos, verificados uno a uno contra
`lib/price-resolver-v2.ts`.

## El hallazgo que define el bloque

Hay **dos generadores en paralelo**, y el bueno es el que nadie llama.

| Ruta | Cómo fija el precio | ¿La usa la interfaz? |
|---|---|---|
| `/api/agent/budget-analysis` (662 líneas) | mete el catálogo en el *prompt* y pide al modelo un `unit_cost` «realista de mercado español» | **sí** |
| `/api/budgets/generate-v2` (525 líneas) | llama a `resolvePricesForBudget()` del resolutor determinista | **no** |
| `/api/budgets/analyze`, `/api/budgets/reprice` | — | **no** |

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

El CHECK de la base dice otra cosa:

```sql
budget_items_category_check
  CHECK (category = ANY (ARRAY['material', 'mano_obra', 'otros']))
```

**El generador vivo ofrece una categoría que la base rechaza.** Una partida que
el modelo clasifique como `maquinaria` llega intacta al escritor —
`BudgetGenerateProvider.tsx:186` hace `text(row.category, "otros")`, y ese
`"otros"` es solo el valor por defecto para cadenas vacías, no una
normalización — y revienta con `23514`.

Comprobado en producción: de 911 partidas, **0 son `maquinaria`** (583 material,
310 mano_obra, 18 otros). Coherente con el rechazo.

`maquinaria` sí es legítima en otro sitio: es un `business_subsector` del banco
de precios (`pb_products`), con su propio vocabulario. El defecto es que el
prompt de partidas tomó prestado el vocabulario del banco de precios.

**Decisión de producto pendiente**, y conviene tomarla al abrir G1:

- **(a) Añadir `maquinaria` al CHECK.** Migración, y después habría que decidir
  qué hacer con el PDF: hoy **reconoce la etiqueta «Maquinaria»**
  (`lib/pdf-generator.ts:110`) pero **suma su importe bajo «Otros»**, porque el
  desglose agrupa en material, mano de obra y todo lo demás (`:916-922`, con el
  rótulo en `:995`). Es decir, la categoría se vería en cada línea pero no
  tendría subtotal propio.
- **(b) Quitarla del prompt** y mapear maquinaria a `otros`. Sin migración, pero
  entierra en «otros» un coste que en obra se mira aparte.

Recomiendo **(a)**: el PDF ya la trata como categoría propia, así que el resto
del sistema ya asume que existe. Pero es una decisión de producto, no mía.

## Contrato real de `price_source`

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

Eso reescribe la regla de G1. «Impedir precios inventados» no es distinguir
resuelto de no resuelto, es **fijar un umbral de confianza por debajo del cual
un precio no puede presentarse como firme**. Los candidatos naturales son
`market_estimate` (0.35) y `estimated` (0.05), que es además el único que llega
con precio 0.

**Segunda decisión de producto**: dónde va el umbral y qué pasa debajo. Propongo
**0.45** —deja pasar `enlaze_base` y los ocho niveles por encima, y marca
`market_estimate` y `estimated`— pero el número lo decide quien firma los presupuestos, y conviene
medirlo antes con presupuestos reales.

## Contrato propuesto para el modelo

El modelo deja de emitir `unit_cost`. Emite, por partida:

```
{ concept, description, quantity, unit, category, chapter, price_hint? }
```

`price_hint` es opcional y **no se usa para calcular**: se registra para poder
medir después cuánto se desviaba el modelo del precio real.

El resolutor decide el precio y cada partida viaja con su `source_type` y su
`confidence_score` hasta la interfaz. Por debajo del umbral, la partida se marca
y **no se presenta como precio comprobado**; qué se hace exactamente con ella es
la puerta de G2.

`category` debe pertenecer al vocabulario que el CHECK acepte **en ese momento**
—hoy tres valores, cuatro si se toma la decisión (a)—, y la validación debe leer
el vocabulario de un solo sitio, no repetirlo en el prompt y en el escritor.

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
5. La línea base estática no empeora (hoy 19 fallos preexistentes).
6. `generate-v2` sigue existiendo pero con fecha y responsable de retirada.

## Matriz de pruebas

| Área | Casos |
|---|---|
| **Determinismo** | dos generaciones con la misma entrada y el mismo catálogo dan los mismos precios; cambiar el catálogo cambia el precio; cambiar solo la redacción del proyecto no lo cambia |
| **Origen y confianza** | cada partida lleva `source_type` y `confidence_score`; la cadena respeta sus **once** niveles en orden (`manual_locked` > `private_tariff` > `negotiated` > `historical_approved` > `preferred_supplier` > `provider_updated` > **`private_bc3`** > `technical_bank` > `enlaze_base` > `market_estimate` > `ai_estimate`); `private_bc3` gana a `technical_bank` cuando ambos casan; `historical_approved` decae con los días (0.88 / 0.78 / 0.65) |
| **Precios no inventados** | con el catálogo vacío todo cae al fallback: `source_type` = `estimated`, confianza 0.05, `unit_price` 0 y su aviso, y **ninguna** partida se presenta como firme; un `price_hint` del modelo nunca acaba en `unit_price`; el umbral se aplica en el servidor, no solo al pintar; un cero con confianza 0.05 no se muestra como «gratis» |
| **Nombre interno frente a externo** | la salida nunca contiene `source_type: "ai_estimate"`; una validación escrita contra `ai_estimate` debe fallar la prueba, porque no casaría nunca en producción |
| **Categorías** | una `category` fuera del vocabulario del CHECK se rechaza **antes** de llegar al escritor, con mensaje accionable; `maquinaria` según la decisión (a) o (b), y la prueba debe fallar si prompt y CHECK divergen otra vez |
| **Cálculo** | el total es reproducible y coincide con la suma de las partidas tal como se hayan contabilizado; ninguna partida bajo umbral entra en el total **en silencio**: o suma y está marcada, o no suma y se dice. **Qué de las dos cosas es la decisión de G2 y esta fila se cierra cuando llegue**; hasta entonces la prueba fija el invariante, no la política |
| **Regresión de la ruta viva** | el contexto por sector, rastreador y ubicación sigue llegando al prompt; el asistente sigue terminando en un presupuesto guardado |
| **Mutantes obligatorios** | devolver el `price_hint` como `unit_price` → debe fallar; saltarse la validación de categoría → debe fallar; tratar una partida bajo umbral como precio firme → debe fallar; bajar el umbral a 0 → debe fallar; quitar `private_bc3` de la cadena → debe fallar; comprobar el umbral contra `ai_estimate` en vez de `estimated` → debe fallar |
| **E2E** | generar desde la interfaz, revisar las partidas marcadas, corregirlas a mano, guardar y exportar |

Las seis pruebas de mutante no son opcionales: sin ellas, una suite que solo
comprueba «hay precio» pasaría con el modelo inventándolo.

## Riesgos

- **Cobertura del catálogo, y es el riesgo que decide el bloque.** Si el
  resolutor no cubre lo que el modelo propone, el presupuesto sale lleno de
  partidas marcadas y la herramienta parece peor que antes, aunque sea más
  honesta. Hay que medir la distribución de `confidence_score` sobre
  presupuestos reales **antes** de tocar la ruta viva: si la mayoría cae en
  `market_estimate` o `estimated`, G1 no se despliega, se pospone y primero se
  amplía el catálogo.
- **Tres decisiones de producto**, todas al abrir G1 y no al cerrarlo: qué pasa
  con `maquinaria` (a o b), dónde va el umbral de confianza, y qué se hace con
  una partida por debajo — bloquear el PDF, dejarla marcada a cero, o pedir el
  precio al usuario. La tercera es la puerta de G2.
- **`generate-v2` acumula deuda mientras siga ahí.** Si G1 se alarga, quedan dos
  generadores divergiendo. Poner fecha de retirada desde el primer día.
