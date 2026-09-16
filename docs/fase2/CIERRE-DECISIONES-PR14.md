# Cierre de decisiones del PR #14 — 2026-09-16

HEAD `1272a0d`, 6/6 comprobaciones verdes, Vercel Ready en Preview. Dos
migraciones pendientes en la rama: `20260915140000_portal_tokens_owner_only.sql`
y `20260915150000_portal_token_read_access.sql`. Nada aplicado en producción.

## Distinción que ordena todo lo demás

**Fusionar no es aplicar.** Fusionar #14 no toca la base de datos: deja dos
ficheros de migración en `main`, sin ejecutar. Lo que las decisiones de abajo
condicionan es **aplicar `150000`**, no el merge. La única razón para decidir
antes de fusionar es que dos de las respuestas cambian el SQL de `150000`, y es
preferible que esa migración entre en `main` ya en su forma definitiva que
enmendarla después en otro PR.

---

## A. Imprescindible antes de fusionar y aplicar

### A1. La vulnerabilidad de tokens — ya corregida, nada pendiente

`1272a0d` la cierra con `20260915140000`. Verificación: 12/12 en PostgreSQL 17 y
cuatro mutantes que fallan la suite (rama `created_by` restaurada, `WITH CHECK`
heredado, trigger retirado, `revoke` retirado). No requiere ninguna decisión.

### A2. Orden de migraciones

`140000` < `150000` < `160000` por nombre, que es el orden de aplicación. Lo que
importa, y ya está garantizado:

- **`140000` es autosuficiente.** Cierra por sí sola la forja de tokens y la
  enumeración; no depende de `150000`. Puede aplicarse hoy, sola, sin ninguna de
  las decisiones de abajo.
- **`150000` no debe aplicarse nunca antes que `140000`**, porque
  `portal_read_snapshot` es SECURITY DEFINER y convertiría una fila forjada en el
  proyecto entero. El orden por nombre ya lo impide.
- `160000` (E2) es independiente y puede esperar.

**No hay ninguna otra corrección técnica pendiente en el bloque A.** No he
encontrado ningún fallo adicional en esta revisión.

---

## B. Puede esperar a E2 / `160000` o más tarde

| Asunto | Por qué puede esperar |
|---|---|
| Aprobación de presupuestos desde el portal | Imposible por construcción para enlaces heredados, y hoy irrelevante: **0 presupuestos en `enviado`**, luego no habría ninguno que responder aunque existieran tokens |
| RPC de emisión y rotación de tokens | Nada la necesita hasta que se quiera emitir el primer enlace moderno. `portal_tokens` sigue con 0 filas |
| Caducidad por defecto y máxima | Pertenece a la emisión; sin emisión no aplica |
| Asignar proyecto a los presupuestos sueltos (Nivel 1 y 2) | Trabajo de datos, reversible, sin ventana de riesgo |
| Retirar el `GRANT SELECT` de `anon` sobre `portal_tokens` | Tras `140000` no queda política que le deje ver filas; el `grant` sobrante no expone nada |

---

## C. Requiere decisión explícita vuestra

### C1. Presupuestos sin `project_id` compartidos por `client_id`

#### Alcance real, medido

De 5 pares enlace-presupuesto visibles hoy en la rama, 4 llegan por la vía
«cliente». Pero lo importante es lo que **no** ocurre:

| Medida | Valor |
|---|---:|
| Pares que cruzan de **propietario** | **0** |
| Pares que cruzan de **cliente** | **0** |
| Presupuestos distintos que llegan por la vía cliente | 3 |
| Presupuestos visibles desde **más de un enlace** | **1** |

La regla exige `b.user_id = proyecto.user_id` **y** `b.client_id =
proyecto.client_id`, así que un cliente solo puede ver presupuestos suyos, del
mismo contratista. **Esto no es una fuga de confidencialidad como lo era la forja
de tokens: es una mala atribución dentro de los portales de un mismo cliente.**
El cliente ya tiene derecho a ver ese presupuesto; lo ve bajo el proyecto
equivocado.

El caso único es **PRE-2026-18088** (`pendiente`, 6.771,94 €), de la clienta
«Maria», visible desde sus dos enlaces: «prueba» y «Pintura casa María López».

Riesgo residual: una ficha de cliente tiene un solo contacto, así que hoy es la
misma persona. Dejaría de serlo si un cliente-empresa pasara a tener varios
interlocutores por proyecto.

#### Opciones seguras comparadas

| Opción | Pares visibles | Reparto cruzado | Migra datos | Coste |
|---|---:|---|---|---|
| 1. Dejarlo como está | 5 | sí (1 presupuesto, 2 enlaces) | no | ninguno |
| **2. Cliente con un único proyecto** | **3** | **imposible por construcción** | **no** | 1 presupuesto, 1 clienta, 2 portales |
| 3. Solo presupuestos del proyecto | 1 | imposible | no | 4 pares; 3 portales vacíos; oculta 2 presupuestos **aceptados** |
| 4. Asignar datos y luego la 3 | 5 tras asignar | imposible | sí | depende de C3 del informe anterior |

La opción 2 muestra un presupuesto sin proyecto solo si el cliente del enlace
tiene exactamente un proyecto. Cuando tiene varios no hay forma de saber a cuál
corresponde, así que no se muestra: el reparto deja de ser posible, sin tocar un
solo dato y sin decidir nada sobre los registros existentes.

Detalle por enlace de la opción 2: «reforma» conserva 1, «reforma local» conserva
2, «prueba» y «Pintura casa María López» pasan de 1 a 0, y los tres portales del
propio titular siguen en 0 por el filtro de borradores ya aprobado.

#### Decisión tomada: opción 2 (aprobada el 2026-09-16)

Implementada en `20260915150000`. `portal_read_snapshot` calcula una vez por
lectura si el cliente del enlace tiene exactamente un proyecto vivo del mismo
propietario, y solo en ese caso muestra presupuestos sin `project_id`. La misma
condición gobierna el sellado de `viewed_at`, porque marcar como «Visualizado» un
presupuesto que el cliente no llegó a ver falsearía el timeline de aceptación.

Efecto medido contra producción con la regla ya escrita:

| Proyecto | Cliente único | Visibles tras la regla | Detalle |
|---|---|---:|---|
| reforma | sí | 1 | PRE-2026-53806 (aceptado) |
| reforma local | sí | 2 | PRE-2026-14306 (pendiente), PRE-2026-19087 (aceptado) |
| prueba | no | 0 | — |
| Pintura casa María López | no | 0 | — |
| prueba 2 / prueba 3 / Reforma vivienda integral | no | 0 | ya vacíos por el filtro de borradores |

Total: 3 pares, 3 presupuestos distintos, **0 cruces de cliente y 0 de
propietario**. Los dos portales que pasan a 0 son los de «Maria», y lo único que
contenían era el presupuesto ambiguo PRE-2026-18088; **ningún portal pierde un
presupuesto atribuido directamente a su proyecto**. «reforma» y «reforma local»
conservan los suyos, incluidos dos aceptados que la opción 3 habría escondido.

PRE-2026-18088 vuelve a verse en cuanto se le asigne un `project_id`: la regla no
prejuzga esa asignación, solo deja de adivinarla.

#### Facturas: misma regla, aprobada después

La asimetría se señaló al aplicar la regla a presupuestos y se resolvió el mismo
día extendiéndola a facturas: una factura sin `project_id` se muestra solo si el
cliente del enlace tiene exactamente un proyecto vivo del mismo propietario, y una
factura con `project_id` sigue viéndose solo en su proyecto.

Efecto medido con las dos facturas vivas, ambas sin `project_id`:

| Factura | Importe | Estado | Cliente | Antes | Después |
|---|---:|---|---|---|---|
| `031-0011-983717` | 62,51 € | `paid` | Alvaro Miralles (3 proyectos, los 3 con enlace) | visible en «prueba 2», «prueba 3» y «Reforma vivienda integral» | **oculta en las tres** |
| *(sin número)* | 0,00 € | `pending` | sin cliente | nunca visible | sin cambio |

Total: 3 pares antes, **0 después**; 1 factura en varios enlaces antes, **0
después**; 0 cruces de cliente y 0 de propietario. La única factura afectada es de
la ficha de cliente del propio titular, así que **ningún cliente real pierde
nada**, y vuelve a verse en cuanto se le asigne un proyecto.

### C2. Qué puede hacer un enlace heredado

Comportamiento exacto del código en `1272a0d`, no de memoria:

| Acción | Enlace heredado (`projects.access_token`) | Token moderno |
|---|---|---|
| **Leer** el portal de su proyecto | Sí | Sí |
| **Responder cambios de obra** | **Sí**, sin comprobación de capacidad | Solo con `approve_changes` |
| **Aprobar o rechazar presupuestos** | **No, nunca** | Solo con `approve_budgets`, y además el presupuesto debe estar atado al proyecto, en `enviado` y con versión documental |

La aprobación de presupuestos está cerrada por construcción: E2 exige una fila en
`portal_tokens`, y un enlace heredado no la tiene. No hay que decidir nada ahí.

Lo que sí hay que decidir es **la respuesta a cambios de obra**. Dos lecturas
legítimas:

- *Mantenerla.* `150000` no concede nada nuevo: hoy la política
  `"Public update change approval"` tiene `USING(true)`, es decir que **cualquiera
  en Internet** puede aprobar un cambio de obra. La migración lo reduce a quien
  posee un enlace válido de ese proyecto. Es una **restricción fuerte**, no una
  concesión retroactiva.
- *Quitarla.* Si el criterio es que un secreto sin caducidad ni revocación, que ha
  circulado por correo y WhatsApp, no debe tener ningún poder de escritura,
  entonces los siete enlaces vivos se quedan sin aprobar extras hasta que exista
  emisión de tokens modernos.

**Decisión tomada: mantenerla (aprobada el 2026-09-16).** No requiere ningún
cambio de código: es lo que `150000` ya hace. Un enlace heredado conserva lectura
y respuesta a cambios de obra, restringida por la migración a quien posea el
enlace válido de ese proyecto, y **no gana ninguna capacidad sobre presupuestos**.
No se concede nada retroactivo: la migración reduce el alcance de una política que
hoy es `USING(true)`.

### C3. No se reabre

La ocultación de borradores está aprobada e implementada (lista explícita de
estados visibles). No he encontrado evidencia nueva que justifique reabrirla.

---

## Orden propuesto

1. ~~Responder C1 y C2.~~ Resueltas el 2026-09-16: C1 opción 2, C2 mantener.
2. ~~Enmendar `150000`.~~ Hecho; banco 13/13 y dos mutantes que fallan la suite.
3. Revisar el CI del commit nuevo antes de cualquier decisión de integración.
4. Fusionar #14.
4. Aplicar **`140000` sola** y comprobar que el panel sigue listando enlaces y que
   el borrado de cuenta sigue funcionando.
5. Aplicar `150000`. El portal vuelve en lectura, con respuesta a cambios y con
   los presupuestos bloqueados y avisados.
6. Más tarde y por separado: `160000` (E2), emisión de tokens, asignación de
   proyecto.

Entre los pasos 4 y 5 el sistema queda en un estado coherente y más seguro que
hoy: sin forja de tokens, sin enumeración, y con el portal todavía caído. Se puede
permanecer ahí indefinidamente.
