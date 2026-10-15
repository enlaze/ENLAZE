# G3 fase A — prueba de persistencia real

Rama: `codex/g3-a-ai-estimate`. Validación local del 15 de octubre de 2026.

La aserción de cierre está en `__tests__/budget-wizard-full-page.browser.integration.test.mjs`.
El navegador pulsa «Volver a calcular» en la página Next real, llama a la ruta
`/api/agent/budget-analysis` y el autoguardado escribe mediante PostgREST y las
funciones SQL reales. Después, una consulta SQL independiente lee `budget_items`:
15 líneas nuevas, ninguna con `price_source_type IS NULL`; las siete propuestas
por el modelo conservan `ai_estimate`, confianza `0.20` y fecha actual.

El caso usa autenticación sintética, una respuesta local fija del modelo y una
cuota de prueba. No sustituye la ruta de IA, el resolutor, el escritor de
presupuestos, PostgREST ni PostgreSQL. Un producto sin coincidencia permite
recorrer el resolutor V2 sin búsquedas web. El esquema auxiliar está en
`__tests__/support/budget-wizard-ai-fixtures.sql`.

El banco se protege con los controles existentes de base, puerto, marcador y
versión PostgreSQL. Se crearon clústeres PostgreSQL 17 nuevos y desechables para
cada ejecución; se cerraron al terminar. Las migraciones históricas de esquema y
escritores G3 se cargaron exclusivamente allí. **La nueva migración
`20261015090000_budget_items_ai_estimate_comment.sql` no se aplicó.**

## Ejecución y resultados

Comando de prueba, con el banco local del workflow existente preparado:

```sh
node --test --test-reporter=tap __tests__/budget-wizard-full-page.browser.integration.test.mjs
```

Entorno local: Node 25.8.2, PostgreSQL 17.11, PostgREST 16.4 y Chrome del sistema.
El workflow existente conserva Node 22 y PostgREST 12.2.3; esa combinación de CI
no se ejecutó localmente. El workflow incluye ahora la nueva fixture SQL y el
helper de procedencia en sus filtros de archivos.

La mutación elimina temporalmente estas tres asignaciones de la ruta de IA:

```ts
item.price_source_type = "ai_estimate";
item.price_confidence = AI_ESTIMATE_CONFIDENCE;
item.price_checked_at = checkedAt;
```

Se ejecutó el mismo E2E sin modificar sus aserciones: salida 1 por siete filas
persistidas con NULL. Se restauró el archivo byte por byte mediante `finally` y
se repitió el mismo recorrido: salida 0. La espera comprueba la presencia de las
líneas, no su procedencia; el fallo es la aserción SQL, no un timeout.

## Salida íntegra con mutación — exit 1

```text
Runtime: v25.8.2
postgres (PostgreSQL) 17.11 (Homebrew)
PostgREST 16.4
TAP version 13
# node:internal/modules/run_main:107
#     triggerUncaughtException(
#     ^
# AssertionError [ERR_ASSERTION]: NULL en partidas NUEVAS de budget_items: Pintura pared G3 0, Pintura pared G3 1, Pintura pared G3 2, Pintura pared G3 3, Pintura pared G3 4, Pintura pared G3 5, Pintura pared G3 6
# + actual - expected
# + [
# +   'Pintura pared G3 0',
# +   'Pintura pared G3 1',
# +   'Pintura pared G3 2',
# +   'Pintura pared G3 3',
# +   'Pintura pared G3 4',
# +   'Pintura pared G3 5',
# +   'Pintura pared G3 6'
# + ]
# - []
#     at file:///Users/alvaromirallesgrande/.codex/.chatgpt-projects/g-p-69de2eaeed248191ab741c6a4d91510c/enlaze-g3-a/__tests__/budget-wizard-full-page.browser.integration.test.mjs:413:10
#     at process.processTicksAndRejections (node:internal/process/task_queues:104:5) {
#   generatedMessage: false,
#   code: 'ERR_ASSERTION',
#   actual: [
#     'Pintura pared G3 0',
#     'Pintura pared G3 1',
#     'Pintura pared G3 2',
#     'Pintura pared G3 3',
#     'Pintura pared G3 4',
#     'Pintura pared G3 5',
#     'Pintura pared G3 6'
#   ],
#   expected: [],
#   operator: 'deepStrictEqual',
#   diff: 'simple'
# }
# Node.js v25.8.2
# Subtest: __tests__/budget-wizard-full-page.browser.integration.test.mjs
not ok 1 - __tests__/budget-wizard-full-page.browser.integration.test.mjs
  ---
  duration_ms: 44258.3045
  type: 'test'
  location: '/Users/alvaromirallesgrande/.codex/.chatgpt-projects/g-p-69de2eaeed248191ab741c6a4d91510c/enlaze-g3-a/__tests__/budget-wizard-full-page.browser.integration.test.mjs:1:1'
  failureType: 'testCodeFailure'
  exitCode: 1
  signal: ~
  error: 'test failed'
  code: 'ERR_TEST_FAILURE'
  ...
1..1
# tests 1
# suites 0
# pass 0
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 44262.871209
```

## Salida íntegra restaurada — exit 0

```text
Runtime: v25.8.2
postgres (PostgreSQL) 17.11 (Homebrew)
PostgREST 16.4
TAP version 13
# PASS G3 PostgreSQL 17: 15 líneas nuevas en budget_items, 0 NULL; 7 ai_estimate con confianza 0.20 y fecha actual
# PASS: wizard hydrates without writing, autosaves, rejects a stale tab, finalizes through PostgREST and keeps a legacy budget items
# Subtest: __tests__/budget-wizard-full-page.browser.integration.test.mjs
ok 1 - __tests__/budget-wizard-full-page.browser.integration.test.mjs
  ---
  duration_ms: 52864.154375
  type: 'test'
  ...
1..1
# tests 1
# suites 0
# pass 1
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 52869.111125
```

## Otras comprobaciones y límites

- `tsc --noEmit`: salida 0.
- ESLint del E2E modificado: salida 0, sin diagnósticos.
- Procedencia y escritores: 30 pruebas, 30 pasan, 0 fallan, 0 omitidas.
- La entrega anterior pasó 228 pruebas de regresión y el E2E rápido con dobles,
  que se conserva como comprobación adicional del cableado.
- El lint global de la entrega anterior tenía 23 errores y 135 avisos ya
  existentes; la comparación con la base no encontró diagnósticos nuevos.
- No se ejecutó build ni prebuild, ni se consultó Stripe. Siguen sin comprobarse
  el empaquetado, prerenderizado y comportamiento de la compilación de producción.
- No se modificó el PDF cliente ni se accedió a Supabase producción.
- No se cambiaron comparador, clasificación, BC3, banco técnico ni n8n.
- No se abrió PR. La rama se publica para revisión.
