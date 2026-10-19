/**
 * Junta el resumen del agente (n8n: Gmail, Calendar, mercado...) con los
 * hechos de la cuenta en Enlaze (`business-facts.ts`) en lo que pinta la
 * tarjeta del resumen.
 *
 * Reglas:
 *  - Si el resumen del agente es de HOY, se respeta entero (titular,
 *    narrativa, sello de la IA) y los hechos de la cuenta van delante en
 *    «Qué hacer hoy» y en «Ojo con».
 *  - Si el resumen es de otro día y hay hechos, manda lo de hoy: titular,
 *    narrativa y acciones salen de los hechos, con la fecha de hoy. Las
 *    acciones de un resumen viejo no se mezclan con las de hoy.
 *  - Si el resumen es viejo y no hay hechos, se enseña como hasta ahora.
 *  - Sin resumen y sin hechos: null (la tarjeta enseña «conecta el agente»).
 */

import type { BusinessAction, BusinessFacts, BusinessFactKind } from "./business-facts";

export interface MergedAction {
  title: string;
  reason?: string;
  moment?: string;
  priority?: "alta" | "media" | "baja";
  href?: string;
  hrefLabel?: string;
}

export interface AgentBriefingPart {
  id: string;
  /** AAAA-MM-DD */
  executionDate: string;
  headline: string;
  narrative: string;
  actions: MergedAction[];
  opportunities: string[];
  watchOuts: string[];
  aiWritten: boolean;
}

export interface MergedBriefing {
  summaryId: string;
  /** AAAA-MM-DD del resumen que se enseña. */
  date: string;
  headline: string;
  narrative: string;
  actions: MergedAction[];
  opportunities: string[];
  watchOuts: string[];
  aiWritten: boolean;
  /** true si incluye hechos de la cuenta. */
  hasBusinessFacts: boolean;
}

/** Como mucho, cuántas acciones enseña la tarjeta en total. */
export const MAX_CARD_ACTIONS = 7;

const LINK_LABEL: Record<BusinessFactKind, string> = {
  cobrar: "Ver el recordatorio",
  contestar: "Abrir el presupuesto",
  enviar: "Abrir el presupuesto",
  precio: "Ver el aviso",
};

export function factToAction(a: BusinessAction): MergedAction {
  return {
    title: a.title,
    reason: a.reason,
    moment: a.moment,
    priority: a.priority,
    href: a.href,
    hrefLabel: LINK_LABEL[a.kind],
  };
}

export function mergeBriefing(
  agent: AgentBriefingPart | null,
  facts: BusinessFacts | null,
  today: string,
): MergedBriefing | null {
  const factActions = (facts?.actions ?? []).map(factToAction);
  const factWatch = facts?.watchOuts ?? [];
  const hasFacts = factActions.length > 0 || factWatch.length > 0;

  if (agent && agent.executionDate === today) {
    return {
      summaryId: agent.id,
      date: agent.executionDate,
      headline: agent.headline || facts?.headline || "",
      narrative: agent.narrative || facts?.narrative || "",
      actions: [...factActions, ...agent.actions].slice(0, MAX_CARD_ACTIONS),
      opportunities: agent.opportunities,
      watchOuts: [...factWatch, ...agent.watchOuts],
      aiWritten: agent.aiWritten,
      hasBusinessFacts: hasFacts,
    };
  }

  if (hasFacts) {
    return {
      // El estado de las casillas se guarda por id: uno por día.
      summaryId: `negocio-${today}`,
      date: today,
      headline: facts?.headline || "Lo que tienes pendiente hoy",
      narrative: facts?.narrative || "",
      actions: factActions,
      opportunities: [],
      watchOuts: factWatch,
      aiWritten: false,
      hasBusinessFacts: true,
    };
  }

  if (agent) {
    return {
      summaryId: agent.id,
      date: agent.executionDate,
      headline: agent.headline,
      narrative: agent.narrative,
      actions: agent.actions,
      opportunities: agent.opportunities,
      watchOuts: agent.watchOuts,
      aiWritten: agent.aiWritten,
      hasBusinessFacts: false,
    };
  }

  return null;
}
