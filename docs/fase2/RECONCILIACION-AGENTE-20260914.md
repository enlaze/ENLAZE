# Reconciliación de migraciones del agente · 2026-09-14

## Alcance

Esta rama alinea los nombres locales con las migraciones que ya constan aplicadas en producción del proyecto Supabase `dsgnymebkxxkslyeotee`. No aplica SQL, no repara el historial remoto y no modifica datos de producción.

Base de código: `ff85b3c68ba75f69decc4045696b8494e7d43c8b` (main tras el PR #11).

## Evidencia de producción (solo lectura)

La consulta al historial remoto se tomó el `2026-09-14 14:38:25.681599+00` mediante `clock_timestamp()`:

* 44 versiones registradas, desde `20260408200422` hasta `20260912155346`.
* Las tres versiones del agente están presentes: `20260912133537`, `20260912141703` y `20260912155346`.
* El inventario local de esta rama contiene 45 ficheros SQL: las mismas 44 versiones remotas más la migración local aún pendiente `20260914090000_budgets_lock_version.sql`.
* Por tanto, la única diferencia intencionada para el siguiente preflight es E1 (`20260914090000`); no queda ninguna versión de agente ausente localmente.

## Cambios

| Versión real | Fichero local | Huella del SQL registrado | Bytes |
| --- | --- | ---: | ---: |
| `20260912133537` | `agent_briefing_idempotency_activity_and_cache.sql` | `18e05fd4bd2bada9cc971112dbb1f339` | 4690 |
| `20260912141703` | `agent_ingest_idempotency_all_tables.sql` | `ff6cda9e07c39f09a4e4b17e05afc636` | 3975 |
| `20260912155346` | `agent_reviews_content_dedupe_key.sql` | `6642b029227143e6b8574286a64fcbbc` | 701 |

La primera migración se renombra desde el timestamp antiguo `20260912093000` al timestamp real `20260912133537`. Sus 17 sentencias SQL coinciden con el cuerpo registrado; para comparar se excluyeron únicamente dos bloques de comentario que estaban en el fichero antiguo. No se normalizaron literales, expresiones ni espacios del SQL. Las otras dos migraciones se restauraron con el texto recuperado del registro remoto y un único salto de línea final; sus bytes y MD5 coinciden exactamente. El visor de Supabase añade un `;` de presentación al final, que no forma parte del cuerpo almacenado.

## Verificación

La batería local relacionada pasó completa: **135/135 pruebas**, incluyendo el control de transacciones, orden de partidas, reemplazo atómico, E1 y la comparación estática de estas migraciones. También se verificaron los hashes SHA-256 de los tres ficheros restaurados y que la migración E1 conserva su SHA-256 aprobado `fe29c2bab9c683e86fdc9bcae01899ef5381da73ce138dc159d087822a4550b6`.

No se ejecutó `supabase db push`, ni siquiera en `--dry-run`, en esta rama porque no se dispone de la contraseña de PostgreSQL en el entorno. El historial se consultó desde el editor SQL autenticado y solo se ejecutaron sentencias `SELECT`.

## Siguiente paso seguro

Revisar este PR y, antes de aplicar E1, repetir desde un terminal autenticado el preflight exacto: `migration list`, `db push --dry-run` y la comprobación de que aparece únicamente `20260914090000_budgets_lock_version.sql`. Después de una revisión explícita se podrá aplicar E1 por separado. Esta reconciliación no autoriza ni implica cambiar el historial remoto ni desplegar las migraciones del agente otra vez.
