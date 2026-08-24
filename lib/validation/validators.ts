/**
 * validators.ts — Detección y reporte canónico (Fase 2C). MODO OBSERVADOR.
 *
 * Estas funciones DETECTAN y REPORTAN. No corrigen, no borran líneas, no recalculan
 * importes, no cambian cantidades y no bloquean presupuestos. Son puras: mismas
 * entradas, misma salida, sin red, sin reloj, sin aleatoriedad y sin escrituras.
 *
 * DETERMINISMO: ninguna decisión depende del orden en que lleguen las líneas. Todo se
 * ordena por item_id o por canonical_id antes de agrupar, y las incidencias salen
 * ordenadas por (código, presupuesto, conceptos, líneas). Dos ejecuciones con la misma
 * entrada barajada distinta producen el MISMO array, campo a campo.
 *
 * EXCEPCIONES: una incidencia de negocio nunca se lanza, se devuelve. Sólo se lanza
 * cuando el LLAMADOR ha pasado un contrato incompleto, que es un fallo de programa: un
 * budget_items.canonical_id tiene FK contra canonical_concepts, así que una línea no
 * puede referirse a un concepto inexistente salvo que quien llame haya pasado una lista
 * parcial de conceptos. Callar eso produciría un informe incompleto que parece completo.
 */

import { formatCents, toCents } from "../money";
import {
  FINDING_CODES,
  MATERIAL_BEARING_PRICE_TYPES,
  type CanonicalContract,
  type ConceptRule,
  type EvidenceValue,
  type FindingCode,
  type FindingEvidence,
  type FindingSeverity,
  type ValidationFinding,
  type ValidationLine,
  type ValidationReport,
} from "./types";

// ─── Utilidades ───────────────────────────────────────────────────────────────

/**
 * Si la línea COBRA en la base del presupuesto.
 *
 * Sin afirmación explícita del llamador se deduce del subtotal almacenado: una línea
 * que aporta 0,00 € a la base no está cobrando nada, y por tanto no puede duplicar un
 * cobro ni solaparse económicamente con otra. Es la definición conservadora: en la duda
 * NO se reporta, porque el coste de un falso positivo en modo observador es que un
 * humano pierda el tiempo y deje de fiarse del informe.
 *
 * Se compara en céntimos con toCents por la misma razón que en todo el repositorio: el
 * subtotal viene de un numeric de PostgreSQL y 0.00000001 no debería contar como cobro.
 */
export function isEconomicLine(line: ValidationLine): boolean {
  if (typeof line.economic === "boolean") return line.economic;
  if (line.subtotal === null || line.subtotal === undefined) return false;
  return toCents(line.subtotal) !== 0;
}

/**
 * Huella económica de una línea. EVIDENCIA AUXILIAR, NUNCA IDENTIDAD.
 *
 * Esta huella no asigna ni sugiere canonical_id. Sólo describe la forma económica de la
 * línea: unidad, cantidad, precio unitario e importe. Dos líneas con la misma huella
 * pueden ser el mismo concepto repetido o dos conceptos distintos que casualmente
 * cuestan lo mismo; distinguirlo requiere semántica, no aritmética. Por eso vive aquí,
 * en los validators, y no en el resolver.
 *
 * El dinero entra en céntimos para que 717.5 y 717.50 den la misma huella. La cantidad
 * se fija a cuatro decimales, que es más precisión de la que cualquier medición de obra
 * aporta, y evita que 6 y 6.0000000001 se separen.
 */
export function economicFingerprint(line: ValidationLine): string {
  const unit = (line.unit ?? "").trim().toLowerCase();
  const qty = Number(line.quantity);
  const quantity = Number.isFinite(qty) ? qty.toFixed(4) : "NULL";
  return [unit, quantity, toCents(line.unit_price), toCents(line.subtotal)].join("|");
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function byItemId(a: ValidationLine, b: ValidationLine): number {
  return a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0;
}

/** Agrupa por presupuesto. Sin budget_id todas las líneas caen en el mismo cubo. */
function groupByBudget(lines: readonly ValidationLine[]): [string | null, ValidationLine[]][] {
  const groups = new Map<string, ValidationLine[]>();
  for (const line of lines) {
    const key = line.budget_id ?? "";
    const bucket = groups.get(key);
    if (bucket) bucket.push(line);
    else groups.set(key, [line]);
  }
  return [...groups.keys()]
    .sort()
    .map((key) => [key === "" ? null : key, groups.get(key)!.slice().sort(byItemId)]);
}

/** Retrato de una línea para la evidencia. Copia los importes, no los recalcula. */
function lineEvidence(line: ValidationLine): FindingEvidence {
  return {
    item_id: line.item_id,
    name: line.name ?? null,
    canonical_id: line.canonical_id,
    canonical_status: line.canonical_status,
    price_type: line.price_type,
    quantity: line.quantity ?? null,
    unit: line.unit ?? null,
    unit_price: line.unit_price ?? null,
    subtotal: line.subtotal ?? null,
    huella_economica: economicFingerprint(line),
  };
}

/** Suma de subtotales SÓLO como evidencia. No vuelve a ninguna línea ni a ningún total. */
function sumaSubtotales(lines: readonly ValidationLine[]): number {
  let cents = 0;
  for (const line of lines) cents += toCents(line.subtotal);
  return cents;
}

function nombreCorto(line: ValidationLine): string {
  return line.name?.trim() || line.item_id;
}

// ─── Índice del contrato ──────────────────────────────────────────────────────

interface ContractIndex {
  concept: (canonicalId: string) => ConceptRule;
  /** Conceptos que el agregado incluye. */
  includes: (canonicalId: string) => readonly string[];
  /** Conceptos que incluyen a éste. */
  includedBy: (canonicalId: string) => readonly string[];
}

function buildIndex(contract: CanonicalContract): ContractIndex {
  const concepts = new Map<string, ConceptRule>();
  for (const c of contract.concepts) concepts.set(c.canonical_id, c);

  const includes = new Map<string, string[]>();
  const includedBy = new Map<string, string[]>();

  const push = (map: Map<string, string[]>, key: string, value: string) => {
    const bucket = map.get(key);
    if (bucket) bucket.push(value);
    else map.set(key, [value]);
  };

  for (const rel of contract.relations) {
    if (rel.relation_type !== "includes") continue;
    push(includes, rel.from_canonical, rel.to_canonical);
    push(includedBy, rel.to_canonical, rel.from_canonical);
  }

  for (const list of includes.values()) list.sort();
  for (const list of includedBy.values()) list.sort();

  return {
    concept(canonicalId) {
      const found = concepts.get(canonicalId);
      if (!found) {
        throw new Error(
          `validators: el concepto '${canonicalId}' no está en el contrato recibido. ` +
            `budget_items.canonical_id tiene FK contra canonical_concepts, así que esto ` +
            `sólo puede pasar si el llamador pasó una lista parcial de conceptos.`
        );
      }
      return found;
    },
    includes: (id) => includes.get(id) ?? [],
    includedBy: (id) => includedBy.get(id) ?? [],
  };
}

// ─── Construcción y orden de incidencias ──────────────────────────────────────

function finding(
  code: FindingCode,
  severity: FindingSeverity,
  message: string,
  canonicalIds: readonly string[],
  lines: readonly ValidationLine[],
  budgetId: string | null,
  evidence: FindingEvidence
): ValidationFinding {
  return {
    code,
    severity,
    message,
    canonical_ids: uniqueSorted(canonicalIds),
    item_ids: uniqueSorted(lines.map((l) => l.item_id)),
    budget_id: budgetId,
    evidence,
  };
}

const CODE_ORDER = new Map<FindingCode, number>(FINDING_CODES.map((c, i) => [c, i]));

function compareFindings(a: ValidationFinding, b: ValidationFinding): number {
  const byCode = CODE_ORDER.get(a.code)! - CODE_ORDER.get(b.code)!;
  if (byCode !== 0) return byCode;

  const budget = (a.budget_id ?? "").localeCompare(b.budget_id ?? "");
  if (budget !== 0) return budget;

  const canonical = a.canonical_ids.join(",").localeCompare(b.canonical_ids.join(","));
  if (canonical !== 0) return canonical;

  return a.item_ids.join(",").localeCompare(b.item_ids.join(","));
}

// ─── DUPLICATE_CANONICAL ──────────────────────────────────────────────────────

/**
 * Dos líneas económicas distintas del mismo presupuesto con el mismo canonical_id.
 *
 * Caso real que motivó la Fase 2: «Contenedor y transporte a gestor autorizado» y
 * «Contenedores y transporte», ambas WORK.WASTE.CONTAINER.HAUL, 6 ud × 717,50 € cada
 * una. El cliente paga dos veces el mismo contenedor. Aquí sólo se reporta: ninguna de
 * las dos líneas se toca.
 *
 * Severidad: 'error' cuando TODAS las líneas del grupo están 'resolved', porque
 * entonces la identidad es determinista y el cobro repetido es un hecho. Basta con que
 * una esté en 'review' para bajar a 'warning': con una identidad todavía sin confirmar,
 * afirmar que hay duplicado sería ir más lejos que la evidencia.
 */
export function findDuplicateCanonical(
  lines: readonly ValidationLine[],
  contract: CanonicalContract
): ValidationFinding[] {
  buildIndex(contract); // valida el contrato aunque este validador no lo consulte
  const out: ValidationFinding[] = [];

  for (const [budgetId, budgetLines] of groupByBudget(lines)) {
    const porConcepto = new Map<string, ValidationLine[]>();

    for (const line of budgetLines) {
      if (!line.canonical_id) continue;
      if (!isEconomicLine(line)) continue;
      const bucket = porConcepto.get(line.canonical_id);
      if (bucket) bucket.push(line);
      else porConcepto.set(line.canonical_id, [line]);
    }

    for (const canonicalId of [...porConcepto.keys()].sort()) {
      const grupo = porConcepto.get(canonicalId)!;
      if (grupo.length < 2) continue;

      const todasResueltas = grupo.every((l) => l.canonical_status === "resolved");
      const huellas = uniqueSorted(grupo.map(economicFingerprint));
      const total = sumaSubtotales(grupo);

      out.push(
        finding(
          "DUPLICATE_CANONICAL",
          todasResueltas ? "error" : "warning",
          `El concepto ${canonicalId} se cobra en ${grupo.length} líneas distintas del ` +
            `mismo presupuesto (${grupo.map((l) => `«${nombreCorto(l)}»`).join(", ")}). ` +
            `Importe total afectado: ${formatCents(total)}. No se ha modificado ninguna línea.`,
          [canonicalId],
          grupo,
          budgetId,
          {
            canonical_id: canonicalId,
            lineas: grupo.map(lineEvidence) as readonly EvidenceValue[],
            suma_subtotales_cents: total,
            estados: uniqueSorted(grupo.map((l) => l.canonical_status)),
            // La huella no ha decidido nada aquí: la identidad la dio el canonical_id.
            // Que además coincida es evidencia de refuerzo, y sólo eso.
            huellas_economicas: huellas,
            huella_economica_identica: huellas.length === 1,
          }
        )
      );
    }
  }

  return out.sort(compareFindings);
}

// ─── OVERLAPPING_CANONICAL_SCOPE ──────────────────────────────────────────────

/**
 * Un concepto agregado y un componente suyo, ambos cobrados en el mismo presupuesto.
 *
 * Caso: WORK.WASTE.MANAGEMENT.FULL incluye WORK.WASTE.CONTAINER.HAUL y
 * WORK.WASTE.FEE.DISPOSAL. Si el presupuesto cobra el agregado y además el contenedor,
 * el contenedor se está pagando dos veces.
 *
 * Una relación 'includes' NO es por sí sola un error: describe la estructura del
 * vocabulario, y un presupuesto puede usar perfectamente el agregado sin sus
 * componentes, o un componente sin el agregado. Sólo se reporta cuando AMBAS partes
 * están cobradas económicamente en el mismo presupuesto.
 *
 * Reparto de competencias con MATERIAL_DOUBLE_IMPUTATION: cuando lo incluido es un
 * material (kind MAT), el hecho lo reporta aquel validador, que además sabe mirar el
 * price_type. Sin este reparto el mismo hecho generaría dos incidencias distintas.
 */
export function findOverlappingScope(
  lines: readonly ValidationLine[],
  contract: CanonicalContract
): ValidationFinding[] {
  const index = buildIndex(contract);
  const out: ValidationFinding[] = [];

  for (const [budgetId, budgetLines] of groupByBudget(lines)) {
    const economicas = budgetLines.filter((l) => l.canonical_id && isEconomicLine(l));

    const porConcepto = new Map<string, ValidationLine[]>();
    for (const line of economicas) {
      const bucket = porConcepto.get(line.canonical_id!);
      if (bucket) bucket.push(line);
      else porConcepto.set(line.canonical_id!, [line]);
    }

    for (const agregado of [...porConcepto.keys()].sort()) {
      for (const componente of index.includes(agregado)) {
        const lineasComponente = porConcepto.get(componente);
        if (!lineasComponente) continue; // el componente no se cobra: no hay solape
        if (index.concept(componente).kind === "MAT") continue; // competencia del otro validador

        const lineasAgregado = porConcepto.get(agregado)!;
        const implicadas = [...lineasAgregado, ...lineasComponente].sort(byItemId);
        const todasResueltas = implicadas.every((l) => l.canonical_status === "resolved");

        out.push(
          finding(
            "OVERLAPPING_CANONICAL_SCOPE",
            todasResueltas ? "error" : "warning",
            `${agregado} ya engloba a ${componente}, y en este presupuesto se cobran los ` +
              `dos: ${implicadas.map((l) => `«${nombreCorto(l)}»`).join(", ")}. ` +
              `Importe de las líneas implicadas: ${formatCents(sumaSubtotales(implicadas))}. ` +
              `Sólo se reporta; no se ha eliminado ni ajustado nada.`,
            [agregado, componente],
            implicadas,
            budgetId,
            {
              relacion: { from: agregado, to: componente, tipo: "includes" },
              lineas_agregado: lineasAgregado.map(lineEvidence) as readonly EvidenceValue[],
              lineas_componente: lineasComponente.map(lineEvidence) as readonly EvidenceValue[],
              suma_subtotales_cents: sumaSubtotales(implicadas),
            }
          )
        );
      }
    }
  }

  return out.sort(compareFindings);
}

// ─── MATERIAL_DOUBLE_IMPUTATION ───────────────────────────────────────────────

/**
 * Una partida que ya lleva el material en su precio, y el mismo material cobrado además
 * como línea aparte.
 *
 * Casos del seed: WORK.PAINT.EMULSION.WALL.2COATS incluye MAT.PAINT.EMULSION.INTERIOR_MATT
 * y WORK.PAINT.PRIMER.APPLY incluye MAT.PAINT.PRIMER.ACRYLIC.
 *
 * EL price_type MANDA. Con LABOR_ONLY la partida es sólo mano de obra y comprar el
 * material aparte es lo correcto: no se reporta nada. Con LABOR_AND_MATERIAL, SERVICE o
 * MATERIAL_ONLY el material ya está dentro del precio y volver a cobrarlo lo duplica.
 * Con price_type NULL no se puede afirmar ni lo uno ni lo otro: se deja constancia como
 * 'info' y no se inventa ningún price_type.
 *
 * UNA SOLA INCIDENCIA POR MATERIAL. Cuando pintura de paredes y pintura de techos
 * incluyen las dos el mismo esmalte, el hecho es uno: ese material está cobrado aparte
 * pese a estar dentro de dos partidas. Se emite una incidencia con las dos partidas en
 * la evidencia, ordenadas por item_id, en vez de dos incidencias casi idénticas.
 */
export function findMaterialDoubleImputation(
  lines: readonly ValidationLine[],
  contract: CanonicalContract
): ValidationFinding[] {
  const index = buildIndex(contract);
  const out: ValidationFinding[] = [];

  for (const [budgetId, budgetLines] of groupByBudget(lines)) {
    const economicas = budgetLines.filter((l) => l.canonical_id && isEconomicLine(l));

    const porConcepto = new Map<string, ValidationLine[]>();
    for (const line of economicas) {
      const bucket = porConcepto.get(line.canonical_id!);
      if (bucket) bucket.push(line);
      else porConcepto.set(line.canonical_id!, [line]);
    }

    for (const material of [...porConcepto.keys()].sort()) {
      if (index.concept(material).kind !== "MAT") continue;

      const partidas: ValidationLine[] = [];
      for (const contenedora of index.includedBy(material)) {
        const lineasContenedoras = porConcepto.get(contenedora);
        if (!lineasContenedoras) continue;
        for (const line of lineasContenedoras) {
          // LABOR_ONLY: el material aparte es legítimo. No es evidencia de nada.
          if (line.price_type === "LABOR_ONLY") continue;
          partidas.push(line);
        }
      }
      if (partidas.length === 0) continue;

      partidas.sort(byItemId);
      const lineasMaterial = porConcepto.get(material)!;
      const conPrecioConMaterial = partidas.filter(
        (l) => l.price_type !== null && MATERIAL_BEARING_PRICE_TYPES.includes(l.price_type)
      );
      const concluyente = conPrecioConMaterial.length > 0;
      const implicadas = [...lineasMaterial, ...partidas].sort(byItemId);

      out.push(
        finding(
          "MATERIAL_DOUBLE_IMPUTATION",
          concluyente ? "error" : "info",
          concluyente
            ? `El material ${material} se cobra como línea propia ` +
              `(${lineasMaterial.map((l) => `«${nombreCorto(l)}»`).join(", ")}) y además ya ` +
              `está incluido en ${conPrecioConMaterial.length} partida(s) cuyo precio lleva ` +
              `material: ${conPrecioConMaterial.map((l) => `«${nombreCorto(l)}» (${l.price_type})`).join(", ")}. ` +
              `Importe del material cobrado aparte: ${formatCents(sumaSubtotales(lineasMaterial))}. ` +
              `No se ha corregido ningún importe.`
            : `El material ${material} se cobra como línea propia y aparece incluido en ` +
              `partidas sin price_type declarado ` +
              `(${partidas.map((l) => `«${nombreCorto(l)}»`).join(", ")}). ` +
              `Sin price_type no se puede afirmar que esté duplicado; queda como aviso.`,
          [material, ...partidas.map((l) => l.canonical_id!)],
          implicadas,
          budgetId,
          {
            material,
            lineas_material: lineasMaterial.map(lineEvidence) as readonly EvidenceValue[],
            partidas_que_lo_incluyen: partidas.map((l) => ({
              ...lineEvidence(l),
              incluye_material_en_precio:
                l.price_type === null ? null : MATERIAL_BEARING_PRICE_TYPES.includes(l.price_type),
            })) as readonly EvidenceValue[],
            concluyente,
            suma_material_cents: sumaSubtotales(lineasMaterial),
          }
        )
      );
    }
  }

  return out.sort(compareFindings);
}

// ─── PRICE_TYPE_NOT_ALLOWED ───────────────────────────────────────────────────

/**
 * price_type de la línea contra allowed_price_types del concepto.
 *
 * price_type NULL no se reporta como error ni se rellena con el default del concepto:
 * en las 807 líneas históricas la columna está vacía porque nadie la escribió todavía,
 * y rellenarla desde aquí sería inventar una afirmación económica que nadie hizo. Queda
 * como 'info' para que se vea el hueco.
 *
 * Se comprueban TODAS las líneas con canonical_id, cobren o no: un price_type prohibido
 * es una incoherencia del contrato aunque la línea no cobre. Las que no cobran bajan a
 * 'warning' porque no hay dinero en juego.
 */
export function findPriceTypeNotAllowed(
  lines: readonly ValidationLine[],
  contract: CanonicalContract
): ValidationFinding[] {
  const index = buildIndex(contract);
  const out: ValidationFinding[] = [];

  for (const [budgetId, budgetLines] of groupByBudget(lines)) {
    for (const line of budgetLines) {
      if (!line.canonical_id) continue;

      const concepto = index.concept(line.canonical_id);
      const permitidos = concepto.allowed_price_types;

      if (line.price_type === null || line.price_type === undefined) {
        out.push(
          finding(
            "PRICE_TYPE_NOT_ALLOWED",
            "info",
            `La línea «${nombreCorto(line)}» está clasificada como ${line.canonical_id} pero ` +
              `no declara price_type. No se comprueba nada contra ` +
              `[${permitidos.join(", ")}] y no se le asigna ninguno.`,
            [line.canonical_id],
            [line],
            budgetId,
            {
              canonical_id: line.canonical_id,
              price_type: null,
              allowed_price_types: [...permitidos],
              default_price_type: concepto.default_price_type,
              motivo: "price_type ausente",
            }
          )
        );
        continue;
      }

      if (permitidos.includes(line.price_type)) continue;

      out.push(
        finding(
          "PRICE_TYPE_NOT_ALLOWED",
          isEconomicLine(line) ? "error" : "warning",
          `La línea «${nombreCorto(line)}» declara price_type ${line.price_type}, que no ` +
            `está permitido para ${line.canonical_id}. Permitidos: ` +
            `[${permitidos.join(", ")}]. No se ha modificado la línea.`,
          [line.canonical_id],
          [line],
          budgetId,
          {
            canonical_id: line.canonical_id,
            price_type: line.price_type,
            allowed_price_types: [...permitidos],
            default_price_type: concepto.default_price_type,
            motivo: "price_type fuera del vocabulario permitido",
          }
        )
      );
    }
  }

  return out.sort(compareFindings);
}

// ─── ECONOMIC_FINGERPRINT_COLLISION ───────────────────────────────────────────

/**
 * Líneas con la misma huella económica que NO comparten canonical_id.
 *
 * Es una SOSPECHA, siempre 'info', y no asigna identidad a nadie. Dos líneas pueden
 * costar exactamente lo mismo por motivos que no tienen nada que ver con ser el mismo
 * concepto: en este generador muchas partidas alzadas salen de la misma fórmula
 * max(superficie × 1,6, 140) y colisionan sin parecerse en nada.
 *
 * Por construcción esta función no puede producir un DUPLICATE_CANONICAL: aquella
 * agrupa por canonical_id y ésta ni siquiera lo mira para decidir. Cuando el grupo
 * comparte un canonical_id, el caso ya está reportado allí con su severidad real y aquí
 * se omite para no duplicar ruido.
 */
export function findEconomicFingerprintCollisions(
  lines: readonly ValidationLine[],
  contract: CanonicalContract
): ValidationFinding[] {
  buildIndex(contract);
  const out: ValidationFinding[] = [];

  for (const [budgetId, budgetLines] of groupByBudget(lines)) {
    const porHuella = new Map<string, ValidationLine[]>();

    for (const line of budgetLines) {
      if (!isEconomicLine(line)) continue;
      const huella = economicFingerprint(line);
      const bucket = porHuella.get(huella);
      if (bucket) bucket.push(line);
      else porHuella.set(huella, [line]);
    }

    for (const huella of [...porHuella.keys()].sort()) {
      const grupo = porHuella.get(huella)!;
      if (grupo.length < 2) continue;

      const ids = uniqueSorted(grupo.map((l) => l.canonical_id ?? ""));
      const compartenConcepto = ids.length === 1 && ids[0] !== "";
      if (compartenConcepto) continue; // ya lo cuenta DUPLICATE_CANONICAL

      out.push(
        finding(
          "ECONOMIC_FINGERPRINT_COLLISION",
          "info",
          `${grupo.length} líneas tienen exactamente la misma forma económica ` +
            `(${huella}) sin compartir concepto canónico: ` +
            `${grupo.map((l) => `«${nombreCorto(l)}»`).join(", ")}. ` +
            `Es una coincidencia numérica, no una identidad: no se les asigna ningún ` +
            `canonical_id ni se deduce de aquí que estén duplicadas.`,
          grupo.map((l) => l.canonical_id).filter((id): id is string => id !== null),
          grupo,
          budgetId,
          {
            huella_economica: huella,
            lineas: grupo.map(lineEvidence) as readonly EvidenceValue[],
            canonical_ids_distintos: ids.map((id) => (id === "" ? null : id)),
            asigna_identidad: false,
          }
        )
      );
    }
  }

  return out.sort(compareFindings);
}

// ─── Entrada única ────────────────────────────────────────────────────────────

/**
 * Ejecuta los cinco validadores y devuelve el informe completo, ordenado y estable.
 *
 * observer_mode va en el objeto porque quien lo consuma tiene que poder comprobar en
 * ejecución que esto no autoriza a bloquear ni a corregir. En Fase 2 es siempre true.
 */
export function validateBudget(
  lines: readonly ValidationLine[],
  contract: CanonicalContract
): ValidationReport {
  const findings = [
    ...findDuplicateCanonical(lines, contract),
    ...findOverlappingScope(lines, contract),
    ...findMaterialDoubleImputation(lines, contract),
    ...findPriceTypeNotAllowed(lines, contract),
    ...findEconomicFingerprintCollisions(lines, contract),
  ].sort(compareFindings);

  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity] += 1;

  return { findings, counts, observer_mode: true };
}
