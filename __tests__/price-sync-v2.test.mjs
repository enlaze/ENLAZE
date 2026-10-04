import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PRICE_STALENESS_DAYS_BY_SOURCE,
  PRICE_SYNC_SOURCE_TYPES,
  confidenceForEvidence,
  getSyncStatus,
  observedUnitPrice,
  priceSyncSourceType,
  runPriceSync,
} from "../lib/price-sync-v2.ts";

// Production contract verified on 2026-10-04. This is the complete column
// inventory of public.pb_price_current; sync payloads may use only this set.
// Keeping the contract beside the fake prevents it from accepting fields that
// PostgREST would reject against the real table.
const PB_PRICE_CURRENT_COLUMNS = new Set([
  "id",
  "product_id",
  "observation_id",
  "provider_id",
  "price_excl_vat",
  "confidence_score",
  "region",
  "is_available",
  "source_type",
  "checked_at",
  "price_changed_at",
  "created_at",
  "updated_at",
]);

class FakeQuery {
  constructor(database, table) {
    this.database = database;
    this.table = table;
    this.operation = "select";
    this.filters = [];
    this.orderings = [];
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

  not(column, operator, value) {
    this.filters.push({ kind: "not", column, operator, value });
    return this;
  }

  gt(column, value) {
    this.filters.push({ kind: "gt", column, value });
    return this;
  }

  or(expression) {
    this.filters.push({ kind: "or", expression });
    return this;
  }

  order(column, options) {
    const ordering = { column, ...options };
    this.orderings.push(ordering);
    this.orderBy ??= ordering;
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
      orderings: query.orderings,
      filters: query.filters,
      payload: query.payload,
      selectOptions: query.selectOptions,
      range: query.rangeValue,
      limit: query.limitValue,
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
      const products = [...(this.options.products ?? [product()])]
        .filter((row) => query.filters.every((filter) => {
          if (filter.kind === "gt") return String(row[filter.column]) > String(filter.value);
          if (filter.kind === "eq") return row[filter.column] === filter.value;
          return true;
        }))
        .toSorted((left, right) => left.id.localeCompare(right.id));
      const from = query.rangeValue?.from ?? 0;
      const requestedTo = query.rangeValue?.to ?? (from + 999);
      const to = Math.min(requestedTo, from + (query.limitValue ?? 1_000) - 1, from + 999);
      const data = products.slice(from, to + 1);
      this.options.afterProductRead?.(this.calls.filter((call) => call.table === "pb_products").length, data);
      return this.options.productError
        ? { data: null, error: { message: this.options.productError } }
        : { data, error: null };
    }

    if (query.table === "pb_price_observations") {
      if (query.orderBy?.column !== "observed_at") {
        return { data: null, error: { message: "column checked_at does not exist" } };
      }
      if (this.options.observationError) {
        return { data: null, error: { message: this.options.observationError } };
      }
      const requestedProductIds = query.filters.find(
        (filter) => filter.kind === "in" && filter.column === "product_id",
      )?.value;
      const observations = (this.options.observations ?? [observation()])
        .filter((row) => !requestedProductIds || requestedProductIds.includes(row.product_id))
        .filter((row) => query.filters.every((filter) => {
          if (filter.kind !== "or") return true;
          const match = filter.expression.match(
            /^observed_at\.lt\.([^,]+),and\(observed_at\.eq\.([^,]+),id\.gt\.(.+)\)$/,
          );
          assert.ok(match, `unexpected observation cursor: ${filter.expression}`);
          return row.observed_at < match[1]
            || (row.observed_at === match[2] && row.id > match[3]);
        }))
        .toSorted((left, right) => {
          const byObservedAt = right.observed_at.localeCompare(left.observed_at);
          return byObservedAt || left.id.localeCompare(right.id);
        });
      const from = query.rangeValue?.from ?? 0;
      const requestedTo = query.rangeValue?.to ?? (from + 999);
      const to = Math.min(requestedTo, from + (query.limitValue ?? 1_000) - 1, from + 999);
      return { data: observations.slice(from, to + 1), error: null };
    }

    if (query.table === "pb_price_current") {
      if (query.operation === "upsert") {
        const payload = Array.isArray(query.payload) ? query.payload : [query.payload];
        const unknownColumns = [...new Set(
          payload.flatMap((row) => Object.keys(row))
            .filter((column) => !PB_PRICE_CURRENT_COLUMNS.has(column)),
        )];
        if (unknownColumns.length > 0) {
          return {
            data: null,
            error: {
              message: `pb_price_current schema contract rejects: ${unknownColumns.join(", ")}`,
            },
          };
        }
        this.currentUpserts.push(...payload);
        return this.options.upsertError
          ? { data: null, error: { message: this.options.upsertError } }
          : { data: null, error: null };
      }
      if (query.operation === "update") {
        this.staleUpdates++;
        if (this.options.staleError) {
          return { data: null, error: { message: this.options.staleError } };
        }
        const rows = (this.options.staleRows ?? []).filter((row) =>
          query.filters.every((filter) => {
            if (filter.kind === "eq") return row[filter.column] === filter.value;
            if (filter.kind === "lt") return String(row[filter.column]) < String(filter.value);
            if (filter.kind === "not" && filter.operator === "in") {
              const excluded = String(filter.value).slice(1, -1).split(",");
              return !excluded.includes(String(row[filter.column]));
            }
            return true;
          }),
        );
        for (const row of rows) row.is_available = false;
        return {
          data: rows.map((row) => ({ id: row.id, source_type: row.source_type })),
          error: null,
        };
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
      const prices = (this.options.existingPrices ?? [])
        .map((row, index) => ({ id: row.id ?? `current-${String(index).padStart(6, "0")}`, ...row }))
        .filter((row) => query.filters.every((filter) => {
          if (filter.kind === "gt") return String(row[filter.column]) > String(filter.value);
          return true;
        }))
        .toSorted((left, right) => left.id.localeCompare(right.id));
      const from = query.rangeValue?.from ?? 0;
      const requestedTo = query.rangeValue?.to ?? (from + 999);
      const to = Math.min(requestedTo, from + (query.limitValue ?? 1_000) - 1, from + 999);
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

function stalePrice(overrides = {}) {
  return {
    id: "current-1",
    source_type: "n8n",
    checked_at: "2026-08-25T12:00:00.000Z",
    is_available: true,
    ...overrides,
  };
}

const STALENESS_TEST_NOW = Date.parse("2026-10-04T12:00:00.000Z");

async function runStalenessScenario(staleRows, stalenessDays = 30) {
  const database = new FakeSupabase({ products: [], observations: [], staleRows });
  const result = await runPriceSync(
    database,
    { staleness_days: stalenessDays },
    { now: () => STALENESS_TEST_NOW },
  );
  return { database, result };
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

test("current-price upsert names only real production columns", async () => {
  const database = new FakeSupabase({
    products: [product()],
    observations: [observation()],
  });

  const result = await runPriceSync(database);

  assert.equal(result.status, "completed");
  assert.equal(database.currentUpserts.length, 1);
  assert.deepEqual(
    Object.keys(database.currentUpserts[0]).toSorted(),
    [
      "checked_at",
      "confidence_score",
      "is_available",
      "observation_id",
      "price_changed_at",
      "price_excl_vat",
      "product_id",
      "provider_id",
      "region",
      "source_type",
    ],
  );
  assert.ok(
    Object.keys(database.currentUpserts[0])
      .every((column) => PB_PRICE_CURRENT_COLUMNS.has(column)),
  );
});

test("paginates past the production PostgREST 1,000-row cap", async () => {
  const products = Array.from({ length: 2_005 }, (_, index) => product({
    id: `product-${String(index + 1).padStart(5, "0")}`,
    unit_price: 10 + index / 100,
  }));
  const existingPrices = Array.from({ length: 1_505 }, (_, index) => ({
    id: `current-${String(index + 1).padStart(5, "0")}`,
    product_id: `product-${String(index + 1).padStart(5, "0")}`,
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
  assert.equal(currentUpsertCalls.length, 5);
  assert.ok(currentUpsertCalls.every((call) => call.payload.length <= 500));
  assert.ok(productReads.every((call) => call.orderBy?.column === "id"));
  assert.ok(currentReads.every((call) => call.orderBy?.column === "id"));
  assert.ok(productReads.every((call) => call.range === undefined && call.limit === 1_000));
  assert.ok(currentReads.every((call) => call.range === undefined && call.limit === 1_000));
  assert.deepEqual(
    productReads.slice(1).map((call) => call.filters.find((filter) => filter.kind === "gt")?.value),
    ["product-00999", "product-01998"],
  );
  assert.deepEqual(
    currentReads.slice(1).map((call) => call.filters.find((filter) => filter.kind === "gt")?.value),
    ["current-00999"],
  );
});

test("keyset pagination walks the initial catalogue once when rows are inserted mid-run", async () => {
  const products = Array.from({ length: 1_500 }, (_, index) => product({
    id: `product-${String(index + 1).padStart(5, "0")}`,
  }));
  const initialIds = products.map((row) => row.id);
  const database = new FakeSupabase({
    products,
    observations: [],
    afterProductRead(readNumber) {
      if (readNumber === 1) {
        products.push(product({ id: "product-00000" }));
      }
    },
  });

  const result = await runPriceSync(database);
  const writtenIds = database.currentUpserts.map((row) => row.product_id);

  assert.equal(result.status, "completed");
  assert.equal(result.records_checked, initialIds.length);
  assert.deepEqual(writtenIds.toSorted(), initialIds.toSorted());
  assert.equal(new Set(writtenIds).size, writtenIds.length);
  assert.equal(writtenIds.includes("product-00000"), false);
});

test("negative control: offset pagination duplicates a row inserted before its next page", () => {
  const rows = Array.from({ length: 1_500 }, (_, index) =>
    `product-${String(index + 1).padStart(5, "0")}`);
  const firstPage = rows.slice(0, 1_000);
  rows.unshift("product-00000");
  const secondPage = rows.slice(1_000, 2_000);
  const traversed = [...firstPage, ...secondPage];

  assert.equal(traversed.length, 1_501);
  assert.equal(new Set(traversed).size, 1_500);
  assert.equal(traversed.filter((id) => id === "product-01000").length, 2);
});

test("writes a 500-product batch with one upsert", async () => {
  const products = Array.from({ length: 500 }, (_, index) => product({
    id: `product-${String(index + 1).padStart(5, "0")}`,
  }));
  const database = new FakeSupabase({ products, observations: [] });

  const result = await runPriceSync(database);
  const upserts = database.calls.filter(
    (call) => call.table === "pb_price_current" && call.operation === "upsert",
  );

  assert.equal(result.status, "completed");
  assert.equal(result.records_checked, 500);
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].payload.length, 500);
});

test("a timed segment resumes after its last committed product without gaps or repeats", async () => {
  const products = Array.from({ length: 1_200 }, (_, index) => product({
    id: `product-${String(index + 1).padStart(5, "0")}`,
  }));
  const database = new FakeSupabase({ products, observations: [] });
  let clock = 0;
  const runtime = { now: () => {
    const value = clock;
    clock += 60;
    return value;
  } };

  const first = await runPriceSync(database, { time_budget_ms: 100 }, runtime);
  assert.equal(first.status, "partial");
  assert.equal(first.resume_after_id, "product-00999");
  assert.equal(first.records_checked, 999);
  assert.equal(first.stale_marked, 0);
  assert.equal(database.staleUpdates, 0);

  clock = 0;
  const second = await runPriceSync(database, {
    time_budget_ms: 1_000,
    resume_after_id: first.resume_after_id,
  }, runtime);
  const writtenIds = database.currentUpserts.map((row) => row.product_id);

  assert.equal(second.status, "completed");
  assert.equal(second.resume_after_id, null);
  assert.equal(second.records_checked, 201);
  assert.equal(
    database.staleUpdates,
    Object.keys(PRICE_STALENESS_DAYS_BY_SOURCE).length + 1,
  );
  assert.equal(writtenIds.length, 1_200);
  assert.equal(new Set(writtenIds).size, 1_200);
  assert.deepEqual(
    writtenIds.toSorted(),
    products.map((row) => row.id).toSorted(),
  );
  assert.deepEqual(database.runUpdates.slice(-2).map((row) => row.status), ["partial", "completed"]);
});

test("paginates dense observation batches and keeps every product's latest row", async () => {
  const products = Array.from({ length: 50 }, (_, index) => product({
    id: `product-${index + 1}`,
  }));
  const denseProductObservations = Array.from({ length: 1_050 }, (_, index) => observation({
    id: `dense-${String(index).padStart(4, "0")}`,
    product_id: "product-1",
    observed_at: "2026-09-30T23:59:59.000Z",
  }));
  const remainingObservations = products.slice(1).flatMap((row, index) => [
    observation({
      id: `latest-${String(index + 2).padStart(2, "0")}`,
      product_id: row.id,
      observed_at: "2026-08-17T12:00:00.000Z",
      observed_price: 100 + index,
    }),
    observation({
      id: `older-${String(index + 2).padStart(2, "0")}`,
      product_id: row.id,
      observed_at: "2026-08-17T11:00:00.000Z",
      observed_price: 1,
    }),
  ]);
  const database = new FakeSupabase({
    products,
    observations: [...denseProductObservations, ...remainingObservations],
  });

  const result = await runPriceSync(database);
  const observationReads = database.calls.filter(
    (call) => call.table === "pb_price_observations",
  );

  assert.equal(result.status, "completed");
  assert.equal(result.records_checked, 50);
  assert.equal(database.currentUpserts.length, 50);
  for (let index = 1; index < products.length; index++) {
    const materialized = database.currentUpserts.find(
      (row) => row.product_id === products[index].id,
    );
    assert.equal(materialized.observation_id, `latest-${String(index + 1).padStart(2, "0")}`);
  }
  assert.ok(observationReads.every((call) => call.range === undefined && call.limit === 1_000));
  assert.equal(observationReads.length, 2);
  assert.equal(observationReads[1].filters.some((filter) => filter.kind === "or"), true);
  assert.match(
    observationReads[1].filters.find((filter) => filter.kind === "or").expression,
    /observed_at\.eq\.2026-09-30T23:59:59\.000Z,id\.gt\.dense-0998/,
  );
  assert.ok(observationReads.every((call) => JSON.stringify(call.orderings) === JSON.stringify([
    { column: "observed_at", ascending: false },
    { column: "id", ascending: true },
  ])));
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

test("staleness windows follow the real dated source scenario", async (t) => {
  assert.deepEqual(PRICE_STALENESS_DAYS_BY_SOURCE, {
    provider_catalog: 400,
    n8n: 30,
    product_base: 30,
  });

  await t.test("a 90-day provider catalogue price stays available", async () => {
    const catalogue = stalePrice({
      id: "catalogue-90-days",
      source_type: "provider_catalog",
      checked_at: "2026-07-06T12:00:00.000Z",
    });
    const globalCutoff = new Date(
      STALENESS_TEST_NOW - 30 * 24 * 60 * 60 * 1_000,
    ).toISOString();

    // Mutation guard: a single global 30-day window would mark this fixture.
    assert.ok(catalogue.checked_at < globalCutoff);

    const { result } = await runStalenessScenario([catalogue]);
    assert.equal(result.status, "completed");
    assert.equal(result.stale_marked, 0);
    assert.equal(catalogue.is_available, true);
  });

  await t.test("a 40-day n8n price becomes unavailable", async () => {
    const n8n = stalePrice({ id: "n8n-40-days", source_type: "n8n" });
    const { result } = await runStalenessScenario([n8n], 90);

    assert.equal(result.stale_marked, 1);
    assert.deepEqual(result.stale_marked_by_source, { n8n: 1 });
    assert.equal(n8n.is_available, false);
  });

  await t.test("a 40-day product base price becomes unavailable", async () => {
    const base = stalePrice({ id: "base-40-days", source_type: "product_base" });
    const { result } = await runStalenessScenario([base], 90);

    assert.equal(result.stale_marked, 1);
    assert.deepEqual(result.stale_marked_by_source, { product_base: 1 });
    assert.equal(base.is_available, false);
  });

  await t.test("an unknown source uses the configured default window", async () => {
    const recent = stalePrice({
      id: "manual-40-days",
      source_type: "manual",
      checked_at: "2026-08-25T12:00:00.000Z",
    });
    const old = stalePrice({
      id: "manual-46-days",
      source_type: "manual",
      checked_at: "2026-08-19T12:00:00.000Z",
    });
    const { result } = await runStalenessScenario([recent, old], 45);

    assert.equal(result.stale_marked, 1);
    assert.deepEqual(result.stale_marked_by_source, { manual: 1 });
    assert.equal(recent.is_available, true);
    assert.equal(old.is_available, false);
  });

  await t.test("the persisted run summary includes the per-source breakdown", async () => {
    const catalogue = stalePrice({
      id: "catalogue-summary",
      source_type: "provider_catalog",
      checked_at: "2026-07-06T12:00:00.000Z",
    });
    const n8n = stalePrice({ id: "n8n-summary", source_type: "n8n" });
    const base = stalePrice({ id: "base-summary", source_type: "product_base" });
    const fallback = stalePrice({
      id: "fallback-summary",
      source_type: "scraper",
      checked_at: "2026-08-19T12:00:00.000Z",
    });
    const { database, result } = await runStalenessScenario(
      [catalogue, n8n, base, fallback],
      45,
    );
    const summary = database.runUpdates.at(-1).summary;

    assert.equal(result.stale_marked, 3);
    assert.deepEqual(summary.stale_marked_by_source, {
      n8n: 1,
      product_base: 1,
      scraper: 1,
    });
    assert.deepEqual(result.stale_marked_by_source, summary.stale_marked_by_source);
    assert.equal(catalogue.is_available, true);
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
