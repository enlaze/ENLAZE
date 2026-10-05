# E6 — `authenticated` pierde lo que no usa

Fecha: 2026-10-05. Estado: **diseño. Sin migración, sin código.**
Rama: `codex/e6-authenticated-least-privilege-design`, desde `origin/main` `b9ed8dd`.

La otra mitad de la puerta que E5 cerró a medias. `authenticated` conserva `arwdDxtm`
sobre 88 de las 93 tablas de `public`, y privilegios parciales sobre otras tres.

## Por qué esto no es E5 otra vez

E5 fue sencillo porque `anon` **no usaba nada**: el portal había pasado a tres
RPC `SECURITY DEFINER` y se podía revocar en bloque.

Aquí no. Medido sobre `origin/main`, el panel consulta **78 de las 93 tablas**
con el JWT del usuario. Revocar en bloque rompe el producto.

Así que E6 no es una migración, son **tres lotes de riesgo muy distinto**, y el
primero vale la pena por sí solo.

## El método, y su límite

Se recorrieron `app/`, `components/`, `lib/` y `hooks/` buscando
`.from("tabla")` y la operación que le sigue. Un fichero que menciona
`SUPABASE_SERVICE_ROLE_KEY` o `getServiceRoleClient` se clasifica como
`service_role`; el resto, como `authenticated`.

**El límite hay que tenerlo presente**: la clasificación es por fichero, no por
llamada. Una ruta que use los dos clientes queda mal atribuida, y el análisis
tiende a sobreestimar lo que `authenticated` necesita — que para esto es el
error seguro. Antes de revocar cualquier cosa del lote 2 hay que confirmar
tabla por tabla.

## Lote 1 · Lo que ninguna aplicación necesita — **el que vale la pena**

`arwdDxtm` incluye cuatro privilegios que esta aplicación no usa en ninguna
tabla:

Medido en producción el 2026-10-05:

| | Tablas |
|---|---|
| `authenticated=arwdDxtm` — los ocho | **88** |
| `authenticated=rxtm` — sin escritura ni TRUNCATE | 3 — `plan_catalog`, `subscriptions`, `usage_events` |
| sin ningún privilegio para `authenticated` | 2 — `portal_tokens`, `stripe_events` |
| **Total en `public`** | **93** |

De esos ocho privilegios hay cuatro que esta aplicación no usa en ninguna tabla:

| Privilegio | Para qué sirve | ¿Lo usa el panel? |
|---|---|---|
| **D — TRUNCATE** | vaciar una tabla entera | no |
| x — REFERENCES | crear claves ajenas | no |
| t — TRIGGER | crear disparadores | no |
| m — MAINTAIN | VACUUM, ANALYZE, REINDEX | no |

Y **`TRUNCATE` es el que importa: RLS no lo cubre.** Las políticas se aplican a
SELECT, INSERT, UPDATE y DELETE. Un `TRUNCATE` no pasa por ellas.

Hoy eso significa que cualquier usuario autenticado, con una conexión directa a
PostgreSQL, podría vaciar cualquiera de las 88 tablas que conceden `D`. No es alcanzable con la
clave pública —PostgREST no expone `TRUNCATE`— exactamente igual que pasaba con
`anon` antes de E5. Y exactamente igual que entonces, la respuesta correcta no
es «no es alcanzable», es «no hace falta».

**Alcance:** revocar `TRUNCATE, REFERENCES, TRIGGER, MAINTAIN` de
`authenticated` en las 91 tablas que le conceden algo. Las 88 completas quedan
en `arwd` —SELECT, INSERT, UPDATE, DELETE—; las tres parciales quedan en `r`,
solo lectura, que es lo que ya hacían.

**Riesgo:** ninguno medible. Ninguna de esas cuatro operaciones aparece en el
código, y PostgREST no expone ninguna.

**Y el defecto del esquema**, igual que en E5: sin cambiarlo, la siguiente
tabla nueva vuelve a conceder los cuatro.

Este lote se puede hacer ya, y debería.

## Lote 2 · Tablas que el panel solo lee

Medido: hay **quince** tablas que `authenticated` únicamente consulta, sin
escribir nunca.

```
agent_campaigns          agent_daily_summary      agent_reviews
budget_items             budgets                  data_subject_requests
digital_signatures       expense_categories       processing_activities
sector_config            sector_data              security_incidents
subprocessors            budget_lines (*)         user_settings (*)
```

(*) no existen en la base — ver más abajo.

**Y el caso que mejor lo explica es `budgets` y `budget_items`.** El panel solo
las lee porque **las escrituras ya pasan por RPC**: `save_budget`,
`finalize_budget` y `replace_budget_items`, todas `SECURITY DEFINER`, que se
ejecutan como su propietario y no necesitan los privilegios de quien llama.

Eso lo construyó la fase 2F para resolver atomicidad y conflictos. El efecto
secundario es que **las dos tablas centrales del producto ya están listas para
quedarse en solo lectura**, y nadie lo había notado.

**Alcance:** revocar `INSERT, UPDATE, DELETE` de `authenticated` en esas tablas.

**Riesgo:** medio, y acotable. El límite del método está arriba: hay que
confirmar tabla por tabla que ninguna escritura llega por un camino que el
grep no ve. Para `budgets` y `budget_items` la confirmación es barata y ya
existe: **el E2E completo del asistente**
(`budget-wizard-full-page.browser.integration`) recorre crear, autoguardar,
rechazar pestaña obsoleta y finalizar con Next, PostgREST y PostgreSQL reales.
Si pasa con los privilegios retirados, están retirados bien.

Las otras trece necesitan su propia verificación antes de tocarlas.

## Lote 3 · Tablas que el panel no debería escribir

El grep atribuye a `authenticated` escrituras sobre el banco de precios y el
banco técnico:

```
pb_products        pb_providers       pb_price_current    pb_price_observations
pb_price_sources   pb_sync_runs       price_sync_logs     resolved_prices
technical_chapters technical_price_items  technical_price_components
```

Si esas escrituras vienen de rutas de API que usan el cliente de cookies, son
reales y hay que entender por qué un usuario del panel puede escribir en el
banco de precios compartido. Si vienen de rutas que en realidad usan
`service_role` y el método las clasificó mal, no hay nada que hacer salvo
corregir el análisis.

**Esto no es un lote de privilegios: es una pregunta de diseño** que hay que
contestar antes de decidir nada. Va el último a propósito.

## Hallazgo lateral: cinco tablas que no existen

El código consulta cinco tablas ausentes de la base:

```
budget_lines    notification_settings    user_settings
work_reports    pb_normalized_concepts
```

Cualquier código que las toque está roto, como ya lo estaba `generate-v2` con
`effective_price` y `pb_normalized_concepts`. No son un problema de
privilegios, pero salieron de esta medición y conviene que no se pierdan: son
más superficie construida y nunca conectada.

## Orden propuesto

| Lote | Qué | Riesgo | Cuándo |
|---|---|---|---|
| **1** | TRUNCATE, REFERENCES, TRIGGER, MAINTAIN en las 91 con privilegios | ninguno medible | ya |
| 2 | INSERT/UPDATE/DELETE en las que solo se leen | medio, acotable | tras verificar tabla por tabla |
| 3 | Escrituras al banco de precios | — | es una pregunta, no una migración |

Hacer el 1 solo ya cierra el único agujero que RLS no cubre. Los otros dos
mejoran la defensa en profundidad y pueden esperar.

## Criterios de terminado del lote 1

1. Ninguna tabla de `public` concede `TRUNCATE`, `REFERENCES`, `TRIGGER` ni
   `MAINTAIN` a `authenticated`.
2. Las 88 conservan `SELECT, INSERT, UPDATE, DELETE` y las tres parciales
   conservan `SELECT` — y hay una prueba que falla si alguna los pierde.
3. Los privilegios por defecto de `postgres` ya no conceden los cuatro.
4. Una tabla creada después nace sin ellos.
5. El E2E completo del asistente sigue pasando.
6. El centinela de E5 sigue en `OK`.

## Matriz de pruebas del lote 1

| Área | Casos |
|---|---|
| **Revocación** | cero tablas con `D`, `x`, `t` o `m` para `authenticated`; las 88 conservan `arwd` y las tres parciales conservan `r` |
| **Bajo el rol** | `set local role authenticated`: un `TRUNCATE` falla con **42501**, y un `SELECT`/`INSERT`/`UPDATE`/`DELETE` sigue comportándose como antes. **Control negativo obligatorio**: antes de la migración, ese mismo `TRUNCATE` funciona |
| **Defecto** | una tabla creada después nace sin los cuatro; control negativo: sin el `alter default privileges`, nace con ellos |
| **No se tocó `anon`** | sigue en cero tablas: el centinela de E5 en `OK` |
| **Camino de presupuestos** | el E2E completo del asistente pasa con los privilegios retirados |
| **Mutantes** | revocar también `DELETE` → la prueba de «conserva arwd» debe fallar; omitir el `alter default privileges` → la prueba del defecto debe fallar |

El control negativo del `TRUNCATE` es el que da sentido a todo: sin él, una
prueba que compruebe «no se puede truncar» pasaría igual antes y después si el
rol nunca hubiera podido.

## Riesgos

- **El método sobreestima lo que `authenticated` necesita**, que es el error
  seguro para el lote 1 y el que obliga a verificar tabla por tabla en el 2.
- **El defecto de `supabase_admin`** sigue sin poder alterarse desde una
  migración. El centinela de E5 vigila `anon`; haría falta extenderlo a
  `authenticated` para los cuatro privilegios de este lote.
- **El lote 2 toca `budgets` y `budget_items`**, las tablas centrales del
  producto. No se despliega sin que el E2E completo pase con los privilegios
  ya retirados.
