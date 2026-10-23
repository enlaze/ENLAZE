# Gates y rollback — G3 precios propios

Rama `codex/g3-own-prices-gates`, creada desde `origin/main` (`772cc6cd31e66a49ca299531bdf2ec84a7032e58`). Sin PR. No hay SQL aplicado fuera de clústeres nuevos, locales y desechables; la ejecución de producción corresponde exclusivamente a Álvaro.

La migración fusionada no se modifica. SHA-256 de `20261021090000_user_supplied_prices.sql`: `af87a063a9a4eeca6ba7317ea68ff50b5fceb2fba524cd03dd7ce762f6fb7c46` (idéntico a `origin/main`). No se modifica código de la aplicación.

## Bloques del operador

La única definición ejecutable está en `docs/fase3/G3-OWN-PRICES-CHECKS.sql` y `docs/fase3/G3-OWN-PRICES-ROLLBACK.sql`. El índice de `docs/fase2/CHECKS.sql` y `ROLLBACK.sql` apunta a esos archivos.

1. `CHECK_G3_OWN_PRECHECK`, antes del push: exige cero registros de versión, rechaza tipos incompatibles y cualquier aplicación parcial, y devuelve `price_items_precheck` y `budget_items_precheck`. Incluso las columnas UUID ya existentes abortan: la migración usa ADD COLUMN sin IF NOT EXISTS.
2. `CHECK_G3_OWN_AUDIT`, inmediatamente después y antes de permitir escrituras: el operador pega **ambos** conteos previos en las dos constantes `-1`. Exige versión registrada exactamente una vez, cuentas idénticas, columnas UUID anulables sin default, tabla de eventos con RLS, SELECT para authenticated sin INSERT/UPDATE/DELETE (incluidos permisos de columna), ausencia de privilegios anon, funciones SECURITY DEFINER con search_path vacío y ACL privadas, ambos disparadores activos y enlazados a las funciones correctas, y **cero eventos**.
3. Si aparece ABORTAR se detiene el proceso y se investiga. No se reemplazan las constantes con conteos posteriores para conseguir OK. La cuenta de eventos se hace como operador que no esté filtrado por RLS: se rechaza un cero obtenido por una sesión que oculte eventos ajenos. Una tabla de eventos ausente también devuelve ABORTAR, sin error de referencia a una relación inexistente.
4. `ROLLBACK_G3_OWN`: bloque manual dentro de una transacción del cliente, tras revertir la aplicación. Orden escrito y ejecutado: **dos disparadores → funciones → tabla de eventos → dos columnas**. La RPC auxiliar se retira y el escritor anterior se restaura en el paso de funciones. No usa CASCADE. Se restaura también el comentario anterior y se notifica la recarga del esquema.

El rollback es destructivo si ya hay eventos recogidos: perdería historial y referencias. **El guard lo bloquea antes de soltar ningún objeto si hay un solo evento**; exportar y revisar antes de decidir cómo proceder. No borra precios ni partidas. No cambia el registro de migraciones; cualquier reconciliación de ese registro corresponde al operador, no a este bloque.

Los dos conteos son controles de cardinalidad, no hashes del contenido. En las pruebas se compara además el snapshot completo de los precios/partidas para demostrar que la migración y el rollback conservan sus importes y datos anteriores.

## Pruebas reales

Reproducción sin archivos de entorno, credenciales alojadas, Stripe ni build:

```sh
WIZARD_TEST_POSTGREST_BIN=/private/tmp/enlaze-postgrest-14-4/bin/postgrest node scripts/test-budget-wizard-provenance-local.mjs --own-price-gates --with-wizard
```

El runner crea, verifica y destruye el clúster PostgreSQL 17.11. PostgREST es 14.4. El test se incorpora también al workflow existente antes del E2E real del asistente.

- **45/45** pruebas: gates reales leídos de los archivos del operador, datos previos de 6 precios y 59 partidas, auditoría OK con 6/59 y cero eventos; PRECHECK/AUDIT ejecutables en transacciones de solo lectura.
- Manipulaciones dentro de transacciones descartadas: registro ausente/duplicado, placeholders sin rellenar o cuentas distintas, filas añadidas/eliminadas, tabla ausente, RLS desactivado, SELECT revocado, escrituras concedidas (incluidas por columna), permisos anon, disparadores desactivados/ausentes/mal enlazados, funciones ausentes o SECURITY INVOKER, search_path modificado, función privada expuesta, tipo/default de columna cambiado y evento inesperado. Todas dan ABORTAR; deshacer solo la manipulación devuelve OK.
- Un evento de otro usuario oculto por RLS produce un conteo aparente de cero, pero la auditoría devuelve ABORTAR por lectura filtrada.
- Rollback real, sin eventos: elimina objetos en orden, conserva filas/importes y restaura cuerpo, ACL y comentario anteriores del escritor. Con un evento: se rechaza y conserva funciones, disparadores e historial.
- **E2E real del asistente: PASS**, tras los gates en el mismo clúster: confirma compatibilidad del rollback actualizado y mantiene la recogida/reutilización de precios.
- **17/17** regresiones rápidas de escritor/procedencia; tipos y lint de los archivos modificados: PASS.
- No se ejecutó build, no se abrió PR y no se accedió a producción.

Salidas: `gates-and-rollback.tap`, `wizard-regression.log`, `writer-and-provenance.txt`, `types-and-lint.txt`.

Ejemplos de veredictos observados:

```text
Quitar SELECT:          ABORTAR: privilegios de user_price_collection_events incompatibles
Desactivar disparador:  ABORTAR: disparadores ausentes, desactivados o enlazados incorrectamente
Cambiar search_path:    ABORTAR: funciones ausentes, security definer, search_path o ACL incompatibles
Evento inesperado:      ABORTAR: hay eventos; hubo escrituras durante la aplicacion, investigar antes de continuar
Tras revertir cada manipulación: OK
```
