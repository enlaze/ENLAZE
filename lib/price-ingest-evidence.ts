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
  catalog_url?: string;
  catalog_store?: string;
  catalog_page?: number;
  authorization_reference?: string;
}

type ProductPageSource = {
  evidenceMode: "product_page";
  origin: string;
  skuPattern: RegExp;
  website: string;
  pathPattern?: RegExp;
  evidenceType?: string;
  seller?: string;
  priceIncludesVat?: boolean;
  vatRate?: number;
  skuPrefix?: string;
  authorizationReferenceRequired?: boolean;
};

type AuthorizedTariffSource = {
  evidenceMode: "authorized_tariff";
  origin: string;
  skuPattern: RegExp;
  skuPrefix: string;
  website: string;
  seller: string;
  evidenceType: string;
  tariffPathPattern: RegExp;
};

type OfficialCatalogSource = {
  evidenceMode: "official_catalog";
  catalogUrl: string;
  skuPattern: RegExp;
  website: string;
};

type VerifiedProviderSource =
  | ProductPageSource
  | OfficialCatalogSource
  | AuthorizedTariffSource;

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
    skuPrefix: "LM-",
    evidenceType: "official_product_listing",
    seller: "Leroy Merlin",
    priceIncludesVat: true,
    vatRate: 21,
    authorizationReferenceRequired: true,
    website: "https://www.leroymerlin.es",
  },
  obramat: {
    evidenceMode: "product_page",
    origin: "https://www.obramat.es",
    skuPattern: /^OB-\d+$/,
    website: "https://www.obramat.es",
  },
  ikea: {
    evidenceMode: "product_page",
    origin: "https://www.ikea.com",
    pathPattern: /^\/es\/es\/p\/.+\/$/,
    skuPattern: /^IKEA-\d{3}\.\d{3}\.\d{2}$/,
    skuPrefix: "IKEA-",
    evidenceType: "official_product_page",
    seller: "IKEA",
    priceIncludesVat: true,
    vatRate: 21,
    website: "https://www.ikea.com/es/es/",
  },
  roca: {
    evidenceMode: "official_catalog",
    catalogUrl: ROCA_BC3_URL,
    skuPattern: /^ROCA-A[A-Z0-9.]+$/,
    website: "https://www.roca.es",
  },
  "grupo puma": {
    evidenceMode: "authorized_tariff",
    origin: "https://www.grupopuma.com",
    skuPattern: /^PUMA-[A-Z0-9][A-Z0-9._-]*$/i,
    skuPrefix: "PUMA-",
    seller: "Grupo Puma",
    evidenceType: "authorized_price_tariff",
    tariffPathPattern: /^\/uploads\/.+/,
    website: "https://www.grupopuma.com/es-ES",
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

export function getEvidenceVerificationLabel(
  providerName: string,
  product?: ReliablePriceEvidenceProduct
) {
  if (
    normalizeProviderName(providerName) === "obramat" &&
    product?.evidence_type === "official_pdf_catalog"
  ) {
    return "official_catalog_sku_source_url_raw_price_sha256";
  }
  if (normalizeProviderName(providerName) === "leroy merlin") {
    return "authorized_direct_seller_sku_url_raw_price";
  }
  if (normalizeProviderName(providerName) === "grupo puma") {
    return "authorized_tariff_sku_raw_price_sha256";
  }
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
    if (
      normalizeProviderName(providerName) === "obramat" &&
      product.evidence_type === "official_pdf_catalog"
    ) {
      const expectedReference = product.sku.replace(/^OB-/, "");
      const publishedAt = Date.parse(product.catalog_published_at || "");
      let catalogUrl: URL;
      try {
        catalogUrl = new URL(product.catalog_url || "");
      } catch {
        return false;
      }
      const catalogPageMatch = evidenceUrl.pathname.match(
        /^\/catalogo-2026\/catalogo-2026-[a-z0-9-]+\/page\/(\d+)\/?$/i
      );
      const hasOfficialProductPage =
        evidenceUrl.origin === source.origin &&
        evidenceUrl.pathname.endsWith(`-${expectedReference}.html`);
      const hasOfficialCatalogPage =
        evidenceUrl.origin === "https://view.publitas.com" &&
        Boolean(catalogPageMatch) &&
        Number(catalogPageMatch?.[1]) === Number(product.catalog_page);

      return (
        (hasOfficialProductPage || hasOfficialCatalogPage) &&
        catalogUrl.origin === "https://view.publitas.com" &&
        /^\/105196\/\d+\/pdfs\/[a-f0-9-]+\.pdf$/i.test(
          catalogUrl.pathname
        ) &&
        product.seller?.toLocaleLowerCase("es") === "obramat" &&
        product.price_includes_vat === true &&
        product.vat_rate === 21 &&
        product.manufacturer_reference === expectedReference &&
        /^[a-f0-9]{64}$/i.test(product.catalog_sha256 || "") &&
        Number.isFinite(publishedAt) &&
        Boolean(product.catalog_store?.trim()) &&
        Number.isInteger(product.catalog_page) &&
        Number(product.catalog_page) > 0
      );
    }

    const expectedReference = source.skuPrefix
      ? product.sku.slice(source.skuPrefix.length)
      : null;
    const obramatReference =
      normalizeProviderName(providerName) === "obramat"
        ? product.sku.replace(/^OB-/, "")
        : null;
    return (
      evidenceUrl.origin === source.origin &&
      (!obramatReference ||
        evidenceUrl.pathname.endsWith(`-${obramatReference}.html`)) &&
      (!source.pathPattern || source.pathPattern.test(evidenceUrl.pathname)) &&
      (!source.evidenceType || product.evidence_type === source.evidenceType) &&
      (!source.seller ||
        product.seller?.toLocaleLowerCase("es") ===
          source.seller.toLocaleLowerCase("es")) &&
      (source.priceIncludesVat === undefined ||
        product.price_includes_vat === source.priceIncludesVat) &&
      (source.vatRate === undefined || product.vat_rate === source.vatRate) &&
      (!expectedReference || product.manufacturer_reference === expectedReference) &&
      (!source.authorizationReferenceRequired ||
        Boolean(product.authorization_reference?.trim()))
    );
  }

  if (source.evidenceMode === "authorized_tariff") {
    const expectedReference = product.sku.slice(source.skuPrefix.length);
    const publishedAt = Date.parse(product.catalog_published_at || "");
    let catalogUrl: URL;
    try {
      catalogUrl = new URL(product.catalog_url || "");
    } catch {
      return false;
    }

    return (
      evidenceUrl.href === catalogUrl.href &&
      catalogUrl.origin === source.origin &&
      source.tariffPathPattern.test(catalogUrl.pathname) &&
      product.evidence_type === source.evidenceType &&
      product.seller?.toLocaleLowerCase("es") ===
        source.seller.toLocaleLowerCase("es") &&
      typeof product.price_includes_vat === "boolean" &&
      product.vat_rate === 21 &&
      product.manufacturer_reference === expectedReference &&
      /^[a-f0-9]{64}$/i.test(product.catalog_sha256 || "") &&
      Number.isFinite(publishedAt) &&
      Boolean(product.authorization_reference?.trim())
    );
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
