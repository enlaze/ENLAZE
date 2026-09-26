import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("app/dashboard/projects/[id]/page.tsx", "utf8");
const dialog = readFileSync("app/dashboard/projects/_components/PortalLinksDialog.tsx", "utf8");
const migration = readFileSync("supabase/migrations/20260925100000_portal_token_ui_cutover.sql", "utf8");
const aclClosure = readFileSync(
  "supabase/migrations/20260925110000_portal_tokens_least_privilege.sql", "utf8");

test("la ficha delega la gestión y no relee secretos", () => {
  assert.match(page, /<PortalLinksDialog/);
  assert.doesNotMatch(page, /\.from\(["']portal_tokens["']\)/);
  assert.doesNotMatch(page, /\.select\(["']access_token["']\)/);
  assert.doesNotMatch(page, /navigator\.clipboard/,
    "la ficha no conserva una vía paralela de copia de secretos");
});

test("el gestor usa solo RPC y no persiste ni registra secretos", () => {
  for (const rpc of [
    "portal_list_tokens", "portal_issue_token", "portal_rotate_token", "portal_revoke_token",
  ]) assert.match(dialog, new RegExp(`rpc\\(\\"${rpc}\\"`));
  assert.doesNotMatch(dialog, /\.from\(/);
  assert.doesNotMatch(dialog, /localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(dialog, /console\.(?:log|info|warn|error)/);
  assert.match(dialog, /el secreto no volverá a mostrarse/i);
});

test("el corte retira únicamente la lectura directa autenticada y exige las RPC", () => {
  assert.match(migration, /revoke select on table public\.portal_tokens from authenticated;/i);
  assert.doesNotMatch(migration, /\bgrant\s+(?:select|insert|update|delete)\b/i);
  assert.doesNotMatch(migration, /\b(drop|truncate|delete|update|insert)\s+(?:table\s+)?public\.portal_tokens\b/i);
  for (const fn of ["portal_list_tokens", "portal_issue_token", "portal_rotate_token", "portal_revoke_token"]) {
    assert.match(migration, new RegExp(fn));
  }
});

test("el cierre ACL retira todo acceso directo del navegador y conserva service_role", () => {
  assert.match(aclClosure,
    /revoke all privileges on table public\.portal_tokens from public, anon, authenticated;/i);
  assert.doesNotMatch(aclClosure, /\bgrant\b/i);
  assert.doesNotMatch(aclClosure,
    /\b(drop|truncate|delete|update|insert)\s+(?:table\s+)?public\.portal_tokens\b/i);
  assert.doesNotMatch(aclClosure, /\b(?:grant|revoke)\b[^;]*\bservice_role\b/i,
    "la migración no debe cambiar la ACL administrativa de service_role");
  for (const fn of ["portal_list_tokens", "portal_issue_token", "portal_rotate_token", "portal_revoke_token"]) {
    assert.match(aclClosure, new RegExp(fn));
  }
});
