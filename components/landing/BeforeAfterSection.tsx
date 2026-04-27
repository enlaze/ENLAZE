"use client";

import { useEffect, useRef, useState } from "react";

type Side = "before" | "after";
type StageState = Side | "both";

const beforeItems = [
  "Domingo haciendo presupuestos para entregar el lunes",
  "Clientes que no contestan porque tardas 4 días en enviar",
  "«Se me había olvidado ese cliente, lo llamo el lunes»",
  "Tres carpetas, dos Excel y un WhatsApp que nadie encuentra",
  "Pierdes el 60 % de los presupuestos por no hacer seguimiento",
  "Trabajas 60 horas y facturas lo mismo que el mes pasado",
];

const afterItems = [
  "Fin de semana libre. Los presupuestos salen en 30 segundos",
  "Presupuesto enviado el mismo día de la reunión",
  "Seguimiento automático. Ningún cliente se queda sin respuesta",
  "Un único panel con todo: clientes, proyectos, mensajes, presupuestos",
  "Cierras más clientes sin mover un dedo de más",
  "Trabajas 40 horas y facturas un 30 % más",
];

const frictionParticles = [
  { left: "12%", bottom: "10%", duration: "7s", delay: "0s" },
  { left: "34%", bottom: "8%", duration: "9s", delay: "1.5s" },
  { left: "60%", bottom: "14%", duration: "8s", delay: "0.8s" },
  { left: "80%", bottom: "6%", duration: "10s", delay: "2.2s" },
  { left: "22%", bottom: "4%", duration: "11s", delay: "3s" },
];

const XIcon = () => (
  <svg viewBox="0 0 24 24">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 24 24">
    <path d="m5 12 5 5L20 7" />
  </svg>
);

export default function BeforeAfterSection() {
  const stageRef = useRef<HTMLDivElement>(null);
  const sideBeforeRef = useRef<HTMLElement>(null);
  const sideAfterRef = useRef<HTMLElement>(null);
  const [state, setState] = useState<StageState>("both");
  const [inView, setInView] = useState(false);
  const [stageIn, setStageIn] = useState(false);

  const autoStoppedRef = useRef(false);
  const isPausedRef = useRef(false);
  const autoStartedRef = useRef(false);
  const inViewRef = useRef(false);
  const stateRef = useRef<StageState>("both");
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    inViewRef.current = inView;
  }, [inView]);

  const flash = (side: Side) => {
    const el = side === "before" ? sideBeforeRef.current : sideAfterRef.current;
    if (!el) return;
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  };

  const applyState = (next: StageState) => {
    stateRef.current = next;
    setState(next);
    if (next === "before" || next === "after") flash(next);
  };

  const clearAuto = () => {
    if (autoTimerRef.current) {
      clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
  };

  const scheduleAuto = (delay: number) => {
    clearAuto();
    if (autoStoppedRef.current || isPausedRef.current || !inViewRef.current) return;
    autoTimerRef.current = setTimeout(() => {
      if (autoStoppedRef.current || isPausedRef.current || !inViewRef.current) return;
      const curr = stateRef.current;
      const next: Side = curr === "before" ? "after" : "before";
      applyState(next);
      scheduleAuto(4500);
    }, delay);
  };

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          inViewRef.current = e.isIntersecting;
          setInView(e.isIntersecting);
          if (e.isIntersecting) {
            setStageIn(true);
            if (!autoStartedRef.current) {
              autoStartedRef.current = true;
              setTimeout(() => {
                if (
                  !autoStoppedRef.current &&
                  !isPausedRef.current &&
                  inViewRef.current
                ) {
                  applyState("before");
                  scheduleAuto(4500);
                }
              }, 1700);
            } else if (!autoStoppedRef.current && !isPausedRef.current) {
              scheduleAuto(2500);
            }
          } else {
            clearAuto();
          }
        });
      },
      { threshold: 0.25 }
    );
    io.observe(node);
    return () => {
      io.disconnect();
      clearAuto();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onMouseEnter = () => {
    isPausedRef.current = true;
    clearAuto();
  };
  const onMouseLeave = () => {
    isPausedRef.current = false;
    if (!autoStoppedRef.current && inViewRef.current) scheduleAuto(2500);
  };

  const onTabClick = (v: Side) => {
    autoStoppedRef.current = true;
    clearAuto();
    applyState(v);
  };

  const toggleState: Side = state === "after" ? "after" : "before";

  return (
    <section className="ba-section">
      <div className="ba-container">
        <header className="ba-head">
          <span className="ba-eyebrow">
            <span className="ba-swap">
              <b>ANTES</b> · <i>DESPUÉS</i>
            </span>
          </span>
          <h2 className="ba-title">Así cambia tu semana</h2>
          <p className="ba-subtitle">
            La misma empresa, los mismos clientes, los mismos trabajos.
            <br />
            Solo cambia quién hace la parte aburrida.
          </p>

          <div className="ba-toggle-wrap" data-state={toggleState} role="tablist">
            <span className="ba-pill" aria-hidden="true" />
            <button
              type="button"
              data-v="before"
              role="tab"
              className={state === "before" ? "is-active" : ""}
              onClick={() => onTabClick("before")}
            >
              <span className="ba-dot ba-dot-before" />
              Antes
            </button>
            <button
              type="button"
              data-v="after"
              role="tab"
              className={state === "after" ? "is-active" : ""}
              onClick={() => onTabClick("after")}
            >
              <span className="ba-dot ba-dot-after" />
              Después
            </button>
          </div>
        </header>

        <div
          className={`ba-stage${stageIn ? " in" : ""}`}
          data-state={state}
          ref={stageRef}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
        >
          <div className="ba-arena">
            <div className="ba-split" />

            <aside className="ba-side ba-side-before" ref={sideBeforeRef}>
              <div className="ba-reveal" />
              <div className="ba-friction" aria-hidden="true">
                {frictionParticles.map((p, i) => (
                  <span
                    key={i}
                    style={{
                      left: p.left,
                      bottom: p.bottom,
                      animationDuration: p.duration,
                      animationDelay: p.delay,
                    }}
                  />
                ))}
              </div>

              <div className="ba-side-head">
                <div className="ba-icon">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </div>
                <div>
                  <div className="ba-label">ANTES</div>
                  <h3>Sin Enlaze</h3>
                </div>
              </div>

              <div className="ba-items">
                {beforeItems.map((t, i) => (
                  <div
                    key={i}
                    className="ba-item ba-item-before"
                    style={
                      {
                        ["--d" as string]: `${i * 60}ms`,
                        ["--jd" as string]: `${i * 200}ms`,
                      } as React.CSSProperties
                    }
                  >
                    <div className="ba-mark">
                      <XIcon />
                    </div>
                    <div>{t}</div>
                  </div>
                ))}
              </div>
            </aside>

            <aside className="ba-side ba-side-after" ref={sideAfterRef}>
              <div className="ba-reveal" />

              <div className="ba-side-head">
                <div className="ba-icon">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m5 12 5 5L20 7" />
                  </svg>
                </div>
                <div>
                  <div className="ba-label">DESPUÉS</div>
                  <h3>Con Enlaze</h3>
                </div>
              </div>

              <div className="ba-items">
                {afterItems.map((t, i) => (
                  <div
                    key={i}
                    className="ba-item ba-item-after"
                    style={
                      {
                        ["--d" as string]: `${i * 60}ms`,
                        ["--jd" as string]: `${i * 200}ms`,
                      } as React.CSSProperties
                    }
                  >
                    <div className="ba-mark">
                      <CheckIcon />
                    </div>
                    <div>{t}</div>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </div>
      </div>

      <style jsx>{`
        .ba-section {
          --ba-ink: #0b1220;
          --ba-ink-2: #1f2937;
          --ba-ink-3: #475569;
          --ba-muted: #6b7280;
          --ba-line: rgba(11, 18, 32, 0.08);
          --ba-bg: #f4f7f5;
          --ba-accent: #10b981;
          --ba-accent-2: #059669;
          --ba-accent-soft: rgba(16, 185, 129, 0.1);
          --ba-warn: #ef4444;
          --ba-warn-soft: rgba(239, 68, 68, 0.08);

          position: relative;
          overflow: hidden;
          padding: 100px 24px 130px;
          background: var(--ba-bg);
          color: var(--ba-ink);
          font-family: "Inter", system-ui, -apple-system, sans-serif;
          -webkit-font-smoothing: antialiased;
        }
        .ba-section::before,
        .ba-section::after {
          content: "";
          position: absolute;
          pointer-events: none;
          width: 600px;
          height: 600px;
          border-radius: 50%;
          filter: blur(80px);
          opacity: 0.55;
        }
        .ba-section::before {
          top: -120px;
          left: -180px;
          background: radial-gradient(closest-side, rgba(239, 68, 68, 0.18), transparent 70%);
          animation: ba-drift1 24s ease-in-out infinite;
        }
        .ba-section::after {
          bottom: -160px;
          right: -180px;
          background: radial-gradient(closest-side, rgba(16, 185, 129, 0.22), transparent 70%);
          animation: ba-drift2 28s ease-in-out infinite;
        }
        @keyframes ba-drift1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50%      { transform: translate(60px, -40px) scale(1.08); }
        }
        @keyframes ba-drift2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50%      { transform: translate(-50px, 40px) scale(1.1); }
        }

        .ba-container {
          max-width: 1200px;
          margin: 0 auto;
          position: relative;
          z-index: 1;
        }

        .ba-head {
          text-align: center;
          margin-bottom: 56px;
        }
        .ba-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 6px 14px;
          border-radius: 999px;
          background: white;
          color: var(--ba-accent-2);
          border: 1px solid rgba(16, 185, 129, 0.25);
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          box-shadow: 0 6px 20px -10px rgba(16, 185, 129, 0.3);
        }
        .ba-swap {
          display: inline-flex;
          gap: 4px;
          align-items: center;
          color: var(--ba-ink-3);
        }
        .ba-swap b { color: var(--ba-warn); font-weight: 700; }
        .ba-swap i { font-style: normal; color: var(--ba-accent-2); font-weight: 700; }
        .ba-title {
          margin: 22px auto 14px;
          font-size: clamp(36px, 5.4vw, 64px);
          line-height: 1.04;
          letter-spacing: -0.025em;
          font-weight: 700;
          max-width: 880px;
          text-wrap: balance;
          color: var(--ba-ink);
        }
        .ba-subtitle {
          margin: 0 auto;
          max-width: 620px;
          color: var(--ba-ink-3);
          font-size: 17px;
          line-height: 1.55;
        }

        .ba-toggle-wrap {
          margin: 30px auto 0;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px;
          background: white;
          border: 1px solid var(--ba-line);
          border-radius: 999px;
          box-shadow: 0 8px 24px -12px rgba(11, 18, 32, 0.18);
          position: relative;
        }
        .ba-pill {
          position: absolute;
          top: 6px;
          left: 6px;
          height: calc(100% - 12px);
          width: calc(50% - 6px);
          border-radius: 999px;
          background: var(--ba-ink);
          transition:
            transform 600ms cubic-bezier(0.55, 0.05, 0.2, 1),
            background 500ms ease;
          box-shadow: 0 6px 18px -8px rgba(11, 18, 32, 0.5);
        }
        .ba-toggle-wrap[data-state="after"] .ba-pill {
          transform: translateX(100%);
          background: linear-gradient(135deg, #10b981, #059669);
          box-shadow: 0 6px 18px -6px rgba(16, 185, 129, 0.55);
        }
        .ba-toggle-wrap button {
          position: relative;
          z-index: 1;
          border: none;
          background: transparent;
          font-family: inherit;
          font-size: 14px;
          font-weight: 600;
          padding: 10px 22px;
          border-radius: 999px;
          cursor: pointer;
          color: var(--ba-ink-3);
          letter-spacing: 0.04em;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          transition: color 400ms ease;
          min-width: 150px;
          justify-content: center;
        }
        .ba-toggle-wrap button.is-active { color: white; }
        .ba-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        .ba-dot-before {
          background: var(--ba-warn);
          box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.18);
        }
        .ba-dot-after {
          background: #5eead4;
          box-shadow: 0 0 0 3px rgba(94, 234, 212, 0.3);
        }

        .ba-stage {
          position: relative;
          margin: 56px auto 0;
          max-width: 1100px;
          border-radius: 28px;
          background: white;
          border: 1px solid var(--ba-line);
          box-shadow:
            0 1px 0 rgba(255, 255, 255, 0.9) inset,
            0 40px 80px -40px rgba(11, 18, 32, 0.32),
            0 14px 36px -20px rgba(11, 18, 32, 0.18);
          overflow: hidden;
          isolation: isolate;
          opacity: 0;
          transform: translateY(24px) scale(0.985);
          transition:
            opacity 900ms ease,
            transform 1000ms cubic-bezier(0.22, 0.7, 0.18, 1);
        }
        .ba-stage.in {
          opacity: 1;
          transform: none;
        }

        .ba-arena {
          position: relative;
          display: grid;
          grid-template-columns: 1fr 1fr;
          min-height: 580px;
        }
        @media (max-width: 820px) {
          .ba-arena { grid-template-columns: 1fr; }
        }

        .ba-split {
          position: absolute;
          top: 0;
          bottom: 0;
          left: 50%;
          width: 1px;
          background: linear-gradient(
            to bottom,
            transparent,
            var(--ba-line) 12%,
            var(--ba-line) 88%,
            transparent
          );
          z-index: 2;
        }
        @media (max-width: 820px) {
          .ba-split { display: none; }
        }

        .ba-side {
          padding: 32px 32px 36px;
          position: relative;
          transition:
            filter 600ms ease,
            opacity 600ms ease,
            transform 800ms cubic-bezier(0.22, 0.7, 0.18, 1);
        }
        .ba-side-before {
          background:
            radial-gradient(80% 60% at 20% 10%, rgba(239, 68, 68, 0.05), transparent 60%),
            linear-gradient(180deg, #fff7f6, #fff);
        }
        .ba-side-after {
          background:
            radial-gradient(80% 60% at 80% 90%, rgba(16, 185, 129, 0.07), transparent 60%),
            linear-gradient(180deg, #f0fdf6, #fff);
        }

        .ba-side-head {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 26px;
        }
        .ba-icon {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          display: grid;
          place-items: center;
          flex-shrink: 0;
        }
        .ba-side-before .ba-icon {
          background: var(--ba-warn-soft);
          border: 1px solid rgba(239, 68, 68, 0.22);
          color: var(--ba-warn);
        }
        .ba-side-after .ba-icon {
          background: var(--ba-accent-soft);
          border: 1px solid rgba(16, 185, 129, 0.25);
          color: var(--ba-accent-2);
        }
        .ba-icon :global(svg) {
          width: 18px;
          height: 18px;
          stroke-width: 2.2;
        }
        .ba-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }
        .ba-side-before .ba-label { color: var(--ba-warn); }
        .ba-side-after .ba-label { color: var(--ba-accent-2); }
        .ba-side-head h3 {
          margin: 2px 0 0;
          font-size: 22px;
          font-weight: 700;
          letter-spacing: -0.015em;
          color: var(--ba-ink);
        }

        .ba-items {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .ba-item {
          display: grid;
          grid-template-columns: 22px 1fr;
          gap: 12px;
          align-items: flex-start;
          padding: 12px 14px;
          border-radius: 12px;
          background: white;
          border: 1px solid var(--ba-line);
          font-size: 14px;
          line-height: 1.5;
          color: var(--ba-ink-2);
          transition:
            transform 600ms cubic-bezier(0.22, 0.7, 0.18, 1) var(--d, 0ms),
            opacity 600ms ease var(--d, 0ms),
            filter 600ms ease var(--d, 0ms),
            border-color 400ms ease,
            box-shadow 400ms ease,
            background 400ms ease;
          box-shadow:
            0 1px 0 rgba(255, 255, 255, 0.9) inset,
            0 2px 6px -3px rgba(11, 18, 32, 0.06);
        }

        .ba-mark {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          display: grid;
          place-items: center;
          margin-top: 1px;
          transition:
            transform 400ms ease,
            background 400ms ease,
            box-shadow 500ms ease;
        }
        .ba-item-before .ba-mark {
          background: var(--ba-warn-soft);
          color: var(--ba-warn);
          border: 1px solid rgba(239, 68, 68, 0.3);
        }
        .ba-item-after .ba-mark {
          background: var(--ba-accent-soft);
          color: var(--ba-accent-2);
          border: 1px solid rgba(16, 185, 129, 0.35);
        }
        .ba-mark :global(svg) {
          width: 11px;
          height: 11px;
          stroke-width: 3;
          fill: none;
          stroke: currentColor;
          stroke-linecap: round;
          stroke-linejoin: round;
        }

        .ba-stage[data-state="before"] .ba-side-before .ba-item {
          border-color: rgba(239, 68, 68, 0.22);
          background: linear-gradient(180deg, #fff, #fff7f6);
          box-shadow:
            0 1px 0 rgba(255, 255, 255, 0.9) inset,
            0 6px 14px -8px rgba(239, 68, 68, 0.18);
          animation: ba-jitter 4.6s ease-in-out infinite;
          animation-delay: var(--jd, 0ms);
        }
        .ba-stage[data-state="before"] .ba-side-before .ba-item:nth-child(2n) {
          animation-direction: alternate;
        }
        @keyframes ba-jitter {
          0%, 100% { transform: translateX(0) rotate(0deg); }
          25%      { transform: translateX(2px) rotate(0.18deg); }
          50%      { transform: translateX(-2px) rotate(-0.16deg); }
          75%      { transform: translateX(1px) rotate(0.1deg); }
        }
        .ba-stage[data-state="before"] .ba-side-before .ba-item .ba-mark {
          animation: ba-pulseRed 2.4s ease-in-out infinite;
          animation-delay: var(--jd, 0ms);
        }
        @keyframes ba-pulseRed {
          0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.35); }
          50%      { box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
        }

        .ba-stage[data-state="after"] .ba-side-after .ba-item {
          border-color: rgba(16, 185, 129, 0.25);
          box-shadow:
            0 1px 0 rgba(255, 255, 255, 0.9) inset,
            0 8px 18px -10px rgba(16, 185, 129, 0.3);
        }
        .ba-stage[data-state="after"] .ba-side-after .ba-item .ba-mark {
          animation: ba-glowGreen 3.6s ease-in-out infinite;
          animation-delay: var(--jd, 0ms);
        }
        @keyframes ba-glowGreen {
          0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
          50%      { box-shadow: 0 0 0 5px rgba(16, 185, 129, 0.1); }
        }

        .ba-stage[data-state="before"] .ba-side-after {
          filter: blur(2px) grayscale(0.35);
          opacity: 0.45;
          transform: scale(0.98);
        }
        .ba-stage[data-state="after"] .ba-side-before {
          filter: blur(2px) grayscale(0.45) saturate(0.7);
          opacity: 0.42;
          transform: scale(0.98);
        }
        .ba-stage[data-state="both"] .ba-side {
          filter: none;
          opacity: 1;
          transform: none;
        }

        .ba-reveal {
          position: absolute;
          inset: 0;
          pointer-events: none;
          overflow: hidden;
          border-radius: inherit;
        }
        .ba-reveal::before {
          content: "";
          position: absolute;
          top: -10%;
          bottom: -10%;
          width: 40%;
          left: -50%;
          background: linear-gradient(
            100deg,
            rgba(255, 255, 255, 0) 0%,
            rgba(255, 255, 255, 0.55) 50%,
            rgba(255, 255, 255, 0) 100%
          );
          transform: skewX(-14deg);
          filter: blur(8px);
          opacity: 0;
        }
        .ba-side:global(.flash) .ba-reveal::before {
          animation: ba-sheen 900ms cubic-bezier(0.4, 0.1, 0.2, 1) forwards;
        }
        @keyframes ba-sheen {
          0%   { left: -50%; opacity: 0; }
          20%  { opacity: 1; }
          80%  { opacity: 1; }
          100% { left: 110%; opacity: 0; }
        }

        .ba-friction {
          position: absolute;
          inset: 0;
          overflow: hidden;
          pointer-events: none;
          opacity: 0;
          transition: opacity 700ms ease;
        }
        .ba-stage[data-state="before"] .ba-side-before .ba-friction {
          opacity: 0.5;
        }
        .ba-friction span {
          position: absolute;
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: var(--ba-warn);
          opacity: 0.18;
          animation: ba-floatUp linear infinite;
        }
        @keyframes ba-floatUp {
          0%   { transform: translateY(20px); opacity: 0; }
          20%  { opacity: 0.25; }
          100% { transform: translateY(-180px); opacity: 0; }
        }
      `}</style>
    </section>
  );
}
