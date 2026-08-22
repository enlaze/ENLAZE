export type ProcurementKind = "product" | "service";

export interface ProcurementMaterialLike {
  procurementKind?: ProcurementKind | null;
  name?: string | null;
}

export function getProcurementKind(material: ProcurementMaterialLike): ProcurementKind {
  return material.procurementKind === "service" ? "service" : "product";
}

export function isCommercialProductMaterial(material: ProcurementMaterialLike): boolean {
  return getProcurementKind(material) === "product";
}

export function isServiceMaterial(material: ProcurementMaterialLike): boolean {
  return getProcurementKind(material) === "service";
}

/**
 * A commercial basket line must identify one purchasable SKU family. Bundles,
 * unresolved alternatives and generic accessory groups cannot be verified
 * honestly against a single supplier product.
 */
export function auditAtomicMaterialName(name: string) {
  const normalized = String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const reasons: string[] = [];

  if (!normalized) reasons.push("Falta el nombre del producto");
  // Separators written between words normally denote a bundle/choice. Keep
  // legitimate technical notation such as 1P+N and fractional threads 1/2.
  if (/\s\+\s/.test(normalized) || /[a-záéíóúñ]\s*\/\s*[a-záéíóúñ]/.test(normalized)) {
    reasons.push("Contiene varios productos o una alternativa sin resolver");
  }
  if (/\b(?:lote|varios|surtido|accesorios|consumibles)\b/.test(normalized)) {
    reasons.push("Describe un conjunto genérico, no un producto individual");
  }
  if (/\b(?:ceramico|porcelanico)\s*\/\s*(?:laminado|vinilico)\b/.test(normalized)) {
    reasons.push("La solución constructiva todavía no está seleccionada");
  }

  return {
    isAtomic: reasons.length === 0,
    reasons,
  };
}
