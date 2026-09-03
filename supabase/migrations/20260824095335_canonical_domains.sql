-- Fase 2 · 1/8 · Vocabulario cerrado de dominios canónicos.
--
-- Diseño congelado: docs/FASE-2-CONCEPTOS-CANONICOS.md (v5, 2026-08-24), sección 2.1.
--
-- Los 20 dominios se corresponden 1:1 con VALID_CHAPTERS de lib/budget-analysis.ts:154-159.
-- La correspondencia queda garantizada por la unicidad de chapter_code, no por un mapa
-- en código: replica el precedente de validación con vocabulario cerrado que ya usa
-- sanitizeAnalysis() en la frontera con el LLM.
--
-- No depende de ninguna otra migración de Fase 2. Nada la referencia todavía.

begin;

create table if not exists public.canonical_domains (
  domain       text primary key
               check (domain ~ '^[A-Z][A-Z0-9_]*$'),
  chapter_code text unique,
  label_es     text not null
);

comment on table public.canonical_domains is
  'Fase 2. Vocabulario cerrado de dominios. chapter_code se corresponde 1:1 con VALID_CHAPTERS de lib/budget-analysis.ts. NULL solo si el dominio no mapea a ningún capítulo.';

insert into public.canonical_domains (domain, chapter_code, label_es) values
  ('PROTECT',     'protecciones',         'Protecciones'),
  ('DEMO',        'demoliciones',         'Demoliciones'),
  ('MASONRY',     'albanileria',          'Albañilería'),
  ('PLUMBING',    'fontaneria',           'Fontanería'),
  ('ELECTRIC',    'electricidad',         'Electricidad'),
  ('WATERPROOF',  'impermeabilizacion',   'Impermeabilización'),
  ('CLADDING',    'revestimientos',       'Revestimientos'),
  ('FLOORING',    'pavimentos',           'Pavimentos'),
  ('SKIRTING',    'rodapie',              'Rodapié'),
  ('PAINT',       'pintura',              'Pintura'),
  ('JOINERY_INT', 'carpinteria_interior', 'Carpintería interior'),
  ('JOINERY_EXT', 'carpinteria_exterior', 'Carpintería exterior'),
  ('SANITARY',    'sanitarios',           'Sanitarios'),
  ('KITCHEN',     'cocina',               'Cocina'),
  ('HVAC',        'climatizacion',        'Climatización'),
  ('CEILING',     'falsos_techos',        'Falsos techos'),
  ('WASTE',       'residuos',             'Residuos'),
  ('CLEANING',    'limpieza',             'Limpieza'),
  ('SAFETY',      'seguridad',            'Seguridad'),
  ('OTHER',       'otros',                'Otros')
on conflict (domain) do nothing;

alter table public.canonical_domains enable row level security;

drop policy if exists canonical_domains_read on public.canonical_domains;
create policy canonical_domains_read on public.canonical_domains
  for select to authenticated using (true);

-- Sin políticas de escritura: vocabulario global e inmutable, solo service_role.

commit;
