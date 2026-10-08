# Recibidas: editar, papelera, filtro por cliente y contenido legal

Continúa `unificacion-recibidas.md`. Esa rama dejó una sola pantalla de facturas
recibidas —el panel de Facturación— y retiró la de obras a un redirect. Lo que
faltaba en ese panel era poder corregir, poder eliminar y poder clasificar por
cliente. Y, de paso, guardar los datos que una factura necesita para que su IVA
sea deducible.

Base: `codex/unify-received-invoices-on-main` en `5f86e3d`.

## Qué cambia

**Editar.** Cada fila abre la factura en el mismo formulario del alta. Hasta
ahora esa escritura solo se alcanzaba por el reintento de conservación del
documento del OCR, y cliente, obra y categoría se guardaban en un `UPDATE`
aparte que podía fallar por su cuenta y dejar la factura a medio corregir. Ahora
todo el contenido va en `update_received_invoice_and_reconcile`, bajo el mismo
bloqueo de fila, con cliente y obra comprobados como ya se comprobaba el
proveedor. `document_url` no viaja desde el navegador: el documento conservado
solo lo escribe el servidor. Una factura en la papelera no se edita; se restaura
primero.

**Eliminar.** Va a la papelera, con confirmación, por `move_to_trash`, que ya
aceptaba `received_invoice` desde `20260729_recoverable_trash.sql`. No hace falta
reconciliar importes: los totales por proveedor se suman al leer y la política
restrictiva `received_invoices_hide_trashed` deja fuera lo que está en la
papelera. `/dashboard/trash` ya sabía listarlas y restaurarlas; el panel lleva
ahora su enlace.

**Clasificar.** Filtro y columna de cliente, junto a los de estado, obra,
categoría y periodo —anual, trimestral o mensual— que ya existían. Elegido un
cliente, el desplegable de obras se queda con las suyas: antes se podía combinar
cliente con obra ajena y la lista salía vacía sin explicar por qué.

**Contenido obligatorio de la factura.** Se guardan serie, fecha de la operación
cuando difiere de la de expedición, domicilio fiscal del expedidor, descripción
de la operación y el desglose por tipos de IVA. Es el contenido que exige el
art. 6 del RD 1619/2012, recogido en el capítulo de obligaciones formales del
manual de IVA de la AEAT. Sin esos datos el IVA soportado no es deducible.

Nada pasa a ser obligatorio en la base: las facturas ya registradas siguen
siendo válidas, y lo que les falte se avisa —en el formulario mientras se
teclea, en la lista, en la ficha y en una columna del CSV— en lugar de
rechazarse. El arreglo real es pedirle al proveedor una factura correcta.

### Alcance que se dejó fuera

Se acordó cubrir lo necesario para deducir el IVA. **No** se han añadido los
tipos de factura (simplificada, rectificativa con su referencia y motivo) ni las
menciones especiales: inversión del sujeto pasivo, exención intracomunitaria,
REBU, agencias de viajes y criterio de caja. Si en algún momento se registran
facturas de esos casos, habrá que ampliar el formulario y los avisos.

## Desglose por tipos de IVA

Solo se guarda cuando la factura trae más de un tipo. Con un tipo único mandan
`iva_percent` e `iva_amount` como siempre, `vat_breakdown` queda a null y
ninguna lectura existente cambia de comportamiento.

Con desglose, `iva_percent` pasa a null —no hay un tipo único que anotar— y un
CHECK obliga a que las bases y las cuotas del desglose cuadren con `subtotal` e
`iva_amount`, que es lo que suman Contabilidad y el informe fiscal. Cada cuota
se redondea a céntimos antes de sumar, al igual que el CHECK, o la fila se
rechaza. El PDF fiscal no imprime el tipo por factura, así que ese null no le
afecta; la ficha de la factura sí lista los tipos con su base y su cuota.

## Verificación

- Migración aplicada y reaplicada en un PostgreSQL 17 desechable y local, con
  un esquema que reproduce el de producción tras la unificación. El CHECK
  rechaza desgloses mal formados, con tipos imposibles y descuadrados respecto
  a la base o la cuota. El RPC rechaza cliente u obra ajenos, obra en la
  papelera, factura en la papelera, usuario distinto del dueño y sesión
  ausente, cada uno con su código de error, y los intentos rechazados no dejan
  rastro en la factura.
- `tsc --noEmit`: sin errores.
- `eslint` sobre los ficheros tocados: sin avisos. La deuda de lint del
  repositorio sigue donde estaba.
- `next build --webpack` con credenciales ficticias: compila, valida TypeScript
  y genera las 134 páginas. `npm run build` sigue deteniéndose en `plans:check`
  por falta de credenciales reales.
- Pruebas: 50 correctas y 1 omitida (la de SQL, que exige su clúster) en las
  suites de recibidas, incluidas 21 nuevas. `p1-review` pasa de 41 a 43
  correctas: las dos pruebas del reintento del OCR leían la pantalla retirada y
  ahora apuntan al hook que heredó esa lógica, sin cambiar lo que afirman.
  Quedan 16 fallos heredados, ajenos a este trabajo.
- La dependencia `stripe` no estaba instalada en el equipo. Se instaló solo
  dentro del worktree para poder compilar; `npm ci` en el checkout principal lo
  resuelve de verdad.

## Pendiente antes de desplegar

Lo de `unificacion-recibidas.md` sigue vigente y ahora son dos migraciones, en
este orden:

1. `20261009120000_unify_received_invoices.sql`
2. `20261010120000_received_invoice_legal_fields.sql`

Primero las migraciones, después el código. La segunda **suelta y recrea**
`update_received_invoice_and_reconcile` con más parámetros: entre aplicarla y
desplegar el código, el panel anterior no puede corregir facturas, porque llama
a la firma antigua. Es una ventana corta, pero conviene no dejarla abierta.

Sin validar con datos reales: que las 9 facturas aparezcan con su cliente, que
el filtro por trimestre y el CSV cuadren con Contabilidad y el PDF, y que
editar y mandar a la papelera se comporten en el navegador. Branching sigue
pidiendo plan superior en `dsgnymebkxxkslyeotee`, así que hace falta otro
entorno de pruebas o un volcado de producción a un Postgres local.
