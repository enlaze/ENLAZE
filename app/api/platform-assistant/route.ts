import Anthropic from "@anthropic-ai/sdk";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  PLATFORM_GUIDE,
  buildLocalAssistantAnswer,
  getGuideForPath,
  suggestPathForQuestion,
} from "@/lib/platform-assistant-guide";

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return cookieStore.get(name)?.value; },
        set() {},
        remove() {},
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  let body: {
      message?: string;
      pathname?: string;
      voice_mode?: boolean;
      history?: ConversationMessage[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Petición no válida" }, { status: 400 });
  }

  const message = String(body.message || "").trim().slice(0, 2000);
  if (!message) return NextResponse.json({ error: "Escribe una pregunta" }, { status: 400 });

  const pathname = String(body.pathname || "/dashboard").slice(0, 300);
  const voiceMode = body.voice_mode === true;
  const localAnswer = buildLocalAssistantAnswer(message, pathname);
  const localResponse = () => NextResponse.json({
    ok: true,
    answer: localAnswer.answer,
    suggested_path: localAnswer.suggestedPath,
    suggested_label: localAnswer.suggestedLabel,
    mode: "local",
  });

  if (!process.env.ANTHROPIC_API_KEY) return localResponse();

  try {
    const currentGuide = getGuideForPath(pathname);
    const guideText = PLATFORM_GUIDE
      .map((entry) => `${entry.path} — ${entry.label}: ${entry.purpose}`)
      .join("\n");
    const normalizedHistory = Array.isArray(body.history)
      ? body.history
          .slice(-6)
          .filter((item) => item?.role === "user" || item?.role === "assistant")
          .map((item) => ({ role: item.role, content: String(item.content || "").slice(0, 2000) }))
      : [];
    const firstUserTurn = normalizedHistory.findIndex((item) => item.role === "user");
    const safeHistory = firstUserTurn >= 0 ? normalizedHistory.slice(firstUserTurn) : [];

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const result = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 700,
      temperature: 0.2,
      system: `Eres Guía ENLAZE, el asistente de ayuda integrado en una plataforma española para autónomos y pymes de construcción.
Tu misión es explicar la plataforma con lenguaje muy sencillo, breve y accionable.
La página actual es "${currentGuide.label}" (${pathname}): ${currentGuide.purpose}

MAPA REAL DE LA PLATAFORMA:
${guideText}

REGLAS:
- Responde en español y en un máximo de ${voiceMode ? "90" : "140"} palabras salvo que el usuario pida detalle.
- ${voiceMode ? "Habla como una persona cercana y profesional: frases cortas, sin Markdown y sin leer direcciones web. Si falta un dato, haz una sola pregunta aclaratoria." : "Usa un tono cercano, profesional y fácil de leer."}
- Da pasos numerados cuando expliques un proceso.
- No inventes botones, datos, precios, automatizaciones ni acciones realizadas.
- No digas que has abierto, guardado, enviado o modificado nada.
- Si una función no consta en el mapa, dilo claramente y orienta a la sección más cercana.
- Para precios, distingue siempre entre precio verificado, banco técnico y estimación.
- Para presupuestos, recuerda que superficie, ubicación, estancias, actuaciones y calidad tienen prioridad sobre la descripción libre.`,
      messages: [
        ...safeHistory,
        { role: "user", content: message },
      ],
    });

    const answer = result.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    const suggestedPath = suggestPathForQuestion(message);
    const suggestedEntry = suggestedPath
      ? PLATFORM_GUIDE.find((entry) => entry.path === suggestedPath)
      : null;

    return NextResponse.json({
      ok: true,
      answer,
      suggested_path: suggestedPath,
      suggested_label: suggestedEntry?.label || null,
      mode: "ai",
    });
  } catch (error: unknown) {
    const status = error && typeof error === "object" && "status" in error
      ? Number((error as { status?: unknown }).status) || null
      : null;
    console.warn("[platform-assistant] usando guía local", { status });
    return localResponse();
  }
}
