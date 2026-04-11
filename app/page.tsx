"use client";

import { useState } from "react";
import Link from "next/link";
import Logo from "@/components/Logo";

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
const IconBell = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </Icon>
);
const IconWrench = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14.7 6.3a4.5 4.5 0 0 0 6 6L17 16l3.3 3.3a1.7 1.7 0 1 1-2.4 2.4L14.6 18.4l-3.7 3.7a4.5 4.5 0 0 1-6-6L8.6 12.4 5.3 9.1a1.7 1.7 0 1 1 2.4-2.4l3.3 3.3z" />
  </Icon>
);
const IconCheck = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 12 4.5 4.5L20 6" />
  </Icon>
);
const IconFileText = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
    <path d="M14 3v5h5" />
    <path d="M9 13h6M9 17h4" />
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
const IconQuote = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 7h4v4a4 4 0 0 1-4 4" />
    <path d="M15 7h4v4a4 4 0 0 1-4 4" />
  </Icon>
);

/* ─────────────────────────────────────────────────────────────────────
 *  Navbar
 * ──────────────────────────────────────────────────────────────────── */

function Navbar() {
  const [open, setOpen] = useState(false);
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-navy-100 bg-white/80 backdrop-blur-xl">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Logo href="/" size={34} />

        <div className="hidden items-center gap-8 md:flex">
          <a
            href="#producto"
            className="text-[13.5px] font-medium text-navy-600 transition-colors hover:text-navy-900"
          >
            Producto
          </a>
          <a
            href="#como-funciona"
            className="text-[13.5px] font-medium text-navy-600 transition-colors hover:text-navy-900"
          >
            Cómo funciona
          </a>
          <Link
            href="/pricing"
            className="text-[13.5px] font-medium text-navy-600 transition-colors hover:text-navy-900"
          >
            Precios
          </Link>
          <Link
            href="/login"
            className="text-[13.5px] font-medium text-navy-600 transition-colors hover:text-navy-900"
          >
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
          className="text-navy-700 md:hidden"
          aria-label="Abrir menú"
        >
          {open ? <IconClose size={22} /> : <IconMenu size={22} />}
        </button>
      </nav>

      {open && (
        <div className="flex flex-col gap-4 border-b border-navy-100 bg-white px-6 py-5 md:hidden">
          <a href="#producto" onClick={() => setOpen(false)} className="text-sm font-medium text-navy-700">
            Producto
          </a>
          <a href="#como-funciona" onClick={() => setOpen(false)} className="text-sm font-medium text-navy-700">
            Cómo funciona
          </a>
          <Link href="/pricing" onClick={() => setOpen(false)} className="text-sm font-medium text-navy-700">
            Precios
          </Link>
          <Link href="/login" onClick={() => setOpen(false)} className="text-sm font-medium text-navy-700">
            Iniciar sesión
          </Link>
          <Link
            href="/register"
            onClick={() => setOpen(false)}
            className="rounded-xl bg-navy-900 px-4 py-2.5 text-center text-sm font-semibold text-white"
          >
            Crear cuenta
          </Link>
        </div>
      )}
    </header>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Hero
 * ──────────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="relative overflow-hidden pt-36 pb-24 md:pt-44 md:pb-32">
      {/* Atmósfera de fondo */}
      <div
        aria-hidden
        className="
          pointer-events-none absolute inset-x-0 top-0 h-[720px] -z-10
          bg-[radial-gradient(ellipse_at_top,rgba(0,200,150,0.10),transparent_55%),radial-gradient(ellipse_at_bottom,rgba(10,25,41,0.05),transparent_60%)]
        "
      />
      {/* Grid sutil */}
      <div
        aria-hidden
        className="
          pointer-events-none absolute inset-0 -z-10 opacity-[0.25]
          [background-image:linear-gradient(to_right,#e8eef4_1px,transparent_1px),linear-gradient(to_bottom,#e8eef4_1px,transparent_1px)]
          [background-size:64px_64px]
          [mask-image:radial-gradient(ellipse_at_top,black_45%,transparent_75%)]
        "
      />

      <div className="relative mx-auto max-w-6xl px-6">
        {/* Eyebrow pill */}
        <div className="flex justify-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-navy-100 bg-white/80 px-3.5 py-1.5 shadow-[0_1px_2px_rgba(10,25,41,0.04)] backdrop-blur">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-green/60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-green" />
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-600">
              El sistema operativo de tu empresa de servicios
            </span>
          </div>
        </div>

        {/* Headline */}
        <h1 className="mx-auto mt-8 max-w-4xl text-center text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.025em] text-navy-900 md:text-[4rem] lg:text-[4.5rem]">
          Gana más clientes.{" "}
          <span className="relative inline-block whitespace-nowrap">
            <span className="relative z-10 text-brand-green">Automatiza el resto</span>
            <svg
              aria-hidden
              viewBox="0 0 300 12"
              className="absolute -bottom-2 left-0 h-2.5 w-full text-brand-green/30"
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
          .
        </h1>

        {/* Subtitle */}
        <p className="mx-auto mt-7 max-w-2xl text-center text-[17px] leading-relaxed text-navy-500 md:text-[18px]">
          Enlaze reúne tu CRM, la automatización de WhatsApp y email, los presupuestos con IA y el seguimiento comercial en un mismo panel. Para que las empresas de reformas, instalaciones y servicios técnicos cierren más trabajos con menos horas de oficina.
        </p>

        {/* CTAs */}
        <div className="mt-10 flex flex-wrap justify-center gap-3">
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
            Probar Enlaze gratis
            <IconArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
          <a
            href="#producto"
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
        </div>

        {/* Trust note */}
        <p className="mt-6 text-center text-[13px] text-navy-500">
          Sin tarjeta de crédito · Configuración en 2 minutos · Cancela cuando quieras
        </p>

        {/* Product preview mockup */}
        <ProductPreview />
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Product preview — mockup limpio del panel de presupuestos
 * ──────────────────────────────────────────────────────────────────── */

function ProductPreview() {
  return (
    <div className="relative mx-auto mt-20 max-w-5xl">
      {/* Glow bajo el mockup */}
      <div
        aria-hidden
        className="
          pointer-events-none absolute inset-x-8 -bottom-10 h-40 rounded-[40px]
          bg-gradient-to-r from-brand-green/10 via-navy-200/40 to-brand-green/10
          blur-3xl
        "
      />

      <div
        className="
          relative overflow-hidden rounded-2xl border border-navy-100 bg-white
          shadow-[0_40px_80px_-30px_rgba(10,25,41,0.25),0_20px_40px_-20px_rgba(10,25,41,0.15)]
        "
      >
        {/* Fake browser chrome */}
        <div className="flex items-center justify-between border-b border-navy-100 bg-navy-50/60 px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-navy-200" />
            <span className="h-2.5 w-2.5 rounded-full bg-navy-200" />
            <span className="h-2.5 w-2.5 rounded-full bg-navy-200" />
          </div>
          <div className="flex items-center gap-1.5 rounded-md border border-navy-100 bg-white px-3 py-1 text-[11px] text-navy-500">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-green" />
            app.enlaze.com/dashboard
          </div>
          <div className="w-12" />
        </div>

        {/* Mockup body */}
        <div className="grid grid-cols-12 gap-0">
          {/* Fake sidebar */}
          <aside className="col-span-3 hidden border-r border-navy-100 bg-white p-4 md:block">
            <div className="flex items-center gap-2 px-2 py-2">
              <div className="h-6 w-6 rounded-md bg-navy-900" />
              <div className="h-2.5 w-16 rounded bg-navy-200" />
            </div>
            <div className="mt-6 space-y-1">
              <MockNavItem label="Dashboard" active />
              <MockNavItem label="Clientes" />
              <MockNavItem label="Presupuestos" />
              <MockNavItem label="Obras" />
              <MockNavItem label="Facturas" />
              <MockNavItem label="Ajustes" />
            </div>
          </aside>

          {/* Fake main content */}
          <div className="col-span-12 bg-navy-50/30 p-5 md:col-span-9 md:p-7">
            {/* Header row */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-navy-400">
                  Nuevo presupuesto
                </div>
                <div className="mt-1 text-[15px] font-semibold text-navy-900">
                  Reforma integral — Piso C/ Castellana 48
                </div>
              </div>
              <div className="hidden items-center gap-2 rounded-full border border-brand-green/20 bg-brand-green/10 px-2.5 py-1 sm:inline-flex">
                <IconSparkles size={12} className="text-brand-green" />
                <span className="text-[11px] font-semibold text-brand-green">
                  Generado con IA
                </span>
              </div>
            </div>

            {/* Budget lines */}
            <div className="mt-5 overflow-hidden rounded-xl border border-navy-100 bg-white">
              <div className="grid grid-cols-12 gap-4 border-b border-navy-100 bg-navy-50/60 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-navy-500">
                <div className="col-span-6">Partida</div>
                <div className="col-span-2 text-right">Uds.</div>
                <div className="col-span-2 text-right">Precio</div>
                <div className="col-span-2 text-right">Total</div>
              </div>

              <MockLine label="Demolición de tabiquería interior" qty="35 m²" unit="12,00" total="420,00" />
              <MockLine label="Instalación eléctrica completa" qty="1 ud" unit="1.850,00" total="1.850,00" />
              <MockLine label="Fontanería baño principal" qty="1 ud" unit="920,00" total="920,00" />
              <MockLine label="Suelo laminado AC5 roble natural" qty="48 m²" unit="34,50" total="1.656,00" />
            </div>

            {/* Totals */}
            <div className="mt-5 flex items-end justify-between gap-4">
              <div className="text-[11px] text-navy-500">
                Enviado automáticamente al cliente el <span className="font-medium text-navy-700">9 abr 2026</span>
              </div>
              <div className="rounded-xl border border-navy-100 bg-white px-4 py-3 text-right">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-navy-500">
                  Total
                </div>
                <div className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-navy-900">
                  €4.846,00
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MockNavItem({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] font-medium ${
        active
          ? "bg-navy-900 text-white"
          : "text-navy-600"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          active ? "bg-brand-green" : "bg-navy-200"
        }`}
      />
      {label}
    </div>
  );
}

function MockLine({
  label,
  qty,
  unit,
  total,
}: {
  label: string;
  qty: string;
  unit: string;
  total: string;
}) {
  return (
    <div className="grid grid-cols-12 gap-4 border-b border-navy-50 px-4 py-3 text-[12px] last:border-0">
      <div className="col-span-6 truncate font-medium text-navy-800">{label}</div>
      <div className="col-span-2 text-right tabular-nums text-navy-600">{qty}</div>
      <div className="col-span-2 text-right tabular-nums text-navy-600">€{unit}</div>
      <div className="col-span-2 text-right font-semibold tabular-nums text-navy-900">€{total}</div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Benefits (4)
 * ──────────────────────────────────────────────────────────────────── */

const benefits = [
  {
    Icon: IconUsers,
    title: "CRM centralizado",
    desc: "Todos tus clientes, obras y conversaciones en un único sitio. Cada ficha guarda el historial completo: mensajes, presupuestos, visitas y estado del trabajo. Se acabaron las hojas de cálculo y las notas sueltas en el móvil.",
  },
  {
    Icon: IconSparkles,
    title: "Mensajes automáticos por WhatsApp y email",
    desc: "Enlaze se encarga de confirmar visitas, enviar recordatorios, avisar al cliente cuando su trabajo avanza de fase y responder a lo más repetitivo. Tú escribes la plantilla una vez y el sistema se ocupa del resto.",
  },
  {
    Icon: IconFileText,
    title: "Presupuestos generados con IA",
    desc: "Describe el trabajo en lenguaje natural y Enlaze genera un presupuesto profesional con partidas, medidas y precios, listo para enviar por WhatsApp o email desde el mismo panel.",
  },
  {
    Icon: IconBell,
    title: "Seguimiento comercial que no se olvida",
    desc: "Enlaze vigila tus presupuestos abiertos y te avisa cuando uno lleva días sin respuesta, sugiriendo el mensaje de seguimiento. Ningún cliente se queda en el olvido por descuido.",
  },
];

function Benefits() {
  return (
    <section id="producto" className="relative py-28">
      <div className="mx-auto max-w-6xl px-6">
        {/* Section header */}
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-green">
            Producto
          </p>
          <h2 className="mt-3 text-[2rem] font-semibold tracking-[-0.02em] text-navy-900 md:text-[2.75rem]">
            Un sistema completo para gestionar tu negocio de servicios
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-navy-500">
            CRM, automatización, presupuestos y seguimiento. Todo conectado, pensado para cómo trabajan de verdad las empresas de servicios técnicos.
          </p>
        </div>

        {/* Grid */}
        <div className="mt-16 grid grid-cols-1 gap-5 md:grid-cols-2">
          {benefits.map(({ Icon, title, desc }, i) => (
            <article
              key={i}
              className="
                group relative overflow-hidden rounded-2xl border border-navy-100 bg-white p-8
                shadow-[0_1px_2px_rgba(10,25,41,0.04)]
                transition-all duration-300 ease-out
                hover:-translate-y-[2px] hover:border-navy-200
                hover:shadow-[0_12px_32px_-16px_rgba(10,25,41,0.18)]
              "
            >
              <div
                className="
                  flex h-11 w-11 items-center justify-center rounded-xl
                  bg-navy-50 text-navy-700 ring-1 ring-inset ring-navy-100
                  transition-colors duration-300
                  group-hover:bg-brand-green/10 group-hover:text-brand-green group-hover:ring-brand-green/15
                "
              >
                <Icon size={20} />
              </div>
              <h3 className="mt-6 text-[17px] font-semibold tracking-tight text-navy-900">
                {title}
              </h3>
              <p className="mt-2.5 text-[14.5px] leading-relaxed text-navy-500">
                {desc}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  How it works (3 steps)
 * ──────────────────────────────────────────────────────────────────── */

const steps = [
  {
    n: "01",
    Icon: IconPlus,
    title: "Capta al cliente",
    desc: "Un nuevo contacto llega por tu web, WhatsApp o una llamada. Enlaze lo registra al instante en tu CRM con todos sus datos y los del trabajo a realizar.",
  },
  {
    n: "02",
    Icon: IconBell,
    title: "Automatiza la comunicación",
    desc: "WhatsApp y email funcionan solos: confirmaciones de visita, recordatorios, avisos de estado. Deja de abrir quince chats distintos para contar lo mismo.",
  },
  {
    n: "03",
    Icon: IconSparkles,
    title: "Genera el presupuesto",
    desc: "Describe el trabajo y la IA lo convierte en un presupuesto profesional con partidas, medidas y totales. Listo para enviar desde el mismo panel.",
  },
  {
    n: "04",
    Icon: IconCheck,
    title: "Cierra el trabajo",
    desc: "Enlaze hace el seguimiento por ti, te avisa cuando el cliente acepta y te deja todo listo para facturar. Tú solo te ocupas de ejecutar la obra.",
  },
];

function HowItWorks() {
  return (
    <section
      id="como-funciona"
      className="relative overflow-hidden bg-navy-900 py-28"
    >
      {/* Atmósfera */}
      <div
        aria-hidden
        className="
          pointer-events-none absolute inset-0
          bg-[radial-gradient(ellipse_at_top_left,rgba(0,200,150,0.12),transparent_50%),radial-gradient(ellipse_at_bottom_right,rgba(0,200,150,0.08),transparent_55%)]
        "
      />
      {/* Grid pattern */}
      <div
        aria-hidden
        className="
          pointer-events-none absolute inset-0 opacity-[0.08]
          [background-image:linear-gradient(to_right,#ffffff_1px,transparent_1px),linear-gradient(to_bottom,#ffffff_1px,transparent_1px)]
          [background-size:64px_64px]
          [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_75%)]
        "
      />

      <div className="relative mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-green">
            Cómo funciona
          </p>
          <h2 className="mt-3 text-[2rem] font-semibold tracking-[-0.02em] text-white md:text-[2.75rem]">
            Del primer contacto al trabajo cerrado, en cuatro pasos
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-navy-300">
            Un flujo simple que cubre todo el ciclo comercial: captación, comunicación, presupuesto y cierre.
          </p>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map(({ n, Icon, title, desc }, i) => (
            <article
              key={i}
              className="
                group relative overflow-hidden rounded-2xl
                border border-white/10 bg-white/[0.04] p-8
                backdrop-blur-sm
                transition-all duration-300
                hover:-translate-y-[2px] hover:border-brand-green/30 hover:bg-white/[0.06]
              "
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-green">
                  Paso {n}
                </span>
                <div
                  className="
                    flex h-10 w-10 items-center justify-center rounded-xl
                    bg-brand-green/10 text-brand-green ring-1 ring-inset ring-brand-green/20
                  "
                >
                  <Icon size={18} />
                </div>
              </div>
              <h3 className="mt-8 text-[18px] font-semibold tracking-tight text-white">
                {title}
              </h3>
              <p className="mt-3 text-[14.5px] leading-relaxed text-navy-300">
                {desc}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Social proof — metrics + testimonial
 * ──────────────────────────────────────────────────────────────────── */

const metrics = [
  {
    value: "8 h",
    label: "Ahorradas a la semana por empresa",
    Icon: IconClock,
  },
  {
    value: "3×",
    label: "Más trabajos cerrados cada mes",
    Icon: IconFileText,
  },
  {
    value: "+200",
    label: "Empresas de servicios ya usan Enlaze",
    Icon: IconUsers,
  },
  {
    value: "98 %",
    label: "Clientes nos recomiendan a un compañero",
    Icon: IconShield,
  },
];

function SocialProof() {
  return (
    <section className="relative py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-green">
            Resultados
          </p>
          <h2 className="mt-3 text-[2rem] font-semibold tracking-[-0.02em] text-navy-900 md:text-[2.75rem]">
            Empresas reales, resultados medibles
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-navy-500">
            Lo que consiguen los equipos que ya trabajan con Enlaze.
          </p>
        </div>

        {/* Metrics grid */}
        <div className="mt-14 grid grid-cols-2 gap-5 md:grid-cols-4">
          {metrics.map(({ value, label, Icon }, i) => (
            <div
              key={i}
              className="
                rounded-2xl border border-navy-100 bg-white p-6
                shadow-[0_1px_2px_rgba(10,25,41,0.04)]
              "
            >
              <div
                className="
                  flex h-9 w-9 items-center justify-center rounded-lg
                  bg-navy-50 text-navy-700 ring-1 ring-inset ring-navy-100
                "
              >
                <Icon size={16} />
              </div>
              <p className="mt-5 text-[2rem] font-semibold tracking-[-0.02em] text-navy-900">
                {value}
              </p>
              <p className="mt-1 text-[13px] leading-snug text-navy-500">
                {label}
              </p>
            </div>
          ))}
        </div>

        {/* Testimonial */}
        <figure
          className="
            relative mx-auto mt-14 max-w-3xl overflow-hidden
            rounded-2xl border border-navy-100 bg-white p-8 md:p-10
            shadow-[0_1px_2px_rgba(10,25,41,0.04)]
          "
        >
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-green/60 to-transparent"
          />
          <IconQuote size={28} className="text-brand-green/70" />
          <blockquote className="mt-5 text-[18px] leading-relaxed text-navy-800 md:text-[20px]">
            Antes perdíamos trabajos simplemente por no contestar a tiempo. Ahora Enlaze responde por nosotros, envía los presupuestos el mismo día de la visita y hace el seguimiento sin que nadie del equipo tenga que recordarlo. Hemos pasado de 12 a 34 obras al mes sin contratar a nadie.
          </blockquote>
          <figcaption className="mt-7 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-navy-900 text-[13px] font-semibold text-white">
              MR
            </div>
            <div>
              <p className="text-[14px] font-semibold text-navy-900">Marcos Robles</p>
              <p className="text-[13px] text-navy-500">Fundador, Reformas Robles (Madrid)</p>
            </div>
            <div className="ml-auto hidden items-center gap-0.5 text-brand-green sm:flex">
              {[0, 1, 2, 3, 4].map((i) => (
                <IconStar key={i} size={14} className="fill-current" />
              ))}
            </div>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Final CTA
 * ──────────────────────────────────────────────────────────────────── */

function FinalCTA() {
  return (
    <section className="relative overflow-hidden py-28">
      <div
        aria-hidden
        className="
          pointer-events-none absolute inset-0 -z-10
          bg-[radial-gradient(ellipse_at_center,rgba(0,200,150,0.08),transparent_60%)]
        "
      />
      <div className="mx-auto max-w-4xl px-6">
        <div
          className="
            relative overflow-hidden rounded-3xl border border-navy-100
            bg-gradient-to-b from-white to-navy-50/60
            p-10 md:p-16
            shadow-[0_1px_2px_rgba(10,25,41,0.04),0_30px_60px_-30px_rgba(10,25,41,0.15)]
          "
        >
          {/* Acento brand-green */}
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
            <h2 className="mx-auto mt-4 max-w-2xl text-[2rem] font-semibold tracking-[-0.02em] text-navy-900 md:text-[2.75rem]">
              Pon tu negocio en automático.
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-[16px] leading-relaxed text-navy-500">
              Crea tu cuenta gratis y empieza a gestionar clientes, automatizar mensajes y enviar presupuestos en menos de dos minutos. Sin tarjeta, sin compromiso.
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
                Probar Enlaze gratis
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

            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[12.5px] text-navy-500">
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
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Footer
 * ──────────────────────────────────────────────────────────────────── */

function Footer() {
  return (
    <footer className="border-t border-navy-100 bg-white">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <Logo href="/" size={30} />
            <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-navy-500">
              El sistema todo-en-uno para empresas de reformas, instalaciones y servicios técnicos: CRM, automatización, presupuestos y seguimiento.
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
              { label: "Sobre Enlaze", href: "#" },
              { label: "Contacto", href: "#" },
              { label: "Blog", href: "#" },
            ]}
          />
          <FooterCol
            title="Legal"
            links={[
              { label: "Privacidad", href: "#" },
              { label: "Términos", href: "#" },
              { label: "Cookies", href: "#" },
            ]}
          />
        </div>

        <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-navy-100 pt-8 sm:flex-row">
          <p className="text-[12.5px] text-navy-500">
            © 2026 Enlaze. Hecho con cuidado en España.
          </p>
          <div className="flex items-center gap-2 text-[12.5px] text-navy-500">
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
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-900">
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
    <main className="min-h-screen bg-white text-navy-900 antialiased">
      <Navbar />
      <Hero />
      <Benefits />
      <HowItWorks />
      <SocialProof />
      <FinalCTA />
      <Footer />
    </main>
  );
}
