import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const route = fs.readFileSync(
  path.join(root, "app/api/webhooks/construccion/route.ts"),
  "utf8"
);

test("el webhook tolera registros históricos duplicados", () => {
  assert.doesNotMatch(route, /\.maybeSingle\(\)/);
  assert.equal(route.match(/\.in\("id", existingIds\)/g)?.length, 3);
});

test("precios, normativas y noticias conservan su búsqueda idempotente", () => {
  for (const dataType of ["price", "regulation", "news"]) {
    assert.match(route, new RegExp(`\\.eq\\("data_type", "${dataType}"\\)`));
  }
  assert.equal(
    route.match(/const existingIds = \(existingRows \|\| \[\]\)\.map/g)?.length,
    3
  );
});
