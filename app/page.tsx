import Image from "next/image";
import Link from "next/link";
import { Caveat, Plus_Jakarta_Sans } from "next/font/google";
import Logo from "@/components/Logo";
import AccountDeletedNotice from "@/components/AccountDeletedNotice";
import Section from "@/components/landing/Section";
import LandingNav from "@/components/landing/LandingNav";
import LandingBackground from "@/components/landing/LandingBackground";
import ChaosHero from "@/components/landing/ChaosHero";
import {
  ANNUAL_DISCOUNT,
  PAID_PLAN_IDS,
  PLAN_LABELS,
  RECOMMENDED_PLAN,
  TRIAL_DAYS,
  VAT_SUFFIX,
  formatEuros,
  planHasFeature,
  planLimit,
  priceCents,
  type PaidPlanId,
} from "@/lib/plans";

/*
 * Landing (b13, Maratón UMH, 26-10-2026).
 *
 * Posicionamiento: Enlaze no es un programa de facturas, es un asistente que
 * hace el trabajo de oficina. El resumen de cada mañana va primero; las
 * funciones vienen después, como prueba.
 *
 * Reglas que esta página no puede saltarse:
 *  - Siempre clara: nada de variantes `dark:`, aunque el visitante tenga el
 *    tema oscuro guardado de la app.
 *  - Las imágenes son capturas reales de la app con la cuenta de demostración
 *    (datos inventados, scripts/demo-landing/). Nunca pantallas dibujadas.
 *  - Precios y prueba salen de lib/plans.ts; aquí no se escribe ninguna cifra.
 *  - Sin promesas de normas: ni Verifactu, ni «certificado», ni «cumple», ni
 *    «varios usuarios». La prueba `landing-b13-claims` lo vigila.
 */

// Titulares de la landing (diseño de la portada, 19-10).
const display = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  display: "swap",
  variable: "--font-landing-display",
});

// Letra a mano del post-it y del importe rodeado en la portada.
const hand = Caveat({
  subsets: ["latin"],
  weight: ["700"],
  display: "swap",
  variable: "--font-landing-hand",
});

const H = "font-[family-name:var(--font-landing-display)]";

const TRIAL = `Prueba ${TRIAL_DAYS} días gratis, sin tarjeta`;

function PrimaryCta({ children = "Empieza la prueba gratis" }: { children?: React.ReactNode }) {
  return (
    <Link
      href="/register"
      className="inline-flex items-center justify-center rounded-xl bg-brand-green px-6 py-3.5 text-[15px] font-semibold text-navy-950 shadow-[0_8px_24px_-12px_rgba(0,160,120,0.7)] transition-colors hover:bg-brand-green-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-900"
    >
      {children}
    </Link>
  );
}

/** Marco para las capturas: borde fino y sombra baja, como una hoja encima de la mesa. */
function Shot({
  src,
  alt,
  width,
  height,
  className = "",
  priority = false,
  sizes,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  priority?: boolean;
  sizes: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-[18px] border border-[#DCE3EA] bg-white shadow-[0_1px_2px_rgba(10,25,41,0.06),0_24px_48px_-28px_rgba(10,25,41,0.35)] ${className}`}
    >
      <Image src={src} alt={alt} width={width} height={height} priority={priority} sizes={sizes} className="h-auto w-full" />
    </div>
  );
}

/* ── Cada mañana: el resumen como protagonista ─────────────────────────── */

const MORNING = [
  {
    title: "Qué cobrar",
    text: "Las facturas vencidas, con cuánto suman y cuántos días llevan de retraso. El recordatorio para reclamarlas ya está escrito.",
  },
  {
    title: "A quién contestar",
    text: "Los presupuestos enviados que nadie ha respondido, para que llames antes de que el cliente se enfríe.",
  },
  {
    title: "Qué presupuesto mandar",
    text: "Los presupuestos terminados que aún no has enviado, y los materiales que te han subido antes de que mandes el siguiente.",
  },
];

function EachMorning() {
  return (
    <Section id="cada-manana" padding="py-20 md:py-28" innerClassName="px-4 sm:px-6">
      <div className="max-w-2xl">
        <h2 className={`${H} text-[2rem] font-semibold leading-[1.1] tracking-[-0.02em] text-navy-900 sm:text-[2.6rem]`}>
          Abres Enlaze y ya sabes qué hacer hoy.
        </h2>
        <p className="mt-5 text-[17px] leading-[1.65] text-navy-600">
          Enlaze repasa tus facturas, tus presupuestos y los avisos de precio de tus proveedores, y
          te deja una lista corta, ordenada por lo que más importa. Cada tarea lleva a lo que ya
          tienes preparado: el recordatorio, el presupuesto, el aviso.
        </p>
      </div>

      <dl className="mt-14 grid gap-x-10 gap-y-10 border-t border-[#E1E7ED] pt-10 md:grid-cols-3">
        {MORNING.map((m) => (
          <div key={m.title}>
            <dt className={`${H} text-[1.3rem] font-semibold text-navy-900`}>{m.title}</dt>
            <dd className="mt-2.5 text-[15.5px] leading-[1.65] text-navy-600">{m.text}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

/* ── Las pruebas: cada función con su captura real ─────────────────────── */

type Proof = {
  id: string;
  title: string;
  text: string;
  note?: string;
  shot: { src: string; alt: string; width: number; height: number; phone?: boolean };
};

const PROOFS: Proof[] = [
  {
    id: "presupuestos",
    title: "Presupuestos con tus precios",
    text: "Le cuentas la obra y Enlaze prepara las partidas y la lista de materiales. La IA propone; el precio lo decides tú. Si tienes un precio fijado para un material, va el tuyo, por delante de cualquier tarifa de mercado, y se ve marcado como tuyo.",
    shot: {
      src: "/landing/tu-precio.png",
      alt: "Línea de materiales de un presupuesto: adhesivo cementoso a 12,90 euros el saco, marcado como «Tu precio» y «Precio fijado por ti en Precios».",
      width: 1310,
      height: 448,
    },
  },
  {
    id: "escanear",
    title: "Facturas de proveedor, con una foto",
    text: "Haz una foto a la factura con el móvil. La IA lee el proveedor, el NIF, el número, las fechas, la base y el IVA. Tú compruebas que está bien y la registras.",
    shot: {
      src: "/landing/escanear-movil.png",
      alt: "Pantalla de Enlaze en el móvil para escanear una factura de proveedor, con el botón «Escanear factura».",
      width: 1170,
      height: 2532,
      phone: true,
    },
  },
  {
    id: "avisos",
    title: "Te avisa cuando un proveedor sube precios",
    text: "Elige los materiales que más usas y el límite que aceptas. Si el precio lo supera, te enteras antes de mandar el próximo presupuesto, no cuando ya has perdido el margen.",
    shot: {
      src: "/landing/alertas.png",
      alt: "Avisos de precio: el cemento cola sube de 12,90 a 14,06 euros, un 9 %, y el tubo multicapa de 118 a 125,10 euros, un 6 %.",
      width: 1726,
      height: 300,
    },
  },
  {
    id: "cobros",
    title: "Recordatorios de cobro, ya escritos",
    text: "Cuando una factura vence, Enlaze te lo dice y te deja el email preparado, con el importe y los días de retraso. Lo lees, cambias lo que quieras y lo envías.",
    note: "Hoy el envío lo das tú. El reenvío automático está en camino.",
    shot: {
      src: "/landing/reclamar.png",
      alt: "Email de recordatorio preparado por Enlaze para una factura de 1.240 euros vencida hace 12 días.",
      width: 1024,
      height: 1368,
    },
  },
];

function ProofRow({ proof, flip }: { proof: Proof; flip: boolean }) {
  const { shot } = proof;
  return (
    <div id={proof.id} className="grid items-center gap-10 py-14 md:grid-cols-2 md:gap-16 md:py-20">
      <div className={flip ? "md:order-2" : ""}>
        <h3 className={`${H} text-[1.75rem] font-semibold leading-[1.15] tracking-[-0.015em] text-navy-900 sm:text-[2.1rem]`}>
          {proof.title}
        </h3>
        <p className="mt-4 max-w-[30rem] text-[16.5px] leading-[1.65] text-navy-600">{proof.text}</p>
        {proof.note && <p className="mt-4 max-w-[30rem] text-[14px] leading-relaxed text-navy-500">{proof.note}</p>}
      </div>
      <div className={`${flip ? "md:order-1" : ""} ${shot.phone ? "flex justify-center" : ""}`}>
        <Shot
          src={shot.src}
          alt={shot.alt}
          width={shot.width}
          height={shot.height}
          className={shot.phone ? "w-[min(260px,70vw)] rounded-[30px] border-[6px] border-navy-900" : ""}
          sizes={shot.phone ? "260px" : "(min-width: 768px) 520px, 100vw"}
        />
      </div>
    </div>
  );
}

function Proofs() {
  return (
    <Section padding="pt-20 md:pt-28 pb-6" innerClassName="px-4 sm:px-6">
      <h2 className={`${H} max-w-2xl text-[2rem] font-semibold leading-[1.1] tracking-[-0.02em] text-navy-900 sm:text-[2.6rem]`}>
        Y detrás del resumen, el trabajo hecho.
      </h2>
      <p className="mt-5 max-w-2xl text-[17px] leading-[1.65] text-navy-600">
        Todas las imágenes de esta página son capturas de Enlaze con la cuenta de demostración.
      </p>
      <div className="mt-4 divide-y divide-[#E1E7ED]">
        {PROOFS.map((p, i) => (
          <ProofRow key={p.id} proof={p} flip={i % 2 === 1} />
        ))}
      </div>
    </Section>
  );
}

/* ── Precios (de lib/plans.ts) ─────────────────────────────────────────── */

const num = (n: number) => new Intl.NumberFormat("es-ES", { useGrouping: true }).format(n);

function limitLine(plan: PaidPlanId, resource: "presupuestos" | "facturas" | "escaneos_ocr", label: string) {
  const max = planLimit(plan, resource);
  return max === null ? `${label[0].toUpperCase()}${label.slice(1)} sin límite` : `${num(max)} ${label} al mes`;
}

const PLAN_PITCH: Record<PaidPlanId, string> = {
  basico: "Clientes, presupuestos y facturas en orden.",
  profesional: "El asistente completo: el resumen de cada mañana y los avisos de precios.",
  empresa: "Lo mismo que Profesional, para mucho más volumen.",
};

function Pricing() {
  const discount = Math.round(ANNUAL_DISCOUNT * 100);
  return (
    <Section id="precios" padding="py-20 md:py-28" innerClassName="px-4 sm:px-6">
      <div className="max-w-2xl">
        <h2 className={`${H} text-[2rem] font-semibold leading-[1.1] tracking-[-0.02em] text-navy-900 sm:text-[2.6rem]`}>
          Precios claros, sin permanencia.
        </h2>
        <p className="mt-5 text-[17px] leading-[1.65] text-navy-600">
          Empiezas con {TRIAL_DAYS} días gratis con todo desbloqueado, sin tarjeta. Luego eliges plan, o
          no. Si pagas al año, te ahorras un {discount} %.
        </p>
      </div>

      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {PAID_PLAN_IDS.map((plan) => {
          const featured = plan === RECOMMENDED_PLAN;
          const assistant = planHasFeature(plan, "briefing_diario") && planHasFeature(plan, "seguimiento_precios");
          return (
            <div
              key={plan}
              className={`flex flex-col rounded-2xl border p-6 sm:p-7 ${
                featured ? "border-navy-900 bg-navy-900 text-white" : "border-[#DCE3EA] bg-white text-navy-900"
              }`}
            >
              <p className={`${H} text-[1.35rem] font-semibold`}>{PLAN_LABELS[plan]}</p>
              <p className={`mt-1.5 min-h-[3rem] text-[14.5px] leading-snug ${featured ? "text-navy-200" : "text-navy-600"}`}>
                {PLAN_PITCH[plan]}
              </p>
              <p className="mt-5 flex items-baseline gap-1.5">
                <span className={`${H} text-[2.6rem] font-semibold leading-none tracking-[-0.02em]`}>
                  {formatEuros(priceCents(plan, "month"))}
                </span>
                <span className={`text-[14px] ${featured ? "text-navy-200" : "text-navy-500"}`}>al mes {VAT_SUFFIX}</span>
              </p>
              <ul className={`mt-6 space-y-2.5 text-[14.5px] ${featured ? "text-navy-100" : "text-navy-700"}`}>
                <li>{assistant ? "Resumen diario y avisos de precios" : "Sin resumen diario ni avisos de precios"}</li>
                <li>{limitLine(plan, "presupuestos", "presupuestos")}</li>
                <li>{limitLine(plan, "facturas", "facturas")}</li>
                <li>{limitLine(plan, "escaneos_ocr", "facturas de proveedor escaneadas")}</li>
              </ul>
              <Link
                href="/register"
                className={`mt-8 rounded-xl px-5 py-3 text-center text-[15px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${
                  featured
                    ? "bg-brand-green text-navy-950 hover:bg-brand-green-light focus-visible:outline-white"
                    : "border border-navy-900 text-navy-900 hover:bg-navy-50 focus-visible:outline-navy-900"
                }`}
              >
                {TRIAL}
              </Link>
            </div>
          );
        })}
      </div>
      <p className="mt-6 text-[14px] text-navy-500">
        Todos los detalles y límites, en la{" "}
        <Link href="/pricing" className="underline underline-offset-4 hover:text-navy-900">
          página de precios
        </Link>
        .
      </p>
    </Section>
  );
}

/* ── Llamada final y pie ───────────────────────────────────────────────── */

function FinalCta() {
  return (
    <Section padding="py-24 md:py-32" innerClassName="px-4 sm:px-6">
      <div className="max-w-3xl">
        <h2 className={`${H} text-[2.2rem] font-semibold leading-[1.05] tracking-[-0.025em] text-navy-900 sm:text-[3.2rem]`}>
          Mañana, el primer resumen te está esperando.
        </h2>
        <p className="mt-5 max-w-xl text-[17px] leading-[1.65] text-navy-600">
          Date de alta, mete tus clientes y tus facturas, y deja que Enlaze se ocupe del papeleo
          mientras tú trabajas.
        </p>
        <div className="mt-9">
          <PrimaryCta>{TRIAL}</PrimaryCta>
        </div>
      </div>
    </Section>
  );
}

function Footer() {
  const legal = [
    { label: "Aviso legal", href: "/legal/aviso-legal" },
    { label: "Privacidad", href: "/legal/privacy" },
    { label: "Términos", href: "/legal/terms" },
    { label: "Cookies", href: "/legal/cookies" },
  ];
  return (
    <footer className="border-t border-[#E1E7ED]">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
        <Logo href="/" size={26} wordmarkClassName="text-navy-900" />
        <nav aria-label="Legal" className="flex flex-wrap gap-x-6 gap-y-2 text-[14px] text-navy-600">
          {legal.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-navy-900">
              {l.label}
            </Link>
          ))}
        </nav>
        <p className="text-[13px] text-navy-500">© 2026 Enlaze</p>
      </div>
    </footer>
  );
}

export default function Home() {
  return (
    <main className={`${display.variable} ${hand.variable} isolate min-h-screen bg-landing-paper text-navy-900 antialiased`}>
      <LandingBackground />
      <AccountDeletedNotice />
      <LandingNav />
      <ChaosHero trialDays={TRIAL_DAYS} />
      <EachMorning />
      <Proofs />
      <Pricing />
      <FinalCta />
      <Footer />
    </main>
  );
}
