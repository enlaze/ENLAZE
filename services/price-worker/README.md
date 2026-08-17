# ENLAZE Price Worker

Servicio independiente para importar tarifas públicas y oficiales en el banco de
precios de ENLAZE. Incluye el catálogo profesional BC3/FIEBDC que Roca publica
desde su zona profesional y las fichas JSON-LD de IKEA España.

## Criterios de funcionamiento

- usa el `Fetcher` HTTP normal de Scrapling, nunca sus modos stealth;
- se identifica con `ENLAZE-Public-Price-Monitor/1.0` (configurable);
- comprueba `robots.txt` y se detiene si el acceso no está permitido;
- confirma que Roca sigue publicando el enlace exacto antes de descargarlo;
- conserva fecha y SHA-256 del BC3 como evidencia de cada observación;
- trabaja en modo simulación por defecto; `--send` es imprescindible para escribir;
- registra si el precio incluye IVA: Roca se importa sin IVA e IKEA con IVA.

## Ejecución local

Requiere Python 3.10 o posterior.

```bash
cd services/price-worker
python3 -m venv .venv
.venv/bin/pip install .

# Descarga, valida y muestra una muestra; no escribe en ENLAZE
.venv/bin/enlaze-price-worker roca

# Importación real
PRICE_INGEST_URL=https://enlaze.es/api/pb/ingest \
SYNC_API_KEY=... \
.venv/bin/enlaze-price-worker roca --send

# IKEA: simulación limitada a 25 productos de reforma
.venv/bin/enlaze-price-worker ikea

# IKEA: lote real de 100 fichas, con una pausa entre peticiones
PRICE_INGEST_URL=https://enlaze.es/api/pb/ingest \
SYNC_API_KEY=... \
.venv/bin/enlaze-price-worker ikea --send --max-products 100
```

IKEA publica más de 28.000 URLs. El comando filtra por defecto cocinas, baños,
iluminación, puertas y revestimientos, y limita cada ejecución a 25 fichas. Usa
`--start-at` para reanudar y `--all-products` solo cuando se haya planificado un
rastreo completo. Cada ficha se valida contra vendedor, SKU, URL y precio.

Leroy Merlin y OBRAMAT publican sitemaps, pero actualmente responden HTTP 403 al
worker identificado. El servicio no intenta superar esa protección. Porcelanosa
publica referencias en España, pero no ofrece una tarifa pública verificable.

Para comprobar un archivo ya descargado sin usar la red:

```bash
PYTHONPATH=src python3 -m enlaze_price_worker roca --catalog-file /ruta/fiebdc-roca.zip
```

## Conexión local con n8n

El servicio HTTP escucha únicamente en el propio ordenador. La escritura está
desactivada salvo que se añada `--enable-send` de forma explícita:

```bash
.venv/bin/enlaze-price-worker serve \
  --env-file ../../.env.local \
  --api-url https://enlaze.vercel.app/api/pb/ingest \
  --enable-send
```

Comprobaciones locales:

```bash
curl http://127.0.0.1:8765/health
curl -X POST http://127.0.0.1:8765/run/roca/dry-run
```

El workflow `n8n-workflows/08-roca-catalogo-oficial-semanal.json` llama a este
servicio cada lunes a las 04:00. No necesita guardar la API key dentro de n8n.
El Mac, n8n y el worker deben estar encendidos en ese momento.

## Docker y programación

```bash
docker build -t enlaze-price-worker .
docker run --rm \
  -e PRICE_INGEST_URL=https://enlaze.es/api/pb/ingest \
  -e SYNC_API_KEY \
  -v enlaze-roca-state:/data \
  enlaze-price-worker roca --send
```

Los catálogos completos son grandes, por lo que una ejecución semanal es suficiente.
n8n puede lanzar este contenedor o su comando cada lunes. El volumen `/data`
conserva ETag y `Last-Modified` para evitar descargas innecesarias.

No añadas técnicas de ocultación, rotación de identidades, resolución automática
de bloqueos ni bypass de controles. Para una fuente nueva, prioriza API, feed,
tarifa descargable o autorización escrita del proveedor.
