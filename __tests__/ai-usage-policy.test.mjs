import test from "node:test";
import assert from "node:assert/strict";
import {
  canUseExternalAi,
  getAiUsagePolicy,
  sumAiTokens,
} from "../lib/ai-usage-policy.ts";

test("AI budget policy enforces hard configurable limits", () => {
  const policy = getAiUsagePolicy({
    AI_BUDGET_MAX_OUTPUT_TOKENS: "3200",
    AI_BUDGET_DAILY_TOKENS_PER_USER: "10000",
    AI_BUDGET_DAILY_TOKENS_GLOBAL: "50000",
  });
  assert.equal(policy.maxOutputTokens, 3200);
  assert.equal(sumAiTokens([{ tokens_in: 3000, tokens_out: 1000 }]), 4000);
  assert.equal(canUseExternalAi({ userTokens: 9999, globalTokens: 49999, policy }), true);
  assert.equal(canUseExternalAi({ userTokens: 10000, globalTokens: 49999, policy }), false);
  assert.equal(canUseExternalAi({ userTokens: 1, globalTokens: 50000, policy }), false);
});

test("AI output cap never exceeds the provider-safe maximum", () => {
  const policy = getAiUsagePolicy({ AI_BUDGET_MAX_OUTPUT_TOKENS: "999999" });
  assert.equal(policy.maxOutputTokens, 8192);
});
