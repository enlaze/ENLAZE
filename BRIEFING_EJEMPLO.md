# Briefing de ejemplo (para grabar el vídeo de la landing)

_Datos de ejemplo para sembrar en Supabase y grabar la tarjeta del briefing. No necesita IA ni API keys._

## Contenido del briefing

**Titular:** Tres presupuestos esperan respuesta y una factura vence hoy

**Narrativa:** Lo primero de hoy es cobrar y cerrar. La factura de Construcciones Duero vence esta tarde y sigue como pendiente, y tienes tres presupuestos de la semana pasada que los clientes abrieron pero no han contestado. Con dos llamadas y un reenvío te quitas lo urgente. Y vigila el margen de solados: el proveedor ha subido un 6%.

## Qué hacer hoy (5 tareas para ir tachando)

1. **ALTA · Antes de las 12:00** — Llamar a Construcciones Duero. *La factura F-2026-018 (2.480 €) vence hoy y sigue pendiente.*
2. **ALTA · Hoy** — Confirmar el pedido de azulejo para la obra de Vallecas. *Llega en 3 días; sin confirmar hoy, se retrasa la obra.*
3. **MEDIA · Esta mañana** — Reenviar el presupuesto de la reforma de Chamberí. *Lo han abierto tres veces, sin respuesta desde el martes.*
4. **MEDIA · Hoy** — Emitir la factura de la obra terminada en Getafe. *Entregada el viernes y aún sin facturar.*
5. **BAJA · Cuando puedas** — Revisar el margen de la partida de solados. *El proveedor subió un 6%; puede comerte el beneficio.*

---

## Prompt para Claude Code (sembrar el briefing)

> Con el MCP de Supabase conectado, **siembra un briefing de ejemplo** para el usuario con el que voy a grabar la landing (mi cuenta de dev del dashboard — identifícala o pregúntame el email). Inserta una fila en la tabla del briefing diario (`agent_daily_summary` o la que use `DailyBriefingCard`), **con fecha de hoy**, para que la tarjeta del Centro de control lo renderice como el briefing del día. Usa el contenido de arriba (titular, narrativa y las 5 tareas con su prioridad, cuándo y descripción), mapeándolo al esquema existente.
>
> Además, **verifica que la interacción de marcar/tachar tareas funciona**: al pulsar la casilla de una tarea, debe marcarse como hecha y **tacharse visualmente**. Si no existiera o no tachara, arréglala para que se vea el gesto de completar la tarea.
>
> Es dato de ejemplo para grabar un vídeo — no hace falta IA ni API keys. Confírmame en `localhost:3000/dashboard` que se ve bien y que puedo tachar tareas.
