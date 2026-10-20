import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PriceProvenanceSummary } from "../components/budgets/PriceProvenanceSummary.tsx";

test("the shared wizard/detail summary renders the amount percentage and the resolved 0%", () => {
  const render = lines => renderToStaticMarkup(React.createElement(PriceProvenanceSummary, { lines }));
  assert.match(render([
    { subtotal: 950, price_source_type: "ai_estimate" },
    { subtotal: 50, price_source_type: "technical_bank" },
  ]), /1 de 2 líneas sin fuente verificable — 95 % del importe/);
  assert.match(render([{ subtotal: 10, price_source_type: "technical_bank" }]),
    /0 de 1 líneas sin fuente verificable — 0 % del importe/);
  assert.match(render([{ subtotal: 10, price_source_type: null }]),
    /1 de 1 líneas sin fuente verificable — 100 % del importe/);
  assert.equal(render([]), "");
});
