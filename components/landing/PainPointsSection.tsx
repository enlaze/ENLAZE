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
      <svg viewBox="0 0 64 64">
        <path d="M14 14 h32 a6 6 0 0 1 6 6 v18 a6 6 0 0 1 -6 6 h-9 l-6 6 l1 -6 h-18 a6 6 0 0 1 -6 -6 v-18 a6 6 0 0 1 6 -6 z" />
        <circle cx="30" cy="29" r="9" />
        <path d="M30 22 v1.6 M37 29 h-1.6 M30 36 v-1.6 M23 29 h1.6" />
        <path d="M30 29 l-5 -2" />
        <path d="M30 29 l0 -5.5" strokeWidth="1.4" />
        <circle cx="30" cy="29" r="0.9" fill="currentColor" stroke="none" />
        <circle cx="44" cy="22" r="2.2" fill="currentColor" stroke="none" />
        <circle cx="44" cy="22" r="4.5" strokeDasharray="1.8 2.4" />
      </svg>
    ),
  },
  {
    idx: "02",
    title: "Haces presupuestos el domingo por la noche.",
    desc: "Te toca sacrificar el fin de semana para enviar lo que deberías haber mandado el martes. Otra vez.",
    svg: (
      <svg viewBox="0 0 64 64">
        <path d="M48 14 a10 10 0 1 0 8 14 a8 8 0 0 1 -8 -14 z" />
        <path d="M50 36 l0 3 M48.5 37.5 h3" strokeWidth="1.2" />
        <path d="M14 16 l0 2 M13 17 h2" strokeWidth="1.2" />
        <path d="M16 22 h18 l8 8 v22 a3 3 0 0 1 -3 3 h-23 a3 3 0 0 1 -3 -3 v-27 a3 3 0 0 1 3 -3 z" />
        <path d="M34 22 v6 a2 2 0 0 0 2 2 h6" />
        <path d="M21 38 h10 M21 42 h14" />
        <rect x="20" y="46" width="18" height="6" rx="1.4" />
        <path d="M24 49 h0.4 M28 49 h0.4 M32 49 h0.4" strokeWidth="1.6" />
        <path d="M26 35 a2.4 2.4 0 1 0 0 -3 M24 33.2 h3.4 M24 34.4 h3.4" strokeWidth="1.4" />
      </svg>
    ),
  },
  {
    idx: "03",
    title: "Los presupuestos se quedan sin respuesta.",
    desc: "No tienes tiempo de hacer seguimiento. 6 de cada 10 trabajos se pierden solo por silencio.",
    svg: (
      <svg viewBox="0 0 64 64">
        <path d="M10 18 h16 l6 6 v18 a3 3 0 0 1 -3 3 h-19 a3 3 0 0 1 -3 -3 v-21 a3 3 0 0 1 3 -3 z" />
        <path d="M26 18 v4 a2 2 0 0 0 2 2 h4" />
        <path d="M14 30 h10 M14 34 h12 M14 38 h8" />
        <path d="M30 24 l8 -4" />
        <path d="M38 20 l-2 -1 M38 20 l-1 2" strokeWidth="1.5" />
        <path d="M40 22 C 46 22, 50 26, 50 32" strokeDasharray="1.8 2.4" />
        <path d="M48 38 a3 3 0 1 1 3 3 v2" />
        <circle cx="51" cy="46.5" r="0.9" fill="currentColor" stroke="none" />
        <path d="M42 46 a4 4 0 0 1 4 4" strokeDasharray="1.8 2.4" strokeWidth="1.4" />
      </svg>
    ),
  },
  {
    idx: "04",
    title: "Tu información vive en cinco sitios distintos.",
    desc: "Una libreta, el WhatsApp de alguien, un Excel, la memoria del equipo y una carpeta perdida. Nadie sabe dónde está qué.",
    svg: (
      <svg viewBox="0 0 64 64">
        <rect x="9" y="10" width="11" height="18" rx="2" />
        <path d="M13 25 h3" strokeWidth="1.4" />
        <path d="M36 12 h6 l2 3 h10 a2 2 0 0 1 2 2 v8 a2 2 0 0 1 -2 2 h-18 a2 2 0 0 1 -2 -2 v-11 a2 2 0 0 1 2 -2 z" />
        <rect x="22" y="26" width="20" height="14" rx="2" />
        <path d="M22 31 h20 M28 26 v14 M35 26 v14" strokeWidth="1.3" />
        <rect x="8" y="38" width="13" height="16" rx="1.6" />
        <path d="M11 42 h7 M11 46 h7 M11 50 h5" strokeWidth="1.3" />
        <path d="M8 41 h13 M8 51 h13" strokeWidth="0.9" />
        <path d="M44 42 h11 v8 l-3 3 h-8 z" />
        <path d="M52 50 h3 l-3 3 z" fill="currentColor" stroke="none" opacity="0.1" />
        <path d="M21 19 h11" strokeDasharray="1.8 2.4" strokeWidth="1.3" />
        <path d="M14 32 v6" strokeDasharray="1.8 2.4" strokeWidth="1.3" />
        <path d="M44 30 v8" strokeDasharray="1.8 2.4" strokeWidth="1.3" />
        <path d="M22 46 h20" strokeDasharray="1.8 2.4" strokeWidth="1.3" />
        <circle cx="32" cy="20" r="1" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    idx: "05",
    title: "Cada reunión son dos horas de papeleo después.",
    desc: "Apuntar, preparar presupuesto, enviarlo, recordar quién dijo qué. Y mañana, vuelta a empezar.",
    svg: (
      <svg viewBox="0 0 64 64">
        <rect x="12" y="8" width="28" height="20" rx="3" />
        <path d="M12 14 h28" />
        <path d="M19 6 v6 M33 6 v6" />
        <circle cx="22" cy="20" r="2.2" />
        <path d="M18 26 a4 4 0 0 1 8 0" strokeWidth="1.4" />
        <circle cx="32" cy="20" r="2.2" />
        <path d="M28 26 a4 4 0 0 1 8 0" strokeWidth="1.4" />
        <path d="M40 22 C 48 22, 50 28, 50 34" />
        <path d="M48 32 l2 2 l2 -2" strokeWidth="1.5" />
        <rect x="36" y="34" width="20" height="22" rx="2" />
        <path d="M40 30 h16 a2 2 0 0 1 2 2 v22" strokeWidth="1.3" opacity="0.55" />
        <path d="M44 26 h16 a2 2 0 0 1 2 2 v22" strokeWidth="1.3" opacity="0.3" />
        <rect x="39" y="38" width="3" height="3" rx="0.6" />
        <path d="M44 40 h9 M39 45 h14 M39 49 h11 M39 53 h6" />
      </svg>
    ),
  },
  {
    idx: "06",
    title: "Trabajas más, facturas lo mismo.",
    desc: "Tus horas ya no dan para más. Contratar oficina no te compensa. Y el techo se hace cada mes más bajo.",
    svg: (
      <svg viewBox="0 0 64 64">
        <path d="M8 50 h48" />
        <path d="M14 46 C 16 38, 22 28, 30 16" />
        <path d="M28 18 l2 -2 l2 2" strokeWidth="1.6" />
        <circle cx="30" cy="13" r="3.6" />
        <path d="M30 11 v2 l1.4 1" strokeWidth="1.3" />
        <path d="M14 42 h36" />
        <path d="M48 40 l2 2 l-2 2" strokeWidth="1.6" />
        <circle cx="42" cy="42" r="3.6" />
        <path d="M40.5 41 a2 2 0 1 0 0 2 M39.5 41.6 h3 M39.5 42.6 h3" strokeWidth="1.2" />
        <path d="M30 50 v-3" strokeDasharray="1.8 2.4" strokeWidth="1.3" />
        <path d="M30 50 l-2 6 M30 50 l2 6" strokeWidth="1.2" opacity="0.5" />
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
          --pp-bg-0: #f4f7f5;
          --pp-ink: #0a1929;
          --pp-ink-2: #475467;
          --pp-warn: #e85a48;
          --pp-accent-2: #00a67a;

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
          /* Cream plano + UN solo accent en la zona central del top.
             Sin radials/orbs cerca de los bordes inferiores → el bottom
             de la sección queda cream PURO y se funde sin cortes con
             el cream PURO del top de Solucion. */
          background:
            radial-gradient(60% 40% at 30% 30%, rgba(0, 200, 150, 0.08), transparent 60%),
            #f4f7f5;
        }
        .pp-bg-shader::before {
          content: "";
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          opacity: 0.40;
          will-change: transform;
          width: 460px;
          height: 460px;
          left: -100px;
          top: 80px;
          background: radial-gradient(closest-side, rgba(0, 200, 150, 0.16), transparent 70%);
          animation: pp-drift1 22s ease-in-out infinite;
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
          mix-blend-mode: multiply;
          opacity: 0.04;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.5 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
          /* Fundido del grain en los bordes para que la textura no termine en
             seco contra Solucion (que es cream sin grain) y desaparezca el
             corte horizontal entre ambas secciones cream. */
          -webkit-mask-image: linear-gradient(
            to bottom,
            transparent 0,
            #000 140px,
            #000 calc(100% - 220px),
            transparent 100%
          );
          mask-image: linear-gradient(
            to bottom,
            transparent 0,
            #000 140px,
            #000 calc(100% - 220px),
            transparent 100%
          );
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
          background: linear-gradient(100deg, #00a67a 0%, #0891b2 50%, #1e3a5f 100%);
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
          --card-glow: rgba(232, 90, 72, 0);
          position: relative;
          padding: 26px 26px 28px;
          border-radius: 18px;
          background: #ffffff;
          border: 1px solid rgba(10, 25, 41, 0.08);
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
            0 1px 2px rgba(10, 25, 41, 0.04),
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

        .pp-grid.has-hover .pp-card { opacity: 0.6; }
        .pp-grid.has-hover .pp-card.is-hover {
          opacity: 1;
          transform: translateY(-6px) scale(1.012);
          border-color: rgba(232, 90, 72, 0.40);
          background: linear-gradient(180deg, #ffffff, rgba(232, 90, 72, 0.04));
          box-shadow:
            0 1px 0 rgba(255, 255, 255, 0.6) inset,
            0 22px 50px -20px rgba(232, 90, 72, 0.30),
            0 8px 30px -10px rgba(10, 25, 41, 0.18);
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
          width: 28px;
          height: 28px;
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
          color: rgba(10, 25, 41, 0.30);
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
          border-bottom: 1px dashed rgba(0, 166, 122, 0.4);
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
