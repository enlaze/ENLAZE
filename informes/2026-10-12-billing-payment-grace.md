# Facturación: cinco días de gracia desde el primer impago

**Entrega:** primero se subió mediante push normal `codex/billing-webhook-regression` (`5ee9fe8`). El cambio nuevo está en `codex/billing-payment-grace`, desde `origin/main` (`10788b1`), en una carpeta duradera del repositorio. Sin PR; esta segunda rama queda local. La migración `20261012170000_billing_payment_grace.sql` está **pendiente, sin aplicar a ENLAZE**. Solo se ejecutó contra PostgreSQL 17 desechable. Sin acceso a Stripe, Vercel, Supabase externo ni credenciales reales.

**Cambio:** `BILLING_GRACE_DAYS = 5` se exporta exclusivamente desde `lib/plans.ts`. El primer `invoice.payment_failed` propone un límite a 120 horas; un trigger conserva atómicamente la primera fecha no NULL, incluso con escrituras concurrentes. La recuperación activa borra la fecha; el siguiente impago abre otro plazo. La baja corta inmediatamente. Una fila `past_due` con fecha NULL conserva el bloqueo anterior: sin default, backfill ni cron.

**Acceso y aviso:** SQL concede `full` solo con `past_due_grace_ends_at > now()`; en igualdad corta. En esta revisión, `lib/subscription.ts` **delega en SQL por RPC**, sin un segundo cálculo de fechas. Se actualizó su contrato y se comprobaron sus funciones reales, el trigger de escritura y `billing_usage_summary`. La API incluye el límite; dashboard y Plan y facturación muestran día y hora en Madrid y enlace para revisar el pago. El temporizador/foco únicamente reconsulta el servidor, nunca cambia permisos ni suscripciones.

**Verificación:** PostgreSQL **17.11** y PostgREST **16.4**, BillingStore y `stripe_events` reales: **11/11** (diez casos y contenedor). Cinco entregas preservan el límite; se prueban −1 ms / igualdad / +1 ms, duplicados, recuperación, segundo impago, NULL heredado, baja y concurrencia con barrera de bloqueo. SQL y RPC usan reloj fijo sustituido únicamente en el catálogo del clúster privado verificado, sin alterar cuerpos SQL de producción. El transporte Stripe rechaza la red; solo la respuesta externa de suscripción es una fixture. Aviso **2/2**, unitarias de planes/webhook **19/19**; TypeScript, ESLint de TypeScript/JavaScript modificados y `git diff --check`: correctos.

**Mutaciones: 7/7 detectadas.** Se usan copias temporales; cada ejecución debe fallar en su caso de comportamiento, con código 1. Los gates se omiten en mutantes para evitar falsos éxitos por huellas SQL diferentes. Salidas completas: `informes/evidencias/billing-payment-grace/*.tap`; resumen: `resumen.txt`.

```text
BASELINE: 11/11 PASS
KILLED retry-extends-deadline: five retries never move the deadline
  retry 1 must preserve the FIRST deadline
  actual:   2030-10-17T02:00:00.000Z
  expected: 2030-10-17T01:00:00.000Z
KILLED no-opening-grace
KILLED inclusive-boundary
KILLED early-boundary
KILLED no-recovery-reset
KILLED deleted-keeps-access
KILLED null-grants-access
7/7 mutants killed; application/migration unchanged; clusters destroyed.
```

**Gates/rollback:** en `docs/fase2/CHECKS.sql`, `CHECK_BILLING_GRACE_PRECHECK` y `_AUDIT` revisan cuerpos/configuración/ACL, columna anulable sin default, trigger, consumidores SQL, permisos y registro/conteo. El AUDIT exige copiar el conteo previo y revisar el snapshot, inmediatamente tras aplicar y antes del nuevo webhook. Las pruebas comparan todas las filas sin backfill y rechazan default, trigger desactivado, permisos alterados y reaplicación. `ROLLBACK_BILLING_GRACE` restaura acceso/esquema; exige reconocimiento explícito por perder las fechas. Se verifica que una gracia vigente pasa a solo lectura y el resto de columnas se conserva. Sin BEGIN/COMMIT de nivel superior. Despliegue futuro: PRECHECK → migración → AUDIT → aplicación; rollback: aplicación anterior → SQL.

**Pendiente:** no se ejecutó `npm run build`: su prebuild conecta con base/Stripe, prohibidos aquí. La instalación local reutilizada contiene Next 16.2.1 frente a 16.3.8 en el lockfile; se leyeron sus guías y no se descargaron dependencias. Falta build con versiones exactas en entorno autorizado; no se afirma validación en producción.

**Reproducir:** `npm run test:billing-grace`, `test:billing-grace-mutations`, `test:billing-grace-notice`, `test:billing`. Requiere PG17/PostgREST locales ya instalados; no carga `.env`, descarga dependencias ni acepta variables de un proyecto real. No ejecutar `test:billing-integration`, `plans:sync` ni migraciones contra la base real para este encargo.

## Integración y gate de producción · 20 de octubre

El PRECHECK inicial de producción abortó correctamente: el cuerpo de `access_level` tiene hash `b7e6d58a7ee948cde947fd2a712e91a5`, mientras la migración histórica local tiene `a73facb21af70ce1ad9ba56e0c175a5c`. La única diferencia es el comentario tras `else 'read_only'`; lógica, SECURITY DEFINER, search_path y ACL coinciden. El guard y el PRECHECK aceptan exclusivamente esos dos cuerpos conocidos. La prueba real verifica ambos y demuestra que una modificación de la condición de acceso sigue abortando el gate y la migración.

Las regresiones de webhook se ejecutan con el esquema de gracia aplicado solamente en el banco desechable. El primer impago conserva estado past_due y plan, y ahora abre acceso temporal; los controles de límites, recuperación y NULL legacy siguen en la suite de gracia.

Validación actual: gracia real 11/11, store real 8/8, planes/webhook 19/19, avisos 2/2; siete mutantes detectados. TypeScript y lint de archivos afectados pasan. No se ejecutó build local ni prebuild de Stripe. La aplicación de producción requiere PRECHECK fresco, snapshot sin datos personales, una sola migración en el plan y AUDIT inmediato antes de desplegar el webhook.
