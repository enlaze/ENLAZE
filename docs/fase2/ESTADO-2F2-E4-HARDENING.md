# 2F-2 / E4 — endurecimiento previo al despliegue de L1

Fecha: 2026-09-24 (revisión 2, tras el NO-GO de Codex sobre `f4820ab`).
Estado: **rama lista para revisión; nada aplicado**.
Rama: `codex/portal-token-hardening-e4`, desde `origin/main` `42c7c07`.
Migración nueva: `20260925090000_portal_token_listing.sql`, **no aplicada**.
`20260923120000_portal_token_lifecycle.sql` **no se toca**: ya está fusionada.

Cuatro hallazgos sobre el lote E4-L1 antes de desplegarlo. Tres se cierran aquí;
el primero se cierra **a medias a propósito**, y conviene leer por qué.

---

## 1 · El secreto se puede ver más de una vez

### Lo que pasa hoy

`20260915140000` retiró `INSERT`/`UPDATE`/`DELETE` sobre `portal_tokens`, pero
**no el `SELECT`**. Con RLS, el dueño de un proyecto puede leer sus propias filas
enteras, columna `token` incluida. Y la pantalla lo hace:
`.from("portal_tokens").select("token")` en cada clic de «Compartir con cliente».

E4-L1 fue diseñado como si el secreto se entregara una sola vez, al emitir o
rotar. **Eso no es cierto todavía.** Mientras el `SELECT` directo siga concedido,
el secreto es releíble tantas veces como se quiera.

### Lo que se hace

`public.portal_list_tokens(p_project_id uuid)`, en la migración nueva. Valida
propiedad igual que el resto del lote —mismo `42501 Portal link is not available`
para un proyecto ajeno, inexistente o borrado— y devuelve un array ordenado del
más reciente al más antiguo con **solo metadatos**:

| Campo | |
|---|---|
| `id`, `project_id`, `permissions`, `label` | identificación y alcance |
| `created_at`, `expires_at`, `is_active`, `revoked_at` | estado |
| `is_live` | `is_active ∧ ¬revocado ∧ expires_at > now()`, la misma definición que usa el tope de cinco |

`token` **no está**, y no puede estarlo: la forma del metadato es
`portal_token_internal.status`, exactamente la misma que ya devuelven revocar y
la parte `revoked` de rotar. Hay una sola definición de «metadato» en el lote, no
dos que puedan separarse con el tiempo.

**Pagina de verdad.** La primera versión agregaba el historial entero. El tope de
cinco solo cuenta enlaces **vigentes**, así que rotar y revocar acumula filas sin
límite: un proyecto de años puede tener cientos, y esa es justo la respuesta que
la interfaz del lote 2 pedirá en cada carga. Mejor fijar el contrato ahora que
romperlo después.

```
portal_list_tokens(p_project_id, p_limit default 20,
                   p_cursor_created_at default null, p_cursor_id default null)
  → { items: [...], next_cursor: {created_at, id} | null }
```

Cursor por `(created_at, id)` y no `OFFSET`: con `OFFSET`, emitir o revocar entre
dos páginas desplaza las filas y el usuario ve repetidos o se salta alguno. El
desempate por `id` hace falta porque `created_at` empata en cuanto se emiten dos
enlaces en la misma transacción. `p_limit` se valida entre 1 y 100 (`22023`), y
pasar media pareja de cursor también se rechaza: daría una página distinta de la
que el llamante cree pedir. `next_cursor` solo se emite si la página salió llena.

A diferencia de `owned_project`, el auxiliar `visible_project` **no bloquea** la
fila del proyecto: abrir una ficha no debe serializar las emisiones de ese
proyecto. Hay una prueba que lo comprueba con dos sesiones.

### Lo que NO se hace, y por qué

**No se retira el `SELECT` directo de `authenticated`.** Retirarlo aquí dejaría
ciega la pantalla actual, que todavía no usa la RPC nueva. La retirada tiene que
ir en el **mismo despliegue** que la interfaz del lote 2, de forma atómica.

Consecuencia que hay que decir en voz alta: **hasta ese despliegue no puede
afirmarse que el secreto se muestre una sola vez.** Cualquier documento o
mensaje que lo diga antes está equivocado. Hay una prueba que falla a propósito
el día que el privilegio se retire, para que nadie olvide actualizar esto.

---

## 2 · Filtración de la URL portadora por telemetría

`/portal/<secreto>` es una URL portadora. Salía por cuatro caminos:

| Camino | Qué lo arregla |
|---|---|
| `capture_pageview: true` de PostHog captura `window.location.href` **dentro del propio `init`**, antes de que nada pueda sanearlo | `capture_pageview: false` |
| `analytics.pageViewed(pathname)` mandaba la ruta cruda como `$current_url` | se redacta en el emisor |
| PostHog **persiste** `$initial_current_url` en `localStorage` y cookie | en el portal no se inicializa PostHog en absoluto |
| Sentry: `request.url`, breadcrumbs de navegación, nombre de transacción, logs | hooks de saneado en los tres `init` |
| Session Replay graba la barra de direcciones, y su grabación no pasa por `beforeSend` | apagado en toda la app mientras el token vaya en la URL |

### Piezas

- **`lib/portal-path-redaction.ts`** — única definición del enmascarado.
  `redactPortalPath` reescribe todo `/portal/<algo>` a `/portal/[token]`, ya sea
  un path, una URL absoluta con query o una URL incrustada en el texto de un
  error. `redactPortalDeep` recorre estructuras enteras, **claves incluidas**, en
  vez de enumerar los campos donde hoy aparece la URL: esa lista se queda corta
  con cada versión del SDK.

  **Fail-closed.** La primera versión devolvía el valor original en cuatro
  situaciones, y en las cuatro el token sobrevivía entero: rama por debajo de la
  profundidad 12, ciclo detectado, instancias de `Error` y de `URL`, y cualquier
  otro objeto no plano. Ahora nada opaco sale intacto:

  | Caso | Qué se emite |
  |---|---|
  | profundidad agotada | `[redacted: max depth]` |
  | ciclo | `[redacted: cycle]` |
  | `Error` | objeto plano con `name`, `message`, `stack`, `cause` y propiedades propias, todo redactado |
  | `URL` | su `href` redactado |
  | instancia de clase | aplanada a sus propiedades enumerables, redactadas |
  | `Map` / `Set` | recorridos, no devueltos opacos |
  | función | `[redacted: unsafe value]` — su código fuente puede llevar la URL |
  | getter que lanza | `[redacted: unsafe value]`, sin mirar la excepción |
- **`lib/sentry-portal-scrubbing.ts`** — `beforeSend`, `beforeSendTransaction`,
  `beforeBreadcrumb` y `beforeSendLog`, compartidos por
  `instrumentation-client.ts`, `sentry.server.config.ts` y
  `sentry.edge.config.ts`, para que endurecer uno no deje los otros dos
  abiertos. Si el saneado fallara, **el evento se descarta**; no sale sin
  redactar.

  El aviso por consola es una **constante sin datos**. Antes imprimía el error
  que había hecho fallar el saneado, y ese error es justamente el que más
  probabilidades tiene de llevar el secreto —algo reventó leyendo la URL—; con
  `enableLogs` activo, esa línea de consola vuelve a Sentry. Mismo arreglo en
  `lib/telemetry-safe.ts`, que tenía el mismo patrón.
- **Replay: apagado en toda la app, no solo en el portal.**
  La primera versión de este lote apagaba Replay en el portal y, para quien
  llegara navegando dentro de la app, lo **paraba** al entrar con `stop()`. Eso
  estaba mal, y de la peor manera. El `stop()` público de `@sentry/replay`
  10.66.0 es, literalmente:

  ```js
  this._replay.stop({ forceFlush: this._replay.recordingMode === "session" })
  ```

  En una sesión muestreada —el 10% con la configuración anterior— `stop()`
  **envía** el búfer. Es decir: pararlo al llegar al portal mandaba precisamente
  la grabación del portal. El guard no solo no protegía, sino que disparaba la
  fuga que pretendía evitar, y únicamente en el caso muestreado, que es el que
  no se ve en una prueba con dobles.

  Mientras el token viaje en la URL, Replay se queda fuera: sin
  `replayIntegration()` y con las dos tasas a 0 en los tres entornos.
  `lib/replay-portal-guard.ts` queda eliminado. Reactivarlo es parte del lote 2,
  cuando el secreto deje de ir en la ruta; hay una prueba que falla si alguien
  lo enciende antes.
- **`onRouterTransitionStart`** redacta el href en el origen, así que el span de
  navegación nace ya como `/portal/[token]`.

### Inicialización única

`initialized` solo se ponía a `true` **después** del import dinámico de
`posthog-js`, así que dos llamadas en el mismo tick pasaban las dos por el
guardián y hacían dos `posthog.init`. Y los dos efectos de `AnalyticsProvider`
llaman a `initAnalytics` en el mismo tick: era el caso normal, no el raro. Ahora
hay una **promesa única** compartida; el early-return del portal no se memoiza,
para que navegar del portal a una pantalla normal siga pudiendo inicializar.

### El pageview conserva host, query y UTM

Al sustituir la captura automática por una manual, el evento pasó a llevar solo
el `pathname`: se perdían host, query y **parámetros UTM**, es decir la
atribución de campañas, sin que nadie se enterase hasta mirar los informes.
Ahora `$current_url` es la URL completa saneada —leída en el momento de emitir,
cuando la barra de direcciones ya refleja la ruta nueva— y se añade `$pathname`
aparte. En el portal no se emite nada, así que la URL completa nunca lleva un
secreto.

### Regresión que destapó la prueba

Al desactivar `capture_pageview` se perdía el **primer** pageview de cada carga:
el efecto corría antes de que `initAnalytics` hubiera terminado y `trackEvent`
volvía sin hacer nada. Antes lo tapaba la captura automática de PostHog. Ahora
el efecto espera a la promesa de inicialización.

---

## 3 · `access_token` heredado descargado al navegador

`app/dashboard/projects/[id]/page.tsx` hacía `projects.select("*")`, que se traía
`access_token` —el secreto del enlace heredado— y lo dejaba en el estado de
React durante toda la sesión, disponible para cualquier volcado de error.

Ahora la proyección es **explícita y sin `access_token`**, y el secreto se pide
**a demanda, en el clic** de «Compartir con cliente», solo si no hay enlace
moderno. La forma de compartir enlaces heredados no cambia; lo que cambia es
cuánto tiempo vive el secreto en memoria.

No se puede eliminar del todo todavía: el botón necesita el secreto para
construir la URL, y el enlace heredado no tiene otra vía. **El cambio atómico del
lote 2** es sustituir ese botón por `portal_list_tokens` + `portal_issue_token`,
de modo que la pantalla deje de leer `portal_tokens.token` y
`projects.access_token`; en ese mismo despliegue se retira el `SELECT` directo.

---

## 4 · El preflight no servía antes del despliegue

`CHECK_E4_L1_VALUES` y `CHECK_E4_L1_EXPIRY` llaman a
`portal_token_permissions_valid()` y `portal_token_max_lifetime()`, **que nacen
dentro de E4-L1**. Ejecutarlos antes falla con «function does not exist»: justo
cuando más falta hacían, no decían nada.

**`CHECK_E4_L1_PRECHECK`** es autónomo: solo tablas y expresiones que ya existen.
Es solo lectura y no selecciona `portal_tokens.token` ni `projects.access_token`
en ningún momento; cuenta filas. Devuelve un `veredicto` y las siete columnas de
evidencia que lo justifican, y aborta ante:

| Condición | Columna |
|---|---|
| tokens modernos inesperados | `tokens_modernos` |
| permisos fuera del vocabulario canónico | `permisos_malos` |
| filas sin `created_by` | `sin_created_by` |
| `created_at` o `expires_at` nulos | `fechas_nulas` |
| caducidad fuera de la ventana de 365 días | `fuera_de_ventana` |
| algún proyecto ya por encima de 5 vigentes | `proyectos_con_exceso` |
| objetos de E4 ya creados (aplicación parcial) | `objetos_e4` |
| enlaces heredados distintos de la línea base de 8 | `enlaces_legacy` |

`CHECK_E4_L1_PRECHECK_GATE` es la misma comprobación en un bloque `DO` que lanza,
para guiones que tengan que parar. Un `DO` no escribe nada: lee y lanza.

### Recuento corregido

E4-L1 crea **7** auxiliares privados, no 6. Tras aplicarlo el inventario debe dar
**13 funciones: 6 públicas y 7 internas**. Tras este lote de endurecimiento son
**15**: `portal_list_tokens` (pública) y `visible_project` (interna).
`ESTADO-2F2-E4-L1.md` y `CHECKS.sql` quedan corregidos.

---

## Pruebas

| Suite | |
|---|---|
| `portal-token-access.integration` | **14/14**, sin tocar |
| `portal-token-lifecycle.integration` | **18/18**, sin tocar |
| `portal-token-listing.integration` | **12/12** (10 + paginación y validación de argumentos) |
| `portal-telemetry-redaction` | **19/19** (11 + fail-closed, Replay y PostHog) |
| `portal-telemetry-isolation.browser` | **PASS** |

Las tres suites SQL comparten una sola base y cada una reconstruye el esquema,
así que **no pueden correr en paralelo**: CI las lanza en pasos separados y en
local hay que pasar `--test-concurrency=1` si se ejecutan juntas (así dan 44/44).

La prueba de navegador monta el `AnalyticsProvider` real con un secreto centinela
en la ruta y comprueba que no aparece en eventos de PostHog, eventos de Sentry,
consola, errores de página, `localStorage`, `sessionStorage` ni cookies, y que
nada intenta salir del loopback. Lleva tres controles positivos —fuera del portal
la telemetría emite, el `$pageview` conserva host/query/UTM, y hay exactamente un
`posthog.init`— para que no pueda pasar por tenerlo todo apagado.

### Lo que la revisión anterior no detectaba

Cinco de los siete hallazgos eran fallos que las pruebas de `f4820ab` dejaban
pasar, y cada uno tiene ahora una prueba que lo caza:

| Fallo | Prueba que ahora lo caza |
|---|---|
| `stop()` envía el búfer en sesión muestreada | Replay no puede activarse en producción |
| token a profundidad >12 | corte por profundidad con marcador |
| ciclo devolviendo el nodo crudo | ciclo con marcador |
| `Error` con token en message/stack/cause | Error aplanado y redactado |
| `URL` del portal | URL aplanada a href redactado |
| objeto opaco intacto | instancia de clase aplanada |
| getter que lanza con token en el mensaje | getter hostil sin mirar la excepción |
| consola imprimiendo el error del saneado | constante sin datos, en los dos módulos |
| dos `posthog.init` concurrentes | exactamente un init |
| pageview sin host/query/UTM | pageview con UTM |
| rollback en orden equivocado | comprobado a mano en el banco |
| listado sin paginar | tope, cursor, orden estable y argumentos inválidos |

Un detalle que solo apareció al probarlo: el bloque de rollback del hardening
nombraba la firma antigua `portal_list_tokens(uuid)`. Con `drop ... if exists`
eso **no borra nada** y solo lo dice en un `NOTICE`, así que la compensación
parecía correcta y dejaba la función viva. Ahora lleva la firma completa.

### Mutantes

| Mutante | Prueba que lo mata |
|---|---|
| `isPortalPath` deja de reconocer el portal | no se carga el SDK de PostHog |
| se quitan los hooks de saneado de Sentry | el centinela no sale en Sentry |
| `status` devolviera el secreto | control negativo del listado |

El mutante «no se para Session Replay» ya no aplica: no hay nada que parar
porque Replay no arranca. Lo sustituye una prueba estática que falla si
`replayIntegration()` o una tasa positiva reaparecen en cualquiera de los tres
`init`, o si vuelve el guard basado en `stop()`.

Comprobado además a mano contra el banco desechable: el precheck da `OK` antes
de desplegar, aborta tras aplicar E4; los cuatro estados del libro de migraciones
dan el veredicto correcto, incluido `RECUPERAR`; y la compensación en orden
inverso deja 0 objetos de E4, 0 filas borradas y las 3 funciones de migraciones
anteriores intactas.

## Procedimiento de despliegue

**Ésta es la única secuencia autorizada para E4.** `ESTADO-2F2-E4-L1.md` ya no
describe ninguna otra: apunta aquí.

### El estado cambió mientras se revisaba este lote

`origin/main` avanzó de `42c7c07` a `928e260` y, comprobado por lectura de
producción el 2026-09-24:

- **`20260923120000` (E4-L1) ya está aplicada.** 6 funciones públicas, 7 internas,
  2 CHECK, 0 enlaces modernos, **8 heredados** — la línea base queda reconfirmada.
- Se aplicaron además cinco migraciones de facturación y seguridad de ese día. La
  última versión registrada es **`20260924150745`**.
- **El listado se renumeró** de `20260924120000` a **`20260925090000`**. Con el
  número original habría quedado por debajo de tres versiones ya registradas, es
  decir fuera de orden — justo el desajuste que el commit `8440857` acababa de
  arreglar en este repositorio.

Así que **queda una sola migración pendiente**, no dos. La secuencia conserva la
misma forma; lo que cambia es el recuento.

**1 · Precheck**

- `CHECK_E4_DEPLOY_PENDING` → `veredicto = OK`. Exige `20260915160000` y
  `20260923120000` registradas, `20260925090000` ausente, y avisa si apareciera
  alguna versión por encima que dejara el listado fuera de orden.
- `CHECK_E4_L1_PRECHECK` → `veredicto = OK` (estado de los datos).

**2 · Dry-run**

`supabase migration list`. La **única** pendiente debe ser `20260925090000`. Esto
no se ve desde SQL: el libro solo conoce lo ya aplicado. Si aparece cualquier
otra, parar: alguien ha añadido trabajo que no se ha revisado aquí.

**3 · Autorización independiente**

El dry-run se enseña a quien autoriza y se obtiene un sí explícito **antes** de
empujar. El push no se lanza a continuación del listado por inercia.

**4 · Un único `supabase db push`**

Sin pausas intermedias: la herramienta no las hace y no se va a fingir que sí.

**5 · Auditoría conjunta**

- `CHECK_E4_DEPLOY_AUDIT` → `veredicto = OK`. No cuenta nombres: compara el
  inventario real contra el esperado fila a fila —esquema, nombre, **identidad de
  argumentos**, `prosecdef` y los cuatro privilegios— con `FULL JOIN`, así que
  detecta igual lo que falta y lo que sobra. Cubre firma cambiada, overload
  inesperado, `SECURITY DEFINER` donde no toca, `EXECUTE` de más para `anon`,
  `public` o `service_role`, auxiliar privado alcanzable y ayudante puro que deja
  de ser ejecutable por `PUBLIC`.
- Si no cuadra, `CHECK_E4_DEPLOY_AUDIT_DETALLE` dice exactamente qué fila falla y
  en qué columna.
- `CHECK_E4_L1_SCHEMA`, `_GRANTS`, `_EXPIRY`, `_VALUES` para el detalle de datos.

Estado esperado al terminar: **15 funciones, 7 públicas y 8 internas**.

**6 · Recuperación hacia delante**

`CHECK_E4_DEPLOY_AUDIT` nombra el estado intermedio:
`RECUPERAR: falta 20260925090000`. **No se arregla con rollback.** Se corrige
hacia delante: arreglar la migración y volver a hacer `db push`, que aplicará
solo la que falta. Mientras tanto el sistema es coherente — E4-L1 funciona entero
y lo único ausente es el listado, que ninguna pantalla usa todavía.

**7 · Despliegue de la aplicación**

Esta rama (telemetría + proyección explícita) no depende de la base de datos:
puede ir antes o después del push, en cualquier orden.

**8 · Lote 2, en un único despliegue atómico**

Interfaz que usa `portal_list_tokens` + `portal_issue_token`, y en la misma
migración `revoke select on public.portal_tokens from authenticated`. Solo a
partir de aquí puede decirse que el secreto se enseña una vez. Es también el
momento de volver a encender Session Replay y `capture_pageleave`.

### Compensación

`docs/fase2/ROLLBACK.sql` lleva los dos bloques de E4 **en orden inverso al
despliegue**: `ROLLBACK_2F2_E4_HARDENING` primero y `ROLLBACK_2F2_E4_L1`
después. Al revés falla, y se comprobó que falla: E4-L1 hace
`drop schema portal_token_internal` sin `CASCADE` —a propósito, para no borrar
de más— y el esquema no está vacío mientras siga dentro `visible_project`.

Ese orden vale **para el par de E4**, no para el archivo entero. La cabecera de
`ROLLBACK.sql` decía que todo se ejecuta de arriba abajo como inverso del
despliegue, y eso no es cierto: los bloques se fueron añadiendo por lotes y el
archivo no está globalmente ordenado así. Ahora dice lo que hay que hacer —
seleccionar expresamente el bloque que toque— y señala E4 como el único par con
orden interno obligatorio.

---

## Riesgos

- **«Copia única» sigue siendo falso** hasta el paso 6. Es el riesgo principal de
  este lote y el motivo de que la prueba
  `el SELECT directo sigue concedido` esté escrita para romperse cuando cambie.
- **La línea base de 8 enlaces heredados no se pudo reconfirmar** en este lote:
  las lecturas contra producción están bloqueadas por el clasificador de
  permisos. Si el precheck devuelve otro número, no es necesariamente un fallo
  —se crean y borran proyectos—, pero hay que explicarlo antes de seguir.
- **`capture_pageview: false` cambia el comportamiento de analytics en toda la
  app**, no solo en el portal. Se compensa con el pageview manual ya existente,
  ahora esperando a la inicialización, y hay control positivo en la prueba de
  navegador. Aun así, conviene mirar el volumen de `$pageview` en PostHog los
  primeros días.
- **No se emite ningún evento de producto desde el portal.** Es deliberado: el
  propio evento delata que un cliente concreto abrió su enlace. Si alguna vez se
  quiere medir el uso del portal, hará falta un evento diseñado para eso, sin
  URL y sin identificador de enlace.
- **Session Replay queda apagado en toda la aplicación**, no solo en el portal.
  Es una pérdida real de observabilidad, y es el precio de que el token viaje en
  la URL. Se recupera en el lote 2. No se intentó conservarlo fuera del portal
  porque hacerlo con garantías exige impedir la grabación **antes** del cambio
  de URL y probarlo contra el SDK real, no contra un doble; eso es un lote en sí
  mismo.
- **El saneado fail-closed puede recortar telemetría legítima**: una rama por
  debajo de doce niveles, un ciclo o una instancia de clase salen ahora como
  marcador. Es deliberado —mejor un evento menos informativo que un secreto
  fuera— pero si aparecen muchos `[redacted: max depth]` en Sentry, habrá que
  mirar qué estructura los provoca en vez de subir el límite sin pensar.
- **La página por defecto son 20 enlaces.** Si la interfaz del lote 2 necesita
  otra cosa, cambiar el valor por defecto es compatible hacia atrás; cambiar la
  forma de `next_cursor` no lo sería.
- **El rollback del listado deja ciega la pantalla** si se ejecuta después del
  lote 2. Su guarda lo detecta y se niega.
