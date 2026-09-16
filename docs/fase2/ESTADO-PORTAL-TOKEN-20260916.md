# Corrección de acceso del portal — revisión 2026-09-16

Rama: `codex/portal-token-access-20260916`, basada en `main` 
`c475ec6629f773f33472179fd1c92aa7061a9f9d`.

## Qué corrige

Las políticas históricas de `portal_tokens` hacían visibles a `anon` todos los
tokens activos y no caducados. En producción se confirmó con una consulta de
metadatos: RLS activa, SELECT de `anon` sobre la columna `token` y dos políticas
SELECT públicas con el mismo predicado. No se leyó ningún token real y el recuento
actual de capacidades `approve_budgets`/`approve_changes` es cero.

La migración `20260915150000_portal_token_read_access.sql` elimina esas políticas
públicas y crea `portal_read_snapshot(text)`, una función SECURITY DEFINER que
valida el enlace presentado, comprueba revocación/caducidad, y devuelve únicamente
los datos del proyecto enlazado. No devuelve el secreto ni permite enumerar enlaces.
Las rutas antiguas siguen aceptándose cuando no existe una fila moderna para ese
UUID; una fila moderna revocada no cae a la ruta heredada.

La misma migración elimina la política histórica de actualización pública de
`project_changes` y añade `portal_respond_to_change(text,uuid,boolean)`. Solo acepta
cambios propuestos del proyecto del enlace y exige `approve_changes` en tokens
modernos. El portal ya usa esta función y no envía campos de estado arbitrarios.
También elimina la política pública de actualización de `budgets`: el portal
intenta `portal_respond_to_budget(...)` (la función transaccional de E2) y solo
mantiene un fallback mientras esa función aún no está publicada. Por tanto, tras
aplicar esta corrección los botones de presupuesto quedan bloqueados hasta que E2
esté desplegada, en lugar de conservar una escritura pública insegura.

## Verificación

- `tsc --noEmit --incremental false`: PASS.
- Prueba con PostgreSQL 17.6 desechable: 6 PASS en la ejecución previa del banco
  de lectura/enlace y respuesta de cambios. El último ajuste añade además la
  comprobación de que la actualización directa de presupuestos queda denegada;
  ese banco no se pudo repetir desde este turno porque el límite de uso bloqueó
  el acceso al proceso local.

## Despliegue

No se ha hecho commit, push, merge ni despliegue. La migración no se ha ejecutado
en producción. Antes de fusionar hay que repetir la prueba en CI y revisar que el
portal actual conserva su lectura con un token válido y que el flujo que emite
tokens asigna explícitamente `approve_changes`/`approve_budgets` solo cuando debe.
