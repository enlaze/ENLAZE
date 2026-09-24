# Enlaze — Pendientes (cosas para más adelante)

_Lista viva de cosas por arreglar o rematar. Nada urgente salvo que se indique._

## Bugs conocidos (arreglar cuando toque)
- ~~🔴 SEGURIDAD: lecturas públicas de datos privados~~ ✅ **ARREGLADO** (rama `fix/security-rls`, verificado): 9 tablas (facturas, albaranes, pedidos, obras…) + `agent_connections` (lectura/escritura anónima de credenciales OAuth de Google) + RPC `get_expense_summary` (resumen financiero de cualquiera, era explotable). Todo restringido al dueño; service_role intacto. Falta fusionar a main.
- ~~SEGURIDAD — escritura anónima en catálogo de precios `pb_*`~~ ✅ **ARREGLADO 2026-09-24** (`20260924113527_close_price_bank_write_hole`): anon ya no lee ni escribe; con sesión solo se escribe lo propio. Probado en real (`npm run test:price-bank-rls`).
- **🟡 SEGURIDAD — portal de cliente (antes de usar el portal):** _Revisado 2026-09-24:_ `portal_tokens` ya es solo del dueño (20260915140000) y el barrido de lectura y escritura con anon no encuentra acceso a `portal_tokens` ni a `project_changes`; el ciclo de vida de enlaces (`20260923120000`) está aplicado. Queda lo que sigue: usa la anon key en el navegador, `portal_tokens` deja a cualquiera listar todos los tokens, y `project_changes` permite UPDATE público. Además ya estaba roto. Arreglo real = ruta de servidor con service role que valide el token. Es su propia tarea.
- ~~SEGURIDAD — escritura pública en `n8n_updates` / `sector_data`~~ ✅ **ARREGLADO 2026-09-24** (`20260924144202`): `/api/webhook` pasó antes a service_role; anon no lee ni escribe; `sector_data` solo se lee con sesión.
- **Go-live:** asegurar `SUPABASE_SERVICE_ROLE_KEY` en el entorno de producción. Varias rutas **caen a la anon key si falta** en vez de fallar (`/api/agent/*`, `webhooks/comercio-local`, `pb/webhook`, `webhooks/construccion`): convertirlas en 500 como `lib/api-key-auth.ts`.
- **Go-live:** configurar en n8n las **notificaciones de error** (error workflow) para enterarse si el agente falla en producción, en vez de descubrirlo tarde.
- **Go-live:** revisar las **vulnerabilidades de dependencias** (`npm audit` reporta 20, 11 altas y 1 crítica). Mirar cuáles son reales (muchas suelen ser de desarrollo) antes de lanzar. Ojo con `npm audit fix --force`, que puede romper cosas.
- ~~Bucle de recarga + login que reinicia~~ ✅ **ARREGLADO** (CSP + aislamiento de Sentry). Login entra a la primera, sin recargas.
- ~~Cumplimiento → Seguridad (incidencias vacías)~~ ✅ **ARREGLADO** (filtra por `reported_by`; de paso el 400 del dashboard y la tarjeta de Seguridad siempre en verde).
- ~~Ficha de proveedor (barra no se pintaba)~~ ✅ **ARREGLADO** (totales calculados desde `received_invoices`).
- ~~Listado de proveedores mostraba 0,00 € en "Facturado"~~ ✅ **ARREGLADO** (totales calculados; de paso arreglado el orden y la exportación CSV de esa columna).
- **Interfaz `Supplier` desincronizada del esquema:** declara campos que no existen (city, postal_code, province, trade_name, iban, category_id…) → salen vacíos en la ficha. Saneamiento mayor, aparte.

- **Migraciones perdidas en 7135c48, abiertas (auditoría 2026-09-24):**
  - `20260721_obra_partes_gantt`: las 6 tablas (partes de trabajo y Gantt) no existen. Solo lo nota firmar un parte (`signatures/public` consulta `work_reports`).
  - `20260804_retained_received_invoice_documents`: falta la policy de lectura del bucket `received-invoice-documents` (no es fuga; es acceso que falta).
  - `20260806_04_reconcile_supplier_invoiced`: **ya sin objeto**; `suppliers` no guarda totales (se calculan al leer). Borrar del todo cuando se decida.
  - `20260716_price_bank_v2`: NO aplicar tal cual (ver "Precios propios del usuario" abajo).
- **Precios propios del usuario (análisis 2026-09-24):** el resolvedor v2 (`/api/prices/resolve`) busca `price_items.is_locked`, que no existe; la pantalla de Precios marca "manual" en `is_manual_override`. Son el mismo concepto con dos nombres → los niveles 1 ("manual bloqueado") y 10 no se activan nunca. Aplicar `price_bank_v2` NO lo arregla (crea `is_locked` a false y nadie lo escribe). Decisión de producto pendiente.
- **Código muerto:** `/api/budgets/generate-v2`, `/api/budgets/reprice`, `/api/pb/providers`, `/api/pb/providers/[id]`, `/api/pb/products`: nadie los llama. `generate-v2` además tiene un `.or()` mal formado sobre `pb_providers`.
- **Catálogo compartido:** "Añadir precio" sin proveedor lo cuelga de "Referencia mercado ES", que es GLOBAL → el precio que mete un usuario lo ven todos. Decidir si debe ser privado.

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
