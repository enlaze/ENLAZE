# Banco de pruebas: facturas recibidas con el esquema y los datos reales

Reproduce producción en un PostgreSQL local y desechable para aplicar ahí
`20261009120000_unify_received_invoices.sql` y
`20261010120000_received_invoice_legal_fields.sql` antes de tocar producción.

No sustituye a una rama de Supabase: no hay Storage, ni Auth de verdad, ni
PostgREST. Lo que sí cubre —y era lo que faltaba— es el **esquema real** y los
**datos reales**, en lugar de un esquema escrito a mano con filas inventadas.

## Qué hay aquí

| Fichero | Qué es |
|---|---|
| `00-base.sql` | Lo que Supabase da hecho: esquema `auth`, `auth.uid()` leída de `test.uid`, los tres roles y las funciones auxiliares de `portal_tokens`. |
| `01-tablas.sql` | DDL de las 14 tablas implicadas, extraído del catálogo de producción. |
| `02-restricciones.sql` | Sus 59 claves primarias, ajenas, únicas y CHECK, también del catálogo. |
| `02b-permisos.sql` | Los permisos de partida reales. Sin esto, comprobar que la unificación quita INSERT/UPDATE y conserva SELECT no probaría nada. |
| `05-escenario-portal.sql` | Añadido sintético y marcado: producción solo tiene enlaces de portal revocados, así que hacen falta dos activos para ejercitar las dos ramas de la regla de visibilidad. |
| `06-comprobaciones.sql` | Las comprobaciones: portal, resumen por trimestre, edición, desglose, sellado de la tabla heredada y albaranes. |

Falta a propósito `04-datos.sql`, que son las filas. **No se guarda en el
repositorio**: aunque va anonimizado, lleva números de factura e importes
reales. Se regenera cuando se necesita, con las consultas de abajo.

## Cómo regenerar las filas

Dos consultas de **solo lectura** contra producción. Devuelven directamente el
guion de INSERT, con nombres, NIF, domicilios y notas sustituidos por valores
sintéticos, y conservando ids, fechas, importes, estados, categorías, claves
ajenas y la diferencia entre NULL y cadena vacía, que es de lo que depende la
migración.

La primera cubre `auth.users`, `clients`, `suppliers` y `projects`; la segunda,
`received_invoices`, `invoices`, `invoice_items`, `delivery_notes` y
`portal_tokens`. Están en `docs/facturacion/validacion-datos-reales.md`, en el
apartado «Cómo se regeneran las filas», para no duplicarlas aquí.

Si el esquema de producción cambia, `01-tablas.sql` y `02-restricciones.sql` se
regeneran con las consultas de catálogo del mismo documento.

## Cómo se ejecuta

Hace falta un PostgreSQL 17 local (`brew install postgresql@17`) y **ningún**
acceso a producción más allá de haber regenerado las filas.

```sh
export LC_ALL=C          # si no, el postmaster de macOS no arranca
initdb -D /tmp/val/data -U postgres --no-locale --encoding=UTF8
pg_ctl -D /tmp/val/data -o "-h 127.0.0.1 -p 55448 -c unix_socket_directories=''" -l /tmp/val/log start
psql -h 127.0.0.1 -p 55448 -U postgres -d postgres -c "create database validacion;"

for f in 00-base 01-tablas 02-restricciones 02b-permisos 03-portal-snapshot 04-datos 05-escenario-portal; do
  psql -h 127.0.0.1 -p 55448 -U postgres -d validacion -v ON_ERROR_STOP=1 -f "$f.sql"
done
psql ... -f ../../migrations/20261009120000_unify_received_invoices.sql
psql ... -f ../../migrations/20261010120000_received_invoice_legal_fields.sql
psql ... -f 06-comprobaciones.sql
```

`03-portal-snapshot.sql` tampoco está aquí: son las líneas 72–213 de
`../../migrations/20260929100000_portal_rpcs_drop_legacy_token.sql`, o sea la
función `portal_read_snapshot` sin la guarda de esa migración, que exige
`projects.access_token`, columna ya retirada. Se extrae así:

```sh
sed -n '72,213p' ../../migrations/20260929100000_portal_rpcs_drop_legacy_token.sql > 03-portal-snapshot.sql
```

Que la copia local sea la de producción se comprueba por su huella, la misma
que acepta la guarda de la unificación:

```sql
select md5(prosrc) = '41960f0bd6850ba24e8c944117831287'
  from pg_proc where oid = 'public.portal_read_snapshot(text)'::regprocedure;
```

Al terminar: `pg_ctl -D /tmp/val/data stop` y borrar el directorio. Lleva datos
del negocio, aunque anonimizados.
