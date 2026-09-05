# Enlaze — Pendientes (cosas para más adelante)

_Lista viva de cosas por arreglar o rematar. Nada urgente salvo que se indique._

## Bugs conocidos (arreglar cuando toque)
- ~~Bucle de recarga + login que reinicia~~ ✅ **ARREGLADO** (CSP + aislamiento de Sentry). Login entra a la primera, sin recargas.
- ~~Cumplimiento → Seguridad (incidencias vacías)~~ ✅ **ARREGLADO** (filtra por `reported_by`; de paso el 400 del dashboard y la tarjeta de Seguridad siempre en verde).
- ~~Ficha de proveedor (barra no se pintaba)~~ ✅ **ARREGLADO** (totales calculados desde `received_invoices`).
- ~~Listado de proveedores mostraba 0,00 € en "Facturado"~~ ✅ **ARREGLADO** (totales calculados; de paso arreglado el orden y la exportación CSV de esa columna).
- **Interfaz `Supplier` desincronizada del esquema:** declara campos que no existen (city, postal_code, province, trade_name, iban, category_id…) → salen vacíos en la ficha. Saneamiento mayor, aparte.

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
