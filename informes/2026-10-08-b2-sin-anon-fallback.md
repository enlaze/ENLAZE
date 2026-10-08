# b2-sin-anon-fallback: sin clave de servicio, error claro

Rama `auto/b2-sin-anon-fallback`. No se ha tocado `main`, la base ni nada externo.

## Qué ha cambiado

- **Ninguna ruta cae ya a la clave pública.** Antes, si faltaba `SUPABASE_SERVICE_ROLE_KEY`, estas rutas seguían funcionando con la anon key: `agent/*` (auth compartida, config, news, users, ingest), `webhooks/comercio-local`, `webhooks/construccion`, `pb/webhook`, `invoices/ocr` y el inspector del agente. Ahora usan el `getServiceRoleClient()` que ya existía. Si falta la clave, `serviceRoleUnavailable()` responde **500** y escribe en el log `[ruta] falta SUPABASE_SERVICE_ROLE_KEY: ruta desactivada`. Es el mismo contrato que `requireBearer`.
- **Rutas que fallaban con un error confuso.** `pb/ingest`, `pb/sync/run`, `prices/weekly-report/send` y `prices/process-alerts` creaban el cliente con `!`. Ahora fallan igual que las demás.
- **Comparación del Bearer.** `pb/webhook` y `webhooks/construccion` lo comparaban con `!==` o `includes`; ahora usan `requireBearer`, que compara en tiempo constante. Cambio menor: si no hay ningún secreto configurado, construcción responde 500 en vez de 401, y si falta la clave de servicio, 500 en vez de 503.
- **Clave escrita a fuego.** El script antiguo del scraper tenía la clave de sincronización como valor por defecto. Además, `BRIEFING-CODEX.md` y `CODEX-WORKFLOW-BRIEFING.md` la citaban como "SYNC_API_KEY actual (en Vercel env vars)". La he quitado de los tres ficheros, y el script ahora se para si falta la variable. No hay más secretos reales en el código: los de las pruebas son ficticios y los de CI son contraseñas de bases desechables.
- **Commit aparte (se puede deshacer solo): las rutas de correo exigen secreto.** `prices/weekly-report/send` y `prices/process-alerts` mandan correos y avisos a todos los usuarios con la clave de servicio. No pedían nada salvo, en teoría, una sesión cualquiera. Ahora exigen `Bearer WEBHOOK_SECRET` o `AGENT_API_KEY`. Las he añadido a la lista pública del proxy, como el resto de rutas de sistema. El webhook de construcción, que llama a `process-alerts` tras sincronizar, ahora envía esa cabecera; antes la llamada iba sin nada.

## Cómo lo he comprobado

- `node --test __tests__/no-anon-fallback.test.mjs`: 7 pruebas, todas en verde. Recorren `app`, `lib`, `components` y `scripts` y fallan si vuelve a aparecer una caída a la anon key, un `SUPABASE_SERVICE_ROLE_KEY!` en una ruta o un secreto con valor por defecto literal.
- Pruebas relacionadas en verde: construcción, auth de sync, sentinel de anon, telemetría, briefing del agente, n8n y proveedores.
- `test:p1`: los mismos 18 fallos que en `main`; las aserciones de p1 sobre OCR y pb/webhook siguen pasando.
- `tsc` sin errores. `eslint` sobre los ficheros tocados: 20 problemas en `main` y 20 en la rama, todos heredados.
- `next build` correcto (sin `prebuild`: consulta Stripe).
- **No lo he probado contra producción.**

## Qué tiene que decidir o aprobar Daniil

1. **Rotar `SYNC_API_KEY` (urgente).** Sigue en el historial de git. Hay que poner una nueva en Vercel y en la credencial "ENLAZE Sync API" de n8n. Con la antigua se puede escribir en el catálogo de precios a través de `pb/ingest`.
2. **Comprobar que n8n llega a `pb/webhook` y a `/api/agent/*`.** Según el código del proxy, esas rutas exigen sesión de usuario y no están en la lista pública, así que n8n, que llama con Bearer y sin sesión, debería recibir 401. Llamando a la función `proxy` aislada, da 401. Sin embargo, en un `next start` local pasaron. No he podido aclararlo sin tocar producción. Comprobación inofensiva (solo devuelve la documentación de la ruta):

   ```
   curl -s -o /dev/null -w "%{http_code}\n" https://enlaze.vercel.app/api/pb/webhook
   ```

   200 = el proxy deja pasar; 401 = el proxy bloquea, y entonces los envíos de n8n a esas rutas están fallando.
3. **Inspector del agente.** Con `NEXT_PUBLIC_DEV_TOOLS_ENABLED=true`, cualquier usuario con sesión ve los perfiles y correos de todos. ¿Está activo en producción? ¿Lo limitamos a tu cuenta?
4. **Fuera de este bloque, pero relacionado:** `prices/resolve` y `agent/budget-analysis`, si falta la clave de servicio, usan la sesión del usuario. No es un riesgo (ven menos, no más), pero dan resultados más pobres sin avisar. ¿Lo dejamos así?

## Revisar con tus ojos en 10 minutos

- La comprobación del punto 2.
- El diff de `lib/supabase-service-role.ts` (el helper nuevo) y de `app/api/agent/_lib/auth.ts`.
- El commit aparte `prices/*`: si prefieres no cambiar el acceso a esas rutas, se revierte solo.
