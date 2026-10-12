# b4-pruebas-verdes — informe (2026-10-08)

## Qué ha cambiado

**Pruebas: de 19 fallos a 0.** Las 52 baterías unitarias dan 564 en verde, 0 fallos y 2 marcadas como pendientes (`todo`); el worker de Python pasa sus 8 pruebas. Ninguna prueba se ha borrado.

El bloque decía que las migraciones "se renombraron". No es así: el commit `7135c48` las **borró** porque nunca se aplicaron. Por eso cada prueba se ha resuelto comprobando primero en la base (solo lectura) qué protección existe hoy de verdad:

| Prueba(s) | Qué pasaba | Qué he hecho |
|---|---|---|
| 8 de bloqueo de escritura | leían `20260806_03`, borrada | apuntan a `20260807105148_account_deletion_write_lock_fixed`, **aplicada**; todas las afirmaciones se cumplen sin tocarlas |
| 2 de conservar el presupuesto | leían `20260804_preserve…`, borrada | apuntan a `20260807123749_budget_presupix_fields`, **aplicada**; sin tocar las afirmaciones |
| policies de `pb_*` | leía `20260806_02`, borrada | apunta a `20260924113527_close_price_bank_write_hole` (**aplicada**, hace lo mismo con un bucle); en la base las 6 policies son solo de `service_role` |
| `reconcile_supplier_invoiced` | función que ya no tiene sentido (`suppliers` no guarda totales) | ahora comprueba su sustituta `update_received_invoice_and_reconcile`: dueño por `auth.uid()`, bloqueo de fila, dueño del proveedor, sin `anon` |
| 4 de facturas recibidas | leían la página vieja, que desde `f5cc00b` solo redirige | leen el hook y la pestaña nuevos (`components/facturacion/`). La de "deshabilitado al guardar" exige ahora que **toda** entrada de fichero se bloquee (antes contaba 2; hoy hay 1) |
| `price-catalog-search` | `3e0230f` añadió a propósito la búsqueda "fondo fijador" y no actualizó la prueba | la prueba espera la búsqueda nueva |
| **2 huecos reales → `todo`** | ver "Qué decides" | se ejecutan y salen en el resultado como pendientes; no se ocultan |

**Lint: de 303 errores a 24.** 189 eran ruido: `.test-out/` (JS compilado subido al repo) y `.claude/` (worktrees de agentes); ahora se ignoran. En código real:
- `any` (75 → 0 sin justificar): tipos reales en rutas de precios, agente y `lib/`. En los `catch`, `err: unknown` + `(err as Error).message` genera el mismo JavaScript. Quedan 7 `any` con comentario de por qué: `sectorData` (claves que vienen del sector en la base) y el JSON de `/api/agent/budget-analysis`.
- `require` en scripts CommonJS de `scripts/`: regla apagada solo ahí. En `ProvidersStep` el `require` del PDF se queda (comentado): pasarlo a `import()` sacaría `window.open` del clic y el navegador podría bloquear la ventana.
- `prefer-const` en `SoftAurora`: la regla se equivoca (`resize()` lee `program` antes de crearlo; con `const` daría ReferenceError). Se queda `let`, comentado.

## Cómo lo he verificado
`tsc` limpio, `npx next build` correcto, todas las pruebas unitarias (52 ficheros) y las del worker. Base: solo `SELECT` (migraciones aplicadas, columnas, buckets, policies). No he ejecutado pruebas de integración (escriben en la base).

## Qué decides tú
1. **Bucket `received-invoice-documents`**: existe y es privado, pero ninguna migración lo crea y **no tiene policy de lectura para su dueño**. ¿Se escribe la migración (bucket + policy de lectura por carpeta del usuario, como la borrada)? Decide si el usuario debe poder abrir sus facturas retenidas desde el navegador.
2. **`agent_connections`**: las 5 columnas (`connected`, `credentials_ref`, `error_message`, `last_sync_at`, `config`) existen en la base pero no en ninguna migración. ¿Añado una migración idempotente que solo las declare (en producción no cambiaría nada)? Ojo: mientras no se aplique, `migraciones-check` la marcará.
3. **24 errores de `react-hooks`** (reglas nuevas del React Compiler: `setState` dentro de efectos, funciones usadas antes de declararse). Arreglarlos exige reordenar efectos en 17 pantallas, y eso sí puede cambiar el comportamiento. Propongo un bloque aparte, pantalla a pantalla, o bajarlos a aviso hasta entonces. No lo he hecho sin tu visto bueno.

## Qué mirar con tus ojos (10 min)
- `git diff main -- __tests__/p1-review.test.mjs`: que cada prueba reapuntada siga exigiendo lo mismo que antes.
- Generar un presupuesto, descargar el PDF cliente e interno: que la ventana se abra igual.
- Facturas → Recibidas: editar una factura y ver que guarda.
