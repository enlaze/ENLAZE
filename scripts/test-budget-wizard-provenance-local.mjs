// Owns the entire disposable PG17 cluster and PostgREST. No Docker pull,
// .env loading, credentials, installation, deploy or external service.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, rm, cp, symlink, realpath, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { assertNoProductionEnvironment } from '../__tests__/lib/disposable-target-guard.mjs';
import { DATABASE, MARKER } from '../__tests__/lib/budget-revision-rpcs-bench.mjs';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const pgBin = process.env.WIZARD_TEST_PG_BIN ?? '/opt/homebrew/opt/postgresql@17/bin';
const restBin = process.env.WIZARD_TEST_POSTGREST_BIN ?? '/opt/homebrew/opt/postgrest/bin/postgrest';
assertNoProductionEnvironment(process.env);
assert.deepEqual(Object.keys(process.env).filter(key => /^(PG|PGRST_|E2_|RUN_REVISION|REVISION_RPCS|TEST_DATABASE_URL)/.test(key)), [], 'Refuse inherited bench settings');
assert.deepEqual(['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','VERCEL_TOKEN','ANTHROPIC_API_KEY','SERP_API_KEY']
  .filter(key => process.env[key] !== undefined), [], 'Refuse integration credentials');
assert.ok(existsSync(join(pgBin,'initdb')) && existsSync(restBin), 'Install PG17/PostgREST locally; this runner downloads nothing');
const childEnv = Object.fromEntries(['PATH','HOME','TMPDIR','LANG','LC_ALL','PUPPETEER_EXECUTABLE_PATH'].filter(key => process.env[key] !== undefined).map(key => [key,process.env[key]]));
const version = (await exec(join(pgBin,'postgres'), ['--version'], {env:childEnv})).stdout.trim();
assert.match(version, /PostgreSQL\) 17\./);
const directory = await mkdtemp('/private/tmp/enlaze-wizard-provenance-');
const data = join(directory,'data');
const reports = join(root,'informes/evidencias/budget-wizard-provenance');
await mkdir(reports,{recursive:true});
let started=false, rest, mutantDir;
const env = {...childEnv,
  RUN_REVISION_RPCS_INTEGRATION_TESTS:'1', REVISION_RPCS_DB_ACK:'DISPOSABLE_ONLY',
  REVISION_RPCS_CLUSTER_ACK:'DISPOSABLE_CLUSTER',
  TEST_DATABASE_URL:`postgres://postgres:e2_disposable_database_only@127.0.0.1:55435/${DATABASE}`,
  E2_AUTHENTICATOR_PASSWORD:'e2_disposable_authenticator_only',
  E2_JWT_SECRET:'e2_synthetic_disposable_jwt_secret_not_for_production',
  E2_REST_URL:'http://127.0.0.1:53002',
};
async function run(cwd, name) {
  const child = spawn(globalThis.process.execPath,['--import','tsx','__tests__/budget-wizard-full-page.browser.integration.test.mjs'],
    {cwd,env,detached:true,stdio:['ignore','pipe','pipe']});
  let output='';
  for(const stream of [child.stdout,child.stderr]) stream.on('data',chunk=>{output+=chunk; globalThis.process.stdout.write(chunk);});
  const stopGroup=()=>{try{globalThis.process.kill(-child.pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}};
  const timer=setTimeout(stopGroup,240000);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  clearTimeout(timer);
  stopGroup();
  await writeFile(join(reports,`${name}.log`),output);
  return {code,output};
}
try {
  await exec(join(pgBin,'initdb'),['-D',data,'--auth=trust','--username=postgres','--no-locale','--encoding=UTF8'],{env:childEnv});
  await exec(join(pgBin,'pg_ctl'),['-D',data,'-l',join(directory,'postgres.log'),'-o',
    `-k ${directory} -p 55435 -h 127.0.0.1 -c enlaze.test_cluster_marker=${MARKER}`,'-w','start'],{env:childEnv});
  started=true;
  const initial=new Client({host:directory,port:55435,user:'postgres',database:'postgres'});
  await initial.connect();
  try{
    const identity=(await initial.query("select current_setting('data_directory') as directory, current_setting('enlaze.test_cluster_marker') as marker, (select count(*)::int from pg_database where not datistemplate and datname<>'postgres') as others")).rows[0];
    assert.deepEqual(identity,{directory:data,marker:MARKER,others:0});
    await initial.query(`create database ${DATABASE}`);
  }finally{await initial.end();}
  await exec(globalThis.process.execPath,['__tests__/support/prepare-budget-revision-rpcs.mjs'],{cwd:root,env});
  rest=spawn(restBin,[],{env:{...childEnv,
    PGRST_DB_URI:`postgresql://e2_authenticator@/${DATABASE}?host=${encodeURIComponent(directory)}&port=55435`,
    PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:env.E2_JWT_SECRET,
    PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:'53002'},stdio:['ignore','ignore','pipe']});
  let restLog=''; rest.stderr.on('data',chunk=>{restLog=(restLog+chunk).slice(-3000);});
  let ready=false;
  for(let i=0;i<100;i++){
    try{ready=(await fetch(env.E2_REST_URL,{signal:AbortSignal.timeout(500),redirect:'error'})).ok;}catch{ /* starting */ }
    if(ready || rest.exitCode!==null)break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(ready,restLog);
  console.log(`BENCH ${version}; local PostgREST; existing full-page E2E; guarded Next sockets and browser requests`);
  const baseline=await run(root,'baseline');
  assert.equal(baseline.code,0,baseline.output.slice(-5000));
  const providerPath='app/dashboard/budgets/generate/_components/BudgetGenerateProvider.tsx';
  const original=await readFile(join(root,providerPath),'utf8');
  const summary=['BASELINE PASS: generated provenance + real manual edit + existing wizard regressions'];
  if(!globalThis.process.argv.includes('--baseline-only')){
    mutantDir=await mkdtemp('/private/tmp/enlaze-wizard-provenance-mutant-');
    await cp(root,mutantDir,{recursive:true,filter:path=>!['.git','node_modules','.next','.test-out','informes'].includes(path.split('/').at(-1))});
    await symlink(await realpath(join(root,'node_modules')),join(mutantDir,'node_modules'));
    for(const [name,items] of [['no-provenance-transport',['p','m']],['no-partida-provenance',['p']],['no-material-provenance',['m']]]){
      let changed=original;
      for(const item of items){
        const anchor=item==='p' ? `      ...evidenceForSave(p, p.unit_price),\n`
          : `              ...resolvedPriceEvidence(\n                resolved.selectedPrice, resolved.sourceType, resolved.confidenceScore, resolved.capturedAt,\n              ),\n`;
        assert.equal(changed.split(anchor).length,2,`unique mutation anchor ${item}`);
        changed=changed.replace(anchor,'');
      }
      await writeFile(join(mutantDir,providerPath),changed);
      const result=await run(mutantDir,name);
      assert.equal(result.code,1,`${name} must fail an assertion, not boot/crash`);
      assert.match(result.output,/AssertionError/);
      assert.match(result.output,/G3 TRANSPORT: .* source must reach (budget_items|wizard_state)/);
      summary.push(`KILLED ${name}: real persisted prices lost provenance`);
      console.log(summary.at(-1));
    }
    assert.equal(await readFile(join(root,providerPath),'utf8'),original,'checked-out provider unchanged');
    summary.push('3/3 mutants killed; provider unchanged; disposable services removed on exit.');
  }
  await writeFile(join(reports,'resumen.txt'),summary.join('\n')+'\n');
  console.log(summary.join('\n'));
}finally{
  if(rest && rest.exitCode===null){const exited=new Promise(resolve=>rest.once('exit',resolve));rest.kill('SIGTERM');await exited;}
  if(started)await exec(join(pgBin,'pg_ctl'),['-D',data,'-m','immediate','-w','stop'],{env:childEnv});
  if(mutantDir)await rm(mutantDir,{recursive:true,force:true});
  await rm(directory,{recursive:true,force:true});
}
