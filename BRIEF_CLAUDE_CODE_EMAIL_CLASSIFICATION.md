# Brief para Claude Code — Clasificación de correos de clientes por importancia + bandeja en el dashboard

## Contexto

ENLAZE es un SaaS B2B para pequeños negocios con un agente diario (Claude Sonnet vía n8n) que genera briefings. La integración de Gmail YA funciona a nivel de datos: `lib/agent/intelligence/gmail.ts` trae la bandeja del usuario y `/api/agent/gmail/summary` devuelve un `GmailIntel` enriquecido (ver `AGENT_AUDIT.md`, sección "Profundización Bloque 1").

**Problema actual (diagnosticado):**

1. **Ninguna pantalla de usuario muestra la bandeja de Gmail.** La página `/dashboard/emails` se anuncia en su `InfoFlipCard` como "tu bandeja de entrada de Gmail conectada a ENLAZE", pero su código solo lee la tabla Supabase `messages` con `channel='email'` (correos *salientes* enviados a clientes vía Resend). Nunca llama a Gmail. Por eso el usuario ve "Sin emails todavía". Los datos reales de Gmail (`gmail_intel`) solo los consumen el flujo de n8n y el inspector de dev (`/dashboard/dev/agent-inspector`).

2. **La clasificación por importancia es débil donde más importa.** `gmail.ts::categorize()` clasifica en `customer | supplier | lead | internal | spam | unknown` por dominios + regex, y `priorityFor()` da `urgent | high | normal | low`. Pero un cliente real escribiendo desde un correo freemail (gmail.com/outlook.com) sin palabras clave de pedido cae en `unknown` y nunca se marca como importante. El objetivo del usuario es que el agente **distinga de verdad qué correos de clientes son importantes y cuáles no**.

## Objetivo

Que el agente analice los correos entrantes, los **clasifique por importancia con criterio**, y que esa clasificación (a) alimente el briefing de n8n y (b) se vea en una bandeja real dentro del dashboard. Además, guiar a usuarios nuevos para que conecten su correo de **empresa/profesional** (no el personal), de modo que el agente trabaje sobre correo relevante y no sobre ruido personal.

Tras este cambio, la bandeja del dashboard debe poder mostrar algo como:

- **🔴 Importante** — *Marta García (cliente recurrente) · "Presupuesto reforma cocina" · lleva 26h sin respuesta.*
- **🟠 A revisar** — *Proveedor Mañana del Trigo · "Factura mayo" · adjunto detectado.*
- **⚪ Ruido** — newsletters, promos, no-reply (colapsados/ocultos por defecto).

## Decisiones ya tomadas (NO preguntes, aplícalas)

### Motor de clasificación: **heurístico + Claude Haiku para los ambiguos**

- Primer pase **heurístico** (gratis, instantáneo) resuelve los casos claros.
- Los correos que queden `category='unknown'` o con señal de prioridad ambigua se mandan **en una sola llamada batch a Claude Haiku** que devuelve importancia + categoría + motivo. Una sola llamada por ejecución (no una por correo) para acotar coste y latencia.
- Esto es la iteración que `AGENT_AUDIT.md` dejó anotada como futura ("clasificación de email con Claude Haiku cuando el heurístico falle"). Ahora sí se implementa.
- `ANTHROPIC_API_KEY` ya está en `.env.local`. Reutiliza el patrón que ya usa el repo (`new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })` + `anthropic.messages.create(...)`, ver `app/api/agent/market/analysis/route.ts` y `app/api/agent/budget-analysis/route.ts`). SDK: `@anthropic-ai/sdk@^0.80.0`. **Modelo: el Haiku más reciente disponible** (verifica el string exacto; objetivo: `claude-haiku-4-5-20251001`). Si ese string no está disponible en la cuenta, cae a un Haiku anterior, pero NO uses Sonnet para esto (coste).

### Nuevo eje de "importancia"

Añade a cada hilo un campo `importance` con cuatro niveles y un motivo legible:

```typescript
type EmailImportance = 'critical' | 'important' | 'normal' | 'noise';
// critical → cliente/proveedor que requiere acción hoy o lleva mucho esperando, deadlines, dinero
// important → cliente/proveedor relevante, merece atención pronto
// normal → legítimo pero no urgente
// noise → newsletters, promos, notificaciones automáticas, no-reply
```

Cada item clasificado lleva además `importance_reason: string` (una frase corta en castellano, p.ej. "Cliente recurrente sin respuesta 26h") y `classified_by: 'heuristic' | 'haiku'` para trazabilidad.

---

## Parte 1 — Motor de clasificación (core)

Trabaja sobre `lib/agent/intelligence/gmail.ts`. Si crece demasiado, extrae la lógica de importancia a `lib/agent/intelligence/email-importance.ts` y mantén `gmail.ts` como orquestador.

### 1.1 Mejorar la heurística de categoría/cliente

`categorize()` falla con clientes en dominios freemail. Mejóralo:

- **is_recurring_contact ya existe** y es la mejor señal de "cliente real": si has intercambiado >2 emails con esa dirección en los 90 días vistos, trátalo como contacto relevante aunque el dominio sea freemail → categoría `customer` (en vez de `unknown`) salvo que el contenido indique proveedor.
- Cruza el remitente con la tabla Supabase `clients` (campo `email`): si el `from_email` está en `clients`, categoría = `customer` con alta confianza. (Hazlo en el route, que ya tiene el `supabase` y el `user_id`; pásale a `fetchGmailIntel` un set de emails de clientes conocidos.)
- Mantén las reglas actuales de `supplier`/`spam`/`internal`.

### 1.2 Asignar importancia heurística (casos claros)

Reglas (de mayor a menor prioridad):

- `URGENT_RE` en asunto/snippet → `critical`.
- Cliente conocido o recurrente **sin responder** y `hours_waiting >= 24` → `critical`.
- `invoices_detected` con importe o fecha de vencimiento próxima → `important`.
- Proveedor sin responder `>= 48h`, o `meeting_requests` con fecha → `important`.
- Cliente conocido reciente (sin urgencia) → `important`.
- `category='spam'`, no-reply/newsletter/promo → `noise`.
- Resto con categoría clara → `normal`.

Marca estos como `classified_by: 'heuristic'`.

### 1.3 Fallback con Haiku (batch, una llamada)

Para los hilos que queden `category='unknown'` **o** sin importancia clara tras 1.2 (cap a, p.ej., los 15 más recientes para acotar coste):

- Construye **una sola** llamada a Haiku con:
  - Contexto de negocio: `business_name`, `business_type`/sector (de `profiles`), 1-2 frases de qué hace el negocio.
  - Un array de correos, cada uno con `{ idx, from_name, from_email, subject, snippet }` (snippet ya viene truncado a 200 chars).
  - Instrucción de devolver **JSON estricto**: array `[{ idx, importance, category, reason }]` con los enums de arriba.
- Parsea el JSON con tolerancia (si Haiku envuelve en texto, extrae el bloque). Aplica el resultado a los hilos correspondientes y márcalos `classified_by: 'haiku'`.
- **Robustez:** si Haiku falla, da timeout (>4s) o devuelve JSON inválido → cae a la importancia heurística (nunca bloquees el endpoint ni tires 500). Loguea `[agent/intel/gmail] haiku fallback: <motivo>` sin contenido de correos.
- **Privacy:** a Haiku solo van remitente + asunto + snippet (≤200 chars). NUNCA cuerpos completos. NUNCA loguees asunto/snippet/contenido en consola ni Sentry.
- **Latencia:** una sola llamada batch; el endpoint summary debe seguir respondiendo en <5s. Si el batch tarda, devuelve lo heurístico y marca un flag `haiku_skipped: true`.
- **(Opcional, recomendado) Caché:** cachea la clasificación por `message_id` (p.ej. en una tabla ligera `agent_email_classifications` o en `agent_connections.config.email_cache`) para no reclasificar el mismo correo en cada ejecución del agente. Si lo implementas, documenta el TTL (sugerencia: hasta que el hilo reciba nuevo mensaje).

### 1.4 Extender el tipo `GmailIntel`

Añade a `AwaitingReplyThread` (y a cualquier lista de hilos que se exponga): `importance`, `importance_reason`, `classified_by`. Añade a `GmailIntel`:

```typescript
classified_threads: Array<AwaitingReplyThread>; // todos los hilos analizados, ordenados por importancia (critical→noise) y luego por hours_waiting desc
importance_counts: { critical: number; important: number; normal: number; noise: number };
```

Actualiza `emptyGmailIntel()` con los nuevos campos a cero/lista vacía.

---

## Parte 2 — Propagar al briefing de n8n

Fichero: `~/Desktop/enlaze/n8n-workflow-comercio-local-v6.3.json` (haz backup antes, como ya hay `.bak`/`.bak2`).

- **`Run User Modules`**: ya hace `payload.gmail_intel = inbox`. Asegúrate de que `classified_threads` e `importance_counts` viajan en ese objeto (vienen gratis con el spread del payload del endpoint; solo verifica que no se recortan).
- **`Build Claude Prompt`**: en el `ctx.gmail_intel` curado, incluye los `classified_threads` con importancia `critical`/`important` (no metas el `noise` para no inflar tokens) + `importance_counts`.
- **System prompt** — amplía la sección "USO DE DATOS DE INTEGRACIONES (OBLIGATORIO si están presentes)":

```
- Abre el briefing con los correos importance=critical: cítalos por from_name, asunto y horas esperando, y propón acción concreta (responder, llamar, agendar).
- Menciona los importance=important que el usuario debería atender hoy.
- NO menciones correos importance=noise.
- Usa importance_counts para dar contexto ("tienes 3 correos críticos y 5 importantes sin atender").
- NUNCA inventes correos, remitentes ni cifras que no estén en classified_threads.
```

---

## Parte 3 — Bandeja real en el dashboard

Fichero: `app/dashboard/emails/page.tsx`.

- Reorganiza la página en **dos pestañas (tabs)**:
  1. **"Bandeja"** (nueva, por defecto): la bandeja de Gmail clasificada.
  2. **"Enviar"**: el formulario + historial actual de correos salientes (lo que ya existe; consérvalo tal cual, no rompas el flujo de Resend ni la tabla `messages`).
- La pestaña Bandeja hace `fetch('/api/agent/gmail/summary')` desde el navegador. **El route ya soporta sesión de browser** (`verifyAgentOrBrowserRequest`), así que no hace falta pasar `user_id`.
- Render:
  - Agrupa por importancia: **Críticos** y **Importantes** arriba (badge de color: rojo/ámbar), **Normales** en medio, **Ruido** colapsado bajo un "Ver N correos de baja prioridad".
  - Por correo: `from_name`, badge de `category`, asunto, snippet, `hours_waiting` ("hace 26h"), y `importance_reason` en texto pequeño.
  - Estados: cargando (skeleton), `status='not_connected'` → CTA "Conecta Gmail" que enlaza a `/dashboard/settings/integrations`. `status='decrypt_failed'` → aviso "Reconecta Gmail". `status` de error/rate_limited → mensaje suave. Bandeja vacía pero conectado → "No hay correos pendientes, todo al día".
- **Corrige el `InfoFlipCard`**: el `what`/`howTo` actuales prometen una bandeja que antes no existía; ahora sí, así que ajústalos para que describan correctamente la bandeja clasificada + el envío.

(Si prefieres no tocar la página existente, crea `app/dashboard/inbox/page.tsx` y enlázala en el nav; pero la opción recomendada es las pestañas en `emails` porque es donde el usuario ya busca "sus correos".)

---

## Parte 4 — Nudge: conectar el correo de empresa

Objetivo: que el usuario conecte su correo profesional, no el personal, para reducir ruido.

- **`app/dashboard/settings/integrations/page.tsx`**, tarjeta de Gmail (`id: 'gmail'`): añade bajo la descripción una nota discreta antes de conectar:
  > *Recomendación: conecta el correo de tu negocio (p.ej. info@tunegocio.com) en lugar de tu correo personal, para que el agente se centre en clientes y proveedores y no en correo personal.*
- **`components/OnboardingChecklist.tsx`**: en el paso de conectar Gmail, incluye el mismo consejo en una línea.
- Es solo copy + UI; no hace falta lógica nueva.

---

## Parte 5 — Inspector (depuración)

`app/dashboard/dev/agent-inspector/page.tsx`, bloque "Gmail intel": añade `importance_counts` y muestra `classified_threads` con su `importance`, `importance_reason` y `classified_by` (para ver qué resolvió la heurística vs Haiku).

---

## Constraints técnicos

- TypeScript estricto, evita `any` (especialmente al parsear el JSON de Haiku: define un tipo y valida).
- Cada endpoint summary responde en **<5s**; el batch de Haiku no puede romper esto (timeout + fallback).
- Si Google o Anthropic fallan → `200` con `status`/flag explícito, **nunca 500**.
- Privacy: a Haiku solo metadata + snippet ≤200 chars; sin cuerpos completos; sin loguear contenido.
- Coste: una sola llamada Haiku por ejecución, cap de correos a clasificar, y caché si la implementas.

## Archivos clave

- `lib/agent/intelligence/gmail.ts` — categoría/prioridad/importancia (núcleo).
- `lib/agent/intelligence/email-importance.ts` — **NUEVO** (si extraes la lógica de importancia + Haiku).
- `app/api/agent/gmail/summary/route.ts` — pasa emails de `clients` conocidos a `fetchGmailIntel`; el payload ya fluye.
- `app/dashboard/emails/page.tsx` — pestañas Bandeja/Enviar.
- `app/dashboard/settings/integrations/page.tsx` y `components/OnboardingChecklist.tsx` — nudge.
- `app/dashboard/dev/agent-inspector/page.tsx` — visualizar importancia.
- `~/Desktop/enlaze/n8n-workflow-comercio-local-v6.3.json` — `Run User Modules` + `Build Claude Prompt` + system prompt.
- `AGENT_AUDIT.md` — añade sección "Bloque 2 — Clasificación de importancia".
- Patrón Anthropic de referencia: `app/api/agent/market/analysis/route.ts`, `app/api/agent/budget-analysis/route.ts`.

## Criterios de aceptación

- [ ] `GmailIntel` expone `classified_threads`, `importance_counts` y cada hilo lleva `importance` + `importance_reason` + `classified_by`.
- [ ] Heurística mejorada: un cliente recurrente desde freemail ya NO cae en `unknown`/`normal` por defecto; sale `customer` con importancia adecuada.
- [ ] Fallback Haiku en batch (1 llamada) para los ambiguos, con parseo tolerante y fallback heurístico si falla; sin 500; <5s.
- [ ] A Haiku no se le manda cuerpo completo de correos, ni se loguea contenido.
- [ ] La pestaña Bandeja de `/dashboard/emails` muestra los correos reales de Gmail ordenados por importancia, con estados de no-conectado/error/vacío. La pestaña Enviar sigue funcionando igual.
- [ ] `Build Claude Prompt` incluye `classified_threads` (critical/important) + `importance_counts` en el ctx; el system prompt instruye a abrir con los críticos y omitir el ruido.
- [ ] Nudge de "correo de empresa" visible en integraciones y onboarding.
- [ ] Inspector muestra la clasificación con su origen (heuristic/haiku).
- [ ] `npx tsc --noEmit -p tsconfig.json` limpio.
- [ ] `npm run build` limpio.
- [ ] `AGENT_AUDIT.md` documenta el motor, el prompt de Haiku, los niveles de importancia, y los casos donde puede fallar.

## Estilo

- Castellano peninsular, directo.
- Helpers en `lib/agent/intelligence/`; no metas 300 líneas en el route.
- Logging con prefijo `[agent/intel/gmail]`, solo metadata.
- Commit sugerido: `feat(agent): email importance classification (heuristic+Haiku) + dashboard inbox + business-email nudge`.

## Verificación previa (antes de empezar a programar)

Confirma que Gmail está realmente conectado y trayendo datos, o no tendrás con qué probar:

1. `NEXT_PUBLIC_DEV_TOOLS_ENABLED=true npm run dev`
2. Abre `http://localhost:3000/dashboard/dev/agent-inspector` logueado como idkdu37@gmail.com.
3. Fila `gmail` → "Endpoint live": `status=active` = OK. `decrypt_failed` = problema de `OAUTH_ENCRYPTION_KEY` local vs prod (reconecta o re-encripta). `not_connected` = conéctalo en `/dashboard/settings/integrations` (requiere en Google Cloud Console: redirect URI `http://localhost:3000/api/auth/google/callback` + idkdu37@gmail.com como Test User).
4. Si "Gmail intel" muestra `total_unread` y `threads_awaiting_reply` con datos → adelante.

## Cuando termines, muéstrame

1. Captura del inspector con `importance_counts` y la clasificación (heuristic vs haiku).
2. La pestaña Bandeja del dashboard con correos reales clasificados.
3. Un briefing de prueba que abra citando los correos críticos por nombre.
4. La sección añadida a `AGENT_AUDIT.md`.

---

## ADDENDUM — Aprovechar el contexto de sector (ya implementado en el bloque 3)

Desde que se escribió este brief se implementó la especialización por sector. Ahora
`/api/agent/config` ya devuelve `agent_persona_prompt`, `agent_name` y `sector_intel`
(ver `lib/agent/sector-intel.ts` y `AGENT_AUDIT.md`, "Bloque 3"). La clasificación de
correos debe apoyarse en eso para acertar más con clientes/proveedores:

1. **Heurística enriquecida con `supplier_types`:** `sector_intel.supplier_types` lista
   los tipos de proveedor típicos del subsector (p.ej. en hostelería: "distribuidor de
   alimentación/horeca", "bodega"; en estética: "distribuidor de producto profesional").
   Úsalo como señal extra al categorizar `supplier`: si el remitente o el dominio casa
   con esos tipos/marcas, sube la confianza de `category='supplier'`. Pásale a
   `fetchGmailIntel` (o al clasificador) los `supplier_types` del usuario, igual que ya
   se le pasan los emails de `clients` conocidos.

2. **Haiku con persona de sector:** en la llamada batch a Haiku para los correos
   ambiguos, incluye en el contexto de negocio el `agent_name`/sector y 1 frase del
   `agent_persona_prompt`. Así Haiku clasifica "importante vs ruido" sabiendo que es,
   p.ej., una peluquería (una confirmación de cita de cliente es crítica) y no un
   bufete (donde lo crítico es un plazo procesal). No mandes el prompt entero — solo el
   nombre del sector y una línea de contexto, para no inflar tokens.

3. **Reutiliza la fuente de verdad:** el sector sale de `profiles.business_sector` vía
   `/api/agent/config`. No reintroduzcas lógica de sector en el route de Gmail; consume
   lo que ya devuelve config.

**Criterio de aceptación añadido:**
- [ ] La categorización de `supplier` usa `sector_intel.supplier_types` del usuario.
- [ ] El batch de Haiku recibe el sector/persona del negocio como contexto.
- [ ] No se duplica lógica de sector; se consume `/api/agent/config`.
