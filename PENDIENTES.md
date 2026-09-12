# Enlaze — Pendientes (cosas para más adelante)

_Lista viva de cosas por arreglar o rematar. Nada urgente salvo que se indique._

## Bugs conocidos (arreglar cuando toque)
- ~~🔴 SEGURIDAD: lecturas públicas de datos privados~~ ✅ **ARREGLADO** (rama `fix/security-rls`, verificado): 9 tablas (facturas, albaranes, pedidos, obras…) + `agent_connections` (lectura/escritura anónima de credenciales OAuth de Google) + RPC `get_expense_summary` (resumen financiero de cualquiera, era explotable). Todo restringido al dueño; service_role intacto. Falta fusionar a main.
- **SEGURIDAD — escritura anónima en catálogo de precios `pb_*`:** cualquiera puede ESCRIBIR precios (política de service_role mal aplicada a public). Revisar si n8n escribe con anon key; si usa service_role, bloquear la escritura pública.
- **🔴 SEGURIDAD — portal de cliente (antes de usar el portal):** usa la anon key en el navegador, `portal_tokens` deja a cualquiera listar todos los tokens, y `project_changes` permite UPDATE público. Además ya estaba roto. Arreglo real = ruta de servidor con service role que valide el token. Es su propia tarea.
- **SEGURIDAD — escritura pública en `prices` / `n8n_updates`:** cualquiera puede escribir (atado a los flujos de n8n con anon key). Revisar el modelo de n8n antes de restringir.
- **Go-live:** asegurar `SUPABASE_SERVICE_ROLE_KEY` en el entorno de producción (las rutas `/api/agent/*` caen a la anon key si falta).
- **Go-live:** configurar en n8n las **notificaciones de error** (error workflow) para enterarse si el agente falla en producción, en vez de descubrirlo tarde.
- **Go-live:** revisar las **vulnerabilidades de dependencias** (`npm audit` reporta 20, 11 altas y 1 crítica). Mirar cuáles son reales (muchas suelen ser de desarrollo) antes de lanzar. Ojo con `npm audit fix --force`, que puede romper cosas.
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
