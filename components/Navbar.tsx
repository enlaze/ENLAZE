'use client';

import Logo from "./Logo";

export default function Navbar() {
  return (
    <div className="w-full flex items-center justify-between px-6 py-4 border-b bg-white">
      
      <Logo />

      <div className="hidden md:flex items-center gap-6 text-sm text-gray-600">
        <a href="#beneficios">Beneficios</a>
        <a href="#precios">Precios</a>
        <a href="#como-funciona">Cómo funciona</a>
      </div>

      <div>
        <a href="/login" className="bg-green-500 text-white px-4 py-2 rounded-lg">
          Iniciar sesión
        </a>
      </div>

    </div>
  );
}