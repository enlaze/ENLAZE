# Decisiones pendientes antes de restaurar el portal — 2026-09-16

Dos decisiones bloquean el despliegue de `20260915150000_portal_token_read_access.sql`.
Ninguna se ha aplicado: este documento aporta los datos y las opciones, no la decisión.
Todas las cifras salen de lecturas sobre el proyecto `dsgnymebkxxkslyeotee` el
2026-09-16; no se escribió nada, no se creó ningún token y no se asignó ninguna
capacidad.

## El marco cambió: el portal no está expuesto, está caído

`20260908082105_fix_open_rls_select_policies` retiró el SELECT público de
`projects`, `clients`, `budgets`, `project_changes` y `project_milestones`. Como
`anon` hoy no ve **ninguna** fila de esas tablas, los siete enlaces vivos no
muestran nada.

Esto invierte la pregunta. Aplicar la migración no *mantiene* una exposición
heredada: la **reactiva**, porque `portal_read_snapshot` es SECURITY DEFINER y no
depende de las políticas ausentes. Cualquier cosa que el snapshot devuelva pasa a
verse por primera vez en meses. Por eso la visibilidad es una puerta de
despliegue y no una deuda que se pueda arrastrar.

---

## Decisión 1 — Qué presupuestos ve cada enlace legacy

### Regla actual del lector

Un enlace de proyecto muestra un presupuesto si pertenece al propietario, no está
borrado y **o bien** está atado a ese proyecto, **o bien** no tiene proyecto y
comparte cliente con él:

```sql
b.project_id = <proyecto>  or  (<cliente> is not null and b.project_id is null and b.client_id = <cliente>)
```

Sin filtro de estado: un `borrador` se muestra igual que un `aceptado`.

### Qué vería cada enlace, por opción

Presupuestos visibles por enlace (7 enlaces, 7 presupuestos distintos, 12 pares
enlace-presupuesto):

| Proyecto | A: tal cual | B: sin borradores | C: solo del proyecto | D: ambas |
|---|---:|---:|---:|---:|
| prueba 3 | 3 | 0 | 1 | 0 |
| prueba 2 | 2 | 0 | 0 | 0 |
| reforma local | 2 | 2 | 1 | 1 |
| Reforma vivienda integral c/ alcalde jose luis lassaletta | 2 | 0 | 0 | 0 |
| Pintura casa María López | 1 | 1 | 0 | 0 |
| prueba | 1 | 1 | 0 | 0 |
| reforma | 1 | 1 | 0 | 0 |

### Quién ve realmente un borrador hoy

Los tres enlaces que exponen borradores —`prueba 3`, `prueba 2` y `Reforma
vivienda integral…`— pertenecen **al mismo propietario**, y en los tres la ficha
de cliente asociada **es el propio titular de la cuenta** (el correo del cliente
coincide con el del usuario).

**Ningún tercero ve hoy un borrador.** El único cliente que no es el propio
usuario es «Maria», con dos enlaces, y lo que ve es `PRE-2026-18088` en estado
`pendiente` (6.771,94 €), no un borrador.

Esto rebaja mucho la urgencia, y a la vez hace que ocultar borradores sea casi
gratis: hoy no le quita nada a ningún cliente real.

### El segundo eje, que no va de borradores

La rama «por cliente» reparte un presupuesto sin proyecto a **todos** los enlaces
de ese cliente:

| Presupuesto | Estado | Importe | Enlaces que lo ven |
|---|---|---:|---:|
| PRE-2026-47770 | borrador | 172.495,01 € | 3 |
| PRE-2026-98502 | borrador | 187.403,18 € | 3 |
| PRE-2026-18088 | pendiente | 6.771,94 € | 2 |

Son 10 de 18 presupuestos los que no tienen `project_id`, y 5 de los 7 visibles
desde el portal. Ocultar borradores **no** corrige esto: `PRE-2026-18088` seguiría
apareciendo en dos portales distintos. Es una decisión separada.

### Opciones

- **A — Restaurar tal cual.** Cero cambios. Riesgo: al primer cliente real con
  varios proyectos se le enseñan borradores con precios internos y provisionales
  como si fueran ofertas. Hoy no afecta a nadie; mañana sí.
- **B — Ocultar borradores** (`status not in ('borrador','draft')` en el snapshot).
  Cambio de una línea en la migración, verificable con el banco. Coste real hoy:
  tres portales del propio titular pasan a 0 presupuestos. Ningún cliente real
  pierde nada. **Es la que recomiendo.**
- **C — Solo presupuestos del proyecto** (eliminar la rama por cliente). Corrige
  el reparto cruzado, pero deja 5 de 7 portales vacíos, incluido el de «Maria».
  Requiere antes atar los presupuestos a su proyecto.
- **D — B + C.** Solo `reforma local` mostraría algo. Demasiado agresivo sin
  limpiar datos primero.

### Recomendación

**B ahora, C después de limpiar datos.** B cierra la ventana mientras no cuesta
nada, y deja el reparto por cliente como una decisión con su propio trabajo de
datos detrás.

> No aplicado. Cambiar la visibilidad es política de producto y necesita tu
> aprobación expresa.

---

## Decisión 2 — Respuesta a presupuestos desde enlaces legacy

### Por qué aplicar 150000 + 160000 juntas no basta

`portal_respond_to_budget` (E2, línea 340 y siguientes) exige **cinco** cosas:

1. Una fila en `portal_tokens` cuyo `token` sea el UUID presentado.
2. Que esa fila esté activa, sin revocar, sin caducar, y con `approve_budgets`.
3. Que el presupuesto cumpla `budgets.project_id = portal_tokens.project_id`.
4. Estado `enviado` o `sent`.
5. Una fila de `document_versions` para la versión actual del presupuesto.

Un enlace legacy es un `projects.access_token`, no una fila de `portal_tokens`:
falla en el punto 1 y la función responde «Portal link is not available». No es un
efecto secundario del orden de aplicación; es el diseño de capacidades de E2.

### Estado real hoy

- `portal_tokens`: **0 filas**. Y **ningún punto del código las crea**: el botón
  «Compartir con cliente» de `app/dashboard/projects/[id]/page.tsx:833` solo
  *lee* `portal_tokens` y, al no encontrar nada, copia la URL del `access_token`.
- **0 presupuestos en `enviado`**. Los estados presentes son `borrador`,
  `pendiente` y `aceptado`. Aunque hubiera tokens y capacidades, el punto 4 no se
  cumpliría para ninguno: hoy no hay nada que responder.
- 5 de los 7 presupuestos visibles desde el portal no tienen `project_id`, así que
  fallarían el punto 3 aun con token y capacidad.

Conclusión: habilitar la respuesta **no es urgente**, porque ahora mismo no
desbloquearía ni un solo presupuesto.

### Opciones de emisión / migración de enlaces

- **A — Migrar el UUID legacy a `portal_tokens`, con permisos `["read"]`.**
  Conserva las URLs que ya circulan; no concede nada nuevo. Deja el modelo listo
  para conceder capacidades una a una más adelante.
  *Riesgo:* el `access_token` nunca se trató como secreto con capacidades. No
  caduca, no se puede revocar hoy sin romper la URL y ha viajado por correo y
  WhatsApp. Como se queda en `read`, no hay escalada, pero se legitima como
  identidad de portal un secreto de higiene desconocida.
- **B — A, pero concediendo `approve_budgets` de entrada.**
  *Riesgo alto:* cualquiera que haya recibido alguna vez uno de esos enlaces
  podría aceptar un contrato. Convierte un enlace de lectura en poder de firma
  retroactivamente. **No recomendada.**
- **C — Emitir tokens nuevos, con caducidad y capacidades explícitas, y revocar
  los legacy.** Es el modelo que E2 presupone.
  *Coste:* hay que construir la emisión (no existe), reenviar enlaces a los
  clientes y aceptar que las URLs antiguas dejen de funcionar.
  *Riesgo:* si se revoca antes de reenviar, los clientes se quedan sin portal.
- **D — Relajar E2 para aceptar `access_token`.**
  *Riesgo:* tira el modelo de capacidades justo donde más importa —la aceptación
  de un contrato— y obliga a retocar una migración ya revisada y con CI propio.
  **No recomendada.**
- **E — No habilitar la respuesta ahora.** El portal se restaura en lectura y con
  respuesta a *cambios*; los presupuestos quedan bloqueados con aviso explícito.
  *Coste hoy: ninguno*, porque no hay presupuestos en `enviado`.

### Requisito previo, valga la opción que valga

Mientras los presupuestos no estén atados a un proyecto (`project_id`), el punto 3
los deja fuera. Atarlos es trabajo de datos que ninguna de las opciones evita.

### Recomendación

**E ahora; C cuando exista la emisión (E4), con A como puente solo si hay que
conservar las URLs en circulación.** Y antes que cualquiera de las dos, atar los
presupuestos a su proyecto.

> No aplicado. No se ha creado ningún token ni asignado ninguna capacidad.

---

## Lo que sí se corrigió en esta rama, por ser un fallo técnico inequívoco

El lector lista presupuestos por la vía «cliente» que el escritor de E2 rechaza
por el punto 3. Con una capacidad concedida a nivel de enlace, el portal habría
ofrecido «Aceptar» sobre presupuestos que la base iba a rechazar: la misma clase
de falsa promesa que ya se corrigió en `7205fb9`.

`portal_read_snapshot` devuelve ahora `can_respond` **por presupuesto**,
reproduciendo las cinco condiciones del escritor, y el portal dibuja el botón solo
con esa señal. Cubierto por la prueba `can_respond repeats every condition the
budget writer checks`, que verifica además que un presupuesto solo-cliente no es
respondible y que perder su `document_versions` lo descalifica.

Esto no decide visibilidad ni permisos: solo impide ofrecer lo que la base niega.
