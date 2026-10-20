import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PaymentGraceNotice } from "../components/billing/PlanNotices.tsx";
import { paymentGraceMessage } from "../lib/billing-messages.ts";
import { isInPaymentGrace } from "../lib/billing-status.ts";

const deadline = "2030-10-17T01:00:00.000Z";
test("payment grace notice shows precise deadline and an actionable payment link", () => {
  const html = renderToStaticMarkup(React.createElement(PaymentGraceNotice, { deadline }));
  assert.match(html, /role="status"/);
  assert.match(html, /17 de octubre de 2030.*3:00:00/);
  assert.match(html, /hora de Madrid/);
  assert.match(html, /Conservas el acceso completo/);
  assert.match(html, /href="\/dashboard\/settings\/plan"/);
  assert.match(html, /Revisar pago/);
  assert.ok(html.includes(paymentGraceMessage(deadline)));
});
test("only a server-confirmed full past_due account with a deadline shows grace", () => {
  const status = { status: "past_due", access_level: "full", past_due_grace_ends_at: deadline };
  assert.equal(isInPaymentGrace(status), true);
  assert.equal(isInPaymentGrace({ ...status, access_level: "read_only" }), false);
  assert.equal(isInPaymentGrace({ ...status, past_due_grace_ends_at: null }), false);
  assert.equal(isInPaymentGrace({ ...status, status: "active" }), false);
  assert.equal(isInPaymentGrace({ ...status, status: "canceled" }), false);
});
