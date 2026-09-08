// Banco ejecutable de `lib/margins.ts`.
//
// El margen dejó de estar escrito a mano en el asistente y pasa a resolverse
// desde `margin_config`. La regla —específico del servicio, si no general, si
// no defecto— decide el precio que ve el cliente, así que se prueba aquí en vez
// de confiar en que el Provider la aplique bien.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MARGIN_PERCENT,
  resolveMarginPercent,
  marginMultiplier,
  clampMarginPercent,
  fetchMarginPercent,
} from "../lib/margins.ts";

const CONFIG = [
  { service_type: "general", margin_percent: "20.00" },
  { service_type: "reforma", margin_percent: "65.00" },
  { service_type: "electricidad", margin_percent: "3.00" },
];

describe("resolveMarginPercent", () => {
  test("prefiere el margen específico del tipo de servicio", () => {
    assert.equal(resolveMarginPercent(CONFIG, "reforma"), 65);
    assert.equal(resolveMarginPercent(CONFIG, "electricidad"), 3);
  });

  test("cae al general cuando el servicio no tiene margen propio", () => {
    assert.equal(resolveMarginPercent(CONFIG, "fontaneria"), 20);
  });

  test("cae al defecto cuando no hay configuración", () => {
    assert.equal(resolveMarginPercent([], "reforma"), DEFAULT_MARGIN_PERCENT);
    assert.equal(resolveMarginPercent(null, "reforma"), DEFAULT_MARGIN_PERCENT);
  });

  test("cae al defecto cuando hay filas pero ninguna aplicable", () => {
    const sinGeneral = [{ service_type: "reforma", margin_percent: 65 }];
    assert.equal(resolveMarginPercent(sinGeneral, "diseno"), DEFAULT_MARGIN_PERCENT);
  });

  test("un margen del 0% es un valor legítimo, no una ausencia", () => {
    const aCero = [{ service_type: "general", margin_percent: 0 }];
    assert.equal(resolveMarginPercent(aCero, "loquesea"), 0);
  });

  test("acepta numeric como cadena, que es como llega de PostgREST", () => {
    assert.equal(resolveMarginPercent(CONFIG, "reforma"), 65);
    assert.equal(typeof resolveMarginPercent(CONFIG, "reforma"), "number");
  });

  test("ignora valores no numéricos en vez de propagar NaN a los precios", () => {
    const roto = [
      { service_type: "reforma", margin_percent: "no-es-un-numero" },
      { service_type: "general", margin_percent: 30 },
    ];
    assert.equal(resolveMarginPercent(roto, "reforma"), 30);
  });

  test("es indiferente a mayúsculas y espacios en el tipo de servicio", () => {
    assert.equal(resolveMarginPercent(CONFIG, "  Reforma "), 65);
  });

  test("pedir 'general' explícitamente devuelve el general", () => {
    assert.equal(resolveMarginPercent(CONFIG, "general"), 20);
  });
});

describe("marginMultiplier", () => {
  test("convierte porcentaje en multiplicador sobre el coste", () => {
    assert.equal(marginMultiplier(65), 1.65);
    assert.equal(marginMultiplier(0), 1);
  });

  test("un porcentaje corrupto no puede envenenar el multiplicador", () => {
    assert.equal(marginMultiplier(Number.NaN), 1 + DEFAULT_MARGIN_PERCENT / 100);
  });
});

describe("clampMarginPercent", () => {
  test("rechaza negativos y no numéricos", () => {
    assert.equal(clampMarginPercent(-10), 0);
    assert.equal(clampMarginPercent(""), DEFAULT_MARGIN_PERCENT);
    assert.equal(clampMarginPercent("abc"), DEFAULT_MARGIN_PERCENT);
  });

  test("conserva los valores válidos y acota los absurdos", () => {
    assert.equal(clampMarginPercent(65), 65);
    assert.equal(clampMarginPercent("42.5"), 42.5);
    assert.equal(clampMarginPercent(99999), 1000);
  });
});

describe("fetchMarginPercent", () => {
  function clienteFalso(respuesta) {
    return {
      from() {
        return {
          select() {
            return { eq: async () => respuesta };
          },
        };
      },
    };
  }

  test("resuelve desde lo que devuelve la tabla", async () => {
    const margen = await fetchMarginPercent(
      clienteFalso({ data: CONFIG, error: null }),
      "usuario-1",
      "reforma",
    );
    assert.equal(margen, 65);
  });

  test("un error de lectura no impide presupuestar", async () => {
    const margen = await fetchMarginPercent(
      clienteFalso({ data: null, error: { message: "boom" } }),
      "usuario-1",
      "reforma",
    );
    assert.equal(margen, DEFAULT_MARGIN_PERCENT);
  });
});
