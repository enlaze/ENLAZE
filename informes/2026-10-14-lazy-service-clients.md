# Arranque sin claves de correo o IA

**Rama:** `codex/lazy-service-clients`, nueva desde `origin/main` (`10788b1`). Sin PR. No se añadieron claves a Preview ni se modificaron entornos, datos, migraciones o configuración de producción.

**Cambio:** los cinco módulos encargados usan `lib/service-clients.ts`, con `getResend()` y `getAnthropic()` perezosos y memorizados. Importar el módulo no construye clientes; cada getter comprueba su clave y solo entonces crea/reutiliza el SDK. Una clave ausente produce `RESEND_API_KEY no está configurada` o `ANTHROPIC_API_KEY no está configurada` dentro del manejo de errores de la petición. Send-OTP también registra el error explícitamente. Se conservan las referencias de tipos y `Anthropic.NotFoundError` del OCR sin crear una instancia al importar.

Los getters se llaman antes de guardar el OTP o reservar cuota de IA. La prueba del OCR confirma que, sin clave, responde 500 sin extraer, reservar cuota ni subir archivos. El test de transporte existente ahora declara correctamente un servicio configurado mediante una clave sintética y su SDK simulado; las pruebas de importación y del build siguen con las variables ausentes.

**Regresión:** seis casos pasan: importación aislada de cada uno de los cinco módulos con ambas variables borradas, y errores/memorización de los getters. Proxies observan los constructores reales, tanto en ESM como CommonJS, sin cambiar su comportamiento. Además de exigir que el import no lance, se exige cero construcciones: Anthropic 0.80.0 permite construir sin clave y una prueba solo de «no lanzar» no detectaría su regresión. El caso positivo comprueba una única construcción real por SDK y la identidad del cliente en llamadas posteriores, sin peticiones de correo o IA.

**Mutaciones: 5/5 detectadas.** Se añade un `new` a nivel de módulo, por separado, en cada fichero de una copia temporal. La aserción de importación falla para Resend; para Anthropic falla el contador de construcciones. Se verifican el caso concreto y código 1, y el código original permanece intacto.

```text
BASELINE 6/6 PASS
KILLED notification: eager resend
KILLED send-otp: eager resend
KILLED budget-generate: eager anthropic
KILLED market-analysis: eager anthropic
KILLED invoice-ocr: eager anthropic
5/5 mutants killed; real source unchanged; no email or AI requests.
```

**Build comprobado con dependencias exactas del lockfile:** se instalaron mediante `npm ci --ignore-scripts --no-audit --no-fund`. Next **16.3.8**, Turbopack, ejecución real de `npm run build`, incluido su `prebuild`:

```text
plan_catalog coincide con lib/plans.ts (4 planes)
Next.js 16.3.8 (Turbopack)
Compiled successfully
Collecting page data using 9 workers
Generating static pages ... (134/134)
PASS npm run build with service credentials absent (including prebuild)
```

El proceso de build tiene `RESEND_API_KEY` y `ANTHROPIC_API_KEY` **ausentes**, sin valores de relleno. Se rechazan `.env` y no se heredan credenciales de la máquina. `plans:check` consulta una fixture HTTP local de solo lectura, con los cuatro planes reales de `lib/plans.ts`; Stripe queda sin clave y no se consulta. La respuesta de fuentes usa el hook de pruebas de Next y todos los sockets externos se rechazan antes de conectar. No se valida aquí el catálogo ni los precios de producción. El build emite un aviso nativo de libvips en macOS, sin afectar su salida 0.

**Otras comprobaciones:** TypeScript correcto; ESLint sin errores y con un aviso previo por una variable de `catch` sin usar en notification-service. Once pruebas de OCR/ausencia de fallback pasan. `p1-review` termina con 58 casos correctos y dos TODO anteriores por migraciones ausentes, sin fallos nuevos. `git diff --check` correcto.

**Automatización:** se añade `service-clients-without-keys.yml`, que instala el lockfile, ejecuta las mutaciones y el build sin claves en PRs que afecten estos archivos o por ejecución manual. No utiliza secretos; no se abrió PR ni se ejecutó el workflow remoto.

**Repetir:** `npm run test:service-clients`, `npm run test:service-client-mutations`, `npm run test:build-without-service-keys`. Salidas completas en `informes/evidencias/lazy-service-clients/`: baseline, cinco mutantes y build. Las variables falsas del test positivo de constructores solo existen en su proceso de prueba; nunca se envían a un servicio ni se configuran en Preview.
