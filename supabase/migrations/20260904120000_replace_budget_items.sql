-- FASE 2F-1DB — `replace_budget_items`: sustitución atómica del conjunto de líneas
--
-- QUÉ AÑADE: una función nueva, `public.replace_budget_items(uuid, jsonb)`, que
-- reemplaza en UNA SOLA transacción todas las filas de `budget_items` de un
-- presupuesto. Nada más.
--
-- QUÉ NO TOCA: no modifica `update_budget_with_items` ni ninguna otra función, no
-- altera ninguna tabla, no crea índices ni triggers, no reescribe datos y no
-- cambia ninguna política RLS. Es una migración estrictamente aditiva.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ EXISTE
-- ─────────────────────────────────────────────────────────────────────────────
-- El generador de presupuestos sustituye hoy sus líneas desde el cliente con un
-- DELETE seguido de un INSERT, en dos llamadas PostgREST independientes. Cada una
-- es su propia transacción implícita, así que no existe ninguna frontera que las
-- una: si el DELETE tiene éxito y el INSERT falla, el presupuesto se queda sin
-- líneas. Ninguna cantidad de código de cliente cierra esa ventana; sólo una
-- función del servidor la cierra, porque el cuerpo entero de una función plpgsql
-- se ejecuta dentro de la transacción de la llamada.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ESTA MIGRACIÓN ES INERTE HASTA QUE SE PUBLIQUE EL CLIENTE (2F-1APP)
-- ─────────────────────────────────────────────────────────────────────────────
-- Ningún fichero de la aplicación nombra `replace_budget_items` en este commit.
-- Aplicar esta migración no cambia el comportamiento de nada: crea una función
-- que nadie invoca. Esa inercia es deliberada y es el orden de publicación
-- seguro. Lo peligroso sería lo contrario —publicar primero el cliente que llama
-- a una función que no existe—, porque Vercel despliega la aplicación por su
-- cuenta pero NO ejecuta migraciones de Supabase.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- DIFERENCIAS DELIBERADAS CON `update_budget_with_items`
-- ─────────────────────────────────────────────────────────────────────────────
-- No son descuidos. Cada una está aquí por una razón concreta:
--
-- 1. ACEPTA EL ARRAY VACÍO. `update_budget_with_items` aborta con «At least one
--    budget item is required». Aquí `[]` es una petición legítima: significa
--    «este presupuesto se queda sin líneas», y hoy el generador ya puede llegar
--    a ese estado. Convertirlo en excepción rompería un caso que hoy funciona.
--
-- 2. NO EXIGE `quantity > 0` NI `unit_price > 0`. La tabla real no tiene ningún
--    CHECK sobre esas dos columnas —los CHECK vigentes son los de `category`,
--    `unit`, `sort_order >= 0` y los dos canónicos—, de modo que hoy se pueden
--    guardar líneas a cero y se guardan con éxito. Si esta función las rechazara,
--    2F-1 convertiría guardados que hoy funcionan en fallos, y además fallos
--    bloqueantes, porque a partir de 2F-1APP un guardado fallido impide
--    finalizar. Endurecer esto exige validación previa en la interfaz y es una
--    decisión de producto: queda para una fase posterior, no para ésta.
--
-- 3. TRANSPORTA `subtotal` EN VEZ DE RECALCULARLO SIEMPRE. Ver la nota monetaria
--    más abajo. Es la diferencia con más consecuencias y la más importante de
--    respetar.
--
-- 4. NO TOCA LA CABECERA. `update_budget_with_items` actualiza `budgets`, avanza
--    la versión, reinicia el ciclo de vida y escribe una instantánea. Esta
--    función sólo sustituye líneas. La fila de `budgets` se lee y se bloquea,
--    pero no se modifica ninguna de sus columnas, `updated_at` incluido.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- NOTA MONETARIA — POR QUÉ `subtotal` SE TRANSPORTA Y NO SE RECALCULA
-- ─────────────────────────────────────────────────────────────────────────────
-- `update_budget_with_items` calcula siempre `round(quantity * unit_price, 2)` e
-- ignora el `subtotal` que le manden. Para el generador eso NO es equivalente:
-- los materiales llegan con el margen ya aplicado sobre su propio subtotal, que
-- no es el producto de la cantidad por el precio unitario de la misma fila.
-- Recalcular aquí cambiaría importes de presupuestos vivos, y 2F-1 tiene un
-- único objetivo, la atomicidad; no puede mover dinero de paso.
--
-- Regla, por tanto: si el elemento trae `subtotal`, se guarda tal cual. Sólo si
-- falta se calcula `round(quantity * unit_price, 2)`, que es lo que haría
-- cualquier llamador razonable que no lo envíe. Converger las dos funciones en
-- una sola semántica monetaria es trabajo de una fase posterior, con sus propias
-- pruebas sobre importes reales.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- SEGURIDAD
-- ─────────────────────────────────────────────────────────────────────────────
-- `security definer` desactiva RLS dentro del cuerpo, así que la autorización se
-- hace a mano y es obligatoria: se exige `auth.uid()` no nulo y se comprueba la
-- propiedad de la fila con `user_id = auth.uid()` y `deleted_at is null`. Los
-- tres casos de rechazo —el presupuesto no existe, no es del usuario, o está
-- borrado— devuelven el MISMO error y el MISMO mensaje. Distinguirlos convertiría
-- la función en un oráculo para enumerar identificadores ajenos.
--
-- `set search_path = public, pg_temp` fija la resolución de nombres, y el cuerpo
-- no construye ni ejecuta SQL dinámico en ningún punto.
--
-- NO SE DECLARA `strict`. Con `strict`, PostgreSQL devolvería NULL sin llegar a
-- ejecutar el cuerpo cuando cualquier argumento fuese NULL, y un error de
-- programación del llamador se convertiría en un no-op silencioso: exactamente la
-- clase de fallo mudo que esta fase existe para eliminar. Los NULL se validan a
-- mano y se rechazan por separado, cada uno con su propio mensaje.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CÓDIGOS DE ERROR
-- ─────────────────────────────────────────────────────────────────────────────
--   22004  argumento obligatorio a NULL (`p_budget_id` o `p_items`)
--   22023  `p_items` no es un array, o un elemento concreto es inválido
--   42501  no hay sesión, o el presupuesto no está disponible para este usuario
-- Las violaciones de constraint de la propia tabla se propagan sin envolver, con
-- su SQLSTATE original de la clase 23.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CONTROL DE TRANSACCIÓN
-- ─────────────────────────────────────────────────────────────────────────────
-- El fichero no abre ni cierra transacción y no lleva directiva para desactivar
-- la del runner: el CLI envuelve cada migración en una transacción y ésta no
-- contiene nada que lo impida. El último statement es el NOTIFY a PostgREST, para
-- que la función quede publicada en el esquema expuesto en cuanto se aplique.

create or replace function public.replace_budget_items(
  p_budget_id uuid,
  p_items     jsonb
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id  uuid;
  v_budget   uuid;
  v_item     jsonb;
  v_pos      bigint;
  v_numero   numeric;
  v_insertadas integer;
begin
  -- ── 1. Argumentos obligatorios ─────────────────────────────────────────────
  -- Se rechazan por separado y con mensajes distintos: quien reciba el error
  -- tiene que poder saber cuál de los dos argumentos venía mal.
  if p_budget_id is null then
    raise exception 'replace_budget_items: p_budget_id es obligatorio'
      using errcode = '22004';
  end if;

  if p_items is null then
    raise exception 'replace_budget_items: p_items es obligatorio'
      using errcode = '22004';
  end if;

  -- ── 2. Forma del payload ───────────────────────────────────────────────────
  -- Tiene que ser un array JSON. Un objeto, un escalar o el literal jsonb 'null'
  -- se rechazan aquí, antes de tocar nada.
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'replace_budget_items: p_items debe ser un array JSON (recibido: %)',
      jsonb_typeof(p_items)
      using errcode = '22023';
  end if;

  -- ── 3. Autorización ────────────────────────────────────────────────────────
  -- Obligatoria y manual: `security definer` deja RLS fuera de juego, así que sin
  -- esta comprobación una llamada sin sesión operaría con los privilegios del
  -- propietario de la función.
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'replace_budget_items: no hay sesión autenticada'
      using errcode = '42501';
  end if;

  -- ── 4. Propiedad, borrado lógico y bloqueo ─────────────────────────────────
  -- `for update` serializa dos sustituciones concurrentes sobre el mismo
  -- presupuesto: la segunda espera a que la primera confirme, y el resultado
  -- nunca es una mezcla de ambos conjuntos. Ordena por llegada, no por frescura;
  -- decidir qué escritor debe ganar es responsabilidad del cliente.
  select b.id
    into v_budget
    from public.budgets as b
   where b.id = p_budget_id
     and b.user_id = v_user_id
     and b.deleted_at is null
     for update;

  if not found then
    -- Mismo error y mismo texto para inexistente, ajeno y borrado. A propósito.
    raise exception 'replace_budget_items: el presupuesto no está disponible'
      using errcode = '42501';
  end if;

  -- ── 5. Validación elemento a elemento, ANTES de escribir nada ──────────────
  -- La atomicidad no depende de este bucle: el cuerpo entero es una sola
  -- transacción y cualquier fallo posterior revierte igual. Está aquí por la
  -- calidad del mensaje: «elemento 3: falta concept» en vez de un error de cast
  -- opaco disparado a mitad del INSERT.
  for v_item, v_pos in
    select t.item, t.ordinality
      from jsonb_array_elements(p_items) with ordinality as t(item, ordinality)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'replace_budget_items: el elemento % debe ser un objeto JSON (recibido: %)',
        v_pos - 1, jsonb_typeof(v_item)
        using errcode = '22023';
    end if;

    if nullif(btrim(coalesce(v_item->>'concept', '')), '') is null then
      raise exception 'replace_budget_items: el elemento % no tiene concept',
        v_pos - 1
        using errcode = '22023';
    end if;

    -- `quantity`: presente y numérica. NO se exige que sea mayor que cero; ver la
    -- diferencia 2 de la cabecera.
    if v_item->>'quantity' is null then
      raise exception 'replace_budget_items: el elemento % no tiene quantity',
        v_pos - 1
        using errcode = '22023';
    end if;
    begin
      v_numero := (v_item->>'quantity')::numeric;
    exception
      when invalid_text_representation then
        raise exception 'replace_budget_items: el elemento % tiene un quantity no numérico',
          v_pos - 1
          using errcode = '22023';
    end;
    -- `NaN` supera el cast porque numeric lo admite, y envenenaría cualquier suma
    -- posterior. No es una regla de negocio: es una comprobación de que el valor
    -- es un número. JSON no tiene literal NaN, así que sólo puede llegar como
    -- cadena, es decir, desde un llamador que ya está haciendo algo raro.
    if v_numero = 'NaN'::numeric then
      raise exception 'replace_budget_items: el elemento % tiene quantity = NaN',
        v_pos - 1
        using errcode = '22023';
    end if;

    -- `unit_price`: mismas reglas, misma ausencia de umbral.
    if v_item->>'unit_price' is null then
      raise exception 'replace_budget_items: el elemento % no tiene unit_price',
        v_pos - 1
        using errcode = '22023';
    end if;
    begin
      v_numero := (v_item->>'unit_price')::numeric;
    exception
      when invalid_text_representation then
        raise exception 'replace_budget_items: el elemento % tiene un unit_price no numérico',
          v_pos - 1
          using errcode = '22023';
    end;
    if v_numero = 'NaN'::numeric then
      raise exception 'replace_budget_items: el elemento % tiene unit_price = NaN',
        v_pos - 1
        using errcode = '22023';
    end if;
  end loop;

  -- ── 6. Sustitución ─────────────────────────────────────────────────────────
  -- El DELETE y el INSERT comparten la transacción de la llamada. O queda el
  -- conjunto nuevo entero, o queda intacto el anterior. No existe ningún instante
  -- observable con la tabla a medias.
  delete from public.budget_items
   where budget_id = p_budget_id;

  -- Con `p_items = '[]'` este INSERT no produce ninguna fila: el borrado se
  -- mantiene y la función devuelve 0. Es un resultado válido, no un error.
  insert into public.budget_items (
    budget_id,
    sort_order,
    concept,
    description,
    quantity,
    unit,
    category,
    chapter,
    unit_price,
    subtotal,
    canonical_id,
    canonical_status,
    canonical_confidence,
    canonical_source,
    canonical_origin,
    canonical_source_ref,
    price_type
  )
  -- `budget_id` sale del parámetro y de ningún otro sitio. Si un elemento trae su
  -- propio `budget_id`, se ignora en silencio: aceptarlo permitiría escribir en
  -- el presupuesto de otro usuario a través de una llamada autorizada para éste.
  select p_budget_id,
         -- `ordinality` es base 1 y la genera PostgreSQL a partir de la posición
         -- real del elemento en el array, así que no puede repetirse ni dejar
         -- huecos. Un `sort_order` enviado por el cliente sí podría, y la UNIQUE
         -- lo rechazaría con un error incomprensible. Por eso no se lee.
         (t.ordinality - 1)::integer,
         btrim(t.item->>'concept'),
         coalesce(t.item->>'description', ''),
         (t.item->>'quantity')::numeric,
         coalesce(nullif(t.item->>'unit', ''), 'ud'),
         coalesce(nullif(t.item->>'category', ''), 'otros'),
         nullif(t.item->>'chapter', ''),
         (t.item->>'unit_price')::numeric,
         -- Transporte si viene, cálculo sólo si falta. Ver la nota monetaria.
         coalesce(
           (nullif(t.item->>'subtotal', ''))::numeric,
           round((t.item->>'quantity')::numeric * (t.item->>'unit_price')::numeric, 2)
         ),
         -- Transporte literal de lo canónico: lo que decida el clasificador es lo
         -- que se guarda. Esta función no clasifica, no deduce y no corrige.
         nullif(t.item->>'canonical_id', ''),
         -- Réplica explícita del default de la columna: al nombrarla en el
         -- INSERT, el default deja de aplicarse, y la columna es NOT NULL.
         coalesce(nullif(t.item->>'canonical_status', ''), 'unmatched'),
         (nullif(t.item->>'canonical_confidence', ''))::numeric,
         nullif(t.item->>'canonical_source', ''),
         nullif(t.item->>'canonical_origin', ''),
         nullif(t.item->>'canonical_source_ref', ''),
         nullif(t.item->>'price_type', '')
    from jsonb_array_elements(p_items) with ordinality as t(item, ordinality);

  -- Número real de filas insertadas, no la longitud del array. Permite al
  -- llamador afirmar el éxito en positivo en lugar de deducirlo de la ausencia
  -- de error.
  get diagnostics v_insertadas = row_count;

  return v_insertadas;
end;
$$;

comment on function public.replace_budget_items(uuid, jsonb) is
  'FASE 2F-1DB. Sustituye ATÓMICAMENTE el conjunto completo de líneas de un '
  'presupuesto: DELETE + INSERT en la misma transacción, de modo que nunca queda '
  'un estado intermedio con la tabla vacía o a medias. '
  'AUTORIZACIÓN: exige auth.uid() y propiedad de la fila con deleted_at is null; '
  'inexistente, ajeno y borrado devuelven el mismo 42501 para no servir de '
  'oráculo de enumeración. '
  'ORDEN: sort_order lo genera WITH ORDINALITY empezando en cero; un sort_order '
  'enviado dentro del JSON se ignora. budget_id sale del parámetro y un '
  'budget_id dentro del JSON también se ignora. '
  'CONJUNTO VACÍO: p_items = [] es válido, borra todas las líneas y devuelve 0. '
  'SUBTOTAL: se transporta el valor recibido y sólo se calcula '
  'round(quantity*unit_price, 2) cuando falta. Es una DIVERGENCIA DELIBERADA con '
  'update_budget_with_items, que siempre recalcula: los materiales del generador '
  'llegan con el margen ya aplicado sobre su propio subtotal, que no es el '
  'producto de cantidad por precio unitario de la misma fila, y recalcular aquí '
  'cambiaría importes de presupuestos vivos. '
  'CANTIDAD Y PRECIO CERO: se aceptan, porque la tabla no los prohíbe y hoy se '
  'guardan con éxito. '
  'ALCANCE: no modifica ninguna columna de budgets (la fila sólo se lee y se '
  'bloquea con FOR UPDATE), no escribe instantáneas, versiones ni registros de '
  'actividad, y no ejecuta SQL dinámico. '
  'DEVUELVE: el número real de filas insertadas.';

-- ACL determinista. Estado final, no incremental: se enumera lo que se quita y lo
-- que se pone, de modo que una producción actualizada y una instalación limpia
-- acaben con exactamente los mismos privilegios.
--
-- Los `revoke` no son decorativos. PostgreSQL concede EXECUTE a PUBLIC por
-- defecto en toda función nueva, y `create or replace` CONSERVA la ACL previa, así
-- que callarse dejaría el resultado a merced del estado anterior de la base.
--
-- Resultado garantizado, venga de donde venga la base:
--   owner        postgres  (implícito por propiedad, no se toca)
--   authenticated  EXECUTE
--   anon           sin EXECUTE
--   service_role   sin EXECUTE
--   PUBLIC         sin EXECUTE
revoke all on function public.replace_budget_items(uuid, jsonb)
  from public;
revoke all on function public.replace_budget_items(uuid, jsonb)
  from anon;
revoke all on function public.replace_budget_items(uuid, jsonb)
  from service_role;
grant execute on function public.replace_budget_items(uuid, jsonb)
  to authenticated;

notify pgrst, 'reload schema';
