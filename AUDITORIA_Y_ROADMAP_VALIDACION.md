# Enlaze — Auditoría de producto y roadmap hasta validación

_Fecha: 2026-07-01 · Objetivo de esta etapa: web prácticamente acabada + primeros usuarios probándola (fase de validación)._

---

> **Actualización 2026-07-02:** Etapa A RESUELTA por decisión de producto — comercio local **no lleva presupuestos** (se ocultó/gateó, construcción intacto). El siguiente foco es la Etapa B (pulido visual) → C (QA).
>
> **Actualización 2026-07-08:** Etapa B HECHA y subida (breadcrumbs + consistencia dark/light). **Etapa activa: C (QA del primer usuario).** Primer usuario real probable = empresa de CONSTRUCCIÓN (padre del socio) → la QA se enfoca en el recorrido de un usuario de construcción, incluido crear un presupuesto con el wizard. Etapa E (servidor/hosting) sigue APARCADA hasta tener ese usuario listo.

## 1. Veredicto: dónde estás de verdad

El producto está **feature-complete**, no a medias. Datos objetivos de la auditoría:

- **19 módulos** del dashboard, y **todos leen datos reales de Supabase** (no son maquetas): clientes, presupuestos, catálogo, proveedores, pedidos, albaranes, calendario, facturas recibidas/emitidas, pagos, márgenes, emails, WhatsApp/mensajes, cumplimiento, registro de actividad, ajustes.
- **Un solo `TODO`** en todo el código. Deuda técnica muy baja.
- Superficie pública real: landing (1.137 líneas), pricing con planes 19/49/199 € y descuento anual, registro, verificación de email, **onboarding real** (multi-paso con consentimiento legal), login.
- Tu **roadmap de polish de abril** ya tiene gran parte del **P0 hecho**: fuente Inter, modal de confirmación, toasts, skeletons, medidor de contraseña, overlay de atajos, toggle anual en pricing, JSON-LD. Empty states usados en 12 módulos.

**Estimación honesta: ~80-85% del camino a "web acabada", no un 40%.**
_Caveat: esto lo juzgo leyendo código estático, no usando la app en caliente ni revisando cada pantalla renderizada. Es una estimación cualitativa; la QA de la Etapa C la confirmará o la corregirá._

---

## 2. El hueco que más importa (prioridad 1)

El **generador de presupuestos solo funciona para el sector Construcción**. Para Comercio Local / Retail —el sector de tu cliente de prueba, Panadería San Juan— la pantalla muestra literalmente *"Flujo Retail en construcción"*.

Es decir: **tu primer sector objetivo no puede generar presupuestos**, que es una función central del producto. Esto es lo primero a cerrar antes de poner usuarios de comercio local a probar.

El detalle está en tu propio `MULTI_SECTOR_WIZARD_TECH_DEBT.md` (4 puntos: configuraciones visuales por sector, quitar el fallback "construccion", unificar la fuente de verdad del sector, y categorías por sector).

---

## 3. Lo que NO es bloqueante (mejora, pero puede esperar)

El resto de tu roadmap de abril (P1/P2): sorting+filtros+paginación en tablas, export CSV/PDF, acciones bulk, breadcrumbs, empty-states ilustrados, social proof en landing, status page, changelog, cookies banner. Todo esto sube la percepción de "premium" pero **no bloquea** que un usuario valide el producto. Se cogen los de más impacto en la Etapa B y el resto se aparca.

---

## 4. Las etapas hasta validación

Método fijo: **yo defino cada etapa, Claude Code ejecuta, tú validas visualmente.** Cada cambio lleva su nota de *qué cambia por dentro / qué cambia visualmente*.

### Etapa A — Presupuestos en comercio local  _(RESUELTA · 2026-07-02)_
Decisión de producto: el concepto de "presupuesto" es nativo de construcción y **no aplica a comercio local**. En vez de construir un wizard retail, se **ocultó y gateó** el módulo de presupuestos para `comercio_local` (construcción intacto). Reversible: se revisará en validación si algún usuario real necesita cotizar (catering, pedidos B2B).
- **Hecho:** budgets fuera del nav de comercio_local (gate en código, no depende de migración), guard de ruta que redirige a `/dashboard`, y eliminado el cartel "en construcción".
- **Pendiente de verificar en vivo:** como usuario comercio_local, confirmar que el nav oculta "Presupuestos" y que la URL directa redirige.

### Etapa B — Pulido visual y de consistencia  _(HECHA · 2026-07-03)_
El rediseño del briefing (ya en marcha) + una pasada de consistencia + los P1 de más impacto de tu roadmap.
- **Interno:** componentes de UI reutilizados, tablas con orden/filtro donde aporte.
- **Visual:** el producto se siente terminado y coherente entre módulos.
- **Reparto:** Cowork prioriza y da dirección de diseño → Code implementa.

### Etapa C — Recorrido del primer usuario (QA end-to-end)  _(QA HECHA · bugs cazados y arreglados · quedan flecos)_

Recorrido de usuario de construcción ejecutado (9-10 jul). Bugs ENCONTRADOS y ARREGLADOS: email/dominio Resend, enlace a localhost, guardar perfil (RLS 42501), botón crear obra (RLS sistémico + columna `projects`), tildes/logo/campo empresa opcional, iconos onboarding + primeros pasos + ajustes.

- **RESUELTO (commit 112a1f8):** el onboarding ya persiste el progreso en sessionStorage — solo falta confirmarlo en vivo.
- **RESUELTO (b5c2479, ee5ab5e):** la recuperación de contraseña ya existía y se ha endurecido (enlace caducado con pantalla clara, mensaje neutro que no filtra qué emails existen, redirectTo con NEXT_PUBLIC_SITE_URL, flujo PKCE). Pendiente solo probarla en vivo.
- **BLOQUEANTE DE EMAIL (lo importante ahora):** los emails de Supabase están topados a ~2/hora, así que el reseteo de contraseña y el email de registro NO llegan de forma fiable. Falta configurar **Resend como SMTP de Supabase** — eso desbloquea los dos de golpe.
- **Pendiente menor:** mover "Registro de actividad" fuera del menú principal (accesible desde Cumplimiento).
- **En curso (pulido):** sustituir emojis por iconos lucide, pantalla por pantalla (queda ~la mitad).
- **SIGUIENTE PASO GRANDE:** validar el presupuestador con un constructor real (padre del socio). El banco de precios vacío hace que las estimaciones no sean fiables; hay que ver si aporta valor de verdad.
- Aparcado a lanzamiento: SMTP de Supabase (vía Resend), revocar el token de GitHub expuesto.
Probar el funnel completo con datos reales: landing → registro → verificación email → onboarding → dashboard → generar primer presupuesto → briefing del agente. Arreglar lo que se rompa. Incluir recuperación de contraseña si falta.
- **Interno:** se cierran bugs de flujo, estados vacíos con 1 cliente/0 datos.
- **Visual:** cada pantalla se ve bien también "vacía", no solo llena.
- **Reparto:** Cowork hace el guion de QA → Code arregla lo que aparezca.

### Etapa D — Instrumentación para aprender  _(medir)_
Analytics (PostHog) + error tracking (Sentry). Hoy no tienes ninguno; solo un `lib/error-handler.ts` local. Sin esto, no verás qué hacen los primeros usuarios ni qué se rompe.
- **Interno:** eventos de producto + captura de errores en producción.
- **Visual:** nada para el usuario; es para ti.
- **Reparto:** Cowork elige herramientas y define eventos → Code integra.

### Etapa E — Go-live / Validación  _(infra, aparcada hasta aquí)_
El paquete de infraestructura que decidimos aparcar: deploy de Next.js a Vercel + hosting de n8n + estrategia única de clave de cifrado OAuth. Todo junto porque está acoplado. Luego, invitar a los primeros usuarios reales.
- **Interno:** la app y el agente dejan de depender de tu portátil.
- **Visual:** nada nuevo; el briefing empieza a aparecer solo cada día.
- **Reparto:** Cowork prepara el plan de despliegue → Code ejecuta → tú haces los clics en Vercel.

---

## 5. Resumen del orden

A (wizard retail) → B (pulido visual) → C (QA del primer usuario) → D (instrumentación) → E (go-live + validación).

Las etapas A-D son 100% locales (sin infra). La E es el "salir a producción" que solo tiene sentido cuando A-D estén sólidas y tengas a alguien real esperando para probar.
