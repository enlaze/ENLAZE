# ENLAZE Price Worker

Servicio independiente para importar tarifas públicas y oficiales en el banco de
precios de ENLAZE. La primera fuente es el catálogo profesional BC3/FIEBDC que
Roca publica desde su propia zona profesional.

## Criterios de funcionamiento

- usa el `Fetcher` HTTP normal de Scrapling, nunca sus modos stealth;
- se identifica con `ENLAZE-Public-Price-Monitor/1.0` (configurable);
- comprueba `robots.txt` y se detiene si el acceso no está permitido;
- confirma que Roca sigue publicando el enlace exacto antes de descargarlo;
- conserva fecha y SHA-256 del BC3 como evidencia de cada observación;
- trabaja en modo simulación por defecto; `--send` es imprescindible para escribir;
- envía precios sin IVA, conforme a la convención del banco de precios.

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
```

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

El catálogo completo es grande, por lo que una ejecución semanal es suficiente.
n8n puede lanzar este contenedor o su comando cada lunes. El volumen `/data`
conserva ETag y `Last-Modified` para evitar descargas innecesarias.

No añadas técnicas de ocultación, rotación de identidades, resolución automática
de bloqueos ni bypass de controles. Para una fuente nueva, prioriza API, feed,
tarifa descargable o autorización escrita del proveedor.
