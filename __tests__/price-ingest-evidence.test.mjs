import assert from "node:assert/strict";
import test from "node:test";
import {
  hasReliableProviderEvidence,
  VERIFIED_ROCA_BC3_URL,
} from "../lib/price-ingest-evidence.ts";

const validRocaProduct = {
  price: 169,
  sku: "ROCA-A212106001",
  product_url: VERIFIED_ROCA_BC3_URL,
  raw_price: "169,00 €",
  currency: "EUR",
  seller: "Roca",
  price_includes_vat: false,
  vat_rate: 21,
  evidence_type: "official_bc3_catalog",
  manufacturer_reference: "A212106001",
  catalog_sha256: "a".repeat(64),
  catalog_published_at: "2026-06-30T00:00:00.000Z",
};

test("accepts a Roca product backed by the official BC3 catalogue", () => {
  assert.equal(hasReliableProviderEvidence("Roca", validRocaProduct), true);
});

test("rejects Roca catalogue rows without an immutable catalogue hash", () => {
  assert.equal(
    hasReliableProviderEvidence("Roca", {
      ...validRocaProduct,
      catalog_sha256: "",
    }),
    false
  );
});

test("rejects Roca catalogue rows that pretend the net price includes VAT", () => {
  assert.equal(
    hasReliableProviderEvidence("Roca", {
      ...validRocaProduct,
      price_includes_vat: true,
    }),
    false
  );
});

test("keeps accepting verified direct-seller product pages", () => {
  assert.equal(
    hasReliableProviderEvidence("Leroy Merlin", {
      price: 4.95,
      sku: "LM-12345",
      product_url: "https://www.leroymerlin.es/productos/cemento-12345.html",
      raw_price: "4,95 €",
      currency: "EUR",
    }),
    true
  );
});

const validObramatCatalogProduct = {
  price: 10.5,
  sku: "OB-25091202",
  product_url:
    "https://www.obramat.es/productos/mortero-adhesivo-y-regularizador-satepro-therm-25-kg-gris-25091202.html",
  raw_price: "10,50 €",
  currency: "EUR",
  seller: "OBRAMAT",
  price_includes_vat: true,
  vat_rate: 21,
  evidence_type: "official_pdf_catalog",
  manufacturer_reference: "25091202",
  catalog_sha256: "b".repeat(64),
  catalog_published_at: "2026-03-14T12:27:00.000Z",
  catalog_url:
    "https://view.publitas.com/105196/2909135/pdfs/6d8b4a54-a24c-4e95-8692-3cf3ac5bf358.pdf",
  catalog_store: "Alicante",
  catalog_page: 20,
};

test("accepts an OBRAMAT product backed by its official store catalogue", () => {
  assert.equal(
    hasReliableProviderEvidence("OBRAMAT", validObramatCatalogProduct),
    true
  );
});

test("accepts the exact official catalogue page when no product link is embedded", () => {
  assert.equal(
    hasReliableProviderEvidence("OBRAMAT", {
      ...validObramatCatalogProduct,
      product_url:
        "https://view.publitas.com/catalogo-2026/catalogo-2026-alicante/page/20",
    }),
    true
  );
});

test("rejects an OBRAMAT catalogue source that points to another page", () => {
  assert.equal(
    hasReliableProviderEvidence("OBRAMAT", {
      ...validObramatCatalogProduct,
      product_url:
        "https://view.publitas.com/catalogo-2026/catalogo-2026-alicante/page/21",
    }),
    false
  );
});

test("rejects an OBRAMAT catalogue row with a mismatched product URL", () => {
  assert.equal(
    hasReliableProviderEvidence("OBRAMAT", {
      ...validObramatCatalogProduct,
      product_url:
        "https://www.obramat.es/productos/otro-producto-25091299.html",
    }),
    false
  );
});

test("rejects an OBRAMAT catalogue row without its store scope", () => {
  assert.equal(
    hasReliableProviderEvidence("OBRAMAT", {
      ...validObramatCatalogProduct,
      catalog_store: "",
    }),
    false
  );
});

const validIkeaProduct = {
  price: 7.99,
  sku: "IKEA-605.800.77",
  product_url:
    "https://www.ikea.com/es/es/p/zebrasav-lampara-techo-marron-papel-pintado-60580077/",
  raw_price: "7,99 €",
  currency: "EUR",
  seller: "IKEA",
  price_includes_vat: true,
  vat_rate: 21,
  evidence_type: "official_product_page",
  manufacturer_reference: "605.800.77",
};

test("accepts an IKEA Spain product with official JSON-LD evidence", () => {
  assert.equal(hasReliableProviderEvidence("IKEA", validIkeaProduct), true);
});

test("rejects IKEA evidence from a non-product path or mismatched seller", () => {
  assert.equal(
    hasReliableProviderEvidence("IKEA", {
      ...validIkeaProduct,
      product_url: "https://www.ikea.com/es/es/cat/productos-products/",
    }),
    false
  );
  assert.equal(
    hasReliableProviderEvidence("IKEA", {
      ...validIkeaProduct,
      seller: "Marketplace",
    }),
    false
  );
});
