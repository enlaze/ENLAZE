"use client";

import { useEffect, useRef, useState } from "react";

type Card = {
  title: string;
  body: string;
  svg: React.ReactNode;
};

const cards: Card[] = [
  {
    title:
      "Contestas a todos tus clientes en minutos, aunque estés fuera de la oficina",
    body:
      "WhatsApp y email automáticos. Las preguntas repetidas se responden solas. Las citas quedan confirmadas. Tú ni abres el móvil y el cliente ya sabe que estás al otro lado.",
    svg: (
      <svg viewBox="0 0 24 24">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
    ),
  },
  {
    title: "Envías el presupuesto el mismo día de la reunión",
    body:
      "Describes el servicio en lenguaje natural y la IA genera un presupuesto profesional con partidas, cantidades y precios en 30 segundos. Cero plantillas de Word. Cero cálculos a mano.",
    svg: (
      <svg viewBox="0 0 24 24">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
  },
  {
    title: "Ningún cliente se queda en el olvido",
    body:
      "Enlaze hace el seguimiento por ti. Recordatorios automáticos a los tres días, mensajes de cierre si la cosa se enfría, avisos cuando alguien contesta. Los presupuestos dejan de morir en silencio.",
    svg: (
      <svg viewBox="0 0 24 24">
        <polyline points="23 4 23 10 17 10" />
        <polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
      </svg>
    ),
  },
  {
    title: "Todo tu negocio cabe en un solo panel",
    body:
      "Clientes, proyectos, mensajes, presupuestos, facturas y operaciones. Un único sitio, todo conectado. Se acabaron las libretas sueltas y los «¿dónde lo tenía apuntado?».",
    svg: (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="4" />
        <line x1="12" y1="2" x2="12" y2="4" />
        <line x1="12" y1="20" x2="12" y2="22" />
        <line x1="2" y1="12" x2="4" y2="12" />
        <line x1="20" y1="12" x2="22" y2="12" />
      </svg>
    ),
  },
];

const tints = [
  { a: "rgba(16,185,129,0.10)", b: "rgba(16,185,129,0.05)" },
  { a: "rgba(59,130,246,0.09)", b: "rgba(16,185,129,0.05)" },
  { a: "rgba(168,85,247,0.08)", b: "rgba(16,185,129,0.05)" },
  { a: "rgba(245,158,11,0.08)", b: "rgba(16,185,129,0.06)" },
];

const HOLD_BEFORE = 0.2;
const STEP_LEN = 1.0;
const HOLD_AFTER = 0.8;

export default function SolucionSection() {
  const introRef = useRef<HTMLElement>(null);
  const storyRef = useRef<HTMLElement>(null);
  const cardRefs = useRef<Array<HTMLElement | null>>([]);
  const stepRefs = useRef<Array<HTMLDivElement | null>>([]);
  const lblIdxRef = useRef<HTMLElement>(null);
  const scrollCueRef = useRef<HTMLDivElement>(null);
  const blob1Ref = useRef<HTMLDivElement>(null);
  const blob2Ref = useRef<HTMLDivElement>(null);
  const tintRef = useRef<HTMLDivElement>(null);

  const [introIn, setIntroIn] = useState(false);

  useEffect(() => {
    const intro = introRef.current;
    if (!intro) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setIntroIn(true);
            io.unobserve(intro);
          }
        });
      },
      { threshold: 0.3 }
    );
    io.observe(intro);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const story = storyRef.current;
    if (!story) return;

    const N = cards.length;

    const setStoryHeight = () => {
      const total = HOLD_BEFORE + STEP_LEN * (N - 1) + HOLD_AFTER + 1;
      story.style.height = `calc(100vh * ${total.toFixed(2)})`;
    };
    setStoryHeight();

    let raf: number | null = null;

    const update = () => {
      raf = null;
      const r = story.getBoundingClientRect();
      const vh = window.innerHeight;
      const scrollable = Math.max(1, story.offsetHeight - vh);
      const scrolled = Math.min(Math.max(-r.top, 0), scrollable);
      const startPx = HOLD_BEFORE * vh;
      const endPx = scrollable - HOLD_AFTER * vh;
      const span = Math.max(1, endPx - startPx);
      const t = Math.min(Math.max((scrolled - startPx) / span, 0), 1);
      const v = t * (N - 1);
      const active = Math.min(N - 1, Math.floor(v + 0.0001));
      const frac = v - active;

      cardRefs.current.forEach((c, i) => {
        if (!c) return;
        c.classList.remove("is-active", "is-prev", "is-next");
        if (i === active) c.classList.add("is-active");
        else if (i < active) c.classList.add("is-prev");
        else c.classList.add("is-next");
      });

      stepRefs.current.forEach((s, i) => {
        if (!s) return;
        s.classList.remove("is-active", "is-done");
        if (i < active) {
          s.classList.add("is-done");
          s.style.setProperty("--p", "1");
        } else if (i === active) {
          s.classList.add("is-active");
          s.style.setProperty("--p", frac.toFixed(3));
        } else {
          s.style.setProperty("--p", "0");
        }
      });

      if (lblIdxRef.current) {
        lblIdxRef.current.textContent = String(active + 1).padStart(2, "0");
      }

      if (tintRef.current) {
        const a = tints[active];
        const b = tints[Math.min(tints.length - 1, active + 1)];
        const pick = frac < 0.5 ? a : b;
        tintRef.current.style.setProperty("--tint-a", pick.a);
        tintRef.current.style.setProperty("--tint-b", pick.b);
      }

      if (scrollCueRef.current) {
        if (scrolled < startPx + vh * 0.1) {
          scrollCueRef.current.classList.add("show");
        } else {
          scrollCueRef.current.classList.remove("show");
        }
      }

      const py = (scrolled / scrollable) * 100;
      if (blob1Ref.current) {
        blob1Ref.current.style.transform = `translate3d(0, ${(-py * 0.6).toFixed(1)}px, 0)`;
      }
      if (blob2Ref.current) {
        blob2Ref.current.style.transform = `translate3d(0, ${(py * 0.5).toFixed(1)}px, 0)`;
      }
    };

    const onScroll = () => {
      if (raf != null) return;
      raf = requestAnimationFrame(update);
    };

    const onResize = () => {
      setStoryHeight();
      onScroll();
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    update();

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="sol-root">
      <section
        className={`sol-intro${introIn ? " in" : ""}`}
        id="producto"
        ref={introRef}
      >
        <div className="sol-container">
          <span className="sol-eyebrow">
            <span className="sol-dot" />
            LA SOLUCIÓN
          </span>
          <h2 className="sol-title">
            Todo lo que necesitas para vender mejor y gestionar mejor
          </h2>
          <p className="sol-subtitle">
            ENLAZE te ayuda a organizar el trabajo comercial y operativo de tu
            empresa para responder más rápido, crear presupuestos con más
            agilidad, hacer seguimiento sin olvidos y centralizar la información
            importante.
          </p>
        </div>
      </section>

      <section className="sol-story" ref={storyRef}>
        <div className="sol-stage">
          <div className="sol-tint" ref={tintRef} />
          <div className="sol-atmos">
            <div className="sol-blob sol-b1" ref={blob1Ref} />
            <div className="sol-blob sol-b2" ref={blob2Ref} />
          </div>

          <div className="sol-card-wrap">
            {cards.map((c, i) => (
              <article
                key={i}
                className={`sol-card${i === 0 ? " is-active" : ""}`}
                data-step={i}
                ref={(el) => {
                  cardRefs.current[i] = el;
                }}
              >
                <div className="sol-num">
                  <span>{String(i + 1).padStart(2, "0")}</span> / 04
                </div>
                <div className="sol-icon-wrap">{c.svg}</div>
                <h3 className="sol-card-title">{c.title}</h3>
                <p className="sol-card-body">{c.body}</p>
              </article>
            ))}
          </div>

          <div className="sol-progress">
            {cards.map((_, i) => (
              <div
                key={i}
                className={`sol-step${i === 0 ? " is-active" : ""}`}
                data-i={i}
                ref={(el) => {
                  stepRefs.current[i] = el;
                }}
              >
                <div className="sol-fill" />
              </div>
            ))}
            <div className="sol-progress-label">
              <b ref={lblIdxRef}>01</b> / 04
            </div>
          </div>

          <div className="sol-scroll-cue show" ref={scrollCueRef}>
            <span>Desliza</span>
            <span className="sol-arrow" />
          </div>
        </div>
      </section>

      <div className="sol-outro" />

      <style jsx global>{`
        .sol-root {
          --sol-ink: #0b1220;
          --sol-ink-3: #475569;
          --sol-muted: #6b7280;
          --sol-line: rgba(11, 18, 32, 0.08);
          --sol-bg: #f4f7f5;
          --sol-card-bg: #ffffff;
          --sol-accent: #10b981;
          --sol-accent-2: #059669;

          background: var(--sol-bg);
          color: var(--sol-ink);
          font-family: "Inter", system-ui, -apple-system, sans-serif;
          -webkit-font-smoothing: antialiased;
        }

        .sol-intro {
          position: relative;
          padding: 110px 24px 60px;
          text-align: center;
          overflow: hidden;
        }
        .sol-intro::before,
        .sol-intro::after {
          content: "";
          position: absolute;
          pointer-events: none;
          width: 720px;
          height: 720px;
          border-radius: 50%;
          filter: blur(90px);
          opacity: 0.55;
          left: 50%;
          transform: translateX(-50%);
        }
        .sol-intro::before {
          /* Movido a 80px para que el orb NO bleed en el top edge.
             Antes estaba a -260px tintando los primeros 200 px de cream
             con verde — eso creaba un cambio de color contra PainPoints
             y se veía como un corte horizontal. */
          top: 80px;
          background: radial-gradient(closest-side, rgba(16, 185, 129, 0.16), transparent 70%);
        }

        .sol-container {
          max-width: 880px;
          margin: 0 auto;
          position: relative;
          z-index: 1;
        }

        .sol-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 6px 14px;
          border-radius: 999px;
          background: white;
          color: var(--sol-accent-2);
          border: 1px solid rgba(16, 185, 129, 0.25);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          box-shadow: 0 6px 20px -10px rgba(16, 185, 129, 0.3);
        }
        .sol-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--sol-accent);
          box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.18);
        }
        .sol-title {
          margin: 22px auto 18px;
          font-size: clamp(38px, 5.6vw, 68px);
          line-height: 1.04;
          letter-spacing: -0.025em;
          font-weight: 700;
          text-wrap: balance;
          color: var(--sol-ink);
        }
        .sol-subtitle {
          margin: 0 auto;
          max-width: 680px;
          color: var(--sol-ink-3);
          font-size: 17px;
          line-height: 1.6;
          text-wrap: pretty;
        }

        .sol-intro .sol-eyebrow,
        .sol-intro .sol-title,
        .sol-intro .sol-subtitle {
          opacity: 0;
          transform: translateY(18px);
          filter: blur(8px);
          transition:
            opacity 900ms cubic-bezier(0.22, 0.7, 0.18, 1),
            transform 900ms cubic-bezier(0.22, 0.7, 0.18, 1),
            filter 900ms cubic-bezier(0.22, 0.7, 0.18, 1);
        }
        .sol-intro .sol-eyebrow { transition-delay: 0ms; }
        .sol-intro .sol-title { transition-delay: 100ms; }
        .sol-intro .sol-subtitle { transition-delay: 200ms; }
        .sol-intro.in .sol-eyebrow,
        .sol-intro.in .sol-title,
        .sol-intro.in .sol-subtitle {
          opacity: 1;
          transform: none;
          filter: none;
        }

        .sol-story {
          position: relative;
          height: calc(100vh * 5);
        }
        .sol-stage {
          position: sticky;
          top: 0;
          height: 100vh;
          display: grid;
          place-items: center;
          overflow: hidden;
        }

        .sol-tint {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background:
            radial-gradient(60% 50% at 50% 50%, var(--tint-a, rgba(16, 185, 129, 0.1)), transparent 70%),
            radial-gradient(40% 60% at 50% 100%, var(--tint-b, rgba(16, 185, 129, 0.05)), transparent 70%);
          transition: background 1200ms cubic-bezier(0.22, 0.7, 0.18, 1);
        }

        .sol-progress {
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          bottom: 56px;
          display: flex;
          align-items: center;
          gap: 14px;
          z-index: 5;
          padding: 10px 16px;
          background: rgba(255, 255, 255, 0.6);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          border: 1px solid var(--sol-line);
          border-radius: 999px;
          box-shadow: 0 10px 30px -16px rgba(11, 18, 32, 0.18);
        }
        .sol-step {
          width: 32px;
          height: 3px;
          background: rgba(11, 18, 32, 0.08);
          border-radius: 3px;
          overflow: hidden;
          position: relative;
        }
        .sol-fill {
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, var(--sol-accent-2), var(--sol-accent));
          transform-origin: left center;
          transform: scaleX(0);
          transition: transform 600ms cubic-bezier(0.22, 0.7, 0.18, 1);
        }
        .sol-step.is-active .sol-fill {
          box-shadow: 0 0 12px rgba(16, 185, 129, 0.45);
          transform: scaleX(var(--p, 0));
        }
        .sol-step.is-done .sol-fill {
          transform: scaleX(1);
        }
        .sol-progress-label {
          font-family: "Inter", sans-serif;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--sol-muted);
          font-variant-numeric: tabular-nums;
          min-width: 76px;
        }
        .sol-progress-label b {
          color: var(--sol-ink);
          font-weight: 700;
        }

        .sol-card-wrap {
          position: relative;
          width: min(720px, 92vw);
          height: 460px;
          perspective: 1400px;
        }
        .sol-card {
          position: absolute;
          inset: 0;
          padding: 56px 56px 60px;
          background: var(--sol-card-bg);
          border: 1px solid var(--sol-line);
          border-radius: 28px;
          box-shadow:
            0 1px 0 rgba(255, 255, 255, 0.9) inset,
            0 1px 2px rgba(11, 18, 32, 0.04),
            0 40px 80px -40px rgba(11, 18, 32, 0.3),
            0 16px 36px -22px rgba(11, 18, 32, 0.18);
          display: flex;
          flex-direction: column;
          opacity: 0;
          transform: translateY(40px) scale(0.96);
          filter: blur(3px);
          pointer-events: none;
          transition:
            opacity 800ms cubic-bezier(0.22, 0.7, 0.18, 1),
            transform 900ms cubic-bezier(0.22, 0.7, 0.18, 1),
            filter 800ms cubic-bezier(0.22, 0.7, 0.18, 1);
          will-change: transform, opacity, filter;
        }
        .sol-card.is-active {
          opacity: 1;
          transform: translateY(0) scale(1);
          filter: blur(0);
          pointer-events: auto;
        }
        .sol-card.is-active .sol-icon-wrap {
          animation:
            sol-iconIn 1100ms cubic-bezier(0.22, 0.7, 0.18, 1) both,
            sol-iconFloat 6s ease-in-out 1100ms infinite;
        }
        .sol-card.is-active .sol-card-title {
          animation: sol-textIn 800ms cubic-bezier(0.22, 0.7, 0.18, 1) 120ms both;
        }
        .sol-card.is-active .sol-card-body {
          animation: sol-textIn 800ms cubic-bezier(0.22, 0.7, 0.18, 1) 220ms both;
        }
        .sol-card.is-active .sol-num {
          animation: sol-textIn 800ms cubic-bezier(0.22, 0.7, 0.18, 1) 60ms both;
        }
        .sol-card.is-prev {
          opacity: 0;
          transform: translateY(-26px) scale(0.97);
          filter: blur(3px);
        }
        .sol-card.is-next {
          opacity: 0;
          transform: translateY(40px) scale(0.96);
          filter: blur(3px);
        }

        @keyframes sol-iconIn {
          0%   { transform: translateY(8px) scale(0.85) rotate(-6deg); opacity: 0; filter: blur(4px); }
          60%  { transform: translateY(-2px) scale(1.04) rotate(2deg);  opacity: 1; filter: blur(0); }
          100% { transform: translateY(0) scale(1) rotate(0deg);        opacity: 1; filter: blur(0); }
        }
        @keyframes sol-textIn {
          0%   { transform: translateY(10px); opacity: 0; filter: blur(3px); }
          100% { transform: translateY(0);    opacity: 1; filter: blur(0); }
        }
        @keyframes sol-iconFloat {
          0%, 100% { translate: 0 0; }
          50%      { translate: 0 -3px; }
        }

        .sol-num {
          position: absolute;
          top: 28px;
          right: 32px;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.18em;
          color: var(--sol-muted);
          font-variant-numeric: tabular-nums;
        }
        .sol-num span {
          color: var(--sol-ink);
        }

        .sol-icon-wrap {
          width: 60px;
          height: 60px;
          border-radius: 16px;
          background: linear-gradient(180deg, #ffffff, #f4f7f5);
          border: 1px solid var(--sol-line);
          display: grid;
          place-items: center;
          margin-bottom: 30px;
          color: var(--sol-accent-2);
          position: relative;
          overflow: hidden;
        }
        .sol-icon-wrap::before {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(16, 185, 129, 0.04));
          z-index: 0;
        }
        .sol-icon-wrap svg {
          width: 26px;
          height: 26px;
          stroke: currentColor;
          fill: none;
          stroke-width: 1.8;
          stroke-linecap: round;
          stroke-linejoin: round;
          position: relative;
          z-index: 1;
        }

        .sol-card-title {
          margin: 0 0 18px;
          font-size: clamp(24px, 2.8vw, 32px);
          line-height: 1.2;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: var(--sol-ink);
          text-wrap: balance;
        }
        .sol-card-body {
          margin: 0;
          font-size: 17px;
          line-height: 1.6;
          color: var(--sol-ink-3);
          text-wrap: pretty;
        }

        .sol-atmos {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }
        .sol-blob {
          position: absolute;
          border-radius: 50%;
          filter: blur(90px);
          will-change: transform;
        }
        .sol-b1 {
          width: 520px;
          height: 520px;
          background: radial-gradient(closest-side, rgba(16, 185, 129, 0.22), transparent 70%);
          left: -180px;
          top: 20%;
        }
        .sol-b2 {
          width: 460px;
          height: 460px;
          background: radial-gradient(closest-side, rgba(16, 185, 129, 0.14), transparent 70%);
          right: -140px;
          bottom: 12%;
        }

        .sol-scroll-cue {
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          bottom: 28px;
          color: var(--sol-muted);
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          display: flex;
          align-items: center;
          gap: 10px;
          opacity: 0;
          transition: opacity 500ms ease;
        }
        .sol-scroll-cue.show {
          opacity: 0.8;
        }
        .sol-arrow {
          width: 14px;
          height: 14px;
          border-right: 1.5px solid currentColor;
          border-bottom: 1.5px solid currentColor;
          transform: rotate(45deg) translate(-2px, -2px);
          animation: sol-bob 1.6s ease-in-out infinite;
        }
        @keyframes sol-bob {
          0%, 100% { transform: rotate(45deg) translate(-2px, -2px); }
          50%      { transform: rotate(45deg) translate(2px, 2px); }
        }

        .sol-outro {
          height: 30vh;
        }
      `}</style>
    </div>
  );
}
