import {test} from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {config,setup} from "./lib/budget-revision-rpcs-bench.mjs";

test("E2 / PostgREST: real HTTP conflicts and Supabase error channel",
  {skip:process.env.RUN_REVISION_RPCS_INTEGRATION_TESTS!=="1",timeout:90000}, async t=>{
  const cfg=config(process.env), secret=process.env.E2_JWT_SECRET;
  assert.ok(typeof secret==="string" && secret.length>=32);
  assert.equal(process.env.E2_REST_URL,"http://127.0.0.1:53002");
  const base=process.env.E2_REST_URL;
  const {Client}=await import("pg"), db=new Client(cfg);
  await db.connect();t.after(()=>db.end());await setup(db);
  const owner="11111111-1111-4111-8111-111111111111";
  await db.query("insert into auth.users values($1)",[owner]);
  await db.query("notify pgrst, 'reload schema'");
  const part=x=>Buffer.from(JSON.stringify(x)).toString("base64url");
  function token(role,sub){
    const value=part({alg:"HS256",typ:"JWT"})+"."+part({role,sub,exp:Math.floor(Date.now()/1000)+300});
    return value+"."+createHmac("sha256",secret).update(value).digest("base64url");
  }
  const auth=token("authenticated",owner);
  async function request(name,args,bearer=auth){
    return fetch(base+"/rpc/"+name,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+bearer},
      body:JSON.stringify(args),signal:AbortSignal.timeout(5000)});
  }
  // Wait for schema cache reload, not merely a healthy process.
  let ready=false;
  for(let i=0;i<100;i++){
    try{
      const r=await fetch(base+"/",{headers:{Authorization:"Bearer "+auth},signal:AbortSignal.timeout(1000)});
      const spec=await r.json();
      if(r.ok && spec.paths?.["/rpc/save_budget"] && spec.paths?.["/rpc/portal_respond_to_budget"]){ready=true;break;}
    }catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  assert.ok(ready,"PostgREST must expose the actual E2 schema");
  const items=[{concept:"HTTP synthetic",quantity:1,unit_price:12,subtotal:12}];
  let r=await request("create_budget_with_items",{p_budget_data:{title:"HTTP E2",budget_number:"HTTP-E2",total:12},p_items:items});
  assert.equal(r.status,200); const created=await r.json(); assert.equal(created.lock_version,1);
  const args={p_budget_id:created.budget_id,p_expected_lock_version:1,p_budget_data:{title:"saved once"},p_items:items};
  const snapshot=async()=>(await db.query("select to_jsonb(b) as budget,(select jsonb_agg(to_jsonb(i) order by sort_order,id) from public.budget_items i where budget_id=b.id) as items from public.budgets b where b.id=$1",[created.budget_id])).rows[0];
  await t.test("raw HTTP: first write succeeds, stale write returns 409/PT409 without mutation",async()=>{
    r=await request("save_budget",args);assert.equal(r.status,200);assert.equal((await r.json()).lock_version,2);
    const before=await snapshot();
    r=await request("save_budget",args);assert.equal(r.status,409);assert.equal((await r.json()).code,"PT409");
    assert.deepEqual(await snapshot(),before);
  });
  await t.test("Supabase rpc resolves data:null/error:PT409; one request, no implicit retry",async()=>{
    const {createClient}=await import("@supabase/supabase-js");
    let requests=0;
    const client=createClient(base,"synthetic-local-key",{
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      global:{headers:{Authorization:"Bearer "+auth},fetch:async(input,init)=>{
        const url=new URL(typeof input==="string"?input:input.url??String(input));
        assert.equal(url.origin,base);assert.equal(url.pathname,"/rest/v1/rpc/save_budget");
        url.pathname=url.pathname.replace("/rest/v1","");
        requests++;return fetch(url,{...init,signal:AbortSignal.timeout(5000)});
      }}
    });
    const before=await snapshot();
    const result=await client.rpc("save_budget",args);
    assert.equal(result.status,409);assert.equal(result.data,null);assert.equal(result.error?.code,"PT409");
    assert.equal(requests,1);assert.deepEqual(await snapshot(),before);
    const fresh=await client.rpc("save_budget",{...args,p_expected_lock_version:2});
    assert.equal(fresh.error,null);assert.equal(fresh.data.lock_version,3);assert.equal(requests,2);
  });
  await t.test("anonymous owner-write and foreign-owner write are denied",async()=>{
    for(const bearer of [token("anon"),token("authenticated","22222222-2222-4222-8222-222222222222")]){
      const before=await snapshot(),response=await request("save_budget",{...args,p_expected_lock_version:3},bearer);
      assert.ok([401,403].includes(response.status));assert.equal((await response.json()).code,"42501");
      assert.deepEqual(await snapshot(),before);
    }
  });
});
