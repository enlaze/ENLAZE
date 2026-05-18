# Brief para Claude Code — Observabilidad y auditoría del agente

## Contexto

ENLAZE es un SaaS B2B para pequeños negocios. El núcleo de valor es un **agente diario** que cada mañana genera un briefing (titular, narrativa, acciones priorizadas) para el dueño del negocio. El briefing lo genera Claude (actualmente Sonnet 4.6, vía API directa de Anthropic) dentro de un workflow de n8n (`~/Desktop/enlaze/n8n-workflow-comercio-local-v6.3.json`), tomando como input datos agregados que se obtienen llamando a varios endpoints `/api/agent/*` del propio Next.js.

**El problema actual:** el briefing alucina datos (afirma que Día de la Madre está al caer cuando ya pasó hace 15 días) **y** dice cosas falsas sobre el estado del usuario (afirma que Gmail/Calendar/Sheets no están conectados cuando sí lo están). Esto significa que **o el agente no recibe la verdad de los datos**, **o el modelo está fabricando**. Sin saber qué ve exactamente el agente, no podemos iterar.

## Objetivo

Construir la observabilidad mínima necesaria para que el equipo (humano + IA) pueda **iterar el agente con velocidad y certeza**:

1. **Saber exactamente qué contexto recibe Claude** en cada ejecución del briefing.
2. **Auditar bugs del data layer** (módulos que el agente cree desconectados aunque estén conectados, fechas que no llegan, etc.).
3. **Comparar fácilmente dos ejecuciones** (qué cambió, qué mejoró, qué empeoró).

## Decisiones tomadas (no preguntes, aplícalas)

1. **Una página nueva `/dashboard/dev/agent-inspector`** (server component, gated por una variable de entorno `NEXT_PUBLIC_DEV_TOOLS_ENABLED=true` o por rol — tú decides cuál es más limpio).
2. Para el `user_id` logeado, esa página muestra **todo lo que el agente verá** la próxima vez que se ejecute: el `ctx` completo que se enviaría a Claude (igual al que construye el nodo "Build Claude Prompt" del workflow).
3. **Llama a los mismos endpoints `/api/agent/*`** que llama n8n. Re-implementa la lógica de fetch en TypeScript (no llames a n8n). Si esto requiere que esos endpoints acepten autenticación tanto por `AGENT_API_KEY` como por cookie de sesión Supabase, mira `app/api/agent/_lib/auth.ts` — ya tiene una helper `verifyAgentOrBrowserRequest` que parece pensada para eso, úsala.
4. La página renderiza en bloques expandibles:
   - **Identidad del usuario** (id, email, business_name, sector, agent_enabled, agent_modules_enabled).
   - **Estado de módulos** (gmail, calendar, sheets, reputation: cada uno con `connected: bool`, `last_sync_at`, `error_message` si hay, y un snippet de la última payload).
   - **Datos del briefing** (lo que el agente envía a Claude — un JSON pretty-printed, igual al `ctx` del nodo Build Claude Prompt).
   - **Último briefing generado** (lo que devolvió Claude la última vez — el `ai_briefing` completo + el contexto que recibió, si lo guardamos).
   - **Calendario retail** (upcoming + recently_passed eventos según el cálculo en JS).
5. **Logs de las últimas 5 ejecuciones del agente para este usuario**: timestamp, modelo usado, tokens, ai_briefing.headline, score, y un botón "ver contexto completo" que abre un modal con el JSON enviado.
6. Si la página detecta **inconsistencias** (ej. `agent_connections.connected=true` pero el último briefing decía "no conectado"), las muestra en rojo arriba como **"alertas de coherencia"**.

## Auditoría obligatoria de bugs conocidos

Mientras construyes la página, vas a tocar el data layer. Documenta y arregla (o documenta por qué no se puede arreglar ahora) los siguientes bugs:

### Bug A: agente cree que módulos no están conectados

El último briefing afirma *"tienes 4 módulos sin conectar (Gmail, Calendar, Reputación, Sheets)"* pero el usuario (id `c6c7e97a-6b17-4d66-9950-4674a5992633`) acaba de conectar Gmail, Calendar y Sheets vía OAuth. La tabla `agent_connections` tiene 3 filas para ese usuario con `connected=true`.

Investiga:

1. Que `/api/agent/config?user_id=c6c7e97a-...` devuelve `gmail_connected: true`, `google_calendar_connected: true`, etc.
2. Que `/api/agent/gmail/summary?user_id=c6c7e97a-...` devuelve `connected: true` y datos reales, no el fallback `{ connected: false, _setup: "Configurar OAuth Gmail" }`.
3. Idem `calendar/summary`, `sheets/summary`, `reputation/summary`.
4. Si alguno de esos endpoints está devolviendo `connected: false` cuando debería ser `true`, mira la lógica interna y arréglala.

Pista probable: el endpoint puede estar fallando a la hora de **desencriptar el access_token** porque la conexión se hizo con la `OAUTH_ENCRYPTION_KEY` actual (local) mientras que la pre-existente en Vercel está cifrada con otra clave. Mira `lib/crypto.ts` y maneja el error de decrypt con gracia (devolver `connected: false, status: 'decrypt_failed'` en lugar de 500). Pero antes confirma que ese es realmente el problema.

### Bug B: alucinaciones de fechas pese al prompt

Aunque el nodo "Build Claude Prompt" (en `~/Desktop/enlaze/n8n-workflow-comercio-local-v6.3.json`) pasa `ctx.upcoming_retail_events` y `ctx.recently_passed_retail_events`, Claude las ignora a veces. Sospecho que la causa es que el contexto del briefing **viene cargado de campos del `daily_summary` mecánico que repiten "Día de la Madre"** (el `buildDailySummary` original mete "campaña sugerida" sin contexto temporal). Investiga:

1. Lee el `Run User Modules` en el workflow y mira qué genera `buildDailySummary` cuando estamos a 14+ días de Día de la Madre. Si sigue metiendo recomendaciones de Día de la Madre, **propón** una corrección al `buildDailySummary` (no la apliques sin mi confirmación, sólo deja un comentario `// TODO(observability): este recommendation deberia respetar el calendario retail`).
2. Comprueba que `ctx.mechanical_summary` que se envía a Claude no contiene strings con "Día de la Madre" cuando el calendario no lo incluye.

### Bug C: usuarios fantasma

Hay dos perfiles en `profiles` con `agent_enabled=true`:

- `64314010-8300-4c7c-9d1d-8fcfbf6a0f8c` — "Panadería San Juan" (test creado por un compañero)
- `c6c7e97a-6b17-4d66-9950-4674a5992633` — "ENLAZE" (idkdu37@gmail.com — el usuario real)

El agente procesa ambos en cada ejecución. **No los borres**, pero en la inspección visualiza claramente cuál es cuál y permite seleccionar entre ellos con un dropdown si el usuario es admin.

## Archivos clave a tocar

- `app/api/agent/config/route.ts`, `app/api/agent/{gmail,calendar,sheets,reputation}/summary/route.ts` — endpoints que el agente consume. Posibles correcciones de manejo de errores.
- `app/api/agent/_lib/auth.ts` — utilidad de autenticación dual (agent key + cookie de sesión).
- `lib/crypto.ts` — encryption layer; añade manejo de errores graceful.
- `app/dashboard/dev/agent-inspector/page.tsx` (NUEVO) — la página que vamos a construir.
- `components/dashboard/AgentExperience.tsx` — referencia para sacar tipos.
- `lib/agent/build-context.ts` (NUEVO opcional) — extracción del cálculo de `ctx` que hace el nodo "Build Claude Prompt" del workflow a TypeScript reutilizable. Si lo haces, el nodo de n8n puede llamar a un endpoint `/api/agent/build-context?user_id=X` en vez de duplicar lógica. **No es obligatorio**, sólo si lo ves limpio.

## Criterios de aceptación

- [ ] Existe `/dashboard/dev/agent-inspector` y se accede sólo con la flag de dev tools (o con rol admin — tu criterio).
- [ ] Entrando como `idkdu37@gmail.com`, la página muestra estado real de Gmail/Calendar/Sheets/Reputación, con `connected: true` para los conectados.
- [ ] La página muestra el JSON `ctx` exacto que el agente envía a Claude, formateado y expandible.
- [ ] La página detecta y resalta en rojo si hay incoherencia entre `agent_connections.connected` y lo que el último briefing dijo sobre conexión.
- [ ] Si algún endpoint del agente falla a desencriptar tokens, devuelve `connected: false, status: 'decrypt_failed', error_message: 'mensaje legible'` en lugar de 500.
- [ ] Si encuentras que `buildDailySummary` mete contenido de eventos pasados, deja un `TODO(observability)` en su lugar (no lo arregles sin confirmar).
- [ ] `npx tsc --noEmit -p tsconfig.json` pasa limpio.
- [ ] `npm run build` pasa.

## Estilo

- TypeScript estricto. Nada de `any` salvo cuando sea defendible.
- Tailwind con las utility classes ya en el proyecto.
- Server components donde sea posible; client components sólo para interactividad.
- La página puede ser fea — es una herramienta interna. Prioriza información sobre estética.

## Verificación al terminar

1. `npx tsc --noEmit -p tsconfig.json`
2. `npm run build`
3. `npm run dev` y entrar como `idkdu37@gmail.com` a `http://localhost:3000/dashboard/dev/agent-inspector`. Deja captura del resultado o un README breve de qué se ve.

## Si encuentras algo gordo

Si en la auditoría descubres que el agente tiene un bug estructural (por ejemplo, llama a endpoints que ya no existen, o usa una tabla deprecada), **no lo arregles silenciosamente**. Documéntalo en un fichero `AGENT_AUDIT.md` que dejes en la raíz, y para arreglarlo crea un commit aparte con mensaje claro tipo `fix(agent): handle decrypt errors in gmail summary`.

---

## ACTUALIZACIÓN URGENTE (Bug C confirmado tras testing)

Tras subir el modelo a Sonnet 4.6 y endurecer el prompt anti-alucinación, el briefing sigue mencionando "Día de la Madre" como evento urgente — incluso aunque ya pasó hace 15 días. La causa **NO es el modelo, es el data layer**:

Dentro del nodo "Run User Modules" del workflow (`~/Desktop/enlaze/n8n-workflow-comercio-local-v6.3.json`) existe un map hardcodeado del estilo:

```javascript
const SEASONAL_CAMPAIGNS = {
  2: { title: 'Día del Padre', ... },
  4: { title: 'Día de la Madre: máximo gasto medio', steps: [...] },
  8: { title: 'Vuelta al cole: reactivación', ... },
};
```

Y a continuación se aplica `SEASONAL_CAMPAIGNS[currentMonth]` sin mirar el DÍA del mes. Resultado: durante todo mayo, el agente recomienda Día de la Madre como acción urgente — el primer día y el día 31. Lo mismo en marzo (Día del Padre), septiembre (vuelta al cole), etc.

**Tarea adicional para esta auditoría:**

1. Localiza `SEASONAL_CAMPAIGNS` en `Run User Modules` y refactorízalo para que respete el día exacto. Reglas:
   - Sólo dispara la campaña si la fecha del evento está en **los próximos 14 días** desde hoy, NO si simplemente estamos en el mes correcto.
   - Día de la Madre = primer domingo de mayo (no día fijo).
   - Día del Padre en España = 19 de marzo.
   - Vuelta al cole = ventana del 25 agosto al 15 septiembre.
2. La fuente única de la verdad debe ser el `buildSpanishCalendarContext()` que ya existe en el nodo "Build Claude Prompt". Mejor extraer esa función a un módulo reutilizable y consumirlo desde ambos sitios.
3. Verifica que tras el refactor, ejecutando hoy (18 mayo 2026), `SEASONAL_CAMPAIGNS` no dispara nada (Día de la Madre fue el 3 mayo, fuera de ventana).

Criterio de aceptación adicional: ejecutar el workflow tras tu refactor y confirmar que el `daily_summary.priority_actions` NO menciona ningún evento estacional pasado.
