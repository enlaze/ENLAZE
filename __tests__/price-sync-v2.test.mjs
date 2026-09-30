import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PRICE_SYNC_SOURCE_TYPES,
  confidenceForEvidence,
  getSyncStatus,
  observedUnitPrice,
  priceSyncSourceType,
  runPriceSync,
} from "../lib/price-sync-v2.ts";

class FakeQuery {
  constructor(database, table) {
    this.database = database;
    this.table = table;
    this.operation = "select";
    this.filters = [];
  }

  select(columns, options) {
    this.columns = columns;
    this.selectOptions = options;
    return this;
  }

  insert(payload) {
    this.operation = "insert";
    this.payload = payload;
    return this;
  }

  update(payload) {
    this.operation = "update";
    this.payload = payload;
    return this;
  }

  upsert(payload, options) {
    this.operation = "upsert";
    this.payload = payload;
    this.upsertOptions = options;
    return this;
  }

  eq(column, value) {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }

  in(column, value) {
    this.filters.push({ kind: "in", column, value });
    return this;
  }

  lt(column, value) {
    this.filters.push({ kind: "lt", column, value });
    return this;
  }

  order(column, options) {
    this.orderBy = { column, ...options };
    return this;
  }

  limit(value) {
    this.limitValue = value;
    return this;
  }

  range(from, to) {
    this.rangeValue = { from, to };
    return this;
  }

  single() {
    this.cardinality = "single";
    return this;
  }

  maybeSingle() {
    this.cardinality = "maybeSingle";
    return this;
  }

  then(resolve, reject) {
    return this.database.execute(this).then(resolve, reject);
  }
}

class FakeSupabase {
  constructor(options = {}) {
    this.options = options;
    this.calls = [];
    this.currentUpserts = [];
    this.runUpdates = [];
    this.staleUpdates = 0;
  }

  from(table) {
    return new FakeQuery(this, table);
  }

  async execute(query) {
    this.calls.push({
      table: query.table,
      operation: query.operation,
      columns: query.columns,
      orderBy: query.orderBy,
      filters: query.filters,
      payload: query.payload,
      selectOptions: query.selectOptions,
      range: query.rangeValue,
    });

    if (query.table === "pb_sync_runs") {
      if (query.operation === "insert") {
        return this.options.insertRunError
          ? { data: null, error: { message: this.options.insertRunError } }
          : { data: { id: "run-1" }, error: null };
      }
      if (query.operation === "update") {
        this.runUpdates.push(query.payload);
        return this.options.updateRunError
          ? { data: null, error: { message: this.options.updateRunError } }
          : { data: null, error: null };
      }
      if (query.columns === "*") {
        return this.options.lastRunError
          ? { data: null, error: { message: this.options.lastRunError } }
          : { data: this.options.lastRun ?? null, error: null };
      }
      return this.options.idempotencyError
        ? { data: null, error: { message: this.options.idempotencyError } }
        : { data: this.options.existingRuns ?? [], error: null };
    }

    if (query.table === "pb_products") {
      const products = this.options.products ?? [product()];
      const from = query.rangeValue?.from ?? 0;
      const requestedTo = query.rangeValue?.to ?? (from + 999);
      const to = Math.min(requestedTo, from + 999);
      return this.options.productError
        ? { data: null, error: { message: this.options.productError } }
        : { data: products.slice(from, to + 1), error: null };
    }

    if (query.table === "pb_price_observations") {
      if (query.orderBy?.column !== "observed_at") {
        return { data: null, error: { message: "column checked_at does not exist" } };
      }
      return this.options.observationError
        ? { data: null, error: { message: this.options.observationError } }
        : { data: this.options.observations ?? [observation()], error: null };
    }

    if (query.table === "pb_price_current") {
      if (query.operation === "upsert") {
        this.currentUpserts.push(...(Array.isArray(query.payload) ? query.payload : [query.payload]));
        return this.options.upsertError
          ? { data: null, error: { message: this.options.upsertError } }
          : { data: null, error: null };
      }
      if (query.operation === "update") {
        this.staleUpdates++;
        return this.options.staleError
          ? { data: null, error: { message: this.options.staleError } }
          : { data: this.options.staleRows ?? [], error: null };
      }
      if (query.selectOptions?.head) {
        const available = query.filters.some(
          (filter) => filter.column === "is_available" && filter.value === true,
        );
        if (available && this.options.totalAvailableError) {
          return { count: null, data: null, error: { message: this.options.totalAvailableError } };
        }
        if (!available && this.options.totalProductsError) {
          return { count: null, data: null, error: { message: this.options.totalProductsError } };
        }
        return {
          count: available ? (this.options.totalAvailable ?? 0) : (this.options.totalProducts ?? 0),
          data: null,
          error: null,
        };
      }
      const prices = this.options.existingPrices ?? [];
      const from = query.rangeValue?.from ?? 0;
      const requestedTo = query.rangeValue?.to ?? (from + 999);
      const to = Math.min(requestedTo, from + 999);
      return this.options.existingPricesError
        ? { data: null, error: { message: this.options.existingPricesError } }
        : { data: prices.slice(from, to + 1), error: null };
    }

    throw new Error(`Unexpected fake query: ${query.table}.${query.operation}`);
  }
}

function product(overrides = {}) {
  return {
    id: "product-1",
    commercial_name: "Mortero",
    provider_id: "provider-1",
    concept_id: "concept-1",
    sale_unit: "ud",
    units_per_package: 1,
    unit_price: 9.99,
    is_available: true,
    is_active: true,
    pb_providers: { id: "provider-1", name: "Proveedor" },
    ...overrides,
  };
}

function observation(overrides = {}) {
  return {
    id: "observation-1",
    product_id: "product-1",
    provider_id: "provider-1",
    observed_price: 21.5,
    observed_at: "2026-09-28T08:30:00.000Z",
    source: "provider_catalog",
    source_url: "https://supplier.example/product",
    currency: "EUR",
    metadata: {
      evidence_type: "official_bc3_catalog",
      price_basis: "ud",
    },
    created_at: "2026-09-28T08:31:00.000Z",
    ...overrides,
  };
}

test("materializes the real observation schema instead of the obsolete columns", async () => {
  const database = new FakeSupabase({
    products: [product({ is_available: false })],
    observations: [observation()],
  });

  const result = await runPriceSync(database);

  assert.equal(result.status, "completed");
  assert.equal(result.records_checked, 1);
  assert.equal(result.records_new, 1);
  assert.equal(database.currentUpserts.length, 1);
  assert.deepEqual(database.currentUpserts[0], {
    product_id: "product-1",
    observation_id: "observation-1",
    provider_id: "provider-1",
    concept_id: "concept-1",
    price_excl_vat: 21.5,
    confidence_score: 0.85,
    region: "ES",
    is_available: false,
    source_type: "provider_catalog",
    checked_at: "2026-09-28T08:30:00.000Z",
    price_changed_at: undefined,
  });

  const observationCall = database.calls.find((call) => call.table === "pb_price_observations");
  assert.equal(observationCall.orderBy.column, "observed_at");
  assert.match(observationCall.columns, /observed_price/);
  assert.match(observationCall.columns, /observed_at/);
  assert.doesNotMatch(observationCall.columns, /price_excl_vat|checked_at|confidence_score/);
});

test("paginates past the production PostgREST 1,000-row cap", async () => {
  const products = Array.from({ length: 2_005 }, (_, index) => product({
    id: `product-${index + 1}`,
    unit_price: 10 + index / 100,
  }));
  const existingPrices = Array.from({ length: 1_505 }, (_, index) => ({
    product_id: `product-${index + 1}`,
    price_excl_vat: 10 + index / 100,
    is_available: true,
  }));
  const database = new FakeSupabase({ products, existingPrices, observations: [] });

  const result = await runPriceSync(database);
  const productReads = database.calls.filter((call) => call.table === "pb_products");
  const currentReads = database.calls.filter(
    (call) => call.table === "pb_price_current" && call.operation === "select",
  );
  const currentUpsertCalls = database.calls.filter(
    (call) => call.table === "pb_price_current" && call.operation === "upsert",
  );

  assert.equal(result.status, "completed");
  assert.equal(result.records_checked, 2_005);
  assert.equal(result.records_new, 500);
  assert.equal(result.records_unchanged, 1_505);
  assert.equal(database.currentUpserts.length, 2_005);
  assert.equal(currentUpsertCalls.length, 41);
  assert.ok(currentUpsertCalls.every((call) => call.payload.length <= 50));
  assert.ok(productReads.every((call) => call.orderBy?.column === "id"));
  assert.ok(currentReads.every((call) => call.orderBy?.column === "product_id"));
  assert.deepEqual(productReads.map((call) => call.range), [
    { from: 0, to: 999 },
    { from: 1_000, to: 1_999 },
    { from: 2_000, to: 2_999 },
  ]);
  assert.deepEqual(currentReads.map((call) => call.range), [
    { from: 0, to: 999 },
    { from: 1_000, to: 1_999 },
  ]);
});

for (const [evidenceType, confidence] of [
  ["official_bc3_catalog", 0.85],
  ["official_pdf_catalog", 0.80],
  ["official_product_page", 0.70],
  ["official_product_listing", 0.70],
  [undefined, 0.55],
]) {
  test(`derives confidence ${confidence} for ${evidenceType ?? "missing evidence_type"}`, () => {
    assert.equal(confidenceForEvidence(evidenceType), confidence);
  });
}

test("the obsolete checked_at failure ends the run in error instead of completed", async () => {
  const database = new FakeSupabase({
    observationError: "column pb_price_observations.checked_at does not exist",
  });

  const result = await runPriceSync(database);

  assert.equal(result.status, "error");
  assert.equal(result.records_checked, 0);
  assert.equal(result.records_errors, 1);
  assert.equal(database.currentUpserts.length, 0);
  assert.equal(database.staleUpdates, 0);
  assert.match(result.errors.join("\n"), /checked_at does not exist/);
  assert.equal(database.runUpdates.at(-1).status, "error");
});

test("price_basis is a sale format, while explicit package quantities still convert", async (t) => {
  assert.deepEqual(observedUnitPrice(120, "Caja", "Caja", 12), {
    price: 10,
    reason: null,
  });
  assert.deepEqual(observedUnitPrice(120, "m²", "m2", 1), {
    price: 120,
    reason: null,
  });

  await t.test("a Bote with units_per_package 1 keeps its observed price", async () => {
    const database = new FakeSupabase({
      products: [product({
        commercial_name: "Pintura plástica Bote 4 L",
        sale_unit: "Bote",
        units_per_package: 1,
      })],
      observations: [observation({
        observed_price: 23.23,
        metadata: { evidence_type: "official_product_page", price_basis: "Bote" },
      })],
    });

    const result = await runPriceSync(database);

    assert.equal(result.status, "completed");
    assert.equal(result.records_checked, 1);
    assert.equal(result.records_skipped, 0);
    assert.equal(result.records_errors, 0);
    assert.deepEqual(result.errors, []);
    assert.equal(database.currentUpserts[0].price_excl_vat, 23.23);
  });

  await t.test("x12 ud with units_per_package 1 is skipped with its own reason", async () => {
    const database = new FakeSupabase({
      products: [product({
        commercial_name: "Tacos de nylon x12 ud",
        sale_unit: "Caja",
        units_per_package: 1,
      })],
      observations: [observation({
        observed_price: 12,
        metadata: { evidence_type: "official_product_page", price_basis: "Caja" },
      })],
    });

    const result = await runPriceSync(database);
    const summary = database.runUpdates.at(-1).summary;

    assert.equal(result.status, "completed");
    assert.equal(result.records_skipped, 1);
    assert.deepEqual(result.errors, []);
    assert.equal(database.currentUpserts.length, 0);
    assert.deepEqual(summary.skipped.reasons, {
      declared_pack_quantity_without_units_per_package: 1,
    });
    assert.match(summary.skipped.examples[0].reason, /declared pack quantity 12/);
  });

  await t.test("zero and negative prices stay discarded", async () => {
    const database = new FakeSupabase({
      products: [product({ id: "zero" }), product({ id: "negative" })],
      observations: [
        observation({ id: "zero-observation", product_id: "zero", observed_price: 0 }),
        observation({ id: "negative-observation", product_id: "negative", observed_price: -5 }),
      ],
    });

    const result = await runPriceSync(database);
    const summary = database.runUpdates.at(-1).summary;

    assert.equal(result.status, "completed");
    assert.equal(result.records_skipped, 2);
    assert.equal(database.currentUpserts.length, 0);
    assert.deepEqual(summary.skipped.reasons, { invalid_observed_price: 2 });
  });
});

test("3,000 safe discards stay completed and keep a bounded summary", async () => {
  const products = Array.from({ length: 3_000 }, (_, index) => product({
    id: `product-${index + 1}`,
    unit_price: 0,
  }));
  const database = new FakeSupabase({ products, observations: [] });

  const result = await runPriceSync(database);
  const persisted = database.runUpdates.at(-1);
  const reason = "observed_price is not a positive finite number";

  assert.equal(result.status, "completed");
  assert.equal(result.records_checked, 3_000);
  assert.equal(result.records_skipped, 3_000);
  assert.equal(result.records_errors, 0);
  assert.deepEqual(result.errors, []);
  assert.equal(database.currentUpserts.length, 0);
  assert.equal(persisted.status, "completed");
  assert.deepEqual(persisted.error_log, []);
  assert.deepEqual(persisted.summary.skipped.reasons, { invalid_observed_price: 3_000 });
  assert.equal(persisted.summary.skipped.examples.length, 20);
  assert.ok(persisted.summary.skipped.examples.every((example) => example.reason === reason));
});

test("a product base price cannot tie an observation without evidence metadata", async () => {
  const database = new FakeSupabase({
    products: [
      product({ id: "observed-product" }),
      product({ id: "base-product" }),
    ],
    observations: [observation({
      id: "observation-without-evidence",
      product_id: "observed-product",
      source: "n8n",
      metadata: { price_basis: "ud" },
    })],
  });

  const result = await runPriceSync(database);
  const observed = database.currentUpserts.find((row) => row.product_id === "observed-product");
  const base = database.currentUpserts.find((row) => row.product_id === "base-product");

  assert.equal(result.status, "completed");
  assert.equal(observed.confidence_score, 0.55);
  assert.equal(observed.source_type, "n8n");
  assert.equal(base.confidence_score, 0.30);
  assert.equal(base.source_type, "product_base");
  assert.ok(base.confidence_score < observed.confidence_score);
});

test("source_type has one closed vocabulary", () => {
  const allowed = [
    "provider_catalog",
    "n8n",
    "manual",
    "api",
    "scraper",
    "product_base",
  ];
  assert.deepEqual([...PRICE_SYNC_SOURCE_TYPES], allowed);
  for (const source of allowed) assert.equal(priceSyncSourceType(source), source);
  assert.equal(priceSyncSourceType("unexpected_source"), "n8n");
  assert.equal(priceSyncSourceType(" API "), "api");
});

test("an unknown source fallback is counted instead of becoming n8n silently", async () => {
  const database = new FakeSupabase({
    observations: [observation({ source: "new_external_feed" })],
  });

  const result = await runPriceSync(database);
  const summary = database.runUpdates.at(-1).summary;

  assert.equal(result.status, "completed");
  assert.equal(database.currentUpserts[0].source_type, "n8n");
  assert.deepEqual(summary.unknown_sources, {
    count: 1,
    examples: [{ product_id: "product-1", source: "new_external_feed" }],
  });
});

test("every database operation in the sync fails closed", async (t) => {
  const cases = [
    ["idempotency read", { idempotencyError: "idempotency unavailable" }, { idempotency_key: "daily" }],
    ["run insert", { insertRunError: "cannot create run" }],
    ["product read", { productError: "products unavailable" }],
    ["current-price read", { existingPricesError: "current prices unavailable" }],
    ["current-price upsert", { upsertError: "upsert refused" }],
    ["stale update", { staleError: "stale update refused" }],
    ["final run update", { updateRunError: "run update refused" }],
  ];

  for (const [name, options, config = {}] of cases) {
    await t.test(name, async () => {
      const database = new FakeSupabase(options);
      const result = await runPriceSync(database, config);
      assert.equal(result.status, "error");
      assert.ok(result.records_errors >= 1);
      assert.ok(result.errors.length >= 1);
    });
  }
});

test("getSyncStatus surfaces read failures", async () => {
  const database = new FakeSupabase({ totalAvailableError: "count unavailable" });
  await assert.rejects(
    getSyncStatus(database),
    /Failed to count available prices: count unavailable/,
  );
});
