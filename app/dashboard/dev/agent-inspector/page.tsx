/**
 * /dashboard/dev/agent-inspector
 *
 * Internal observability tool. Renders, for a selected user, exactly what the
 * daily agent (n8n → Claude) will see on its next run:
 *   - profile + module connection state (gmail / calendar / sheets / reputation)
 *   - module summary payloads (the same shape the n8n "Run User Modules" node ingests)
 *   - synthetic `ctx` mirroring "Build Claude Prompt"
 *   - last 5 daily summaries this user actually got
 *   - coherence alerts (e.g. agent_connections.connected=true but last briefing
 *     said "no conectado")
 *
 * Gated by NEXT_PUBLIC_DEV_TOOLS_ENABLED. UI is intentionally bare —
 * information first, aesthetics last.
 */

import { headers } from "next/headers";
import Link from "next/link";
import { createClient } from "@/lib/supabase-server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { buildInspectionContext } from "@/lib/agent/build-context";

export const dynamic = "force-dynamic";

const DEV_TOOLS_ENABLED = process.env.NEXT_PUBLIC_DEV_TOOLS_ENABLED === "true";

type SearchParams = Promise<{ user_id?: string }>;

interface ProfileRow {
  id: string;
  email: string | null;
  full_name: string | null;
  company_name: string | null;
  business_name: string | null;
  business_sector: string | null;
  business_type: string | null;
  city: string | null;
  agent_enabled: boolean | null;
  agent_status: string | null;
  agent_modules_enabled: Record<string, boolean> | null;
}

interface ConnectionRow {
  module: string;
  connected: boolean | null;
  status: string | null;
  last_sync_at: string | null;
  error_message: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any;
  credentials_ref: string | null;
}

interface DailySummaryRow {
  id: string;
  execution_date: string;
  headline: string | null;
  score: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw_payload: any;
  created_at: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function service() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createServiceClient(url, key);
}

async function resolveBaseUrl(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") || "http";
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}

async function fetchAgentEndpoint(baseUrl: string, path: string, userId: string) {
  const key = process.env.AGENT_API_KEY;
  const url = `${baseUrl}${path}?user_id=${encodeURIComponent(userId)}`;
  try {
    const res = await fetch(url, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({ _parse_error: "non-json response" }));
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: { _fetch_error: err instanceof Error ? err.message : String(err) },
    };
  }
}

function classifyConnection(c: ConnectionRow | undefined) {
  if (!c) return { label: "sin fila en agent_connections", tone: "gray" as const };
  if (c.connected && (c.status === "active" || !c.status)) return { label: c.status || "active", tone: "green" as const };
  if (c.connected && c.status === "decrypt_failed") return { label: "decrypt_failed (revisar clave)", tone: "red" as const };
  if (c.connected) return { label: c.status || "connected", tone: "yellow" as const };
  return { label: c.status || "disconnected", tone: "gray" as const };
}

function detectCoherenceAlerts(args: {
  connections: ConnectionRow[];
  endpointResults: Record<string, { ok: boolean; status: number; body: { connected?: boolean; status?: string; error_message?: string } }>;
  lastSummary: DailySummaryRow | null;
}): string[] {
  const alerts: string[] = [];
  const byModule = new Map(args.connections.map((c) => [c.module, c]));
  const expected: Array<{ key: string; module: string; label: string }> = [
    { key: "gmail", module: "gmail", label: "Gmail" },
    { key: "calendar", module: "google_calendar", label: "Google Calendar" },
    { key: "sheets", module: "google_sheets", label: "Google Sheets" },
    { key: "reputation", module: "google_business", label: "Google Business" },
  ];

  for (const e of expected) {
    const row = byModule.get(e.module);
    const live = args.endpointResults[e.key]?.body;
    if (row?.connected && live && live.connected === false) {
      alerts.push(
        `${e.label}: la DB dice connected=true pero el endpoint devuelve connected=false (status=${live.status ?? "n/a"}, ${live.error_message ?? "sin detalle"}). Probable mismatch de OAUTH_ENCRYPTION_KEY entre entornos.`,
      );
    }
    if (row?.connected && live?.connected) {
      // OK
    }
  }

  if (args.lastSummary) {
    const briefingText = JSON.stringify(args.lastSummary.raw_payload || {}).toLowerCase();
    const mentionsDisconnection = /sin conectar|no conectad|no est[aá] conectad/i.test(briefingText);
    if (mentionsDisconnection) {
      const liveStates: Array<[string, boolean]> = [
        ["gmail", args.endpointResults.gmail?.body?.connected === true],
        ["calendar", args.endpointResults.calendar?.body?.connected === true],
        ["sheets", args.endpointResults.sheets?.body?.connected === true],
        ["reputation", args.endpointResults.reputation?.body?.connected === true],
      ];
      const liveNow = liveStates.filter(([, on]) => on).map(([m]) => m);
      if (liveNow.length > 0) {
        alerts.push(
          `Último briefing menciona módulos "sin conectar" pero ahora aparecen como conectados: ${liveNow.join(", ")}. Comparar fecha del briefing (${args.lastSummary.execution_date}) con el momento en que el usuario conectó OAuth.`,
        );
      }
    }
  }

  return alerts;
}

// ── Page ───────────────────────────────────────────────────────────────────

export default async function AgentInspectorPage({ searchParams }: { searchParams: SearchParams }) {
  if (!DEV_TOOLS_ENABLED) {
    return (
      <main className="prose max-w-3xl">
        <h1>Agent Inspector — deshabilitado</h1>
        <p>
          Establece <code>NEXT_PUBLIC_DEV_TOOLS_ENABLED=true</code> en el entorno para activar esta página.
        </p>
      </main>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return (
      <main className="prose max-w-3xl">
        <h1>Agent Inspector</h1>
        <p>Necesitas estar logeado.</p>
      </main>
    );
  }

  const params = await searchParams;
  const selectedUserId = params?.user_id || user.id;

  const svc = service();
  // List all agent-enabled profiles for the dropdown (intentionally not deleting
  // the "Panadería San Juan" ghost — see brief Bug C).
  const { data: profilesData } = await svc
    .from("profiles")
    .select(
      "id, email, full_name, company_name, business_name, business_sector, business_type, city, agent_enabled, agent_status, agent_modules_enabled",
    )
    .eq("agent_enabled", true);
  const profiles = (profilesData || []) as ProfileRow[];

  const profile = profiles.find((p) => p.id === selectedUserId) || null;

  const { data: connData } = await svc
    .from("agent_connections")
    .select("module, connected, status, last_sync_at, error_message, config, credentials_ref")
    .eq("user_id", selectedUserId);
  const connections = (connData || []) as ConnectionRow[];

  const { data: summariesData } = await svc
    .from("agent_daily_summary")
    .select("id, execution_date, headline, score, raw_payload, created_at")
    .eq("user_id", selectedUserId)
    .order("execution_date", { ascending: false })
    .limit(5);
  const summaries = (summariesData || []) as DailySummaryRow[];

  const baseUrl = await resolveBaseUrl();

  const [gmail, calendar, sheets, reputation] = await Promise.all([
    fetchAgentEndpoint(baseUrl, "/api/agent/gmail/summary", selectedUserId),
    fetchAgentEndpoint(baseUrl, "/api/agent/calendar/summary", selectedUserId),
    fetchAgentEndpoint(baseUrl, "/api/agent/sheets/summary", selectedUserId),
    fetchAgentEndpoint(baseUrl, "/api/agent/reputation/summary", selectedUserId),
  ]);

  const ctx = buildInspectionContext({
    profile,
    gmail: gmail.body,
    calendar: calendar.body,
    sheets: sheets.body,
    reputation: reputation.body,
  });

  const endpointResults = { gmail, calendar, sheets, reputation };
  const alerts = detectCoherenceAlerts({
    connections,
    endpointResults,
    lastSummary: summaries[0] || null,
  });

  return (
    <main className="space-y-6 font-mono text-[13px] text-navy-900 dark:text-zinc-100">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Agent Inspector</h1>
        <p className="text-sm text-navy-500 dark:text-zinc-400">
          Lo que el agente verá la próxima vez que se ejecute para este usuario.
          Llama a los mismos endpoints <code>/api/agent/*</code> que llama n8n.
        </p>
      </header>

      {/* User selector */}
      <section className="rounded-lg border border-navy-200 dark:border-zinc-700 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-navy-400 dark:text-zinc-500 mb-2">
          Usuario inspeccionado
        </p>
        <form method="GET" className="flex flex-wrap items-center gap-2">
          <select
            name="user_id"
            defaultValue={selectedUserId}
            className="rounded border border-navy-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-sm"
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {(p.business_name || p.company_name || p.email || p.id) +
                  (p.id === user.id ? " (yo)" : "")}
              </option>
            ))}
            {profile === null && (
              <option value={selectedUserId}>{selectedUserId} (no en profiles)</option>
            )}
          </select>
          <button
            type="submit"
            className="rounded bg-navy-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-3 py-1 text-sm font-medium"
          >
            Inspeccionar
          </button>
          <Link
            href="/dashboard/dev/agent-inspector"
            className="text-xs text-navy-400 dark:text-zinc-500 underline ml-2"
          >
            usar mi propio user_id
          </Link>
        </form>
        <p className="mt-2 text-xs text-navy-400 dark:text-zinc-500">
          Logeado como <span className="font-semibold">{user.email}</span> · id{" "}
          <code className="text-[11px]">{user.id}</code>
        </p>
      </section>

      {/* Coherence alerts */}
      {alerts.length > 0 && (
        <section className="rounded-lg border-2 border-red-400 bg-red-50 dark:bg-red-950/30 dark:border-red-500/70 p-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-red-700 dark:text-red-300 mb-2">
            ⚠ Alertas de coherencia
          </h2>
          <ul className="space-y-1 text-[12.5px] text-red-900 dark:text-red-200">
            {alerts.map((a, i) => (
              <li key={i}>• {a}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Identity */}
      <Section title="Identidad del usuario">
        <KV label="user_id" value={selectedUserId} mono />
        <KV label="email" value={profile?.email ?? "—"} />
        <KV label="business_name" value={profile?.business_name ?? profile?.company_name ?? "—"} />
        <KV label="business_type / sector" value={`${profile?.business_type ?? "—"} / ${profile?.business_sector ?? "—"}`} />
        <KV label="agent_enabled" value={String(profile?.agent_enabled ?? false)} />
        <KV label="agent_status" value={profile?.agent_status ?? "—"} />
        <KV label="agent_modules_enabled" value={JSON.stringify(profile?.agent_modules_enabled ?? {})} mono />
      </Section>

      {/* Module status */}
      <Section title="Estado de módulos (DB + endpoints en vivo)">
        <ModuleRow
          label="Gmail"
          dbRow={connections.find((c) => c.module === "gmail")}
          live={gmail}
        />
        <ModuleRow
          label="Google Calendar"
          dbRow={connections.find((c) => c.module === "google_calendar")}
          live={calendar}
        />
        <ModuleRow
          label="Google Sheets"
          dbRow={connections.find((c) => c.module === "google_sheets")}
          live={sheets}
        />
        <ModuleRow
          label="Google Business (reputación)"
          dbRow={connections.find((c) => c.module === "google_business")}
          live={reputation}
        />
      </Section>

      {/* Calendar */}
      <Section title="Calendario retail (mismas reglas que el agente)">
        <p className="text-xs text-navy-500 dark:text-zinc-400 mb-2">
          Ventana ± 14 días salvo overrides. Si esta lista está vacía, Claude no debe mencionar ningún evento estacional.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-navy-400 mb-1">Upcoming</p>
            {ctx.upcoming_retail_events.length === 0 ? (
              <p className="text-sm italic text-navy-400">— sin eventos en ventana —</p>
            ) : (
              <ul className="text-sm space-y-1">
                {ctx.upcoming_retail_events.map((e) => (
                  <li key={e.key}>
                    {e.name} · {e.date} (en {e.in_days} días)
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-navy-400 mb-1">Recently passed</p>
            {ctx.recently_passed_retail_events.length === 0 ? (
              <p className="text-sm italic text-navy-400">— sin eventos recientes —</p>
            ) : (
              <ul className="text-sm space-y-1">
                {ctx.recently_passed_retail_events.map((e) => (
                  <li key={e.key}>
                    {e.name} · {e.date} (hace {e.days_ago} días)
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Section>

      {/* Synthesized ctx */}
      <Section title="ctx que se enviaría a Claude (próxima ejecución)">
        <details open>
          <summary className="cursor-pointer text-sm font-semibold mb-2">Ver JSON completo</summary>
          <pre className="overflow-x-auto rounded bg-navy-900 dark:bg-zinc-950 text-zinc-100 p-3 text-[11.5px] leading-snug">
            {JSON.stringify(ctx, null, 2)}
          </pre>
        </details>
      </Section>

      {/* Last 5 briefings */}
      <Section title="Últimas 5 ejecuciones del agente para este usuario">
        {summaries.length === 0 ? (
          <p className="text-sm italic text-navy-400">Sin briefings registrados.</p>
        ) : (
          <ul className="space-y-3">
            {summaries.map((s) => {
              const ai = s.raw_payload?.daily_summary?.ai_briefing
                || s.raw_payload?.ai_briefing
                || null;
              return (
                <li key={s.id} className="rounded border border-navy-200 dark:border-zinc-700 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                    <span className="text-xs text-navy-400 dark:text-zinc-500">
                      {s.execution_date} · score {s.score ?? "—"}
                      {ai?.model && <> · modelo {ai.model}</>}
                    </span>
                    <span className="text-[11px] text-navy-400 dark:text-zinc-500">{s.created_at}</span>
                  </div>
                  <p className="text-sm font-medium">{ai?.headline || s.headline || "—"}</p>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-navy-500 dark:text-zinc-400">
                      Ver raw_payload (incluye contexto recibido si se guardó)
                    </summary>
                    <pre className="overflow-x-auto rounded bg-navy-900 dark:bg-zinc-950 text-zinc-100 p-3 text-[11px] mt-2 max-h-96">
                      {JSON.stringify(s.raw_payload, null, 2)}
                    </pre>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* Raw endpoint dumps */}
      <Section title="Respuestas crudas de /api/agent/*/summary">
        {(["gmail", "calendar", "sheets", "reputation"] as const).map((k) => {
          const r = endpointResults[k];
          return (
            <details key={k} className="mb-2">
              <summary className="cursor-pointer text-sm font-semibold">
                {k} — HTTP {r.status} {r.ok ? "✓" : "✗"}{" "}
                <span className="text-xs font-normal text-navy-500">
                  connected={String(r.body?.connected ?? "n/a")} status={String(r.body?.status ?? "—")}
                </span>
              </summary>
              <pre className="overflow-x-auto rounded bg-navy-900 dark:bg-zinc-950 text-zinc-100 p-3 text-[11px] mt-2 max-h-96">
                {JSON.stringify(r.body, null, 2)}
              </pre>
            </details>
          );
        })}
      </Section>
    </main>
  );
}

/* ─── Tiny presentational helpers (kept inline; this page is internal-only) ── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-navy-200 dark:border-zinc-700 p-4">
      <h2 className="text-sm font-bold uppercase tracking-wider text-navy-500 dark:text-zinc-400 mb-3">
        {title}
      </h2>
      <div>{children}</div>
    </section>
  );
}

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[200px_1fr] gap-2 text-sm py-0.5">
      <span className="text-navy-400 dark:text-zinc-500">{label}</span>
      <span className={mono ? "font-mono text-[12px] break-all" : ""}>{value}</span>
    </div>
  );
}

function ModuleRow({
  label,
  dbRow,
  live,
}: {
  label: string;
  dbRow: ConnectionRow | undefined;
  live: { ok: boolean; status: number; body: { connected?: boolean; status?: string; error_message?: string } };
}) {
  const cls = classifyConnection(dbRow);
  const liveConnected = live.body?.connected === true;
  const liveStatus = live.body?.status ?? "—";
  const tone =
    cls.tone === "green"
      ? "bg-green-100 text-green-800 dark:bg-emerald-900/40 dark:text-emerald-200"
      : cls.tone === "yellow"
      ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200"
      : cls.tone === "red"
      ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"
      : "bg-navy-100 text-navy-600 dark:bg-zinc-800 dark:text-zinc-300";
  return (
    <div className="border-b border-navy-100 dark:border-zinc-800 last:border-b-0 py-2 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
      <div>
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-[12px] text-navy-500 dark:text-zinc-400">
          DB: connected={String(dbRow?.connected ?? false)} · status=
          <span className={`inline-block rounded px-1.5 ${tone}`}>{cls.label}</span>
          {dbRow?.last_sync_at && <> · last_sync={dbRow.last_sync_at}</>}
        </p>
        <p className="text-[12px] text-navy-500 dark:text-zinc-400">
          Endpoint live: connected={String(liveConnected)} · status={liveStatus} · HTTP {live.status}
          {live.body?.error_message && (
            <span className="text-red-600 dark:text-red-400"> · {live.body.error_message}</span>
          )}
        </p>
      </div>
    </div>
  );
}
