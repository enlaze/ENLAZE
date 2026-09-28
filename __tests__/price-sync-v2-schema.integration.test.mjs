import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { confidenceForEvidence, observedUnitPrice } from "../lib/price-sync-v2.ts";

const enabled = process.env.RUN_PRICE_SYNC_INTEGRATION === "1";
const dbName = "enlaze_revision_rpcs_test";
const marker = "budget_revision_rpcs_2f2";

test("price sync reads the real observation contract on disposable PostgreSQL 17", {
  skip: !enabled,
  timeout: 120000,
}, () => {
  assert.equal(process.env.PRICE_SYNC_TEST_ACK, "DISPOSABLE_CLUSTER");
  assert.deepEqual(Object.keys(process.env).filter((key) => key.startsWith("PG")), []);

  const socket = process.env.PRICE_SYNC_TEST_SOCKET;
  if (socket) {
    assert.match(socket, /^\/private\/tmp\/enlaze-e2-bench\.[A-Za-z0-9]+$/);
  } else {
    assert.equal(
      process.env.TEST_DATABASE_URL,
      "postgres://postgres:e2_disposable_database_only@127.0.0.1:55435/enlaze_revision_rpcs_test",
    );
  }

  const sql = String.raw`
    begin;
    select 'IDENTITY=' || concat_ws('|',
      current_database(),
      current_setting('enlaze.test_cluster_marker',true),
      current_setting('server_version_num'),
      (select rolsuper from pg_roles where rolname=current_user),
      (select count(*) from pg_database where not datistemplate
        and datname not in ('postgres',current_database()))
    );

    create temporary table pb_price_observations (
      id uuid primary key,
      product_id uuid not null,
      provider_id uuid not null,
      observed_price numeric(12,4) not null,
      observed_at timestamptz default now(),
      source text not null default 'n8n',
      source_url text,
      currency text default 'EUR',
      metadata jsonb default '{}'::jsonb,
      created_at timestamptz default now()
    );

    select 'COLUMNS=' || string_agg(attname, ',' order by attnum)
    from pg_attribute
    where attrelid='pg_temp.pb_price_observations'::regclass
      and attnum > 0 and not attisdropped;

    insert into pg_temp.pb_price_observations
      (id,product_id,provider_id,observed_price,observed_at,source,source_url,currency,metadata,created_at)
    values
      ('33333333-3333-4333-8333-333333333333',
       '11111111-1111-4111-8111-111111111111',
       '22222222-2222-4222-8222-222222222222',
       96,'2026-09-27T09:00:00Z','provider_catalog',
       'https://supplier.example/old','EUR',
       '{"evidence_type":"official_pdf_catalog","price_basis":"Caja"}'::jsonb,
       '2026-09-27T09:01:00Z'),
      ('44444444-4444-4444-8444-444444444444',
       '11111111-1111-4111-8111-111111111111',
       '22222222-2222-4222-8222-222222222222',
       120,'2026-09-28T09:00:00Z','provider_catalog',
       'https://supplier.example/current','EUR',
       '{"evidence_type":"official_bc3_catalog","price_basis":"Caja"}'::jsonb,
       '2026-09-28T09:01:00Z');

    create temporary table price_sync_assertions(key text primary key, value text not null);
    do $block$
    declare
      rows_read integer := 0;
      error_code text := 'none';
    begin
      begin
        execute 'select count(*) from pg_temp.pb_price_observations order by checked_at desc'
          into rows_read;
      exception when others then
        get stacked diagnostics error_code = returned_sqlstate;
      end;
      insert into pg_temp.price_sync_assertions(key,value)
      values ('OLD_ORDER_CODE',error_code),('OLD_ORDER_ROWS',rows_read::text);
    end
    $block$;

    select key || '=' || value from pg_temp.price_sync_assertions order by key;
    select 'LATEST=' || concat_ws('|',
      id,
      observed_price,
      to_char(observed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      source,
      metadata->>'evidence_type',
      metadata->>'price_basis'
    )
    from pg_temp.pb_price_observations
    where product_id='11111111-1111-4111-8111-111111111111'
    order by observed_at desc
    limit 1;
    rollback;
  `;

  const args = [
    "-X",
    "-q",
    "-v", "ON_ERROR_STOP=1",
    "-h", socket || "127.0.0.1",
    "-p", "55435",
    "-U", "postgres",
    "-d", dbName,
    "-A",
    "-t",
  ];
  const env = socket
    ? process.env
    : { ...process.env, PGPASSWORD: "e2_disposable_database_only" };
  const execution = spawnSync("psql", args, {
    input: sql,
    encoding: "utf8",
    env,
    timeout: 120000,
  });

  assert.ifError(execution.error);
  assert.equal(execution.status, 0, execution.stderr || execution.stdout);
  const results = new Map(execution.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("="))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }));

  const [database, clusterMarker, version, superuser, otherDatabases] =
    results.get("IDENTITY").split("|");
  assert.equal(database, dbName);
  assert.equal(clusterMarker, marker);
  assert.equal(Math.floor(Number(version) / 10000), 17);
  assert.equal(superuser, "t");
  assert.equal(Number(otherDatabases), 0);

  assert.equal(results.get("COLUMNS"), [
    "id",
    "product_id",
    "provider_id",
    "observed_price",
    "observed_at",
    "source",
    "source_url",
    "currency",
    "metadata",
    "created_at",
  ].join(","));
  assert.equal(results.get("OLD_ORDER_CODE"), "42703");
  assert.equal(results.get("OLD_ORDER_ROWS"), "0");

  const [id, rawPrice, observedAt, source, evidenceType, priceBasis] =
    results.get("LATEST").split("|");
  assert.equal(id, "44444444-4444-4444-8444-444444444444");
  assert.equal(Number(rawPrice), 120);
  assert.equal(observedAt, "2026-09-28T09:00:00.000Z");
  assert.equal(source, "provider_catalog");
  assert.equal(confidenceForEvidence(evidenceType), 0.85);
  assert.deepEqual(observedUnitPrice(rawPrice, priceBasis, "ud", 12), {
    price: 10,
    reason: null,
  });
});
