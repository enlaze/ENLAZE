# Unificación de facturas recibidas

Base: `origin/main` `b9ed8dd24fe7f42a6bcff535c5057edd80bd6b83`.

## Verificación por lote

| Lote | Typecheck | Lint global | Tests | Build |
| --- | --- | --- | --- | --- |
| 1 | OK (`tsc --noEmit`) | 218 errores / 157 avisos ya en la base (solo se ha añadido SQL y tests) | 18/18 | Bloqueado en prebuild: faltan credenciales para `plans:check` |

| 2 | OK | Sin cambios: 218 errores / 157 avisos | 21/21, incluye paginación y fallo intermedio | Mismo bloqueo en prebuild |

| 3 | OK | 218 errores / 156 avisos; archivos modificados sin errores ni avisos | 25/25: periodos, CSV, resumen completo y formulario por cliente | Mismo bloqueo en prebuild; compilación directa adicional bloqueada por descarga de Inter (red) |

Los registros de esta ejecución están en `/private/tmp/enlaze-unify-checks`.

## Límites y diferencias respecto al encargo

- El `.git` original es de solo lectura para este entorno. El worktree se creó desde una copia Git independiente de la referencia exacta solicitada; no se modificó la copia de trabajo del usuario.
- El portal en esta base ya usa exclusivamente `portal_read_snapshot`. Se conserva ese consumidor y el contrato JSON. El campo JSON `payment_status` recibe `received_invoices.status`, conservando el vocabulario de tramitación y ampliando sus etiquetas.
- Se revocan INSERT y UPDATE de `invoices` e `invoice_items` a los roles del navegador. Se conservan tablas, lecturas y borrado administrativo, además de las RPC SECURITY DEFINER existentes.
- El CSV aplica todos los filtros; el enlace al PDF fiscal usa el mismo periodo y muestra todas las recibidas de ese periodo, como el informe existente. Se indica expresamente en el hub.
- No se ha aplicado la migración a producción ni a una rama Supabase: no hay conector/CLI de Supabase disponible. El intento de preparar PostgreSQL local tampoco pudo arrancar: el sandbox deniega la memoria compartida de `initdb`. Las pruebas de contrato SQL NO equivalen a aplicar la migración.

## Despliegue pendiente

1. Aplicar `20261007120000_unify_received_invoices.sql` en una rama Supabase con los datos de prueba adecuados. Comprobar 7 → 9 filas, idempotencia, fila Ikea, FK de albaranes y snapshot de un token activo. La guarda debe abortar ante un cuerpo de RPC diferente al revisado.
2. Resolver los prerrequisitos de lint/build y verificar la aplicación y el PDF con esas facturas en el entorno de prueba.
3. Tras esa validación, desplegar la migración antes del código de aplicación. No ejecutar este paso en producción sin autorización.
