"use client";
import { useState } from "react";

const LinkIcon = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#00c896" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

const ArrowRight = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
);

const MenuIcon = () => (
  <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

const CloseIcon = () => (
  <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

function Navbar() {
  const [open, setOpen] = useState(false);
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white/85 backdrop-blur-xl border-b border-navy-100">
      <nav className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-navy-800 flex items-center justify-center">
            <LinkIcon />
          </div>
          <span className="text-xl font-bold text-navy-900">Enlaze</span>
        </div>
        <div className="hidden md:flex items-center gap-8">
          <a href="#beneficios" className="text-sm font-medium text-navy-700 hover:text-navy-900 transition-colors">Beneficios</a><a href="/pricing" className="text-sm font-medium text-navy-700 hover:text-navy-900 transition-colors">Precios</a>
          <a href="#como-funciona" className="text-sm font-medium text-navy-700 hover:text-navy-900 transition-colors">Como funciona</a>
          <a href="/login" className="text-sm font-medium text-navy-700 hover:text-navy-900 transition-colors">Iniciar sesion</a><a href="/register" className="px-5 py-2.5 rounded-xl bg-brand-green text-white text-sm font-semibold shadow-lg shadow-brand-green/25 hover:bg-brand-green-dark transition-colors">Empieza ahora</a>
        </div>
        <button onClick={() => setOpen(!open)} className="md:hidden text-navy-700">
          {open ? <CloseIcon /> : <MenuIcon />}
        </button>
      </nav>
      {open && (
        <div className="md:hidden bg-white border-b border-navy-100 px-6 py-4 flex flex-col gap-4">
          <a href="#beneficios" onClick={() => setOpen(false)} className="text-sm font-medium text-navy-700">Beneficios</a>
          <a href="#como-funciona" onClick={() => setOpen(false)} className="text-sm font-medium text-navy-700">Como funciona</a><a href="/pricing" onClick={() => setOpen(false)} className="text-sm font-medium text-navy-700">Precios</a>
          <a href="/login" onClick={() => setOpen(false)} className="text-sm font-medium text-navy-700">Iniciar sesion</a><a href="/register" onClick={() => setOpen(false)} className="px-5 py-2.5 rounded-xl bg-brand-green text-white text-sm font-semibold text-center">Empieza ahora</a>
        </div>
      )}
    </header>
  );
}

function Hero() {
  return (
    <section className="relative pt-36 md:pt-44 pb-20 overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full bg-gradient-to-br from-navy-100/60 via-brand-green/10 to-transparent blur-3xl -z-10" />
      <div className="max-w-6xl mx-auto px-6 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-navy-200 bg-white px-4 py-1.5 text-sm font-medium text-navy-700 shadow-sm mb-8">
          <span className="w-2 h-2 rounded-full bg-brand-green" />
          Automatizacion inteligente para empresas
        </div>
        <h1 className="max-w-4xl mx-auto text-4xl md:text-6xl lg:text-7xl font-extrabold leading-[1.08] tracking-tight text-navy-900">
          Nunca mas pierdas{" "}
          <span className="relative inline-block">
            <span className="relative z-10 text-brand-green">un cliente</span>
            <span className="absolute bottom-1 left-0 right-0 h-3 bg-brand-green/15 rounded-sm -z-0" />
          </span>{" "}
          por falta de comunicacion
        </h1>
        <p className="max-w-2xl mx-auto mt-6 text-lg text-navy-600 leading-relaxed">
          Enlaze automatiza tus mensajes de WhatsApp, emails, recordatorios y calendario para que tu equipo se enfoque en lo que importa:{" "}
          <strong className="text-navy-800">cerrar ventas.</strong>
        </p>
        <div className="mt-10 flex gap-4 justify-center flex-wrap">
          <a href="/register" className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl bg-brand-green text-white text-base font-semibold shadow-lg shadow-brand-green/30 hover:bg-brand-green-dark transition-colors">
            Empieza ahora <ArrowRight />
          </a>
          <a href="#como-funciona" className="inline-flex items-center px-8 py-4 rounded-2xl border border-navy-200 bg-white text-navy-800 text-base font-semibold hover:bg-navy-50 transition-colors">
            Como funciona
          </a>
        </div>
        <p className="mt-10 text-sm text-navy-500">
          Ya confian en nosotros <strong className="text-navy-700">+200 empresas</strong> en Latinoamerica
        </p>
        <div className="max-w-3xl mx-auto mt-14 rounded-2xl border border-navy-200/60 bg-gradient-to-b from-navy-800 to-navy-900 p-1 shadow-2xl">
          <div className="rounded-xl bg-navy-900 p-6 md:p-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-2xl border border-brand-green/20 bg-gradient-to-b from-brand-green/15 to-brand-green/5 p-5">
                <div className="flex items-center gap-2 text-sm text-white/70">WhatsApp</div>
                <p className="mt-2 text-3xl font-bold text-white">1,248</p>
                <p className="mt-1 text-xs text-white/50">mensajes enviados hoy</p>
              </div>
              <div className="rounded-2xl border border-blue-500/20 bg-gradient-to-b from-blue-500/15 to-blue-500/5 p-5">
                <div className="flex items-center gap-2 text-sm text-white/70">Emails</div>
                <p className="mt-2 text-3xl font-bold text-white">856</p>
                <p className="mt-1 text-xs text-white/50">emails automatizados</p>
              </div>
              <div className="rounded-2xl border border-purple-400/20 bg-gradient-to-b from-purple-400/15 to-purple-400/5 p-5">
                <div className="flex items-center gap-2 text-sm text-white/70">Citas</div>
                <p className="mt-2 text-3xl font-bold text-white">94</p>
                <p className="mt-1 text-xs text-white/50">citas agendadas</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const benefits = [
  { icon: "clock", title: "Ahorra horas cada dia", desc: "Deja de enviar mensajes uno por uno. Enlaze automatiza toda tu comunicacion para que tu equipo recupere horas productivas cada semana." },
  { icon: "zap", title: "Automatizacion total", desc: "WhatsApp, emails, recordatorios y calendario sincronizados en un solo lugar. Configura una vez y Enlaze trabaja 24/7 por ti." },
  { icon: "users", title: "No pierdas ni un cliente", desc: "Cada lead recibe seguimiento automatico. Sin mensajes olvidados, sin citas perdidas. Tus clientes siempre se sienten atendidos." },
];

function Benefits() {
  return (
    <section id="beneficios" className="py-24">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-green">Beneficios</p>
          <h2 className="mt-3 text-3xl md:text-5xl font-extrabold tracking-tight text-navy-900">Todo lo que necesitas para comunicar mejor</h2>
          <p className="mt-4 text-lg text-navy-600">Enlaze centraliza y automatiza cada punto de contacto con tus clientes.</p>
        </div>
        <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-7">
          {benefits.map((b, i) => (
            <div key={i} className="rounded-2xl border border-navy-100 bg-white p-8 shadow-sm hover:shadow-md transition-shadow">
              <div className="w-14 h-14 rounded-2xl bg-navy-50 flex items-center justify-center text-2xl">
                {b.icon === "clock" ? "⏱️" : b.icon === "zap" ? "⚡" : "👥"}
              </div>
              <h3 className="mt-6 text-xl font-bold text-navy-900">{b.title}</h3>
              <p className="mt-3 text-base text-navy-600 leading-relaxed">{b.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const steps = [
  { n: "01", title: "Conecta tus canales", desc: "Vincula tu WhatsApp Business, cuentas de email y calendario en menos de 5 minutos. Sin configuraciones complicadas.", icon: "🔗" },
  { n: "02", title: "Configura tus flujos", desc: "Crea secuencias automaticas de mensajes, recordatorios y seguimientos personalizados para cada tipo de cliente.", icon: "⚙️" },
  { n: "03", title: "Relajate y crece", desc: "Enlaze trabaja por ti 24/7. Monitorea resultados en tiempo real mientras tus clientes reciben atencion impecable.", icon: "📈" },
];

function HowItWorks() {
  return (
    <section id="como-funciona" className="bg-navy-900 py-24 relative overflow-hidden">
      <div className="absolute top-20 right-20 w-72 h-72 rounded-full bg-brand-green/10 blur-3xl" />
      <div className="max-w-6xl mx-auto px-6 relative">
        <div className="text-center max-w-2xl mx-auto">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-green">Como funciona</p>
          <h2 className="mt-3 text-3xl md:text-5xl font-extrabold tracking-tight text-white">Tres pasos para automatizar tu comunicacion</h2>
          <p className="mt-4 text-lg text-navy-300">Tan simple que estaras listo en minutos, no semanas.</p>
        </div>
        <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-7">
          {steps.map((s, i) => (
            <div key={i} className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-8">
              <span className="text-5xl font-extrabold text-brand-green/20">{s.n}</span>
              <div className="mt-4 w-14 h-14 rounded-2xl bg-brand-green/10 flex items-center justify-center text-2xl">{s.icon}</div>
              <h3 className="mt-5 text-xl font-bold text-white">{s.title}</h3>
              <p className="mt-3 text-base text-navy-300 leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section id="cta" className="py-24 relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] rounded-full bg-gradient-to-br from-brand-green/10 via-navy-100/40 to-transparent blur-3xl -z-10" />
      <div className="max-w-3xl mx-auto px-6 text-center">
        <div className="rounded-3xl border border-navy-100 bg-white p-10 md:p-14 shadow-xl">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-green">Empieza hoy</p>
          <h2 className="mt-4 text-3xl md:text-5xl font-extrabold tracking-tight text-navy-900">Lleva tu comunicacion al siguiente nivel</h2>
          <p className="max-w-xl mx-auto mt-4 text-lg text-navy-600 leading-relaxed">
            Unete a las empresas que ya automatizan su WhatsApp, emails y calendario con Enlaze. Configura en minutos, sin codigo.
          </p>
          <div className="mt-10">
            <a href="/register" className="inline-flex items-center gap-2 px-10 py-4 rounded-2xl bg-brand-green text-white text-base font-semibold shadow-lg shadow-brand-green/30 hover:bg-brand-green-dark transition-colors">
              Empieza ahora — es gratis <ArrowRight />
            </a>
          </div>
          <p className="mt-6 text-sm text-navy-500">Sin tarjeta de credito · Setup en 5 minutos · Cancela cuando quieras</p>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-navy-100 bg-navy-950">
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-8">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-navy-800 flex items-center justify-center">
              <LinkIcon />
            </div>
            <span className="text-lg font-bold text-white">Enlaze</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-navy-400">
            <a href="#beneficios" className="hover:text-white transition-colors">Beneficios</a>
            <a href="#como-funciona" className="hover:text-white transition-colors">Como funciona</a>
            <a href="/legal/aviso-legal" className="hover:text-white transition-colors">Aviso Legal</a>
            <a href="/legal/privacy" className="hover:text-white transition-colors">Privacidad</a>
            <a href="/legal/terms" className="hover:text-white transition-colors">Términos</a>
            <a href="/legal/cookies" className="hover:text-white transition-colors">Cookies</a>
          </div>
        </div>
        <div className="mt-10 border-t border-white/10 pt-6 text-center text-sm text-navy-500">
          © 2026 Enlaze. Todos los derechos reservados.
        </div>
      </div>
    </footer>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen">
      <Navbar />
      <Hero />
      <Benefits />
      <HowItWorks />
      <FinalCTA />
      <Footer />
    </main>
  );
}
