import test from "node:test";
import assert from "node:assert/strict";

import { resolveSafeAuthRedirect } from "../lib/auth-redirect.ts";

test("login returns to the exact internal budget URL", () => {
  const budgetPath = "/dashboard/budgets/generate?budgetId=318dc62a-b519-4637-a361-d87ca63aa628";
  const search = `?redirect=${encodeURIComponent(budgetPath)}`;

  assert.equal(resolveSafeAuthRedirect(search), budgetPath);
});

test("login rejects external and protocol-relative redirects", () => {
  assert.equal(
    resolveSafeAuthRedirect("?redirect=https%3A%2F%2Fattacker.example"),
    "/dashboard"
  );
  assert.equal(
    resolveSafeAuthRedirect("?redirect=%2F%2Fattacker.example"),
    "/dashboard"
  );
  assert.equal(resolveSafeAuthRedirect(""), "/dashboard");
});
