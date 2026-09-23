# 2F-2 / E4 lote 1 — ciclo de vida seguro de `portal_tokens`

Fecha: 2026-09-23. Estado: **rama lista para revisión; migración NO aplicada**.
Rama: `codex/portal-token-lifecycle-e4`, creada desde `origin/main`
`d59ca7179ac96ef2e67c196b0a37fa5688e78339`, sin rebase ni reescritura.
Migración nueva: `20260923120000_portal_token_lifecycle.sql`, posterior a
`20260915160000`. **Aditiva: no reescribe ninguna migración ya aplicada.**

Solo backend. No se toca `app/dashboard/projects/[id]/page.tsx`, ni el portal
público, ni `projects.access_token`, ni `lib/budget-items-writer.ts`.

## Por qué hacía falta

`20260915140000` dejó `portal_tokens` sin INSERT/UPDATE/DELETE para `anon` ni
`authenticated`, y con un trigger que exige que `created_by` sea el dueño del
proyecto. Eso cerró la falsificación entre inquilinos, pero también dejó la tabla
**sin ninguna vía legítima de escritura**: la aplicación no podía emitir un enlace
moderno. Este lote aporta esa vía, y solo esa.

## Estado de producción, comprobado por lectura el 2026-09-23

| Comprobación | Valor |
|---|---|
| Filas en `portal_tokens` | **0** |
| Filas sin `created_by` | 0 |
| Filas incompatibles con el nuevo CHECK | **0** |
| Enlaces heredados vivos (`projects.access_token`) | **8** |
| Última migración registrada | `20260915160000` |

Al no haber ninguna fila moderna, el CHECK entra sin riesgo de fallar al aplicarse.
Si en el momento del despliegue hubiera filas incompatibles, la migración **falla**
y hay que revisarlas a mano: no las corrige en silencio. Los 8 enlaces heredados no
se migran, no se revocan y no reciben ningún permiso.

## Contrato de las tres RPC

Todas son `SECURITY DEFINER` con `search_path = ''`, y solo `authenticated` puede
ejecutarlas. El llamante **nunca** elige `token`, `created_by`, `is_active`,
`access_count`, `last_accessed_at` ni `revoked_at`: los fija el servidor.
`created_by` sale siempre de `auth.uid()`.

### `portal_issue_token(p_project_id, p_permissions, p_expires_at, p_label)`

Emite un enlace para un proyecto propio y no borrado. `p_permissions` por defecto
`["read"]`; `p_expires_at` y `p_label` son opcionales. Devuelve `id`, `project_id`,
`token`, `permissions`, `label`, `expires_at`, `created_at`, `is_active` y
`revoked_at`: lo justo para copiar el enlace y pintar su estado.

El secreto es `gen_random_uuid()`, generado en el servidor con su CSPRNG; ningún
valor propuesto por el cliente llega a la columna.

### `portal_rotate_token(p_token_id, p_expires_at)`

Emite el sustituto y revoca el anterior **en la misma transacción**: o hay enlace
nuevo y el viejo queda revocado, o no cambia nada. Devuelve
`{ "issued": …, "revoked": … }`; el bloque `revoked` no repite ningún secreto.

Hereda `project_id`, `permissions` y `label` del enlace rotado. La caducidad se
hereda salvo que se pase otra, y se rechaza si la heredada ya venció: rotar no debe
producir un enlace nacido muerto.

Contra la carrera: la fila antigua se bloquea con `FOR UPDATE` **antes** de
comprobar su estado. La segunda rotación simultánea espera al bloqueo, ve la fila ya
revocada y responde `PT409 Portal link is no longer active`. Nunca quedan dos
sustitutos vigentes del mismo enlace.

### `portal_revoke_token(p_token_id)`

**Idempotente.** Revocar un enlace ya revocado no es error: devuelve su estado sin
tocar `revoked_at`, de modo que un doble clic o un reintento no mueven la fecha de
revocación original. Nunca devuelve el secreto.

### Errores

| Situación | Código | Mensaje |
|---|---|---|
| Proyecto o enlace ajeno, inexistente o borrado | `42501` | `Portal link is not available` |
| Rotar un enlace ya revocado o inactivo | `PT409` | `Portal link is no longer active` |
| `permissions` no es un array, trae no-textos, valores desconocidos, repetidos, o le falta `read` | `22023` | mensaje específico por caso |
| `expires_at` no está en el futuro | `22023` | `expires_at must be in the future` |

Un proyecto ajeno y uno inexistente responden **exactamente lo mismo**: nada en la
respuesta permite deducir que el recurso existe.

## Vocabulario de permisos

Canónico y cerrado: `read`, `approve_changes`, `approve_budgets` — los mismos que
consume `20260915150000`. `read` siempre presente. Se rechaza el array vacío, el
objeto, la cadena, `null`, los elementos numéricos o anidados, los duplicados y
cualquier valor fuera de la lista (incluidos los singulares antiguos
`approve_change` / `approve_budget`).

La validación vive además en un CHECK de tabla, `portal_tokens_permissions_check`,
apoyado en `public.portal_token_permissions_valid(jsonb)`: un CHECK no admite
subconsultas, así que la lógica está en una función inmutable y pura. Esa función
no lee ninguna tabla y se deja ejecutable, para que cualquier escritor legítimo
(incluido `service_role` desde el servidor) pueda insertar.

**No se concede `approve_budgets` automáticamente.** Quién lo pide y con qué
interfaz es el lote 2.

## Privilegios

- `authenticated`: `EXECUTE` en las tres RPC públicas. Nada más.
- `anon`, `public`, `service_role`: **sin** `EXECUTE` en ninguna de las tres.
- Esquema privado `portal_token_internal`: revocado para todos; sus seis auxiliares
  son `SECURITY INVOKER` y solo se alcanzan desde dentro de las RPC.
- `INSERT` / `UPDATE` / `DELETE` directos sobre `portal_tokens` siguen **revocados**
  para `anon` y `authenticated`. Este lote no los repone.

## Pruebas

Banco desechable PostgreSQL 17 con marcador `budget_revision_rpcs_2f2`, protegido
contra producción: el test aborta si la base no es la desechable, si hay otras bases
en el clúster, si aparece cualquier variable `PG*` en el entorno, o si falta el
reconocimiento `PORTAL_TEST_ACK=DISPOSABLE_CLUSTER`.

`__tests__/portal-token-lifecycle.integration.test.mjs` — identidad del banco
comprobada de entrada (base, marcador, versión 17, aislamiento) y 11 subpruebas,
todas en verde:

1. emisión correcta por el propietario, con el servidor fijando lo que no se elige
2. proyecto ajeno, inexistente y borrado responden lo mismo
3. cada forma inválida de `permissions`, una por una
4. caducidad pasada y caducidad igual a `now()`
5. atomicidad de la rotación: sustituto emitido y anterior revocado a la vez
6. carrera de rotaciones: la segunda sesión **se bloquea de verdad** (se comprueba
   que sigue sin resolverse tras 400 ms) y al liberarse recibe `PT409`
7. revocación idempotente, sin repetir el secreto ni mover `revoked_at`
8. no se puede tocar ni descubrir el enlace de otro
9. DML directo por `authenticated` sigue denegado; `anon` no ejecuta ninguna RPC
10. enlaces heredados intactos y `portal_read_snapshot` / `portal_respond_to_change`
    siguen funcionando igual
11. controles negativos y mutantes: se comprueba que cada aserción agarra

No se envuelve todo en una transacción porque la prueba de carrera necesita dos
sesiones compitiendo de verdad por el bloqueo de fila.

`__tests__/portal-token-access.integration.test.mjs` se reejecutó entero (14/14) tras
ampliar el fixture, y las dos suites pasan encadenadas en el mismo orden que usa CI:
26 pruebas, 0 fallos, 0 omitidas.

`__tests__/support/portal-token-access-schema.sql` añade `label` y `created_at` a la
tabla desechable: ya existen en producción y las RPC las escriben. Sin ellas el banco
habría pasado por el motivo equivocado.

CI: `.github/workflows/portal-token-lifecycle-integration.yml`, sin ningún secreto
del repositorio, levanta `postgres:17` en un contenedor efímero.

## Despliegue futuro

1. Ejecutar el bloque `CHECK_E4_L1_VALUES` de `docs/fase2/CHECKS.sql` **antes** de
   aplicar: `incompatibles` debe ser 0. Si no lo es, parar y revisar a mano.
2. Aplicar `20260923120000_portal_token_lifecycle.sql`.
3. Ejecutar `CHECK_E4_L1_SCHEMA` y `CHECK_E4_L1_GRANTS`: las tres RPC con
   `anon_execute = false` y `authenticated_execute = true`, los auxiliares con ambos
   en `false`, y las seis filas de DML directo en `false`.
4. No hace falta desplegar aplicación: ninguna pantalla llama todavía a estas RPC.

Compensación: `ROLLBACK_2F2_E4_L1` en `docs/fase2/ROLLBACK.sql`, **sin ejecutar**.
Exige el reconocimiento explícito
`enlaze.allow_portal_lifecycle_rollback = 'before_issuing_links'` y se niega si
existe algún enlace moderno vigente. No borra filas ni toca enlaces heredados: retira
las RPC, el esquema privado, el CHECK y el validador.

## Riesgos y decisiones abiertas

- **Caducidad opcional.** `expires_at` admite `NULL`, es decir, enlaces sin
  vencimiento. Caducidad por defecto y máximo permitido son decisión de producto, no
  técnica; si se quiere imponer un tope, es un cambio pequeño en
  `validate_expiry` más un CHECK, pero cambia el contrato y debe decidirse antes de
  que la interfaz emita enlaces.
- **Sin límite de enlaces vivos por proyecto.** Nada impide emitir muchos. Con la
  interfaz del lote 2 conviene decidir si se acota o basta con listarlos y revocarlos.
- **El secreto viaja en la respuesta de emisión y de rotación**, que es lo mínimo
  para poder copiar el enlace. No se registra en logs ni se devuelve en ninguna otra
  ruta, pero cualquier pantalla que lo consuma no debe persistirlo.
- **Convivencia con enlaces heredados.** Siguen vivos y fuera de este ciclo de vida.
  Su retirada es un lote posterior y exige decidir qué pasa con los 8 en uso.
- **Idempotencia de la revocación** es una decisión, no un descuido: se eligió por
  encima de devolver `PT409` para que un reintento de red no parezca un fallo.
