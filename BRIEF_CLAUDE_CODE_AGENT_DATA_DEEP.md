# Brief para Claude Code — Profundizar el uso de Gmail / Calendar / Sheets en el agente

## Contexto

ENLAZE es un SaaS B2B para pequeños negocios. Tiene un agente diario que genera briefings con Claude Sonnet 4.6 vía n8n. El briefing actual es **mejor a nivel de prosa** que hace una semana (Sonnet + reglas anti-alucinación + calendario retail correcto), pero **sigue siendo genérico** porque el agente no usa de verdad los datos de las integraciones del usuario.

Estado actual: Gmail, Calendar y Sheets están conectados vía OAuth para el usuario `c6c7e97a-6b17-4d66-9950-4674a5992633` (idkdu37@gmail.com). Las routes `/api/agent/{gmail,calendar,sheets}/summary` existen y devuelven `connected: true` con datos básicos. Pero **el contenido que llega a Claude desde esos endpoints es superficial** — no permite que el briefing diga cosas concretas como "María García te escribió hace 2 días y aún no le has respondido" o "los croissants llevan 4 días agotándose".

## Objetivo

Transformar el agente de "sabe que los módulos están conectados" a "usa el contenido real de esos módulos para generar valor concreto". Después de este cambio, un briefing tipo debe poder afirmar cosas como:

- *"Marta García (cliente recurrente) te escribió ayer preguntando por X. Lleva 26h sin respuesta. Te dejo un draft de respuesta."*
- *"Hoy tienes 3 citas: a las 11h con el proveedor de harinas, a las 16h con María (Caja 2 firma renovación), 18h taller. Bloque libre de 13h-16h."*
- *"Ayer ingresaste 380€, +12% vs el mismo lunes pasado. Top producto: croissant almendra (28 unidades). Llevamos 4 días seguidos agotando antes de las 12h — propon encargar 40 más a Mañana del Trigo."*

## Decisiones tomadas (no preguntes, aplícalas)

### Arquitectura

Cada endpoint summary (`/api/agent/gmail/summary`, `.../calendar/summary`, `.../sheets/summary`) devuelve un payload mucho más rico. **No introducir todavía clasificación con Claude Haiku dentro de los routes** — primero hacemos enriquecimiento heurístico/algorítmico. Si después vemos que faltan insights, añadimos Haiku como segunda iteración.

### Payload enriquecido por módulo

#### Gmail (`/api/agent/gmail/summary`)

Hoy devuelve algo así como `{ connected, unread_count, priority_threads, awaiting_reply, ... }`. Enriquécelo a:

```typescript
{
  connected: boolean,
  status: 'ok' | 'decrypt_failed' | 'expired_token' | 'rate_limited',

  // Inbox aggregates
  total_unread: number,
  threads_awaiting_reply: Array<{
    thread_id: string,
    from_name: string,
    from_email: string,
    subject: string,
    snippet: string, // first 200 chars
    hours_waiting: number,
    is_recurring_contact: boolean, // appears in other threads from past 90 days
    category: 'customer' | 'supplier' | 'lead' | 'internal' | 'unknown',
    priority_signal: 'urgent' | 'high' | 'normal' | 'low', // heuristic: subject keywords, sender history, time waiting
  }>,

  // Patterns
  top_senders_30d: Array<{ email, name, count, is_customer: boolean }>,
  threads_count_by_category: { customer, supplier, lead, internal, spam, unknown },

  // Time-sensitive
  invoices_detected: Array<{ thread_id, supplier, amount?, due_date?, snippet }>,
  meeting_requests: Array<{ thread_id, from, proposed_dates, snippet }>,

  // Stats for prompt
  emails_processed: number,
  fetched_range_days: number,
}
```

Heurísticas para implementar:

- **Categoría**: matchea contra contactos conocidos, lista de dominios de proveedores, lista de remitentes recurrentes. Default `unknown`.
- **is_recurring_contact**: si has intercambiado >2 emails con esa dirección en los últimos 90 días.
- **priority_signal**: subject contiene "urgente|asap|hoy|importante" → urgent; cliente recurrente sin respuesta >24h → high; default normal.
- **invoices_detected**: cualquier email con "factura|invoice|albarán|pago" en subject + adjunto PDF, extrae lo que puedas con regex sobre el snippet.

Procesa **últimos 7 días** o **50 emails** (lo que sea menor). No proceses la bandeja entera — costaría demasiado y la mayoría no aporta.

#### Calendar (`/api/agent/calendar/summary`)

Hoy devuelve `{ connected, today_events, next_events, ... }`. Enriquécelo a:

```typescript
{
  connected, status,

  today: {
    date: string,
    events: Array<{ start, end, title, location?, attendees?, is_recurring: boolean }>,
    total_events: number,
    total_busy_hours: number,
    free_blocks: Array<{ start, end, duration_hours: number }>, // huecos >= 1h
    is_packed: boolean, // > 6h ocupadas
  },

  tomorrow: { /* misma forma que today */ },

  this_week: {
    total_events: number,
    busiest_day: { date, count },
    quietest_day: { date, count },
  },

  upcoming_important: Array<{
    date,
    title,
    why_important: string, // "primera cita con cliente X", "vence plazo Y", etc.
    days_until: number,
  }>,

  recurring_patterns: Array<{
    description: string, // "miércoles 9-11h equipo", "viernes 16h cierre semanal"
    occurrences: number,
  }>,
}
```

Mira **calendarios primarios + cualquier secundario que el usuario tenga visible** (no sólo "primary").

#### Sheets (`/api/agent/sheets/summary`)

Hoy probablemente devuelve metadata básica de la hoja conectada. Enriquécelo:

```typescript
{
  connected, status,
  active_sheet: {
    id, name, last_modified,
    column_schema_detected: Array<{ name, type, role: 'date'|'product'|'quantity'|'price'|'revenue'|'unknown' }>,
  },

  // Si pudiste detectar columnas de ventas:
  sales_summary: {
    today: { revenue: number, units: number, transactions: number } | null,
    yesterday: { revenue, units, transactions } | null,
    this_week: { revenue, units, transactions, vs_last_week_pct: number } | null,
    this_month: { revenue, units, vs_last_month_pct: number } | null,
  } | null,

  top_products_7d: Array<{ name, units, revenue, trend: 'up'|'down'|'flat', vs_previous_pct: number }> | null,

  alerts: Array<{
    type: 'product_declining' | 'stock_low' | 'anomaly_high' | 'anomaly_low',
    message: string,
    data: Record<string, any>,
  }>,

  rows_analyzed: number,
  detection_confidence: 'high' | 'medium' | 'low', // qué tan seguro estás de que entendiste el schema
}
```

**Detección de schema**: usa heurísticas. Columna con muchos `YYYY-MM-DD` o `DD/MM/YYYY` → `date`. Columna con muchos números enteros pequeños → `quantity`. Columna con números mayores y posible `€` → `price` o `revenue`. Columna de texto repetida → `product`. Si la detección no es clara, devuelve `detection_confidence: 'low'` y deja el resto null — **no inventes datos**.

Sólo procesa la hoja activa configurada por el usuario (campo `active_sheet_id` en `agent_connections.config`), o la última modificada si no hay configurada.

### Cambios necesarios en el workflow de n8n

El nodo `Run User Modules` ya llama a estos 3 endpoints. Lo que falla hoy es que **la información que recoge no fluye con detalle al `ctx`** que envía a Claude. Hay que:

1. Que el JS de `Run User Modules` recoja los nuevos campos del payload (incluyendo `threads_awaiting_reply[]`, `today.events[]`, `sales_summary`, etc.) en su `outputs[i]`.
2. Que `Build Claude Prompt` los incluya en el `ctx` que envía a Claude. Añadir nuevas claves: `ctx.gmail_intel`, `ctx.calendar_intel`, `ctx.sales_intel`.
3. Que el system prompt de Claude se actualice con instrucciones específicas para usar estos campos. Algo así:

```
USO DE DATOS DE INTEGRACIONES (OBLIGATORIO si estan presentes):
- Si gmail_intel.threads_awaiting_reply tiene items con priority_signal=urgent o high → menciónalos por nombre en el briefing.
- Si gmail_intel.invoices_detected tiene items → menciónalos.
- Si calendar_intel.today.is_packed → comenta el ritmo del día.
- Si sales_intel.sales_summary.yesterday existe → cita el dato concreto con comparativa.
- Si sales_intel.alerts tiene items → conviértelos en watch_outs.
- NUNCA inventes datos de Gmail/Calendar/Sheets que no estén en los campos correspondientes del ctx.
```

### Inspector

Actualiza `/dashboard/dev/agent-inspector` para mostrar el nuevo payload enriquecido en lugar del básico que hay hoy. Cada sección expandible (Gmail, Calendar, Sheets) debe mostrar los nuevos campos. Eso te sirve para depurar.

## Constraints técnicos

- **Coste de tokens**: NO hagas clasificación con Claude dentro de los routes en esta iteración. Todo heurístico/algorítmico.
- **Latencia**: cada summary endpoint debe responder en <5s. Si superas eso, paginar o limitar.
- **Robustez**: si la API de Google falla (401, 403, 429, 5xx), el endpoint devuelve `{ connected: true, status: 'rate_limited' | 'auth_expired' | 'api_error', ...lo que se pudo recoger }`. NUNCA 500.
- **Privacy**: NO loguees contenido completo de emails ni filas de hojas en consola/Sentry. Sólo metadata (counts, IDs, días, etc.).

## Archivos clave

- `app/api/agent/gmail/summary/route.ts`
- `app/api/agent/calendar/summary/route.ts`
- `app/api/agent/sheets/summary/route.ts`
- `lib/services/google-api.ts` — extiende para los endpoints de Gmail/Calendar/Sheets que necesites.
- `~/Desktop/enlaze/n8n-workflow-comercio-local-v6.3.json` — toca el JS de "Run User Modules" para propagar los nuevos campos al output, y el de "Build Claude Prompt" para añadirlos al ctx y actualizar el system prompt.
- `app/dashboard/dev/agent-inspector/page.tsx` — actualiza para visualizar el nuevo payload.
- `AGENT_AUDIT.md` (raíz) — añade una sección "Profundización Bloque 1" documentando los cambios.

## Criterios de aceptación

- [ ] Los 3 endpoints summary devuelven el payload enriquecido completo cuando los módulos están conectados.
- [ ] Si un endpoint falla parcialmente (ej. Google API timeout), devuelve `200` con un `status` explícito en lugar de 500.
- [ ] `Run User Modules` recoge los nuevos campos en sus outputs.
- [ ] `Build Claude Prompt` los pasa al `ctx` con claves `gmail_intel`, `calendar_intel`, `sales_intel`.
- [ ] El system prompt actualizado instruye a Claude a usar estos datos cuando estén presentes.
- [ ] El inspector muestra los nuevos campos en bloques expandibles.
- [ ] Tras ejecutar el workflow para idkdu37@gmail.com (que tiene los 3 módulos conectados), el briefing referencia AL MENOS un dato concreto del Gmail, Calendar o Sheets (o documenta por qué no fue posible — ej. Sheets sin schema detectado).
- [ ] `npx tsc --noEmit -p tsconfig.json` pasa limpio.
- [ ] `npm run build` pasa.
- [ ] Documentado en `AGENT_AUDIT.md` con la lista de heurísticas implementadas y casos donde la detección puede fallar.

## Estilo

- TypeScript estricto, evita `any`.
- Si la complejidad lo pide, divide en helpers en `lib/agent/intelligence/{gmail,calendar,sheets}.ts`. No metas 500 líneas en cada route.
- Logging útil con prefijo `[agent/intel/{module}]` para depurar.

## Iteraciones futuras (NO en esta tarea, sólo nota mental)

- Clasificación con Claude Haiku para mejores categorías de email cuando el heurístico falle.
- Detección de schema de Sheets con un agente LLM (cuando heurísticos no basten).
- Memoria: pasar a Claude los últimos 3 briefings + qué se marcó como hecho.
- Acciones ejecutables (botones que disparan flows reales).

## Cuando termines

Deja en el commit del cambio una nota tipo:

> *"feat(agent): rich Gmail/Calendar/Sheets intelligence — briefing now cites concrete inbox/agenda/sales data"*

Y muéstrame:
1. Captura del inspector con los nuevos campos.
2. Una ejecución de prueba del workflow + el briefing resultante (esperamos ver datos concretos).
3. Sección añadida a `AGENT_AUDIT.md`.
