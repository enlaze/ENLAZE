"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

// WebGL solo en el navegador y fuera del primer paquete de la página.
const WebThreads = dynamic(() => import("@/components/react-bits/WebThreads"), { ssr: false });
const GhostFibers = dynamic(() => import("@/components/react-bits/GhostFibers"), { ssr: false });

const NAVY = "#0f1b2d";
const GREEN = "#00c896";

/**
 * Fondos a prueba, para compararlos con ?fondo=threads|fibras|no.
 * `hero` es la opacidad con la portada a la vista; `rest`, la del resto de la página.
 */
export const BACKGROUNDS = {
  threads: { hero: 0.3, rest: 0.07 },
  fibras: { hero: 0.5, rest: 0.11 },
} as const;

export type BackgroundKind = keyof typeof BACKGROUNDS;

export function pickBackground(search: string): BackgroundKind | null {
  const value = new URLSearchParams(search).get("fondo");
  if (value === "no") return null;
  return value && value in BACKGROUNDS ? (value as BackgroundKind) : "threads";
}

/** Opacidad según cuánto se ha bajado: de `hero` a `rest` mientras sale la portada. */
export function backgroundOpacity(scrollY: number, heroHeight: number, kind: BackgroundKind) {
  const { hero, rest } = BACKGROUNDS[kind];
  const t = Math.min(1, Math.max(0, scrollY / Math.max(heroHeight * 0.8, 1)));
  return hero + (rest - hero) * t;
}

/**
 * Fondo fijo detrás de toda la landing (el <main> lleva `isolate`). Más visible en
 * la portada y muy tenue al bajar. La pausa con la pestaña oculta y el fotograma
 * quieto con «reducir movimiento» los hacen ya los dos componentes de React Bits.
 */
export default function LandingBackground({ heroId = "portada" }: { heroId?: string }) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [kind, setKind] = useState<BackgroundKind | null>(null);

  useEffect(() => {
    setKind(pickBackground(window.location.search));
  }, []);

  useEffect(() => {
    if (!kind) return;
    let raf = 0;
    const apply = () => {
      raf = 0;
      const hero = document.getElementById(heroId);
      const layer = layerRef.current;
      if (!layer) return;
      layer.style.opacity = String(backgroundOpacity(window.scrollY, hero?.offsetHeight ?? window.innerHeight, kind));
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
  }, [kind, heroId]);

  if (!kind) return null;

  return (
    <div
      ref={layerRef}
      aria-hidden="true"
      data-fondo={kind}
      className="pointer-events-none fixed inset-0 -z-10"
      style={{ opacity: BACKGROUNDS[kind].hero }}
    >
      {kind === "threads" ? (
        <WebThreads
          lightMode
          colors={[NAVY, GREEN]}
          coreColor={GREEN}
          threadCount={5}
          spread={0.22}
          speed={0.1}
          frequency={4}
          thickness={1}
          // El nudo (pinch) en el centro de la portada, que ocupa la parte alta de la pantalla.
          pinch={0.5}
          position={0.56}
          grain={0}
          pulseOnClick={false}
          dpr={1.5}
        />
      ) : (
        <GhostFibers
          lightMode
          glowColor={NAVY}
          secondaryColor={GREEN}
          lineColor={GREEN}
          gradient="depth"
          layers={3}
          threads={96}
          particles={0.2}
          dpr={1.5}
          fiberStyle="dots"
          twist={1}
          waves={0.65}
          volume={1.2}
          rotation={-4}
          thickness={1.2}
          depthOfField={0.45}
          speed={0.35}
          sparkle={0.2}
          grain={0}
          vignette={0.2}
          hoverEffect="focus"
          pulseOnClick={false}
        />
      )}
    </div>
  );
}
