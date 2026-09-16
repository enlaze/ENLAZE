# Corrección de acceso del portal — revisión 2026-09-16

Rama: `codex/portal-token-access-20260916`, basada en `main`
`c475ec6629f773f33472179fd1c92aa7061a9f9d` (ya incluye los PR #11 y #12).

## Estado real de producción antes de esta rama

Comprobado por consulta de metadatos sobre el proyecto `dsgnymebkxxkslyeotee`,
sin leer ningún token:

- Como `anon` no hay **ninguna** fila visible en `projects`, `clients`, `budgets`,
  `project_changes` ni `project_milestones`: la migración ya aplicada
  `20260908082105_fix_open_rls_select_policies` retiró las lecturas públicas. El
  portal de cliente está hoy **caído** para los 7 enlaces vivos, no solo expuesto.
- `portal_tokens` tiene 0 filas y ningún punto de la aplicación las inserta, así
  que todos los enlaces vivos usan la ruta heredada `projects.access_token`.
- `"Public update budget status"` sobre `budgets` ya no existe; su `drop` aquí es
  un no-op. `"Public update change approval"` sobre `project_changes` **sí**
  existe con `USING(true)`: es el único agujero de escritura real que queda, y es
  lo que esta migración cierra.
- `anon` conserva los privilegios de tabla (`select`, `update`) sobre `budgets` y
  `project_changes`: quien decide es RLS, no el `grant`. De ahí que una escritura
  sin política afecte a 0 filas **sin devolver error**.

Por tanto esta migración hace dos cosas: **restaura** el portal (vía SECURITY
DEFINER, que no depende de las políticas ausentes) y cierra el `USING(true)`.

## Qué corrige

`20260915150000_portal_token_read_access.sql` elimina las políticas públicas de
`portal_tokens` y crea `portal_read_snapshot(text)`, SECURITY DEFINER, que valida
el enlace presentado, comprueba revocación y caducidad y devuelve solo los datos
del proyecto enlazado. No devuelve el secreto ni permite enumerar enlaces. Las
rutas antiguas se siguen aceptando cuando no existe fila moderna para ese UUID;
una fila moderna revocada no cae a la ruta heredada.

La misma migración elimina la política histórica de actualización pública de
`project_changes` y añade `portal_respond_to_change(text,uuid,boolean)`, que solo
acepta cambios propuestos del proyecto del enlace y exige `approve_changes` en
tokens modernos.

### Capacidades declaradas

`portal_read_snapshot` devuelve un bloque `capabilities` con `respond_budgets` y
`respond_changes`. El portal solo dibuja un botón cuando la base de datos declara
esa capacidad, de modo que nunca ofrece una acción que luego sería rechazada:

- `respond_changes`: cierto para un enlace heredado (es anterior al modelo de
  permisos) y, en un token moderno, solo con `approve_changes`.
- `respond_budgets`: exige token moderno con `approve_budgets` **y** que exista
  `portal_respond_to_budget`, que se sonda con `to_regprocedure`. Un enlace
  heredado nunca puede responder presupuestos porque esa función de E2 requiere
  fila en `portal_tokens`.

Para presupuestos, la capacidad de enlace no basta: el lector también lista
presupuestos atados solo por cliente, que `portal_respond_to_budget` rechaza
porque compara `budgets.project_id` con el proyecto del token. En producción eso
son 5 de los 7 presupuestos visibles. Por eso cada presupuesto lleva su propio
`can_respond`, que repite las cinco condiciones del escritor —capacidad, proyecto,
estado `enviado`/`sent` y versión documental finalizada— y el portal solo dibuja
el botón con esa señal. Para cambios no hace falta: el snapshot lista exactamente
los que `portal_respond_to_change` acepta.

### Sin fallback silencioso

El portal ya no escribe nunca directamente sobre `budgets` ni sobre
`project_changes`. Las políticas que lo permitían no existen, así que ese UPDATE
afectaría a 0 filas y **no devolvería error**: se le confirmaría al cliente una
respuesta que no se guardó. Ahora ambas acciones exigen que el RPC devuelva
resultado; si la función aún no existe (`PGRST202`) la acción queda bloqueada con
un mensaje explícito. `portal_respond_to_budget` pertenece a
`20260915160000_budget_revision_rpcs.sql` (E2) y **no** se duplica aquí: E2 la
crea con `create function` sin `or replace`, así que duplicarla rompería E2.

### Vocabulario de estados

El vocabulario canónico de presupuesto es español —`borrador` → `pendiente` →
`enviado` → `aceptado`/`rechazado`— y así lo escribe E2. El portal usaba el inglés
(`sent`, `pending`, `accepted`), que no corresponde a ningún dato real: los
botones no aparecían nunca y el KPI «total aprobado» daba 0 € habiendo
presupuestos aceptados. Ahora se usa el español y se mantienen los deletreos
ingleses como alias de solo lectura, porque el `DEFAULT` de la columna sigue
siendo `'pending'`. `project_changes` sí es inglés por su `CHECK`
(`proposed|approved|rejected|executed`) y no se toca.

### Trazabilidad

`portal_read_snapshot` reanuda, dentro del SECURITY DEFINER y sin reabrir RLS, la
contabilidad que antes hacía el lector con políticas abiertas:
`portal_tokens.last_accessed_at` y `access_count`, y `budgets.viewed_at`. Este
último solo se sella en presupuestos ya enviados, que es lo que significa
«Visualizado» en el timeline de aceptación; un borrador nunca se sella.

## Verificación

- `tsc --noEmit --incremental false`: PASS.
- `eslint` sobre la página: 1 error + 1 aviso, **idénticos a los previos** al
  cambio (`loadPortal` usado antes de declararse). El repo arrastra 219 errores de
  lint previos, así que no es una puerta limpia; la de CI es `tsc`.
- Banco PostgreSQL 17.11 desechable (cluster local por socket, marcador
  `budget_revision_rpcs_2f2`, sin TCP): **9 PASS**, incluidas las pruebas nuevas
  de capacidades, contabilidad de accesos y `can_respond`.

La prueba de `can_respond` encontró un fallo real antes de subirlo: con
`project_id` nulo, `b.project_id = v_project.id` devolvía `null` y no `false`, así
que el campo salía como `null` en el JSON. Corregido con `is not distinct from`.

Dos defectos del propio banco salieron a la luz y se corrigieron:

1. El esquema desechable no concedía a `anon` el `update` sobre `budgets`, así que
   la aserción de escritura directa fallaba con «permission denied» en lugar de
   demostrar que la bloquea RLS. Producción sí concede ese privilegio.
2. `asRole` hacía `reset role` en un `finally` sin proteger: al abortarse la
   transacción, ese error sustituía al que explicaba la causa real.

## Despliegue

No se ha hecho merge ni se ha aplicado ninguna migración en producción.

Pendiente antes de fusionar:

- Aplicar esta migración y la de E2 en la misma ventana, o asumir que la respuesta
  a presupuestos queda bloqueada (con aviso explícito) hasta que E2 esté.
- **E1 (`lock_version`) ya está aplicada en producción**: `20260914090000` consta
  registrada y la columna existe. El preflight que la daba por pendiente está
  desactualizado.
- No existe todavía ningún flujo que cree `portal_tokens` ni que conceda
  `approve_changes`/`approve_budgets`; mientras siga así, todos los enlaces son
  heredados y no pueden responder presupuestos.
- Queda abierta una decisión de producto: el snapshot devuelve también los
  presupuestos en `borrador`, por lo que el cliente los ve. Es comportamiento
  previo, no una regresión de esta rama, y no se ha cambiado aquí.

Las dos decisiones que bloquean el despliegue —visibilidad de borradores y
respuesta a presupuestos desde enlaces heredados— están documentadas con datos de
producción y opciones en `DECISIONES-PORTAL-20260916.md`. El preflight de E2,
corregido tras confirmar que E1 ya está aplicada, está en
`PREFLIGHT-E2-20260916.md`.
