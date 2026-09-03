-- ============================================================================
-- Ajustes → Empresa: ubicación del negocio + datos de actividad
--
-- 1) `profiles` gana `province` y `comunidad_autonoma`.
--    El agente económico ya lee `profiles.city` (app/api/agent/config/route.ts).
--    Con provincia y comunidad autónoma podrá filtrar noticias, ayudas y
--    subvenciones por territorio. Esta migración SOLO añade las columnas y las
--    rellena con lo que ya hubiera en `fiscal_settings`; usarlas en las queries
--    del agente es un paso posterior.
--
-- 2) `fiscal_settings` gana `comunidad_autonoma` (coherencia con profiles),
--    `cnae` y `facturae_enabled`, que la nueva pantalla de Ajustes edita.
--
-- Todo es aditivo y idempotente: no altera datos existentes ni rompe lecturas.
-- Ejecutar en el SQL Editor de Supabase.
-- ============================================================================

-- ── 1. profiles ─────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists province text,
  add column if not exists comunidad_autonoma text;

comment on column public.profiles.province is
  'Provincia del negocio. La lee el agente económico para filtrar ayudas y noticias provinciales. Espejo de fiscal_settings.province.';
comment on column public.profiles.comunidad_autonoma is
  'Comunidad autónoma. Se autocompleta desde la provincia en Ajustes, pero es editable (el negocio puede operar en otra).';


-- ── 2. fiscal_settings ──────────────────────────────────────────────────────
alter table public.fiscal_settings
  add column if not exists comunidad_autonoma text,
  add column if not exists cnae text,
  add column if not exists facturae_enabled boolean not null default false;

comment on column public.fiscal_settings.comunidad_autonoma is
  'Comunidad autónoma del domicilio fiscal. Se autocompleta desde province.';
comment on column public.fiscal_settings.cnae is
  'Código CNAE de la actividad (opcional, texto libre: "4332 — Instalación de carpintería").';
comment on column public.fiscal_settings.facturae_enabled is
  'Emitir en formato Facturae firmado para clientes B2B que lo exigen.';


-- ── 3. Backfill: fiscal_settings → profiles ─────────────────────────────────
-- Los usuarios que ya rellenaron sus datos fiscales no tienen por qué volver a
-- entrar en Ajustes para que el agente vea su territorio.
update public.profiles p
set
  province = coalesce(p.province, f.province),
  city     = coalesce(nullif(p.city, ''), nullif(f.city, ''))
from public.fiscal_settings f
where f.user_id = p.id
  and (p.province is null or nullif(p.city, '') is null);


-- ── 4. Backfill: provincia → comunidad autónoma ─────────────────────────────
-- Mismo mapa que lib/es-regions.ts. Solo rellena filas donde aún es NULL.
with prov_ccaa(province, ccaa) as (
  values
    ('Almería','Andalucía'), ('Cádiz','Andalucía'), ('Córdoba','Andalucía'), ('Granada','Andalucía'),
    ('Huelva','Andalucía'), ('Jaén','Andalucía'), ('Málaga','Andalucía'), ('Sevilla','Andalucía'),
    ('Huesca','Aragón'), ('Teruel','Aragón'), ('Zaragoza','Aragón'),
    ('Asturias','Principado de Asturias'),
    ('Islas Baleares','Illes Balears'), ('Illes Balears','Illes Balears'), ('Baleares','Illes Balears'),
    ('Las Palmas','Canarias'), ('Santa Cruz de Tenerife','Canarias'),
    ('Cantabria','Cantabria'),
    ('Albacete','Castilla-La Mancha'), ('Ciudad Real','Castilla-La Mancha'), ('Cuenca','Castilla-La Mancha'),
    ('Guadalajara','Castilla-La Mancha'), ('Toledo','Castilla-La Mancha'),
    ('Ávila','Castilla y León'), ('Burgos','Castilla y León'), ('León','Castilla y León'),
    ('Palencia','Castilla y León'), ('Salamanca','Castilla y León'), ('Segovia','Castilla y León'),
    ('Soria','Castilla y León'), ('Valladolid','Castilla y León'), ('Zamora','Castilla y León'),
    ('Barcelona','Cataluña'), ('Gerona','Cataluña'), ('Girona','Cataluña'),
    ('Lérida','Cataluña'), ('Lleida','Cataluña'), ('Tarragona','Cataluña'),
    ('Alicante','Comunitat Valenciana'), ('Alacant','Comunitat Valenciana'),
    ('Castellón','Comunitat Valenciana'), ('Castelló','Comunitat Valenciana'),
    ('Valencia','Comunitat Valenciana'), ('València','Comunitat Valenciana'),
    ('Badajoz','Extremadura'), ('Cáceres','Extremadura'),
    ('La Coruña','Galicia'), ('A Coruña','Galicia'), ('Lugo','Galicia'),
    ('Orense','Galicia'), ('Ourense','Galicia'), ('Pontevedra','Galicia'),
    ('Madrid','Comunidad de Madrid'),
    ('Murcia','Región de Murcia'),
    ('Navarra','Comunidad Foral de Navarra'), ('Nafarroa','Comunidad Foral de Navarra'),
    ('Álava','País Vasco'), ('Araba','País Vasco'), ('Araba/Álava','País Vasco'),
    ('Guipúzcoa','País Vasco'), ('Gipuzkoa','País Vasco'),
    ('Vizcaya','País Vasco'), ('Bizkaia','País Vasco'),
    ('La Rioja','La Rioja'),
    ('Ceuta','Ceuta'), ('Melilla','Melilla')
)
update public.profiles p
set comunidad_autonoma = m.ccaa
from prov_ccaa m
where p.comunidad_autonoma is null
  and lower(trim(p.province)) = lower(trim(m.province));

with prov_ccaa(province, ccaa) as (
  values
    ('Almería','Andalucía'), ('Cádiz','Andalucía'), ('Córdoba','Andalucía'), ('Granada','Andalucía'),
    ('Huelva','Andalucía'), ('Jaén','Andalucía'), ('Málaga','Andalucía'), ('Sevilla','Andalucía'),
    ('Huesca','Aragón'), ('Teruel','Aragón'), ('Zaragoza','Aragón'),
    ('Asturias','Principado de Asturias'),
    ('Islas Baleares','Illes Balears'), ('Illes Balears','Illes Balears'), ('Baleares','Illes Balears'),
    ('Las Palmas','Canarias'), ('Santa Cruz de Tenerife','Canarias'),
    ('Cantabria','Cantabria'),
    ('Albacete','Castilla-La Mancha'), ('Ciudad Real','Castilla-La Mancha'), ('Cuenca','Castilla-La Mancha'),
    ('Guadalajara','Castilla-La Mancha'), ('Toledo','Castilla-La Mancha'),
    ('Ávila','Castilla y León'), ('Burgos','Castilla y León'), ('León','Castilla y León'),
    ('Palencia','Castilla y León'), ('Salamanca','Castilla y León'), ('Segovia','Castilla y León'),
    ('Soria','Castilla y León'), ('Valladolid','Castilla y León'), ('Zamora','Castilla y León'),
    ('Barcelona','Cataluña'), ('Gerona','Cataluña'), ('Girona','Cataluña'),
    ('Lérida','Cataluña'), ('Lleida','Cataluña'), ('Tarragona','Cataluña'),
    ('Alicante','Comunitat Valenciana'), ('Alacant','Comunitat Valenciana'),
    ('Castellón','Comunitat Valenciana'), ('Castelló','Comunitat Valenciana'),
    ('Valencia','Comunitat Valenciana'), ('València','Comunitat Valenciana'),
    ('Badajoz','Extremadura'), ('Cáceres','Extremadura'),
    ('La Coruña','Galicia'), ('A Coruña','Galicia'), ('Lugo','Galicia'),
    ('Orense','Galicia'), ('Ourense','Galicia'), ('Pontevedra','Galicia'),
    ('Madrid','Comunidad de Madrid'),
    ('Murcia','Región de Murcia'),
    ('Navarra','Comunidad Foral de Navarra'), ('Nafarroa','Comunidad Foral de Navarra'),
    ('Álava','País Vasco'), ('Araba','País Vasco'), ('Araba/Álava','País Vasco'),
    ('Guipúzcoa','País Vasco'), ('Gipuzkoa','País Vasco'),
    ('Vizcaya','País Vasco'), ('Bizkaia','País Vasco'),
    ('La Rioja','La Rioja'),
    ('Ceuta','Ceuta'), ('Melilla','Melilla')
)
update public.fiscal_settings f
set comunidad_autonoma = m.ccaa
from prov_ccaa m
where f.comunidad_autonoma is null
  and lower(trim(f.province)) = lower(trim(m.province));
