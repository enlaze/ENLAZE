/**
 * budget-planner.ts
 *
 * FASE 5 del generador de presupuestos v2.
 * Planificacion temporal: duracion, fases, dependencias, ruta critica, cuadrilla.
 *
 * 100% determinista — sin IA, sin llamadas externas.
 * Recibe BudgetItemV2[] + ProjectAnalysis y devuelve BudgetTimeline.
 *
 * Funciones principales:
 *   - calculateTimeline(): planificacion completa
 *   - calculateCriticalPath(): identifica la secuencia mas larga
 *   - recommendCrew(): recomienda composicion de cuadrilla
 */

import type {
  BudgetItemV2,
  BudgetTimeline,
  DurationEstimate,
  CrewRecommendation,
  CrewMember,
  TimelinePhaseV2,
  DryingTime,
  ProjectAnalysis,
  ChapterCode,
  TradeCode,
} from "./types/budget-v2";

// ─── Rendimientos base (horas por unidad) ───────────────────────────────────

const RENDIMIENTOS: Record<string, Record<string, number>> = {
  demoliciones:         { m2: 0.30, ud: 0.50, m3: 2.0, pa: 4.0 },
  albanileria:          { m2: 0.60, ud: 0.80, ml: 0.20 },
  fontaneria:           { ud: 2.50, ml: 0.30, punto: 1.50, pa: 8.0 },
  electricidad:         { ud: 0.80, punto: 1.20, ml: 0.15, pa: 6.0 },
  revestimientos:       { m2: 0.55, ml: 0.20 },
  pavimentos:           { m2: 0.45, ml: 0.15 },
  pintura:              { m2: 0.15, ml: 0.10 },
  carpinteria_interior: { ud: 2.00 },
  carpinteria_exterior: { ud: 3.00 },
  sanitarios:           { ud: 2.00, pa: 6.0 },
  cocina:               { pa: 16.0 },
  climatizacion:        { ud: 8.00 },
  impermeabilizacion:   { m2: 0.35 },
  falsos_techos:        { m2: 0.40 },
  residuos:             { ud: 1.00, m3: 0.50 },
  limpieza:             { m2: 0.10, pa: 4.0 },
  protecciones:         { pa: 3.0, ud: 0.50 },
  seguridad:            { pa: 2.0, ud: 0.50 },
  rodapie:              { ml: 0.12, m2: 0.15 },
  otros:                { pa: 4.0, ud: 1.0 },
};

// ─── Dependencies between chapters ──────────────────────────────────────────

const CHAPTER_DEPENDENCIES: Record<ChapterCode, ChapterCode[]> = {
  protecciones:         [],
  demoliciones:         ["protecciones"],
  albanileria:          ["demoliciones"],
  fontaneria:           ["demoliciones"],
  electricidad:         ["demoliciones"],
  impermeabilizacion:   ["albanileria", "fontaneria"],
  revestimientos:       ["impermeabilizacion"],
  pavimentos:           ["fontaneria", "electricidad"],
  rodapie:              ["pavimentos"],
  falsos_techos:        ["electricidad"],
  carpinteria_interior: ["albanileria"],
  carpinteria_exterior: ["albanileria"],
  sanitarios:           ["revestimientos", "fontaneria"],
  cocina:               ["revestimientos", "electricidad", "fontaneria"],
  pintura:              ["albanileria", "carpinteria_interior"],
  climatizacion:        ["electricidad"],
  seguridad:            [],
  residuos:             [],
  limpieza:             [],
  otros:                [],
};

// ─── Chapters that can run in parallel ──────────────────────────────────────

const PARALLEL_GROUPS: ChapterCode[][] = [
  ["fontaneria", "electricidad"],
  ["revestimientos", "falsos_techos"],
  ["carpinteria_interior", "carpinteria_exterior"],
];

function canParallel(chapter: ChapterCode): boolean {
  return PARALLEL_GROUPS.some(group => group.includes(chapter));
}

// ─── Drying times ───────────────────────────────────────────────────────────

const DRYING_TIMES: DryingTime[] = [
  { after: "Impermeabilizacion", hours: 24, note: "Secado lamina impermeabilizante antes de alicatar" },
  { after: "Enfoscado / albanileria", hours: 48, note: "Fraguado del mortero antes de alicatar" },
  { after: "Nivelacion suelo", hours: 24, note: "Secado de mortero autonivelante" },
  { after: "Primera mano pintura", hours: 12, note: "Secado entre manos de pintura" },
  { after: "Solado / pavimento", hours: 24, note: "Fraguado de cemento cola antes de rejuntar" },
];

// ─── Phase labels ───────────────────────────────────────────────────────────

const PHASE_LABELS: Record<ChapterCode, string> = {
  protecciones: "Protecciones y trabajos previos",
  demoliciones: "Demoliciones",
  albanileria: "Albanileria y tabiqueria",
  fontaneria: "Fontaneria y saneamiento",
  electricidad: "Electricidad",
  impermeabilizacion: "Impermeabilizacion",
  revestimientos: "Revestimientos de paredes",
  pavimentos: "Pavimentos y solados",
  rodapie: "Rodapie",
  pintura: "Pintura y acabados",
  carpinteria_interior: "Carpinteria interior",
  carpinteria_exterior: "Carpinteria exterior",
  sanitarios: "Sanitarios y griferia",
  cocina: "Cocina",
  climatizacion: "Climatizacion",
  falsos_techos: "Falsos techos",
  residuos: "Gestion de residuos",
  limpieza: "Limpieza final de obra",
  seguridad: "Seguridad y salud",
  otros: "Otros",
};

// ─── Trade to chapter mapping (primary trade per chapter) ───────────────────

const CHAPTER_PRIMARY_TRADE: Record<ChapterCode, TradeCode> = {
  protecciones: "peon",
  demoliciones: "peon_especialista",
  albanileria: "oficial_albanil",
  fontaneria: "fontanero",
  electricidad: "electricista",
  impermeabilizacion: "oficial_albanil",
  revestimientos: "alicatador",
  pavimentos: "alicatador",
  rodapie: "oficial_albanil",
  pintura: "pintor",
  carpinteria_interior: "carpintero",
  carpinteria_exterior: "carpintero",
  sanitarios: "fontanero",
  cocina: "carpintero",
  climatizacion: "climatizador",
  falsos_techos: "oficial_albanil",
  residuos: "peon",
  limpieza: "peon",
  seguridad: "encargado",
  otros: "peon",
};

// ─── Core calculation ───────────────────────────────────────────────────────

const HOURS_PER_DAY = 8;
const WORKING_DAYS_PER_WEEK = 5;
const CALENDAR_FACTOR = 1.4; // working days -> calendar days

/**
 * FASE 5: Calculate complete timeline for a budget.
 *
 * Pure function — no side effects, no DB calls.
 *
 * @param items - BudgetItemV2[] with quantities
 * @param analysis - ProjectAnalysis from FASE 1 (optional, for phase hints)
 * @param workersCount - user-specified workers (null = auto-recommend)
 * @param startDate - ISO date string (optional)
 * @param deadlineDate - ISO date string (optional)
 */
export function calculateTimeline(
  items: BudgetItemV2[],
  analysis: ProjectAnalysis | null,
  workersCount: number | null,
  startDate: string | null,
  deadlineDate: string | null,
): BudgetTimeline {
  // ── Calculate hours per chapter ──
  const chapterHours = calculateChapterHours(items);

  // ── Recommend crew ──
  const crew = recommendCrew(items, chapterHours, workersCount);

  // ── Build phases with dependencies ──
  const phases = buildPhases(items, chapterHours, crew);

  // ── Calculate duration ──
  const duration = calculateDuration(phases);

  // ── Critical path ──
  const criticalPath = calculateCriticalPath(phases);

  // ── Applicable drying times ──
  const activeChapters = new Set(items.map(i => i.chapter));
  const applicableDrying = DRYING_TIMES.filter(dt => {
    const afterLower = dt.after.toLowerCase();
    if (afterLower.includes("impermeabilizacion") && activeChapters.has("impermeabilizacion")) return true;
    if ((afterLower.includes("enfoscado") || afterLower.includes("albanileria")) && activeChapters.has("albanileria")) return true;
    if (afterLower.includes("nivelacion") && activeChapters.has("pavimentos")) return true;
    if (afterLower.includes("pintura") && activeChapters.has("pintura")) return true;
    if ((afterLower.includes("solado") || afterLower.includes("pavimento")) && activeChapters.has("pavimentos")) return true;
    return false;
  });

  // ── Risks ──
  const risks: string[] = [];
  if (activeChapters.has("carpinteria_exterior")) {
    risks.push("Plazo de entrega de ventanas a medida: 15-20 dias laborables");
  }
  if (activeChapters.has("demoliciones")) {
    risks.push("Instalaciones ocultas en mal estado pueden anadir 2-3 dias");
  }
  if (activeChapters.has("impermeabilizacion")) {
    risks.push("Condiciones de humedad pueden retrasar secado de impermeabilizacion");
  }
  if (deadlineDate && startDate) {
    const start = new Date(startDate);
    const deadline = new Date(deadlineDate);
    const calendarDaysAvailable = Math.ceil((deadline.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    if (calendarDaysAvailable < duration.calendar_days_min) {
      risks.push(`Plazo disponible (${calendarDaysAvailable} dias) inferior a la duracion minima estimada (${duration.calendar_days_min} dias)`);
    }
  }

  // ── End date estimate ──
  let endDateEstimated: string | null = null;
  if (startDate) {
    const start = new Date(startDate);
    const avgCalendarDays = Math.round((duration.calendar_days_min + duration.calendar_days_max) / 2);
    const end = new Date(start.getTime() + avgCalendarDays * 24 * 60 * 60 * 1000);
    endDateEstimated = end.toISOString().split("T")[0];
  }

  const assumptions: string[] = [
    `Jornada laboral de ${HOURS_PER_DAY} horas`,
    `${WORKING_DAYS_PER_WEEK} dias laborables por semana`,
    "Materiales disponibles sin plazo de espera excepto ventanas a medida",
    `Cuadrilla de ${crew.workers_total} trabajadores`,
  ];

  return {
    estimated_duration: duration,
    recommended_crew: crew,
    phases,
    critical_path: criticalPath,
    drying_times: applicableDrying,
    risks,
    start_date: startDate,
    end_date_estimated: endDateEstimated,
    assumptions,
  };
}

// ─── Hours calculation per chapter ──────────────────────────────────────────

interface ChapterHoursEntry {
  chapter: ChapterCode;
  hours: number;
  items: string[];
}

function calculateChapterHours(items: BudgetItemV2[]): Map<ChapterCode, ChapterHoursEntry> {
  const result = new Map<ChapterCode, ChapterHoursEntry>();

  for (const item of items) {
    const entry = result.get(item.chapter) || {
      chapter: item.chapter,
      hours: 0,
      items: [],
    };

    // Use item's estimated_hours if available, otherwise calculate from rendimientos
    let hours = item.estimated_hours;
    if (hours <= 0) {
      const rendimiento = RENDIMIENTOS[item.chapter];
      if (rendimiento) {
        const unitRendimiento = rendimiento[item.unit] || rendimiento["ud"] || 1.0;
        hours = item.quantity * unitRendimiento;
      } else {
        hours = item.quantity * 1.0; // fallback: 1h per unit
      }
    }

    entry.hours += hours;
    entry.items.push(item.id);
    result.set(item.chapter, entry);
  }

  return result;
}

// ─── Crew recommendation ────────────────────────────────────────────────────

function recommendCrew(
  items: BudgetItemV2[],
  chapterHours: Map<ChapterCode, ChapterHoursEntry>,
  userWorkersCount: number | null,
): CrewRecommendation {
  // Aggregate hours by trade
  const tradeHours = new Map<TradeCode, number>();

  for (const [chapter, entry] of chapterHours) {
    // Use item-level trades if available
    const chapterItems = items.filter(i => i.chapter === chapter);
    const itemTradeHours = new Map<TradeCode, number>();

    for (const item of chapterItems) {
      const trade = item.trade || CHAPTER_PRIMARY_TRADE[chapter];
      const h = item.estimated_hours > 0 ? item.estimated_hours : entry.hours / chapterItems.length;
      itemTradeHours.set(trade, (itemTradeHours.get(trade) || 0) + h);
    }

    for (const [trade, hours] of itemTradeHours) {
      tradeHours.set(trade, (tradeHours.get(trade) || 0) + hours);
    }
  }

  // Build crew breakdown
  const breakdown: CrewMember[] = [];
  for (const [trade, hours] of tradeHours) {
    if (hours <= 0) continue;
    const days = Math.ceil(hours / HOURS_PER_DAY);
    breakdown.push({ trade, count: 1, days });
  }

  // Sort by days descending
  breakdown.sort((a, b) => b.days - a.days);

  // If user specified workers count, use it; otherwise estimate
  let workersTotal: number;
  if (userWorkersCount && userWorkersCount > 0) {
    workersTotal = userWorkersCount;
  } else {
    // Heuristic: unique trades that have significant work (>= 2 days)
    const significantTrades = breakdown.filter(b => b.days >= 2);
    workersTotal = Math.max(2, Math.min(significantTrades.length + 1, 8));
  }

  return {
    workers_total: workersTotal,
    breakdown,
  };
}

// ─── Phase building with dependencies ───────────────────────────────────────

function buildPhases(
  items: BudgetItemV2[],
  chapterHours: Map<ChapterCode, ChapterHoursEntry>,
  crew: CrewRecommendation,
): TimelinePhaseV2[] {
  // Only build phases for chapters that have items
  const activeChapters = [...chapterHours.keys()];

  // Build ordered phases respecting dependencies
  const ordered = topologicalSort(activeChapters);

  const phases: TimelinePhaseV2[] = [];
  const phaseEndDays = new Map<ChapterCode, number>();

  for (let i = 0; i < ordered.length; i++) {
    const chapter = ordered[i];
    const entry = chapterHours.get(chapter);
    if (!entry || entry.hours <= 0) continue;

    // Find workers for this chapter's primary trade
    const primaryTrade = CHAPTER_PRIMARY_TRADE[chapter];
    const tradeWorkers = crew.breakdown.find(b => b.trade === primaryTrade)?.count || 1;

    const durationDays = Math.max(1, Math.ceil(entry.hours / (tradeWorkers * HOURS_PER_DAY)));

    // Calculate start day based on dependencies
    const deps = CHAPTER_DEPENDENCIES[chapter].filter(d => activeChapters.includes(d));
    let startDay = 1;
    for (const dep of deps) {
      const depEnd = phaseEndDays.get(dep);
      if (depEnd && depEnd >= startDay) {
        startDay = depEnd + 1;
      }
    }

    // Add drying time if applicable
    if (chapter === "revestimientos" && phaseEndDays.has("impermeabilizacion")) {
      startDay = Math.max(startDay, (phaseEndDays.get("impermeabilizacion") || 0) + 2); // +1 day for 24h drying
    }
    if (chapter === "revestimientos" && phaseEndDays.has("albanileria")) {
      startDay = Math.max(startDay, (phaseEndDays.get("albanileria") || 0) + 3); // +2 days for 48h fraguado
    }

    const endDay = startDay + durationDays - 1;
    phaseEndDays.set(chapter, endDay);

    // Determine dependency phase indices
    const dependsOnIndices = deps
      .map(d => phases.findIndex(p => p.name === PHASE_LABELS[d]))
      .filter(idx => idx >= 0)
      .map(idx => idx + 1); // 1-based

    phases.push({
      order: phases.length + 1,
      name: PHASE_LABELS[chapter],
      start_day: startDay,
      end_day: endDay,
      duration_days: durationDays,
      depends_on: dependsOnIndices,
      can_parallel: canParallel(chapter),
      items: entry.items,
    });
  }

  // Special: limpieza always goes last
  const cleaningPhase = phases.find(p => p.name === PHASE_LABELS.limpieza);
  if (cleaningPhase) {
    const maxEndDay = Math.max(...phases.filter(p => p !== cleaningPhase).map(p => p.end_day), 0);
    cleaningPhase.start_day = maxEndDay + 1;
    cleaningPhase.end_day = cleaningPhase.start_day + cleaningPhase.duration_days - 1;
  }

  return phases;
}

// ─── Topological sort for chapter ordering ──────────────────────────────────

function topologicalSort(chapters: ChapterCode[]): ChapterCode[] {
  const chaptersSet = new Set(chapters);
  const visited = new Set<ChapterCode>();
  const result: ChapterCode[] = [];

  function visit(chapter: ChapterCode) {
    if (visited.has(chapter)) return;
    visited.add(chapter);

    const deps = CHAPTER_DEPENDENCIES[chapter] || [];
    for (const dep of deps) {
      if (chaptersSet.has(dep)) {
        visit(dep);
      }
    }
    result.push(chapter);
  }

  // Visit in a deterministic order
  const orderedChapters: ChapterCode[] = [
    "protecciones", "seguridad", "demoliciones", "albanileria",
    "fontaneria", "electricidad", "impermeabilizacion",
    "revestimientos", "pavimentos", "rodapie", "falsos_techos",
    "carpinteria_interior", "carpinteria_exterior",
    "sanitarios", "cocina", "climatizacion",
    "pintura", "residuos", "limpieza", "otros",
  ];

  for (const ch of orderedChapters) {
    if (chaptersSet.has(ch)) visit(ch);
  }
  // Any remaining chapters not in orderedChapters
  for (const ch of chapters) {
    if (!visited.has(ch)) visit(ch);
  }

  return result;
}

// ─── Duration calculation ───────────────────────────────────────────────────

function calculateDuration(phases: TimelinePhaseV2[]): DurationEstimate {
  if (phases.length === 0) {
    return {
      working_days_min: 0,
      working_days_max: 0,
      calendar_days_min: 0,
      calendar_days_max: 0,
      weeks_min: 0,
      weeks_max: 0,
    };
  }

  const maxEndDay = Math.max(...phases.map(p => p.end_day));

  // Min: optimistic (phases can overlap perfectly)
  const workingDaysMin = maxEndDay;
  // Max: add 20% buffer for delays, unexpected issues
  const workingDaysMax = Math.ceil(maxEndDay * 1.2);

  const calendarDaysMin = Math.ceil(workingDaysMin * CALENDAR_FACTOR);
  const calendarDaysMax = Math.ceil(workingDaysMax * CALENDAR_FACTOR);

  const weeksMin = Math.ceil(workingDaysMin / WORKING_DAYS_PER_WEEK);
  const weeksMax = Math.ceil(workingDaysMax / WORKING_DAYS_PER_WEEK);

  return {
    working_days_min: workingDaysMin,
    working_days_max: workingDaysMax,
    calendar_days_min: calendarDaysMin,
    calendar_days_max: calendarDaysMax,
    weeks_min: weeksMin,
    weeks_max: weeksMax,
  };
}

// ─── Critical path ──────────────────────────────────────────────────────────

function calculateCriticalPath(phases: TimelinePhaseV2[]): string[] {
  if (phases.length === 0) return [];

  // Find the phase that ends last
  let lastPhase = phases[0];
  for (const phase of phases) {
    if (phase.end_day > lastPhase.end_day) {
      lastPhase = phase;
    }
  }

  // Trace back through dependencies to build critical path
  const path: string[] = [lastPhase.name];
  let current = lastPhase;

  while (current.depends_on.length > 0) {
    // Find the dependency that ends latest (the one on the critical path)
    let latestDep: TimelinePhaseV2 | null = null;
    for (const depOrder of current.depends_on) {
      const dep = phases.find(p => p.order === depOrder);
      if (dep && (!latestDep || dep.end_day > latestDep.end_day)) {
        latestDep = dep;
      }
    }

    if (!latestDep) break;
    path.unshift(latestDep.name);
    current = latestDep;
  }

  return path;
}
