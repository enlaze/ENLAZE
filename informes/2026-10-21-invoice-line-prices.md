# Las líneas de factura alimentan el banco de precios

Rama: `codex/invoice-line-prices`. Base: `origin/main`,
`f11da2c3c26291a28e1b404c8ff54580c3ecf799` (verificada en remoto).
Implementación preparada para revisión. Sin PR ni despliegue.

## Resultado

El OCR devuelve sus líneas y la unidad explícita; no registra facturas al extraer.
El formulario conserva esas líneas y las escribe al confirmar la cabecera, con
identidades estables en los reintentos. No duplica la cabecera si falla la escritura
de líneas o la promoción documental. Las altas manuales y la edición fiscal siguen
su flujo existente.

`received_invoice_lines` conserva descripción, cantidad, unidad, precio unitario
extraído e importe, factura y dueño. No inventa una unidad/cantidad ausente. El
precio reutilizable es el neto de línea después de descuentos y sin IVA dividido
por cantidad, redondeado en PostgreSQL a los céntimos que admite el presupuesto.
Se conservan abonos e incompletas, pero no aportan candidatos. Las fechas futuras,
las facturas rechazadas y las enviadas a papelera tampoco aportan precios.

La prioridad queda `manual_locked` → `received_invoice` → niveles anteriores.
Se cumple tanto en V2 como en el camino alternativo V1 y aunque se personalicen
prioridades. Reutiliza el emparejador b1 completo: Dice 0,85, medidas y unidad. A
igual coincidencia prefiere la factura más reciente. Comparte la función de edad
con `historical_approved`: 0,88 antes de 30 días, 0,78 antes de 60 y 0,65 después.
No se intenta resolver abreviaturas ni se relaja el umbral.

## Confidencialidad y usos reales

- Lectura exclusivamente con cliente autenticado, filtro de dueño y RLS que exige
  también la propiedad de la factura. No utiliza el cliente privilegiado del catálogo.
- Sin INSERT/UPDATE/DELETE/TRUNCATE directos para authenticated; anon sin lectura.
  La RPC fija el dueño desde la factura, bloquea su fila y verifica cuenta/billing y
  el bloqueo de borrado de cuenta bajo el mismo advisory lock del flujo existente.
- Los precios de factura no se escriben en la caché de resolución. La carga por
  páginas de UUID supera el límite de 1.000 filas sin paginación por timestamps.
- `get_invoice_price_stats()` devuelve precios utilizables y usos efectivamente
  guardados. El contador es único por línea de factura/presupuesto. Valida dueño,
  unidad según b1, coste neto adoptado y fecha de la factura. Consultar, repetir una
  línea, autosalvar o deshacer una transacción no infla el contador.
- Los eventos conservan UUID históricos sin FK a línea/presupuesto; se eliminan al
  borrar la cuenta. No almacenan descripciones ni importes. Su lectura es privada.

Se reutiliza el transporte UUID ya existente `budget_items.price_item_id`,
discriminado por `price_source_type`; la migración documenta ambos significados.
No se modifica el writer de presupuestos. El motor permanece intacto: un adaptador
solo en su entrada/salida presenta esta evidencia como histórica y restaura su tipo
preciso al salir. La procedencia persistida sigue siendo `received_invoice` y la
calibración no modifica el coste facturado. Se protege también de la sustitución
por un catálogo al elegir proveedor.

## Migración y operación

Migración nueva: `20261021120000_received_invoice_prices.sql`, **pendiente**.
Solo se ejecutó en clústeres PostgreSQL 17 desechables de prueba. No hay backfill.
No se han consultado ni modificado producción o Preview.

[Puertas de entrada y auditoría](../docs/fase3/INVOICE-PRICES-CHECKS.sql): registro
inicial ausente, ausencia de aplicación parcial, tres cuentas de filas previas;
después registro exactamente una vez, cuentas idénticas, esquema, RLS, ACL,
funciones y disparador válidos, cero líneas y eventos. Los tres placeholders `-1`
obligan a pegar el precheck; no basta comparar a ojo.

[Rollback](../docs/fase3/INVOICE-PRICES-ROLLBACK.sql): bloquea escrituras antes de
contar. Si hay líneas o eventos, ABORTAR por pérdida destructiva. Sin datos admite
aplicación parcial y elimina, por orden, disparador, funciones, eventos y líneas.
Sin CASCADE y sin modificar el registro de migraciones ni las tablas anteriores.
El cliente controla la transacción. El [procedimiento](../docs/fase3/INVOICE-PRICES.md)
indica aplicar/gatear SQL antes de desplegar los nuevos lectores y escritores.

## Verificación

- **30/30** comprobaciones nuevas con PostgreSQL **17.11** y PostgREST **14.4**:
  dueño A/B, intentos de lectura/escritura y adopción ajenos, neto/descuento,
  prioridad manual, unidades y medidas, edad, más de 1.000 líneas, idempotencia,
  coste y fecha incorrectos, usos únicos, rollback de transacción, cuenta bloqueada
  y solo lectura. Gates rechazan grant retirado, privilegio añadido, RLS desactivado,
  política permisiva, trigger desactivado, search_path alterado, security invoker
  indebido y ejecución pública; rollback vacío y parcial comprobados.
- **8/8** pruebas PostgreSQL del contrato histórico de procedencia. El vocabulario
  original se verifica como histórico; los emisores actuales se verifican contra el
  comentario nuevo. No se reescribió ninguna migración desplegada.
- **174** regresiones aprobadas y **2 TODO preexistentes** en p1-review: las
  comprobaciones de migraciones de bucket documental y agent_connections.
- **8/8** regresiones adicionales: precios propios, resumen y E2E con dobles.
  El PDF cliente sigue sin revelar procedencia.
- E2E real: imagen → revisión OCR → confirmación React → RPC de líneas → Next
  resolutor → otro presupuesto generado → `budget_items`. Pasa en V2 y se comprueba
  además la resolución V1 con el catálogo desactivado; manual_locked sigue ganando.
  Solo OCR/almacén documental externos reciben respuestas de prueba. El navegador,
  Next, PostgREST, RLS, líneas, resolutor y guardado de presupuesto son reales.
- Tipos: `npx tsc --noEmit --incremental false`, salida 0 sin diagnósticos.
- Lint de todos los TS/TSX/MJS afectados: salida 0, **0 errores y 7 avisos
  preexistentes** (provider y resolvedor V1). Sin avisos nuevos.
- CI ejecutará también la integración nueva en su banco PostgreSQL 17/PostgREST 14.4.

No se ejecutó `npm run build`, ni el prebuild que consulta Stripe. No se han
comprobado el empaquetado optimizado ni la ejecución del artefacto de producción.
Las comprobaciones de tipos, lint y navegador con Next dev sí se ejecutaron.

## Mutación obligatoria: dos salidas

Se suprime solo la llamada `save_received_invoice_lines` en una copia temporal.
La factura se confirma pero no conserva líneas. No se altera el checkout original.

[Salida completa con mutación](evidencias/invoice-prices/no-invoice-line-write.log):

```text
INVOICE EVIDENCE: lines=0; persisted source=ai_estimate
AssertionError: INVOICE REUSE: persisted budget must use its private invoice price
actual: 'ai_estimate'
expected: 'received_invoice'
# pass 0
# fail 1
```

[Salida completa restaurada](evidencias/invoice-prices/restored.log):

```text
INVOICE EVIDENCE: lines=1; persisted source=received_invoice
PASS INVOICE REUSE: uploaded image -> OCR review -> received_invoice_lines -> real Next resolver -> second generated budget_items received_invoice / 0.88 / 18.75; prices=1 reused=1
# pass 1
# fail 0
```

[Integración y gates](evidencias/invoice-prices/integration-and-gates.tap),
[contrato histórico](evidencias/invoice-prices/historical-provenance.tap),
[regresiones](evidencias/invoice-prices/regression-summary.txt),
[regresiones adicionales](evidencias/invoice-prices/additional-regression.txt),
[tipos](evidencias/invoice-prices/types.txt), [lint](evidencias/invoice-prices/lint.txt).

## Alcance preservado

Sin cambios en `lib/budget-engine.ts`, writers de presupuesto, definición del
resumen de fuente floja, recogida de precios propios, generadores PDF, comparador,
clasificación, BC3, banco técnico o n8n. Sin PR ni despliegue. La migración queda
para aplicación separada por Álvaro con sus gates.

## Diff de implementación y evidencias (excluye este informe)

```text
 .../workflows/budget-revision-rpcs-integration.yml |   9 +
 ...get-items-price-provenance.integration.test.mjs |  11 +-
 ...t-wizard-full-page.browser.integration.test.mjs |  86 ++++++++
 .../received-invoice-prices.integration.test.mjs   | 239 +++++++++++++++++++++
 __tests__/support/price-provenance-comment.mjs     |   4 +-
 __tests__/support/received-invoice-prices.mjs      |  55 +++++
 app/api/invoices/ocr/route.ts                      |   4 +-
 app/api/prices/resolve/route.ts                    |  22 +-
 .../_components/BudgetGenerateProvider.tsx         |  25 +--
 components/facturacion/useReceivedInvoices.ts      |  17 ++
 docs/fase2/CHECKS.sql                              |   4 +
 docs/fase3/INVOICE-PRICES-CHECKS.sql               |  99 +++++++++
 docs/fase3/INVOICE-PRICES-ROLLBACK.sql             |  36 ++++
 docs/fase3/INVOICE-PRICES.md                       |  99 +++++++++
 .../invoice-prices/additional-regression.txt       |  24 +++
 informes/evidencias/invoice-prices/baseline.log    |  30 +++
 .../invoice-prices/historical-provenance.tap       |  59 +++++
 .../invoice-prices/integration-and-gates.tap       | 203 +++++++++++++++++
 informes/evidencias/invoice-prices/lint.txt        |  13 ++
 .../invoice-prices/no-invoice-line-write.log       |  51 +++++
 .../invoice-prices/regression-summary.txt          | 170 +++++++++++++++
 informes/evidencias/invoice-prices/restored.log    |  30 +++
 informes/evidencias/invoice-prices/types.txt       |   2 +
 lib/price-resolution-selection.ts                  |   1 +
 lib/price-resolver-v2.ts                           |  71 ++++--
 lib/price-resolver.ts                              |   2 +
 lib/provider-materials.ts                          |   2 +-
 lib/received-invoice-prices.ts                     |  72 +++++++
 lib/types/price-bank.ts                            |   2 +
 scripts/test-budget-wizard-provenance-local.mjs    |  33 ++-
 .../20261021120000_received_invoice_prices.sql     | 168 +++++++++++++++
 31 files changed, 1603 insertions(+), 40 deletions(-)
```

Archivos del cambio (además de este informe):

- `.github/workflows/budget-revision-rpcs-integration.yml`
- `__tests__/budget-items-price-provenance.integration.test.mjs`
- `__tests__/budget-wizard-full-page.browser.integration.test.mjs`
- `__tests__/received-invoice-prices.integration.test.mjs`
- `__tests__/support/price-provenance-comment.mjs`
- `__tests__/support/received-invoice-prices.mjs`
- `app/api/invoices/ocr/route.ts`
- `app/api/prices/resolve/route.ts`
- `app/dashboard/budgets/generate/_components/BudgetGenerateProvider.tsx`
- `components/facturacion/useReceivedInvoices.ts`
- `docs/fase2/CHECKS.sql`
- `docs/fase3/INVOICE-PRICES-CHECKS.sql`
- `docs/fase3/INVOICE-PRICES-ROLLBACK.sql`
- `docs/fase3/INVOICE-PRICES.md`
- `informes/evidencias/invoice-prices/additional-regression.txt`
- `informes/evidencias/invoice-prices/baseline.log`
- `informes/evidencias/invoice-prices/historical-provenance.tap`
- `informes/evidencias/invoice-prices/integration-and-gates.tap`
- `informes/evidencias/invoice-prices/lint.txt`
- `informes/evidencias/invoice-prices/no-invoice-line-write.log`
- `informes/evidencias/invoice-prices/regression-summary.txt`
- `informes/evidencias/invoice-prices/restored.log`
- `informes/evidencias/invoice-prices/types.txt`
- `lib/price-resolution-selection.ts`
- `lib/price-resolver-v2.ts`
- `lib/price-resolver.ts`
- `lib/provider-materials.ts`
- `lib/received-invoice-prices.ts`
- `lib/types/price-bank.ts`
- `scripts/test-budget-wizard-provenance-local.mjs`
- `supabase/migrations/20261021120000_received_invoice_prices.sql`
