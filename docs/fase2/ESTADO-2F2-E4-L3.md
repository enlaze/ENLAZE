# 2F-2 / E4 lote 3 — retirada de los enlaces heredados

Fecha: 2026-09-27. Estado: **S3.1 y S3.2 en rama, sin fusionar ni aplicar**.
Rama: `codex/legacy-token-retirement-s3`, desde `origin/main` `99d11e9`.
Migración nueva: `20260927100000_projects_access_token_no_default.sql`,
**no aplicada**.

## Lo que la auditoría cambió del plan

El lote 3 estaba planteado como «sustituir los ocho enlaces heredados y retirar
la columna». Leer el esquema y los datos deshizo dos supuestos.

**`projects.access_token` es `uuid NOT NULL DEFAULT gen_random_uuid()`.** No son
ocho restos de una tanda antigua: son ocho porque hay ocho proyectos, y **cada
alta nueva produce otro**. El conjunto no se agota, crece. Cualquier plan que
sustituya los ocho sin cortar la fuente no converge nunca.

Y porque la columna es `NOT NULL`, **retirar un enlace concreto poniéndolo a
`NULL` es imposible hoy**. La compensación que figuraba en la revisión de E4
—vaciar proyecto a proyecto— no se podía ejecutar. Corregido en
[ESTADO-2F2-E4-HARDENING.md](ESTADO-2F2-E4-HARDENING.md).

**El portal nunca ha tenido nada que enseñar.** En toda la base hay 0
`project_changes` y 0 presupuestos enviados. Los ocho proyectos están en
`planning`, tres propietarios, y al menos cuatro son datos de prueba
(«prueba», «prueba 2», «prueba 3»). Un cliente que abriera cualquiera de los
ocho vería un portal vacío.

**No hay forma de saber si se han usado.** No existe telemetría de acceso al
portal: ni columna, ni tabla, ni evento. La «ventana de observación» que el plan
anterior daba por hecha no es ejecutable tal como estaba escrita.

## Orden, y por qué es el contrario del previsto

| | | Estado |
|---|---|---|
| **S3.1** | cortar la fuente: fuera el `DEFAULT`, columna nullable | en esta rama |
| **S3.2** | retirar el fallback muerto del portal público | en esta rama |
| **S3.3** | vaciar los ocho y retirar columna y compatibilidad | **fuera de alcance**, requiere decisión de producto |

Primero se corta la emisión. Si no, cada día que pasa añade un enlace y la
retirada persigue un blanco móvil.

## S3.1 · La migración

Comprueba que `public.projects.access_token` existe y que su estado de partida
es **exactamente** `gen_random_uuid()` y `NOT NULL`; si no, aborta en vez de
adivinar. Después quita el `DEFAULT` y permite `NULL`.

No toca ninguna fila. No emite, rota, copia ni revoca ningún token. No retira la
columna ni la compatibilidad heredada de las RPC: **los ocho enlaces actuales
siguen abriendo por `portal_read_snapshot`**, y hay una prueba que lo comprueba.

### La compensación no es incondicional

`ROLLBACK_2F2_E4_L3` exige el reconocimiento
`enlaze.allow_legacy_token_default_rollback = 'restore_automatic_legacy_links'`
y, antes de tocar nada, **cuenta los proyectos con `access_token` nulo**.

Si hay uno solo, **aborta sin modificar nada**. Restaurar el `NOT NULL` obligaría
a inventar un valor para esas filas, y ese valor sería una URL portadora del
portal emitida para un proyecto que nunca la pidió. Un rollback no puede tomar
esa decisión: hay que tomarla proyecto a proyecto y con su dueño delante.

Conviene decirlo sin rodeos: **S3.1 solo es reversible mientras no exista ningún
proyecto creado después de aplicarla.** En la práctica, eso significa desde el
despliegue hasta la primera alta.

## S3.2 · El fallback muerto del portal

`app/portal/[token]/page.tsx` tenía `loadLegacyPortal()`, invocado solo cuando
`portal_read_snapshot` devolvía `PGRST202`. Era compatibilidad para la ventana
entre desplegar la página y aplicar `20260915150000`; esa ventana se cerró el
2026-09-15.

Seguía haciendo dos cosas que hoy no puede hacer:

- leer `portal_tokens` directamente, privilegio que `anon` perdió con
  `20260925110000` — el fallback ya estaba medio roto;
- leer `projects` con `select("*")`, que arrastra `access_token` —el secreto del
  enlace heredado— al navegador de un visitante anónimo.

Retirado. El portal público depende ahora exclusivamente de
`portal_read_snapshot`, y habla con la base por exactamente tres RPC: esa y las
dos de respuesta. El comportamiento de enlace inválido no cambia: error,
respuesta vacía, proyecto ausente o excepción llevan igual a «no encontrado».

Las dos RPC de escritura **conservan** su detección de `PGRST202`: si faltaran,
el portal se niega explícitamente en vez de escribir en la tabla. Eso es lo
contrario del fallback retirado y debe seguir.

## Pruebas

| Suite | |
|---|---|
| `legacy-token-retirement.integration` | **9/9**, PostgreSQL 17 desechable |
| `portal-public-page-contract` | **5/5**, estática |

La de integración comprueba: estado de partida igual al de producción; el guard
rechaza los tres estados no previstos; las ocho filas quedan **idénticas byte a
byte** tras aplicar; un proyecto nuevo nace sin enlace y la columna admite `NULL`
explícito; ninguna otra columna de ninguna otra tabla se mueve; el portal sigue
abriendo un enlace heredado por la RPC; y la migración no lleva control de
transacción propio y se puede envolver y deshacer entera.

**Control negativo obligatorio**: un mutante sin `DROP DEFAULT` demuestra que con
el `DEFAULT` intacto el proyecto nuevo **sí** recibe enlace. Sin él, la aserción
del alta pasaría por ausencia de la columna, no por la migración.

El fixture `portal-token-access-schema.sql` pasa a declarar `access_token` como
`NOT NULL DEFAULT`, igual que producción. Antes era nullable, y con esa versión
el guard de la migración no se habría ejercitado nunca.

La estática mata tres mutantes: reintroducir `from("portal_tokens")`, reintroducir
`select("*")` sobre `projects`, y perder el camino de «no encontrado».

## Despliegue futuro

1. `CHECK_E4_L3_S31_PRECHECK` → `veredicto = OK`.
2. `supabase migration list`: la única pendiente debe ser `20260927100000`.
3. Un solo `supabase db push`.
4. `CHECK_E4_L3_S31_AUDIT` → `veredicto = OK`: registrada, sin default, nullable,
   ocho enlaces intactos y la unicidad en pie.

S3.2 no necesita migración: viaja con el despliegue de la aplicación y es
independiente de S3.1 en ambos sentidos.

## Lo que queda decidido por producto, no por ingeniería

**Qué se hace con los ocho.** Con 0 cambios, 0 presupuestos enviados, cuatro
proyectos de prueba y tres propietarios que son el equipo, montar una campaña de
sustitución —emitir moderno, comunicar al cliente, observar— es desproporcionado.
La recomendación es preguntar a los tres propietarios si alguno llegó a compartir
un enlace; a la respuesta negativa, vaciarlos en una sola operación una vez S3.1
esté aplicada. Si alguno dice que sí, ese proyecto y solo ese recibe token
moderno con `read` + `approve_changes`, 90 días y propietario el `user_id` del
proyecto.

Sin telemetría, esa decisión se toma por testimonio. Si se quiere certeza hay que
instrumentar primero y esperar, lo que son semanas de calendario para ocho
enlaces que probablemente nadie abrió.

## Riesgos

- **S3.1 deja de ser reversible en cuanto se crea el primer proyecto.** Es
  inherente, no un descuido: el rollback lo detecta y se niega.
- **La retirada de la columna sigue lejos.** Mientras `portal_read_snapshot` y
  `portal_respond_to_change` acepten `access_token`, hay compatibilidad que
  mantener. Retirarla es S3.3 y exige cero consumidores.
- **`anon` conserva `SELECT` de tabla sobre `projects` y `budgets`** sin ninguna
  política que le dé filas. Mismo patrón que se cerró en `portal_tokens`, misma
  solución, fuera del alcance de este lote.
- **Los ocho enlaces siguen siendo portadores y sin caducidad.** S3.1 no los
  toca; quien tenga uno guardado sigue entrando mientras exista.
