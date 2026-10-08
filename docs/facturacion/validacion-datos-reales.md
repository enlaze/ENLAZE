# Validación con el esquema y los datos reales

Lo que quedaba pendiente en `unificacion-recibidas.md` y
`recibidas-edicion-papelera.md` era aplicar las migraciones sobre datos de
verdad. Branching sigue pidiendo plan superior en `dsgnymebkxxkslyeotee`, así
que se hizo de otra forma: **reproducir producción en un PostgreSQL 17 local y
desechable** —su esquema sacado del catálogo, sus permisos y sus filas— y
aplicar ahí las dos migraciones.

A producción solo se le hicieron **consultas de lectura**. No se aplicó ninguna
migración, no se creó ninguna rama y no se escribió nada. El banco de pruebas y
cómo repetirlo están en `supabase/validacion/recibidas/`.

## Hasta dónde llega y hasta dónde no

Cubre el esquema real (14 tablas, 59 restricciones), los permisos reales de
`anon`, `authenticated` y `service_role`, las filas reales y la función
`portal_read_snapshot` **byte a byte** la de producción: su `md5(prosrc)` es
`41960f0b…`, la misma huella que exige la guarda de la unificación.

No cubre Storage, Auth de verdad, PostgREST ni la interfaz. Que el hub, el CSV y
el PDF se vean bien en el navegador sigue sin comprobarse.

Las filas llevan nombres, NIF, domicilios y notas sustituidos por valores
sintéticos. Ids, fechas, importes, estados, categorías, claves ajenas y la
diferencia entre NULL y cadena vacía se conservan intactos, que es de lo que
depende la migración.

## Lo que se encontró

### Un dato real que se perdía

`invoices` guardaba `supplier_address`, y la unificación no lo trasladaba:
cuando se escribió, `received_invoices` no tenía esa columna. Una de las dos
facturas trasladadas lleva domicilio de proveedor, y lo perdía de vista.

Arreglado en `20261010120000`, que corre justo después y recupera el dato por
`id` —la unificación lo conserva—, rellenando solo lo que está a null, de modo
que reejecutar no deshace correcciones posteriores. Con esto, además, el
domicilio es justo uno de los datos que la factura necesita para deducir el IVA.

Lo demás que `invoices` tiene y no viaja: `subcategory` y `tags` están vacíos en
las dos filas; `ocr_raw_data`, `ocr_confidence` y `manually_verified` son
chatarra del escaneo, no datos del negocio, y en cualquier caso la tabla no se
borra y siguen ahí.

### El 7 → 9 no lo ve un solo usuario

El total pasa de 7 a 9, pero las dos facturas heredadas son del usuario
`53918141…`, que tiene **una** recibida. Así que:

| Usuario | Antes | Después |
|---|---|---|
| `53918141…` | 1 | **3** |
| `c6c7e97a…` | 6 | 6 |

Quien note el cambio al desplegar es el primero. El segundo, que es el que tiene
el grueso de las facturas, no verá ninguna novedad en su lista: conviene saberlo
antes de dar el despliegue por fallido porque «no aparecen las facturas nuevas».

### El trimestre guardado de la factura sin fecha

`invoices` guardaba `quarter` y `fiscal_year` a mano. Para la factura con fecha
(2025-11-28) decía `Q4`/2025, que es lo que da el periodo derivado de
`issue_date`: coinciden. Para la que no tiene fecha decía `Q3`/2026, y el
periodo derivado la coloca en el 2T de 2026, porque su única fecha recuperable
es `created_at` (2026-04-08). No hay nada que respetar ahí: ese `Q3` no se
apoyaba en ninguna fecha. Queda anotado porque es la única diferencia entre el
periodo que guardaba la tabla vieja y el que ahora se deduce.

## Comprobaciones, todas sobre los datos reales

| # | Qué | Resultado |
|---|---|---|
| 1 | Las dos migraciones se aplican en orden sobre el esquema real | Sin errores |
| 2 | Recibidas pasan de 7 a 9, sin ids repetidos | 9 filas, 9 ids |
| 3 | `invoices` e `invoice_items` siguen enteras | 2 y 8 filas |
| 4 | La factura con fecha conserva número, importes, cliente y documento | 51,66 / 10,85 / 62,51, cliente y documento intactos |
| 5 | La factura sin número ni fecha recibe marcador y fecha de `created_at` | `SIN-NUMERO-16f99b32`, 2026-04-08 |
| 6 | Estado de cobro trasladado | `paid` → pagada con `amount_paid` = total; `pending` → pendiente con 0 |
| 7 | Domicilio del proveedor recuperado | Recuperado donde lo había; sigue a null donde estaba vacío |
| 8 | FK de albaranes apunta a `received_invoices` | Repuntada; el albarán real, que no tenía factura, intacto |
| 9 | Un albarán puede apuntar ya a una factura del hub | Aceptado; una factura inexistente se rechaza (23503) |
| 10 | Portal, caso ambiguo: el Cliente 1 tiene 4 obras | Su factura sin obra **no** asoma (0 facturas) |
| 11 | Portal, caso inequívoco: cliente con una sola obra | Su factura sin obra sí asoma (1, la que toca) |
| 12 | Portal, enlace revocado de verdad y token malformado | `null` en los dos casos |
| 13 | La tabla heredada queda sellada | `authenticated` pierde INSERT y UPDATE, conserva SELECT y DELETE; `service_role` intacto; `anon` sin nada |
| 14 | Las cinco columnas legales existen y llegan vacías a las 9 | Correcto |
| 15 | Editar una factura real con cliente y obra reales de su dueño | Guarda serie, fecha de operación, descripción, obra y categoría |
| 16 | Desglose por tipos sobre una factura real | Guardado, con `iva_percent` a null |
| 17 | Desglose que no cuadra con la base | Rechazado (23514) |
| 18 | Cliente de otro usuario sobre una factura real | Rechazado (42501) |
| 19 | Reejecutar las dos migraciones | Sin duplicados y sin pisar el desglose, la serie ni el domicilio escritos después |

Resumen fiscal que sale de los datos reales, por si sirve de contraste al
desplegar:

| Usuario | Periodo | Facturas | Base | IVA | Total |
|---|---|---|---|---|---|
| `53918141…` | 2025 · 4T | 1 | 51,66 | 10,85 | 62,51 |
| `53918141…` | 2026 · 2T | 1 | 0,00 | 0,00 | 0,00 |
| `53918141…` | 2026 · 4T | 1 | 2.000,00 | 420,00 | 2.420,00 |
| `c6c7e97a…` | 2026 · 2T | 1 | 842,30 | 176,88 | 1.019,18 |
| `c6c7e97a…` | 2026 · 3T | 5 | 3.938,80 | 827,15 | 4.755,95 |

## Cómo se regeneran las filas

Dos consultas de lectura contra producción, que devuelven el guion de INSERT ya
anonimizado. La primera, maestros:

```sql
with u as (
  select format('insert into auth.users (id) values (%L);', id::text) as s, 1 as orden,
         row_number() over (order by id) as n
  from auth.users
), c as (
  select format('insert into public.clients (id, user_id, name, status) values (%L,%L,%L,%L);',
    id::text, user_id::text, 'Cliente ' || row_number() over (order by created_at, id),
    coalesce(status,'active')) as s, 2 as orden, row_number() over (order by created_at, id) as n
  from public.clients
), s as (
  select format('insert into public.suppliers (id, user_id, name, nif, status, type) values (%L,%L,%L,%L,%L,%L);',
    id::text, user_id::text, 'Proveedor ' || row_number() over (order by created_at, id),
    case when nif is null then null when btrim(nif) = '' then ''
         else 'B' || lpad((10000000 + row_number() over (order by created_at, id))::text, 8, '0') end,
    status, type) as s, 3 as orden, row_number() over (order by created_at, id) as n
  from public.suppliers
), p as (
  select format('insert into public.projects (id, user_id, client_id, name, address, status, deleted_at) values (%L,%L,%L,%L,%L,%L,%L);',
    id::text, user_id::text, client_id::text, 'Obra ' || row_number() over (order by created_at, id),
    case when address is null then null when btrim(address) = '' then ''
         else 'Dirección de obra ' || row_number() over (order by created_at, id) end,
    status, deleted_at::text) as s, 4 as orden, row_number() over (order by created_at, id) as n
  from public.projects
)
select string_agg(s, E'\n' order by orden, n)
from (select s,orden,n from u union all select s,orden,n from c
      union all select s,orden,n from s union all select s,orden,n from p) todo;
```

La segunda, facturación: `received_invoices`, `invoices`, `invoice_items`,
`delivery_notes` y `portal_tokens`. Misma forma, con dos reglas que importan:
los importes se vuelcan como texto (`coalesce(col::text,'null')`) para no
perder los NULL, y de los textos solo se preserva si eran NULL, vacíos o
tenían contenido. Está en el historial de la rama; si hay que rehacerla, la
plantilla es la de arriba aplicada a cada tabla con todas sus columnas.

Y el esquema, cuando cambie:

```sql
-- Tablas
select c.relname,
  'create table public.' || c.relname || ' (' || E'\n' ||
  string_agg('  ' || quote_ident(a.attname) || ' ' || format_type(a.atttypid, a.atttypmod)
    || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
    || case when a.attnotnull then ' not null' else '' end, ',' || E'\n' order by a.attnum)
  || E'\n);'
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
where n.nspname = 'public' and c.relname = any($1)
group by c.relname;

-- Restricciones (claves ajenas solo dentro del conjunto, más auth.users)
select 'alter table public.' || t.relname || ' add constraint ' || c.conname || ' '
       || pg_get_constraintdef(c.oid) || ';'
from pg_constraint c
join pg_class t on t.oid = c.conrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public' and t.relname = any($1) and c.contype in ('p','u','c','f')
  and (c.contype <> 'f' or c.confrelid::regclass::text = any($1)
       or c.confrelid::regclass::text = 'auth.users');
```

## Qué sigue pendiente

Solo la comprobación en navegador, que este banco no puede dar: que el hub
liste las 9 con su cliente, que el filtro por trimestre y el CSV cuadren con
Contabilidad y el PDF, y que editar y mandar a la papelera se comporten contra
una base real a través de PostgREST.

Y el orden de siempre: primero `20261009120000`, luego `20261010120000`, después
el código. La segunda recrea `update_received_invoice_and_reconcile` con más
parámetros, así que entre migrar y desplegar el código el panel anterior no
puede corregir facturas.
