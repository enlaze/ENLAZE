import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Autenticación por clave compartida (`Authorization: Bearer <secreto>`) para
 * las llamadas de n8n y demás procesos de sistema.
 *
 * Reglas, sin excepciones:
 *   · Sin la variable de entorno definida, NO se deja pasar a nadie: la ruta
 *     responde 500 y no procesa nada. Nunca "sin clave, pasa".
 *   · No hay valores por defecto escritos en el código.
 *   · La comparación es exacta y en tiempo constante (no `includes`).
 */
export type SharedSecret = "AGENT_API_KEY" | "WEBHOOK_SECRET";

function bearerToken(req: Request): string {
  const header = req.headers.get("authorization") || "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

function secretValue(name: SharedSecret): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function safeEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** ¿Trae la petición exactamente `Bearer <valor de la variable>`? Sin variable definida: false. */
export function bearerMatches(req: Request, name: SharedSecret): boolean {
  const expected = secretValue(name);
  const provided = bearerToken(req);
  return Boolean(expected && provided && safeEqual(provided, expected));
}

/**
 * Exige `Bearer <secreto>` con alguna de las variables indicadas.
 * Devuelve la respuesta de error (500 si ninguna está definida, 401 si no
 * coincide) o null si puede seguir.
 *
 *   const denied = requireBearer(req, "AGENT_API_KEY");
 *   if (denied) return denied;
 */
export function requireBearer(req: Request, ...names: SharedSecret[]): NextResponse | null {
  const configured = names.filter((name) => secretValue(name) !== null);
  if (configured.length === 0) {
    console.error(`[auth] ${names.join(" / ")} no está definida: ruta desactivada`);
    return NextResponse.json({ error: "Servicio no configurado" }, { status: 500 });
  }
  if (configured.some((name) => bearerMatches(req, name))) return null;
  return NextResponse.json({ error: "No autorizado" }, { status: 401 });
}
