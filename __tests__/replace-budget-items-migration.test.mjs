// FASE 2F-1DB — contrato estático de `20260904120000_replace_budget_items.sql`
//
// QUÉ PRUEBA ESTA SUITE Y QUÉ NO
// ------------------------------
// Prueba el TEXTO de la migración: que la función declarada cumple, cláusula por
// cláusula, el contrato cerrado de 2F-1DB. No prueba su COMPORTAMIENTO: para eso
// hace falta un PostgreSQL real, y ese entorno todavía no está elegido ni
// autorizado. Mientras no exista, esta suite en verde significa «el fichero dice
// lo que tiene que decir», no «la función hace lo que tiene que hacer».
//
// Aserciones que quedan pendientes de la suite de integración, y que NINGÚN test
// estático puede sustituir: que un elemento inválido revierte el conjunto entero,
// que `[]` borra y devuelve 0, que los tres casos de rechazo devuelven el mismo
// 42501, que dos llamadas concurrentes no se entrelazan, y que la ACL efectiva en
// la base coincide con la declarada.
//
// BLOQUE A — el contrato, verificado sobre el fichero real.
// BLOQUE B — controles negativos. Cada mutación aplica UN verificador a una copia
//            del fichero que introduce UNA regresión concreta, y exige que ese
//            verificador la rechace. Sin este bloque, un verificador con un regex
//            mal escrito pasaría siempre y la suite entera sería decorativa.
//
//            LA CORRESPONDENCIA NO ES UNO A UNO, y conviene no describirla como si
//            lo fuera. Hay más mutaciones que verificadores: los verificadores que
//            agrupan varias condiciones —o que pueden burlarse escribiendo la
//            misma regresión de varias formas— tienen varias mutaciones cada uno.
//            El umbral contra el cero, por ejemplo, se puede colar nombrando la
//            columna o aplicándolo a la variable ya casteada, y el rechazo del
//            array vacío se puede escribir contando o comparando: cada forma
//            necesita su propio mutante, porque un regex puede cazar una y dejar
//            pasar las otras. El reparto exacto no se afirma aquí de palabra: lo
//            calcula y lo comprueba el test «la cobertura de mutaciones es la
//            declarada», al final del BLOQUE B.
// BLOQUE C — encaje de la migración en el historial del repositorio.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { detectarControlTransaccion, trocearStatements } from "./lib/sql-toplevel.mjs";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR_MIGRACIONES = "supabase/migrations";
const FICHERO = "20260904120000_replace_budget_items.sql";
const RUTA = join(DIR_MIGRACIONES, FICHERO);

const SQL = readFileSync(join(RAIZ, RUTA), "utf8");

const norm = (s) => s.replace(/\s+/g, " ").trim();
const bajo = (s) => norm(s).toLowerCase();

// Las flechas de jsonb (`->` y `->>`) contienen `>`, y eso convierte cualquier
// búsqueda ingenua de comparadores en un campo de minas de falsos positivos. Se
// neutralizan antes de buscar operadores de comparación.
const sinFlechas = (s) => s.replace(/->>/g, "·").replace(/->/g, "·");

// El troceador de `sql-toplevel.mjs` conserva intacto lo que va entre `$$`, así
// que el cuerpo de la función llega con sus comentarios. Para las mayoría de las
// reglas eso es una ventaja —una tabla prohibida nombrada en un comentario sigue
// siendo una señal—, pero para las que buscan CÓDIGO es una trampa: el cuerpo
// explica en un comentario que «con `p_items = '[]'` este INSERT no produce
// ninguna fila», y una regla que vetase esa comparación se dispararía contra su
// propia documentación. Este helper quita los comentarios de línea respetando las
// cadenas, para poder distinguir lo que se ejecuta de lo que sólo se explica.
const sinComentarios = (s) => {
  let salida = "";
  let enCadena = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (enCadena) {
      salida += c;
      if (c === "'") {
        if (s[i + 1] === "'") {
          salida += s[i + 1];
          i += 2;
          continue;
        }
        enCadena = false;
      }
      i += 1;
      continue;
    }
    if (c === "'") {
      enCadena = true;
      salida += c;
      i += 1;
      continue;
    }
    if (c === "-" && s[i + 1] === "-") {
      while (i < s.length && s[i] !== "\n") i += 1;
      continue; // el \n se copia en la vuelta siguiente
    }
    salida += c;
    i += 1;
  }
  return salida;
};

const FIRMA = "public.replace_budget_items(uuid, jsonb)";

const COLUMNAS_ESPERADAS = [
  "budget_id",
  "sort_order",
  "concept",
  "description",
  "quantity",
  "unit",
  "category",
  "chapter",
  "unit_price",
  "subtotal",
  "canonical_id",
  "canonical_status",
  "canonical_confidence",
  "canonical_source",
  "canonical_origin",
  "canonical_source_ref",
  "price_type",
];

// ---------------------------------------------------------------------------
// Análisis: trocea el fichero y aísla las piezas que cada verificador necesita.
// ---------------------------------------------------------------------------
function analizar(sql) {
  const statements = trocearStatements(sql);

  const creacion = statements.find((s) =>
    /create\s+or\s+replace\s+function\s+public\.replace_budget_items/i.test(s),
  );
  if (!creacion) return null;

  const primerDolar = creacion.indexOf("$$");
  const ultimoDolar = creacion.lastIndexOf("$$");
  if (primerDolar === -1 || ultimoDolar === primerDolar) return null;

  return {
    statements,
    creacion,
    // Firma y atributos: todo lo anterior al cuerpo.
    cabecera: creacion.slice(0, primerDolar),
    // Cuerpo plpgsql. OJO: el troceador conserva íntegro lo que va entre `$$`,
    // comentarios incluidos, así que las aserciones de ausencia sobre el cuerpo
    // también cazan una tabla prohibida nombrada en un comentario interno.
    cuerpo: creacion.slice(primerDolar + 2, ultimoDolar),
    comentario: statements.find((s) =>
      /comment\s+on\s+function\s+public\.replace_budget_items/i.test(s),
    ),
  };
}

// ---------------------------------------------------------------------------
// Verificadores. Cada uno es una función pura texto -> booleano, y se usa dos
// veces: contra el fichero real (BLOQUE A) y contra un mutante (BLOQUE B).
// ---------------------------------------------------------------------------
const CONTRATO = {
  "firma y tipo de retorno": (sql) => {
    const a = analizar(sql);
    if (!a) return false;
    const c = bajo(a.cabecera);
    return (
      /create or replace function public\.replace_budget_items\( p_budget_id uuid, p_items jsonb \)/.test(c) &&
      /returns integer/.test(c)
    );
  },

  "language plpgsql, volatile y security definer": (sql) => {
    const a = analizar(sql);
    if (!a) return false;
    const c = bajo(a.cabecera);
    return /language plpgsql/.test(c) && /\bvolatile\b/.test(c) && /security definer/.test(c);
  },

  "search_path fijado a public, pg_temp": (sql) => {
    const a = analizar(sql);
    if (!a) return false;
    return /set search_path = public, pg_temp/.test(bajo(a.cabecera));
  },

  // Con STRICT, un argumento NULL devolvería NULL sin ejecutar el cuerpo: el
  // error del llamador se volvería un no-op mudo.
  "no se declara STRICT": (sql) => {
    const a = analizar(sql);
    if (!a) return false;
    return !/\bstrict\b/i.test(a.cabecera);
  },

  "rechaza p_budget_id nulo con 22004": (sql) => {
    const a = analizar(sql);
    if (!a) return false;
    return /if\s+p_budget_id\s+is\s+null\s+then[\s\S]{0,400}?errcode\s*=\s*'22004'/i.test(a.cuerpo);
  },

  "rechaza p_items nulo con 22004, por separado": (sql) => {
    const a = analizar(sql);
    if (!a) return false;
    return /if\s+p_items\s+is\s+null\s+then[\s\S]{0,400}?errcode\s*=\s*'22004'/i.test(a.cuerpo);
  },

  "rechaza p_items que no sea array con 22023": (sql) => {
    const a = analizar(sql);
    if (!a) return false;
    return /jsonb_typeof\s*\(\s*p_items\s*\)\s*<>\s*'array'[\s\S]{0,500}?errcode\s*=\s*'22023'/i.test(
      a.cuerpo,
    );
  },

  "exige auth.uid() y rechaza su ausencia con 42501": (sql) => {
    const a = analizar(sql);
    if (!a) return false;
    return (
      /auth\.uid\s*\(\s*\)/i.test(a.cuerpo) &&
      /if\s+v_user_id\s+is\s+null\s+then[\s\S]{0,400}?errcode\s*=\s*'42501'/i.test(a.cuerpo)
    );
  },

  "comprueba propiedad y deleted_at y bloquea con FOR UPDATE": (sql) => {
    const a = analizar(sql);
    if (!a) return false;
    return /from\s+public\.budgets[\s\S]{0,500}?user_id\s*=\s*v_user_id[\s\S]{0,300}?deleted_at\s+is\s+null[\s\S]{0,300}?for\s+update/i.test(
      a.cuerpo,
    );
  },

  // Los tres casos —inexistente, ajeno, borrado— caen en la MISMA consulta y en
  // la MISMA rama `not found`, así que estructuralmente no pueden distinguirse.
  "un único 42501 indistinguible para inexistente, ajeno y borrado": (sql) => {
    const a = analizar(sql);
    if (!a) return false;
    const ramas = a.cuerpo.match(/not\s+found/gi) || [];
    return (
      ramas.length === 1 &&
      /if\s+not\s+found\s+then[\s\S]{0,400}?errcode\s*=\s*'42501'/i.test(a.cuerpo)
    );
  },

  "valida que cada elemento sea objeto y traiga concept, quantity y unit_price": (sql) => {
    const a = analizar(sql);
    if (!a) return false;
    const c = a.cuerpo;
    const castsGuardados = (c.match(/invalid_text_representation/gi) || []).length;
    return (
      /jsonb_typeof\s*\(\s*v_item\s*\)\s*<>\s*'object'/i.test(c) &&
      /btrim\s*\(\s*coalesce\s*\(\s*v_item->>'concept'/i.test(c) &&
      /v_item->>'quantity'\s+is\s+null/i.test(c) &&
      /v_item->>'unit_price'\s+is\s+null/i.test(c) &&
      castsGuardados === 2
    );
  },

  // 2F-1 no puede convertir en fallo un guardado que hoy funciona. La tabla no
  // tiene CHECK sobre quantity ni unit_price, así que el cero es legal.
  // El umbral puede colarse de dos maneras y las dos cuentan. La DIRECTA vuelve a
  // nombrar la columna o la clave JSON junto al cero. La INDIRECTA aplica el
  // umbral a la variable que acaba de recibir el cast —`if v_numero <= 0 then`—
  // y no menciona `quantity` ni `unit_price` en ninguna parte. La segunda es la
  // forma natural de escribirlo dentro del bucle, así que un verificador que sólo
  // mire los nombres de columna deja pasar justo la regresión más probable.
  //
  // Por eso la regla es más ancha: en el cuerpo no puede haber NINGUNA comparación
  // de orden contra el literal cero. El cuerpo real no tiene ninguna —`<>` aparece
  // sólo en los dos `jsonb_typeof(...) <> '...'`, y la única igualdad es contra
  // 'NaN'::numeric, que no es un umbral— de modo que la regla ancha no produce
  // falsos positivos aquí.
  "no introduce reglas nuevas contra cantidad o precio cero": (sql) => {
    const a = analizar(sql);
    if (!a) return false;
    const limpio = sinFlechas(sinComentarios(a.cuerpo));
    const comparaciones = [
      // Directa, en cualquiera de los dos órdenes.
      /(quantity|unit_price)[^\n]{0,120}?(<=|>=|<|>)\s*0/i,
      /0\s*(<=|>=|<|>)[^\n]{0,120}?(quantity|unit_price)/i,
      // Indirecta: cualquier comparación de orden contra cero, se llame como se
      // llame el operando. `(?!=)` evita leer `<>` como `<`, y `(?![\d.])` evita
      // confundir el cero con el primer dígito de otro número.
      /(<=|>=|<(?![=>])|>(?!=))\s*0(?![\d.])/,
      /\b0(?![\d.])\s*(<=|>=|<(?![=>])|>(?!=))/,
    ];
    return !comparaciones.some((re) => re.test(limpio));
  },

  // `[]` es una petición legítima. Rechazarlo se puede escribir contando
  // (`jsonb_array_length`) o comparando el propio parámetro con el array vacío,
  // en cualquiera de los dos órdenes. Las tres formas se vetan aquí.
  "acepta el array vacío: no hay guarda de longitud": (sql) => {
    const a = analizar(sql);
    if (!a) return false;
    const c = sinComentarios(a.cuerpo);
    const guardas = [
      /jsonb_array_length/i,
      // p_items = '[]'::jsonb  /  p_items::text = '[]'  /  p_items <> '[]'
      /p_items\s*(::\s*\w+\s*)?(=|<>|!=)\s*'\[\s*\]'/i,
      // '[]'::jsonb = p_items  (forma simétrica)
      /'\[\s*\]'\s*(::\s*\w+\s*)?(=|<>|!=)\s*p_items/i,
    ];
    return !guardas.some((re) => re.test(c));
  },

  // Contar no basta: un DELETE y un INSERT en el orden inverso siguen siendo uno
  // de cada, pero borrarían las filas recién insertadas y dejarían el presupuesto
  // vacío. El orden ES el contrato, así que se comprueban las posiciones reales.
  "un único DELETE y un único INSERT, en ese orden, sin control de transacción interno": (sql) => {
    const a = analizar(sql);
    if (!a) return false;
    const borrados = a.cuerpo.match(/delete\s+from\s+public\.budget_items/gi) || [];
    const insertados = a.cuerpo.match(/insert\s+into\s+public\.budget_items/gi) || [];
    if (borrados.length !== 1 || insertados.length !== 1) return false;

    // Con exactamente una ocurrencia de cada uno, la primera coincidencia ES la
    // única, así que estas posiciones no son aproximaciones.
    const posDelete = a.cuerpo.search(/delete\s+from\s+public\.budget_items/i);
    const posInsert = a.cuerpo.search(/insert\s+into\s+public\.budget_items/i);
    if (posDelete === -1 || posInsert === -1) return false;
    if (!(posDelete < posInsert)) return false;

    return !/^\s*(commit|rollback)\s*;/im.test(a.cuerpo);
  },

  "budget_id sale del parámetro y nunca del JSON": (sql) => {
    const a = analizar(sql);
    if (!a) return false;
    return (
      /select\s+p_budget_id\s*,/i.test(a.cuerpo) &&
      !/->>\s*'budget_id'/i.test(a.cuerpo)
    );
  },

  "sort_order sale de WITH ORDINALITY empezando en cero y nunca del JSON": (sql) => {
    const a = analizar(sql);
    if (!a) return false;
    return (
      /with\s+ordinality/i.test(a.cuerpo) &&
      /\(\s*t\.ordinality\s*-\s*1\s*\)::integer/i.test(a.cuerpo) &&
      !/->>\s*'sort_order'/i.test(a.cuerpo)
    );
  },

  // La divergencia monetaria deliberada con `update_budget_with_items`.
  "subtotal se transporta y sólo se calcula si falta": (sql) => {
    const a = analizar(sql);
    if (!a) return false;
    return /coalesce\s*\(\s*\(\s*nullif\s*\(\s*t\.item->>'subtotal'\s*,\s*''\s*\)\s*\)::numeric\s*,\s*round\s*\(/i.test(
      a.cuerpo,
    );
  },

  "el mapa de columnas es exactamente el acordado y en orden": (sql) => {
    const a = analizar(sql);
    if (!a) return false;
    const m = a.cuerpo.match(/insert\s+into\s+public\.budget_items\s*\(([\s\S]*?)\)/i);
    if (!m) return false;
    const columnas = m[1]
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c !== "");
    return (
      columnas.length === COLUMNAS_ESPERADAS.length &&
      columnas.every((c, i) => c === COLUMNAS_ESPERADAS[i])
    );
  },

  "no modifica ninguna fila de budgets": (sql) => {
    const a = analizar(sql);
    if (!a) return false;
    const escrituras = /(update|insert\s+into|delete\s+from|truncate)\s+(public\.)?budgets\b/i;
    const referencias = a.cuerpo.match(/public\.budgets\b/gi) || [];
    return !escrituras.test(a.cuerpo) && referencias.length === 1;
  },

  "no nombra budget_snapshots, document_versions ni activity_log": (sql) => {
    const a = analizar(sql);
    if (!a) return false;
    return !/(budget_snapshots|document_versions|activity_log)/i.test(a.cuerpo);
  },

  "sin SQL dinámico ni triggers": (sql) => {
    const a = analizar(sql);
    if (!a) return false;
    return (
      !/\bexecute\b/i.test(a.cuerpo) &&
      !/\bformat\s*\(/i.test(a.cuerpo) &&
      !/create\s+(or\s+replace\s+)?trigger/i.test(sql)
    );
  },

  "devuelve el número real de filas insertadas": (sql) => {
    const a = analizar(sql);
    if (!a) return false;
    return (
      /get\s+diagnostics\s+v_insertadas\s*=\s*row_count/i.test(a.cuerpo) &&
      /return\s+v_insertadas\s*;/i.test(a.cuerpo) &&
      !/return\s+\d+\s*;/i.test(a.cuerpo)
    );
  },

  "documenta el contrato y la decisión sobre subtotal": (sql) => {
    const a = analizar(sql);
    if (!a || !a.comentario) return false;
    const c = a.comentario.toLowerCase();
    return c.includes("subtotal") && c.includes("divergencia");
  },

  // PUBLIC no es un rol ordinario: no se consulta como tal, se comprueba que el
  // fichero contiene su REVOKE explícito. `create or replace` conserva la ACL
  // previa y PostgreSQL concede EXECUTE a PUBLIC por defecto, así que sin este
  // statement el resultado dependería del estado anterior de la base.
  "ACL absoluta: revoca a PUBLIC, anon y service_role": (sql) => {
    const a = analizar(sql);
    if (!a) return false;
    const revocados = ["public", "anon", "service_role"].map((rol) =>
      a.statements.some(
        (s) => bajo(s) === `revoke all on function ${FIRMA} from ${rol}`.toLowerCase(),
      ),
    );
    return revocados.every(Boolean);
  },

  "ACL absoluta: concede EXECUTE sólo a authenticated": (sql) => {
    const a = analizar(sql);
    if (!a) return false;
    const concesiones = a.statements.filter((s) => /^grant\b/i.test(norm(s)));
    return (
      concesiones.length === 1 &&
      bajo(concesiones[0]) === `grant execute on function ${FIRMA} to authenticated`.toLowerCase()
    );
  },

  "el último statement es el NOTIFY a PostgREST": (sql) => {
    const a = analizar(sql);
    if (!a) return false;
    const ultimo = a.statements[a.statements.length - 1];
    return bajo(ultimo) === "notify pgrst, 'reload schema'";
  },

  "sin control de transacción de nivel superior ni directiva": (sql) => {
    if (detectarControlTransaccion(sql).length > 0) return false;
    return !sql
      .split("\n")
      .map((l) => l.trim().toLowerCase())
      .includes("-- pg-delta: transaction=false");
  },
};

// ---------------------------------------------------------------------------
// Mutaciones. Cada una introduce UNA regresión concreta.
// ---------------------------------------------------------------------------
const MUTACIONES = [
  {
    // El tipo de retorno es contrato: `integer` es lo que permite al llamador
    // afirmar el éxito contando filas en vez de deducirlo de la ausencia de error.
    verificador: "firma y tipo de retorno",
    descripcion: "se cambia el tipo de retorno",
    mutar: (s) => s.replace("returns integer\nlanguage plpgsql", "returns bigint\nlanguage plpgsql"),
  },
  {
    verificador: "no se declara STRICT",
    descripcion: "se añade STRICT a la firma",
    mutar: (s) => s.replace("returns integer\nlanguage plpgsql", "returns integer\nstrict\nlanguage plpgsql"),
  },
  {
    verificador: "language plpgsql, volatile y security definer",
    descripcion: "se degrada a security invoker",
    mutar: (s) => s.replace("\nvolatile\nsecurity definer\n", "\nvolatile\nsecurity invoker\n"),
  },
  {
    verificador: "search_path fijado a public, pg_temp",
    descripcion: "se elimina el search_path",
    mutar: (s) => s.replace("\nset search_path = public, pg_temp\nas $$", "\nas $$"),
  },
  {
    verificador: "rechaza p_budget_id nulo con 22004",
    descripcion: "se neutraliza la guarda de p_budget_id",
    mutar: (s) => s.replace("if p_budget_id is null then", "if false then"),
  },
  {
    verificador: "rechaza p_items nulo con 22004, por separado",
    descripcion: "se neutraliza la guarda de p_items",
    mutar: (s) => s.replace("if p_items is null then", "if false then"),
  },
  {
    verificador: "rechaza p_items que no sea array con 22023",
    descripcion: "se acepta cualquier tipo de JSON",
    mutar: (s) => s.replace("jsonb_typeof(p_items) <> 'array'", "false"),
  },
  {
    verificador: "exige auth.uid() y rechaza su ausencia con 42501",
    descripcion: "se permite ejecutar sin sesión",
    mutar: (s) => s.replace("if v_user_id is null then", "if false then"),
  },
  {
    verificador: "comprueba propiedad y deleted_at y bloquea con FOR UPDATE",
    descripcion: "se elimina el FOR UPDATE",
    mutar: (s) => s.replace("\n     for update;", ";"),
  },
  {
    verificador: "comprueba propiedad y deleted_at y bloquea con FOR UPDATE",
    descripcion: "se deja de excluir los presupuestos borrados",
    mutar: (s) => s.replace("and b.deleted_at is null", "and true"),
  },
  {
    verificador: "un único 42501 indistinguible para inexistente, ajeno y borrado",
    descripcion: "se elimina la rama not found",
    mutar: (s) => s.replace("if not found then", "if false then"),
  },
  {
    verificador: "valida que cada elemento sea objeto y traiga concept, quantity y unit_price",
    descripcion: "se deja de exigir que el elemento sea un objeto",
    mutar: (s) => s.replace("jsonb_typeof(v_item) <> 'object'", "false"),
  },
  {
    verificador: "no introduce reglas nuevas contra cantidad o precio cero",
    descripcion: "se cuela un umbral directo sobre quantity",
    mutar: (s) =>
      s.replace(
        "    if v_item->>'unit_price' is null then",
        "    if (v_item->>'quantity')::numeric <= 0 then\n" +
          "      raise exception 'umbral colado' using errcode = '22023';\n" +
          "    end if;\n" +
          "    if v_item->>'unit_price' is null then",
      ),
  },
  {
    // Umbral INDIRECTO sobre quantity: se aplica a `v_numero`, que acaba de
    // recibir el cast de quantity, y no se nombra la columna en ninguna parte.
    // Es la forma que se le escapaba al verificador anterior.
    verificador: "no introduce reglas nuevas contra cantidad o precio cero",
    descripcion: "se cuela un umbral indirecto «if v_numero <= 0» tras el cast de quantity",
    mutar: (s) =>
      s.replace(
        "    if v_numero = 'NaN'::numeric then\n" +
          "      raise exception 'replace_budget_items: el elemento % tiene quantity = NaN',",
        "    if v_numero <= 0 then\n" +
          "      raise exception 'umbral indirecto colado' using errcode = '22023';\n" +
          "    end if;\n" +
          "    if v_numero = 'NaN'::numeric then\n" +
          "      raise exception 'replace_budget_items: el elemento % tiene quantity = NaN',",
      ),
  },
  {
    // El mismo umbral indirecto, pero tras el cast de unit_price. Va aparte a
    // propósito: son dos anclajes distintos y una mutación sola no probaría que
    // el verificador cubre las dos ramas del bucle.
    verificador: "no introduce reglas nuevas contra cantidad o precio cero",
    descripcion: "se cuela un umbral indirecto «if v_numero <= 0» tras el cast de unit_price",
    mutar: (s) =>
      s.replace(
        "    if v_numero = 'NaN'::numeric then\n" +
          "      raise exception 'replace_budget_items: el elemento % tiene unit_price = NaN',",
        "    if v_numero <= 0 then\n" +
          "      raise exception 'umbral indirecto colado' using errcode = '22023';\n" +
          "    end if;\n" +
          "    if v_numero = 'NaN'::numeric then\n" +
          "      raise exception 'replace_budget_items: el elemento % tiene unit_price = NaN',",
      ),
  },
  {
    verificador: "acepta el array vacío: no hay guarda de longitud",
    descripcion: "se rechaza el array vacío contando elementos",
    mutar: (s) =>
      s.replace(
        "  delete from public.budget_items",
        "  if jsonb_array_length(p_items) = 0 then\n" +
          "    raise exception 'vacio' using errcode = '22023';\n" +
          "  end if;\n\n" +
          "  delete from public.budget_items",
      ),
  },
  {
    // Misma regresión, escrita sin contar: comparación directa con el array
    // vacío. No aparece `jsonb_array_length` por ningún sitio.
    verificador: "acepta el array vacío: no hay guarda de longitud",
    descripcion: "se rechaza el array vacío comparando p_items = '[]'::jsonb",
    mutar: (s) =>
      s.replace(
        "  delete from public.budget_items",
        "  if p_items = '[]'::jsonb then\n" +
          "    raise exception 'vacio' using errcode = '22023';\n" +
          "  end if;\n\n" +
          "  delete from public.budget_items",
      ),
  },
  {
    verificador: "acepta el array vacío: no hay guarda de longitud",
    descripcion: "se rechaza el array vacío en la forma simétrica '[]'::jsonb = p_items",
    mutar: (s) =>
      s.replace(
        "  delete from public.budget_items",
        "  if '[]'::jsonb = p_items then\n" +
          "    raise exception 'vacio' using errcode = '22023';\n" +
          "  end if;\n\n" +
          "  delete from public.budget_items",
      ),
  },
  {
    verificador: "un único DELETE y un único INSERT, en ese orden, sin control de transacción interno",
    descripcion: "se duplica el DELETE",
    mutar: (s) =>
      s.replace(
        "  delete from public.budget_items\n   where budget_id = p_budget_id;",
        "  delete from public.budget_items\n   where budget_id = p_budget_id;\n" +
          "  delete from public.budget_items\n   where budget_id = p_budget_id;",
      ),
  },
  {
    // Uno de cada, pero al revés: el DELETE se lleva por delante las filas que
    // el INSERT acaba de escribir. Contar ocurrencias no lo caza; comparar
    // posiciones sí.
    verificador: "un único DELETE y un único INSERT, en ese orden, sin control de transacción interno",
    descripcion: "se intercambia el orden y el DELETE queda después del INSERT",
    mutar: (s) => {
      const bloqueDelete = "  delete from public.budget_items\n   where budget_id = p_budget_id;\n";
      const finInsert = "    from jsonb_array_elements(p_items) with ordinality as t(item, ordinality);";
      return s.replace(bloqueDelete, "").replace(finInsert, `${finInsert}\n\n${bloqueDelete.trimEnd()}`);
    },
  },
  {
    verificador: "budget_id sale del parámetro y nunca del JSON",
    descripcion: "se toma el budget_id del elemento JSON",
    mutar: (s) => s.replace("select p_budget_id,", "select (t.item->>'budget_id')::uuid,"),
  },
  {
    verificador: "sort_order sale de WITH ORDINALITY empezando en cero y nunca del JSON",
    descripcion: "se toma el sort_order del elemento JSON",
    mutar: (s) => s.replace("(t.ordinality - 1)::integer,", "(t.item->>'sort_order')::integer,"),
  },
  {
    verificador: "subtotal se transporta y sólo se calcula si falta",
    descripcion: "se recalcula siempre el subtotal, cambiando importes",
    mutar: (s) =>
      s.replace(
        "         coalesce(\n" +
          "           (nullif(t.item->>'subtotal', ''))::numeric,\n" +
          "           round((t.item->>'quantity')::numeric * (t.item->>'unit_price')::numeric, 2)\n" +
          "         ),",
        "         round((t.item->>'quantity')::numeric * (t.item->>'unit_price')::numeric, 2),",
      ),
  },
  {
    verificador: "el mapa de columnas es exactamente el acordado y en orden",
    descripcion: "se pierde una columna del INSERT",
    mutar: (s) => s.replace("    chapter,\n", ""),
  },
  {
    verificador: "no modifica ninguna fila de budgets",
    descripcion: "se cuela un UPDATE de la cabecera",
    mutar: (s) =>
      s.replace(
        "  delete from public.budget_items",
        "  update public.budgets set updated_at = now() where id = p_budget_id;\n\n" +
          "  delete from public.budget_items",
      ),
  },
  {
    verificador: "no nombra budget_snapshots, document_versions ni activity_log",
    descripcion: "se cuela un registro de actividad",
    mutar: (s) =>
      s.replace(
        "  delete from public.budget_items",
        "  insert into public.activity_log (action) values ('items.replaced');\n\n" +
          "  delete from public.budget_items",
      ),
  },
  {
    verificador: "sin SQL dinámico ni triggers",
    descripcion: "se cuela SQL dinámico",
    mutar: (s) =>
      s.replace(
        "  delete from public.budget_items",
        "  execute 'select 1';\n\n  delete from public.budget_items",
      ),
  },
  {
    verificador: "devuelve el número real de filas insertadas",
    descripcion: "se devuelve una constante en vez del row_count",
    mutar: (s) => s.replace("return v_insertadas;", "return 0;"),
  },
  {
    verificador: "documenta el contrato y la decisión sobre subtotal",
    descripcion: "se vacía el comentario de la función",
    mutar: (s) =>
      s.replace(
        /comment on function public\.replace_budget_items\(uuid, jsonb\) is[\s\S]*?;\n/,
        "comment on function public.replace_budget_items(uuid, jsonb) is 'sin documentar';\n",
      ),
  },
  {
    verificador: "ACL absoluta: revoca a PUBLIC, anon y service_role",
    descripcion: "se omite el REVOKE de PUBLIC",
    mutar: (s) =>
      s.replace(
        "revoke all on function public.replace_budget_items(uuid, jsonb)\n  from public;\n",
        "",
      ),
  },
  {
    verificador: "ACL absoluta: concede EXECUTE sólo a authenticated",
    descripcion: "se concede EXECUTE también a anon",
    mutar: (s) =>
      s.replace(
        "grant execute on function public.replace_budget_items(uuid, jsonb)\n  to authenticated;",
        "grant execute on function public.replace_budget_items(uuid, jsonb)\n  to anon;\n" +
          "grant execute on function public.replace_budget_items(uuid, jsonb)\n  to authenticated;",
      ),
  },
  {
    verificador: "el último statement es el NOTIFY a PostgREST",
    descripcion: "se añade un statement después del NOTIFY",
    mutar: (s) => `${s}\nselect 1;\n`,
  },
  {
    verificador: "sin control de transacción de nivel superior ni directiva",
    descripcion: "se abre una transacción de nivel superior",
    mutar: (s) => `begin;\n${s}`,
  },
  {
    verificador: "sin control de transacción de nivel superior ni directiva",
    descripcion: "se añade la directiva que desactiva la transacción del runner",
    mutar: (s) => `-- pg-delta: transaction=false\n${s}`,
  },
];

// ---------------------------------------------------------------------------
// BLOQUE A — el contrato sobre el fichero real
// ---------------------------------------------------------------------------
describe("FASE 2F-1DB · BLOQUE A — contrato de replace_budget_items", () => {
  test("la migración existe y se trocea en los siete statements esperados", () => {
    const a = analizar(SQL);
    assert.ok(a, "no se ha podido aislar el CREATE FUNCTION");
    assert.equal(
      a.statements.length,
      7,
      `se esperaban 7 statements de nivel superior y hay ${a.statements.length}: ` +
        a.statements.map((s) => bajo(s).slice(0, 40)).join(" | "),
    );
  });

  for (const [nombre, verificador] of Object.entries(CONTRATO)) {
    test(nombre, () => {
      assert.equal(verificador(SQL), true, `el fichero real incumple: ${nombre}`);
    });
  }
});

// ---------------------------------------------------------------------------
// BLOQUE B — controles negativos
// ---------------------------------------------------------------------------
describe("FASE 2F-1DB · BLOQUE B — controles negativos", () => {
  for (const { verificador, descripcion, mutar } of MUTACIONES) {
    test(`«${verificador}» detecta la regresión: ${descripcion}`, () => {
      const fn = CONTRATO[verificador];
      assert.ok(fn, `no existe el verificador «${verificador}»`);

      const mutante = mutar(SQL);
      // Sin esta comprobación, una mutación cuyo anclaje no case dejaría el texto
      // intacto y el control negativo pasaría por casualidad, sin probar nada.
      assert.notEqual(mutante, SQL, "la mutación no ha modificado el texto: anclaje roto");

      assert.equal(fn(SQL), true, "el verificador debería aceptar el fichero real");
      assert.equal(fn(mutante), false, "el verificador NO ha detectado la regresión");
    });
  }

  // La cobertura se calcula, no se afirma. Si alguien añade un verificador y se
  // olvida del mutante, o apunta una mutación a un nombre que ya no existe, este
  // test lo dice; y la cabecera del fichero deja de poder mentir sin fallar.
  test("la cobertura de mutaciones es la declarada", () => {
    const nombres = Object.keys(CONTRATO);

    for (const { verificador } of MUTACIONES) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(CONTRATO, verificador),
        `la mutación apunta a un verificador inexistente: «${verificador}»`,
      );
    }

    const cubiertos = new Set(MUTACIONES.map((m) => m.verificador));
    const sinMutante = nombres.filter((n) => !cubiertos.has(n));
    assert.deepEqual(
      sinMutante,
      [],
      `verificadores sin ningún control negativo: ${sinMutante.join(" | ")}`,
    );

    // Reparto real, comprobado: hay más mutaciones que verificadores porque cinco
    // de ellos tienen varias. Los números concretos se afirman para que un recorte
    // silencioso de la cobertura rompa el test en vez de pasar inadvertido.
    const porVerificador = new Map();
    for (const { verificador } of MUTACIONES) {
      porVerificador.set(verificador, (porVerificador.get(verificador) ?? 0) + 1);
    }
    const conVarias = [...porVerificador.entries()]
      .filter(([, n]) => n > 1)
      .map(([nombre, n]) => `${nombre} ×${n}`)
      .sort();

    assert.equal(nombres.length, 27, "el número de verificadores ha cambiado");
    assert.equal(MUTACIONES.length, 34, "el número de mutaciones ha cambiado");
    assert.deepEqual(conVarias.length, 5, `verificadores con más de un mutante: ${conVarias.join(" | ")}`);
  });
});

// ---------------------------------------------------------------------------
// BLOQUE C — encaje con el resto del historial de migraciones
// ---------------------------------------------------------------------------
describe("FASE 2F-1DB · BLOQUE C — encaje en el historial", () => {
  const ficheros = readdirSync(join(RAIZ, DIR_MIGRACIONES))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  test("el fichero está en supabase/migrations y es el último por timestamp", () => {
    assert.ok(ficheros.includes(FICHERO), `${FICHERO} no está en ${DIR_MIGRACIONES}`);
    assert.equal(
      ficheros[ficheros.length - 1],
      FICHERO,
      "la migración nueva debe ordenarse la última; si no, el CLI no la aplicará después del resto",
    );
  });

  test("es la única migración que define replace_budget_items", () => {
    const definidoras = ficheros.filter((f) =>
      /create\s+or\s+replace\s+function\s+public\.replace_budget_items/i.test(
        readFileSync(join(RAIZ, DIR_MIGRACIONES, f), "utf8"),
      ),
    );
    assert.deepEqual(definidoras, [FICHERO]);
  });

  // Si esta migración tocase update_budget_with_items rompería el CASO M4b de
  // `budget-items-sort-order-migration.test.mjs`, que exige que 20260901120000
  // siga siendo la última que la define. 2F-1DB es estrictamente aditiva.
  //
  // OJO CON EL ANCLAJE: el fichero SÍ nombra `update_budget_with_items`, en la
  // cabecera y dentro del literal de `comment on function`, porque documentar
  // las cuatro divergencias es parte del contrato pedido. Eso es documentación,
  // no una redefinición. Buscar la cadena en el texto crudo confunde ambas
  // cosas, así que la comprobación se ancla en lo que Postgres ejecuta: el
  // statement troceado y sin comentarios, y el cuerpo de la función.
  test("no redefine update_budget_with_items ni altera ninguna tabla", () => {
    const { statements, cuerpo } = analizar(SQL);

    const redefiniciones = statements.filter((s) =>
      /^\s*create\s+(or\s+replace\s+)?function\s+public\.update_budget_with_items/i.test(s),
    );
    assert.deepEqual(
      redefiniciones,
      [],
      "2F-1DB no debe redefinir update_budget_with_items: rompería el CASO M4b de budget-items-sort-order-migration",
    );

    const ddl = statements.filter((s) => /^\s*(alter\s+table|create\s+table|drop)\b/i.test(s));
    assert.deepEqual(
      ddl,
      [],
      "2F-1DB es aditiva: crea una función y ajusta su ACL, no toca el esquema de ninguna tabla",
    );

    // Ni DDL encubierto dentro del cuerpo, donde el troceador conserva los
    // comentarios y por tanto una regla sobre el texto sí es fiable.
    assert.equal(
      /\b(alter\s+table|create\s+table|drop\s+(table|function|index|trigger))\b/i.test(cuerpo),
      false,
      "el cuerpo de la función no debe contener DDL",
    );

    // Control negativo: si el anclaje anterior dejara de morder, este DDL
    // colado justo antes de la función pasaría inadvertido.
    const mutante = SQL.replace(
      "create or replace function public.replace_budget_items(",
      "alter table public.budget_items add column colada integer;\n\ncreate or replace function public.replace_budget_items(",
    );
    assert.notEqual(mutante, SQL, "la mutación no ha modificado el texto: anclaje roto");
    assert.equal(
      trocearStatements(mutante).some((s) => /^\s*(alter\s+table|create\s+table|drop)\b/i.test(s)),
      true,
      "el filtro de DDL no detecta un ALTER TABLE colado en la migración",
    );
  });

  // FASE 2F-1APP — la puerta temporal que había aquí («ningún fichero de
  // aplicación invoca todavía la RPC») ya no describe la realidad: la
  // aplicación la invoca desde esta fase. En su lugar quedan seis invariantes
  // positivas, que dicen no ya *si* se usa, sino *cómo*: por un único punto,
  // desde un único consumidor y sin que sobreviva ningún escritor directo.
  //
  // Es un cambio de signo deliberado, no una relajación: la puerta anterior
  // solo podía romperse adelantando la publicación; estas se rompen si alguien
  // dispersa el nombre de la RPC, duplica el helper o reintroduce el par
  // DELETE + INSERT que 2F-1APP vino a eliminar.
  const DIRECTORIOS_APP = ["app", "lib", "components", "hooks", "providers"];
  const IGNORADOS = new Set(["node_modules", ".next", ".git", ".claude", ".test-out", "__tests__"]);
  const HELPER = "lib/budget-items-writer.ts";
  const PROVIDER = "app/dashboard/budgets/generate/_components/BudgetGenerateProvider.tsx";

  /** Recorre el código de aplicación y devuelve rutas relativas a la raíz. */
  function ficherosDeAplicacion() {
    const encontrados = [];
    const visitar = (relativo) => {
      let entradas;
      try {
        entradas = readdirSync(join(RAIZ, relativo), { withFileTypes: true });
      } catch {
        return; // Un directorio ausente no es un incumplimiento del contrato.
      }
      for (const entrada of entradas) {
        if (IGNORADOS.has(entrada.name)) continue;
        const ruta = `${relativo}/${entrada.name}`;
        if (entrada.isDirectory()) visitar(ruta);
        else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entrada.name)) encontrados.push(ruta);
      }
    };
    for (const dir of DIRECTORIOS_APP) visitar(dir);
    return encontrados;
  }

  const leer = (ruta) => readFileSync(join(RAIZ, ruta), "utf8");
  const cuenta = (texto, aguja) => texto.split(aguja).length - 1;

  test("INVARIANTE 1 — el nombre de la RPC solo aparece en el helper", () => {
    const nombran = ficherosDeAplicacion().filter((ruta) => /replace_budget_items/.test(leer(ruta)));
    assert.deepEqual(
      nombran.sort(),
      [HELPER],
      "el nombre de la función SQL debe existir en un único punto del código de aplicación",
    );
  });

  test("INVARIANTE 2 — el helper invoca la RPC una sola vez", () => {
    const helper = leer(HELPER);
    assert.equal(cuenta(helper, "supabase.rpc("), 1, "una única invocación, sin caminos alternativos");
    assert.ok(
      helper.includes('export const REPLACE_BUDGET_ITEMS_RPC = "replace_budget_items";'),
      "el nombre debe estar declarado una vez y reutilizado",
    );
    assert.equal(
      cuenta(helper, '"replace_budget_items"'),
      1,
      "el literal no debe repetirse: la constante es la única fuente",
    );
    assert.ok(helper.includes("supabase.rpc(REPLACE_BUDGET_ITEMS_RPC, {"), "debe llamarse a través de la constante");
  });

  test("INVARIANTE 3 — solo el Provider importa el helper", () => {
    const importadores = ficherosDeAplicacion().filter(
      (ruta) => ruta !== HELPER && /budget-items-writer/.test(leer(ruta)),
    );
    assert.deepEqual(
      importadores.sort(),
      [PROVIDER],
      "ampliar el conjunto de consumidores es una decisión de diseño, no un detalle",
    );
  });

  test("INVARIANTE 4 — el Provider lo invoca exactamente dos veces", () => {
    // Una en el guardado de borrador y otra en la finalización: son los dos
    // únicos momentos en que el asistente escribe las líneas.
    assert.equal(cuenta(leer(PROVIDER), "replaceBudgetItems("), 2);
  });

  test("INVARIANTE 5 — ningún otro escritor ha adoptado la RPC", () => {
    const otros = [
      "app/dashboard/budgets/generate/_components/LiveSummaryPanel.tsx",
      "app/dashboard/budgets/generate/page.tsx",
      "app/dashboard/budgets/_components/budget-form.tsx",
      "app/dashboard/budgets/[id]/page.tsx",
    ];
    for (const ruta of otros) {
      const contenido = leer(ruta);
      assert.equal(/replace_budget_items/.test(contenido), false, `${ruta} no debe nombrar la RPC`);
      assert.equal(/budget-items-writer/.test(contenido), false, `${ruta} no debe importar el helper`);
    }
  });

  test("INVARIANTE 6 — el Provider ya no escribe budget_items directamente", () => {
    const provider = leer(PROVIDER);
    assert.equal(
      /\.from\(\s*["'`]budget_items["'`]\s*\)/.test(provider),
      false,
      "el par DELETE + INSERT que podía quedarse a medias ya no existe",
    );
    assert.equal(cuenta(provider, ".delete()"), 0, "no debe quedar ningún borrado suelto");

    // Lo único que puede quedar del nombre de la tabla son comentarios que
    // expliquen por qué ya no se toca. Cualquier mención en código ejecutable
    // sería un camino paralelo al helper.
    const enCodigo = provider
      .split("\n")
      .map((linea, i) => [i + 1, linea])
      .filter(([, linea]) => linea.includes("budget_items"))
      .filter(([, linea]) => !/^\s*(\/\/|\*)/.test(linea));
    assert.deepEqual(
      enCodigo,
      [],
      `budget_items solo puede aparecer en comentarios del Provider; encontrado en: ${enCodigo
        .map(([n]) => n)
        .join(", ")}`,
    );
  });
});
