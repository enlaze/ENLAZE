# Deuda técnica registrada

Este documento recoge defectos conocidos que están fuera del alcance del plan de
refactorización del generador de presupuestos (ver
`docs/ANALISIS-ARQUITECTURA-PRESUPUESTOS.md`). Cada entrada describe el problema,
por qué no se ha corregido todavía y qué haría falta para cerrarla.

---

## DT-001 — `price-catalog-search` consulta el catálogo con `.limit()` sin orden determinista

**Estado:** abierta. No corregir dentro de las Fases 0–6 del plan de presupuestos.

**Detectada:** 2026-08-23, al diagnosticar el fallo preexistente de
`__tests__/price-catalog-search.test.mjs`.

### Qué pasa

`buildCatalogSearchTokenGroups` (`lib/price-catalog-search.ts`) genera varios
grupos de tokens por material. Cada grupo se convierte en una consulta
independiente de texto completo sobre `pb_products`, y los resultados de todas
ellas se unen en un `Map` por `id`.

Las dos consumidoras aplican un tope de filas **sin `ORDER BY`**:

| Consumidora | Línea | Tope |
| --- | --- | --- |
| `app/api/prices/resolve/route.ts` | `.limit(80)` tras `.textSearch(...)` | 80 filas |
| `scripts/audit-atomic-material-coverage.ts` | `.limit(150)` tras `.textSearch(...)` | 150 filas |

Sin cláusula de orden, PostgreSQL devuelve las filas en el orden en que las
produce el plan de ejecución. Ese orden no está garantizado y puede cambiar con
un `VACUUM`, con un cambio de plan o simplemente al crecer la tabla.

### Por qué importa

Cuando el número de productos que casan con un grupo de tokens supera el tope,
el subconjunto que sobrevive es **arbitrario y no reproducible**. Consecuencias:

1. **Resultados no deterministas.** La misma búsqueda puede devolver candidatos
   distintos en dos ejecuciones consecutivas, y por tanto el resolutor de precios
   puede elegir un producto distinto sin que haya cambiado nada.
2. **Pérdida silenciosa de cobertura.** Un producto perfectamente válido puede
   no llegar nunca al matcher estricto porque quedó fuera del corte.
3. **Se degrada al crecer el banco.** Hoy el banco es pequeño y el tope casi
   nunca se alcanza. Cuanto más catálogo se ingiera, más frecuente será.

Este es justamente el motivo por el que la regla de imprimación mantiene la
alternativa estrecha `["fondo","fijador"]` además de la amplia `["fijador"]`:
la consulta estrecha es la red de seguridad frente al truncamiento arbitrario de
la amplia. Es decir, hoy estamos compensando el síntoma añadiendo consultas
redundantes en lugar de arreglar la causa.

### Qué haría falta para cerrarla

Ordenar por relevancia de texto completo antes de aplicar el tope, de modo que
lo que se descarte sea siempre lo menos relevante y el resultado sea
reproducible. En Postgres es `ts_rank` / `ts_rank_cd` sobre el mismo
`tsvector` que ya indexa `idx_pb_products_name_fts`. PostgREST no expone
`ts_rank` directamente en `.order()`, así que probablemente haga falta una de
estas dos vías:

- una función RPC en Supabase que encapsule `SELECT ... ORDER BY ts_rank(...) DESC LIMIT n`
  y llamarla con `.rpc()`; o
- una columna generada / vista materializada con el `tsvector` y un orden
  estable de desempate (por ejemplo `ts_rank DESC, id ASC`).

Cerrada la causa, procede revisar si siguen haciendo falta todas las
alternativas estrechas de `CATALOG_SEARCH_RULES` o si algunas se pueden retirar,
ahorrando una ida y vuelta a la base de datos por material.

**Nota:** cualquier cambio aquí toca la resolución de precios, no la aritmética
del presupuesto. Es independiente de las Fases 0–6 y debe validarse con
`test:price-catalog-search`, `test:price-resolution-selection` y
`test:commercial-product-match`.
