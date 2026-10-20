# Regresión del almacén del webhook de facturación

Rama `codex/billing-webhook-regression`, desde el `origin/main` local `10788b1`. Sin fetch, push, PR, servicios externos ni lectura de `.env`.

## Cambio y alcance

Banco autocontenido: crea y destruye un clúster **PostgreSQL 17** y un PostgREST de bucle local. Ejecuta **la migración de facturación completa, sin modificarla**: `stripe_events`, `subscriptions`, restricciones, RLS y funciones del muro son reales. `createSupabaseBillingStore` usa el cliente Supabase real. Solo los prerrequisitos de Auth y tablas de documentos son mínimos; no se prueba Supabase Auth/Storage ni Checkout. Stripe firma/verifica en memoria con credenciales ficticias y su cliente HTTP está prohibido. El banco rechaza configuración de proyectos reales y tráfico HTTP fuera de su origen local.

Siete casos conductuales (ocho tests contando el padre):

- Duplicado: `new` aplica; `duplicate` no reescribe ni el plan ni `processed_at`, incluso tras una actualización más nueva del plan. Un trigger de auditoría cuenta las escrituras reales.
- Caducado: reclama la fila y renueva `received_at`; reciente: `in_progress`, entrega 409 y ninguna escritura. Una finalización entre lectura y UPDATE tampoco se reclama.
- Concurrencia: diez carreras forzadas; ambos leen la fila caducada antes del UPDATE. Exactamente un `new`, un `in_progress` y una escritura SQL por carrera.
- Baja e impago: estado y acceso comprobados en las tablas y la función real `billing_internal.access_level`.

**Decisión de producto ya presente en el código:** `customer.subscription.deleted` pone `canceled`, mantiene el nombre del plan y deja acceso de solo lectura. `invoice.payment_failed` pone **inmediatamente `past_due` y acceso de solo lectura**, aunque el periodo siga vigente; conserva plan, periodo, IDs y la política de cancelación. No cancela ni rebaja el plan. No se ha cambiado esta decisión ni código de ejecución.

## Validación y reproducción

```text
npm run test:billing-store             # 8 pasan; 0 fallan; 0 omitidos
npm run test:billing-store-mutations   # baseline verde; 9/9 mutantes detectados
npm run test:billing                   # 19 pasan; 0 fallan
```

Mutaciones: retirar corte de duplicado, comprobación `processed_at`, reclamo, filtro de antigüedad, filtro de no procesado, corte de `in_progress`, marcado de procesamiento, aplicación de baja y aplicación de impago. Cada variante debe fallar su caso nombrado; un error de arranque no cuenta. Las copias mutadas se eliminan; el original queda intacto. [Salidas literales](evidencias-billing-webhook-regression/resumen.txt) y diez archivos TAP completos en esa carpeta.

Requisitos locales: PostgreSQL 17 (`BILLING_TEST_PG_BIN` si no está en la ruta habitual), PostgREST (`BILLING_TEST_POSTGREST_BIN`) y dependencias npm ya instaladas. Aquí: PG 17.11, PostgREST 16.4, Node 25.8.2. `tsc --noEmit --incremental false` y ESLint de los archivos tocados pasan. La instalación offline no tenía `zod@4.6.5`; se reutilizaron dependencias locales, con `pg`, `tsx`, Stripe y Supabase **exactamente en las versiones del lock**. Next instalado es 16.2.1 frente a 16.3.8 del lock: **no se validó build**; además su prebuild consulta Stripe y este encargo lo prohíbe.

Para revisar en diez minutos: ejecutar los dos comandos del banco; leer los fallos `duplicate-short-circuit` y `no-reclamation`, y comprobar que el informe refleja la política de impago deseada. No hay migración ni actuación externa pendiente de aprobar.
