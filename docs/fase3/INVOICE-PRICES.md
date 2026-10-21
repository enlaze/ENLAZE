# Precios privados procedentes de facturas recibidas

Migración pendiente: `20261021120000_received_invoice_prices.sql`. Sin backfill.
No se aplica con este encargo. Los únicos destinos usados en las pruebas son
clústeres PostgreSQL 17 desechables de loopback y PostgREST 14.4.

El OCR sigue extrayendo un borrador. La confirmación del formulario conserva sus
líneas por la RPC `save_received_invoice_lines`, antes de promover el documento.
Un fallo conserva el identificador de cabecera para reintentar sin duplicar la
factura. Las correcciones de cabecera, la fiscalidad y la conservación documental
siguen sus caminos existentes. No se inventan unidades ni cantidades ausentes.
Los importes originales, abonos y líneas incompletas se conservan; solo cantidades
y netos positivos con unidad conocida pueden aportar precios. El coste reutilizable
es el neto después de descuentos y sin IVA dividido por cantidad, redondeado a los
céntimos que admite el presupuesto. No implica que la factura esté liquidada.

`manual_locked` conserva prioridad absoluta. `received_invoice` va justo después,
incluso con prioridades personalizadas. Usa el emparejador b1 existente: Dice 0,85,
unidad compatible y medidas coincidentes. A igual coincidencia se prefiere la
factura más reciente. La confianza comparte la función de `historical_approved`:
0,88 (<30 días), 0,78 (<60 días), 0,65 después; las fechas futuras o inválidas se
excluyen. No se cambia la normalización ni se intenta expandir abreviaturas.

La carga usa exclusivamente el cliente autenticado y filtro explícito por dueño,
con páginas por UUID para superar el límite de 1.000 filas. No pasa por el cliente
privilegiado del catálogo ni se escribe en la caché de resolución. RLS exige además
que la factura siga perteneciendo al mismo usuario y no esté en la papelera.
Una factura rechazada deja de aportar candidatos. La única escritura de líneas es
la RPC, que fija el dueño desde la factura y verifica cuenta, permiso de escritura
y bloqueo de eliminación. No se conceden INSERT, UPDATE, DELETE ni TRUNCATE sobre
las tablas nuevas a authenticated; anon tampoco tiene lectura.

El identificador histórico `budget_items.price_item_id` ya transporta UUID sin FK:
el tipo `received_invoice` lo discrimina como `received_invoice_lines.id`. El writer
de presupuestos y el motor permanecen intactos. Un adaptador de entrada/salida
presenta la factura al motor como evidencia histórica para que no recalibre ese
coste, y restaura `received_invoice` al salir; la procedencia persistida no cambia.
El PDF cliente, el resumen de fuentes flojas y la recogida de precios propios no
se modifican.

## Medición

Consulta autenticada del propio usuario, sin escrituras:

```sql
select public.get_invoice_price_stats();
select public.get_invoice_price_stats(now() - interval '14 days');
```

`prices`: líneas con un precio utilizable en facturas propias activas. El periodo
filtra la fecha de recogida, no la fecha de la factura. `reused`: pares distintos
(línea de factura, presupuesto) realmente persistidos en ese periodo. No es número
de consultas, de filas duplicadas ni de autosaves; puede superar `prices` porque
un mismo precio sirve en varios presupuestos. No debe interpretarse como porcentaje
de precios distintos emparejados. La tabla privada de eventos permite contar esos
precios distintos si se necesita estudiar esa cohorte. Los eventos no guardan
nombres ni importes y conservan la identidad histórica sin FK hacia línea/presupuesto.

El disparador valida dueño de presupuesto, línea y factura; factura activa; unidad
normalizada; coste neto adoptado y fecha de evidencia. Una edición manual del
importe no cuenta como reutilización. Las consultas al resolutor no escriben eventos.
La restricción única impide duplicados y el evento participa en la transacción de
guardado: un rollback de presupuesto tampoco deja usos fantasma.

## Puertas y deshacer

1. Ejecutar **CHECK_INVOICE_PRICES_PRECHECK** en
   [INVOICE-PRICES-CHECKS.sql](INVOICE-PRICES-CHECKS.sql), como operador sin filtro
   RLS. Debe dar OK. Conservar sus tres conteos de cabeceras, partidas y precios.
2. Aplicar únicamente esta migración y registrarla por el procedimiento habitual.
   No mezclar con otra migración. No habilitar todavía los escritores nuevos.
3. Pegar los tres valores en los placeholders `-1` de
   **CHECK_INVOICE_PRICES_AUDIT**. Debe dar OK: registro exactamente una vez,
   mismas cuentas, esquema/ACL/RLS/funciones/disparador válidos, cero líneas y usos.
   La concurrencia que cambie cuentas exige investigar, no sustituir el precheck.
4. Solo después desplegar la aplicación que usa las nuevas tablas y RPC.
5. Para deshacer: retirar primero esa aplicación y ejecutar
   **ROLLBACK_INVOICE_PRICES** en
   [INVOICE-PRICES-ROLLBACK.sql](INVOICE-PRICES-ROLLBACK.sql) dentro de una transacción
   controlada por el cliente. Orden: disparador, funciones, eventos, líneas.
   No hay CASCADE ni cambios en cabeceras/banco/presupuestos/registro de migraciones.
   Si ya existen líneas o usos se bloquea: borrarlos sería destructivo y requiere
   exportación y decisión del operador. Admite una aplicación parcial sin datos.

## Verificación reproducible

```sh
WIZARD_TEST_POSTGREST_BIN=/ruta/local/postgrest-14.4/bin/postgrest \
  node scripts/test-budget-wizard-provenance-local.mjs --invoice-prices --with-wizard
```

El runner rechaza variables de producción, credenciales externas y destinos
heredados; crea y elimina su clúster. Ejecuta gates, manipulaciones deliberadas,
RLS con dos usuarios y RPCs reales. Después ejecuta el navegador con Next real,
suprime únicamente la llamada que escribe las líneas en una copia temporal,
exige fallo por ausencia de `received_invoice` en `budget_items`, restaura y exige
éxito. Solo la visión OCR y el almacén documental externos tienen respuestas de
prueba en ese recorrido; las pruebas de transporte OCR y conservación documental
existentes cubren esas fronteras por separado. No se llama a Stripe ni se hace build.
