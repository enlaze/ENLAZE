# Brief para Claude Code — Mover el agente al centro de control

## Contexto

Tenemos un agente automatizado que corre en n8n (workflow `ENLAZE — Comercio Local v6.3 Retail` en `~/Desktop/enlaze/n8n-workflow-comercio-local-v6.3.json`). Cada día tira de noticias, BOE/subvenciones, precios de combustible y de luz, datos del INE, etc. y produce un payload por cliente que el endpoint `app/api/agent/ingest/route.ts` guarda en Supabase (tabla `agent_daily_summary` + tablas relacionadas: `agent_news`, `agent_signals`, `agent_reviews`, `agent_campaigns`, `agent_leads`, `agent_tasks`).

Recientemente se ha añadido un nodo Claude al workflow que genera un `daily_summary.ai_briefing` real en lenguaje natural (titular, narrativa, top_actions priorizadas, watch_outs, opportunities, mood). Eso llega íntegro dentro de `raw_payload` de la fila de `agent_daily_summary` (el endpoint `ingest` guarda el JSON completo en esa columna).

La página `app/dashboard/agent/page.tsx` ya consume y muestra el `ai_briefing` correctamente con una tarjeta encabezada por "Resumen del día · generado por IA". Esa parte funciona.

## El problema de producto

`/dashboard/agent` está enterrada en el sidebar como "Asistente IA" — el cliente entra a la home, ve KPIs financieros, y el briefing del agente queda como un sitio secundario al que casi nadie va. **No tiene sentido tenerlo apartado: es lo más valioso que ve un comercio local cada día.**

## Objetivo

Mover toda la experiencia del agente al centro de control (la home del dashboard, `app/dashboard/page.tsx`) y convertirla en lo **primero** que ve el cliente al entrar a su cuenta. Eliminar (o convertir en redirect) la ruta `/dashboard/agent`.

## Decisiones ya tomadas (no preguntes, aplícalas)

1. **El briefing de Claude (`ai_briefing`) es el bloque hero del centro de control.** Aparece arriba del todo, encima de los KPIs financieros. Si por algún motivo no existe `ai_briefing` para el usuario logeado, cae al resumen mecánico (`headline` + `priority_actions` plano) que ya estaba.
2. **El bloque actual `IntelligenceSummary` (≈línea 811 de `app/dashboard/page.tsx`) desaparece o se evoluciona.** El placeholder "Aún no tienes el agente conectado / Conectar herramientas" sigue siendo útil como fallback cuando no hay ningún `agent_daily_summary` aún, pero deja de ser lo principal cuando sí hay datos.
3. **Las pestañas que tiene `/dashboard/agent` hoy (Noticias, Señales, Reseñas, Marketing, Leads, Tareas) se llevan al centro de control también**, debajo del briefing y de los KPIs financieros. Diseña su disposición como prefieras pero respeta la jerarquía visual: briefing → KPIs financieros → tabs del agente → resto.
4. **`/dashboard/agent` se elimina**, y en su lugar se hace redirect server-side a `/dashboard`. Esto evita romper enlaces guardados o bookmarks.
5. **El item "Asistente IA" del sidebar también se elimina** (probablemente vive en un componente compartido tipo `components/layout/sidebar.tsx` o similar — busca "Asistente IA" en todo el proyecto y quita la entrada).
6. **No toques el endpoint `app/api/agent/ingest/route.ts`** — guarda bien. Si quieres exponer columnas planas adicionales en `agent_daily_summary` (`ai_headline`, `ai_mood`, etc.) para queries más rápidas, propon una migración SQL pero no la apliques sin confirmación.

## Archivos clave

- `app/dashboard/page.tsx` — el centro de control (home). Aquí va el grueso del trabajo. 969 líneas; el bloque `IntelligenceSummary` está alrededor de la línea 800-825.
- `app/dashboard/agent/page.tsx` — la página actual del agente. 628 líneas. De aquí salen las types (`DailySummary`, `AIBriefing`, `AIAction`, `AgentNews`, `AgentSignal`, `AgentReview`, `AgentCampaign`, `AgentLead`, `AgentTask`), los `useEffect` que cargan datos, los handlers (`markNewsRead`, `acknowledgeSignal`, `completeTask`, `updateLeadStatus`) y la UI de las pestañas. Todo eso hay que portarlo al home.
- `app/api/agent/ingest/route.ts` — sólo de lectura. Para entender qué guarda y dónde.
- `components/ui/*` — el sistema de design ya existente. **No introduzcas dependencias nuevas ni componentes ad-hoc**, reutiliza `Card`, `StatCard`, `Button`, `Badge`, `Loading`, `EmptyState`, `PageHeader`.
- El sidebar — búscalo con `grep -rn "Asistente IA" components/` y quita la entrada.

## Cosas a investigar / arreglar de paso

**Problema del `user_id`**: al probar el flujo localmente, el workflow inserta filas en `agent_daily_summary` para el `user_id` que devuelve `app/api/agent/users/route.ts` (en este test fue `64314010-8300-4c7c-9d1d-8fcfbf6a0f8c`, "Panadería San Juan"). Cuando el usuario logeado (`idkdu37@gmail.com`) entra a `/dashboard/agent`, ve la tarjeta vacía — la query `supabase.from("agent_daily_summary").select("*")...` devuelve 0 filas. Sospechas a comprobar:

1. ¿La fila en `agent_daily_summary` se está insertando con el `user_id` correcto (el de `auth.users` correspondiente al usuario que se loguea como `idkdu37@gmail.com`)?
2. ¿Las políticas RLS de Supabase para `agent_daily_summary` permiten al usuario leer sus propias filas?
3. ¿El cliente Supabase del navegador (`@/lib/supabase-browser`) está enviando el JWT correctamente? Verifica que la sesión activa coincida con el `user_id` esperado.

Si encuentras el desajuste, arréglalo (probablemente sea una política RLS faltante o que la query del frontend no filtra explícitamente por `user_id` y RLS no está activo). Documenta lo que encuentres.

## Criterios de aceptación

- [ ] Entras a `http://localhost:3000/dashboard` y **lo primero** que ves arriba del todo es la tarjeta del briefing de Claude (titular IA, narrativa, top_actions con bolitas de color por impacto, opportunities, watch_outs, mood). Encima de los KPIs financieros, no debajo.
- [ ] Si no hay `ai_briefing` pero sí hay `agent_daily_summary` mecánico, se muestra el viejo headline + priority_actions plano.
- [ ] Si no hay `agent_daily_summary` ninguno, sale el placeholder "Aún no tienes el agente conectado" con CTA a integraciones, **pero como bloque secundario**, no ocupando toda la primera pantalla.
- [ ] Las pestañas (Noticias, Señales, Reseñas, Marketing, Leads, Tareas) están accesibles desde el centro de control, debajo del briefing y los KPIs.
- [ ] `/dashboard/agent` redirige a `/dashboard` (o devuelve 404 — tú decides cuál es más limpio para Next.js App Router).
- [ ] El sidebar ya no tiene la entrada "Asistente IA".
- [ ] El typecheck pasa limpio: `npx tsc --noEmit -p tsconfig.json` sin errores.
- [ ] El build pasa: `npm run build`.
- [ ] No hay imports muertos, no hay rutas huérfanas, no hay componentes definidos pero no usados.

## Estilo y constraints

- TypeScript estricto, nada de `any` salvo justificado.
- Tailwind con las utility classes que ya hay en el resto del proyecto (`brand-green`, `navy-*`, dark mode soportado).
- Server components donde sea posible; client components sólo cuando hace falta interactividad (los handlers de tabs, los "marcar leído", "acknowledge", etc.).
- Si rompes algo de la estructura actual de la home (KPIs financieros, gráficos, "Requiere atención", "Cumplimiento", "Actividad reciente"), **respétalos** — sólo se reorganizan en orden, no se borran.

## Verificación final

1. `npx tsc --noEmit -p tsconfig.json`
2. `npm run build`
3. Levantar dev (`npm run dev`) y entrar a `/dashboard` con sesión activa. Verificar que se ve la tarjeta del briefing arriba del todo.
4. Entrar a `/dashboard/agent` (URL directa) y verificar que redirige.
5. `grep -rn "Asistente IA" app components` no debe devolver resultados (excepto comentarios o nombres en español genérico).

---

Cuando termines, deja un commit con un mensaje claro y muéstrame el diff resumido. Si en algún punto necesitas decidir algo no cubierto aquí, deja una nota en el PR/commit y elige la opción que minimice cambios visuales para el cliente final.
