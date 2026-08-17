# BRIEFING PARA CODEX - Proyecto ENLAZE

## Qué es ENLAZE
SaaS para empresas en España (construcción, comercio local, estética, hostelería, automoción, educación). Stack: Next.js (App Router) + Supabase + Vercel. El repo está en GitHub: `github.com/enlaze/ENLAZE`.

## Qué estamos haciendo ahora
Construyendo un **sistema automatizado de seguimiento de precios** que scrapea webs de proveedores españoles, normaliza los datos y los guarda en Supabase para que los usuarios vean precios actualizados diariamente.

## Arquitectura actual

```
n8n (local) → scraping webs proveedores → Gemini AI (normalización) → POST /api/pb/ingest → Supabase
```

### Flujo de datos:
1. **n8n** ejecuta workflows cada 24h con Schedule Trigger
2. Los nodos HTTP scrapean webs de proveedores (ManoMano, etc.)
3. **Google Gemini AI** normaliza el HTML a JSON estructurado
4. Un nodo Code valida y formatea el JSON
5. Se envía por POST a `/api/pb/ingest` con Bearer token auth
6. El endpoint upserta productos en `pb_products` y registra historial en `pb_price_observations`

### Tablas Supabase relevantes:
- `pb_products` — productos con precios (columnas: commercial_name, unit_price, provider_id, sector, category, subcategory, brand, sku, last_synced_at, source_url, price_trend)
- `pb_providers` — proveedores por sector (130+ proveedores reales españoles)
- `pb_price_observations` — historial de precios (product_id, provider_id, observed_price, source, source_url, observed_at)
- `sync_api_keys` — API keys hasheadas (SHA-256) para auth
- `price_sync_logs` — logs de cada sincronización

### Endpoint principal: `/api/pb/ingest` (POST)
- **Archivo**: `app/api/pb/ingest/route.ts`
- **Auth**: Bearer token → compara contra env vars SYNC_API_KEY, AGENT_API_KEY, WEBHOOK_SECRET (o tabla sync_api_keys)
- **Body**: `{ provider_name, sector, source_url, products: [{ name, price, unit, category, subcategory, brand, sku }] }`
- **Comportamiento**: auto-crea proveedores si no existen, upsert productos (actualiza precio si cambió con tracking de tendencia up/down/stable), registra observación en historial
- **SYNC_API_KEY actual**: `enlaze-sync-2026-precio` (en Vercel env vars)

### Middleware (`middleware.ts`):
- `/api/pb/ingest` y `/api/pb/sync/run` están en PUBLIC_API_ROUTES (no requieren cookie auth, manejan su propia auth con Bearer token)

## Workflow n8n existente: "Enlaze - Construcción y reformas"
Workflow ID: `wfdP2cJs0ioJAJ6g` con 6 flujos paralelos:

1. **Precios retail** → scrapea ManoMano (antes Leroy Merlin/OBRAMAT, bloqueados por Cloudflare) → Gemini AI → valida → envía a `/api/pb/ingest`
2. **CYPE** → scrapea generador de precios → Gemini → valida → envía a `/api/webhooks/construccion`
3. **BOE** → RSS normativas → filtra → Gemini → envía a `/api/webhooks/construccion`
4. **Google News** → RSS noticias sector → Gemini → envía a `/api/webhooks/construccion`
5. **INE** → API índices materiales → Gemini → envía a `/api/webhooks/construccion`
6. **ESIOS/REE** → precios electricidad PVPC → Gemini → envía a `/api/webhooks/construccion`

**IMPORTANTE**: Solo el flujo 1 (precios retail) usa `/api/pb/ingest`. Los demás usan `/api/webhooks/construccion`.

## PROBLEMA ACTUAL: Scraping bloqueado por Cloudflare

### Situación:
- Leroy Merlin y OBRAMAT bloquean peticiones HTTP directas ("Forbidden")
- Cambiamos a ManoMano.es pero también usa Cloudflare (muestra "Just a moment...")
- Creamos `scripts/scraper-precios.js` con **Puppeteer** (navegador headless)
- Puppeteer SÍ pasa Cloudflare y carga la página con productos visibles
- El banner de cookies se cierra correctamente
- PERO los selectores CSS no encuentran los productos

### Lo que vemos en la captura de debug:
La página de ManoMano carga correctamente (dice "Cementos y morteros - 243 productos") con productos visibles:
- "Bostik – Fleur de chaux 4kg" → 10,92€
- "Mortero impermeabilizante SIKA..." → 26,27€
- "Microhormigón SIKA FastFix-60 20 Kg" → 50,59€
- Cada producto tiene botón "Añadir a la cesta"

### Lo que necesitamos:
1. **Arreglar los selectores CSS** en `scripts/scraper-precios.js` para extraer productos de ManoMano
2. Los archivos HTML de debug están en `debug-scraper/*.html` — examinar la estructura DOM real
3. Una vez que los selectores funcionen, el script envía automáticamente a `/api/pb/ingest`

### Script actual: `scripts/scraper-precios.js`
- Usa Puppeteer para abrir Chrome headless
- Navega a 5 URLs de ManoMano (cementos, puertas, albañilería, iluminación, fontanería)
- Cierra el banner de cookies haciendo click en "Aceptar y cerrar"
- Hace scroll para cargar productos
- Guarda capturas y HTML de debug en `debug-scraper/`
- Intenta extraer productos buscando botones "Añadir a la cesta" y subiendo al contenedor padre
- Envía los productos encontrados a la API de ENLAZE
- Ejecutar con: `node scripts/scraper-precios.js`

## Archivos clave

```
app/api/pb/ingest/route.ts          ← Endpoint de ingesta de precios
middleware.ts                        ← Rutas públicas (incluye /api/pb/ingest)
scripts/scraper-precios.js           ← Script Puppeteer para scraping
debug-scraper/*.png                  ← Capturas de lo que ve Puppeteer
debug-scraper/*.html                 ← HTML parcial de las páginas scrapeadas
n8n-workflows/                       ← JSONs de workflows n8n
supabase/migrations/                 ← Migraciones SQL
```

## Otros problemas pendientes (no urgentes)
- "Conectar integraciones no funciona"
- "Al cambiar de sector, actualizar el banco de precio al mismo"
- "Al hacer una foto a una factura y subirla para analizarla, sale un error 404"
- "En presupuesto, poder volver a editarlo para modificar cantidades, precios, nombre del cliente, obra, etc."

## Variables de entorno en Vercel
- `SYNC_API_KEY` = `enlaze-sync-2026-precio`
- `NEXT_PUBLIC_SUPABASE_URL` = URL de Supabase
- `SUPABASE_SERVICE_ROLE_KEY` = Service role key
- `WEBHOOK_SECRET` = para webhooks existentes
- Deployment Protection de Vercel está DESACTIVADO (lo desactivamos para que las peticiones externas lleguen)

## Cómo probar que la API funciona
```bash
curl -s -X POST https://enlaze.vercel.app/api/pb/ingest \
  -H "Authorization: Bearer enlaze-sync-2026-precio" \
  -H "Content-Type: application/json" \
  -d '{"provider_name":"Test","sector":"construccion","products":[{"name":"Cemento Portland 25kg","price":4.95}]}'
```
Debería devolver: `{"ok":true,"inserted":1,...}`

## Sectores válidos
construccion, comercio_local, estetica, hosteleria, automocion, educacion
