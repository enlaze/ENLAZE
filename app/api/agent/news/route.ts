import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import {
  getSectorIntel,
  resolveNewsQueries,
  type SectorIntelProfile,
} from "@/lib/agent/sector-intel";
import { normalizeBusinessSectorKey } from "@/lib/agent-prompts";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

interface NewsItem {
  title: string;
  url: string;
  source: string | null;
  published_at: string | null;
  sector: string;
  query: string;
  why_relevant?: string;
}

interface HaikuRelevancePayload {
  items: Array<{ idx: number; relevance: string }>;
}

/**
 * GET /api/agent/news?user_id=xxx[&write=1][&persist=1]
 *
 * Fetches sector-specific news from Google News RSS (no API key needed),
 * deduplicates, optionally enriches with Haiku one-liner ("why relevant"),
 * and either returns the news or writes them to `agent_news`.
 *
 * Robustez: ante cualquier fallo (RSS caído, Haiku caído, etc.) devuelve
 *   200 { news: [] }. Nunca 500.
 *
 * IMPORTANTE: este endpoint y el ingest pueden ambos escribir noticias en
 * `agent_news`. Para evitar duplicados, n8n debería elegir UNA vía: o
 * llamar aquí con `write=1` (escribimos), o llamar sin `write=1` y luego
 * volcar a `/api/agent/ingest`. La idempotencia diaria se aplica si
 * `write=1` (no duplica misma URL en el mismo día/usuario).
 */
export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const authHeader = req.headers.get("authorization");
    const expectedKey = process.env.AGENT_API_KEY;
    if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = req.nextUrl.searchParams.get("user_id");
    if (!userId) {
      return NextResponse.json(
        { error: "user_id query parameter is required" },
        { status: 400 },
      );
    }

    const writeMode =
      req.nextUrl.searchParams.get("write") === "1" ||
      req.nextUrl.searchParams.get("persist") === "1";

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, business_sector, city")
      .eq("id", userId)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json({ ok: true, news: [], reason: "no_profile" });
    }

    const sectorKey = normalizeBusinessSectorKey(profile.business_sector);
    const intel: SectorIntelProfile = getSectorIntel(sectorKey);
    const queries = resolveNewsQueries(intel, profile.city);
    const maxItems = Math.max(1, Math.min(intel.news_max_items, 10));

    // Per-query timeout small, total wall-time <8s
    const overallDeadline = startedAt + 7500;
    const perQueryTimeoutMs = 2200;

    const allItems: NewsItem[] = [];
    for (const q of queries) {
      if (Date.now() > overallDeadline) break;
      const remaining = overallDeadline - Date.now();
      const items = await fetchGoogleNewsRss(q, sectorKey, Math.min(perQueryTimeoutMs, remaining));
      allItems.push(...items);
    }

    const deduped = dedupeAndSort(allItems);
    const trimmed = deduped.slice(0, maxItems);

    // Optional Haiku enrichment — single batched call
    if (anthropic && trimmed.length > 0 && Date.now() < overallDeadline) {
      try {
        await enrichWithHaiku(trimmed, sectorKey, profile.city || "España", overallDeadline);
      } catch (err) {
        console.warn(
          `[agent/news] Haiku enrichment failed (${(err as Error).message}); continuing without why_relevant`,
        );
      }
    }

    let written = 0;
    if (writeMode && trimmed.length > 0) {
      written = await persistAgentNews(supabase, userId, trimmed);
    }

    const tookMs = Date.now() - startedAt;
    console.log(
      `[agent/news] user=${userId.slice(0, 8)} sector=${sectorKey} queries=${queries.length} items=${trimmed.length} written=${written} took=${tookMs}ms`,
    );

    return NextResponse.json({
      ok: true,
      sector: sectorKey,
      city: profile.city || null,
      queries_count: queries.length,
      news_count: trimmed.length,
      news: trimmed,
      written,
      took_ms: tookMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[agent/news] fail: ${message}`);
    return NextResponse.json({ ok: true, news: [], error: message });
  }
}

async function fetchGoogleNewsRss(
  query: string,
  sectorKey: string,
  timeoutMs: number,
): Promise<NewsItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=es&gl=ES&ceid=ES:es`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, timeoutMs));
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; EnlazeBot/1.0)" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRss(xml, query, sectorKey);
  } catch (err) {
    console.warn(`[agent/news] rss fail q="${query}": ${(err as Error).message}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function parseRss(xml: string, query: string, sectorKey: string): NewsItem[] {
  const items: NewsItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = extractTag(block, "title");
    const link = extractTag(block, "link");
    const pubDate = extractTag(block, "pubDate");
    const source = extractTag(block, "source");
    if (!title || !link) continue;
    items.push({
      title: decodeEntities(title),
      url: link.trim(),
      source: source ? decodeEntities(source) : null,
      published_at: parseDateIso(pubDate),
      sector: sectorKey,
      query,
    });
    if (items.length >= 25) break;
  }
  return items;
}

function extractTag(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  if (!m) return null;
  return stripCdata(m[1]).trim() || null;
}

function stripCdata(raw: string): string {
  const m = raw.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return m ? m[1] : raw;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function parseDateIso(raw: string | null): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function dedupeAndSort(items: NewsItem[]): NewsItem[] {
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const out: NewsItem[] = [];
  for (const it of items) {
    const u = canonicalUrl(it.url);
    const t = it.title.toLowerCase().slice(0, 80);
    if (seenUrls.has(u) || seenTitles.has(t)) continue;
    seenUrls.add(u);
    seenTitles.add(t);
    out.push(it);
  }
  out.sort((a, b) => {
    const da = a.published_at ? Date.parse(a.published_at) : 0;
    const db = b.published_at ? Date.parse(b.published_at) : 0;
    return db - da;
  });
  return out;
}

function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.search = "";
    return u.toString().toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

async function enrichWithHaiku(
  items: NewsItem[],
  sectorKey: string,
  city: string,
  deadline: number,
): Promise<void> {
  if (!anthropic) return;
  const remaining = deadline - Date.now();
  if (remaining < 1500) return;

  const list = items
    .map((it, idx) => `${idx}. ${it.title}${it.source ? ` (${it.source})` : ""}`)
    .join("\n");

  const system =
    `Eres un consultor de comercio local en España. Recibes una lista numerada de titulares de noticias y debes explicar, en UNA frase muy corta (<=25 palabras) y en castellano peninsular, por qué cada noticia le importa a un negocio del sector "${sectorKey}" en ${city}. ` +
    `Devuelve SOLO JSON con la forma {"items":[{"idx":N,"relevance":"..."}]}. Si una noticia no es relevante, ponla con "relevance":"Sin relevancia clara".`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1500, remaining - 500));
  try {
    const msg = await anthropic.messages.create(
      {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 800,
        system,
        messages: [{ role: "user", content: list }],
      },
      { signal: controller.signal },
    );
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const parsed = safeParseJson<HaikuRelevancePayload>(text);
    if (!parsed?.items) return;
    for (const entry of parsed.items) {
      if (typeof entry.idx !== "number") continue;
      const target = items[entry.idx];
      if (!target) continue;
      const rel = (entry.relevance || "").trim();
      if (rel && rel.toLowerCase() !== "sin relevancia clara") {
        target.why_relevant = rel;
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

function safeParseJson<T>(text: string): T | null {
  try {
    let s = text.trim();
    if (s.startsWith("```json")) s = s.slice(7);
    if (s.startsWith("```")) s = s.slice(3);
    if (s.endsWith("```")) s = s.slice(0, -3);
    const first = s.indexOf("{");
    const last = s.lastIndexOf("}");
    if (first !== -1 && last > first) s = s.slice(first, last + 1);
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

async function persistAgentNews(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  items: NewsItem[],
): Promise<number> {
  if (items.length === 0) return 0;

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();

  // Look up URLs already inserted today to avoid duplicates
  const urls = items.map((it) => it.url).filter(Boolean);
  let existingUrls = new Set<string>();
  if (urls.length > 0) {
    const { data: existing } = await supabase
      .from("agent_news")
      .select("url")
      .eq("user_id", userId)
      .gte("created_at", todayIso)
      .in("url", urls);
    if (existing) existingUrls = new Set((existing as Array<{ url: string }>).map((r) => r.url));
  }

  const rows = items
    .filter((it) => !existingUrls.has(it.url))
    .map((it) => ({
      user_id: userId,
      title: it.title,
      summary: it.why_relevant || null,
      source: it.source,
      url: it.url,
      published_date: it.published_at,
      category: it.sector,
      relevance: 5,
      tags: [it.sector],
    }));

  if (rows.length === 0) return 0;
  const { error } = await supabase.from("agent_news").insert(rows);
  if (error) {
    console.warn(`[agent/news] persist error: ${error.message}`);
    return 0;
  }
  return rows.length;
}
