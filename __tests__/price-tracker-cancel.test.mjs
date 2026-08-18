import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isRetryableBrowserError, mapWithConcurrency } = require(
  "../scripts/scraper-precios.js"
);
const root = path.resolve(import.meta.dirname, "..");

test("el planificador deja de iniciar trabajos cuando se activa la cancelación", async () => {
  const started = [];
  let cancelled = false;

  const results = await mapWithConcurrency(
    ["uno", "dos", "tres"],
    1,
    async (item) => {
      started.push(item);
      cancelled = true;
      return item;
    },
    () => cancelled
  );

  assert.deepEqual(started, ["uno"]);
  assert.deepEqual(results, ["uno"]);
});

test("la API cancela solo solicitudes propias y evita que n8n las reactive", () => {
  const route = fs.readFileSync(
    path.join(root, "app/api/prices/n8n-sync/route.ts"),
    "utf8"
  );

  assert.match(route, /export async function DELETE\(request: Request\)/);
  assert.match(route, /currentRow\.data\?\.requested_by !== user\.id/);
  assert.match(route, /phase: "cancelled"/);
  assert.match(route, /p_expected_status: "processing"/);
  assert.match(route, /if \(currentRow\.data\?\.phase === "cancelled"\)/);
  assert.match(route, /if \(action === "status"\)/);
});

test("la interfaz permite detener el rastreo en la página y en segundo plano", () => {
  const page = fs.readFileSync(
    path.join(root, "app/dashboard/prices/page.tsx"),
    "utf8"
  );
  const background = fs.readFileSync(
    path.join(root, "components/PriceTrackerBackgroundStatus.tsx"),
    "utf8"
  );
  const scraper = fs.readFileSync(
    path.join(root, "scripts/scraper-precios.js"),
    "utf8"
  );

  assert.match(page, /Detener rastreo/);
  assert.match(page, /method: "DELETE"/);
  assert.match(background, /Detener/);
  assert.match(background, /method: "DELETE"/);
  assert.match(scraper, /startSyncCancellationMonitor/);
  assert.match(scraper, /activeBrowsers/);
});

test("ManoMano reintenta páginas con errores temporales del servidor", () => {
  assert.equal(
    isRetryableBrowserError(
      new Error(
        'No aparecieron tarjetas en la página 11. Título: "500 - Error interno del servidor".'
      )
    ),
    true
  );
  assert.equal(
    isRetryableBrowserError(
      new Error("ManoMano activó su verificación de seguridad")
    ),
    false
  );
});
