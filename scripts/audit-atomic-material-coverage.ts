#!/usr/bin/env node

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { MATERIAL_SPECS } from "../lib/budget-engine";
import {
  evaluateCommercialProductMatch,
  isProductSpecificSourceUrl,
} from "../lib/commercial-product-match";
import { buildCatalogSearchTokenGroups } from "../lib/price-catalog-search";
import { hasVerifiedCatalogEvidence } from "../lib/price-traceability";

interface CatalogProvider {
  id: string;
  name: string;
  company_id: string | null;
}

interface CatalogProduct {
  id: string;
  commercial_name: string;
  sku: string | null;
  sale_unit: string;
  unit_price: number;
  units_per_package: number | null;
  url: string | null;
  source_url: string | null;
  checked_at: string | null;
  pb_providers: CatalogProvider | CatalogProvider[];
}

interface EvidenceRow {
  product_id: string;
  source_url: string | null;
  metadata: Record<string, unknown> | null;
  observed_at: string | null;
}

interface AuditedCandidate {
  product_id: string;
  product_name: string;
  provider: string;
  sku: string | null;
  unit: string;
  units_per_package: number | null;
  price: number;
  source_url: string | null;
  checked_at: string | null;
  semantic_score: number;
  exact_semantics: boolean;
  traceable: boolean;
  issues: string[];
}

function getOption(name: string, fallback = "") {
  const exact = `--${name}`;
  const prefix = `${exact}=`;
  const index = process.argv.findIndex(
    (argument) => argument === exact || argument.startsWith(prefix),
  );
  if (index === -1) return fallback;
  const argument = process.argv[index];
  if (argument.startsWith(prefix)) return argument.slice(prefix.length);
  return process.argv[index + 1] && !process.argv[index + 1].startsWith("--")
    ? process.argv[index + 1]
    : "true";
}

function providerFromProduct(product: CatalogProduct) {
  return Array.isArray(product.pb_providers)
    ? product.pb_providers[0]
    : product.pb_providers;
}

function canonicalSourceUrl(product: CatalogProduct, evidence?: EvidenceRow) {
  return product.source_url || product.url || evidence?.source_url || null;
}

function evidenceIsVerified(evidence?: EvidenceRow) {
  const metadata = evidence?.metadata || {};
  return hasVerifiedCatalogEvidence({
    evidenceVerified: true,
    evidenceType: metadata.evidence_type
      ? String(metadata.evidence_type)
      : undefined,
    evidenceVerification: metadata.verification
      ? String(metadata.verification)
      : undefined,
  });
}

async function fetchCandidates(
  database: SupabaseClient,
  materialName: string,
) {
  const rowsById = new Map<string, CatalogProduct>();
  for (const tokens of buildCatalogSearchTokenGroups(materialName)) {
    const { data, error } = await database
      .from("pb_products")
      .select(`
        id, commercial_name, sku, sale_unit, unit_price, units_per_package,
        url, source_url, checked_at,
        pb_providers!inner(id, name, company_id)
      `)
      .eq("sector", "construccion")
      .eq("is_active", true)
      .eq("is_available", true)
      .is("pb_providers.company_id", null)
      .gt("unit_price", 0)
      .textSearch("commercial_name", tokens.join(" "), {
        config: "spanish",
        type: "websearch",
      })
      .limit(150);

    if (error) throw new Error(`${materialName}: ${error.message}`);
    for (const row of data || []) {
      const product = row as unknown as CatalogProduct;
      rowsById.set(product.id, product);
    }
  }
  return Array.from(rowsById.values());
}

async function fetchEvidence(
  database: SupabaseClient,
  productIds: string[],
) {
  const byProduct = new Map<string, EvidenceRow>();
  for (let start = 0; start < productIds.length; start += 100) {
    const ids = productIds.slice(start, start + 100);
    const { data, error } = await database
      .from("pb_price_observations")
      .select("product_id, source_url, metadata, observed_at")
      .in("product_id", ids)
      .order("observed_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(`Evidencias: ${error.message}`);
    for (const row of data || []) {
      const evidence = row as EvidenceRow;
      if (!byProduct.has(evidence.product_id)) {
        byProduct.set(evidence.product_id, evidence);
      }
    }
  }
  return byProduct;
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  }

  const database = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const queue = [];
  const productSpecs = MATERIAL_SPECS.filter(
    (spec) => (spec.procurementKind || "product") === "product",
  );

  for (const material of productSpecs) {
    const products = await fetchCandidates(database, material.name);
    const evidenceByProduct = await fetchEvidence(
      database,
      products.map((product) => product.id),
    );
    const candidates: AuditedCandidate[] = products.map((product) => {
      const evidence = evidenceByProduct.get(product.id);
      const sourceUrl = canonicalSourceUrl(product, evidence);
      const match = evaluateCommercialProductMatch({
        requestedName: material.name,
        candidateName: product.commercial_name,
        requestedUnit: material.unit,
        candidateUnit: product.sale_unit,
        unitsPerPackage: product.units_per_package,
        referenceUnitPrice: material.unit_price,
        candidateUnitPrice: product.unit_price,
      });
      const traceable = isProductSpecificSourceUrl(sourceUrl)
        || evidenceIsVerified(evidence);
      return {
        product_id: product.id,
        product_name: product.commercial_name,
        provider: providerFromProduct(product)?.name || "Proveedor sin identificar",
        sku: product.sku,
        unit: product.sale_unit,
        units_per_package: product.units_per_package,
        price: Number(product.unit_price),
        source_url: sourceUrl,
        checked_at: product.checked_at || evidence?.observed_at || null,
        semantic_score: match.score,
        exact_semantics: match.isExact,
        traceable,
        issues: match.reasons,
      };
    });

    const verified = candidates
      .filter((candidate) => candidate.exact_semantics && candidate.traceable)
      .sort((left, right) => right.semantic_score - left.semantic_score || left.price - right.price);
    const review = candidates
      .filter((candidate) => !verified.some((exact) => exact.product_id === candidate.product_id))
      .sort((left, right) =>
        Number(right.exact_semantics) - Number(left.exact_semantics)
        || Number(right.traceable) - Number(left.traceable)
        || right.semantic_score - left.semantic_score
      )
      .slice(0, 8);

    queue.push({
      material_id: material.id,
      material_name: material.name,
      specification: material.specification,
      unit: material.unit,
      preferred_provider: material.provider_id,
      status: verified.length > 0
        ? "verified"
        : review.length > 0
          ? "needs_review"
          : "missing",
      verified_candidates: verified,
      review_candidates: review,
      candidates_examined: candidates.length,
    });

    process.stderr.write(
      `${queue.length}/${productSpecs.length} ${material.name}: `
      + `${verified.length > 0 ? "verificado" : review.length > 0 ? "revisar" : "ausente"}\n`,
    );
  }

  const summary = {
    generated_at: new Date().toISOString(),
    products: queue.length,
    verified: queue.filter((item) => item.status === "verified").length,
    needs_review: queue.filter((item) => item.status === "needs_review").length,
    missing: queue.filter((item) => item.status === "missing").length,
  };
  const report = { summary, queue };
  const output = getOption("output");
  if (output) {
    await writeFile(path.resolve(output), `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(report, null, output ? 0 : 2)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
