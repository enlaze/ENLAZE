import { test } from "node:test";
import assert from "node:assert/strict";
import { config, setup, read, MIGRATION } from "./lib/budget-revision-rpcs-bench.mjs";

const enabled=process.env.RUN_REVISION_RPCS_INTEGRATION_TESTS==="1";
test("E2 / PostgreSQL 17: real authorization, atomicity and revisions", {skip:!enabled,timeout:120000}, async t=>{
  const cfg=config(process.env); const {Client}=await import("pg");
  const db=new Client(cfg); await db.connect(); t.after(()=>db.end());
  await setup(db);
  const OWNER="11111111-1111-4111-8111-111111111111", OTHER="22222222-2222-4222-8222-222222222222";
  const CLIENT="33333333-3333-4333-8333-333333333333", FOREIGN="44444444-4444-4444-8444-444444444444";
  const PROJECT="55555555-5555-4555-8555-555555555555", OTHERPROJECT="66666666-6666-4666-8666-666666666666";
  await db.query("insert into auth.users values ($1),($2)",[OWNER,OTHER]);
  await db.query("insert into public.clients values ($1,$2),($3,$4)",[CLIENT,OWNER,FOREIGN,OTHER]);
  await db.query("insert into public.projects(id,user_id) values ($1,$2),($3,$4)",[PROJECT,OWNER,OTHERPROJECT,OTHER]);
  const items=[{concept:"A",quantity:"2",unit_price:"10",subtotal:"20.01",unit_price_cost:"3.14",subtotal_cost:"6.29"}];
  const header={title:"Synthetic E2",budget_number:"PRE-E2",subtotal:"80.01",iva_percent:"21",iva_amount:"16.80",total:"96.81",project_id:PROJECT,client_id:CLIENT};
  async function call(name,args,owner=OWNER,client=db,role="authenticated"){
    assert.ok(["create_budget_with_items","save_budget","finalize_budget","change_budget_status","duplicate_budget","portal_respond_to_budget"].includes(name));
    assert.ok(["authenticated","anon","service_role"].includes(role));
    await client.query("begin");
    try {
      await client.query("set local role "+role);
      await client.query("select set_config('request.jwt.claim.sub',$1,true)",[owner??""]);
      const r=(await client.query("select public."+name+"("+args.map((_,i)=>"$"+(i+1)).join(",")+") as r",args.map(a=>a!==null&&typeof a==="object"?JSON.stringify(a):a))).rows[0].r;
      await client.query("commit"); return r;
    } catch(e){await client.query("rollback");throw e;}
  }
  const create=(data=header,rows=items)=>call("create_budget_with_items",[data,rows]);
  async function state(id) {
    return (await db.query(`select to_jsonb(b) as budget,
      (select coalesce(jsonb_agg(to_jsonb(i) order by sort_order,id),'[]') from public.budget_items i where budget_id=b.id) as items,
      (select coalesce(jsonb_agg(to_jsonb(d) order by version),'[]') from public.document_versions d where entity_type='budget' and entity_id=b.id) as versions
      from public.budgets b where id=$1`,[id])).rows[0];
  }
  const edit={...header}; delete edit.budget_number;
  let initial;
  await t.test("create preserves defaults and transported money, rewrites draftId",async()=>{
    initial=await create({...header,wizard_state:{draftId:"foreign",partidas:[]}});
    assert.equal(initial.lock_version,1);assert.equal(initial.version,1);
    const s=await state(initial.budget_id);
    assert.equal(s.budget.total,96.81);assert.equal(s.budget.subtotal,80.01);
    assert.equal(s.items[0].subtotal,20.01);assert.equal(s.items[0].subtotal_cost,6.29);
    assert.equal(s.budget.wizard_state.draftId,initial.budget_id);
    assert.equal(s.budget.payment_schedule.length,0);
    const minimal=await create({title:"minimal",budget_number:"MIN"},[]);
    assert.equal(minimal.items_count,0);
  });
  await t.test("missing/foreign/deleted budget and missing auth fail identically",async()=>{
    const id=initial.budget_id;
    for(const [target,owner] of [[id,OTHER],["99999999-9999-4999-8999-999999999999",OWNER],[id,null]]){
      await assert.rejects(()=>call("save_budget",[target,1,edit,items],owner),{code:"42501",message:"Budget is not available"});
    }
    const b=await create();await db.query("update public.budgets set deleted_at=now() where id=$1",[b.budget_id]);
    await assert.rejects(()=>call("save_budget",[b.budget_id,1,edit,items]),{code:"42501",message:"Budget is not available"});
  });
  await t.test("stale revision leaves every header, item and document byte unchanged",async()=>{
    const before=await state(initial.budget_id);
    await assert.rejects(()=>call("save_budget",[initial.budget_id,2,edit,items]),{code:"PT409"});
    assert.deepEqual(await state(initial.budget_id),before);
  });
  await t.test("rejects invalid/omitted revision, server fields, rates, nulls and invalid item numbers",async()=>{
    for(const expected of [null,0,-1]) await assert.rejects(()=>call("save_budget",[initial.budget_id,expected,edit,items]),{code:"22023"});
    for(const bad of [{user_id:OTHER},{status:"aceptado"},{version:8},{lock_version:9},{budget_number:"change"},{total:null},{total:"NaN"},{iva_percent:130},{discount_percent:-1},{wizard_state:null},{payment_schedule:{}},{title:""}]){
      await assert.rejects(()=>call("save_budget",[initial.budget_id,1,{...edit,...bad},items]),{code:"22023"});
    }
    for(const bad of [{quantity:null},{unit_price:null},{subtotal:"NaN"},{subtotal_cost:"Infinity"},{unit_price_cost:"-Infinity"}]){
      await assert.rejects(()=>call("save_budget",[initial.budget_id,1,edit,[{...items[0],...bad}]]),{code:"22023"});
    }
  });
  await t.test("foreign client/project cannot be attached on create or save",async()=>{
    for(const bad of [{client_id:FOREIGN},{project_id:OTHERPROJECT}]){
      const before=await state(initial.budget_id);
      await assert.rejects(()=>create({...header,...bad}),{code:"42501"});
      await assert.rejects(()=>call("save_budget",[initial.budget_id,1,{...edit,...bad},items]),{code:"42501"});
      assert.deepEqual(await state(initial.budget_id),before);
    }
  });
  await t.test("duplicate rejects legacy cross-owner associations",async()=>{
    const b=await create();
    await db.query("update public.budgets set client_id=$2 where id=$1",[b.budget_id,FOREIGN]);
    await assert.rejects(()=>call("duplicate_budget",[b.budget_id]),{code:"42501"});
  });
  await t.test("failure after DELETE restores header, old IDs and all data",async()=>{
    const before=await state(initial.budget_id);
    await assert.rejects(()=>call("save_budget",[initial.budget_id,1,{...edit,title:"must roll back"},[{...items[0],canonical_id:"missing",canonical_status:"resolved",canonical_confidence:1,canonical_source:"generator"}]]),{code:"23503"});
    assert.deepEqual(await state(initial.budget_id),before);
  });
  await t.test("save clears nullable links, increments once and leaves draft document version alone",async()=>{
    const r=await call("save_budget",[initial.budget_id,1,{...edit,client_id:null,valid_until:null},items]);
    assert.equal(r.lock_version,2);assert.equal(r.version,1);
    assert.equal((await state(r.budget_id)).budget.client_id,null);
  });
  await t.test("first finalization is document 1, subsequent is 2; snapshot uses stored rows",async()=>{
    const r=await call("finalize_budget",[initial.budget_id,2,edit,items]);
    assert.equal(r.lock_version,3);assert.equal(r.version,1);
    let s=await state(r.budget_id);assert.equal(s.versions.length,1);
    assert.deepEqual(s.versions[0].snapshot.items,s.items);assert.equal(s.versions[0].snapshot.total,96.81);
    const second=await call("finalize_budget",[r.budget_id,3,edit,items]);
    assert.equal(second.version,2);assert.equal(second.lock_version,4);
    s=await state(r.budget_id);assert.deepEqual(s.versions.map(v=>v.version),[1,2]);
  });
  await t.test("document insertion failure rolls back the entire finalization",async()=>{
    const b=await create(),before=await state(b.budget_id);
    await db.query("alter table public.document_versions add constraint e2_test_failure check(false) not valid");
    try {await assert.rejects(()=>call("finalize_budget",[b.budget_id,1,edit,items]),{code:"23514"});}
    finally {await db.query("alter table public.document_versions drop constraint e2_test_failure");}
    assert.deepEqual(await state(b.budget_id),before);
  });
  await t.test("positive total cannot finalize empty; drafts may remain empty",async()=>{
    const b=await create(header,[]),before=await state(b.budget_id);
    await assert.rejects(()=>call("finalize_budget",[b.budget_id,1,edit,[]]),{code:"22023"});
    assert.deepEqual(await state(b.budget_id),before);
  });
  await t.test("lifecycle rejects null/invalid transitions and preserves document number",async()=>{
    const b=await create();
    await assert.rejects(()=>call("change_budget_status",[b.budget_id,1,"aceptado"]),{code:"22023"});
    await call("finalize_budget",[b.budget_id,1,edit,items]);
    await assert.rejects(()=>call("change_budget_status",[b.budget_id,2,null]),{code:"22023"});
    const sent=await call("change_budget_status",[b.budget_id,2,"enviado"]);
    assert.equal(sent.previous_status,"pendiente");assert.equal(sent.version,1);assert.equal(sent.lock_version,3);
    await assert.rejects(()=>call("save_budget",[b.budget_id,3,edit,items]),{code:"22023"});
    const accepted=await call("change_budget_status",[b.budget_id,3,"aceptado"]);assert.equal(accepted.lock_version,4);
  });
  await t.test("duplication copies costs, new IDs, draft number/state and source unchanged",async()=>{
    const before=await state(initial.budget_id),r=await call("duplicate_budget",[initial.budget_id]),s=await state(r.budget_id);
    assert.equal(r.lock_version,1);assert.equal(r.status,"borrador");assert.equal(s.versions.length,0);
    assert.notEqual(s.budget.budget_number,before.budget.budget_number);
    assert.notEqual(s.items[0].id,before.items[0].id);assert.equal(s.items[0].subtotal_cost,before.items[0].subtotal_cost);
    assert.equal(s.budget.wizard_state.draftId,r.budget_id);
    assert.deepEqual(await state(initial.budget_id),before);
  });
  await t.test("all frozen economic vectors are transported exactly as PostgreSQL numeric",async()=>{
    for(const c of JSON.parse(read("__tests__/fixtures/budget-economic-golden-vectors.json")).cases){
      const h={...c.header,title:c.case_id,budget_number:c.case_id};delete h.status;delete h.n_items;
      const rows=c.persisted_items.map((i,n)=>({concept:"row "+n,quantity:i[1],unit_price:i[2],subtotal:i[3],category:i[4],unit:i[5]}));
      const b=await create(h,rows);
      for(const key of ["subtotal","iva_percent","iva_amount","total","discount_percent","discount_amount"]){
        assert.equal((await db.query("select "+key+"=$2::numeric as ok from public.budgets where id=$1",[b.budget_id,h[key]])).rows[0].ok,true,key);
      }
      const stored=(await db.query("select subtotal::text from public.budget_items where budget_id=$1 order by sort_order",[b.budget_id])).rows;
      assert.deepEqual(stored.map(i=>i.subtotal),c.persisted_items.map(i=>i[3]));
    }
  });
  await t.test("two sessions with one revision: one commits, one gets PT409",async()=>{
    const b=await create(),a=new Client(cfg),c=new Client({...cfg,application_name:"e2-contender"});
    await a.connect();await c.connect();
    try{
      await a.query("begin");await a.query("set local role authenticated");
      await a.query("select set_config('request.jwt.claim.sub',$1,true)",[OWNER]);
      await a.query("select public.save_budget($1,1,$2::jsonb,$3::jsonb)",[b.budget_id,JSON.stringify({...edit,title:"winner"}),JSON.stringify(items)]);
      const contender=call("save_budget",[b.budget_id,1,{...edit,title:"loser"},items],OWNER,c).then(v=>({v}),e=>({e}));
      let waiting=false;
      for(let n=0;n<100;n++){
        waiting=(await db.query("select exists(select 1 from pg_stat_activity where application_name='e2-contender' and wait_event_type='Lock') as ok")).rows[0].ok;
        if(waiting)break;await new Promise(r=>setTimeout(r,20));
      }
      assert.equal(waiting,true,"contender demonstrably blocked before commit");
      await a.query("commit");const result=await contender;assert.equal(result.e?.code,"PT409");
      const after=await state(b.budget_id);assert.equal(after.budget.title,"winner");assert.equal(after.budget.lock_version,2);
    }finally{await a.query("rollback");await a.end();await c.end();}
  });
  await t.test("account deletion lock rejects all writes including anonymous portal",async()=>{
    await db.query("insert into public.account_deletion_locks(user_id) values($1)",[OWNER]);
    try {
      await assert.rejects(()=>create(),{code:"42501"});
      await assert.rejects(()=>call("save_budget",[initial.budget_id,4,edit,items]),{code:"42501"});
    }finally{await db.query("delete from public.account_deletion_locks where user_id=$1",[OWNER]);}
  });
  await t.test("portal scopes budget/owner/project, read-only and revoked tokens fail closed",async()=>{
    const b=await create(),other=await create();
    await call("finalize_budget",[b.budget_id,1,edit,items]);await call("change_budget_status",[b.budget_id,2,"enviado"]);
    const token=(await db.query("insert into public.portal_tokens(project_id) values($1) returning token",[PROJECT])).rows[0].token;
    const respond=(id=b.budget_id,decision="accepted",tok=token)=>call("portal_respond_to_budget",[tok,id,decision,"Synthetic signer"],null,db,"anon");
    await assert.rejects(()=>respond(),{code:"42501"});
    await db.query('update public.portal_tokens set permissions=\'["approve_budgets"]\' where token=$1',[token]);
    await db.query("update public.portal_tokens set revoked_at=now() where token=$1",[token]);await assert.rejects(()=>respond(),{code:"42501"});
    await db.query("update public.portal_tokens set revoked_at=null,expires_at=now()-interval '1 second' where token=$1",[token]);await assert.rejects(()=>respond(),{code:"42501"});
    await db.query("update public.portal_tokens set expires_at=null where token=$1",[token]);
    await db.query("update public.budgets set project_id=$2 where id=$1",[other.budget_id,OTHERPROJECT]);await assert.rejects(()=>respond(other.budget_id),{code:"42501"});
    await assert.rejects(()=>respond(b.budget_id,null),{code:"22023"});
    await assert.rejects(()=>respond(b.budget_id,"accepted","bad-token"),{code:"42501"});
    await db.query("insert into public.account_deletion_locks(user_id) values($1)",[OWNER]);
    await assert.rejects(()=>respond(),{code:"42501"});await db.query("delete from public.account_deletion_locks where user_id=$1",[OWNER]);
    const r=await respond();assert.equal(r.status,"aceptado");assert.equal(r.lock_version,4);
    await assert.rejects(()=>respond(),{code:"PT409"});
  });
  await t.test("private helpers inaccessible, public ACL explicit; table ACL unchanged",async()=>{
    const acl=(await db.query("select n.nspname,p.proname,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'execute') as anon,has_function_privilege('authenticated',p.oid,'execute') as auth,has_function_privilege('service_role',p.oid,'execute') as service from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='budget_internal' or (n.nspname='public' and p.proname in ('save_budget','portal_respond_to_budget'))")).rows;
    for(const r of acl){assert.equal(r.service,false);if(r.nspname==="budget_internal"){assert.equal(r.auth,false);assert.equal(r.anon,false);assert.equal(r.prosecdef,false);}else{assert.equal(r.prosecdef,true);assert.equal(r.auth,true);assert.equal(r.anon,r.proname==="portal_respond_to_budget");}}
    for(const role of ["anon","service_role"]) await assert.rejects(()=>call("create_budget_with_items",[header,items],OWNER,db,role),{code:"42501"});
  });
  await t.test("pre-client compensation refuses missing acknowledgement and preserves all data/E1",async()=>{
    const rollback=read("docs/fase2/ROLLBACK.sql").split("-- BEGIN ROLLBACK_2F2_E2")[1].split("-- END ROLLBACK_2F2_E2")[0];
    const before=await state(initial.budget_id);
    await assert.rejects(()=>db.query(rollback),{code:"P0001"});
    await db.query("rollback");
    assert.ok((await db.query("select to_regprocedure('public.save_budget(uuid,integer,jsonb,jsonb)') as p")).rows[0].p);
    await db.query("set enlaze.allow_revision_rpcs_rollback='before_revision_clients'");
    await db.query(rollback);
    assert.equal((await db.query("select to_regprocedure('public.save_budget(uuid,integer,jsonb,jsonb)') as p")).rows[0].p,null);
    assert.deepEqual(await state(initial.budget_id),before);
    assert.ok((await db.query("select to_regprocedure('public.replace_budget_items(uuid,jsonb)') as p")).rows[0].p);
    await db.query("reset enlaze.allow_revision_rpcs_rollback");
  });
});

test("E2 / PostgreSQL: behavioral negative controls",{skip:!enabled,timeout:120000},async t=>{
  const {Client}=await import("pg"),db=new Client(config(process.env));await db.connect();t.after(()=>db.end());
  const sql=read("supabase/migrations/"+MIGRATION);
  const owner="11111111-1111-4111-8111-111111111111";
  const rows=[{concept:"mutant",quantity:1,unit_price:12,subtotal:12,unit_price_cost:3,subtotal_cost:3}];
  const invoke=async(name,args)=>{
    await db.query("begin");try{
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
      const r=(await db.query("select public."+name+"("+args.map((_,i)=>"$"+(i+1)).join(",")+") as r",args.map(x=>typeof x==="object"?JSON.stringify(x):x))).rows[0].r;
      await db.query("commit");return r;
    }catch(e){await db.query("rollback");throw e;}
  };
  const cases=[
    ["stale revision accepted","if b.lock_version is distinct from p_expected then","if false then",async b=>{
      let code;try{await invoke("save_budget",[b.budget_id,99,{title:"mutant"},rows]);}catch(e){code=e.code;}
      assert.equal(code,"PT409");
    }],
    ["revision not incremented","lock_version = lock_version + 1","lock_version = lock_version",async b=>{
      assert.equal((await invoke("save_budget",[b.budget_id,1,{title:"mutant"},rows])).lock_version,2);
    }],
    ["private helper exposed","revoke all on all functions in schema budget_internal from public, anon, authenticated, service_role;","grant execute on all functions in schema budget_internal to authenticated;",async()=>{
      assert.equal((await db.query("select has_function_privilege('authenticated','budget_internal.replace_items(uuid,jsonb)','execute') as allowed")).rows[0].allowed,false);
    }]
  ];
  for(const [name,needle,replacement,verify] of cases){
    await t.test(name,async()=>{
      assert.ok(sql.includes(needle));
      // Baseline must pass the same behavioral oracle before mutation.
      for(const mutated of [false,true]){
        await setup(db,mutated?sql.replace(needle,replacement):sql);
        await db.query("insert into auth.users values($1)",[owner]);
        const b=await invoke("create_budget_with_items",[{title:"mutant",budget_number:"M"},rows]);
        if(mutated)await assert.rejects(()=>verify(b),{name:"AssertionError"});
        else await verify(b);
      }
    });
  }
  await setup(db); // Never leave the marked disposable DB on a mutant.
});
