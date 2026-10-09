# Despliegue de la unificación de facturas recibidas

Rama: `fix/recibidas-editar-papelera-legal`, con `main` ya integrado.
Vuelta atrás: `ROLLBACK-recibidas.sql`. Validación: `validacion-datos-reales.md`.

## Antes de nada: producción va por detrás de `main`

A 9 de octubre de 2026, `dsgnymebkxxkslyeotee` tiene aplicadas 66 migraciones y
la última es `20261008120000_budget_items_price_provenance`. Quedan **cuatro**
pendientes, y solo dos son de este trabajo:

| Versión | De dónde viene | Nota |
|---|---|---|
| `20261005160000_authenticated_drop_unused_privileges` | `main` | ⚠ **Fuera de orden**: es anterior a la última aplicada |
| `20261008130000_budget_items_price_provenance_writers` | `main` | En orden |
| `20261009120000_unify_received_invoices` | esta rama | En orden |
| `20261010120000_received_invoice_legal_fields` | esta rama | En orden |

La primera detendrá `supabase db push`: el CLI no acepta un fichero anterior al
último registro. Tiene salida fácil, y **renumerarla no es la buena**:

- **`supabase db push --include-all`** es la vía. Aplica también lo anterior al
  último registro, y una vez aplicada queda en el historial, así que no vuelve a
  quejarse en despliegues futuros.
- **Renumerarla sería un error.** Esa serie (E6 lote 1) ancla su prueba
  (`__tests__/authenticated-unused-privileges.integration.test.mjs`), su bloque
  de comprobaciones (`docs/fase2/CHECKS.sql`) y su compensación
  (`docs/fase2/ROLLBACK.sql`) a la cadena `20261005160000`. Cambiarle el número
  rompe los tres sitios.
- **Por `psql` el problema no existe**: `psql -f` ejecuta el fichero sin mirar
  el orden. Solo hay que registrar la versión después, o `migraciones:check`
  la dará por pendiente para siempre:

  ```sql
  insert into supabase_migrations.schema_migrations (version, name)
  values ('20261005160000', 'authenticated_drop_unused_privileges')
  on conflict (version) do nothing;
  ```

El `migraciones:check` del repositorio, por su parte, **no mira el orden**: solo
compara conjuntos —pendientes, ausentes y duplicadas—, así que una versión
antigua aplicada tarde no le molesta.

Ojo: esa migración tiene su propio bloque de comprobación en
`docs/fase2/CHECKS.sql` (busca «E6 lote 1»), que conviene pasar al aplicarla.
No es de este trabajo, pero cae en el mismo despliegue.

Comprobación del estado real antes de empezar:

```sql
select version, name from supabase_migrations.schema_migrations order by version desc limit 5;
```

## La ventana de riesgo

`20261010120000` **suelta y recrea** `update_received_invoice_and_reconcile` con
23 parámetros en lugar de 15. Entre que esa migración entra y el código nuevo
está servido, el panel anterior no puede corregir facturas recibidas: llama a
una firma que ya no existe. Nada se corrompe y nada se pierde; simplemente ese
botón da error hasta que el despliegue termina.

Son minutos, pero se acortan así: aplicar las migraciones **justo antes** de que
el despliegue del código acabe de publicarse, no horas antes. Y si hay que
abortar a mitad, el nivel 1 de `ROLLBACK-recibidas.sql` devuelve la firma de 15
parámetros y el panel anterior vuelve a funcionar sin perder nada.

## Orden

Primero la base, después el código. Y eso significa **antes de fusionar el PR**,
porque fusionar dispara el despliegue.

1. **Aplicar las cuatro migraciones** en orden de versión, con `--include-all`
   por lo de `20261005160000`.
2. **Comprobar** con las consultas de abajo.
3. **Fusionar el PR** en `main` y dejar que se despliegue el código.
4. Si algo va mal, `ROLLBACK-recibidas.sql`, nivel 1 primero.

El orden importa y no es simétrico:

- **Migraciones primero** (correcto): el código anterior sigue funcionando en
  todo salvo un botón, el de corregir una factura cuando el OCR dejó su
  documento pendiente, porque llama a la firma de 15 parámetros que
  `20261010120000` sustituye. Es la ventana descrita arriba, y el nivel 1 de la
  vuelta atrás la cierra en un minuto.
- **Código primero** (mal): el código nuevo pide `clients(name)` —que necesita
  la clave ajena que añade la migración— y columnas que aún no existen. Se cae
  la pestaña de Recibidas entera, no un botón.

Si el despliegue de `main` es automático, fusionar y migrar no se pueden hacer
«a la vez»: hay que migrar antes y fusionar después.

Con el CLI:

```bash
supabase db push --linked --include-all
```

O una a una por `psql`, que es como se probaron en el entorno de pruebas
(`-1` las envuelve en transacción, igual que hace el runner):

```bash
cd supabase/migrations && psql "$URL_DE_PRODUCCION" -1 -v ON_ERROR_STOP=1 -f 20261009120000_unify_received_invoices.sql
```

```bash
cd supabase/migrations && psql "$URL_DE_PRODUCCION" -1 -v ON_ERROR_STOP=1 -f 20261010120000_received_invoice_legal_fields.sql
```

La guarda de la unificación aborta si `portal_read_snapshot` no es la versión
revisada, así que un cambio ajeno a esa función detiene la migración en lugar de
pisarla. A 9 de octubre de 2026 su huella en producción es la esperada.

## Qué comprobar después

```sql
-- 1. De 7 a 9 recibidas, sin ids repetidos, y la tabla heredada intacta.
select (select count(*) from public.received_invoices) as recibidas,
       (select count(distinct id) from public.received_invoices) as ids,
       (select count(*) from public.invoices) as heredadas,
       (select count(*) from public.invoice_items) as lineas;

-- 2. Las dos trasladadas, con su marcador, su fecha derivada y su domicilio.
select invoice_series, invoice_number, issue_date, supplier_address, client_id, category
  from public.received_invoices
 where id in (select id from public.invoices);

-- 3. La FK de albaranes y la firma de la RPC.
select pg_get_constraintdef(c.oid) from pg_constraint c
 where c.conname = 'delivery_notes_invoice_id_fkey';
select pg_get_function_identity_arguments(p.oid) from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'update_received_invoice_and_reconcile';

-- 4. La tabla heredada sellada para el navegador, con la lectura intacta.
select grantee, string_agg(privilege_type, ', ' order by privilege_type)
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'invoices'
   and grantee in ('anon', 'authenticated', 'service_role')
 group by grantee;
```

Y en la aplicación, que es donde se ve: el hub de Facturación → Recibidas con
las 9 repartidas por periodo (ocho en 2026 y una en 2025), su columna de
cliente, los filtros de cliente y trimestre, editar una, mandar otra a la
papelera y recuperarla, y que el total del hub coincida con Contabilidad y con
el PDF del periodo.

## Lo que ningún usuario va a notar

El total pasa de 7 a 9, pero las dos facturas heredadas son de un solo usuario,
que tenía una recibida: pasa de 1 a 3. El otro usuario, que tiene las seis
restantes, **no verá ninguna novedad en su lista**. Conviene saberlo para no dar
el despliegue por fallido al mirar la cuenta equivocada.
