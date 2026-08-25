-- =====================================================================================
-- FASE 2 · COMPROBACIONES POSTERIORES A CADA MIGRACIÓN
-- Diseño congelado: docs/FASE-2-CONCEPTOS-CANONICOS.md (v5, 2026-08-24)
--
-- CÓMO SE USA: se ejecuta el bloque correspondiente INMEDIATAMENTE DESPUÉS de aplicar su
-- migración, no todos al final. Si un bloque no da el resultado esperado, se para y se
-- revierte con el bloque equivalente de docs/fase2/ROLLBACK.sql antes de seguir.
--
-- Todas las consultas son de SOLO LECTURA salvo el BLOQUE 7-B, que es la batería de
-- pruebas de ck_origin_source_ref. Ese bloque escribe, pero termina en ROLLBACK y por
-- tanto no deja nada. Está marcado en su cabecera.
-- =====================================================================================


-- ─────────────────────────────────────────────────────────────────────────────────────
-- BLOQUE 1 · Tras 20260824095335_canonical_domains.sql
-- Esperado: 20 dominios, 20 chapter_code distintos, 0 dominios sin capítulo.
-- ─────────────────────────────────────────────────────────────────────────────────────
select count(*)                                   as dominios,
       count(distinct chapter_code)               as capitulos_distintos,
       count(*) filter (where chapter_code is null) as sin_capitulo
  from public.canonical_domains;
-- ESPERADO: 20 | 20 | 0

-- Paridad con VALID_CHAPTERS de lib/budget-analysis.ts:154-159.
-- Esperado: 0 filas. Cualquier fila devuelta es un capítulo que existe en código y no en
-- base de datos, o al revés.
select d.chapter_code
  from public.canonical_domains d
 where d.chapter_code not in (
   'protecciones','demoliciones','albanileria','fontaneria','electricidad',
   'impermeabilizacion','revestimientos','pavimentos','rodapie','pintura',
   'carpinteria_interior','carpinteria_exterior','sanitarios','cocina','climatizacion',
   'falsos_techos','residuos','limpieza','seguridad','otros'
 );
-- ESPERADO: 0 filas


-- ─────────────────────────────────────────────────────────────────────────────────────
-- BLOQUE 2 · Tras 20260824095816_canonical_concepts.sql
-- La tabla se crea vacía: aquí se comprueba la ESTRUCTURA, no el contenido.
-- ─────────────────────────────────────────────────────────────────────────────────────
select conname, contype
  from pg_constraint
 where conrelid = 'public.canonical_concepts'::regclass
 order by contype, conname;
-- ESPERADO, entre otras: ck_canonical_grammar, ck_canonical_parts, ck_price_type_default,
-- ck_price_type_values, ck_deprecated_needs_successor (contype 'c'); la PK sobre id y la
-- UNIQUE sobre canonical_id; y la FK a canonical_domains más la autorreferencia de
-- superseded_by (contype 'f').

select count(*) as conceptos from public.canonical_concepts;
-- ESPERADO: 0

-- La gramática rechaza lo que debe rechazar. Ninguna de estas escribe nada: todas deben
-- fallar. Se ejecutan una a una y se comprueba que TODAS dan error de CHECK.
--   insert into public.canonical_concepts (canonical_id,kind,domain,family,concept,
--     display_name_es,definition_es,default_unit,default_price_type,allowed_price_types)
--   values ('WORK.PAINT.PREP','WORK','PAINT','PREP','X','x','x','ud','LABOR_ONLY',
--           ARRAY['LABOR_ONLY']);           -- 3 segmentos -> ck_canonical_grammar
--   ... values ('work.paint.prep.surface', ...) -- minúsculas -> ck_canonical_grammar
--   ... values ('WORK.PAINT.PREP.OTRA', 'WORK','PAINT','PREP','SURFACE', ...)
--                                              -- partes descuadradas -> ck_canonical_parts


-- ─────────────────────────────────────────────────────────────────────────────────────
-- BLOQUE 3 · Tras 20260824101019_canonical_alias_sources.sql
-- La precedencia vive en datos. Aquí se lee tal cual la va a leer el resolver.
--
-- La precedencia verificada aquí es la CONGELADA en v5 §4.1 y no se rediseña:
--   manual 1 > curated 2 > engine 3 > import 4 > provider 5.
-- ─────────────────────────────────────────────────────────────────────────────────────

-- 3.1 Volcado literal de la precedencia.
select source, general_rank, source_specific, requires_source_ref, label_es
  from public.canonical_alias_sources
 order by general_rank;
-- ESPERADO exactamente:
--   manual   1 false false
--   curated  2 false false
--   engine   3 true  false
--   import   4 true  true
--   provider 5 true  true

-- 3.2 Aserción fila a fila contra los valores congelados. Devuelve una fila por
--     procedencia con veredicto OK/FALLO, más las que sobren o falten.
with esperado(source, general_rank, source_specific, requires_source_ref) as (
  values ('manual',   1::smallint, false, false),
         ('curated',  2::smallint, false, false),
         ('engine',   3::smallint, true,  false),
         ('import',   4::smallint, true,  true),
         ('provider', 5::smallint, true,  true)
)
select coalesce(e.source, r.source)                       as source,
       e.general_rank                                     as rank_esperado,
       r.general_rank                                     as rank_real,
       e.requires_source_ref                              as req_ref_esperado,
       r.requires_source_ref                              as req_ref_real,
       case
         when r.source is null then 'FALTA EN LA BASE DE DATOS'
         when e.source is null then 'SOBRA EN LA BASE DE DATOS'
         when e.general_rank        is distinct from r.general_rank        then 'FALLO: rank'
         when e.source_specific     is distinct from r.source_specific     then 'FALLO: source_specific'
         when e.requires_source_ref is distinct from r.requires_source_ref then 'FALLO: requires_source_ref'
         else 'OK'
       end                                                as veredicto
  from esperado e
  full outer join public.canonical_alias_sources r using (source)
 order by coalesce(e.general_rank, r.general_rank);
-- ESPERADO: 5 filas, todas con veredicto 'OK'

-- 3.3 Recuentos e invariantes agregadas.
select count(*)                                                  as procedencias,
       count(distinct general_rank)                              as ranks_distintos,
       count(distinct source)                                    as sources_distintas,
       min(general_rank)                                         as rank_min,
       max(general_rank)                                         as rank_max,
       count(*) filter (where requires_source_ref)               as exigen_source_ref,
       count(*) filter (where source_specific)                   as especificas,
       -- requires_source_ref debe ser true EXACTAMENTE en import y provider
       count(*) filter (where requires_source_ref
                          and source not in ('import','provider'))          as req_ref_indebido,
       count(*) filter (where not requires_source_ref
                          and source in ('import','provider'))              as req_ref_faltante
  from public.canonical_alias_sources;
-- ESPERADO: 5 | 5 | 5 | 1 | 5 | 2 | 3 | 0 | 0

-- 3.4 RLS de solo lectura.
select (select relrowsecurity from pg_class
          where oid = 'public.canonical_alias_sources'::regclass)           as rls_activada,
       (select count(*) from pg_policies where schemaname = 'public'
          and tablename = 'canonical_alias_sources')                        as politicas,
       (select count(*) from pg_policies where schemaname = 'public'
          and tablename = 'canonical_alias_sources' and cmd = 'SELECT')     as politicas_lectura,
       (select count(*) from pg_policies where schemaname = 'public'
          and tablename = 'canonical_alias_sources' and cmd <> 'SELECT')    as politicas_escritura;
-- ESPERADO: true | 1 | 1 | 0

-- 3.5 Restricciones estructurales: PK sobre source, UNIQUE sobre general_rank y los dos
--     CHECK. Sin la UNIQUE, dos procedencias podrían empatar en rank y el desempate del
--     nivel 2 dejaría de ser determinista, que es justo lo que la fase quiere evitar.
select conname, contype, pg_get_constraintdef(oid) as definicion
  from pg_constraint
 where conrelid = 'public.canonical_alias_sources'::regclass
 order by contype, conname;
-- ESPERADO: PK (source); UNIQUE (general_rank); CHECK source ~ '^[a-z_]+$';
--           CHECK general_rank > 0

-- 3.6 Pruebas negativas: ni source ni rank duplicados. Se ejecutan dentro de un bloque
--     que ABORTA SIEMPRE, así que ninguna inserción puede sobrevivir.
do $$
declare
  v_rep text := '';
  v_con text;
begin
  begin
    insert into public.canonical_alias_sources
      (source, general_rank, source_specific, requires_source_ref, label_es)
    values ('manual', 9, false, false, 'duplicado de source');
    v_rep := v_rep || E'\n  source duplicado ("manual")   -> ACEPTADO  [FALLO]';
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  source duplicado ("manual")   -> RECHAZADO por ' || v_con;
  end;

  begin
    insert into public.canonical_alias_sources
      (source, general_rank, source_specific, requires_source_ref, label_es)
    values ('otra_fuente', 3, false, false, 'duplicado de rank');
    v_rep := v_rep || E'\n  rank duplicado (3)            -> ACEPTADO  [FALLO]';
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  rank duplicado (3)            -> RECHAZADO por ' || v_con;
  end;

  begin
    insert into public.canonical_alias_sources
      (source, general_rank, source_specific, requires_source_ref, label_es)
    values ('MAYUSCULAS', 9, false, false, 'source con mayusculas');
    v_rep := v_rep || E'\n  source en mayusculas          -> ACEPTADO  [FALLO]';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  source en mayusculas          -> RECHAZADO por ' || v_con;
  end;

  begin
    insert into public.canonical_alias_sources
      (source, general_rank, source_specific, requires_source_ref, label_es)
    values ('otra_fuente', 0, false, false, 'rank cero');
    v_rep := v_rep || E'\n  rank = 0                      -> ACEPTADO  [FALLO]';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  rank = 0                      -> RECHAZADO por ' || v_con;
  end;

  raise exception 'INFORME BLOQUE 3.6 (nada persistido):%', v_rep;
end $$;
-- ESPERADO: las cuatro pruebas RECHAZADAS. El mensaje de error es el informe, provocado
--           a propósito para abortar la transacción.

-- 3.7 Confirmación de que las pruebas no dejaron rastro.
select count(*) as procedencias_tras_pruebas from public.canonical_alias_sources;
-- ESPERADO: 5


-- ─────────────────────────────────────────────────────────────────────────────────────
-- BLOQUE 4 · Tras 20260824101548_canonical_aliases.sql
-- ─────────────────────────────────────────────────────────────────────────────────────
-- 4.1 El normalizador se comporta. Es la fuente única: si esto falla, falla el matching
--     entero y el seed queda desalineado con el resolver.
select public.canonical_normalize('  Pintura   plástica  MATE (interior) ')
         as norm_1,
       public.canonical_normalize('Cinta de enmascarar y plástico protector')
         as norm_2,
       public.canonical_normalize('Tubería multicapa 16 mm')
         as norm_3,
       public.canonical_normalize('Albañilería / Fontanería—Ñ')
         as norm_4;
-- ESPERADO:
--   'pintura plastica mate interior'
--   'cinta de enmascarar y plastico protector'
--   'tuberia multicapa 16 mm'
--   'albanileria fontaneria n'

-- 4.2 alias_norm es GENERADA. Debe salir 'ALWAYS'; si sale vacío, la columna se creó
--     como columna normal y el seed podría desincronizarse.
select column_name, is_generated, generation_expression
  from information_schema.columns
 where table_schema = 'public' and table_name = 'canonical_aliases'
   and column_name = 'alias_norm';
-- ESPERADO: alias_norm | ALWAYS | ...canonical_normalize(alias_value)...

-- 4.3 Los índices únicos existen y son NULLS NOT DISTINCT. Sin eso, dos alias globales
--     idénticos (company_id NULL, source_ref NULL) NO colisionarían.
select indexname, indexdef
  from pg_indexes
 where schemaname = 'public' and tablename = 'canonical_aliases'
 order by indexname;
-- ESPERADO: uq_alias_exact y uq_alias_synonym deben contener literalmente
--           'NULLS NOT DISTINCT' en indexdef.

-- 4.4 Las cuatro políticas RLS existen y la tabla las tiene activadas.
select policyname, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public' and tablename = 'canonical_aliases'
 order by policyname;
-- ESPERADO: canonical_aliases_read / _insert_own / _update_own / _delete_own

select relrowsecurity from pg_class where oid = 'public.canonical_aliases'::regclass;
-- ESPERADO: true

-- 4.5 El normalizador debe ser IMMUTABLE. Si fuera STABLE o VOLATILE, PostgreSQL
--     RECHAZARÍA usarlo en una columna generada; que la tabla exista ya lo prueba de
--     forma indirecta, pero se comprueba explícitamente porque es la garantía de que el
--     valor almacenado no puede divergir del valor recalculado.
select p.proname,
       p.provolatile          as volatilidad,   -- i = immutable
       p.proisstrict          as estricta,
       p.proparallel          as paralelismo,   -- s = safe
       pg_get_function_identity_arguments(p.oid) as firma
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'canonical_normalize';
-- ESPERADO: canonical_normalize | i | true | s | text

-- 4.6 Inventario estructural: las dos claves foráneas y las restricciones nombradas.
select c.conname,
       c.contype,                                    -- f = FK, c = CHECK, p = PK
       pg_get_constraintdef(c.oid) as definicion
  from pg_constraint c
 where c.conrelid = 'public.canonical_aliases'::regclass
 order by c.contype, c.conname;
-- ESPERADO, entre otras:
--   f · canonical_aliases_canonical_id_fkey -> canonical_concepts(canonical_id) ON DELETE CASCADE
--   f · canonical_aliases_source_fkey       -> canonical_alias_sources(source)
--   c · ck_confidence_by_kind, ck_source_ref_presence,
--       ck_curated_is_global, ck_engine_is_global

-- 4.7 alias_norm NO es editable a mano, ni al insertar ni al actualizar, y se recalcula
--     sola cuando cambia alias_value. Aborta siempre: nada persiste.
do $$
declare
  v_rep  text := '';
  v_sql  text;
  v_norm text;
begin
  insert into public.canonical_concepts
    (canonical_id, kind, domain, family, concept,
     display_name_es, definition_es, default_unit,
     default_price_type, allowed_price_types)
  values ('MAT.PAINT.TEST.ALPHA', 'MAT', 'PAINT', 'TEST', 'ALPHA',
          'Concepto de prueba A', 'Temporal. Se revierte.', 'ud',
          'MATERIAL_ONLY', array['MATERIAL_ONLY']);

  -- Escritura directa en la columna generada, al insertar.
  begin
    insert into public.canonical_aliases
      (canonical_id, alias_kind, source, alias_value, alias_norm)
    values ('MAT.PAINT.TEST.ALPHA', 'exact', 'curated', 'Valor A', 'inyectado a mano');
    v_rep := v_rep || E'\n  INSERT escribiendo alias_norm      -> ACEPTADO  [FALLO]';
  exception when others then
    get stacked diagnostics v_sql = returned_sqlstate;
    v_rep := v_rep || E'\n  INSERT escribiendo alias_norm      -> RECHAZADO SQLSTATE ' || v_sql;
  end;

  -- Fila legítima, para poder intentar el UPDATE.
  insert into public.canonical_aliases
    (canonical_id, alias_kind, source, alias_value)
  values ('MAT.PAINT.TEST.ALPHA', 'exact', 'curated', '  Pintura   PLÁSTICA mate ');

  select alias_norm into v_norm from public.canonical_aliases
   where canonical_id = 'MAT.PAINT.TEST.ALPHA';
  v_rep := v_rep || E'\n  alias_norm calculado               -> "' || v_norm || '"';

  begin
    update public.canonical_aliases set alias_norm = 'inyectado a mano'
     where canonical_id = 'MAT.PAINT.TEST.ALPHA';
    v_rep := v_rep || E'\n  UPDATE escribiendo alias_norm      -> ACEPTADO  [FALLO]';
  exception when others then
    get stacked diagnostics v_sql = returned_sqlstate;
    v_rep := v_rep || E'\n  UPDATE escribiendo alias_norm      -> RECHAZADO SQLSTATE ' || v_sql;
  end;

  -- Al cambiar alias_value, alias_norm debe seguirlo sin intervención.
  update public.canonical_aliases set alias_value = 'Ñandú  ÁGIL/rápido'
   where canonical_id = 'MAT.PAINT.TEST.ALPHA';
  select alias_norm into v_norm from public.canonical_aliases
   where canonical_id = 'MAT.PAINT.TEST.ALPHA';
  v_rep := v_rep || E'\n  alias_norm tras UPDATE de valor    -> "' || v_norm || '"';

  raise exception 'INFORME BLOQUE 4.7 (nada persistido):%', v_rep;
end $$;
-- ESPERADO: ambas escrituras directas RECHAZADAS con SQLSTATE 428C9 (generated_always);
--           alias_norm calculado = 'pintura plastica mate';
--           alias_norm tras UPDATE = 'nandu agil rapido'.

-- 4.8 Contrato de confianza, presencia de source_ref, globalidad de curated/engine,
--     vocabularios cerrados y ambas claves foráneas. Con controles positivos: sin ellos,
--     una tabla que rechazase todo daría el mismo resultado que una tabla correcta.
do $$
declare
  v_rep text := '';
  v_con text;
  v_n   int;
  v_n2  int;
  v_cmp uuid := '11111111-1111-1111-1111-111111111111';
begin
  insert into public.canonical_concepts
    (canonical_id, kind, domain, family, concept,
     display_name_es, definition_es, default_unit,
     default_price_type, allowed_price_types)
  values ('MAT.PAINT.TEST.ALPHA', 'MAT', 'PAINT', 'TEST', 'ALPHA',
          'Concepto de prueba A', 'Temporal.', 'ud', 'MATERIAL_ONLY',
          array['MATERIAL_ONLY']);

  -- ── CONTROLES POSITIVOS ────────────────────────────────────────────────────
  begin
    insert into public.canonical_aliases
      (canonical_id, alias_kind, source, alias_value, confidence)
    values ('MAT.PAINT.TEST.ALPHA','exact','curated','P1 exacto global', 1.00);
    v_rep := v_rep || E'\n  [+] exact curated conf=1.00        -> ACEPTADO';
  exception when others then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  [+] exact curated conf=1.00        -> RECHAZADO por ' || coalesce(v_con,'?') || '  [FALLO]';
  end;

  begin
    insert into public.canonical_aliases
      (canonical_id, alias_kind, source, alias_value, confidence)
    values ('MAT.PAINT.TEST.ALPHA','synonym','curated','P2 sinonimo global', 0.70);
    v_rep := v_rep || E'\n  [+] synonym curated conf=0.70      -> ACEPTADO';
  exception when others then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  [+] synonym curated conf=0.70      -> RECHAZADO por ' || coalesce(v_con,'?') || '  [FALLO]';
  end;

  begin
    insert into public.canonical_aliases
      (canonical_id, alias_kind, source, source_ref, alias_value)
    values ('MAT.PAINT.TEST.ALPHA','exact','import','cype','P3 exacto de cype');
    v_rep := v_rep || E'\n  [+] import con source_ref          -> ACEPTADO';
  exception when others then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  [+] import con source_ref          -> RECHAZADO por ' || coalesce(v_con,'?') || '  [FALLO]';
  end;

  begin
    insert into public.canonical_aliases
      (canonical_id, alias_kind, source, company_id, alias_value)
    values ('MAT.PAINT.TEST.ALPHA','exact','manual', v_cmp,'P4 exacto de empresa');
    v_rep := v_rep || E'\n  [+] manual con company_id          -> ACEPTADO';
  exception when others then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  [+] manual con company_id          -> RECHAZADO por ' || coalesce(v_con,'?') || '  [FALLO]';
  end;

  -- ── CONFIANZA POR NATURALEZA ───────────────────────────────────────────────
  begin
    insert into public.canonical_aliases
      (canonical_id, alias_kind, source, alias_value, confidence)
    values ('MAT.PAINT.TEST.ALPHA','exact','curated','N1', 0.70);
    v_rep := v_rep || E'\n  [-] exact conf=0.70                -> ACEPTADO  [FALLO]';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  [-] exact conf=0.70                -> RECHAZADO por ' || v_con;
  end;

  begin
    insert into public.canonical_aliases
      (canonical_id, alias_kind, source, alias_value, confidence)
    values ('MAT.PAINT.TEST.ALPHA','synonym','curated','N2', 1.00);
    v_rep := v_rep || E'\n  [-] synonym conf=1.00              -> ACEPTADO  [FALLO]';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  [-] synonym conf=1.00              -> RECHAZADO por ' || v_con;
  end;

  begin
    insert into public.canonical_aliases
      (canonical_id, alias_kind, source, alias_value, confidence)
    values ('MAT.PAINT.TEST.ALPHA','synonym','curated','N3', 0.85);
    v_rep := v_rep || E'\n  [-] synonym conf=0.85 (borde)      -> ACEPTADO  [FALLO]';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  [-] synonym conf=0.85 (borde)      -> RECHAZADO por ' || v_con;
  end;

  begin
    insert into public.canonical_aliases
      (canonical_id, alias_kind, source, alias_value, confidence)
    values ('MAT.PAINT.TEST.ALPHA','synonym','curated','N4', 0.49);
    v_rep := v_rep || E'\n  [-] synonym conf=0.49              -> ACEPTADO  [FALLO]';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  [-] synonym conf=0.49              -> RECHAZADO por ' || v_con;
  end;

  -- ── PRESENCIA DE source_ref ────────────────────────────────────────────────
  begin
    insert into public.canonical_aliases
      (canonical_id, alias_kind, source, alias_value)
    values ('MAT.PAINT.TEST.ALPHA','exact','import','N5 import sin ref');
    v_rep := v_rep || E'\n  [-] import SIN source_ref          -> ACEPTADO  [FALLO]';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  [-] import SIN source_ref          -> RECHAZADO por ' || v_con;
  end;

  begin
    insert into public.canonical_aliases
      (canonical_id, alias_kind, source, alias_value)
    values ('MAT.PAINT.TEST.ALPHA','exact','provider','N6 provider sin ref');
    v_rep := v_rep || E'\n  [-] provider SIN source_ref        -> ACEPTADO  [FALLO]';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  [-] provider SIN source_ref        -> RECHAZADO por ' || v_con;
  end;

  begin
    insert into public.canonical_aliases
      (canonical_id, alias_kind, source, source_ref, company_id, alias_value)
    values ('MAT.PAINT.TEST.ALPHA','exact','manual','cype', v_cmp,'N7');
    v_rep := v_rep || E'\n  [-] manual CON source_ref          -> ACEPTADO  [FALLO]';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  [-] manual CON source_ref          -> RECHAZADO por ' || v_con;
  end;

  begin
    insert into public.canonical_aliases
      (canonical_id, alias_kind, source, source_ref, alias_value)
    values ('MAT.PAINT.TEST.ALPHA','exact','curated','cype','N8');
    v_rep := v_rep || E'\n  [-] curated CON source_ref         -> ACEPTADO  [FALLO]';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  [-] curated CON source_ref         -> RECHAZADO por ' || v_con;
  end;

  begin
    insert into public.canonical_aliases
      (canonical_id, alias_kind, source, source_ref, alias_value)
    values ('MAT.PAINT.TEST.ALPHA','exact','engine','cype','N9');
    v_rep := v_rep || E'\n  [-] engine CON source_ref          -> ACEPTADO  [FALLO]';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  [-] engine CON source_ref          -> RECHAZADO por ' || v_con;
  end;

  -- ── GLOBALIDAD OBLIGATORIA DE curated Y engine ─────────────────────────────
  begin
    insert into public.canonical_aliases
      (canonical_id, alias_kind, source, company_id, alias_value)
    values ('MAT.PAINT.TEST.ALPHA','exact','curated', v_cmp,'N10');
    v_rep := v_rep || E'\n  [-] curated CON company_id         -> ACEPTADO  [FALLO]';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  [-] curated CON company_id         -> RECHAZADO por ' || v_con;
  end;

  begin
    insert into public.canonical_aliases
      (canonical_id, alias_kind, source, company_id, alias_value)
    values ('MAT.PAINT.TEST.ALPHA','exact','engine', v_cmp,'N11');
    v_rep := v_rep || E'\n  [-] engine CON company_id          -> ACEPTADO  [FALLO]';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  [-] engine CON company_id          -> RECHAZADO por ' || v_con;
  end;

  -- ── VOCABULARIOS CERRADOS Y CLAVES FORÁNEAS ────────────────────────────────
  begin
    insert into public.canonical_aliases
      (canonical_id, alias_kind, source, alias_value)
    values ('MAT.PAINT.TEST.ALPHA','fuzzy','curated','N12');
    v_rep := v_rep || E'\n  [-] alias_kind = "fuzzy"           -> ACEPTADO  [FALLO]';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  [-] alias_kind = "fuzzy"           -> RECHAZADO por ' || v_con;
  end;

  -- N13 · una procedencia inexistente la rechaza PRIMERO ck_source_ref_presence, no la
  --       FK: el ELSE false del CASE cubre todo valor fuera de las cinco procedencias y
  --       se evalúa antes que las claves foráneas. La FK sigue existiendo (4.6) y se
  --       prueba en vivo en N17. Por eso aquí se captura la excepción de forma genérica.
  begin
    insert into public.canonical_aliases
      (canonical_id, alias_kind, source, alias_value)
    values ('MAT.PAINT.TEST.ALPHA','exact','inventada','N13');
    v_rep := v_rep || E'\n  [-] source inexistente             -> ACEPTADO  [FALLO]';
  exception when check_violation or foreign_key_violation then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  [-] source inexistente             -> RECHAZADO por ' || v_con;
  end;

  begin
    insert into public.canonical_aliases
      (canonical_id, alias_kind, source, alias_value)
    values ('MAT.PAINT.NO.EXISTE','exact','curated','N14');
    v_rep := v_rep || E'\n  [-] canonical_id inexistente       -> ACEPTADO  [FALLO]';
  exception when foreign_key_violation then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  [-] canonical_id inexistente       -> RECHAZADO por FK ' || v_con;
  end;

  begin
    insert into public.canonical_aliases
      (canonical_id, alias_kind, source, alias_value)
    values ('MAT.PAINT.TEST.ALPHA','exact','curated','    ');
    v_rep := v_rep || E'\n  [-] alias_value en blanco          -> ACEPTADO  [FALLO]';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  [-] alias_value en blanco          -> RECHAZADO por ' || coalesce(v_con,'(anonima)');
  end;

  begin
    insert into public.canonical_aliases
      (canonical_id, alias_kind, source, source_ref, alias_value)
    values ('MAT.PAINT.TEST.ALPHA','exact','import','CYPE','N16');
    v_rep := v_rep || E'\n  [-] source_ref en mayusculas       -> ACEPTADO  [FALLO]';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  [-] source_ref en mayusculas       -> RECHAZADO por ' || coalesce(v_con,'(anonima)');
  end;

  -- ── LAS DOS FK, PROBADAS DESDE EL LADO REFERENCIADO ────────────────────────
  -- N17 · borrar la procedencia 'curated' con alias vivos debe fallar: eso demuestra que
  --       la FK a canonical_alias_sources está realmente activa, no sólo declarada.
  begin
    delete from public.canonical_alias_sources where source = 'curated';
    v_rep := v_rep || E'\n  [-] borrar source referenciado     -> ACEPTADO  [FALLO]';
  exception when foreign_key_violation then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  [-] borrar source referenciado     -> RECHAZADO por FK ' || v_con;
  end;

  -- N18 · borrar el concepto debe arrastrar sus alias (ON DELETE CASCADE). Sin cascada
  --       quedarían alias huérfanos apuntando a un canonical_id que ya no existe.
  select count(*) into v_n from public.canonical_aliases
   where canonical_id = 'MAT.PAINT.TEST.ALPHA';
  delete from public.canonical_concepts where canonical_id = 'MAT.PAINT.TEST.ALPHA';
  select count(*) into v_n2 from public.canonical_aliases
   where canonical_id = 'MAT.PAINT.TEST.ALPHA';
  v_rep := v_rep || E'\n  [=] CASCADE al borrar concepto     -> ' || v_n
                 || ' alias antes, ' || v_n2 || ' despues (esperado N y 0)';

  raise exception 'INFORME BLOQUE 4.8 (nada persistido):%', v_rep;
end $$;
-- ESPERADO: los 4 controles positivos ACEPTADOS; las 16 pruebas negativas RECHAZADAS;
--           N13 rechazada por ck_source_ref_presence (el CHECK precede a la FK);
--           N17 rechazada por canonical_aliases_source_fkey;
--           N18 deja 0 alias tras borrar el concepto.

-- 4.9 Unicidad real: NULLS NOT DISTINCT, convivencia entre bancos y ambigüedad de
--     sinónimos. Es la parte que decide si el resolver puede confiar en la tabla.
do $$
declare
  v_rep text := '';
  v_con text;
  v_cmp uuid := '11111111-1111-1111-1111-111111111111';
begin
  insert into public.canonical_concepts
    (canonical_id, kind, domain, family, concept,
     display_name_es, definition_es, default_unit,
     default_price_type, allowed_price_types)
  values ('MAT.PAINT.TEST.ALPHA','MAT','PAINT','TEST','ALPHA',
          'Prueba A','Temporal.','ud','MATERIAL_ONLY', array['MATERIAL_ONLY']),
         ('MAT.PAINT.TEST.BETA','MAT','PAINT','TEST','BETA',
          'Prueba B','Temporal.','ud','MATERIAL_ONLY', array['MATERIAL_ONLY']);

  -- U1 · dos exactos globales idénticos: company_id NULL y source_ref NULL en ambos.
  --      Es EL caso que sólo cierra NULLS NOT DISTINCT.
  insert into public.canonical_aliases (canonical_id, alias_kind, source, alias_value)
  values ('MAT.PAINT.TEST.ALPHA','exact','curated','Pintura plastica mate');
  begin
    insert into public.canonical_aliases (canonical_id, alias_kind, source, alias_value)
    values ('MAT.PAINT.TEST.BETA','exact','curated','Pintura plastica mate');
    v_rep := v_rep || E'\n  U1 exacto global duplicado (NULL,NULL) -> ACEPTADO  [FALLO]';
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  U1 exacto global duplicado (NULL,NULL) -> RECHAZADO por ' || v_con;
  end;

  -- U2 · el duplicado se detecta por alias_norm, no por alias_value literal.
  begin
    insert into public.canonical_aliases (canonical_id, alias_kind, source, alias_value)
    values ('MAT.PAINT.TEST.BETA','exact','curated','  PINTURA   Plástica, MATE!! ');
    v_rep := v_rep || E'\n  U2 mismo alias tras normalizar         -> ACEPTADO  [FALLO]';
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  U2 mismo alias tras normalizar         -> RECHAZADO por ' || v_con;
  end;

  -- U3 · el mismo literal SÍ puede existir en cype y en public_bc3.
  begin
    insert into public.canonical_aliases
      (canonical_id, alias_kind, source, source_ref, alias_value)
    values ('MAT.PAINT.TEST.ALPHA','exact','import','cype','Tuberia multicapa 16 mm'),
           ('MAT.PAINT.TEST.BETA','exact','import','public_bc3','Tuberia multicapa 16 mm');
    v_rep := v_rep || E'\n  U3 mismo alias en cype y public_bc3    -> ACEPTADO';
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  U3 mismo alias en cype y public_bc3    -> RECHAZADO por ' || v_con || '  [FALLO]';
  end;

  -- U4 · un sinónimo ambiguo debe poder apuntar a dos conceptos distintos.
  begin
    insert into public.canonical_aliases
      (canonical_id, alias_kind, source, alias_value, confidence)
    values ('MAT.PAINT.TEST.ALPHA','synonym','curated','Cinta y plastico', 0.70),
           ('MAT.PAINT.TEST.BETA', 'synonym','curated','Cinta y plastico', 0.70);
    v_rep := v_rep || E'\n  U4 sinonimo hacia dos conceptos        -> ACEPTADO';
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  U4 sinonimo hacia dos conceptos        -> RECHAZADO por ' || v_con || '  [FALLO]';
  end;

  -- U5 · pero el mismo sinónimo hacia el MISMO concepto es ruido y se rechaza.
  begin
    insert into public.canonical_aliases
      (canonical_id, alias_kind, source, alias_value, confidence)
    values ('MAT.PAINT.TEST.ALPHA','synonym','curated','Cinta y plastico', 0.70);
    v_rep := v_rep || E'\n  U5 sinonimo repetido, mismo concepto   -> ACEPTADO  [FALLO]';
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  U5 sinonimo repetido, mismo concepto   -> RECHAZADO por ' || v_con;
  end;

  -- U6 · el alias privado de una empresa no colisiona con el global homónimo.
  begin
    insert into public.canonical_aliases
      (canonical_id, alias_kind, source, company_id, alias_value)
    values ('MAT.PAINT.TEST.ALPHA','exact','manual', v_cmp,'Pintura plastica mate');
    v_rep := v_rep || E'\n  U6 mismo alias, global vs empresa      -> ACEPTADO';
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  U6 mismo alias, global vs empresa      -> RECHAZADO por ' || v_con || '  [FALLO]';
  end;

  raise exception 'INFORME BLOQUE 4.9 (nada persistido):%', v_rep;
end $$;
-- ESPERADO: U1, U2 y U5 RECHAZADOS; U3, U4 y U6 ACEPTADOS.

-- 4.10 Matriz RLS multiempresa. Se ejecuta cambiando de rol a 'authenticated' y
--      simulando el JWT, dentro del mismo bloque que aborta. El sembrado previo se hace
--      como propietario, que es exactamente lo que hará una migración real.
do $$
declare
  v_rep text := '';
  v_sql text;
  v_n   int;
  v_a   uuid := '11111111-1111-1111-1111-111111111111';
  v_b   uuid := '22222222-2222-2222-2222-222222222222';
begin
  insert into public.canonical_concepts
    (canonical_id, kind, domain, family, concept,
     display_name_es, definition_es, default_unit,
     default_price_type, allowed_price_types)
  values ('MAT.PAINT.TEST.ALPHA','MAT','PAINT','TEST','ALPHA',
          'Prueba A','Temporal.','ud','MATERIAL_ONLY', array['MATERIAL_ONLY']);

  insert into public.canonical_aliases
    (canonical_id, alias_kind, source, company_id, alias_value)
  values ('MAT.PAINT.TEST.ALPHA','exact','curated', null, 'Global curado'),
         ('MAT.PAINT.TEST.ALPHA','exact','manual',  v_a,  'Privado de A'),
         ('MAT.PAINT.TEST.ALPHA','exact','manual',  v_b,  'Privado de B');

  -- ── Sesión de la empresa A ─────────────────────────────────────────────────
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_a, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  v_rep := v_rep || E'\n  rol efectivo = ' || current_user
                 || ' · auth.uid() = ' || coalesce(auth.uid()::text,'NULL');

  select count(*) into v_n from public.canonical_aliases;
  v_rep := v_rep || E'\n  A ve en total                      -> ' || v_n || ' (esperado 2)';

  select count(*) into v_n from public.canonical_aliases where company_id = v_b;
  v_rep := v_rep || E'\n  A ve alias de B                    -> ' || v_n || ' (esperado 0)';

  select count(*) into v_n from public.canonical_aliases where company_id is null;
  v_rep := v_rep || E'\n  A ve alias globales                -> ' || v_n || ' (esperado 1)';

  begin
    insert into public.canonical_aliases
      (canonical_id, alias_kind, source, company_id, alias_value)
    values ('MAT.PAINT.TEST.ALPHA','exact','manual', v_a, 'Nuevo propio de A');
    v_rep := v_rep || E'\n  [+] A inserta manual propio        -> ACEPTADO';
  exception when others then
    get stacked diagnostics v_sql = returned_sqlstate;
    v_rep := v_rep || E'\n  [+] A inserta manual propio        -> RECHAZADO ' || v_sql || '  [FALLO]';
  end;

  begin
    insert into public.canonical_aliases
      (canonical_id, alias_kind, source, company_id, alias_value)
    values ('MAT.PAINT.TEST.ALPHA','exact','manual', v_b, 'A suplantando a B');
    v_rep := v_rep || E'\n  [-] A inserta para B               -> ACEPTADO  [FALLO]';
  exception when others then
    get stacked diagnostics v_sql = returned_sqlstate;
    v_rep := v_rep || E'\n  [-] A inserta para B               -> RECHAZADO ' || v_sql;
  end;

  -- source='import' con company_id propio: todos los CHECK se cumplen, así que si esto
  -- se rechaza es la RLS y sólo la RLS.
  begin
    insert into public.canonical_aliases
      (canonical_id, alias_kind, source, source_ref, company_id, alias_value)
    values ('MAT.PAINT.TEST.ALPHA','exact','import','cype', v_a, 'A fingiendo import');
    v_rep := v_rep || E'\n  [-] A inserta source=import        -> ACEPTADO  [FALLO]';
  exception when others then
    get stacked diagnostics v_sql = returned_sqlstate;
    v_rep := v_rep || E'\n  [-] A inserta source=import        -> RECHAZADO ' || v_sql;
  end;

  begin
    insert into public.canonical_aliases
      (canonical_id, alias_kind, source, company_id, alias_value)
    values ('MAT.PAINT.TEST.ALPHA','exact','engine', null, 'A fingiendo engine');
    v_rep := v_rep || E'\n  [-] A inserta source=engine        -> ACEPTADO  [FALLO]';
  exception when others then
    get stacked diagnostics v_sql = returned_sqlstate;
    v_rep := v_rep || E'\n  [-] A inserta source=engine        -> RECHAZADO ' || v_sql;
  end;

  begin
    insert into public.canonical_aliases
      (canonical_id, alias_kind, source, company_id, alias_value)
    values ('MAT.PAINT.TEST.ALPHA','exact','curated', null, 'A fingiendo curated');
    v_rep := v_rep || E'\n  [-] A inserta source=curated       -> ACEPTADO  [FALLO]';
  exception when others then
    get stacked diagnostics v_sql = returned_sqlstate;
    v_rep := v_rep || E'\n  [-] A inserta source=curated       -> RECHAZADO ' || v_sql;
  end;

  update public.canonical_aliases set alias_value = 'Editado por A'
   where alias_value = 'Privado de A';
  get diagnostics v_n = row_count;
  v_rep := v_rep || E'\n  A actualiza su propio alias        -> ' || v_n || ' fila(s) (esperado 1)';

  update public.canonical_aliases set alias_value = 'Editado por A'
   where company_id = v_b;
  get diagnostics v_n = row_count;
  v_rep := v_rep || E'\n  A actualiza alias de B             -> ' || v_n || ' fila(s) (esperado 0)';

  update public.canonical_aliases set alias_value = 'Editado por A'
   where company_id is null;
  get diagnostics v_n = row_count;
  v_rep := v_rep || E'\n  A actualiza alias global           -> ' || v_n || ' fila(s) (esperado 0)';

  delete from public.canonical_aliases where company_id = v_b;
  get diagnostics v_n = row_count;
  v_rep := v_rep || E'\n  A borra alias de B                 -> ' || v_n || ' fila(s) (esperado 0)';

  delete from public.canonical_aliases where company_id is null;
  get diagnostics v_n = row_count;
  v_rep := v_rep || E'\n  A borra alias global               -> ' || v_n || ' fila(s) (esperado 0)';

  delete from public.canonical_aliases where alias_value = 'Editado por A';
  get diagnostics v_n = row_count;
  v_rep := v_rep || E'\n  A borra su propio alias            -> ' || v_n || ' fila(s) (esperado 1)';

  -- ── Sesión de la empresa B ─────────────────────────────────────────────────
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_b, 'role','authenticated')::text, true);
  select count(*) into v_n from public.canonical_aliases;
  v_rep := v_rep || E'\n  B ve en total                      -> ' || v_n || ' (esperado 2)';

  select count(*) into v_n from public.canonical_aliases where company_id = v_a;
  v_rep := v_rep || E'\n  B ve alias de A                    -> ' || v_n || ' (esperado 0)';

  raise exception 'INFORME BLOQUE 4.10 (nada persistido):%', v_rep;
end $$;
-- ESPERADO: A ve 2 (1 global + 1 propio) y 0 de B; sólo el INSERT manual propio pasa;
--           los tres INSERT ajenos o de procedencia no permitida se rechazan con 42501;
--           las escrituras sobre filas ajenas o globales afectan a 0 filas;
--           B ve 2 (1 global + 1 propio) y 0 de A.

-- 4.11 Recuentos tras las pruebas. Todas las transacciones anteriores han abortado, así
--      que el registro canónico debe seguir exactamente como lo dejaron las migraciones.
select (select count(*) from public.canonical_domains)       as dominios,
       (select count(*) from public.canonical_concepts)      as conceptos,
       (select count(*) from public.canonical_alias_sources) as procedencias,
       (select count(*) from public.canonical_aliases)       as alias;
-- ESPERADO: 20 | 0 | 5 | 0


-- ─────────────────────────────────────────────────────────────────────────────────────
-- BLOQUE 5 · Tras 20260824112605_canonical_relations.sql
-- ─────────────────────────────────────────────────────────────────────────────────────
-- 5.1 La tabla nace vacía. El seed llega en la migración siguiente.
select count(*) as relaciones from public.canonical_concept_relations;
-- ESPERADO: 0

-- 5.2 Restricciones: ambas FK con ON DELETE CASCADE, el UNIQUE de tres columnas, el
--     CHECK de autorrelación y el vocabulario cerrado de relation_type.
select c.conname,
       c.contype,                                    -- f = FK, u = UNIQUE, c = CHECK
       pg_get_constraintdef(c.oid) as definicion
  from pg_constraint c
 where c.conrelid = 'public.canonical_concept_relations'::regclass
 order by c.contype, c.conname;
-- ESPERADO:
--   c · canonical_concept_relations_relation_type_check
--       -> relation_type IN ('includes','provides','variant_of')
--   c · ck_no_self  -> from_canonical <> to_canonical
--   f · from_canonical -> canonical_concepts(canonical_id) ON DELETE CASCADE
--   f · to_canonical   -> canonical_concepts(canonical_id) ON DELETE CASCADE
--   u · uq_relation UNIQUE (from_canonical, to_canonical, relation_type)

-- 5.3 El índice sobre to_canonical. Sin él, "¿quién absorbe a este concepto?" —la
--     pregunta que hace el detector de doble imputación— recorre la tabla entera.
select indexname, indexdef
  from pg_indexes
 where schemaname = 'public' and tablename = 'canonical_concept_relations'
 order by indexname;
-- ESPERADO: idx_relation_to sobre (to_canonical), más el índice del PK y el del UNIQUE.

-- 5.4 RLS activada, una sola policy de lectura, cero policies de escritura.
select relrowsecurity from pg_class
 where oid = 'public.canonical_concept_relations'::regclass;
-- ESPERADO: true

select policyname, cmd, roles::text, qual, with_check
  from pg_policies
 where schemaname = 'public' and tablename = 'canonical_concept_relations'
 order by policyname;
-- ESPERADO: exactamente una fila -> canonical_relations_read | SELECT | {authenticated}
--           | true | NULL.  Ninguna policy de INSERT, UPDATE ni DELETE: las relaciones
--           sólo se escriben por migración, igual que el resto del registro canónico.

-- 5.5 Batería de relaciones. Los conceptos son temporales y viven dentro de la misma
--     transacción, que aborta siempre: canonical_concepts sigue vacío al terminar.
do $$
declare
  v_rep text := '';
  v_con text;
  v_n   int;
  v_n2  int;
begin
  insert into public.canonical_concepts
    (canonical_id, kind, domain, family, concept, display_name_es, definition_es,
     default_unit, default_price_type, allowed_price_types)
  values ('WORK.WASTE.TEST.HAUL','WORK','WASTE','TEST','HAUL','Prueba W','Temporal.','ud',
          'LABOR_AND_MATERIAL', array['LABOR_AND_MATERIAL']),
         ('SRV.WASTE.TEST.HAUL','SRV','WASTE','TEST','HAUL','Prueba S','Temporal.','ud',
          'SERVICE', array['SERVICE']),
         ('MAT.WASTE.TEST.BAG','MAT','WASTE','TEST','BAG','Prueba M','Temporal.','ud',
          'MATERIAL_ONLY', array['MATERIAL_ONLY']);

  -- ── LOS TRES TIPOS VÁLIDOS ─────────────────────────────────────────────────
  begin
    insert into public.canonical_concept_relations (from_canonical, to_canonical, relation_type)
    values ('WORK.WASTE.TEST.HAUL','MAT.WASTE.TEST.BAG','includes');
    v_rep := v_rep || E'\n  [+] includes valida               -> ACEPTADA';
  exception when others then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  [+] includes valida               -> RECHAZADA por ' || coalesce(v_con,'?') || '  [FALLO]';
  end;

  begin
    insert into public.canonical_concept_relations (from_canonical, to_canonical, relation_type)
    values ('SRV.WASTE.TEST.HAUL','WORK.WASTE.TEST.HAUL','provides');
    v_rep := v_rep || E'\n  [+] provides valida               -> ACEPTADA';
  exception when others then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  [+] provides valida               -> RECHAZADA por ' || coalesce(v_con,'?') || '  [FALLO]';
  end;

  begin
    insert into public.canonical_concept_relations (from_canonical, to_canonical, relation_type)
    values ('MAT.WASTE.TEST.BAG','SRV.WASTE.TEST.HAUL','variant_of');
    v_rep := v_rep || E'\n  [+] variant_of valida             -> ACEPTADA';
  exception when others then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  [+] variant_of valida             -> RECHAZADA por ' || coalesce(v_con,'?') || '  [FALLO]';
  end;

  -- ── EL MISMO PAR CON OTRO TIPO SÍ CONVIVE ──────────────────────────────────
  -- uq_relation incluye relation_type, así que A->B puede ser a la vez 'includes' y
  -- 'variant_of'. Es deliberado: son afirmaciones distintas sobre el mismo par.
  begin
    insert into public.canonical_concept_relations (from_canonical, to_canonical, relation_type)
    values ('WORK.WASTE.TEST.HAUL','MAT.WASTE.TEST.BAG','variant_of');
    v_rep := v_rep || E'\n  [+] mismo par, otro tipo          -> ACEPTADA';
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  [+] mismo par, otro tipo          -> RECHAZADA por ' || v_con || '  [FALLO]';
  end;

  -- ── NEGATIVAS ──────────────────────────────────────────────────────────────
  begin
    insert into public.canonical_concept_relations (from_canonical, to_canonical, relation_type)
    values ('WORK.WASTE.TEST.HAUL','SRV.WASTE.TEST.HAUL','excludes');
    v_rep := v_rep || E'\n  [-] relation_type inventado       -> ACEPTADA  [FALLO]';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  [-] relation_type inventado       -> RECHAZADA por ' || v_con;
  end;

  begin
    insert into public.canonical_concept_relations (from_canonical, to_canonical, relation_type)
    values ('WORK.WASTE.TEST.HAUL','WORK.WASTE.TEST.HAUL','includes');
    v_rep := v_rep || E'\n  [-] autorrelacion A -> A          -> ACEPTADA  [FALLO]';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  [-] autorrelacion A -> A          -> RECHAZADA por ' || v_con;
  end;

  begin
    insert into public.canonical_concept_relations (from_canonical, to_canonical, relation_type)
    values ('WORK.WASTE.TEST.HAUL','MAT.WASTE.TEST.BAG','includes');
    v_rep := v_rep || E'\n  [-] relacion duplicada            -> ACEPTADA  [FALLO]';
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  [-] relacion duplicada            -> RECHAZADA por ' || v_con;
  end;

  begin
    insert into public.canonical_concept_relations (from_canonical, to_canonical, relation_type)
    values ('WORK.WASTE.NO.EXISTE','MAT.WASTE.TEST.BAG','includes');
    v_rep := v_rep || E'\n  [-] from_canonical inexistente    -> ACEPTADA  [FALLO]';
  exception when foreign_key_violation then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  [-] from_canonical inexistente    -> RECHAZADA por FK ' || v_con;
  end;

  begin
    insert into public.canonical_concept_relations (from_canonical, to_canonical, relation_type)
    values ('WORK.WASTE.TEST.HAUL','MAT.WASTE.NO.EXISTE','includes');
    v_rep := v_rep || E'\n  [-] to_canonical inexistente      -> ACEPTADA  [FALLO]';
  exception when foreign_key_violation then
    get stacked diagnostics v_con = constraint_name;
    v_rep := v_rep || E'\n  [-] to_canonical inexistente      -> RECHAZADA por FK ' || v_con;
  end;

  -- ── CASCADE POR AMBOS LADOS ────────────────────────────────────────────────
  -- MAT.WASTE.TEST.BAG aparece como to_canonical en dos relaciones y como
  -- from_canonical en una: borrarlo debe llevarse las tres.
  select count(*) into v_n from public.canonical_concept_relations;
  delete from public.canonical_concepts where canonical_id = 'MAT.WASTE.TEST.BAG';
  select count(*) into v_n2 from public.canonical_concept_relations;
  v_rep := v_rep || E'\n  [=] CASCADE al borrar concepto    -> ' || v_n
                 || ' relaciones antes, ' || v_n2 || ' despues';

  raise exception 'INFORME BLOQUE 5.5 (nada persistido):%', v_rep;
end $$;
-- ESPERADO: los 4 casos positivos ACEPTADOS, los 5 negativos RECHAZADOS, y el CASCADE
--           dejando 4 -> 1 (sobrevive sólo SRV -> WORK 'provides', la única que no
--           menciona el concepto borrado).

-- 5.6 Confirmación de que las pruebas no dejaron rastro en ninguna de las cinco tablas.
select (select count(*) from public.canonical_domains)            as dominios,
       (select count(*) from public.canonical_concepts)           as conceptos,
       (select count(*) from public.canonical_alias_sources)      as procedencias,
       (select count(*) from public.canonical_aliases)            as alias,
       (select count(*) from public.canonical_concept_relations)  as relaciones;
-- ESPERADO: 20 | 0 | 5 | 0 | 0


-- ─────────────────────────────────────────────────────────────────────────────────────
-- BLOQUE 6 · Tras 20260824115621_canonical_seed_paint_waste.sql
-- Esta es la migración con contenido real. Sus comprobaciones son las más importantes.
-- ─────────────────────────────────────────────────────────────────────────────────────
-- 6.0 Recuento global de las tres tablas del seed.
select (select count(*) from public.canonical_concepts)          as conceptos,
       (select count(*) from public.canonical_aliases)           as alias,
       (select count(*) from public.canonical_concept_relations) as relaciones;
-- ESPERADO: 20 | 37 | 12

-- 6.1 Recuento por tipo.
select kind, count(*) from public.canonical_concepts group by kind order by kind;
-- ESPERADO: MAT 8 | SRV 2 | WORK 10   (total 20)

-- 6.2 Recuento de alias por procedencia y naturaleza.
select source, alias_kind, count(*)
  from public.canonical_aliases
 group by source, alias_kind
 order by source, alias_kind;
-- ESPERADO: curated exact 6 | engine exact 20 | curated synonym 11

-- 6.3 Ningún alias 'engine' ni 'curated' puede ser privado de una empresa.
select count(*) as alias_globales_violados
  from public.canonical_aliases
 where source in ('engine','curated') and company_id is not null;
-- ESPERADO: 0

-- 6.4 El contrato de confianza se cumple en todas las filas.
select count(*) as confianza_violada
  from public.canonical_aliases
 where (alias_kind = 'exact'   and confidence <> 1.00)
    or (alias_kind = 'synonym' and (confidence < 0.50 or confidence >= 0.85));
-- ESPERADO: 0

-- 6.5 La franja [0.85, 1.00) debe quedar VACÍA por diseño. Era la que permitía al
--     resolver construir un estado que budget_items rechazaría.
select count(*) as en_franja_prohibida
  from public.canonical_aliases
 where confidence >= 0.85 and confidence < 1.00;
-- ESPERADO: 0

-- 6.6 La ambigüedad deliberada está representada. Es el caso real que motivó permitir
--     sinónimos ambiguos: 0,37 € (cinta) frente a 38,40 € (plástico) en producción.
select a.alias_value, a.canonical_id, a.confidence
  from public.canonical_aliases a
 where a.alias_norm = public.canonical_normalize('Cinta de enmascarar y plastico protector')
 order by a.canonical_id;
-- ESPERADO: 2 filas -> MAT.PAINT.MASKING.FILM y MAT.PAINT.MASKING.TAPE, ambas 0.70

-- 6.7 Ningún alias exacto es ambiguo. Si esto devuelve filas, la promesa de "exact
--     resuelve automáticamente con confianza 1.00" es falsa.
select company_id, source, source_ref, alias_norm, count(distinct canonical_id) as n
  from public.canonical_aliases
 where alias_kind = 'exact'
 group by 1,2,3,4
having count(distinct canonical_id) > 1;
-- ESPERADO: 0 filas

-- 6.8 Las relaciones del seed.
select relation_type, count(*)
  from public.canonical_concept_relations
 group by relation_type order by relation_type;
-- ESPERADO: includes 8 | provides 2 | variant_of 2   (total 12)

-- 6.9 Ninguna relación apunta a un concepto inexistente ni a sí misma.
select count(*) as relaciones_rotas
  from public.canonical_concept_relations r
 where r.from_canonical = r.to_canonical
    or not exists (select 1 from public.canonical_concepts c
                    where c.canonical_id = r.from_canonical)
    or not exists (select 1 from public.canonical_concepts c
                    where c.canonical_id = r.to_canonical);
-- ESPERADO: 0

-- 6.10 El puente WORK <-> SRV del contenedor existe. Es lo que permite ver que
--      290 × 1,20 = 348 es el MISMO hecho físico a los dos lados del margen.
select from_canonical, relation_type, to_canonical
  from public.canonical_concept_relations
 where relation_type = 'provides';
-- ESPERADO: SRV.WASTE.CONTAINER.HAUL -> WORK.WASTE.CONTAINER.HAUL
--            y su variante 6M3

-- 6.11 Los 20 canonical_id esperados, sin extras ni faltantes. La lista es la del seed.
with esperados(canonical_id) as (values
  ('WORK.PAINT.PREP.MASKING'),('WORK.PAINT.PREP.SURFACE'),('WORK.PAINT.PRIMER.APPLY'),
  ('WORK.PAINT.EMULSION.WALL.2COATS'),('WORK.PAINT.EMULSION.CEILING.2COATS'),
  ('MAT.PAINT.EMULSION.INTERIOR_MATT'),('MAT.PAINT.PRIMER.ACRYLIC'),('MAT.PAINT.FILLER.POWDER'),
  ('MAT.PAINT.MASKING.TAPE'),('MAT.PAINT.MASKING.FILM'),('MAT.PAINT.TOOL.ROLLER'),
  ('MAT.PAINT.TOOL.BRUSH'),('MAT.PAINT.TOOL.TRAY'),
  ('WORK.WASTE.MANAGEMENT.FULL'),('WORK.WASTE.CONTAINER.HAUL'),('WORK.WASTE.CONTAINER.HAUL.6M3'),
  ('WORK.WASTE.FEE.DISPOSAL'),('SRV.WASTE.CONTAINER.HAUL'),('SRV.WASTE.CONTAINER.HAUL.6M3'),
  ('WORK.PROTECT.SITE.COVERING'))
select
  (select count(*) from esperados e
    where not exists (select 1 from public.canonical_concepts c
                       where c.canonical_id = e.canonical_id)) as faltantes,
  (select count(*) from public.canonical_concepts c
    where not exists (select 1 from esperados e
                       where e.canonical_id = c.canonical_id)) as extras;
-- ESPERADO: 0 | 0

-- 6.12 Los dos alias nuevos de protección existen EXACTAMENTE una vez cada uno.
select alias_value, count(*) as n
  from public.canonical_aliases
 where canonical_id = 'WORK.PROTECT.SITE.COVERING'
   and source = 'engine' and alias_kind = 'exact'
 group by alias_value order by alias_value;
-- ESPERADO: 2 filas -> 'Implantación y protecciones de obra' 1
--                      'Protección de elementos que se conservan' 1

-- 6.13 SRV.WASTE.CONTAINER.HAUL sigue siendo estructural: 0 alias, por decisión explícita.
select count(*) as alias_de_srv_haul
  from public.canonical_aliases
 where canonical_id = 'SRV.WASTE.CONTAINER.HAUL';
-- ESPERADO: 0

-- 6.14 La unidad canónica del agregado de residuos refleja el emisor real (:611 usa 'ud').
select canonical_id, default_unit, default_price_type
  from public.canonical_concepts
 where canonical_id = 'WORK.WASTE.MANAGEMENT.FULL';
-- ESPERADO: ud | LABOR_AND_MATERIAL

-- 6.15 Las 12 relaciones esperadas, sin extras ni faltantes.
with esperadas(f, t, tipo) as (values
  ('SRV.WASTE.CONTAINER.HAUL.6M3','WORK.WASTE.CONTAINER.HAUL.6M3','provides'),
  ('SRV.WASTE.CONTAINER.HAUL','WORK.WASTE.CONTAINER.HAUL','provides'),
  ('WORK.WASTE.CONTAINER.HAUL.6M3','WORK.WASTE.CONTAINER.HAUL','variant_of'),
  ('SRV.WASTE.CONTAINER.HAUL.6M3','SRV.WASTE.CONTAINER.HAUL','variant_of'),
  ('WORK.WASTE.MANAGEMENT.FULL','WORK.WASTE.CONTAINER.HAUL','includes'),
  ('WORK.WASTE.MANAGEMENT.FULL','WORK.WASTE.FEE.DISPOSAL','includes'),
  ('WORK.PAINT.EMULSION.WALL.2COATS','MAT.PAINT.EMULSION.INTERIOR_MATT','includes'),
  ('WORK.PAINT.EMULSION.CEILING.2COATS','MAT.PAINT.EMULSION.INTERIOR_MATT','includes'),
  ('WORK.PAINT.PRIMER.APPLY','MAT.PAINT.PRIMER.ACRYLIC','includes'),
  ('WORK.PAINT.PREP.SURFACE','MAT.PAINT.FILLER.POWDER','includes'),
  ('WORK.PAINT.PREP.MASKING','MAT.PAINT.MASKING.TAPE','includes'),
  ('WORK.PAINT.PREP.MASKING','MAT.PAINT.MASKING.FILM','includes'))
select
  (select count(*) from esperadas e
    where not exists (select 1 from public.canonical_concept_relations r
                       where r.from_canonical = e.f and r.to_canonical = e.t
                         and r.relation_type = e.tipo))              as faltantes,
  (select count(*) from public.canonical_concept_relations r
    where not exists (select 1 from esperadas e
                       where e.f = r.from_canonical and e.t = r.to_canonical
                         and e.tipo = r.relation_type))              as extras;
-- ESPERADO: 0 | 0

-- 6.16 Las 6 relaciones 'includes' de pintura, listadas.
select from_canonical, to_canonical
  from public.canonical_concept_relations
 where relation_type = 'includes' and from_canonical like 'WORK.PAINT.%'
 order by from_canonical, to_canonical;
-- ESPERADO: 6 filas

-- 6.17 Las 6 relaciones de residuos: 2 includes + 2 provides + 2 variant_of.
select relation_type, from_canonical, to_canonical
  from public.canonical_concept_relations
 where from_canonical like '%.WASTE.%'
 order by relation_type, from_canonical;
-- ESPERADO: 6 filas

-- 6.18 IDEMPOTENCIA. Reejecuta los INSERT del seed dentro de una transacción que SIEMPRE
--      termina en ROLLBACK. No re-registra la migración: solo prueba que 'on conflict do
--      nothing' absorbe la segunda pasada sin insertar ni una fila.
--      El DO lanza excepción a propósito: aborta la transacción y nada persiste.
do $$
declare
  v_c0 int; v_a0 int; v_r0 int;
  v_c1 int; v_a1 int; v_r1 int;
begin
  select count(*) into v_c0 from public.canonical_concepts;
  select count(*) into v_a0 from public.canonical_aliases;
  select count(*) into v_r0 from public.canonical_concept_relations;

  insert into public.canonical_concepts
    (canonical_id, kind, domain, family, concept, variant,
     display_name_es, definition_es, default_unit, default_price_type, allowed_price_types)
  select canonical_id, kind, domain, family, concept, variant,
         display_name_es, definition_es, default_unit, default_price_type, allowed_price_types
    from public.canonical_concepts
  on conflict (canonical_id) do nothing;

  insert into public.canonical_aliases
    (canonical_id, alias_kind, source, source_ref, company_id, alias_value, confidence)
  select canonical_id, alias_kind, source, source_ref, company_id, alias_value, confidence
    from public.canonical_aliases
  on conflict do nothing;

  insert into public.canonical_concept_relations
    (from_canonical, to_canonical, relation_type, note_es)
  select from_canonical, to_canonical, relation_type, note_es
    from public.canonical_concept_relations
  on conflict (from_canonical, to_canonical, relation_type) do nothing;

  select count(*) into v_c1 from public.canonical_concepts;
  select count(*) into v_a1 from public.canonical_aliases;
  select count(*) into v_r1 from public.canonical_concept_relations;

  raise exception 'INFORME 6.18 IDEMPOTENCIA (nada persistido): conceptos %->% | alias %->% | relaciones %->%',
    v_c0, v_c1, v_a0, v_a1, v_r0, v_r1;
end $$;
-- ESPERADO: 20->20 | 37->37 | 12->12, entregado como excepción que revierte todo.

-- 6.19 La migración 6 no toca datos económicos. Baseline completo.
select (select count(*) from public.budget_items)                         as bi_filas,
       (select sum(quantity * unit_price) from public.budget_items)       as suma_q_x_p,
       (select sum(subtotal) from public.budget_items)                    as suma_subtotal,
       (select md5(string_agg(id::text, ',' order by id))
          from public.budget_items)                                       as md5_ids,
       (select count(*) from public.pb_products)                          as pb_filas,
       (select count(*) from public.pb_products where concept_id is not null) as pb_concept_id;
-- ESPERADO: 807 | 978511.3000 | 978511.61 | 50c5f5cd2b11d09237c73af605e4beac | 42221 | 0


-- ─────────────────────────────────────────────────────────────────────────────────────
-- BLOQUE 7-A · Tras 20260824121231_budget_items_canonical.sql (SOLO LECTURA)
-- ─────────────────────────────────────────────────────────────────────────────────────
-- 7A.1 Las 7 columnas existen y ninguna es NOT NULL sin default. Si alguna lo fuese, el
--      ALTER habría fallado sobre las 807 filas existentes.
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'budget_items'
   and column_name in ('canonical_id','canonical_status','canonical_confidence',
                       'canonical_source','canonical_origin','canonical_source_ref',
                       'price_type')
 order by column_name;
-- ESPERADO: 7 filas. canonical_status NOT NULL con default 'unmatched'; las otras 6 YES.

-- 7A.2 NINGÚN IMPORTE SE HA TOCADO. Esta es la comprobación que de verdad importa.
--      Se compara contra el valor anotado ANTES de aplicar la migración.
select count(*)                      as filas,
       sum(quantity * unit_price)    as base_calculada,
       sum(subtotal)                 as base_almacenada,
       md5(string_agg(id::text, ',' order by id)) as huella_filas
  from public.budget_items;
-- ESPERADO: 807 filas y exactamente los mismos base_calculada, base_almacenada y huella
--           que antes de la migración. Anotar los cuatro valores ANTES de aplicarla.
--           (base_calculada y base_almacenada no tienen por qué coincidir entre sí; lo
--           que importa es que cada una sea idéntica a su valor previo.)

-- 7A.3 Las 807 filas históricas quedan en 'unmatched' y sin procedencia inventada.
select canonical_status, count(*),
       count(*) filter (where canonical_id       is not null) as con_id,
       count(*) filter (where canonical_origin   is not null) as con_origen,
       count(*) filter (where canonical_source_ref is not null) as con_source_ref
  from public.budget_items
 group by canonical_status;
-- ESPERADO: unmatched | 807 | 0 | 0 | 0

-- 7A.4 Los índices son PARCIALES. Hoy indexan 0 filas y crecerán solo con lo clasificado.
select indexname, indexdef
  from pg_indexes
 where schemaname = 'public' and tablename = 'budget_items'
   and indexname in ('idx_budget_items_canonical','idx_budget_items_canonical_status');
-- ESPERADO: 2 filas, ambas con cláusula WHERE

-- 7A.5 Los dos CHECK compuestos están escritos con CASE, no con OR encadenados.
--      Motivo: en PostgreSQL un CHECK que evalúa a NULL se considera SATISFECHO, así que
--      la forma disyuntiva dejaría pasar (canonical_origin NULL, source_ref 'cype').
select conname, pg_get_constraintdef(oid) as definicion
  from pg_constraint
 where conrelid = 'public.budget_items'::regclass
   and conname in ('ck_canonical_coherence','ck_origin_source_ref');
-- ESPERADO: 2 filas, ambas definiciones contienen 'CASE' y 'ELSE false'

-- 7A.6 Inventario de las restricciones de vocabulario cerrado y de la FK.
select conname, contype, pg_get_constraintdef(oid) as definicion
  from pg_constraint
 where conrelid = 'public.budget_items'::regclass
   and conname in ('budget_items_canonical_id_fkey',
                   'ck_budget_items_canonical_status',
                   'ck_budget_items_canonical_source',
                   'ck_budget_items_canonical_origin',
                   'ck_budget_items_source_ref_format',
                   'ck_budget_items_price_type',
                   'ck_budget_items_confidence_range')
 order by conname;
-- ESPERADO: 7 filas. La FK apunta a canonical_concepts(canonical_id).

-- 7A.7 Los datos reales respetan cada vocabulario cerrado. Con 807 filas en 'unmatched'
--      todos estos contadores deben ser 0 por construcción; se comprueban igualmente
--      porque el objetivo es que sigan siendo 0 cuando el resolver empiece a escribir.
select
  count(*) filter (where canonical_status not in ('unmatched','resolved','review','ambiguous'))
    as status_fuera_de_vocabulario,
  count(*) filter (where canonical_source is not null
                     and canonical_source not in ('override','generator','exact_manual',
                         'exact_curated','exact_engine','exact_import','exact_provider',
                         'synonym','fingerprint'))
    as source_fuera_de_vocabulario,
  count(*) filter (where canonical_origin is not null
                     and canonical_origin not in ('engine','ai','import','provider','free_text','legacy'))
    as origin_fuera_de_vocabulario,
  count(*) filter (where price_type is not null
                     and price_type not in ('LABOR_ONLY','MATERIAL_ONLY',
                                            'LABOR_AND_MATERIAL','SERVICE'))
    as price_type_fuera_de_vocabulario,
  count(*) filter (where canonical_confidence is not null
                     and (canonical_confidence < 0 or canonical_confidence > 1))
    as confianza_fuera_de_rango,
  count(*) filter (where canonical_source_ref is not null
                     and (canonical_origin is null
                          or canonical_origin not in ('import','provider')))
    as source_ref_sin_import_ni_provider
  from public.budget_items;
-- ESPERADO: 0 | 0 | 0 | 0 | 0 | 0

-- 7A.8 La matriz congelada de canonical_status se cumple fila a fila. Cuenta las filas que
--      estarían en una combinación ilegal según la sección 5.2 del diseño.
select
  count(*) filter (where canonical_status = 'unmatched'
                     and (canonical_id is not null
                          or canonical_confidence is not null
                          or canonical_source is not null))          as unmatched_ilegales,
  count(*) filter (where canonical_status = 'resolved'
                     and (canonical_id is null
                          or canonical_confidence is distinct from 1.00
                          or canonical_source is null))              as resolved_ilegales,
  count(*) filter (where canonical_status = 'review'
                     and (canonical_id is null
                          or canonical_confidence is null
                          or canonical_confidence <  0.50
                          or canonical_confidence >= 0.85
                          or canonical_source not in ('synonym','fingerprint'))) as review_ilegales,
  count(*) filter (where canonical_status = 'ambiguous'
                     and (canonical_id is not null
                          or canonical_confidence is not null
                          or canonical_source is null))              as ambiguous_ilegales
  from public.budget_items;
-- ESPERADO: 0 | 0 | 0 | 0

-- 7A.9 El backfill semántico NO se ha ejecutado: no hay ni una línea clasificada.
select count(*) as filas_clasificadas
  from public.budget_items
 where canonical_status <> 'unmatched' or canonical_id is not null;
-- ESPERADO: 0

-- 7A.10 Los índices parciales indexan hoy exactamente 0 filas.
select (select count(*) from public.budget_items where canonical_id is not null)      as idx_canonical_filas,
       (select count(*) from public.budget_items where canonical_status <> 'unmatched') as idx_status_filas;
-- ESPERADO: 0 | 0


-- ─────────────────────────────────────────────────────────────────────────────────────
-- BLOQUE 7-B · BATERÍA DE ck_origin_source_ref  (ESCRIBE, PERO TERMINA EN ROLLBACK)
--
-- Los 8 casos exigidos. Se ejecutan contra la restricción REAL de la tabla REAL, no
-- contra una copia, porque una copia no demostraría nada.
--
-- SE EJECUTA EL BLOQUE ENTERO DE UNA SOLA VEZ, desde 'begin;' hasta 'rollback;'.
-- Si se ejecuta por trozos, el ROLLBACK final no llega a correr y la fila de prueba
-- queda modificada. Se usa UNA fila existente y se restaura al deshacer la transacción.
-- ─────────────────────────────────────────────────────────────────────────────────────
begin;

create temp table _ck_origin_resultado (
  n            int,
  origen       text,
  source_ref   text,
  esperado     text,
  obtenido     text,
  veredicto    text
) on commit drop;

do $$
declare
  v_id      uuid;
  v_casos   text[][] := array[
    array['1','import',   'cype',    'VALIDO'  ],
    array['2','provider', 'obramat', 'VALIDO'  ],
    array['3','import',   '<NULL>',  'RECHAZADO'],
    array['4','provider', '<NULL>',  'RECHAZADO'],
    array['5','engine',   'cype',    'RECHAZADO'],
    array['6','free_text','obramat', 'RECHAZADO'],
    array['7','legacy',   'cype',    'RECHAZADO'],
    array['8','<NULL>',   '<NULL>',  'VALIDO'  ]
  ];
  v_i       int;
  v_origen  text;
  v_ref     text;
  v_esp     text;
  v_obt     text;
begin
  select id into v_id from public.budget_items order by id limit 1;
  if v_id is null then
    raise exception 'No hay filas en budget_items: no se puede ejecutar la bateria.';
  end if;

  for v_i in 1 .. array_length(v_casos, 1) loop
    v_origen := nullif(v_casos[v_i][2], '<NULL>');
    v_ref    := nullif(v_casos[v_i][3], '<NULL>');
    v_esp    := v_casos[v_i][4];

    -- Subtransaccion: si el UPDATE viola el CHECK, solo se deshace este intento.
    begin
      update public.budget_items
         set canonical_origin     = v_origen,
             canonical_source_ref = v_ref
       where id = v_id;
      v_obt := 'VALIDO';
    exception
      when check_violation then
        v_obt := 'RECHAZADO';
    end;

    insert into _ck_origin_resultado
      values (v_i, coalesce(v_origen,'NULL'), coalesce(v_ref,'NULL'),
              v_esp, v_obt,
              case when v_esp = v_obt then 'OK' else 'FALLO' end);
  end loop;
end $$;

-- UNA SOLA SENTENCIA DE LECTURA. El recuento de fallos viaja como columna, no como un
-- segundo SELECT. Motivo: los clientes SQL que solo devuelven el resultado de la ultima
-- sentencia obligarian a lanzar los dos SELECT por separado, y eso parte la transaccion:
-- el 'rollback;' de mas abajo no llegaria a ejecutarse y la fila de prueba quedaria
-- modificada en produccion. Con una sentencia unica, el bloque entero se envia de una
-- vez y el ROLLBACK siempre corre. Esta es la forma realmente ejecutada.
select n, origen, source_ref, esperado, obtenido, veredicto,
       (select count(*) from _ck_origin_resultado where veredicto = 'FALLO') as fallos
  from _ck_origin_resultado order by n;
-- ESPERADO, las 8 filas con veredicto 'OK' y fallos = 0 en todas ellas:
--   1 import    cype     VALIDO     VALIDO     OK  0
--   2 provider  obramat  VALIDO     VALIDO     OK  0
--   3 import    NULL     RECHAZADO  RECHAZADO  OK  0
--   4 provider  NULL     RECHAZADO  RECHAZADO  OK  0
--   5 engine    cype     RECHAZADO  RECHAZADO  OK  0
--   6 free_text obramat  RECHAZADO  RECHAZADO  OK  0
--   7 legacy    cype     RECHAZADO  RECHAZADO  OK  0
--   8 NULL      NULL     VALIDO     VALIDO     OK  0
-- Si 'fallos' no es 0, NO SE CONTINUA: se revierte con el BLOQUE 2 de ROLLBACK.sql.

rollback;
-- La fila de prueba vuelve a su estado original. No queda rastro.

-- Confirmacion de que el rollback surtio efecto:
select count(*) as filas_con_origen from public.budget_items
 where canonical_origin is not null or canonical_source_ref is not null;
-- ESPERADO: 0


-- ─────────────────────────────────────────────────────────────────────────────────────
-- BLOQUE 8 · Tras 20260824123052_pb_products_canonical_fk.sql
-- ─────────────────────────────────────────────────────────────────────────────────────
-- 8.1 La FK existe y es ON DELETE SET NULL. Con CASCADE, borrar un concepto canonico
--     borraria productos de proveedor, y eso seria destruir catalogo ajeno.
select conname, pg_get_constraintdef(oid) as definicion
  from pg_constraint
 where conrelid = 'public.pb_products'::regclass
   and conname in ('pb_products_concept_id_fkey','ck_pb_concept_match_type');
-- ESPERADO: 2 filas. La FK debe decir 'ON DELETE SET NULL'.

-- 8.2 NINGUNA FILA SE HA TOCADO.
select count(*)                                          as productos,
       count(*) filter (where concept_id is not null)    as vinculados,
       count(*) filter (where concept_match_type is null) as match_type_nulo
  from public.pb_products;
-- ESPERADO: 42221 | 0 | 0
-- Si match_type_nulo NO es 0, hay que revisar antes de que el resolver escriba nada:
-- el CHECK de vocabulario no atrapa los NULL (una comparacion IN con NULL da NULL, y un
-- CHECK que evalua a NULL se considera satisfecho).

-- 8.3 Reparto de concept_match_type.
select concept_match_type, count(*)
  from public.pb_products group by 1 order by 1;
-- ESPERADO: none | 42221

-- 8.4 El indice es parcial.
select indexname, indexdef from pg_indexes
 where schemaname = 'public' and tablename = 'pb_products'
   and indexname = 'idx_pb_products_concept';
-- ESPERADO: 1 fila, con clausula WHERE concept_id IS NOT NULL


-- ─────────────────────────────────────────────────────────────────────────────────────
-- BLOQUE 9 · CRITERIO DE SALIDA (se ejecuta al final, con las 8 aplicadas)
-- Corresponde a la seccion 9 del diseno congelado.
-- ─────────────────────────────────────────────────────────────────────────────────────
select 'dominios'   as objeto, count(*)::text as valor, '20'    as esperado from public.canonical_domains
union all
select 'conceptos',  count(*)::text, '20'    from public.canonical_concepts
union all
-- 37, no 35: la enmienda WARN-2 anadio los DOS literales reales del emisor de
-- protecciones (budget-engine.ts:691) como alias exact/engine de
-- WORK.PROTECT.SITE.COVERING. El seed definitivo aplicado tiene 37 aliases.
select 'aliases',    count(*)::text, '37'    from public.canonical_aliases
union all
select 'relaciones', count(*)::text, '12'    from public.canonical_concept_relations
union all
select 'procedencias', count(*)::text, '5'   from public.canonical_alias_sources
union all
select 'items_unmatched', count(*)::text, '807'
  from public.budget_items where canonical_status = 'unmatched'
union all
select 'importe_total', sum(quantity * unit_price)::text, 'IDENTICO AL PREVIO'
  from public.budget_items
union all
select 'productos', count(*)::text, '42221'  from public.pb_products
union all
select 'productos_vinculados', count(*) filter (where concept_id is not null)::text, '0'
  from public.pb_products;


-- ─────────────────────────────────────────────────────────────────────────────────────
-- BLOQUE 10 · BASELINE ECONOMICO REFORZADO  (SOLO LECTURA)
--
-- Se ejecuta antes y despues de CADA paso del backfill.
--
-- Por que existe 'huella_monetaria'. Las otras tres metricas tienen un punto ciego:
--   - huella_ids demuestra que no aparecio ni desaparecio ninguna linea;
--   - las dos sumas demuestran que los totales globales no se movieron;
--   - ninguna detecta un CAMBIO COMPENSADO, dos lineas alteradas en sentidos opuestos
--     que se anulan entre si en el agregado.
-- La huella monetaria hashea los valores linea a linea, no agregados, asi que si cambia
-- una sola celda economica de una sola fila, cambia el hash.
--
-- Detalles que NO son decorativos:
--   - 'order by id' fija el orden; sin el, string_agg no es determinista.
--   - 'coalesce(..., NULL)' es obligatorio: sin el, una columna NULL propagaria NULL a
--     toda la fila y esa linea desapareceria del hash EN SILENCIO.
--   - los separadores '|' y '\n' evitan colisiones por concatenacion ambigua.
-- ─────────────────────────────────────────────────────────────────────────────────────
select
  count(*)                                                     as filas,
  sum(quantity * unit_price)                                   as base_calculada,
  sum(subtotal)                                                as base_almacenada,
  md5(string_agg(id::text, ',' order by id))                   as huella_ids,
  md5(string_agg(
        id::text || '|' ||
        coalesce(quantity::text,   'NULL') || '|' ||
        coalesce(unit_price::text, 'NULL') || '|' ||
        coalesce(subtotal::text,   'NULL'),
        E'\n' order by id))                                    as huella_monetaria
  from public.budget_items;
-- ESPERADO:
--   filas            = 807
--   base_calculada   = 978511.3000
--   base_almacenada  = 978511.61
--   huella_ids       = 50c5f5cd2b11d09237c73af605e4beac
--   huella_monetaria = e11db5c2ddd964cb7d5daddd709ba3b0
--
-- Si huella_monetaria cambia y las sumas NO, hay un cambio compensado. Se para.
