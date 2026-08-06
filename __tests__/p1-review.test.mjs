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
  isConfirmedInvoiceDocumentUrl,
  parseConfirmedInvoiceDocumentUrl,
  parseOwnedOcrDraftUrl,
  parseRetainedReceivedInvoiceDocumentUrl,
  retainedInvoiceStorageUrl,
} from "../lib/invoice-ocr-drafts.ts";
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

test("both budget-generation paths use the shared traceability gate", () => {
  const provider = readFileSync(
    "app/dashboard/budgets/generate/_components/BudgetGenerateProvider.tsx",
    "utf8"
  );
  assert.equal(
    provider.match(/isTraceableCommercialPrice\(resolved\)/g)?.length,
    2
  );
});

test("V2 price queries include shared and company-owned providers", () => {
  const route = readFileSync("app/api/prices/resolve/route.ts", "utf8");
  assert.match(
    route,
    /company_id\.is\.null,company_id\.eq\.\$\{companyScopeId\}/
  );
  assert.equal(
    (route.match(/\.or\(visibleProviderFilter, \{ referencedTable: "pb_providers" \}\)/g) || []).length,
    3
  );
  assert.doesNotMatch(route, /\.is\("pb_providers\.company_id", null\)/);
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
  assert.doesNotMatch(retryBranch, /deleteStorageFiles\(/);
});

test("checkpoint retry re-runs ownership cleanup before clearing markers or Auth", () => {
  const accountDeletion = readFileSync("app/api/account/delete/route.ts", "utf8");
  const retryBranchStart = accountDeletion.indexOf(
    "if (isAccountDeletionCleanupComplete(user.app_metadata))"
  );
  const retryBranchEnd = accountDeletion.indexOf(
    "return NextResponse.json({ ok: true, resumed: true });",
    retryBranchStart
  );
  const retryBranch = accountDeletion.slice(retryBranchStart, retryBranchEnd);

  // Re-collects parent ids and repeats every ownership-cleanup step from the
  // main flow, so a row inserted after the first pass (e.g. by another
  // authenticated tab) is still cleaned up instead of blocking deleteUser
  // forever once the checkpoint is set.
  assert.match(
    retryBranch,
    /retryParentIds\[table\] = await collectIds\(admin, table, "user_id", userId\)/
  );
  assert.match(
    retryBranch,
    /for \(const \{ table, column, parent \} of CHILD_TABLES\)/
  );
  assert.match(retryBranch, /for \(const \{ table, column \} of OWNED_TABLES\)/);
  assert.match(retryBranch, /deletePrivatePriceBank\(admin, userId, ownershipRetryErrors\)/);
  assert.match(retryBranch, /clearAuthorReferences\(admin, userId, ownershipRetryErrors\)/);

  // Ordering: ownership cleanup must run, and succeed, before fiscal markers
  // or Auth are touched — otherwise a race could still slip through.
  const ownershipCleanup = retryBranch.indexOf("deletePrivatePriceBank(admin, userId, ownershipRetryErrors)");
  const markerCleanup = retryBranch.indexOf("clearFiscalRetryMarkers(admin, userId)");
  const authDelete = retryBranch.indexOf("admin.auth.admin.deleteUser(userId)");
  assert.ok(ownershipCleanup >= 0);
  assert.ok(markerCleanup > ownershipCleanup);
  assert.ok(authDelete > markerCleanup);

  // Still never touches Storage on this branch — the fiscal markers may
  // already be gone, so re-enumerating Storage here would be unsafe.
  assert.doesNotMatch(retryBranch, /deleteStorageFiles\(/);
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

  assert.match(
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
  assert.match(elseBranch, /updateReceivedInvoice\(supabase, invoiceId, \{/);
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
