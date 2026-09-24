import "server-only";
import Stripe from "stripe";

let cached: Stripe | null = null;

/**
 * Cliente de Stripe, creado bajo demanda (nunca al evaluar el módulo, para no
 * romper el build donde falte la clave). Devuelve null si no hay clave.
 *
 * Vale una clave secreta (`sk_`) o, mejor, una restringida (`rk_`).
 * Mientras no exista entidad legal solo se admiten claves de prueba: una
 * clave `*_live_` se rechaza salvo que se active a propósito STRIPE_LIVE_MODE=1.
 */
export function getStripe(): Stripe | null {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (isLiveKey(key) && process.env.STRIPE_LIVE_MODE !== "1") {
    console.error("[stripe] Clave real rechazada: Enlaze está en modo prueba (STRIPE_LIVE_MODE no es 1).");
    return null;
  }
  cached = new Stripe(key);
  return cached;
}

export function isLiveKey(key: string): boolean {
  return key.startsWith("sk_live_") || key.startsWith("rk_live_");
}
