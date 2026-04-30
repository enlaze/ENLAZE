"use client";

import { useState } from "react";
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
  "Tienes una empresa de servicios: mantenimiento, asesoría, consultoría, agencia, clínica, instaladores, multiservicio...",
  "Te tiras horas cada semana haciendo presupuestos a mano",
  "Has perdido clientes por no llegar a contestar a tiempo",
  "Tu información está repartida entre libretas, Excel y WhatsApp",
  "Haces seguimiento «cuando me acuerdo» (es decir, casi nunca)",
  "Facturas entre 50.000 € y 2 M € al año y quieres crecer sin doblar la oficina",
];

const fitNo = [
  "Tienes menos de 3 clientes al mes (todavía no lo necesitas)",
  "Buscas solo un programa para emitir facturas (hay opciones más simples)",
  "No usas WhatsApp ni email para hablar con tus clientes",
];

function ForWhom() {
  return (
    <Section tone="light">
      <AnimatedBlock y={30} duration={650}>
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-green">
            Para quién es
          </p>
          <h2 className="mt-3 text-[2rem] font-semibold tracking-[-0.02em] text-navy-900 transition-colors md:text-[2.75rem]">
            Diseñado para empresas de servicios que viven de atender bien y responder rápido
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-navy-500 transition-colors">
            ENLAZE está pensado para negocios que trabajan con solicitudes, clientes, presupuestos, tareas y seguimiento diario.
          </p>
        </div>
      </AnimatedBlock>

      <div className="mt-16 grid grid-cols-1 gap-6 lg:grid-cols-5">
        <AnimatedBlock delay={80} y={40} duration={700} className="h-full lg:col-span-3">
          {/* Sí */}
          <div
            className="
              relative h-full overflow-hidden rounded-2xl
              border border-brand-green/20 bg-white p-8 transition-colors md:p-10
              shadow-[0_1px_2px_rgba(10,25,41,0.04),0_24px_56px_-28px_rgba(0,200,150,0.25)]
            "
          >
            <div
              aria-hidden
              className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-green/60 to-transparent"
            />
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-green/10 text-brand-green ring-1 ring-inset ring-brand-green/20">
                <IconCheck size={18} />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-green">
                  Enlaze es para ti si…
                </p>
                <p className="text-[17px] font-semibold text-navy-900 transition-colors">
                  Eres una empresa de servicios que ya factura pero no escala
                </p>
              </div>
            </div>

            <ul className="mt-7 space-y-4">
              {fitYes.map((t, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-green/15 text-brand-green">
                    <IconCheck size={12} />
                  </span>
                  <span className="text-[14.5px] leading-relaxed text-navy-700 transition-colors">{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </AnimatedBlock>

        <AnimatedBlock delay={180} y={40} duration={700} className="h-full lg:col-span-2">
          {/* No */}
          <div
            className="
              relative h-full overflow-hidden rounded-2xl
              border border-navy-100 bg-navy-50/40 p-8 transition-colors md:p-10
            "
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-navy-100 text-navy-500 ring-1 ring-inset ring-navy-200">
                <IconX size={18} />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-500 transition-colors">
                  Todavía no, si…
                </p>
                <p className="text-[17px] font-semibold text-navy-900 transition-colors">Te conviene más otra cosa</p>
              </div>
            </div>

            <ul className="mt-7 space-y-4">
              {fitNo.map((t, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-navy-100 text-navy-500">
                    <IconX size={12} />
                  </span>
                  <span className="text-[14px] leading-relaxed text-navy-600 transition-colors">{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </AnimatedBlock>
      </div>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  CTA FINAL
 * ──────────────────────────────────────────────────────────────────── */

function FinalCTA() {
  return (
    <section className="relative overflow-hidden py-28 transition-colors">
      <div
        aria-hidden
        className="
          pointer-events-none absolute inset-0 -z-10
          bg-[radial-gradient(ellipse_at_center,rgba(0,200,150,0.08),transparent_60%)]
        "
      />
      <div className="mx-auto max-w-4xl px-6">
        <AnimatedBlock y={40} duration={750}>
          <div
            className="
              relative overflow-hidden rounded-3xl border border-navy-100 bg-gradient-to-b from-white to-navy-50/60 p-10 transition-colors md:p-16
              shadow-[0_1px_2px_rgba(10,25,41,0.04),0_30px_60px_-30px_rgba(10,25,41,0.15)]
            "
          >
            <div
              aria-hidden
              className="
                pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full
                bg-brand-green/10 blur-3xl
              "
            />
            <div
              aria-hidden
              className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-green/60 to-transparent"
            />

            <div className="relative text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-green">
                Empieza hoy
              </p>
              <h2 className="mx-auto mt-4 max-w-2xl text-[2rem] font-semibold tracking-[-0.02em] text-navy-900 transition-colors md:text-[2.75rem]">
                Tu próximo cliente ya te ha escrito. La pregunta es si vas a contestar a tiempo.
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-[16px] leading-relaxed text-navy-500 transition-colors">
                Crea tu cuenta en dos minutos. A partir de hoy, el sistema trabaja mientras tú te dedicas a lo que mejor sabes hacer.
              </p>

              <div className="mt-10 flex flex-wrap justify-center gap-3">
                <Link
                  href="/register"
                  className="
                    group inline-flex items-center gap-2
                    rounded-xl bg-brand-green px-7 py-4 text-[14px] font-semibold text-white
                    shadow-[0_10px_28px_-10px_rgba(0,200,150,0.55),0_2px_4px_-2px_rgba(0,200,150,0.4),inset_0_1px_0_rgba(255,255,255,0.18)]
                    ring-1 ring-inset ring-white/10
                    transition-all duration-200 ease-out
                    hover:-translate-y-[1.5px] hover:bg-brand-green-dark
                  "
                >
                  Empezar a cerrar más clientes
                  <IconArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
                </Link>
                <Link
                  href="/pricing"
                  className="
                    inline-flex items-center gap-2
                    rounded-xl border border-navy-200 bg-white px-6 py-4 text-[14px] font-semibold text-navy-800
                    transition-all duration-200
                    hover:-translate-y-[1px] hover:border-navy-300 hover:bg-navy-50
                  "
                >
                  Ver precios
                </Link>
              </div>

              <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[12.5px] text-navy-500 transition-colors">
                <span className="inline-flex items-center gap-1.5">
                  <IconCheck size={14} className="text-brand-green" />
                  Sin tarjeta de crédito
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <IconCheck size={14} className="text-brand-green" />
                  Configuración en 2 minutos
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <IconCheck size={14} className="text-brand-green" />
                  Cancela cuando quieras
                </span>
              </div>
            </div>
          </div>
        </AnimatedBlock>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Footer
 * ──────────────────────────────────────────────────────────────────── */

function Footer() {
  return (
    <footer className="border-t border-navy-100 bg-[#f4f7f5] transition-colors">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <Logo href="/" size={30} />
            <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-navy-500 transition-colors">
              El sistema que contesta, presupuesta y hace el seguimiento por ti. Para empresas de servicios que quieren crecer sin añadir más horas de oficina.
            </p>
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

        <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-navy-100 pt-8 transition-colors sm:flex-row">
          <p className="text-[12.5px] text-navy-500 transition-colors">
            © 2026 Enlaze. Hecho con cuidado en España.
          </p>
          <div className="flex items-center gap-2 text-[12.5px] text-navy-500 transition-colors">
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
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-900 transition-colors">
        {title}
      </p>
      <ul className="mt-4 space-y-2.5">
        {links.map((l) => (
          <li key={l.label}>
            <a
              href={l.href}
              className="text-[13px] text-navy-500 transition-colors hover:text-navy-900"
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
