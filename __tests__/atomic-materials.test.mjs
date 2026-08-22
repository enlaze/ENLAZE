import test from "node:test";
import assert from "node:assert/strict";

import { buildScopeMaterials } from "../lib/budget-engine.ts";
import {
  auditAtomicMaterialName,
  isCommercialProductMaterial,
  isServiceMaterial,
} from "../lib/material-procurement.ts";

const integralScope = {
  superficie_m2: 160,
  num_banos: 2,
  incluye_cocina: true,
  incluye_ventanas: true,
  incluye_climatizacion: true,
  estancias: ["vivienda_completa"],
  actuaciones: [],
  calidad: "media",
  ubicacion: "Alicante",
  project_context: "existing_renovation",
};

test("the integral basket contains stable, atomic and auditable procurement lines", () => {
  const materials = buildScopeMaterials(integralScope);
  const products = materials.filter(isCommercialProductMaterial);
  const services = materials.filter(isServiceMaterial);

  assert.ok(products.length > 30, `only ${products.length} product lines were generated`);
  assert.equal(new Set(materials.map((material) => material.id)).size, materials.length);
  assert.ok(products.every((material) => material.specification.trim().length > 0));
  assert.ok(products.every((material) => auditAtomicMaterialName(material.name).isAtomic));
  assert.equal(services.length, 1);
  assert.match(services[0].name, /servicio de contenedor/i);
});

test("legacy bundles and unresolved choices fail the atomic gate", () => {
  for (const legacyName of [
    "Cuadro eléctrico + protecciones",
    "Racores y accesorios multicapa",
    "Pavimento cerámico/laminado",
    "Rodillos + brochas + cubetas",
  ]) {
    assert.equal(auditAtomicMaterialName(legacyName).isAtomic, false, legacyName);
  }

  assert.equal(auditAtomicMaterialName("Magnetotérmico 1P+N 16A curva C").isAtomic, true);
  assert.equal(auditAtomicMaterialName("Llave de corte escuadra 1/2 x 3/8 pulgadas").isAtomic, true);
});

test("product coverage excludes local services from its denominator", () => {
  const materials = buildScopeMaterials({
    ...integralScope,
    actuaciones: ["gestion_residuos"],
  });

  assert.equal(materials.filter(isCommercialProductMaterial).length, 0);
  assert.equal(materials.filter(isServiceMaterial).length, 1);
});
