"use client";

import { useEffect, useRef } from "react";

export default function HowItWorks() {
  const stageRef = useRef<HTMLDivElement>(null);
  const coreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stage = stageRef.current;
    const core = coreRef.current;
    if (!stage || !core) return;

    const cards = stage.querySelectorAll<HTMLElement>(".step-card");
    const onEnter = () => core.classList.add("react");
    const onLeave = () => core.classList.remove("react");

    cards.forEach((c) => {
      c.addEventListener("mouseenter", onEnter);
      c.addEventListener("mouseleave", onLeave);
    });
    return () => {
      cards.forEach((c) => {
        c.removeEventListener("mouseenter", onEnter);
        c.removeEventListener("mouseleave", onLeave);
      });
    };
  }, []);

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />

      <section className="hiw-section" id="como-funciona">
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">
              <span className="dot" /> Cómo funciona
            </span>
            <h2>
              <em>Empezar es más fácil que lo que haces ahora</em>
            </h2>
            <p className="lede">
              Tres pasos. Ni formaciones de dos días, ni consultores, ni
              manuales de 80 páginas.
            </p>
          </div>

          {/* CINEMATIC STAGE */}
          <div className="stage" ref={stageRef}>
            <span className="side-label left">
              <span className="ln" /> Entrada
            </span>
            <span className="side-label right">
              Salida <span className="ln" />
            </span>

            {/* Connecting paths */}
            <svg
              className="flow"
              viewBox="0 0 1280 520"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="lgIn" x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0" />
                  <stop offset="40%" stopColor="#10b981" stopOpacity=".75" />
                  <stop offset="100%" stopColor="#22d3ee" stopOpacity=".95" />
                </linearGradient>
                <linearGradient id="lgOut" x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0%" stopColor="#22d3ee" stopOpacity=".95" />
                  <stop offset="60%" stopColor="#10b981" stopOpacity=".75" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                </linearGradient>
              </defs>

              {/* INPUT paths (left -> core@640,260) */}
              <path id="p1in" className="track" d="M 200,95 C 360,95 480,200 640,260" />
              <path id="p1g" className="glow" d="M 200,95 C 360,95 480,200 640,260" stroke="url(#lgIn)" />
              <path id="p2in" className="track" d="M 200,260 C 360,260 460,260 640,260" />
              <path id="p2g" className="glow" d="M 200,260 C 360,260 460,260 640,260" stroke="url(#lgIn)" />
              <path id="p3in" className="track" d="M 200,425 C 360,425 480,320 640,260" />
              <path id="p3g" className="glow" d="M 200,425 C 360,425 480,320 640,260" stroke="url(#lgIn)" />

              {/* OUTPUT paths (core -> right) */}
              <path id="o1" className="track" d="M 640,260 C 800,200 920,95 1080,95" />
              <path className="glow" d="M 640,260 C 800,200 920,95 1080,95" stroke="url(#lgOut)" />
              <path id="o2" className="track" d="M 640,260 C 820,260 920,260 1080,260" />
              <path className="glow" d="M 640,260 C 820,260 920,260 1080,260" stroke="url(#lgOut)" />
              <path id="o3" className="track" d="M 640,260 C 800,320 920,425 1080,425" />
              <path className="glow" d="M 640,260 C 800,320 920,425 1080,425" stroke="url(#lgOut)" />

              {/* Particles, slow */}
              <circle className="pkt" r="2.4">
                <animateMotion dur="5s" repeatCount="indefinite" rotate="auto">
                  <mpath href="#p1in" />
                </animateMotion>
              </circle>
              <circle className="pkt" r="2" opacity=".6">
                <animateMotion dur="5s" begin="-2s" repeatCount="indefinite" rotate="auto">
                  <mpath href="#p1in" />
                </animateMotion>
              </circle>
              <circle className="pkt" r="2.4">
                <animateMotion dur="4.2s" repeatCount="indefinite" rotate="auto">
                  <mpath href="#p2in" />
                </animateMotion>
              </circle>
              <circle className="pkt" r="2" opacity=".6">
                <animateMotion dur="4.2s" begin="-2s" repeatCount="indefinite" rotate="auto">
                  <mpath href="#p2in" />
                </animateMotion>
              </circle>
              <circle className="pkt" r="2.4">
                <animateMotion dur="5s" begin="-1s" repeatCount="indefinite" rotate="auto">
                  <mpath href="#p3in" />
                </animateMotion>
              </circle>
              <circle className="pkt" r="2" opacity=".6">
                <animateMotion dur="5s" begin="-3s" repeatCount="indefinite" rotate="auto">
                  <mpath href="#p3in" />
                </animateMotion>
              </circle>

              <circle className="pkt cy" r="2.4">
                <animateMotion dur="5s" repeatCount="indefinite" rotate="auto">
                  <mpath href="#o1" />
                </animateMotion>
              </circle>
              <circle className="pkt cy" r="2" opacity=".6">
                <animateMotion dur="5s" begin="-2.4s" repeatCount="indefinite" rotate="auto">
                  <mpath href="#o1" />
                </animateMotion>
              </circle>
              <circle className="pkt cy" r="2.4">
                <animateMotion dur="4.2s" begin="-.5s" repeatCount="indefinite" rotate="auto">
                  <mpath href="#o2" />
                </animateMotion>
              </circle>
              <circle className="pkt cy" r="2" opacity=".6">
                <animateMotion dur="4.2s" begin="-2.6s" repeatCount="indefinite" rotate="auto">
                  <mpath href="#o2" />
                </animateMotion>
              </circle>
              <circle className="pkt cy" r="2.4">
                <animateMotion dur="5s" begin="-1s" repeatCount="indefinite" rotate="auto">
                  <mpath href="#o3" />
                </animateMotion>
              </circle>
              <circle className="pkt cy" r="2" opacity=".6">
                <animateMotion dur="5s" begin="-3s" repeatCount="indefinite" rotate="auto">
                  <mpath href="#o3" />
                </animateMotion>
              </circle>
            </svg>

            {/* INPUT CHIPS (left -> core) */}
            <div className="chip in c1">
              <div className="badge" style={{ background: "#25d366" }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <path d="M20 12a8 8 0 1 0-14.9 4.1L4 20l4-1.05A8 8 0 0 0 20 12Z" stroke="#06241a" strokeWidth="1.6" />
                  <path d="M9 9.5c.2-.6.6-.8 1-.8.3 0 .6 0 .8.5l.5 1.1c.1.3 0 .5-.2.7l-.4.4c-.1.1-.2.3 0 .5.4.7 1 1.3 1.7 1.7.2.1.3 0 .4 0l.4-.4c.2-.2.4-.3.7-.2l1.1.5c.5.2.5.5.5.8 0 .4-.2.8-.8 1-1 .4-2.5 0-4.1-1.6S8.6 10.5 9 9.5Z" fill="#06241a" />
                </svg>
              </div>
              <div>
                <strong>WhatsApp</strong>
                <div className="small">&quot;¿Me pasáis precio?&quot;</div>
              </div>
            </div>

            <div className="chip in c2">
              <div
                className="badge"
                style={{ background: "linear-gradient(180deg,#22d3ee,#06b6d4)", color: "#04212a" }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="5" width="18" height="14" rx="2" stroke="#04212a" strokeWidth="1.6" />
                  <path d="m4 7 8 6 8-6" stroke="#04212a" strokeWidth="1.6" />
                </svg>
              </div>
              <div>
                <strong>Email entrante</strong>
                <div className="small">presupuesto@enlaze.app</div>
              </div>
            </div>

            <div className="chip in c3">
              <div
                className="badge"
                style={{ background: "linear-gradient(180deg,#34d39a,#10b981)", color: "#06241a" }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <path d="M5 4h3l2 4-2 1c.7 2.3 2.7 4.3 5 5l1-2 4 2v3c0 1-.7 1.7-1.7 1.7C9.7 19 5 14.3 5 6.7 5 5.7 5.7 5 5 5Z" stroke="#06241a" strokeWidth="1.6" strokeLinejoin="round" />
                  <path d="M16 4l4 4M16 8l4-4" stroke="#06241a" strokeWidth="1.6" />
                </svg>
              </div>
              <div>
                <strong>Llamada perdida</strong>
                <div className="small">+34 612 ··· 47</div>
              </div>
            </div>

            {/* CORE */}
            <div className="core" ref={coreRef} aria-hidden="true">
              <div className="ring r3" />
              <div className="ring r2" />
              <div className="ring" />
              <div className="heartbeat" />
              <div className="heartbeat b" />
              <div className="orb">
                <div className="glyph">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
                    <path d="M5 12c2.5-4 4.5-6 7-6s4.5 2 7 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M5 12c2.5 4 4.5 6 7 6s4.5-2 7-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <circle cx="12" cy="12" r="2" fill="currentColor" />
                  </svg>
                </div>
              </div>
            </div>

            {/* OUTPUT CHIPS (core -> right) */}
            <div className="chip out c1">
              <div
                className="badge"
                style={{ background: "linear-gradient(180deg,#34d39a,#10b981)", color: "#06241a" }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <path d="M14 3v5h5" stroke="#06241a" strokeWidth="1.6" />
                  <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-5Z" stroke="#06241a" strokeWidth="1.6" />
                </svg>
              </div>
              <div>
                <strong>Presupuesto generado</strong>
                <div className="small">#2418 · 1.840 €</div>
              </div>
              <span className="check">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                  <path d="m5 12 5 5 9-11" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </div>

            <div className="chip out c2">
              <div
                className="badge"
                style={{ background: "linear-gradient(180deg,#22d3ee,#06b6d4)", color: "#04212a" }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <path d="m3 11 18-8-8 18-2-8-8-2Z" stroke="#04212a" strokeWidth="1.6" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <strong>Seguimiento enviado</strong>
                <div className="small">+2 días · automático</div>
              </div>
              <span className="check">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                  <path d="m5 12 5 5 9-11" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </div>

            <div className="chip out c3">
              <div
                className="badge"
                style={{ background: "linear-gradient(180deg,#34d39a,#10b981)", color: "#06241a" }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <circle cx="9" cy="8" r="3" stroke="#06241a" strokeWidth="1.6" />
                  <path d="M3 19c.6-2.7 3-4 6-4s5.4 1.3 6 4" stroke="#06241a" strokeWidth="1.6" strokeLinecap="round" />
                  <path d="M17 8v6M14 11h6" stroke="#06241a" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </div>
              <div>
                <strong>Cliente añadido</strong>
                <div className="small">Marta · Reforma cocina</div>
              </div>
              <span className="check">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                  <path d="m5 12 5 5 9-11" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </div>
          </div>

          {/* STEPS — secondary row */}
          <div className="steps">
            <article className="step-card" data-step="1">
              <div className="row">
                <span className="num">
                  <b>PASO</b>01
                </span>
                <div className="ico">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>
              </div>
              <h3>Conecta tu WhatsApp y tu email</h3>
              <p>
                Dos minutos, sin instalar nada. Enlaze entra como un miembro
                más del equipo, con tu número y tu dirección de siempre.
              </p>
            </article>

            <article className="step-card" data-step="2">
              <div className="row">
                <span className="num">
                  <b>PASO</b>02
                </span>
                <div className="ico">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.8" />
                    <circle cx="17" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.8" />
                    <path d="M3 19c.6-2.7 3-4 6-4s5.4 1.3 6 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    <path d="M14.5 19c.4-1.6 2-2.6 4-2.6s3.6 1 4 2.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </div>
              </div>
              <h3>Importa tus clientes y tus precios</h3>
              <p>
                Sube tu lista en un Excel o pégala directamente. Enlaze aprende
                cómo presupuestas para que cada documento salga como lo harías
                tú.
              </p>
            </article>

            <article className="step-card" data-step="3">
              <div className="row">
                <span className="num">
                  <b>PASO</b>03
                </span>
                <div className="ico">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
                  </svg>
                </div>
              </div>
              <h3>Respira. A partir de aquí, el sistema trabaja</h3>
              <p>
                Contesta a tus clientes, manda presupuestos el mismo día y
                hace el seguimiento solo. Tú te dedicas al servicio. Enlaze
                cierra la venta.
              </p>
            </article>
          </div>
        </div>

        <style jsx>{`
          .hiw-section {
            --bg: #020617;
            --bg-deep: #000000;
            --ink: #eef2f7;
            --ink-2: #aab4c2;
            --ink-3: #6b7686;
            --ink-4: #4a5564;
            --emerald: #10b981;
            --emerald-2: #34d39a;
            --cyan: #06b6d4;
            --cyan-2: #22d3ee;

            position: relative;
            overflow: hidden;
            padding: 160px 24px 180px;
            background: var(--bg);
            isolation: isolate;
            color: var(--ink);
            font-family: "Geist", ui-sans-serif, system-ui, -apple-system,
              "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            -webkit-font-smoothing: antialiased;
            text-rendering: optimizeLegibility;
          }
          .hiw-section :global(*) {
            box-sizing: border-box;
          }
          /* very soft central pool */
          .hiw-section::before {
            content: "";
            position: absolute;
            inset: 0;
            pointer-events: none;
            background:
              radial-gradient(50% 45% at 50% 55%, rgba(16, 185, 129, 0.08), transparent 65%),
              radial-gradient(35% 30% at 50% 55%, rgba(6, 182, 212, 0.06), transparent 70%);
          }
          /* fine grain */
          .hiw-section::after {
            content: "";
            position: absolute;
            inset: 0;
            pointer-events: none;
            opacity: 0.05;
            mix-blend-mode: overlay;
            background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
          }
          .wrap {
            max-width: 1280px;
            margin: 0 auto;
            position: relative;
            z-index: 2;
          }

          /* HEAD */
          .eyebrow {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            color: var(--emerald);
            font-family: "Geist Mono", monospace;
            font-size: 11px;
            letter-spacing: 0.24em;
            text-transform: uppercase;
            padding: 6px 12px;
            border: 1px solid rgba(16, 185, 129, 0.22);
            border-radius: 999px;
            background: rgba(16, 185, 129, 0.04);
          }
          .eyebrow .dot {
            width: 5px;
            height: 5px;
            border-radius: 999px;
            background: var(--emerald);
            box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.12),
              0 0 12px rgba(16, 185, 129, 0.7);
            animation: hiw-pulse 2.4s ease-in-out infinite;
          }
          @keyframes hiw-pulse {
            0%, 100% { opacity: 0.6; }
            50% { opacity: 1; }
          }

          .head {
            text-align: center;
            max-width: 880px;
            margin: 0 auto 80px;
          }
          h2 {
            font-size: clamp(40px, 5vw, 60px);
            line-height: 1.04;
            letter-spacing: -0.025em;
            margin: 22px 0 16px;
            font-weight: 600;
            color: var(--ink);
            text-wrap: balance;
          }
          h2 em {
            font-style: normal;
            background: linear-gradient(180deg, #f7faf8 0%, #c2cdda 100%);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
          }
          .lede {
            color: var(--ink-3);
            font-size: 16px;
            max-width: 540px;
            margin: 0 auto;
          }

          /* CINEMATIC STAGE ==================================================== */
          .stage {
            position: relative;
            height: 520px;
            margin-bottom: 60px;
          }

          /* Lateral labels */
          .side-label {
            position: absolute;
            top: 50%;
            transform: translateY(-50%);
            font-family: "Geist Mono", monospace;
            font-size: 10px;
            letter-spacing: 0.28em;
            text-transform: uppercase;
            color: var(--ink-4);
            display: flex;
            align-items: center;
            gap: 10px;
            z-index: 2;
          }
          .side-label .ln {
            width: 28px;
            height: 1px;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.18));
          }
          .side-label.left { left: 0; }
          .side-label.right {
            right: 0;
            flex-direction: row-reverse;
          }
          .side-label.right .ln {
            background: linear-gradient(270deg, transparent, rgba(255, 255, 255, 0.18));
          }

          /* SVG flow */
          .flow {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 1;
          }
          .flow :global(.track) {
            stroke: rgba(255, 255, 255, 0.07);
            stroke-width: 1;
            fill: none;
          }
          .flow :global(.glow) {
            fill: none;
            stroke-width: 1.4;
            transition: stroke-width 0.5s, opacity 0.5s;
            opacity: 0.7;
          }
          .flow :global(.pkt) {
            fill: var(--emerald-2);
            filter: drop-shadow(0 0 4px var(--emerald))
              drop-shadow(0 0 10px rgba(16, 185, 129, 0.5));
          }
          .flow :global(.pkt.cy) {
            fill: var(--cyan-2);
            filter: drop-shadow(0 0 4px var(--cyan))
              drop-shadow(0 0 10px rgba(6, 182, 212, 0.5));
          }

          /* CORE =============================================================== */
          .core {
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            width: 220px;
            height: 220px;
            z-index: 5;
          }
          .core .ring {
            position: absolute;
            inset: 0;
            border-radius: 50%;
            border: 1px solid rgba(255, 255, 255, 0.06);
            animation: hiw-rot 28s linear infinite;
          }
          .core .ring.r2 {
            inset: -32px;
            border: 1px dashed rgba(16, 185, 129, 0.18);
            animation: hiw-rot 36s linear infinite reverse;
          }
          .core .ring.r3 {
            inset: -72px;
            border-color: rgba(255, 255, 255, 0.04);
          }
          @keyframes hiw-rot {
            to { transform: rotate(360deg); }
          }

          .core .heartbeat {
            position: absolute;
            inset: 0;
            border-radius: 50%;
            border: 1px solid rgba(16, 185, 129, 0.55);
            animation: hiw-beat 4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
          }
          .core .heartbeat.b {
            animation-delay: -2s;
            border-color: rgba(6, 182, 212, 0.45);
          }
          @keyframes hiw-beat {
            0% { transform: scale(1); opacity: 0.6; }
            70% { transform: scale(1.7); opacity: 0; }
            100% { transform: scale(1.7); opacity: 0; }
          }

          .core .orb {
            position: absolute;
            inset: 22px;
            border-radius: 50%;
            background:
              radial-gradient(circle at 50% 32%, rgba(52, 211, 154, 0.55), rgba(6, 182, 212, 0.16) 50%, transparent 75%),
              linear-gradient(180deg, #0c2335, #050d18);
            border: 1px solid rgba(255, 255, 255, 0.1);
            box-shadow:
              inset 0 1px 0 rgba(255, 255, 255, 0.07),
              inset 0 0 60px rgba(6, 182, 212, 0.16),
              0 0 0 1px rgba(16, 185, 129, 0.14),
              0 0 80px rgba(16, 185, 129, 0.25),
              0 0 160px rgba(6, 182, 212, 0.14);
            display: grid;
            place-items: center;
            overflow: hidden;
            animation: hiw-breathe 4s ease-in-out infinite;
          }
          .core .orb::before {
            content: "";
            position: absolute;
            inset: -2px;
            background: conic-gradient(from 0deg, transparent 0 60%, rgba(16, 185, 129, 0.5) 70%, transparent 80%);
            filter: blur(8px);
            animation: hiw-rot 8s linear infinite;
            opacity: 0.55;
          }
          @keyframes hiw-breathe {
            0%, 100% {
              box-shadow:
                inset 0 1px 0 rgba(255, 255, 255, 0.07),
                inset 0 0 60px rgba(6, 182, 212, 0.14),
                0 0 0 1px rgba(16, 185, 129, 0.12),
                0 0 70px rgba(16, 185, 129, 0.22),
                0 0 140px rgba(6, 182, 212, 0.1);
            }
            50% {
              box-shadow:
                inset 0 1px 0 rgba(255, 255, 255, 0.09),
                inset 0 0 70px rgba(6, 182, 212, 0.22),
                0 0 0 1px rgba(16, 185, 129, 0.2),
                0 0 100px rgba(16, 185, 129, 0.36),
                0 0 180px rgba(6, 182, 212, 0.18);
            }
          }
          .core.react .orb {
            box-shadow:
              inset 0 1px 0 rgba(255, 255, 255, 0.1),
              inset 0 0 80px rgba(6, 182, 212, 0.28),
              0 0 0 1px rgba(16, 185, 129, 0.28),
              0 0 120px rgba(16, 185, 129, 0.45),
              0 0 200px rgba(6, 182, 212, 0.25);
            transition: box-shadow 0.5s ease;
          }
          .core .glyph {
            position: relative;
            z-index: 2;
            width: 72px;
            height: 72px;
            display: grid;
            place-items: center;
            color: #0a1929;
            background: linear-gradient(180deg, #34d39a, #10b981);
            border-radius: 20px;
            box-shadow: 0 12px 32px rgba(16, 185, 129, 0.45),
              inset 0 1px 0 rgba(255, 255, 255, 0.4);
          }
          .core .label {
            position: absolute;
            left: 50%;
            top: -32px;
            transform: translateX(-50%);
            color: var(--ink-3);
            font-size: 10px;
            letter-spacing: 0.28em;
            text-transform: uppercase;
            font-family: "Geist Mono", monospace;
            white-space: nowrap;
          }
          .core .label b {
            color: var(--emerald);
            font-weight: 500;
            opacity: 0.9;
          }

          /* FLOATING CHIPS — inputs (left) + outputs (right) ==================== */
          .chip {
            position: absolute;
            z-index: 4;
            background: rgba(8, 16, 28, 0.78);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 12px;
            padding: 9px 12px;
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            box-shadow:
              inset 0 1px 0 rgba(255, 255, 255, 0.05),
              0 18px 36px -16px rgba(0, 0, 0, 0.7);
            color: var(--ink);
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 10px;
            min-width: 180px;
            will-change: transform, opacity;
          }
          .chip .badge {
            width: 24px;
            height: 24px;
            border-radius: 7px;
            display: grid;
            place-items: center;
            flex-shrink: 0;
          }
          .chip .small {
            font-family: "Geist Mono", monospace;
            font-size: 10px;
            color: var(--ink-3);
            margin-top: 2px;
          }
          .chip strong {
            font-weight: 500;
            font-size: 12.5px;
            color: var(--ink);
          }
          .chip .check {
            margin-left: auto;
            width: 18px;
            height: 18px;
            border-radius: 50%;
            background: rgba(16, 185, 129, 0.16);
            border: 1px solid rgba(16, 185, 129, 0.45);
            color: var(--emerald);
            display: grid;
            place-items: center;
            box-shadow: 0 0 12px rgba(16, 185, 129, 0.35);
          }

          /* INPUT chips animate from left toward core, then fade */
          .chip.in {
            left: 7%;
            animation: hiw-inflow 9s cubic-bezier(0.55, 0.05, 0.35, 1) infinite;
            opacity: 0;
          }
          .chip.in.c1 { top: 18%; animation-delay: 0s; }
          .chip.in.c2 { top: 46%; animation-delay: -3s; }
          .chip.in.c3 { top: 72%; animation-delay: -6s; }

          @keyframes hiw-inflow {
            0%   { transform: translateX(-30px) scale(0.94); opacity: 0; filter: blur(2px); }
            12%  { transform: translateX(0) scale(1);        opacity: 1; filter: blur(0); }
            62%  { transform: translateX(220px) scale(0.96); opacity: 0.85; filter: blur(0); }
            78%  { transform: translateX(310px) scale(0.7);  opacity: 0; filter: blur(4px); }
            100% { transform: translateX(310px) scale(0.7);  opacity: 0; filter: blur(4px); }
          }

          /* OUTPUT chips emerge from core toward right */
          .chip.out {
            right: 7%;
            animation: hiw-outflow 9s cubic-bezier(0.55, 0.05, 0.35, 1) infinite;
            opacity: 0;
          }
          .chip.out.c1 { top: 18%; animation-delay: -1.5s; }
          .chip.out.c2 { top: 46%; animation-delay: -4.5s; }
          .chip.out.c3 { top: 72%; animation-delay: -7.5s; }

          @keyframes hiw-outflow {
            0%   { transform: translateX(310px) scale(0.7);  opacity: 0; filter: blur(4px); }
            18%  { transform: translateX(220px) scale(0.96); opacity: 0; filter: blur(2px); }
            35%  { transform: translateX(0) scale(1);        opacity: 1; filter: blur(0); }
            78%  { transform: translateX(-30px) scale(0.96); opacity: 0.85; filter: blur(0); }
            92%  { transform: translateX(-30px) scale(0.94); opacity: 0; filter: blur(2px); }
            100% { transform: translateX(-30px) scale(0.94); opacity: 0; filter: blur(2px); }
          }

          /* STEPS — secondary row ============================================= */
          .steps {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 18px;
            position: relative;
            z-index: 6;
          }
          .step-card {
            position: relative;
            border-radius: 16px;
            padding: 18px 20px;
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.025), rgba(255, 255, 255, 0.008));
            border: 1px solid rgba(255, 255, 255, 0.06);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            box-shadow:
              inset 0 1px 0 rgba(255, 255, 255, 0.04),
              0 18px 36px -22px rgba(0, 0, 0, 0.6);
            transition: transform 0.5s cubic-bezier(0.2, 0.7, 0.2, 1),
              border-color 0.4s, box-shadow 0.5s;
            cursor: default;
          }
          .step-card:hover {
            transform: translateY(-4px);
            border-color: rgba(16, 185, 129, 0.3);
            box-shadow:
              inset 0 1px 0 rgba(255, 255, 255, 0.07),
              0 24px 48px -20px rgba(0, 0, 0, 0.7),
              0 0 0 1px rgba(16, 185, 129, 0.1),
              0 14px 40px -10px rgba(16, 185, 129, 0.2);
          }
          .step-card .row {
            display: flex;
            align-items: center;
            gap: 12px;
          }
          .step-card .num {
            color: var(--emerald);
            font-family: "Geist Mono", monospace;
            font-size: 11px;
            letter-spacing: 0.24em;
          }
          .step-card .num b {
            color: var(--emerald);
            font-weight: 500;
            opacity: 0.5;
            margin-right: 6px;
          }
          .step-card .ico {
            width: 32px;
            height: 32px;
            border-radius: 9px;
            display: grid;
            place-items: center;
            background: linear-gradient(180deg, rgba(16, 185, 129, 0.15), rgba(16, 185, 129, 0.03));
            color: var(--emerald);
            border: 1px solid rgba(16, 185, 129, 0.2);
            margin-left: auto;
            transition: box-shadow 0.4s;
          }
          .step-card:hover .ico {
            box-shadow: 0 0 22px rgba(16, 185, 129, 0.28);
          }
          .step-card h3 {
            margin: 14px 0 8px;
            font-size: 16px;
            letter-spacing: -0.005em;
            font-weight: 600;
            color: var(--ink);
          }
          .step-card p {
            margin: 0;
            color: var(--ink-3);
            font-size: 13.5px;
            line-height: 1.6;
          }

          /* hover lights up its inflow path + reacts core */
          .stage:has(.step-card[data-step="1"]:hover) .flow :global(#p1g),
          .stage:has(.step-card[data-step="2"]:hover) .flow :global(#p2g),
          .stage:has(.step-card[data-step="3"]:hover) .flow :global(#p3g) {
            stroke-width: 2.6;
            opacity: 1;
          }

          /* Responsive */
          @media (max-width: 1080px) {
            .stage { display: none; }
            .steps { grid-template-columns: 1fr; }
          }
        `}</style>
      </section>
    </>
  );
}
