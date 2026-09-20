# Preflight de E2 — actualizado 2026-09-16

Sustituye al preflight anterior, que daba E1 por pendiente. Verificado por lectura
sobre `dsgnymebkxxkslyeotee` el 2026-09-16.

## 1. E1 ya está aplicada — confirmado

El preflight antiguo afirmaba que E1 (`lock_version`) seguía pendiente y que era la
única migración por aplicar. **Las dos mitades eran falsas.** Lectura directa:

| Comprobación | Resultado |
|---|---|
| `20260914090000` en `supabase_migrations.schema_migrations` | registrada, nombre `budgets_lock_version` |
| Columna `budgets.lock_version` | existe |
| Nulabilidad / default | `NOT NULL`, default `1` |
| Filas con `lock_version` nulo | 0 de 18 |

E1 está aplicada y consolidada. No hay que volver a ejecutarla, y cualquier
`dry-run` que la proponga indica que se está comparando contra un historial viejo.

## 2. El historial del repositorio coincide con producción

La última migración de `main` es `20260914090000`, que es exactamente la última
registrada en producción. **`main` no tiene ninguna migración pendiente.**

| Rama | Migraciones por encima de `20260914090000` |
|---|---|
| `main` (`c475ec6`) | ninguna |
| `codex/portal-token-access-20260916` | `20260915150000_portal_token_read_access.sql` |
| `codex/budget-revision-rpcs-2f2-e2` | `20260915160000_budget_revision_rpcs.sql` |

Ambas ramas parten de `c475ec6`, así que ninguna necesita rebase.

## 3. Orden de aplicación

`150000` < `160000`, así que el orden por nombre ya es el correcto. Importa por dos
motivos:

- `150000` cierra la política `"Public update change approval"` sobre
  `project_changes`, que hoy sigue viva con `USING(true)`. Es el único agujero de
  escritura pública que queda.
- `150000` sondea con `to_regprocedure` si `portal_respond_to_budget` existe. Si se
  aplica antes que E2, el portal declara la respuesta a presupuestos como no
  disponible y la bloquea con aviso; al aplicar E2 después, se habilita sola sin
  tocar la aplicación.

Aplicar **solo** E2 sin `150000` deja el portal caído (sin lector) y el
`USING(true)` abierto. Aplicar **solo** `150000` es seguro y es el orden
recomendado si hay que separarlas.

## 4. Comprobaciones antes de aplicar E2

Se mantienen las del documento de E2, con estas precisiones:

- [ ] CI verde sobre el commit del PR, no solo en local.
- [ ] `budget_internal` no existe todavía en producción. Si existe, **detenerse**:
      no sobrescribir.
- [ ] Ninguna de las seis firmas públicas de E2 existe:
      `create_budget_with_items`, `save_budget`, `finalize_budget`,
      `change_budget_status`, `duplicate_budget`, `portal_respond_to_budget`.
- [ ] `CHECK_E2_SCHEMA` de `docs/fase2/CHECKS.sql` ejecutado y archivado.
- [ ] Dry-run que muestre **solo** E2 (y `150000` si van en la misma ventana).
- [ ] Hashes de datos de `budgets` y `budget_items` antes y después.
- [ ] Decisión 1 de `DECISIONES-PORTAL-20260916.md` resuelta: E2 no la toca, pero
      `150000` restaura la visibilidad y no debe desplegarse sin esa respuesta.

## 5. Lo que E2 **no** desbloquea

Conviene fijarlo para que nadie espere un efecto que no va a ocurrir:

- **0 presupuestos en estado `enviado`.** `portal_respond_to_budget` solo acepta
  `enviado`/`sent`, así que tras aplicar E2 no habrá ni un presupuesto respondible.
- **0 filas en `portal_tokens`**, y ningún código que las cree. Todos los enlaces
  vivos son legacy (`projects.access_token`) y la función los rechaza por diseño.
- **10 de 18 presupuestos sin `project_id`**, y 5 de los 7 visibles desde el
  portal. La función exige `budgets.project_id = portal_tokens.project_id`, así que
  seguirían fuera aun con token y capacidad.

Es decir: E2 es correcta y merece aplicarse por las RPC de escritura autenticada,
pero **no** restaura por sí sola la aceptación de presupuestos desde el portal. Eso
depende de la decisión 2.

## 6. Compensación

Sin cambios respecto al documento de E2: `ROLLBACK_2F2_E2` exige el reconocimiento
`before_revision_clients`, elimina solo esas funciones y su esquema, sin `CASCADE`,
y no repara historial remoto. Para `150000` la compensación es recrear las
políticas que elimina, lo que **reabriría** el `USING(true)`; preferible corregir
hacia delante.
