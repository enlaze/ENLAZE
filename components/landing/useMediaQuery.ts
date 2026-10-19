"use client";

import { useSyncExternalStore } from "react";

/**
 * Lee una media query y se actualiza si cambia. En el servidor y durante la
 * hidratación devuelve null: todavía no se sabe, así que no se pinta nada que
 * dependa de ella.
 */
export function useMediaQuery(query: string): boolean | null {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => null,
  );
}
