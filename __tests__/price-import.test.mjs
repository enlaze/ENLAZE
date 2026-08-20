import test from "node:test";
import assert from "node:assert/strict";
import { analyzeCSV, parseLocalizedPrice } from "../lib/price-import.ts";

test("interpreta importes españoles e internacionales sin perder los millares", () => {
  assert.equal(parseLocalizedPrice("1.234,56 €"), 1234.56);
  assert.equal(parseLocalizedPrice("1,234.56"), 1234.56);
  assert.equal(parseLocalizedPrice("1.234"), 1234);
  assert.equal(parseLocalizedPrice("12,50"), 12.5);
});

test("conserva todas las filas válidas aunque la vista previa muestre solo 50", () => {
  const lines = ["Producto;Precio"];
  for (let index = 1; index <= 55; index += 1) {
    lines.push(`Producto ${index};${index},50`);
  }

  const analysis = analyzeCSV(lines.join("\n"));
  assert.equal(analysis.total_rows, 55);
  assert.equal(analysis.rows.length, 55);
  assert.equal(analysis.preview.length, 50);
  assert.equal(analysis.rows[54].unit_price, 55.5);
});
