# ENLAZE — Roadmap de Polish Premium

_Fecha: 2026-04-16_

Estado actual: **producto sólido y feature-complete**. Dark mode recién arreglado, 20+ secciones del dashboard funcionando, auth + Supabase estable, error boundaries en su sitio. Lo que falta es la capa de pulido que diferencia un SaaS "funcional" de un SaaS "premium" tipo Notion/Linear/Stripe.

Los ítems están ordenados por impacto/esfuerzo. Empieza por P0 — son quick wins que cambian la percepción del producto de forma desproporcionada.

---

## P0 — Quick wins (1–3 días cada uno, impacto enorme)

### 1. Reemplazar `confirm()` del navegador por modal custom
Ahora mismo, borrar un cliente/proyecto/factura muestra el pop-up gris feo del navegador. Esto grita "producto casero". Necesitas un componente `<ConfirmDialog>` y sustituirlo en todas las páginas de listado.

Archivos afectados (al menos): `dashboard/prices/page.tsx`, `dashboard/calendar/page.tsx`, `dashboard/suppliers/page.tsx`, `dashboard/clientes/page.tsx`, y varios más.

### 2. Sistema de toasts (Sonner o propio)
No hay feedback visual tras crear/editar/borrar. El usuario hace click en "Guardar" y no pasa nada perceptible. Añadir toast de éxito/error + botón "Deshacer" en acciones destructivas.

### 3. Skeleton loaders en lugar de spinners
Los `animate-spin` hacen que la app parezca lenta. Los skeletons (bloques grises con shimmer que imitan el layout final) dan sensación de velocidad incluso con la misma latencia real.

### 4. Fuente Inter via `next/font`
Estás usando `system-ui`. Carga Inter (o Geist) con `next/font/google` → se nota muchísimo el "feel" premium. Es una línea de código.

### 5. Overlay de atajos de teclado (`?`)
El `Cmd+K` ya funciona pero nadie lo sabe. Añade un modal que se abra con `?` mostrando todos los shortcuts (`Cmd+K`, `N P` nueva propuesta, `G C` ir a clientes, etc.).

### 6. Medidor de fuerza de contraseña en /register
Ahora solo validas `minLength=6`. Añade indicador visual (débil/media/fuerte) basado en longitud + mayúsculas + números + símbolos.

### 7. Toggle anual/mensual en /pricing con descuento visible
En el FAQ mencionas 20% de descuento anual pero no hay toggle. Los visitantes no lo ven. Cambia el pricing a `monthly|yearly` con el ahorro destacado.

### 8. JSON-LD (schema.org) en páginas clave
Añade `<script type="application/ld+json">` con `Organization`, `Product`, `FAQPage`. Gratis en SEO, mejor CTR en Google.

---

## P1 — Mejoras de producto (1–2 semanas cada una)

### 9. Tablas con sorting + filtros + paginación
`DataTable` actual no permite ordenar por columna, filtrar por estado/fecha, ni pagina. Si un usuario tiene 500 clientes, la página peta. Necesitas:
- Click en cabecera → sort asc/desc
- Dropdown de filtros arriba de cada tabla (Estado, rango fechas)
- Paginación server-side (25/50/100 por página)

### 10. Export a CSV/PDF en cada tabla
Botón "Exportar" arriba a la derecha. Para pymes españolas esto es **crítico** — piden datos para su gestor constantemente.

### 11. Checkboxes + acciones bulk
Seleccionar varias filas → "Borrar", "Cambiar estado", "Enviar email masivo". Aumenta el throughput de los usuarios en 5–10×.

### 12. Selección y combobox buscable
Los `<select>` nativos se ven mal y no escalan. Usa un Combobox (Radix o custom) con búsqueda interna para seleccionar cliente/proyecto/proveedor. Cuando el usuario tenga 200 clientes, va a agradecerlo.

### 13. Breadcrumbs en páginas de detalle
`/dashboard/suppliers/[id]` no indica dónde está. Añade `Dashboard › Proveedores › Nombre Proveedor` en la cabecera.

### 14. Social proof en landing
- Fila de logos de clientes ("Confían en nosotros: X, Y, Z")
- 3 métricas grandes ("1.200 empresas · 85.000 facturas emitidas · 4.9★")
- Al menos 1 case study en detalle (no solo el testimonio de 2 líneas)

### 15. Empty states con ilustraciones
Ahora los empty states son un icono genérico + texto. Crea 5–6 ilustraciones SVG propias (consistentes con el brand) para cada sección: Sin clientes, Sin facturas, Sin proyectos, etc.

### 16. Componentes UI que faltan
Crea (o instala Radix UI / shadcn) los siguientes, todos se van a usar muchísimo:
- `Dialog` / `Modal`
- `Tooltip`
- `Toast`
- `Tabs`
- `DatePicker`
- `Combobox`
- `Drawer` (panel lateral para filtros)
- `Progress`
- `Switch`

### 17. OAuth en /login
Botones "Continuar con Google" y "Continuar con Microsoft". Supabase lo soporta con 3 líneas de configuración. Reduce la fricción de registro ~40% según benchmarks.

### 18. Recuperación de contraseña
Link "¿Olvidaste tu contraseña?" en /login → flujo completo de reset por email. Ahora si un usuario se olvida, está bloqueado.

### 19. Analytics (PostHog)
Sin datos reales no sabes dónde caen los usuarios. PostHog tiene free tier generoso + session replay + funnels. Instalación: 5 minutos.

### 20. Error tracking (Sentry)
Los `console.error` se pierden. Con Sentry ves errores en producción con stack trace, breadcrumbs y contexto de usuario. Gratis hasta 5k errores/mes.

---

## P2 — Polish a nivel de marca y confianza (2–4 semanas)

### 21. Página de status (status.enlaze.com)
BetterStack o Statuspage. Muestra uptime real → señal de madurez para cerrar contratos enterprise.

### 22. Changelog público / release notes
Página `/changelog` con las novedades versionadas. Los usuarios existentes ven que el producto avanza; los prospectos ven que hay tracción.

### 23. Roadmap público votable (Canny o propio)
Los usuarios votan features. Genera engagement y priorización gratis.

### 24. Página /security detallada
La tienes pero seguramente vacía. Documenta: cifrado en reposo, TLS 1.3, backups, certificaciones, gestión de accesos, proveedores (sub-processors list).

### 25. Banner de consentimiento de cookies
Obligatorio en UE. No detecté ninguno. Usar Cookiebot, Osano, o implementación propia con toggles (Estadísticas / Marketing).

### 26. Página DPA (Data Processing Agreement)
Existe el archivo pero seguramente está vacío. Si quieres B2B, es obligatorio poder firmar un DPA.

### 27. Preparación i18n (next-intl)
Todo el copy está hardcodeado en español. Si algún día quieres vender fuera de ES, vas a refactorizar cientos de strings. Extraer a `/messages/es.json` ahora cuesta mucho menos que más tarde.

### 28. Vídeos en testimonios + más casos reales
Los 3 testimonios actuales son texto. Un video de 30s con cliente real triplica la conversión.

---

## P3 — Estratégico (1+ meses)

### 29. Documentación API (OpenAPI/Swagger)
Si algún día quieres integraciones de terceros o vender un plan "Developer".

### 30. Integración con Zapier/Make
Amplía el alcance del producto sin escribir código extra tú. Webhooks salientes + algunas acciones entrantes = 5000+ apps conectables.

### 31. App móvil (React Native o PWA)
La web es responsive pero una app nativa es otro nivel de retención. Como mínimo, convertir a PWA con manifest + service worker (1 día) para que se pueda instalar.

### 32. IA integrada más visible
Tienes `/dashboard/agent` pero no está muy expuesto. Notion/Linear hacen de la IA su elemento premium más visible. Considera un "Ask AI" global accesible con `Cmd+J` en todo el dashboard.

---

## Detalles técnicos sueltos (arreglos pequeños)

- **Sin `next/font`** — resultado: FOUT y font-rendering inconsistente.
- **apple-icon.png y icon.png pesan 111 KB cada uno** — genera versiones en 32/192/512 con `sharp` o el favicon generator. Ahora sirves el mismo bloque pesado a todo.
- **No hay `manifest.json`** — imposible instalar como PWA.
- **Sin Suspense boundaries ni `loading.tsx`** en rutas del dashboard — pérdida de oportunidad para streaming UI de Next.js 16.
- **No hay `error.tsx` granulares** por ruta, solo el global — dificulta debug.
- **Los archivos `.bak`, `.bak2`, `.bak3` en `app/dashboard/facturas/` y `app/dashboard/budgets/generate/`** — límpialos del repo.
- **7 MDs de documentación en la raíz** (COMPLIANCE_CORE_PLAN, IMPLEMENTATION_CHECKLIST, ERROR_HANDLING, etc.) — muévelos a `/docs/` para no ensuciar el root.

---

## Orden recomendado de ataque

Si tuviera que priorizar, atacaría así:

**Semana 1** → P0 completo (8 ítems). Cambio de percepción brutal.

**Semana 2–3** → P1 #9 (tablas), #10 (export), #16 (modal + toast + tooltip + tabs), #17 (OAuth), #18 (reset password), #19 (PostHog), #20 (Sentry).

**Semana 4+** → P1 restantes + P2. Aquí ya entras en "producto vendible a enterprise".

**Más adelante** → P3 cuando tengas más clientes y feedback real.

La clave: **P0 + #16 + #19** te dan el 80% del "feel premium" con 20% del esfuerzo total.
