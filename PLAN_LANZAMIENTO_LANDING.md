# Plan de lanzamiento — Landing de Enlaze

_Objetivo del mes: tener la **landing pública en vivo** para captar lista de espera (waitlist) de autónomos/pymes, y empezar a construir demanda y lista de correos **antes** de abrir el producto._

Fecha de arranque: 14 agosto 2026 · Ventana: ~4 semanas

---

## Por qué una landing primero

- **Valida el mensaje** con gente real antes de invertir en abrir el producto.
- **Capta correos** de interesados → lista para el día que se lance el producto.
- **No depende de lo que está bloqueado.** La landing NO usa el agente ni n8n, así que los créditos de la API de Anthropic y el hosting de n8n **no bloquean** este lanzamiento.
- Da presencia y credibilidad para enseñar a los primeros clientes (el padre de tu socio, contactos del sector construcción).

---

## Alcance: qué SÍ y qué NO

**SÍ entra:**
- Página pública con la propuesta de valor, para quién es y qué resuelve.
- Formulario de waitlist (captación de correos + sector).
- Confirmación por email al registrarse.
- Páginas legales (aviso legal, privacidad, cookies) — obligatorio en España.
- Dominio propio + analítica básica.

**NO entra (todavía):**
- Registro/login al producto real.
- Pagos.
- El agente / briefing IA en vivo.

---

## Fases (semana a semana)

### Semana 1 — Decisiones y fundamentos
- [ ] **Dominio:** verificar disponibilidad de `enlaze.es` y comprarlo (o alternativa). _(A confirmar disponibilidad y precio en un registrador; no lo doy por hecho.)_
- [ ] **Dónde van los registros:** tabla `waitlist` en Supabase (lo más simple, ya lo tenéis).
- [ ] **Mensaje/propuesta de valor:** cerrar el titular y el "para quién". Idea base: Enlaze = **el respaldo** del autónomo/pyme (mensajería, facturas, presupuestos y un briefing diario, en un solo sitio).
- [ ] **Estructura:** landing dentro de la misma app Next.js (ruta pública `/`) — más simple que una web aparte.

### Semana 2 — Construcción
- [ ] Diseño + copy de la landing (hero, propuesta de valor, features, para quién, CTA).
- [ ] Formulario de waitlist → Supabase + email de confirmación (Resend, que ya está montado).
- [ ] Páginas legales: aviso legal, política de privacidad, política de cookies + banner de consentimiento (RGPD).
- [ ] Versión móvil (la mayoría entrará desde el móvil).

### Semana 3 — Deploy, analítica y QA
- [ ] Deploy en Vercel con el dominio `enlaze.es` (DNS + SSL).
- [ ] Analítica (Vercel Analytics o Plausible) para medir visitas y conversión.
- [ ] SEO básico: título, descripción, imagen para compartir (Open Graph).
- [ ] QA: el formulario guarda bien, el email llega, lo legal está enlazado, móvil OK, carga rápida.

### Semana 4 — Pulido y salida
- [ ] Revisión final de copy (sin faltas, mensaje claro).
- [ ] Prueba con gente real (tu socio, el padre, algún conocido del sector).
- [ ] Publicar y empezar a difundir (contactos, redes, sector construcción).

---

## Decisiones abiertas (para hablar contigo y tu socio)

1. **¿Landing dentro de la misma app o web aparte?** → Recomiendo dentro de la misma app (`/` pública). Menos mantenimiento.
2. **¿Qué pedimos en el formulario?** → Recomiendo email + sector (para segmentar). Cuanto menos se pida, más gente se registra.
3. **¿Dominio `.es` o `.com`?** → `.es` encaja por ser mercado español; confirmar disponibilidad de ambos.
4. **¿Idioma?** → Español (mercado objetivo). Inglés más adelante si hace falta.

---

## Lo que NO bloquea la landing (tranquilidad)

- Créditos de la API de Anthropic → solo afectan al agente, no a la landing.
- Hosting de n8n → igual, no afecta.
- El merge de las ramas de tu socio (papelera, presupuestos) → independiente; la landing se puede construir en paralelo.

---

## Cómo trabajamos

Patrón de siempre: **yo defino, Claude Code/Design ejecuta, tú validas.** Para cada bloque de construcción te paso un prompt listo para copiar-pegar en Code/Design, revisas su resultado, y ajustamos.

---

_Documento vivo. Se actualiza según avancemos._
