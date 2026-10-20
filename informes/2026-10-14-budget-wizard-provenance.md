# E2E real: procedencia del precio hasta la persistencia

Rama `codex/budget-wizard-provenance`, PR #52. Actualizada a `origin/main` (`dda074c`): desde ese cambio los materiales de la cesta se guardan en `wizard_state.materials`, y únicamente las partidas entran en `budget_items`.

El E2E existente `__tests__/budget-wizard-full-page.browser.integration.test.mjs` abre un borrador vacío, avanza por la página Next, ejecuta las rutas reales de análisis y resolución y guarda mediante la RPC real y PostgREST. Las fuentes son tarifas privadas sintéticas; no se siembra procedencia en el presupuesto ni se simula el writer.

Comprueba las cinco filas nuevas de `budget_items` y los ocho materiales de `wizard_state`: fuente, confianza y fecha coinciden con la respuesta del resolutor. Después edita un precio en el input real: la fila editada guarda `user_edited`, confianza 0.95 y fecha actual, y las otras cuatro permanecen iguales. Conserva los casos previos de hidratación sin escritura, conflicto entre pestañas, finalización y partidas antiguas.

El runner `npm run test:budget-wizard-provenance-local` inicia y elimina su propio PostgreSQL 17/PostgREST. La ejecución del 19 de octubre pasó el baseline y mató tres mutaciones: pérdida de procedencia en partidas, materiales o ambos. Las partidas se comprueban en SQL; los materiales se comprueban en el JSON persistido. Salidas completas en `informes/evidencias/budget-wizard-provenance/`.

Pila local: PostgreSQL 17.11, PostgREST 16.4, Next 16.3.8 (lockfile) y Chrome. CI usa PostgreSQL 17 y PostgREST 12.2.3. El banco rechaza credenciales de producción, archivos de entorno y conexiones externas. Las migraciones de preparación se ejecutan exclusivamente en la base desechable.

Solo cambia pruebas, fixtures, runner, filtros de CI e informes. No se ejecuta `npm run build` local: su prebuild consulta Stripe.
