-- BANCO DESECHABLE DEL CONTRATO DE CONFLICTO PT409 — ESQUEMA EXCLUSIVO DE PRUEBA
--
-- =============================================================================
-- QUÉ ES ESTE FICHERO Y, SOBRE TODO, QUÉ NO ES
-- =============================================================================
-- Es un banco de pruebas DESECHABLE cuyo único objetivo es demostrar UNA cosa:
-- que un SQLSTATE `PT409` lanzado dentro de una función de PostgreSQL llega al
-- cliente como un HTTP 409 con `code = "PT409"` en el cuerpo, en UNA sola
-- petición, sin reintento automático y SIN HABER MODIFICADO NADA.
--
-- NO ES UNA MIGRACIÓN DE PRODUCCIÓN Y NO ES UN BORRADOR DE UNA.
-- Todo lo que se crea aquí lleva el prefijo `pt409_bench_` precisamente para que
-- nadie pueda confundirlo con el esquema real ni copiarlo a
-- `supabase/migrations` por inercia. Las tablas de aquí NO son `budgets` ni
-- `budget_items` recortadas: son tablas inventadas para este experimento. La
-- función de aquí NO es `replace_budget_items` con concurrencia ni un anticipo
-- de la futura RPC de 2F-2: es el mínimo código capaz de exhibir el contrato de
-- conflicto.
--
-- Decirlo al revés, que es como importa: este fichero NO demuestra que el diseño
-- de 2F-2 sea correcto. Demuestra que el MECANISMO de señalización de conflicto
-- funciona de extremo a extremo en la pila real (PostgreSQL -> PostgREST ->
-- fetch / supabase-js). El diseño se discute en el informe, no aquí.
--
-- ES DESTRUCTIVO. Empieza borrando los esquemas `public` y `auth` enteros, y
-- crea y modifica ROLES, que son objetos del CLÚSTER y no de la base: existen
-- para todas las bases del servidor a la vez y sobreviven al borrado de los
-- esquemas. Por eso se exige un contenedor dedicado y no «una base más» dentro
-- de un PostgreSQL que ya se use para otra cosa.
--
-- =============================================================================
-- CÓMO SE EJECUTA
-- =============================================================================
-- Nunca a mano contra nada que importe. Lo aplica
-- `__tests__/budget-revision-conflict.integration.test.mjs`, y sólo DESPUÉS de
-- que todas sus guardas hayan pasado. Que lo aplique el test y no un paso suelto
-- del flujo de CI es deliberado: la parte destructiva de este banco tiene que
-- quedar DETRÁS de las guardas, no delante. Un `psql` lanzado desde el YAML
-- borraría los esquemas sin haber comprobado ni los acuses de recibo ni el host.
--
-- El contenedor sobre el que se aplica lo arranca el flujo de CI así:
--
--   docker run --detach --name enlaze-pt409-bench-db \
--     --network enlaze-pt409-bench-net \
--     --publish 127.0.0.1:55433:5432 \
--     --env POSTGRES_PASSWORD=... \
--     --env POSTGRES_DB=enlaze_revision_conflict_test \
--     postgres:17 \
--     -c enlaze.test_cluster_marker=revision_conflict_2f2
--
-- LA CONTRASEÑA DEL ROL `authenticator` NO ESTÁ ESCRITA EN ESTE FICHERO. Aparece
-- como el testigo `:'pt409_bench_authenticator_password'`, y el test lo
-- sustituye por un literal correctamente escapado antes de enviar el guion a
-- PostgreSQL. La contraseña se genera dentro de la propia ejecución de CI, se
-- pasa al test y al contenedor de PostgREST por entorno, y no se imprime nunca.
--
-- El testigo usa a propósito la sintaxis de variable de psql, de modo que el
-- fichero siga siendo aplicable también así, si algún día hiciera falta:
--
--   docker exec -i enlaze-pt409-bench-db psql -U postgres \
--     -d enlaze_revision_conflict_test -v ON_ERROR_STOP=1 \
--     -v pt409_bench_authenticator_password="$GENERADA" \
--     -f - < __tests__/support/bootstrap-budget-revision-conflict.sql
--
-- En ambos caminos, si la contraseña no se aporta el testigo se queda sin
-- sustituir y la ejecución muere con un error de sintaxis. Es lo que debe pasar:
-- fallar ruidosamente antes que arrancar con una credencial adivinable.
--
-- =============================================================================
-- REQUISITOS Y GUARDAS
-- =============================================================================
--   · La base debe llamarse exactamente `enlaze_revision_conflict_test`.
--   · PostgreSQL 17 o superior, comprobado con `server_version_num >= 170000`
--     (se usa `gen_random_uuid()` del núcleo, sin pgcrypto).
--   · El usuario de conexión debe ser SUPERUSUARIO: se crean roles y se cambia
--     la propiedad efectiva de una función SECURITY DEFINER.
--   · El clúster debe presentar `enlaze.test_cluster_marker=revision_conflict_2f2`.
--
-- Las cuatro se comprueban en el primer bloque `do` del fichero, antes de tocar
-- absolutamente nada.
--
-- Sobre esa última guarda hay que ser honesto respecto de lo que vale. Los
-- parámetros personalizados de dos partes se pueden fijar también por sesión
-- —`SET`, la opción de conexión `options`, `PGOPTIONS`—, así que un servidor
-- cualquiera puede presentarlo si alguien se lo pide. Sirve para detectar que se
-- ha apuntado por descuido a otro PostgreSQL. NO es una prueba de que el clúster
-- sea desechable y NO sustituye a los acuses de recibo explícitos que exige el
-- test. La defensa de verdad está en
-- `__tests__/budget-revision-conflict.integration.test.mjs`, que comprueba host,
-- puerto, nombre de base, superusuario, marcador y los dos acuses ANTES de leer
-- este fichero, para que una negativa nunca llegue con los esquemas ya borrados.

-- Las cuatro negativas de abajo van TODAS en el primer bloque `do`, y ese bloque
-- va antes del primer `create role`, del primer `alter role`, del primer `grant`
-- y del primer `drop schema`. Eso no es una cuestión de estilo: es la única
-- disposición en la que una negativa puede afirmar con verdad que no se ha
-- modificado nada. Si alguna de estas comprobaciones bajase por debajo de la
-- sección 1, el mensaje seguiría diciendo «no se ha modificado nada» mientras
-- los roles del clúster ya habrían cambiado.
--
-- Las dos primeras —base y versión— duplican a propósito comprobaciones que el
-- test ya hace antes de leer este fichero. La duplicación es deliberada: el
-- fichero tiene que ser seguro también por el segundo camino documentado más
-- arriba, el `psql -f`, donde no hay ningún test delante que compruebe nada.
do $guard$
begin
  if current_database() <> 'enlaze_revision_conflict_test' then
    raise exception
      'NEGATIVA: este fichero es destructivo y sólo se aplica sobre la base enlaze_revision_conflict_test. current_database() dice «%». No se ha modificado nada.',
      current_database();
  end if;

  if current_setting('server_version_num')::integer < 170000 then
    raise exception
      'NEGATIVA: el banco exige PostgreSQL 17 o superior y el servidor dice server_version_num=% (%). No se ha modificado nada.',
      current_setting('server_version_num'),
      version();
  end if;

  if coalesce(current_setting('enlaze.test_cluster_marker', true), '') <> 'revision_conflict_2f2' then
    raise exception
      'NEGATIVA: este fichero es destructivo y el clúster no presenta enlaze.test_cluster_marker=revision_conflict_2f2 (valor observado: %). No se ha modificado nada.',
      coalesce(nullif(current_setting('enlaze.test_cluster_marker', true), ''), '<sin fijar>');
  end if;

  if not exists (select 1 from pg_roles where rolname = current_user and rolsuper) then
    raise exception
      'NEGATIVA: se requiere un usuario superusuario para crear roles y una función SECURITY DEFINER. Usuario actual: %. No se ha modificado nada.',
      current_user;
  end if;
end;
$guard$;

-- =============================================================================
-- 1. ROLES DEL CLÚSTER
-- =============================================================================
-- Son los tres roles que PostgREST necesita, y ninguno más:
--
--   · `authenticator` es el ÚNICO con LOGIN. Es el rol con el que PostgREST abre
--     la conexión. Se crea `noinherit` a propósito: PostgREST cambia de rol con
--     `set local role` según el claim `role` del JWT, y si `authenticator`
--     heredase los privilegios de sus miembros los tendría siempre, incluso
--     antes del cambio de rol, que es justo lo contrario del modelo.
--   · `anon` es el rol de las peticiones sin JWT. Aquí no recibe NINGÚN
--     privilegio sobre los objetos del banco. Existe porque PostgREST exige un
--     rol anónimo configurado, y porque sin él no se podría distinguir «no tiene
--     permiso» de «el rol no existe».
--   · `authenticated` es el rol de las peticiones con JWT válido. Es el único
--     que puede leer la tabla y ejecutar la función.
--
-- Ninguno es superusuario y ninguno tiene BYPASSRLS: si los tuviera, la prueba
-- de que la RLS impide la escritura directa no probaría nada.
do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
end;
$roles$;

-- La contraseña llega como variable de psql generada en la ejecución de CI.
-- Nunca se escribe en el repositorio y nunca se imprime en los registros.
alter role authenticator with password :'pt409_bench_authenticator_password';

grant anon, authenticated to authenticator;

-- =============================================================================
-- 2. RESET DE LOS DOS ESQUEMAS
-- =============================================================================
-- Se borran enteros en lugar de usar `create ... if not exists` para que cada
-- ejecución parta de un estado idéntico y no herede la función, las
-- restricciones ni —esto es lo importante— la ACL que dejó la ejecución
-- anterior. La ACL es uno de los objetos bajo prueba: heredarla invalidaría la
-- comprobación de que `anon` no puede ejecutar la función.
drop schema if exists public cascade;
drop schema if exists auth cascade;

create schema public;
create schema auth;

grant usage on schema public to anon, authenticated, authenticator;
grant usage on schema auth  to anon, authenticated, authenticator;

-- =============================================================================
-- 3. `auth.uid()` COMPATIBLE CON LOS CLAIMS DE PostgREST
-- =============================================================================
-- En Supabase, `auth.uid()` devuelve el `sub` del JWT. PostgREST deposita los
-- claims en variables de configuración de la sesión al abrir la petición, y NO
-- lo ha hecho siempre igual:
--
--   · PostgREST >= 9 fija `request.jwt.claims` con el JSON completo de claims.
--   · PostgREST antiguo fijaba una variable por claim: `request.jwt.claim.sub`,
--     `request.jwt.claim.role`, etc.
--
-- Esta implementación lee las DOS formas, en ese orden. No es adorno: fija el
-- banco a la SEMÁNTICA del contrato y no a la versión concreta de PostgREST que
-- se haya anclado hoy en el flujo de CI, de modo que subir esa versión no
-- convierta un fallo real en un `auth.uid()` silenciosamente NULL, que haría
-- pasar por «sin permiso» lo que en realidad sería «claims en otro sitio».
--
-- Tres detalles que importan:
--   · el segundo argumento de `current_setting` es `true`, así que si la
--     variable no está fijada devuelve NULL en lugar de lanzar
--     `undefined_object`. Esa rama es la que permite probar «no hay sesión»;
--   · `nullif(..., '')` convierte la cadena vacía en NULL, porque `''::uuid`
--     fallaría con `invalid_text_representation` en vez de devolver NULL;
--   · la función es `stable`, no `immutable`: depende de la configuración de la
--     sesión, y declararla `immutable` permitiría al planificador cachear su
--     resultado entre sesiones distintas.
create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      (nullif(current_setting('request.jwt.claims', true), ''))::jsonb ->> 'sub',
      nullif(current_setting('request.jwt.claim.sub', true), '')
    ),
    ''
  )::uuid
$$;

grant execute on function auth.uid() to anon, authenticated, authenticator;

-- =============================================================================
-- 4. TABLA DE PRUEBA
-- =============================================================================
-- Modela lo mínimo que exige el enunciado del contrato: una revisión y algún
-- estado observable. Todo lo demás está para poder DEMOSTRAR la ausencia de
-- efectos, que es la parte difícil de probar:
--
--   · `revision`        — la revisión que el cliente debe traer consigo.
--   · `observable_state`— el estado que una operación válida cambia.
--   · `mutation_count`  — contador independiente. Sirve para detectar una
--                         función que incremente `revision` exactamente en uno
--                         pero haya escrito dos veces por el camino. Sin él,
--                         «se incrementó una vez» y «se escribió una vez» serían
--                         indistinguibles.
--   · `last_mutated_at` — permite afirmar que tras un conflicto no cambió NI LA
--                         FECHA. Se rellena con `clock_timestamp()` y no con
--                         `now()`: `now()` es el instante de INICIO de la
--                         transacción y sería idéntico en dos escrituras dentro
--                         de la misma transacción, con lo que no distinguiría
--                         una escritura de dos.
create table public.pt409_bench_record (
  id               uuid        primary key default gen_random_uuid(),
  owner_id         uuid        not null,
  revision         integer     not null default 1,
  observable_state text        not null default 'estado-inicial',
  mutation_count   integer     not null default 0,
  last_mutated_at  timestamptz not null default clock_timestamp(),
  constraint pt409_bench_record_revision_positiva check (revision >= 1),
  constraint pt409_bench_record_mutaciones_no_negativas check (mutation_count >= 0)
);

comment on table public.pt409_bench_record is
  'TABLA EXCLUSIVA DE PRUEBA del banco PT409. No es ninguna tabla de produccion recortada. No copiar a supabase/migrations.';

-- RLS con UNA sola política, de SELECT, y a propósito ninguna de INSERT, UPDATE
-- ni DELETE. Es una afirmación deliberada: el rol `authenticated` puede LEER lo
-- suyo y no puede escribir NADA por la vía directa de la tabla. La única puerta
-- de escritura es la función. Así, si el test observa un cambio de estado tras
-- un conflicto, no cabe la excusa de «lo escribió otra cosa».
alter table public.pt409_bench_record enable row level security;

create policy pt409_bench_record_select_propio
  on public.pt409_bench_record
  for select
  to authenticated
  using (owner_id = auth.uid());

grant select on public.pt409_bench_record to authenticated;
-- `anon` no recibe nada, ni siquiera SELECT.

-- =============================================================================
-- 5. LA FUNCIÓN BAJO PRUEBA
-- =============================================================================
-- Contrato:
--   · acepta la revisión que el cliente cree tener;
--   · si coincide con la actual, modifica el estado e incrementa la revisión
--     EXACTAMENTE UNA VEZ;
--   · si no coincide, lanza `PT409` y no modifica absolutamente nada.
--
-- La ausencia de efectos está garantizada por dos vías independientes, y conviene
-- no confundirlas:
--
--   1. ORDEN. La comprobación va ANTES de cualquier escritura. En el camino del
--      conflicto no se ejecuta ni un solo UPDATE. Esto es una propiedad del
--      código y se sostiene sola.
--   2. TRANSACCIÓN. PostgREST envuelve cada petición HTTP en UNA transacción, así
--      que una excepción no capturada la aborta entera. Esto es una propiedad de
--      la pila, no del código.
--
-- Se hacen las dos porque la segunda es justamente la que NO se puede dar por
-- supuesta al llamar por HTTP: es el hecho que el banco existe para verificar.
-- Apoyarse sólo en ella sería asumir lo que se quiere demostrar.
--
-- `select ... for update` bloquea la fila entre la lectura y la escritura. Sin
-- él, dos peticiones concurrentes podrían leer la misma revisión, las dos
-- encontrarla válida y las dos escribir: la revisión acabaría en +1 en lugar de
-- +2 y una de las dos actualizaciones se perdería en silencio. Es exactamente el
-- fallo que un control de concurrencia optimista debe impedir.
--
-- Sobre el código de error elegido: PostgREST traduce un SQLSTATE que empiece por
-- `PT` usando los tres caracteres siguientes como estado HTTP. `PT409` da 409.
-- No se usa `40001` (serialization_failure) porque su significado convenido es
-- «vuelve a intentarlo», y los clientes y proxies pueden reintentar solos, que es
-- lo contrario de lo que se quiere: aquí el cliente debe releer y decidir. No se
-- usa `23505` porque ya lo produce la restricción UNIQUE de `document_versions` en
-- producción y confundir ambos casos haría inservible el diagnóstico.
create function public.pt409_bench_apply_change(
  p_record_id         uuid,
  p_expected_revision integer,
  p_new_state         text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_caller       uuid;
  v_owner        uuid;
  v_revision     integer;
  v_new_revision integer;
  v_new_state    text;
begin
  -- SECURITY DEFINER: la función se ejecuta con los privilegios de su
  -- propietario (el superusuario que aplica este fichero), y como la RLS no está
  -- FORZADA sobre la tabla, el propietario NO pasa por las políticas. Por eso la
  -- comprobación de pertenencia de abajo es OBLIGATORIA y manual. No hay red de
  -- seguridad. Es la misma situación que en producción, y por eso se reproduce.
  v_caller := auth.uid();

  if v_caller is null then
    raise exception using
      errcode = '42501',
      message = 'PT409_BENCH: no hay sesion autenticada';
  end if;

  if p_record_id is null or p_expected_revision is null then
    raise exception using
      errcode = '22004',
      message = 'PT409_BENCH: p_record_id y p_expected_revision no pueden ser nulos';
  end if;

  if p_new_state is null or btrim(p_new_state) = '' then
    raise exception using
      errcode = '22023',
      message = 'PT409_BENCH: p_new_state debe ser una cadena no vacia';
  end if;

  select r.owner_id, r.revision
    into v_owner, v_revision
    from public.pt409_bench_record as r
   where r.id = p_record_id
     for update;

  if not found then
    raise exception using
      errcode = 'PT404',
      message = 'PT409_BENCH: el registro no existe';
  end if;

  if v_owner is distinct from v_caller then
    -- Mismo código que «no existe» habría sido más discreto, pero aquí interesa
    -- poder distinguir los tres finales en el test sin ambigüedad.
    raise exception using
      errcode = '42501',
      message = 'PT409_BENCH: el registro no pertenece al llamante';
  end if;

  if v_revision is distinct from p_expected_revision then
    raise exception using
      errcode = 'PT409',
      message = 'PT409_BENCH: conflicto de revision',
      detail  = format('revision_esperada=%s revision_actual=%s', p_expected_revision, v_revision),
      hint    = 'Relee el registro y repite la operacion sobre la revision actual. No reintentes con la misma.';
  end if;

  update public.pt409_bench_record as r
     set observable_state = p_new_state,
         revision         = r.revision + 1,
         mutation_count   = r.mutation_count + 1,
         last_mutated_at  = clock_timestamp()
   where r.id = p_record_id
  returning r.revision, r.observable_state
       into v_new_revision, v_new_state;

  return jsonb_build_object(
    'id',               p_record_id,
    'revision',         v_new_revision,
    'observable_state', v_new_state
  );
end;
$fn$;

comment on function public.pt409_bench_apply_change(uuid, integer, text) is
  'FUNCION EXCLUSIVA DE PRUEBA del banco PT409. No es la futura RPC de 2F-2 ni un borrador de ella. No copiar a supabase/migrations.';

-- ACL explícita. El `revoke ... from public` NO es redundante: al crear una
-- función, PostgreSQL concede EXECUTE al pseudo-rol PUBLIC por defecto, y sin
-- esta línea `anon` podría ejecutarla por herencia de PUBLIC y la comprobación
-- de que no puede no probaría nada.
revoke all on function public.pt409_bench_apply_change(uuid, integer, text) from public;
revoke all on function public.pt409_bench_apply_change(uuid, integer, text) from anon;
grant execute on function public.pt409_bench_apply_change(uuid, integer, text) to authenticated;

-- =============================================================================
-- 6. MUTANTES PARA LOS CONTROLES NEGATIVOS
-- =============================================================================
-- Un banco que sólo comprueba el camino correcto no demuestra nada: hay que
-- demostrar que sus afirmaciones AGARRAN, es decir, que fallarían si el
-- comportamiento se degradase. Estas tres funciones son versiones deliberadamente
-- estropeadas de la anterior. El test las llama a través de EXACTAMENTE el mismo
-- ayudante de aserciones y exige que ese ayudante falle con las dos primeras.
--
-- Existen aquí y no creadas al vuelo desde el test para que se puedan leer, y
-- para que quede constancia por escrito de qué degradación cubre cada una.

-- MUTANTE A — deja de comprobar la revisión y siempre tiene éxito.
-- Cubre: «si la función deja de lanzar PT409, el banco debe fallar».
create function public.pt409_bench_mutante_siempre_exito(
  p_record_id         uuid,
  p_expected_revision integer,
  p_new_state         text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $mut_a$
declare
  v_new_revision integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'PT409_BENCH: no hay sesion autenticada';
  end if;

  update public.pt409_bench_record as r
     set observable_state = p_new_state,
         revision         = r.revision + 1,
         mutation_count   = r.mutation_count + 1,
         last_mutated_at  = clock_timestamp()
   where r.id = p_record_id
     and r.owner_id = auth.uid()
  returning r.revision into v_new_revision;

  return jsonb_build_object('id', p_record_id, 'revision', v_new_revision);
end;
$mut_a$;

-- MUTANTE B — señala el conflicto con PT400 en vez de PT409.
-- Cubre: «si el test acepta cualquier 4xx, el banco debe fallar». Un test que
-- comprobase `status >= 400 && status < 500` pasaría con esta función, y es
-- justamente lo que no puede ocurrir: 400 significa «tu petición está mal
-- formada» y llevaría al cliente a corregir el cuerpo, cuando lo que tiene que
-- hacer es releer y reintentar sobre la revisión nueva.
create function public.pt409_bench_mutante_pt400(
  p_record_id         uuid,
  p_expected_revision integer,
  p_new_state         text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $mut_b$
declare
  v_revision integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'PT409_BENCH: no hay sesion autenticada';
  end if;

  select r.revision into v_revision
    from public.pt409_bench_record as r
   where r.id = p_record_id and r.owner_id = auth.uid()
     for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'PT409_BENCH: el registro no existe';
  end if;

  if v_revision is distinct from p_expected_revision then
    raise exception using
      errcode = 'PT400',
      message = 'PT409_BENCH(mutante): conflicto senalado con el codigo equivocado';
  end if;

  return jsonb_build_object('id', p_record_id, 'revision', v_revision);
end;
$mut_b$;

-- MUTANTE C — escribe PRIMERO y lanza PT409 DESPUÉS.
-- Esta no es un control negativo: es la evidencia positiva más fuerte del banco.
-- Comprueba la propiedad de la que depende todo el diseño de 2F-2, que PostgREST
-- envuelve cada petición HTTP en UNA transacción. Si esa propiedad se cumple, el
-- UPDATE de aquí abajo se revierte al lanzarse la excepción y el estado queda
-- intacto pese a haberse escrito. Si NO se cumpliera, este mutante dejaría el
-- registro modificado con un 409 en la mano, que es el peor de los mundos.
--
-- Conviene ver por qué esto no se puede probar «al revés». No hay forma portable
-- de hacer que una escritura SOBREVIVA a una excepción no capturada dentro de la
-- misma transacción: haría falta una transacción autónoma (dblink, pg_background)
-- que no está instalada ni debe estarlo. Por eso la afirmación «si el conflicto
-- modificase estado, fecha o revisión el banco fallaría» se demuestra en el test
-- perturbando la instantánea y exigiendo que el comparador salte, y no
-- fabricando una función imposible.
create function public.pt409_bench_mutante_escribe_y_luego_lanza(
  p_record_id         uuid,
  p_expected_revision integer,
  p_new_state         text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $mut_c$
declare
  v_revision integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'PT409_BENCH: no hay sesion autenticada';
  end if;

  select r.revision into v_revision
    from public.pt409_bench_record as r
   where r.id = p_record_id and r.owner_id = auth.uid()
     for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'PT409_BENCH: el registro no existe';
  end if;

  -- Escritura deliberada ANTES de comprobar nada.
  update public.pt409_bench_record as r
     set observable_state = p_new_state || '-ESCRITURA-QUE-DEBE-REVERTIRSE',
         revision         = r.revision + 41,
         mutation_count   = r.mutation_count + 41,
         last_mutated_at  = clock_timestamp()
   where r.id = p_record_id;

  if v_revision is distinct from p_expected_revision then
    raise exception using
      errcode = 'PT409',
      message = 'PT409_BENCH(mutante): conflicto tras haber escrito',
      detail  = format('revision_esperada=%s revision_actual=%s', p_expected_revision, v_revision);
  end if;

  return jsonb_build_object('id', p_record_id, 'revision', v_revision + 41);
end;
$mut_c$;

do $acl_mutantes$
declare
  v_firma text;
begin
  foreach v_firma in array array[
    'public.pt409_bench_mutante_siempre_exito(uuid, integer, text)',
    'public.pt409_bench_mutante_pt400(uuid, integer, text)',
    'public.pt409_bench_mutante_escribe_y_luego_lanza(uuid, integer, text)'
  ] loop
    execute format('revoke all on function %s from public', v_firma);
    execute format('revoke all on function %s from anon', v_firma);
    execute format('grant execute on function %s to authenticated', v_firma);
    execute format(
      'comment on function %s is %L',
      v_firma,
      'MUTANTE EXCLUSIVO DE PRUEBA del banco PT409. Comportamiento estropeado a proposito. No copiar a supabase/migrations.'
    );
  end loop;
end;
$acl_mutantes$;

-- =============================================================================
-- 7. AVISO A PostgREST
-- =============================================================================
-- PostgREST cachea el esquema al arrancar. Este NOTIFY le hace recargarlo.
--
-- NO ES OPCIONAL, Y ESTA LÍNEA DECÍA ANTES LO CONTRARIO. Afirmaba que el flujo
-- de CI arranca PostgREST DESPUÉS de aplicar este fichero y que por tanto la
-- ruta normal no dependía del NOTIFY. Es falso, y lo es por una razón que está
-- en el corazón del diseño: quien aplica este fichero es el test, y el test sólo
-- lo aplica después de sus guardas, así que PostgREST tiene que estar levantado
-- ya —lo arranca el flujo de CI antes— porque si no, el test no tendría contra
-- qué comprobar nada. Es decir: cuando estas sentencias se ejecutan, PostgREST
-- LLEVA RATO EN MARCHA con una caché del esquema vacío anterior, y las secciones
-- 5 y 6 acaban de borrar y recrear `public` entero bajo sus pies.
--
-- Sin este NOTIFY —y sin `PGRST_DB_CHANNEL_ENABLED=true` en el contenedor, que
-- es lo que hace que alguien escuche— PostgREST seguiría sirviendo 404 para
-- `pt409_bench_apply_change` indefinidamente, y el banco entero fallaría por una
-- caché obsoleta mientras el esquema es correcto. El test no da por hecho que
-- surta efecto: reintenta el NOTIFY y espera a ver la función publicada en el
-- documento OpenAPI antes de afirmar nada.
notify pgrst, 'reload schema';
