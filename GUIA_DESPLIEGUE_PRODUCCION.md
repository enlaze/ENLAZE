# Enlaze — Guía de despliegue a producción (Etapa E)

Fecha: 2026-07-16

---

## 1. Variables de entorno necesarias en Vercel

### Obligatorias (la app no arranca sin ellas)

| Variable | Dónde obtenerla | Ejemplo |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → URL | `https://dsgnymebkxxkslyeotee.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon/public | `eyJhbG...` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role (SECRETO) | `eyJhbG...` |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys | `sk-ant-api03-...` |
| `RESEND_API_KEY` | resend.com → API Keys | `re_...` |
| `OAUTH_ENCRYPTION_KEY` | Generar con `openssl rand -hex 32` | 64 chars hex |
| `NEXT_PUBLIC_SITE_URL` | Tu dominio final | `https://enlaze.es` |

### Opcionales (funcionalidad extra)

| Variable | Para qué | Notas |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Login con Google + integración Gmail/Sheets | Configurar OAuth en Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Idem | |
| `AGENT_API_KEY` | Autenticación del agente n8n → API interna | Generar con `openssl rand -hex 32` |
| `WEBHOOK_SECRET` | Verificar webhooks de n8n | Generar con `openssl rand -hex 16` |
| `SERP_API_KEY` | Búsqueda de precios de mercado vía SerpAPI | serpapi.com |
| `N8N_PRICE_SEARCH_WEBHOOK_URL` | URL del webhook de n8n para búsqueda de precios | Se configura tras desplegar n8n |
| `NEXT_PUBLIC_POSTHOG_KEY` | PostHog analytics | eu.posthog.com → Project → Settings |
| `NEXT_PUBLIC_POSTHOG_HOST` | PostHog host | `https://eu.i.posthog.com` |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry error tracking | sentry.io → Project → Settings → DSN |
| `SENTRY_AUTH_TOKEN` | Subida de source maps en build | sentry.io → Auth Tokens |
| `SENTRY_ORG` | Organización en Sentry | p.ej. `enlaze` |
| `SENTRY_PROJECT` | Proyecto en Sentry | p.ej. `enlaze-web` |
| `NEXT_PUBLIC_DEV_TOOLS_ENABLED` | Muestra el Agent Inspector en /dashboard/dev | Solo poner `true` en desarrollo |


## 2. Pasos de despliegue en Vercel

### 2.1 Preparación local

```bash
# 1. Instalar dependencias de instrumentación
npm install posthog-js @sentry/nextjs

# 2. (Opcional) Correr el wizard de Sentry para crear configs server/edge
npx @sentry/wizard@latest -i nextjs

# 3. Verificar build limpio
npm run build

# 4. Commit todo
git add -A && git commit -m "chore: prepare for production deployment"
git push origin main
```

### 2.2 En Vercel

1. Ir a vercel.com → New Project → Import Git Repository → seleccionar `enlaze`
2. Framework Preset: se detecta Next.js automáticamente
3. Root Directory: `.` (raíz)
4. En Settings → Environment Variables, añadir TODAS las variables de la sección 1
5. Deploy

### 2.3 Dominio personalizado

1. Vercel → Project → Settings → Domains → Add `enlaze.es`
2. En tu registrador DNS, apuntar:
   - `A` → `76.76.21.21` (IP de Vercel)
   - `CNAME` para `www` → `cname.vercel-dns.com`
3. Vercel genera el certificado SSL automáticamente

### 2.4 Configurar Supabase para producción

1. En Supabase → Authentication → URL Configuration:
   - Site URL: `https://enlaze.es`
   - Redirect URLs: añadir `https://enlaze.es/**`
2. En Supabase → Authentication → Email Templates:
   - Cambiar los links de `localhost:3000` a `https://enlaze.es`
3. Si usas Google OAuth:
   - En Google Cloud Console → Credentials → Authorized redirect URIs:
     añadir `https://enlaze.es/api/auth/google/callback`


## 3. n8n — Opciones de hosting

El agente diario y la FASE 2 del banco de precios (scraping de proveedores) necesitan n8n corriendo 24/7.

### Opción A: n8n Cloud (recomendada para empezar)

- n8n.cloud — plan Starter ~20€/mes
- Sin gestión de servidor
- Configurar los webhooks apuntando a `https://enlaze.es/api/webhooks/construccion` etc.

### Opción B: VPS propio (más control, más trabajo)

- Hetzner CX22 (~5€/mes) o DigitalOcean Droplet básico
- Docker Compose con n8n + PostgreSQL
- Configurar HTTPS con Caddy/nginx + Let's Encrypt
- Dominio tipo `n8n.enlaze.es`

### Opción C: Railway / Render

- railway.app o render.com — deploy de n8n via Docker
- Plan Hobby ~5-7€/mes, sin administrar servidor
- Limitación: puede haber cold starts

### Configuración de n8n (independiente de la opción)

Una vez desplegado n8n:

1. Crear los workflows:
   - Daily briefing (cron diario 7:00 AM)
   - Price sync (cron diario 3:00 AM)
   - Webhook de scraping de proveedores
2. Configurar credenciales en n8n:
   - HTTP Header Auth con `AGENT_API_KEY` para llamar a las APIs de Enlaze
   - Supabase con `SUPABASE_SERVICE_ROLE_KEY` si accede directo
3. Apuntar las URLs de webhook de vuelta a Vercel:
   - `POST https://enlaze.es/api/webhooks/construccion`
   - `POST https://enlaze.es/api/pb/sync/run`
4. Añadir `N8N_PRICE_SEARCH_WEBHOOK_URL` en Vercel apuntando al webhook de n8n


## 4. Checklist pre-lanzamiento

### Seguridad

- [ ] `SUPABASE_SERVICE_ROLE_KEY` NUNCA en variables `NEXT_PUBLIC_*`
- [ ] `ANTHROPIC_API_KEY` solo en server-side (no NEXT_PUBLIC)
- [ ] `OAUTH_ENCRYPTION_KEY` generada nueva para producción (no reusar la de desarrollo)
- [ ] `AGENT_API_KEY` y `WEBHOOK_SECRET` generados nuevos para producción
- [ ] RLS activo en todas las tablas de Supabase
- [ ] Verificar que `/dashboard/dev/agent-inspector` no es accesible (variable `NEXT_PUBLIC_DEV_TOOLS_ENABLED` no está en Vercel)

### Funcionalidad

- [ ] Registro de usuario nuevo funciona
- [ ] Email de verificación llega (comprobar Resend dashboard + dominio verificado)
- [ ] Login funciona
- [ ] Onboarding completo (sector → datos → legal)
- [ ] Dashboard carga con datos vacíos (nuevo usuario)
- [ ] Crear presupuesto manual funciona
- [ ] Generador de presupuestos IA funciona (necesita ANTHROPIC_API_KEY)
- [ ] Recuperación de contraseña funciona
- [ ] Logout y re-login funciona
- [ ] Dark mode funciona en todas las pantallas

### DNS y email

- [ ] Dominio `enlaze.es` resuelve correctamente
- [ ] SSL activo (candado verde en el navegador)
- [ ] SPF, DKIM y DMARC configurados en DNS para enviar emails desde @enlaze.es via Resend
- [ ] Email de verificación no cae en spam

### Instrumentación

- [ ] PostHog recibe eventos (comprobar en posthog.com → Activity)
- [ ] Sentry recibe errores de prueba (comprobar en sentry.io → Issues)

### Post-lanzamiento

- [ ] Invitar al primer usuario real (empresa de construcción)
- [ ] Monitorizar PostHog las primeras 48h para ver el funnel
- [ ] Revisar Sentry por errores inesperados
- [ ] Verificar que el agente n8n ejecuta el briefing diario a las 7:00

---

## 5. Resumen de arquitectura en producción

```
Usuario → enlaze.es (Vercel/Next.js)
              ↓
         Supabase (PostgreSQL + Auth + RLS)
              ↓
         Anthropic API (Claude para presupuestos)
              ↓
         Resend (emails transaccionales)
              ↓
         n8n (agente diario + price sync)
              ↓
         PostHog (analytics) + Sentry (errores)
```
