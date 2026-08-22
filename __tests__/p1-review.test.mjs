import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isTraceableCommercialPrice } from "../lib/price-traceability.ts";
import {
  MAX_COMPANY_LOGO_BYTES,
  downloadCompanyLogo,
  isAllowedCompanyLogoUrl,
} from "../lib/company-logo-download.ts";
import { deleteStorageTree } from "../lib/storage-cleanup.ts";
import {
  RETAINED_INVOICE_BUCKET,
  buildConfirmedInvoiceDocument,
  buildLegacyReceivedInvoiceDocument,
  isConfirmedInvoiceDocumentUrl,
  parseConfirmedInvoiceDocumentUrl,
  parseOwnedOcrDraftUrl,
  parseRetainedReceivedInvoiceDocumentUrl,
  retainedInvoiceStorageUrl,
} from "../lib/invoice-ocr-drafts.ts";
import {
  beginAccountWriteLease,
  endAccountWriteLease,
} from "../lib/account-write-lease.ts";
import {
  ACCOUNT_DELETION_CLEANUP_COMPLETE,
  ACCOUNT_DELETION_PHASE_METADATA_KEY,
  FISCALLY_DEFINITIVE_ISSUED_INVOICE_STATUSES,
  isAccountDeletionCleanupComplete,
  isFiscallyDefinitiveIssuedInvoiceStatus,
  markAccountDeletionCleanupComplete,
} from "../lib/account-deletion-retention.ts";
import {
  diffSnapshots,
  normalizeSnapshotItems,
} from "../lib/budget-snapshots.ts";

const SUPABASE_URL = "https://example.supabase.co";
const USER_ID = "123e4567-e89b-12d3-a456-426614174000";
const VALID_LOGO_URL =
  `${SUPABASE_URL}/storage/v1/object/public/company-branding/${USER_ID}/logo.png`;

test("only traceable commercial observations are presented as verified", () => {
  const valid = {
    selectedPrice: 12.5,
    sourceType: "provider_updated",
    sourceUrl: "https://supplier.example/product/1",
    confidenceScore: 0.75,
  };

  assert.equal(isTraceableCommercialPrice(valid), true);
  assert.equal(
    isTraceableCommercialPrice({ ...valid, sourceType: "technical_bank" }),
    false
  );
  assert.equal(isTraceableCommercialPrice({ ...valid, sourceUrl: "" }), false);
  assert.equal(
    isTraceableCommercialPrice({ ...valid, confidenceScore: 0.74 }),
    false
  );
  assert.equal(isTraceableCommercialPrice({ ...valid, selectedPrice: 0 }), false);
});

test("budget generation uses the shared traceability and adoption gates", () => {
  const provider = readFileSync(
    "app/dashboard/budgets/generate/_components/BudgetGenerateProvider.tsx",
    "utf8"
  );
  assert.ok((provider.match(/isTraceableCommercialPrice\(resolved\)/g) || []).length >= 2);
  assert.equal((provider.match(/canAdoptResolvedPrice\(resolved\)/g) || []).length, 2);
});

test("V2 price queries include shared and company-owned providers", () => {
  const route = readFileSync("app/api/prices/resolve/route.ts", "utf8");
  assert.match(
    route,
    /company_id\.is\.null,company_id\.eq\.\$\{companyScopeId\}/
  );
  assert.equal(
    (route.match(/\.or\(visibleProviderFilter, \{ referencedTable: "pb_providers" \}\)/g) || []).length,
    2
  );
  assert.doesNotMatch(route, /\.from\("pb_price_current"\)/);
  assert.doesNotMatch(route, /\.is\("pb_providers\.company_id", null\)/);
});

test("catalogue candidate search limits before semantic ranking without sorting the full bank", () => {
  const route = readFileSync("app/api/prices/resolve/route.ts", "utf8");
  assert.match(route, /trackerTokenGroups\.length; start \+= 4/);
  assert.match(route, /\.or\(tokens\.map/);
  assert.match(route, /\.limit\(300\)/);
  assert.doesNotMatch(route, /\.or\(tokens\.map[\s\S]{0,250}\.order\("checked_at"/);
});

test("service-role price reads derive tenant scope only from the authenticated user", () => {
  const route = readFileSync("app/api/prices/resolve/route.ts", "utf8");
  assert.match(route, /const companyScopeId = user\.id/);
  assert.doesNotMatch(route, /\.from\("profiles"\)[\s\S]{0,120}\.select\("company_id"\)/);
  assert.doesNotMatch(route, /companyScopeId = company_id \|\| user\.id/);
});

test("company logos are restricted to the configured bucket and owner", () => {
  assert.equal(isAllowedCompanyLogoUrl(VALID_LOGO_URL, SUPABASE_URL, USER_ID), true);
  assert.equal(
    isAllowedCompanyLogoUrl(
      `${SUPABASE_URL}/storage/v1/object/public/company-branding/another-user/logo.png`,
      SUPABASE_URL,
      USER_ID
    ),
    false
  );
  assert.equal(
    isAllowedCompanyLogoUrl(
      `https://attacker.example/storage/v1/object/public/company-branding/${USER_ID}/logo.png`,
      SUPABASE_URL,
      USER_ID
    ),
    false
  );
  assert.equal(
    isAllowedCompanyLogoUrl(
      `${SUPABASE_URL}/storage/v1/object/public/other-bucket/${USER_ID}/logo.png`,
      SUPABASE_URL,
      USER_ID
    ),
    false
  );
});

test("logo download disables redirects and enforces response bounds", async () => {
  let redirectMode = null;
  const downloaded = await downloadCompanyLogo({
    rawUrl: VALID_LOGO_URL,
    supabaseUrl: SUPABASE_URL,
    userId: USER_ID,
    fetchImpl: async (_url, init) => {
      redirectMode = init?.redirect;
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          "content-type": "image/png",
          "content-length": "3",
        },
      });
    },
  });

  assert.deepEqual([...downloaded], [1, 2, 3]);
  assert.equal(redirectMode, "manual");

  const oversizedByHeader = await downloadCompanyLogo({
    rawUrl: VALID_LOGO_URL,
    supabaseUrl: SUPABASE_URL,
    userId: USER_ID,
    fetchImpl: async () => new Response(new Uint8Array([1]), {
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-length": String(MAX_COMPANY_LOGO_BYTES + 1),
      },
    }),
  });
  assert.equal(oversizedByHeader, null);

  const oversizedStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(4));
      controller.enqueue(new Uint8Array(4));
      controller.close();
    },
  });
  await assert.rejects(() => downloadCompanyLogo({
    rawUrl: VALID_LOGO_URL,
    supabaseUrl: SUPABASE_URL,
    userId: USER_ID,
    maxBytes: 6,
    fetchImpl: async () => new Response(oversizedStream, {
      status: 200,
      headers: { "content-type": "image/png" },
    }),
  }), /size limit/);
});

test("storage cleanup descends through nested project document folders", async () => {
  const tree = new Map([
    [USER_ID, [
      { id: null, name: "projects", metadata: null },
      { id: "root-file", name: "root.pdf", metadata: {} },
    ]],
    [`${USER_ID}/projects`, [
      { id: null, name: "project-1", metadata: null },
    ]],
    [`${USER_ID}/projects/project-1`, [
      { id: "file-a", name: "a.pdf", metadata: {} },
      { id: "file-b", name: "b.jpg", metadata: {} },
      { id: "file-c", name: "c.png", metadata: {} },
    ]],
  ]);
  const removedBatches = [];
  const bucket = {
    async list(path, { limit, offset }) {
      return {
        data: (tree.get(path) || []).slice(offset, offset + limit),
        error: null,
      };
    },
    async remove(paths) {
      removedBatches.push(paths);
      return { data: [], error: null };
    },
  };

  const removed = await deleteStorageTree(bucket, USER_ID, 2);
  assert.equal(removed, 4);
  assert.deepEqual(removedBatches.flat().sort(), [
    `${USER_ID}/projects/project-1/a.pdf`,
    `${USER_ID}/projects/project-1/b.jpg`,
    `${USER_ID}/projects/project-1/c.png`,
    `${USER_ID}/root.pdf`,
  ].sort());
});

test("storage cleanup can preserve retained legacy invoice objects", async () => {
  const removedPaths = [];
  const bucket = {
    async list() {
      return {
        data: [
          { id: "retained", name: "retained.jpg", metadata: {} },
          { id: "deletable", name: "draft.jpg", metadata: {} },
        ],
        error: null,
      };
    },
    async remove(paths) {
      removedPaths.push(...paths);
      return { data: [], error: null };
    },
  };

  const retained = new Set([`${USER_ID}/retained.jpg`]);
  const removed = await deleteStorageTree(bucket, USER_ID, 100, retained);
  assert.equal(removed, 1);
  assert.deepEqual(removedPaths, [`${USER_ID}/draft.jpg`]);
});

test("account cleanup recursively removes OCR drafts and orphaned confirmed files", async () => {
  const invoiceId = "223e4567-e89b-12d3-a456-426614174000";
  const orphanInvoiceId = "323e4567-e89b-12d3-a456-426614174000";
  const keptPath = `${USER_ID}/confirmed/${invoiceId}/fiscal.jpg`;
  const tree = new Map([
    [USER_ID, [
      { id: null, name: "drafts", metadata: null },
      { id: null, name: "confirmed", metadata: null },
    ]],
    [`${USER_ID}/drafts`, [
      { id: "draft-a", name: "abandoned.jpg", metadata: {} },
      { id: null, name: "nested", metadata: null },
    ]],
    [`${USER_ID}/drafts/nested`, [
      { id: "draft-b", name: "also-abandoned.png", metadata: {} },
    ]],
    [`${USER_ID}/confirmed`, [
      { id: null, name: invoiceId, metadata: null },
      { id: null, name: orphanInvoiceId, metadata: null },
    ]],
    [`${USER_ID}/confirmed/${invoiceId}`, [
      { id: "kept", name: "fiscal.jpg", metadata: {} },
      { id: "stale", name: "stale-copy.jpg", metadata: {} },
    ]],
    [`${USER_ID}/confirmed/${orphanInvoiceId}`, [
      { id: "orphan", name: "orphan.jpg", metadata: {} },
    ]],
  ]);
  const removedPaths = [];
  const bucket = {
    async list(path, { limit, offset }) {
      return {
        data: (tree.get(path) || []).slice(offset, offset + limit),
        error: null,
      };
    },
    async remove(paths) {
      removedPaths.push(...paths);
      return { data: [], error: null };
    },
  };

  const removed = await deleteStorageTree(
    bucket,
    USER_ID,
    2,
    new Set([keptPath])
  );

  assert.equal(removed, 4);
  assert.ok(!removedPaths.includes(keptPath));
  assert.deepEqual(removedPaths.sort(), [
    `${USER_ID}/confirmed/${invoiceId}/stale-copy.jpg`,
    `${USER_ID}/confirmed/${orphanInvoiceId}/orphan.jpg`,
    `${USER_ID}/drafts/abandoned.jpg`,
    `${USER_ID}/drafts/nested/also-abandoned.png`,
  ].sort());
});

test("storage cleanup is safe to retry after a partial OCR deletion", async () => {
  const retainedPath = `${USER_ID}/confirmed/invoice/fiscal.jpg`;
  const livePaths = new Set([
    `${USER_ID}/draft-a.jpg`,
    `${USER_ID}/draft-b.jpg`,
    retainedPath,
  ]);
  let failOnce = true;
  const bucket = {
    async list(path, { limit, offset }) {
      const entries = [...livePaths]
        .filter((item) => item.startsWith(`${path}/`))
        .map((item) => ({ id: item, name: item.slice(path.length + 1), metadata: {} }));
      return { data: entries.slice(offset, offset + limit), error: null };
    },
    async remove(paths) {
      if (failOnce && paths.includes(`${USER_ID}/draft-b.jpg`)) {
        failOnce = false;
        return { data: null, error: { message: "temporary failure" } };
      }
      for (const path of paths) livePaths.delete(path);
      return { data: [], error: null };
    },
  };
  const retained = new Set([retainedPath]);

  await assert.rejects(
    () => deleteStorageTree(bucket, USER_ID, 1, retained),
    /temporary failure/
  );
  assert.equal(await deleteStorageTree(bucket, USER_ID, 1, retained), 1);
  assert.equal(await deleteStorageTree(bucket, USER_ID, 1, retained), 0);
  assert.deepEqual([...livePaths], [retainedPath]);
});

test("corrective SQL preserves the old budget before destructive edits", () => {
  const sql = readFileSync(
    "supabase/migrations/20260804_preserve_budget_before_lifecycle_edit.sql",
    "utf8"
  ).toLowerCase();
  const snapshotInsert = sql.indexOf("insert into public.budget_snapshots");
  const budgetUpdate = sql.indexOf("update public.budgets");
  const itemDelete = sql.indexOf("delete from public.budget_items");

  assert.ok(snapshotInsert >= 0);
  assert.ok(snapshotInsert < budgetUpdate);
  assert.ok(snapshotInsert < itemDelete);
  assert.match(sql, /'budget_data',\s*to_jsonb\(v_budget\)/);
  assert.match(sql, /'name',\s*coalesce\(item_row\.concept, ''\)/);
  assert.match(sql, /'unit_price_sale',\s*coalesce\(item_row\.unit_price, 0\)/);
  assert.match(sql, /'subtotal_sale',\s*coalesce\(item_row\.subtotal, 0\)/);
  assert.doesNotMatch(sql, /jsonb_agg\(to_jsonb\(item_row\)/);
});

test("legacy lifecycle snapshots are normalized to BudgetItemV2", () => {
  const [item] = normalizeSnapshotItems([{
    id: "line-1",
    concept: "Demolición de tabique",
    description: "Retirada y gestión",
    quantity: 2,
    unit: "m2",
    category: "demoliciones",
    unit_price: 45,
    subtotal: 90,
  }]);

  assert.equal(item.name, "Demolición de tabique");
  assert.equal(item.chapter, "demoliciones");
  assert.equal(item.unit_cost, 45);
  assert.equal(item.unit_price_sale, 45);
  assert.equal(item.subtotal_cost, 90);
  assert.equal(item.subtotal_sale, 90);
  assert.equal(item.price_source, "estimated");
  assert.deepEqual(item.materials, []);
});

test("snapshot diff compares legacy rows with BudgetItemV2 rows by name", () => {
  const commonSnapshot = {
    id: "snapshot",
    budget_id: "budget-1",
    user_id: USER_ID,
    snapshot_type: "edited",
    label: null,
    summary_data: {},
    analysis_data: null,
    metadata: {},
    resolver_used: "v1",
    total_items: 1,
    total_cost: 90,
    total_sale: 90,
    avg_confidence: 0,
    created_at: "2026-08-05T00:00:00Z",
  };
  const legacyItem = {
    id: "line-1",
    concept: "Demolición de tabique",
    quantity: 2,
    unit: "m2",
    category: "demoliciones",
    unit_price: 45,
    subtotal: 90,
  };
  const [v2Item] = normalizeSnapshotItems([{
    ...legacyItem,
    concept: undefined,
    name: "Demolición de tabique",
    unit_cost: 50,
    unit_price_sale: 50,
    subtotal_cost: 100,
    subtotal_sale: 100,
  }]);

  const diff = diffSnapshots(
    { ...commonSnapshot, version: 1, items_data: [legacyItem] },
    {
      ...commonSnapshot,
      version: 2,
      total_cost: 100,
      total_sale: 100,
      items_data: [v2Item],
    }
  );

  assert.equal(diff.items_added, 0);
  assert.equal(diff.items_removed, 0);
  assert.equal(diff.items_modified, 1);
  assert.equal(diff.diffs[0].name, "Demolición de tabique");
  assert.ok(diff.diffs[0].changes.some(({ field }) => field === "unit_price_sale"));
});

test("retained invoice storage is private and account cleanup uses an exact allow-list", () => {
  const migration = readFileSync(
    "supabase/migrations/20260804_retained_received_invoice_documents.sql",
    "utf8"
  );
  const accountDeletion = readFileSync("app/api/account/delete/route.ts", "utf8");
  const ocrRoute = readFileSync("app/api/invoices/ocr/route.ts", "utf8");

  assert.match(migration, /'received-invoice-documents'[\s\S]*?false/);
  assert.doesNotMatch(
    accountDeletion.match(/const STORAGE_BUCKETS = \[[^\]]+\]/)?.[0] || "",
    /received-invoice-documents/
  );
  assert.match(accountDeletion, /admin\.storage\.from\(RETAINED_INVOICE_BUCKET\)/);
  assert.match(
    accountDeletion,
    /deleteStorageTree\([\s\S]*?RETAINED_INVOICE_BUCKET[\s\S]*?retainedReceivedInvoicePaths/
  );
  assert.ok(
    accountDeletion.indexOf("retainedReceivedInvoicePaths") <
      accountDeletion.indexOf("admin.auth.admin.deleteUser(userId)")
  );
  assert.match(accountDeletion, /"project-docs"/);
  assert.equal(RETAINED_INVOICE_BUCKET, "received-invoice-documents");
  assert.match(ocrRoute, /storageBucket = extractOnly \? RETAINED_INVOICE_BUCKET : "invoices"/);
});

test("fiscal retention remains discoverable across account-deletion retries", () => {
  const accountDeletion = readFileSync("app/api/account/delete/route.ts", "utf8");
  assert.match(
    accountDeletion,
    /user_id\.eq\.\$\{userId\},deleted_by\.eq\.\$\{userId\}/
  );
  assert.ok((accountDeletion.match(/deleted_by: userId/g) || []).length >= 2);
  assert.ok((accountDeletion.match(/\.or\(retryableOwnerFilter\)/g) || []).length >= 2);
});

test("account deletion removes issued drafts and retains only definitive statuses", () => {
  assert.equal(isFiscallyDefinitiveIssuedInvoiceStatus("draft"), false);
  assert.equal(isFiscallyDefinitiveIssuedInvoiceStatus(null), false);
  assert.equal(isFiscallyDefinitiveIssuedInvoiceStatus("unknown"), false);
  for (const status of FISCALLY_DEFINITIVE_ISSUED_INVOICE_STATUSES) {
    assert.equal(isFiscallyDefinitiveIssuedInvoiceStatus(status), true);
  }

  const accountDeletion = readFileSync("app/api/account/delete/route.ts", "utf8");
  assert.match(
    accountDeletion,
    /filter\(\(row\) => !isFiscallyDefinitiveIssuedInvoiceStatus\(row\.status\)\)/
  );
  const lineDelete = accountDeletion.indexOf(
    '"issued_invoice_lines",\n      "invoice_id",\n      draftIssuedIds'
  );
  const eventDelete = accountDeletion.indexOf(
    '"fiscal_events",\n      "invoice_id",\n      draftIssuedIds'
  );
  const draftDelete = accountDeletion.indexOf(
    'deleteByIn(admin, "issued_invoices", "id", draftIssuedIds, errors)'
  );
  assert.ok(lineDelete >= 0);
  assert.ok(eventDelete > lineDelete);
  assert.ok(draftDelete > eventDelete);
  assert.match(
    accountDeletion,
    /query = query\.in\("status", \[\.\.\.statuses\]\)/
  );
});

test("OCR draft URLs cannot escape their authenticated owner or draft prefix", () => {
  const fileName = "1700000000-123e4567-e89b-12d3-a456-426614174000-invoice.jpg";
  const draftUrl = retainedInvoiceStorageUrl(`${USER_ID}/drafts/${fileName}`);
  assert.deepEqual(parseOwnedOcrDraftUrl(draftUrl, USER_ID), {
    objectPath: `${USER_ID}/drafts/${fileName}`,
    fileName,
  });
  assert.equal(
    parseOwnedOcrDraftUrl(
      retainedInvoiceStorageUrl(`another-user/drafts/${fileName}`),
      USER_ID
    ),
    null
  );
  assert.equal(
    parseOwnedOcrDraftUrl(
      retainedInvoiceStorageUrl(`${USER_ID}/drafts/../confirmed/file.jpg`),
      USER_ID
    ),
    null
  );
  assert.equal(
    parseOwnedOcrDraftUrl(
      retainedInvoiceStorageUrl(`${USER_ID}/confirmed/${USER_ID}/${fileName}`),
      USER_ID
    ),
    null
  );
});

test("confirmed OCR paths are deterministic and tied to the invoice", () => {
  const fileName = "1700000000-123e4567-e89b-12d3-a456-426614174000-invoice.jpg";
  const confirmed = buildConfirmedInvoiceDocument(USER_ID, USER_ID, fileName);
  assert.deepEqual(confirmed, {
    objectPath: `${USER_ID}/confirmed/${USER_ID}/${fileName}`,
    storageUrl: retainedInvoiceStorageUrl(
      `${USER_ID}/confirmed/${USER_ID}/${fileName}`
    ),
  });
  assert.equal(
    isConfirmedInvoiceDocumentUrl(confirmed?.storageUrl, USER_ID, USER_ID),
    true
  );
  assert.equal(
    isConfirmedInvoiceDocumentUrl(confirmed?.storageUrl, "another-user", USER_ID),
    false
  );
  assert.deepEqual(
    parseConfirmedInvoiceDocumentUrl(confirmed?.storageUrl, USER_ID, USER_ID),
    { objectPath: confirmed.objectPath, fileName }
  );
  assert.equal(
    parseConfirmedInvoiceDocumentUrl(
      retainedInvoiceStorageUrl(`${USER_ID}/drafts/${fileName}`),
      USER_ID,
      USER_ID
    ),
    null
  );
});

test("stable received-invoice references preserve either side of OCR promotion", async () => {
  const invoiceId = "223e4567-e89b-12d3-a456-426614174000";
  const fileName = "1700000000-123e4567-e89b-12d3-a456-426614174000-invoice.jpg";
  const draftUrl = retainedInvoiceStorageUrl(`${USER_ID}/drafts/${fileName}`);
  const confirmed = buildConfirmedInvoiceDocument(USER_ID, invoiceId, fileName);

  assert.equal(
    parseRetainedReceivedInvoiceDocumentUrl(draftUrl, USER_ID, invoiceId)?.objectPath,
    `${USER_ID}/drafts/${fileName}`
  );
  assert.equal(
    parseRetainedReceivedInvoiceDocumentUrl(
      confirmed?.storageUrl,
      USER_ID,
      invoiceId
    )?.objectPath,
    confirmed?.objectPath
  );

  for (const stablePath of [
    `${USER_ID}/drafts/${fileName}`,
    confirmed.objectPath,
  ]) {
    const livePaths = new Set([
      `${USER_ID}/drafts/${fileName}`,
      confirmed.objectPath,
    ]);
    const bucket = {
      async list(path) {
        return {
          data: [...livePaths]
            .filter((item) => item.startsWith(`${path}/`))
            .map((item) => ({
              id: item,
              name: item.slice(path.length + 1),
              metadata: {},
            })),
          error: null,
        };
      },
      async remove(paths) {
        for (const path of paths) livePaths.delete(path);
        return { data: [], error: null };
      },
    };

    await deleteStorageTree(bucket, USER_ID, 100, new Set([stablePath]));
    assert.deepEqual([...livePaths], [stablePath]);
  }

  const accountDeletion = readFileSync("app/api/account/delete/route.ts", "utf8");
  const fence = accountDeletion.indexOf("const fiscalUpdates = [");
  const stableRead = accountDeletion.indexOf(
    '// Stable read: after the update above'
  );
  const pathCollection = accountDeletion.indexOf(
    "parseRetainedReceivedInvoiceDocumentUrl("
  );
  assert.ok(fence >= 0);
  assert.ok(stableRead > fence);
  assert.ok(pathCollection > stableRead);
});

test("deleted_by cleanup is checkpointed, precedes Auth deletion, and is retryable", () => {
  const originalMetadata = { role: "member" };
  const checkpointed = markAccountDeletionCleanupComplete(originalMetadata);
  assert.equal(checkpointed.role, "member");
  assert.equal(
    checkpointed[ACCOUNT_DELETION_PHASE_METADATA_KEY],
    ACCOUNT_DELETION_CLEANUP_COMPLETE
  );
  assert.equal(isAccountDeletionCleanupComplete(originalMetadata), false);
  assert.equal(isAccountDeletionCleanupComplete(checkpointed), true);

  const accountDeletion = readFileSync("app/api/account/delete/route.ts", "utf8");
  const checkpoint = accountDeletion.indexOf(
    "admin.auth.admin.updateUserById("
  );
  const markerCleanup = accountDeletion.indexOf(
    "clearFiscalRetryMarkers(admin, userId)",
    checkpoint
  );
  const authDelete = accountDeletion.indexOf(
    "admin.auth.admin.deleteUser(userId)",
    markerCleanup
  );
  assert.ok(checkpoint >= 0);
  assert.ok(markerCleanup > checkpoint);
  assert.ok(authDelete > markerCleanup);

  const retryBranchStart = accountDeletion.indexOf(
    "if (isAccountDeletionCleanupComplete(user.app_metadata))"
  );
  const retryBranchEnd = accountDeletion.indexOf(
    "return NextResponse.json({ ok: true, resumed: true });",
    retryBranchStart
  );
  const retryBranch = accountDeletion.slice(retryBranchStart, retryBranchEnd);
  assert.match(retryBranch, /clearFiscalRetryMarkers\(admin, userId\)/);
  assert.match(retryBranch, /admin\.auth\.admin\.deleteUser\(userId\)/);
  // The write lock (hallazgo 2) closes most of the race window, but a write
  // already in flight when the lock landed can still slip through. The
  // retry branch now re-runs anonymizeRetainedRows and deleteStorageFiles
  // too — both are designed to be safely repeated — instead of trusting the
  // first pass caught everything and never touching Storage again.
  assert.match(retryBranch, /deleteStorageFiles\(/);
});

test("checkpoint retry re-runs anonymization, ownership cleanup and Storage, in order, before clearing markers or Auth", () => {
  const accountDeletion = readFileSync("app/api/account/delete/route.ts", "utf8");
  const retryBranchStart = accountDeletion.indexOf(
    "if (isAccountDeletionCleanupComplete(user.app_metadata))"
  );
  const retryBranchEnd = accountDeletion.indexOf(
    "return NextResponse.json({ ok: true, resumed: true });",
    retryBranchStart
  );
  const retryBranch = accountDeletion.slice(retryBranchStart, retryBranchEnd);

  // Re-runs anonymizeRetainedRows (idempotent by its own design — see its
  // doc comment), re-collects parent ids and repeats every ownership
  // cleanup step from the main flow, so a row inserted after the first pass
  // (e.g. by another authenticated tab, or a write that landed the instant
  // the write lock was inserted) is still cleaned up instead of blocking
  // deleteUser forever once the checkpoint is set.
  assert.match(retryBranch, /await anonymizeRetainedRows\(admin, userId, retryErrors\)/);
  assert.match(
    retryBranch,
    /retryParentIds\[table\] = await collectIds\(admin, table, "user_id", userId\)/
  );
  assert.match(
    retryBranch,
    /for \(const \{ table, column, parent \} of CHILD_TABLES\)/
  );
  assert.match(retryBranch, /for \(const \{ table, column \} of OWNED_TABLES\)/);
  assert.match(retryBranch, /deletePrivatePriceBank\(admin, userId, retryErrors\)/);
  assert.match(retryBranch, /clearAuthorReferences\(admin, userId, retryErrors\)/);
  assert.match(retryBranch, /deleteN8nUpdatesForUser\(admin, userId, retryErrors\)/);
  assert.match(retryBranch, /deleteStorageFiles\(/);

  // Ordering, matching the main flow's FK-safe sequence: anonymize → owned
  // tables/private price bank/author refs/n8n_updates → Storage → fiscal
  // markers → Auth. Each phase must succeed before the next runs.
  const anonymize = retryBranch.indexOf("await anonymizeRetainedRows(admin, userId, retryErrors)");
  const ownershipCleanup = retryBranch.indexOf("deletePrivatePriceBank(admin, userId, retryErrors)");
  const storageCleanup = retryBranch.indexOf("await deleteStorageFiles(");
  const markerCleanup = retryBranch.indexOf("clearFiscalRetryMarkers(admin, userId)");
  const authDelete = retryBranch.indexOf("admin.auth.admin.deleteUser(userId)");
  assert.ok(anonymize >= 0);
  assert.ok(ownershipCleanup > anonymize);
  assert.ok(storageCleanup > ownershipCleanup);
  assert.ok(markerCleanup > storageCleanup);
  assert.ok(authDelete > markerCleanup);
});

test("OCR draft promotion and deletion preserve referenced fiscal documents", () => {
  const route = readFileSync("app/api/invoices/ocr/route.ts", "utf8");
  const page = readFileSync("app/dashboard/suppliers/invoices/page.tsx", "utf8");

  assert.match(route, /\$\{userId\}\/drafts\/\$\{objectName\}/);
  assert.match(
    route,
    /\.eq\("id", invoiceId\)\s*\.eq\("user_id", user\.id\)/
  );
  assert.match(
    route,
    /\.copy\(draft\.objectPath, confirmed\.objectPath\)[\s\S]*?\.update\(\{ document_url: confirmed\.storageUrl \}\)[\s\S]*?\.remove\(\[draft\.objectPath\]\)/
  );
  assert.match(
    route,
    /select\("id", \{ count: "exact", head: true \}\)[\s\S]*?\.eq\("document_url", rawDraftUrl as string\)[\s\S]*?if \(\(count \?\? 0\) > 0\)/
  );
  assert.match(page, /method: "DELETE"/);
  assert.match(page, /method: "PATCH"/);
  assert.match(page, /setPendingInvoiceId\(invoiceId\)/);
});

test("OCR draft deletion requires this exact draft to have produced the confirmed URL", () => {
  const route = readFileSync("app/api/invoices/ocr/route.ts", "utf8");
  assert.doesNotMatch(route, /isConfirmedInvoiceDocumentUrl/);

  const draftDeleteStart = route.indexOf(
    "if (invoice.document_url === confirmed.storageUrl) {"
  );
  assert.ok(draftDeleteStart >= 0);
  const mismatchGuard = route.indexOf(
    "if (invoice.document_url !== draftUrl) {",
    draftDeleteStart
  );
  assert.ok(mismatchGuard > draftDeleteStart);
  assert.ok(
    route.indexOf(".remove([draft.objectPath])", draftDeleteStart) < mismatchGuard
  );

  // A stale/malformed PATCH pairing confirmed invoice A with an unrelated
  // owned draft B must not delete B: the confirmed document this draft would
  // have produced and A's actual confirmed document are different objects,
  // even though both are "some confirmed URL" for the same invoice.
  const invoiceId = "223e4567-e89b-12d3-a456-426614174000";
  const thisDraftFileName = "1700000000-223e4567-e89b-12d3-a456-426614174000-a.jpg";
  const actualDocumentFileName = "1700000000-323e4567-e89b-12d3-a456-426614174000-b.jpg";

  const confirmedForThisDraft = buildConfirmedInvoiceDocument(
    USER_ID,
    invoiceId,
    thisDraftFileName
  );
  const actualConfirmedDocument = buildConfirmedInvoiceDocument(
    USER_ID,
    invoiceId,
    actualDocumentFileName
  );

  // The old, vulnerable check would have accepted this pairing...
  assert.equal(
    isConfirmedInvoiceDocumentUrl(actualConfirmedDocument.storageUrl, USER_ID, invoiceId),
    true
  );
  // ...but the exact match the fix requires correctly rejects it.
  assert.notEqual(
    confirmedForThisDraft.storageUrl,
    actualConfirmedDocument.storageUrl
  );
});

test("resubmitting a pending OCR-promotion retry persists form corrections", () => {
  const page = readFileSync("app/dashboard/suppliers/invoices/page.tsx", "utf8");

  // The retry-persist path now goes through a single atomic RPC instead of
  // the removed updateReceivedInvoice() + best-effort reconcile pair.
  assert.doesNotMatch(
    page,
    /import \{[\s\S]*?updateReceivedInvoice[\s\S]*?\} from "@\/lib\/suppliers"/
  );

  const createBranchStart = page.indexOf("if (!invoiceId) {");
  assert.ok(createBranchStart >= 0);
  const elseBranchStart = page.indexOf("} else {", createBranchStart);
  assert.ok(elseBranchStart > createBranchStart);
  const promoteCall = page.indexOf(
    "await promoteOcrDraft(form.document_url, invoiceId)"
  );
  assert.ok(promoteCall > elseBranchStart);

  const elseBranch = page.slice(elseBranchStart, promoteCall);
  assert.match(elseBranch, /supabase\.rpc\("update_received_invoice_and_reconcile", \{/);
  assert.match(elseBranch, /if \(error\) \{/);
  // document_url is only ever written server-side (creation, then OCR
  // promotion) — this retry path must not overwrite it from client state.
  assert.doesNotMatch(elseBranch, /document_url:/);
});

test("lifecycle snapshot stores the pre-tax subtotal as total_sale, not the VAT-inclusive total", () => {
  const sql = readFileSync(
    "supabase/migrations/20260804_preserve_budget_before_lifecycle_edit.sql",
    "utf8"
  );

  const valuesStart = sql.indexOf("jsonb_array_length(v_previous_items),");
  assert.ok(valuesStart >= 0);
  const insertClose = sql.indexOf(");", valuesStart);
  assert.ok(insertClose > valuesStart);
  const totalsClause = sql.slice(valuesStart, insertClose);

  // total_items, total_cost, total_sale — the last two must both be the
  // pre-tax subtotal budget_items sums to, matching item-level subtotal_sale
  // above and the budgets.subtotal column comment ("before VAT"). Storing
  // the VAT-inclusive total here made diffSnapshots report a spurious sale
  // delta whenever iva_percent was nonzero.
  const totalsValues = totalsClause
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  assert.match(totalsValues, /coalesce\(v_budget\.subtotal, 0\),\s*coalesce\(v_budget\.subtotal, 0\)/);
  assert.doesNotMatch(totalsValues, /v_budget\.total\b/);

  // The unrelated summary_data.total field (VAT-inclusive, for historical
  // fidelity) must be untouched.
  assert.match(sql, /'total',\s*v_budget\.total/);
});

test("test:p1 runs with a Node 20-compatible TypeScript loader", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.match(pkg.scripts["test:p1"], /--import tsx --test/);
  assert.ok(
    pkg.devDependencies.tsx,
    "tsx must be a devDependency so `--import tsx` resolves on a clean install"
  );
});

// ─── hallazgo 2 (write-lock / leases) ──────────────────────────────────────

test("beginAccountWriteLease/endAccountWriteLease call the expected RPCs and release exactly once", async () => {
  const calls = [];
  const admin = {
    rpc: async (fn, args) => {
      calls.push([fn, args]);
      if (fn === "begin_account_write_lease") return { data: "lease-123", error: null };
      if (fn === "end_account_write_lease") return { data: null, error: null };
      throw new Error(`unexpected rpc ${fn}`);
    },
  };

  const leaseId = await beginAccountWriteLease(admin, "user-1", 180);
  assert.equal(leaseId, "lease-123");
  assert.deepEqual(calls[0], [
    "begin_account_write_lease",
    { p_user_id: "user-1", p_ttl_seconds: 180 },
  ]);

  await endAccountWriteLease(admin, leaseId);
  assert.deepEqual(calls[1], ["end_account_write_lease", { p_lease_id: "lease-123" }]);
});

test("beginAccountWriteLease throws when the account is locked; endAccountWriteLease never throws", async () => {
  const admin = {
    rpc: async (fn) => {
      if (fn === "begin_account_write_lease") {
        return { data: null, error: { message: "La cuenta está en proceso de eliminación." } };
      }
      return { data: null, error: { message: "boom" } };
    },
  };

  await assert.rejects(() => beginAccountWriteLease(admin, "user-1"), /proceso de eliminación/);
  await assert.doesNotReject(() => endAccountWriteLease(admin, "lease-x"));
});

test("legacy received-invoice documents get a deterministic private destination", () => {
  const invoiceId = "223e4567-e89b-12d3-a456-426614174000";
  const built = buildLegacyReceivedInvoiceDocument(USER_ID, invoiceId, "factura.pdf");
  assert.deepEqual(built, {
    objectPath: `${USER_ID}/legacy/${invoiceId}/factura.pdf`,
    storageUrl: retainedInvoiceStorageUrl(`${USER_ID}/legacy/${invoiceId}/factura.pdf`),
  });
  assert.equal(buildLegacyReceivedInvoiceDocument(USER_ID, "not-a-uuid", "factura.pdf"), null);
});

test("legacy public-bucket invoices are migrated (download+upload+compare-and-set), never deleted from the source before confirmation", () => {
  const accountDeletion = readFileSync("app/api/account/delete/route.ts", "utf8");
  assert.match(accountDeletion, /async function migrateLegacyReceivedInvoiceDocument\(/);
  const fnBody = accountDeletion.slice(
    accountDeletion.indexOf("async function migrateLegacyReceivedInvoiceDocument("),
    accountDeletion.indexOf("async function anonymizeRetainedRows(")
  );
  assert.doesNotMatch(fnBody, /\.remove\(/);
  assert.match(fnBody, /\.storage\s*\n?\s*\.from\("invoices"\)\s*\n?\s*\.download\(legacyObjectPath\)/);
  assert.match(fnBody, /\.upload\(target\.objectPath, downloaded, \{ upsert: false \}\)/);
  assert.match(
    fnBody,
    /\.update\(\{ document_url: target\.storageUrl \}\)[\s\S]*?\.eq\("id", invoiceId\)[\s\S]*?\.eq\("document_url", currentDocumentUrl\)/
  );
});

test("account deletion locks the account via RPC before any destructive step, and aborts with 409 if leases are still active", () => {
  const accountDeletion = readFileSync("app/api/account/delete/route.ts", "utf8");
  const lockCall = accountDeletion.indexOf('admin.rpc("lock_account_for_deletion"');
  const checkpointBranch = accountDeletion.indexOf(
    "isAccountDeletionCleanupComplete(user.app_metadata)"
  );
  assert.ok(lockCall >= 0);
  assert.ok(lockCall < checkpointBranch);
  assert.match(accountDeletion, /lockResult\.activeLeases > 0/);
  assert.match(accountDeletion, /status: 409/);
  assert.doesNotMatch(accountDeletion, /getSession\(\)/);
});

test("n8n_updates rows for the deleting user are removed in both the main flow and the retry branch", () => {
  const accountDeletion = readFileSync("app/api/account/delete/route.ts", "utf8");
  assert.match(
    accountDeletion,
    /\.from\("n8n_updates"\)\s*\n?\s*\.delete\(\)\s*\n?\s*\.eq\("data->>requested_by", userId\)/
  );
  assert.equal(
    (accountDeletion.match(/deleteN8nUpdatesForUser\(admin, userId, (errors|retryErrors)\)/g) || [])
      .length,
    2
  );
});

test("agent_connections is aligned with idempotent ADD COLUMN IF NOT EXISTS", () => {
  const sql = readFileSync("supabase/migrations/20260806_01_align_agent_connections.sql", "utf8");
  for (const col of ["connected", "credentials_ref", "error_message", "last_sync_at", "config"]) {
    assert.match(sql, new RegExp(`add column if not exists ${col}\\b`));
  }
});

test("permissive price-bank service-role policies are dropped and recreated scoped to service_role", () => {
  const sql = readFileSync(
    "supabase/migrations/20260806_02_fix_price_bank_service_role_policies.sql",
    "utf8"
  );
  const tables = [
    "pb_providers",
    "pb_price_sources",
    "pb_products",
    "pb_price_observations",
    "pb_price_current",
    "pb_sync_runs",
  ];
  for (const t of tables) {
    assert.match(sql, new RegExp(`drop policy if exists "Service role full access" on public\\.${t};`));
    assert.match(
      sql,
      new RegExp(`create policy "Service role full access" on public\\.${t}\\s*\\n\\s*for all to service_role`)
    );
  }
});

test("write-lock migration: universal trigger excludes extension-owned and internal tables, and verifies coverage", () => {
  const sql = readFileSync(
    "supabase/migrations/20260806_03_account_deletion_write_lock.sql",
    "utf8"
  );
  assert.equal(
    (sql.match(/c\.relname not in \('account_deletion_locks', 'account_write_leases'\)/g) || [])
      .length,
    2
  );
  assert.match(sql, /d\.deptype = 'e'/);
  assert.match(sql, /tabla\(s\) mutable\(s\) sin trigger/);
});

test("write-lock migration: trigger returns explicit OLD/NEW per tg_op, no COALESCE(NEW, OLD), and is itself revoked from all roles", () => {
  const sql = readFileSync(
    "supabase/migrations/20260806_03_account_deletion_write_lock.sql",
    "utf8"
  );
  const fn = sql.slice(
    sql.indexOf("create or replace function public.reject_writes_during_account_deletion()"),
    sql.indexOf('revoke all on function public.reject_writes_during_account_deletion()')
  );
  assert.match(fn, /if tg_op = 'DELETE' then return old; end if;/);
  assert.doesNotMatch(fn, /coalesce\(new, old\)/i);
  assert.match(
    sql,
    /revoke all on function public\.reject_writes_during_account_deletion\(\) from public, anon, authenticated;/
  );
});

test("write-lock migration: Storage policies are RESTRICTIVE, idempotent (DROP POLICY IF EXISTS), and every user bucket is confirmed to exist", () => {
  const sql = readFileSync(
    "supabase/migrations/20260806_03_account_deletion_write_lock.sql",
    "utf8"
  );
  for (const policy of [
    "account_deletion_lock_blocks_storage_insert",
    "account_deletion_lock_blocks_storage_update",
    "account_deletion_lock_blocks_storage_delete",
  ]) {
    assert.match(sql, new RegExp(`drop policy if exists ${policy} on storage\\.objects;`));
    assert.match(sql, new RegExp(`create policy ${policy}\\s*\\n\\s*on storage\\.objects as restrictive`));
  }
  for (const bucket of ["invoices", "company-branding", "project-docs", "received-invoice-documents"]) {
    assert.match(sql, new RegExp(`'${bucket}'`));
  }
  assert.match(sql, /bucket\(s\) esperado\(s\) no encontrado\(s\)/);
});

test("write-lock migration: lease TTL is validated and bounded, default matches 180s", () => {
  const sql = readFileSync(
    "supabase/migrations/20260806_03_account_deletion_write_lock.sql",
    "utf8"
  );
  assert.match(sql, /p_ttl_seconds is null or p_ttl_seconds <= 0 or p_ttl_seconds > 900/);
  assert.match(sql, /p_ttl_seconds integer default 180/);
});

test("write-lock migration: n8n RPCs force requested_by server-side, re-check ownership after the advisory lock, and never write orphaned rows", () => {
  const sql = readFileSync(
    "supabase/migrations/20260806_03_account_deletion_write_lock.sql",
    "utf8"
  );
  assert.match(sql, /jsonb_build_object\('requested_by', p_requested_by::text\)/);
  const writeFn = sql.slice(
    sql.indexOf("create or replace function public.write_n8n_update_locked"),
    sql.indexOf("revoke all on function public.write_n8n_update_locked")
  );
  assert.match(writeFn, /if v_owner is null then\s*\n\s*return null;/);
  assert.match(writeFn, /for update/i);
  assert.match(writeFn, /v_owner_after_lock is null or v_owner_after_lock <> v_owner/);
  assert.match(writeFn, /jsonb_build_object\('requested_by', v_owner::text\)/);
});

test("write-lock migration: mark_signature_signed_locked revokes the public token atomically with signing, and requires the OTP to match/be unused/unexpired/within attempts in one UPDATE", () => {
  const sql = readFileSync(
    "supabase/migrations/20260806_03_account_deletion_write_lock.sql",
    "utf8"
  );
  const fn = sql.slice(
    sql.indexOf("create or replace function public.mark_signature_signed_locked"),
    sql.indexOf("create or replace function public.save_signature_image_locked")
  );
  assert.match(
    fn,
    /update public\.signature_otps[\s\S]*?where id = p_otp_id[\s\S]*?and signature_id = p_signature_id[\s\S]*?and used = false[\s\S]*?and expires_at >= v_now[\s\S]*?and attempts <= 5/
  );
  assert.match(fn, /public_token_hash = null/);
  assert.match(fn, /where id = p_signature_id\s*\n\s*and status = 'pending'/);
  assert.match(fn, /already_signed/);
});

test("write-lock migration: internal RPCs are revoked from public/anon/authenticated and granted only to service_role", () => {
  const sql = readFileSync(
    "supabase/migrations/20260806_03_account_deletion_write_lock.sql",
    "utf8"
  );
  for (const fn of [
    "begin_account_write_lease\\(uuid, integer\\)",
    "end_account_write_lease\\(uuid\\)",
    "lock_account_for_deletion\\(uuid\\)",
    "create_n8n_update_locked\\(text, text, text, uuid, jsonb\\)",
    "write_n8n_update_locked\\(uuid, text, text, jsonb, timestamptz\\)",
  ]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn} from public, anon, authenticated;`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn} to service_role;`));
  }
  assert.doesNotMatch(sql, /grant execute on function public\.begin_account_write_lease[^;]*to authenticated/);
});

test("write-lock migration: every advisory lock uses hashtextextended, not hashtext", () => {
  const sql = readFileSync(
    "supabase/migrations/20260806_03_account_deletion_write_lock.sql",
    "utf8"
  );
  assert.ok((sql.match(/pg_advisory_xact_lock\(hashtextextended\(/g) || []).length >= 6);
  assert.doesNotMatch(sql, /pg_advisory_xact_lock\(hashtext\(/);
});

test("reconcile_supplier_invoiced adjusts both suppliers atomically and checks ownership via auth.uid()", () => {
  const sql = readFileSync(
    "supabase/migrations/20260806_04_reconcile_supplier_invoiced.sql",
    "utf8"
  );
  assert.match(sql, /create or replace function public\.reconcile_supplier_invoiced\(/);
  assert.match(sql, /and user_id = auth\.uid\(\)/);
  assert.match(sql, /greatest\(\s*\n?\s*0,/);
  assert.match(
    sql,
    /grant execute on function public\.reconcile_supplier_invoiced\([^)]*\)\s*\n\s*to authenticated;/
  );
});

test("OCR route protects every service_role Storage call with a write lease and sets maxDuration", () => {
  const route = readFileSync("app/api/invoices/ocr/route.ts", "utf8");
  assert.match(route, /export const maxDuration = 60;/);
  assert.equal((route.match(/beginAccountWriteLease\(supabaseService,/g) || []).length, 3);
  assert.equal((route.match(/endAccountWriteLease\(supabaseService,/g) || []).length, 3);
  assert.match(route, /deleteLeaseId = await beginAccountWriteLease\(supabaseService, user\.id, 180\)/);
});

test("agent/ingest, agent/config and agent/news wrap their writes in a lease", () => {
  for (const [file, ttl] of [
    ["app/api/agent/ingest/route.ts", 180],
    ["app/api/agent/config/route.ts", 90],
    ["app/api/agent/news/route.ts", 90],
  ]) {
    const route = readFileSync(file, "utf8");
    assert.match(route, /beginAccountWriteLease\(/);
    assert.match(route, /endAccountWriteLease\(/);
    assert.match(route, new RegExp(`, ${ttl}\\)`));
  }
});

test("pb/webhook only acquires a lease for company-scoped payloads", () => {
  const route = readFileSync("app/api/pb/webhook/route.ts", "utf8");
  assert.match(
    route,
    /if \(companyId\) \{\s*\n\s*leaseId = await beginAccountWriteLease\(supabase, companyId, 180\);/
  );
  assert.match(route, /if \(leaseId\) await endAccountWriteLease\(supabase, leaseId\);/);
});

test("prices/import writes with the authenticated session client into a private, company-scoped provider, with no explicit any", () => {
  const route = readFileSync("app/api/prices/import/route.ts", "utf8");
  assert.doesNotMatch(route, /supabaseAdmin/);
  assert.match(route, /\.eq\("company_id", user\.id\)/);
  assert.match(route, /company_id: user\.id,/);
  assert.doesNotMatch(route, /is\("company_id", null\)/);
  assert.doesNotMatch(route, /:\s*any\b/);
});

test("weekly-report/send and process-alerts lease each user and release in finally", () => {
  const ttlByFile = {
    // Bumped above maxDuration (300s) with margin: the untimed Resend fetch
    // for each user runs before the lease is released, so the TTL must
    // safely outlast the whole route's time budget, not just be "usually
    // enough".
    "app/api/prices/weekly-report/send/route.ts": 320,
    "app/api/prices/process-alerts/route.ts": 180,
  };
  for (const [file, ttl] of Object.entries(ttlByFile)) {
    const route = readFileSync(file, "utf8");
    assert.match(route, /export const maxDuration = 300;/);
    assert.match(route, new RegExp(`beginAccountWriteLease\\(supabase, userId, ${ttl}\\)`));
    assert.match(route, /\}\s*finally\s*\{\s*\n\s*await endAccountWriteLease\(supabase, leaseId\);/);
  }
});

test("process-alerts groups notifications, alert records and price_alerts updates by user before writing", () => {
  const route = readFileSync("app/api/prices/process-alerts/route.ts", "utf8");
  assert.match(route, /const perUser = new Map</);
  assert.match(route, /for \(const \[userId, bucket\] of perUser\)/);
});

test("signatures/create requires an authenticated session and ignores any client-supplied user_id", () => {
  const route = readFileSync("app/api/signatures/create/route.ts", "utf8");
  assert.match(route, /createSessionClient/);
  assert.match(route, /supabase\.auth\.getUser\(\)/);
  assert.match(route, /p_user_id: user\.id/);
  assert.doesNotMatch(route, /const \{[^}]*\buser_id\b[^}]*\} = body/);
});

test("send-otp trusts only the signer_email resolved from the token, never the request body, and requires a pending signature", () => {
  const route = readFileSync("app/api/signatures/send-otp/route.ts", "utf8");
  assert.doesNotMatch(route, /body\.email/);
  assert.doesNotMatch(route, /sanitizeEmail/);
  assert.match(route, /select\("id, signer_name, signer_email, entity_type, status"\)/);
  assert.match(route, /const email = sig\.signer_email;/);
  assert.match(route, /sig\.status !== "pending"/);
});

test("verify-otp and public signature POST reject anything but a pending signature", () => {
  const verify = readFileSync("app/api/signatures/verify-otp/route.ts", "utf8");
  const pub = readFileSync("app/api/signatures/public/route.ts", "utf8");
  assert.match(verify, /sig\.status !== "pending"/);
  assert.match(pub, /sig\.status !== "pending"/);
});

test("auth/google/callback upserts the connection via the atomic RPC, not a direct insert/update", () => {
  const route = readFileSync("app/api/auth/google/callback/route.ts", "utf8");
  assert.match(route, /\.rpc\("upsert_agent_connection_locked"/);
  assert.doesNotMatch(route, /\.from\("agent_connections"\)\s*\n?\s*\.update\(payload\)/);
  assert.doesNotMatch(route, /\.from\("agent_connections"\)\s*\n?\s*\.insert\(payload\)/);
});

test("commercial prices require strict traceability before replacing the technical estimate", () => {
  const provider = readFileSync(
    "app/dashboard/budgets/generate/_components/BudgetGenerateProvider.tsx",
    "utf8"
  );
  assert.equal((provider.match(/hasUsablePrice/g) || []).length, 4);
  assert.match(provider, /function canAdoptResolvedPrice/);
  assert.match(provider, /AUTHORITATIVE_NON_COMMERCIAL_SOURCES/);
  assert.equal(
    (provider.match(/isRealData: isTraceableCommercialPrice\(resolved\)/g) || []).length,
    2
  );
  assert.doesNotMatch(provider, /isRealData: true,\n\s*sourceType: resolved\.sourceType/);
});

test("Cancel, New invoice and Scan are disabled while saving", () => {
  const page = readFileSync("app/dashboard/suppliers/invoices/page.tsx", "utf8");
  assert.match(page, /onClick=\{handleNewInvoice\} disabled=\{saving\}/);
  assert.match(page, /onClick=\{handleCancelForm\} disabled=\{saving\}/);
  assert.equal((page.match(/disabled=\{scanning \|\| saving\}/g) || []).length, 2);
});

test("retry submit updates the invoice and reconciles supplier balances in one atomic RPC", () => {
  const page = readFileSync("app/dashboard/suppliers/invoices/page.tsx", "utf8");
  assert.match(page, /supabase\.rpc\("update_received_invoice_and_reconcile", \{/);
  assert.doesNotMatch(page, /\.rpc\("reconcile_supplier_invoiced"/);
});

// ─── service-role client: lazy, server-only, no module-level construction ──

test("supabase-service-role helper is server-only, lazy, and disables session persistence/refresh", () => {
  const helper = readFileSync("lib/supabase-service-role.ts", "utf8");
  assert.match(helper, /^import "server-only";/m);
  assert.match(helper, /persistSession: false, autoRefreshToken: false/);
  // The env vars must only be read inside the exported function, not at
  // module top-level (which is exactly what broke `next build`'s page-data
  // collection whenever SUPABASE_SERVICE_ROLE_KEY is unset).
  const fnStart = helper.indexOf("export function getServiceRoleClient()");
  assert.ok(fnStart >= 0);
  assert.ok(helper.indexOf("process.env.SUPABASE_SERVICE_ROLE_KEY") > fnStart);
  assert.doesNotMatch(
    helper.slice(0, fnStart),
    /process\.env\.(SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_URL)/
  );
});

test("no signature endpoint creates the service-role Supabase client at module load time", () => {
  const files = [
    "app/api/signatures/create/route.ts",
    "app/api/signatures/public/route.ts",
    "app/api/signatures/send-otp/route.ts",
    "app/api/signatures/verify-otp/route.ts",
  ];
  for (const file of files) {
    const route = readFileSync(file, "utf8");
    assert.match(
      route,
      /import \{ getServiceRoleClient \} from "@\/lib\/supabase-service-role";/,
      `${file} debe usar el helper perezoso`
    );
    // La referencia directa a la env var solo debe vivir en el helper, no
    // en el propio endpoint — ni siquiera como `!` a nivel de módulo.
    assert.doesNotMatch(
      route,
      /SUPABASE_SERVICE_ROLE_KEY/,
      `${file} no debe referenciar la env var directamente`
    );
    // Sin cliente construido fuera de un handler exportado.
    assert.doesNotMatch(
      route,
      /^const \w+ = createClient\(/m,
      `${file} no debe crear el cliente a nivel de módulo`
    );
    // Cada handler debe comprobar el helper y responder 503 sin filtrar
    // nombres ni valores de secretos.
    assert.match(route, /if \(!supabase\w*\) \{/);
    assert.match(route, /status: 503/);
    assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY.*\$\{/); // nunca interpolado en una respuesta
  }
});
