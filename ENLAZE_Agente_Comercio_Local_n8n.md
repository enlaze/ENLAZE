# ENLAZE — Agente de Comercio Local (n8n)

## Diseño técnico completo · v1.0 · Abril 2026

---

## 1. Resumen ejecutivo

Este agente automatiza la inteligencia de negocio para pequeños comercios locales (bares, restaurantes, peluquerías, tiendas, centros de estética, despachos). Se ejecuta cada 24 horas en n8n, recopila datos de fuentes públicas, los normaliza y envía a ENLAZE vía webhook.

El resultado: cada mañana el comerciante abre ENLAZE y encuentra qué pasa en su entorno, qué oportunidades tiene, qué debería corregir, qué acción comercial le conviene y qué riesgo debe mirar.

**Nombre comercial:** "Asistente automático para comercio local"

**Workflows n8n propuestos:**

- `Comercio local — Radar local`
- `Comercio local — Reputación y marketing`
- `Comercio local — Leads y seguimiento`
- `Comercio local — Operación y señales`

---

## 2. MVP recomendado

### Qué construir primero (Fase 1 — 1 semana)

| Prioridad | Módulo | Por qué |
|-----------|--------|---------|
| 1 | Noticias + ayudas + normativas | Fuentes RSS reales, valor inmediato, sin API de pago |
| 2 | Reputación online (Google) | Alto impacto percibido, datos públicos vía Places API |
| 3 | Radar de competencia básico | Mismo Places API, diferenciador claro |
| 4 | Ideas de marketing automáticas | Code node con lógica de calendario, sin API externa |

**Motivo:** Estas 4 piezas usan fuentes reales ya disponibles, no requieren integraciones complejas, y producen valor visible al comerciante desde el día 1.

---

## 3. Arquitectura del workflow en n8n

### 3.1 Workflow principal: `Comercio local — Orquestador`

```
┌─────────────────┐
│ Schedule Trigger │  (cada 24h, 06:00)
│   "cron_daily"   │
└────────┬────────┘
         │
    ┌────▼────┐
    │  HTTP   │  GET /api/agent/config?sector=comercio_local
    │ Request │  → obtiene: business_id, nombre, tipo, ciudad,
    │"get_cfg"│    coords, google_place_id, competidores[], keywords[]
    └────┬────┘
         │
    ┌────▼──────────────────────────────────────────────┐
    │              PARALLEL SPLIT (4 ramas)              │
    │                                                    │
    │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────┐ │
    │  │ Módulo 1 │ │ Módulo 2 │ │ Módulo 3 │ │Mod.4 │ │
    │  │  Radar   │ │Reputación│ │   CRM    │ │Oper. │ │
    │  │  local   │ │marketing │ │  ventas  │ │negoc.│ │
    │  └────┬─────┘ └────┬─────┘ └────┬─────┘ └──┬───┘ │
    └───────┼────────────┼────────────┼───────────┼─────┘
            │            │            │           │
    ┌───────▼────────────▼────────────▼───────────▼─────┐
    │                    MERGE                           │
    │              "merge_all_modules"                   │
    └────────────────────┬──────────────────────────────┘
                         │
                    ┌────▼────┐
                    │  Code   │  Ensambla payload final
                    │"build_  │  con timestamp, versión,
                    │payload" │  business_id
                    └────┬────┘
                         │
                    ┌────▼────┐
                    │  HTTP   │  POST /api/agent/ingest
                    │ Request │  → envía todo a ENLAZE
                    │"webhook"│
                    └─────────┘
```

---

### 3.2 Módulo 1 — Radar local (detalle de nodos)

```
Nodos del Módulo 1:
━━━━━━━━━━━━━━━━━━

1. HTTP Request "fetch_news_rss_1"
   → GET https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/economia/portada
   → Entrada: ninguna
   → Salida: XML con últimas noticias económicas

2. HTTP Request "fetch_news_rss_2"
   → GET https://www.europapress.es/rss/rss.aspx?ch=136  (Economía pymes)
   → Entrada: ninguna
   → Salida: XML RSS

3. HTTP Request "fetch_news_rss_3"
   → GET https://cincodias.elpais.com/rss/feed.html?feedId=17066  (Pymes)
   → Entrada: ninguna
   → Salida: XML RSS

4. HTTP Request "fetch_boe_ayudas"
   → GET https://www.boe.es/rss/canal.php?c=ayudas
   → Entrada: ninguna
   → Salida: XML RSS con subvenciones y ayudas publicadas en BOE

5. HTTP Request "fetch_local_events"
   → GET Google Places Nearby Search API
   → URL: https://maps.googleapis.com/maps/api/place/nearbysearch/json
   → Params: location={{coords}}&radius=1000&type=event&key={{GOOGLE_API_KEY}}
   → Salida: JSON con eventos y establecimientos cercanos

6. HTTP Request "fetch_competitors"
   → GET Google Places Nearby Search API
   → Params: location={{coords}}&radius=500&type={{business_type}}&key={{GOOGLE_API_KEY}}
   → Salida: JSON con competidores cercanos (nombre, rating, horario, fotos)

7. Code "parse_news"
   → Entrada: outputs de nodos 1-3
   → Lógica:
     - Parsea XML RSS
     - Filtra por keywords: ["comercio local", "pyme", "autónomo",
       "subvención", "digitalización", "hostelería", "comercio minorista",
       "IVA", "seguridad social", "licencia apertura"]
     - Normaliza a estructura uniforme
   → Salida: array de {title, summary, source, url, date, category, relevance}

8. Code "parse_ayudas"
   → Entrada: output de nodo 4
   → Lógica:
     - Parsea RSS del BOE
     - Filtra por: "pyme", "comercio", "digitalización", "Kit Digital",
       "autónomo", "empleo", "formación"
     - Clasifica: subvención | ayuda | bonificación | formación
   → Salida: array de {title, type, amount_range, deadline, url, region, target}

9. Code "parse_competitors"
   → Entrada: outputs de nodos 5-6
   → Lógica:
     - Extrae competidores relevantes
     - Compara con datos previos (si existen) para detectar cambios
     - Genera señales: nuevo competidor, cambio de horario,
       subida/bajada rating, cierre detectado
   → Salida: array de {name, type, distance_m, rating, total_reviews,
              price_level, status, signal_type, signal_detail}

10. Code "build_radar_output"
    → Entrada: outputs de nodos 7-9
    → Lógica: Merge + clasificación por prioridad
    → Salida:
      {
        news: [...],
        regulations: [...],
        subsidies: [...],
        competitor_signals: [...],
        local_events: [...]
      }
```

---

### 3.3 Módulo 2 — Reputación y marketing (detalle de nodos)

```
Nodos del Módulo 2:
━━━━━━━━━━━━━━━━━━

11. HTTP Request "fetch_google_reviews"
    → GET Google Places Details API
    → URL: https://maps.googleapis.com/maps/api/place/details/json
    → Params: place_id={{google_place_id}}&fields=reviews,rating,
              user_ratings_total&key={{GOOGLE_API_KEY}}
    → Salida: JSON con reseñas, rating medio, total reseñas

12. Code "analyze_reviews"
    → Entrada: output de nodo 11
    → Lógica:
      - Clasifica cada reseña: positiva (4-5★), neutra (3★), negativa (1-2★)
      - Detecta temas recurrentes por keywords:
        espera, trato, precio, limpieza, calidad, ambiente, ruido,
        parking, accesibilidad, variedad, tamaño_raciones
      - Marca reseñas urgentes: 1★ sin respuesta en últimos 7 días
      - Calcula tendencia: media últimos 30 vs últimos 90 días
      - Genera borradores de respuesta para negativas
    → Salida:
      {
        current_rating: 4.2,
        total_reviews: 187,
        new_reviews_7d: 5,
        sentiment_breakdown: {positive: 3, neutral: 1, negative: 1},
        recurring_themes: ["espera", "calidad"],
        urgent_reviews: [...],
        suggested_responses: [...],
        trend: "stable" | "improving" | "declining"
      }

13. Code "generate_marketing_ideas"
    → Entrada: config del negocio + fecha actual
    → Lógica:
      - Calendario comercial: detecta próximos festivos, eventos,
        fechas señaladas (San Valentín, Día Madre, Black Friday,
        fiestas locales, Navidad, rebajas, vuelta al cole)
      - Análisis de día de semana: detecta días valle
        (típicamente martes/miércoles para hostelería)
      - Genera ideas según tipo de negocio:
        * Bar/restaurante: menú especial, happy hour, cata
        * Peluquería: descuento martes, pack novias, tratamiento nuevo
        * Tienda: liquidación, escaparate temático, venta flash
        * Estética: bono sesiones, tratamiento estacional
      - Propone mensajes para WhatsApp y RRSS
    → Salida:
      {
        upcoming_dates: [...],
        campaign_ideas: [
          {
            title: "Promoción martes de cañas",
            type: "promotion",
            channel: ["whatsapp", "instagram"],
            target: "clientes_recurrentes",
            suggested_date: "2026-04-21",
            message_draft: "🍺 Este martes...",
            reason: "Martes detectado como día valle"
          }
        ],
        content_ideas: [
          {
            platform: "instagram",
            format: "reel",
            topic: "Preparación del plato del día",
            hashtags: ["#comerciolocal", "#tubarrio"]
          }
        ]
      }

14. Code "build_reputation_output"
    → Entrada: outputs de nodos 12-13
    → Salida:
      {
        reviews: {...},
        campaigns: [...],
        content_ideas: [...]
      }
```

---

### 3.4 Módulo 3 — CRM y ventas (detalle de nodos)

```
Nodos del Módulo 3:
━━━━━━━━━━━━━━━━━━

15. HTTP Request "fetch_nearby_businesses"
    → GET Google Places Nearby Search
    → Busca negocios locales en radio de 2km que puedan ser CLIENTES de ENLAZE
    → Params: location={{coords}}&radius=2000&type=restaurant|cafe|
              hair_care|beauty_salon|store&key={{GOOGLE_API_KEY}}
    → Salida: JSON con negocios cercanos

16. Code "score_leads"
    → Entrada: output de nodo 15
    → Lógica:
      - Para cada negocio detectado evalúa:
        * ¿Tiene web? (website field vacío = +30 puntos)
        * ¿Rating bajo? (<3.5 = +20, <4.0 = +10)
        * ¿Pocas reseñas? (<20 = +25, <50 = +10)
        * ¿Sin fotos propias? (+15)
        * ¿Horarios incompletos? (+10)
        * ¿Sin respuesta a reseñas? (requeriría Places Details) (+20)
      - Score total 0-100
      - Clasifica: caliente (>60), templado (30-60), frío (<30)
    → Salida: array de
      {
        name: "Bar El Rincón",
        type: "bar",
        city: "Madrid",
        zone: "Chamberí",
        place_id: "ChIJ...",
        score: 75,
        priority: "hot",
        issues: ["sin_web", "pocas_reseñas", "rating_bajo"],
        opportunity: "Reputación + automatización",
        recommendation: "Negocio con baja reputación online y sin web:
                         lead caliente para pack reputación + presencia digital"
      }

17. HTTP Request "fetch_existing_leads"
    → GET /api/agent/leads?business_id={{business_id}}
    → Obtiene leads ya registrados en ENLAZE para no duplicar
    → Salida: array de leads existentes

18. Code "deduplicate_leads"
    → Entrada: outputs de nodos 16-17
    → Lógica:
      - Compara por place_id o nombre+dirección
      - Marca nuevos vs actualizados
      - Genera tareas de seguimiento para leads sin atender >3 días
    → Salida:
      {
        new_leads: [...],
        updated_leads: [...],
        follow_up_tasks: [
          {
            type: "follow_up",
            lead_name: "Bar El Rincón",
            reason: "Lead caliente sin contactar en 5 días",
            priority: "high",
            suggested_action: "Llamar o visitar"
          }
        ]
      }

19. Code "build_crm_output"
    → Entrada: output de nodo 18
    → Salida:
      {
        leads: [...],
        tasks: [...],
        pipeline_summary: {
          total_leads: 12,
          hot: 3,
          warm: 5,
          cold: 4,
          contacted: 7,
          pending: 5
        }
      }
```

---

### 3.5 Módulo 4 — Operación del negocio (detalle de nodos)

```
Nodos del Módulo 4:
━━━━━━━━━━━━━━━━━━

*** NOTA: Este módulo queda PREPARADO estructuralmente.
    Requiere que ENLAZE tenga datos de stock/proveedores
    del negocio para funcionar con datos reales. ***

20. HTTP Request "fetch_business_data"
    → GET /api/agent/business-data?business_id={{business_id}}
    → Obtiene: productos, stock, proveedores, ventas últimos 30 días
    → Salida: JSON con datos operativos del negocio

21. Code "analyze_stock"
    → Entrada: output de nodo 20
    → Lógica:
      - Detecta productos con stock bajo (< umbral configurado)
      - Detecta productos sin rotación (0 ventas en 30 días)
      - Detecta productos con margen negativo o <10%
      - Genera alertas de reposición
    → Salida:
      {
        low_stock_alerts: [
          { product: "Cerveza Mahou", current: 5, min: 24,
            urgency: "critical", action: "Pedir a proveedor X" }
        ],
        no_rotation: [
          { product: "Gin premium Y", days_without_sale: 45,
            stock_value: 180, action: "Considerar promoción o descatalogado" }
        ],
        margin_alerts: [
          { product: "Menú del día", margin_pct: 8,
            issue: "Margen inferior al 10%", suggestion: "Revisar coste ingredientes" }
        ]
      }

22. Code "analyze_suppliers"
    → Entrada: output de nodo 20
    → Lógica:
      - Compara precios entre proveedores para mismos productos
      - Detecta subidas de precio >5% respecto al mes anterior
      - Sugiere cambios de proveedor
    → Salida:
      {
        price_alerts: [...],
        supplier_comparison: [...],
        savings_opportunities: [...]
      }

23. Code "build_operations_output"
    → Entrada: outputs de nodos 21-22
    → Salida:
      {
        stock_signals: [...],
        margin_signals: [...],
        supplier_signals: [...],
        recommended_actions: [...]
      }
```

---

## 4. Fuentes de datos propuestas

### Implementables ahora (MVP)

| Módulo | Fuente | Tipo | Coste |
|--------|--------|------|-------|
| Radar | RSS El País Economía | RSS/XML | Gratis |
| Radar | RSS Europa Press Pymes | RSS/XML | Gratis |
| Radar | RSS Cinco Días Pymes | RSS/XML | Gratis |
| Radar | BOE Ayudas RSS | RSS/XML | Gratis |
| Radar | CCAA Ayudas (Kit Digital, etc) | Web scraping | Gratis |
| Radar | Google Places Nearby Search | API | ~$0.032/req |
| Reputación | Google Places Details (reviews) | API | ~$0.017/req |
| Competencia | Google Places (competidores) | API | ~$0.032/req |
| Marketing | Calendario interno (Code node) | Lógica local | Gratis |

### Requieren integración futura

| Módulo | Fuente | Tipo | Notas |
|--------|--------|------|-------|
| Reputación | TripAdvisor | Scraping/API | Requiere partnership o scraping |
| Reputación | Yelp Fusion API | API | Gratis hasta 5000 req/día |
| Reputación | Facebook Page Reviews | Graph API | Requiere token del negocio |
| CRM | Google My Business API | API | Para detectar fichas incompletas |
| Operación | Datos internos ENLAZE | API interna | Cuando el módulo stock exista |
| Radar | Eventbrite API | API | Eventos locales |
| Radar | Ayuntamiento Open Data | API/Web | Varía por ciudad |

### Solo estructura preparada

| Módulo | Fuente | Notas |
|--------|--------|-------|
| Operación | Stock y ventas | Requiere que el negocio use ENLAZE |
| Operación | Proveedores y precios | Requiere datos de compras |
| CRM | Pipeline completo | Requiere módulo CRM en ENLAZE activo |

---

## 5. Payloads JSON para ENLAZE

### 5.1 Payload completo (lo que envía el webhook)

```json
{
  "agent": "comercio_local",
  "version": "1.0",
  "business_id": "uuid-del-negocio",
  "timestamp": "2026-04-15T06:00:00Z",
  "execution_id": "n8n-exec-abc123",

  "radar": {
    "news": [
      {
        "id": "news_001",
        "title": "El Gobierno amplía el Kit Digital para comercios con menos de 3 empleados",
        "summary": "Nueva línea de ayudas de hasta 2.000€ para digitalización...",
        "source": "Cinco Días",
        "url": "https://cincodias.elpais.com/...",
        "date": "2026-04-14",
        "category": "ayuda",
        "relevance": 9,
        "tags": ["kit_digital", "subvención", "digitalización"]
      }
    ],
    "regulations": [
      {
        "id": "reg_001",
        "title": "Nuevo reglamento de terrazas en Madrid",
        "type": "normativa_local",
        "effective_date": "2026-06-01",
        "impact": "medium",
        "summary": "Limita horarios de terrazas en zonas residenciales...",
        "url": "https://boe.es/...",
        "action_required": "Revisar horarios de terraza antes del 1 de junio"
      }
    ],
    "subsidies": [
      {
        "id": "sub_001",
        "title": "Kit Digital Segmento III",
        "amount_range": "1.000€ - 2.000€",
        "deadline": "2026-12-31",
        "target": "Autónomos y empresas 0-2 empleados",
        "url": "https://www.acelerapyme.gob.es/...",
        "status": "abierta"
      }
    ],
    "competitor_signals": [
      {
        "id": "comp_001",
        "competitor_name": "Café Roma",
        "signal_type": "rating_change",
        "detail": "Rating bajó de 4.3 a 4.1 en últimos 30 días",
        "distance_m": 200,
        "opportunity": "Posible insatisfacción de sus clientes — oportunidad de captación"
      }
    ],
    "local_events": [
      {
        "id": "evt_001",
        "name": "Mercadillo de primavera - Plaza Mayor",
        "date": "2026-04-20",
        "expected_traffic": "high",
        "recommendation": "Preparar stock extra y considerar promoción especial"
      }
    ]
  },

  "reputation": {
    "reviews": {
      "current_rating": 4.2,
      "total_reviews": 187,
      "new_reviews_7d": 5,
      "trend": "stable",
      "sentiment": {
        "positive": 3,
        "neutral": 1,
        "negative": 1
      },
      "recurring_themes": ["calidad_comida", "tiempo_espera"],
      "urgent": [
        {
          "id": "rev_001",
          "author": "María G.",
          "rating": 1,
          "text": "Esperamos 40 minutos para que nos tomasen nota...",
          "date": "2026-04-12",
          "responded": false,
          "theme": "tiempo_espera",
          "suggested_response": "Hola María, sentimos mucho tu experiencia. Hemos reforzado el equipo en horario punta para evitar esperas. Nos encantaría que nos dieras otra oportunidad. Un saludo, [Nombre]"
        }
      ]
    },
    "campaigns": [
      {
        "id": "camp_001",
        "title": "Promoción Día de la Madre",
        "type": "seasonal",
        "channel": ["whatsapp", "instagram"],
        "target_audience": "clientes_recurrentes",
        "suggested_date": "2026-05-01",
        "message_draft": "Este Día de la Madre, sorpréndela con un menú especial para 2 por solo 35€. Reserva tu mesa llamando al [teléfono].",
        "reason": "Día de la Madre el 3 de mayo — alta demanda en hostelería"
      },
      {
        "id": "camp_002",
        "title": "Happy Hour martes",
        "type": "recurring",
        "channel": ["instagram_stories"],
        "target_audience": "nuevos_clientes",
        "suggested_date": "every_tuesday",
        "message_draft": "🍺 Martes de happy hour: 2x1 en cañas de 18:00 a 20:00",
        "reason": "Martes detectado como día con menor afluencia"
      }
    ],
    "content_ideas": [
      {
        "platform": "instagram",
        "format": "reel",
        "topic": "Behind the scenes: cómo preparamos nuestro plato estrella",
        "estimated_engagement": "high",
        "hashtags": ["#comerciolocal", "#hechoentubarrio", "#foodie"]
      }
    ]
  },

  "crm": {
    "leads": [
      {
        "id": "lead_001",
        "name": "Peluquería Estilo",
        "type": "peluquería",
        "city": "Madrid",
        "zone": "Chamberí",
        "place_id": "ChIJxyz...",
        "score": 82,
        "priority": "hot",
        "issues": ["sin_web", "pocas_reseñas", "no_responde_reseñas"],
        "opportunity": "Reputación + presencia digital",
        "recommendation": "Negocio con 12 reseñas, sin web y sin respuesta a reseñas negativas en 4 meses. Lead ideal para pack reputación + automatización.",
        "is_new": true
      }
    ],
    "tasks": [
      {
        "id": "task_001",
        "type": "follow_up",
        "entity_type": "lead",
        "entity_id": "lead_003",
        "title": "Contactar Bar El Rincón",
        "description": "Lead caliente (score 75) sin contactar en 5 días",
        "priority": "high",
        "due_date": "2026-04-16",
        "status": "pending"
      }
    ],
    "pipeline_summary": {
      "total_leads": 12,
      "hot": 3,
      "warm": 5,
      "cold": 4,
      "contacted_pct": 58,
      "conversion_rate": 12
    }
  },

  "operations": {
    "stock_signals": [
      {
        "id": "stock_001",
        "product": "Cerveza Mahou 33cl",
        "current_stock": 5,
        "min_stock": 24,
        "urgency": "critical",
        "action": "Pedir al proveedor Distribuciones García"
      }
    ],
    "margin_signals": [
      {
        "id": "margin_001",
        "product": "Menú del día",
        "current_margin_pct": 8,
        "target_margin_pct": 25,
        "issue": "Coste de materias primas subió un 15% este mes",
        "suggestion": "Ajustar precio de 12€ a 13.50€ o revisar ingredientes"
      }
    ],
    "supplier_signals": [
      {
        "id": "sup_001",
        "supplier": "Distribuciones García",
        "signal": "price_increase",
        "detail": "Subida del 8% en cerveza desde abril",
        "alternative": "Distribuciones López ofrece mismo producto un 5% más barato"
      }
    ]
  },

  "daily_summary": {
    "headline": "Todo estable. 1 reseña negativa pendiente de respuesta y oportunidad de campaña por Día de la Madre.",
    "priority_actions": [
      "Responder reseña negativa de María G. (1★ sobre esperas)",
      "Preparar campaña Día de la Madre antes del 1 de mayo",
      "Contactar lead caliente: Peluquería Estilo (Chamberí)"
    ],
    "opportunities_count": 3,
    "risks_count": 1,
    "score": 78
  }
}
```

---

## 6. Endpoints / acciones sugeridas para ENLAZE

### API interna de ENLAZE (receptor del agente)

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/agent/config` | GET | Devuelve config del negocio para el agente |
| `/api/agent/ingest` | POST | Recibe el payload completo del agente |
| `/api/agent/leads` | GET | Lista leads existentes (para dedup) |
| `/api/agent/business-data` | GET | Datos operativos del negocio |

### Acciones que ENLAZE ejecuta al recibir el payload

| Acción | Tabla destino | Qué hace |
|--------|--------------|----------|
| `upsert_news` | `agent_news` | Inserta/actualiza noticias |
| `upsert_regulations` | `agent_regulations` | Inserta normativas |
| `upsert_subsidies` | `agent_subsidies` | Inserta ayudas/subvenciones |
| `upsert_signals` | `agent_signals` | Señales de competencia, stock, márgenes |
| `upsert_reviews` | `agent_reviews` | Reseñas y análisis de reputación |
| `upsert_campaigns` | `agent_campaigns` | Ideas de campaña y marketing |
| `upsert_leads` | `agent_leads` | Leads detectados |
| `create_tasks` | `agent_tasks` | Tareas de seguimiento |
| `update_pipeline` | `agent_pipeline` | Resumen del pipeline CRM |
| `update_daily_summary` | `agent_daily_summary` | Resumen diario ejecutivo |

---

## 7. Roadmap por fases

### Fase 1 — MVP (Semana 1-2)

**Objetivo:** Valor visible desde el primer día

| Nodo | Implementación | Estado |
|------|---------------|--------|
| Schedule Trigger | cron 0 6 * * * | Real |
| Config loader | HTTP a ENLAZE | Real |
| RSS noticias (3 fuentes) | HTTP + Code parse | Real |
| BOE ayudas | HTTP + Code parse | Real |
| Google Reviews | Places API Details | Real |
| Análisis reseñas | Code node clasificación | Real |
| Ideas marketing | Code node calendario | Real |
| Merge + webhook | Merge + HTTP POST | Real |
| Tablas en Supabase | Migration | Real |

**Coste estimado:** ~$5-10/mes en Google API (dependiendo de volumen)

**Entregable para el comerciante:**
- Cada mañana ve noticias relevantes, ayudas disponibles
- Ve estado de sus reseñas y reseñas urgentes con respuesta sugerida
- Ve ideas de campaña y contenido adaptadas a su tipo de negocio

---

### Fase 2 — Mejorada (Semana 3-4)

**Objetivo:** Inteligencia competitiva y captación

| Nodo | Implementación | Estado |
|------|---------------|--------|
| Radar competencia | Places Nearby Search | Real |
| Señales competencia | Code node comparación | Real |
| Detección leads | Places Search + scoring | Real |
| Deduplicación leads | Code + API ENLAZE | Real |
| Tareas seguimiento | Code generación | Real |
| Dashboard agente en ENLAZE | Frontend React | Real |
| Notificaciones push | Integración con sistema existente | Real |

**Entregable adicional:**
- Ve qué hace la competencia (cambios de rating, nuevas aperturas)
- ENLAZE detecta automáticamente negocios cercanos como leads
- Sistema de tareas y seguimiento automático

---

### Fase 3 — Premium (Mes 2-3)

**Objetivo:** Operación completa y personalización

| Nodo | Implementación | Estado |
|------|---------------|--------|
| Control de stock | Cuando ENLAZE tenga módulo stock | Preparado |
| Alertas márgenes | Cuando haya datos de ventas | Preparado |
| Comparación proveedores | Cuando haya datos de compras | Preparado |
| TripAdvisor reviews | API o scraping | Futuro |
| Facebook reviews | Graph API con token | Futuro |
| WhatsApp envío automático | API WhatsApp Business | Futuro |
| Email automático | SendGrid/Resend | Futuro |
| Multi-idioma | i18n del agente | Futuro |

**Entregable adicional:**
- Control de stock con alertas automáticas
- Detección de márgenes negativos
- Envío automático de campañas por WhatsApp/email
- Múltiples fuentes de reseñas

---

## 8. Recomendación final

### Qué montar primero y por qué

**Empezar por el workflow `Comercio local — Radar local` + `Reputación y marketing`** en un solo workflow de n8n. Razones:

1. **Valor inmediato sin dependencias**: RSS + Google Places API son fuentes reales que funcionan desde el día 1. No necesitan que el comerciante haya cargado datos.

2. **Impacto percibido alto**: Un comerciante que cada mañana abre ENLAZE y ve "tienes 1 reseña negativa sin responder — aquí tienes un borrador de respuesta" percibe valor instantáneo.

3. **Diferenciador claro**: Ningún CRM para pymes en España ofrece esto como servicio automático diario integrado.

4. **Base para upsell**: Una vez el comerciante ve el radar y la reputación, el paso natural es: "¿quieres también que detectemos leads para ti?" → Fase 2.

### Orden de construcción recomendado

```
Día 1-2:  Schedule + Config + RSS noticias + RSS ayudas + Code parse
Día 3-4:  Google Reviews + Code análisis + Code marketing ideas
Día 5:    Merge + Webhook + Tablas Supabase + endpoint /api/agent/ingest
Día 6-7:  Frontend: vista de "Resumen diario" en dashboard ENLAZE
Día 8-10: Google Nearby (competidores) + Señales + Leads scoring
```

### Nombre de venta

> **"Asistente inteligente para tu negocio"**
>
> Cada día, ENLAZE te dice:
> - Qué está pasando en tu entorno
> - Qué oportunidades tienes
> - Qué deberías corregir
> - Qué acción comercial te conviene
> - Qué riesgo o incidencia debes mirar

---

## Anexo A: Pseudocódigo de nodos clave

### Code node "parse_news"

```javascript
const keywords = [
  "comercio local", "pyme", "autónomo", "subvención",
  "digitalización", "hostelería", "comercio minorista",
  "IVA", "seguridad social", "licencia", "kit digital",
  "reforma laboral", "inflación", "turismo"
];

const allItems = [];

for (const input of $input.all()) {
  const xml = input.json.data; // raw RSS XML
  const items = parseRSS(xml); // helper que parsea XML RSS

  for (const item of items) {
    const text = (item.title + " " + item.description).toLowerCase();
    const matched = keywords.filter(k => text.includes(k));

    if (matched.length > 0) {
      allItems.push({
        title: item.title,
        summary: item.description?.substring(0, 300),
        source: item.source || "RSS",
        url: item.link,
        date: item.pubDate,
        category: classifyNewsCategory(matched),
        relevance: Math.min(matched.length * 3, 10),
        tags: matched
      });
    }
  }
}

return allItems
  .sort((a, b) => b.relevance - a.relevance)
  .slice(0, 10);
```

### Code node "analyze_reviews"

```javascript
const placeData = $input.first().json;
const reviews = placeData.result?.reviews || [];
const now = new Date();
const day7ago = new Date(now - 7 * 86400000);
const day30ago = new Date(now - 30 * 86400000);
const day90ago = new Date(now - 90 * 86400000);

const themes = {
  espera: /esper|tard|demor|lent/i,
  trato: /trato|aten|amab|simpát|maleducad|grosero/i,
  precio: /precio|caro|barat|relación.calidad/i,
  limpieza: /limpi|suci|higien/i,
  calidad: /calidad|sabor|fresc|rico|buen/i,
  ambiente: /ambient|ruid|música|decorac/i,
  parking: /aparc|parking|estacion/i,
  raciones: /ración|cantidad|poco|abundan/i
};

const classified = reviews.map(r => {
  const sentiment = r.rating >= 4 ? "positive" :
                    r.rating === 3 ? "neutral" : "negative";
  const detectedThemes = Object.entries(themes)
    .filter(([_, regex]) => regex.test(r.text))
    .map(([name]) => name);

  return { ...r, sentiment, themes: detectedThemes };
});

const urgent = classified.filter(r =>
  r.sentiment === "negative" &&
  new Date(r.time * 1000) > day7ago
);

const recent30 = classified.filter(r =>
  new Date(r.time * 1000) > day30ago
);
const recent90 = classified.filter(r =>
  new Date(r.time * 1000) > day90ago
);

const avg30 = recent30.reduce((s, r) => s + r.rating, 0) /
              (recent30.length || 1);
const avg90 = recent90.reduce((s, r) => s + r.rating, 0) /
              (recent90.length || 1);

const trend = avg30 > avg90 + 0.2 ? "improving" :
              avg30 < avg90 - 0.2 ? "declining" : "stable";

return [{
  json: {
    current_rating: placeData.result?.rating,
    total_reviews: placeData.result?.user_ratings_total,
    new_reviews_7d: classified.filter(r =>
      new Date(r.time * 1000) > day7ago).length,
    trend,
    sentiment: {
      positive: classified.filter(r => r.sentiment === "positive").length,
      neutral: classified.filter(r => r.sentiment === "neutral").length,
      negative: classified.filter(r => r.sentiment === "negative").length
    },
    recurring_themes: getMostFrequent(classified.flatMap(r => r.themes)),
    urgent: urgent.map(r => ({
      author: r.author_name,
      rating: r.rating,
      text: r.text,
      date: new Date(r.time * 1000).toISOString().split("T")[0],
      themes: r.themes,
      suggested_response: generateResponse(r)
    }))
  }
}];
```

### Code node "generate_marketing_ideas"

```javascript
const config = $input.first().json;
const businessType = config.business_type; // bar, restaurante, peluquería...
const now = new Date();

// Calendario comercial español
const calendar = [
  { date: "01-06", name: "Reyes", advance_days: 15 },
  { date: "02-14", name: "San Valentín", advance_days: 14 },
  { date: "03-19", name: "Día del Padre", advance_days: 10 },
  { date: "05-01", name: "Día del Trabajo", advance_days: 7 },
  { date: "05-first_sunday", name: "Día de la Madre", advance_days: 14 },
  { date: "10-12", name: "Día de la Hispanidad", advance_days: 7 },
  { date: "11-last_friday", name: "Black Friday", advance_days: 14 },
  { date: "12-25", name: "Navidad", advance_days: 21 },
  { date: "12-31", name: "Nochevieja", advance_days: 14 },
];

// Detecta días valle por tipo de negocio
const valleyDays = {
  bar: [1, 2],           // lunes, martes
  restaurante: [1, 2],   // lunes, martes
  peluquería: [1],        // lunes
  tienda: [1],            // lunes
  estética: [1, 2],       // lunes, martes
};

const campaigns = [];
const upcoming = getUpcomingDates(calendar, now, 30);

for (const event of upcoming) {
  campaigns.push({
    title: `Campaña ${event.name}`,
    type: "seasonal",
    channel: ["whatsapp", "instagram"],
    target_audience: "clientes_recurrentes",
    suggested_date: subtractDays(event.actualDate, event.advance_days),
    reason: `${event.name} el ${formatDate(event.actualDate)}`
  });
}

// Promoción días valle
const valleys = valleyDays[businessType] || [1, 2];
campaigns.push({
  title: `Promoción ${getDayNames(valleys)}`,
  type: "recurring",
  channel: ["instagram_stories", "whatsapp"],
  reason: `${getDayNames(valleys)} detectados como días de menor afluencia`
});

return [{ json: { campaigns } }];
```

---

## Anexo B: Migración Supabase para tablas del agente

```sql
-- Tablas necesarias en ENLAZE para almacenar datos del agente

CREATE TABLE IF NOT EXISTS agent_daily_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  business_id uuid,
  execution_date date NOT NULL DEFAULT CURRENT_DATE,
  headline text,
  priority_actions jsonb DEFAULT '[]',
  opportunities_count int DEFAULT 0,
  risks_count int DEFAULT 0,
  score int DEFAULT 0,
  raw_payload jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_news (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  external_id text,
  title text NOT NULL,
  summary text,
  source text,
  url text,
  published_date date,
  category text,
  relevance int DEFAULT 5,
  tags text[] DEFAULT '{}',
  read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  signal_type text NOT NULL,
  source_entity text,
  title text NOT NULL,
  detail text,
  severity text DEFAULT 'info',
  opportunity text,
  action_suggested text,
  acknowledged boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  platform text DEFAULT 'google',
  author text,
  rating int,
  text_content text,
  review_date date,
  sentiment text,
  themes text[] DEFAULT '{}',
  responded boolean DEFAULT false,
  suggested_response text,
  urgent boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  title text NOT NULL,
  type text,
  channel text[] DEFAULT '{}',
  target_audience text,
  suggested_date date,
  message_draft text,
  reason text,
  status text DEFAULT 'idea',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  name text NOT NULL,
  business_type text,
  city text,
  zone text,
  place_id text UNIQUE,
  score int DEFAULT 0,
  priority text DEFAULT 'cold',
  issues text[] DEFAULT '{}',
  opportunity text,
  recommendation text,
  status text DEFAULT 'new',
  contacted_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS en todas las tablas
ALTER TABLE agent_daily_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_news ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_leads ENABLE ROW LEVEL SECURITY;

-- Políticas RLS (patrón uniforme)
DO $$ BEGIN
  CREATE POLICY "Users own agent_daily_summary" ON agent_daily_summary
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users own agent_news" ON agent_news
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users own agent_signals" ON agent_signals
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users own agent_reviews" ON agent_reviews
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users own agent_campaigns" ON agent_campaigns
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users own agent_leads" ON agent_leads
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Índices
CREATE INDEX IF NOT EXISTS idx_agent_news_user ON agent_news(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_signals_user ON agent_signals(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_reviews_user ON agent_reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_campaigns_user ON agent_campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_leads_user ON agent_leads(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_leads_place ON agent_leads(place_id);
CREATE INDEX IF NOT EXISTS idx_agent_summary_date ON agent_daily_summary(user_id, execution_date);
```

---

*Documento generado para ENLAZE · Abril 2026*
