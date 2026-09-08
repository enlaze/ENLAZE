-- Etiquetas de cliente.
--
-- La ficha de cliente del rediseño pide etiquetas libres ("Constructora",
-- "Contrato marco", "Paga a 30 días"...) para describir al cliente y para
-- filtrar el listado. No existía almacenamiento: el diseño las traía
-- inventadas en el propio HTML.
--
-- POR QUÉ UNA COLUMNA `text[]` Y NO UNA TABLA `client_tags`:
-- una etiqueta aquí no tiene atributos propios —ni color guardado, ni
-- descripción, ni orden global— y siempre se lee junto al cliente, nunca por
-- sí sola. Una tabla obligaría a un join (o a una segunda consulta) en el
-- listado y a su propia RLS a cambio de nada: no hay nada que normalizar
-- cuando el valor ES la etiqueta. Postgres indexa el array con GIN y responde
-- a `@>` / `&&` sin ese coste. Si algún día una etiqueta necesita atributos
-- propios, migrar a tabla es un `unnest` directo.
alter table public.clients
  add column if not exists tags text[] not null default '{}'::text[];

comment on column public.clients.tags is
  'Etiquetas libres del cliente, en el orden en que se añadieron. El trigger '
  'clients_normalize_tags garantiza que no hay NULLs, ni cadenas vacías o en '
  'blanco, ni repetidas. Se filtra con operadores de array: `tags @> ARRAY[...]` '
  'para "tiene todas" y `tags && ARRAY[...]` para "tiene alguna" '
  '(PostgREST: cs / ov).';

-- Normalizar en vez de rechazar.
--
-- Las invariantes que queremos (sin NULLs, sin blancos, sin repetidas) no
-- caben en un CHECK: quitar duplicados y detectar cadenas en blanco exige
-- `unnest`, y Postgres prohíbe subconsultas dentro de un CHECK. Se podría
-- envolver en una función IMMUTABLE, pero entonces un cliente que mande
-- ["Obra", "obra "] recibe un error 400 por algo que el servidor sabe
-- arreglar solo. Un trigger BEFORE lo deja limpio y el guardado no falla.
--
-- Qué hace, en orden: descarta NULLs y lo que quede vacío tras `btrim`,
-- recorta los espacios de los extremos, y elimina repetidas conservando la
-- PRIMERA aparición (por eso el `order by min(ord)`: el orden en que el
-- usuario las añadió es el orden en que se pintan en la ficha).
--
-- La comparación de duplicados es `lower(btrim(t))`, insensible a mayúsculas:
-- "Constructora" y "constructora" son la misma etiqueta, y se conserva la
-- grafía de la primera. Sin esto el filtro del listado mostraría dos entradas
-- para lo que el usuario entiende como una sola.
create or replace function public.clients_normalize_tags()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.tags := coalesce((
    select array_agg(t order by ord)
    from (
      select min(ord) as ord, (array_agg(btrim(tag) order by ord))[1] as t
      from unnest(new.tags) with ordinality as u(tag, ord)
      where tag is not null and btrim(tag) <> ''
      group by lower(btrim(tag))
    ) dedup
  ), '{}'::text[]);
  return new;
end;
$$;

comment on function public.clients_normalize_tags() is
  'Trigger BEFORE INSERT/UPDATE de public.clients: deja clients.tags sin '
  'NULLs, sin cadenas en blanco y sin etiquetas repetidas (comparando sin '
  'distinguir mayúsculas), conservando la primera grafía y el orden de alta.';

drop trigger if exists clients_normalize_tags on public.clients;
create trigger clients_normalize_tags
  before insert or update of tags on public.clients
  for each row execute function public.clients_normalize_tags();

-- GIN es el índice que entiende los operadores de array. Un btree sobre
-- `tags` no serviría para `@>` / `&&`: compararía el array entero como valor.
create index if not exists idx_clients_tags on public.clients using gin (tags);

-- No se tocan las políticas: las cuatro `clients_*_own` filtran por
-- `auth.uid() = user_id` sobre la fila entera, así que la columna nueva queda
-- cubierta sin cambios.

notify pgrst, 'reload schema';
