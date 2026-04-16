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
 *  Hero  (Variante A aplicada — pain-driven)
 * ──────────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="relative overflow-hidden pt-36 pb-24 md:pt-44 md:pb-32">
      <div
        aria-hidden
        className="
          pointer-events-none absolute inset-x-0 top-0 h-[720px] -z-10
          bg-[radial-gradient(ellipse_at_top,rgba(0,200,150,0.10),transparent_55%),radial-gradient(ellipse_at_bottom,rgba(10,25,41,0.05),transparent_60%)]]
        "
      />
      <div
        aria-hidden
        className="
          pointer-events-none absolute inset-0 -z-10 opacity-[0.22]
          [background-image:linear-gradient(to_right,#e8eef4_1px,transparent_1px),linear-gradient(to_bottom,#e8eef4_1px,transparent_1px)]
          [background-size:64px_64px]
          [mask-image:radial-gradient(ellipse_at_top,black_45%,transparent_75%)]]]
        "
      />

      <div className="relative mx-auto max-w-6xl px-6">
        <div className="flex justify-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-navy-100 bg-white/80 px-3.5 py-1.5 shadow-[0_1px_2px_rgba(10,25,41,0.04)] backdrop-blur transition-colors]">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-green/60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-green" />
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-600 transition-colors">
              Automatización para empresas de servicios
            </span>
          </div>
        </div>

        {/* Headline */}
        <h1 className="mx-auto mt-8 max-w-4xl text-center text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.025em] text-navy-900 transition-colors md:text-[4rem] lg:text-[4.5rem]">
          Cierra más clientes{" "}
          <span className="relative inline-block whitespace-nowrap">
            <span className="relative z-10 text-brand-green">sin trabajar más horas</span>
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

        {/* Subheadline */}
        <p className="mx-auto mt-7 max-w-2xl text-center text-[17px] leading-relaxed text-navy-500 transition-colors md:text-[18px]">
          ENLAZE centraliza clientes, presupuestos, seguimiento y operaciones en un solo lugar para empresas de servicios que quieren responder más rápido, vender mejor y tener más control del negocio.
        </p>

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
            Solicitar demo
            <IconArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
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
        </div>

        <p className="mx-auto mt-6 max-w-xl text-center text-[14px] leading-relaxed text-navy-400 transition-colors">
          Menos WhatsApp perdido, menos Excel disperso y menos tiempo apagando fuegos. Más orden, más seguimiento y más ventas.
        </p>

        <p className="mt-4 text-center text-[13px] text-navy-500 transition-colors">
          Sin tarjeta · Configuración en 2 minutos · Cancela cuando quieras
        </p>

        <ProductPreview />
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Product preview — mockup del panel
 * ──────────────────────────────────────────────────────────────────── */

function ProductPreview() {
  return (
    <div className="relative mx-auto mt-20 max-w-5xl">
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

        <div className="grid grid-cols-12 gap-0">
          <aside className="col-span-3 hidden border-r border-navy-100 bg-white p-4 md:block">
            <div className="flex items-center gap-2 px-2 py-2">
              <div className="h-6 w-6 rounded-md bg-navy-900" />
              <div className="h-2.5 w-16 rounded bg-navy-200" />
            </div>
            <div className="mt-6 space-y-1">
              <MockNavItem label="Dashboard" active />
              <MockNavItem label="Clientes" />
              <MockNavItem label="Presupuestos" />
              <MockNavItem label="Proyectos" />
              <MockNavItem label="Facturas" />
              <MockNavItem label="Ajustes" />
            </div>
          </aside>

          <div className="col-span-12 bg-navy-50/30 p-5 md:col-span-9 md:p-7">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-navy-400">
                  Nuevo presupuesto
                </div>
                <div className="mt-1 text-[15px] font-semibold text-navy-900">
                  Mantenimiento integral — Oficinas Castellana 48
                </div>
              </div>
              <div className="hidden items-center gap-2 rounded-full border border-brand-green/20 bg-brand-green/10 px-2.5 py-1 sm:inline-flex">
                <IconSparkles size={12} className="text-brand-green" />
                <span className="text-[11px] font-semibold text-brand-green">
                  Generado con IA
                </span>
              </div>
            </div>

            <div className="mt-5 overflow-hidden rounded-xl border border-navy-100 bg-white">
              <div className="grid grid-cols-12 gap-4 border-b border-navy-100 bg-navy-50/60 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-navy-500">
                <div className="col-span-6">Partida</div>
                <div className="col-span-2 text-right">Uds.</div>
                <div className="col-span-2 text-right">Precio</div>
                <div className="col-span-2 text-right">Total</div>
              </div>

              <MockLine label="Diagnóstico y planificación inicial" qty="1 ud" unit="420,00" total="420,00" />
              <MockLine label="Servicio técnico especializado" qty="1 ud" unit="1.850,00" total="1.850,00" />
              <MockLine label="Revisión y puesta a punto completa" qty="1 ud" unit="920,00" total="920,00" />
              <MockLine label="Mantenimiento preventivo trimestral" qty="4 ud" unit="414,00" total="1.656,00" />
            </div>

            <div className="mt-5 flex items-end justify-between gap-4">
              <div className="text-[11px] text-navy-500">
                Enviado automáticamente al cliente el{" "}
                <span className="font-medium text-navy-700">9 abr 2026</span>
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
        active ? "bg-navy-900 text-white" : "text-navy-600"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-brand-green" : "bg-navy-200"}`} />
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
 *  Pain section — dolor del cliente
 * ──────────────────────────────────────────────────────────────────── */

const pains = [
  {
    title: "Contestas cuando puedes, no cuando el cliente quiere",
    desc: "Entre un cliente y otro, los mensajes se acumulan. Y el que no espera, ya está hablando con tu competencia.",
  },
  {
    title: "Haces presupuestos el domingo por la noche",
    desc: "Te toca sacrificar el fin de semana para enviar lo que deberías haber mandado el martes. Otra vez.",
  },
  {
    title: "Los presupuestos se quedan sin respuesta",
    desc: "No tienes tiempo de hacer seguimiento. 6 de cada 10 trabajos se pierden solo por silencio.",
  },
  {
    title: "Tu información vive en cinco sitios distintos",
    desc: "Una libreta, el WhatsApp de alguien, un Excel, la memoria del equipo y una carpeta perdida. Nadie sabe dónde está qué.",
  },
  {
    title: "Cada reunión son dos horas de papeleo después",
    desc: "Apuntar, preparar presupuesto, enviarlo, recordar quién dijo qué. Y mañana, vuelta a empezar.",
  },
  {
    title: "Trabajas más, facturas lo mismo",
    desc: "Tus horas ya no dan para más. Contratar oficina no te compensa. Y el techo se hace cada mes más bajo.",
  },
];

function PainSection() {
  return (
    <section className="relative border-y border-navy-100 bg-navy-50/40 py-28 transition-colors">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-green">
            El problema
          </p>
          <h2 className="mt-3 text-[2rem] font-semibold tracking-[-0.02em] text-navy-900 transition-colors md:text-[2.75rem]">
            Tu problema no es que falten clientes. Es lo que pasa después.
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-navy-500 transition-colors">
            Si alguna de estas frases te suena, no eres tú. Es el sistema con el que estás trabajando.
          </p>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {pains.map((p, i) => (
            <article
              key={i}
              className="
                group relative rounded-2xl border border-navy-100 bg-white p-7
                shadow-[0_1px_2px_rgba(10,25,41,0.04)]
                transition-all duration-300
                hover:-translate-y-[2px] hover:border-navy-200
                hover:shadow-[0_12px_32px_-16px_rgba(10,25,41,0.18)]]]
              "
            >
              <div
                className="
                  flex h-10 w-10 items-center justify-center rounded-xl
                  bg-red-50 text-red-500 ring-1 ring-inset ring-red-100
                "
              >
                <IconAlert size={18} />
              </div>
              <h3 className="mt-5 text-[15.5px] font-semibold tracking-tight text-navy-900 transition-colors">
                {p.title}
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-navy-500 transition-colors">{p.desc}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Benefits — qué hace el producto (outcomes, no features)
 * ──────────────────────────────────────────────────────────────────── */

const benefits = [
  {
    Icon: IconMessage,
    title: "Contestas a todos tus clientes en minutos, aunque estés fuera de la oficina",
    desc: "WhatsApp y email automáticos. Las preguntas repetidas se responden solas. Las citas quedan confirmadas. Tú ni abres el móvil y el cliente ya sabe que estás al otro lado.",
  },
  {
    Icon: IconZap,
    title: "Envías el presupuesto el mismo día de la reunión",
    desc: "Describes el servicio en lenguaje natural y la IA genera un presupuesto profesional con partidas, cantidades y precios en 30 segundos. Cero plantillas de Word. Cero cálculos a mano.",
  },
  {
    Icon: IconRefresh,
    title: "Ningún cliente se queda en el olvido",
    desc: "Enlaze hace el seguimiento por ti. Recordatorios automáticos a los tres días, mensajes de cierre si la cosa se enfría, avisos cuando alguien contesta. Los presupuestos dejan de morir en silencio.",
  },
  {
    Icon: IconTarget,
    title: "Todo tu negocio cabe en un solo panel",
    desc: "Clientes, proyectos, mensajes, presupuestos, facturas y operaciones. Un único sitio, todo conectado. Se acabaron las libretas sueltas y los «¿dónde lo tenía apuntado?».",
  },
];

function Benefits() {
  return (
    <section id="producto" className="relative py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-green">
            La solución
          </p>
          <h2 className="mt-3 text-[2rem] font-semibold tracking-[-0.02em] text-navy-900 transition-colors md:text-[2.75rem]">
            Todo lo que necesitas para vender mejor y gestionar mejor
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-navy-500 transition-colors">
            ENLAZE te ayuda a organizar el trabajo comercial y operativo de tu empresa para responder más rápido, crear presupuestos con más agilidad, hacer seguimiento sin olvidos y centralizar la información importante.
          </p>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-5 md:grid-cols-2">
          {benefits.map(({ Icon, title, desc }, i) => (
            <article
              key={i}
              className="
                group relative overflow-hidden rounded-2xl border border-navy-100 bg-white p-8
                shadow-[0_1px_2px_rgba(10,25,41,0.04)]
                transition-all duration-300 ease-out
                hover:-translate-y-[2px] hover:border-navy-200
                hover:shadow-[0_12px_32px_-16px_rgba(10,25,41,0.18)]]]
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
              <h3 className="mt-6 text-[17px] font-semibold tracking-tight text-navy-900 transition-colors">
                {title}
              </h3>
              <p className="mt-2.5 text-[14.5px] leading-relaxed text-navy-500 transition-colors">{desc}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  How it works — 3 pasos, fondo navy
 * ──────────────────────────────────────────────────────────────────── */

const steps = [
  {
    n: "01",
    Icon: IconPlus,
    title: "Conecta tu WhatsApp y tu email",
    desc: "Dos minutos, sin instalar nada. Enlaze entra como un miembro más del equipo, con tu número y tu dirección de siempre.",
  },
  {
    n: "02",
    Icon: IconUsers,
    title: "Importa tus clientes y tus precios",
    desc: "Sube tu lista en un Excel o pégala directamente. Enlaze aprende cómo presupuestas para que cada documento salga como lo harías tú.",
  },
  {
    n: "03",
    Icon: IconSparkles,
    title: "Respira. A partir de aquí, el sistema trabaja",
    desc: "Contesta a tus clientes, manda presupuestos el mismo día y hace el seguimiento solo. Tú te dedicas al servicio. Enlaze cierra la venta.",
  },
];

function HowItWorks() {
  return (
    <section id="como-funciona" className="relative overflow-hidden bg-navy-900 py-28">
      <div
        aria-hidden
        className="
          pointer-events-none absolute inset-0
          bg-[radial-gradient(ellipse_at_top_left,rgba(0,200,150,0.12),transparent_50%),radial-gradient(ellipse_at_bottom_right,rgba(0,200,150,0.08),transparent_55%)]
        "
      />
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
            Empezar es más fácil que lo que haces ahora
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-navy-300">
            Tres pasos. Ni formaciones de dos días, ni consultores, ni manuales de 80 páginas.
          </p>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-3">
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
              <p className="mt-3 text-[14.5px] leading-relaxed text-navy-300">{desc}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Before vs After
 * ──────────────────────────────────────────────────────────────────── */

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

function BeforeAfter() {
  return (
    <section className="relative py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-green">
            Antes vs. después
          </p>
          <h2 className="mt-3 text-[2rem] font-semibold tracking-[-0.02em] text-navy-900 transition-colors md:text-[2.75rem]">
            Así cambia tu semana
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-navy-500 transition-colors">
            La misma empresa, los mismos clientes, los mismos trabajos. Solo cambia quién hace la parte aburrida.
          </p>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Antes */}
          <div
            className="
              relative overflow-hidden rounded-2xl
              border border-navy-100 bg-white p-8 transition-colors] md:p-10
              shadow-[0_1px_2px_rgba(10,25,41,0.04)]
            "
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-500 ring-1 ring-inset ring-red-100">
                <IconX size={18} />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-400 transition-colors">
                  Antes
                </p>
                <p className="text-[17px] font-semibold text-navy-900 transition-colors">Sin Enlaze</p>
              </div>
            </div>

            <ul className="mt-7 space-y-4">
              {beforeItems.map((t, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-500">
                    <IconX size={10} />
                  </span>
                  <span className="text-[14.5px] leading-relaxed text-navy-600 transition-colors">{t}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Después */}
          <div
            className="
              relative overflow-hidden rounded-2xl
              border border-brand-green/20 bg-white p-8 transition-colors] md:p-10
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
                  Después
                </p>
                <p className="text-[17px] font-semibold text-navy-900 transition-colors">Con Enlaze</p>
              </div>
            </div>

            <ul className="mt-7 space-y-4">
              {afterItems.map((t, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-green/15 text-brand-green">
                    <IconCheck size={10} />
                  </span>
                  <span className="text-[14.5px] leading-relaxed text-navy-700 transition-colors">{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Social proof — métricas + 3 testimonios
 * ──────────────────────────────────────────────────────────────────── */

const metrics = [
  { value: "8 h", label: "Ahorradas cada semana por empresa", Icon: IconClock },
  { value: "3×", label: "Más trabajos cerrados cada mes", Icon: IconFileText },
  { value: "+200", label: "Empresas de servicios ya usan Enlaze", Icon: IconUsers },
  { value: "98 %", label: "Clientes nos recomiendan a un compañero", Icon: IconShield },
];

const testimonials = [
  {
    initials: "MR",
    name: "Marcos Robles",
    role: "Fundador, Robles Servicios Técnicos",
    city: "Madrid",
    quote:
      "Antes perdíamos clientes simplemente por no contestar a tiempo. Ahora Enlaze responde por nosotros y envía los presupuestos el mismo día. Hemos triplicado los proyectos cerrados al mes sin contratar a nadie.",
  },
  {
    initials: "LG",
    name: "Laura Giménez",
    role: "Gerente, Giménez Consulting",
    city: "Valencia",
    quote:
      "El seguimiento automático nos ha cambiado el mes. Antes cerrábamos 3 de cada 10 presupuestos. Ahora cerramos 7. Lo único que cambió fue que Enlaze no se olvida de ninguno.",
  },
  {
    initials: "JO",
    name: "Javier Ortiz",
    role: "Director, Ortiz Mantenimiento",
    city: "Sevilla",
    quote:
      "Lo más valioso no es el tiempo que ahorramos. Es que los domingos ya no trabajo. Los presupuestos que antes me llevaban dos horas salen ahora en treinta segundos y llegan al cliente antes de que cuelgue el teléfono.",
  },
];

function SocialProof() {
  return (
    <section className="relative border-y border-navy-100 bg-navy-50/40 py-28 transition-colors">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-green">
            Resultados
          </p>
          <h2 className="mt-3 text-[2rem] font-semibold tracking-[-0.02em] text-navy-900 transition-colors md:text-[2.75rem]">
            Empresas reales, resultados medibles
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-navy-500 transition-colors">
            Lo que consiguen los equipos que ya trabajan con Enlaze.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-2 gap-5 md:grid-cols-4">
          {metrics.map(({ value, label, Icon }, i) => (
            <div
              key={i}
              className="
                rounded-2xl border border-navy-100 bg-white p-6 transition-colors
                shadow-[0_1px_2px_rgba(10,25,41,0.04)]]
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
              <p className="mt-5 text-[2rem] font-semibold tracking-[-0.02em] text-navy-900 transition-colors">
                {value}
              </p>
              <p className="mt-1 text-[13px] leading-snug text-navy-500 transition-colors">{label}</p>
            </div>
          ))}
        </div>

        <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-3">
          {testimonials.map((t, i) => (
            <figure
              key={i}
              className="
                relative overflow-hidden rounded-2xl
                border border-navy-100 bg-white p-7
                shadow-[0_1px_2px_rgba(10,25,41,0.04)]
                transition-all duration-300
                hover:-translate-y-[2px] hover:border-navy-200
                hover:shadow-[0_12px_32px_-16px_rgba(10,25,41,0.18)]
              "
            >
              <div
                aria-hidden
                className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-green/40 to-transparent"
              />
              <div className="flex items-center gap-1 text-brand-green">
                {[0, 1, 2, 3, 4].map((i) => (
                  <IconStar key={i} size={13} className="fill-current" />
                ))}
              </div>
              <blockquote className="mt-5 text-[15px] leading-relaxed text-navy-700">
                «{t.quote}»
              </blockquote>
              <figcaption className="mt-6 flex items-center gap-3 border-t border-navy-100 pt-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-navy-900 text-[12px] font-semibold text-white">
                  {t.initials}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-semibold text-navy-900">{t.name}</p>
                  <p className="truncate text-[12px] text-navy-500">
                    {t.role} · {t.city}
                  </p>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
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
    <section className="relative py-28">
      <div className="mx-auto max-w-6xl px-6">
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

        <div className="mt-16 grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* Sí */}
          <div
            className="
              relative overflow-hidden rounded-2xl
              border border-brand-green/20 bg-white p-8 transition-colors] md:p-10
              shadow-[0_1px_2px_rgba(10,25,41,0.04),0_24px_56px_-28px_rgba(0,200,150,0.25)]
              lg:col-span-3
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

          {/* No */}
          <div
            className="
              relative overflow-hidden rounded-2xl
              border border-navy-100 bg-navy-50/40 p-8 transition-colors md:p-10
              lg:col-span-2
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
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Final CTA
 * ──────────────────────────────────────────────────────────────────── */

function FinalCTA() {
  return (
    <section className="relative overflow-hidden py-28 transition-colors">
      <div
        aria-hidden
        className="
          pointer-events-none absolute inset-0 -z-10
          bg-[radial-gradient(ellipse_at_center,rgba(0,200,150,0.08),transparent_60%)]]
        "
      />
      <div className="mx-auto max-w-4xl px-6">
        <div
          className="
            relative overflow-hidden rounded-3xl border border-navy-100 bg-gradient-to-b from-white to-navy-50/60 p-10 transition-colors] md:p-16
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
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Footer
 * ──────────────────────────────────────────────────────────────────── */

function Footer() {
  return (
    <footer className="border-t border-navy-100 bg-white transition-colors">
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
    <main className="min-h-screen bg-white text-navy-900 transition-colors antialiased">
      <Navbar />
      <Hero />
      <PainSection />
      <Benefits />
      <HowItWorks />
      <BeforeAfter />
      <SocialProof />
      <ForWhom />
      <FinalCTA />
      <Footer />
    </main>
  );
}
