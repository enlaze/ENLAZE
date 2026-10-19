// b15: el registro de React Bits está configurado y su LogoLoop (TS + Tailwind)
// sirve para la cinta de sectores. Se renderiza en el servidor, sin navegador.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LogoLoop } from "../components/react-bits/LogoLoop.tsx";
import { SECTOR_OPTIONS } from "../lib/sectors.ts";

test("components.json apunta al registro gratuito de React Bits y no toca Tailwind", () => {
  const cfg = JSON.parse(readFileSync("components.json", "utf8"));
  assert.equal(cfg.registries["@react-bits"], "https://reactbits.dev/r/{name}.json");
  assert.equal(cfg.tailwind.config, "");
  assert.equal(cfg.tailwind.cssVariables, false);
  assert.equal(cfg.aliases.components, "@/components/react-bits");
});

test("LogoLoop une las clases con espacios (el CLI de shadcn lo rompía)", () => {
  const src = readFileSync("components/react-bits/LogoLoop.tsx", "utf8");
  assert.match(src, /const cx = \(\.\.\.parts: Array<string \| false \| null \| undefined>\) => parts\.filter\(Boolean\)\.join\(' '\);/);
});

test("la cinta pinta un elemento por sector, con su nombre y sin emojis", () => {
  const sectors = SECTOR_OPTIONS.filter((s) => s.id !== "otro");
  const logos = sectors.map((s) => ({
    node: React.createElement("span", null, s.name),
    title: s.name,
  }));
  const html = renderToStaticMarkup(
    React.createElement(LogoLoop, { logos, speed: 40, gap: 48, logoHeight: 20, fadeOut: true, ariaLabel: "Sectores" }),
  );
  for (const s of sectors) assert.ok(html.includes(s.name), s.name);
  assert.match(html, /aria-label="Sectores"/);
  // Clases separadas: si cx las pegara, no habría «relative flex-none».
  assert.match(html, /relative flex-none/);
  assert.doesNotMatch(html, /\p{Emoji_Presentation}/u);
});
