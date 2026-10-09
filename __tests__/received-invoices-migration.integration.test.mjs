import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Never uses a cloud URL. This schema is intentionally disposable and only
// models the tables/constraints relevant to this migration, not all Supabase.
const enabled = process.env.RUN_RECEIVED_INVOICES_SQL_TEST === "1";
const sql = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const migration = sql("supabase/migrations/20261009120000_unify_received_invoices.sql");
const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CLIENT = "10000000-0000-4000-8000-000000000001";
const PROJECT = "20000000-0000-4000-8000-000000000001";
const OTHER_PROJECT = "20000000-0000-4000-8000-000000000002";
const REAL = "30000000-0000-4000-8000-000000000001";
const IKEA = "30000000-0000-4000-8000-000000000002";
const hubId = (n) => `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("SQL real en PostgreSQL desechable: migración de recibidas", { skip: !enabled }, async (t) => {
  assert.equal(process.env.RECEIVED_INVOICES_TEST_ACK, "DISPOSABLE_CLUSTER");
  assert.deepEqual(Object.keys(process.env).filter((key) => key.startsWith("PG")), []);
  const { Client } = await import("pg");
  const db = new Client({ host: "/private/tmp/enlaze-unify-pg-socket", port: 55447, user: "postgres", database: "enlaze_received_invoices_test" });
  await db.connect();
  t.after(() => db.end());
  const identity = (await db.query(`select current_database() as db,
    current_setting('enlaze.test_cluster_marker', true) as marker,
    current_setting('data_directory') as directory,
    (select count(*)::int from pg_database where not datistemplate and datname not in ('postgres', current_database())) as other_dbs`)).rows[0];
  assert.deepEqual(identity, { db: "enlaze_received_invoices_test", marker: "unify_received_invoices_20261007", directory: "/private/tmp/enlaze-unify-pg", other_dbs: 0 });

  await db.query(sql("__tests__/support/bootstrap-budget-schema.sql"));
  await db.query(sql("__tests__/support/portal-token-access-schema.sql"));
  await db.query(sql("supabase/migrations/20260413131504_phase9_suppliers_and_received_invoices.sql"));
  await db.query(`
    alter table public.invoices
      add column supplier_id uuid references public.suppliers(id),
      add column supplier_name text, add column supplier_nif text,
      add column due_date date, add column iva_percentage numeric,
      add column irpf_percentage numeric, add column irpf_amount numeric,
      add column payment_method text, add column image_url text, add column notes text,
      add column created_at timestamptz default now(), add column updated_at timestamptz default now(),
      add column deleted_by uuid;
    alter table public.received_invoices add column deleted_at timestamptz, add column deleted_by uuid;
    create table public.invoice_items (id uuid primary key default gen_random_uuid(), invoice_id uuid references public.invoices(id));
    create table public.delivery_notes (id uuid primary key default gen_random_uuid(), invoice_id uuid references public.invoices(id));
    alter table public.invoices enable row level security;
    alter table public.invoice_items enable row level security;
    create policy "Users manage own invoices" on public.invoices for all using (user_id=auth.uid()) with check (user_id=auth.uid());
    create policy invoices_select_own on public.invoices for select using (user_id=auth.uid());
    create policy invoices_insert_own on public.invoices for insert with check (user_id=auth.uid());
    create policy invoices_update_own on public.invoices for update using (user_id=auth.uid());
    create policy invoice_items_own on public.invoice_items for all using (true) with check (true);
    grant all on public.invoices, public.invoice_items, public.received_invoices to authenticated, service_role;
    grant select, insert, update on public.invoices, public.invoice_items to anon;
  `);
  const previous = sql("supabase/migrations/20260929100000_portal_rpcs_drop_legacy_token.sql")
    .match(/create or replace function public\.portal_read_snapshot[\s\S]*?\$\$;/i)[0];
  await db.query(previous);
  await db.query("revoke all on function public.portal_read_snapshot(text) from public; grant execute on function public.portal_read_snapshot(text) to anon, authenticated");
  const definition = async () => (await db.query(`select proacl::text as acl, prosecdef as definer, proconfig as config
    from pg_proc where oid='public.portal_read_snapshot(text)'::regprocedure`)).rows[0];
  const oldDefinition = await definition();
  await db.query("insert into auth.users(id) values($1),($2)", [OWNER, OTHER]);
  await db.query("insert into public.clients(id,user_id,name) values($1,$2,'Cliente de prueba')", [CLIENT, OWNER]);
  await db.query("insert into public.projects(id,user_id,client_id,name) values($1,$2,$3,'Obra única'),($4,$2,null,'Otra obra')", [PROJECT, OWNER, CLIENT, OTHER_PROJECT]);
  const token = (await db.query("insert into public.portal_tokens(project_id,created_by) values($1,$2) returning token::text", [PROJECT, OWNER])).rows[0].token;
  await db.query(`insert into public.invoices(id,user_id,client_id,invoice_number,supplier_name,invoice_date,
      base_amount,iva_amount,irpf_amount,total_amount,category,payment_status,image_url,created_at)
    values($1,$3,$4,'F-REAL','BRICOLAJE BRICOMAN','2026-09-01',51.66,10.85,0,62.51,'material','paid','https://fixture.invalid/document.jpg','2026-09-02'),
          ($2,$3,null,'  ','Ikea',null,0,0,0,0,'unknown','pending',null,'2026-09-03')`, [REAL, IKEA, OWNER, CLIENT]);
  for (let i = 1; i <= 7; i++) await db.query(`insert into public.received_invoices
    (id,user_id,invoice_number,supplier_name,issue_date,subtotal,iva_amount,total,status)
    values($1,$2,$3,'Proveedor prueba','2026-09-01',100,21,121,'approved')`, [hubId(i), OWNER, `HUB-${i}`]);
  await db.query("insert into public.invoice_items(invoice_id) select $1::uuid from generate_series(1,8)", [REAL]);
  await db.query("insert into public.delivery_notes(invoice_id) values($1)", [REAL]);
  const apply = async () => {
    await db.query("begin");
    try { await db.query(migration); await db.query("commit"); }
    catch (error) { await db.query("rollback"); throw error; }
  };
  const snapshot = async (value = token) => (await db.query("select public.portal_read_snapshot($1) as data", [value])).rows[0].data;

  await t.test("control: el portal antiguo solo ve la factura heredada", async () => {
    assert.deepEqual((await snapshot()).invoices.map((i) => i.id), [REAL]);
    assert.equal((await db.query("select count(*)::int as n from public.received_invoices")).rows[0].n, 7);
  });
  await apply();
  await t.test("traslado 7 → 9, sin perder Ikea, documento ni importes", async () => {
    const counts = (await db.query("select count(*)::int as total,count(distinct id)::int as unique_ids from public.received_invoices")).rows[0];
    assert.deepEqual(counts, { total: 9, unique_ids: 9 });
    const ikea = (await db.query("select invoice_number,issue_date::text,category from public.received_invoices where id=$1", [IKEA])).rows[0];
    assert.deepEqual(ikea, { invoice_number: "SIN-NUMERO-30000000", issue_date: "2026-09-03", category: "general" });
    const real = (await db.query("select total,amount_paid,payment_status,status,document_url,client_id from public.received_invoices where id=$1", [REAL])).rows[0];
    assert.deepEqual(real, { total: "62.51", amount_paid: "62.51", payment_status: "paid", status: "paid", document_url: "https://fixture.invalid/document.jpg", client_id: CLIENT });
    assert.equal((await db.query("select count(*)::int as n from public.invoice_items")).rows[0].n, 8);
    assert.equal((await db.query("select count(*)::int as n from public.invoices")).rows[0].n, 2);
  });
  await t.test("albaranes: FK cambiada y enlace preexistente conservado", async () => {
    assert.equal((await db.query("select confrelid::regclass::text as target from pg_constraint where conname='delivery_notes_invoice_id_fkey'")).rows[0].target, "received_invoices");
    assert.equal((await db.query("select invoice_id from public.delivery_notes")).rows[0].invoice_id, REAL);
    await db.query("insert into public.delivery_notes(invoice_id) values($1)", [hubId(1)]);
  });
  await t.test("nuevas FK de obra y cliente usan ON DELETE SET NULL", async () => {
    const rules = (await db.query("select confdeltype from pg_constraint where conname in ('received_invoices_client_id_fkey','received_invoices_project_id_fkey')")).rows;
    assert.equal(rules.length, 2);
    assert.ok(rules.every((r) => r.confdeltype === "n"));
  });
  await t.test("escritura antigua sellada; lectura y administración conservadas", async () => {
    for (const table of ["invoices", "invoice_items"]) {
      for (const role of ["authenticated", "anon"]) {
        const row = (await db.query("select has_table_privilege($1,$2,'INSERT') as ins, has_table_privilege($1,$2,'UPDATE') as upd, has_table_privilege($1,$2,'SELECT') as sel", [role, `public.${table}`])).rows[0];
        assert.deepEqual(row, { ins: false, upd: false, sel: true });
      }
      assert.equal((await db.query("select has_table_privilege('service_role',$1,'DELETE') as allowed", [`public.${table}`])).rows[0].allowed, true);
    }
    await db.query("set role authenticated");
    try {
      await assert.rejects(db.query("update public.invoices set notes='forbidden' where id=$1", [REAL]), /permission denied/);
      await assert.rejects(db.query("insert into public.invoice_items(invoice_id) values($1)", [REAL]), /permission denied/);
    } finally { await db.query("reset role"); }
  });
  await t.test("portal: misma ACL, claves antiguas y visibilidad por obra/cliente sin fugas", async () => {
    assert.deepEqual(await definition(), oldDefinition);
    await db.query("update public.received_invoices set project_id=$1 where id in ($2,$3,$4)", [PROJECT, hubId(1), hubId(5), hubId(7)]);
    await db.query("update public.received_invoices set client_id=$1 where id in ($2,$3)", [CLIENT, hubId(2), hubId(3)]);
    await db.query("update public.received_invoices set project_id=$1 where id=$2", [OTHER_PROJECT, hubId(2)]);
    await db.query("update public.received_invoices set project_id=$1,user_id=$2 where id=$3", [PROJECT, OTHER, hubId(4)]);
    await db.query("update public.received_invoices set deleted_at=now() where id=$1", [hubId(5)]);
    let result = await snapshot();
    assert.deepEqual(new Set(result.invoices.map((i) => i.id)), new Set([REAL, hubId(1), hubId(3), hubId(7)]));
    const invoice = result.invoices.find((i) => i.id === hubId(1));
    assert.equal(invoice.invoice_date, "2026-09-01");
    assert.equal(invoice.base_amount, 100);
    assert.equal(invoice.total_amount, 121);
    assert.equal(invoice.payment_status, "approved");
    await db.query("insert into public.projects(id,user_id,client_id,name) values(gen_random_uuid(),$1,$2,'Cliente ambiguo')", [OWNER, CLIENT]);
    result = await snapshot();
    assert.deepEqual(new Set(result.invoices.map((i) => i.id)), new Set([hubId(1), hubId(7)]));
    await db.query("set role anon");
    try { assert.ok((await snapshot()).project); } finally { await db.query("reset role"); }
    assert.equal(await snapshot("invalid"), null);
    await db.query("update public.portal_tokens set revoked_at=now() where token=$1", [token]);
    assert.equal(await snapshot(), null);
  });
  await t.test("reejecutar no duplica ni sobrescribe las facturas trasladadas", async () => {
    await db.query("update public.received_invoices set notes='edited after migration' where id=$1", [REAL]);
    await apply();
    assert.equal((await db.query("select count(*)::int as n from public.received_invoices")).rows[0].n, 9);
    assert.equal((await db.query("select notes from public.received_invoices where id=$1", [REAL])).rows[0].notes, "edited after migration");
  });
  await t.test("guarda: rechaza un cambio ajeno del snapshot y revierte el lote", async () => {
    await db.query("begin");
    try {
      await db.query("create or replace function public.portal_read_snapshot(p_token text) returns jsonb language sql security definer set search_path='' as $$ select null::jsonb $$");
      await assert.rejects(db.query(migration), /modified outside this series/);
    } finally { await db.query("rollback"); }
  });
});
