import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");
const cache = path.join(root, "node_modules/.cache");
mkdirSync(cache, { recursive: true });
const dir = mkdtempSync(path.join(cache, "received-invoices-ocr-"));
test.after(() => { rmSync(dir, { recursive: true, force: true }); delete globalThis.__receivedOcrTest; });
const stubs = {
  "@anthropic-ai/sdk": `export default class Anthropic { static NotFoundError = class extends Error {}; messages = { create: async () => { globalThis.__receivedOcrTest.ai++; return { content: [{type: 'text', text: '{"invoice_number":"OCR-1","total_amount":121}'}], usage: {} }; } }; }`,
  "@supabase/supabase-js": `export const createClient = () => ({ storage: { from(bucket) { globalThis.__receivedOcrTest.buckets.push(bucket); return { upload: async (path) => ({ data: { path }, error: null }) }; } } });`,
  "@/lib/supabase-server": `export const createClient = async () => ({ auth: { getUser: async () => ({ data: { user: { id: '11111111-1111-4111-8111-111111111111' } } }) }, from() { throw new Error('OCR must never insert an invoice'); } });`,
  "sharp": `export default () => { const chain = { rotate: () => chain, metadata: async () => ({width:100,height:100}), resize: () => chain, flatten: () => chain, jpeg: () => chain, toBuffer: async () => Buffer.from('image') }; return chain; };`,
  "@/lib/ai-logger": `export const logAiRun = () => {}; export const hashText = async () => 'fixture-hash';`,
  "@/lib/rate-limit": `export const rateLimitSensitive = () => ({ allowed: true });`,
  "@/lib/account-write-lease": `export const beginAccountWriteLease = async () => 'lease'; export const endAccountWriteLease = async () => {};`,
  "@/lib/subscription": `export const requireWriteAccess = async () => null; export const reserveUsage = async () => { globalThis.__receivedOcrTest.quota++; return null; };`,
};
const bundle = path.join(dir, "ocr.cjs");
await build({
  entryPoints: [path.join(root, "app/api/invoices/ocr/route.ts")], outfile: bundle,
  platform: "node", format: "cjs", bundle: true, packages: "external", logLevel: "silent",
  plugins: [{ name: "ocr-transport", setup(builder) {
    builder.onResolve({ filter: /.*/ }, (args) => args.path in stubs ? { path: args.path, namespace: "test" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "test" }, (args) => ({ contents: stubs[args.path] }));
  } }],
});
const { POST } = createRequire(import.meta.url)(bundle);
const request = (mode) => {
  const form = new FormData();
  if (mode) form.set("mode", mode);
  form.set("file", new File(["image"], "factura.jpg", { type: "image/jpeg" }));
  return new Request("https://fixture.invalid/api/invoices/ocr", { method: "POST", body: form });
};

test("OCR rechaza modo heredado o desconocido antes de gastar cuota, subir o extraer", async () => {
  globalThis.__receivedOcrTest = { ai: 0, quota: 0, buckets: [] };
  for (const mode of [undefined, "legacy", "unknown"]) {
    const response = await POST(request(mode));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /mode=extract/);
  }
  assert.deepEqual(globalThis.__receivedOcrTest, { ai: 0, quota: 0, buckets: [] });
});

test("OCR extract devuelve un borrador privado revisable y no inserta facturas ni líneas", async () => {
  globalThis.__receivedOcrTest = { ai: 0, quota: 0, buckets: [] };
  const response = await POST(request("extract"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ocr_data.invoice_number, "OCR-1");
  assert.equal(body.invoice, undefined);
  assert.match(body.image_url, /^storage:\/\/received-invoice-documents\/[^/]+\/drafts\//);
  assert.deepEqual(globalThis.__receivedOcrTest, { ai: 1, quota: 1, buckets: ["received-invoice-documents"] });
});

test("ningún consumidor activo lee o escribe las tablas heredadas fuera del borrado de cuenta", () => {
  const walk = (dir) => readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((item) =>
    item.isDirectory() ? walk(`${dir}/${item.name}`) : [`${dir}/${item.name}`]);
  const legacy = [...walk("app"), ...walk("lib"), ...walk("components")]
    .filter((file) => /\.[jt]sx?$/.test(file))
    .filter((file) => /\.from\(["'](?:invoices|invoice_items)["']\)/.test(read(file)));
  assert.deepEqual(legacy, ["app/api/account/delete/route.ts"]);
  assert.match(read("app/dashboard/facturas/page.tsx"), /redirect\(/);
  assert.match(read("app/dashboard/facturas/page.tsx"), /dashboard\/facturacion\?tab=recibidas/);
  assert.match(read("app/portal/[token]/page.tsx"), /supabase.rpc\("portal_read_snapshot"/);
  assert.doesNotMatch(read("lib/platform-assistant-guide.ts"), /dashboard\/facturas/);
});
