# Unificación de facturas recibidas

Base: `origin/main` `b9ed8dd24fe7f42a6bcff535c5057edd80bd6b83`.
Rama: `codex/unify-received-invoices`.
Worktree: `/private/tmp/enlaze-unify-received-invoices`.
Repositorio Git independiente: `/private/tmp/enlaze-unify-git.git`.

Recibidas reúne cliente, obra, categoría, periodos por fecha de emisión, resumen fiscal y exportación CSV. Obra, Contabilidad, informe fiscal, albaranes y snapshot del portal usan `received_invoices`. El OCR solo extrae borradores para revisión. La ruta antigua redirige al hub. Las tablas antiguas permanecen, sin INSERT/UPDATE del navegador; el borrado de cuenta no se ha modificado.

## Verificación por lote

Se ejecutaron `tsc --noEmit`, `npm run lint`, las pruebas relacionadas y `npm run build` tras cada lote.

| Lote | Typecheck | Lint global | Tests relacionados | `npm run build` |
| --- | --- | --- | --- | --- |
| 1 | OK | 218 errores / 157 avisos previos | 18/18 | Bloqueado en `plans:check`: faltan credenciales |
| 2 | OK | 218 / 157 | 21/21; consultas y paginación | Mismo bloqueo |
| 3 | OK | 218 / 156; archivos del lote sin errores ni avisos | 25/25; periodos, CSV, resumen y formulario | Mismo bloqueo |
| 4 | OK | 218 / 156 | 27/27; pagos parciales y alcance por obra | Mismo bloqueo |
| 5 | OK | 218 / 156 | 30/30; siete recibidas sintéticas en el endpoint fiscal | Mismo bloqueo |
| 6 y final | OK | 217 / 152 | 42/42, incluyendo SQL ejecutado localmente | Mismo bloqueo |

La compilación adicional `next build --webpack` **sí terminó correctamente**, incluida la generación de páginas y TypeScript. Se ejecutó con valores ficticios para Supabase, Resend y Stripe y permiso de red para descargar Inter. No ejecutó `plans:check`, no valida esos servicios y no equivale a un `npm run build` limpio con la configuración de despliegue. Las versiones de las dependencias directas reutilizadas coinciden con `package-lock.json`; no se cambió el lockfile.

Las pruebas específicas de almacenamiento y borrado de cuenta pasan: **9/9**. La suite amplia `p1-review` más asistente y bloqueo de cuenta da **48 correctas, 18 fallos heredados y 1 omitida**. Los 18 nombres de fallo son los mismos que antes del lote 6: rutas antiguas de migraciones (ahora en `migrations_historico`) y pruebas que aún buscan lógica en la pantalla de proveedores sustituida por un redirect. La integración remota del bloqueo de cuenta no se ejecutó por falta de su entorno. No se reparó esa deuda ajena al encargo.

Registros completos: `/private/tmp/enlaze-unify-checks`.

## Qué demuestra la prueba SQL local

La migración se aplicó y reejecutó en PostgreSQL 17 desechable, con socket exclusivo, nombre de base y marcador de clúster verificados antes de preparar el esquema. No se conecta a Supabase ni usa datos de producción. El esquema de prueba reproduce los contratos relevantes, no todo el esquema de producción.

Sus nueve comprobaciones pasan:

- Control previo: el portal antiguo solo ve la factura heredada atribuible al cliente.
- Paso de 7 a 9 recibidas sin duplicar IDs; Ikea conserva una fecha derivada de `created_at` y número marcador; se conservan documento, cliente e importes.
- FK de albaranes dirigida a `received_invoices`, conservando enlaces existentes y aceptando facturas del hub.
- FK de cliente y obra con `ON DELETE SET NULL`.
- INSERT/UPDATE heredados denegados para los roles del navegador; SELECT y borrado administrativo conservados; tablas y ocho líneas antiguas intactas.
- Snapshot con ACL, SECURITY DEFINER, claves JSON y regla de visibilidad intactas: obra directa, cliente inequívoco, cliente ambiguo, otro propietario, papelera y token revocado.
- Reejecución sin duplicados ni sobrescritura de correcciones posteriores.
- Guarda que rechaza una redefinición ajena del snapshot.

El contador de Node incluye el caso contenedor además de sus ocho subpruebas.

Para repetirlo en el clúster local descrito por el test:

```sh
RUN_RECEIVED_INVOICES_SQL_TEST=1 RECEIVED_INVOICES_TEST_ACK=DISPOSABLE_CLUSTER \
  node --test __tests__/received-invoices-migration.integration.test.mjs
```

Por defecto, esa prueba se omite. Su conexión está fijada al socket `/private/tmp/enlaze-unify-pg-socket`, puerto 55447, base `enlaze_received_invoices_test`, directorio `/private/tmp/enlaze-unify-pg` y marcador `unify_received_invoices_20261007`. Rechaza variables `PG*`, otros destinos y clústeres con otras bases de usuario. El clúster se detuvo al terminar.

## Límites y diferencias respecto al encargo

- El `.git` original era de solo lectura. El worktree se creó desde una copia Git independiente de la referencia exacta solicitada; no se modificó la copia de trabajo del usuario.
- El portal de `b9ed8dd` ya usaba exclusivamente `portal_read_snapshot`. Se conserva esa lectura y se amplían las etiquetas. La clave JSON `payment_status` proyecta `received_invoices.status`.
- Además del SQL propuesto, se revocan INSERT/UPDATE de ambas tablas heredadas a los roles del navegador. Se conservan las RPC SECURITY DEFINER, las lecturas y la administración.
- El CSV respeta todos los filtros y carga todas las páginas. El enlace al PDF usa el mismo periodo y muestra todas las recibidas de ese periodo, como el informe existente; el hub lo explica.
- `app/contabilidad-print/page.tsx` ya representa las filas del endpoint fiscal; su contrato no cambia y no necesita modificaciones.
- Se retira la persistencia de líneas OCR en `invoice_items`; ninguna pantalla las mostraba. No se borra su contenido.
- No se aplicó la migración a una **rama de Supabase** ni a producción. No había conector/CLI disponible y el acceso por navegador a Supabase fue denegado. La validación local es adicional, no sustituye esa comprobación.
- No se verificó la aparición de las **siete facturas reales** en la pantalla y PDF de un entorno conectado. Sí se ejecutó el endpoint fiscal con siete facturas sintéticas, paginadas, comprobando fechas, estados y totales. No se realizó una prueba visual completa del hub en navegador.

## Despliegue pendiente

1. En una rama de Supabase con datos de prueba adecuados, aplicar `20261007120000_unify_received_invoices.sql` y comprobar 7 → 9 filas, Ikea, reejecución, FK y snapshot de un token activo. La guarda debe abortar si la RPC no coincide con la versión revisada.
2. Ejecutar `npm run build` con la configuración autorizada de ese entorno, resolver la deuda de lint según la política del repo y comprobar las siete facturas reales en Contabilidad y el PDF.
3. Después de validar y autorizar el despliegue, aplicar primero la migración y a continuación el código. No se ha desplegado nada en producción.
