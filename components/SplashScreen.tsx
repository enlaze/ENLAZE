'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';


/* Coreografía — ajusta todo aquí */
const TIMINGS = {
  focusDuration: 1200,
  shineStart: 850,
  shineDuration: 1500,
  exitStart: 2800,
  exitDuration: 800,
  totalDuration: 3400,
};

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

const LOGO_SRC = '/logo.png';
const LOGO_SIZE = 340;
const STORAGE_KEY = 'enlaze_splash_shown';

export default function SplashScreen() {
  const [shouldRender, setShouldRender] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [shine, setShine] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Solo se muestra la primera vez en la sesión del navegador.
    // sessionStorage se borra al cerrar la pestaña/navegador,
    // así que volverá a aparecer en una nueva sesión pero NO al
    // navegar entre páginas, hacer login o recargar.
    let alreadyShown: string | null = null;
    try {
      alreadyShown = sessionStorage.getItem(STORAGE_KEY);
    } catch {
      // Si sessionStorage no está disponible (modo privado raro),
      // simplemente mostramos el splash.
    }

    if (alreadyShown) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: skip splash on subsequent navigations within the same session
      setDone(true);
      return;
    }

    try {
      sessionStorage.setItem(STORAGE_KEY, '1');
    } catch {}

    setShouldRender(true);

    const t0 = setTimeout(() => setMounted(true), 30);
    const t1 = setTimeout(() => setShine(true), TIMINGS.shineStart);
    const t2 = setTimeout(() => setExiting(true), TIMINGS.exitStart);
    const t3 = setTimeout(() => setDone(true), TIMINGS.totalDuration);

    return () => [t0, t1, t2, t3].forEach(clearTimeout);
  }, []);

  if (done || !shouldRender) return null;

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-white"
      style={{
        opacity: exiting ? 0 : 1,
        transition: `opacity ${TIMINGS.exitDuration}ms ${EASE}`,
      }}
    >
      <div
        className="relative"
        style={{
          width: LOGO_SIZE,
          height: LOGO_SIZE,
          opacity: mounted ? 1 : 0,
          filter: `blur(${mounted ? 0 : 8}px)`,
          transform: `scale(${mounted ? 1 : 0.95})`,
          transition: `
            opacity ${TIMINGS.focusDuration}ms ${EASE},
            filter ${TIMINGS.focusDuration}ms ${EASE},
            transform ${TIMINGS.focusDuration}ms ${EASE}
          `,
        }}
      >
     <Image
  src={LOGO_SRC}
  alt="Logo"
  width={LOGO_SIZE}
  height={LOGO_SIZE}
  priority
  className="select-none"
/>


        {/* Light sweep ultra sutil recortado a la silueta del logo */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            WebkitMaskImage: `url(${LOGO_SRC})`,
            maskImage: `url(${LOGO_SRC})`,
            WebkitMaskSize: 'contain',
            maskSize: 'contain',
            WebkitMaskRepeat: 'no-repeat',
            maskRepeat: 'no-repeat',
            WebkitMaskPosition: 'center',
            maskPosition: 'center',
          }}
        >
          <div
            className="absolute top-0 h-full"
            style={{
              width: '50%',
              background:
                'linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.35) 50%, transparent 70%)',
              filter: 'blur(10px)',
              left: shine ? '150%' : '-80%',
              transition: `left ${TIMINGS.shineDuration}ms ${EASE}`,
            }}
          />
        </div>
      </div>
    </div>
  );
}