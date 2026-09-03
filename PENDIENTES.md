# Enlaze — Pendientes (cosas para más adelante)

_Lista viva de cosas por arreglar o rematar. Nada urgente salvo que se indique._

## Bugs conocidos (arreglar cuando toque)
- **⚠️ Bucle de recarga en el dashboard (prioritario):** todas las páginas del dashboard se recargan solas ~3 veces/segundo. Es un error de JavaScript al arranque (`JSON.parse` sobre algo vacío) que apunta a Sentry (su worker está bloqueado por la política de seguridad). Molesto en desarrollo y, si pasa en producción, manda ruido a Sentry en cada carga. Conviene arreglarlo antes del lanzamiento.
- **Cumplimiento → Seguridad:** la lista de incidencias sale siempre vacía. El código consulta `security_incidents.user_id`, una columna que **no existe**. → `app/dashboard/compliance/security/page.tsx` (~línea 27)
- **Ficha de proveedor:** una barra no se pinta nunca porque depende de `supplier.total_invoiced`, que **no existe** en la tabla de proveedores. → `app/dashboard/suppliers/[id]/page.tsx` (~línea 91)

## Para el lanzamiento (go-live)
- Desplegar en Vercel + conectar dominio `enlaze.es` (DNS/SSL) + variables de entorno.
- Conectar el **cron** de mensajes programados (para que se disparen solos a su hora).
- **n8n en producción** (el agente/briefing) — incluye meter el secreto de Vercel en el llavero del Mac.
- **Créditos de API de Anthropic** (para que el agente funcione).
- **WhatsApp Meta Business** (cuenta Business + número + plantillas aprobadas) para poder enviar WhatsApp de verdad.
- **QA final** antes de abrir.

## Pendiente de rematar
- **Landing nueva:** está en la rama `rediseno-landing`. Falta grabar los vídeos del producto, que Code los integre, revisar y fusionar a `main`.
- **Logo modo oscuro:** arreglado en `rediseno-landing` (verificar que quedó commiteado). Llega a `main` al fusionar la landing.

## Opcional / futuro (no compensa ahora)
- "Fase 4" de coherencia visual: ~600 utilidades de Tailwind (red-/amber-/blue-) que ya son semánticas. Mucho esfuerzo, poco valor. Solo si algún día apetece.

---
_Actualizado: 25 ago 2026_
