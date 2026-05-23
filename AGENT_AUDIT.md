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

---

# Bloque 3 — Especialización por sector — 2026-05-23

Aplicación de `BRIEF_CLAUDE_CODE_AGENT_SECTOR.md` + ADDENDUM. Objetivo:
que el agente diario deje de ser genérico y razone como un experto del
subsector real del negocio (peluquería ≠ hostelería ≠ taller).

## TL;DR

| Pieza | Estado |
| --- | --- |
| `lib/agent/sector-intel.ts` con perfiles por sector | ✅ Creado |
| `lib/sectors.ts` lista compartida onboarding ↔ Ajustes | ✅ Creado |
| `business_sector` deja de colapsar a `comercio_local` | ✅ Hecho |
| `/api/agent/config` expone `agent_persona_prompt`, `agent_name`, `sector_intel` | ✅ Hecho |
| `/api/agent/news` (Google News RSS + Haiku opcional) | ✅ Creado, `200` siempre |
| Ajustes → Sector edita y muestra el subsector granular | ✅ Hecho |
| `sector-context` deriva de `profiles.business_sector` | ✅ Hecho |
| `npx tsc --noEmit` y `npm run build` | ✅ limpios |

## Decisiones de diseño aplicadas

### Única fuente de verdad = `profiles.business_sector`

Antes había dos: `profiles.business_sector` (granular, lo guardaba el
onboarding) y `fiscal_settings.sector_key` (coarse, lo editaba Ajustes →
Sector). Como Ajustes solo tocaba el segundo, el subsector quedaba
escondido y el agente nunca llegaba a usarlo.

Ahora:
- Ajustes → Sector escribe en `profiles.business_sector` (granular) y
  además sincroniza `fiscal_settings.sector_key` con su mapeo coarse
  (`construccion` / `comercio` / `servicios`) para no romper el motor de
  presupuestos.
- `lib/sector-context.tsx::loadConfig` lee primero `profiles.business_sector`;
  sólo cae a `fiscal_settings.sector_key` si el primero está vacío.
- `sector_config` (tabla coarse) sigue usándose para terminología y
  módulos visibles — se busca por la versión coarse mapeada.

### Taxonomía y mapeos

`lib/sectors.ts::SECTOR_OPTIONS` es la lista canónica. Sus `id` coinciden
1:1 con las claves de `sectorConfigs` en `lib/agent-prompts.ts`:

```
construccion · legal · hosteleria · salud · comercio · automocion ·
estetica · educacion · tecnologia · eventos · otro
```

`normalizeSectorId(value)` y `normalizeBusinessSectorKey(value)`
(en `lib/sectors.ts` y `lib/agent-prompts.ts` respectivamente) absorben
alias históricos: `comercio_local` / `retail` → `comercio`, `peluqueria`
/ `belleza` → `estetica`, `restaurante` / `bar` / `cafeteria` →
`hosteleria`. Lo demás cae a `otro`.

Para el motor de presupuestos / banco de precios:
`lib/sector-config.ts::normalizeSector` mapea `construccion` →
`construccion` y todo lo demás a `comercio_local`. Esto es un detalle
del wizard de presupuestos, no del agente — el agente diario sigue
viendo la clave granular vía `business_sector`.

### Perfiles de inteligencia (`lib/agent/sector-intel.ts`)

`SECTOR_INTEL` indexa por `sector_key` y contiene, para cada subsector,
material editorial concreto para España:

- `news_queries`: queries Google News RSS específicas. `{ciudad}` se
  interpola server-side con `profiles.city` antes de salir hacia n8n /
  el endpoint de noticias.
- `news_max_items`: 4–5.
- `kpis_focus`: las cifras que el agente debe destacar para ese
  sector (food cost % en hostelería, rebooking % en peluquería, ITV en
  automoción…).
- `seasonal_focus`: ventanas estacionales propias (terrazas de verano,
  cenas de empresa, temporada de bodas, revisión pre-vacaciones…) con
  meses 1–12 y nota accionable.
- `campaign_archetypes`: arquetipos de campaña reales del sector
  (happy hour en franja valle, bono prepago, paquete novia, revisión
  pre-vacaciones, escaparate temático…). NADA de "haz una promo".
- `regulatory_notes`: recordatorios operativos (APPCC, alérgenos,
  gestión de residuos químicos en estética, RGPD fotos antes/después,
  garantía legal de reparación en automoción…).
- `supplier_types`: tipos de proveedor habituales (ayuda a futuras
  categorizaciones de Gmail y sugerencias de compras).

Cubierto con calidad: `hosteleria`, `estetica`, `comercio`, `salud`,
`automocion` + un `default` para `otro` / sin sector. Los otros
sectores existentes en `sectorConfigs` (legal, construccion,
educacion, tecnologia, eventos) caen al `default` por ahora; añadir
perfiles propios es una línea por sector cuando convenga.

### Endpoint `/api/agent/config`

Sigue devolviendo lo que ya devolvía. Añade:

- `sector` ahora es el resultado de `normalizeBusinessSectorKey` (clave
  válida de `sectorConfigs`), no `business_sector || "comercio_local"`.
- `sector_raw`: lo que hay literalmente en BBDD (para debug).
- `agent_name` y `agent_persona_prompt`: la persona detallada (ej. "Eres
  un consultor experto en hostelería con 20 años…") en lugar de prosa
  genérica.
- `sector_intel`: `SectorIntelProfile` con `news_queries` ya
  interpoladas con `profiles.city`. n8n no replica lógica de sector.

### Endpoint nuevo `/api/agent/news`

`GET /api/agent/news?user_id=<uuid>[&write=1]`. Protegido por
`Bearer AGENT_API_KEY`. Flujo:

1. Lee `profiles.business_sector` + `city`, resuelve el perfil con
   `getSectorIntel`, interpola queries con `resolveNewsQueries`.
2. Para cada query, fetch a `https://news.google.com/rss/search?q=…&hl=es&gl=ES&ceid=ES:es`
   (sin API key). Parseo de RSS con regex (sin dependencias nuevas).
   Per-query timeout 2200 ms; deadline global 7500 ms para asegurar
   <8 s.
3. Dedup por URL canonicalizada + título (`slice(0,80).toLowerCase()`),
   orden por `pubDate` desc, recorte a `news_max_items`.
4. Si hay `ANTHROPIC_API_KEY`, llamada única a
   `claude-haiku-4-5-20251001` con system prompt en castellano:
   "explica en ≤25 palabras por qué importa cada titular a un negocio
   del sector X en {ciudad}". JSON `{items:[{idx,relevance}]}`. Si
   falla, se sigue sin `why_relevant` (no bloquea).
5. Si `write=1`, escribe en `agent_news` con idempotencia: se filtran
   las URLs ya insertadas para el mismo usuario en el día UTC. Campos
   mapeados al esquema que ya espera `/api/agent/ingest`:
   `user_id, title, summary (=why_relevant), source, url,
   published_date, category (=sector_key), relevance=5, tags=[sector]`.

Ante cualquier error devuelve `200 { ok:true, news: [] }` con `error`
en el body. Nunca 500. Logs sólo metadata: `[agent/news] user=… sector=…
queries=… items=… written=… took=…ms`.

### Reglas para el `Build Claude Prompt` de n8n (a aplicar en el workflow)

El brief pide reescribir el system prompt para que use la persona y
respete el sector. Como editar el JSON enorme de n8n vivo es un cambio
operativo, dejamos el contrato listo desde el código:

- `/api/agent/config` ya devuelve `agent_persona_prompt`, `agent_name`
  y `sector_intel` (con `kpis_focus`, `seasonal_focus`,
  `campaign_archetypes`, `regulatory_notes`, `supplier_types`,
  `news_queries`).
- `/api/agent/news?user_id=&write=1` se puede llamar desde un nodo
  nuevo `Fetch Sector News` después del `Run User Modules`. Como ya
  escribe en `agent_news`, el `ingest` no necesita re-mandar noticias.
  El payload que llega a `Build Claude Prompt` debería incorporar
  `news` (las recién obtenidas) y `sector_intel` (de
  `/api/agent/config`).
- Reglas a inyectar en el system prompt del `Build Claude Prompt`
  (texto íntegro a pegar):

```
ESPECIALIZACIÓN POR SECTOR (OBLIGATORIO):
- Eres el agente del sector {agent_name}. Razona y prioriza como un
  experto de ESE sector.
- Usa sector_intel.kpis_focus para decidir qué cifras destacar.
- Si hay news relevantes, cita 1-2 por título y explica en una frase
  por qué importan al negocio (usa why_relevant si está).
- Aplica seasonal_focus del sector (no sólo el calendario retail
  genérico).
- Cuando toque, recuerda un punto de regulatory_notes (p.ej. APPCC en
  hostelería) sin sonar a abogado.
- Propón campañas inspiradas en campaign_archetypes del sector,
  adaptadas a los datos reales del negocio. NADA de campañas genéricas
  tipo "haz una promo".
- NUNCA inventes noticias, cifras ni normativas que no estén en el ctx.
```

> Estos dos cambios (`Fetch Sector News` + reescritura del system
> prompt) son los únicos que quedan en el workflow JSON y son
> 100 % editables desde la UI de n8n sin tocar código TS.

### Onboarding ↔ Ajustes

- `app/onboarding/page.tsx` importa `SECTOR_OPTIONS` y guarda la `id`
  exacta en `profiles.business_sector`.
- `app/dashboard/settings/sector/page.tsx` también importa
  `SECTOR_OPTIONS` (no la tabla `sector_config`), preselecciona desde
  `profiles.business_sector` y guarda en `profiles.business_sector`.
  Sincroniza `fiscal_settings.sector_key` con su coarse para no
  romper el wizard de presupuestos.
- `sector-context` lee primero `profiles.business_sector` y cae a
  `fiscal_settings.sector_key` sólo si está vacío. La búsqueda en
  `sector_config` se hace con la versión coarse mapeada
  (`construccion` / `comercio` / `servicios`).

## Casos donde puede fallar (documentado)

- **`business_sector = "otro"` o un free-text no canónico**: el agente
  cae al perfil `default`. Útil pero genérico. Recomendar al usuario
  en Ajustes elegir el subsector más cercano.
- **Sin `city` en el perfil**: `resolveNewsQueries` interpola "España"
  y las queries quedan más genéricas. El briefing pierde regional.
- **Google News RSS caído / corta conexión**: el endpoint devuelve
  `news: []` con `error` en el body. El briefing diario funciona,
  pero sin noticias frescas para ese día.
- **Haiku falla / no hay `ANTHROPIC_API_KEY`**: las noticias llegan
  sin `why_relevant`. Aceptable: el briefing puede explicar por sí
  solo.
- **Perfiles existentes con `business_sector = "comercio_local"` o
  vacío**: en el dashboard parecerán "Comercio" o caerán al `default`.
  No se ejecuta migración automática para no sobrescribir un
  `business_sector` ya elegido por el usuario; el usuario lo arregla
  desde Ajustes → Sector en un click.
- **Sectores `legal`/`construccion`/`educacion`/`tecnologia`/`eventos`
  no tienen perfil propio todavía**: `getSectorIntel` los lleva al
  `default`. La persona detallada de `sectorConfigs` sí está activa.

## Verificación local

```bash
npx tsc --noEmit -p tsconfig.json   # ✅ limpio
npm run build                       # ✅ limpio
```

## Archivos tocados (bloque 3)

```
NEW   lib/agent/sector-intel.ts        — registro SECTOR_INTEL + helpers
NEW   lib/sectors.ts                   — SECTOR_OPTIONS compartido + normalize
NEW   app/api/agent/news/route.ts      — Google News RSS + Haiku opcional
EDIT  lib/agent-prompts.ts             — getSectorConfig con alias; nueva normalizeBusinessSectorKey
EDIT  lib/sector-config.ts             — normalizeSector: sólo construccion permanece; el resto cae a comercio_local
EDIT  lib/sector-context.tsx           — sectorKey deriva de profiles.business_sector; lookup coarse en sector_config
EDIT  app/api/agent/config/route.ts    — devuelve agent_persona_prompt + agent_name + sector_intel
EDIT  app/onboarding/page.tsx          — consume SECTOR_OPTIONS
EDIT  app/dashboard/settings/sector/page.tsx — edita business_sector, mismas opciones que onboarding
EDIT  AGENT_AUDIT.md                   — esta sección
```

## Pendientes (n8n, fuera de TS)

1. Añadir un nodo `Fetch Sector News` en `n8n-workflow-comercio-local-v6.3.json`
   que llame `/api/agent/news?user_id=...&write=1` y guarde el array en el
   payload (o confíe en que el endpoint ya escribió en `agent_news`).
2. Reemplazar el system prompt inline de `Build Claude Prompt` por uno que
   parta de `agent_persona_prompt`, inyecte `sector_intel` y `news` y
   añada el bloque "ESPECIALIZACIÓN POR SECTOR" que dejamos arriba.

## Bloque 4 — Clasificación de correos por importancia + bandeja en el dashboard (2026-05-23)

Implementa el brief `BRIEF_CLAUDE_CODE_EMAIL_CLASSIFICATION.md`. El agente ahora
clasifica los correos entrantes por importancia y los muestra en una bandeja real
dentro del dashboard (antes la página Emails solo mostraba correos salientes).

### Motor de importancia

Nuevo eje `importance: 'critical' | 'important' | 'normal' | 'noise'` por hilo, con
`importance_reason` (frase corta en español) y `classified_by: 'heuristic' | 'haiku'`.

- **Heurística** (`lib/agent/intelligence/gmail.ts::importanceForHeuristic`): resuelve
  los casos claros — urgente → critical; cliente conocido/recurrente sin responder
  ≥24h → critical; factura/pago → important; proveedor sin responder ≥48h o solicitud
  de reunión → important; cliente → important; spam/no-reply/notificaciones → noise;
  resto con categoría clara → normal.
- **Categorización mejorada**: `categorize()` ahora cruza el remitente con los emails
  de `clients` del usuario (→ customer con alta confianza) y con tokens derivados de
  `sector_intel.supplier_types` (→ supplier). Resuelve el punto débil de clientes en
  dominios freemail.
- **Fallback Haiku** (`lib/agent/intelligence/email-importance.ts`): los correos que
  quedan `category='unknown'` se mandan en UNA sola llamada batch a
  `claude-haiku-4-5-20251001` con el contexto de sector (agent_name + 1 línea de
  persona). Devuelve importancia + categoría + motivo. Timeout 4,5s, cap 15 correos,
  parseo JSON tolerante. Si falla (sin API key, timeout, JSON inválido) → se queda la
  heurística. Nunca bloquea ni lanza.

`GmailIntel` se amplía con `classified_threads` (todos los hilos analizados, ordenados
por importancia y luego horas) e `importance_counts`. `threads_awaiting_reply` se
mantiene (subconjunto sin ruido) para compatibilidad con n8n.

### Privacidad y robustez

- A Haiku solo van remitente + asunto + snippet (≤200 chars). Nunca cuerpos completos.
- No se loguea contenido de correos, solo contadores con prefijo `[agent/intel/gmail]`.
- El endpoint `/api/agent/gmail/summary` sigue devolviendo 200 siempre, nunca 500.

### Cableado del route

`app/api/agent/gmail/summary/route.ts` ahora, antes de llamar a `fetchGmailIntel`,
carga los emails de `clients` del usuario y resuelve el sector
(`normalizeBusinessSectorKey` → `getSectorConfig` + `getSectorIntel`), y los pasa como
opciones (`knownClientEmails`, `supplierHints`, `sectorContext`, `enableHaiku: true`).
Reutiliza la fuente de verdad de sector; no duplica lógica.

### Bandeja en el dashboard

`app/dashboard/emails/page.tsx` reorganizada en dos pestañas:
- **Bandeja**: hace `fetch('/api/agent/gmail/summary')` (sesión de browser) y muestra
  los correos agrupados por importancia (críticos/importantes/normales arriba, ruido
  colapsado), con badges de color, categoría, horas de espera y el motivo de
  importancia. Estados: cargando / no-conectado (CTA a Integraciones) / error / vacío.
- **Enviar**: el formulario + historial de salientes existente, intacto.
- Corregido el copy del `InfoFlipCard` para reflejar la bandeja real.

### Inspector

`/dashboard/dev/agent-inspector` muestra ahora `importance_counts` y, por cada correo,
`importance` + motivo + si lo clasificó la heurística o Haiku (IA).

### Verificación

```bash
npx tsc --noEmit -p tsconfig.json   # ✅ limpio
npx eslint <ficheros tocados>       # ✅ 0 errores (1 warning exhaustive-deps preexistente)
npm run build                       # pendiente de ejecutar en máquina del usuario
```

> Nota: el build no se pudo ejecutar en el entorno aislado (Next requiere descargar el
> binario SWC y no había acceso a registry.npmjs.org). tsc + eslint pasan limpios.

### Pendiente opcional (n8n, no bloqueante)

`classified_threads` e `importance_counts` ya viajan dentro de `gmail_intel` hacia n8n
automáticamente (el endpoint los incluye en el payload). Falta, si se quiere, actualizar
el system prompt de `Build Claude Prompt` para que el briefing abra con los correos
`critical`/`important` por nombre y omita el `noise`. Es un cambio de prompt aislado.

### Archivos tocados (bloque 4)

```
NEW   lib/agent/intelligence/email-importance.ts   — clasificador Haiku batch
EDIT  lib/agent/intelligence/gmail.ts              — importance + classified_threads + opts
EDIT  app/api/agent/gmail/summary/route.ts          — clients + sector → fetchGmailIntel
EDIT  app/dashboard/emails/page.tsx                 — pestañas Bandeja / Enviar
EDIT  app/dashboard/dev/agent-inspector/page.tsx    — importance_counts + por correo
EDIT  AGENT_AUDIT.md                                — esta sección
```

### Casos donde puede fallar (documentado)

- **Buzón sin correos de negocio** (p.ej. cuenta de la uni con notificaciones de
  CAMPUS): casi todo se clasifica como `internal/noise`, que es lo correcto. Para ver
  `critical/important` hacen falta correos reales de clientes/proveedores.
- **Sin `ANTHROPIC_API_KEY` o Haiku caído**: los correos `unknown` se quedan en
  `normal` con motivo "Sin clasificar". El resto (heurística) funciona igual.
- **El usuario envía desde otra dirección** distinta a `tokenInfo.email`: sus propios
  correos podrían contar como pendientes (mismo criterio que ya existía).
