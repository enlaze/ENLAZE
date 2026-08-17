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
