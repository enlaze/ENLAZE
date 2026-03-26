"use client";
import Link from "next/link";

const LinkIcon = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#00c896" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

const Check = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#00c896" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const plans = [
  {
    name: "Basico",
    price: "19",
    desc: "Para emprendedores y negocios que empiezan a profesionalizar su comunicacion.",
    features: [
      "Hasta 100 clientes",
      "WhatsApp basico (100 msg/mes)",
      "Emails automaticos (500/mes)",
      "1 usuario",
      "Dashboard con analiticas",
      "Soporte por email",
    ],
    cta: "Empezar prueba gratis",
    popular: false,
  },
  {
    name: "Profesional",
    price: "49",
    desc: "Para equipos que necesitan automatizar toda su comunicacion y crecer.",
    features: [
      "Clientes ilimitados",
      "WhatsApp ilimitado",
      "Emails ilimitados",
      "Calendario y recordatorios",
      "Hasta 5 usuarios",
      "Soporte prioritario 24h",
      "Reportes avanzados",
      "Integraciones CRM",
    ],
    cta: "Empezar prueba gratis",
    popular: true,
  },
  {
    name: "Empresa",
    price: "199",
    desc: "Para empresas grandes con necesidades a medida y soporte dedicado.",
    features: [
      "Todo lo de Profesional",
      "Usuarios ilimitados",
      "API personalizada",
      "Integraciones a medida",
      "Manager dedicado",
      "SLA garantizado",
      "Onboarding personalizado",
      "Facturacion personalizada",
    ],
    cta: "Contactar ventas",
    popular: false,
  },
];

const faqs = [
  { q: "Como funciona la prueba gratuita de 10 dias?", a: "Al registrarte tienes acceso completo a todas las funcionalidades de tu plan elegido durante 10 dias sin coste. No te cobramos nada hasta que termine la prueba, y puedes cancelar en cualquier momento." },
  { q: "Puedo cambiar de plan en cualquier momento?", a: "Si, puedes subir o bajar de plan cuando quieras. Los cambios se aplican inmediatamente y ajustamos la facturacion de forma proporcional." },
  { q: "Hay compromiso de permanencia?", a: "No, todos los planes son mensuales sin compromiso. Puedes cancelar cuando quieras sin penalizacion." },
  { q: "Que metodos de pago aceptan?", a: "Aceptamos tarjetas de credito y debito (Visa, Mastercard, American Express). Tambien transferencia bancaria para el plan Empresa." },
  { q: "Ofrecen descuento por pago anual?", a: "Si, con el pago anual ahorras un 20% en cualquier plan. Contactanos para mas informacion." },
  { q: "Que pasa cuando termina mi prueba gratuita?", a: "Te avisamos antes de que termine. Si decides continuar, se activa la suscripcion mensual. Si no, tu cuenta pasa a modo lectura sin perder tus datos." },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/85 backdrop-blur-xl border-b border-navy-100">
        <nav className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-navy-800 flex items-center justify-center"><LinkIcon /></div>
            <span className="text-xl font-bold text-navy-900">Enlaze</span>
          </Link>
          <div className="flex items-center gap-6">
            <Link href="/" className="text-sm font-medium text-navy-700 hover:text-navy-900 transition-colors hidden sm:block">Inicio</Link>
            <Link href="/login" className="text-sm font-medium text-navy-700 hover:text-navy-900 transition-colors">Iniciar sesion</Link>
            <Link href="/register" className="px-5 py-2.5 rounded-xl bg-brand-green text-white text-sm font-semibold shadow-lg shadow-brand-green/25 hover:bg-brand-green-dark transition-colors">Empieza ahora</Link>
          </div>
        </nav>
      </header>

      <main className="pt-36 pb-24">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-green">Precios</p>
            <h1 className="mt-3 text-4xl md:text-6xl font-extrabold tracking-tight text-navy-900">Un plan para cada etapa de tu negocio</h1>
            <p className="mt-4 text-lg text-navy-600">Sin sorpresas, sin costes ocultos. Empieza con 10 dias gratis y escala cuando lo necesites.</p>
          </div>

          <div className="flex justify-center mb-12">
            <div className="inline-flex items-center gap-2 rounded-full bg-brand-green/10 px-5 py-2.5 text-sm font-semibold text-brand-green">
              🎁 10 dias de prueba gratis en todos los planes — sin tarjeta de credito
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
            {plans.map((plan, i) => (
              <div key={i} className={`rounded-2xl border p-8 relative ${plan.popular ? "border-brand-green bg-white shadow-xl shadow-brand-green/10 md:scale-105" : "border-navy-100 bg-white shadow-sm"}`}>
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-brand-green text-white text-xs font-semibold">
                    Mas popular
                  </div>
                )}
                <h3 className="text-lg font-bold text-navy-900">{plan.name}</h3>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-5xl font-extrabold text-navy-900">{plan.price}€</span>
                  <span className="text-navy-500">/mes</span>
                </div>
                <p className="mt-1 text-xs text-brand-green font-medium">10 dias gratis</p>
                <p className="mt-3 text-sm text-navy-600">{plan.desc}</p>
                <Link href="/register" className={`mt-6 block text-center py-3 rounded-xl font-semibold text-sm transition-colors ${plan.popular ? "bg-brand-green text-white shadow-lg shadow-brand-green/25 hover:bg-brand-green-dark" : "border border-navy-200 text-navy-800 hover:bg-navy-50"}`}>
                  {plan.cta}
                </Link>
                <div className="mt-8 space-y-3">
                  {plan.features.map((f, j) => (
                    <div key={j} className="flex items-start gap-3">
                      <div className="mt-0.5"><Check /></div>
                      <span className="text-sm text-navy-700">{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-24 max-w-2xl mx-auto">
            <h2 className="text-2xl font-bold text-navy-900 text-center mb-10">Preguntas frecuentes</h2>
            <div className="space-y-6">
              {faqs.map((faq, i) => (
                <div key={i} className="rounded-xl border border-navy-100 bg-white p-6">
                  <h3 className="font-semibold text-navy-900">{faq.q}</h3>
                  <p className="mt-2 text-sm text-navy-600 leading-relaxed">{faq.a}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-navy-100 bg-navy-950">
        <div className="max-w-6xl mx-auto px-6 py-8 text-center text-sm text-navy-500">
          © 2026 Enlaze. Todos los derechos reservados.
        </div>
      </footer>
    </div>
  );
}
