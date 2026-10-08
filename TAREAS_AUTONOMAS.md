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
