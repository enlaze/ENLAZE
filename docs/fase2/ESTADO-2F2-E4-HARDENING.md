# 2F-2 / E4 — endurecimiento previo al despliegue de L1

Fecha: 2026-09-24. Estado: **rama lista para revisión; nada aplicado**.
Rama: `codex/portal-token-hardening-e4`, desde `origin/main` `42c7c07`.
Migración nueva: `20260924120000_portal_token_listing.sql`, **no aplicada**.
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
| Sentry: `request.url`, breadcrumbs de navegación, nombre de transacción, logs, y Session Replay grabando la barra de direcciones | hooks de saneado en los tres `init` + Replay apagado |

### Piezas

- **`lib/portal-path-redaction.ts`** — única definición del enmascarado.
  `redactPortalPath` reescribe todo `/portal/<algo>` a `/portal/[token]`, ya sea
  un path, una URL absoluta con query o una URL incrustada en el texto de un
  error. `redactPortalDeep` recorre estructuras enteras, **claves incluidas**, en
  vez de enumerar los campos donde hoy aparece la URL: esa lista se queda corta
  con cada versión del SDK.
- **`lib/sentry-portal-scrubbing.ts`** — `beforeSend`, `beforeSendTransaction`,
  `beforeBreadcrumb` y `beforeSendLog`, compartidos por
  `instrumentation-client.ts`, `sentry.server.config.ts` y
  `sentry.edge.config.ts`, para que endurecer uno no deje los otros dos
  abiertos. Si el saneado fallara, **el evento se descarta**; no sale sin
  redactar.
- **Replay.** Su grabación no pasa por `beforeSend`: no hay hook que la redacte,
  solo se puede no grabar. En el cliente la integración ni se carga si el bundle
  arranca en el portal, y las dos tasas de muestreo van a 0. Para quien llegue
  navegando dentro de la app —donde esa decisión ya se tomó con la ruta
  anterior— `lib/replay-portal-guard.ts` la **para** al entrar. Se usa `stop()`,
  no `flush()`: vaciar el búfer sería enviarlo.
- **`onRouterTransitionStart`** redacta el href en el origen, así que el span de
  navegación nace ya como `/portal/[token]`.

### Regresión que destapó la prueba

Al desactivar `capture_pageview` se perdía el **primer** pageview de cada carga:
el efecto de `AnalyticsProvider` corría antes de que `initAnalytics` —asíncrona,
importa `posthog-js` dinámicamente— hubiera terminado, y `trackEvent` volvía sin
hacer nada. Antes lo tapaba la captura automática de PostHog. Ahora el efecto
espera a `initAnalytics()`, que es idempotente.

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
| `portal-token-listing.integration` | **10/10**, nueva |
| `portal-telemetry-redaction` | **11/11**, nueva, estática |
| `portal-telemetry-isolation.browser` | **PASS**, nueva, Chromium real |

Las tres suites SQL comparten una sola base y cada una reconstruye el esquema,
así que **no pueden correr en paralelo**: CI las lanza en pasos separados y en
local hay que pasar `--test-concurrency=1` si se ejecutan juntas (así dan 42/42).

La prueba de navegador monta el `AnalyticsProvider` real con un secreto centinela
en la ruta y comprueba que no aparece en eventos de PostHog, eventos de Sentry,
consola, errores de página, `localStorage`, `sessionStorage` ni cookies, y que
nada intenta salir del loopback. Lleva dos controles positivos —fuera del portal
la telemetría sigue emitiendo, y `sanitize_properties` limpia una propiedad
sucia— para que no pueda pasar por tenerlo todo apagado.

### Mutantes

| Mutante | Prueba que lo mata |
|---|---|
| `isPortalPath` deja de reconocer el portal | no se carga el SDK de PostHog |
| se quitan los hooks de saneado de Sentry | el centinela no sale en Sentry |
| no se para Session Replay al entrar | Replay se para al entrar |
| `status` devolviera el secreto | control negativo del listado |

Además se comprobaron a mano contra el banco desechable: el precheck da `OK`
antes de desplegar con la línea base de 8 heredados, aborta tras aplicar E4
(`objetos_e4 = 16`), y cada una de las ocho condiciones enciende su columna. El
rollback nuevo falla sin reconocimiento, falla si el `SELECT` directo ya se
retiró, y completa dejando los 13 objetos de E4-L1 y todas las filas intactas.

---

## Orden de despliegue recomendado

1. **`CHECK_E4_L1_PRECHECK`** contra producción. `veredicto` = `OK`, o parar.
2. Aplicar **`20260923120000_portal_token_lifecycle.sql`** (E4-L1).
3. `CHECK_E4_L1_SCHEMA`, `CHECK_E4_L1_GRANTS`, `CHECK_E4_L1_EXPIRY`,
   `CHECK_E4_L1_VALUES`. Inventario: **13 funciones, 6 públicas y 7 internas**.
4. Aplicar **`20260924120000_portal_token_listing.sql`**. Inventario: **15**.
5. Desplegar **esta rama de aplicación** (telemetría + proyección explícita).
   Los pasos 4 y 5 son independientes entre sí; ninguno rompe al otro si va
   primero, porque nada de la interfaz actual llama todavía a la RPC nueva.
6. **Lote 2, en un único despliegue atómico**: interfaz que usa
   `portal_list_tokens` + `portal_issue_token`, y en la misma migración
   `revoke select on public.portal_tokens from authenticated`. Solo a partir de
   aquí puede decirse que el secreto se enseña una vez.

El paso 5 puede ir antes del 2 sin problema: la redacción de telemetría y la
proyección explícita no dependen de ningún objeto de base de datos nuevo.

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
- **Session Replay puede grabar unos instantes** si alguien llega al portal
  navegando dentro de la app: `stopReplayOnPortal()` corre en un efecto, después
  del primer render. La ventana es de milisegundos y no incluye envío, porque
  `stop()` descarta el búfer, pero no es cero.
- **El rollback del listado deja ciega la pantalla** si se ejecuta después del
  lote 2. Su guarda lo detecta y se niega.
