"use client";

import { useEffect, useRef } from "react";

type Pain = {
  idx: string;
  title: string;
  desc: string;
  svg: React.ReactNode;
};

const pains: Pain[] = [
  {
    idx: "01",
    title: "Contestas cuando puedes, no cuando el cliente quiere.",
    desc: "Entre un cliente y otro, los mensajes se acumulan. Y el que no espera, ya está hablando con tu competencia.",
    svg: (
      <svg viewBox="0 0 24 24">
        <path d="M21 12a8 8 0 1 1-3.2-6.4L21 4v5h-5" />
        <path d="M8 12h8M8 16h5" />
      </svg>
    ),
  },
  {
    idx: "02",
    title: "Haces presupuestos el domingo por la noche.",
    desc: "Te toca sacrificar el fin de semana para enviar lo que deberías haber mandado el martes. Otra vez.",
    svg: (
      <svg viewBox="0 0 24 24">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        <circle cx="17" cy="6" r="0.6" fill="currentColor" />
        <circle cx="20" cy="9" r="0.6" fill="currentColor" />
      </svg>
    ),
  },
  {
    idx: "03",
    title: "Los presupuestos se quedan sin respuesta.",
    desc: "No tienes tiempo de hacer seguimiento. 6 de cada 10 trabajos se pierden solo por silencio.",
    svg: (
      <svg viewBox="0 0 24 24">
        <path d="M4 7h12a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3h-3l-4 3v-3H6a3 3 0 0 1-2-1" />
        <path d="M3 4l18 18" />
      </svg>
    ),
  },
  {
    idx: "04",
    title: "Tu información vive en cinco sitios distintos.",
    desc: "Una libreta, el WhatsApp de alguien, un Excel, la memoria del equipo y una carpeta perdida. Nadie sabe dónde está qué.",
    svg: (
      <svg viewBox="0 0 24 24">
        <circle cx="5" cy="6" r="2" />
        <circle cx="19" cy="6" r="2" />
        <circle cx="5" cy="18" r="2" />
        <circle cx="19" cy="18" r="2" />
        <circle cx="12" cy="12" r="2" />
        <path d="M7 6h6m4 0h0M7 18h10M5 8v8m14-8v8" />
      </svg>
    ),
  },
  {
    idx: "05",
    title: "Cada reunión son dos horas de papeleo después.",
    desc: "Apuntar, preparar presupuesto, enviarlo, recordar quién dijo qué. Y mañana, vuelta a empezar.",
    svg: (
      <svg viewBox="0 0 24 24">
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9z" />
        <path d="M14 3v6h5" />
        <path d="M9 13h6M9 17h4" />
      </svg>
    ),
  },
  {
    idx: "06",
    title: "Trabajas más, facturas lo mismo.",
    desc: "Tus horas ya no dan para más. Contratar oficina no te compensa. Y el techo se hace cada mes más bajo.",
    svg: (
      <svg viewBox="0 0 24 24">
        <path d="M3 17l5-5 4 4 4-7 5 8" />
        <path d="M3 21h18" />
      </svg>
    ),
  },
];

export default function PainPointsSection() {
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const cards = Array.from(grid.querySelectorAll<HTMLElement>(".pp-card"));

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.18, rootMargin: "0px 0px -40px 0px" }
    );
    cards.forEach((c) => io.observe(c));

    let activeCard: HTMLElement | null = null;
    const cleanups: Array<() => void> = [];

    cards.forEach((card) => {
      const onMove = (e: PointerEvent) => {
        const r = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${e.clientX - r.left}px`);
        card.style.setProperty("--my", `${e.clientY - r.top}px`);
      };
      const onEnter = () => {
        activeCard?.classList.remove("is-hover");
        card.classList.add("is-hover");
        grid.classList.add("has-hover");
        activeCard = card;
      };
      const onLeave = () => {
        card.classList.remove("is-hover");
        if (activeCard === card) activeCard = null;
        setTimeout(() => {
          if (!grid.querySelector(".pp-card.is-hover")) {
            grid.classList.remove("has-hover");
          }
        }, 60);
      };
      card.addEventListener("pointermove", onMove);
      card.addEventListener("pointerenter", onEnter);
      card.addEventListener("pointerleave", onLeave);
      cleanups.push(() => {
        card.removeEventListener("pointermove", onMove);
        card.removeEventListener("pointerenter", onEnter);
        card.removeEventListener("pointerleave", onLeave);
      });
    });

    return () => {
      io.disconnect();
      cleanups.forEach((fn) => fn());
    };
  }, []);

  return (
    <section className="pp-section">
      <div className="pp-bg-shader" />
      <div className="pp-grain" />

      <div className="pp-container">
        <header className="pp-head">
          <span className="pp-eyebrow">
            <span className="pp-dot" />
            El problema real
          </span>
          <h2 className="pp-title">
            Tu problema no es que falten clientes.
            <br />
            <span className="pp-grad">Es lo que pasa después.</span>
          </h2>
          <p className="pp-subtitle">
            Si alguna de estas frases te suena, no eres tú. Es el sistema con el
            que estás trabajando.
          </p>
        </header>

        <div className="pp-grid" ref={gridRef}>
          {pains.map((p, i) => (
            <article
              key={p.idx}
              className="pp-card"
              style={{ ["--delay" as string]: `${i * 80}ms` } as React.CSSProperties}
            >
              <span className="pp-idx">{p.idx}</span>
              <span className="pp-corner" />
              <div className="pp-icon-wrap">{p.svg}</div>
              <h3>{p.title}</h3>
              <p>{p.desc}</p>
            </article>
          ))}
        </div>

        <p className="pp-foot">
          ¿Te identificas con tres o más?{" "}
          <a href="#producto">
            <strong>Mira cómo lo arregla Enlaze</strong>
            <span className="pp-arrow">→</span>
          </a>
        </p>
      </div>

      <style jsx>{`
        .pp-section {
          --pp-bg-0: #050b14;
          --pp-ink: #eaf1f8;
          --pp-ink-2: #b8c4d4;
          --pp-warn: #f97362;
          --pp-accent-2: #5eead4;

          position: relative;
          overflow: hidden;
          padding: 110px 24px 130px;
          isolation: isolate;
          background: var(--pp-bg-0);
          color: var(--pp-ink);
          font-family: "Inter", system-ui, -apple-system, sans-serif;
          -webkit-font-smoothing: antialiased;
        }

        .pp-bg-shader {
          position: absolute;
          inset: 0;
          z-index: -2;
          background:
            radial-gradient(60% 50% at 20% 10%, rgba(16, 185, 129, 0.18), transparent 60%),
            radial-gradient(55% 50% at 85% 90%, rgba(94, 234, 212, 0.1), transparent 60%),
            radial-gradient(50% 60% at 50% 100%, rgba(249, 115, 98, 0.1), transparent 60%),
            linear-gradient(180deg, #050b14 0%, #07111d 50%, #0a1828 100%);
        }
        .pp-bg-shader::before,
        .pp-bg-shader::after {
          content: "";
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          opacity: 0.5;
          will-change: transform;
        }
        .pp-bg-shader::before {
          width: 520px;
          height: 520px;
          left: -120px;
          top: 120px;
          background: radial-gradient(closest-side, rgba(16, 185, 129, 0.28), transparent 70%);
          animation: pp-drift1 22s ease-in-out infinite;
        }
        .pp-bg-shader::after {
          width: 620px;
          height: 620px;
          right: -160px;
          bottom: -120px;
          background: radial-gradient(closest-side, rgba(56, 189, 248, 0.18), transparent 70%);
          animation: pp-drift2 28s ease-in-out infinite;
        }
        @keyframes pp-drift1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50%      { transform: translate(60px, -40px) scale(1.08); }
        }
        @keyframes pp-drift2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50%      { transform: translate(-50px, 40px) scale(1.1); }
        }

        .pp-grain {
          position: absolute;
          inset: 0;
          z-index: -1;
          pointer-events: none;
          mix-blend-mode: overlay;
          opacity: 0.1;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.5 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
        }

        .pp-container {
          max-width: 1180px;
          margin: 0 auto;
        }

        .pp-head {
          text-align: center;
          margin-bottom: 64px;
        }
        .pp-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 12px;
          border-radius: 999px;
          background: rgba(249, 115, 98, 0.1);
          color: var(--pp-warn);
          border: 1px solid rgba(249, 115, 98, 0.22);
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }
        .pp-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--pp-warn);
          box-shadow: 0 0 0 3px rgba(249, 115, 98, 0.18);
          animation: pp-pulse 2.4s ease-in-out infinite;
        }
        @keyframes pp-pulse {
          0%, 100% { box-shadow: 0 0 0 3px rgba(249, 115, 98, 0.18); }
          50%      { box-shadow: 0 0 0 6px rgba(249, 115, 98, 0.04); }
        }
        .pp-title {
          margin: 22px auto 14px;
          font-size: clamp(34px, 4.6vw, 60px);
          line-height: 1.04;
          letter-spacing: -0.025em;
          font-weight: 700;
          max-width: 920px;
          text-wrap: balance;
          color: var(--pp-ink);
        }
        .pp-grad {
          background: linear-gradient(100deg, #5eead4 0%, #67e8f9 50%, #93c5fd 100%);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .pp-subtitle {
          margin: 0 auto;
          max-width: 600px;
          color: var(--pp-ink-2);
          font-size: 17px;
          line-height: 1.55;
          text-wrap: pretty;
        }

        .pp-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 18px;
        }
        @media (max-width: 960px) {
          .pp-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 620px) {
          .pp-grid { grid-template-columns: 1fr; }
        }

        .pp-card {
          --card-glow: rgba(249, 115, 98, 0);
          position: relative;
          padding: 26px 26px 28px;
          border-radius: 18px;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.015));
          border: 1px solid rgba(255, 255, 255, 0.08);
          backdrop-filter: blur(18px) saturate(1.1);
          -webkit-backdrop-filter: blur(18px) saturate(1.1);
          overflow: hidden;
          transition:
            transform 600ms cubic-bezier(0.22, 0.7, 0.18, 1),
            border-color 400ms ease,
            box-shadow 500ms ease,
            opacity 350ms ease,
            background 400ms ease;
          opacity: 0;
          transform: translateY(18px) scale(0.965);
          filter: blur(6px);
          box-shadow:
            0 1px 0 rgba(255, 255, 255, 0.04) inset,
            0 0 0 0 var(--card-glow);
        }
        .pp-card.in {
          opacity: 1;
          transform: translateY(0) scale(1);
          filter: blur(0);
          transition:
            opacity 900ms cubic-bezier(0.22, 0.7, 0.18, 1) var(--delay, 0ms),
            transform 1000ms cubic-bezier(0.22, 0.7, 0.18, 1) var(--delay, 0ms),
            filter 800ms cubic-bezier(0.22, 0.7, 0.18, 1) var(--delay, 0ms),
            border-color 400ms ease,
            box-shadow 500ms ease,
            background 400ms ease;
        }

        .pp-card::before {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: inherit;
          background: radial-gradient(
            280px 280px at var(--mx, 50%) var(--my, 50%),
            rgba(249, 115, 98, 0.1),
            transparent 60%
          );
          opacity: 0;
          transition: opacity 350ms ease;
          pointer-events: none;
        }
        .pp-card:hover::before { opacity: 1; }

        .pp-grid.has-hover .pp-card { opacity: 0.55; }
        .pp-grid.has-hover .pp-card.is-hover {
          opacity: 1;
          transform: translateY(-6px) scale(1.012);
          border-color: rgba(249, 115, 98, 0.45);
          background: linear-gradient(180deg, rgba(249, 115, 98, 0.06), rgba(255, 255, 255, 0.02));
          box-shadow:
            0 1px 0 rgba(255, 255, 255, 0.06) inset,
            0 22px 50px -20px rgba(249, 115, 98, 0.35),
            0 8px 30px -10px rgba(0, 0, 0, 0.5);
        }

        .pp-icon-wrap {
          width: 46px;
          height: 46px;
          border-radius: 12px;
          display: grid;
          place-items: center;
          background: rgba(249, 115, 98, 0.1);
          border: 1px solid rgba(249, 115, 98, 0.25);
          color: var(--pp-warn);
          margin-bottom: 22px;
          position: relative;
          transition:
            background 400ms ease,
            border-color 400ms ease,
            transform 600ms cubic-bezier(0.22, 0.7, 0.18, 1);
          animation: pp-iconBreathe 4.2s ease-in-out infinite;
          animation-delay: var(--delay, 0ms);
        }
        .pp-icon-wrap::after {
          content: "";
          position: absolute;
          inset: -3px;
          border-radius: 14px;
          box-shadow: 0 0 0 0 rgba(249, 115, 98, 0.4);
          pointer-events: none;
        }
        .pp-icon-wrap :global(svg) {
          width: 22px;
          height: 22px;
          stroke: currentColor;
          fill: none;
          stroke-width: 1.8;
          stroke-linecap: round;
          stroke-linejoin: round;
          transition: transform 600ms cubic-bezier(0.22, 0.7, 0.18, 1);
        }
        @keyframes pp-iconBreathe {
          0%, 100% { box-shadow: 0 0 0 0 rgba(249, 115, 98, 0); }
          50%      { box-shadow: 0 0 0 6px rgba(249, 115, 98, 0.06); }
        }
        .pp-card.is-hover .pp-icon-wrap {
          background: rgba(249, 115, 98, 0.18);
          border-color: rgba(249, 115, 98, 0.55);
          transform: translateY(-2px);
          animation: pp-iconPulseHover 1.8s ease-in-out infinite;
        }
        @keyframes pp-iconPulseHover {
          0%, 100% { box-shadow: 0 0 0 0 rgba(249, 115, 98, 0.45); }
          50%      { box-shadow: 0 0 0 10px rgba(249, 115, 98, 0); }
        }
        .pp-card.is-hover .pp-icon-wrap :global(svg) {
          transform: rotate(-4deg) scale(1.05);
        }

        .pp-card h3 {
          margin: 0 0 10px;
          font-size: 17px;
          line-height: 1.3;
          font-weight: 600;
          letter-spacing: -0.005em;
          color: var(--pp-ink);
          text-wrap: balance;
        }
        .pp-card p {
          margin: 0;
          font-size: 14px;
          line-height: 1.55;
          color: var(--pp-ink-2);
          text-wrap: pretty;
        }

        .pp-idx {
          position: absolute;
          top: 18px;
          right: 22px;
          font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 11px;
          color: rgba(255, 255, 255, 0.28);
          letter-spacing: 0.06em;
        }

        .pp-corner {
          position: absolute;
          top: 0;
          right: 0;
          width: 60px;
          height: 60px;
          pointer-events: none;
          opacity: 0;
          transition: opacity 350ms ease;
        }
        .pp-corner::before,
        .pp-corner::after {
          content: "";
          position: absolute;
          background: linear-gradient(135deg, rgba(249, 115, 98, 0.55), transparent 70%);
        }
        .pp-corner::before { top: 0; right: 0; width: 1px; height: 60px; }
        .pp-corner::after  { top: 0; right: 0; width: 60px; height: 1px; }
        .pp-card.is-hover .pp-corner { opacity: 1; }

        .pp-foot {
          margin-top: 64px;
          text-align: center;
          color: var(--pp-ink-2);
          font-size: 15px;
        }
        .pp-foot strong {
          color: var(--pp-ink);
          font-weight: 600;
        }
        .pp-foot a {
          color: var(--pp-accent-2);
          text-decoration: none;
          border-bottom: 1px dashed rgba(94, 234, 212, 0.4);
          padding-bottom: 1px;
        }
        .pp-arrow {
          display: inline-block;
          margin-left: 6px;
          transition: transform 400ms ease;
        }
        .pp-foot a:hover .pp-arrow { transform: translateX(4px); }
      `}</style>
    </section>
  );
}
