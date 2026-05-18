# Agent observability audit — 2026-05-18

Auditoría del data layer del agente diario tras el brief
`BRIEF_CLAUDE_CODE_AGENT_OBSERVABILITY.md`. Resumen ejecutivo abajo, detalle por
bug a continuación, y un anexo con los archivos tocados y cómo verificar todo.

## TL;DR

| Área | Estado | Detalle |
| --- | --- | --- |
| Inspector `/dashboard/dev/agent-inspector` | ✅ Construido | Server component, gated por `NEXT_PUBLIC_DEV_TOOLS_ENABLED=true`. Llama los mismos endpoints que n8n. |
| Bug A — módulos "no conectados" | ✅ Arreglado | Endpoints summary degradan a `200 { connected:false, status:'decrypt_failed', error_message }` en vez de tirar 401/500. |
| Bug B — alucinaciones de fechas | ✅ Mitigado estructuralmente + `TODO(observability)` | Tras arreglar Bug C, `buildDailySummary` ya no inyecta literales estacionales; se deja TODO documentando la dependencia. |
| Bug C — `SEASONAL_CAMPAIGNS` por mes | ✅ Arreglado | Reescrito a `RETAIL_CALENDAR` con ventana ±14 días por evento (override por evento). Verificado: hoy (18-05-2026) no dispara ningún evento. |
| Bug C — usuarios fantasma | ✅ Visualizado | El inspector lista todos los perfiles con `agent_enabled=true` en un dropdown; no se borra ninguno. |
| `npx tsc --noEmit` | ✅ Limpio | |
| `npm run build` | ✅ Limpio | `/dashboard/dev/agent-inspector` aparece como ruta dinámica `ƒ`. |

## Bug A — el agente cree que los módulos no están conectados

### Causa raíz confirmada
Cadena observada en el flujo `Run User Modules` → endpoint summary:

1. La fila en `agent_connections` tiene `connected=true` y `credentials_ref`
   cifrado con la `OAUTH_ENCRYPTION_KEY` del entorno donde se hizo el OAuth.
2. El entorno actual tiene otra `OAUTH_ENCRYPTION_KEY` (local vs Vercel).
3. `lib/services/google-api.ts::getValidAccessToken` llama a `decryptToken`
   dentro de un `try`, captura el throw y **devuelve `null`**.
4. La summary route veía `accessToken=null` y respondía
   `401 { ok:false, connected:false, error:"Google token missing or expired." }`.
5. En `Run User Modules`, `gmailResp.ok===false` → se aplica `defaultInbox()`
   → `connected: false`.
6. `Build Claude Prompt` pone `modules_state.gmail = 'NO conectado'`.
7. Claude obedece y dice "Gmail no conectado".

### Arreglo aplicado
Quería diferenciar **"OAuth nunca se conectó"** de **"OAuth está conectado pero
el token guardado no se puede descifrar aquí"**. Lo conseguí con tres cambios:

1. `lib/crypto.ts`: nueva `safeDecryptToken()` que devuelve un union
   `{ ok:true, plaintext } | { ok:false, reason, error }`. La `decryptToken`
   original sigue intacta para no romper a `lib/services/google-api.ts::encryptToken`
   ni a callers existentes.
2. `lib/services/google-api.ts`: nueva `getAccessTokenInfo()` que devuelve
   `{ token, status, error_message, email }` con `status` de tipo
   `'active' | 'not_connected' | 'no_credentials' | 'decrypt_failed' |
   'no_refresh_token' | 'refresh_failed' | 'config_error'`. La función original
   `getValidAccessToken` queda como wrapper que solo devuelve el token (las
   action routes — create-event, append-row, etc. — no han cambiado).
3. Las cuatro summary routes (`gmail`, `calendar`, `sheets`, `reputation`)
   ahora:
   - Usan `getAccessTokenInfo` y, si `status !== 'active'`, devuelven
     **HTTP 200** con `{ connected:false, status, error_message, ...estructuras vacías }`.
   - En `gmail/summary` se hace además `syncModuleState` para que la fila de
     `agent_connections` quede reflejando el estado real (`status='decrypt_failed'`)
     mientras `connected` en BD se mantiene true (porque el OAuth sí existe, solo
     no se puede usar desde este entorno). Esto da una alerta de coherencia
     limpia en el inspector.
   - `reputation/summary` pasa de `verifyAgentRequest` a
     `verifyAgentOrBrowserRequest` para que el inspector pueda llamarla con
     sesión de browser (los otros tres ya lo usaban).

### Cómo verificarlo
- Abrir `/dashboard/dev/agent-inspector` como `idkdu37@gmail.com`.
- En "Estado de módulos", cada fila muestra dos líneas: **DB** (qué dice
  `agent_connections`) y **Endpoint live** (qué responde la summary route).
- Si la clave no coincide, la fila aparece en rojo con
  `status=decrypt_failed` y el `error_message` legible; y arriba aparece la
  **Alerta de coherencia** correspondiente.
- Cuando la clave sí coincide, los módulos aparecen verdes `status=active`.

## Bug B — alucinaciones de fechas en el briefing

### Diagnóstico
Antes del refactor, `Run User Modules` añadía:

- `buildCampaigns` → `campaigns.push({ title: 'Día de la Madre', ... })` cuando
  `MONTH === 4`, todo el mes.
- `buildBusinessRecommendations` → `recs.push({ title: 'Día de la Madre: máximo gasto medio', ... })` también todo mayo.

Esas estructuras se inyectaban en `ctx.recommendations` y en `ctx.marketing.campaigns`,
y de ahí pasaban tal cual al prompt de Claude — el modelo veía "Día de la Madre"
en su contexto factual aunque el calendario retail dijese lo contrario.
El JSON del prompt era internamente contradictorio (calendar vacío, campañas con
Mother's Day) y Claude elegía el dato más vistoso.

`buildDailySummary` por sí mismo no introduce literales de evento (sólo cuenta
campañas/tareas y devuelve la lista de "📣 N campaña(s) sugerida(s)"). Pero
**reescupía** indirectamente lo que `buildCampaigns` le entregaba, y como esas
campañas iban en el payload completo, Claude las leía.

### Acción
- Bug C (abajo) resuelve la causa: con el calendario `RETAIL_CALENDAR` ningún
  builder mete "Día de la Madre" salvo dentro de la ventana. Por construcción,
  `mechanical_summary` deja de contener literales fuera de fecha.
- En `buildDailySummary` se añade un `TODO(observability)` recordando la
  dependencia implícita y avisando para futuros mantenedores. Per brief, no
  se aplica más cambio sin confirmar.

## Bug C — `SEASONAL_CAMPAIGNS` hardcodeadas por mes

### Causa raíz
Dos mapas `{0..11: {...}}` keyed por mes:
- `seasonalTips[MONTH]` en `buildBusinessRecommendations`
- `seasonal[MONTH]` en `buildCampaigns`

Daba igual el día — durante todo mayo se disparaba "Día de la Madre", durante
todo marzo "Día del Padre", durante todo septiembre "Vuelta al cole".

### Arreglo aplicado (en `Run User Modules` del workflow)
- Añadida función `buildSpanishRetailCalendar(today, windowDays=14)` al inicio
  del nodo. Genera la lista de eventos del año (con cálculo dinámico del
  primer domingo de mayo para Día de la Madre, etc.) y los clasifica en
  `upcoming` / `recently_passed` según una ventana configurable por evento.
- Ventanas por evento:
  - **Default**: ±14 días.
  - `rebajas_enero`, `rebajas_verano`, `navidad`: 21 días (campañas largas).
  - `black_friday`: 10 días.
  - `vuelta_cole`: 14 días con ancla en 1-sept (cubre ~25 ago → 15 sep,
    aprox. lo que pide el brief).
- Constante global `RETAIL_CALENDAR = buildSpanishRetailCalendar(TODAY)`.
- Los dos mapas estacionales ahora están **keyed por `key` estable**
  (`dia_madre`, `dia_padre`, `vuelta_cole`, etc.) y se itera sobre
  `RETAIL_CALENDAR.upcoming`, mirando cada `key`. Si no está en upcoming,
  no se emite recomendación ni campaña.
- `buildCampaigns` calcula `suggested_date` como `TODAY + min(in_days - 5, 5)`
  con piso en 0, para que la campaña se lance ~5 días antes del evento real,
  no "hoy" siempre.
- Cada item estacional emitido incluye `seasonal_event: { key, name, date, in_days }`
  para trazabilidad.

### Verificación para hoy (2026-05-18)
Sanity check ejecutado en Node sobre la lógica: para `TODAY=2026-05-18`,
ninguno de los 20 eventos cae en ventana. Día de la Madre 2026 fue el 3-mayo
(15 días atrás, fuera de la ventana de 14). Por tanto:
- `RETAIL_CALENDAR.upcoming = []`
- `seasonalTipsByKey[...]` no añade nada
- `seasonalByKey[...]` no añade nada
- `daily_summary.priority_actions` no menciona ningún evento estacional
- `ctx.upcoming_retail_events = []` (lo mismo en `Build Claude Prompt`)

### Sincronización entre nodos
`Build Claude Prompt` ya tenía su propia `buildSpanishCalendarContext()` con la
misma forma, así que dejé el comentario:

> Keep in sync with buildSpanishCalendarContext() inside "Build Claude Prompt"
> (same node uses a copy because n8n Function nodes can't share modules).

No es perfecto (n8n no soporta imports), pero el TS `lib/agent/build-context.ts`
sí centraliza el cálculo para la app y queda como referencia canónica.

## Bug C — usuarios fantasma

- El inspector lista en el dropdown todos los `profiles` con `agent_enabled=true`,
  marcando con "(yo)" la fila del usuario logeado. No se borra ningún perfil.
- Cambiar de usuario es un `GET ?user_id=...`. El SERVICE_ROLE_KEY se usa
  server-side para leer estado cross-user, pero las summary routes se llaman
  con el `user_id` seleccionado igual que haría n8n.

## Inspector — qué muestra exactamente

1. **Identidad** — `user_id`, email, business_name, type/sector, `agent_enabled`,
   `agent_status`, `agent_modules_enabled`.
2. **Estado de módulos** — por cada uno de gmail/calendar/sheets/reputation:
   - lo que dice la fila de `agent_connections` (connected, status, last_sync)
   - lo que dice la summary route ahora (connected, status, HTTP code, error_message)
3. **Calendario retail** — `upcoming` y `recently_passed` calculados con la
   misma función que ahora consume el workflow.
4. **`ctx` que iría a Claude** — JSON pretty-printed con identidad, estado de
   módulos, ventana retail, y las payloads crudas de los 4 endpoints.
5. **Últimos 5 briefings** — `execution_date`, score, modelo (si está),
   headline, y `raw_payload` expandible.
6. **Respuestas crudas de `/api/agent/*/summary`** — para debugging directo.
7. **Alertas de coherencia** en rojo arriba, dos tipos:
   - DB dice `connected=true` pero endpoint dice `connected=false`
     (típicamente `decrypt_failed`).
   - Último briefing menciona "sin conectar" / "no conectado" pero los endpoints
     ahora responden conectado — pista para investigar timing.

## Archivos tocados

```
NEW   app/dashboard/dev/agent-inspector/page.tsx
NEW   lib/agent/build-context.ts
EDIT  lib/crypto.ts                                — añade safeDecryptToken
EDIT  lib/services/google-api.ts                   — añade getAccessTokenInfo
EDIT  app/api/agent/gmail/summary/route.ts          — degradación graceful
EDIT  app/api/agent/calendar/summary/route.ts       — degradación graceful
EDIT  app/api/agent/sheets/summary/route.ts         — degradación graceful
EDIT  app/api/agent/reputation/summary/route.ts     — switch a verifyAgentOrBrowserRequest
EDIT  n8n-workflow-comercio-local-v6.3.json
        - Run User Modules: añade buildSpanishRetailCalendar + RETAIL_CALENDAR;
          reescribe seasonalTips / seasonal a lookup por key estable;
          TODO(observability) en buildDailySummary.
NEW   AGENT_AUDIT.md                                — este documento
```

`Build Claude Prompt` no se ha tocado: ya tenía la lógica de calendario
correcta. Se anota la duplicidad con `Run User Modules` para mantenerlos
sincronizados a mano (limitación de n8n).

## Verificación local

```bash
npx tsc --noEmit -p tsconfig.json   # ✅ limpio
npm run build                       # ✅ limpio
NEXT_PUBLIC_DEV_TOOLS_ENABLED=true npm run dev
# Abrir http://localhost:3000/dashboard/dev/agent-inspector tras login
```

Para reproducir el escenario "Bug A" en local: levantar la app con una
`OAUTH_ENCRYPTION_KEY` distinta de la que se usó para conectar OAuth, abrir el
inspector y comprobar que aparece la alerta de coherencia + el módulo en rojo
con `status=decrypt_failed` (sin 500, sin throw).

## Pendientes razonables (no aplicados — esperan confirmación)

1. **Re-encrypt sweep**: si quieres alinear local con prod, un script
   admin que pase por cada `agent_connections` y re-encripte con la clave de
   destino. Requiere acceso a ambas claves a la vez; mejor decisión humana.
2. **Persistir `ctx` enviado a Claude**: hoy `agent_daily_summary.raw_payload`
   guarda lo que devolvió el `Build Claude Prompt`, pero no necesariamente el
   string final que recibió Claude. Sería trivial añadir
   `_ai_briefing_request` al payload guardado para inspecciones forenses.
3. **Snapshot/diff entre dos ejecuciones**: el brief lo menciona como objetivo
   (#3) pero hoy el inspector sólo lista las últimas 5. Cuando haya
   contexto guardado (punto 2), un diff lado a lado es la pieza que falta.
4. **Mover `buildSpanishRetailCalendar` a `Fetch Shared Sources`** para evitar
   la duplicación entre `Run User Modules` y `Build Claude Prompt`. Es viable
   pero implica reordenar dependencias del workflow; lo dejo señalado.
