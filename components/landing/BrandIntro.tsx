"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import ShaderBackground from "@/components/landing/ShaderBackground";

/* ─────────────────────────────────────────────────────────────────────
 *  BrandIntro — réplica 1:1 del logo-stage del HTML "Brand Intro" original.
 *
 *  Reproducimos textualmente el CSS del original para:
 *    · .logo-stage (centrado perfecto vía grid + place-items center)
 *    · .logo-wrap  (entry: opacity / scale / blur con cubic-bezier exactos)
 *    · .aura       (radial-gradient teal → blue → transparent, blur 28px)
 *    · .sheen + .sheen::after (sweep blanco diagonal sobre la silueta del logo)
 *
 *  Lo que NO incluimos del original (a propósito):
 *    · Shader background — ya lo aporta <ShaderBackground variant="dark" />
 *    · Base + grain + vignette + wordmark + tag + curtain + product UI
 *
 *  Timeline (idéntica al original):
 *    t=  40 ms : add .lit  → dispara aura (1100 ms / delay 200 ms),
 *                logo-wrap (900-1100 ms / delay 120 ms) y sheen (1400 ms / delay 600 ms)
 *    t=2000 ms : add .leaving → fade-out del overlay (400 ms)
 *    t=2400 ms : unmount completo del componente
 *
 *  Reglas de integración:
 *    · prefers-reduced-motion → no se monta nada
 *    · sessionStorage → sólo se reproduce una vez por sesión
 *    · SSR-safe: empieza en stage="hidden", no renderiza en servidor
 *    · Z-index 50 dentro del stacking del Hero (isolate en <section>)
 * ───────────────────────────────────────────────────────────────────── */

const STORAGE_KEY = "enlaze:brand-intro:played:v6";

export default function BrandIntro() {
  const [stage, setStage] = useState<"hidden" | "playing" | "leaving" | "done">(
    "hidden"
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    // a11y
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- a11y skip
      setStage("done");
      return;
    }

    // Sólo una vez por sesión
    let alreadyPlayed = false;
    try {
      alreadyPlayed = sessionStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      /* sessionStorage bloqueado */
    }
    if (alreadyPlayed) {
      setStage("done");
      return;
    }

    // Delay de arranque (150 ms) para dar tiempo a que el ShaderBackground
    // monte su contexto WebGL, compile shaders y pinte el primer frame.
    // En producción no se nota; en dev (React Strict Mode + HMR) evita el
    // "flash negro" porque el shader ya tiene contenido cuando entramos
    // a la fase .lit.
    const STARTUP_DELAY = 150;
    const TOTAL = STARTUP_DELAY + 2400;

    const litTimer = setTimeout(() => setStage("playing"), STARTUP_DELAY + 40);
    const leaveTimer = setTimeout(() => setStage("leaving"), STARTUP_DELAY + 2000);
    const doneTimer = setTimeout(() => {
      setStage("done");
      try {
        sessionStorage.setItem(STORAGE_KEY, "1");
      } catch {
        /* ignore */
      }
    }, TOTAL);

    return () => {
      clearTimeout(litTimer);
      clearTimeout(leaveTimer);
      clearTimeout(doneTimer);
    };
  }, []);

  if (stage === "hidden" || stage === "done") return null;

  // .lit se aplica desde "playing" en adelante (igual que en el JS original
  // donde applyState añade la clase a partir de t >= 0.04 s).
  // En este punto stage solo puede ser "playing" o "leaving" (los otros
  // dos terminan con un `return null` arriba).
  const rootClass = ["bi-root", "lit", stage === "leaving" ? "leaving" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div aria-hidden="true" className={rootClass}>
      {/* Base sólida #050b14 — mismo color que el body del HTML original.
          Sirve de "lienzo" antes de que el shader pinte su primer frame
          (~16 ms) y rellena los bordes que el shader pueda no cubrir. */}
      <div className="base" />

      {/* Backdrop animado — REUTILIZA <ShaderBackground /> (mismo componente
          que el Hero) en variant="dark". No es un canvas nuevo "ad-hoc": es
          exactamente el shader del proyecto. Vive sólo durante los 2.4 s
          de la intro y se desmonta con el componente. */}
      <div className="shader-host">
        <ShaderBackground variant="dark" />
      </div>

      {/* Grain — replica .grain del HTML original (mix-blend-mode overlay,
          fractal noise SVG, opacity 0 → 0.10 con .lit). */}
      <div className="grain" />

      {/* Vignette — replica .vignette del HTML original. */}
      <div className="vignette" />

      <div className="logo-stage">
        <div className="logo-wrap">
          <div className="aura" />
          <Image
            src="/logo.png"
            alt=""
            width={200}
            height={200}
            priority
            draggable={false}
            className="logo"
          />
          <span className="sheen" />
        </div>
      </div>

      <style jsx>{`
        /* ── Root: FIXED, viewport completo, encima de todo (header incluido).
              Replica position:fixed; inset:0 del .root original del HTML. ── */
        .bi-root {
          position: fixed;
          inset: 0;
          z-index: 9999;
          overflow: hidden;
          pointer-events: none;
          opacity: 1;
          transition: opacity 400ms cubic-bezier(0.4, 0, 0.2, 1);
        }
        .bi-root.leaving {
          opacity: 0;
        }

        /* Base sólida — fallback navy enriquecido. NUNCA puramente negro:
           si el shader tarda en pintar (dev mode), esto es lo que se ve. */
        .base {
          position: absolute;
          inset: 0;
          background:
            radial-gradient(
              ellipse at 30% 20%,
              rgba(0, 200, 150, 0.12),
              transparent 55%
            ),
            radial-gradient(
              ellipse at 70% 80%,
              rgba(8, 34, 69, 0.50),
              transparent 60%
            ),
            radial-gradient(
              80% 60% at 50% 50%,
              #0a1a2c 0%,
              #050b14 60%,
              #02060c 100%
            );
        }

        /* Shader host — visible desde el primer frame (opacity 0.85 fija).
           En el HTML original tenía un fade-in de 700 ms, pero en un entorno
           con React Strict Mode ese fade combinado con el delay de init de
           WebGL deja varios cientos de ms de canvas vacío visible.
           Mostrarlo ya con su opacidad final + el .base navy de abajo
           garantiza que nunca se vea negro. */
        .shader-host {
          position: absolute;
          inset: 0;
          opacity: 0.85;
        }
        /* El canvas interno del ShaderBackground necesita anclar al
           contenedor — lo posiciona él internamente como absolute inset-0. */

        /* Grain — fractalNoise SVG en mix-blend-mode overlay, igual que el
           HTML original. Aparece a 0.10 cuando entra .lit. */
        .grain {
          position: absolute;
          inset: 0;
          pointer-events: none;
          mix-blend-mode: overlay;
          opacity: 0;
          transition: opacity 800ms ease-out;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.45 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
        }
        .bi-root.lit .grain {
          opacity: 0.10;
        }

        /* Vignette — radial dark al borde, idéntica al original. */
        .vignette {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background: radial-gradient(
            70% 55% at 50% 50%,
            rgba(255, 255, 255, 0) 50%,
            rgba(0, 0, 0, 0.55) 100%
          );
        }

        /* ── Logo stage — centrado perfecto vía grid + place-items ── */
        .logo-stage {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
        }

        .logo-wrap {
          position: relative;
          width: 220px;
          height: 220px;
          display: grid;
          place-items: center;
          opacity: 0;
          transform: scale(0.92);
          filter: blur(6px);
          transition:
            opacity 900ms cubic-bezier(0.22, 0.7, 0.18, 1) 120ms,
            transform 1100ms cubic-bezier(0.22, 0.7, 0.18, 1) 120ms,
            filter 900ms cubic-bezier(0.22, 0.7, 0.18, 1) 120ms;
        }
        .bi-root.lit .logo-wrap {
          opacity: 1;
          transform: scale(1);
          filter: blur(0);
        }

        /* ── Aura — radial teal → blue → transparent, blur 28px ── */
        .aura {
          position: absolute;
          inset: -40%;
          background: radial-gradient(
            closest-side,
            rgba(20, 184, 166, 0.3),
            rgba(37, 99, 235, 0.18) 45%,
            rgba(0, 0, 0, 0) 70%
          );
          filter: blur(28px);
          opacity: 0;
          transition: opacity 1100ms ease-out 200ms;
        }
        .bi-root.lit .aura {
          opacity: 1;
        }

        /* ── Logo image — drop-shadow doble teal+blue ── */
        .logo-wrap :global(.logo) {
          width: 200px !important;
          height: 200px !important;
          object-fit: contain;
          filter:
            drop-shadow(0 14px 40px rgba(20, 184, 166, 0.35))
            drop-shadow(0 4px 16px rgba(37, 99, 235, 0.3));
          will-change: transform, filter;
        }

        /* ── Sheen — sweep blanco enmascarado por la silueta del logo ── */
        .sheen {
          position: absolute;
          inset: 0;
          pointer-events: none;
          border-radius: 24px;
          overflow: hidden;
          -webkit-mask: url("/logo.png") center / contain no-repeat;
          mask: url("/logo.png") center / contain no-repeat;
        }
        .sheen::after {
          content: "";
          position: absolute;
          top: -20%;
          bottom: -20%;
          width: 35%;
          left: -45%;
          background: linear-gradient(
            100deg,
            rgba(255, 255, 255, 0) 0%,
            rgba(255, 255, 255, 0.55) 50%,
            rgba(255, 255, 255, 0) 100%
          );
          transform: skewX(-18deg);
          filter: blur(6px);
          opacity: 0;
        }
        .bi-root.lit .sheen::after {
          animation: bi-sheenSweep 1400ms cubic-bezier(0.4, 0.1, 0.2, 1) 600ms 1
            forwards;
        }
        @keyframes bi-sheenSweep {
          0% {
            left: -45%;
            opacity: 0;
          }
          20% {
            opacity: 1;
          }
          80% {
            opacity: 1;
          }
          100% {
            left: 130%;
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
