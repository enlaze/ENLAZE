# Entornos: producción y previsualizaciones

## Los dos proyectos

| | Producción | Previsualizaciones |
|---|---|---|
| Proyecto Supabase | `dsgnymebkxxkslyeotee` | `wowzjvlyklooqafgzuqk` |
| Nombre | enlaze | enlaze-preview |
| Región | eu-west-3 | eu-west-3 |
| Datos | los de verdad | ninguno; se siembra lo que haga falta |
| Lo usa | `enlaze.es` | cada despliegue de rama en Vercel |

## Por qué existe el segundo

Vercel publica una previsualización por cada rama empujada, y las variables de
entorno que se añaden sin acotar valen para Production, Preview y Development a
la vez. Durante meses, la URL de cualquier rama habló con la base de
**producción**, y sus rutas de servidor llevaban la clave de servicio de
producción, que se salta RLS.

No era teórico: el 9 de octubre de 2026, un borrado hecho desde la
previsualización de un PR apareció en los datos reales. Se descubrió al cuadrar
el recuento de facturas tras un despliegue.

Tres medidas, en el orden en que se tomaron:

1. **Vercel Authentication** en las previsualizaciones, para que abrir una exija
   iniciar sesión en Vercel.
2. **Este segundo proyecto**, para que Preview tenga su propia base.
3. **`npm run entorno:check`** (`scripts/entorno-check.mts`), que falla la
   compilación si un despliegue apunta a la base de otro entorno. Cuatro reglas:
   una previsualización no apunta a producción; producción sí tiene que apuntar
   a producción —el error simétrico es igual de grave—; la URL y la clave de
   servicio tienen que ser del mismo proyecto; y fuera de producción Stripe no
   puede ir en modo real. Fuera de Vercel no opina.

## Variables acotadas en Vercel

Cada variable va marcada **solo para su entorno**. Las que importan:

| Variable | Production | Preview |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | el proyecto de producción | el de previsualizaciones |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | la suya | la suya |
| `SUPABASE_SERVICE_ROLE_KEY` | la suya | la suya |
| `STRIPE_SECRET_KEY` | `sk_live_…` | **sin definir** (o `sk_test_…`) |
| `RESEND_API_KEY` | la suya | **sin definir** |

`SUPABASE_PROJECT_REF` **no hace falta en Vercel**: solo la lee
`scripts/migraciones-check.mts`, que no corre en el build —el `prebuild` es
`entorno:check && plans:check`—. En CI la pone el propio workflow por su matriz,
y en local sale de `.env.local`.

Las dos últimas no son capricho. Una previsualización con la clave real de
Resend puede **enviar correos a clientes reales**, y con una `sk_live_` de
Stripe puede **cobrar**. De Stripe se encarga `entorno:check`, porque el modo va
en el prefijo; de Resend no hay forma de saber si una clave es de pruebas, así
que ahí solo queda acotarla a mano.

## Mantenimiento: el esquema se desincroniza

Es el coste real de tener un segundo proyecto, y es el que se olvida: **una base
de pruebas que no reproduce el esquema de producción no sirve para probar nada**,
y se queda atrás con la primera migración.

**La regla: toda migración que se aplique a producción se aplica también al
proyecto de previsualizaciones.** Con el CLI, apuntando a cada uno:

```bash
supabase db push --linked --include-all          # producción (el proyecto enlazado)
supabase db push --db-url "$URL_DE_PREVIEW" --include-all
```

Y para saber si ya se ha desincronizado, sin necesitar la contraseña de la base
—solo un token de la Management API con permiso Database → Migrations → Read—:

```bash
SUPABASE_PROJECT_REF=wowzjvlyklooqafgzuqk npm run migraciones:check
```

No hace falta acordarse: el workflow `migraciones-check.yml` compara **los dos
proyectos** cada dos horas y en cada push a `main`, y nombra las que falten en
cada lado. Si el trabajo de preview sale en rojo, es que una migración llegó a
producción y no a la base de pruebas.

## Cómo se montó el proyecto de previsualizaciones

Por si hay que rehacerlo. El detalle, con los errores esperados y las trampas,
está en `supabase/validacion/recibidas/README.md`; el resumen:

1. `pg_dump --schema-only` del esquema `public` de producción, **más** los tres
   esquemas internos (`billing_internal`, `budget_internal`,
   `portal_token_internal`), que un volcado de `public` no arrastra aunque siete
   de sus triggers dependan de ellos.
2. Cargar los dos volcados con `psql`. Errores esperados: `public` ya existe,
   los siete triggers de plan que se crean antes que su esquema, y doce
   `ALTER DEFAULT PRIVILEGES` que piden superusuario.
3. Reponer esos siete triggers y los **dos de `auth.users`** (perfil y prueba
   gratuita), que tampoco viajan en un volcado de `public`.
4. Sembrar `plan_catalog`, o `billing_internal.start_trial()` aborta el registro
   de cualquier usuario nuevo.
5. Registrar en `supabase_migrations.schema_migrations` las versiones que el
   volcado ya representa. Si no, `migraciones:check` las dará por pendientes
   para siempre y el workflow quedará en rojo sin motivo.
