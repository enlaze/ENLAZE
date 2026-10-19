"use client";

import Image from "next/image";
import Link from "next/link";
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { animate, motion, motionValue, useMotionTemplate, useTransform, type MotionValue } from "framer-motion";
import s from "./ChaosHero.module.css";
import { useMediaQuery } from "./useMediaQuery";
import { AUTO_ORDER_SECONDS, PIECE_LAYOUT, PIECE_SPRING, SLOT_ORDER, SLOT_SPRING, SLOTS, WINDOW_SPRING, piecesFor, slotDelays, type SlotId } from "./chaosOrder";

/*
 * Portada «El caos que se ordena». Las piezas de papeleo flotan alrededor del
 * titular y, al bajar (o solas a los 2,6 s), vuelan con rebote hasta su sitio en
 * el resumen diario, que es la captura real public/landing/resumen.png cortada
 * en cuatro franjas: cabecera (a) y las tres tareas (b, c, d).
 * Con «reducir movimiento» se pinta directamente el estado final, sin animación.
 */

const Check = () => (
  <svg width="1.4em" height="1.4em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 13l4 4 9-10M10 17l9-10" />
  </svg>
);

const Chat = ({ text, time }: { text: string; time: string }) => (
  <div className={s.wa}>
    <p>{text}</p>
    <small>
      {time}
      <Check />
    </small>
  </div>
);

const Ticket = ({ rows, total }: { rows: [string, string][]; total: string }) => (
  <div className={s.tk}>
    <span className={s.tkHead}>TICKET</span>
    {rows.map(([a, b]) => (
      <span key={a} className={s.tkRow}>
        <span>{a}</span>
        <span>{b}</span>
      </span>
    ))}
    <span className={`${s.tkRow} ${s.tkTotal}`}>
      <span>TOTAL</span>
      <span>{total}</span>
    </span>
  </div>
);

/** Dibujo de cada pieza (aspecto genérico, tonos apagados). */
const PIECE_ART: Record<string, () => ReactNode> = {
  tk1: () => <Ticket rows={[["SILICONA x2", "9,80"], ["BROCAS 6MM", "7,15"], ["CINTA", "3,20"]]} total="20,15" />,
  tk2: () => <Ticket rows={[["12/10 08:14", ""], ["COMBUSTIBLE", "45,00"]]} total="45,00" />,
  ag: () => (
      <div className={s.ag}>
        <div className={s.agHead}>
          <svg width="1.4em" height="1.4em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
          AGENDA
        </div>
        <div className={s.agBody}>Lunes 9:00 · obra</div>
      </div>
    ),
  inv: () => (
      <div className={s.inv}>
        <div className={s.invHead}>
          <b>FACTURA</b>
          <span>Nº 0009</span>
        </div>
        <div className={s.invTo}>Com. de propietarios Pinar 8</div>
        <div className={s.invLines}>
          <i />
          <i className={s.short} />
          <i />
          <i className={s.short} />
          <i />
        </div>
        <div className={s.invTotal}>
          <span>TOTAL</span>
          <span>1.240,00 €</span>
        </div>
        <span className={s.invStamp}>VENCIDA</span>
      </div>
    ),
  wa2: () => <Chat text="¿Cuándo me pagas?" time="18:05" />,
  amt1: () => <div className={s.amt}>1.240 €</div>,
  wa3: () => <Chat text="Te transfiero mañana" time="21:37" />,
  amt2: () => <div className={`${s.amt} ${s.amtHand}`}>630 €</div>,
  wa1: () => <Chat text="¿Me pasas el presupuesto?" time="10:42" />,
  pi: () => (
      <div className={s.pi}>
        <p>Llamar a Javier</p>
        <svg width="6.5em" height=".8em" viewBox="0 0 120 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M2 8c20-6 40 2 60-2s38-4 56 0" />
        </svg>
      </div>
    ),
  em: () => (
      <div className={s.em}>
        <span className={s.emIcon}>
          <svg width="1.3em" height="1.3em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M3 7l9 6 9-6" />
          </svg>
        </span>
        <span className={s.emText}>
          <span className={s.emTop}>
            <span>Correo</span>
            <span>ahora</span>
          </span>
          <span className={s.emFrom}>Javier Ruiz</span>
          <span className={s.emSubject}>Re: presupuesto cocina</span>
        </span>
      </div>
    ),
};

type Placed = ReturnType<typeof piecesFor>[number];

type PieceValues = { q: MotionValue<number>; o: MotionValue<number>; dx: MotionValue<number>; dy: MotionValue<number>; st: MotionValue<number> };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function Piece({ spec, v, mobile, innerRef }: { spec: Placed; v: PieceValues; mobile: boolean; innerRef: (el: HTMLDivElement | null) => void }) {
  const unit = () => {
    const dx = v.dx.get();
    const dy = v.dy.get();
    const len = Math.hypot(dx, dy) || 1;
    return { dx, dy, ux: dx / len, uy: dy / len, arc: spec.arc * Math.sin(Math.PI * clamp01(v.q.get())) };
  };
  const x = useTransform(() => {
    const { dx, uy, arc } = unit();
    return dx * v.q.get() - uy * arc;
  });
  const y = useTransform(() => {
    const { dy, ux, arc } = unit();
    return dy * v.q.get() + ux * arc;
  });
  const rotate = useTransform(() => spec.r * (1 - v.q.get()));
  const scale = useTransform(() => Math.max(0.05, 1 + (v.st.get() - 1) * v.q.get()));
  const pos = (mobile ? spec.mobile : spec.desktop) ?? spec.desktop;
  const drift = { "--drift-dur": `${6 + (spec.seed % 4)}s`, "--drift-delay": `${-spec.seed * 0.7}s` } as CSSProperties;

  return (
    <motion.div ref={innerRef} className={s.piece} style={{ left: `${pos.left}%`, top: pos.top, x, y, rotate, scale, opacity: v.o }}>
      <div className={s.drift} style={drift}>
        {PIECE_ART[spec.id]()}
      </div>
    </motion.div>
  );
}

function Slot({ id, value, priority }: { id: SlotId; value: MotionValue<number>; priority: boolean }) {
  const { top, height } = SLOTS[id];
  const opacity = useTransform(() => clamp01(value.get() * 1.4));
  const y = useTransform(() => (1 - value.get()) * 12);
  const scale = useTransform(() => 0.94 + 0.06 * value.get());
  return (
    // Rellena la franja que la contiene; la imagen se desplaza para enseñar solo su trozo.
    <motion.div className={s.slot} style={{ top: 0, height: "100%", opacity, y, scale }}>
      <Image
        src="/landing/resumen.png"
        alt={
          id === "a"
            ? "Resumen diario de Enlaze: hoy toca cobrar 1.870 € y mandar un presupuesto, con las tareas del día preparadas."
            : ""
        }
        width={1826}
        height={1322}
        priority={priority}
        sizes="(min-width: 960px) 880px, 100vw"
        style={{ top: `${(-top / height) * 100}%`, height: `${(100 / height) * 100}%` }}
      />
    </motion.div>
  );
}

function offsetWithin(el: HTMLElement, root: HTMLElement) {
  let x = 0;
  let y = 0;
  let n: HTMLElement | null = el;
  while (n && n !== root) {
    x += n.offsetLeft;
    y += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }
  return { x, y };
}

const ENTER = { duration: 1, ease: [0.16, 1, 0.3, 1] as const };

const MotionLink = motion.create(Link);

export default function ChaosHero({ trialDays }: { trialDays: number }) {
  const heroRef = useRef<HTMLElement>(null);
  const pieceEls = useRef(new Map<string, HTMLDivElement>());
  const slotEls = useRef(new Map<SlotId, HTMLDivElement>());
  const mobile = useMediaQuery("(max-width: 640px)");
  const reduce = useMediaQuery("(prefers-reduced-motion: reduce)") === true;

  // Un juego de valores por pieza y por franja; viven lo que el componente.
  const [values] = useState(() => ({
    pieces: Object.fromEntries(
      PIECE_LAYOUT.map((p) => [p.id, { q: motionValue(0), o: motionValue(0), dx: motionValue(0), dy: motionValue(0), st: motionValue(1) }]),
    ) as Record<string, PieceValues>,
    slots: Object.fromEntries(SLOT_ORDER.map((id) => [id, motionValue(0)])) as Record<SlotId, MotionValue<number>>,
    win: motionValue(0),
  }));

  const placed = useMemo(() => (mobile === null ? [] : piecesFor(mobile)), [mobile]);

  // «el papeleo» pasa de gris a verde según encajan las franjas.
  const order = useTransform(() => SLOT_ORDER.reduce((sum, id) => sum + clamp01(values.slots[id].get()), 0) / SLOT_ORDER.length);
  const accent = useTransform(order, [0, 1], ["#98a1ac", "#00c896"]);
  const glow = useTransform(() => (0.45 * order.get()).toFixed(3));
  const shadow = useMotionTemplate`0 1px 2px rgba(15,27,45,.05), 0 24px 48px -20px rgba(15,27,45,.22), 0 50px 120px -30px rgba(0,200,150,${glow})`;
  const winOpacity = useTransform(() => clamp01(values.win.get() * 1.3));
  const winY = useTransform(() => (1 - values.win.get()) * 40);
  const winScale = useTransform(() => 0.92 + 0.08 * values.win.get());

  // Dónde tiene que acabar cada pieza: centro de su franja, con un pequeño desvío lateral.
  useLayoutEffect(() => {
    const hero = heroRef.current;
    if (!hero || mobile === null) return;
    const measure = () => {
      for (const spec of placed) {
        const el = pieceEls.current.get(spec.id);
        const slot = slotEls.current.get(spec.slot);
        if (!el || !slot) continue;
        const b = offsetWithin(el, hero);
        const so = offsetWithin(slot, hero);
        const v = values.pieces[spec.id];
        v.dx.set(so.x + slot.offsetWidth * (0.5 + spec.jx) - (b.x + el.offsetWidth / 2));
        v.dy.set(so.y + slot.offsetHeight * 0.5 - (b.y + el.offsetHeight / 2));
        v.st.set(Math.max(0.16, Math.min(0.5, (slot.offsetHeight * 0.55) / (el.offsetHeight || 1))));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(hero);
    document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  }, [placed, mobile, values]);

  // Caos → orden.
  useLayoutEffect(() => {
    if (mobile === null) return;
    const all = Object.values(values.pieces);
    if (reduce) {
      for (const v of all) {
        v.q.set(1);
        v.o.set(0);
      }
      for (const id of SLOT_ORDER) values.slots[id].set(1);
      values.win.set(1);
      return;
    }

    const controls: { stop: () => void }[] = [];
    for (const spec of placed) {
      const v = values.pieces[spec.id];
      v.q.set(0);
      v.o.set(0);
      controls.push(animate(v.o, 1, { duration: 0.6, delay: 0.1 + spec.k * 0.05, ease: "easeOut" }));
    }
    for (const id of SLOT_ORDER) values.slots[id].set(0);
    values.win.set(0);

    let fired = false;
    const mountedAt = performance.now();
    const fire = () => {
      if (fired) return;
      fired = true;
      controls.push(animate(values.win, 1, WINDOW_SPRING));
      for (const spec of placed) {
        const v = values.pieces[spec.id];
        controls.push(animate(v.q, 1, { ...PIECE_SPRING, delay: spec.delay }));
        controls.push(animate(v.o, 0, { duration: 0.2, delay: spec.delay + 0.3 }));
      }
      const delays = slotDelays(placed);
      for (const id of SLOT_ORDER) {
        controls.push(animate(values.slots[id], 1, { ...SLOT_SPRING, delay: delays[id] }));
      }
    };
    const onUserScroll = () => {
      if (performance.now() - mountedAt > 400) fire();
    };
    const timer = window.setTimeout(fire, AUTO_ORDER_SECONDS * 1000);
    window.addEventListener("scroll", onUserScroll, { passive: true });
    window.addEventListener("wheel", onUserScroll, { passive: true });
    window.addEventListener("touchmove", onUserScroll, { passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", onUserScroll);
      window.removeEventListener("wheel", onUserScroll);
      window.removeEventListener("touchmove", onUserScroll);
      for (const c of controls) c.stop();
    };
  }, [placed, mobile, reduce, values]);

  const enter = (delay: number) =>
    reduce ? { initial: false as const } : { initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, transition: { ...ENTER, delay } };

  return (
    <section ref={heroRef} id="portada" className={s.hero} data-orden={reduce ? "final" : "animado"}>
      <div className={s.stage} aria-hidden="true">
        {placed.map((spec) => (
          <Piece
            key={spec.id}
            spec={spec}
            v={values.pieces[spec.id]}
            mobile={mobile === true}
            innerRef={(el) => {
              if (el) pieceEls.current.set(spec.id, el);
              else pieceEls.current.delete(spec.id);
            }}
          />
        ))}
      </div>

      <div className={s.wrap}>
        <div className={`${s.copy} font-[family-name:var(--font-landing-display)]`}>
          <h1 className={s.h1}>
            <motion.span {...enter(0)}>Tú haces el trabajo.</motion.span>
            <motion.span {...enter(0.12)}>
              Enlaze hace <motion.span style={{ display: "inline", color: accent }}>el papeleo</motion.span>.
            </motion.span>
          </h1>
          <motion.p className={s.sub} {...enter(0.28)}>
            El asistente con IA que hace el trabajo de oficina de autónomos y pymes.
          </motion.p>
          <MotionLink href="/register" className={s.cta} {...enter(0.38)}>
            Prueba {trialDays} días gratis
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </MotionLink>
          <motion.p className={s.micro} {...enter(0.46)}>
            Sin tarjeta
          </motion.p>
        </div>

        <div className={s.product}>
          <motion.figure className={s.window} style={{ opacity: winOpacity, y: winY, scale: winScale, boxShadow: shadow }}>
            <div className={s.chrome} aria-hidden="true">
              <div className={s.dots}>
                <span />
                <span />
                <span />
              </div>
              <div className={s.url}>
                <div className={s.urlpill}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="5" y="11" width="14" height="10" rx="2" />
                    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                  </svg>
                  <span>enlaze.es/dashboard</span>
                </div>
              </div>
              <div className={s.chromeend} />
            </div>
            <div className={s.screen}>
              {SLOT_ORDER.map((id) => (
                <div
                  key={id}
                  data-slot-id={id}
                  ref={(el) => {
                    if (el) slotEls.current.set(id, el);
                    else slotEls.current.delete(id);
                  }}
                  className={s.slot}
                  style={{ top: `${SLOTS[id].top}%`, height: `${SLOTS[id].height}%` }}
                >
                  <Slot id={id} value={values.slots[id]} priority={id === "a"} />
                </div>
              ))}
            </div>
          </motion.figure>
          <p className={s.caption}>El resumen de hoy de Reformas Alcor, una cuenta de demostración con datos inventados.</p>
        </div>
      </div>
    </section>
  );
}
