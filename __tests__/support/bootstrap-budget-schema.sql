-- BANCO CONDUCTUAL DE `replace_budget_items` — ESQUEMA MÍNIMO DE PRUEBA
--
-- ═════════════════════════════════════════════════════════════════════════════
-- QUÉ ES ESTE FICHERO Y QUÉ NO ES
-- ═════════════════════════════════════════════════════════════════════════════
-- Reproduce EL CONTRATO QUE NECESITA ESTA RPC, no todo Supabase ni todo el
-- esquema de producción. Contiene exclusivamente los roles, el esquema `auth`,
-- las tablas y las restricciones que `public.replace_budget_items(uuid, jsonb)`
-- lee, escribe o puede violar. Nada más.
--
-- NO reproduce todas las restricciones de producción, y no debe afirmarse que lo
-- haga: reproduce las RELEVANTES PARA ESTA RPC.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- DE DÓNDE SALEN LAS RESTRICCIONES, Y POR QUÉ NO BASTAN LAS MIGRACIONES
-- ─────────────────────────────────────────────────────────────────────────────
-- Casi todas las restricciones de abajo llevan citada la migración que las creó.
-- DOS llegaron por otro camino, y cada una por uno distinto:
--
--   · `budget_items_category_check`: confirmada en el catálogo real de producción
--     por la auditoría Q9. No se ha localizado su creación en el historial del
--     repositorio.
--   · `budget_items_unit_check`: confirmada igualmente en producción por Q9, y
--     además localizada en el repositorio, en
--     `supabase/migrations_historico/20260520_flexible_unit_check.sql`.
--
-- La lección está en cómo se encontraron, no en que faltasen. Se dio por sentado
-- que `category` no tenía restricción tras leer `supabase/migrations` y no ver
-- ninguna, y eso era un error de método por partida doble: ese directorio no es
-- el estado de la base —el repositorio guarda la historia que se escribió aquí—
-- y ni siquiera es todo el historial, porque `migrations_historico` estaba al
-- lado y contenía la segunda. Un banco construido sobre esa lectura aceptaría
-- alegremente valores que producción rechaza, que es exactamente el fallo
-- silencioso que este banco existe para evitar. La fuente que zanja la pregunta
-- es el catálogo real.
--
-- NO ES UNA MIGRACIÓN. Vive fuera de `supabase/migrations` a propósito y el
-- runner del CLI de Supabase no lo verá nunca. No debe aplicarse a ninguna base
-- que no sea la base local desechable del banco conductual.
--
-- ES DESTRUCTIVO. Empieza borrando los esquemas `public` y `auth` enteros. Sólo
-- lo ejecuta `__tests__/replace-budget-items.integration.test.mjs`, y sólo
-- después de que TODAS sus guardas hayan pasado: opt-in explícito, los DOS acuses
-- de recibo, entorno sin variables de libpq heredadas, URL con usuario y
-- contraseña explícitos, host literal 127.0.0.1, puerto 55432 y base exactamente
-- `enlaze_replace_items_test`, comprobada además contra `current_database()` ya
-- conectado, junto con superusuario y marcador de clúster. Este fichero no puede
-- defenderse solo: la defensa está en el test.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- QUÉ SE OMITE, Y POR QUÉ ESO NO FALSEA LA PRUEBA
-- ═════════════════════════════════════════════════════════════════════════════
-- `public.budgets` de producción tiene decenas de columnas (importes, IVA,
-- descuentos, calendario de pagos, wizard_state, ciclo de vida...). Aquí sólo
-- aparecen las cuatro que la RPC toca —`id`, `user_id`, `deleted_at` para el
-- `select ... for update`, y `updated_at` para poder demostrar que la cabecera
-- NO se modifica— más `title`, `status` y `created_at` para que las fixtures
-- sean legibles. La RPC no nombra ninguna otra columna de `budgets`: no las
-- lee, no las escribe y no puede depender de ellas.
--
-- `public.budget_items` de producción tiene 22 columnas. Aquí están las 17 que
-- la RPC enumera en su INSERT, más `id` y `created_at`. Las que faltan —`name`,
-- `unit_price_cost`, `subtotal_cost`— tampoco las nombra la RPC desplegada
-- `update_budget_with_items`, que lleva meses insertando en producción sin
-- ellas: si alguna fuese NOT NULL sin default, esa función ya estaría rota. Su
-- ausencia aquí no puede, por tanto, hacer pasar un INSERT que producción
-- rechazaría.
--
-- `public.canonical_concepts` aparece REDUCIDA A SU CLAVE. No se reproduce el
-- modelo canónico: se reproduce sólo lo justo para que la FOREIGN KEY
-- `budget_items_canonical_id_fkey` exista de verdad. Omitirla habría hecho que
-- el banco aceptase `canonical_id` inventados que producción rechaza.
--
-- NO se reproducen: PostgREST, el emisor de JWT de Supabase, `auth.jwt()`,
-- `auth.role()`, los triggers de `auth`, las políticas de storage, ni ninguna
-- otra RPC. La RPC bajo prueba no los invoca.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- REQUISITOS DEL CLÚSTER DESECHABLE
-- ═════════════════════════════════════════════════════════════════════════════
-- Dice «clúster» y no «base» a propósito. Este fichero no se limita a modificar
-- una base: CREA ROLES Y LES CONCEDE MEMBRESÍAS, y los roles son objetos del
-- clúster. Existen para todas las bases del servidor a la vez y sobreviven al
-- borrado de los esquemas. En consecuencia, ejecutar esto contra una base nueva
-- y vacía del PostgreSQL de trabajo NO es seguro: la base sería prescindible,
-- pero los roles que se tocan los comparten todos los demás proyectos de ese
-- servidor.
--
-- Por eso se exige un contenedor dedicado, no una base más:
--
--   docker run --rm -d --name enlaze-replace-items-test \
--     -p 127.0.0.1:55432:5432 \
--     -e POSTGRES_PASSWORD=postgres \
--     -e POSTGRES_DB=enlaze_replace_items_test \
--     postgres:17 \
--     -c enlaze.test_cluster_marker=replace_items_2f1db
--
--   until docker exec enlaze-replace-items-test \
--           pg_isready -U postgres -d enlaze_replace_items_test -q; do sleep 1; done
--
-- La base se crea con `POSTGRES_DB`, durante la inicialización de la imagen, y no
-- después con un `docker exec ... createdb`: ese paso posterior es una carrera
-- contra el arranque y falla de forma intermitente si se lanza demasiado pronto.
-- Y hay que esperar a que el servidor acepte conexiones antes de lanzar el test,
-- porque `docker run` vuelve mucho antes de que eso ocurra; de ahí el bucle con
-- `pg_isready`.
--
--   · PostgreSQL 13 o superior (se usa `gen_random_uuid()` del núcleo, sin
--     pgcrypto). La ejecución real se hará preferentemente sobre PostgreSQL 17.
--   · El contenedor recibe `-c enlaze.test_cluster_marker=replace_items_2f1db` al
--     arrancar, y el test comprueba ese marcador ya conectado y ANTES de leer
--     este fichero. Conviene saber qué vale esa comprobación: es una SEÑAL
--     SECUNDARIA, no una prueba de que el clúster sea desechable. Los parámetros
--     personalizados de dos partes como éste pueden fijarse también por sesión
--     —`SET`, la opción de conexión `options`, `PGOPTIONS`—, así que un servidor
--     cualquiera puede presentarlo si alguien se lo pide. Sirve para detectar que
--     se ha apuntado por descuido a otro PostgreSQL; no sustituye al
--     consentimiento humano de los dos acuses de recibo. El test rechaza además
--     PGOPTIONS y las demás variables de libpq, que son el camino fácil para
--     falsificarlo.
--   · La conexión debe llegar por 127.0.0.1:55432, con usuario y contraseña
--     explícitos en la URL. El 5432 está descartado por ser justo donde escucha
--     lo que no hay que tocar.
--   · El usuario de conexión debe ser SUPERUSUARIO. No basta con CREATEROLE:
--     `service_role` se crea con BYPASSRLS, y ese atributo sólo lo puede
--     conceder un superusuario. El test lo comprueba después de conectar y
--     ANTES de leer este fichero, para que la negativa no llegue con los
--     esquemas ya borrados.
--   · Dos acuses de recibo, porque son dos ámbitos de daño:
--     REPLACE_ITEMS_TEST_DB_ACK=DISPOSABLE_ONLY (la base es desechable) y
--     REPLACE_ITEMS_TEST_CLUSTER_ACK=DISPOSABLE_CLUSTER (el servidor entero lo
--     es).

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. ROLES
-- ═════════════════════════════════════════════════════════════════════════════
-- `nologin`: no son cuentas, son destinatarios de privilegios. El banco entra en
-- ellos con `set role`, nunca autenticándose.
--
-- Existen los tres porque la ACL de la RPC habla de los tres: `authenticated`
-- con EXECUTE, `anon` y `service_role` sin él. Sin los tres roles creados, la
-- prueba de ACL efectiva no podría distinguir «no tiene permiso» de «el rol no
-- existe».
do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$roles$;

-- `set role` exige ser superusuario o miembro del rol de destino. El usuario que
-- ejecuta esto ya es superusuario —lo exige `service_role ... bypassrls`— así
-- que esta concesión es redundante para él. Se conserva porque hace explícita la
-- pertenencia en el catálogo y porque documenta qué necesitaría un usuario no
-- superusuario si alguna vez se relajase el requisito.
do $membresia$
begin
  execute format('grant anon, authenticated, service_role to %I', current_user);
end;
$membresia$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. RESET DE LOS DOS ESQUEMAS
-- ═════════════════════════════════════════════════════════════════════════════
-- Se borran enteros en lugar de usar `create ... if not exists` para que cada
-- ejecución del banco parta de un estado idéntico y no herede la función, las
-- restricciones ni la ACL que dejó la ejecución anterior. La ACL es justamente
-- uno de los objetos bajo prueba: heredarla invalidaría la prueba 6.
drop schema if exists public cascade;
drop schema if exists auth cascade;

create schema public;
create schema auth;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth  to anon, authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. `auth.uid()` MÍNIMA, BASADA EN LA GUC DE SESIÓN
-- ═════════════════════════════════════════════════════════════════════════════
-- En Supabase, `auth.uid()` lee el `sub` del JWT que PostgREST deposita en la
-- GUC `request.jwt.claim.sub` (y en `request.jwt.claims`) al abrir la conexión.
-- El banco conductual no habla con PostgREST: se conecta a PostgreSQL
-- directamente, así que fija esa misma GUC con `set_config` y esta función la
-- lee. La forma del contrato —una función `auth.uid()` que devuelve `uuid` o
-- NULL— es exactamente la de producción, que es lo único de lo que depende la
-- RPC.
--
-- Los tres detalles que importan:
--   · el segundo argumento de `current_setting` es `true`, así que si la GUC no
--     está fijada devuelve NULL en vez de lanzar `undefined_object`. Esa rama es
--     la que permite probar «no hay sesión autenticada»;
--   · `nullif(..., '')` convierte la GUC vacía en NULL: `''::uuid` fallaría con
--     un error de sintaxis que la RPC no espera;
--   · `stable`, no `volatile`, como en producción.
create or replace function auth.uid()
returns uuid
language sql
stable
as $auth_uid$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$auth_uid$;

grant execute on function auth.uid() to public;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. `auth.users` REDUCIDA A SU CLAVE
-- ═════════════════════════════════════════════════════════════════════════════
-- Sólo existe para que la FOREIGN KEY de `budgets.user_id` sea real. La RPC
-- nunca lee esta tabla: compara `budgets.user_id` con `auth.uid()`.
create table auth.users (
  id uuid primary key
);

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. `public.canonical_concepts` REDUCIDA A SU CLAVE
-- ═════════════════════════════════════════════════════════════════════════════
-- Origen del contrato: 20260824095816_canonical_concepts.sql (la tabla real
-- tiene además dominio, unidad, vocabularios y auditoría).
--
-- Aquí sólo se necesita `canonical_id` porque es la única columna que referencia
-- `budget_items_canonical_id_fkey`, y esa FK sí importa: es una de las
-- restricciones que un `canonical_id` transportado por la RPC puede violar.
create table public.canonical_concepts (
  canonical_id text primary key
);

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. `public.budgets`
-- ═════════════════════════════════════════════════════════════════════════════
-- Las tres columnas del `where` de la RPC son `id`, `user_id` y `deleted_at`.
-- `deleted_at` es lo que convierte el borrado lógico en uno de los tres casos
-- que deben devolver el MISMO 42501.
--
-- `updated_at` no la toca la RPC, y precisamente por eso está aquí: la prueba 4
-- exige demostrar que la cabecera no cambia, y una columna de marca temporal es
-- la forma más sensible de detectar una escritura accidental.
create table public.budgets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null default '',
  status     text not null default 'pendiente',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Sin trigger de `updated_at`. En producción tampoco lo hay: `updated_at` la
-- escribe explícitamente `update_budget_with_items` en su UPDATE. Añadir aquí un
-- trigger que no existe allí falsearía la prueba de inmutabilidad de la
-- cabecera en la dirección cómoda.

-- ═════════════════════════════════════════════════════════════════════════════
-- 7. `public.budget_items`
-- ═════════════════════════════════════════════════════════════════════════════
-- Columnas: las 17 que enumera el INSERT de la RPC, más `id` y `created_at`.
--
-- Tipos tomados de 20260519_align_budget_items_schema.sql. `numeric(12,2)` en
-- `quantity`, `unit_price` y `subtotal` NO es un detalle cosmético: la columna
-- redondea al almacenar, así que un `subtotal` transportado con más de dos
-- decimales llegaría redondeado y la prueba de transporte no distinguiría
-- «transportado» de «recalculado». El banco usa por eso valores de dos
-- decimales en las entradas y reserva el redondeo para el caso que lo prueba.
create table public.budget_items (
  id                   uuid primary key default gen_random_uuid(),
  budget_id            uuid references public.budgets(id) on delete cascade,
  sort_order           integer not null default 0,
  concept              text,
  description          text,
  quantity             numeric(12,2) default 1,
  unit                 text default 'ud',
  category             text,
  chapter              text,
  unit_price           numeric(12,2) default 0,
  subtotal             numeric(12,2) default 0,
  canonical_id         text,
  canonical_status     text not null default 'unmatched',
  canonical_confidence numeric(3,2),
  canonical_source     text,
  canonical_origin     text,
  canonical_source_ref text,
  price_type           text,
  created_at           timestamptz default now()
);

-- ── Orden — 20260901120000_budget_items_sort_order.sql ────────────────────────
-- La UNIQUE es la restricción que obliga a la RPC a generar `sort_order` con
-- `with ordinality` en vez de leerlo del JSON. Sin ella, la prueba de orden no
-- probaría nada: un `sort_order` repetido enviado por el cliente se guardaría
-- tan campante.
alter table public.budget_items
  add constraint ck_budget_items_sort_order_non_negative check (sort_order >= 0);

alter table public.budget_items
  add constraint uq_budget_items_budget_id_sort_order unique (budget_id, sort_order);

-- ── Vocabularios de `category` y `unit` — CATÁLOGO REAL, auditoría Q9 ────────
-- PROCEDENCIA, una por una, porque no es la misma para las dos:
--
--   · `budget_items_category_check`: confirmada por el catálogo real de
--     producción en la auditoría Q9. No se ha localizado su creación en el
--     historial del repositorio. Que no se haya localizado no equivale a que no
--     esté —es una afirmación sobre lo que se ha buscado, no sobre lo que
--     existe— y por eso se enuncia así.
--
--   · `budget_items_unit_check`: confirmada por el catálogo real de producción
--     en Q9 y, además, documentada en el repositorio, en
--     `supabase/migrations_historico/20260520_flexible_unit_check.sql`, que
--     sustituye una lista anterior más estrecha por la que se transcribe abajo.
--
-- La lección de método sigue en pie y no la borra el hecho de que una de las dos
-- sí esté en el historial: el catálogo de producción es la fuente, y las
-- migraciones son un registro parcial de cómo se llegó a él. La segunda
-- restricción está en `migrations_historico`, no en `migrations`, que es
-- justamente el directorio que se inspeccionó al principio.
--
-- Se transcriben con sus nombres EXACTOS porque el nombre es lo que aparece en
-- el SQLSTATE 23514 que recibe el llamador, y una prueba que espere otro nombre
-- no estaría comprobando la misma restricción.
--
-- Importan aquí por una razón concreta: la RPC aplica `coalesce(nullif(...),
-- 'otros')` a `category` y `coalesce(nullif(...), 'ud')` a `unit`, y ambos
-- defaults son valores ADMITIDOS por estos vocabularios. Sin las restricciones
-- puestas, ese detalle no se estaría verificando: cualquier default habría
-- pasado.
alter table public.budget_items add constraint budget_items_category_check check (
  category in ('material','mano_obra','otros')
);

-- `unit` se compara normalizada —`lower(trim(...))`— y admite las variantes con
-- superíndice. La RPC no normaliza: transporta lo que recibe tras el
-- `coalesce/nullif`, así que es esta restricción, y no la función, la que decide
-- qué unidades entran.
alter table public.budget_items add constraint budget_items_unit_check check (
  unit is null or lower(trim(unit)) in (
    'm2','m²','ml','m3','m³',
    'ud','uds','pa',
    'h','jornada',
    'kg','l','lote',
    'punto','estancia',
    'sacos','rollos','cubos','kit',
    'global','partida',
    'm','tn','cm'
  )
);

-- ── Integridad referencial canónica — 20260824121231 ─────────────────────────
alter table public.budget_items
  add constraint budget_items_canonical_id_fkey
  foreign key (canonical_id) references public.canonical_concepts(canonical_id);

-- ── Vocabularios cerrados — 20260824121231 ───────────────────────────────────
-- `ck_budget_items_canonical_status` es la restricción que usa la prueba 1 para
-- provocar un fallo DESPUÉS del DELETE: la RPC valida `concept`, `quantity` y
-- `unit_price`, pero transporta `canonical_status` literalmente sin mirarlo, así
-- que un valor fuera de este vocabulario supera intacto la validación previa y
-- sólo revienta dentro del INSERT.
alter table public.budget_items add constraint ck_budget_items_canonical_status check (
  canonical_status in ('unmatched','resolved','review','ambiguous')
);

alter table public.budget_items add constraint ck_budget_items_canonical_source check (
  canonical_source is null or canonical_source in (
    'override',
    'generator',
    'exact_manual',
    'exact_curated',
    'exact_engine',
    'exact_import',
    'exact_provider',
    'synonym',
    'fingerprint'
  )
);

-- Vocabulario ampliado con 'ai' por 20260825094545_budget_items_canonical_origin_ai.sql.
alter table public.budget_items add constraint ck_budget_items_canonical_origin check (
  canonical_origin is null
  or canonical_origin in ('engine','ai','import','provider','free_text','legacy')
);

alter table public.budget_items add constraint ck_budget_items_source_ref_format check (
  canonical_source_ref is null or canonical_source_ref ~ '^[a-z0-9][a-z0-9_-]*$'
);

alter table public.budget_items add constraint ck_budget_items_price_type check (
  price_type is null
  or price_type in ('LABOR_ONLY','MATERIAL_ONLY','LABOR_AND_MATERIAL','SERVICE')
);

alter table public.budget_items add constraint ck_budget_items_confidence_range check (
  canonical_confidence is null
  or (canonical_confidence >= 0 and canonical_confidence <= 1)
);

-- ── Coherencia de estado — 20260824121231, sección 5.2 ───────────────────────
-- Copiada literalmente, `case ... else false` incluido. El `else false` es
-- intencional en origen —un CHECK que evalúa a NULL se da por SATISFECHO— y
-- reescribirlo como disyunción aquí haría que el banco aceptase combinaciones
-- que producción rechaza.
alter table public.budget_items add constraint ck_canonical_coherence check (
  case canonical_status
    when 'unmatched' then
             canonical_id         is null
         and canonical_confidence is null
         and canonical_source     is null
    when 'resolved' then
             canonical_id         is not null
         and canonical_confidence is not null
         and canonical_confidence = 1.00
         and canonical_source     is not null
         and canonical_source in ('override','generator','exact_manual','exact_curated',
                                  'exact_engine','exact_import','exact_provider')
    when 'review' then
             canonical_id         is not null
         and canonical_confidence is not null
         and canonical_confidence >= 0.50
         and canonical_confidence <  0.85
         and canonical_source     is not null
         and canonical_source in ('synonym','fingerprint')
    when 'ambiguous' then
             canonical_id         is null
         and canonical_confidence is null
         and canonical_source     is not null
         and canonical_source in ('synonym','fingerprint','exact_manual','exact_curated',
                                  'exact_engine','exact_import','exact_provider')
    else false
  end
);

-- ── Origen y fuente concreta — 20260825094545, sección 5.3 ampliada ──────────
alter table public.budget_items add constraint ck_origin_source_ref check (
  case
    when canonical_origin in ('import','provider')                then canonical_source_ref is not null
    when canonical_origin in ('engine','ai','free_text','legacy') then canonical_source_ref is null
    when canonical_origin is null                                 then canonical_source_ref is null
    else false
  end
);

-- ═════════════════════════════════════════════════════════════════════════════
-- 8. RLS Y PERMISOS MÍNIMOS
-- ═════════════════════════════════════════════════════════════════════════════
-- RLS se activa porque en producción está activa. No cambia el comportamiento de
-- la RPC —es `security definer` y su propietario es el mismo que el de las
-- tablas, así que la salta igual aquí que allí— pero dejarla apagada haría que
-- este fichero afirmase un esquema que no es el desplegado.
--
-- CAVEAT EXPLÍCITO, para que nadie deduzca de más: el banco inserta sus fixtures
-- conectado como PROPIETARIO de las tablas, y el propietario no está sujeto a
-- RLS mientras no se declare FORCE. Por tanto este fichero NO prueba las
-- políticas de RLS, y el banco tampoco lo pretende. Lo que se prueba es la ruta
-- de la RPC, que es la que RLS no gobierna.
alter table public.budgets      enable row level security;
alter table public.budget_items enable row level security;

create policy budgets_user_policy on public.budgets
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy budget_items_user_policy on public.budget_items
  for all
  using (
    budget_id in (select id from public.budgets where user_id = auth.uid())
  )
  with check (
    budget_id in (select id from public.budgets where user_id = auth.uid())
  );

-- Privilegios MÍNIMOS DEL BANCO. No son «los de producción» ni se ha comprobado
-- que coincidan con ellos: el catálogo real no se ha leído para esta cuestión, y
-- ya se ha visto (ver cabecera) que las migraciones no bastan para deducirlo. Son
-- exactamente los privilegios que este banco necesita para que sus asertos
-- signifiquen algo, y nada más.
--
-- NO SON LO QUE DEMUESTRA LA ACL, y decir lo contrario sería un error sobre cómo
-- funciona PostgreSQL. El motor comprueba el privilegio EXECUTE de la función
-- ANTES de entrar en su cuerpo: si está revocado, la llamada se rechaza sin haber
-- leído ni escrito una sola tabla, de modo que los privilegios de tabla del
-- llamante no pueden ser la causa de ese 42501 ni aunque no existieran. Y en el
-- caso de `anon` la hipótesis contraria ni siquiera se sostiene sobre los hechos
-- de este fichero: abajo no se le concede CRUD sobre nada, sólo `select` sobre
-- `canonical_concepts`.
--
-- Lo que sí demuestra la prueba 6, y con qué:
--   · `has_function_privilege(...)` para los tres roles: lo que el catálogo dice.
--   · La ausencia de entradas que empiecen por '=' en `pg_proc.proacl`: que no
--     queda la concesión implícita a PUBLIC, que PostgreSQL añade por defecto a
--     toda función nueva.
--   · La llamada real rechazada, con un mensaje que menciona la función: que el
--     motor se comporta como el catálogo promete.
--
-- Entonces, ¿por qué se conceden? Por comodidad futura, no por necesidad
-- probatoria: una tabla sin un solo `grant` obliga a que cualquier prueba nueva
-- que quiera leerla bajo `set role` empiece por añadirlos. Con la RPC actual, que
-- es `security definer` y ejecuta con los privilegios del definidor, ninguna de
-- las seis pruebas depende de ellos, y podrían borrarse sin que ninguna cambiara
-- de resultado. Tampoco se afirma que coincidan con los de producción: eso no se
-- ha auditado.
--
-- ALCANCE DE LA PRUEBA DE AUTORIZACIÓN, dicho sin adornos: este banco demuestra
-- (a) la autorización manual que la RPC hace en su cuerpo —comparar `auth.uid()`
-- contra `budgets.user_id`— y (b) la ACL de la función tal como queda en el
-- catálogo tras la migración. NO reproduce ni verifica la cadena JWT/PostgREST de
-- Supabase: no hay GoTrue emitiendo tokens, no hay PostgREST validando firmas,
-- caducidades ni `role` claims, y `auth.uid()` aquí es una función de banco que
-- lee `request.jwt.claim.sub` de `current_setting`, fijado a mano con `set local`.
-- Que un usuario real llegue a la RPC con el `sub` y el rol correctos es
-- responsabilidad de esa cadena, y queda fuera de lo que estas pruebas cubren.
grant select, insert, update, delete on public.budgets      to authenticated, service_role;
grant select, insert, update, delete on public.budget_items to authenticated, service_role;
grant select on public.canonical_concepts to anon, authenticated, service_role;
