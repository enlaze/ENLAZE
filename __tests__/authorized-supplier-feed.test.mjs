import assert from "node:assert/strict";
import test from "node:test";
import importer from "../scripts/import-authorized-supplier-feed.js";

const { buildProducts, PROVIDERS } = importer;

test("normalizes an authorized direct-seller Leroy feed", () => {
  const products = buildProducts(
    "leroy",
    PROVIDERS.leroy,
    {
      source: {},
      products: [
        {
          name: "Cemento gris 25 kg",
          reference: "12345",
          price: 4.95,
          unit: "saco",
          product_url:
            "https://www.leroymerlin.es/productos/cemento-gris-25-kg-12345.html",
        },
      ],
    },
    "a".repeat(64),
    "LM-AUTH-2026-001"
  );

  assert.equal(products.length, 1);
  assert.equal(products[0].sku, "LM-12345");
  assert.equal(products[0].seller, "Leroy Merlin");
  assert.equal(products[0].price_includes_vat, true);
  assert.equal(products[0].authorization_reference, "LM-AUTH-2026-001");
});

test("normalizes an authorized Grupo Puma tariff with immutable evidence", () => {
  const products = buildProducts(
    "grupo-puma",
    PROVIDERS["grupo-puma"],
    {
      source: {
        catalog_url:
          "https://www.grupopuma.com/uploads/tarifas/tarifa-profesional-2026.pdf",
        catalog_published_at: "2026-01-01T00:00:00.000Z",
        price_includes_vat: false,
      },
      products: [
        {
          name: "Pegoland C2TE 25 kg",
          reference: "PEGOLAND-C2TE-25",
          price: 13.9,
          unit: "saco",
        },
      ],
    },
    "b".repeat(64),
    "PUMA-AUTH-2026-001"
  );

  assert.equal(products.length, 1);
  assert.equal(products[0].sku, "PUMA-PEGOLAND-C2TE-25");
  assert.equal(products[0].catalog_sha256, "b".repeat(64));
  assert.equal(products[0].evidence_type, "authorized_price_tariff");
});

test("rejects conflicting prices for one authorized reference", () => {
  assert.throws(
    () =>
      buildProducts(
        "leroy",
        PROVIDERS.leroy,
        {
          source: {},
          products: [
            {
              name: "Cemento gris 25 kg",
              reference: "12345",
              price: 4.95,
              product_url:
                "https://www.leroymerlin.es/productos/cemento-gris-25-kg-12345.html",
            },
            {
              name: "Cemento gris 25 kg",
              reference: "12345",
              price: 5.25,
              product_url:
                "https://www.leroymerlin.es/productos/cemento-gris-25-kg-12345.html",
            },
          ],
        },
        "c".repeat(64),
        "LM-AUTH-2026-001"
      ),
    /precios contradictorios/
  );
});
