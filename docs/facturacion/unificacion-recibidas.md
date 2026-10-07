# Unificación de facturas recibidas

Base: `origin/main` `b9ed8dd24fe7f42a6bcff535c5057edd80bd6b83`.

## Verificación por lote

| Lote | Typecheck | Lint global | Tests | Build |
| --- | --- | --- | --- | --- |
| 1 | OK (`tsc --noEmit`) | 218 errores / 157 avisos ya en la base (solo se ha añadido SQL y tests) | 18/18 | Bloqueado en prebuild: faltan credenciales para `plans:check` |

| 2 | OK | Sin cambios: 218 errores / 157 avisos | 21/21, incluye paginación y fallo intermedio | Mismo bloqueo en prebuild |

Los registros de esta ejecución están en `/private/tmp/enlaze-unify-checks`.

## Límites y diferencias respecto al encargo

- El `.git` original es de solo lectura para este entorno. El worktree se creó desde una copia Git independiente de la referencia exacta solicitada; no se modificó la copia de trabajo del usuario.
- El portal en esta base ya usa exclusivamente `portal_read_snapshot`. Se conserva ese consumidor y el contrato JSON. El campo JSON `payment_status` recibe `received_invoices.status`, conservando el vocabulario de tramitación y ampliando sus etiquetas.
- Se revocan INSERT y UPDATE de `invoices` e `invoice_items` a los roles del navegador. Se conservan tablas, lecturas y borrado administrativo, además de las RPC SECURITY DEFINER existentes.
- No se ha aplicado la migración a producción ni a una rama Supabase: no hay conector/CLI de Supabase disponible. El intento de preparar PostgreSQL local tampoco pudo arrancar: el sandbox deniega la memoria compartida de `initdb`. Las pruebas de contrato SQL NO equivalen a aplicar la migración.

## Despliegue pendiente

1. Aplicar `20261007120000_unify_received_invoices.sql` en una rama Supabase con los datos de prueba adecuados. Comprobar 7 → 9 filas, idempotencia, fila Ikea, FK de albaranes y snapshot de un token activo. La guarda debe abortar ante un cuerpo de RPC diferente al revisado.
2. Resolver los prerrequisitos de lint/build y verificar la aplicación y el PDF con esas facturas en el entorno de prueba.
3. Tras esa validación, desplegar la migración antes del código de aplicación. No ejecutar este paso en producción sin autorización.
