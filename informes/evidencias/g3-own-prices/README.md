# G3 fase 4 — precios propios

Rama `codex/g3-own-prices`, creada desde `origin/main` (`51c725d7e26285f0b58b34966f08aee9502ac59c`). Pendiente de revisión, sin PR, despliegue ni acceso a producción.

## Comportamiento

Las partidas sin fuente verificable ofrecen una entrada de coste por unidad, sin IVA, dentro del asistente y del presupuesto guardado. No hay diálogo ni una nueva condición para finalizar. La definición de fuente floja sigue siendo la única de `lib/budget-price-provenance.ts`, con NULL incluido.

La pantalla de Precios y la recogida comparten `saveManualPrice`: escritura confirmada en `price_items`, con nombre, unidad, propietario y sector. La recogida fija `is_manual_override=true`; solo después de confirmar el banco aplica `user_supplied / 0.95 / fecha actual` a la partida. El detalle conserva el margen existente, usa el cálculo financiero compartido y guarda mediante `save_budget` con `lock_version`; sincroniza las partidas del asistente para que reaparezca la corrección al abrirlo.

El resolutor conserva el emparejador b1, Dice 0.85, compatibilidad de medidas y unidad sin conversión. Solo transporta también el ID del precio elegido. Una tarifa manual rechazada por b1 no puede volver a entrar por el emparejador genérico del camino V1. Un presupuesto posterior adopta `manual_locked`, con la confianza 1 que ya tenía ese nivel. Editar solo el importe sigue produciendo `user_edited`, sin cambiar el banco.

## Instrumentación

La migración pendiente `20261021090000_user_supplied_prices.sql` añade la referencia al presupuesto de recogida en `price_items`, la identidad del precio en `budget_items` y eventos de instrumentación con identificadores y fecha. Los importes permanecen exclusivamente en el banco existente; no hay un segundo almacén ni emparejador.

- Guardados: precios distintos recogidos desde presupuestos, una vez por ID de precio, aunque se corrijan varias veces.
- Reutilizados: pares precio/presupuesto posterior guardado, una vez aunque haya líneas repetidas o autoguardados. Se exige fuente `manual_locked`, propiedad, unidad, importe coincidente y evidencia posterior a la recogida.
- Consultas, candidatos rechazados y el presupuesto de origen no suman reutilizaciones. Duplicar un presupuesto no copia la identidad del precio como una nueva adopción.
- El usuario ve ambos contadores en Precios. `get_user_price_collection_stats(p_since)` permite consultar un periodo usando la sesión del propietario; no acepta otro usuario. RLS impide consultar eventos ajenos o escribir contadores directamente.
- Los eventos conservan la historia si se elimina el presupuesto/precio; se eliminan al borrar el usuario.

## Verificación

- `node --test` con `--import tsx`: **214/214** pruebas de escritor, emparejamiento, procedencia, resumen, PDF cliente, recálculo y flujos de presupuesto. Salida en `unit-and-regressions.txt`.
- `npx tsc --noEmit`: **PASS**.
- Lint de todos los archivos de aplicación modificados: seis errores preexistentes (uno en detalle y cinco en Precios), también reproducidos desde `origin/main`; **cero errores nuevos**. Detalle en `lint.txt` y comparación en `lint-comparison.json`.
- E2E real ampliado: Next, Chrome 151.0.7922.47, PostgreSQL 17.11 y PostgREST 14.4. Guardado desde detalle y asistente; `user_supplied / 0.95`; fila manual real del banco; segundo presupuesto `manual_locked`; otra unidad rechazada; resumen 7→6→5 líneas flojas; contadores 2 guardados / 1 reutilizado; autoguardado y consultas sin inflación; candidatos persistidos con unidad/importe/procedencia/fecha incorrectos no cuentan; RLS y gate del rollback comprobados.
- El escritor SQL nuevo se compara con el cuerpo anterior: solo añade el transporte de `price_item_id`; los cálculos y la autorización permanecen iguales. El rollback restaura el cuerpo previo.

## Mutación obligatoria

Reproducción local, sin cargar archivos de entorno ni credenciales externas:

```sh
WIZARD_TEST_POSTGREST_BIN=/private/tmp/enlaze-postgrest-14-4/bin/postgrest node scripts/test-budget-wizard-provenance-local.mjs --own-price-mutation
```

El runner crea y destruye un clúster dedicado. En una copia temporal suprime la ejecución de la escritura en `price_items`, conservando la respuesta de éxito al primer presupuesto para obligar a comprobar el segundo. No modifica el checkout de trabajo.

Con la escritura suprimida (`no-price-items-write.log`):

```text
AssertionError [ERR_ASSERTION]: G3 OWN REUSE: second budget must resolve collected price, not remain without source
actual: 'ai_estimate'
expected: 'manual_locked'
# pass 0
# fail 1
```

Restaurada (`restored.log`):

```text
PASS G3 OWN WIZARD: detail edit survives hydration; inline assistant collection -> user_supplied / 0.95; summary drops again; saved=2 reused=1
PASS G3 OWN REUSE: second real generated budget -> manual_locked; wrong unit rejected; counters saved=1 reused=1; queries/autosave do not inflate; RLS enforced
# pass 1
# fail 0
```

La línea de log con saved=1/reused=1 corresponde al punto de control del segundo presupuesto; después de recoger otro precio en el asistente, el estado final es saved=2/reused=1.

## Límites de esta entrega

La migración solo se ejecutó en los bancos locales desechables del E2E, que se destruyeron; queda pendiente de revisión y aplicación en un entorno autorizado. Se incluyen CHECKS y rollback; el rollback rechaza descartar eventos existentes. No se ha ejecutado `npm run build`: no se comprobó la compilación de producción ni su prebuild que consulta Stripe. Tipos, lint y Next en desarrollo sí se ejecutaron.

No se han cambiado los renderizadores de PDF cliente, comparador, clasificación, BC3, banco técnico, n8n ni datos de producción. No se usó Supabase Preview/Auth ni credenciales de pruebas alojadas. Sin PR.
