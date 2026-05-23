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

      {/* Enriched intel — Gmail */}
      <Section title="Gmail intel (lo que Claude verá como ctx.gmail_intel)">
        <GmailIntelBlock data={gmail.body} />
      </Section>

      {/* Enriched intel — Calendar */}
      <Section title="Calendar intel (ctx.calendar_intel)">
        <CalendarIntelBlock data={calendar.body} />
      </Section>

      {/* Enriched intel — Sheets */}
      <Section title="Sheets / Sales intel (ctx.sales_intel)">
        <SheetsIntelBlock data={sheets.body} />
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

/* ─── Intel blocks for the enriched payloads ─────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function GmailIntelBlock({ data }: { data: any }) {
  if (!data || data.connected !== true) {
    return (
      <p className="text-sm italic text-navy-400 dark:text-zinc-500">
        Gmail no operativo · status={String(data?.status ?? "—")}{" "}
        {data?.error_message && <span className="text-red-500">· {data.error_message}</span>}
      </p>
    );
  }
  const awaiting = (data.threads_awaiting_reply || []) as Array<{
    from_name: string; from_email: string; subject: string; hours_waiting: number;
    is_recurring_contact: boolean; category: string; priority_signal: string; snippet: string;
    importance?: string; importance_reason?: string; classified_by?: string;
  }>;
  const invoices = (data.invoices_detected || []) as Array<{ supplier: string; amount: number | null; due_date: string | null; snippet: string }>;
  const meetings = (data.meeting_requests || []) as Array<{ from: string; proposed_dates: string[]; snippet: string }>;
  const senders = (data.top_senders_30d || []) as Array<{ name: string; email: string; count: number; is_customer: boolean }>;
  const counts = data.threads_count_by_category || {};
  return (
    <div className="space-y-3 text-[12.5px]">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="Unread total" value={String(data.total_unread ?? 0)} />
        <Stat label="Procesados" value={String(data.emails_processed ?? 0)} />
        <Stat label="Pendientes" value={String(awaiting.length)} />
        <Stat label="Ventana" value={`${data.fetched_range_days ?? "?"}d`} />
      </div>

      <div className="flex flex-wrap gap-3 text-[11px] text-navy-500 dark:text-zinc-400">
        <span className="font-bold uppercase tracking-wider text-navy-400">Importancia</span>
        <span>{(data.importance_counts || {}).critical ?? 0} crítico</span>
        <span>{(data.importance_counts || {}).important ?? 0} importante</span>
        <span>{(data.importance_counts || {}).normal ?? 0} normal</span>
        <span>{(data.importance_counts || {}).noise ?? 0} ruido</span>
      </div>

      <details open>
        <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-zinc-500">
          Awaiting reply ({awaiting.length})
        </summary>
        {awaiting.length === 0 ? (
          <p className="text-xs italic text-navy-400 mt-1">— nada pendiente —</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {awaiting.slice(0, 8).map((t, i) => (
              <li key={i} className="rounded border border-navy-100 dark:border-zinc-800 p-2">
                <p className="font-semibold">{t.from_name} <span className="text-navy-400 dark:text-zinc-500">&lt;{t.from_email}&gt;</span></p>
                <p className="text-[12px] text-navy-600 dark:text-zinc-300 truncate">{t.subject}</p>
                <p className="text-[11.5px] text-navy-400 dark:text-zinc-500 mt-0.5">
                  {t.hours_waiting}h · {t.category} · prio={t.priority_signal} · imp={t.importance ?? "?"}{t.classified_by === "haiku" ? " (IA)" : ""}{t.is_recurring_contact ? " · recurrente" : ""}
                </p>
                {t.importance_reason && <p className="text-[10.5px] text-navy-400 mt-0.5">{t.importance_reason}</p>}
                <p className="text-[11px] italic text-navy-500 dark:text-zinc-400 mt-1 line-clamp-2">{t.snippet}</p>
              </li>
            ))}
          </ul>
        )}
      </details>

      <details>
        <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-zinc-500">
          Facturas detectadas ({invoices.length})
        </summary>
        {invoices.length === 0 ? (
          <p className="text-xs italic text-navy-400 mt-1">— ninguna —</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {invoices.map((v, i) => (
              <li key={i}>
                <span className="font-semibold">{v.supplier}</span>
                {v.amount != null && <> · {v.amount}€</>}
                {v.due_date && <> · vence {v.due_date}</>}
              </li>
            ))}
          </ul>
        )}
      </details>

      <details>
        <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-zinc-500">
          Solicitudes de reunión ({meetings.length})
        </summary>
        {meetings.length === 0 ? (
          <p className="text-xs italic text-navy-400 mt-1">— ninguna —</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {meetings.map((m, i) => (
              <li key={i}>
                <span className="font-semibold">{m.from}</span>
                {m.proposed_dates.length > 0 && <> · fechas: {m.proposed_dates.join(", ")}</>}
              </li>
            ))}
          </ul>
        )}
      </details>

      <details>
        <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-zinc-500">
          Top remitentes ({senders.length})
        </summary>
        <ul className="mt-2 text-[12px] space-y-0.5">
          {senders.map((s, i) => (
            <li key={i}>{s.count}× {s.name} <span className="text-navy-400">&lt;{s.email}&gt;</span> {s.is_customer ? "" : "(prov)"}</li>
          ))}
        </ul>
      </details>

      <details>
        <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-zinc-500">
          Conteo por categoría
        </summary>
        <p className="text-[12px] mt-1">
          {Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" · ")}
        </p>
      </details>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CalendarIntelBlock({ data }: { data: any }) {
  if (!data || data.connected !== true) {
    return (
      <p className="text-sm italic text-navy-400 dark:text-zinc-500">
        Calendar no operativo · status={String(data?.status ?? "—")}{" "}
        {data?.error_message && <span className="text-red-500">· {data.error_message}</span>}
      </p>
    );
  }
  const today = data.today || {};
  const tomorrow = data.tomorrow || {};
  const upcoming = (data.upcoming_important || []) as Array<{ date: string; title: string; why_important: string; days_until: number }>;
  const patterns = (data.recurring_patterns || []) as Array<{ description: string; occurrences: number }>;
  return (
    <div className="space-y-3 text-[12.5px]">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="Hoy eventos" value={String(today.total_events ?? 0)} />
        <Stat label="Hoy ocupado" value={`${today.total_busy_hours ?? 0}h`} />
        <Stat label="Apretado?" value={today.is_packed ? "sí" : "no"} />
        <Stat label="Mañana eventos" value={String(tomorrow.total_events ?? 0)} />
      </div>
      <DayBlock label="Hoy" day={today} />
      <DayBlock label="Mañana" day={tomorrow} />

      <details>
        <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-zinc-500">
          Próximos importantes ({upcoming.length})
        </summary>
        {upcoming.length === 0 ? (
          <p className="text-xs italic text-navy-400 mt-1">— ninguno —</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {upcoming.map((e, i) => (
              <li key={i}>
                <span className="font-semibold">{e.title}</span> · {e.date} (en {e.days_until}d) — {e.why_important}
              </li>
            ))}
          </ul>
        )}
      </details>

      <details>
        <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-zinc-500">
          Patrones recurrentes ({patterns.length})
        </summary>
        {patterns.length === 0 ? (
          <p className="text-xs italic text-navy-400 mt-1">— ninguno —</p>
        ) : (
          <ul className="mt-2 space-y-0.5 text-[12px]">
            {patterns.map((p, i) => <li key={i}>{p.description} · {p.occurrences} ocurrencias</li>)}
          </ul>
        )}
      </details>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DayBlock({ label, day }: { label: string; day: any }) {
  const events = (day?.events || []) as Array<{ start: string; end: string; title: string; location?: string | null; attendees?: number }>;
  const free = (day?.free_blocks || []) as Array<{ start: string; end: string; duration_hours: number }>;
  return (
    <details open={label === "Hoy"}>
      <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-zinc-500">
        {label} ({day?.date ?? "—"}) · {events.length} eventos · {free.length} huecos libres
      </summary>
      <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <p className="text-[11px] font-semibold text-navy-500 dark:text-zinc-400">Eventos</p>
          {events.length === 0 ? (
            <p className="text-xs italic text-navy-400">— sin eventos —</p>
          ) : (
            <ul className="text-[12px] space-y-0.5">
              {events.map((e, i) => (
                <li key={i}>
                  <span className="font-mono">{fmtTime(e.start)}-{fmtTime(e.end)}</span> {e.title}
                  {e.location && <span className="text-navy-400"> · {e.location}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="text-[11px] font-semibold text-navy-500 dark:text-zinc-400">Huecos libres</p>
          {free.length === 0 ? (
            <p className="text-xs italic text-navy-400">— sin huecos {">"}=1h —</p>
          ) : (
            <ul className="text-[12px] space-y-0.5">
              {free.map((f, i) => (
                <li key={i}>
                  <span className="font-mono">{fmtTime(f.start)}-{fmtTime(f.end)}</span> ({f.duration_hours}h)
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </details>
  );
}

function fmtTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SheetsIntelBlock({ data }: { data: any }) {
  if (!data || data.connected !== true) {
    return (
      <p className="text-sm italic text-navy-400 dark:text-zinc-500">
        Sheets no operativo · status={String(data?.status ?? "—")}{" "}
        {data?.error_message && <span className="text-red-500">· {data.error_message}</span>}
      </p>
    );
  }
  const sheet = data.active_sheet || {};
  const sales = data.sales_summary || null;
  const top = (data.top_products_7d || []) as Array<{ name: string; units: number; revenue: number; trend: string; vs_previous_pct: number }>;
  const alerts = (data.alerts || []) as Array<{ type: string; message: string }>;
  const schema = (sheet.column_schema_detected || []) as Array<{ name: string; type: string; role: string }>;
  return (
    <div className="space-y-3 text-[12.5px]">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="Hoja" value={sheet.name || "—"} />
        <Stat label="Filas analizadas" value={String(data.rows_analyzed ?? 0)} />
        <Stat label="Confianza" value={String(data.detection_confidence || "low")} />
        <Stat label="Fallback?" value={data.is_fallback ? "sí" : "no"} />
      </div>

      <details open>
        <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-zinc-500">
          Esquema detectado ({schema.length} columnas)
        </summary>
        {schema.length === 0 ? (
          <p className="text-xs italic text-navy-400 mt-1">— ninguno —</p>
        ) : (
          <ul className="mt-2 text-[12px] space-y-0.5">
            {schema.map((c, i) => (
              <li key={i}>
                <span className="font-mono">{c.name}</span> · tipo={c.type} · rol=<span className="font-semibold">{c.role}</span>
              </li>
            ))}
          </ul>
        )}
      </details>

      <details open>
        <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-zinc-500">
          Sales summary
        </summary>
        {!sales ? (
          <p className="text-xs italic text-navy-400 mt-1">— sin datos (confianza baja o sin columnas válidas) —</p>
        ) : (
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
            <SalesWindowBlock label="Hoy" w={sales.today} />
            <SalesWindowBlock label="Ayer" w={sales.yesterday} />
            <SalesWindowBlock label="Esta semana" w={sales.this_week} extra={sales.this_week?.vs_last_week_pct} extraLabel="vs sem. pasada" />
            <SalesWindowBlock label="Este mes" w={sales.this_month} extra={sales.this_month?.vs_last_month_pct} extraLabel="vs mes pasado" />
          </div>
        )}
      </details>

      <details>
        <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-zinc-500">
          Top productos 7d ({top.length})
        </summary>
        {top.length === 0 ? (
          <p className="text-xs italic text-navy-400 mt-1">— sin datos —</p>
        ) : (
          <ul className="mt-2 space-y-0.5">
            {top.map((p, i) => (
              <li key={i}>
                <span className="font-semibold">{p.name}</span>
                {" "}— {p.units} u · {p.revenue.toFixed(0)}€ · {p.trend} ({p.vs_previous_pct}%)
              </li>
            ))}
          </ul>
        )}
      </details>

      <details>
        <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-zinc-500">
          Alertas ({alerts.length})
        </summary>
        {alerts.length === 0 ? (
          <p className="text-xs italic text-navy-400 mt-1">— ninguna —</p>
        ) : (
          <ul className="mt-2 space-y-0.5">
            {alerts.map((a, i) => (
              <li key={i}><span className="font-mono text-[11px]">[{a.type}]</span> {a.message}</li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SalesWindowBlock({ label, w, extra, extraLabel }: { label: string; w: any; extra?: number | null; extraLabel?: string }) {
  if (!w) {
    return (
      <div>
        <p className="text-[11px] font-semibold text-navy-500 dark:text-zinc-400">{label}</p>
        <p className="text-xs italic text-navy-400">— sin datos —</p>
      </div>
    );
  }
  return (
    <div>
      <p className="text-[11px] font-semibold text-navy-500 dark:text-zinc-400">{label}</p>
      <p className="text-[13px]">
        {typeof w.revenue === "number" && <><strong>{w.revenue.toFixed(0)}€</strong> · </>}
        {typeof w.units === "number" && <>{w.units} u </>}
        {typeof w.transactions === "number" && <> · {w.transactions} tx</>}
      </p>
      {extra !== undefined && extra !== null && (
        <p className="text-[11.5px] text-navy-500">{extraLabel}: {extra}%</p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-navy-100 dark:border-zinc-800 px-2 py-1">
      <p className="text-[10.5px] uppercase tracking-wider text-navy-400 dark:text-zinc-500">{label}</p>
      <p className="text-[13px] font-semibold">{value}</p>
    </div>
  );
}
