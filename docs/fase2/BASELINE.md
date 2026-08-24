# Fase 2 — Baseline previo a cualquier migración

**Capturado:** 2026-08-24, antes de aplicar `20260824095335_canonical_domains.sql`.
**Proyecto Supabase:** `dsgnymebkxxkslyeotee` (eu-west-3, Postgres 17.6.1).

Estos son los valores que deben permanecer **idénticos** durante toda la Fase 2. Si alguno
cambia, se para y se revierte con `docs/fase2/ROLLBACK.sql`.

## budget_items

| Métrica | Valor congelado |
|---|---|
| `count(*)` | **807** |
| `sum(quantity * unit_price)` | **978511.3000** |
| `sum(subtotal)` | **978511.61** |
| `md5(string_agg(id::text, ',' order by id))` | **50c5f5cd2b11d09237c73af605e4beac** |
| Huella monetaria por fila (ver abajo) | **e11db5c2ddd964cb7d5daddd709ba3b0** |

### Huella monetaria por fila

Añadida el 2026-08-24, tras cerrar las 8 migraciones y **antes** de empezar el backfill.

Las tres métricas anteriores tienen un punto ciego. El MD5 de ids demuestra que no
apareció ni desapareció ninguna línea. Las dos sumas demuestran que los totales globales
no se movieron. Ninguna de las tres detecta un **cambio compensado**: dos líneas que se
alteran en sentidos opuestos y se anulan entre sí en el agregado.

La huella monetaria cierra ese hueco porque hashea los valores económicos **línea a
línea**, no agregados:

```sql
md5(string_agg(
      id::text || '|' ||
      coalesce(quantity::text,   'NULL') || '|' ||
      coalesce(unit_price::text, 'NULL') || '|' ||
      coalesce(subtotal::text,   'NULL'),
      E'\n' order by id)) as huella_monetaria
  from public.budget_items;
```

Notas de diseño, para que el valor sea reproducible y no dé falsos positivos:

- `order by id` fija el orden. Sin él, `string_agg` no es determinista y el hash cambiaría
  entre ejecuciones sin que cambiase ningún dato.
- `coalesce(..., 'NULL')` es obligatorio. Sin él, una sola columna NULL propagaría NULL a
  toda la concatenación de esa fila y la línea desaparecería del hash en silencio.
- El separador `|` entre campos y `\n` entre filas evita colisiones por concatenación
  ambigua (que `12|3` y `1|23` produzcan la misma cadena).
- `quantity::text` sobre `numeric` conserva la escala almacenada, así que el valor es
  estable mientras el dato no cambie.

**Verificado empíricamente**, no asumido. Dentro de una transacción terminada en
`ROLLBACK` se intercambiaron los subtotales de dos líneas, un cambio deliberadamente
compensado. Resultado: `filas` 807 sin cambio, `sum(subtotal)` 978511.61 sin cambio,
`huella_ids` 50c5f5cd… sin cambio, y **`huella_monetaria` cambió** de
`e11db5c2ddd964cb7d5daddd709ba3b0` a `ecfdd18ada701f5aaee4a1906026c4ec`. Tras el
`ROLLBACK` volvió a `e11db5c2…`. Es decir: la huella detecta lo que las otras tres no ven.

## pb_products

| Métrica | Valor congelado |
|---|---|
| `count(*)` | **42221** |
| `count(*) filter (where concept_id is not null)` | **0** |
| `count(*) filter (where concept_match_type is null)` | **0** |

## Consulta de reverificación

Se ejecuta después de cada migración. Debe devolver exactamente los valores de arriba.

```sql
select 'budget_items' as tabla,
       count(*)::text                                      as filas,
       coalesce(sum(quantity * unit_price), 0)::text        as base_calculada,
       coalesce(sum(subtotal), 0)::text                     as base_almacenada,
       md5(coalesce(string_agg(id::text, ',' order by id), '')) as huella_ids
  from public.budget_items
union all
select 'pb_products',
       count(*)::text,
       count(*) filter (where concept_id is not null)::text,
       count(*) filter (where concept_match_type is null)::text,
       ''
  from public.pb_products;
```

## Observación registrada, ajena a Fase 2

`sum(quantity * unit_price)` = 978 511,30 y `sum(subtotal)` = 978 511,61 **no coinciden**:
hay **0,31 € de diferencia acumulada** entre el producto recalculado y el subtotal
almacenado. Es un desajuste de redondeo preexistente, anterior a esta fase y ajeno a ella.

No se corrige aquí. Se anota por dos motivos: para que nadie lo atribuya después a Fase 2,
y porque las dos cifras deben compararse **cada una contra sí misma**, nunca entre sí. La
condición de éxito es que 978511.3000 siga siendo 978511.3000 y que 978511.61 siga siendo
978511.61, no que converjan.

Candidato a revisión en el recálculo del paso 17 con `lib/budget-totals.ts`.

## Registro de versiones reales (opción A)

`apply_migration` genera su propio timestamp con la hora del servidor e ignora el nombre
del archivo. Tras cada aplicación se renombra el archivo local a la versión realmente
registrada, para que el repositorio diga la verdad sobre el estado de la base de datos.

**Regla de inmutabilidad (adoptada el 2026-08-24).** Una migración aplicada es inmutable,
incluidos sus comentarios. Lo único que puede cambiar en ella es el nombre del archivo, y
sólo para hacerlo coincidir con la versión registrada. Un comentario obsoleto dentro de una
migración aplicada se deja como está: es el testimonio de lo que se ejecutó, no
documentación viva. Las referencias se mantienen al día en `docs/`, en `CHECKS.sql` y en las
migraciones todavía no aplicadas, que son los sitios donde alguien las va a leer para
decidir algo.

Consecuencia conocida y aceptada: `20260824101019_canonical_alias_sources.sql:20` menciona
`20260824120300_canonical_aliases`, nombre que ya no existe. El archivo real es
`20260824101548_canonical_aliases.sql`.

| # | Nombre local definitivo | Versión remota | Orden |
|---|---|---|---|
| 1 | `20260824095335_canonical_domains.sql` | `20260824095335` | posterior a `20260820180526` |
| 2 | `20260824095816_canonical_concepts.sql` | `20260824095816` | posterior a `20260824095335` |
| 3 | `20260824101019_canonical_alias_sources.sql` | `20260824101019` | posterior a `20260824095816` |
| 4 | `20260824101548_canonical_aliases.sql` | `20260824101548` | posterior a `20260824101019` |
| 5 | `20260824112605_canonical_relations.sql` | `20260824112605` | posterior a `20260824101548` |
| 6 | `20260824115621_canonical_seed_paint_waste.sql` | `20260824115621` | posterior a `20260824112605` |
| 7 | `20260824121231_budget_items_canonical.sql` | `20260824121231` | posterior a `20260824115621` |
| 8 | `20260824123052_pb_products_canonical_fk.sql` | `20260824123052` | posterior a `20260824121231` |

Las 8 migraciones de Fase 2 están aplicadas. El repositorio y
`supabase_migrations.schema_migrations` coinciden nombre a nombre.

## Reverificaciones del baseline

| Momento | budget_items | base_calculada | base_almacenada | md5 | pb_products | concept_id |
|---|---|---|---|---|---|---|
| Inicial | 807 | 978511.3000 | 978511.61 | 50c5f5cd… | 42221 | 0 |
| Tras `canonical_domains` | 807 | 978511.3000 | 978511.61 | 50c5f5cd… | 42221 | 0 |
| Tras `canonical_concepts` | 807 | 978511.3000 | 978511.61 | 50c5f5cd… | 42221 | 0 |
| Tras `canonical_alias_sources` | 807 | 978511.3000 | 978511.61 | 50c5f5cd… | 42221 | 0 |
| Tras `canonical_aliases` | 807 | 978511.3000 | 978511.61 | 50c5f5cd… | 42221 | 0 |
| Tras `canonical_relations` | 807 | 978511.3000 | 978511.61 | 50c5f5cd… | 42221 | 0 |
| Tras `canonical_seed_paint_waste` | 807 | 978511.3000 | 978511.61 | 50c5f5cd… | 42221 | 0 |
| Tras `budget_items_canonical` | 807 | 978511.3000 | 978511.61 | 50c5f5cd… | 42221 | 0 |
| Tras `pb_products_canonical_fk` | 807 | 978511.3000 | 978511.61 | 50c5f5cd… | 42221 | 0 |

La huella monetaria se capturó por primera vez al cerrar la migración 8:
`e11db5c2ddd964cb7d5daddd709ba3b0`. A partir de aquí se reverifica junto con las demás
métricas, y es la que manda durante el backfill.

Las pruebas del BLOQUE 4 escriben en `canonical_concepts`, `canonical_aliases` y
`canonical_alias_sources`, pero cada bloque termina en un `raise exception` deliberado que
aborta la transacción entera. Los recuentos posteriores lo confirman: 20 / 0 / 5 / 0.
