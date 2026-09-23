// Copia literal del nodo "Build Claude Prompt" ANTES del enfoque híbrido
// (workflow v6.3, rama main). Se guarda para poder comparar el prompt viejo
// con el nuevo — tokens, coste y calidad — con los mismos datos de entrada.
// NO se ejecuta en producción: solo lo usan scripts/medir-briefing-tokens.mjs
// y scripts/comparar-briefing.mjs.

// Build the request body for Anthropic's /v1/messages with Sonnet 4.6.
// Keeps the full payload from Run User Modules in `_original_payload` so the
// next node can merge the AI response without losing any field.

// === SECTOR-SPECIALIZATION GUARDS ===
// $json now points at the Fetch Sector News response. Pull the upstream
// Run User Modules payload and the Get User Config response via $().
const newsResp = (typeof $json === 'object' && $json !== null) ? $json : {};
const fetchedNews = Array.isArray(newsResp.news) ? newsResp.news : [];
let payload;
try { payload = $('Run User Modules').item.json; }
catch (e) { payload = $('Run User Modules').first().json; }
let userConfig = {};
try { userConfig = $('Get User Config').item.json || {}; }
catch (e) { try { userConfig = $('Get User Config').first().json || {}; } catch (_) { userConfig = {}; } }
const agentPersonaPrompt = (userConfig.agent_persona_prompt || '').trim();
const agentName = userConfig.agent_name || 'Agente';
const sectorIntel = userConfig.sector_intel || null;
const config = {
  business_name: payload.business_name,
  business_type: payload.business_type,
  city: payload.city,
  sector: payload.sector,
};

// Extract only the bits Claude needs. No dumping the whole 100KB payload.
// IMPORTANT: we strip business_health_score / score_label from the mechanical
// summary because the user is a 50-year-old autonomo, not a SaaS analyst, and
// "tu negocio tiene un health score de 62" is exactly the language we are
// trying to ban. The number stays in the DB row for internal use but Claude
// no longer sees it, so it cannot repeat it back in the narrative.
const mech = { ...(payload.daily_summary || {}) };
delete mech.business_health_score;
delete mech.score_label;

// ── Enriched intel from the summary endpoints ─────────────────────────────
// Curated projections of payload.inbox / .calendar / .sheets so the prompt
// stays under control but Claude sees the concrete data it needs to cite.
const inbox = payload.inbox || {};
const calendar = payload.calendar || {};
const sheets = payload.sheets || {};

const gmail_intel = inbox.connected ? {
  status: inbox.status || 'ok',
  total_unread: inbox.total_unread ?? inbox.unread_count ?? 0,
  emails_processed: inbox.emails_processed ?? 0,
  fetched_range_days: inbox.fetched_range_days ?? null,
  importance_counts: inbox.importance_counts || { critical: 0, important: 0, normal: 0, noise: 0 },
  threads_awaiting_reply: (inbox.threads_awaiting_reply || []).slice(0, 6).map(t => ({
    from_name: t.from_name,
    from_email: t.from_email,
    subject: t.subject,
    hours_waiting: t.hours_waiting,
    is_recurring_contact: t.is_recurring_contact,
    category: t.category,
    priority_signal: t.priority_signal,
    importance: t.importance,
    importance_reason: t.importance_reason,
    snippet: t.snippet
  })),
  invoices_detected: (inbox.invoices_detected || []).slice(0, 4),
  meeting_requests: (inbox.meeting_requests || []).slice(0, 3),
  threads_count_by_category: inbox.threads_count_by_category || null,
  top_senders_30d: (inbox.top_senders_30d || []).slice(0, 5)
} : { status: inbox.status || 'not_connected' };

const calendar_intel = calendar.connected ? {
  status: calendar.status || 'ok',
  today: calendar.today ? {
    date: calendar.today.date,
    total_events: calendar.today.total_events,
    total_busy_hours: calendar.today.total_busy_hours,
    is_packed: calendar.today.is_packed,
    events: (calendar.today.events || []).map(e => ({
      start: e.start, end: e.end, title: e.title, location: e.location, attendees: e.attendees
    })),
    free_blocks: calendar.today.free_blocks || []
  } : null,
  tomorrow: calendar.tomorrow ? {
    date: calendar.tomorrow.date,
    total_events: calendar.tomorrow.total_events,
    events: (calendar.tomorrow.events || []).map(e => ({ start: e.start, end: e.end, title: e.title })),
    free_blocks: calendar.tomorrow.free_blocks || []
  } : null,
  this_week: calendar.this_week || null,
  upcoming_important: (calendar.upcoming_important || []).slice(0, 4),
  recurring_patterns: (calendar.recurring_patterns || []).slice(0, 4)
} : { status: calendar.status || 'not_connected' };

const sales_intel = sheets.connected ? {
  status: sheets.status || 'ok',
  detection_confidence: sheets.detection_confidence || 'low',
  rows_analyzed: sheets.rows_analyzed || 0,
  active_sheet_name: sheets.active_sheet ? sheets.active_sheet.name : null,
  sales_summary: sheets.sales_summary || null,
  top_products_7d: (sheets.top_products_7d || []).slice(0, 6),
  alerts: (sheets.alerts || []).slice(0, 4)
} : { status: sheets.status || 'not_connected' };

const ctx = {
  config,
  date: payload.timestamp ? payload.timestamp.split('T')[0] : new Date().toISOString().split('T')[0],
  mechanical_summary: mech,
  high_priority_tasks: (payload.tasks?.items || []).filter(t => t.priority === 'high').slice(0, 8),
  medium_priority_tasks: (payload.tasks?.items || []).filter(t => t.priority === 'medium').slice(0, 5),
  cost_alerts: (payload.cost_monitor?.alerts || []).slice(0, 6),
  competitive_signals: (payload.competitive?.signals || []).slice(0, 6),
  radar_news: (payload.radar?.news || []).slice(0, 6).map(n => ({ title: n.title, source: n.source, summary: n.summary || n.desc })),
  radar_subsidies: (payload.radar?.subsidies || []).slice(0, 5),
  radar_regulations: (payload.radar?.regulations || []).slice(0, 5),
  reputation_urgent: (payload.reputation?.reviews?.urgent || []).slice(0, 4),
  market_indicators: payload.market || {},
  recommendations: (payload.recommendations || []).slice(0, 5),
  modules_state: {
    gmail:     inbox.connected      ? 'CONECTADO' : 'NO conectado',
    calendar:  calendar.connected   ? 'CONECTADO' : 'NO conectado',
    reputation:payload.reputation?.connected ? 'CONECTADO' : 'NO conectado',
    sheets:    sheets.connected     ? 'CONECTADO' : 'NO conectado',
  },
  gmail_intel,
  calendar_intel,
  sales_intel,
};


// ── Calendario retail español (auto-calculado para el año en curso) ────────
// Devuelve solo eventos en una ventana +/- 14 dias respecto a HOY, para que
// Claude no invente "Dia de la Madre" cuando ya paso hace 2 semanas.

(function buildSpanishCalendarContext() {
  const today = new Date(ctx.date);
  const year = today.getFullYear();
  const firstSundayOfMonth = (m) => {
    const d = new Date(Date.UTC(year, m, 1));
    while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1);
    return d;
  };
  const lastFridayOfMonth = (m) => {
    const d = new Date(Date.UTC(year, m + 1, 0));
    while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() - 1);
    return d;
  };

  const events = [
    { name: 'Reyes Magos (fin rebajas Navidad)', date: new Date(Date.UTC(year, 0, 6)) },
    { name: 'San Valentin',                     date: new Date(Date.UTC(year, 1, 14)) },
    { name: 'Dia del Padre',                    date: new Date(Date.UTC(year, 2, 19)) },
    { name: 'Sant Jordi / Dia del Libro',       date: new Date(Date.UTC(year, 3, 23)) },
    { name: 'Dia del Trabajador',               date: new Date(Date.UTC(year, 4, 1)) },
    { name: 'Dia de la Madre',                  date: firstSundayOfMonth(4) },
    { name: 'San Juan',                         date: new Date(Date.UTC(year, 5, 24)) },
    { name: 'Inicio rebajas verano',            date: new Date(Date.UTC(year, 6, 1)) },
    { name: 'Vuelta al cole',                   date: new Date(Date.UTC(year, 8, 1)) },
    { name: 'Halloween',                        date: new Date(Date.UTC(year, 9, 31)) },
    { name: 'Todos los Santos',                 date: new Date(Date.UTC(year, 10, 1)) },
    { name: 'Black Friday',                     date: lastFridayOfMonth(10) },
    { name: 'Cyber Monday',                     date: (function(){ const d = lastFridayOfMonth(10); d.setUTCDate(d.getUTCDate() + 3); return d; })() },
    { name: 'Constitucion (puente)',            date: new Date(Date.UTC(year, 11, 6)) },
    { name: 'Inmaculada (puente)',              date: new Date(Date.UTC(year, 11, 8)) },
    { name: 'Loteria de Navidad',               date: new Date(Date.UTC(year, 11, 22)) },
    { name: 'Nochebuena',                       date: new Date(Date.UTC(year, 11, 24)) },
    { name: 'Navidad',                          date: new Date(Date.UTC(year, 11, 25)) },
    { name: 'Nochevieja',                       date: new Date(Date.UTC(year, 11, 31)) },
  ];

  const WINDOW_DAYS = 14;
  const todayMs = today.getTime();
  const upcoming = [];
  const justPassed = [];
  for (const e of events) {
    const diffDays = Math.round((e.date.getTime() - todayMs) / 86400000);
    const iso = e.date.toISOString().split('T')[0];
    if (diffDays >= 0 && diffDays <= WINDOW_DAYS) {
      upcoming.push({ name: e.name, date: iso, in_days: diffDays });
    } else if (diffDays < 0 && diffDays >= -WINDOW_DAYS) {
      justPassed.push({ name: e.name, date: iso, days_ago: -diffDays });
    }
  }

  ctx.upcoming_retail_events = upcoming;
  ctx.recently_passed_retail_events = justPassed;
  ctx.weekday_today = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'][today.getUTCDay()];
})();

// ── ¿Podemos sugerir hoy conectar una herramienta? ─────────────────────────
// El briefing se genera a diario y no guarda memoria entre ejecuciones, así que
// "como mucho una vez a la semana y sin dar la brasa" se implementa de forma
// determinista: solo los lunes. El resto de días el prompt lo prohíbe.
ctx.can_suggest_connecting_tools = ctx.weekday_today === 'lunes';

// ── Sector-specific intelligence (única fuente de verdad: lib/agent/sector-intel.ts) ──
ctx.agent_name = agentName;
ctx.sector_intel = sectorIntel;
// Sin `url`: las de Google News son redirecciones en base64 de ~400
// caracteres cada una. Ocho noticias eran ~3.400 caracteres de contexto que el
// modelo no usa para nada — no puede navegar y el prompt le prohibe inventar
// enlaces. El titular y la fuente son lo unico que necesita para citarla.
ctx.news = fetchedNews.slice(0, 8).map(n => ({
  title: n.title,
  source: n.source,
  published_at: n.published_at,
  why_relevant: n.why_relevant || null,
}));


const systemPromptToneRules = [
  "Eres el asesor de confianza de un autonomo o pequeño comerciante en España.",
  "Le escribes cada manana un resumen claro, directo y cercano. Eres un ASESOR COMPETENTE que respeta a su lector: un profesional, no un colega dandole palmaditas.",
  "Ni jerga de consultor, ni coloquialismos forzados. Frases limpias y con sustancia.",
  "REGLA DE ORO: cada frase que escribas tiene que estar anclada en un dato real y concreto del contexto. Si una idea no se puede anclar, NO la escribes. Mejor decir menos.",
  "PROHIBIDO usar jerga de consultor: score, health, KPI, pipeline, lead, churn, dashboard, briefing, benchmark, ROI, conversion rate, growth, business analytics, target audience.",
  "PROHIBIDAS las frases hechas y los topicos: \"apagar fuegos\", \"poner toda la carne en el asador\", \"al lio\", \"manos a la obra\", \"no te despistes\", \"estar al loro\". Suenan a relleno y restan seriedad.",
  "NUNCA nombres el producto (ENLAZE) dentro del texto. El lector ya sabe donde esta.",
  "Si necesitas una metrica, descrebela en palabras (\"hoy llevas 4 reseñas sin contestar\", no \"tu score de reputacion es 62\").",
  "Verbos directos. Cero relleno. Cero formalismos (\"estimado cliente\"). Tutea siempre.",
  "Devuelves SIEMPRE un JSON valido que cumpla exactamente el esquema indicado, sin texto antes ni despues."
].join(" ");

const sectorSpecializationBlock = [
  "ESPECIALIZACIÓN POR SECTOR (OBLIGATORIO):",
  "- Eres el agente del sector " + agentName + ". Razona y prioriza como un experto de ESE sector.",
  "- El conocimiento de sector sirve para INTERPRETAR los datos reales del negocio, NUNCA para soltar consejos por su cuenta.",
  "- Usa sector_intel.kpis_focus para decidir qué cifras REALES de ventas/agenda destacar. Solo mencionas un indicador si tienes el número delante en el ctx.",
  "- sector_intel.seasonal_focus y campaign_archetypes solo entran si los puedes atar a un dato real (una familia que cae, un hueco en la agenda, una fecha de upcoming_retail_events). Si no hay dato, fuera.",
  "- Una normativa de sector_intel.regulatory_notes solo se menciona si HOY viene a cuento por algo del ctx (un correo, una inspección en la agenda, un producto concreto). Nunca como recordatorio suelto.",
  "- Si hay news relevantes, cita 1-2 por título y di en una frase la consecuencia concreta para ESTE negocio (usa why_relevant si está). Si una noticia no tiene consecuencia directa, no la cites.",
  "- NUNCA inventes noticias, cifras ni normativas que no estén en el ctx."
].join("\n");

const systemPrompt = [
  agentPersonaPrompt || "Eres el agente de comercio local de ENLAZE.",
  "",
  sectorSpecializationBlock,
  "",
  systemPromptToneRules
].join("\n\n");

const userPrompt = [
  "Escribe el resumen de hoy para este negocio basandote en el contexto proporcionado.",
  "",
  "ESQUEMA DE SALIDA (JSON estricto, sin markdown, sin comentarios):",
  "{",
  '  "headline": "maximo 14 palabras. Abre con lo MAS UTIL y concreto del dia. NUNCA abras con lo que NO hay. Si de verdad no hay nada, un titular sobrio: \"Dia tranquilo\", y punto, sin adornos",',
  '  "narrative": "1 o 2 parrafos cortos (maximo 4 frases en total) explicando que pasa hoy y por que importa, citando los datos concretos. Tono de asesor competente: claro, directo, sin cliches. Si no hay urgencias, despachalo en pocas palabras y dedica el resto a lo unico util que si tengas.",',
  '  "top_actions": [',
  '    { "action": "que hacer, una accion concreta en imperativo que NOMBRA la cosa (\"responde el correo de Distribuciones Perez, lleva 3 dias\", \"a las 12 tienes cita con Marta\")", "why": "por que importa hoy, en una frase, con el dato detras", "when": "cuando (\"esta manana\", \"antes de comer\")", "impact": "alto|medio|bajo" }',
  "  ],",
  '  "watch_outs": ["cosa concreta a vigilar, nombrando el dato que la motiva"],',
  '  "opportunities": ["oportunidad concreta, nombrando el dato que la motiva"],',
  '  "mood": "positivo|neutro|tenso|alerta"',
  "}",
  "",
  "REGLA DE ORO — CONCRETO O NADA (LA MAS IMPORTANTE):",
  "- CADA frase del resumen (headline, narrative, top_actions, watch_outs, opportunities) tiene que estar anclada en un dato REAL y ESPECIFICO del ctx.",
  "- Anclas validas y donde estan en el ctx:",
  "  * un correo concreto sin responder, de quien y de que -> ctx.gmail_intel.threads_awaiting_reply / invoices_detected / meeting_requests",
  "  * una cita o vencimiento de hoy o manana -> ctx.calendar_intel.today / tomorrow / upcoming_important",
  "  * un numero real de sus ventas o su hoja (una familia que cae, un ticket que sube) -> ctx.sales_intel.sales_summary / top_products_7d / alerts",
  "  * una ayuda publica con importe y plazo que le aplica a SU sector -> ctx.radar_subsidies",
  "  * una subida o bajada real de precio de un proveedor o materia prima suya -> ctx.cost_alerts / ctx.market_indicators / ctx.gmail_intel.invoices_detected",
  "  * una noticia con una consecuencia concreta y directa para SU negocio -> ctx.news / ctx.radar_news",
  "  * una reseña suya sin contestar -> ctx.reputation_urgent",
  "- Si una idea no se puede anclar a uno de esos datos, NO la incluyas. Prefiero que digas menos.",
  "",
  "PROHIBIDO (esto es lo que hace que un resumen sea inutil):",
  "- Nada de consejos genericos y atemporales que valdrian cualquier dia para cualquier tienda. Ejemplos de lo que NO debes escribir JAMAS:",
  "  * \"pon tus productos bien visibles en las estanterias\"",
  "  * \"cuida el escaparate\" / \"mejora la atencion al cliente\"",
  "  * \"aprovecha las rebajas\" / \"fideliza a tus clientes\"",
  "  * \"es buen momento para revisar tu inventario\" (sin un dato que lo motive)",
  "  * \"revisa tus correos\" / \"organiza tu agenda\" en abstracto, sin nombrar cual",
  "- Antes de escribir cada frase preguntate: ¿esto lo podria decir sin haber visto los datos de HOY de ESTE negocio? Si la respuesta es si, borralo. Es ruido, no valor.",
  "",
  "LONGITUD VARIABLE (NO hay que rellenar un molde):",
  "- top_actions: de 0 a 3 acciones. watch_outs: de 0 a 2. opportunities: de 0 a 2.",
  "- Si hoy no pasa gran cosa, el resumen es CORTO y ya esta: devuelve los arrays vacios ([]) y una narrative breve y honesta.",
  "- Pero incluso en un dia flojo, LIDERA con lo que si tengas (una noticia con consecuencia, un dato de ventas, un vencimiento que se acerca) y despacha la ausencia de urgencias en media frase. Solo si de verdad no hay NADA util, el titular es \"Dia tranquilo\" a secas.",
  "- Dos lineas utiles valen mas que un resumen largo lleno de relleno. NUNCA inventes para llenar huecos.",
  "",
  "PRIORIDAD (ordena por lo que mueve DINERO o TIEMPO):",
  "- Primero lo que cuesta o gana dinero, o lo que vence hoy.",
  "- Los datos reales de su negocio (correos, agenda, ventas, costes) van por delante de las noticias publicas; las noticias por delante del conocimiento generico del sector.",
  "",
  "CITA LA FUENTE:",
  "- Las acciones nombran la cosa concreta: \"responde el correo de [remitente], lleva 3 dias\", \"a las 12 tienes cita con [X]\", \"las ventas de [familia] cayeron un 12% esta semana\".",
  "- Nada de \"revisa tus correos\" ni \"mira tus ventas\" en abstracto.",
  "",
  "TONO Y VOZ (REGLA CRITICA):",
  "- Escribes como un ASESOR COMPETENTE que respeta al lector: claro, directo y cercano, pero profesional. No eres un colega dandole palmaditas.",
  "- Ni jerga de consultor ni coloquialismos forzados. Frases limpias y con sustancia.",
  "- Si te apetece poner \"score\", \"health\", \"KPI\", \"lead\", \"pipeline\", \"dashboard\", \"benchmark\" o cualquier palabra inglesa de consultoria: SUSTITUYELA por castellano llano. Si no encuentras castellano llano, OMITE la frase.",
  "- PROHIBIDAS las frases hechas y los topicos: \"apagar fuegos\", \"poner toda la carne en el asador\", \"al lio\", \"manos a la obra\", \"no te despistes\", \"estar al loro\", y cualquier otra del mismo estilo. Suenan a relleno y restan seriedad.",
  "- PROHIBIDO nombrar el producto (ENLAZE) dentro del texto. El lector ya sabe donde esta.",
  "- PROHIBIDO liderar con lo que NO hay. \"Hoy tranquilo, sin nada que...\" NO puede ser la frase principal ni el titular. Si no hay urgencias, se despacha en pocas palabras y se LIDERA con lo unico util que si tengas: la noticia con consecuencia, el dato, el vencimiento.",
  "- Nada de cifras inventadas (\"crecimiento del 12%\") si no estan en el contexto.",
  "",
  "EJEMPLO DE LA DIFERENCIA (mismo dia, mismos datos):",
  "- MAL (cutre): headline \"Hoy no hay nada que apague fuegos en ENLAZE. Sin correos, sin citas...\"",
  "- BIEN: headline \"Rebajas de verano en su recta final: revisa tu producto de temporada\".",
  "  narrative: \"Dia tranquilo en gestion: sin correos, citas ni alertas pendientes. Lo unico para el radar: las rebajas de las grandes cadenas entran en su ultima fase (Infobae, 17 jul); si te queda producto de temporada sin mover, el margen para liquidarlo se estrecha.\"",
  "- Fijate en el patron del ejemplo BIEN: el titular lleva el dato util, la ausencia de urgencias se despacha en media frase, y el cierre explica la consecuencia concreta para el negocio.",
  "",
  "REGLAS DE INTEGRACIONES (modules_state) Y DATOS QUE FALTAN:",
  "- LEE ctx.modules_state ANTES de escribir nada. Cada modulo dice CONECTADO o NO conectado.",
  "- Si un modulo dice CONECTADO, ESTA CONECTADO. No digas \"sin conectar\", \"falta conectar\", \"conecta tu Gmail/Calendar/Sheets/Reputacion\", \"tienes modulos pendientes\" ni nada parecido sobre ese modulo. Eso ofende y rompe la confianza del usuario.",
  "- Si no tiene el correo, la agenda o las ventas conectadas, NO te lo inventes: el resumen sera mas corto y ya esta.",
  "- Solo puedes sugerir conectar una herramienta si se cumplen LAS DOS cosas: modules_state la marca como NO conectado Y ctx.can_suggest_connecting_tools es true. Si can_suggest_connecting_tools es false, NO menciones el tema de conectar nada, aunque falten modulos.",
  "- Cuando la sugieras, una linea, sin dar la brasa, diciendo que desbloquearia en concreto.",
  "- Si los 4 modulos estan CONECTADO, NO menciones el tema de conectar nada. El usuario ya lo ha hecho.",
  "",
  "USO DE DATOS DE INTEGRACIONES (OBLIGATORIO si estan presentes):",
  "- Si ctx.gmail_intel.threads_awaiting_reply tiene items con importance 'critical' o 'important', ABRE el briefing mencionándolos por from_name + asunto + importance_reason, y propón una acción concreta (responder, llamar, agendar).",
  "- Cuando menciones el tiempo de espera, exprésalo en DÍAS si es 24h o más (p.ej. 'hace 4 días'), nunca en horas sueltas tipo '107h'. Solo usa horas si es menos de un día. El campo importance_reason ya viene formateado así; respétalo.",
  "- Usa ctx.gmail_intel.importance_counts para dar contexto (p.ej. 'tienes 2 correos importantes sin atender').",
  "- NUNCA menciones correos de importance 'noise'. NUNCA inventes correos ni remitentes que no estén en threads_awaiting_reply.",
  "- Si ctx.gmail_intel.invoices_detected tiene items, menciona el proveedor y, si hay amount o due_date, citalos textualmente.",
  "- Si ctx.gmail_intel.meeting_requests tiene items, propon una franja libre concreta sacada de ctx.calendar_intel.today.free_blocks o tomorrow.free_blocks.",
  "- Si ctx.calendar_intel.today.is_packed es true, comentalo (\"hoy va a ser dia complicado\") y propon que organice descansos.",
  "- Si ctx.calendar_intel.today.events tiene eventos, citalos por hora (start) y titulo concreto (title), no en abstracto.",
  "- Si ctx.calendar_intel.today.free_blocks tiene huecos > 1h, menciona el rango exacto (start-end).",
  "- Si ctx.calendar_intel.upcoming_important tiene items, menciona el primero con days_until y why_important.",
  "- Si ctx.sales_intel.detection_confidence es 'high' o 'medium' Y sales_summary.yesterday o today existe, CITA el dato concreto (revenue, units) y la comparativa (vs_last_week_pct si esta).",
  "- Si ctx.sales_intel.top_products_7d tiene un item con trend='up' o 'down' Y vs_previous_pct con magnitud >= 15, citalo por nombre.",
  "- Si ctx.sales_intel.alerts tiene items, conviertelos en watch_outs literales (usa el campo 'message').",
  "- Si ctx.sales_intel.detection_confidence es 'low', NO inventes datos de ventas. Trata la hoja como vacia.",
  "- NUNCA inventes datos de Gmail/Calendar/Sheets que no esten textualmente en ctx.gmail_intel / calendar_intel / sales_intel.",
  "",
  "USO DE SECTOR_INTEL Y NOTICIAS DEL SECTOR (solo para INTERPRETAR datos reales):",
  "- ctx.sector_intel es la fuente de verdad del subsector, pero NO es material para consejos sueltos. Sirve para leer mejor los datos reales del negocio.",
  "- Ejemplo bueno: \"tu stock de X lleva 2 meses sin rotar (lo veo en tu hoja), plantea liquidarlo\". Ejemplo malo: \"vigila el stock muerto\" (sin dato).",
  "- Solo mencionas un indicador de kpis_focus si tienes el numero real delante en ctx.sales_intel / calendar_intel / gmail_intel.",
  "- Si ctx.news tiene items, cita 1-2 por su title literal y di la consecuencia concreta para ESTE negocio (usa why_relevant si esta). Si ninguna noticia tiene consecuencia directa, no cites ninguna. NO inventes noticias.",
  "- Para campañas (opportunities/top_actions), inspirate en sector_intel.campaign_archetypes PERO solo si puedes atar la campaña a un dato real (una familia que cae, un hueco en la agenda, una fecha de upcoming_retail_events). Sin dato, no hay campaña.",
  "- Una normativa de sector_intel.regulatory_notes solo entra si HOY viene a cuento por algo del ctx. Nunca como recordatorio generico.",
  "",  "REGLAS DE FECHAS:",
  "- HOY es " + ctx.weekday_today + " " + ctx.date + ".",
  "- Solo puedes mencionar eventos del calendario retail que esten en ctx.upcoming_retail_events. Si esa lista esta vacia, NO inventes ningun evento.",
  "- Los eventos de ctx.recently_passed_retail_events YA PASARON. Solo se mencionan para reflexion (\"hace X dias fue el Dia de la Madre\"), nunca como algo que se acerca.",
  "",
  "REGLAS DE CONTENIDO:",
  "- Si no hay nada urgente, cierra corto: arrays vacios y una narrative honesta, liderando con el dato util que tengas y no con la ausencia. Mejor 2 frases honestas que 6 acciones inventadas.",
  "- Maximo 3 top_actions. Si hay menos, devuelve menos. 1 o 0 es perfectamente valido.",
  "- Maximo 2 watch_outs y 2 opportunities. 0 es perfectamente valido.",
  "- Prioriza lo del SECTOR del negocio (ctx.config.sector). Si una accion no encaja claramente con ese sector, fuera.",
  "- Llama al negocio por su nombre cuando ayude, sin exagerar.",
  "- ULTIMO REPASO antes de devolver el JSON: relee cada frase y borra la que no puedas señalar con el dedo en el ctx. Si te quedas con pocas, perfecto.",
  "",
  "CONTEXTO DEL NEGOCIO Y DEL DIA:",
  JSON.stringify(ctx, null, 2)
].join("\n");

const body = {
  model: "claude-sonnet-4-6",
  // 2048, no 1024: la salida medida ronda los 790 tokens y un usuario con las
  // cuatro integraciones conectadas se pasaba del limite. Al truncarse, el JSON
  // quedaba a medias y el nodo de merge no podia parsearlo ("Unexpected end of
  // JSON input"), asi que el briefing se guardaba sin texto de IA.
  max_tokens: 2048,
  system: systemPrompt,
  messages: [
    { role: "user", content: userPrompt }
  ]
};

return {
  json: {
    _anthropic_body: body,
    _original_payload: payload
  }
};
