/**
 * Gmail intelligence — heuristic extraction over a small inbox window so the
 * agent can cite concrete senders, hours-waiting, invoice candidates, etc.
 *
 * Heuristic-first: regex/keyword + known-client + sector supplier hints. For
 * the emails the heuristic can't place (category 'unknown'), a SINGLE batched
 * Claude Haiku call assigns importance/category (see ./email-importance). If
 * Haiku is unavailable it degrades to the heuristic — never blocks.
 *
 * Window: last 7 days OR 50 messages, whichever is smaller — see
 * GMAIL_WINDOW_DAYS / GMAIL_WINDOW_MAX_MESSAGES.
 */

import {
  classifyEmailsWithHaiku,
  BusinessContext,
  EmailImportance,
  HaikuClassifyItem,
} from "./email-importance";

const LOG = "[agent/intel/gmail]";

export const GMAIL_WINDOW_DAYS = 7;
export const GMAIL_WINDOW_MAX_MESSAGES = 50;
const DETAIL_FETCH_CAP = 30; // we only fully fetch this many messages
const DAYS_90_MS = 90 * 24 * 60 * 60 * 1000;

export type GmailStatus =
  | "ok"
  | "decrypt_failed"
  | "expired_token"
  | "rate_limited"
  | "auth_expired"
  | "api_error"
  | "not_connected";

export type EmailCategory = "customer" | "supplier" | "lead" | "internal" | "spam" | "unknown";
export type PrioritySignal = "urgent" | "high" | "normal" | "low";

export type { EmailImportance };

export interface AwaitingReplyThread {
  thread_id: string;
  from_name: string;
  from_email: string;
  subject: string;
  snippet: string;
  hours_waiting: number;
  is_recurring_contact: boolean;
  category: EmailCategory;
  priority_signal: PrioritySignal;
  importance: EmailImportance;
  importance_reason: string;
  classified_by: "heuristic" | "haiku";
}

export interface TopSender {
  email: string;
  name: string;
  count: number;
  is_customer: boolean;
}

export interface InvoiceDetected {
  thread_id: string;
  supplier: string;
  amount: number | null;
  due_date: string | null;
  snippet: string;
}

export interface MeetingRequest {
  thread_id: string;
  from: string;
  proposed_dates: string[];
  snippet: string;
}

export type ImportanceCounts = Record<EmailImportance, number>;

export interface GmailIntel {
  connected: boolean;
  status: GmailStatus;
  error_message: string | null;
  total_unread: number;
  threads_awaiting_reply: AwaitingReplyThread[];
  classified_threads: AwaitingReplyThread[];
  importance_counts: ImportanceCounts;
  top_senders_30d: TopSender[];
  threads_count_by_category: Record<EmailCategory, number>;
  invoices_detected: InvoiceDetected[];
  meeting_requests: MeetingRequest[];
  emails_processed: number;
  fetched_range_days: number;
}

/** Optional inputs that sharpen classification (known clients + sector). */
export interface GmailIntelOptions {
  knownClientEmails?: string[];
  supplierHints?: string[];
  sectorContext?: BusinessContext | null;
  enableHaiku?: boolean;
}

export function emptyGmailIntel(
  status: GmailStatus,
  error: string | null = null,
): GmailIntel {
  return {
    connected: status === "ok",
    status,
    error_message: error,
    total_unread: 0,
    threads_awaiting_reply: [],
    classified_threads: [],
    importance_counts: { critical: 0, important: 0, normal: 0, noise: 0 },
    top_senders_30d: [],
    threads_count_by_category: { customer: 0, supplier: 0, lead: 0, internal: 0, spam: 0, unknown: 0 },
    invoices_detected: [],
    meeting_requests: [],
    emails_processed: 0,
    fetched_range_days: 0,
  };
}

interface ParsedFrom {
  name: string;
  email: string;
}

function parseFrom(raw: string): ParsedFrom {
  const trimmed = (raw || "").trim();
  const angleMatch = trimmed.match(/^(.*?)<([^>]+)>\s*$/);
  if (angleMatch) {
    const name = angleMatch[1].trim().replace(/^"|"$/g, "");
    const email = angleMatch[2].trim().toLowerCase();
    return { name: name || email.split("@")[0], email };
  }
  if (trimmed.includes("@")) {
    return { name: trimmed.split("@")[0], email: trimmed.toLowerCase() };
  }
  return { name: trimmed || "Desconocido", email: "" };
}

const SUPPLIER_DOMAINS = new Set([
  "makro.es",
  "mercadona.es",
  "metro.es",
  "carrefour.es",
  "amazon.es",
  "amazon.com",
  "aliexpress.com",
]);

const INTERNAL_FREEMAIL = new Set(["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com"]);

const STOPWORDS = new Set([
  "distribuidor", "proveedor", "de", "del", "la", "las", "los", "y", "o", "para",
  "software", "marca", "marcas", "tipo", "tipos", "general", "producto", "productos",
]);

const URGENT_RE = /\b(urgente|urgent|asap|importante|prioridad|emergencia|hoy)\b/i;
const INVOICE_RE = /\b(factura|invoice|alban?aran|albara|pago|payment|recibo)\b/i;
const ORDER_RE = /\b(pedido|order|encargo|reserva)\b/i;
const SUPPLIER_RE = /\b(proveedor|supplier|cotizaci[oó]n|presupuesto|albara|albar[aá]n)\b/i;
const MEETING_RE = /\b(reuni[oó]n|meeting|cita|videollamada|llamada|nos vemos|quedamos)\b/i;
const NOREPLY_RE = /\b(no-?reply|noreply|notification|notificaci[oó]n)\b/i;
const AMOUNT_RE = /(?:€|EUR\s*)?\s*([0-9]{1,5}(?:[.,][0-9]{2})?)\s*(?:€|EUR|euros)\b/i;
const DATE_RE = /\b(\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{2,4})?)\b/g;

/** Turn sector supplier_types phrases into significant keyword tokens. */
function buildSupplierTokens(hints: string[]): string[] {
  const tokens = new Set<string>();
  for (const h of hints || []) {
    for (const w of h.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/)) {
      if (w.length > 4 && !STOPWORDS.has(w)) tokens.add(w);
    }
  }
  return Array.from(tokens);
}

function categorize(
  from: ParsedFrom,
  subject: string,
  snippet: string,
  knownClients: Set<string>,
  supplierTokens: string[],
): EmailCategory {
  const text = `${subject} ${snippet}`.toLowerCase();
  const domain = from.email.split("@")[1] || "";
  const haystack = `${from.name} ${domain} ${text}`.toLowerCase();
  if (from.email && knownClients.has(from.email)) return "customer";
  if (SUPPLIER_DOMAINS.has(domain) || SUPPLIER_RE.test(text)) return "supplier";
  if (supplierTokens.some((t) => haystack.includes(t))) return "supplier";
  if (INVOICE_RE.test(text)) return "supplier";
  if (ORDER_RE.test(text)) return "customer";
  if (NOREPLY_RE.test(from.email)) return "internal";
  if (/\b(promo|descuento|oferta|newsletter|unsubscribe)\b/i.test(text)) return "spam";
  if (INTERNAL_FREEMAIL.has(domain)) return "unknown";
  return "unknown";
}

function priorityFor(args: {
  subject: string;
  snippet: string;
  hoursWaiting: number;
  isRecurring: boolean;
  category: EmailCategory;
}): PrioritySignal {
  const text = `${args.subject} ${args.snippet}`;
  if (URGENT_RE.test(text)) return "urgent";
  if (args.isRecurring && args.category === "customer" && args.hoursWaiting >= 24) return "high";
  if (args.category === "supplier" && args.hoursWaiting >= 48) return "high";
  if (args.category === "spam") return "low";
  return "normal";
}

/**
 * Heuristic importance for the clear cases. Returns `null` when the case is
 * ambiguous (category unknown) so the caller can defer it to Haiku.
 */
function importanceForHeuristic(a: {
  category: EmailCategory;
  priority: PrioritySignal;
  hoursWaiting: number;
  isRecurring: boolean;
  isKnownClient: boolean;
  isInvoice: boolean;
  isMeeting: boolean;
  fromEmail: string;
}): { importance: EmailImportance; reason: string } | null {
  const noReply = NOREPLY_RE.test(a.fromEmail);
  if (a.priority === "urgent") return { importance: "critical", reason: "Marcado como urgente" };
  if ((a.isKnownClient || a.category === "customer") && (a.isRecurring || a.isKnownClient) && a.hoursWaiting >= 24)
    return { importance: "critical", reason: `Cliente sin responder ${a.hoursWaiting}h` };
  if (a.isInvoice) return { importance: "important", reason: "Factura / pago detectado" };
  if (a.category === "supplier" && a.hoursWaiting >= 48)
    return { importance: "important", reason: `Proveedor sin responder ${a.hoursWaiting}h` };
  if (a.isMeeting) return { importance: "important", reason: "Solicitud de reunión / cita" };
  if (a.isKnownClient || a.category === "customer") return { importance: "important", reason: "Correo de cliente" };
  if (a.category === "spam" || noReply) return { importance: "noise", reason: "Notificación automática / promo" };
  if (a.category === "internal") return { importance: "noise", reason: "Notificación interna" };
  if (a.category === "supplier") return { importance: "normal", reason: "Proveedor, sin urgencia" };
  if (a.category === "unknown") return null; // defer to Haiku
  return { importance: "normal", reason: "Correo legítimo, sin urgencia" };
}

const IMPORTANCE_ORDER: Record<EmailImportance, number> = { critical: 0, important: 1, normal: 2, noise: 3 };
const VALID_CATEGORIES = new Set<EmailCategory>(["customer", "supplier", "lead", "internal", "spam", "unknown"]);

function safeHeader(headers: { name: string; value: string }[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
}

interface MessageDetail {
  id: string;
  thread_id: string;
  internal_ts_ms: number;
  from: ParsedFrom;
  to: string;
  subject: string;
  snippet: string;
  label_ids: string[];
  has_attachment: boolean;
  me_replied: boolean;
}

interface GmailListResult {
  messages: Array<{ id: string; threadId?: string }>;
  resultSizeEstimate?: number;
}

async function gmailGet<T>(
  url: string,
  token: string,
): Promise<{ ok: true; body: T } | { ok: false; status: number; statusText: string }> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return { ok: false, status: res.status, statusText: res.statusText };
  const body = (await res.json()) as T;
  return { ok: true, body };
}

export async function fetchGmailIntel(
  accessToken: string,
  myEmail: string | null,
  opts: GmailIntelOptions = {},
): Promise<GmailIntel> {
  const t0 = Date.now();
  const safeMe = (myEmail || "").toLowerCase();
  const knownClients = new Set((opts.knownClientEmails || []).map((e) => (e || "").toLowerCase()).filter(Boolean));
  const supplierTokens = buildSupplierTokens(opts.supplierHints || []);

  // 1) Unread count (cheap probe)
  const unreadList = await gmailGet<GmailListResult>(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread+in:inbox&maxResults=1",
    accessToken,
  );
  if (!unreadList.ok) {
    if (unreadList.status === 401 || unreadList.status === 403) {
      return emptyGmailIntel("auth_expired", `Gmail API ${unreadList.status} ${unreadList.statusText}`);
    }
    if (unreadList.status === 429) {
      return emptyGmailIntel("rate_limited", `Gmail API 429 ${unreadList.statusText}`);
    }
    return emptyGmailIntel("api_error", `Gmail API ${unreadList.status} ${unreadList.statusText}`);
  }
  const total_unread = unreadList.body.resultSizeEstimate ?? unreadList.body.messages?.length ?? 0;

  // 2) Recent window list
  const afterEpoch = Math.floor((Date.now() - GMAIL_WINDOW_DAYS * 24 * 60 * 60 * 1000) / 1000);
  const windowList = await gmailGet<GmailListResult>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=in:inbox+after:${afterEpoch}&maxResults=${GMAIL_WINDOW_MAX_MESSAGES}`,
    accessToken,
  );
  if (!windowList.ok) {
    return emptyGmailIntel("api_error", `Gmail window list ${windowList.status} ${windowList.statusText}`);
  }
  const ids = (windowList.body.messages || []).slice(0, DETAIL_FETCH_CAP);

  // 3) Fetch metadata for each (sequential — Gmail rate limits parallel bursts at low quota)
  const details: MessageDetail[] = [];
  for (const m of ids) {
    const detail = await gmailGet<{
      id: string;
      threadId: string;
      internalDate: string;
      labelIds?: string[];
      snippet?: string;
      payload?: { headers?: { name: string; value: string }[]; parts?: { filename?: string }[]; filename?: string };
    }>(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`,
      accessToken,
    );
    if (!detail.ok) continue;
    const d = detail.body;
    const headers = d.payload?.headers || [];
    const fromRaw = safeHeader(headers, "From");
    const toRaw = safeHeader(headers, "To");
    const subject = safeHeader(headers, "Subject") || "(sin asunto)";
    const hasAttachment =
      !!d.payload?.filename ||
      (d.payload?.parts || []).some((p) => !!p.filename && p.filename.length > 0);
    details.push({
      id: d.id,
      thread_id: d.threadId,
      internal_ts_ms: Number(d.internalDate || Date.now()),
      from: parseFrom(fromRaw),
      to: toRaw,
      subject,
      snippet: (d.snippet || "").slice(0, 200),
      label_ids: d.labelIds || [],
      has_attachment: hasAttachment,
      me_replied: false,
    });
  }

  // 4) Group by thread + sender histogram
  const byThread = new Map<string, MessageDetail[]>();
  for (const d of details) {
    const arr = byThread.get(d.thread_id) || [];
    arr.push(d);
    byThread.set(d.thread_id, arr);
  }

  const senderHistogram = new Map<string, { name: string; count: number; lastSeen: number }>();
  for (const d of details) {
    if (!d.from.email) continue;
    const cur = senderHistogram.get(d.from.email) || { name: d.from.name, count: 0, lastSeen: 0 };
    cur.count += 1;
    cur.lastSeen = Math.max(cur.lastSeen, d.internal_ts_ms);
    if (!cur.name && d.from.name) cur.name = d.from.name;
    senderHistogram.set(d.from.email, cur);
  }

  const classifiedAll: AwaitingReplyThread[] = [];
  const haikuItems: HaikuClassifyItem[] = [];
  const invoices_detected: InvoiceDetected[] = [];
  const meeting_requests: MeetingRequest[] = [];
  const threads_count_by_category: Record<EmailCategory, number> = {
    customer: 0,
    supplier: 0,
    lead: 0,
    internal: 0,
    spam: 0,
    unknown: 0,
  };

  for (const [threadId, msgs] of byThread.entries()) {
    msgs.sort((a, b) => b.internal_ts_ms - a.internal_ts_ms);
    const latest = msgs[0];
    const latestFromMe = !!safeMe && latest.from.email === safeMe;

    const category = categorize(latest.from, latest.subject, latest.snippet, knownClients, supplierTokens);
    threads_count_by_category[category] += 1;

    const textFull = `${latest.subject} ${latest.snippet}`;
    const isInvoice = INVOICE_RE.test(textFull) && latest.has_attachment;
    const isMeeting = MEETING_RE.test(textFull) && !latestFromMe;

    // Invoice detection
    if (isInvoice) {
      const amountMatch = textFull.match(AMOUNT_RE);
      const amount = amountMatch ? Number(amountMatch[1].replace(",", ".")) : null;
      const dateMatches = textFull.match(DATE_RE);
      invoices_detected.push({
        thread_id: threadId,
        supplier: latest.from.name || latest.from.email,
        amount: Number.isFinite(amount) ? amount : null,
        due_date: dateMatches ? dateMatches[0] : null,
        snippet: latest.snippet,
      });
    }

    // Meeting request detection
    if (isMeeting) {
      const dateMatches = textFull.match(DATE_RE);
      meeting_requests.push({
        thread_id: threadId,
        from: latest.from.name || latest.from.email,
        proposed_dates: dateMatches ? Array.from(new Set(dateMatches)).slice(0, 4) : [],
        snippet: latest.snippet,
      });
    }

    if (latestFromMe) continue;

    const hoursWaiting = Math.max(0, Math.round((Date.now() - latest.internal_ts_ms) / (60 * 60 * 1000)));
    const senderStat = senderHistogram.get(latest.from.email);
    const isRecurring =
      (senderStat?.count || 0) > 1 ||
      (senderStat ? Date.now() - senderStat.lastSeen < DAYS_90_MS && senderStat.count >= 2 : false);
    const isKnownClient = !!latest.from.email && knownClients.has(latest.from.email);
    const priority = priorityFor({ subject: latest.subject, snippet: latest.snippet, hoursWaiting, isRecurring, category });

    const heur = importanceForHeuristic({
      category,
      priority,
      hoursWaiting,
      isRecurring,
      isKnownClient,
      isInvoice,
      isMeeting,
      fromEmail: latest.from.email,
    });

    const item: AwaitingReplyThread = {
      thread_id: threadId,
      from_name: latest.from.name,
      from_email: latest.from.email,
      subject: latest.subject,
      snippet: latest.snippet,
      hours_waiting: hoursWaiting,
      is_recurring_contact: isRecurring,
      category,
      priority_signal: priority,
      importance: heur ? heur.importance : "normal",
      importance_reason: heur ? heur.reason : "Sin clasificar",
      classified_by: "heuristic",
    };

    if (!heur) {
      haikuItems.push({
        idx: classifiedAll.length,
        from_name: item.from_name,
        from_email: item.from_email,
        subject: item.subject,
        snippet: item.snippet,
      });
    }
    classifiedAll.push(item);
  }

  // 5) Haiku fallback for the ambiguous (unknown) emails — one batched call.
  if (opts.enableHaiku && opts.sectorContext && haikuItems.length > 0) {
    const results = await classifyEmailsWithHaiku(haikuItems, opts.sectorContext);
    if (results) {
      for (const r of results) {
        const target = classifiedAll[r.idx];
        if (!target) continue;
        target.importance = r.importance;
        target.importance_reason = r.reason || target.importance_reason;
        target.classified_by = "haiku";
        const cat = r.category as EmailCategory;
        if (VALID_CATEGORIES.has(cat)) target.category = cat;
      }
    }
  }

  // 6) Tally + sort
  const importance_counts: ImportanceCounts = { critical: 0, important: 0, normal: 0, noise: 0 };
  for (const t of classifiedAll) importance_counts[t.importance] += 1;

  const sortFn = (a: AwaitingReplyThread, b: AwaitingReplyThread) => {
    const d = IMPORTANCE_ORDER[a.importance] - IMPORTANCE_ORDER[b.importance];
    if (d !== 0) return d;
    return b.hours_waiting - a.hours_waiting;
  };
  classifiedAll.sort(sortFn);

  const threads_awaiting_reply = classifiedAll.filter((t) => t.importance !== "noise").slice(0, 12);
  const classified_threads = classifiedAll.slice(0, 40);

  const top_senders_30d: TopSender[] = Array.from(senderHistogram.entries())
    .map(([email, stat]) => ({
      email,
      name: stat.name,
      count: stat.count,
      is_customer: knownClients.has(email) || !SUPPLIER_DOMAINS.has(email.split("@")[1] || ""),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  console.log(
    `${LOG} processed=${details.length} unread=${total_unread} classified=${classifiedAll.length} ` +
      `critical=${importance_counts.critical} important=${importance_counts.important} ` +
      `invoices=${invoices_detected.length} meetings=${meeting_requests.length} elapsed_ms=${Date.now() - t0}`,
  );

  return {
    connected: true,
    status: "ok",
    error_message: null,
    total_unread,
    threads_awaiting_reply,
    classified_threads,
    importance_counts,
    top_senders_30d,
    threads_count_by_category,
    invoices_detected: invoices_detected.slice(0, 8),
    meeting_requests: meeting_requests.slice(0, 6),
    emails_processed: details.length,
    fetched_range_days: GMAIL_WINDOW_DAYS,
  };
}
