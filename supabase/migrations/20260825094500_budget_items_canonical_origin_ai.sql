-- FASE 2D-2b — Ampliar el vocabulario de budget_items.canonical_origin con 'ai'.
--
-- QUÉ HACE: añade un valor admitido y lo coloca en la rama correcta de la regla de
-- source_ref. Nada más.
--
-- QUÉ NO HACE, y es deliberado: cero UPDATE, cero backfill, cero cambios de DEFAULT,
-- cero cambios en columnas monetarias, cero cambios en las demás restricciones
-- canónicas (ck_budget_items_canonical_source, ck_canonical_coherence,
-- ck_budget_items_source_ref_format, ck_budget_items_price_type,
-- ck_budget_items_confidence_range) y cero cambios en los índices. Ninguna fila
-- existente cambia ni puede volverse inválida: ambas restricciones nuevas son
-- superconjuntos estrictos de las que sustituyen, así que todo lo que era legal antes
-- lo sigue siendo.
--
-- POR QUÉ SON DOS RESTRICCIONES Y NO UNA: 'ck_origin_source_ref' está escrita como un
-- CASE con 'else false'. Ese 'else' es intencional —un CHECK que evalúa a NULL se da
-- por SATISFECHO, así que sin él un origen no contemplado se colaría—, pero tiene el
-- efecto de que cualquier valor nuevo que no aparezca en ninguna rama se rechaza
-- siempre. Ampliar sólo 'ck_budget_items_canonical_origin' dejaría 'ai' aceptado por
-- una restricción y prohibido por la otra: las inserciones fallarían igualmente, y el
-- mensaje de error señalaría a la restricción equivocada.
--
-- SEMÁNTICA DE 'ai': procedencia, no fiabilidad. Marca que la línea la propuso
-- originalmente el modelo. Una línea 'ai' puede acabar 'resolved' con evidencia
-- canónica fuerte, o quedarse 'unmatched'; eso lo decide canonical_status, no esta
-- columna. 'ai' NO se añade a canonical_alias_sources ni al vocabulario de
-- canonical_source: no existe ni debe existir 'exact_ai'.

begin;

-- ── Vocabulario ───────────────────────────────────────────────────────────────
alter table public.budget_items drop constraint if exists ck_budget_items_canonical_origin;
alter table public.budget_items add  constraint ck_budget_items_canonical_origin check (
  canonical_origin is null
  or canonical_origin in ('engine','ai','import','provider','free_text','legacy')
);

-- ── Origen y fuente concreta (sección 5.3 del diseño, ampliada) ───────────────
-- import/provider              -> source_ref OBLIGATORIO
-- engine/ai/free_text/legacy   -> source_ref PROHIBIDO
-- NULL (transición)            -> source_ref PROHIBIDO
--
-- 'ai' entra en la rama de PROHIBIDO: una propuesta del modelo no procede de ningún
-- banco de precios ni tarifa identificable, así que no hay instancia documental que
-- declarar. El 'else false' se conserva tal cual.
alter table public.budget_items drop constraint if exists ck_origin_source_ref;
alter table public.budget_items add  constraint ck_origin_source_ref check (
  case
    when canonical_origin in ('import','provider')                then canonical_source_ref is not null
    when canonical_origin in ('engine','ai','free_text','legacy') then canonical_source_ref is null
    when canonical_origin is null                                 then canonical_source_ref is null
    else false
  end
);

comment on column public.budget_items.canonical_origin is
  'Fase 2. Dónde NACIÓ la línea: engine (motor determinista), ai (propuesta '
  'originalmente por el modelo), import/provider (fuente identificable, exigen '
  'canonical_source_ref), free_text (alta manual), legacy (histórico sin procedencia '
  'demostrable), NULL (desconocida). Describe procedencia, NO fiabilidad: una línea ai '
  'puede acabar resolved con evidencia canónica fuerte. No confundir con price_source, '
  'que dice de dónde salió el PRECIO y se sobrescribe varias veces.';

commit;
