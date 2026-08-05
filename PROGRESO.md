# Enlaze — Bitácora de progreso

_Última actualización: 2026-08-05_

Registro de todo lo construido desde que se retomó el proyecto. Sirve para no perder
perspectiva de cuánto se ha avanzado y para que cualquiera (socio incluido) entienda el
estado real de un vistazo.

---

## Punto de partida

El proyecto estaba parado tras una temporada intensa. Al retomarlo y auditarlo, la
conclusión fue clara: **Enlaze estaba mucho más avanzado de lo que parecía** (~80-85%,
prácticamente feature-complete). El trabajo no era construir de cero, sino **terminar,
pulir y validar**. Se montó un roadmap por etapas (A-E) hacia la validación con usuarios
reales.

---

## 1. El agente diario (n8n) — el corazón del producto

El briefing diario que genera el agente es el diferencial de Enlaze. Trabajo hecho:

- **Bug de fan-out arreglado:** el briefing con IA solo se generaba para el primer
  usuario; el resto se quedaba sin nada. Ahora se genera **para todos**.
- Corregida la etiqueta de modelo (haiku → sonnet) y sincronizado el workflow con el repo.
- **Prompt del briefing reescrito de arriba abajo:** de relleno genérico e inútil
  ("pon tus productos en las estanterías") a filosofía **"concreto o nada"**:
  - Cada frase debe anclarse en un dato real y específico del día (correo sin responder,
    cita, número de ventas, ayuda del BOE con plazo, subida de precio de un proveedor…).
  - Prohibido el relleno genérico y los clichés ("apagar fuegos"…).
  - **Longitud variable:** si no hay nada, el briefing es corto y honesto, no relleno.
  - Prioriza lo que mueve **dinero o tiempo**; cita la fuente.
  - Tono de **asesor profesional**, no "lenguaje de bar" (que chocaba con las propias
    personas de sector, que ya son profesionales).
  - Validado con un ejemplo real (panadería) → salto de calidad enorme.

**Pendiente:** saldo en la API de Anthropic para verlo en vivo. Y la "pieza 2":
rellenar los subsectores sin perfil propio (legal, educación, tecnología, eventos),
surtir mejor los datos accionables (ayudas del BOE filtradas, precios de proveedores) y
que el usuario conecte sus herramientas (correo, agenda, ventas).

---

## 2. Decisiones de producto

- **Comercio local NO lleva presupuestos** (es un concepto nativo de construcción). Se
  ocultó/gateó limpiamente para ese sector; construcción intacto.
- **Infraestructura aparcada** (Vercel + hosting de n8n + OAuth) hasta la fase de
  validación — no montar servidores para cero clientes.
- **Briefing diario automático** programado como tarea recurrente.

---

## 3. Pulido visual (Etapa B)

- Rediseño de la **tarjeta de briefing** diario con casillas clicables.
- **Breadcrumbs** en las páginas de detalle + barrido de consistencia (modo claro/oscuro).
- Logo con la "z" verde, **tildes** corregidas en toda la UI, campo "empresa" opcional.
- **Todos los emojis de iPhone** sustituidos por iconos lucide (onboarding, primeros
  pasos, ajustes, registro de actividad y barrido general de ~18 archivos).
- Rediseño de las **4 pantallas de acceso** (registro, login, olvidé/nueva contraseña)
  con el componente AuthShell (fondo aurora + tarjeta partida con marca).

---

## 4. QA del primer usuario (Etapa C) — bugs reales cazados y arreglados

Recorrimos todo el producto como un usuario nuevo de construcción. Encontrado y arreglado:

- Email de verificación no se enviaba → **dominio enlaze.es verificado en Resend**.
- El enlace de verificación apuntaba a producción → `NEXT_PUBLIC_SITE_URL` a localhost.
- Guardar el perfil fallaba (RLS 42501) → política de INSERT + trigger que crea el perfil
  al registrarse.
- El botón "crear obra" no hacía nada → **RLS sistémico** en todas las tablas de usuario
  + columna que faltaba en `projects` + mostrar el error en vez de fallar en silencio.
- El onboarding se reiniciaba al abrir la política de privacidad → **persistir el
  progreso** en sessionStorage.
- Recuperación de contraseña existía pero medio rota (spinner infinito con enlace
  caducado, fuga de qué emails existen) → **endurecida**.

---

## 5. Emails

- **Resend como SMTP de Supabase**: los emails salen de `noreply@enlaze.es`, sin el tope
  de ~2/hora del correo interno.
- **Plantillas con marca** (reseteo de contraseña y confirmar email) en español, limpias,
  que llegan a bandeja de entrada.
- Eliminada la **verificación de email redundante** (había dos sistemas mandando dos
  correos) → solo la nativa de Supabase.

---

## 6. Borrado de cuenta (RGPD + obligación fiscal)

Un botón que estaba muerto convertido en un borrado de cuenta **legalmente correcto**:

- Confirmación escribiendo "ELIMINAR"; endpoint en servidor con service-role; aborta
  antes de tocar el usuario de auth si falla el borrado de datos.
- **Retención legal:** las facturas emitidas y recibidas y los consentimientos NO se
  borran, se **anonimizan** (Hacienda obliga a conservar facturas ~4 años; el RGPD permite
  conservar la prueba de consentimiento).
- Migración de esquema (`user_id` nullable + `ON DELETE SET NULL`) que hace posible el
  borrado conservando lo que la ley exige.
- **Probado end-to-end** con una cuenta desechable: se borra lo personal, sobrevive lo
  legal anonimizado, cero filas huérfanas.

---

## 7. Higiene y organización

- "Registro de actividad" movido fuera del menú principal (accesible desde Cumplimiento).
- Limpieza del repo: fuera versiones viejas del workflow, backups y docs de tareas hechas.
- **Pendientes menores:** revocar el token de GitHub expuesto, verificar que producción
  (Vercel) funciona (bloqueado por el 2FA), limpiar workflows duplicados de n8n.

---

## Estado actual

Producto **sólido y feature-complete**, con la entrada a la app (auth + emails) rediseñada
y con marca, un borrado de cuenta legalmente correcto, la QA del primer usuario hecha, y
el agente con un prompt **mucho** mejor. La base está lista.

**Bloqueadores hoy:**
- Saldo en la API de Anthropic para ejecutar el agente en vivo (no urgente).
- La validación con un constructor real (padre del socio) — depende del socio.

## Próximos pasos

1. **Pieza 2 del agente:** subsectores que faltan, datos accionables (ayudas/precios),
   conectar herramientas. Gran parte se puede hacer sin gastar en API.
2. **Validar** el producto con un usuario real.
3. **Go-live** (Vercel + hosting n8n + OAuth) cuando haya un usuario esperando.
4. Backlog: ocultar secciones del dashboard, bocadillos "TIP", papelera de recuperación.
