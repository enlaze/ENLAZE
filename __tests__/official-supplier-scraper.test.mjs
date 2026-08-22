import assert from "node:assert/strict";
import test from "node:test";
import scraper from "../scripts/scraper-proveedores-oficiales.js";

const { PROVIDERS } = scraper;

const BASKET_COVERAGE_CATEGORIES = [
  "perfiles_yeso",
  "multicapa",
  "colectores",
  "llaves_paso",
  "pvc_evacuacion",
  "sifones_valvulas",
  "cables",
  "cuadros_electricos",
  "mecanismos_empotrar",
  "cementos_cola",
  "suelos_porcelanicos",
  "imprimaciones",
  "masillas_reparacion",
  "plasticos_protectores",
  "cintas_pintor",
  "brochas",
  "rodillos",
  "lavabos",
  "inodoros",
  "platos_ducha",
  "mamparas_frontales",
  "griferia_ducha",
  "siliconas",
];

test("covers the missing construction basket families with official OBRAMAT categories", () => {
  const categories = new Map(
    PROVIDERS.obramat.categories.map((category) => [category.key, category])
  );

  for (const categoryKey of BASKET_COVERAGE_CATEGORIES) {
    assert.ok(categories.has(categoryKey), `missing ${categoryKey}`);
    const category = categories.get(categoryKey);
    const url = new URL(category.url);
    assert.equal(url.origin, PROVIDERS.obramat.origin);
    assert.ok(category.category);
    assert.ok(category.subcategory);
  }
});

test("keeps official supplier category keys unique", () => {
  for (const provider of Object.values(PROVIDERS)) {
    const keys = provider.categories.map((category) => category.key);
    assert.equal(new Set(keys).size, keys.length, provider.name);
  }
});
