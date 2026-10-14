// A fresh process per target prevents module/cache/env leakage between cases.
// These proxies observe REAL constructors without replacing SDK behavior.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mock } from "node:test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Resend } from "resend";
import * as anthropicSdk from "@anthropic-ai/sdk";

delete process.env.RESEND_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
const calls = { resend: 0, anthropic: 0 };
const observe = (sdk, name) => new Proxy(sdk, {
  construct(target, args, newTarget) {
    calls[name]++;
    return Reflect.construct(target, args, newTarget);
  },
});
const require = createRequire(import.meta.url);
const resendMock = { namedExports: { Resend: observe(Resend, "resend") } };
mock.module("resend", resendMock);
// tsx also loads these .ts files through CommonJS. Instrument both entrypoints.
mock.module(require.resolve("resend"), resendMock);
const { default: Anthropic, ...anthropicExports } = anthropicSdk;
const trackedAnthropic = observe(Anthropic, "anthropic");
const anthropicMock = {
  defaultExport: trackedAnthropic,
  namedExports: { ...anthropicExports, Anthropic: trackedAnthropic },
};
mock.module("@anthropic-ai/sdk", anthropicMock);
mock.module(require.resolve("@anthropic-ai/sdk"), {
  defaultExport: { ...anthropicExports, default: trackedAnthropic, Anthropic: trackedAnthropic, __esModule: true },
});

if (process.argv[2] === "getters") {
  const { getResend, getAnthropic } = await import("../../lib/service-clients.ts");
  assert.throws(getResend, /RESEND_API_KEY no está configurada/);
  assert.throws(getAnthropic, /ANTHROPIC_API_KEY no está configurada/);
  assert.deepEqual(calls, { resend: 0, anthropic: 0 });
  process.env.RESEND_API_KEY = "re_synthetic_constructor_test_only";
  process.env.ANTHROPIC_API_KEY = "sk-ant-synthetic-constructor-test-only";
  const resend = getResend(), anthropic = getAnthropic();
  assert.strictEqual(getResend(), resend);
  assert.strictEqual(getAnthropic(), anthropic);
  assert.deepEqual(calls, { resend: 1, anthropic: 1 }, "create once, reuse afterwards");
  delete process.env.RESEND_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  assert.throws(getResend, /RESEND_API_KEY/);
  assert.throws(getAnthropic, /ANTHROPIC_API_KEY/);
  console.log("PASS lazy getters: clear missing-key errors; one real constructor per SDK; no API calls");
} else {
  const target = resolve(process.argv[2]);
  assert.equal(process.env.RESEND_API_KEY, undefined);
  assert.equal(process.env.ANTHROPIC_API_KEY, undefined);
  await assert.doesNotReject(() => import(pathToFileURL(target).href), "module import must not require runtime credentials");
  assert.deepEqual(calls, { resend: 0, anthropic: 0 }, "IMPORT MUST NOT CONSTRUCT SERVICE CLIENTS");
  console.log(`PASS import without keys: ${process.argv[2]}`);
}
