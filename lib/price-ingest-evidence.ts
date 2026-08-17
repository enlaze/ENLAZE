export interface ReliablePriceEvidenceProduct {
  price: number;
  sku?: string;
  product_url?: string;
  raw_price?: string;
  currency?: string;
  seller?: string;
  price_includes_vat?: boolean;
  vat_rate?: number;
  evidence_type?: string;
  manufacturer_reference?: string;
  catalog_sha256?: string;
  catalog_published_at?: string;
}

type ProductPageSource = {
  evidenceMode: "product_page";
  origin: string;
  skuPattern: RegExp;
  website: string;
};

type OfficialCatalogSource = {
  evidenceMode: "official_catalog";
  catalogUrl: string;
  skuPattern: RegExp;
  website: string;
};

type VerifiedProviderSource = ProductPageSource | OfficialCatalogSource;

const ROCA_BC3_URL =
  "https://www.acae.es/catalogos/roca/fiebdc-roca.zip";

const VERIFIED_PROVIDER_SOURCES: Record<string, VerifiedProviderSource> = {
  manomano: {
    evidenceMode: "product_page",
    origin: "https://www.manomano.es",
    skuPattern: /^MM-\d+$/,
    website: "https://www.manomano.es",
  },
  "leroy merlin": {
    evidenceMode: "product_page",
    origin: "https://www.leroymerlin.es",
    skuPattern: /^LM-\d+$/,
    website: "https://www.leroymerlin.es",
  },
  obramat: {
    evidenceMode: "product_page",
    origin: "https://www.obramat.es",
    skuPattern: /^OB-\d+$/,
    website: "https://www.obramat.es",
  },
  roca: {
    evidenceMode: "official_catalog",
    catalogUrl: ROCA_BC3_URL,
    skuPattern: /^ROCA-A[A-Z0-9.]+$/,
    website: "https://www.roca.es",
  },
};

function parseSpanishPriceLabel(value: unknown) {
  const label = String(value || "").replace(/\u00a0/g, " ").trim();
  if (
    !/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?\s*€$/.test(label)
  ) {
    return Number.NaN;
  }

  const numericValue = label.replace(/\s*€$/, "");
  if (numericValue.includes(",")) {
    return Number.parseFloat(
      numericValue.replace(/\./g, "").replace(",", ".")
    );
  }
  if (/^\d{1,3}(?:\.\d{3})+$/.test(numericValue)) {
    return Number.parseFloat(numericValue.replace(/\./g, ""));
  }
  return Number.parseFloat(numericValue);
}

function normalizeProviderName(value: string) {
  return value.trim().toLocaleLowerCase("es");
}

export function getVerifiedProviderSource(providerName: string) {
  return VERIFIED_PROVIDER_SOURCES[normalizeProviderName(providerName)];
}

export function getEvidenceVerificationLabel(providerName: string) {
  return getVerifiedProviderSource(providerName)?.evidenceMode ===
    "official_catalog"
    ? "official_catalog_sku_raw_price_sha256"
    : "official_sku_url_raw_price";
}

export function hasReliableProviderEvidence(
  providerName: string,
  product: ReliablePriceEvidenceProduct
) {
  const source = getVerifiedProviderSource(providerName);
  if (!source) return false;

  const evidencePrice = parseSpanishPriceLabel(product.raw_price);
  const hasMatchingPrice =
    Number.isFinite(evidencePrice) &&
    Number.isFinite(product.price) &&
    Math.abs(evidencePrice - product.price) < 0.005;

  if (
    typeof product.sku !== "string" ||
    !source.skuPattern.test(product.sku) ||
    !hasMatchingPrice ||
    (product.currency && product.currency !== "EUR")
  ) {
    return false;
  }

  let evidenceUrl: URL;
  try {
    evidenceUrl = new URL(product.product_url || "");
  } catch {
    return false;
  }

  if (source.evidenceMode === "product_page") {
    return evidenceUrl.origin === source.origin;
  }

  const expectedReference = product.sku.replace(/^ROCA-/, "");
  const publishedAt = Date.parse(product.catalog_published_at || "");

  return (
    evidenceUrl.href === source.catalogUrl &&
    product.evidence_type === "official_bc3_catalog" &&
    product.seller?.toLocaleLowerCase("es") === "roca" &&
    product.price_includes_vat === false &&
    product.vat_rate === 21 &&
    product.manufacturer_reference === expectedReference &&
    /^[a-f0-9]{64}$/i.test(product.catalog_sha256 || "") &&
    Number.isFinite(publishedAt)
  );
}

export const VERIFIED_ROCA_BC3_URL = ROCA_BC3_URL;
