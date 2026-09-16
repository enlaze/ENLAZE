// Only the dedicated, marked, disposable E2 cluster passes config/guard.
import assert from "node:assert/strict";
import {Client} from "pg";
import {config, setup} from "../lib/budget-revision-rpcs-bench.mjs";
const password=process.env.E2_AUTHENTICATOR_PASSWORD;
assert.match(password??"",/^[A-Za-z0-9_-]{16,128}$/);
const db=new Client(config(process.env));
await db.connect();
try {
  await setup(db);
  await db.query("do $$ begin if not exists(select 1 from pg_roles where rolname='e2_authenticator') then create role e2_authenticator login noinherit; end if; end $$");
  await db.query("alter role e2_authenticator password '"+password+"'");
  await db.query("grant anon, authenticated to e2_authenticator");
} finally { await db.end(); }
