# Configuracion de Workflows n8n para ENLAZE

## Tu workflow actual (Enlaze - Construccion y reformas)

Tu workflow existente ya funciona. Lo unico que necesitas hacer:

### 1. Configurar la credencial Header Auth

En n8n, ve a **Credentials** y busca "Header Auth account". Configura:
- **Name**: `Authorization`
- **Value**: `Bearer enlaze-n8n-2024`

(El valor debe coincidir con tu variable `WEBHOOK_SECRET` en `.env.local` y Vercel)

### 2. Tu workflow ya envia datos al Price Bank V2

He actualizado el endpoint `/api/webhooks/construccion` para que automaticamente
haga "bridge" de los precios al nuevo sistema Price Bank V2 (tablas `pb_*`).
No necesitas cambiar nada en tu workflow actual.

---

## Nuevo workflow: Proveedores Extra

Archivo: `proveedores-extra-scraper.json`

Este workflow scrapea 7 proveedores adicionales:
- BigMat (materiales + herramientas)
- Porcelanosa (ceramica y bano)
- Roca (sanitarios)
- Bauhaus (materiales de construccion)
- Bricoking (materiales)
- Grupo Puma (morteros y adhesivos)

### Como importar en n8n

1. Abre n8n
2. Ve a **Workflows** > **Import from file**
3. Selecciona `proveedores-extra-scraper.json`
4. Configura la credencial:
   - Haz clic en el nodo **"Enviar a ENLAZE PB V2"**
   - En **Credentials**, crea una nueva "Header Auth":
     - Name: `Authorization`
     - Value: `Bearer enlaze-n8n-2024`
5. Si tu app esta en Vercel, la URL ya apunta a `https://enlaze.vercel.app/api/pb/webhook`
6. Para probar en local, cambia la URL a `http://localhost:3000/api/pb/webhook`
7. Haz clic en **Test Workflow** para probarlo

### Variables de entorno opcionales en n8n

Puedes definir estas variables de entorno en n8n para no hardcodear URLs:
- `ENLAZE_WEBHOOK_URL`: URL del webhook (default: `https://enlaze.vercel.app/api/pb/webhook`)

---

## Proveedores soportados (total)

| Proveedor | Workflow | Tipo |
|-----------|----------|------|
| Leroy Merlin | Construccion y reformas | Retail |
| OBRAMAT | Construccion y reformas | Retail |
| CYPE | Construccion y reformas | Base de precios |
| BOE | Construccion y reformas | Normativas |
| Google News | Construccion y reformas | Noticias sector |
| INE | Construccion y reformas | Indices mercado |
| ESIOS/REE | Construccion y reformas | Precio electricidad |
| BigMat | Proveedores Extra | Almacen materiales |
| Porcelanosa | Proveedores Extra | Fabricante ceramica |
| Roca | Proveedores Extra | Fabricante sanitarios |
| Bauhaus | Proveedores Extra | Retail construccion |
| Bricoking | Proveedores Extra | Retail construccion |
| Grupo Puma | Proveedores Extra | Fabricante morteros |

---

## Notas importantes

- Algunas webs bloquean scraping. Si un proveedor no devuelve datos, puede
  necesitar Puppeteer/Playwright en vez de HTTP Request simple.
- Los precios se guardan en dos sitios:
  - `sector_data` (sistema original)
  - `pb_products` + `pb_price_observations` (Price Bank V2)
- Los workflows estan configurados para ejecutarse cada 24h.
- Ambos workflows tienen un Manual Trigger para pruebas.
