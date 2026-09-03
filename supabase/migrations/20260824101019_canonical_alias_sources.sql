-- Fase 2 · 3/8 · Procedencias de alias y su precedencia.
--
-- Diseño congelado: docs/FASE-2-CONCEPTOS-CANONICOS.md (v5, 2026-08-24), sección 4.1.
--
-- La prioridad NO vive en código: vive en datos, para que sea consultable, testeable y
-- modificable por migración sin desplegar.
--
--   general_rank        -> orden total del NIVEL 2 (resolución general).
--   source_specific     -> la procedencia puede actuar como identidad de NIVEL 1.
--   requires_source_ref -> la procedencia exige fuente concreta (cype, public_bc3,
--                          enlaze_base, obramat...). Sin ella volveríamos a mezclar
--                          bancos bajo una misma identidad, que es el defecto ya
--                          verificado del item_code colisionante: 02.001 es "Tubería
--                          multicapa 16 mm" en enlaze_base y "ud Instalación punto de
--                          agua" en public_bc3.
--
-- 'provider' va último a propósito: el nombre comercial es la fuente más ruidosa y la
-- que más colisiona entre catálogos (42.221 filas en pb_products).
--
-- No depende de ninguna otra migración. La referencia 20260824120300_canonical_aliases.

begin;

create table if not exists public.canonical_alias_sources (
  source              text primary key check (source ~ '^[a-z_]+$'),
  general_rank        smallint not null unique check (general_rank > 0),
  source_specific     boolean not null default false,
  requires_source_ref boolean not null default false,
  label_es            text not null
);

comment on table public.canonical_alias_sources is
  'Fase 2. Clase de procedencia de un alias y su precedencia. La instancia concreta (cype, public_bc3, obramat) va en canonical_aliases.source_ref.';

insert into public.canonical_alias_sources
  (source, general_rank, source_specific, requires_source_ref, label_es) values
  ('manual',   1, false, false, 'Curación manual de la empresa'),
  ('curated',  2, false, false, 'Vocabulario base de Enlaze'),
  ('engine',   3, true,  false, 'Literal del generador'),
  ('import',   4, true,  true,  'Importación BC3 / CYPE / banco técnico'),
  ('provider', 5, true,  true,  'Nomenclatura comercial de proveedor')
on conflict (source) do nothing;

alter table public.canonical_alias_sources enable row level security;

drop policy if exists canonical_alias_sources_read on public.canonical_alias_sources;
create policy canonical_alias_sources_read on public.canonical_alias_sources
  for select to authenticated using (true);

commit;
