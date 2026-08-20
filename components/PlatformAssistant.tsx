"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AudioLines, Bot, Mic, MicOff, Send, Volume2, VolumeX, X } from "lucide-react";
import { getGuideForPath } from "@/lib/platform-assistant-guide";
import { selectPreferredSpanishFemaleVoice } from "@/lib/platform-assistant-voice";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  suggestedPath?: string | null;
  suggestedLabel?: string | null;
  responseMode?: "ai" | "local";
}

interface BrowserSpeechRecognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onstart: (() => void) | null;
  onresult: ((event: {
    results: ArrayLike<{
      0: { transcript: string };
      isFinal?: boolean;
    }>;
  }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
}

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;
type VoicePhase = "idle" | "listening" | "thinking" | "speaking" | "error";

const INITIAL_MESSAGE: ChatMessage = {
  role: "assistant",
  content: "Hola, soy la Guía ENLAZE. Puedo explicarte esta pantalla y acompañarte paso a paso. Pulsa «Conversación por voz» para hablar conmigo de forma continua.",
};

function speechRecognitionConstructor() {
  if (typeof window === "undefined") return null;
  const browserWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition || null;
}

function cleanTextForSpeech(text: string) {
  return text
    .replace(/\[([^\]]+)]\([^\)]+\)/g, "$1")
    .replace(/[*_#`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function microphoneErrorMessage(error?: string) {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "Necesito permiso para usar el micrófono. Actívalo en los permisos del navegador y vuelve a intentarlo.";
  }
  if (error === "audio-capture") {
    return "No encuentro un micrófono disponible. Comprueba que está conectado y que el navegador puede utilizarlo.";
  }
  if (error === "network") {
    return "El reconocimiento de voz no está disponible ahora. Puedes seguir escribiéndome y volver a probar en unos segundos.";
  }
  return "No he podido escucharte con claridad. Pulsa el micrófono y vuelve a intentarlo.";
}

export default function PlatformAssistant() {
  const pathname = usePathname();
  const guide = getGuideForPath(pathname);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceOutput, setVoiceOutput] = useState(false);
  const [conversationMode, setConversationMode] = useState(false);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>("idle");
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);
  const endRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const preferredVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const messagesRef = useRef<ChatMessage[]>([INITIAL_MESSAGE]);
  const loadingRef = useRef(false);
  const listeningRef = useRef(false);
  const openRef = useRef(false);
  const voiceOutputRef = useRef(false);
  const conversationModeRef = useRef(false);
  const manualRecognitionStopRef = useRef(false);
  const startListeningRef = useRef<() => void>(() => {});
  const sendMessageRef = useRef<(message?: string) => Promise<void>>(async () => {});

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, open]);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    const loadPreferredVoice = () => {
      preferredVoiceRef.current = selectPreferredSpanishFemaleVoice(
        window.speechSynthesis.getVoices(),
      );
    };
    loadPreferredVoice();
    window.speechSynthesis.addEventListener("voiceschanged", loadPreferredVoice);

    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", loadPreferredVoice);
    };
  }, []);

  const cancelSpeech = useCallback(() => {
    utteranceRef.current = null;
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setVoicePhase((phase) => phase === "speaking" ? "idle" : phase);
  }, []);

  const stopRecognition = useCallback((abort = false) => {
    manualRecognitionStopRef.current = true;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    listeningRef.current = false;
    setListening(false);
    if (recognition) {
      if (abort && recognition.abort) recognition.abort();
      else recognition.stop();
    }
    setVoicePhase((phase) => phase === "listening" ? "idle" : phase);
  }, []);

  const speak = useCallback((text: string) => {
    if (!voiceOutputRef.current || typeof window === "undefined" || !("speechSynthesis" in window)) {
      return false;
    }

    const spokenText = cleanTextForSpeech(text);
    if (!spokenText) return false;

    stopRecognition(true);
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(spokenText);
    const preferredVoice = selectPreferredSpanishFemaleVoice(
      window.speechSynthesis.getVoices(),
    ) || preferredVoiceRef.current;
    preferredVoiceRef.current = preferredVoice;
    utterance.voice = preferredVoice;
    utterance.lang = preferredVoice?.lang || "es-ES";
    utterance.rate = 0.96;
    utterance.pitch = 1.04;
    utterance.volume = 0.98;
    utteranceRef.current = utterance;
    setVoicePhase("speaking");
    setVoiceNotice(null);

    const finishSpeaking = () => {
      if (utteranceRef.current !== utterance) return;
      utteranceRef.current = null;
      setVoicePhase("idle");
      if (conversationModeRef.current && openRef.current) {
        window.setTimeout(() => startListeningRef.current(), 350);
      }
    };
    utterance.onend = finishSpeaking;
    utterance.onerror = finishSpeaking;
    window.speechSynthesis.speak(utterance);
    return true;
  }, [stopRecognition]);

  const sendMessage = useCallback(async (override?: string) => {
    const question = String(override ?? input).trim();
    if (!question || loadingRef.current) return;

    stopRecognition(true);
    const history = messagesRef.current;
    const userMessage: ChatMessage = { role: "user", content: question };
    const nextMessages = [...history, userMessage];
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    setInput("");
    loadingRef.current = true;
    setLoading(true);
    setVoicePhase(conversationModeRef.current ? "thinking" : "idle");
    setVoiceNotice(null);
    let startedSpeaking = false;

    try {
      const response = await fetch("/api/platform-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: question,
          pathname,
          voice_mode: conversationModeRef.current || voiceOutputRef.current,
          history: history.slice(-8).map(({ role, content }) => ({ role, content })),
        }),
      });
      const data = await response.json();
      const answer = response.ok
        ? String(data.answer || "No he encontrado una respuesta clara.")
        : String(data.error || "No he podido responder ahora.");
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: answer,
        suggestedPath: data.suggested_path,
        suggestedLabel: data.suggested_label,
        responseMode: data.mode === "local" ? "local" : "ai",
      };
      messagesRef.current = [...messagesRef.current, assistantMessage];
      setMessages(messagesRef.current);
      startedSpeaking = speak(answer);
    } catch {
      const answer = "No he podido conectar ahora. Inténtalo de nuevo en unos segundos.";
      const assistantMessage: ChatMessage = { role: "assistant", content: answer };
      messagesRef.current = [...messagesRef.current, assistantMessage];
      setMessages(messagesRef.current);
      startedSpeaking = speak(answer);
    } finally {
      loadingRef.current = false;
      setLoading(false);
      if (!startedSpeaking) {
        setVoicePhase("idle");
        if (conversationModeRef.current && openRef.current) {
          window.setTimeout(() => startListeningRef.current(), 350);
        }
      }
    }
  }, [input, pathname, speak, stopRecognition]);

  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  const startListening = useCallback(() => {
    if (loadingRef.current || listeningRef.current) return;
    const Recognition = speechRecognitionConstructor();
    if (!Recognition) {
      const answer = "Este navegador no permite conversación por voz. Puedes seguir usando la ayuda escrita.";
      conversationModeRef.current = false;
      setConversationMode(false);
      setVoicePhase("error");
      setVoiceNotice(answer);
      return;
    }

    cancelSpeech();
    manualRecognitionStopRef.current = false;
    const recognition = new Recognition();
    let finalTranscript = "";
    let latestTranscript = "";
    recognition.lang = "es-ES";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onstart = () => {
      listeningRef.current = true;
      setListening(true);
      setVoicePhase("listening");
      setVoiceNotice(null);
    };
    recognition.onresult = (event) => {
      let interimTranscript = "";
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript || "";
        if (result?.isFinal) finalTranscript += `${transcript} `;
        else interimTranscript += `${transcript} `;
      }
      latestTranscript = `${finalTranscript}${interimTranscript}`.trim();
      setInput(latestTranscript);
    };
    recognition.onerror = (event) => {
      recognitionRef.current = null;
      listeningRef.current = false;
      setListening(false);
      setVoicePhase("error");
      setVoiceNotice(microphoneErrorMessage(event.error));
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        conversationModeRef.current = false;
        setConversationMode(false);
      }
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      listeningRef.current = false;
      setListening(false);
      if (manualRecognitionStopRef.current) {
        manualRecognitionStopRef.current = false;
        return;
      }
      const transcript = latestTranscript.trim();
      if (transcript) {
        setInput("");
        void sendMessageRef.current(transcript);
        return;
      }
      setVoicePhase("idle");
      if (conversationModeRef.current && openRef.current) {
        window.setTimeout(() => startListeningRef.current(), 650);
      }
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      listeningRef.current = false;
      setListening(false);
      setVoicePhase("error");
      setVoiceNotice("No he podido iniciar el micrófono. Comprueba sus permisos y vuelve a intentarlo.");
    }
  }, [cancelSpeech]);

  useEffect(() => {
    startListeningRef.current = startListening;
  }, [startListening]);

  const setVoiceOutputEnabled = useCallback((enabled: boolean) => {
    voiceOutputRef.current = enabled;
    setVoiceOutput(enabled);
    if (!enabled) cancelSpeech();
  }, [cancelSpeech]);

  const stopConversation = useCallback(() => {
    conversationModeRef.current = false;
    setConversationMode(false);
    stopRecognition(true);
    cancelSpeech();
    setVoicePhase("idle");
    setVoiceNotice("Conversación por voz pausada.");
  }, [cancelSpeech, stopRecognition]);

  const toggleConversation = () => {
    if (conversationModeRef.current) {
      stopConversation();
      return;
    }
    if (!speechRecognitionConstructor() || !("speechSynthesis" in window)) {
      setVoicePhase("error");
      setVoiceNotice("Este navegador no ofrece todas las funciones necesarias para la conversación por voz.");
      return;
    }
    conversationModeRef.current = true;
    setConversationMode(true);
    setVoiceOutputEnabled(true);
    setVoiceNotice("Voz femenina activada. Puedes hablar cuando veas «Te escucho». Para interrumpirme, pulsa el micrófono.");
    window.setTimeout(() => startListeningRef.current(), 100);
  };

  const toggleListening = () => {
    if (voicePhase === "speaking") {
      cancelSpeech();
      window.setTimeout(() => startListeningRef.current(), 100);
      return;
    }
    if (listening) {
      stopConversation();
      return;
    }
    startListening();
  };

  const toggleVoiceOutput = () => {
    const enabled = !voiceOutputRef.current;
    setVoiceOutputEnabled(enabled);
    if (!enabled && conversationModeRef.current) stopConversation();
  };

  const closeAssistant = () => {
    stopConversation();
    openRef.current = false;
    setOpen(false);
  };

  useEffect(() => () => {
    conversationModeRef.current = false;
    recognitionRef.current?.abort?.();
    recognitionRef.current?.stop();
    utteranceRef.current = null;
    window.speechSynthesis?.cancel();
  }, []);

  const phaseLabel = voicePhase === "listening"
    ? "Te escucho…"
    : voicePhase === "thinking"
      ? "Estoy pensando…"
      : voicePhase === "speaking"
        ? "Te estoy respondiendo…"
        : voicePhase === "error"
          ? "Revisa el micrófono"
          : conversationMode
            ? "Conversación activa"
            : `Te acompaño en ${guide.label}`;

  return (
    <div
      className="fixed right-5 z-[60] transition-[bottom] duration-300 ease-out"
      style={{ bottom: "calc(1.25rem + var(--enlaze-price-tracker-offset, 0px))" }}
    >
      {open && (
        <section
          className="mb-3 flex h-[min(650px,78vh)] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-navy-100 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
          style={{ maxHeight: "calc(100vh - 2.5rem - var(--enlaze-price-tracker-offset, 0px))" }}
        >
          <header className="flex items-center gap-3 border-b border-navy-100 bg-navy-900 px-4 py-3 text-white dark:border-zinc-700">
            <span className={`flex h-9 w-9 items-center justify-center rounded-xl bg-brand-green text-navy-900 ${voicePhase === "speaking" ? "animate-pulse" : ""}`}>
              <Bot className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold">Guía ENLAZE</h2>
              <p className="truncate text-[11px] text-white/65" aria-live="polite">{phaseLabel}</p>
            </div>
            <button
              type="button"
              onClick={toggleVoiceOutput}
              className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white"
              aria-label={voiceOutput ? "Desactivar lectura en voz alta" : "Activar lectura en voz alta"}
              title={voiceOutput ? "Desactivar voz" : "Leer respuestas en voz alta"}
            >
              {voiceOutput ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={closeAssistant}
              className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white"
              aria-label="Cerrar asistente"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto bg-navy-50/50 p-4 dark:bg-zinc-950/40" aria-live="polite">
            {(conversationMode || voiceNotice) && (
              <div className={`rounded-xl border px-3 py-2.5 text-xs ${
                voicePhase === "error"
                  ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
                  : "border-brand-green/30 bg-brand-green/10 text-navy-700 dark:text-zinc-200"
              }`} role="status">
                <div className="flex items-center gap-2 font-bold">
                  <AudioLines className={`h-4 w-4 text-brand-green ${voicePhase === "listening" || voicePhase === "speaking" ? "animate-pulse" : ""}`} />
                  {phaseLabel}
                </div>
                {voiceNotice && <p className="mt-1 leading-4 opacity-80">{voiceNotice}</p>}
              </div>
            )}

            {messages.map((message, index) => (
              <div key={index} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-5 ${
                  message.role === "user"
                    ? "rounded-br-md bg-navy-900 text-white"
                    : "rounded-bl-md border border-navy-100 bg-white text-navy-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                }`}>
                  <p className="whitespace-pre-wrap">{message.content}</p>
                  {message.role === "assistant" && message.responseMode === "local" && (
                    <p className="mt-1.5 text-[10px] text-navy-400 dark:text-zinc-500">
                      Guía local · la IA avanzada no está disponible temporalmente
                    </p>
                  )}
                  {message.suggestedPath && message.suggestedLabel && (
                    <Link
                      href={message.suggestedPath}
                      onClick={closeAssistant}
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
                  Estoy pensando…
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="border-t border-navy-100 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
            <button
              type="button"
              onClick={toggleConversation}
              className={`mb-2 flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition ${
                conversationMode
                  ? "border-brand-green bg-brand-green/15 text-brand-green"
                  : "border-navy-200 text-navy-700 hover:border-brand-green/50 hover:text-brand-green dark:border-zinc-700 dark:text-zinc-200"
              }`}
            >
              <AudioLines className={`h-4 w-4 ${conversationMode ? "animate-pulse" : ""}`} />
              {conversationMode ? "Pausar conversación por voz" : "Iniciar conversación por voz"}
            </button>
            {messages.length <= 2 && !conversationMode && (
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
                  listening || voicePhase === "speaking"
                    ? "border-red-300 bg-red-50 text-red-600 dark:border-red-800 dark:bg-red-950/30"
                    : "border-navy-200 text-navy-600 hover:border-brand-green/50 hover:text-brand-green dark:border-zinc-700 dark:text-zinc-300"
                }`}
                aria-label={voicePhase === "speaking" ? "Interrumpir y hablar" : listening ? "Pausar conversación" : "Hablar con el asistente"}
                title={voicePhase === "speaking" ? "Interrumpir y hablar" : undefined}
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
                placeholder={listening ? "Te escucho…" : voicePhase === "speaking" ? "Pulsa el micrófono para interrumpirme" : "Pregunta cómo hacer algo…"}
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
        onClick={() => {
          const nextOpen = !openRef.current;
          openRef.current = nextOpen;
          setOpen(nextOpen);
          if (!nextOpen) stopConversation();
        }}
        className="ml-auto flex h-14 items-center gap-2 rounded-full bg-navy-900 px-4 font-bold text-white shadow-xl transition hover:-translate-y-0.5 hover:bg-navy-800 dark:border dark:border-zinc-700 dark:bg-zinc-800"
        aria-label={open ? "Cerrar Guía ENLAZE" : "Abrir Guía ENLAZE"}
      >
        <Bot className="h-5 w-5 text-brand-green" />
        <span className="text-sm">Ayuda IA</span>
        {conversationMode && <span className="h-2 w-2 animate-pulse rounded-full bg-brand-green" aria-hidden="true" />}
      </button>
    </div>
  );
}
