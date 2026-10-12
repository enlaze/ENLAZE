# b12-proxy-de-verdad: el proxy protege `/api` de verdad

Rama `auto/b12-proxy-de-verdad`, sacada de `origin/main` (10788b1) con `auto/b9-proxy-n8n` fusionada dentro, así que b9 entra con este arreglo. No toca main ni la base.

## Qué ha cambiado

- **El 401 del proxy ya bloquea.** Antes, la respuesta 401 copiaba las cabeceras de `NextResponse.next()`, entre ellas `x-middleware-next: 1`, y Next seguía hasta la ruta. Ahora es una respuesta nueva, con las cabeceras de seguridad y sin las de middleware. Es un cambio de 4 líneas en `proxy.ts`.
- **Las listas pasan a `lib/proxy-routes.ts`**, porque `proxy.ts` solo puede exportar `proxy` y `config`. Una prueba las fija tal cual.
- **La excepción por Bearer de b9** (9 rutas de n8n) pasa a llamarse `BEARER_API_ROUTES` y suma 3 rutas que tienen llamante de sistema:
  - `/api/internal/anon-privileges-check`: la llama la **GitHub Action `anon-privileges-check.yml` cada 6 horas**. Sin este cambio habría empezado a recibir 401 del proxy en cuanto se fusionara.
  - `/api/pb/webhook`: es la URL que `n8n-workflows/SETUP.md` manda configurar en n8n, con `Bearer <WEBHOOK_SECRET>`.
  - `/api/cron/dispatch-scheduled`: el reloj de los envíos programados, con `CRON_SECRET`. **Hoy no la llama nadie**: no hay `vercel.json` ni `pg_cron` (comprobado en la base) ni función que llame a `/api/`. La dejo lista para cuando se active.
  
  Sigue la misma regla que b9: ruta exacta y solo si la petición trae `Authorization: Bearer`. Con cookie pasan por el proxy como siempre.
- `PUBLIC_API_ROUTES` no cambia.

## Inventario de `/api` (77 rutas)

"Quién la llama" sale de buscar el texto de la ruta en `app`, `components`, `lib`, `n8n-workflows`, `scripts`, los JSON de la raíz y `.github/workflows`. Incluye imports y comentarios, y no ve lo que haya fuera del repo, como los workflows de n8n que no estén aquí.

- **Pública (lista):** el proxy no mira nada y la ruta se protege sola (firma de Stripe, token de firma o Bearer).
- **Bearer (sin Bearer, sesión):** con Bearer pasa a la ruta, que comprueba la clave; sin Bearer, el proxy exige sesión.
- **Sesión:** sin sesión, 401 del proxy.

| Ruta | Métodos | Proxy desde b12 | Quién la llama (en el repo) |
|---|---|---|---|
| `/api/account/delete` | POST | sesión | app: settings/CuentaPanel.tsx |
| `/api/agent/budget-analysis` | POST | sesión | app: dashboard/budgets/generate/_components/BudgetGenerateProvider.tsx |
| `/api/agent/budgets/generate` | POST | sesión | **nadie** |
| `/api/agent/calendar/action/create-event` | POST | sesión | **nadie** |
| `/api/agent/calendar/summary` | GET | Bearer (sin Bearer, sesión) | app: dashboard/dev/agent-inspector/page.tsx; fuera: n8n-workflow-comercio-local-v6.3.json |
| `/api/agent/config` | GET | Bearer (sin Bearer, sesión) | app: settings/NotificacionesPanel.tsx, agent/sector-intel.ts; fuera: n8n-workflow-comercio-local-v6.3.json |
| `/api/agent/daily-briefing` | GET | sesión | **nadie** |
| `/api/agent/gmail/action/create-draft` | POST | sesión | **nadie** |
| `/api/agent/gmail/summary` | GET | Bearer (sin Bearer, sesión) | app: dashboard/dev/agent-inspector/page.tsx, email/EmailSurface.tsx; fuera: n8n-workflow-comercio-local-v6.3.json |
| `/api/agent/ingest` | POST | Bearer (sin Bearer, sesión) | app: api/agent/news/route.ts; fuera: n8n-workflow-comercio-local-v6.3.json |
| `/api/agent/market/analysis` | GET | sesión | **nadie** |
| `/api/agent/market/prices` | GET | sesión | **nadie** |
| `/api/agent/market/summary` | GET | Bearer (sin Bearer, sesión) | fuera: n8n-workflow-comercio-local-v6.3.json |
| `/api/agent/news` | GET | Bearer (sin Bearer, sesión) | fuera: n8n-workflow-comercio-local-v6.3.json |
| `/api/agent/reputation/summary` | GET | Bearer (sin Bearer, sesión) | app: dashboard/dev/agent-inspector/page.tsx; fuera: n8n-workflow-comercio-local-v6.3.json |
| `/api/agent/sheets/action/append-row` | POST | sesión | **nadie** |
| `/api/agent/sheets/list` | GET | sesión | app: settings/IntegracionesPanel.tsx |
| `/api/agent/sheets/summary` | GET | Bearer (sin Bearer, sesión) | app: dashboard/dev/agent-inspector/page.tsx; fuera: n8n-workflow-comercio-local-v6.3.json |
| `/api/agent/users` | GET | Bearer (sin Bearer, sesión) | fuera: n8n-workflow-comercio-local-v6.3.json |
| `/api/auth/google/callback` | GET | pública (lista) | app: api/auth/google/route.ts, dashboard/settings/integrations/page.tsx |
| `/api/auth/google` | GET | pública (lista) | app: api/auth/google/callback/route.ts, dashboard/settings/integrations/page.tsx, settings/IntegracionesPanel.tsx |
| `/api/billing/checkout` | POST | sesión | app: settings/PlanPanel.tsx |
| `/api/billing/portal` | POST | sesión | app: settings/PlanPanel.tsx |
| `/api/billing/status` | GET | sesión | app: billing/BillingProvider.tsx, settings/PlanPanel.tsx, billing-status.ts |
| `/api/billing/webhook` | POST | pública (lista) | app: billing-webhook.ts |
| `/api/budgets/analyze` | POST | sesión | **nadie** |
| `/api/budgets/compare-providers` | POST | sesión | **nadie** |
| `/api/budgets/pdf` | POST | sesión | app: dashboard/budgets/[id]/page.tsx |
| `/api/budgets/snapshots/[id]/diff` | GET | sesión | **nadie** |
| `/api/budgets/snapshots/[id]` | GET | sesión | app: api/budgets/snapshots/[id]/diff/route.ts |
| `/api/budgets/snapshots` | GET,POST | sesión | app: api/budgets/snapshots/[id]/diff/route.ts, api/budgets/snapshots/[id]/route.ts |
| `/api/calendar/events` | GET,POST,DELETE | sesión | app: dashboard/calendar/page.tsx |
| `/api/contabilidad/download` | GET | sesión | **nadie** |
| `/api/contabilidad/pdf` | GET | sesión | app: contabilidad-print/page.tsx |
| `/api/cron/dispatch-scheduled` | GET,POST | Bearer (sin Bearer, sesión) | ningún cron activo (ni vercel.json ni pg_cron); la ruta documenta Vercel Cron o pg_cron |
| `/api/email/send-bulk` | POST | sesión | app: api/cron/dispatch-scheduled/route.ts, api/scheduled-messages/route.ts, email/EmailSurface.tsx |
| `/api/generate-budget` | POST | sesión | app: api/agent/budgets/generate/route.ts, margins.ts |
| `/api/integrations/whatsapp` | GET,POST,DELETE | sesión | app: settings/IntegracionesPanel.tsx, whatsapp/WhatsAppSurface.tsx |
| `/api/internal/anon-privileges-check` | GET | Bearer (sin Bearer, sesión) | fuera: GitHub Action anon-privileges-check.yml (cada 6 h) |
| `/api/invoices/ocr` | POST,PATCH,DELETE | sesión | app: facturacion/EscanearTab.tsx, facturacion/useReceivedInvoices.ts |
| `/api/notifications/preferences` | GET,POST | sesión | **nadie** |
| `/api/notifications/send` | POST | sesión | **nadie** |
| `/api/pb/concepts` | GET | sesión | **nadie** |
| `/api/pb/import/analyze` | POST | sesión | app: dashboard/prices/import/page.tsx |
| `/api/pb/import/process` | POST | sesión | app: dashboard/prices/import/page.tsx |
| `/api/pb/import/source` | POST | sesión | app: dashboard/prices/import/page.tsx |
| `/api/pb/ingest` | GET,POST | pública (lista) | fuera: 02-rajapack-comercio-local.json, 03-bifull-estetica.json, 04-expomaquinaria-hosteleria.json |
| `/api/pb/search` | GET | sesión | app: dashboard/budgets/_components/budget-form.tsx |
| `/api/pb/sync/run` | POST | pública (lista) | fuera: GitHub Action price-bank-sync.yml (cada 2 h) |
| `/api/pb/sync/status` | GET | sesión | **nadie** |
| `/api/pb/webhook` | POST,GET | Bearer (sin Bearer, sesión) | fuera: SETUP.md |
| `/api/platform-assistant` | POST | sesión | app: PlatformAssistant.tsx |
| `/api/prices/alerts` | GET,POST,DELETE,PATCH | sesión | app: dashboard/prices/_components/PriceAlertsPanel.tsx |
| `/api/prices/compare` | GET | sesión | app: dashboard/prices/_components/ProviderComparePanel.tsx |
| `/api/prices/history` | GET | sesión | app: dashboard/prices/_components/PriceHistoryModal.tsx |
| `/api/prices/import` | POST | sesión | app: dashboard/prices/_components/ImportPricesPanel.tsx |
| `/api/prices/n8n-sync` | POST,DELETE,GET | pública (lista) | app: dashboard/prices/page.tsx, PriceTrackerBackgroundStatus.tsx; fuera: 07-manomano-puppeteer-0600.json, 08-construccion-consolidado.json, manomano-publicado.json |
| `/api/prices/process-alerts` | POST | pública (lista) | app: api/webhooks/construccion/route.ts |
| `/api/prices/resolve` | POST | sesión | app: dashboard/budgets/generate/_components/BudgetGenerateProvider.tsx, price-resolver.ts |
| `/api/prices/sync` | POST | sesión | **nadie** |
| `/api/prices/weekly-report` | GET | sesión | app: api/prices/weekly-report/send/route.ts, dashboard/prices/_components/WeeklyReportPanel.tsx |
| `/api/prices/weekly-report/send` | POST | pública (lista) | **nadie** |
| `/api/scheduled-messages/[id]` | PATCH,DELETE | sesión | app: messaging/useScheduledMessages.ts |
| `/api/scheduled-messages` | GET,POST | sesión | app: email/EmailSurface.tsx, messaging/ScheduledTab.tsx, messaging/useScheduledMessages.ts |
| `/api/search` | GET | sesión | app: SearchCommand.tsx, web-price-search.ts |
| `/api/send-email` | POST | sesión | app: api/email/send-bulk/route.ts, facturacion/ReminderDialog.tsx, gmail-send.ts |
| `/api/signatures/create` | POST | sesión | app: SignatureFlow.tsx |
| `/api/signatures/public` | GET,POST | pública (lista) | app: firmar/[id]/page.tsx, SignatureFlow.tsx |
| `/api/signatures/rotate-token` | POST | sesión | app: dashboard/projects/_components/SignaturePanel.tsx |
| `/api/signatures/send-otp` | POST | pública (lista) | app: firmar/[id]/page.tsx, SignatureFlow.tsx |
| `/api/signatures/verify-otp` | POST | pública (lista) | app: firmar/[id]/page.tsx, SignatureFlow.tsx |
| `/api/technical-prices/import` | POST,GET | pública (lista) | **nadie** |
| `/api/webhook` | POST,GET | pública (lista) | app: api/webhooks/comercio-local/route.ts |
| `/api/webhooks/comercio-local` | POST,GET | pública (lista) | fuera: n8n-workflow-comercio-local-v6.3.json |
| `/api/webhooks/construccion` | POST,GET | pública (lista) | fuera: 08-construccion-consolidado.json, SETUP.md, fuentes-oficiales-publicado.json |
| `/api/whatsapp/send-bulk` | POST | sesión | app: api/cron/dispatch-scheduled/route.ts, api/email/send-bulk/route.ts, api/scheduled-messages/route.ts |
| `/api/whatsapp/send` | POST | sesión | app: api/whatsapp/send-bulk/route.ts, whatsapp.ts |

## Cómo lo he comprobado

- **Prueba nueva** `__tests__/proxy-api-callers.test.mjs` (`npm run test:proxy`, 8 casos), con un caso por tipo de llamante:
  - **Sin nada:** las 62 rutas protegidas de `/api` dan el 401 del proxy, sin `x-middleware-next` y con las cabeceras de seguridad.
  - **Con sesión** (Supabase simulado, sin red): pasan. Con una cookie cuyo token no vale, 401.
  - **Bearer en las 12 rutas de sistema:** pasan. En cualquier otra ruta protegida, y en variantes como `/api/agent/users/otra` o `/api/cron/otra`, 401.
  - **Bearer falso:** llama de verdad al handler de las 12 rutas, en un proceso aparte con la condición `react-server`, y las 12 responden 401.
  - **Webhook de Stripe:** pasa sin sesión.
  - **Cron:** con Bearer pasa; sin nada, 401. Con `x-cron-secret` también da 401 (ver punto 3 de abajo).
  - **Listas fijadas:** exactamente esas, y cada ruta existe.
  - **Páginas:** `/`, `/firmar` y `/portal` siguen públicas, y `/dashboard` sigue redirigiendo a `/login` con `redirect`.
- Con el `proxy.ts` anterior fallan 4 de los 8 casos (sin nada, sesión con cookie falsa, Bearer y cron). Con el arreglo pasan los 8.
- `test:proxy-n8n` de b9: 3/3. Solo he cambiado su comentario, que decía que el 401 se ignoraba. `no-anon-fallback` ahora busca las rutas de sistema en `lib/proxy-routes.ts`.
- **Batería unitaria completa:** 632 pasan, 0 fallan, 2 `todo`. `tsc --noEmit` sin errores. `eslint` limpio en los ficheros tocados. `npm run build` correcto, con `.env.local` de main enlazado y quitado al terminar.
- **`next start` en local, con el build:**
  - `/api/agent/daily-briefing` sin nada: `401 {"error":"No autorizado"}`, y en el log no aparece ninguna línea de la ruta. Es el mensaje del proxy; antes respondía la ruta con "Unauthorized: Invalid session…".
  - `/api/agent/gmail/summary` con Bearer falso: el log muestra que llega a la ruta y que esta lo rechaza.
  - `/api/agent/calendar/action/create-event` con Bearer: 401 sin ninguna línea de la ruta en el log.
  - `/api/billing/webhook` sin firma: `{"error":"Falta la firma"}`, de la ruta.
  - `/dashboard`: 307 a `/login`.
- **No está en producción** ni lo he probado en una preview de Vercel.

## Qué comprobar en la preview de Vercel antes de fusionar

1. `curl -i <preview>/api/agent/daily-briefing`: debe dar `{"error":"No autorizado"}` y no "Unauthorized: Invalid session…".
2. Entrar al dashboard y abrir Email, Facturación, Precios, Ajustes › Integraciones y el buscador. Ninguna llamada a `/api` debe dar 401 con la sesión abierta.
3. Lanzar a mano la Action `anon-privileges-check` contra la preview, o esperar a la siguiente tras fusionar: tiene que seguir en verde.
4. Si n8n apunta a `/api/pb/webhook` o a `/api/agent/*`, una ejecución de prueba del workflow.
5. La Action `price-bank-sync` (`/api/pb/sync/run`) no cambia: ya estaba en la lista pública.

## Qué tienes que decidir

1. **7 rutas de `/api/agent` sin ningún llamante en el repo** se quedan cerradas a Bearer, como ya hacía b9: `budgets/generate`, `market/prices`, `market/analysis`, `daily-briefing`, `calendar/action/create-event`, `gmail/action/create-draft` y `sheets/action/append-row`. Las tres primeras solo aceptan Bearer, así que desde esta rama **nadie puede usarlas**. Las otras cuatro siguen funcionando con sesión. Si algún workflow de n8n que no está en el repo llama a alguna, dímelo y la añado a la lista. Si no, ¿se borran?
2. **Rutas sin llamante y protegidas por sesión** (siguen igual, solo lo apunto): `budgets/analyze`, `budgets/compare-providers`, `budgets/snapshots/[id]/diff`, `contabilidad/download`, `notifications/preferences`, `notifications/send`, `pb/concepts`, `pb/sync/status` y `prices/sync`. Son candidatas a código muerto.
3. **El cron acepta también la cabecera `x-cron-secret`**, pero el proxy solo deja pasar con Bearer. Vercel Cron y el ejemplo de `pg_cron` de la ruta usan Bearer, así que no afecta. Si algún día se configura con `x-cron-secret`, recibiría 401. ¿Quito esa alternativa de la ruta?
4. **Activar el cron de envíos programados:** hoy no se dispara solo; los envíos programados no salen si nadie llama a la ruta. Ya estaba así antes de este bloque.

## Qué revisar en 10 minutos

- El diff de `proxy.ts` (el 401) y `lib/proxy-routes.ts` (las 3 rutas nuevas en `BEARER_API_ROUTES`).
- Los puntos 1 y 2 de la preview.
