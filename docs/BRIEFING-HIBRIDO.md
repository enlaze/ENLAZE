# Briefing diario: enfoque híbrido

Los hechos del día se calculan en código y el modelo solo redacta.

Antes, el nodo `Build Claude Prompt` serializaba el `ctx` entero en JSON y
acompañaba el volcado con unas cien líneas de prohibiciones para que el modelo
no inventara cifras ni se saliera del contexto. Ahora el `ctx` sigue
construyéndose igual —es la entrada tipada del motor— pero al prompt va un
bloque de texto plano en castellano con los importes, los porcentajes, las
esperas y las fechas ya resueltos.

- Motor de hechos: `lib/agent/briefing-facts.ts` (única fuente de verdad).
- Inyección en el nodo de n8n: `npm run sync:briefing-facts`.
- El respaldo mecánico (`Merge AI Briefing`) **no se ha tocado**: sigue leyendo
  `payload.daily_summary`, que se sigue calculando entero.

## Qué decide el modelo y qué no

| Del modelo | Del código |
|---|---|
| El titular | Calcular e interpretar cifras |
| La narrativa | Formatear importes, fechas, horas y porcentajes |
| Qué acciones entran y en qué orden | Convertir las esperas a días |
| El tono | Aplicar umbrales (ruido, fiabilidad de la hoja, movimientos notables) |
| | Resolver la estacionalidad al mes en curso |

## Medida (con `__tests__/fixtures/briefing-dia-completo.json`, 4 integraciones)

| | antes | después |
|---|---|---|
| Prompt de sistema | 2.435 car. | 1.578 car. |
| Instrucciones | 11.327 car. | 2.349 car. |
| Datos | 28.015 car. | 6.288 car. |
| **Total** | **41.777 car.** | **10.215 car.** (−75,6 %) |

`npm run medir:briefing` recalcula esto y añade tokens y coste.
`npm run comparar:briefing` genera el briefing viejo y el nuevo lado a lado.

## Qué se ha quedado fuera del contexto, y por qué

Lo importante: nada de esto desaparece del payload ni de la base de datos. Solo
deja de viajar al modelo.

### Fuera del todo

- **`recommendations`** (2.040 car.). Recomendaciones de plantilla con sus
  `steps` ("1. Abre WhatsApp Business", "2. Envía mensaje a la lista de
  clientes frecuentes"). Son exactamente el consejo genérico y atemporal que el
  prompt viejo dedicaba veinte líneas a prohibir. Quitarlas elimina el gasto y
  la tentación a la vez.
- **`mechanical_summary`**, salvo `margin_pressure` (1.138 car.). Titular
  mecánico, `priority_actions` con emojis ("🔴 3 urgente(s)"), contadores
  (`tasks_high`, `risks_count`, `opportunities_count`), `time_to_complete`,
  `tip`, `modules_connected/pending`. Todo ello es un recuento de los mismos
  hechos que ahora se enuncian directamente: tener las dos versiones invitaba a
  citar el agregado ("2 alertas de costes") en vez del hecho ("la electricidad
  está a 112 EUR/MWh"). **Sigue intacto en el payload**, que es de donde lo lee
  el respaldo mecánico.
- **`market_indicators.price_analysis`** y **`.action_items`** (parte de los
  3.327 car. del bloque). `trending_up`/`trending_down` son copias literales de
  `price_signals` filtradas por palabra en el título; `recommendations` y
  `action_items` son frases enlatadas que duplican las tareas.
- **`market_indicators.competitor_signals`**: duplica `competitive_signals`.
- **`sector_intel.news_queries`** y **`.news_max_items`**: son las cadenas de
  búsqueda del RSS. No le dicen nada al modelo.
- **`gmail_intel.top_senders_30d`** y **`.threads_count_by_category`**: ninguna
  regla del prompt los usaba nunca. Es la pérdida más discutible de la lista;
  si alguna vez quieres "este mes te escribe mucho X", se reponen en una línea.

### Recortado (se queda el hecho, se va el relleno)

- **Resúmenes largos**: `summary` de `radar_news` (320 car. cada una),
  `competitive_signals` (300), `radar_regulations`, `market_indicators.*`. Se
  queda el titular, que es lo que se cita.
- **Identificadores y fechas técnicas**: `id`, `url`, `thread_id`,
  `detected_at`, `date` en ISO. El prompt ya prohibía inventar enlaces y el
  modelo no puede navegar.
- **`snippet`** de correos, facturas y peticiones de cita: el
  `importance_reason` dice lo mismo mejor y más corto.
- **Tareas ya contadas en otra sección** (`email_reply`, `review_reply`,
  `cost_review`, `price_review`, `subsidy_check`, `regulation_review`,
  `competitive_action`): el hecho ya está, con más detalle, en CORREO, COSTES,
  RESEÑAS o ENTORNO. La sección de pendientes solo enseña lo que no sale en
  ningún otro sitio (campañas, acciones de margen, recordatorios de agenda).
- **Titulares repetidos** entre el feed de sector (`news`) y el radar genérico
  (`radar_news`): se deduplican y gana la versión que trae `why_relevant`.
- **Correos de `importance: 'noise'`**: se filtran en código. El prompt viejo
  tenía que pedirlo por favor.

### Lo que NO se ha perdido, aunque lo parezca

- **Perfil de sector**: `kpis_focus`, `campaign_archetypes`,
  `regulatory_notes` y `supplier_types` siguen enteros.
- **Estacionalidad**: `seasonal_focus` ya no se vuelca entero. Se filtra al mes
  en curso, así que el modelo recibe la ventana que toca en lugar de las cuatro
  del año. Es señal ganada, no perdida.
- **Calendario comercial**: igual que antes, con la ventana de ±14 días, pero
  dicho en palabras ("dentro de 8 días", "ya pasó").
- **Huecos libres de mañana**: se mantienen, porque hacen falta para proponer
  una franja a quien pide cita.

### Señal añadida

- **`reputation_stats`**: nota media, total de reseñas, reseñas nuevas y
  tendencia. Cuatro números que ya se calculaban y que el `ctx` viejo tiraba.

## Si tocas algo

1. El motor se edita en `lib/agent/briefing-facts.ts`, nunca en el JSON.
2. `npm run sync:briefing-facts` vuelve a pegarlo en el nodo.
3. `npm run test:briefing-facts` falla si los dos se han separado.
