import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/* Enlaze no envía nada a la AEAT, así que ninguna factura puede salir marcada
   como registrada en Verifactu, ni la app puede prometer firma en Facturae. */

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "node_modules" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

const code = ["app", "components", "lib"].flatMap(sourceFiles).map((file) => ({
  file,
  src: readFileSync(file, "utf8"),
}));

test("ninguna factura nueva se marca como registrada en Verifactu", () => {
  const writes = code.flatMap(({ file, src }) =>
    [...src.matchAll(/verifactu_registered:\s*([^,\n}]+)/g)]
      // Las declaraciones de tipo (`verifactu_registered: boolean`) no escriben.
      .filter(([, value]) => !/^boolean;?$/.test(value.trim()))
      .map(([, value]) => `${file}: ${value.trim()}`),
  );
  assert.ok(writes.length >= 2, `se esperaban las dos altas de factura, hay ${writes.length}`);
  assert.deepEqual(writes.filter((w) => !w.endsWith(": false")), []);
});

test("Ajustes no da verifactu_enabled por activado si no hay valor guardado", () => {
  const src = readFileSync("components/settings/EmpresaPanel.tsx", "utf8");
  assert.match(src, /verifactu_enabled: false,/);
  assert.match(src, /verifactu_enabled: fiscal\?\.verifactu_enabled \?\? false/);
  assert.doesNotMatch(src, /verifactu_enabled: true/);
});

test("la migración cambia solo el valor por defecto, sin tocar filas", () => {
  const dir = "supabase/migrations";
  const file = readdirSync(dir).find((f) => /_fiscal_settings_verifactu_disabled_by_default\.sql$/.test(f));
  assert.ok(file, "falta la migración del valor por defecto");
  const sql = readFileSync(join(dir, file), "utf8").replace(/--.*$/gm, "");
  assert.match(sql, /alter table public\.fiscal_settings\s+alter column verifactu_enabled set default false/i);
  assert.doesNotMatch(sql, /\b(update|delete|insert)\b/i);
});

test("ningún texto promete Facturae firmado", () => {
  const promises = code.filter(({ src }) => /Facturae[^"`\n]{0,40}firmad|firmad[^"`\n]{0,40}Facturae|XAdES/i.test(src));
  assert.deepEqual(promises.map(({ file }) => file), []);
});

test("Ajustes no ofrece un interruptor de Facturae que no hace nada", () => {
  const src = readFileSync("components/settings/EmpresaPanel.tsx", "utf8");
  assert.doesNotMatch(src, /Facturación electrónica B2B/);
  assert.doesNotMatch(src, /patch\(\{ facturae_enabled/);
});

test("la firma de presupuestos describe lo que hace, sin afirmar que cumple una norma", () => {
  const src = readFileSync("app/firmar/[id]/page.tsx", "utf8");
  assert.doesNotMatch(src, /eIDAS|Cumple con/i);
  assert.match(src, /Firma con código de verificación enviado al cliente por email/);
});
