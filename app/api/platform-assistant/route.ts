import Anthropic from "@anthropic-ai/sdk";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  PLATFORM_GUIDE,
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
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "El asistente no está configurado" }, { status: 503 });
  }

  try {
    const body = await request.json() as {
      message?: string;
      pathname?: string;
      history?: ConversationMessage[];
    };
    const message = String(body.message || "").trim().slice(0, 2000);
    if (!message) return NextResponse.json({ error: "Escribe una pregunta" }, { status: 400 });

    const pathname = String(body.pathname || "/dashboard").slice(0, 300);
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
- Responde en español y en un máximo de 140 palabras salvo que el usuario pida detalle.
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
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[platform-assistant]", message);
    return NextResponse.json({ error: "No he podido responder ahora. Inténtalo de nuevo." }, { status: 500 });
  }
}
