# 2F-2 / E2 — RPC transaccionales de presupuestos

Fecha: 2026-09-20. Estado: **rama integrada con `main`; pendiente CI y revisión del PR**.
Rama: `codex/budget-revision-rpcs-2f2-e2`, con `origin/main`
`61a0b4452dc6925772d529696287bcd269ce6bc6` (merge del PR #14) integrado por merge,
sin rebase ni reescritura de commits.
Migración nueva: `20260915160000_budget_revision_rpcs.sql`. **No aplicada en producción.**

## Estado real de producción, comprobado por lectura el 2026-09-20

| Migración | Estado |
|---|---|
| `20260914090000` (E1, `lock_version`) | aplicada y registrada |
| `20260915140000` (aislamiento de `portal_tokens`) | aplicada y registrada |
| `20260915150000` (lector del portal) | aplicada y registrada |
| `20260915160000` (**este lote**) | **pendiente, única pendiente** |

Verificado además que en producción el esquema `budget_internal` **no existe** y que
**ninguna** de las seis firmas públicas de E2 está creada, que es la condición que el
preflight exige antes de aplicar. Las dependencias que E2 necesita sí están:
`account_deletion_locks`, `document_versions`, las 10 columnas de `budgets` y las 19 de
`budget_items` que usa el INSERT.

E2 no modifica ni reaplica E1, `140000` ni `150000`: el merge las trae desde `main`
byte a byte, y el banco comprueba que aplicar E2 no altera ACL ni RLS de las tablas
existentes.

### Encaje con el contrato ya desplegado

- La firma `public.portal_respond_to_budget(text,uuid,text,text)` coincide **exactamente**
  con la que `150000` sondea por `to_regprocedure`, así que el portal habilita la respuesta
  a presupuestos en cuanto E2 se aplique, sin desplegar aplicación.
- `140000` exige que toda fila de `portal_tokens` tenga `created_by` y que ese usuario sea
  el dueño del proyecto. E2 solo **lee** esa tabla, nunca la escribe, así que se apoya en
  esa invariante sin poder romperla. El banco de E2 aplica ahora `140000` para que el
  fixture refleje ese contrato, y comprueba que un token forjado no puede ni existir.
- E2 no ofrece ninguna vía para enlaces heredados: exige fila en `portal_tokens` con
  `approve_budgets`, coincidencia exacta de `project_id`, estado `enviado`/`sent` y versión
  documental finalizada.

## Alcance y contrato que debe revisarse antes de E4

Se añaden seis funciones públicas SECURITY DEFINER, con search_path vacío,
y ocho auxiliares SECURITY INVOKER en un esquema privado sin acceso a los clientes.
La migración no cambia tablas, políticas RLS, fórmulas, default/vocabulario de status,
ni las funciones legadas. No modifica ni conecta ningún escritor de la aplicación.

| RPC | Entrada | Resultado |
|---|---|---|
| create_budget_with_items | p_budget_data jsonb, p_items jsonb | Nueva cabecera y partidas; borrador; lock_version=1 |
| save_budget | p_budget_id uuid, p_expected_lock_version integer, p_budget_data jsonb, p_items jsonb | Cabecera y partidas juntas; revisión +1 |
| finalize_budget | Mismos argumentos que save_budget | Guardado, estado pendiente y versión documental en una transacción |
| change_budget_status | p_budget_id uuid, p_expected_lock_version integer, p_status text | Transición permitida, revisión +1; conserva versión documental |
| duplicate_budget | p_budget_id uuid | Copia con IDs nuevos, borrador, revisión/versión 1, costes conservados |
| portal_respond_to_budget | p_token text, p_budget_id uuid, p_decision text, p_accepted_by_name text | Respuesta sobre un presupuesto concreto, comprobando token/proyecto/propietario |

Todas devuelven budget_id, lock_version, version, status, previous_status e items_count.
Las cinco primeras sólo admiten authenticated; portal admite anon y authenticated.
PUBLIC/service_role no reciben EXECUTE; los auxiliares tampoco se exponen.

La firma del portal incluye **p_budget_id explícito** porque un proyecto puede tener
varios presupuestos. Exige la capacidad **approve_budgets**: un token read no obtiene
permisos de escritura por instalar E2. La futura conexión E4 deberá emitir esa
capacidad expresamente; E2 no modifica tokens existentes. La IP no se acepta como
dato fiable enviado por el cliente.

Cabecera: lista explícita de campos, title obligatorio; budget_number sólo al crear.
Los campos de servidor no son escribibles. Las claves ausentes se conservan; null
borra client_id/project_id/valid_until. Tasas fuera de 0..100 y valores no finitos se
rechazan, no se corrigen silenciosamente. Los importes recibidos se transportan sin
recalcularlos. Subtotales omitidos usan el mismo fallback del escritor legado;
ordinalidad del array determina sort_order. No se conserva el ID de una partida
reemplazada. Cada guardado sustituye el conjunto completo, también si es equivalente.

Los clientes y proyectos deben pertenecer al propietario, incluso al duplicar una
asociación histórica. El presupuesto se bloquea y se comprueba propiedad, no borrado
y revisión antes de escribir. Una revisión obsoleta devuelve PT409/HTTP 409.

El bloqueo asesor por propietario comparte clave con lock_account_for_deletion,
y se mantiene durante toda la transacción. Así se coordina con borrado de cuenta,
a costa de serializar también guardados E2 de distintos presupuestos del mismo usuario.
No es una prueba completa del endpoint de borrado: su regresión sigue exigida antes
de retirar escritores/permisos legados.

## Versiones y estados

lock_version técnico no es version documental. Las nuevas funciones de guardado
aceptan borrador/draft y pendiente/pending. Los estados enviados o respondidos requieren
el futuro flujo de revisión contractual; E2 no reabre ni edita contratos aceptados.
La primera finalización genera MAX(document_versions.version)+1, empezando por 1,
bajo bloqueo de cabecera. También un guardado de un presupuesto ya pendiente genera
versión documental. Snapshot y partidas proceden de las filas realmente persistidas.

Las transiciones nuevas son pendiente/pending → enviado y enviado/sent →
aceptado/rechazado, con documento finalizado existente. El portal sólo responde a
enviado/sent; repetir respuesta devuelve conflicto. Se conservan los escritores y
estados legados: E2 no es aún la unificación global del vocabulario.

La auditoría documental es transaccional. Los eventos de activity_log/notificaciones
no se añaden en este lote y no deben producirse desde E4 antes del éxito confirmado.

## Evidencia ejecutada localmente

| Verificación | Resultado |
|---|---|
| Seis suites estáticas/regresión (E2, E1, migración anterior, lectores, helper, Provider) | 145 PASS, 0 FAIL, 0 SKIP |
| PostgreSQL: permisos, propiedad, validación, atomicidad, versiones, duplicado, portal, compensación | 19 casos + contenedor PASS |
| PostgreSQL: tres mutantes, cada uno comparado con el SQL correcto | 3 casos + contenedor PASS |
| PostgREST y supabase-js real | 3 casos + contenedor PASS |
| Total integración Node | 28 PASS, 0 FAIL, 0 SKIP |

La prueba de concurrencia usa dos sesiones y observa una espera real de bloqueo antes
de liberar la primera: un guardado confirma, el otro recibe PT409. Las pruebas de
error de FK tras DELETE y de error al insertar documento conservan cabecera, IDs,
partidas y versiones anteriores. Los cuatro vectores económicos congelados conservan
sus textos numeric, incluyendo costes. Los controles negativos detectan eliminar la
comparación de revisión, omitir el incremento y conceder EXECUTE a un auxiliar.

HTTP: se comprueba 409/PT409 y ausencia de mutación; supabase-js resuelve con
data:null/error, sin excepción ni reintento automático (una petición observada).
Una petición posterior con revisión nueva sí funciona. Se usa el cliente instalado
por package-lock, adaptando únicamente el prefijo /rest/v1 al PostgREST local.

Runtime: PostgreSQL 17.6 local en clúster exclusivo marcado, puerto 55435;
PostgREST oficial 12.2.3 local, puerto 53002. Credenciales sintéticas, ningún secreto
del proyecto. El bootstrap recrea public/auth **sólo** tras validar URL localhost
exacta, base dedicada, doble ACK, marcador, versión, superusuario y ausencia de otras
bases de trabajo. El fixture reproduce las columnas/contratos necesarios a partir
del bootstrap y auditorías anteriores; no es un clon completo del esquema productivo.
No se hizo una nueva auditoría de producción en este turno.

El workflow nuevo ejecuta SQL y HTTP secuencialmente en PostgreSQL 17/PostgREST
12.2.3 desechables, sin secretos de Supabase. La evidencia de Actions se debe comprobar
sobre el commit del PR; la prueba local no equivale a ese resultado.

## Despliegue y compensación

Ya no hay que esperar a E1 ni al portal: `20260914090000`, `20260915140000` y
`20260915150000` están aplicadas y registradas, y **E2 es la única migración pendiente**.
El orden ya es el correcto por nombre; E2 debe ir después de `150000`, nunca antes.

Antes de aplicar: CI verde, revisión del contrato, inventario SELECT actualizado
de tablas/columnas/privilegios y funciones, hashes de datos, comparación del historial
y dry-run que muestre sólo E2. Comprobar que budget_internal y las seis firmas no
existan; su existencia obliga a detenerse, no a sobrescribirlas.
Producción requiere autorización independiente. No se hace merge automático.

CHECK_E2_SCHEMA en CHECKS.sql inventaría funciones, firmas y ACL. La compensación
ROLLBACK_2F2_E2 exige el reconocimiento before_revision_clients y sólo elimina estas
funciones/esquema, sin CASCADE. Se probó su rechazo sin reconocimiento y conservación
de datos, E1 y escritor anterior. No repara historial remoto. Tras publicar clientes
de revisión, corregir hacia delante; este bloque no es una reversión general.

**E2 no protege aún los guardados legados frente a sobrescrituras.** La protección
completa depende de E3 (carga/autoguardado), E4 (conectar todos los escritores y gestionar
conflictos), observación/compatibilidad y cierre transaccional de accesos antiguos.
E3 y sus pruebas pueden prepararse en paralelo a la revisión de este lote; la conexión
E4 depende de ambos contratos. No se declara completada la fase 2 ni las fases del
producto posteriores.
