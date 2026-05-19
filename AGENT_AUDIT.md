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

## Profundización Bloque 1 — 2026-05-19

Los módulos pasaban de OAuth a "etiqueta CONECTADO" sin alimentar de verdad el
prompt. Ahora cada endpoint `/api/agent/{gmail,calendar,sheets}/summary`
devuelve un payload heurístico enriquecido y Claude tiene reglas explícitas
para citarlo por nombre, hora y cifra.

### Endpoints — qué devuelven ahora

**`/api/agent/gmail/summary`** — `total_unread`, `threads_awaiting_reply[]`
(con `from_name`, `from_email`, `subject`, `snippet` ≤200 chars,
`hours_waiting`, `is_recurring_contact`, `category`, `priority_signal`),
`top_senders_30d[]`, `threads_count_by_category` (customer/supplier/lead/
internal/spam/unknown), `invoices_detected[]`, `meeting_requests[]`,
`emails_processed`, `fetched_range_days`.

**`/api/agent/calendar/summary`** — `today` y `tomorrow` con `events[]`,
`total_busy_hours`, `free_blocks[]` (≥1h) e `is_packed` (>6h ocupado);
`this_week` con `total_events`, `busiest_day`, `quietest_day`;
`upcoming_important[]`; `recurring_patterns[]`. Cubre todos los calendarios
visibles (selected & no hidden), no sólo `primary`.

**`/api/agent/sheets/summary`** — `active_sheet.column_schema_detected[]`
con `role` (date/product/quantity/price/revenue/unknown), `sales_summary`
(today/yesterday/this_week con `vs_last_week_pct`/this_month con
`vs_last_month_pct`), `top_products_7d[]` con trend y `vs_previous_pct`,
`alerts[]`, `rows_analyzed`, `detection_confidence`. Si el schema no se
detecta con seguridad, `detection_confidence='low'` y las cifras quedan en
`null` — **nunca se inventa**.

### Heurísticas implementadas

Gmail (`lib/agent/intelligence/gmail.ts`):
- Ventana: últimos 7 días o 50 mensajes, hasta 30 con detalle (`format=metadata`).
- Categoría: dominio del remitente (`makro.es`, `amazon.es`, etc.) → `supplier`;
  regex sobre subject+snippet para `cliente|pedido` → `customer`; `factura|invoice|albarán|pago` → `supplier`;
  `no-reply|notification` → `internal`; `promo|newsletter|unsubscribe` → `spam`.
- `is_recurring_contact`: ≥2 emails con esa dirección en los 90 días vistos.
- `priority_signal`: `urgente|asap|hoy` → `urgent`; cliente recurrente sin respuesta >24h → `high`;
  proveedor sin respuesta >48h → `high`; spam → `low`; default `normal`.
- `invoices_detected`: regex `factura|invoice|albarán|pago` + adjunto, extrae
  importe con `/€|EUR/` y fecha con regex `dd/mm/yyyy` cuando se puede.
- `meeting_requests`: regex `reunión|meeting|cita|videollamada|llamada` y
  saca fechas con la misma heurística.
- Threads ordenados por prioridad y horas de espera; spam excluido salvo
  marcado como urgent.

Calendar (`lib/agent/intelligence/calendar.ts`):
- Recoge `calendarList` → filtra `selected && !hidden` (con fallback a
  `primary` si no hay nada visible).
- Trae 14 días con `singleEvents=true&orderBy=startTime&maxResults=250`.
- Workday 09:00–18:00. Eventos solapados se mergean antes de calcular
  ocupación. Free blocks >=1h.
- `is_packed`: >6h ocupado.
- `upcoming_important`: regex sobre el título (`firma|contrato|renovación|
  cierre|vencimiento|plazo|deadline`, trámites oficiales, eventos con
  ≥3 asistentes).
- `recurring_patterns`: agrupa eventos con `recurringEventId` por
  weekday+hora+título; ≥2 ocurrencias.

Sheets (`lib/agent/intelligence/sheets.ts`):
- Si `agent_connections.config.active_sheet_id` (o `target_spreadsheet_id`)
  → usa esa hoja; si no, fallback al spreadsheet más recientemente modificado.
- Trae hasta 500 filas de la primera tab.
- Detección de columnas (50 filas de muestra): >70% parseable como fecha
  → `date`; >70% numérico + nombre que matchea `ingreso|total|importe|venta|
  facturación|€` → `revenue`; con nombre `precio|pvp|coste` → `price`; con
  nombre `unidades|cantidad|qty|stock` o promedio <50 e integer → `quantity`;
  >70% string distinto pero acotado → `product`. Cuando solo se detecta numérico
  sin pista de nombre, se usa la magnitud (>=5 → `revenue`, si no `quantity`).
- `detection_confidence`: `high` con date+product+numeric; `medium` con
  date+numeric sin product; `low` en otro caso → sales_summary/top_products
  quedan en `null`.
- Parseo de números en formato ES: `1.234,56` → `1234.56`; quita `€/EUR`.
- Parseo de fechas: ISO `yyyy-mm-dd` o `dd/mm/yyyy|dd-mm|dd.mm` (años de 2
  dígitos → +2000).
- Trend: `vs_previous_pct` >= +10% → `up`, <= -10% → `down`, resto `flat`.
- Alertas: producto cae ≥25% vs semana anterior → `product_declining`;
  facturación de hoy ≥1.5x o ≤0.5x el promedio de los últimos 14 días con
  ≥7 días de datos → `anomaly_high`/`anomaly_low`.

### Casos donde la detección puede fallar (documentado)

- Sheets con cabecera en fila 2 o múltiples tabs con datos distribuidos —
  sólo se procesa la primera tab; mitigado pidiendo `active_sheet_id` en
  config.
- Sheets sin columna de fecha legible (e.g. fechas como texto libre
  "lunes" o números seriales de Excel sin formatear) → confidence=`low` y
  no se computa sales_summary.
- Importes que vienen en celdas como números puros sin símbolo de € y con
  cabecera ambigua: la heurística los marca como `quantity` o `revenue`
  según magnitud, lo cual puede confundirlos. Manejable iterando hacia
  Haiku para clasificar (siguiente bloque).
- Gmail: emails marcados como leídos manualmente pero pendientes de
  respuesta entran igual en `threads_awaiting_reply` (eso es deseado;
  el criterio es "último mensaje no es mío"). Falso positivo posible si
  el usuario envía emails desde otra dirección que no coincide con
  `tokenInfo.email`.
- Calendar: solo cuenta como "important" lo que matchea las regex; eventos
  importantes con títulos genéricos ("Reunión") no se promueven a
  `upcoming_important`.

### Cambios en el workflow de n8n

`Run User Modules`:
- Mantiene el spread `inbox = { connected: true, ...gmailResp.data }`, pero
  como el endpoint ahora pone su propio `connected`, el spread gana — la
  estructura enriquecida fluye al payload tal cual.
- Añade aliases explícitos `payload.gmail_intel = inbox`,
  `payload.calendar_intel = calendar`, `payload.sales_intel = sheets` justo
  antes del `outputs.push`.

`Build Claude Prompt`:
- Construye `ctx.gmail_intel`, `ctx.calendar_intel`, `ctx.sales_intel`
  curados (sub-set de los payloads originales para no inflar tokens).
- El system prompt incluye la sección **USO DE DATOS DE INTEGRACIONES
  (OBLIGATORIO si están presentes)** con instrucciones específicas:
  citar `from_name` + `hours_waiting`, proponer franjas concretas de
  `free_blocks`, citar `revenue` con `vs_last_week_pct`, convertir alerts
  en watch_outs, no inventar nada que no esté en los intel objects.

### Inspector

`/dashboard/dev/agent-inspector` ahora muestra 3 secciones nuevas
expandibles tras "Estado de módulos":
- **Gmail intel**: stats + awaiting_reply detallado + facturas + meetings +
  top senders + conteo por categoría.
- **Calendar intel**: stats + hoy + mañana (eventos y huecos libres con
  hora) + upcoming_important + recurring_patterns.
- **Sheets / Sales intel**: stats + esquema detectado por columna +
  sales_summary 4-ventanas + top_products_7d + alertas.

### Verificación local

```bash
npx tsc --noEmit -p tsconfig.json   # ✅ limpio
npm run build                       # ✅ limpio
```

### Archivos tocados (bloque 1 profundización)

```
NEW   lib/agent/intelligence/gmail.ts
NEW   lib/agent/intelligence/calendar.ts
NEW   lib/agent/intelligence/sheets.ts
EDIT  app/api/agent/gmail/summary/route.ts       — usa fetchGmailIntel; 200 siempre
EDIT  app/api/agent/calendar/summary/route.ts    — usa fetchCalendarIntel
EDIT  app/api/agent/sheets/summary/route.ts      — usa fetchSheetsIntel
EDIT  app/dashboard/dev/agent-inspector/page.tsx — 3 bloques intel expandibles
EDIT  n8n-workflow-comercio-local-v6.3.json
        - Run User Modules: gmail_intel/calendar_intel/sales_intel aliases.
        - Build Claude Prompt: curated ctx + USO DE DATOS DE INTEGRACIONES rules.
EDIT  AGENT_AUDIT.md                              — esta sección
```

### Iteraciones futuras (no incluidas en este bloque)

- Clasificación de email con Claude Haiku cuando la categoría heurística
  devuelve `unknown` consistentemente.
- Detección de schema de Sheets con LLM cuando confidence=`low`.
- Pasar a Claude los últimos 3 briefings + estado de "hecho/no hecho".
- Botones de acción ejecutable conectados a `/api/agent/gmail/action/*`.

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
