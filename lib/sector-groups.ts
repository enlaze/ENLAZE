// lib/sector-groups.ts
// Agrupación en dos niveles (Sector → Subsector) SOLO para la UI de Ajustes.
//
// El valor que se persiste sigue siendo el `id` granular de SECTOR_OPTIONS en
// `profiles.business_sector` (única fuente de verdad, ver lib/sectors.ts).
// Este fichero no introduce ningún valor nuevo en base de datos: solo decide
// bajo qué epígrafe se muestra cada subsector en el selector.

import { SECTOR_OPTIONS, normalizeSectorId, type SectorOption } from "@/lib/sectors";

export interface SectorGroup {
  id: string;
  label: string;
  /** ids de SECTOR_OPTIONS que cuelgan de este grupo */
  members: string[];
}

export const SECTOR_GROUPS: SectorGroup[] = [
  { id: "construccion", label: "Construcción y reformas", members: ["construccion"] },
  { id: "comercio", label: "Comercio y retail", members: ["comercio"] },
  { id: "hosteleria", label: "Hostelería", members: ["hosteleria"] },
  { id: "servicios-profesionales", label: "Servicios profesionales", members: ["legal", "educacion", "tecnologia"] },
  { id: "bienestar", label: "Salud, estética y bienestar", members: ["salud", "estetica"] },
  { id: "tecnico-eventos", label: "Servicios técnicos y eventos", members: ["automocion", "eventos"] },
  { id: "otro", label: "Otro sector", members: ["otro"] },
];

/** Devuelve el grupo al que pertenece un subsector granular. */
export function groupForSector(sectorId: string | null | undefined): SectorGroup {
  const id = normalizeSectorId(sectorId);
  return SECTOR_GROUPS.find((g) => g.members.includes(id)) ?? SECTOR_GROUPS[SECTOR_GROUPS.length - 1];
}

/** Subsectores (SectorOption completos) de un grupo, en el orden de SECTOR_OPTIONS. */
export function subsectorsForGroup(groupId: string): SectorOption[] {
  const group = SECTOR_GROUPS.find((g) => g.id === groupId);
  if (!group) return [];
  return SECTOR_OPTIONS.filter((s) => group.members.includes(s.id));
}
