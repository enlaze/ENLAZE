# b5-dependencias — informe (2026-10-08)

## Qué ha cambiado
`npm audit` partía de **32 vulnerabilidades (1 crítica, 22 altas)**. Hoy eran más que las 20 que recordaba la cola. Quedan **16 (0 críticas, 15 altas, 1 moderada)**.

1. **`npm audit fix` sin `--force`.** Solo cambia `package-lock.json`, con subidas de dependencias indirectas dentro de su rango: `postcss`, `nanoid`, `dompurify`, `svix`/`uuid` (de `resend`), `js-yaml`, `brace-expansion` y otras. Quita 14.
2. **`next` 16.2.1 → 16.3.8 y `eslint-config-next` 16.2.1 → 16.3.8.** Siguen fijados a versión exacta. Next estaba fijado, así que `audit fix` no lo tocaba, y era **lo más grave en producción**: 3 avisos críticos de ejecución remota de código (optimizador de imágenes con AVIF, `next/og` y servidores en Windows). También tenía varios de saltarse el proxy, de SSRF y de denegación de servicio. 16.3.8 es la primera versión fuera de todos los rangos afectados. Elegí la 16.3.8 y no la 16.4.0 por ser el salto más pequeño que los arregla todos; las dos son la misma versión mayor.

## Qué queda y qué recomiendo

| Paquete | ¿Producción? | Riesgo real | Arreglo | Recomendación |
|---|---|---|---|---|
| `xlsx` 0.18.5 (alta) | **Sí**: `lib/price-import.ts` lee los Excel que suben los usuarios | contaminación de prototipo y ReDoS **con ficheros del usuario** | no hay en npm; SheetJS publica la 0.20.x en su CDN | **La más importante.** Cambiar a `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, o a `exceljs`, y probar la importación con Excel reales |
| `sharp` 0.34.5 (alta) | **Sí**: `invoices/ocr` procesa las fotos de facturas | fallos de libvips, libheif y librsvg al procesar imágenes subidas | 0.35.5 (en 0.x cuenta como mayor) | Subir en un bloque propio y probar el escaneo de facturas con JPG, PNG y WebP |
| `@anthropic-ai/sdk` 0.80 (moderada) | Sí, en 10 rutas | solo afecta a la "herramienta de memoria" en disco local, **que no usamos** | 0.132 (mayor) | Bajo riesgo hoy. Subirla cuando se toque la IA, porque cambia la API del SDK |
| `puppeteer-core` 24 y sus dependencias `basic-ftp`, `get-uri`, `proxy-agent`, etc. (altas) | **No**: solo los scripts de scraping (`scripts/`), que no se despliegan en Vercel | sobre todo en la descarga del navegador | `puppeteer-core` 25 (mayor) | Igualarlo con `puppeteer` ^25, que ya usamos, y probar `npm run scrape:prices -- --dry-run` |
| `eslint-config-next` y sus dependencias `fast-glob`, `micromatch`, `braces` (altas) | **No**: solo desarrollo | ninguno en producción | la "solución" de npm es bajar a la 14.2.35, un sinsentido | Ignorar; se resolverá cuando Next actualice su plugin |

## Cómo lo he verificado
- `npx next build` sin errores y `tsc` limpio.
- Pruebas unitarias: las mismas que en main (546 superadas). Los 19 fallos que quedan son los de siempre y los arregla b4.
- `lint`: mismas cifras que en main salvo **5 avisos** (no errores) de una regla nueva de Next 16.3, `no-location-assign-relative-destination`, en `app/error.tsx`, `app/dashboard/error.tsx`, `projects/[id]`, `CuentaPanel` e `IntegracionesPanel`.
- **No lo he probado en Vercel.** El cambio de Next llega a producción al fusionar, porque Vercel instala desde `package-lock.json`.

## Qué decides tú
1. ¿Fusionas la subida de Next ya? Es la crítica. Antes conviene abrir la *preview* de Vercel de esta rama y pasar por el login, el generador de presupuestos y el PDF.
2. ¿Abro bloques para `xlsx` y `sharp`? Los dos tratan ficheros que sube el usuario.

## Qué mirar con tus ojos (10 min)
- En la *preview*: iniciar sesión, crear un presupuesto, descargar el PDF, importar un Excel de precios y escanear una factura.
- `git diff main -- package.json`: solo cambian las dos líneas de Next.
