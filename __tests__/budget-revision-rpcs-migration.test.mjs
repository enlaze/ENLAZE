import {test} from "node:test";
import assert from "node:assert/strict";
import {readdirSync} from "node:fs";
import {config,cluster,read,ROOT,MIGRATION,DATABASE,MARKER} from "./lib/budget-revision-rpcs-bench.mjs";
import {trocearStatements,detectarControlTransaccion} from "./lib/sql-toplevel.mjs";
const sql=read("supabase/migrations/"+MIGRATION);
function expansion(candidate){
  assert.deepEqual(detectarControlTransaccion(candidate),[]);
  const stmts=trocearStatements(candidate).map(s=>s.replace(/--[^\n]*/g,"").trim());
  assert.ok(stmts.every(s=>/^(create (schema|function)|revoke |grant |alter default privileges |set local lock_timeout|notify )/i.test(s)),"additive definitions/ACL only");
  const publicFunctions=stmts.filter(s=>/^create function public\./i.test(s));
  assert.equal(publicFunctions.length,6);
  for(const f of publicFunctions)assert.match(f,/security definer set search_path = ''/);
  for(const f of stmts.filter(s=>/^create function budget_internal\./i.test(s)))assert.match(f,/security invoker set search_path = ''/);
  assert.ok(stmts.every(s=>!/^create function public\.(replace_budget_items|update_budget_with_items)\(/i.test(s)));
}
test("E2: additive migration, six public entry points, pinned search_path",()=>expansion(sql));
for(const [name,mutate] of [
  ["top-level data update",s=>s+"\nupdate public.budgets set total=0;"],
  ["transaction bypass",s=>"commit;\n"+s],
  ["search_path injection",s=>s.replace("security definer set search_path = ''","security definer")],
]){
  test("negative control: "+name,()=>assert.throws(()=>expansion(mutate(sql))));
}
test("migration ordering permits later files and requires E1",()=>{
  const files=readdirSync(new URL("supabase/migrations/",ROOT)).filter(s=>s.endsWith(".sql")).sort();
  assert.equal(files.filter(s=>s.slice(0,14)===MIGRATION.slice(0,14)).length,1);
  assert.ok(files.indexOf("20260914090000_budgets_lock_version.sql")<files.indexOf(MIGRATION));
});
const env={RUN_REVISION_RPCS_INTEGRATION_TESTS:"1",REVISION_RPCS_DB_ACK:"DISPOSABLE_ONLY",REVISION_RPCS_CLUSTER_ACK:"DISPOSABLE_CLUSTER",
  TEST_DATABASE_URL:"postgres://postgres:synthetic@127.0.0.1:55435/enlaze_revision_rpcs_test"};
test("disposable harness rejects missing acknowledgements and inherited/remote connection settings",()=>{
  config(env);
  for(const key of Object.keys(env)){const e={...env};delete e[key];assert.throws(()=>config(e));}
  for(const url of [env.TEST_DATABASE_URL+"?options=role",env.TEST_DATABASE_URL+"\n",env.TEST_DATABASE_URL.replace("127.0.0.1","localhost"),env.TEST_DATABASE_URL.replace("55435","5432"),env.TEST_DATABASE_URL.replace(DATABASE,"postgres")]){
    assert.throws(()=>config({...env,TEST_DATABASE_URL:url}));
  }
  assert.throws(()=>config({...env,PGOPTIONS:""}));
  const row={database:DATABASE,marker:MARKER,superuser:true,other_databases:"0",version_num:"170006",address:"127.0.0.1"};
  cluster(row);for(const k of Object.keys(row))assert.throws(()=>cluster({...row,[k]:null}));
});
test("compensation has explicit pre-client acknowledgement and no cascade",()=>{
  const block=read("docs/fase2/ROLLBACK.sql").split("-- BEGIN ROLLBACK_2F2_E2")[1].split("-- END ROLLBACK_2F2_E2")[0];
  assert.match(block,/before_revision_clients/);assert.doesNotMatch(block,/\bcascade\b/i);
});
