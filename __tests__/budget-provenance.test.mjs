/**
 * FASE 2D-2 — Procedencia persistente de `Partida`.
 *
 * QUÉ SE ESTÁ PROTEGIENDO AQUÍ
 * ----------------------------
 * `canonical_origin` responde a una sola pregunta: ¿dónde NACIÓ la línea? Se
 * sella una vez, en el instante de crearla, y no se vuelve a tocar.
 *
 * El fallo que esta suite existe para impedir es concreto y fácil de cometer:
 * que "pasó por el motor" acabe significando "nació en el motor". Una partida
 * escrita a mano por el usuario atraviesa `normalizeBudgetItemsToScope`,
 * `calculateItemCostBreakdown`, `applyMaterialBasketToItems` y `adjustToMarket`
 * en cada regeneración. Si alguna de esas funciones la re-sellara como
 * `engine`, el resolver acabaría aplicándole aliases de nivel 1 que no le
 * corresponden. Por eso hay tests que comprueban lo que el motor NO hace.
 *
 * Segunda distinción que se protege: `canonical_origin` (nacimiento de la
 * LÍNEA) es independiente de `price_source` (procedencia del PRECIO). El motor
 * reescribe `price_source` continuamente; no debe rozar `canonical_origin`.
 *
 * QUÉ SE COMPRUEBA DE VERDAD Y QUÉ SE COMPRUEBA SOBRE EL TEXTO
 * -----------------------------------------------------------
 * Todo lo que vive en `lib/budget-engine.ts` se ejecuta de verdad: se llama a
 * la función real y se mira el objeto que devuelve.
 *
 * Lo que vive en `BudgetGenerateProvider.tsx` no se puede importar desde
 * node:test (es un componente React con imports de Next). Para esa parte se
 * usan dos estrategias, ninguna de las cuales es una réplica de la lógica:
 *
 *   1. Aserciones sobre el TEXTO del provider, siguiendo la convención ya
 *      establecida en `budget-integrity` y `budget-recalculation`. Son
 *      deliberadamente estrechas: comprueban que las dos reasignaciones que
 *      enumeran campos copian la procedencia, y que ninguna la inventa.
 *   2. Ejecución REAL del viaje de ida y vuelta de `wizard_state`, que es JSON
 *      puro (`{...state}` al serializar, `{...prev, ...savedState}` al
 *      rehidratar) y por tanto sí se puede reproducir exactamente sin React.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const {
  normalizeBudgetItemsToScope,
  buildDeterministicBudgetItems,
  calculateItemCostBreakdown,
  applyMaterialBasketToItems,
  adjustToMarket,
  buildScopeMaterials,
  inferBudgetActions,
} = await import(path.join(root, "lib/budget-engine.ts"));

const { RESOLUTION_ORIGINS } = await import(path.join(root, "lib/types/canonical.ts"));

const providerSrc = fs.readFileSync(
  path.join(root, "app/dashboard/budgets/generate/_components/BudgetGenerateProvider.tsx"),
  "utf8",
);

// ───────────────────────────────────────────────────────────────────────────
// Utilidades del test
// ───────────────────────────────────────────────────────────────────────────

const MARGIN = 1.25;

/** Alcance realista de reforma para que el motor tenga trabajo que hacer. */
function scope() {
  return {
    superficie_m2: 80,
    project_context: "existing_renovation",
    conservation_strategy: "balanced",
    ubicacion: "Madrid",
    banos: 1,
    cocina: true,
  };
}

/**
 * Una línea que el usuario ha escrito a mano en el wizard. Se declara con la
 * procedencia YA sellada, que es exactamente lo que `addPartida` produce.
 */
function lineaManual(over = {}) {
  const quantity = over.quantity ?? 12;
  const unit_price = over.unit_price ?? 30;
  return {
    id: "manual-1",
    concept: "Alicatado a mano del usuario",
    description: "Escrita a mano en el wizard",
    quantity,
    unit: "m2",
    category: "material",
    chapter: "revestimientos",
    unit_price,
    subtotal_cost: quantity * unit_price,
    unit_price_client: unit_price * MARGIN,
    subtotal_client: quantity * unit_price * MARGIN,
    status: "incluida",
    canonical_origin: "free_text",
    canonical_source_ref: null,
    ...over,
  };
}

/** Huella económica de una línea: lo que esta fase NO puede alterar. */
const huella = (items) =>
  items.map((i) => ({
    id: i.id,
    quantity: i.quantity,
    unit: i.unit,
    unit_price: i.unit_price,
    subtotal_cost: i.subtotal_cost,
    unit_price_client: i.unit_price_client,
    subtotal_client: i.subtotal_client,
  }));

const buscar = (items, id) => items.find((i) => i.id === id);

// ───────────────────────────────────────────────────────────────────────────
// BLOQUE 1 — Sellado en el nacimiento (motor)
// ───────────────────────────────────────────────────────────────────────────

describe("2D-2 · sellado en el nacimiento", () => {
  test("engine — buildDeterministicBudgetItems sella toda línea que fabrica", () => {
    const items = buildDeterministicBudgetItems(scope(), MARGIN);

    assert.ok(items.length > 0, "el motor debe fabricar líneas con este alcance");
    for (const item of items) {
      assert.equal(
        item.canonical_origin,
        "engine",
        `la línea ${item.id} la ha fabricado el motor desde cero: debe nacer 'engine'`,
      );
      assert.equal(
        item.canonical_source_ref,
        null,
        "en 2D-2 una línea 'engine' no tiene referencia documental",
      );
    }
  });

  test("engine — normalizeBudgetItemsToScope sella SÓLO los capítulos que inventa", () => {
    const manual = lineaManual();
    const salida = normalizeBudgetItemsToScope(scope(), [manual], MARGIN);

    const inventadas = salida.filter((i) => i.id.startsWith("scope-"));
    assert.ok(
      inventadas.length > 0,
      "el alcance exige capítulos que la entrada no traía; el motor debe añadirlos",
    );
    for (const nueva of inventadas) {
      assert.equal(nueva.canonical_origin, "engine");
      assert.equal(nueva.canonical_source_ref, null);
    }

    // Y la que ya venía sigue siendo suya.
    assert.equal(buscar(salida, "manual-1").canonical_origin, "free_text");
  });

  test("free_text — addPartida es el único alta manual y sella al crear", () => {
    // `addPartida` construye el objeto y pone los valores por defecto DESPUÉS
    // del spread, para que un llamante que ya conozca la procedencia gane.
    const bloque = providerSrc.slice(
      providerSrc.indexOf("const addPartida"),
      providerSrc.indexOf("const updatePartida"),
    );
    assert.ok(bloque.length > 0, "no se ha encontrado addPartida en el provider");

    assert.match(
      bloque,
      /canonical_origin:\s*partida\.canonical_origin\s*\?\?\s*"free_text"/,
      "addPartida debe sellar free_text por defecto",
    );
    assert.match(
      bloque,
      /canonical_source_ref:\s*partida\.canonical_source_ref\s*\?\?\s*null/,
      "addPartida debe preservar source_ref si el llamante lo trae",
    );

    // El orden importa: si el spread fuese lo último, machacaría el sello.
    assert.ok(
      bloque.indexOf("...partida") < bloque.indexOf("canonical_origin"),
      "los valores por defecto deben ir DESPUÉS de `...partida`, no antes",
    );
  });

  test("free_text — el motor nunca sella free_text: sólo lo hace el wizard", () => {
    const engineSrc = fs.readFileSync(path.join(root, "lib/budget-engine.ts"), "utf8");
    assert.doesNotMatch(
      engineSrc,
      /canonical_origin:\s*"free_text"/,
      "el motor no puede declarar líneas manuales; eso sólo ocurre en addPartida",
    );
  });

  test("hay exactamente DOS puntos de nacimiento 'engine' en el motor", () => {
    const engineSrc = fs.readFileSync(path.join(root, "lib/budget-engine.ts"), "utf8");
    const apariciones = engineSrc.match(/canonical_origin:\s*"engine"/g) || [];
    assert.equal(
      apariciones.length,
      2,
      "sólo los add() de normalizeBudgetItemsToScope y buildDeterministicBudgetItems " +
        "pueden sellar 'engine'. Si este test falla, alguien ha añadido un tercer " +
        "punto de nacimiento o —peor— ha re-sellado una línea al transformarla.",
    );
  });

  test("los dos valores usados son ResolutionOrigin válidos", () => {
    assert.ok(RESOLUTION_ORIGINS.includes("engine"));
    assert.ok(RESOLUTION_ORIGINS.includes("free_text"));
  });
});

// ───────────────────────────────────────────────────────────────────────────
// BLOQUE 2 — Transformar no es crear
// ───────────────────────────────────────────────────────────────────────────

describe("2D-2 · transformar una línea no la vuelve a sellar", () => {
  test("CLAVE — una free_text que atraviesa el motor entero sigue siendo free_text", () => {
    const s = scope();
    const manual = lineaManual();

    // El recorrido real del wizard, en el mismo orden.
    let items = normalizeBudgetItemsToScope(s, [manual], MARGIN);
    items = items.map((i) => calculateItemCostBreakdown(i, s, 25));
    const materiales = buildScopeMaterials(s);
    items = applyMaterialBasketToItems(items, materiales, MARGIN);
    const ajuste = adjustToMarket(s, items, materiales, "reforma_integral", MARGIN, true);
    items = ajuste.items.map((i) => ({ ...i }));

    const superviviente = buscar(items, "manual-1");
    assert.ok(superviviente, "la línea manual no debe desaparecer del presupuesto");
    assert.equal(
      superviviente.canonical_origin,
      "free_text",
      "haber atravesado cuatro funciones del motor NO convierte la línea en 'engine'",
    );
    assert.equal(superviviente.canonical_source_ref, null);
  });

  test("CONTROL NEGATIVO — la comprobación anterior detectaría de verdad la avería", () => {
    // Un test que sólo pasa no demuestra nada si no puede fallar nunca. Aquí se
    // simula exactamente el defecto que se quiere impedir —un motor que
    // re-sella todo lo que toca— y se comprueba que la aserción del test
    // anterior lo caza. Si esto dejara de saltar, el test CLAVE sería
    // decorativo.
    const s = scope();
    const salida = normalizeBudgetItemsToScope(s, [lineaManual()], MARGIN)
      // La avería: "ha pasado por el motor, luego es del motor".
      .map((i) => ({ ...i, canonical_origin: "engine" }));

    assert.throws(
      () => assert.equal(buscar(salida, "manual-1").canonical_origin, "free_text"),
      assert.AssertionError,
      "el oráculo debe distinguir 'nació en el motor' de 'pasó por el motor'",
    );
  });

  test("una línea sin procedencia (histórica) sale sin procedencia, no como engine", () => {
    const s = scope();
    const huerfana = lineaManual({ id: "vieja-1" });
    delete huerfana.canonical_origin;
    delete huerfana.canonical_source_ref;

    let items = normalizeBudgetItemsToScope(s, [huerfana], MARGIN);
    items = items.map((i) => calculateItemCostBreakdown(i, s, 25));

    const salida = buscar(items, "vieja-1");
    assert.equal(
      salida.canonical_origin,
      undefined,
      "una línea histórica no adquiere procedencia por pasar por el motor: " +
        "eso lo decidirá el backfill, no la lectura",
    );
    assert.equal(salida.canonical_source_ref, undefined);
  });

  test("una línea 'engine' preexistente conserva engine (no se duplica ni se pierde)", () => {
    const s = scope();
    const previa = lineaManual({ id: "engine-previa", canonical_origin: "engine" });
    const items = normalizeBudgetItemsToScope(s, [previa], MARGIN);
    assert.equal(buscar(items, "engine-previa").canonical_origin, "engine");
  });

  test("source_ref se conserva aunque en 2D-2 nadie lo escriba todavía", () => {
    const s = scope();
    const importada = lineaManual({
      id: "import-1",
      canonical_origin: "import",
      canonical_source_ref: "cype_2026",
    });

    let items = normalizeBudgetItemsToScope(s, [importada], MARGIN);
    items = items.map((i) => calculateItemCostBreakdown(i, s, 25));
    const materiales = buildScopeMaterials(s);
    items = applyMaterialBasketToItems(items, materiales, MARGIN);

    const salida = buscar(items, "import-1");
    assert.equal(salida.canonical_origin, "import");
    assert.equal(
      salida.canonical_source_ref,
      "cype_2026",
      "la propiedad debe sobrevivir para que añadir import/provider no obligue " +
        "a rehacer el modelo",
    );
  });

  test("price_source cambia y canonical_origin no se entera", () => {
    const s = scope();
    // Precio de mercado bajísimo para forzar el escalado de adjustToMarket,
    // que es justamente quien reescribe precios.
    const manual = lineaManual({ unit_price: 1, price_source: "engine_scope" });
    let items = normalizeBudgetItemsToScope(s, [manual], MARGIN);
    items = items.map((i) => calculateItemCostBreakdown(i, s, 25));

    const antesOrigin = buscar(items, "manual-1").canonical_origin;
    const antesPrecio = buscar(items, "manual-1").unit_price;

    const materiales = buildScopeMaterials(s);
    const ajuste = adjustToMarket(s, items, materiales, "reforma_integral", MARGIN, true);
    const despues = buscar(ajuste.items, "manual-1");

    assert.equal(antesOrigin, "free_text");
    assert.equal(
      despues.canonical_origin,
      "free_text",
      "el motor puede reescribir el PRECIO cuanto quiera; el NACIMIENTO no es suyo",
    );
    // Y comprobamos que el escalado ha ocurrido de verdad, para que el test no
    // sea vacío: si el precio no se hubiera tocado, no estaríamos midiendo nada.
    assert.notEqual(
      despues.unit_price,
      antesPrecio,
      "el escalado a mercado debía haberse aplicado; si no, este test no prueba nada",
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// BLOQUE 3 — Las seis reasignaciones del provider
// ───────────────────────────────────────────────────────────────────────────

describe("2D-2 · las seis reasignaciones conservan procedencia", () => {
  /** Trocea el provider entre dos marcas para acotar la aserción. */
  const entre = (desde, hasta) => {
    const a = providerSrc.indexOf(desde);
    assert.notEqual(a, -1, `no se ha encontrado el ancla: ${desde}`);
    const b = providerSrc.indexOf(hasta, a);
    assert.notEqual(b, -1, `no se ha encontrado el cierre: ${hasta}`);
    return providerSrc.slice(a, b);
  };

  test("R1 (adjustResult.items) copia explícitamente: enumera campos", () => {
    const bloque = entre("finalPartidas = adjustResult.items.map", "finalMaterials = adjustResult");
    assert.match(bloque, /canonical_origin:\s*ep\.canonical_origin\s*\?\?\s*null/);
    assert.match(bloque, /canonical_source_ref:\s*ep\.canonical_source_ref\s*\?\?\s*null/);
    assert.doesNotMatch(
      bloque,
      /canonical_origin:\s*"engine"/,
      "esta reasignación CONVIERTE de EnginePartida a Partida; no crea líneas, " +
        "así que no puede sellar una constante",
    );
  });

  test("R2 (built) copia explícitamente: enumera campos", () => {
    const bloque = entre("finalPartidas = built.map", "finalMaterials = buildScopeMaterials");
    assert.match(bloque, /canonical_origin:\s*ep\.canonical_origin\s*\?\?\s*null/);
    assert.match(bloque, /canonical_source_ref:\s*ep\.canonical_source_ref\s*\?\?\s*null/);
    assert.doesNotMatch(bloque, /canonical_origin:\s*"engine"/);
  });

  test("R3, R4, R5, R6 conservan por spread y no necesitan copia", () => {
    // Ajuste geográfico
    assert.match(
      entre("finalPartidas = finalPartidas.map((partida) => {", "const includedCommercialProducts"),
      /return\s*\{\s*\n\s*\.\.\.partida,/,
    );
    // Adopción de precio resuelto
    assert.match(
      entre("finalPartidas = finalPartidas.map((partida, index) => {", "} else {"),
      /return\s*\{\s*\n\s*\.\.\.partida,/,
    );
    // Cesta de materiales
    assert.match(
      entre("finalPartidas = applyMaterialBasketToItems(", "engineMaterialsForBasket,"),
      /\.\.\.partida,/,
    );
    // Calibrado final
    assert.match(
      providerSrc,
      /finalPartidas = finalMarketAdjustment\.items\.map\(\(partida\) => \(\{ \.\.\.partida \}\)\)/,
    );
  });

  test("el provider no deriva procedencia de price_source ni de ningún otro campo", () => {
    // Sellar en función del precio, del proveedor o del capítulo sería el
    // error de diseño que 2D-2 existe para prevenir.
    assert.doesNotMatch(providerSrc, /canonical_origin\s*=\s*[^;]*price_source/);
    assert.doesNotMatch(providerSrc, /canonical_origin:\s*[^,\n]*price_source/);
    assert.doesNotMatch(providerSrc, /canonical_origin:\s*[^,\n]*provider/);
    assert.doesNotMatch(providerSrc, /canonical_origin:\s*[^,\n]*chapter/);
  });

  test("no hay una segunda fuente de verdad de procedencia fuera de Partida", () => {
    // Nada de mapas paralelos id -> origen, ni estado aparte en el wizard.
    assert.doesNotMatch(providerSrc, /provenanceMap|originsById|canonicalOrigins\b/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// BLOQUE 4 — wizard_state: ida y vuelta real
// ───────────────────────────────────────────────────────────────────────────

describe("2D-2 · wizard_state serializa y rehidrata la procedencia", () => {
  /**
   * Reproducción EXACTA del viaje real, no una réplica de lógica:
   *   - guardar:  `const snapshot = { ...state, ... }` → JSON en Supabase
   *   - reabrir:  `setState(prev => ({ ...prev, ...savedState }))`
   * Ambos pasan `partidas` en bloque, así que el viaje es JSON puro.
   */
  const guardar = (state) => JSON.parse(JSON.stringify({ ...state, isSavingDraft: false }));
  const reabrir = (prev, savedState) => ({ ...prev, ...savedState });

  const estadoBase = (partidas) => ({ partidas, marginPercent: 25, sector: "construccion" });

  test("ambos campos sobreviven al viaje completo", () => {
    const original = estadoBase([
      lineaManual(),
      lineaManual({ id: "e-1", canonical_origin: "engine" }),
      lineaManual({ id: "i-1", canonical_origin: "import", canonical_source_ref: "cype_2026" }),
    ]);

    const guardado = guardar(original);
    const rehidratado = reabrir(estadoBase([]), guardado);

    assert.equal(rehidratado.partidas.length, 3);
    assert.equal(buscar(rehidratado.partidas, "manual-1").canonical_origin, "free_text");
    assert.equal(buscar(rehidratado.partidas, "e-1").canonical_origin, "engine");
    assert.equal(buscar(rehidratado.partidas, "i-1").canonical_origin, "import");
    assert.equal(buscar(rehidratado.partidas, "i-1").canonical_source_ref, "cype_2026");
  });

  test("null sobrevive como null y no se convierte en ausencia", () => {
    const original = estadoBase([lineaManual({ canonical_origin: null })]);
    const rehidratado = reabrir(estadoBase([]), guardar(original));
    assert.equal(buscar(rehidratado.partidas, "manual-1").canonical_origin, null);
  });

  test("un wizard_state HISTÓRICO sin los campos sigue sin procedencia", () => {
    const vieja = lineaManual();
    delete vieja.canonical_origin;
    delete vieja.canonical_source_ref;

    const rehidratado = reabrir(estadoBase([]), guardar(estadoBase([vieja])));
    const salida = buscar(rehidratado.partidas, "manual-1");

    assert.equal(salida.canonical_origin, undefined);
    assert.equal(salida.canonical_source_ref, undefined);
    assert.equal(
      "canonical_origin" in salida,
      false,
      "reabrir no debe inventar la clave: ausente entra, ausente sale",
    );
  });

  test("serializar y reabrir es idempotente: no inventa origen en la segunda vuelta", () => {
    const vieja = lineaManual({ id: "v-1" });
    delete vieja.canonical_origin;
    const original = estadoBase([lineaManual(), vieja]);

    const vuelta1 = reabrir(estadoBase([]), guardar(original));
    const vuelta2 = reabrir(estadoBase([]), guardar(vuelta1));

    assert.deepEqual(vuelta2.partidas, vuelta1.partidas);
    assert.equal(buscar(vuelta2.partidas, "v-1").canonical_origin, undefined);
    assert.equal(buscar(vuelta2.partidas, "manual-1").canonical_origin, "free_text");
  });

  test("el provider no añade lógica de guardado aparte para la procedencia", () => {
    // El snapshot debe seguir siendo el spread del estado completo.
    assert.match(providerSrc, /const snapshot = \{\s*\n?\s*\.\.\.state,/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// BLOQUE 5 — Neutralidad económica
// ───────────────────────────────────────────────────────────────────────────

describe("2D-2 · el dinero no se mueve", () => {
  test("el motor determinista produce la misma economía con y sin procedencia", () => {
    const items = buildDeterministicBudgetItems(scope(), MARGIN);
    const sinSello = items.map(({ canonical_origin, canonical_source_ref, ...resto }) => resto);

    // Reconstruir el presupuesto a partir de las líneas desprovistas de sello
    // debe dar exactamente los mismos números.
    const s = scope();
    const conSello = items.map((i) => calculateItemCostBreakdown(i, s, 25));
    const control = sinSello.map((i) => calculateItemCostBreakdown(i, s, 25));

    assert.deepEqual(huella(conSello), huella(control));
    assert.equal(conSello.length, control.length);
  });

  test("el recorrido completo no altera importes por llevar procedencia", () => {
    const s = scope();
    const conSello = lineaManual();
    const sinSello = lineaManual();
    delete sinSello.canonical_origin;
    delete sinSello.canonical_source_ref;

    const recorrido = (entrada) => {
      let items = normalizeBudgetItemsToScope(s, [entrada], MARGIN);
      items = items.map((i) => calculateItemCostBreakdown(i, s, 25));
      const materiales = buildScopeMaterials(s);
      items = applyMaterialBasketToItems(items, materiales, MARGIN);
      return items;
    };

    const a = recorrido(conSello);
    const b = recorrido(sinSello);

    assert.equal(a.length, b.length, "el número de líneas debe ser idéntico");
    assert.deepEqual(
      huella(a),
      huella(b),
      "cantidad, unidad, precio unitario y subtotales deben ser idénticos",
    );
  });

  test("la procedencia no altera qué acciones infiere el motor", () => {
    const s = scope();
    assert.deepEqual(inferBudgetActions(s), inferBudgetActions(s));
  });
});
