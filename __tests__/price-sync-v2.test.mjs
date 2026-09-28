import { test } from "node:test";
import assert from "node:assert/strict";

import {
  confidenceForEvidence,
  getSyncStatus,
  observedUnitPrice,
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
      return this.options.productError
        ? { data: null, error: { message: this.options.productError } }
        : { data: this.options.products ?? [product()], error: null };
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
        this.currentUpserts.push(query.payload);
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
      return this.options.existingPricesError
        ? { data: null, error: { message: this.options.existingPricesError } }
        : { data: this.options.existingPrices ?? [], error: null };
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

test("package prices convert only with a usable package quantity", async (t) => {
  assert.deepEqual(observedUnitPrice(120, "Caja", "Caja", 12), {
    price: 10,
    reason: null,
  });
  assert.deepEqual(observedUnitPrice(120, "m²", "m2", 1), {
    price: 120,
    reason: null,
  });

  await t.test("an ambiguous Caja price is skipped and counted", async () => {
    const database = new FakeSupabase({
      products: [product({ sale_unit: "Caja", units_per_package: 1 })],
      observations: [observation({
        observed_price: 120,
        metadata: { evidence_type: "official_product_page", price_basis: "Caja" },
      })],
    });

    const result = await runPriceSync(database);

    assert.equal(result.status, "partial");
    assert.equal(result.records_checked, 1);
    assert.equal(result.records_skipped, 1);
    assert.equal(result.records_errors, 1);
    assert.equal(database.currentUpserts.length, 0);
    assert.equal(database.runUpdates.at(-1).summary.records_skipped, 1);
    assert.match(result.errors[0], /price_basis 'Caja'/);
  });

  await t.test("sale_unit protects an old Caja row when metadata lacks price_basis", async () => {
    const database = new FakeSupabase({
      products: [product({ sale_unit: "Caja", units_per_package: 1 })],
      observations: [observation({
        observed_price: 120,
        metadata: { evidence_type: "official_product_page" },
      })],
    });

    const result = await runPriceSync(database);

    assert.equal(result.status, "partial");
    assert.equal(result.records_skipped, 1);
    assert.equal(database.currentUpserts.length, 0);
  });

  await t.test("a Caja with units_per_package becomes a real unit price", async () => {
    const database = new FakeSupabase({
      products: [product({ sale_unit: "Caja", units_per_package: 12 })],
      observations: [observation({
        observed_price: 120,
        metadata: { evidence_type: "official_product_page", price_basis: "Caja" },
      })],
    });

    const result = await runPriceSync(database);

    assert.equal(result.status, "completed");
    assert.equal(result.records_skipped, 0);
    assert.equal(database.currentUpserts[0].price_excl_vat, 10);
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
