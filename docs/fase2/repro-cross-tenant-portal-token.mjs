import { readFileSync } from "node:fs";
const root = new URL("file:///Users/alvaromirallesgrande/Desktop/enlaze/.claude/worktrees/portal-token-access-20260916/");
const sql = (p) => readFileSync(new URL(p, root), "utf8");
const pg = await import("pg");
const { Client } = pg.default ?? pg;
const db = new Client({ host: process.env.SOCKET, port: 55435, user: "postgres", database: "enlaze_revision_rpcs_test" });
await db.connect();
await db.query("begin");
await db.query(sql("__tests__/support/bootstrap-budget-schema.sql"));
await db.query(sql("__tests__/support/portal-token-access-schema.sql"));

// Fidelity: production grants authenticated these privileges on portal_tokens.
await db.query("grant select,insert,update,delete on public.portal_tokens to authenticated");
const victim = "11111111-1111-4111-8111-111111111111";
const attacker = "22222222-2222-4222-8222-222222222222";
const victimProject = "33333333-3333-4333-8333-333333333333";
const victimClient = "99999999-9999-4999-8999-999999999999";
await db.query("insert into auth.users(id) values($1),($2)", [victim, attacker]);
await db.query("insert into public.clients(id,user_id,name,email) values($1,$2,'Cliente privado','privado@ejemplo.es')", [victimClient, victim]);
await db.query(`insert into public.projects(id,user_id,name,client_id,address)
  values($1,$2,'Obra confidencial',$3,'Calle secreta 1')`, [victimProject, victim, victimClient]);
await db.query(`insert into public.budgets(id,user_id,project_id,title,status,total)
  values('cccccccc-cccc-4ccc-8ccc-cccccccccccc',$1,$2,'Presupuesto privado','enviado',123456.78)`,
  [victim, victimProject]);

// Apply the pending portal migration exactly as the branch ships it.
const migration = sql("supabase/migrations/20260915150000_portal_token_read_access.sql");
await db.query(migration.replace(/\nbegin;\n/i, "\n").replace(/\ncommit;\s*$/i, "\n"));

const asRole = async (role, uid, query, params = []) => {
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [uid ?? ""]);
  await db.query("set local role " + role);
  try { return await db.query(query, params); }
  finally { await db.query("reset role").catch(() => {}); }
};

const stolen = "44444444-4444-4444-8444-444444444444";
try {
  await asRole("authenticated", attacker, `insert into public.portal_tokens
    (project_id, token, permissions, created_by, expires_at)
    values ($1,$2,'["read","approve_budgets","approve_changes"]'::jsonb,$3,null)`,
    [victimProject, stolen, attacker]);
  console.log("PASO 1 — el atacante INSERTA un token para el proyecto ajeno: LOGRADO");
} catch (e) {
  console.log("PASO 1 — INSERT rechazado:", e.message, "| code", e.code);
  await db.query("rollback"); await db.end(); process.exit(0);
}

const snap = (await asRole("anon", null,
  "select public.portal_read_snapshot($1) as data", [stolen])).rows[0].data;
if (!snap) {
  console.log("PASO 2 — el snapshot NO devuelve nada. No explotable.");
} else {
  console.log("PASO 2 — snapshot devuelto para un proyecto ajeno:");
  console.log("   proyecto:", snap.project?.name, "|", snap.project?.address);
  console.log("   cliente :", snap.client?.name, "|", snap.client?.email);
  console.log("   budgets :", (snap.budgets ?? []).map((b) => `${b.title} ${b.total}`).join(", ") || "ninguno");
  console.log("   capacidades:", JSON.stringify(snap.capabilities));
}
await db.query("rollback");
await db.end();
