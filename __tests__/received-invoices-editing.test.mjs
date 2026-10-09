// Facturas recibidas: edición, papelera, filtro por cliente y el contenido de
// factura que exige deducir el IVA (art. 6 RD 1619/2012 / manual de IVA AEAT).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseVatBreakdown,
  receivedInvoiceAmounts,
  receivedInvoiceComplianceIssues,
  receivedInvoicesCsv,
  vatBreakdownTotals,
} from "../lib/received-invoices.ts";

const complete = {
  invoice_number: "F-2026/14",
  supplier_name: "Proveedor A",
  supplier_nif: "B12345678",
  supplier_address: "Calle Mayor 1, 28013 Madrid",
  description: "Suministro de material de obra",
  subtotal: 100,
  iva_percent: 21,
  iva_amount: 21,
  vat_breakdown: null,
};

/* ── Importes ───────────────────────────────────────────────────────────── */

test("un tipo único mantiene el cálculo de siempre y no guarda desglose", () => {
  const amounts = receivedInvoiceAmounts({ subtotal: "100", iva_percent: "21", irpf_percent: "15" });
  assert.equal(amounts.subtotal, 100);
  assert.equal(amounts.ivaPct, 21);
  assert.equal(amounts.ivaAmount, 21);
  assert.equal(amounts.irpfAmount, 15);
  assert.equal(amounts.total, 106);
  assert.equal(amounts.breakdown, null);
});

test("con varios tipos, base y cuota salen del desglose y el tipo único se anula", () => {
  const amounts = receivedInvoiceAmounts({
    subtotal: "ignorado", iva_percent: "21", irpf_percent: "0",
    vat_lines: [{ base: "200", rate: "21" }, { base: "100", rate: "10" }],
  });
  assert.equal(amounts.subtotal, 300);
  assert.equal(amounts.ivaAmount, 52);
  assert.equal(amounts.total, 352);
  // No hay un tipo único que anotar: la columna se queda a null a propósito.
  assert.equal(amounts.ivaPct, null);
  assert.deepEqual(amounts.breakdown, [
    { base: 200, rate: 21, quota: 42 },
    { base: 100, rate: 10, quota: 10 },
  ]);
});

test("el desglose redondea cada cuota a céntimos antes de sumar, como el CHECK", () => {
  // 33,33 al 21 % son 6,9993: la cuota guardada es 7,00 y la suma tiene que
  // cuadrar con ese mismo 7,00, no con 6,9993, o la migración rechaza la fila.
  const amounts = receivedInvoiceAmounts({
    subtotal: "", iva_percent: "21", irpf_percent: "0",
    vat_lines: [{ base: "33.33", rate: "21" }, { base: "33.33", rate: "21" }],
  });
  assert.equal(amounts.ivaAmount, 14);
  assert.deepEqual(vatBreakdownTotals(amounts.breakdown), { base: 66.66, quota: 14 });
  assert.equal(amounts.subtotal, 66.66);
  assert.equal(amounts.total, 80.66);
});

test("el IRPF del desglose se aplica sobre la base sumada", () => {
  const amounts = receivedInvoiceAmounts({
    subtotal: "", iva_percent: "21", irpf_percent: "15",
    vat_lines: [{ base: "200", rate: "21" }, { base: "100", rate: "10" }],
  });
  assert.equal(amounts.irpfAmount, 45);
  assert.equal(amounts.total, 307);
});

test("una línea a medias no cuenta: el jsonb llega sin tipar", () => {
  assert.deepEqual(parseVatBreakdown([{ base: 100, rate: 21 }]), []);
  assert.deepEqual(parseVatBreakdown([{ base: 100, rate: 21, quota: "x" }]), []);
  assert.deepEqual(parseVatBreakdown("[]"), []);
  assert.deepEqual(parseVatBreakdown(null), []);
  assert.deepEqual(
    parseVatBreakdown([{ base: 100, rate: 21, quota: 21 }, null, { base: 50, rate: 10, quota: 5 }]),
    [{ base: 100, rate: 21, quota: 21 }, { base: 50, rate: 10, quota: 5 }],
  );
});

/* ── Contenido obligatorio de la factura ────────────────────────────────── */

test("una factura con todo el contenido obligatorio no da avisos", () => {
  assert.deepEqual(receivedInvoiceComplianceIssues(complete), []);
});

test("avisa de cada dato que impide deducir el IVA", () => {
  const issues = receivedInvoiceComplianceIssues({
    ...complete, supplier_nif: "", supplier_address: "   ", description: null, subtotal: 0,
  });
  assert.deepEqual(issues, [
    "Falta el NIF del proveedor",
    "Falta el domicilio fiscal del proveedor",
    "Falta la descripción de la operación",
    "Falta la base imponible",
  ]);
});

test("el número marcador de la factura heredada cuenta como número que falta", () => {
  // La migración de unificación puso 'SIN-NUMERO-xxxxxxxx' a la factura que no
  // traía ninguno: es un marcador, no un número correlativo de una serie.
  const issues = receivedInvoiceComplianceIssues({ ...complete, invoice_number: "SIN-NUMERO-1a2b3c4d" });
  assert.deepEqual(issues, ["Falta el número de factura"]);
});

test("un tipo distinto de cero sin cuota consignada no sirve para deducir", () => {
  assert.deepEqual(
    receivedInvoiceComplianceIssues({ ...complete, iva_amount: 0 }),
    ["Falta la cuota de IVA"],
  );
  // Una operación exenta o no sujeta, al 0 %, no es un dato que falte.
  assert.deepEqual(
    receivedInvoiceComplianceIssues({ ...complete, iva_percent: 0, iva_amount: 0 }),
    [],
  );
  // Con desglose, la cuota sale de sus líneas y el tipo único no aplica.
  assert.deepEqual(
    receivedInvoiceComplianceIssues({
      ...complete, iva_percent: null, iva_amount: 52,
      vat_breakdown: [{ base: 200, rate: 21, quota: 42 }, { base: 100, rate: 10, quota: 10 }],
    }),
    [],
  );
  assert.deepEqual(
    receivedInvoiceComplianceIssues({ ...complete, iva_percent: null, iva_amount: 0 }),
    ["Falta el tipo de IVA aplicado"],
  );
});

/* ── CSV ────────────────────────────────────────────────────────────────── */

test("el CSV añade los datos legales al final y deja %IVA vacío si hay varios tipos", () => {
  const row = {
    ...complete, id: "r1", issue_date: "2026-09-30", projects: { name: "Obra centro" },
    category: "material", irpf_percent: 0, irpf_amount: 0, total: 121, status: "approved",
    invoice_series: "A", operation_date: "2026-09-28",
  };
  const csv = receivedInvoicesCsv([row]);
  const [header, single] = csv.split("\r\n");
  assert.match(header, /"Serie";"Fecha operación";"Domicilio proveedor";"Descripción";"Desglose IVA";"Datos que faltan"$/);
  // Las trece columnas de siempre siguen en su sitio.
  assert.match(single, /"30\/09\/2026";"Obra centro";"Material";100,00;21,00;21,00;/);
  assert.match(single, /"A";"28\/09\/2026";"Calle Mayor 1, 28013 Madrid";"Suministro de material de obra";"";""$/);

  const split = receivedInvoicesCsv([{
    ...row, iva_percent: null, iva_amount: 52, subtotal: 300, total: 352,
    vat_breakdown: [{ base: 200, rate: 21, quota: 42 }, { base: 100, rate: 10, quota: 10 }],
  }]).split("\r\n")[1];
  assert.match(split, /300,00;;52,00;/);
  assert.match(split, /"200,00 al 21,00% = 42,00 \| 100,00 al 10,00% = 10,00"/);
});

test("el CSV delata las facturas incompletas, para reclamarlas al proveedor", () => {
  const csv = receivedInvoicesCsv([{
    ...complete, id: "r2", issue_date: "2026-09-30", projects: null, category: "general",
    supplier_nif: "", supplier_address: null, description: null,
    irpf_percent: 0, irpf_amount: 0, total: 121, status: "pending",
    invoice_series: null, operation_date: null,
  }]);
  assert.match(
    csv,
    /"Falta el NIF del proveedor\. Falta el domicilio fiscal del proveedor\. Falta la descripción de la operación"/,
  );
});

/* ── Migración ──────────────────────────────────────────────────────────── */

const migration = readFileSync(
  "supabase/migrations/20261010120000_received_invoice_legal_fields.sql",
  "utf8",
);

test("la migración no lleva control de transacción: el runner la agrupa con su registro", () => {
  assert.doesNotMatch(migration, /^\s*(begin|commit|rollback|start transaction)\b\s*;/im);
  assert.doesNotMatch(migration, /pg-delta:\s*transaction=false/i);
});

test("la migración añade el contenido de factura sin volverlo obligatorio", () => {
  for (const column of ["invoice_series", "operation_date", "supplier_address", "description", "vat_breakdown"]) {
    assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`));
  }
  // Ninguna columna nueva es NOT NULL: las facturas ya registradas siguen
  // siendo válidas y lo que les falte se avisa, no se rechaza.
  assert.deepEqual(migration.match(/ADD COLUMN IF NOT EXISTS \w+ \w+ NOT NULL[^;]*/g), null);
});

test("rescata el domicilio que la unificación dejaba atrás, sin pisar correcciones", () => {
  // `invoices` ya guardaba supplier_address, pero la unificación no lo trasladó
  // porque received_invoices no tenía esa columna todavía. Se vio validando con
  // datos reales: una de las dos facturas trasladadas lo perdía de vista.
  const backfill = migration.slice(
    migration.indexOf("UPDATE public.received_invoices ri"),
    migration.indexOf("-- 2. Desglose"),
  );
  assert.match(backfill, /SET supplier_address = nullif\(btrim\(i\.supplier_address\), ''\)/);
  // Por id, que la unificación conserva.
  assert.match(backfill, /WHERE i\.id = ri\.id/);
  // Solo lo que está a null: reejecutar no deshace lo que se escriba luego.
  assert.match(backfill, /AND ri\.supplier_address IS NULL/);
  assert.match(backfill, /AND nullif\(btrim\(i\.supplier_address\), ''\) IS NOT NULL/);
});

test("el desglose guardado tiene que cuadrar con la base y la cuota de la factura", () => {
  assert.match(migration, /ADD CONSTRAINT received_invoices_vat_breakdown_check/);
  assert.match(migration, /received_invoice_vat_breakdown_is_valid\(vat_breakdown\)/);
  assert.match(migration, /abs\(coalesce\(subtotal, 0\)[\s\S]*?'base'\)\) <= 0\.01/);
  assert.match(migration, /abs\(coalesce\(iva_amount, 0\)[\s\S]*?'quota'\)\) <= 0\.01/);
  // Las funciones del CHECK son IMMUTABLE o Postgres no admite la constraint.
  assert.equal((migration.match(/^IMMUTABLE$/gm) || []).length, 2);
});

test("la edición suelta la firma anterior: dos sobrecargas serían ambiguas", () => {
  assert.match(
    migration,
    /DROP FUNCTION IF EXISTS public\.update_received_invoice_and_reconcile\(\s*uuid, text, uuid, text, text, date, date, numeric, numeric, numeric, numeric, numeric, numeric, text, text\s*\)/,
  );
});

test("la edición comprueba dueño, proveedor, cliente y obra, y no toca la papelera", () => {
  const body = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.update_received_invoice_and_reconcile"));
  assert.match(body, /SECURITY DEFINER\s+SET search_path = ''/);
  // Sin RLS que filtre (es SECURITY DEFINER), el dueño y la papelera se miran
  // a mano, y la fila se bloquea antes de escribir.
  assert.match(body, /where id = p_invoice_id\s+and deleted_at is null\s+for update/);
  assert.match(body, /v_owner is null or v_owner <> v_caller/);
  for (const table of ["suppliers", "clients"]) {
    assert.match(body, new RegExp(`from public\\.${table} where id = p_\\w+ and user_id = v_caller`));
  }
  assert.match(body, /from public\.projects\s+where id = p_project_id and user_id = v_caller and deleted_at is null/);
  // El documento conservado solo lo escribe el servidor.
  assert.doesNotMatch(body, /document_url\s*=/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.update_received_invoice_and_reconcile\([\s\S]*?\) TO authenticated;/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.update_received_invoice_and_reconcile\([\s\S]*?\) FROM public, anon;/);
});

/* ── Panel ──────────────────────────────────────────────────────────────── */

const hook = readFileSync("components/facturacion/useReceivedInvoices.ts", "utf8");
const tab = readFileSync("components/facturacion/RecibidasTab.tsx", "utf8");
const form = readFileSync("components/facturacion/ReceivedInvoiceForm.tsx", "utf8");

test("eliminar es mover a la papelera, con confirmación previa", () => {
  assert.match(hook, /const ok = await confirm\(\{[\s\S]*?variant: "danger"/);
  assert.match(hook, /if \(!ok\) return;\s+setDeletingId\(invoice\.id\);/);
  assert.match(hook, /await trashReceivedInvoice\(supabase, invoice\.id\)/);
  // La papelera no borra: nada de delete() contra la tabla.
  assert.doesNotMatch(hook, /from\("received_invoices"\)[\s\S]{0,80}\.delete\(/);

  const lib = readFileSync("lib/suppliers.ts", "utf8");
  assert.match(lib, /rpc\("move_to_trash", \{\s*p_entity_type: "received_invoice"/);
  // El enlace para recuperarla está donde se borra.
  assert.match(tab, /href="\/dashboard\/trash"/);
});

test("corregir y reintentar el OCR escriben por el mismo RPC, con la clasificación dentro", () => {
  const submit = hook.slice(hook.indexOf("async function handleSubmit"));
  const call = submit.slice(submit.indexOf('rpc("update_received_invoice_and_reconcile"'));
  for (const param of [
    "p_client_id", "p_project_id", "p_category", "p_invoice_series",
    "p_operation_date", "p_supplier_address", "p_description", "p_vat_breakdown",
  ]) {
    assert.ok(call.includes(`${param}:`), `falta ${param} en el RPC de corrección`);
  }
  // Ya no queda un UPDATE suelto de clasificación que pueda fallar aparte.
  assert.doesNotMatch(hook, /\.update\(\{ client_id/);
  assert.equal((hook.match(/rpc\("update_received_invoice_and_reconcile"/g) || []).length, 1);
});

test("editar carga la factura en el mismo formulario y sale del modo al cerrar", () => {
  assert.match(hook, /function handleEditInvoice\(invoice: ReceivedInvoiceRow\)/);
  assert.match(hook, /setEditingId\(invoice\.id\)/);
  // Una factura en la papelera se restaura antes; aquí solo se corrige lo vivo.
  assert.match(hook, /let invoiceId = editingId \|\| pendingInvoiceId;/);
  // Abrir un alta nueva o cancelar tiene que salir del modo corrección, o la
  // siguiente factura sobreescribiría la que se estaba editando.
  assert.equal((hook.match(/setEditingId\(""\)/g) || []).length, 4);
  assert.match(form, /editingId\s*\?\s*"Guardar cambios"/);
  assert.match(tab, /aria-label=\{`Editar factura \$\{inv\.invoice_number\}`\}/);
});

test("el filtro por cliente llega a la consulta y arrastra el de obra", () => {
  assert.match(hook, /client_id: clientFilter \|\| undefined/);
  assert.match(hook, /function handleClientFilter\(clientId: string\)/);
  assert.match(hook, /return project && project\.client_id === clientId \? current : "";/);
  assert.match(tab, /aria-label="Filtrar por cliente"/);
  assert.match(tab, /\.filter\(\(p\) => !clientFilter \|\| p\.client_id === clientFilter\)/);

  const lib = readFileSync("lib/suppliers.ts", "utf8");
  assert.match(lib, /if \(opts\?\.client_id\) query = query\.eq\("client_id", opts\.client_id\);/);
  assert.match(lib, /select\("\*, suppliers\(name\), projects\(name\), clients\(name\)"/);
});

test("el panel marca las facturas incompletas y el formulario avisa al teclear", () => {
  assert.match(tab, /const issues = receivedInvoiceComplianceIssues\(inv\);/);
  assert.match(tab, /Datos incompletos \(\{issues\.length\}\)/);
  assert.match(form, /Con estos datos el IVA no sería deducible/);
  // Avisos, no bloqueo: solo número, nombre, fecha y base siguen siendo
  // obligatorios en el formulario.
  assert.equal((form.match(/\brequired\b/g) || []).length, 8);
});
