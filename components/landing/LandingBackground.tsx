"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

// WebGL solo en el navegador y fuera del primer paquete de la página.
const WebThreads = dynamic(() => import("@/components/react-bits/WebThreads"), { ssr: false });

const GREEN = "#00c896";
/** El mismo verde aclarado con un 40 % de blanco: menta. */
const MINT = "#66dec0";

/** Opacidad del fondo con la portada a la vista y en el resto de la página. */
export const OPACITY = { hero: 0.4, rest: 0.07 } as const;

/** Opacidad según cuánto se ha bajado: de `hero` a `rest` mientras sale la portada. */
export function backgroundOpacity(scrollY: number, heroHeight: number) {
  const t = Math.min(1, Math.max(0, scrollY / Math.max(heroHeight * 0.8, 1)));
  return OPACITY.hero + (OPACITY.rest - OPACITY.hero) * t;
}

/**
 * Ajustes de Web Threads. En el móvil, versión ligera: menos hilos, resolución 1
 * y sin seguir al dedo, para que vaya fluido en gama media.
 */
export function threadSettings(mobile: boolean) {
  return mobile
    ? { threadCount: 3, dpr: 1, mouseInteraction: false }
    : { threadCount: 5, dpr: 1.5, mouseInteraction: true };
}

/**
 * Fondo fijo de hilos detrás de toda la landing (el <main> lleva `isolate`). Más
 * visible en la portada y muy tenue al bajar. La pausa con la pestaña oculta y el
 * fotograma quieto con «reducir movimiento» los hace ya WebThreads.
 */
export default function LandingBackground({ heroId = "portada" }: { heroId?: string }) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [mobile, setMobile] = useState<boolean | null>(null);

  useEffect(() => {
    setMobile(window.matchMedia("(max-width: 767px)").matches);
  }, []);

  useEffect(() => {
    if (mobile === null) return;
    let raf = 0;
    const apply = () => {
      raf = 0;
      const hero = document.getElementById(heroId);
      const layer = layerRef.current;
      if (!layer) return;
      layer.style.opacity = String(backgroundOpacity(window.scrollY, hero?.offsetHeight ?? window.innerHeight));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [mobile, heroId]);

  if (mobile === null) return null;

  return (
    <div
      ref={layerRef}
      aria-hidden="true"
      data-fondo={mobile ? "hilos-movil" : "hilos"}
      className="pointer-events-none fixed inset-0 -z-10"
      style={{ opacity: OPACITY.hero }}
    >
      <WebThreads
        lightMode
        colors={[GREEN, MINT]}
        coreColor={GREEN}
        spread={0.22}
        speed={0.1}
        frequency={4}
        thickness={1}
        // El nudo (pinch) en el centro de la portada, que ocupa la parte alta de la pantalla.
        pinch={0.5}
        position={0.56}
        grain={0}
        pulseOnClick={false}
        {...threadSettings(mobile)}
      />
    </div>
  );
}
