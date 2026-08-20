import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildLocalAssistantAnswer,
  suggestPathForQuestion,
} from "../lib/platform-assistant-guide.ts";
import { selectPreferredSpanishFemaleVoice } from "../lib/platform-assistant-voice.ts";

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

test("la ayuda ofrece una conversación de voz continua e interrumpible", async () => {
  const source = await readFile(
    new URL("../components/PlatformAssistant.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /Iniciar conversación por voz/);
  assert.match(source, /recognition\.interimResults = true/);
  assert.match(source, /utterance\.onend = finishSpeaking/);
  assert.match(source, /startListeningRef\.current\(\)/);
  assert.match(source, /Interrumpir y hablar/);
  assert.match(source, /speechSynthesis\.cancel\(\)/);
  assert.match(source, /voice_mode: conversationModeRef\.current/);
  assert.match(source, /selectPreferredSpanishFemaleVoice/);
  assert.match(source, /utterance\.rate = 0\.96/);
  assert.match(source, /Voz femenina activada/);
});

test("la voz prioriza una opción femenina y natural en español", () => {
  const selected = selectPreferredSpanishFemaleVoice([
    { name: "Jorge", lang: "es-ES", localService: true },
    { name: "Microsoft Elvira Online (Natural)", lang: "es-ES" },
    { name: "Samantha", lang: "en-US", localService: true },
  ]);

  assert.equal(selected?.name, "Microsoft Elvira Online (Natural)");
});

test("Ayuda IA se desplaza según la altura real del rastreador", async () => {
  const [assistantSource, trackerSource] = await Promise.all([
    readFile(new URL("../components/PlatformAssistant.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/PriceTrackerBackgroundStatus.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(trackerSource, /--enlaze-price-tracker-offset/);
  assert.match(trackerSource, /ResizeObserver/);
  assert.match(trackerSource, /getBoundingClientRect\(\)\.height/);
  assert.match(assistantSource, /var\(--enlaze-price-tracker-offset, 0px\)/);
  assert.match(assistantSource, /transition-\[bottom\]/);
});

test("el servidor adapta las respuestas al modo hablado", async () => {
  const source = await readFile(
    new URL("../app/api/platform-assistant/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /const voiceMode = body\.voice_mode === true/);
  assert.match(source, /Habla como una persona cercana y profesional/);
  assert.match(source, /una sola pregunta aclaratoria/);
});
