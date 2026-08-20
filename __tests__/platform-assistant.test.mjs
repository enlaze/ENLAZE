import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLocalAssistantAnswer,
  suggestPathForQuestion,
} from "../lib/platform-assistant-guide.ts";

test("la guía local explica el panel principal sin depender de una API externa", () => {
  const result = buildLocalAssistantAnswer("Explícame el panel principal", "/dashboard");
  assert.match(result.answer, /centro de control/i);
  assert.match(result.answer, /avisos/i);
});

test("la guía local explica cómo crear un presupuesto y enlaza el generador", () => {
  const result = buildLocalAssistantAnswer("Quiero hacer un presupuesto", "/dashboard");
  assert.match(result.answer, /ubicación, superficie, estancias, actuaciones y calidad/i);
  assert.equal(result.suggestedPath, "/dashboard/budgets/generate");
});

test("las preguntas con tildes también encuentran su sección", () => {
  assert.equal(
    suggestPathForQuestion("¿Dónde añado una medición al proyecto?"),
    "/dashboard/projects",
  );
});
