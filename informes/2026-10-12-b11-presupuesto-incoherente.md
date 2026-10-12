# b11-presupuesto-incoherente: PRE-2026-53806 y los presupuestos que no cuadran

Rama `auto/b11-presupuesto-incoherente`, sacada de `origin/main` (10788b1). No toca main. En la base solo he hecho `SELECT`.

## Resumen

- **"Aceptado" con la línea de tiempo en "Rechazado"** son datos antiguos que dejó un fallo del programa en abril. Ese fallo ya no existe en la base. La página sí seguía enseñándolo mal, y eso es lo que he arreglado.
- **"Partidas (0)" con "Subtotal 333 €"** también son datos de abril. Hoy la base no deja finalizar un presupuesto con importe y sin partidas.
- **Hay otro descuadre que sigue pasando hoy**: los presupuestos del asistente guardan la cesta de materiales como partidas, y el subtotal no la incluye. **No lo he tocado** porque es una decisión de producto (pregunta 1).

## 1. Estado "Aceptado", línea de tiempo "Rechazado"

La ficha leía el estado de `status` y la línea de tiempo de las fechas: si había `rejected_at`, ponía "Rechazado" fuera cual fuera el estado.

El historial de versiones de PRE-2026-53806 (`document_versions`) cuenta lo que pasó. El 18 de abril, en 15 segundos, pasó por enviado → pendiente → enviado → aceptado → rechazado → enviado → pendiente. El 27 de abril pasó a aceptado. El código de entonces permitía cualquier cambio y solo escribía una fecha si estaba vacía (`if (!budget.rejected_at)`), así que `rejected_at` se quedó del día 18.

**Hoy ya no puede pasar con presupuestos nuevos.** Desde el 15 de septiembre (migración `20260915160000`), la base cambia el estado con `change_budget_status` y el portal con `portal_respond_to_budget`. Lo he comprobado en la base, no solo en el fichero:
- Solo se puede pasar de pendiente a enviado y de enviado a aceptado o rechazado. No hay vuelta atrás.
- Al aceptar se borra `rejected_at`, y al rechazar se borra `accepted_at`.

**Lo que he cambiado** en `app/dashboard/budgets/[id]/page.tsx`:
- La línea de tiempo obedece al estado: pone "Rechazado" solo si el estado es rechazado, y la fecha de aceptación solo si es aceptado. PRE-2026-53806 pasa a verse "Aceptado 18 abr" sin tocar sus datos. Es la fecha que guarda `accepted_at`: el paso a aceptado del 27 de abril no la actualizó, por el mismo fallo antiguo.
- Al cambiar el estado, la página deja las fechas como las deja la base: borra la contraria. Antes copiaba la lógica antigua y, hasta recargar, podía enseñar las dos.

**Otros presupuestos con el mismo síntoma:** 1 de 12, el propio PRE-2026-53806. Ninguno ha cambiado de estado desde el 15 de septiembre.

## 2. Subtotal sin partidas

El subtotal se guarda aparte, en `budgets.subtotal`. Lo manda el navegador al guardar y la base no lo compara con la suma de las partidas. La base solo comprueba una cosa: un presupuesto finalizado con total mayor que 0 tiene que tener partidas (`save_core`, "A contractual budget with positive total requires items").

PRE-2026-53806 vale 333 € desde su primera versión, del 18 de abril, y nunca ha tenido partidas. La comprobación anterior no existía en abril.

**4 presupuestos sin partidas y con subtotal:**

| Presupuesto | Estado | Creado | Subtotal |
|---|---|---|---|
| PRE-2026-53806 | aceptado | 18 abr | 333,00 € |
| PRE-2026-32309 | borrador | 21 may | 2.448,00 € |
| PRE-2026-19087 | aceptado | 9 jul | 2.448,00 € |
| PRE-2026-63983 | borrador | 14 jul | 2.448,00 € |

Los 4 son anteriores al 15 de septiembre. Hoy no veo cómo crear uno nuevo así: el formulario manual calcula el subtotal a partir de sus partidas, y el asistente, a partir de las partidas que guarda.

## 3. El descuadre que sigue pasando: la cesta de materiales

En **5 presupuestos del asistente**, la suma de las partidas es mayor que el subtotal. La diferencia es exactamente la suma de las partidas con descripción "Material sugerido":

| Presupuesto | Estado | Subtotal | Partidas sin materiales | Materiales (líneas) |
|---|---|---|---|---|
| PRE-2026-18088 | pendiente (guardado el 23 sep) | 5.596,65 € | 5.596,64 € | 1.342,95 € (9) |
| PRE-2026-98502 | borrador | 154.878,66 € | 154.878,67 € | 19.287,29 € (30) |
| PRE-2026-47770 | borrador | 142.557,86 € | 142.557,86 € | 10.856,95 € (45) |
| PRE-2026-21547 | borrador | 106.921,57 € | 106.921,57 € | 9.277,65 € (45) |
| PRE-2026-71515 | borrador | 0,00 € | sin partidas | 3.550,14 € (71) |

**Por qué pasa:**
- El asistente guarda como partidas las no opcionales **más** la cesta de materiales, con el margen aplicado (`revisionItems()` en `BudgetGenerateProvider.tsx`).
- El subtotal solo suma las partidas (`totals.clientPrice`).
- El propio asistente le dice al usuario: "La cesta actualiza el componente de material de las partidas; no se suma una segunda vez".

Resultado: en la ficha, "Partidas (n)" enseña los materiales como líneas con precio, y esas líneas suman más que el subtotal que paga el cliente.

**No lo he cambiado** porque hay dos pruebas que exigen a propósito que partidas y materiales vayan juntos (`budget-generate-writer-flow`, "partidas and materials share one ordered payload", y `budget-items-sort-order-writers-only`), y los materiales guardan además el origen de su precio (`evidenceForSave`). Quitarlos cambia qué se guarda y qué ven el PDF y la ficha. Es la pregunta 1.

## Cómo lo he comprobado

- **Prueba nueva** `__tests__/budget-status-coherence.test.mjs` (4 casos):
  - la línea de tiempo obedece al estado;
  - al cambiar el estado, la página borra la fecha contraria;
  - la última versión de `change_budget_status` y de `portal_respond_to_budget` en las migraciones solo permite los cambios hacia delante y borra la fecha contraria;
  - sigue existiendo la regla "contractual con importe necesita partidas".
  
  Con la página de main fallan los dos primeros; con el arreglo pasan los 4.
- **Batería unitaria completa:** 625 pasan, 0 fallan, 2 `todo`. `tsc --noEmit` sin errores. `eslint` en la página: el mismo error de `react-hooks` (línea 138, `loadBudget`) que en main, que es uno de los 23 heredados, y nada nuevo. `npm run build` correcto.
- **Base:** solo `SELECT` (presupuestos, partidas, `document_versions` y el código de las funciones). Del presupuesto he mirado número, estado, fechas e importes, no datos del cliente.
- **No lo he visto en el navegador.**
- **No he corregido ningún dato**, como pide el bloque.

## Qué tienes que decidir

1. **La cesta de materiales en las partidas.** ¿Qué hacemos?
   - **a)** Dejar de guardarla como partidas. Seguiría en `wizard_state`, que es de donde la recarga el asistente. La ficha y el PDF cuadrarían con el subtotal. Las 2 pruebas que lo exigen se cambiarían.
   - **b)** Guardarla, pero marcada como desglose sin precio, para que no sume. Necesita una columna nueva, es decir, una migración.
   - **c)** Que sí sume al subtotal. Contradice lo que dice el asistente.
   
   Yo haría la a), pero es tu decisión.
2. **Datos existentes.** ¿Los dejamos como están? Son 4 sin partidas, 5 con materiales y el `rejected_at` sobrante de PRE-2026-53806. Todos son de cuentas internas (`subscriptions.is_internal = true`: `c6c7e97a…`, `65aece08…` y `53918141…`). Si quieres limpiarlos, preparo el script como pendiente de aprobar.

## Qué revisar en 10 minutos

1. Abre PRE-2026-53806: la línea de tiempo tiene que decir "Aceptado", como el estado.
2. Abre PRE-2026-18088 y compara "Partidas" con "Subtotal": verás las 9 líneas "Material sugerido" de más. Es el punto 1.
