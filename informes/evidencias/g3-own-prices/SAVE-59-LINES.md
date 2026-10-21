# Coste del disparador sobre un presupuesto de 59 líneas

Medido el 2026-10-21T11:06:26.625Z, antes de fusionar el PR #58. Banco **local desechable**, PostgreSQL 17.11, PostgREST 14.4, Apple M4 ARM64. No es una medición de producción.

Se cronometra el RPC HTTP real `save_budget`, incluida su transacción confirmada y la lectura de la respuesta. La comparación mantiene el mismo esquema migrado, payload y propietario; solo activa/desactiva `record_own_price_reuse` en `budget_items`. No mide la diferencia entre dos aplicaciones o entre dos escritores distintos.

| Presupuesto, siempre 59 líneas | Sin disparador, mediana ms | Con disparador, mediana ms | Diferencia de medianas ms | Con disparador, p95 ms |
| --- | ---: | ---: | ---: | ---: |
| 59 sin reutilizacion (salida inmediata) | 1,356 | 1,376 | +0,020 | 1,654 |
| 21 propias y 38 sin fuente (primer uso) | 1,300 | 1,664 | +0,364 | 1,762 |
| 59 propias (primer uso) | 1,321 | 2,255 | +0,934 | 2,356 |
| 59 propias (autoguardado, eventos ya existentes) | 1,322 | 2,050 | +0,728 | 2,155 |

El mayor incremento de las medianas observadas es **+0,934 ms** cuando se reutilizan 59 precios por primera vez. El camino de salida inmediata añade **+0,020 ms**, comparable al ruido de un banco local. No extrapolar estos tiempos a latencia de red, concurrencia o espera de bloqueos en producción.

## Método y comprobaciones

- 200 guardados medidos por modo y escenario, 1.600 muestras en total.
- 20 bloques equilibrados AB/BA; tres calentamientos descartados por modo y bloque tras cambiar el disparador, diez muestras medidas después.
- `fsync`, `synchronous_commit` y `full_page_writes` verificados en `on`.
- El escenario de primer uso limpia solo los eventos de reutilización antes de cada guardado; esa preparación queda fuera del tiempo. El escenario de autoguardado conserva los eventos previos y verifica que no se duplican.
- Se comprueban 59 filas confirmadas y el número exacto de eventos esperado en cada modo. El banco exige el marcador desechable y rechaza variables de proyectos alojados.
- La migración se aplica con un presupuesto de 59 líneas ya existente y se verifica que su contenido e importes permanecen idénticos.
- El JSON incluye medias, mínimos, máximos y diferencias de bloques para que un pico aislado no se confunda con coste del disparador. No se descartan muestras lentas: solo los calentamientos definidos antes de medir.

Reproducción (sin build ni credenciales externas):

```sh
WIZARD_TEST_POSTGREST_BIN=/private/tmp/enlaze-postgrest-14-4/bin/postgrest node scripts/test-budget-wizard-provenance-local.mjs --own-price-benchmark
```

Resultados: [resumen y estadísticas](save-59-lines-benchmark.json), [1.600 muestras](save-59-lines-samples.csv). Los índices de escenario del CSV corresponden al orden de `results` del JSON. Scripts comprobados con `node --check` y lint sin errores.

## Tiempo del push de la migración

**Push de producción: pendiente, no ejecutado.** La fusión del PR no aplica la migración. Se desplegará aparte, sola y con los gates de `docs/fase3/G3-OWN-PRICES-CHECKS.sql`.

La aplicación SQL local, desde `BEGIN` hasta la confirmación de `COMMIT`, tardó **2,396 ms**. Es un dato del banco, no el tiempo de un `supabase db push` de producción: no incluye autenticación remota, descubrimiento de migraciones, latencia ni espera por tráfico concurrente.

Al ejecutar el despliegue separado se registrarán en este informe el instante de inicio/fin, tiempo de pared del push completo, migración exacta aplicada y resultados de gates anteriores/posteriores, y se comunicará el tiempo a Álvaro. Un fallo o espera de bloqueo se registra como tal; no se sustituye por el tiempo del banco local.
