import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { claimUniqueProduct } from "../lib/price-ingest-dedupe.ts";

test("deduplica productos nuevos por nombre y por SKU", () => {
  const claimed = new Set();

  assert.equal(
    claimUniqueProduct(claimed, { name: "Foco LED", sku: "MM-001" }),
    true
  );
  assert.equal(
    claimUniqueProduct(claimed, { name: "  foco led ", sku: "MM-002" }),
    false
  );
  assert.equal(
    claimUniqueProduct(claimed, { name: "Lámpara de obra", sku: "MM-001" }),
    false
  );
});

test("la ingesta resuelve carreras entre categorías con un upsert único", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const route = fs.readFileSync(
    path.join(root, "app/api/pb/ingest/route.ts"),
    "utf8"
  );

  assert.match(route, /claimUniqueProduct\(claimedNewProductKeys, product\)/);
  assert.match(route, /onConflict: "provider_id,commercial_name"/);
});
