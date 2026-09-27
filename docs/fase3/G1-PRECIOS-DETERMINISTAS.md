# G1 — Precios deterministas en la ruta viva

Fecha: 2026-09-27. Estado: **diseño y matriz de pruebas. Sin código de producción.**
Rama: `codex/g1-deterministic-pricing-design`, desde `origin/main` `99d11e9`.

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

## Contrato propuesto

El modelo deja de emitir `unit_cost`. Emite, por partida:

```
{ concept, description, quantity, unit, category, price_hint? }
```

`price_hint` es opcional y **no se usa para calcular**: solo se registra, para
poder medir después cuánto se desviaba el modelo del precio real.

El resolutor decide el precio y devuelve, por partida, el origen:

| `price_source` | Significado |
|---|---|
| `catalog` | tarifa del usuario o proveedor autorizado |
| `tracker` | producto con precio comprobado en el rastreador |
| `technical_bank` | banco técnico (CYPE/BC3) |
| `unresolved` | **no hay precio**: la partida sale a cero y marcada |

**Ninguna partida sale con precio si el resolutor no lo encontró.** Hoy el
modelo rellena el hueco con una invención; el diseño lo sustituye por un
`unresolved` visible que obliga a decidir a una persona. Eso es la parte de
«impedir precios inventados».

Y «impedir partidas improcedentes»: toda partida debe declarar `category`
dentro del vocabulario canónico (`material`, `mano_obra`, `otros`) y superar el
filtro de sector. Una partida que no encaja en el oficio del proyecto se
descarta antes de llegar al presupuesto, no después.

## Criterios de entrada y de terminado

**Entrada**: no depende de S3. Puede empezar en cuanto haya una rama libre.

**Terminado**:
1. Un presupuesto generado por la interfaz no contiene ni un `unit_price` que no
   provenga del resolutor.
2. Cada partida lleva su `price_source`, y las `unresolved` son visibles en la
   interfaz y no suman al total como si fueran precio firme.
3. Cero partidas fuera del vocabulario de categorías.
4. La línea base estática no empeora.
5. `generate-v2` sigue existiendo pero queda marcado como pendiente de retirada
   con fecha y responsable.

## Matriz de pruebas

| Área | Casos |
|---|---|
| **Determinismo** | dos generaciones con la misma entrada y el mismo catálogo dan los mismos precios; cambiar el catálogo cambia el precio; cambiar solo la redacción del proyecto no lo cambia |
| **Origen del precio** | cada partida lleva `price_source`; `catalog` gana a `tracker` y `tracker` a `technical_bank`; sin coincidencia sale `unresolved` |
| **Precios no inventados** | un catálogo vacío produce todas las partidas `unresolved` y **ninguna** con precio; un `price_hint` del modelo nunca acaba en `unit_price` |
| **Partidas improcedentes** | categoría fuera del vocabulario → rechazada; partida de otro oficio → descartada; cantidad ausente o no numérica → rechazada |
| **Cálculo** | el total es la suma de las partidas resueltas; las `unresolved` no inflan el total ni lo bloquean en silencio |
| **Regresión de la ruta viva** | el contexto por sector, rastreador y ubicación sigue llegando al prompt; el flujo completo del asistente sigue terminando en un presupuesto guardado |
| **Mutantes obligatorios** | devolver el `price_hint` como `unit_price` → debe fallar; saltarse el filtro de categoría → debe fallar; tratar `unresolved` como 0 € firme → debe fallar |
| **E2E** | generar desde la interfaz, revisar las `unresolved`, corregirlas a mano, guardar y exportar |

Las tres pruebas de mutante no son opcionales: sin ellas, una suite que solo
comprueba «hay precio» pasaría con el modelo inventándolo.

## Riesgos

- **Cobertura del catálogo.** Si el resolutor no cubre lo que el modelo propone,
  el presupuesto sale lleno de `unresolved` y la herramienta parece peor que
  antes, aunque sea más honesta. Hay que medir la tasa de resolución sobre
  presupuestos reales **antes** de cambiar la ruta viva; es el dato que decide si
  G1 se despliega o se pospone.
- **Decisión de producto**: qué hacer con una partida `unresolved` — bloquear el
  PDF, dejarla a cero y avisar, o pedir precio al usuario. Es la puerta de G2 y
  conviene decidirla al empezar G1, no al acabarlo.
- **`generate-v2` acumula deuda mientras siga ahí.** Si G1 se alarga, quedan dos
  generadores divergiendo. Poner fecha de retirada desde el primer día.
