import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* "+ Nueva factura recibida" en la ficha del proveedor abre el alta en
   Facturación › Recibidas con ese proveedor ya puesto. */

const ficha = readFileSync("app/dashboard/suppliers/[id]/page.tsx", "utf8");
const hub = readFileSync("app/dashboard/facturacion/page.tsx", "utf8");
const hook = readFileSync("components/facturacion/useReceivedInvoices.ts", "utf8");

test("la ficha enlaza al alta en Recibidas con el proveedor y nueva=1", () => {
  assert.match(
    ficha,
    /href=\{`\/dashboard\/facturacion\?tab=recibidas&supplier=\$\{encodeURIComponent\(id\)\}&nueva=1`\}/,
  );
  assert.doesNotMatch(ficha, /suppliers\/invoices\/new/);
});

test("el hub pasa el proveedor al hook solo con nueva=1 y luego quita nueva de la URL", () => {
  assert.match(hub, /const openNew = searchParams\.get\("nueva"\) === "1";/);
  assert.match(hub, /openNew \? supplierFilter : "",/);
  assert.match(hub, /params\.delete\("nueva"\)/);
});

test("el hook abre el alta una sola vez, con el proveedor de la lista de activos", () => {
  assert.match(hook, /openNewForSupplier = "",/);
  assert.match(hook, /const openNewForSupplierAtMount = useRef\(openNewForSupplier\);/);
  assert.match(hook, /suppliersResult\.data\?\.find\(\(s\) => s\.id === openFor\)/);
  assert.match(hook, /if \(supplier && !openedForSupplier\.current\) \{\s*openedForSupplier\.current = true;/);
  assert.match(hook, /supplier_id: supplier\.id,\s*supplier_name: supplier\.name,\s*supplier_nif: supplier\.nif \|\| "",/);
  assert.match(hook, /setShowForm\(true\);/);
});
