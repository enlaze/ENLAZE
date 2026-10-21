// No hosted Auth or credentials. Real PG17 + PostgREST 14.4 with signed local
// sessions; actual line writer/loader/resolver and actual budget revision RPCs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { config, guard, setup, read } from './lib/budget-revision-rpcs-bench.mjs';
import { prepareWizardProvenance, provenanceScope } from './support/budget-wizard-provenance.mjs';
import { prepareReceivedInvoices, applyInvoicePriceMigration } from './support/received-invoice-prices.mjs';
import { invoiceLinesFromOcr, saveReceivedInvoiceLines, loadReceivedInvoicePrices,
  invoiceEvidenceForEngine, invoiceEvidenceFromEngine } from '../lib/received-invoice-prices.ts';
import { resolveForConcept } from '../lib/price-resolver-v2.ts';
import { resolvedPriceEvidence, evidenceForSave } from '../lib/budget-price-provenance.ts';
import { adjustToMarket, applyMaterialBasketToItems } from '../lib/budget-engine.ts';
import { detectarControlTransaccion } from './lib/sql-toplevel.mjs';
import { assertNoProductionEnvironment } from './lib/disposable-target-guard.mjs';
const owner='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
const version='20261021120000';
const block=(sql,name)=>{ const parts=sql.split(`-- BEGIN ${name}\n`);assert.equal(parts.length,2);return parts[1].split(`-- END ${name}`)[0]; };
const checks=read('docs/fase3/INVOICE-PRICES-CHECKS.sql');
const pre=block(checks,'CHECK_INVOICE_PRICES_PRECHECK'), audit=block(checks,'CHECK_INVOICE_PRICES_AUDIT');
const undo=block(read('docs/fase3/INVOICE-PRICES-ROLLBACK.sql'),'ROLLBACK_INVOICE_PRICES');
const jwt=(user)=>{ const part=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
  const s=`${part({alg:'HS256',typ:'JWT'})}.${part({role:'authenticated',sub:user,exp:Math.floor(Date.now()/1000)+3600})}`;
  return `${s}.${createHmac('sha256',process.env.E2_JWT_SECRET).update(s).digest('base64url')}`; };
const client=user=>createClient(process.env.E2_REST_URL,'synthetic-anon',{
  global:{headers:{Authorization:`Bearer ${jwt(user)}`},fetch:(url,init)=>fetch(String(url).replace('/rest/v1/','/'),init)},auth:{persistSession:false,autoRefreshToken:false}});
const input={concept_name:'Pintura plástica blanca mate interior 15 L',unit:'ud',quantity:2,category:'material'};
const context={company_id:owner,province:'Madrid',quality_tier:'media'};
const empty={current_prices:[],manual_prices:[],historical_prices:[],technical_prices:[],enlaze_prices:[]};
const today=new Date().toISOString().slice(0,10);
const dateDays=days=>new Date(Date.now()-days*86400000).toISOString().slice(0,10);
const ocrLine={description:input.concept_name,quantity:3,unit:'unidades',unit_price:20,subtotal:51};

test('real PG17/PostgREST14.4: private invoice prices, gates, tampering and rollback', {timeout:120000}, async t=>{
  assertNoProductionEnvironment(process.env);
  const db=new Client(config(process.env));await db.connect();t.after(()=>db.end());await guard(db);
  await setup(db);await prepareWizardProvenance(db);
  await db.query(read('supabase/migrations/20261021090000_user_supplied_prices.sql'));
  await prepareReceivedInvoices(db);
  await db.query('drop schema if exists supabase_migrations cascade; create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key)');
  await db.query('insert into auth.users values($1),($2)',[owner,other]);
  await db.query("update public.subscriptions set plan='profesional',status='active',current_period_end=now()+interval '1 month'");
  const a=client(owner),b=client(other);
  // Nonzero baselines prove that gates compare real pre-existing rows.
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  await db.query("insert into public.received_invoices(user_id,invoice_number,supplier_name,issue_date,total) values($1,'LEGACY','Existing supplier',current_date,9)",[owner]);
  await db.query("insert into public.price_items(user_id,name,unit,unit_price,is_active,is_manual_override) values($1,'Existing nonmatching price','ud',9,true,true)",[owner]);
  await db.query('select public.create_budget_with_items($1::jsonb,$2::jsonb)',[
    JSON.stringify({title:'Existing budget',budget_number:'INVOICE-GATE-LEGACY'}),
    JSON.stringify([{concept:'Existing line',unit:'ud',quantity:1,unit_price:9,subtotal:9}])]);
  const counts=(await db.query(pre)).rows[0];assert.equal(counts.veredicto,'OK');
  for(const name of ['received_invoices','price_items','budget_items']) assert.equal(Number(counts[name+'_precheck']),1);
  let readyAudit=audit;
  for(const col of ['received_invoices','budget_items','price_items']) readyAudit=readyAudit.replace(`-1::bigint as ${col}_precheck`,`${counts[col+'_precheck']}::bigint as ${col}_precheck`);
  const verdict=async(sql)=> (await db.query(sql)).rows[0];
  async function drift(name,sql,gate=readyAudit){await t.test(name,async()=>{
    await db.query('begin');try{await db.query(sql);const result=await verdict(gate);assert.match(result.veredicto,/^ABORTAR/,JSON.stringify(result));console.log(result.veredicto);}finally{await db.query('rollback');}
  });}
  await t.test('read-only gates and partial application fail closed',async()=>{
    for(const s of [pre,audit,undo])assert.deepEqual(detectarControlTransaccion(s),[]);
    await db.query('begin read only');try{assert.equal((await verdict(pre)).veredicto,'OK');assert.match((await verdict(readyAudit)).veredicto,/ABORTAR/);}finally{await db.query('rollback');}
  });
  await drift('PRECHECK refuses a partial wrong-type table','create table public.received_invoice_lines(id text)',pre);
  await t.test('partial empty rollback is safe',async()=>{
    await db.query('begin');try{
      await db.query('create table public.received_invoice_lines(id text)');
      await db.query(undo);
      assert.equal((await db.query("select to_regclass('public.received_invoice_lines') n")).rows[0].n,null);
    }finally{await db.query('rollback');}
  });
  await applyInvoicePriceMigration(db);await db.query(`insert into supabase_migrations.schema_migrations values('${version}')`);
  await t.test('AUDIT placeholders abort; exact counts and real metadata pass',async()=>{
    assert.match((await verdict(audit)).veredicto,/ABORTAR/);
    const row=await verdict(readyAudit);assert.equal(row.veredicto,'OK',JSON.stringify(row));
  });
  for(const [name,sql] of [
    ['missing SELECT','revoke select on public.received_invoice_lines from authenticated'],
    ['write privilege','grant insert on public.received_invoice_lines to authenticated'],
    ['column write privilege','grant update(amount) on public.received_invoice_lines to authenticated'],
    ['anonymous leak','grant select on public.received_invoice_lines to anon'],
    ['RLS disabled','alter table public.received_invoice_lines disable row level security'],
    ['permissive policy','create policy leaking on public.received_invoice_lines for select to authenticated using(true)'],
    ['trigger disabled','alter table public.budget_items disable trigger record_invoice_price_reuse'],
    ['function search_path',"alter function budget_internal.record_invoice_price_reuse() set search_path=public"],
    ['function security','alter function public.save_received_invoice_lines(uuid,jsonb) security invoker'],
    ['public execute','grant execute on function public.save_received_invoice_lines(uuid,jsonb) to public'],
    ['registry absent',`delete from supabase_migrations.schema_migrations where version='${version}'`],
  ]) await drift('AUDIT rejects '+name,sql);
  await t.test('empty rollback leaves existing invoices/bank/budget writer untouched',async()=>{
    const before=(await db.query("select prosrc from pg_proc where oid='budget_internal.replace_items(uuid,jsonb)'::regprocedure")).rows;
    await db.query('begin');try{
      await db.query(undo);assert.equal((await db.query("select to_regclass('public.received_invoice_lines') as name")).rows[0].name,null);
      assert.deepEqual((await db.query("select prosrc from pg_proc where oid='budget_internal.replace_items(uuid,jsonb)'::regprocedure")).rows,before);
      assert.equal((await db.query('select count(*)::int n from supabase_migrations.schema_migrations')).rows[0].n,1);
    }finally{await db.query('rollback');}
  });
  await db.query("notify pgrst,'reload schema'");
  for(let i=0;i<100;i++){const result=await a.rpc('get_invoice_price_stats');if(!result.error)break;await new Promise(r=>setTimeout(r,50));}
  const header=async(user,number,date=today)=>{
    const result=await client(user).from('received_invoices').insert({user_id:user,invoice_number:number,
      supplier_name:'Almacén privado',issue_date:date,subtotal:51,total:61.71}).select('id').single();
    assert.equal(result.error,null,JSON.stringify(result.error));return result.data.id;
  };
  const invoice=await header(owner,'PRIVATE-A'), foreign=await header(other,'PRIVATE-B');
  await t.test('confirm OCR lines: amounts, unknown unit, credit and stable retry identities',async()=>{
    const lines=invoiceLinesFromOcr([ocrLine,{description:'Sin unidad',quantity:1,subtotal:99},
      {description:'Abono',quantity:-1,unit:'ud',unit_price:20,subtotal:-20}]);
    await saveReceivedInvoiceLines(a,invoice,lines);
    const rows=await a.from('received_invoice_lines').select('*').eq('invoice_id',invoice).order('line_number');
    assert.equal(rows.error,null);assert.equal(rows.data.length,3);
    assert.equal(Number(rows.data[0].unit_price),20);assert.equal(Number(rows.data[0].effective_unit_price),17,'net after discount');
    assert.equal(rows.data[1].unit,null);assert.equal(rows.data[1].effective_unit_price,null);assert.equal(rows.data[2].effective_unit_price,null);
    await saveReceivedInvoiceLines(a,invoice,lines);
    assert.deepEqual((await a.from('received_invoice_lines').select('id').eq('invoice_id',invoice).order('line_number')).data,rows.data.map(({id})=>({id})));
  });
  await saveReceivedInvoiceLines(b,foreign,invoiceLinesFromOcr([{...ocrLine,subtotal:3}]));
  const prices=await loadReceivedInvoicePrices(a,owner);
  const resolve=(rows=prices, extra={})=>resolveForConcept(input,context,{...empty,invoice_prices:rows,...extra});
  const chosen=resolve();
  await t.test('new level supplies actual net cost after manual, before catalogs/custom order',()=>{
    assert.equal(chosen.source_type,'received_invoice');assert.equal(chosen.unit_price,17);assert.equal(chosen.confidence_score,.88);
    const manual={id:'manual',name:input.concept_name,unit:'ud',unit_price:44,supplier_name:'Propio',source_type:'manual',is_manual_override:true};
    assert.equal(resolve(prices,{manual_prices:[manual]}).source_type,'manual_locked');
    assert.equal(resolveForConcept(input,{...context,priority_order:['technical_bank']},{...empty,invoice_prices:prices}).source_type,'received_invoice');
    assert.notEqual(resolveForConcept({...input,unit:'kg'},context,{...empty,invoice_prices:prices}).source_type,'received_invoice');
    assert.notEqual(resolveForConcept({...input,concept_name:'Pintura plástica blanca mate interior 5 L'},context,{...empty,invoice_prices:prices}).source_type,'received_invoice');
  });
  await t.test('A cannot read, write, load or use B, including forged owner argument',async()=>{
    assert.equal((await a.from('received_invoice_lines').select('*').eq('invoice_id',foreign)).data.length,0);
    assert.deepEqual(await loadReceivedInvoicePrices(a,other),[]);
    assert.equal((await b.from('received_invoice_lines').select('*').eq('invoice_id',invoice)).data.length,0);
    await assert.rejects(saveReceivedInvoiceLines(a,foreign,invoiceLinesFromOcr([ocrLine])),error=>error.code==='42501' && /Invoice owner required/.test(error.message));
    assert.equal((await a.from('received_invoice_lines').insert({invoice_id:foreign,user_id:owner,line_number:100,description:'forged'})).status,403);
    assert.equal(chosen.unit_price,17);assert.equal(resolve(await loadReceivedInvoicePrices(b,other)).unit_price,1);
    assert.equal((await a.rpc('get_invoice_price_stats')).data.prices,1);
    assert.equal((await b.rpc('get_invoice_price_stats')).data.prices,1);
  });
  await t.test('age confidence follows historical curve; future dates are not evidence',()=>{
    for(const [days,confidence] of [[2,.88],[30,.78],[59,.78],[60,.65],[200,.65]]){
      const result=resolve([{...prices[0],invoice_date:dateDays(days)}]);assert.equal(result.confidence_score,confidence);}
    assert.notEqual(resolve([{...prices[0],invoice_date:dateDays(-3)}]).source_type,'received_invoice');
  });
  const items=(source=chosen)=>[{concept:input.concept_name,unit:'ud',quantity:2,unit_price:22.1,subtotal:44.2,
    unit_price_cost:source.unit_price,subtotal_cost:source.unit_price*2,
    ...evidenceForSave(resolvedPriceEvidence(source.unit_price,source.source_type,source.confidence_score,source.checked_at,source.source_id),source.unit_price)}];
  const create=async(lines)=>{const result=await a.rpc('create_budget_with_items',{p_budget_data:{title:'Factura reutilizada',budget_number:'INV-'+crypto.randomUUID()},p_items:lines});assert.equal(result.error,null,JSON.stringify(result.error));return result.data.budget_id;};
  await t.test('actual budget saves count once; lookups, copies and mismatched evidence do not',async()=>{
    assert.equal((await a.rpc('get_invoice_price_stats')).data.reused,0);
    const budget=await create([...items(),...items()]);
    assert.equal((await a.rpc('get_invoice_price_stats')).data.reused,1);
    const saved=(await a.from('budgets').select('lock_version').eq('id',budget).single()).data;
    const again=await a.rpc('save_budget',{p_budget_id:budget,p_expected_lock_version:saved.lock_version,p_budget_data:{title:'Again'},p_items:items()});assert.equal(again.error,null,JSON.stringify(again.error));
    assert.equal((await a.rpc('get_invoice_price_stats')).data.reused,1);
    for(const overrides of [{unit:'kg'},{unit_price_cost:99},{price_item_id:(await b.from('received_invoice_lines').select('id').eq('invoice_id',foreign).single()).data.id},
      {price_source_type:'user_edited'},{price_checked_at:'2000-01-01'}]) await create(items().map(x=>({...x,...overrides})));
    assert.equal((await a.rpc('get_invoice_price_stats')).data.reused,1);
    assert.equal((await b.rpc('get_invoice_price_stats')).data.reused,0);
    assert.equal((await b.from('invoice_price_usage_events').select('*')).data.length,0);
    assert.equal((await a.from('invoice_price_usage_events').insert({user_id:owner,invoice_line_id:chosen.source_id,budget_id:budget})).status,403);
  });
  await t.test('audit and rollback refuse data after release',async()=>{
    assert.match((await verdict(readyAudit)).veredicto,/ABORTAR/);
    await db.query('begin');try{await assert.rejects(db.query(undo),/DESTRUCTIVO/);}finally{await db.query('rollback');}
  });
  await t.test('deleted/rejected invoices stop supplying prices without erasing usage history',async()=>{
    await db.query("update public.received_invoices set status='rejected' where id=$1",[invoice]);assert.deepEqual(await loadReceivedInvoicePrices(a,owner),[]);
    await db.query("update public.received_invoices set status='pending',deleted_at=now() where id=$1",[invoice]);
    assert.equal((await a.from('received_invoice_lines').select('*')).data.length,0);assert.deepEqual(await loadReceivedInvoicePrices(a,owner),[]);
    assert.equal((await a.rpc('get_invoice_price_stats')).data.reused,1);
    await db.query('update public.received_invoices set deleted_at=null where id=$1',[invoice]);
  });
  await t.test('keyset loading crosses 1000 rows without losing the final private price',async()=>{
    const large=await header(owner,'LARGE');
    await saveReceivedInvoiceLines(a,large,Array.from({length:1051},(_,i)=>({description:`Concepto control ${i}`,quantity:1,unit:'ud',unit_price:10,amount:10})));
    assert.equal((await loadReceivedInvoicePrices(a,owner)).length,1052);
  });
  await t.test('net division is rounded in PostgreSQL, including half cents',async()=>{
    const fractional=await header(owner,'HALF-CENT');
    await saveReceivedInvoiceLines(a,fractional,invoiceLinesFromOcr([{description:'Coste fraccionario exacto',quantity:2,unit:'ud',unit_price:1.005,subtotal:2.01}]));
    const offer=(await loadReceivedInvoicePrices(a,owner)).find(row=>row.name==='Coste fraccionario exacto');
    assert.equal(offer.unit_price,1.01);
    const rounded=resolveForConcept({...input,concept_name:offer.name},context,{...empty,invoice_prices:[offer]});
    const before=(await a.rpc('get_invoice_price_stats')).data.reused;
    await create(items(rounded).map(row=>({...row,concept:offer.name})));
    assert.equal((await a.rpc('get_invoice_price_stats')).data.reused,before+1);
  });
  await t.test('usage unit validation agrees with b1 aliases on both sides',async()=>{
    let before=(await a.rpc('get_invoice_price_stats')).data.reused;
    for(const unit of ['ud','u','un','unidad','unidades']) {
      // Invoices retain explicit raw units; budget_items keeps its existing
      // canonical-unit CHECK. Do not loosen that constraint for this feature.
      await db.query('update public.received_invoice_lines set unit=$1 where id=$2',[unit,chosen.source_id]);
      const result=resolveForConcept(input,context,{...empty,invoice_prices:[{...prices[0],unit}]});
      assert.equal(result.source_type,'received_invoice');
      await create(items(result));
      assert.equal((await a.rpc('get_invoice_price_stats')).data.reused,++before);
    }
    await db.query("update public.received_invoice_lines set unit='ud' where id=$1",[chosen.source_id]);
    const linear=await header(owner,'LINEAR-UNIT');
    await saveReceivedInvoiceLines(a,linear,invoiceLinesFromOcr([{description:'Tubo cobre 15 mm',quantity:10,unit:'m',unit_price:5,subtotal:50}]));
    const rows=await loadReceivedInvoicePrices(a,owner);
    for(const unit of ['m','ml','metros lineales']) {
      const result=resolveForConcept({...input,concept_name:'Tubo cobre 15 mm',unit},context,{...empty,invoice_prices:rows});
      assert.equal(result.source_type,'received_invoice');
      await create(items(result).map(row=>({...row,concept:'Tubo cobre 15 mm',unit:'ml'})));
      assert.equal((await a.rpc('get_invoice_price_stats')).data.reused,++before);
    }
  });
  await t.test('transaction rollback does not leave phantom uses',async()=>{
    const before=(await a.rpc('get_invoice_price_stats')).data.reused;
    await db.query('begin');try{
      await db.query('select public.create_budget_with_items($1::jsonb,$2::jsonb)',[
        JSON.stringify({title:'Rolled back',budget_number:'INVOICE-ROLLBACK-TEST'}),JSON.stringify(items())]);
      assert.equal(Number((await db.query('select count(*) n from public.invoice_price_usage_events where user_id=$1',[owner])).rows[0].n),before+1);
    }finally{await db.query('rollback');}
    assert.equal((await a.rpc('get_invoice_price_stats')).data.reused,before);
  });
  await t.test('account lock and expired subscription reject line writes' ,async()=>{
    await db.query('insert into public.account_deletion_locks values($1)',[owner]);
    await assert.rejects(saveReceivedInvoiceLines(a,invoice,invoiceLinesFromOcr([ocrLine])),error=>error.code==='42501' && /Account deletion/.test(error.message));
    await db.query('delete from public.account_deletion_locks where user_id=$1',[owner]);
    await db.query("update public.subscriptions set status='canceled',current_period_end=now()-interval '1 day' where user_id=$1",[owner]);
    await assert.rejects(saveReceivedInvoiceLines(a,invoice,invoiceLinesFromOcr([ocrLine])),error=>error.code==='PT402');
  });
  // The untouched engine sees existing historical evidence via the boundary adapter.
  await t.test('engine adapter preserves invoiced amount and restores exact provenance',()=>{
    const line={...items()[0],price_source:'received_invoice',price_source_type:'received_invoice',id:'test',chapter:'pintura',status:'incluida',
      subtotal_cost:34,unit_price:17,unit_price_client:22.1,subtotal_client:44.2,category:'material',description:''};
    const adapted=invoiceEvidenceForEngine(line);
    const basket=applyMaterialBasketToItems([adapted],[],1.3);
    const adjusted=adjustToMarket(provenanceScope,basket,[],'reforma',1.3,true);
    assert.equal(adjusted.items[0].unit_price,17,'market calibration cannot alter invoice evidence');
    assert.equal(invoiceEvidenceFromEngine(basket[0]).price_source,'received_invoice');
    assert.equal(invoiceEvidenceFromEngine(basket[0]).unit_price,17);
    assert.equal(adapted.price_source_type,'received_invoice');
  });
});
