# Tareas autónomas para Claude Code

Cola de trabajo para avanzar en Enlaze sin que Daniil tenga que estar encima.
Cada sesión: **"Coge el siguiente bloque de TAREAS_AUTONOMAS.md y trabájalo entero siguiendo sus reglas."**

---

## Reglas — siempre, en todos los bloques

1. **Una rama por bloque**, llamada `auto/<id del bloque>` (por ejemplo `auto/b1-mi-precio`). Commit y push de esa rama, sí. **Nunca** tocar `main`, nunca fusionar, nunca hacer push a `main`.
2. **Qué bloque toca:** el primero de la cola cuya rama `auto/<id>` no exista ni en local ni en `origin`. No edites este fichero para marcar bloques.
3. **Como mucho 3 ramas `auto/*` sin fusionar a la vez.** Si ya hay 3, no empieces otro bloque: avisa y para.
4. **Base de datos: SOLO LECTURA.** Solo hay una base y es la de producción. Prohibido aplicar migraciones, insertar, modificar o borrar datos. Si un bloque necesita una migración, escríbela como fichero en la rama y anótala en el informe como **pendiente de aprobar**.
5. **Pruebas que escriben en la base real: no se lanzan.** Déjalas listadas en el informe con el comando exacto para que las lance Daniil. Las pruebas unitarias, `tsc`, `lint` y `build` sí.
6. **Nada hacia fuera:** ni emails, ni WhatsApp, ni Stripe (tampoco modo prueba), ni Vercel, ni n8n, ni GitHub más allá de subir la rama.
7. **Secretos:** no leas, imprimas ni copies valores de `.env.local` ni de ningún fichero con claves.
8. **Decisiones de producto, no las inventes.** Si algo pide decidir (textos que ve el cliente, quitar una función, precios), apunta la pregunta en el informe y sigue con lo que no dependa de ella.
9. **Comprobar antes de afirmar.** `tsc`, `lint` sin errores nuevos, las pruebas relacionadas y `npm run build`. Lo que no hayas podido comprobar, dilo tal cual. Nada de "funciona en producción" si lo has probado en local.
10. **Informe al terminar**, en la rama: `informes/AAAA-MM-DD-<id>.md`, en castellano llano y en una página como mucho:
    - qué ha cambiado;
    - cómo lo has comprobado;
    - qué tiene que decidir o aprobar Daniil;
    - qué revisar con sus propios ojos en 10 minutos.
11. Si terminas un bloque y queda margen, puedes seguir con el siguiente, en su propia rama y respetando la regla 3.

---

## Estado de la cola (2026-10-12)

- **En `main`** (fusionados por Daniil en sesión): b1, b2, b3, b4, b5, b6 y b8. Migración de b8 aplicada (`20261012100029`, `verifactu_certified = false`).
- **Rama abierta, esperando a Daniil:** `auto/b9-proxy-n8n`. **No fusionar todavía.** Ver su informe y la nota del proxy más abajo.
- **Ramas `auto/*` sin fusionar: 1** (b9). Hay margen para la regla 3.
- **Siguiente bloque:** b7-supplier.
- Las pruebas unitarias están en verde en `main`: 608 pasan, 0 fallan y 2 `todo` (se lanzan todos los `__tests__/*.test.mjs` salvo `.integration.` y `.browser.`). `lint` tiene 23 errores, todos de `react-hooks` (ver "Esperando decisión").

---

## Cola de bloques (en orden)

### b1-mi-precio — El precio que pone el usuario manda

- `/api/prices/resolve` busca `is_locked`, que no existe. La pantalla de Precios guarda "Marcar como manual" en `is_manual_override`. Conecta el resolvedor con `is_manual_override`. **No apliques `price_bank_v2`.**
- Decisión ya tomada: si el usuario ha fijado un precio a mano, **manda sobre todo**. Nivel 1 de la cascada, por encima de n8n, del proveedor y del ajuste geográfico. Sin excepciones.
- Que en el presupuesto se vea cuándo un precio es el suyo.
- Prueba: marcar un precio como manual, generar una partida con ese material y comprobar que sale ese precio exacto. Si la prueba necesita escribir en la base, déjala lista y aplica la regla 5.

### b2-sin-anon-fallback — Rutas que caen a la clave pública

- Hay rutas que, si falta `SUPABASE_SERVICE_ROLE_KEY`, usan la anon key en vez de fallar: `/api/agent/*`, `webhooks/comercio-local`, `pb/webhook`, `webhooks/construccion` y las que encuentres.
- Que fallen con 500 y un error claro en el log, igual que hace `lib/api-key-auth.ts` con las claves compartidas. Nunca "sin clave, pasa".
- Barre el código buscando cualquier secreto o clave escrito a fuego como valor por defecto, y quítalo.

### b3-codigo-muerto — Limpiar rutas que no usa nadie

- Candidatas: `/api/budgets/generate-v2`, `/api/budgets/reprice`, `/api/pb/providers`, `/api/pb/providers/[id]`, `/api/pb/products`.
- Antes de borrar cada una, demuestra que nadie la llama: la app, los workflows de `n8n-workflows/`, `scripts/` y las pruebas. Si alguna tiene un llamante, no la borres y explícalo en el informe.

### b4-pruebas-verdes — Que la batería de pruebas esté sana

- `test:p1` tiene unos 18 fallos porque busca ficheros de migración que se renombraron. `lint` tiene errores heredados en ficheros tocados por los pagos.
- Arréglalo sin cambiar el comportamiento de la app. Si una prueba estaba mal planteada, corrígela y explícalo; no la borres para que pase.

### b5-dependencias — `npm audit`

- La última vez marcaba 20 vulnerabilidades (11 altas, 1 crítica).
- Clasifícalas: cuáles afectan a lo que se ejecuta en producción y cuáles solo a desarrollo.
- Aplica las que se arreglan sin cambios incompatibles. **Nunca `npm audit fix --force`.**
- Las que exigen saltos de versión grandes, déjalas en el informe con tu recomendación.

### b6-verifactu-auditoria — Qué hay hecho de Verifactu (solo informe)

- En el código hay `verifactu_hash`, `verifactu_prev_hash`, `verifactu_qr_data`, `verifactu_registered`, `verifactu_enabled` y una sección de cumplimiento fiscal.
- Escribe un informe con lo que está hecho y lo que falta frente al Real Decreto 1007/2023: huella encadenada, QR, registro de eventos, envío a la AEAT, inalterabilidad y declaración responsable del fabricante. Fechas de referencia: obligatorio para autónomos desde el 1 de julio de 2027.
- **Solo informe, sin cambios de código.** Marca como "a confirmar con un asesor" todo lo que sea interpretación legal.

### b7-supplier — Interfaz `Supplier` desincronizada

- La interfaz declara campos que no existen en la tabla (`city`, `postal_code`, `province`, `trade_name`, `iban`, `category_id`…) y salen vacíos en la ficha del proveedor.
- Contrasta con el esquema real (solo lectura) y alinea tipos y pantalla. Si quitar un campo cambia lo que ve el cliente, apúntalo como pregunta.

### b8-quitar-verifactu — HECHO (en main el 2026-10-12)

Fuera las promesas de Verifactu, el hash y el semáforo fiscal de todo lo que ve el usuario. `/dashboard/compliance/fiscal` queda sin enlace desde el hub, con el visto bueno de Daniil.

### b9-proxy-n8n — RAMA ABIERTA, no fusionar

`proxy.ts` deja pasar a n8n en sus 9 rutas exactas de `/api/agent`, y solo si llevan Bearer. **Ojo:** el 401 del proxy en `/api/*` copia las cabeceras de `NextResponse.next()` (incluida `x-middleware-next: 1`) y Next lo ignora, así que hoy cada ruta de `/api` solo está protegida por su propia comprobación. Arreglarlo cambia el comportamiento de toda la API: decide Daniil.

### b10-facturae-sin-firma — Quitar "Facturae firmado"

- Ajustes › Empresa (`components/settings/EmpresaPanel.tsx`) dice "Emite en formato Facturae **firmado**", pero el XML se genera sin firma (lo vio b6). Quitar "firmado" y cualquier otro texto que prometa firma, con el mismo criterio que b8: se quita, no se cambia por otra promesa.
- Busca en app, components y lib "firma", "firmado" y "XAdES" aplicados a Facturae. Ojo: la firma de presupuestos (`SignaturePanel`, OTP) es otra cosa y no se toca.

---

## Esperando decisión de Daniil (no los coge Code)

- **b4:** (1) migración del bucket `received-invoice-documents` con policy de lectura para su dueño; (2) migración idempotente que declare las 5 columnas de `agent_connections`; (3) los 23 errores de `react-hooks`: un bloque pantalla a pantalla o bajarlos a aviso.
- **b5:** ¿abrir bloques para `xlsx` (sin arreglo en npm: SheetJS 0.20.x o `exceljs`) y `sharp` 0.35? Los dos tratan ficheros que sube el usuario.
- **b6:** construir Verifactu en casa o integrar un proveedor; y con el asesor, la modalidad, las facturas ya marcadas y la declaración responsable.
- **b8:** `verifactu_enabled` sigue a `true` por defecto, así que las facturas nuevas salen con `verifactu_registered = true` sin que se vea. Cambiarlo sería otra migración.
- **b9:** fusionar o no, y arreglar o no el 401 del proxy en `/api/*`.

---

## Bloqueados — no los coge Code, dependen de Daniil o del mundo real

- **Briefing híbrido** (`feat/briefing-hibrido`): necesita saldo de API de Anthropic para validarlo.
- **Cobrar de verdad:** claves de Stripe y webhook en Vercel; decidir Apple Pay y Klarna; que Stripe sume el IVA.
- **IVA y entidad legal:** gestoría. Ojo con las bases de la Maratón UMH antes de constituir nada.
- **Correo en `enlaze.es` y conectar el dominio a Vercel.** Después, cambiar los enlaces legales de Stripe a `enlaze.es`.
- **Migraciones abiertas:** `obra_partes_gantt` (decidir si se construyen los partes de trabajo y el Gantt) y la policy de lectura del bucket de documentos del OCR (aprobar).
- **Posicionamiento de la landing:** el nuevo mensaje ("asistente que hace el trabajo de oficina") lo revisa Daniil antes de tocar textos.

---

## Revisión semanal de Daniil (20 minutos)

1. `git fetch` y mirar qué ramas `auto/*` hay.
2. Leer el informe de cada una.
3. Probar lo que diga "revisar en 10 minutos".
4. Fusionar o descartar. Aprobar o rechazar las migraciones pendientes.
