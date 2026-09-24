# 2F-2 / E4 lote 1 — ciclo de vida seguro de `portal_tokens`

Fecha: 2026-09-24 (revisión 2). Estado: **rama lista para revisión; migración NO aplicada**.
Rama: `codex/portal-token-lifecycle-e4`, creada desde `origin/main`
`d59ca7179ac96ef2e67c196b0a37fa5688e78339`, sin rebase ni reescritura.
Migración nueva: `20260923120000_portal_token_lifecycle.sql`, posterior a
`20260915160000`. **Aditiva: no reescribe ninguna migración ya aplicada.**
La revisión 2 modifica esa misma migración, todavía sin desplegar, en vez de
añadir una correctiva encima: corregir con una segunda migración algo que nunca
llegó a aplicarse solo deja ruido en el historial.

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

La revisión 2 **no pudo repetir esa lectura**: el clasificador de permisos bloqueó
el acceso a producción (`[Production Reads]`). Por eso la migración no da por hecho
el estado de `created_at` ni de `expires_at`: comprueba explícitamente que no haya
filas sin fecha o fuera de ventana y **se detiene con un mensaje legible** si las
hubiera, en lugar de rellenarlas. Conviene reconfirmar los seis valores del bloque
`CHECK_E4_L1_VALUES` justo antes de aplicar.

Al no haber ninguna fila moderna, el CHECK entra sin riesgo de fallar al aplicarse.
Si en el momento del despliegue hubiera filas incompatibles, la migración **falla**
y hay que revisarlas a mano: no las corrige en silencio. Los 8 enlaces heredados no
se migran, no se revocan y no reciben ningún permiso.

## Contrato de las tres RPC

Todas son `SECURITY DEFINER` con `search_path = ''`, y solo `authenticated` puede
ejecutarlas. El llamante **nunca** elige `token`, `created_by`, `is_active`,
`access_count`, `last_accessed_at` ni `revoked_at`: los fija el servidor.
`created_by` sale siempre de `auth.uid()`.

### Caducidad obligatoria: 90 días por defecto, 365 como máximo

**Ningún enlace moderno es perpetuo.** Omitir `expires_at` o pasar `NULL` no
significa «sin caducidad»: significa **90 días**. Una fecha explícita se respeta
si está en el futuro y no pasa de **365 días** desde ahora; si no, `22023`.

Los dos plazos viven en una sola pareja de funciones inmutables,
`public.portal_token_default_lifetime()` y `public.portal_token_max_lifetime()`,
que consumen a la vez el `DEFAULT` de la columna, el `CHECK` de la tabla y las RPC.
Si divergieran, la emisión produciría filas que el propio `CHECK` rechaza.

La tabla lo sostiene por su cuenta, no solo las RPC:

| Invariante | |
|---|---|
| `expires_at` | `NOT NULL`, `DEFAULT now() + portal_token_default_lifetime()` |
| `created_at` | `NOT NULL`, `DEFAULT now()` |
| `portal_tokens_expiry_window_check` | `expires_at > created_at AND expires_at <= created_at + portal_token_max_lifetime()` |

El `CHECK` se apoya en `created_at`, **no en `now()`**: así es inmutable, y una fila
válida al insertarse no se vuelve inválida con el paso del tiempo — que es
justamente lo que tiene que pasar para que un enlace pueda caducar. Que la fecha
esté además en el futuro lo comprueban las RPC, que sí conocen `now()`.

### Tope de 5 enlaces vigentes por proyecto

**Vigente** = `is_active` ∧ `revoked_at IS NULL` ∧ `expires_at > now()`. El sexto se
rechaza con `PT409` y un mensaje estable.

Revocar libera plaza de inmediato, y **caducar también**, sin ningún proceso de
limpieza: la plaza se libera sola porque el recuento mira `expires_at`, no un
estado almacenado.

El tope es **seguro ante emisiones simultáneas**. Un `COUNT` sin bloqueo no basta:
dos sesiones verían ambas cuatro enlaces y dejarían seis. Lo que lo impide es que
`owned_project` toma `FOR UPDATE` sobre la fila del proyecto — no `FOR SHARE` — antes
de contar nada, de modo que toda emisión o rotación sobre un mismo proyecto queda
serializada hasta que la anterior confirma. El recuento se hace después de insertar
y rechaza si pasa de cinco.

El tope es **por proyecto, no por usuario**: otro proyecto del mismo dueño sigue con
sus cinco plazas.

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

Hereda `project_id`, `permissions` y `label` del enlace rotado. **La caducidad no se
hereda**: sin fecha explícita, el sustituto nace con 90 días nuevos contados desde la
rotación, que es justo lo que se quiere renovar. Con fecha explícita rige el mismo
suelo y el mismo techo de 365 días que en la emisión.

Rotar **no consume una plaza de más**: revoca uno y emite uno, saldo neto cero. Rotar
un enlace ya caducado sí ocuparía una plaza nueva, así que si el proyecto está al tope
la rotación se rechaza con `PT409` y la revocación se deshace con ella — es todo o
nada.

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
| Sexto enlace vigente en un proyecto | `PT409` | `Project already has the maximum of 5 live portal links` |
| `expires_at` a más de 365 días | `22023` | `expires_at must be at most 365 days from now` |
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
- Esquema privado `portal_token_internal`: revocado para todos; sus **siete**
  auxiliares son `SECURITY INVOKER` y solo se alcanzan desde dentro de las RPC:
  `owned_project`, `validate_permissions`, `resolve_expiry`,
  `assert_live_link_cap`, `issued`, `status` y `lock_own_token`.
  (Corregido el 2026-09-24: antes decía «seis», que era un recuento equivocado.)
- `INSERT` / `UPDATE` / `DELETE` directos sobre `portal_tokens` siguen **revocados**
  para `anon` y `authenticated`. Este lote no los repone.

## Pruebas

Banco desechable PostgreSQL 17 con marcador `budget_revision_rpcs_2f2`, protegido
contra producción: el test aborta si la base no es la desechable, si hay otras bases
en el clúster, si aparece cualquier variable `PG*` en el entorno, o si falta el
reconocimiento `PORTAL_TEST_ACK=DISPOSABLE_CLUSTER`.

`__tests__/portal-token-lifecycle.integration.test.mjs` — identidad del banco
comprobada de entrada (base, marcador, versión 17, aislamiento) y 17 subpruebas,
todas en verde:

1. emisión correcta por el propietario, con el servidor fijando lo que no se elige
2. proyecto ajeno, inexistente y borrado responden lo mismo
3. cada forma inválida de `permissions`, una por una
4. omitir la caducidad da 90 días — por defecto, con `NULL` y con `NULL::timestamptz`
5. suelo y techo: fecha pasada, exactamente ahora, un segundo tarde, 366 días y
   10 años se rechazan; 1 día y 365 días se aceptan
6. quinto enlace permitido, sexto rechazado; el tope no se comparte entre proyectos;
   plaza recuperada tras revocar y tras caducar
7. con una plaza libre, dos emisiones simultáneas: la segunda **se bloquea de verdad**
   (sigue sin resolverse tras 400 ms) y al liberarse recibe `PT409`
8. atomicidad de la rotación: sustituto emitido y anterior revocado a la vez
9. rotar renueva el plazo entero y no hereda el restante; la fecha explícita se
   respeta y tiene el mismo techo
10. rotar al tope no consume plaza; rotar un caducado estando al tope se rechaza y
    deshace su propia revocación
11. carrera de rotaciones: la segunda sesión se bloquea y recibe `PT409`
12. revocación idempotente, sin repetir el secreto ni mover `revoked_at`
13. no se puede tocar ni descubrir el enlace de otro
14. DML directo por `authenticated` sigue denegado; `anon` no ejecuta ninguna RPC
15. enlaces heredados intactos y `portal_read_snapshot` / `portal_respond_to_change`
    siguen funcionando igual
16. controles negativos del vocabulario y de los privilegios
17. la tabla exige caducidad por sí misma: `NOT NULL` y `CHECK` probados por
    inserción directa, más el `DEFAULT` de 90 días sin pasar por la RPC

No se envuelve todo en una transacción porque las dos pruebas de carrera necesitan
sesiones compitiendo de verdad por un bloqueo. Ambas sueltan el bloqueo en un
`finally`: si la aserción falla, la prueba se delata en vez de colgar a las demás.

### Mutantes

Cada garantía nueva se comprobó rompiéndola a propósito, sobre una copia del árbol
en scratch para no tocar los archivos versionados. Ocho de nueve mutantes mueren, y
cada uno en la prueba que le corresponde:

| Mutante | Prueba que lo mata |
|---|---|
| el bloqueo del proyecto vuelve a `FOR SHARE` | emisiones simultáneas |
| el tope pasa a seis | cinco vigentes por proyecto |
| el plazo por defecto pasa a 30 días | omitir la caducidad da 90 días |
| la rotación hereda el plazo restante | rotar renueva el plazo entero |
| la rotación deja de comprobar el tope | rotar al tope no consume plaza |
| el techo sube a 10 años | suelo y techo |
| un caducado sigue ocupando plaza | cinco vigentes por proyecto |
| desaparece el `CHECK` de ventana | la tabla exige caducidad por sí misma |

El noveno —insertar antes de revocar en la rotación— **sobrevive**, y con razón: el
tope se comprueba una sola vez al final y el saldo es cero, así que dentro de la
transacción el orden da igual. Es un mutante equivalente, no un hueco de cobertura.
El comentario de la migración se corrigió para decir eso mismo, porque antes
atribuía la garantía al orden en vez de al bloqueo del proyecto.

`__tests__/portal-token-access.integration.test.mjs` se reejecutó entero (14/14), y
las dos suites pasan encadenadas en el mismo orden que usa CI: 32 pruebas, 0 fallos,
0 omitidas.

`__tests__/support/portal-token-access-schema.sql` añade `label` y `created_at` a la
tabla desechable: ya existen en producción y las RPC las escriben. Sin ellas el banco
habría pasado por el motivo equivocado.

CI: `.github/workflows/portal-token-lifecycle-integration.yml`, sin ningún secreto
del repositorio, levanta `postgres:17` en un contenedor efímero.

## Despliegue futuro

1. Ejecutar **`CHECK_E4_L1_PRECHECK`** de `docs/fase2/CHECKS.sql`: `veredicto`
   debe decir `OK`. Los bloques `CHECK_E4_L1_VALUES` y `CHECK_E4_L1_EXPIRY`
   **no sirven antes del despliegue**, porque llaman a
   `portal_token_permissions_valid()` y `portal_token_max_lifetime()`, que nacen
   dentro de este mismo lote: ejecutarlos antes falla con
   «function does not exist». El precheck no depende de ningún objeto de E4.
   (Corregido el 2026-09-24; antes este paso remitía al bloque equivocado.)
   Si el veredicto no es `OK`, parar y revisar a mano — la migración también se
   detendrá sola con un mensaje legible, sin inventar fechas.
2. Aplicar `20260923120000_portal_token_lifecycle.sql`.
3. Ejecutar `CHECK_E4_L1_SCHEMA`, `CHECK_E4_L1_GRANTS` y `CHECK_E4_L1_EXPIRY`.
   El inventario debe dar **13 funciones: 6 públicas y 7 internas** — las tres
   RPC más `portal_token_permissions_valid`, `portal_token_default_lifetime` y
   `portal_token_max_lifetime` en `public`, y los siete auxiliares en
   `portal_token_internal`. Las tres RPC con `anon_execute = false` y
   `authenticated_execute = true`, los auxiliares privados con ambos en `false`,
   las seis filas de DML directo en `false`, `created_at` y `expires_at` con `is_nullable = NO`, los dos CHECK
   presentes y los plazos en 90 y 365 días.
4. Reejecutar el segundo `SELECT` de `CHECK_E4_L1_VALUES`: cero proyectos por encima
   de cinco vigentes.
5. No hace falta desplegar aplicación: ninguna pantalla llama todavía a estas RPC.

Compensación: `ROLLBACK_2F2_E4_L1` en `docs/fase2/ROLLBACK.sql`, **sin ejecutar**.
Exige el reconocimiento explícito
`enlaze.allow_portal_lifecycle_rollback = 'before_issuing_links'` y se niega si
existe algún enlace moderno vigente, con la misma definición de vigente que usan las
RPC. Retira las tres RPC, el esquema privado, los dos CHECK, el `NOT NULL` de
`created_at` y `expires_at`, el `DEFAULT` de `expires_at` y las tres funciones
públicas auxiliares. **No borra ninguna fila** y no toca `projects.access_token`.
Probado en el banco desechable en sus tres caminos: sin reconocimiento falla, con un
enlace vigente falla, y con reconocimiento y sin vigentes completa dejando cero
objetos de E4, las filas intactas y los enlaces heredados en su sitio.

Asimetría deliberada: el rollback retira el `DEFAULT` de `expires_at`, que este lote
introdujo, pero **no** el de `created_at`, porque no consta que la columna no lo
tuviera ya y quitarlo rompería inserciones que hoy lo dan por hecho.

## Riesgos y decisiones abiertas

- **La lectura de producción quedó bloqueada** en esta revisión por el clasificador
  de permisos, así que el estado de `created_at` y `expires_at` en la tabla real no
  se pudo reconfirmar. La migración está escrita para pararse con un mensaje claro
  en vez de asumirlo, pero conviene ejecutar `CHECK_E4_L1_VALUES` antes de aplicar.
- **Los 90 y los 365 días son política, no física.** Cambiarlos después es fácil —
  las dos funciones de plazo son el único sitio— pero **no** re-caduca los enlaces
  ya emitidos: los vivos conservan la fecha que tuvieran.
- **El tope de 5 no se aplica retroactivamente.** Si alguna vez existieran más de
  cinco vigentes en un proyecto (hoy no hay ninguno moderno), las RPC impedirían
  emitir más pero no revocarían los sobrantes. El segundo `SELECT` de
  `CHECK_E4_L1_VALUES` los delataría.
- **El secreto viaja en la respuesta de emisión y de rotación**, que es lo mínimo
  para poder copiar el enlace. No se registra en logs ni se devuelve en ninguna otra
  ruta, pero cualquier pantalla que lo consuma no debe persistirlo.
- **Convivencia con enlaces heredados.** Los 8 siguen vivos, sin caducidad y fuera de
  este ciclo de vida: no se migran, no se revocan y no reciben permisos. No cuentan
  para el tope de cinco, que solo mira `portal_tokens`. Su sustitución gradual es un
  lote posterior.
- **Idempotencia de la revocación** es una decisión, no un descuido: se eligió por
  encima de devolver `PT409` para que un reintento de red no parezca un fallo.
- **Contención por proyecto.** El `FOR UPDATE` sobre la fila del proyecto serializa
  emisiones y rotaciones de ese proyecto. Las transacciones son cortas y el
  `lock_timeout` de la migración no aplica en tiempo de ejecución, así que en la
  práctica no debería notarse; si alguna vez se emitieran enlaces en lote habría que
  medirlo.
