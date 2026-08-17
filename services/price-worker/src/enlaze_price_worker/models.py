from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date


@dataclass(frozen=True)
class CatalogEvidence:
    source_url: str
    sha256: str
    published_at: date


@dataclass(frozen=True)
class PriceProduct:
    name: str
    price: float
    unit: str
    category: str
    subcategory: str
    brand: str
    sku: str
    description: str
    product_url: str
    raw_price: str
    currency: str
    seller: str
    price_basis: str
    price_includes_vat: bool
    vat_rate: int
    price_scope: str
    observed_at: str
    evidence_type: str
    manufacturer_reference: str
    catalog_sha256: str
    catalog_published_at: str

    def as_payload(self) -> dict[str, object]:
        return asdict(self)
