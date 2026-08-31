# `supabase/migrations_historico/`

Aquí viven 47 ficheros `.sql` que **estuvieron** en `supabase/migrations/` y ya no están.
No se han borrado. No se han modificado. No se ha convertido ninguno todavía en una
migración nueva.

El CLI de Supabase **no lee este directorio**. Es documentación.

## Qué pasó

El historial de migraciones del proyecto se había partido en dos. Por un lado,
`supabase_migrations.schema_migrations` en producción tenía 34 filas, casi todas aplicadas
desde el dashboard. Por otro, `supabase/migrations/` tenía 62 ficheros, y la intersección
era pequeña: 20 versiones registradas en producción no tenían fichero local, y 47 ficheros
locales no tenían fila en producción.

Eso deja el CLI inutilizable. Su rutina de reconciliación recorre en paralelo las versiones
remotas y las locales comparándolas como cadenas, y aborta de dos maneras distintas:

- si encuentra una versión remota sin fichero local, falla con
  *"Remote migration versions not found in local migrations directory"*;
- si encuentra un fichero local cuya versión es anterior a la última remota, falla con
  *"Found local migration files to be inserted before the last migration on remote database"*.

Antes de esta reconciliación el repositorio disparaba las dos.

## Qué se hizo

1. Se restauraron **20 migraciones** desde `supabase_migrations.schema_migrations.statements`,
   byte a byte, verificando el `md5` de cada una contra el de producción. Son las que producción
   conocía y el repositorio no.
2. Se **renombraron 3 ficheros** a su versión remota real: sus nombres llevaban un prefijo de
   fecha corto (`20260806_03_…`, `20260807_…`) que el CLI parsea como versión `20260806` o
   `20260807`, distinta de la que producción tiene registrada.
3. Se **movieron a este directorio los 47 ficheros** locales que no tienen fila en producción y
   cuya versión queda por debajo del techo remoto `20260825094545`.

El resultado es que `supabase/migrations/` contiene ahora exactamente 35 ficheros: las 34
versiones que producción tiene registradas, y una sola migración pendiente de aplicar,
`20260826103500_update_budget_with_items_canonical.sql`.

## La regla que no hay que romper

**No devuelvas ningún fichero de este directorio a `supabase/migrations/`.**

Todas las versiones de aquí son anteriores a `20260825094545`. En cuanto una vuelva, el CLI
volverá a abortar con el error de *"local migration files to be inserted before the last
migration"*, y el repositorio quedará otra vez irreconciliable.

Si el contenido de alguno de estos ficheros hace falta, la vía correcta es **escribir una
migración nueva, idempotente, con timestamp posterior al último remoto**, que haga sólo lo que
falte. No reaplicar el fichero antiguo.

## Cómo leer `manifest.json`

Cada entrada describe un fichero archivado. Los campos que importan:

- `original_filename` — el nombre tal cual estaba.
- `parsed_version` — la versión que el CLI deduciría del nombre (`^([0-9]+)_(.*)\.sql$`).
- `classification` — `C-local-only-sin-equivalente-remoto` para 46 de los 47, y
  `F-divergencia-real-documentada` para el único que sí tiene equivalente remoto.
- `remote_equivalent_version` — `null` salvo en ese caso.
- `reason_archived` — por qué salió de `supabase/migrations/`.
- `production_state` — `applied`, `partial`, `pending` o `indeterminate`.
- `future_action` — qué hacer con él, si algo.
- `evidence` — en qué se apoya la clasificación.

El reparto es: **27 `applied`**, **6 `partial`**, **2 `pending`**, **12 `indeterminate`**.

### `applied` (27)

Todos los objetos que declaran existen ya en producción. Se aplicaron a mano o por dashboard
sin dejar registro. No hay nada que hacer con ellas: son historia.

### `pending` (2)

Ninguno de sus objetos existe en producción. Son migraciones genuinamente no aplicadas:

- `20260721_obra_partes_gantt.sql`
- `20260806_04_reconcile_supplier_invoiced.sql`

Si su contenido sigue haciendo falta, hay que reescribirlas como migraciones nuevas con
timestamp posterior al último remoto, revisadas una a una.

### `partial` (6)

Parte de sus objetos existe en producción y parte no. Reaplicar el fichero entero sería
incorrecto: hay que crear **sólo lo que falta**, con guardas de idempotencia. El `manifest.json`
lista, para cada una, cuántos objetos faltan de cuántos y cuáles son:

| fichero | ausentes |
|---|---|
| `20260422_agent_connections.sql` | 1 de 2 |
| `20260716_budget_snapshots.sql` | 3 de 4 |
| `20260716_price_bank_v2.sql` | 26 de 39 |
| `20260717_price_bank_v2.sql` | 2 de 17 |
| `20260721_price_alerts_history.sql` | 1 de 11 |
| `20260808_01_fix_p1_deletion_signature_invoice_races.sql` | 2 de 4 |

### `indeterminate` (12)

No se puede decidir por catálogo si corrieron. Son políticas RLS (el nombre de la política no
prueba cuál es la definición vigente), semillas de datos (las filas existen pero pueden venir de
otra vía) y redefiniciones de constraints (el catálogo no data la versión). Antes de tocar
ninguna hay que auditar en producción el efecto concreto.

## El caso aparte: `scheduled_messages`

`20260820_scheduled_messages.sql` es la **única divergencia real de contenido** del inventario
completo, y por eso está clasificado como `F` y no como `C`.

Producción registró la versión `20260820180526`, que crea la tabla añadiendo `user_id` con un
`add column if not exists user_id uuid,` en línea. Esa versión está restaurada byte a byte en
`supabase/migrations/`. El fichero archivado aquí es una revisión posterior y **superconjunto**
de aquélla: sustituye ese inline por un bloque `DO` defensivo que añade la columna, crea la
clave foránea contra `auth.users` y hace `SET NOT NULL`, y termina con un `notify`.

Se comprobó en producción que ese delta **ya está materializado**: la tabla tiene 18 columnas,
`user_id` es `NOT NULL`, existe la FK, y no hay ninguna fila con `user_id` nulo. La diferencia
es de forma, no de efecto.

Por decisión expresa, la migración de reconciliación que reintroduzca el bloque `DO` de forma
idempotente **se escribirá después de cerrar 2D-5**, no ahora.

## Nota sobre las 12 diferencias de `md5` en `supabase/migrations/`

Al comparar los 34 ficheros activos contra `schema_migrations.statements`, 22 dan `md5`
idéntico y 12 no. Las 12 son inofensivas: producción almacena el SQL **normalizado** (sin la
cabecera de comentarios, sin `begin;`/`commit;` y, en un caso, sin un comentario al final de
línea), mientras que el fichero local conserva el original completo. Comparando línea a línea
tras normalizar, las 12 coinciden: la única línea que difería en todo el conjunto era un
comentario inline en `20260807105148_account_deletion_write_lock_fixed.sql`.

Esto importa porque el CLI **compara versiones, no contenidos**: la reconciliación no se ve
afectada.
