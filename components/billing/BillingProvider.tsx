"use client";

/**
 * Estado del plan para todo el dashboard, y la red de seguridad de los
 * bloqueos.
 *
 * El muro de pago puede parar una acción por dos caminos: el 402 de nuestras
 * rutas /api/* y el PT402 del trigger cuando se escribe directo contra
 * Supabase (que PostgREST también devuelve como HTTP 402). Los dos pasan por
 * `fetch`, así que aquí se observa cada respuesta 402 y se enseña el motivo en
 * palabras normales con un botón a los planes, venga de la pantalla que venga.
 *
 * Un formulario que ya enseña el bloqueo por su cuenta (p. ej. ClientForm)
 * llama a `claimBillingBlock()` para que no salga también el aviso flotante.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { blockMessage, parseBillingBlock } from "@/lib/billing-messages";
import type { BillingStatus } from "@/lib/billing-status";

export const PLANS_HREF = "/dashboard/settings/plan";

interface BillingContextValue {
  status: BillingStatus | null;
  loading: boolean;
  refresh: () => Promise<BillingStatus | null>;
}

const BillingContext = createContext<BillingContextValue>({
  status: null,
  loading: true,
  refresh: async () => null,
});

export function useBilling() {
  return useContext(BillingContext);
}

// Cuánto espera el aviso flotante a que un formulario diga «este lo enseño yo».
const CLAIM_WINDOW_MS = 600;
let claimedAt = 0;

/** El formulario que llama a esto enseña él mismo el bloqueo: no duplicar. */
export function claimBillingBlock() {
  claimedAt = Date.now();
}

function watchedUrl(url: string): boolean {
  try {
    const u = new URL(url, window.location.href);
    if (u.origin === window.location.origin) return u.pathname.startsWith("/api/");
    const supa = process.env.NEXT_PUBLIC_SUPABASE_URL;
    return !!supa && u.origin === new URL(supa).origin && u.pathname.startsWith("/rest/v1/");
  } catch {
    return false;
  }
}

export function BillingProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const router = useRouter();
  const lastToast = useRef({ at: 0, message: "" });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/billing/status", { cache: "no-store" });
      if (!res.ok) return null;
      const next = (await res.json()) as BillingStatus;
      setStatus(next);
      return next;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Carga inicial: el setState va dentro de `refresh`, tras el await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  // Red de seguridad: cualquier 402 del muro se explica en palabras normales.
  const showBlock = useRef<(body: unknown) => void>(() => {});
  useEffect(() => {
    showBlock.current = (body: unknown) => {
      const block = parseBillingBlock(body);
      if (!block) return;
      const seenAt = Date.now();
      setTimeout(() => {
        if (claimedAt >= seenAt - 50) return; // el formulario ya lo enseña
        // Una ráfaga (o un autoguardado que reintenta) da un solo aviso.
        const message = blockMessage(block);
        const last = lastToast.current;
        if (Date.now() - last.at < 2000 || (message === last.message && Date.now() - last.at < 20000)) return;
        lastToast.current = { at: Date.now(), message };
        toast.warning(message, {
          duration: 10000,
          action: { label: "Ver planes", onClick: () => router.push(PLANS_HREF) },
        });
      }, CLAIM_WINDOW_MS);
      refresh();
    };
  }, [toast, router, refresh]);

  useEffect(() => {
    const original = window.fetch;
    const wrapped: typeof window.fetch = async (input, init) => {
      const res = await original(input, init);
      if (res.status === 402) {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (watchedUrl(url)) {
          res.clone().json().then((body) => showBlock.current(body), () => {});
        }
      }
      return res;
    };
    window.fetch = wrapped;
    return () => {
      if (window.fetch === wrapped) window.fetch = original;
    };
  }, []);

  const value = useMemo(() => ({ status, loading, refresh }), [status, loading, refresh]);
  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
}
