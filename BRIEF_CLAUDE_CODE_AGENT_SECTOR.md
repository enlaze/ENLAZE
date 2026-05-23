# Brief para Claude Code — Especializar el agente diario por sector/subsector de comercio local

## Contexto

ENLAZE tiene un agente diario (Claude Sonnet vía n8n) que genera briefings. Hoy el briefing es **genérico**: el dashboard muestra "Sin noticias", el agente no trae nada específico del sector, y lo único que aparece son campañas de marketing muy genéricas. El usuario (negocios de comercio local) abarca subsectores muy distintos — una peluquería y una hostelería no necesitan ni las mismas noticias, ni los mismos KPIs, ni las mismas campañas.

**Diagnóstico (ya investigado, no lo repitas, constrúyelo):**

1. **El subsector YA se captura pero no se usa.** `app/onboarding/page.tsx` guarda el subsector granular en `profiles.business_sector` con claves como `hosteleria`, `estetica`, `salud`, `comercio`, `otro`. Esas claves **coinciden** con las personas detalladas que ya existen en `lib/agent-prompts.ts` (`sectorConfigs`: `construccion`, `legal`, `hosteleria`, `salud`, `comercio`, `automocion`, `estetica`, `educacion`, `tecnologia`, `eventos`, `otro`).

2. **El briefing diario ignora esa persona.** `/api/agent/config/route.ts` devuelve `sector: business_sector || "comercio_local"` y `getSectorConfig()` colapsa `comercio_local`/`retail` → `comercio` genérico. El nodo `Build Claude Prompt` de n8n arma su propio prompt inline y **no usa `getSectorConfig`**. Resultado: aunque el negocio sea una peluquería, el agente usa prosa genérica de retail.

3. **No hay fetch de noticias por sector.** El workflow `n8n-workflow-comercio-local-v6.3.json` solo tiene nodos `Fetch Shared Sources`, `Fetch Precio Luz`, `Fetch Precios Combustible`. No existe ningún nodo que busque noticias del sector. `/api/agent/ingest` SÍ sabe escribir en `agent_news` (lo hace si recibe filas), pero nadie le manda noticias. Por eso `agent_news` está vacío.

## Objetivo

Hacer que el agente sea **específico por subsector**: que elija la persona correcta, traiga noticias relevantes de ese subsector y la zona del negocio, y que sus KPIs, campañas, alertas y calendario sean los propios del subsector. Tras el cambio, una peluquería y una hostelería deben recibir briefings claramente distintos y útiles.

Ejemplos del objetivo:

- **Peluquería:** *"Se acerca la temporada de bodas (mayo-jun): sube demanda de recogidos y color. Tu agenda del jueves tiene 3 huecos de tarde — lanza promo de mechas. Noticia: nueva normativa de residuos de productos químicos de peluquería en tu CCAA."*
- **Hostelería:** *"El precio del aceite de oliva sigue al alza (+8% mes); revisa escandallo de fritos. Esta semana hace buen tiempo → prepara terraza. Recordatorio APPCC: registro de temperaturas. Cenas de empresa de Navidad: abre reservas ya."*

## Decisiones ya tomadas (NO preguntes, aplícalas)

### A. `business_sector` es la única fuente de verdad del subsector

- El subsector del negocio = `profiles.business_sector`, con valores normalizados a las claves de `sectorConfigs` en `lib/agent-prompts.ts`.
- **Deja de colapsar a "comercio_local".** Para el agente diario, si `business_sector` es una clave válida de `sectorConfigs`, úsala tal cual. `comercio_local`/`retail` siguen mapeando a `comercio` como fallback razonable, pero un negocio que eligió `hosteleria`/`estetica` debe conservar su clave.
- Revisa `app/onboarding/page.tsx`: hoy ofrece pocas opciones (vimos `hosteleria`, `estetica`, `otro` y alguna más recortada en pantalla). Asegúrate de que el selector ofrece **todas** las claves de comercio local relevantes (mínimo: `hosteleria`, `estetica`, `comercio`, `salud`, `automocion`, `educacion`, y `otro`), con icono y descripción, y que guarda exactamente la clave de `sectorConfigs`.

### B. Nuevo "perfil de inteligencia" por sector (en código, no en n8n)

Crea `lib/agent/sector-intel.ts` con un registro `SECTOR_INTEL: Record<string, SectorIntelProfile>` keyed por las mismas claves de `sectorConfigs`. Cada perfil:

```typescript
interface SectorIntelProfile {
  sector_key: string;
  // Noticias: queries para Google News RSS (ES), específicas del subsector.
  news_queries: string[];          // p.ej. hostelería: ["hostelería España", "precio materias primas restauración", "normativa terrazas <ciudad>"]
  news_max_items: number;          // por defecto 5
  // Qué métricas vigilar y nombrar en el briefing.
  kpis_focus: string[];            // hostelería: ["ticket medio","food cost %","ocupación mesas","mermas"]; peluquería: ["ocupación agenda","rebooking %","ticket medio","ratio servicio/producto"]
  // Calendario propio del subsector (además del retail genérico ya existente).
  seasonal_focus: Array<{ key: string; name: string; months: number[]; note: string }>;
  // Arquetipos de campaña reales del subsector.
  campaign_archetypes: string[];
  // Normativa/recordatorios operativos a citar cuando aplique.
  regulatory_notes: string[];      // hostelería: ["APPCC: registro temperaturas","alérgenos en carta"]; estética: ["gestión residuos químicos","RGPD fotos antes/después"]
  // Tipos de proveedor típicos (ayuda a categorizar Gmail y sugerir compras).
  supplier_types: string[];
}
```

Rellena perfiles de calidad para al menos: `hosteleria`, `estetica`, `comercio`, `salud`, `automocion`, y un `default` para `otro`/desconocido. Que sean concretos y españoles, no genéricos.

### C. `/api/agent/config` expone la persona + el perfil de intel

- Extiende `/api/agent/config/route.ts` para que, además de lo que ya devuelve, incluya:
  - `agent_persona_prompt`: el `prompt` de `getSectorConfig(business_sector)` (la persona rica que hoy se ignora).
  - `agent_name`: el `agent_name` de esa config.
  - `sector_intel`: el `SectorIntelProfile` resuelto (con `news_queries` ya interpoladas con `city` cuando el query lo pida).
- Así n8n recibe todo resuelto y **no duplica lógica de sector**. La fuente de verdad queda en el código TS.

### D. Fetch real de noticias por sector (lo que llena "Noticias")

Implementa el fetch de noticias así (orden de preferencia):

1. **Endpoint nuevo `app/api/agent/news/route.ts`** (server-side, llamado por n8n por cada usuario con `?user_id=`): 
   - Lee `sector_intel.news_queries` del usuario.
   - Para cada query, consulta **Google News RSS** (`https://news.google.com/rss/search?q=<query>&hl=es&gl=ES&ceid=ES:es`) — es gratis y sin API key. Parsea el XML (título, link, fecha, fuente).
   - Dedup por título/URL, ordena por fecha desc, recorta a `news_max_items` por sector (total ~5-8).
   - **(Recomendado) Resumen con Haiku en 1 línea**: por cada noticia, una frase "por qué le importa a un/a {sector} en {ciudad}". Una sola llamada batch a Haiku (modelo Haiku más reciente, ver patrón en `app/api/agent/market/analysis/route.ts`). Si Haiku falla, deja la noticia sin resumen (no bloquees).
   - Devuelve `{ news: [{ title, url, source, published_at, why_relevant?, sector }] }`.
   - Robustez: si Google News falla o no hay red → `200 { news: [] }`, nunca 500. Timeout total <8s.
   - Privacy/coste: no loguees contenido completo; cachea por sector+ciudad unas horas si puedes (evita re-fetch por cada usuario del mismo sector el mismo día).

2. **n8n**: añade un nodo `Fetch Sector News` que, por cada usuario, llame a `/api/agent/news?user_id=...` y meta el resultado en el payload. Luego, en el `ingest`, esas noticias se envían a `/api/agent/ingest` (que ya inserta en `agent_news`). Asegúrate de mapear los campos al esquema que `agent_news` espera (mira `app/api/agent/ingest/route.ts` y la tabla; incluye `user_id`, `title`, `url`/`source`, `summary`, `created_at`).

> Nota: si prefieres no tocar n8n para el fetch, el endpoint `/api/agent/news` puede además **escribir directamente** en `agent_news` para ese `user_id` (idempotente: no dupliques por URL+día). Elige una sola vía de escritura para no duplicar noticias.

### E. n8n `Build Claude Prompt`: usar persona + intel + noticias

- Usa `agent_persona_prompt` (de `/api/agent/config`) como base del system prompt en lugar del genérico actual. Mantén las reglas anti-alucinación y la sección "USO DE DATOS DE INTEGRACIONES" que ya existen.
- Inyecta en el `ctx`: `sector_intel` (kpis_focus, seasonal_focus, campaign_archetypes, regulatory_notes) y las `news` recopiladas.
- Añade reglas al system prompt:

```
ESPECIALIZACIÓN POR SECTOR (OBLIGATORIO):
- Eres el agente del sector {agent_name}. Razona y prioriza como un experto de ESE sector.
- Usa kpis_focus para decidir qué cifras de ventas/agenda destacar.
- Si hay news relevantes, cita 1-2 por título y explica en una frase por qué importan al negocio.
- Aplica seasonal_focus del sector (no solo el calendario retail genérico).
- Cuando toque, recuerda un punto de regulatory_notes (p.ej. APPCC en hostelería) sin sonar a abogado.
- Propón campañas inspiradas en campaign_archetypes del sector, adaptadas a los datos reales del negocio. NADA de campañas genéricas tipo "haz una promo".
- NUNCA inventes noticias, cifras ni normativas que no estén en el ctx.
```

## Constraints técnicos

- TypeScript estricto, sin `any` (define tipos para el parseo del RSS y del JSON de Haiku).
- Endpoints responden <8s (news con su timeout + fallback vacío). Nunca 500.
- Sin claves nuevas: usa `ANTHROPIC_API_KEY` ya presente. Google News RSS no necesita key.
- No loguees contenido; solo metadata/counts con prefijo `[agent/news]`.
- Idempotencia de `agent_news`: no duplicar la misma noticia (misma URL) para el mismo usuario el mismo día.

## Archivos clave

- `lib/agent-prompts.ts` — `sectorConfigs` (personas) y `getSectorConfig`. Ajusta el colapso de `comercio_local`.
- `lib/agent/sector-intel.ts` — **NUEVO** registro de perfiles de inteligencia por sector.
- `app/api/agent/config/route.ts` — devolver `agent_persona_prompt`, `agent_name`, `sector_intel`.
- `app/api/agent/news/route.ts` — **NUEVO** fetch de noticias por sector (Google News RSS + Haiku opcional).
- `app/api/agent/ingest/route.ts` — referencia del esquema de `agent_news` (no romper su contrato).
- `app/onboarding/page.tsx` — ampliar el selector de subsector a todas las claves relevantes; guardar la clave exacta de `sectorConfigs`.
- `~/Desktop/enlaze/n8n-workflow-comercio-local-v6.3.json` — nodo `Fetch Sector News`, y `Build Claude Prompt` usando persona + intel + news. Haz backup antes.
- `AGENT_AUDIT.md` — nueva sección "Bloque 3 — Especialización por sector".
- Patrón Anthropic: `app/api/agent/market/analysis/route.ts`, `app/api/agent/budget-analysis/route.ts`.

## Criterios de aceptación

- [ ] `business_sector` no se colapsa: un negocio `hosteleria`/`estetica` conserva su clave hasta el prompt del briefing.
- [ ] Existe `lib/agent/sector-intel.ts` con perfiles concretos para al menos hosteleria, estetica, comercio, salud, automocion + default.
- [ ] `/api/agent/config` devuelve `agent_persona_prompt`, `agent_name` y `sector_intel` (con news_queries interpoladas con la ciudad).
- [ ] `/api/agent/news` devuelve noticias reales del subsector (Google News RSS), con resumen Haiku opcional, `200` siempre, <8s, dedup.
- [ ] El dashboard "Noticias" deja de estar vacío para un usuario con sector configurado (las noticias llegan a `agent_news`).
- [ ] `Build Claude Prompt` usa la persona del sector + inyecta sector_intel y news; el system prompt incluye las reglas de ESPECIALIZACIÓN POR SECTOR.
- [ ] Onboarding ofrece y guarda correctamente el subsector.
- [ ] Dos usuarios de distinto subsector producen briefings claramente distintos (incluye en la prueba un ejemplo hostelería vs peluquería).
- [ ] `npx tsc --noEmit -p tsconfig.json` limpio. `npm run build` limpio.
- [ ] `AGENT_AUDIT.md` documenta el taxonomy, los perfiles, las fuentes de noticias y los casos donde puede fallar (p.ej. sector `otro`).

## Estilo

- Castellano peninsular, directo.
- Perfiles de sector concretos y realistas (España): nada de placeholders genéricos.
- Helpers en `lib/agent/`; routes finos.
- Commit sugerido: `feat(agent): sector-specific briefings — persona routing, sector intel profiles, real sector news`.

## Verificación previa

Confirma el sector del usuario de prueba en BD (`profiles.business_sector` de idkdu37@gmail.com) y, si está como `comercio_local`/vacío, ponlo a un subsector concreto (p.ej. `estetica`) para poder ver la diferencia. Comprueba en `/dashboard/dev/agent-inspector` que `ctx` recibe la persona, el sector_intel y las news tras una ejecución.

## Cuando termines, muéstrame

1. Briefing de un negocio de hostelería y otro de peluquería, lado a lado, mostrando que son distintos y específicos.
2. El dashboard "Noticias" con noticias reales del sector.
3. El `ctx` del inspector con `agent_persona_prompt`, `sector_intel` y `news`.
4. La sección añadida a `AGENT_AUDIT.md`.

---

## ADDENDUM (importante) — El subsector no es visible/editable en la web: unificar fuente de verdad

**Síntoma reportado por el usuario:** "no sale el subsector dentro de la web, solo sale el sector".

**Causa:** hay DOS fuentes de verdad desacopladas (es la tech debt "Unificación del Dominio Sector" de `MULTI_SECTOR_WIZARD_TECH_DEBT.md`):

- `app/onboarding/page.tsx` guarda el subsector granular en **`profiles.business_sector`** (claves: `hosteleria`, `estetica`, `salud`, `comercio`, `automocion`, `legal`, `educacion`, `tecnologia`, `eventos`, `construccion`, `otro`). Estas coinciden con `sectorConfigs`.
- `app/dashboard/settings/sector/page.tsx` lee opciones de la tabla **`sector_config`** y guarda en **`fiscal_settings.sector_key`** (categorías más gruesas). Editar aquí NO actualiza `business_sector`, y es lo único que ve el usuario tras el onboarding.

Resultado: el subsector queda "escondido" y se desincroniza del campo que realmente lee el agente.

**Qué hacer (decisión tomada):**

1. **Única fuente de verdad = `profiles.business_sector`** para todo lo relativo al agente (persona, intel, noticias). El endpoint `/api/agent/config` ya lee `business_sector`; mantenlo.
2. **Hacer el subsector visible y editable en Ajustes → Sector** (`app/dashboard/settings/sector/page.tsx`):
   - Que el selector ofrezca la MISMA lista granular que el onboarding (reutiliza una constante compartida; ver punto 4).
   - Que al guardar escriba en **`profiles.business_sector`** (y, si quieres conservar `fiscal_settings.sector_key` para terminología/UI, manténlo sincronizado escribiendo ambos, pero `business_sector` manda).
   - Que al cargar, preseleccione el valor actual de `profiles.business_sector`.
3. **Sincronizar `sector-context`** (`lib/sector-context.ts` / `useSector`): que su `sectorKey` derive de `profiles.business_sector` para que toda la UI y el agente miren lo mismo. Si hoy deriva de `fiscal_settings.sector_key`, cámbialo o haz que ambos converjan.
4. **Una sola lista de sectores compartida**: extrae la lista (id, icon, name, desc) a un módulo común (p.ej. `lib/sectors.ts`) y consúmela tanto en onboarding como en Ajustes, para que nunca diverjan. Las `id` deben ser exactamente las claves de `sectorConfigs`.
5. **Migración suave**: para perfiles existentes cuyo `business_sector` sea `comercio_local`/vacío pero que tengan `fiscal_settings.sector_key` más específico, considera un backfill puntual que copie el valor más específico a `business_sector`. Documenta cualquier migración SQL en `supabase/migrations`.

**Criterios de aceptación añadidos:**

- [ ] En Ajustes → Sector el usuario ve y puede cambiar su subsector granular (mismas opciones que el onboarding).
- [ ] Guardar en Ajustes actualiza `profiles.business_sector`, y `useSector`/`sector-context` reflejan ese valor sin recargar a mano.
- [ ] Onboarding y Ajustes consumen la MISMA lista de sectores (sin listas duplicadas divergentes).
- [ ] El agente (`/api/agent/config`) resuelve la persona y el `sector_intel` a partir de ese mismo `business_sector`.
