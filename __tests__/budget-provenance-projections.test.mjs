/**
 * FASE 2D-4b — Las dos proyecciones del fallback de motor conservan la procedencia.
 *
 * QUÉ FALLABA
 * -----------
 * Cuando el análisis por IA no responde y el sector es construcción, el asistente cae
 * al motor local. Ese fallback existe por duplicado, uno por cada forma que tiene el
 * usuario de avanzar de paso:
 *
 *   nextStep()  → const builtItems = buildDeterministicBudgetItems(fbScope, mm)
 *   goToStep()  → const gItems     = buildDeterministicBudgetItems(gScope, gMM)
 *
 * Las dos convierten `EnginePartida` en `Partida` reconstruyendo el objeto CLAVE A
 * CLAVE. Lo que no se copie en esa enumeración se pierde, y no se copiaban
 * `canonical_origin` ni `canonical_source_ref`. El motor sella `engine` en el
 * nacimiento; ese sello moría en la conversión y la línea llegaba a `budget_items`
 * con procedencia nula, indistinguible de una línea de origen desconocido.
 *
 * No es un fallo económico: ni un céntimo cambiaba. Es una pérdida silenciosa de
 * información de trazabilidad, que es justo la clase de fallo que no se nota.
 *
 * La auditoría de 2D-2 enumeró SEIS reasignaciones del provider (R1..R6 en
 * `budget-provenance.test.mjs`). Estas dos no estaban en esa lista: viven en el
 * camino de fallback, no en `analyzeWithAI`, y por eso se escaparon. Esta suite las
 * incorpora como R7 y R8.
 *
 * CÓMO SE COMPRUEBA
 * -----------------
 * NO se replica la proyección. `BudgetGenerateProvider.tsx` no se puede importar desde
 * node:test —es un componente React con imports de Next—, así que la suite EXTRAE del
 * fichero real el texto exacto de cada callback `ep => ({ ... })`, lo compila y lo
 * EJECUTA sobre partidas de motor reales. La función que se prueba es literalmente la
 * que está en el fichero: si alguien borra las dos líneas, estos tests caen.
 *
 * Ésa es también la razón de que el control negativo sea real y no un comentario: el
 * último bloque coge ese mismo texto, le quita las dos líneas, vuelve a compilarlo y
 * comprueba que ENTONCES sí se pierde la procedencia.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { buildDeterministicBudgetItems, inferBudgetActions } = await import(
  path.join(root, "lib/budget-engine.ts")
);

const { RESOLUTION_ORIGINS } = await import(path.join(root, "lib/types/canonical.ts"));

const providerSrc = fs.readFileSync(
  path.join(root, "app/dashboard/budgets/generate/_components/BudgetGenerateProvider.tsx"),
  "utf8",
);

// ───────────────────────────────────────────────────────────────────────────
// Extracción y compilación de la proyección REAL
// ───────────────────────────────────────────────────────────────────────────

/** Índice del cierre que equilibra el paréntesis abierto en `abre`, saltando comentarios. */
function cierreDe(src, abre) {
  let nivel = 0;
  for (let i = abre; i < src.length; i += 1) {
    if (src[i] === "/" && src[i + 1] === "/") {
      const salto = src.indexOf("\n", i);
      if (salto === -1) break;
      i = salto;
      continue;
    }
    const c = src[i];
    if (c === "(" || c === "{" || c === "[") nivel += 1;
    else if (c === ")" || c === "}" || c === "]") {
      nivel -= 1;
      if (nivel === 0) return i;
    }
  }
  return -1;
}

/**
 * Devuelve el texto y la función compilada del callback de `partidas: <array>.map(...)`.
 *
 * El cuerpo es JavaScript puro (no hay anotaciones de tipo dentro del objeto), así que
 * se puede compilar tal cual. Si algún día dejara de serlo, la compilación lanzaría y
 * el test lo diría en vez de pasar por casualidad.
 */
function extraerProyeccion(nombreArray) {
  const marca = `partidas: ${nombreArray}.map(`;
  const i = providerSrc.indexOf(marca);
  assert.notEqual(i, -1, `no se ha encontrado la proyección de '${nombreArray}' en el provider`);

  const abre = i + marca.length - 1;
  const fin = cierreDe(providerSrc, abre);
  assert.notEqual(fin, -1, `no se ha encontrado el cierre de la proyección de '${nombreArray}'`);

  const texto = providerSrc.slice(abre + 1, fin);
  assert.match(
    texto,
    /^ep\s*=>\s*\(\{/,
    `la proyección de '${nombreArray}' ya no tiene la forma esperada: ${texto.slice(0, 40)}`,
  );

  return { texto, fn: compilar(texto, nombreArray) };
}

function compilar(texto, etiqueta) {
  try {
    // eslint-disable-next-line no-new-func
    return new Function(`return (${texto});`)();
  } catch (e) {
    assert.fail(`la proyección de '${etiqueta}' no compila: ${e.message}`);
  }
}

const R7 = extraerProyeccion("builtItems"); // nextStep
const R8 = extraerProyeccion("gItems"); // goToStep

const PROYECCIONES = [
  { nombre: "R7 · nextStep (builtItems)", ...R7 },
  { nombre: "R8 · goToStep (gItems)", ...R8 },
];

// ───────────────────────────────────────────────────────────────────────────
// Fixtures
// ───────────────────────────────────────────────────────────────────────────

/** Alcance realista de reforma; produce decenas de partidas de motor de verdad. */
const ALCANCE = {
  superficie_m2: 92,
  num_banos: 2,
  incluye_cocina: true,
  incluye_ventanas: true,
  incluye_climatizacion: false,
  estancias: ["salon", "cocina", "bano"],
  actuaciones: inferBudgetActions("reforma integral de vivienda con demoliciones"),
  calidad: "media",
  ubicacion: "Madrid",
  project_context: "reforma",
  existing_condition: "fair",
  conservation_strategy: "balanced",
  occupied_during_works: false,
  building_age_band: "1980_2000",
};

const MARGEN = 1.25;

/**
 * Una `EnginePartida` con la procedencia que se le pida.
 *
 * El motor real sólo produce `engine`, así que las demás procedencias hay que
 * inyectarlas: lo que se está comprobando es que la proyección COPIA lo que le llega,
 * no que estampe una constante que casualmente coincide con lo que el motor sella hoy.
 */
function enginePartida(extra = {}) {
  return {
    id: "ep-1",
    concept: "Alicatado de paramentos en baño",
    description: "Colocación de azulejo con adhesivo cementoso y rejuntado.",
    quantity: 24.5,
    unit: "m2",
    category: "mano_obra",
    chapter: "alicatados",
    unit_price: 38.4,
    subtotal_cost: 940.8,
    unit_price_client: 48,
    subtotal_client: 1176,
    status: "incluida",
    estimated_hours: 18,
    price_source: "engine_scope",
    canonical_origin: null,
    canonical_source_ref: null,
    ...extra,
  };
}

const CLAVES_ECONOMICAS = [
  "quantity",
  "unit_price",
  "subtotal_cost",
  "unit_price_client",
  "subtotal_client",
];

// ───────────────────────────────────────────────────────────────────────────
// BLOQUE 1 — Cada procedencia se conserva, valor a valor
// ───────────────────────────────────────────────────────────────────────────

describe("2D-4b · las proyecciones del fallback copian la procedencia", () => {
  for (const { nombre, fn } of PROYECCIONES) {
    test(`${nombre} — 'ai' se conserva y NO se convierte en 'engine'`, () => {
      // El caso más importante de todos. Estas proyecciones viven en el camino del
      // motor, así que la tentación de escribir `canonical_origin: "engine"` es
      // máxima. Sería mentir sobre dónde nació la línea: el sello lo pone el
      // nacimiento, no la conversión.
      const salida = [enginePartida({ canonical_origin: "ai" })].map(fn);
      assert.equal(salida[0].canonical_origin, "ai");
      assert.equal(salida[0].canonical_source_ref, null);
    });

    test(`${nombre} — 'engine' se conserva`, () => {
      const salida = [enginePartida({ canonical_origin: "engine" })].map(fn);
      assert.equal(salida[0].canonical_origin, "engine");
      assert.equal(salida[0].canonical_source_ref, null);
    });

    test(`${nombre} — 'free_text' se conserva`, () => {
      // Una línea escrita a mano por el usuario que haya llegado hasta aquí sigue
      // siendo suya. Re-sellarla como `engine` haría que el resolver le aplicase
      // aliases de nivel 1 que no le corresponden.
      const salida = [enginePartida({ canonical_origin: "free_text" })].map(fn);
      assert.equal(salida[0].canonical_origin, "free_text");
      assert.equal(salida[0].canonical_source_ref, null);
    });

    test(`${nombre} — 'import' conserva su source_ref`, () => {
      const salida = [
        enginePartida({ canonical_origin: "import", canonical_source_ref: "cype_2026" }),
      ].map(fn);
      assert.equal(salida[0].canonical_origin, "import");
      assert.equal(salida[0].canonical_source_ref, "cype_2026");
    });

    test(`${nombre} — 'provider' conserva su source_ref`, () => {
      // `import` y `provider` son las dos procedencias que EXIGEN instancia documental
      // (`ck_origin_source_ref`). Copiar el origen y perder la referencia dejaría una
      // pareja que Postgres rechaza y que la clasificación degrada a (null, null): la
      // procedencia se perdería igual, sólo que más tarde y de forma más confusa.
      const salida = [
        enginePartida({ canonical_origin: "provider", canonical_source_ref: "leroy_2026_q1" }),
      ].map(fn);
      assert.equal(salida[0].canonical_origin, "provider");
      assert.equal(salida[0].canonical_source_ref, "leroy_2026_q1");
    });

    test(`${nombre} — null sigue siendo null, y no se inventa procedencia`, () => {
      const salida = [enginePartida({ canonical_origin: null })].map(fn);
      assert.equal(salida[0].canonical_origin, null);
      assert.equal(salida[0].canonical_source_ref, null);
    });

    test(`${nombre} — una línea SIN los campos sale con null explícito, no undefined`, () => {
      // El `?? null` importa: `undefined` no sobrevive a `JSON.stringify`, y
      // `wizard_state` es JSON. Una clave que desaparece del snapshot no es lo mismo
      // que una clave presente con valor nulo.
      const sinCampos = enginePartida();
      delete sinCampos.canonical_origin;
      delete sinCampos.canonical_source_ref;

      const salida = [sinCampos].map(fn);
      assert.ok("canonical_origin" in salida[0], "la clave no está presente");
      assert.ok("canonical_source_ref" in salida[0], "la clave no está presente");
      assert.equal(salida[0].canonical_origin, null);
      assert.equal(salida[0].canonical_source_ref, null);
      assert.deepEqual(JSON.parse(JSON.stringify(salida[0])).canonical_origin, null);
    });

    test(`${nombre} — las seis procedencias válidas pasan sin alterarse`, () => {
      // Barrido completo contra la lista real de orígenes, para que añadir un séptimo
      // no deje un caso sin cubrir en silencio.
      assert.ok(RESOLUTION_ORIGINS.length >= 5, "la lista de orígenes está vacía o incompleta");

      for (const origen of RESOLUTION_ORIGINS) {
        const ref = ["import", "provider"].includes(origen) ? "banco_2026" : null;
        const salida = [
          enginePartida({ canonical_origin: origen, canonical_source_ref: ref }),
        ].map(fn);
        assert.equal(salida[0].canonical_origin, origen, `se perdió el origen '${origen}'`);
        assert.equal(salida[0].canonical_source_ref, ref, `se perdió el ref de '${origen}'`);
      }
    });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// BLOQUE 2 — Contra el motor REAL: el sello llega entero al estado
// ───────────────────────────────────────────────────────────────────────────

describe("2D-4b · el sello del motor sobrevive a la conversión", () => {
  for (const { nombre, fn } of PROYECCIONES) {
    test(`${nombre} — todas las líneas del fallback real conservan 'engine'`, () => {
      // Éste es el fallo tal y como se producía en producción: se llama al mismo
      // `buildDeterministicBudgetItems` que llama el provider, con un alcance
      // realista, y se proyecta con la función real.
      const motor = buildDeterministicBudgetItems(ALCANCE, MARGEN);
      assert.ok(motor.length >= 5, `el motor sólo produjo ${motor.length} partidas`);

      const salida = motor.map(fn);

      for (let i = 0; i < salida.length; i += 1) {
        assert.equal(
          salida[i].canonical_origin,
          "engine",
          `la línea ${i} ('${motor[i].concept}') perdió su procedencia en la conversión`,
        );
        assert.equal(salida[i].canonical_source_ref, null);
      }
    });

    test(`${nombre} — mismo número de líneas y mismo orden`, () => {
      const motor = buildDeterministicBudgetItems(ALCANCE, MARGEN);
      const salida = motor.map(fn);

      assert.equal(salida.length, motor.length, "la conversión cambió el número de partidas");
      assert.deepEqual(
        salida.map((p) => p.id),
        motor.map((p) => p.id),
        "la conversión reordenó las partidas",
      );
      assert.deepEqual(
        salida.map((p) => p.concept),
        motor.map((p) => p.concept),
      );
    });

    test(`${nombre} — economía IDÉNTICA: ni un céntimo se mueve`, () => {
      const motor = buildDeterministicBudgetItems(ALCANCE, MARGEN);
      const salida = motor.map(fn);

      for (let i = 0; i < salida.length; i += 1) {
        for (const clave of CLAVES_ECONOMICAS) {
          assert.equal(
            salida[i][clave],
            motor[i][clave],
            `la línea ${i} cambió '${clave}' al copiar la procedencia`,
          );
        }
        assert.equal(salida[i].unit, motor[i].unit);
        assert.equal(salida[i].status, motor[i].status);
        assert.equal(salida[i].category, motor[i].category);
        assert.equal(salida[i].chapter, motor[i].chapter);
      }

      // Y el total, que es lo que el cliente ve.
      const suma = (filas, clave) => filas.reduce((t, f) => t + f[clave], 0);
      assert.equal(suma(salida, "subtotal_client"), suma(motor, "subtotal_client"));
      assert.equal(suma(salida, "subtotal_cost"), suma(motor, "subtotal_cost"));
    });

    test(`${nombre} — la proyección sólo añade las dos claves de procedencia`, () => {
      // Delimita el cambio: nada más entró ni salió del objeto proyectado.
      const motor = buildDeterministicBudgetItems(ALCANCE, MARGEN);
      const antes = new Set(Object.keys(motor.map(fn)[0]));

      const sinProcedencia = compilar(quitarProcedencia(nombre), nombre);
      const despues = new Set(Object.keys(motor.map(sinProcedencia)[0]));

      const anadidas = [...antes].filter((k) => !despues.has(k)).sort();
      assert.deepEqual(anadidas, ["canonical_origin", "canonical_source_ref"]);
      assert.equal([...despues].filter((k) => !antes.has(k)).length, 0);
    });
  }

  test("las dos proyecciones producen exactamente el mismo objeto", () => {
    // Los dos caminos del fallback son el mismo fallback. Que la procedencia de una
    // línea dependiera de si el usuario pulsó "Siguiente" o saltó de paso sería una
    // diferencia sin ningún significado para el negocio.
    const motor = buildDeterministicBudgetItems(ALCANCE, MARGEN);
    assert.deepEqual(motor.map(R7.fn), motor.map(R8.fn));
  });
});

// ───────────────────────────────────────────────────────────────────────────
// BLOQUE 3 — Control negativo
//
// Sin esto, los tests de arriba podrían estar pasando por cualquier motivo: porque el
// objeto proyectado hereda algo, porque el fixture ya traía la clave, porque
// `deepEqual` es indulgente. Aquí se coge el MISMO texto extraído del fichero real, se
// le quitan las dos líneas de copia, se recompila y se comprueba que entonces la
// procedencia SÍ se pierde. Es la demostración de que lo que hace pasar los tests es
// exactamente el cambio de 2D-4b y nada más.
// ───────────────────────────────────────────────────────────────────────────

/** El texto real de la proyección, sin las dos líneas de copia de procedencia. */
function quitarProcedencia(nombre) {
  const { texto } = PROYECCIONES.find((p) => p.nombre === nombre);
  const mutado = texto
    .split("\n")
    .filter((linea) => !/^\s*canonical_(origin|source_ref):/.test(linea))
    .join("\n");
  assert.notEqual(mutado, texto, `no se han encontrado las líneas a quitar en ${nombre}`);
  return mutado;
}

describe("2D-4b · control negativo: sin la copia, la procedencia se pierde", () => {
  for (const { nombre } of PROYECCIONES) {
    test(`${nombre} — quitando las dos líneas, 'engine' desaparece`, () => {
      const rota = compilar(quitarProcedencia(nombre), nombre);
      const motor = buildDeterministicBudgetItems(ALCANCE, MARGEN);

      const salida = motor.map(rota);
      assert.equal(salida[0].canonical_origin, undefined);
      assert.equal(salida[0].canonical_source_ref, undefined);
      assert.ok(!("canonical_origin" in salida[0]));

      // Y esto es lo que llegaría a la tabla: el `?? null` de `saveDraft` lo convierte
      // en NULL y la línea queda indistinguible de una de origen desconocido.
      assert.equal(salida[0].canonical_origin ?? null, null);
    });

    test(`${nombre} — quitando las dos líneas, 'ai' también desaparece`, () => {
      const rota = compilar(quitarProcedencia(nombre), nombre);
      const salida = [enginePartida({ canonical_origin: "ai" })].map(rota);
      assert.equal(salida[0].canonical_origin, undefined);
    });

    test(`${nombre} — la versión rota conserva la economía: el fallo era SÓLO de procedencia`, () => {
      // Confirma el diagnóstico. Si la versión rota también moviera importes, el
      // defecto sería otro y el arreglo tendría que ser otro.
      const rota = compilar(quitarProcedencia(nombre), nombre);
      const motor = buildDeterministicBudgetItems(ALCANCE, MARGEN);

      const rotas = motor.map(rota);
      const buenas = motor.map(PROYECCIONES.find((p) => p.nombre === nombre).fn);

      assert.equal(rotas.length, buenas.length);
      for (let i = 0; i < rotas.length; i += 1) {
        for (const clave of CLAVES_ECONOMICAS) {
          assert.equal(rotas[i][clave], buenas[i][clave]);
        }
      }
    });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// BLOQUE 4 — Que no vuelva a aparecer una tercera proyección con pérdida
// ───────────────────────────────────────────────────────────────────────────

describe("2D-4b · ninguna proyección de partidas enumera campos sin copiar procedencia", () => {
  test("toda reasignación de `partidas:` que enumere campos copia las dos columnas", () => {
    // El defecto de 2D-4b no fue una línea mal escrita: fue una proyección que nadie
    // había enumerado. Este test recorre TODAS las de la forma `partidas: X.map(...)`
    // y exige la copia, de modo que una tercera que aparezca mañana no pase inadvertida.
    const marcas = [...providerSrc.matchAll(/partidas: (\w+)\.map\(/g)];
    assert.ok(marcas.length >= 2, `se esperaban al menos 2 proyecciones, hay ${marcas.length}`);

    for (const m of marcas) {
      const { texto } = extraerProyeccion(m[1]);
      assert.match(
        texto,
        /canonical_origin:\s*ep\.canonical_origin\s*\?\?\s*null/,
        `la proyección de '${m[1]}' no copia canonical_origin`,
      );
      assert.match(
        texto,
        /canonical_source_ref:\s*ep\.canonical_source_ref\s*\?\?\s*null/,
        `la proyección de '${m[1]}' no copia canonical_source_ref`,
      );
      assert.doesNotMatch(
        texto,
        /canonical_origin:\s*"/,
        `la proyección de '${m[1]}' SELLA una constante; convertir no es nacer`,
      );
    }
  });
});
