"use client";

import { useState } from "react";
import Link from "next/link";
import Logo from "@/components/Logo";

/* Barra de la landing. La landing es siempre clara: no usa variantes `dark:`
   aunque el visitante tenga el tema oscuro guardado de la app. */

const LINKS = [
  { href: "#cada-manana", label: "Cómo funciona" },
  { href: "#precios", label: "Precios" },
];

export default function LandingNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-[#E1E7ED] bg-landing-paper/90 backdrop-blur-md">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
        <Logo href="/" size={32} wordmarkClassName="text-navy-900 text-[17px]" />

        <div className="hidden items-center gap-7 md:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="text-[14px] text-navy-600 hover:text-navy-900">
              {l.label}
            </a>
          ))}
          <Link href="/login" className="text-[14px] text-navy-600 hover:text-navy-900">
            Entrar
          </Link>
          <Link
            href="/register"
            className="rounded-[10px] bg-navy-900 px-4 py-2.5 text-[14px] font-semibold text-white hover:bg-navy-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green"
          >
            Empieza gratis
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="menu-landing"
          aria-label={open ? "Cerrar menú" : "Abrir menú"}
          className="-mr-2 rounded-lg p-2 text-navy-800 md:hidden"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            {open ? <path d="M18 6 6 18M6 6l12 12" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </nav>

      {open && (
        <div id="menu-landing" className="flex flex-col gap-1 border-t border-[#E1E7ED] bg-landing-paper px-4 pb-5 pt-2 md:hidden">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="py-2.5 text-[15px] text-navy-700">
              {l.label}
            </a>
          ))}
          <Link href="/login" className="py-2.5 text-[15px] text-navy-700">
            Entrar
          </Link>
          <Link href="/register" className="mt-2 rounded-[10px] bg-navy-900 px-4 py-3 text-center text-[15px] font-semibold text-white">
            Empieza gratis
          </Link>
        </div>
      )}
    </header>
  );
}
