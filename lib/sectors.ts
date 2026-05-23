// lib/sectors.ts
// Lista compartida de subsectores de comercio local.
// Las `id` coinciden 1:1 con las claves de `sectorConfigs` (lib/agent-prompts.ts)
// y se persisten en `profiles.business_sector` (única fuente de verdad).
// Consúmela tanto en el onboarding como en Ajustes → Sector para evitar drift.

export interface SectorOption {
  id: string;
  icon: string;
  name: string;
  desc: string;
}

export const SECTOR_OPTIONS: SectorOption[] = [
  { id: "construccion", icon: "🏗️", name: "Construcción y Reformas", desc: "Reformas, obra nueva, rehabilitación, instalaciones" },
  { id: "legal", icon: "⚖️", name: "Legal y Abogacía", desc: "Asesoría jurídica, gestión documental, procedimientos" },
  { id: "hosteleria", icon: "🍽️", name: "Hostelería", desc: "Bares, restaurantes, cafeterías, catering" },
  { id: "salud", icon: "🏥", name: "Salud y Bienestar", desc: "Clínicas, fisioterapia, estética, psicología" },
  { id: "comercio", icon: "🛍️", name: "Comercio y Retail", desc: "Tiendas, comercio local, e-commerce" },
  { id: "automocion", icon: "🔧", name: "Automoción", desc: "Talleres mecánicos, chapa y pintura, recambios" },
  { id: "estetica", icon: "💇", name: "Peluquería y Estética", desc: "Peluquerías, centros de estética, spa" },
  { id: "educacion", icon: "📚", name: "Educación y Formación", desc: "Academias, formación, tutorías, coaching" },
  { id: "tecnologia", icon: "💻", name: "Tecnología y Digital", desc: "Desarrollo, IT, consultoría tech, diseño" },
  { id: "eventos", icon: "📸", name: "Eventos y Fotografía", desc: "Fotografía, vídeo, organización de eventos" },
  { id: "otro", icon: "🏢", name: "Otro sector", desc: "Mi sector no está en la lista" },
];

export function findSectorOption(id: string | null | undefined): SectorOption | undefined {
  if (!id) return undefined;
  return SECTOR_OPTIONS.find((s) => s.id === id);
}

/**
 * Devuelve la `id` válida más probable para un valor crudo de business_sector.
 * Acepta alias frecuentes y free-text "otro" no canónico → "otro".
 */
export function normalizeSectorId(value: string | null | undefined): string {
  const v = (value || "").toLowerCase().trim();
  if (!v) return "otro";
  if (SECTOR_OPTIONS.some((s) => s.id === v)) return v;
  if (v === "comercio_local" || v === "retail") return "comercio";
  if (v === "peluqueria" || v === "belleza") return "estetica";
  if (v === "restaurante" || v === "bar" || v === "cafeteria") return "hosteleria";
  return "otro";
}
