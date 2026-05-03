"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import Logo from "@/components/Logo";
import AnimatedBlock from "@/components/landing/AnimatedBlock";
import Section from "@/components/landing/Section";
import FeatureCard from "@/components/landing/FeatureCard";
import BeforeAfterSection from "@/components/landing/BeforeAfterSection";
import PainPointsSection from "@/components/landing/PainPointsSection";
import SoftAurora from "@/components/landing/SoftAurora";
import SolucionSection from "@/components/landing/SolucionSection";
import HowItWorks from "@/components/landing/HowItWorks";
import GradientText from "@/components/ui/gradient-text";

/* ─────────────────────────────────────────────────────────────────────
 *  Icons — estilo Lucide (stroke 1.75, rounded, 24x24)
 * ──────────────────────────────────────────────────────────────────── */

type IconProps = { className?: string; size?: number };

const Icon = ({
  children,
  size = 20,
  className = "",
}: IconProps & { children: React.ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden
  >
    {children}
  </svg>
);

const IconArrowRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </Icon>
);
const IconMenu = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Icon>
);
const IconClose = (p: IconProps) => (
  <Icon {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
);
const IconSparkles = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
  </Icon>
);
const IconUsers = (p: IconProps) => (
  <Icon {...p}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </Icon>
);
const IconMessage = (p: IconProps) => (
  <Icon {...p}>
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </Icon>
);
const IconCheck = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 12 4.5 4.5L20 6" />
  </Icon>
);
const IconX = (p: IconProps) => (
  <Icon {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
);
const IconPlay = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 5v14l12-7z" />
  </Icon>
);
const IconPlus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
const IconClock = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
);
const IconShield = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6z" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
);
const IconStar = (p: IconProps) => (
  <Icon {...p}>
    <path d="m12 3 2.9 5.9 6.6.95-4.8 4.65L17.8 21 12 17.9 6.2 21l1.1-6.5L2.5 9.85l6.6-.95z" />
  </Icon>
);
const IconAlert = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v4" />
    <path d="M12 16h.01" />
  </Icon>
);
const IconZap = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
  </Icon>
);
const IconTarget = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.5" />
  </Icon>
);
const IconRefresh = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    <path d="M3 21v-5h5" />
  </Icon>
);

/* ─────────────────────────────────────────────────────────────────────
 *  Navbar
 * ──────────────────────────────────────────────────────────────────── */

function Navbar() {
  const [open, setOpen] = useState(false);
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-navy-100 bg-white/80 backdrop-blur-xl transition-colors">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Logo href="/" size={34} />

        <div className="hidden items-center gap-8 md:flex">
          <a href="#producto" className="text-[13.5px] font-medium text-navy-600 transition-colors hover:text-navy-900">
            Producto
          </a>
          <a href="#como-funciona" className="text-[13.5px] font-medium text-navy-600 transition-colors hover:text-navy-900">
            Cómo funciona
          </a>
          <Link href="/pricing" className="text-[13.5px] font-medium text-navy-600 transition-colors hover:text-navy-900">
            Precios
          </Link>
          <Link href="/login" className="text-[13.5px] font-medium text-navy-600 transition-colors hover:text-navy-900">
            Iniciar sesión
          </Link>
          <Link
            href="/register"
            className="
              group inline-flex items-center gap-1.5 rounded-xl
              bg-navy-900 px-4 py-2.5 text-[13px] font-semibold text-white
              ring-1 ring-inset ring-white/10
              transition-all duration-200
              hover:-translate-y-[1px] hover:bg-navy-800
            "
          >
            Crear cuenta
            <IconArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>

        <button
          onClick={() => setOpen(!open)}
          className="text-navy-700 transition-colors md:hidden"
          aria-label="Abrir menú"
        >
          {open ? <IconClose size={22} /> : <IconMenu size={22} />}
        </button>
      </nav>

      {open && (
        <div className="flex flex-col gap-4 border-b border-navy-100 bg-white px-6 py-5 transition-colors md:hidden">
          <a href="#producto" onClick={() => setOpen(false)} className="text-sm font-medium text-navy-700 transition-colors">
            Producto
          </a>
          <a href="#como-funciona" onClick={() => setOpen(false)} className="text-sm font-medium text-navy-700 transition-colors">
            Cómo funciona
          </a>
          <Link href="/pricing" onClick={() => setOpen(false)} className="text-sm font-medium text-navy-700 transition-colors">
            Precios
          </Link>
          <Link href="/login" onClick={() => setOpen(false)} className="text-sm font-medium text-navy-700 transition-colors">
            Iniciar sesión
          </Link>
          <Link
            href="/register"
            onClick={() => setOpen(false)}
            className="rounded-xl bg-navy-900 px-4 py-2.5 text-center text-sm font-semibold text-white transition-colors"
          >
            Crear cuenta
          </Link>
        </div>
      )}
    </header>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  HERO — Centrado vertical en viewport sobre Soft Aurora.
 *  Solo mensaje + CTAs. Cero distracciones.
 * ──────────────────────────────────────────────────────────────────── */

function HeroMotion() {
  const reduced = useReducedMotion();

  return (
    <section
      className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-[#050b14] px-6 py-32 md:py-40"
    >
      {/* Fondo animado WebGL — Soft Aurora (ReactBits). Full-width, detrás del contenido. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
        <SoftAurora
          color1="#3b82f6"
          color2="#10b981"
          speed={1}
          scale={1.6}
          brightness={1}
          noiseFrequency={2.5}
          noiseAmplitude={1}
          bandHeight={0.5}
          bandSpread={1}
          octaveDecay={0.1}
          layerOffset={1}
          colorSpeed={1}
          enableMouseInteraction={false}
          mouseInfluence={0.25}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 60 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduced ? 0.01 : 0.9, ease: "easeOut" }}
        className="relative z-10 mx-auto w-full max-w-4xl rounded-3xl border border-white/40 bg-white/85 px-6 py-14 shadow-2xl shadow-navy-900/10 backdrop-blur-md sm:px-10 sm:py-16 md:px-14 md:py-20"
      >
        <AnimatedBlock y={20} duration={600}>
          <div className="flex justify-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-navy-100 bg-white/80 px-3.5 py-1.5 shadow-[0_1px_2px_rgba(10,25,41,0.04)] backdrop-blur transition-colors">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-green/60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-green" />
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-600 transition-colors">
                Hecho para autónomos y PYMEs de servicios
              </span>
            </div>
          </div>
        </AnimatedBlock>

        <AnimatedBlock delay={80} y={30} duration={700}>
          <h1 className="mx-auto mt-10 max-w-4xl text-center text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.025em] text-navy-900 transition-colors md:text-[4rem] lg:text-[4.5rem]">
            Vende más, cobra antes,{" "}
            <span className="relative inline-block whitespace-nowrap">
              <GradientText className="relative z-10">vive mejor.</GradientText>
              <svg
                aria-hidden
                viewBox="0 0 300 12"
                className="absolute -bottom-2 left-0 h-2.5 w-full text-brand-green/30 transition-colors"
                preserveAspectRatio="none"
              >
                <path
                  d="M2 8 Q 75 2, 150 6 T 298 5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          </h1>
        </AnimatedBlock>

        <AnimatedBlock delay={160} y={28} duration={700}>
          <p className="mx-auto mt-8 max-w-2xl text-center text-[17px] leading-relaxed text-navy-500 transition-colors md:text-[18px]">
            ENLAZE es el CRM hecho para autónomos y pequeñas empresas de servicios en España. Clientes, presupuestos, facturas y cobros en un solo sitio — sin Excel, sin WhatsApp olvidado, sin papeles.
          </p>
        </AnimatedBlock>

        <AnimatedBlock delay={240} y={24} duration={700}>
          <div className="mt-12 flex flex-wrap justify-center gap-3">
            <motion.span
              className="inline-block"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: "spring", stiffness: 420, damping: 22, mass: 0.4 }}
            >
              <Link
                href="/register"
                className="
                  group inline-flex items-center gap-2
                  rounded-xl bg-brand-green px-6 py-3.5 text-[14px] font-semibold text-white
                  shadow-[0_10px_28px_-10px_rgba(0,200,150,0.55),0_2px_4px_-2px_rgba(0,200,150,0.4),inset_0_1px_0_rgba(255,255,255,0.18)]
                  ring-1 ring-inset ring-white/10
                  transition-all duration-200 ease-out
                  hover:-translate-y-[1.5px] hover:bg-brand-green-dark
                  hover:shadow-[0_16px_36px_-12px_rgba(0,200,150,0.65),0_2px_4px_-2px_rgba(0,200,150,0.4),inset_0_1px_0_rgba(255,255,255,0.22)]
                  focus:outline-none focus:ring-2 focus:ring-brand-green/50 focus:ring-offset-2
                "
              >
                Solicitar demo
                <IconArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
              </Link>
            </motion.span>
            <motion.span
              className="inline-block"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: "spring", stiffness: 420, damping: 22, mass: 0.4 }}
            >
              <a
                href="#como-funciona"
                className="
                  group inline-flex items-center gap-2
                  rounded-xl border border-navy-200 bg-white px-6 py-3.5 text-[14px] font-semibold text-navy-800
                  transition-all duration-200
                  hover:-translate-y-[1px] hover:border-navy-300 hover:bg-navy-50
                "
              >
                <IconPlay size={14} />
                Ver cómo funciona
              </a>
            </motion.span>
          </div>
        </AnimatedBlock>

        <AnimatedBlock delay={320} y={18} duration={700}>
          <p className="mx-auto mt-8 max-w-xl text-center text-[14px] leading-relaxed text-navy-400 transition-colors">
            Se acabó perseguir cobros, perder mensajes en WhatsApp y hacer presupuestos a mano. Ordena tu negocio y recupera tus tardes.
          </p>

          <p className="mt-4 text-center text-[13px] text-navy-500 transition-colors">
            Sin tarjeta · Listo en 2 minutos · Verifactu incluido · Soporte en español
          </p>
        </AnimatedBlock>
      </motion.div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  For whom — Enlaze es para ti si…
 * ──────────────────────────────────────────────────────────────────── */

const fitYes = [
  "Paso horas haciendo presupuestos que deberían llevarme minutos",
  "He perdido algún cliente por no responder a tiempo",
  "Mis datos viven entre el móvil, Excel y la cabeza",
  "Facturo bien pero siempre cobro tarde",
  "Quiero crecer sin contratar más personas",
];

const serviceTypes = [
  "Asesorías", "Consultoras", "Agencias", "Gestorías", "Clínicas",
  "Instaladores", "Reformas", "Arquitectura", "Diseño", "Fotografía",
  "Formación", "Mantenimiento", "Electricistas", "Fontaneros",
  "Fisioterapia", "Psicología", "Informática", "Limpieza", "Multiservicio",
];

const ForWhomHTML = `
<style>
  :root{
    --cream: #f4f7f5;
    --cream-2: #ecf1ed;
    --navy: #0a1929;
    --ink: #0a1929;
    --ink-2: #4a5868;
    --ink-3: #7a8898;
    --green: #00c896;
    --green-2: #00b386;
    --green-soft: #e6f9f2;
    --white: #ffffff;
  }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:var(--cream);color:var(--ink);font-family:'Geist',ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}

  .section{
    position:relative; overflow:hidden;
    padding: 130px 24px 160px;
    background: var(--cream);
  }
  /* Soft ambient light behind the section */
  .section::before{
    content:""; position:absolute; inset:0; pointer-events:none;
    background:
      radial-gradient(45% 35% at 50% 18%, rgba(0,200,150,.07), transparent 65%),
      radial-gradient(60% 50% at 50% 100%, rgba(0,200,150,.04), transparent 70%);
  }
  .wrap{max-width:1240px;margin:0 auto;position:relative; z-index:1;}

  /* HEAD =============================================================== */
  .head{ text-align:center; max-width: 760px; margin: 0 auto 56px; }
  .eyebrow{
    color: var(--green);
    font-family:'Geist Mono', monospace;
    font-size:12px; letter-spacing:.24em; text-transform:uppercase;
    font-weight:500;
  }
  h2{
    font-size: clamp(40px, 5vw, 60px);
    line-height:1.06;
    letter-spacing:-0.025em;
    margin: 18px 0 18px;
    font-weight: 600;
    color: var(--navy);
    text-wrap: balance;
  }
  .lede{
    color: var(--ink-2); font-size: 16px; line-height: 1.65;
    max-width: 620px; margin: 0 auto;
  }

  /* MARQUEE ============================================================ */
  .marquee{
    position: relative;
    width: 100%;
    overflow: hidden;
    -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 14%, #000 86%, transparent 100%);
            mask-image: linear-gradient(90deg, transparent 0, #000 14%, #000 86%, transparent 100%);
    padding: 22px 0;
  }
  .track{
    display: flex;
    width: max-content;
    gap: 14px;
    animation: scroll 56s linear infinite;
    will-change: transform;
  }
  .marquee:hover .track{ animation-play-state: paused; }
  @keyframes scroll{
    0%   { transform: translate3d(0,0,0); }
    100% { transform: translate3d(-50%,0,0); }
  }

  /* PILL — glassmorphism + gradient border + hover lift */
  .pill{
    position: relative;
    flex-shrink: 0;
    padding: 12px 22px;
    border-radius: 999px;
    background: linear-gradient(180deg, rgba(255,255,255,.85), rgba(244,247,245,.7));
    color: var(--navy);
    font-size: 14.5px;
    font-weight: 500;
    letter-spacing: -0.005em;
    white-space: nowrap;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,.95),
      inset 0 -1px 0 rgba(10,25,41,.03),
      0 1px 2px rgba(10,25,41,.03),
      0 8px 18px -10px rgba(10,25,41,.10);
    transition: transform .35s cubic-bezier(.2,.7,.2,1),
                box-shadow .35s ease,
                color .35s ease;
  }
  /* gradient border using mask trick */
  .pill::before{
    content:"";
    position:absolute; inset:0;
    border-radius: 999px;
    padding: 1px;
    background: linear-gradient(135deg, rgba(0,200,150,.45), rgba(10,25,41,.10) 45%, rgba(10,25,41,.06));
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
            mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor; mask-composite: exclude;
    pointer-events:none;
    transition: background .35s ease, opacity .35s ease;
  }
  .pill:hover{
    transform: translateY(-3px) scale(1.03);
    color: var(--green-2);
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,.95),
      0 1px 2px rgba(10,25,41,.03),
      0 14px 28px -10px rgba(0,200,150,.30),
      0 6px 14px -6px rgba(0,200,150,.20);
  }
  .pill:hover::before{
    background: linear-gradient(135deg, rgba(0,200,150,.85), rgba(0,200,150,.30) 60%, rgba(0,200,150,.15));
  }

  /* TAGLINE ============================================================ */
  .tagline{
    margin-top: 44px;
    text-align: center;
    color: var(--green);
    font-family: 'Geist', sans-serif;
    font-size: clamp(22px, 2.6vw, 30px);
    letter-spacing: -0.012em;
    font-weight: 600;
    display: flex; align-items: center; justify-content: center; gap: 14px;
    line-height: 1.2;
  }
  .tagline .pip{
    width:11px; height:11px; border-radius:50%;
    background: var(--green);
    box-shadow: 0 0 0 5px rgba(0,200,150,.16), 0 0 16px rgba(0,200,150,.7);
    animation: pulse 2.4s ease-in-out infinite;
    flex-shrink: 0;
  }
  .tagline .text{
    background: linear-gradient(90deg, var(--green) 0%, var(--green-2) 50%, var(--green) 100%);
    background-size: 200% 100%;
    -webkit-background-clip: text; background-clip: text;
    color: transparent;
    animation: shimmer 5s ease-in-out infinite;
  }
  @keyframes pulse{0%,100%{opacity:.55; transform:scale(1)}50%{opacity:1; transform:scale(1.2)}}
  @keyframes shimmer{
    0%,100% { background-position: 0% 50%; }
    50%     { background-position: 100% 50%; }
  }

  /* CARD =============================================================== */
  .card-wrap{
    margin: 80px auto 0;
    max-width: 560px;
    position: relative;
  }
  /* halo behind card */
  .card-wrap::before{
    content:""; position:absolute; inset:-30px;
    background: radial-gradient(50% 60% at 50% 60%, rgba(0,200,150,.18), transparent 70%);
    pointer-events: none;
    filter: blur(8px);
    z-index: 0;
  }

  .card{
    position: relative;
    background: var(--white);
    border: 1px solid rgba(0,200,150,.18);
    border-radius: 20px;
    padding: 28px 32px 30px;
    box-shadow:
      0 1px 0 rgba(255,255,255,1) inset,
      0 30px 60px -28px rgba(0,200,150,.30),
      0 14px 30px -10px rgba(10,25,41,.08);
    z-index: 1;
    overflow: hidden;
  }
  /* Top decorative line */
  .card::before{
    content: "";
    position: absolute;
    top: 0; left: 12%; right: 12%;
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--green), transparent);
    opacity: .9;
  }

  .card-head{
    display:flex; align-items:center; gap: 12px;
    padding-bottom: 18px;
    border-bottom: 1px dashed rgba(10,25,41,.08);
    margin-bottom: 18px;
  }
  .check-circle{
    width: 44px; height: 44px;
    border-radius: 50%;
    background: var(--white);
    border: 1px solid rgba(0,200,150,.25);
    display:grid; place-items:center;
    flex-shrink: 0;
    box-shadow: 0 0 0 4px rgba(0,200,150,.08), 0 4px 12px -4px rgba(0,200,150,.20);
    overflow: hidden;
    padding: 6px;
  }
  .check-circle img{
    width: 100%; height: 100%; object-fit: contain; display:block;
  }
  .card-head .title{
    color: var(--green-2);
    font-family: 'Geist Mono', monospace;
    font-size: 11px;
    letter-spacing: .22em;
    text-transform: uppercase;
    font-weight: 500;
  }

  .list{ list-style: none; margin:0; padding:0; display: flex; flex-direction: column; gap: 4px; }
  .list li{
    display: flex; align-items: center; gap: 14px;
    padding: 12px 12px;
    margin: 0 -12px;
    border-radius: 12px;
    color: var(--ink);
    font-size: 15px;
    line-height: 1.45;
    transition: background .25s ease, transform .25s ease;
  }
  .list li:hover{
    background: var(--green-soft);
    transform: translateX(2px);
  }
  .list .ck{
    flex-shrink: 0;
    width: 22px; height: 22px;
    border-radius: 50%;
    background: var(--green-soft);
    border: 1px solid rgba(0,200,150,.30);
    display: grid; place-items: center;
    color: var(--green-2);
  }

  /* prefers-reduced-motion */
  @media (prefers-reduced-motion: reduce){
    .marquee{
      -webkit-mask-image: none; mask-image: none;
      padding: 0;
    }
    .track{
      animation: none;
      width: 100%;
      flex-wrap: wrap;
      justify-content: center;
      gap: 10px;
    }
    .track > .copy-2{ display:none; }
    .pill, .pill:hover{ transform: none; }
    .tagline .pip{ animation: none; }
    .tagline .text{ animation: none; background: none; -webkit-background-clip: initial; background-clip: initial; color: var(--green); }
    .list li:hover{ transform: none; }
  }
</style>
  <section class="section" aria-labelledby="es-para-mi-title">
    <div class="wrap">

      <!-- HEAD -->
      <div class="head">
        <div class="eyebrow">¿ES PARA MÍ?</div>
        <h2 id="es-para-mi-title">Hecho para quien vive de sus clientes.</h2>
        <p class="lede">No somos un software de facturas. Somos para quien necesita que sus clientes, presupuestos, facturas y cobros funcionen juntos — sin montar cinco herramientas distintas.</p>
      </div>

      <!-- MARQUEE -->
      <div class="marquee" role="region" aria-label="Sectores que usan Enlaze">
        <div class="track">
          <span class="pill copy-1">Asesorías</span>
          <span class="pill copy-1">Consultoras</span>
          <span class="pill copy-1">Agencias</span>
          <span class="pill copy-1">Gestorías</span>
          <span class="pill copy-1">Clínicas</span>
          <span class="pill copy-1">Instaladores</span>
          <span class="pill copy-1">Reformas</span>
          <span class="pill copy-1">Arquitectura</span>
          <span class="pill copy-1">Diseño</span>
          <span class="pill copy-1">Fotografía</span>
          <span class="pill copy-1">Formación</span>
          <span class="pill copy-1">Mantenimiento</span>
          <span class="pill copy-1">Electricistas</span>
          <span class="pill copy-1">Fontaneros</span>
          <span class="pill copy-1">Fisioterapia</span>
          <span class="pill copy-1">Psicología</span>
          <span class="pill copy-1">Informática</span>
          <span class="pill copy-1">Limpieza</span>
          <span class="pill copy-1">Multiservicio</span>

          <span class="pill copy-2" aria-hidden="true">Asesorías</span>
          <span class="pill copy-2" aria-hidden="true">Consultoras</span>
          <span class="pill copy-2" aria-hidden="true">Agencias</span>
          <span class="pill copy-2" aria-hidden="true">Gestorías</span>
          <span class="pill copy-2" aria-hidden="true">Clínicas</span>
          <span class="pill copy-2" aria-hidden="true">Instaladores</span>
          <span class="pill copy-2" aria-hidden="true">Reformas</span>
          <span class="pill copy-2" aria-hidden="true">Arquitectura</span>
          <span class="pill copy-2" aria-hidden="true">Diseño</span>
          <span class="pill copy-2" aria-hidden="true">Fotografía</span>
          <span class="pill copy-2" aria-hidden="true">Formación</span>
          <span class="pill copy-2" aria-hidden="true">Mantenimiento</span>
          <span class="pill copy-2" aria-hidden="true">Electricistas</span>
          <span class="pill copy-2" aria-hidden="true">Fontaneros</span>
          <span class="pill copy-2" aria-hidden="true">Fisioterapia</span>
          <span class="pill copy-2" aria-hidden="true">Psicología</span>
          <span class="pill copy-2" aria-hidden="true">Informática</span>
          <span class="pill copy-2" aria-hidden="true">Limpieza</span>
          <span class="pill copy-2" aria-hidden="true">Multiservicio</span>
        </div>
      </div>

      <p class="tagline"><span class="pip"></span><span class="text">Si tienes clientes, ya es para ti.</span></p>

      <!-- CARD -->
      <div class="card-wrap">
        <div class="card">
          <div class="card-head">
            <div class="check-circle" aria-hidden="true">
              <img src="/logo.png" alt="" />
            </div>
            <div class="title">ENLAZE ES PARA TI SI…</div>
          </div>

          <ul class="list">
            <li>
              <span class="ck"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12 5 5 9-11" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
              Paso horas haciendo presupuestos que deberían llevarme minutos
            </li>
            <li>
              <span class="ck"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12 5 5 9-11" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
              He perdido algún cliente por no responder a tiempo
            </li>
            <li>
              <span class="ck"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12 5 5 9-11" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
              Mis datos viven entre el móvil, Excel y la cabeza
            </li>
            <li>
              <span class="ck"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12 5 5 9-11" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
              Facturo bien pero siempre cobro tarde
            </li>
            <li>
              <span class="ck"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12 5 5 9-11" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
              Quiero crecer sin contratar más personas
            </li>
          </ul>
        </div>
      </div>

    </div>
  </section>
`;

function ForWhom() {
  return <div dangerouslySetInnerHTML={{ __html: ForWhomHTML }} />;
}

/* ─────────────────────────────────────────────────────────────────────
 *  CTA FINAL
 * ──────────────────────────────────────────────────────────────────── */

const FinalCTAHTML = `
<style>
  .cta-scope{
    --cta-cream: #f4f7f5;
    --cta-navy: #050b14;
    --cta-navy-2: #0a1422;
    --cta-ink: #ffffff;
    --cta-ink-2: #aab8c8;
    --cta-ink-3: #6f8095;
    --cta-green: #00c896;
    --cta-green-2: #00b386;
    --cta-green-3: #00d6a3;
    color: var(--cta-ink);
    font-family:'Geist',ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
    -webkit-font-smoothing:antialiased;
    text-rendering:optimizeLegibility;
  }
  .cta-scope *{box-sizing:border-box}

  .cta-scope .cream-stub{ display:none; }

  .cta-scope .section{
    position:relative;
    overflow:hidden;
    background: var(--cta-navy);
    padding: 160px 24px 160px;
    isolation: isolate;
  }
  /* Smooth top transition from cream */
  .cta-scope .section::before{
    content:""; position:absolute; left:0; right:0; top:0; height: 110px;
    background: linear-gradient(180deg, var(--cta-cream) 0%, var(--cta-navy) 100%);
    pointer-events: none;
    z-index: 1;
  }

  /* Animated background field */
  .cta-scope .bg{ position:absolute; inset:0; pointer-events:none; z-index: 0; overflow:hidden; }
  .cta-scope .bg .glow{
    position:absolute; left:50%; top:50%;
    width: 900px; height: 900px;
    transform: translate(-50%,-50%);
    background:
      radial-gradient(closest-side, rgba(0,200,150,.22), transparent 70%);
    filter: blur(20px);
    animation: ctaGlowPulse 6s ease-in-out infinite;
  }
  .cta-scope .bg .glow.b{
    width: 1300px; height: 1300px;
    background: radial-gradient(closest-side, rgba(0,200,150,.10), transparent 70%);
    animation-duration: 9s;
    animation-delay: -3s;
  }
  @keyframes ctaGlowPulse{
    0%,100% { opacity:.7; transform: translate(-50%,-50%) scale(1); }
    50%     { opacity:1;  transform: translate(-50%,-50%) scale(1.06); }
  }
  .cta-scope .bg .grid{
    position:absolute; inset:0;
    background-image:
      linear-gradient(to right, rgba(255,255,255,.04) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(255,255,255,.04) 1px, transparent 1px);
    background-size: 64px 64px;
    mask-image: radial-gradient(ellipse 60% 60% at 50% 50%, #000 30%, transparent 85%);
    -webkit-mask-image: radial-gradient(ellipse 60% 60% at 50% 50%, #000 30%, transparent 85%);
  }
  .cta-scope .bg .stars{ position:absolute; inset:0; }
  .cta-scope .bg .stars i{
    position:absolute; width:2px; height:2px; border-radius:50%;
    background: #cdf5e6; opacity:.4;
    box-shadow: 0 0 6px rgba(0,200,150,.6);
    animation: ctaTw 6s ease-in-out infinite;
  }
  @keyframes ctaTw{ 0%,100%{opacity:.15} 50%{opacity:.7} }
  .cta-scope .bg .noise{
    position:absolute; inset:0;
    opacity:.04; mix-blend-mode: overlay;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
  }

  .cta-scope .wrap{ position:relative; z-index:2; max-width: 920px; margin: 0 auto; text-align:center; }

  /* Card with luminous border */
  .cta-scope .card{
    position: relative;
    padding: 64px 56px 56px;
    border-radius: 28px;
    background: linear-gradient(180deg, rgba(255,255,255,.025), rgba(255,255,255,.008));
    border: 1px solid rgba(255,255,255,.08);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,.06),
      0 40px 120px -40px rgba(0,200,150,.20),
      0 30px 80px -40px rgba(0,0,0,.5);
    opacity: 0; transform: translateY(20px);
    animation: ctaRise .9s cubic-bezier(.2,.7,.2,1) .15s forwards;
  }
  .cta-scope .card::before{
    content:""; position:absolute; inset:-1px; border-radius: 29px; padding:1px;
    background: linear-gradient(180deg, rgba(0,200,150,.45), rgba(255,255,255,.10) 30%, rgba(0,200,150,.25));
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
            mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor; mask-composite: exclude;
    pointer-events:none;
  }
  @keyframes ctaRise{ to{ opacity:1; transform:none; } }

  .cta-scope .eyebrow{
    display:inline-flex; align-items:center; gap:10px;
    color: var(--cta-green);
    font-family:'Geist Mono', monospace;
    font-size: 12px; letter-spacing:.24em; text-transform:uppercase;
    padding: 6px 12px;
    border:1px solid rgba(0,200,150,.30);
    border-radius:999px;
    background: rgba(0,200,150,.08);
  }
  .cta-scope .eyebrow .dot{
    width:6px;height:6px;border-radius:50%;background:var(--cta-green);
    box-shadow:0 0 0 4px rgba(0,200,150,.18), 0 0 12px rgba(0,200,150,.7);
    animation: ctaPulse 2.4s ease-in-out infinite;
  }
  @keyframes ctaPulse{0%,100%{opacity:.7}50%{opacity:1}}

  .cta-scope h2{
    margin: 24px auto 22px;
    max-width: 780px;
    font-size: clamp(36px, 4.6vw, 56px);
    line-height: 1.08;
    letter-spacing: -0.025em;
    font-weight: 600;
    color: var(--cta-ink);
    text-wrap: balance;
  }
  .cta-scope .lede{
    color: var(--cta-ink-2);
    font-size: 17px; line-height: 1.6;
    max-width: 580px; margin: 0 auto 36px;
  }

  .cta-scope .actions{
    display:inline-flex; gap: 14px; flex-wrap: wrap; justify-content:center;
  }
  .cta-scope .btn{
    display:inline-flex; align-items:center; gap:10px;
    padding: 15px 22px;
    border-radius: 12px;
    font-size: 15px; font-weight: 600;
    text-decoration: none;
    transition: transform .25s, box-shadow .35s, background .3s, border-color .3s, color .3s;
    cursor: pointer;
    border: 1px solid transparent;
    font-family: inherit;
    position: relative;
    overflow: hidden;
  }
  .cta-scope .btn.primary{
    background: linear-gradient(180deg, var(--cta-green-3), var(--cta-green));
    color: #053926;
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,.45),
      0 10px 28px -8px rgba(0,200,150,.55),
      0 0 0 1px rgba(0,200,150,.30);
    animation: ctaBtnGlow 2.6s ease-in-out infinite;
  }
  @keyframes ctaBtnGlow{
    0%,100% { box-shadow: inset 0 1px 0 rgba(255,255,255,.45), 0 10px 28px -8px rgba(0,200,150,.55), 0 0 0 1px rgba(0,200,150,.30); }
    50%     { box-shadow: inset 0 1px 0 rgba(255,255,255,.5), 0 14px 36px -8px rgba(0,200,150,.75), 0 0 0 1px rgba(0,200,150,.45); }
  }
  /* shimmer sweep */
  .cta-scope .btn.primary::before{
    content:""; position:absolute; top:0; left:-60%; width:50%; height:100%;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,.45), transparent);
    transform: skewX(-20deg);
    animation: ctaShimmer 3.2s ease-in-out infinite;
  }
  @keyframes ctaShimmer{
    0%   { left: -60%; }
    60%,100% { left: 130%; }
  }
  .cta-scope .btn.primary:hover{
    transform: translateY(-2px);
  }
  .cta-scope .btn.secondary{
    background: rgba(255,255,255,.04);
    color: var(--cta-ink);
    border-color: rgba(255,255,255,.20);
    backdrop-filter: blur(4px);
  }
  .cta-scope .btn.secondary:hover{
    background: rgba(255,255,255,.08);
    border-color: rgba(255,255,255,.45);
    transform: translateY(-2px);
  }

  .cta-scope .micro{
    margin-top: 28px;
    color: var(--cta-ink-3);
    font-size: 13px;
    display:flex; flex-wrap:wrap; justify-content:center; gap: 6px 22px;
  }
  .cta-scope .micro span{ display:inline-flex; align-items:center; gap:8px; }
  .cta-scope .micro svg{ color: var(--cta-green); }

  /* prefers-reduced-motion */
  @media (prefers-reduced-motion: reduce){
    .cta-scope .bg{ display:none; }
    .cta-scope .card{ opacity:1; transform:none; animation:none; }
    .cta-scope .btn.primary, .cta-scope .btn.primary::before, .cta-scope .eyebrow .dot{ animation:none; }
  }

  @media (max-width: 720px){
    .cta-scope .card{ padding: 44px 24px 36px; }
  }
</style>
<div class="cta-scope">
  <div class="cream-stub"></div>

  <section class="section" aria-labelledby="cta-title">
    <div class="bg" aria-hidden="true">
      <div class="glow b"></div>
      <div class="glow"></div>
      <div class="grid"></div>
      <div class="stars" id="stars"></div>
      <div class="noise"></div>
    </div>

    <div class="wrap">
      <div class="card">
        <span class="eyebrow"><span class="dot"></span> EMPIEZA HOY</span>
        <h2 id="cta-title">Tu próximo cliente ya te ha escrito. La pregunta es si vas a contestar a tiempo.</h2>
        <p class="lede">Crea tu cuenta en dos minutos. A partir de hoy, el sistema trabaja mientras tú te dedicas a lo que mejor sabes hacer.</p>

        <div class="actions">
          <a href="#" class="btn primary">
            Empezar a cerrar más clientes
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 5l7 7-7 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </a>
          <a href="#" class="btn secondary">Ver precios</a>
        </div>

        <div class="micro">
          <span><svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="m5 12 5 5 9-11" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg> Sin tarjeta de crédito</span>
          <span><svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="m5 12 5 5 9-11" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg> Configuración en 2 minutos</span>
          <span><svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="m5 12 5 5 9-11" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg> Cancela cuando quieras</span>
        </div>
      </div>
    </div>
  </section>
</div>
`;

function FinalCTA() {
  useEffect(() => {
    const host = document.getElementById("stars");
    if (!host || host.childElementCount > 0) return;
    const N = 28;
    for (let k = 0; k < N; k++) {
      const i = document.createElement("i");
      i.style.left = (Math.random() * 100).toFixed(2) + "%";
      i.style.top = (Math.random() * 100).toFixed(2) + "%";
      i.style.animationDelay = (-Math.random() * 6).toFixed(2) + "s";
      i.style.opacity = (0.15 + Math.random() * 0.45).toFixed(2);
      i.style.transform = "scale(" + (0.5 + Math.random() * 1.2).toFixed(2) + ")";
      host.appendChild(i);
    }
  }, []);
  return <div dangerouslySetInnerHTML={{ __html: FinalCTAHTML }} />;
}

/* ─────────────────────────────────────────────────────────────────────
 *  Footer
 * ──────────────────────────────────────────────────────────────────── */

function Footer() {
  return (
    <footer className="bg-[#050b14] transition-colors">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <Logo href="/" size={30} wordmarkClassName="text-white" />
          </div>

          <FooterCol
            title="Producto"
            links={[
              { label: "Funcionalidades", href: "#producto" },
              { label: "Cómo funciona", href: "#como-funciona" },
              { label: "Precios", href: "/pricing" },
            ]}
          />
          <FooterCol
            title="Empresa"
            links={[
              { label: "Iniciar sesión", href: "/login" },
              { label: "Crear cuenta", href: "/register" },
              { label: "Contacto", href: "#" },
            ]}
          />
          <FooterCol
            title="Legal"
            links={[
              { label: "Aviso legal", href: "/legal/aviso-legal" },
              { label: "Privacidad", href: "/legal/privacy" },
              { label: "Términos", href: "/legal/terms" },
              { label: "Cookies", href: "/legal/cookies" },
            ]}
          />
        </div>

        <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-8 transition-colors sm:flex-row">
          <p className="text-[12.5px] text-navy-300 transition-colors">
            © 2026 Enlaze. Hecho con cuidado en España.
          </p>
          <div className="flex items-center gap-2 text-[12.5px] text-navy-300 transition-colors">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-brand-green" />
            Todos los sistemas operativos
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: { label: string; href: string }[];
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white transition-colors">
        {title}
      </p>
      <ul className="mt-4 space-y-2.5">
        {links.map((l) => (
          <li key={l.label}>
            <a
              href={l.href}
              className="text-[13px] text-navy-300 transition-colors hover:text-white"
            >
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Page
 * ──────────────────────────────────────────────────────────────────── */

export default function Home() {
  return (
    <main className="min-h-screen bg-[#f4f7f5] text-navy-900 transition-colors antialiased">
      <Navbar />
      <HeroMotion />
      {/* Bridge dark → cream — funde Hero (navy líquido) con PainPoints. */}
      <div
        aria-hidden
        className="h-24 -mt-1 bg-gradient-to-b from-[#050b14] to-[#f4f7f5]"
      />
      <PainPointsSection />
      <SolucionSection />
      {/* Bridge cream → dark — funde Solucion con HowItWorks (#020617). */}
      <div
        aria-hidden
        className="h-24 -mb-1 bg-gradient-to-b from-[#f4f7f5] to-[#020617]"
      />
      <HowItWorks />
      {/* Bridge dark → cream — funde HowItWorks con BeforeAfter. */}
      <div
        aria-hidden
        className="h-24 -mt-1 bg-gradient-to-b from-[#020617] to-[#f4f7f5]"
      />
      <BeforeAfterSection />
      <ForWhom />
      <FinalCTA />
      <Footer />
    </main>
  );
}
