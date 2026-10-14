import "server-only";
import { Resend } from "resend";
import Anthropic from "@anthropic-ai/sdk";

// Next importa los módulos al recopilar datos del build. Los clientes solo
// se crean cuando una petición los necesita, y se reutilizan en el proceso.
let resend: Resend | null = null;
let anthropic: Anthropic | null = null;

export function getResend(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY no está configurada");
  return (resend ??= new Resend(key));
}

export function getAnthropic(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY no está configurada");
  return (anthropic ??= new Anthropic({ apiKey: key }));
}
