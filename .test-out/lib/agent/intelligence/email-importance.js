"use strict";
/**
 * Email importance classifier.
 *
 * Heuristic classification lives in `gmail.ts`. This module only handles the
 * Claude Haiku *fallback* for the ambiguous emails the heuristic couldn't place
 * (category 'unknown' / no clear importance). One batched call per agent run.
 *
 * Privacy: only sender + subject + snippet (already truncated) are sent. Never
 * full bodies. Never log email content.
 *
 * Robustness: on any failure (no API key, timeout, bad JSON) returns `null` so
 * the caller keeps the heuristic result. NEVER throws to the caller.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyEmailsWithHaiku = classifyEmailsWithHaiku;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const LOG = "[agent/intel/gmail]";
const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const HAIKU_TIMEOUT_MS = 4500;
const HAIKU_MAX_ITEMS = 15;
const IMPORTANCE_SET = new Set(["critical", "important", "normal", "noise"]);
function withTimeout(p, ms) {
    return Promise.race([
        p,
        new Promise((_, reject) => setTimeout(() => reject(new Error("haiku_timeout")), ms)),
    ]);
}
function extractJson(text) {
    let cleaned = text.trim();
    if (cleaned.startsWith("```json"))
        cleaned = cleaned.slice(7);
    if (cleaned.startsWith("```"))
        cleaned = cleaned.slice(3);
    if (cleaned.endsWith("```"))
        cleaned = cleaned.slice(0, -3);
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first !== -1 && last > first)
        cleaned = cleaned.slice(first, last + 1);
    return cleaned.trim();
}
/**
 * Classify ambiguous emails in a single batched Haiku call.
 * Returns the per-email results, or `null` if anything goes wrong.
 */
async function classifyEmailsWithHaiku(items, ctx) {
    if (!process.env.ANTHROPIC_API_KEY) {
        console.log(`${LOG} haiku skipped: no ANTHROPIC_API_KEY`);
        return null;
    }
    const batch = items.slice(0, HAIKU_MAX_ITEMS);
    if (batch.length === 0)
        return null;
    const system = `Eres un clasificador de correos para un negocio del sector "${ctx.agent_name}". ${ctx.persona_hint}
Tu tarea: para CADA correo, decidir su importancia para ESTE negocio y su categoría.

Niveles de importancia:
- "critical": requiere acción hoy (un cliente esperando respuesta, un plazo o vencimiento, dinero en juego, urgencia real).
- "important": merece atención pronto (cliente o proveedor relevante, oportunidad de negocio).
- "normal": legítimo pero sin urgencia.
- "noise": newsletters, promociones, notificaciones automáticas, avisos de plataformas, no-reply.

Categorías: "customer" | "supplier" | "lead" | "internal" | "spam" | "unknown".

Razona como un experto de ESE sector (lo crítico de una peluquería no es lo mismo que lo de un bufete).
Responde SOLO con JSON válido, sin texto alrededor, con esta forma exacta:
{"items":[{"idx":<number>,"importance":"critical|important|normal|noise","category":"customer|supplier|lead|internal|spam|unknown","reason":"frase corta en español"}]}`;
    const userPayload = JSON.stringify({
        business_name: ctx.business_name || null,
        sector: ctx.sector_key,
        emails: batch.map((b) => ({
            idx: b.idx,
            de: b.from_name,
            email: b.from_email,
            asunto: b.subject,
            extracto: b.snippet,
        })),
    });
    try {
        const anthropic = new sdk_1.default({ apiKey: process.env.ANTHROPIC_API_KEY });
        const message = await withTimeout(anthropic.messages.create({
            model: HAIKU_MODEL,
            max_tokens: 1024,
            system,
            messages: [{ role: "user", content: userPayload }],
        }), HAIKU_TIMEOUT_MS);
        const text = message.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("");
        const parsed = JSON.parse(extractJson(text));
        if (!parsed || !Array.isArray(parsed.items)) {
            console.log(`${LOG} haiku fallback: respuesta sin items`);
            return null;
        }
        const out = [];
        for (const raw of parsed.items) {
            if (!raw || typeof raw !== "object")
                continue;
            const r = raw;
            const idx = typeof r.idx === "number" ? r.idx : Number(r.idx);
            const importance = String(r.importance || "");
            if (!Number.isFinite(idx) || !IMPORTANCE_SET.has(importance))
                continue;
            out.push({
                idx,
                importance,
                category: String(r.category || "unknown"),
                reason: String(r.reason || "").slice(0, 140),
            });
        }
        console.log(`${LOG} haiku classified=${out.length}/${batch.length}`);
        return out.length > 0 ? out : null;
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`${LOG} haiku fallback: ${msg}`);
        return null;
    }
}
