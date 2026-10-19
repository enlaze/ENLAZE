/*
 * Datos y orden de la portada «El caos que se ordena», sin JSX ni estilos, para
 * poder probarlos desde Node. El dibujo de cada pieza vive en ChaosHero.tsx.
 */

export type SlotId = "a" | "b" | "c" | "d";

export const SLOT_ORDER: SlotId[] = ["a", "b", "c", "d"];

/** Franjas de la captura real (1826 × 1322): dónde empieza y cuánto mide cada una, en % del alto. */
export const SLOTS: Record<SlotId, { top: number; height: number }> = {
  a: { top: 0, height: 39.713 },
  b: { top: 39.713, height: 18.532 },
  c: { top: 58.245, height: 18.23 },
  d: { top: 76.475, height: 23.525 },
};

/** Muelles del diseño (ω, ζ) pasados a rigidez y amortiguación de framer-motion. */
export const spring = (w: number, z: number) => ({ type: "spring" as const, stiffness: w * w, damping: 2 * z * w, mass: 1 });
export const PIECE_SPRING = spring(6.2, 0.68);
export const SLOT_SPRING = spring(13, 0.42);
export const WINDOW_SPRING = spring(8, 0.8);

/** Si nadie baja, se ordena solo a los 2,6 s. */
export const AUTO_ORDER_SECONDS = 2.6;

type Pos = { left: number; top: number };

export type PieceLayout = {
  id: string;
  slot: SlotId;
  /** Giro inicial en grados. */
  r: number;
  seed: number;
  desktop: Pos;
  /** null = no sale en el móvil. */
  mobile: Pos | null;
};

/*
 * Las piezas cuentan lo mismo que la captura: la factura F-2026/0009 de Pinar 8
 * (1.240 €), la de Ana Navarro (630 €) y el presupuesto de cocina de Javier Ruiz.
 * Posiciones del diseño: `left` en % del ancho de la portada, `top` en px.
 */
export const PIECE_LAYOUT: PieceLayout[] = [
  { id: "tk1", slot: "a", r: 12, seed: 1, desktop: { left: 26, top: 580 }, mobile: { left: 72, top: 480 } },
  { id: "tk2", slot: "a", r: -11, seed: 2, desktop: { left: 87, top: 290 }, mobile: null },
  { id: "ag", slot: "a", r: -3, seed: 3, desktop: { left: 40, top: 540 }, mobile: { left: 40, top: 66 } },
  // En el diseño, en el móvil iba a 250 px y quedaba detrás del subtítulo: bajo el botón no tapa nada.
  { id: "inv", slot: "b", r: 7, seed: 4, desktop: { left: 5.5, top: 230 }, mobile: { left: -10, top: 520 } },
  { id: "wa2", slot: "b", r: 5, seed: 5, desktop: { left: 54.5, top: 606 }, mobile: { left: 36, top: 560 } },
  { id: "amt1", slot: "b", r: -9, seed: 6, desktop: { left: 15.5, top: 478 }, mobile: null },
  { id: "wa3", slot: "c", r: -4, seed: 7, desktop: { left: 4, top: 690 }, mobile: null },
  { id: "amt2", slot: "c", r: 9, seed: 8, desktop: { left: 75, top: 470 }, mobile: { left: 62, top: 705 } },
  { id: "wa1", slot: "d", r: -6, seed: 9, desktop: { left: 3.5, top: 40 }, mobile: null },
  { id: "pi", slot: "d", r: 7, seed: 10, desktop: { left: 84, top: 30 }, mobile: { left: 74, top: 8 } },
  { id: "em", slot: "d", r: -4, seed: 11, desktop: { left: 70, top: 650 }, mobile: { left: 5, top: 640 } },
];

/** Piezas que salen en cada pantalla, en el orden en que encajan: por franja y luego como en el diseño. */
export function piecesFor(mobile: boolean) {
  return PIECE_LAYOUT.filter((p) => !mobile || p.mobile)
    .map((p, dom) => ({ p, dom }))
    .sort((a, b) => SLOT_ORDER.indexOf(a.p.slot) - SLOT_ORDER.indexOf(b.p.slot) || a.dom - b.dom)
    .map(({ p }, k) => ({
      ...p,
      k,
      delay: 0.12 + k * 0.075,
      // Trayectoria curva, alternando el lado.
      arc: (k % 2 ? 1 : -1) * (46 + ((p.seed * 37) % 40)),
      jx: ((k % 3) - 1) * 0.22,
    }));
}

/** Cuándo empieza a encajar cada franja: medio segundo largo después de su última pieza. */
export function slotDelays(placed: ReturnType<typeof piecesFor>) {
  const last: Partial<Record<SlotId, number>> = {};
  for (const p of placed) last[p.slot] = Math.max(last[p.slot] ?? 0, p.delay);
  return Object.fromEntries(SLOT_ORDER.map((id) => [id, (last[id] ?? 0) + 0.42])) as Record<SlotId, number>;
}
