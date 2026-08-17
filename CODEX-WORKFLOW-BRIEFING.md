# BRIEFING PARA CODEX: Conectar workflow n8n "Construcción y reformas" con ENLAZE

## CONTEXTO RÁPIDO
ENLAZE es un SaaS (Next.js + Supabase + Vercel) para empresas españolas. El workflow de n8n "Enlaze - Construcción y reformas" (ID: wfdP2cJs0ioJAJ6g) tiene 51 nodos y 6 flujos de datos paralelos que se ejecutan cada 24h. El objetivo es que todos funcionen perfectamente enviando datos a la plataforma.

## ARQUITECTURA DEL WORKFLOW

```
Schedule Trigger (24h) + Manual Trigger
    │
    ├── FLUJO 1: PRECIOS RETAIL (el problemático)
    │   5 nodos HTTP (ManoMano URLs) → Merge → Extraer → Gemini AI → Validar → POST /api/pb/ingest
    │
    ├── FLUJO 2: CYPE
    │   HTTP (CYPE web) → Extraer novedades → Gemini → Validar → POST /api/webhooks/construccion
    │
    ├── FLUJO 3: BOE (normativas)
    │   HTTP (BOE RSS) → Filtrar → Gemini → Validar → Preparar payload → POST /api/webhooks/construccion
    │
    ├── FLUJO 4: GOOGLE NEWS
    │   HTTP (Google News RSS) → Extraer → Gemini → Validar → Preparar payload → POST /api/webhooks/construccion
    │
    ├── FLUJO 5: INE (índices)
    │   HTTP (INE API) → Procesar → Gemini → Validar → Preparar payload → IF not empty → POST /api/webhooks/construccion
    │
    └── FLUJO 6: ESIOS/REE (electricidad)
        HTTP (ESIOS web) → Procesar → Gemini → Validar → POST /api/webhooks/construccion
```

## ENDPOINTS DE LA PLATAFORMA

### 1. POST /api/pb/ingest (SOLO para precios retail)
- **Auth**: `Authorization: Bearer enlaze-sync-2026-precio`
- **Body**:
```json
{
  "provider_name": "ManoMano",
  "sector": "construccion",
  "source_url": "https://www.manomano.es/...",
  "products": [
    { "name": "Cemento 25kg", "price": 4.95, "unit": "saco", "category": "material", "subcategory": "cementos", "brand": "Sika", "sku": "MM-12345" }
  ]
}
```
- **Respuesta**: `{"ok":true,"inserted":X,"updated":Y,"unchanged":Z,"errors":0,"total":N}`
- **Límite**: máximo 500 productos por petición
- **Sectores válidos**: construccion, comercio_local, estetica, hosteleria, automocion, educacion

### 2. POST /api/webhooks/construccion (para CYPE, BOE, News, INE, ESIOS)
- **Auth**: Header Auth credential (id: MxfBS0YmCERT2Ouh)
- **Body varía por tipo**: ver payloads más abajo

## PROBLEMAS ACTUALES QUE HAY QUE RESOLVER

### PROBLEMA 1: Scraping retail bloqueado por Cloudflare
**Situación**: Los 5 nodos HTTP de scraping (Leroy/OBRAMAT renombrados) ahora apuntan a ManoMano.es pero Cloudflare bloquea las peticiones HTTP directas de n8n. Solo Puppeteer (Chrome headless) puede pasar.

**URLs actuales en los nodos HTTP**:
- "OBRAMAT - Cementos y morteros" → https://www.manomano.es/cementos-y-morteros-3950
- "OBRAMAT - Fontanería baño" → https://www.obramat.es/fontaneria/ (¡aún en OBRAMAT!)
- "Leroy - puertas-ventanas-y-escaleras/" → https://www.manomano.es/las-categorias-de-productos-mas-populares/5756
- "Leroy - madera" → https://www.manomano.es/cat/madera
- "Leroy - baños" → https://www.manomano.es/hub/albanileria-3944
- "Leroy - iluminación" → https://www.manomano.es/cat/iluminacion
- "Leroy - materiales construcción" → https://www.manomano.es/hub/construccion-y-materiales-3943

**Solución ya implementada**: `scripts/scraper-precios.js` usa Puppeteer + puppeteer-core para scrapear ManoMano y enviar directamente a /api/pb/ingest. Este script YA FUNCIONA (probado, inserta productos en Supabase). Usa selectores `[data-testid="productCardVertical"]` y extrae precios del `aria-label` de `[role="group"]`.

**Lo que falta decidir**: ¿Reemplazar el flujo retail del workflow con un nodo "Execute Command" que llame al script? ¿O integrar el scraping con Puppeteer dentro del workflow de otra forma?

### PROBLEMA 2: Nodo "Code - Validar JSON CYPE" tiene código incorrecto
El código es una COPIA EXACTA del nodo de precios retail. Dice `provider_name: 'Leroy Merlin / OBRAMAT'` y referencia `$items("Extraer y normalizar precios retail")` en el fallback. Debería ser un validador para datos CYPE que envía al webhook, no al ingest.

**Código actual incorrecto**:
```javascript
// Dice provider_name: 'Leroy Merlin / OBRAMAT' - INCORRECTO para CYPE
// Referencia $items("Extraer y normalizar precios retail") - INCORRECTO
// Formatea como ingest (provider_name, products) pero se envía a /api/webhooks/construccion
```

**Debería formatear para el webhook así**:
```javascript
return [{
  json: {
    action: "update_prices",
    sector: "construccion",
    data: { prices: aiPrices }
  }
}];
```

### PROBLEMA 3: provider_name incorrecto en "Code - Validar JSON precios IA"
Dice `provider_name: 'Leroy Merlin / OBRAMAT'` pero ahora scrapeamos ManoMano. Debería ser `provider_name: 'ManoMano'` y `source_url: 'https://www.manomano.es'`.

### PROBLEMA 4: El nodo "Extraer y normalizar precios retail" tiene datos fallback hardcodeados
Si el scraping falla (que siempre falla por Cloudflare), usa precios estáticos inventados como:
```
['Plato de ducha resina 70x120', 189.00]
['Saco cemento gris 25 kg CEM II', 4.85]
```
Esto mete datos falsos en la plataforma. Si el scraping no funciona, NO debería enviar nada.

## CÓDIGO COMPLETO DE CADA NODO DE ENVÍO

### "Enviar precios retail a Enlaze" (→ /api/pb/ingest)
```
Method: POST
URL: https://enlaze.vercel.app/api/pb/ingest
Auth: Header Auth "ENLAZE Sync API" (Authorization: Bearer enlaze-sync-2026-precio)
Body: {{ JSON.stringify($json) }}
← recibe de: "Code - Validar JSON precios IA"
```

### "Enviar feed CYPE a Enlaze" (→ /api/webhooks/construccion)
```
Method: POST
URL: https://enlaze.vercel.app/api/webhooks/construccion
Auth: Header Auth original
Body: {{ JSON.stringify($json) }}
← recibe de: "Code - Validar JSON CYPE"
```

### "Enviar normativas a Enlaze" (→ /api/webhooks/construccion)
```
← recibe de: "Preparar payload normativas Enlaze"
Payload format: { action: "update_regulations", sector: "construccion", data: { regulations: [...] } }
```

### "Enviar noticias a Enlaze" (→ /api/webhooks/construccion)
```
← recibe de: "Preparar payload noticias Enlaze"
Payload format: { action: "update_news", sector: "construccion", data: { news: [...] } }
```

### "Enviar índices INE a Enlaze" (→ /api/webhooks/construccion)
```
← recibe de: "IF - Ignorar INE vacío"
Payload format: { action: "update_prices", sector: "construccion", data: { prices: [...] } }
```

### "Enviar señales energía a Enlaze" (→ /api/webhooks/construccion)
```
← recibe de: "Code - Validar JSON energía"
Payload format: { action: "update_prices", sector: "construccion", data: { prices: [...] } }
```

## CREDENCIALES EN N8N
- **"Header Auth ENLAZE Sync API"** (id: 00WTdAFCZp67qL2k): `Authorization: Bearer enlaze-sync-2026-precio` → para /api/pb/ingest
- **Credential original** (id: MxfBS0YmCERT2Ouh): para /api/webhooks/construccion
- **Google Gemini API**: usado en todos los nodos Gemini para normalizar datos con IA

## SCRIPT PUPPETEER: scripts/scraper-precios.js
Ya reescrito y funcional. Usa puppeteer-core, pagina automáticamente las categorías, extrae productos con selectores `[data-testid="productCardVertical"]`, deduplica, y envía en batches a /api/pb/ingest.

**Ejecución**:
```bash
SYNC_API_KEY=enlaze-sync-2026-precio node scripts/scraper-precios.js
SYNC_API_KEY=enlaze-sync-2026-precio node scripts/scraper-precios.js --dry-run --max-products 10
```

## TABLAS SUPABASE

### pb_products (productos con precios)
commercial_name, unit_price, provider_id, sector, category, subcategory, brand, sku, last_synced_at, source_url, price_trend (up/down/stable), is_active, is_available, product_type, sale_unit, description

### pb_providers (proveedores)
name, legal_name, country, is_active, sector

### pb_price_observations (historial de precios)
product_id, provider_id, observed_price, source, source_url, metadata, observed_at

### price_sync_logs (logs de sincronización)
status, sector, source, provider_name, products_total, products_inserted, products_updated, products_errors, source_url, finished_at

## TAREAS CONCRETAS PARA CODEX

1. **Arreglar el nodo "Code - Validar JSON CYPE"**: cambiar el código para que formatee correctamente para /api/webhooks/construccion (no para /api/pb/ingest). Quitar las referencias a "Leroy Merlin" y "$items(Extraer y normalizar precios retail)".

2. **Arreglar el nodo "Code - Validar JSON precios IA"**: cambiar `provider_name` a `'ManoMano'` y `source_url` a `'https://www.manomano.es'`.

3. **Arreglar el nodo "Extraer y normalizar precios retail"**: quitar los datos fallback hardcodeados. Si no hay productos scrapeados, devolver array vacío y que el flujo se detenga.

4. **Decidir cómo integrar el script Puppeteer en el workflow**: Opción A: Reemplazar los 5 nodos HTTP + Merge + Extraer + Gemini + Validar con un solo nodo "Execute Command" que ejecute `scripts/scraper-precios.js` (el script ya envía directamente a la API, no necesita el nodo de envío). Opción B: Mantener la estructura actual pero hacer que el script Puppeteer se ejecute como un cron job separado (fuera de n8n).

5. **Verificar que los flujos 2-6 (CYPE, BOE, News, INE, ESIOS) funcionan correctamente** enviando a /api/webhooks/construccion.

6. **Verificar que /api/webhooks/construccion existe y maneja todos los action types**: update_prices, update_regulations, update_news.

## CÓMO PROBAR

### Probar /api/pb/ingest (precios retail):
```bash
curl -s -X POST https://enlaze.vercel.app/api/pb/ingest \
  -H "Authorization: Bearer enlaze-sync-2026-precio" \
  -H "Content-Type: application/json" \
  -d '{"provider_name":"Test","sector":"construccion","products":[{"name":"Cemento Portland 25kg","price":4.95}]}'
```

### Probar el scraper Puppeteer:
```bash
SYNC_API_KEY=enlaze-sync-2026-precio node scripts/scraper-precios.js --dry-run --max-products 5
```

### Probar webhook (CYPE, BOE, etc):
```bash
curl -s -X POST https://enlaze.vercel.app/api/webhooks/construccion \
  -H "Authorization: Bearer <WEBHOOK_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"action":"update_news","sector":"construccion","data":{"news":[{"title":"Test","content":"Test news","source":"manual"}]}}'
```

## ARCHIVO DEL WORKFLOW
El archivo JSON del workflow completo está en el repo como archivo subido. Tiene 51 nodos. Cualquier cambio en los nodos Code se puede hacer editando el JSON directamente y reimportándolo en n8n.
