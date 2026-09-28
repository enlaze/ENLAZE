"use client";

/**
 * Página pública de precios.
 *
 * TODO sale de lib/plans.ts: precios (los mismos céntimos que cobra Stripe,
 * lo comprueba `npm run plans:check`), límites, funciones, días de prueba,
 * descuento anual y si los precios llevan IVA. Aquí no se escribe ningún
 * número a mano.
 */

import { useState } from "react";
import Link from "next/link";
import Logo from "@/components/Logo";
import {
  ANNUAL_DISCOUNT,
  FEATURE_LABELS,
  PAID_PLAN_IDS,
  PLAN_FEATURES,
  PLAN_LABELS,
  PRICES_INCLUDE_VAT,
  RECOMMENDED_PLAN,
  TRIAL_DAYS,
  VAT_SUFFIX,
  annualSavingsCents,
  formatEuros,
  planLimit,
  priceCents,
  type BillingInterval,
  type LimitedResource,
  type PaidPlanId,
} from "@/lib/plans";

const DISCOUNT_PCT = Math.round(ANNUAL_DISCOUNT * 100);
const CTA = `Prueba ${TRIAL_DAYS} días gratis, sin tarjeta`;

const PLAN_PITCH: Record<PaidPlanId, string> = {
  basico: "Para llevar clientes, presupuestos y facturas en orden.",
  profesional: "Para que Enlaze te vigile el día a día y te avise de lo importante.",
  empresa: "Para mucho volumen de presupuestos, facturas y envíos.",
};

/** Límites que se enseñan en cada plan, en el orden en que importan en la obra. */
const SHOWN_LIMITS: { resource: LimitedResource; one: (n: string) => string; none: string }[] = [
  { resource: "presupuestos", one: (n) => `${n} presupuestos al mes`, none: "Presupuestos sin límite" },
  { resource: "facturas", one: (n) => `${n} facturas al mes`, none: "Facturas sin límite" },
  { resource: "clientes", one: (n) => `Hasta ${n} clientes`, none: "Clientes sin límite" },
  { resource: "whatsapp", one: (n) => `${n} mensajes de WhatsApp al mes`, none: "WhatsApp sin límite" },
  { resource: "emails", one: (n) => `${n} emails al mes`, none: "Emails sin límite" },
  { resource: "escaneos_ocr", one: (n) => `${n} facturas de proveedor escaneadas al mes`, none: "Escaneo de facturas sin límite" },
];

const num = (n: number) => new Intl.NumberFormat("es-ES", { useGrouping: true }).format(n);

function limitLines(plan: PaidPlanId): string[] {
  return SHOWN_LIMITS.map(({ resource, one, none }) => {
    const max = planLimit(plan, resource);
    return max === null ? none : one(num(max));
  });
}

const BASIC = PLAN_FEATURES.basico;
function extraFeatures(plan: PaidPlanId) {
  return PLAN_FEATURES[plan].filter((f) => !BASIC.includes(f));
}

const example = RECOMMENDED_PLAN;
const faqs = [
  {
    q: "¿Cómo es la prueba gratis?",
    a: `Son ${TRIAL_DAYS} días con todas las funciones desbloqueadas, también las del plan ${PLAN_LABELS.profesional}. No te pedimos tarjeta: te registras y empiezas. Durante la prueba puedes crear hasta ${planLimit("prueba", "presupuestos")} presupuestos y ${planLimit("prueba", "facturas")} facturas.`,
  },
  {
    q: "¿Qué pasa cuando se acaba la prueba?",
    a: "Si no eliges plan, tu cuenta pasa a solo lectura: puedes ver y exportar todo lo que tienes, pero no crear ni enviar nada nuevo. Tus datos no se borran. Cuando eliges un plan, sigues donde lo dejaste.",
  },
  {
    q: "¿Puedo cancelar cuando quiera?",
    a: "Sí, no hay permanencia. Cancelas desde Ajustes y conservas el acceso hasta el final del periodo que ya has pagado. Después la cuenta pasa a solo lectura y tus datos siguen ahí.",
  },
  {
    q: "¿Puedo cambiar de plan?",
    a: "Sí, cuando quieras, desde Ajustes → Plan y facturación. Puedes subir o bajar de plan y pasar de mensual a anual.",
  },
  {
    q: "¿Hay descuento si pago al año?",
    a: `Sí, un ${DISCOUNT_PCT} %. Por ejemplo, el plan ${PLAN_LABELS[example]} sale a ${formatEuros(priceCents(example, "year"))} al año en vez de ${formatEuros(priceCents(example, "month") * 12)}: te ahorras ${formatEuros(annualSavingsCents(example))}.`,
  },
  {
    q: "¿Los precios llevan IVA?",
    a: PRICES_INCLUDE_VAT
      ? "Sí, los precios que ves ya llevan el IVA incluido."
      : "No. Los precios que ves son sin IVA; al cobrar se suma el IVA que corresponda.",
  },
  {
    q: "¿Cómo se paga?",
    a: "Solo con tarjeta, de débito o de crédito. No aceptamos transferencia ni domiciliación bancaria.",
  },
];

const cents = (c: number) => (c / 100).toFixed(2);

// JSON-LD: una oferta por plan y periodicidad, con los importes de lib/plans.ts.
const productJsonLd = {
  "@context": "https://schema.org",
  "@type": "Product",
  name: "Enlaze",
  description:
    "Programa para autónomos y empresas de la construcción: clientes, presupuestos, facturas, firma y portal del cliente.",
  brand: { "@type": "Brand", name: "Enlaze" },
  offers: PAID_PLAN_IDS.flatMap((p) =>
    (["month", "year"] as const).map((interval) => ({
      "@type": "Offer",
      name: `${PLAN_LABELS[p]} (${interval === "month" ? "mensual" : "anual"})`,
      price: cents(priceCents(p, interval)),
      priceCurrency: "EUR",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: cents(priceCents(p, interval)),
        priceCurrency: "EUR",
        valueAddedTaxIncluded: PRICES_INCLUDE_VAT,
        unitCode: interval === "month" ? "MON" : "ANN",
        billingDuration: interval === "month" ? "P1M" : "P1Y",
      },
      availability: "https://schema.org/InStock",
    })),
  ),
};

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
};

function Check() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="mt-0.5 shrink-0 text-brand-green">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export default function PricingPage() {
  const [interval, setBillingInterval] = useState<BillingInterval>("month");

  return (
    <div className="min-h-screen bg-white text-navy-900 dark:bg-zinc-950 dark:text-zinc-100">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      <header className="fixed left-0 right-0 top-0 z-50 border-b border-navy-100 bg-white/85 backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-950/85">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Logo href="/" size={36} />
          <div className="flex items-center gap-4 sm:gap-6">
            <Link href="/" className="hidden text-sm font-medium text-navy-700 transition-colors hover:text-navy-900 sm:block dark:text-zinc-300 dark:hover:text-white">
              Inicio
            </Link>
            <Link href="/login" className="text-sm font-medium text-navy-700 transition-colors hover:text-navy-900 dark:text-zinc-300 dark:hover:text-white">
              Iniciar sesión
            </Link>
            <Link href="/register" className="rounded-xl bg-brand-green px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-green-dark sm:px-5 dark:text-zinc-950">
              Empieza gratis
            </Link>
          </div>
        </nav>
      </header>

      <main className="pb-24 pt-32 sm:pt-36">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-green-ink dark:text-success-ink">Precios</p>
            <h1 className="mt-3 text-4xl font-extrabold tracking-tight md:text-5xl">Precios claros, sin permanencia</h1>
            <p className="mt-4 text-lg text-navy-600 dark:text-zinc-400">
              Prueba {TRIAL_DAYS} días gratis, sin tarjeta y con todo desbloqueado. Luego eliges el plan que te encaje.
            </p>
          </div>

          {/* Mensual / anual */}
          <div className="mb-12 mt-8 flex justify-center">
            <div role="radiogroup" aria-label="Forma de pago" className="inline-flex items-center rounded-full border border-navy-200 bg-navy-50 p-1 dark:border-zinc-800 dark:bg-zinc-900">
              {(["month", "year"] as const).map((opt) => {
                const active = interval === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setBillingInterval(opt)}
                    className={`rounded-full px-5 py-2 text-sm font-semibold transition-colors ${
                      active
                        ? "bg-white text-navy-900 shadow-sm dark:bg-zinc-800 dark:text-white"
                        : "text-navy-600 hover:text-navy-900 dark:text-zinc-400 dark:hover:text-white"
                    }`}
                  >
                    {opt === "month" ? "Mensual" : "Anual"}
                    {opt === "year" && (
                      <span className="ml-2 rounded-full bg-brand-green/15 px-2 py-0.5 text-[11px] font-bold text-brand-green-ink dark:text-success-ink">
                        Ahorra {DISCOUNT_PCT} %
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-3 md:gap-8">
            {PAID_PLAN_IDS.map((plan) => (
              <PlanCard key={plan} plan={plan} interval={interval} />
            ))}
          </div>

          <div className="mx-auto mt-10 max-w-3xl space-y-2 text-center text-[15px] text-navy-600 dark:text-zinc-400">
            <p>
              En todos los planes puedes usarlo a la vez desde el móvil en la obra y desde el ordenador en la oficina.
            </p>
            <p className="text-sm text-navy-500 dark:text-zinc-500">
              {PRICES_INCLUDE_VAT ? "Precios con IVA incluido." : "Precios sin IVA."} Pago solo con tarjeta. Sin permanencia.
            </p>
          </div>

          <section className="mx-auto mt-24 max-w-2xl">
            <h2 className="mb-8 text-center text-2xl font-bold">Preguntas frecuentes</h2>
            <div className="space-y-4">
              {faqs.map((faq) => (
                <div key={faq.q} className="rounded-xl border border-navy-100 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
                  <h3 className="font-semibold">{faq.q}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-navy-600 dark:text-zinc-400">{faq.a}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>

      <footer className="border-t border-navy-100 bg-navy-950 dark:border-zinc-800">
        <div className="mx-auto max-w-6xl px-6 py-8 text-center text-sm text-navy-400">
          © {new Date().getFullYear()} Enlaze. Todos los derechos reservados.
        </div>
      </footer>
    </div>
  );
}

function PlanCard({ plan, interval }: { plan: PaidPlanId; interval: BillingInterval }) {
  const recommended = plan === RECOMMENDED_PLAN;
  const total = priceCents(plan, interval);
  const perMonth = interval === "year" ? Math.round(total / 12) : total;
  const extras = extraFeatures(plan);

  return (
    <div
      className={`relative rounded-2xl border p-7 ${
        recommended
          ? "border-brand-green bg-white shadow-xl shadow-brand-green/10 md:-mt-3 dark:bg-zinc-900 dark:shadow-none"
          : "border-navy-100 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      }`}
    >
      {recommended && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-green px-4 py-1 text-xs font-semibold text-white dark:text-zinc-950">
          Recomendado
        </div>
      )}
      <h3 className="text-lg font-bold">{PLAN_LABELS[plan]}</h3>
      <p className="mt-1 text-sm text-navy-600 dark:text-zinc-400">{PLAN_PITCH[plan]}</p>

      <div className="mt-5 flex items-baseline gap-1.5">
        <span className="text-4xl font-extrabold tabular-nums">{formatEuros(perMonth)}</span>
        <span className="text-sm text-navy-500 dark:text-zinc-400">/mes {VAT_SUFFIX}</span>
      </div>
      <p className="mt-1 min-h-[40px] text-[13px] text-navy-500 dark:text-zinc-400">
        {interval === "year" ? (
          <>
            {formatEuros(total)} al año {VAT_SUFFIX}.{" "}
            <span className="font-semibold text-brand-green-ink dark:text-success-ink">
              Ahorras {formatEuros(annualSavingsCents(plan))} al año.
            </span>
          </>
        ) : (
          "Se paga cada mes."
        )}
      </p>

      <Link
        href="/register"
        className={`mt-5 block rounded-xl py-3 text-center text-sm font-semibold transition-colors ${
          recommended
            ? "bg-brand-green text-white hover:bg-brand-green-dark dark:text-zinc-950"
            : "border border-navy-200 text-navy-800 hover:bg-navy-50 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
        }`}
      >
        {CTA}
      </Link>

      <div className="mt-7 space-y-2.5">
        {extras.length === 0 ? (
          BASIC.map((f) => <Line key={f}>{FEATURE_LABELS[f]}</Line>)
        ) : (
          <>
            <p className="text-sm font-semibold">Todo lo del {PLAN_LABELS.basico}, y además:</p>
            {extras.map((f) => (
              <Line key={f}>{FEATURE_LABELS[f]}</Line>
            ))}
          </>
        )}
      </div>

      <div className="mt-6 border-t border-navy-100 pt-5 dark:border-zinc-800">
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-navy-500 dark:text-zinc-500">Cuánto puedes hacer</p>
        <ul className="space-y-1.5 text-sm text-navy-700 dark:text-zinc-300">
          {limitLines(plan).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Line({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <Check />
      <span className="text-sm text-navy-700 dark:text-zinc-300">{children}</span>
    </div>
  );
}
