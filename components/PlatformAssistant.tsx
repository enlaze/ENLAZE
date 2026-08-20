"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bot, Mic, MicOff, Send, Volume2, VolumeX, X } from "lucide-react";
import { getGuideForPath } from "@/lib/platform-assistant-guide";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  suggestedPath?: string | null;
  suggestedLabel?: string | null;
}

interface BrowserSpeechRecognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

export default function PlatformAssistant() {
  const pathname = usePathname();
  const guide = getGuideForPath(pathname);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceOutput, setVoiceOutput] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "Hola, soy la Guía ENLAZE. Puedo explicarte esta pantalla y acompañarte paso a paso. También puedes hablarme con el micrófono.",
    },
  ]);
  const endRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, open]);

  useEffect(() => () => {
    recognitionRef.current?.stop();
    window.speechSynthesis?.cancel();
  }, []);

  const speak = (text: string) => {
    if (!voiceOutput || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "es-ES";
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
  };

  const sendMessage = async (override?: string) => {
    const question = String(override ?? input).trim();
    if (!question || loading) return;

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: question }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const response = await fetch("/api/platform-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: question,
          pathname,
          history: messages.slice(-6).map(({ role, content }) => ({ role, content })),
        }),
      });
      const data = await response.json();
      const answer = response.ok
        ? String(data.answer || "No he encontrado una respuesta clara.")
        : String(data.error || "No he podido responder ahora.");
      setMessages((current) => [...current, {
        role: "assistant",
        content: answer,
        suggestedPath: data.suggested_path,
        suggestedLabel: data.suggested_label,
      }]);
      if (response.ok) speak(answer);
    } catch {
      setMessages((current) => [...current, {
        role: "assistant",
        content: "No he podido conectar ahora. Inténtalo de nuevo en unos segundos.",
      }]);
    } finally {
      setLoading(false);
    }
  };

  const toggleListening = () => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const browserWindow = window as typeof window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const Recognition = browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setMessages((current) => [...current, {
        role: "assistant",
        content: "Este navegador no permite dictado de voz. Puedes escribirme la pregunta en el cuadro de texto.",
      }]);
      return;
    }

    const recognition = new Recognition();
    recognition.lang = "es-ES";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) void sendMessage(transcript);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  };

  return (
    <div className="fixed bottom-5 right-5 z-50">
      {open && (
        <section className="mb-3 flex h-[min(620px,75vh)] w-[min(390px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-navy-100 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
          <header className="flex items-center gap-3 border-b border-navy-100 bg-navy-900 px-4 py-3 text-white dark:border-zinc-700">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-green text-navy-900">
              <Bot className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold">Guía ENLAZE</h2>
              <p className="truncate text-[11px] text-white/65">Te acompaño en {guide.label}</p>
            </div>
            <button
              type="button"
              onClick={() => setVoiceOutput((value) => !value)}
              className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white"
              aria-label={voiceOutput ? "Desactivar lectura en voz alta" : "Activar lectura en voz alta"}
              title={voiceOutput ? "Desactivar voz" : "Leer respuestas en voz alta"}
            >
              {voiceOutput ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white"
              aria-label="Cerrar asistente"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto bg-navy-50/50 p-4 dark:bg-zinc-950/40" aria-live="polite">
            {messages.map((message, index) => (
              <div key={index} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-5 ${
                  message.role === "user"
                    ? "rounded-br-md bg-navy-900 text-white"
                    : "rounded-bl-md border border-navy-100 bg-white text-navy-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                }`}>
                  <p className="whitespace-pre-wrap">{message.content}</p>
                  {message.suggestedPath && message.suggestedLabel && (
                    <Link
                      href={message.suggestedPath}
                      onClick={() => setOpen(false)}
                      className="mt-2 inline-flex rounded-lg bg-brand-green/15 px-2.5 py-1 text-xs font-bold text-brand-green hover:bg-brand-green/25"
                    >
                      Ir a {message.suggestedLabel}
                    </Link>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-md border border-navy-100 bg-white px-4 py-3 text-xs text-navy-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
                  Pensando…
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="border-t border-navy-100 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
            {messages.length <= 2 && (
              <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
                {guide.suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void sendMessage(suggestion)}
                    className="shrink-0 rounded-full border border-navy-200 px-3 py-1 text-[11px] font-medium text-navy-600 hover:border-brand-green/50 hover:text-brand-green dark:border-zinc-700 dark:text-zinc-300"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={toggleListening}
                disabled={loading}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition ${
                  listening
                    ? "border-red-300 bg-red-50 text-red-600 dark:border-red-800 dark:bg-red-950/30"
                    : "border-navy-200 text-navy-600 hover:border-brand-green/50 hover:text-brand-green dark:border-zinc-700 dark:text-zinc-300"
                }`}
                aria-label={listening ? "Detener escucha" : "Hablar con el asistente"}
              >
                {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                rows={1}
                placeholder={listening ? "Escuchando…" : "Pregunta cómo hacer algo…"}
                className="max-h-24 min-h-10 flex-1 resize-none rounded-xl border border-navy-200 bg-navy-50 px-3 py-2.5 text-sm text-navy-900 outline-none focus:border-brand-green dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
              />
              <button
                type="button"
                onClick={() => void sendMessage()}
                disabled={!input.trim() || loading}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-green text-navy-900 transition hover:bg-brand-green/90 disabled:opacity-40"
                aria-label="Enviar pregunta"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="ml-auto flex h-14 items-center gap-2 rounded-full bg-navy-900 px-4 font-bold text-white shadow-xl transition hover:-translate-y-0.5 hover:bg-navy-800 dark:border dark:border-zinc-700 dark:bg-zinc-800"
        aria-label={open ? "Cerrar Guía ENLAZE" : "Abrir Guía ENLAZE"}
      >
        <Bot className="h-5 w-5 text-brand-green" />
        <span className="text-sm">Ayuda IA</span>
      </button>
    </div>
  );
}
