// FASE 2E-3 — Lectores de partidas ordenados por sort_order
//
// Contexto: 2E-1 dejo escrito `sort_order` en las cinco rutas de escritura y
// 2E-2 lo consolido en la base (NOT NULL, >= 0, UNIQUE por (budget_id,
// sort_order)). Hasta esta fase los lectores seguian ordenando por
// `created_at`, que dentro de un mismo presupuesto es practicamente constante
// —las partidas se insertan en lote, con el mismo now()—, de modo que el orden
// real lo decidia PostgreSQL y no estaba garantizado.
//
// Alcance: SOLO el criterio de orden de las cuatro consultas lectoras de
// `budget_items`. No se tocan escritores, RPC, migraciones ni calculos.
//
// Metodo: inspeccion estatica del codigo fuente real. No hay conexion a
// Supabase ni datos de produccion. Tampoco se implementa una funcion de
// ordenacion en memoria para probarla: la aplicacion no ordena en memoria y
// probar una funcion inventada aqui no diria nada sobre el comportamiento real.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, sep } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (p) => readFileSync(join(RAIZ, p), "utf8");
const norm = (s) => s.replace(/\s+/g, " ");

const F_FORM = "app/dashboard/budgets/_components/budget-form.tsx";
const F_GENERATE = "app/dashboard/budgets/generate/page.tsx";
const F_DETALLE = "app/dashboard/budgets/[id]/page.tsx";
const F_PDF_API = "app/api/budgets/pdf/route.ts";

const LECTORES = [F_FORM, F_GENERATE, F_DETALLE, F_PDF_API];

// ---------------------------------------------------------------------------
// Extraccion de cadenas .from("budget_items")....
// ---------------------------------------------------------------------------
//
// No se usa una expresion regular suelta sobre el fichero entero: eso haria
// que un `.order("created_at", ...)` de otra tabla del mismo fichero pudiera
// producir un PASS o un FAIL falso. Se recorta la cadena de metodos que cuelga
// de cada `.from("budget_items")`, contando parentesis y saltando literales,
// y todas las aserciones se hacen sobre ese recorte.

function recorrerCadena(plano, inicio) {
  const fin = plano.length;
  let j = inicio;
  let finCadena = inicio;

  for (;;) {
    while (j < fin && plano[j] === " ") j += 1;
    if (plano[j] !== ".") break;

    let k = j + 1;
    while (k < fin && /[A-Za-z0-9_$]/.test(plano[k])) k += 1;
    if (k >= fin || plano[k] !== "(") break;

    let profundidad = 0;
    let comilla = null;
    let m = k;
    for (; m < fin; m += 1) {
      const c = plano[m];
      if (comilla) {
        if (c === "\\") {
          m += 1;
          continue;
        }
        if (c === comilla) comilla = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        comilla = c;
        continue;
      }
      if (c === "(") profundidad += 1;
      else if (c === ")") {
        profundidad -= 1;
        if (profundidad === 0) break;
      }
    }
    if (m >= fin) break;

    finCadena = m + 1;
    j = m + 1;
  }

  return plano.slice(inicio, finCadena);
}

// Devuelve todas las cadenas que cuelgan de .from("budget_items") en un fuente.
// Tolera formato multilinea porque normaliza los espacios antes de recorrer.
function cadenasBudgetItems(src) {
  const plano = norm(src);
  const ancla = '.from("budget_items")';
  const cadenas = [];
  let desde = 0;
  for (;;) {
    const i = plano.indexOf(ancla, desde);
    if (i === -1) break;
    cadenas.push(recorrerCadena(plano, i));
    desde = i + ancla.length;
  }
  return cadenas;
}

// Un lector es una cadena que proyecta con .select("*") y filtra por budget_id.
// Los escritores (.insert / .delete / .update / .upsert) quedan fuera aunque
// filtren por budget_id, que es justamente el caso de los dos .delete() del
// provider del asistente.
const esLectura = (cadena) =>
  cadena.includes('.select("*")') &&
  cadena.includes('.eq("budget_id"') &&
  !/\.(insert|update|upsert|delete)\(/.test(cadena);

function lecturaUnica(ruta) {
  const lecturas = cadenasBudgetItems(leer(ruta)).filter(esLectura);
  assert.equal(
    lecturas.length,
    1,
    `${ruta} debe contener exactamente una consulta lectora de budget_items, se han encontrado ${lecturas.length}`,
  );
  return lecturas[0];
}

// ---------------------------------------------------------------------------
// BLOQUE A — cada lector, por separado
// ---------------------------------------------------------------------------

function compruebaLector(ruta) {
  const cadena = lecturaUnica(ruta);

  const iSelect = cadena.indexOf('.select("*")');
  const iEq = cadena.indexOf('.eq("budget_id"');
  const iSort = cadena.indexOf('.order("sort_order", { ascending: true })');
  const iId = cadena.indexOf('.order("id", { ascending: true })');

  assert.notEqual(iSort, -1, `${ruta}: falta .order("sort_order", { ascending: true })`);
  assert.notEqual(iId, -1, `${ruta}: falta el desempate .order("id", { ascending: true })`);

  // Secuencia exacta: select -> budget_id -> sort_order ASC -> id ASC.
  assert.ok(iSelect < iEq, `${ruta}: .select("*") debe preceder al filtro por budget_id`);
  assert.ok(iEq < iSort, `${ruta}: el filtro por budget_id debe preceder al orden`);
  assert.ok(
    iSort < iId,
    `${ruta}: sort_order es el orden principal e id solo el desempate; el encadenado esta invertido`,
  );

  // Exactamente dos criterios de orden: ni uno de mas, ni uno de menos.
  const criterios = cadena.match(/\.order\(/g) || [];
  assert.equal(
    criterios.length,
    2,
    `${ruta}: la consulta lectora debe encadenar exactamente dos .order(), tiene ${criterios.length}`,
  );

  // Prohibicion de created_at dentro de esta consulta, no en todo el fichero:
  // otras tablas del mismo modulo siguen ordenando por created_at con razon.
  assert.doesNotMatch(
    cadena,
    /created_at/,
    `${ruta}: la consulta lectora de budget_items no debe derivar el orden de created_at`,
  );

  return cadena;
}

describe("FASE 2E-3 · lectores de budget_items · BLOQUE A — cada lector ordena por sort_order", () => {
  test("CASO R1 — budget-form.tsx hidrata la edicion por sort_order", () => {
    const cadena = compruebaLector(F_FORM);
    assert.match(cadena, /\.eq\("budget_id", editBudgetId\)/);
  });

  test("CASO R2 — generate/page.tsx exporta el PDF del asistente por sort_order", () => {
    const cadena = compruebaLector(F_GENERATE);
    assert.match(cadena, /\.eq\("budget_id", finalizedId\)/);
  });

  test("CASO R3 — [id]/page.tsx carga el detalle por sort_order", () => {
    const cadena = compruebaLector(F_DETALLE);
    assert.match(cadena, /\.eq\("budget_id", params\.id\)/);
  });

  test("CASO R4 — api/budgets/pdf/route.ts genera el PDF de servidor por sort_order", () => {
    const cadena = compruebaLector(F_PDF_API);
    assert.match(cadena, /\.eq\("budget_id", budgetId\)/);
  });
});

// ---------------------------------------------------------------------------
// BLOQUE B — inventario
// ---------------------------------------------------------------------------
//
// Sin este bloque, un quinto lector anadido manana ordenaria por created_at
// sin que ninguna prueba se enterase.

const DIRS = ["app", "lib", "components", "hooks", "providers"];
const EXTENSIONES = /\.(ts|tsx|js|jsx|mjs)$/;
const EXCLUIDOS = new Set(["node_modules", ".next", ".git", ".claude", ".test-out", "__tests__"]);

function fuentes(dirRelativo) {
  const abs = join(RAIZ, dirRelativo);
  let entradas;
  try {
    entradas = readdirSync(abs, { withFileTypes: true });
  } catch {
    return [];
  }
  const encontrados = [];
  for (const e of entradas) {
    if (EXCLUIDOS.has(e.name)) continue;
    const rel = join(dirRelativo, e.name);
    if (e.isDirectory()) encontrados.push(...fuentes(rel));
    else if (e.isFile() && EXTENSIONES.test(e.name)) encontrados.push(rel);
  }
  return encontrados;
}

function inventarioDeLectores() {
  const hallados = [];
  for (const dir of DIRS) {
    for (const rel of fuentes(dir)) {
      const src = readFileSync(join(RAIZ, rel), "utf8");
      if (!src.includes('.from("budget_items")')) continue;
      if (cadenasBudgetItems(src).some(esLectura)) hallados.push(rel.split(sep).join("/"));
    }
  }
  return hallados.sort();
}

describe("FASE 2E-3 · lectores de budget_items · BLOQUE B — inventario", () => {
  test("CASO R5 — los cuatro archivos esperados son los cuatro lectores actuales", () => {
    assert.deepEqual(
      inventarioDeLectores(),
      [...LECTORES].sort(),
      "el conjunto de lectores de budget_items con .select(\"*\") y filtro budget_id ha cambiado: revisa 2E-3",
    );
  });

  test("CASO R6 — ninguna consulta lectora de budget_items conserva created_at", () => {
    for (const rel of inventarioDeLectores()) {
      for (const cadena of cadenasBudgetItems(readFileSync(join(RAIZ, rel), "utf8")).filter(esLectura)) {
        assert.doesNotMatch(cadena, /created_at/, `${rel} sigue ordenando partidas por created_at`);
      }
    }
  });

  test("CASO R7 — los escritores de budget_items no se han convertido en lectores", () => {
    // Control negativo del clasificador. Este caso apuntaba al provider del
    // asistente, cuyos .delete()/.insert() filtraban por budget_id. Desde
    // FASE 2F-1APP el provider sustituye las líneas con la RPC atómica
    // `replace_budget_items` y no vuelve a nombrar la tabla, de modo que ya no
    // queda ninguna cadena suya que clasificar: seguir apuntándole convertiría
    // este control en una comprobación vacía que pasaría por no encontrar nada.
    //
    // El escritor directo que sí sobrevive es la duplicación de la página de
    // detalle, que inserta las partidas copiadas. Además de escribir, ese mismo
    // fichero lee, lo que lo hace un control negativo más exigente que el
    // anterior: obliga al clasificador a separar dos cadenas del mismo fuente,
    // en lugar de descartar un fichero entero por su nombre.
    const provider = "app/dashboard/budgets/generate/_components/BudgetGenerateProvider.tsx";
    assert.equal(
      cadenasBudgetItems(leer(provider)).length,
      0,
      "el provider ya no escribe budget_items directamente: lo hace a través de la RPC atómica",
    );

    const cadenas = cadenasBudgetItems(leer(F_DETALLE));
    const escrituras = cadenas.filter((c) => /\.(insert|update|upsert|delete)\(/.test(c));
    assert.ok(escrituras.length > 0, "la duplicación debe seguir insertando las partidas copiadas");
    assert.ok(
      escrituras.some((c) => c.includes(".insert(")),
      "el escritor directo que queda es un .insert() de duplicación",
    );
    assert.equal(
      escrituras.filter(esLectura).length,
      0,
      "una cadena de escritura no debe clasificarse nunca como lectura",
    );
    assert.equal(
      cadenas.filter(esLectura).length,
      1,
      "el detalle entra en el inventario por su única cadena lectora, no por la de escritura",
    );
  });
});
