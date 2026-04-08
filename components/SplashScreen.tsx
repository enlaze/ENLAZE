'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';

export default function SplashScreen() {
  const [visible, setVisible] = useState(true);
  const [animateIn, setAnimateIn] = useState(false);

  useEffect(() => {
    // Pequeño delay para disparar la animación de entrada
    const enterTimer = setTimeout(() => setAnimateIn(true), 50);
    // Empieza a desvanecer a los 2.5s
    const exitTimer = setTimeout(() => setAnimateIn(false), 2500);
    // Quita el overlay del DOM cuando termina el fade-out
    const removeTimer = setTimeout(() => setVisible(false), 3300);

    return () => {
      clearTimeout(enterTimer);
      clearTimeout(exitTimer);
      clearTimeout(removeTimer);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center bg-white transition-opacity duration-700 ease-out ${
        animateIn ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      aria-hidden="true"
    >
      <Image
        src="/logo.png"
        alt="Logo"
        width={240}
        height={240}
        priority
        className={`transition-all duration-1000 ease-out ${
          animateIn ? 'opacity-100 scale-100' : 'opacity-0 scale-90'
        }`}
      />
    </div>
  );
}