// Actual pending operator SQL, migration and rollback, on the guarded owned PG17
// bench. No credentials, hosted target, .env, deployment or production access.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { config, guard, setup, read } from './lib/budget-revision-rpcs-bench.mjs';
import { assertNoProductionEnvironment } from './lib/disposable-target-guard.mjs';
import { prepareWizardProvenance } from './support/budget-wizard-provenance.mjs';
import { extractFunction } from '../scripts/g3-l1b-generate.mjs';
import { detectarControlTransaccion } from './lib/sql-toplevel.mjs';

const checks = read('docs/fase3/G3-OWN-PRICES-CHECKS.sql');
const rollback = read('docs/fase3/G3-OWN-PRICES-ROLLBACK.sql');
const migration = read('supabase/migrations/20261021090000_user_supplied_prices.sql');
const block = (text, name) => {
  const parts = text.split(`-- BEGIN ${name}\n`);
  assert.equal(parts.length,2, `one ${name}`);
  const end = parts[1].split(`-- END ${name}`);
  assert.equal(end.length,2, `closed ${name}`);
  return end[0];
};
const precheck = block(checks,'CHECK_G3_OWN_PRECHECK');
const audit = block(checks,'CHECK_G3_OWN_AUDIT');
const undo = block(rollback,'ROLLBACK_G3_OWN');
const owner = '11111111-1111-4111-8111-111111111111';
const registered = "insert into supabase_migrations.schema_migrations values('20261021090000')";

test('G3 own operator artifacts have one source, explicit destructive order and no hidden transaction control', () => {
  for (const sql of [precheck,audit,undo]) assert.deepEqual(detectarControlTransaccion(sql), []);
  assert.match(audit, /-1::bigint as price_items_precheck/);
  assert.match(audit, /-1::bigint as budget_items_precheck/);
  assert.match(undo,/DESTRUCTIVO/);
  const statements = [
    'drop trigger record_own_price_reuse on public.budget_items;',
    'drop trigger record_collected_price on public.price_items;',
    'drop function budget_internal.record_own_price_reuse();',
    'drop function budget_internal.record_collected_price();',
    'drop function public.get_user_price_collection_stats(timestamptz);',
    'drop table public.user_price_collection_events;',
    'alter table public.budget_items drop column price_item_id;',
    'alter table public.price_items drop column collection_budget_id;',
  ];
  const positions = statements.map(statement => undo.indexOf(statement));
  assert.ok(positions.every((position,i) => position>=0 && (!i || position>positions[i-1])));
  assert.doesNotMatch(undo,/\bdrop\b[^;]*\bcascade\s*;/i);
  assert.doesNotMatch(undo,/\b(?:delete\s+from|update|insert\s+into)\s+(?:supabase_migrations\.)?schema_migrations\b/i);
  assert.equal(extractFunction(undo,'create or replace function budget_internal.replace_items(','$fn$;'),
    extractFunction(read('supabase/migrations/20261008130000_budget_items_price_provenance_writers.sql'),
      'create or replace function budget_internal.replace_items(','$fn$;'));
});

test('G3 own gates / real PostgreSQL 17: fail closed under deliberate drift and undo without losing price rows', {timeout:120000}, async t => {
  assertNoProductionEnvironment(process.env);
  const db = new Client(config(process.env));
  await db.connect();
  t.after(() => db.end());
  await guard(db);
  await setup(db);
  await prepareWizardProvenance(db);
  await db.query('create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key)');
  await db.query('insert into auth.users values($1)',[owner]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  const items = Array.from({length:59},(_,i)=>({ concept:`Legacy own gate ${i}`, quantity:2,
    unit:'m2', category:'mano_obra', unit_price:12.5+i, subtotal:(12.5+i)*2,
    unit_price_cost:10+i, subtotal_cost:(10+i)*2,
    price_source_type:'ai_estimate', price_confidence:0.2, price_checked_at:'2026-10-20T12:00:00Z' }));
  const target = (await db.query('select public.create_budget_with_items($1::jsonb,$2::jsonb) as value',
    [JSON.stringify({title:'59 legacy lines',budget_number:'G3-GATES-59'}),JSON.stringify(items)])).rows[0].value.budget_id;
  for (let i=0;i<6;i++) await db.query(`insert into public.price_items
    (user_id,name,unit,unit_price,is_manual_override,is_active,sector) values($1,$2,'m2',$3,true,true,'construccion')`,[owner,`Legacy bank ${i}`,10+i]);
  const snapshot = async () => (await db.query(`select
    (select jsonb_agg(to_jsonb(p)-'collection_budget_id' order by id) from public.price_items p) as prices,
    (select jsonb_agg(to_jsonb(i)-'price_item_id' order by sort_order) from public.budget_items i) as items,
    (select prosrc from pg_catalog.pg_proc where oid='budget_internal.replace_items(uuid,jsonb)'::regprocedure) as writer,
    (select obj_description('budget_internal.replace_items(uuid,jsonb)'::regprocedure,'pg_proc')) as writer_comment,
    (select proacl::text from pg_catalog.pg_proc where oid='budget_internal.replace_items(uuid,jsonb)'::regprocedure) as writer_acl,
    (select col_description('public.budget_items'::regclass,attnum) from pg_attribute where attrelid='public.budget_items'::regclass and attname='price_source_type') as source_comment`)).rows[0];
  // Restore the production comment prior to phase 4 so rollback compares the
  // real preceding state, not the older minimal bootstrap comment.
  await db.query(read('supabase/migrations/20261015090000_budget_items_ai_estimate_comment.sql'));
  const before = await snapshot();
  const migrationHash = createHash('sha256').update(migration).digest('hex');
  const pre = (await db.query(precheck)).rows[0];
  assert.equal(pre.veredicto,'OK',JSON.stringify(pre));
  assert.equal(Number(pre.price_items_precheck),6);
  assert.equal(Number(pre.budget_items_precheck),59);
  const audited = audit.replace('-1::bigint as price_items_precheck',`${pre.price_items_precheck}::bigint as price_items_precheck`)
    .replace('-1::bigint as budget_items_precheck',`${pre.budget_items_precheck}::bigint as budget_items_precheck`);
  const auditRow = async sql => (await db.query(sql ?? audited)).rows[0];
  const expectAbort = async (sql, reason) => {
    const row = (await db.query(sql)).rows[0];
    assert.match(row.veredicto,/^ABORTAR/,JSON.stringify(row));
    if (reason) assert.match(row.veredicto,reason);
    console.log(row.veredicto);
    return row;
  };
  await t.test('PRECHECK is read only and captures both nonzero counts',async()=>{
    await db.query('begin read only');
    try { assert.equal((await db.query(precheck)).rows[0].veredicto,'OK'); }
    finally { await db.query('rollback'); }
  });
  for (const [name,sql] of [
    ['registered already',registered],
    ['wrong price_items column type','alter table public.price_items add column collection_budget_id text'],
    ['wrong budget_items column type','alter table public.budget_items add column price_item_id text'],
    ['partial UUID column','alter table public.budget_items add column price_item_id uuid'],
    ['partial events table','create table public.user_price_collection_events(id integer)'],
  ]) await t.test(`PRECHECK ABORTAR: ${name}`,async()=>{
    await db.query('begin');
    try { await db.query(sql); await expectAbort(precheck); }
    finally { await db.query('rollback'); }
  });
  await t.test('AUDIT returns ABORTAR before the migration, including when only the registry row exists',async()=>{
    await expectAbort(audited,/exactamente una vez/);
    await db.query('begin');
    try { await db.query(registered); const row=await expectAbort(audited); assert.equal(row.tabla_eventos,false); assert.equal(Number(row.eventos),-1); }
    finally { await db.query('rollback'); }
  });
  await db.query('begin');
  try { await db.query(migration); await db.query(registered); await db.query('commit'); }
  catch (error) { await db.query('rollback'); throw error; }
  await t.test('AUDIT OK with the operator counts; no data change or migration-created event',async()=>{
    await db.query('begin read only');
    try {
      const row=await auditRow();
      assert.equal(row.veredicto,'OK',JSON.stringify(row));
      assert.equal(Number(row.eventos),0);
      assert.equal(Number(row.funciones_correctas),2);
      assert.equal(Number(row.disparadores_correctos),2);
    } finally { await db.query('rollback'); }
    const after=await snapshot();
    assert.deepEqual(after.prices,before.prices);
    assert.deepEqual(after.items,before.items);
    assert.equal(after.writer_acl,before.writer_acl);
    await expectAbort(precheck,/ya esta registrada/);
  });
  for (const [name,sql] of [
    ['both placeholders left at -1',audit],
    ['price_items placeholder missing',audited.replace(`${pre.price_items_precheck}::bigint as price_items_precheck`,'-1::bigint as price_items_precheck')],
    ['budget_items placeholder missing',audited.replace(`${pre.budget_items_precheck}::bigint as budget_items_precheck`,'-1::bigint as budget_items_precheck')],
    ['incorrect price_items count',audited.replace(`${pre.price_items_precheck}::bigint as price_items_precheck`,'7::bigint as price_items_precheck')],
    ['incorrect budget_items count',audited.replace(`${pre.budget_items_precheck}::bigint as budget_items_precheck`,'60::bigint as budget_items_precheck')],
  ]) await t.test(`AUDIT ABORTAR: ${name}`,async()=>{ await expectAbort(sql); });
  const event = `insert into public.user_price_collection_events(user_id,price_item_id,budget_id,event_kind)
    select '${owner}',id,'${target}','saved' from public.price_items order by id limit 1`;
  for (const [name,sql,reason] of [
    ['missing registry row',"delete from supabase_migrations.schema_migrations where version='20261021090000'",/exactamente una vez/],
    ['duplicate registry row',`alter table supabase_migrations.schema_migrations drop constraint schema_migrations_pkey; ${registered}`,/exactamente una vez/],
    ['price_items row added',`insert into public.price_items(user_id,name) values('${owner}','unexpected')`,/filas de price_items/],
    ['price_items row removed','delete from public.price_items where id=(select id from public.price_items limit 1)',/filas de price_items/],
    ['budget_items row removed','delete from public.budget_items where id=(select id from public.budget_items limit 1)',/filas de budget_items/],
    ['events table missing','drop table public.user_price_collection_events cascade',/falta user_price_collection_events/],
    ['RLS disabled','alter table public.user_price_collection_events disable row level security',/RLS desactivado/],
    ['SELECT grant removed','revoke select on public.user_price_collection_events from authenticated',/privilegios/],
    ['INSERT grant added','grant insert on public.user_price_collection_events to authenticated',/privilegios/],
    ['UPDATE grant added','grant update on public.user_price_collection_events to authenticated',/privilegios/],
    ['DELETE grant added','grant delete on public.user_price_collection_events to authenticated',/privilegios/],
    ['column INSERT grant added','grant insert(event_kind) on public.user_price_collection_events to authenticated',/privilegios/],
    ['column UPDATE grant added','grant update(event_kind) on public.user_price_collection_events to authenticated',/privilegios/],
    ['anon SELECT leaked','grant select on public.user_price_collection_events to anon',/privilegios/],
    ['price trigger disabled','alter table public.price_items disable trigger record_collected_price',/disparadores/],
    ['budget trigger disabled','alter table public.budget_items disable trigger record_own_price_reuse',/disparadores/],
    ['budget trigger absent','drop trigger record_own_price_reuse on public.budget_items',/disparadores/],
    ['trigger bound to wrong function',`drop trigger record_own_price_reuse on public.budget_items;
      create trigger record_own_price_reuse after insert or update on public.budget_items
      for each row execute function budget_internal.record_collected_price()`,/disparadores/],
    ['collected function missing','drop function budget_internal.record_collected_price() cascade',/funciones/],
    ['reuse function missing','drop function budget_internal.record_own_price_reuse() cascade',/funciones/],
    ['collected security definer lost','alter function budget_internal.record_collected_price() security invoker',/funciones/],
    ['reuse security definer lost','alter function budget_internal.record_own_price_reuse() security invoker',/funciones/],
    ['collected search_path changed',"alter function budget_internal.record_collected_price() set search_path='public'",/funciones/],
    ['reuse search_path changed',"alter function budget_internal.record_own_price_reuse() set search_path='public'",/funciones/],
    ['private function exposed','grant execute on function budget_internal.record_own_price_reuse() to authenticated',/funciones/],
    ['new column type changed','alter table public.budget_items alter column price_item_id type text using price_item_id::text',/columnas/],
    ['new column default added','alter table public.budget_items alter column price_item_id set default gen_random_uuid()',/columnas/],
    ['unexpected event recorded',event,/hay eventos/],
  ]) await t.test(`AUDIT ABORTAR: ${name}`,async()=>{
    assert.equal((await auditRow()).veredicto,'OK');
    await db.query('begin');
    try { await db.query(sql); await expectAbort(audited,reason); }
    finally { await db.query('rollback'); }
    assert.equal((await auditRow()).veredicto,'OK','restoring only the deliberate drift returns OK');
  });
  await t.test('AUDIT refuses a role whose RLS filter would hide other users events',async()=>{
    await db.query('begin');
    try {
      const other='22222222-2222-4222-8222-222222222222';
      await db.query('insert into auth.users values($1)',[other]);
      await db.query(`insert into public.user_price_collection_events(user_id,price_item_id,budget_id,event_kind)
        select $1,id,$2,'saved' from public.price_items order by id limit 1`,[other,target]);
      await db.query('grant usage on schema supabase_migrations,budget_internal to authenticated');
      await db.query('grant select on supabase_migrations.schema_migrations to authenticated');
      await db.query('set local role authenticated');
      const row=await expectAbort(audited,/sin filtro RLS/);
      assert.equal(Number(row.eventos),0,'owner-only RLS hides the deliberate other-user event');
      assert.equal(row.lectura_eventos_completa,false,'the zero must never count as an audit pass');
    } finally { await db.query('rollback'); }
  });
  await t.test('ROLLBACK refuses existing events before dropping anything and restores the prior writer/rows when empty',async()=>{
    await db.query('begin');
    try {
      await db.query(event);
      await db.query('savepoint before_undo');
      await assert.rejects(db.query(undo),/Export and review own-price instrumentation before rollback/);
      await db.query('rollback to savepoint before_undo');
      assert.equal(Number((await db.query('select count(*) from public.user_price_collection_events')).rows[0].count),1);
      assert.equal(Number((await auditRow()).disparadores_correctos),2);
      assert.equal(Number((await auditRow()).funciones_correctas),2);
    } finally { await db.query('rollback'); }
    await db.query('begin');
    try {
      await db.query(undo);
      assert.equal((await db.query("select to_regclass('public.user_price_collection_events') as value")).rows[0].value,null);
      for (const fn of ['budget_internal.record_collected_price()','budget_internal.record_own_price_reuse()','public.get_user_price_collection_stats(timestamptz)'])
        assert.equal((await db.query('select to_regprocedure($1) as value',[fn])).rows[0].value,null);
      assert.equal(Number((await db.query(`select count(*) from pg_attribute where not attisdropped and
        ((attrelid='public.price_items'::regclass and attname='collection_budget_id') or
         (attrelid='public.budget_items'::regclass and attname='price_item_id'))`)).rows[0].count),0);
      assert.deepEqual(await snapshot(),before,'price rows, budget lines, old writer, ACL and source comment are restored');
      assert.equal(Number((await db.query("select count(*) from supabase_migrations.schema_migrations where version='20261021090000'")).rows[0].count),1,'rollback does not silently repair deployment history');
    } finally { await db.query('rollback'); }
    assert.equal((await auditRow()).veredicto,'OK','transaction rollback leaves the bench migrated for subsequent checks');
  });
  assert.equal(createHash('sha256').update(read('supabase/migrations/20261021090000_user_supplied_prices.sql')).digest('hex'),migrationHash,'merged migration unchanged');
});
