# Arquitectura de Aislamiento de Agentes por Sector

Este documento detalla la arquitectura de integración con n8n y la IA generativa para garantizar que los datos de diferentes sectores (ej. Construcción vs Retail) nunca se crucen.

## 1. Mapeo Sector → Agente → Endpoint

### Construcción y Reformas
- **Workflow n8n:** `Enlaze -Construcción y reformas-2.json`
- **Agente:** `agent_construccion_360`
- **Endpoint principal:** `/api/webhooks/construccion`
- **Fuentes de datos:** Leroy Merlin, OBRAMAT, CYPE, BOE, Google News, INE, ESIOS.

### Comercio Local / Retail
- **Workflow n8n:** `ENLAZE — Comercio Local v6.3 Retail-2.json`
- **Agente:** comercio local / retail
- **Endpoints:** `/api/webhooks/comercio-local` y `/api/agent/ingest`
- **Fuentes de datos:** Costes, combustible, IPC, ventas retail, competencia, campañas, reputación, Gmail, Calendar, Google Business.

## 2. Global vs Por Usuario (Aislamiento de Datos)

### Datos de Construcción (Actuales)
- Los datos inyectados por el agente de construcción a través de `/api/webhooks/construccion` son **GLOBALES** por sector.
- **No son datos privados de usuario.** Se guardan en la tabla `sector_data` (precios de referencia, normativas, noticias) y **son datos de mercado compartidos**.
- Se aíslan de otros sectores simplemente filtrando por `sector = 'construccion'`.

### Datos de Comercio Local
- El agente de retail opera con un flujo **multiusuario** y privado.
- Consulta `/api/agent/users?sector=comercio_local` para iterar por cada negocio.
- Recupera el contexto privado de cada empresa vía `/api/agent/config?user_id=...`.
- Inyecta insights, precios, leads y tareas privados a través de `/api/agent/ingest` asociados directamente al `user_id`.

## 3. Prevención de Contaminación Cruzada
El sistema evita mezclar datos mediante tres barreras sólidas:
1. **Aislamiento por User ID:** En el Wizard y los endpoints de generación de presupuestos (`/api/agent/budgets/generate`), se consulta `user_id` para acceder al banco de precios privados (`price_items`). Un profesional de reformas jamás leerá datos privados de un retailer.
2. **Filtrado por Sector Estricto:** Al consultar referencias globales en `sector_data`, siempre se filtra explícitamente mediante `.eq("sector", sector_del_usuario)`.
3. **Cerebros de IA Separados (Prompts):** Cada sector tiene su propio `system_prompt` en `lib/agent-prompts.ts` (ej. Agente Constructor vs Agente Comercio). La IA generativa recibe directrices exclusivas de su sector (ej. uso del CTE, RITE y REBT para construcción).

## 4. Deuda Técnica Futura (Tech Debt)
- **Evolución del Agente de Construcción:** El workflow de construcción actual alimenta bases de datos globales de mercado (`sector_data`). Debe evolucionar hacia el mismo patrón multiusuario que el de comercio local para ofrecer un servicio 100% personalizado.
- **Flujo objetivo para construcción:**
  1. Iteración de usuarios: `/api/agent/users?sector=construccion`.
  2. Contexto privado: `/api/agent/config` para leer la información privada de cada empresa constructora.
  3. Procesamiento en n8n por cada usuario individual.
  4. Inyección: Enviar los resultados hiper-personalizados mediante `/api/agent/ingest` asignados a su `user_id`.
