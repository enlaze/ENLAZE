from __future__ import annotations

import json
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections.abc import Iterable, Sequence
from datetime import datetime, timezone

from .models import PriceProduct
from .source import assert_robots_allowed, load_robots_policy, tls_context, user_agent

IKEA_ORIGIN = "https://www.ikea.com"
IKEA_WEBSITE = "https://www.ikea.com/es/es/"
IKEA_SITEMAPS = tuple(
    f"https://www.ikea.com/sitemaps/prod-es-ES_{index}.xml" for index in range(1, 7)
)
MAX_SITEMAP_BYTES = 55 * 1024 * 1024

# Productos útiles para presupuestos de reforma. El catálogo completo supera
# las 28.000 URLs, por lo que el rastreo predeterminado evita mobiliario ajeno.
RENOVATION_URL_PATTERN = re.compile(
    r"(?:metod|enhet|knoxhult|havback|angsjon|taennforsen|tannforsen|"
    r"lavabo|grifo|fregadero|encimera|ducha|inodoro|mueble-[^/]*bano|"
    r"lampara|foco|aplique|bombilla|iluminacion|suelo|revestimiento|"
    r"panel-[^/]*pared|puerta|tirador)",
    re.IGNORECASE,
)
IKEA_PRODUCT_PATH = re.compile(r"^/es/es/p/.+/$")
IKEA_REFERENCE = re.compile(r"^\d{3}\.\d{3}\.\d{2}$")


def _read_url(url: str, *, accept: str, max_bytes: int) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": user_agent(),
            "Accept": accept,
            "Accept-Language": "es-ES,es;q=0.9",
        },
    )
    with urllib.request.urlopen(request, timeout=60, context=tls_context()) as response:
        body = response.read(max_bytes + 1)
    if len(body) > max_bytes:
        raise RuntimeError(f"La respuesta oficial supera el límite permitido: {url}")
    return body


def list_ikea_product_urls(
    *,
    include_all: bool = False,
    limit: int | None = None,
) -> list[str]:
    urls: list[str] = []
    seen: set[str] = set()
    robots_policy = load_robots_policy(IKEA_SITEMAPS[0])
    for sitemap_url in IKEA_SITEMAPS:
        assert_robots_allowed(sitemap_url, robots_policy)
        document = _read_url(
            sitemap_url,
            accept="application/xml,text/xml;q=0.9,*/*;q=0.1",
            max_bytes=MAX_SITEMAP_BYTES,
        )
        try:
            root = ET.fromstring(document)
        except ET.ParseError as error:
            raise RuntimeError(f"IKEA devolvió un sitemap inválido: {sitemap_url}") from error
        for location in root.findall("{http://www.sitemaps.org/schemas/sitemap/0.9}url"):
            url_node = location.find("{http://www.sitemaps.org/schemas/sitemap/0.9}loc")
            url = (url_node.text if url_node is not None else "") or ""
            url = url.strip()
            if not _is_ikea_product_url(url):
                continue
            if not include_all and not RENOVATION_URL_PATTERN.search(url):
                continue
            if url not in seen:
                seen.add(url)
                urls.append(url)
                if limit is not None and len(urls) >= limit:
                    return urls
    return urls


def _is_ikea_product_url(url: str) -> bool:
    try:
        parsed = urllib.parse.urlparse(url)
    except ValueError:
        return False
    return (
        f"{parsed.scheme}://{parsed.netloc}" == IKEA_ORIGIN
        and bool(IKEA_PRODUCT_PATH.fullmatch(parsed.path))
        and not parsed.query
        and not parsed.fragment
    )


def _walk_json(value: object) -> Iterable[dict[str, object]]:
    if isinstance(value, dict):
        if value.get("@type") == "Product":
            yield value
        for child in value.values():
            yield from _walk_json(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk_json(child)


def _first_offer(value: object) -> dict[str, object] | None:
    if isinstance(value, dict):
        return value
    if isinstance(value, list):
        return next((offer for offer in value if isinstance(offer, dict)), None)
    return None


def _brand_name(value: object) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        return str(value.get("name") or "").strip()
    return ""


def _seller_name(value: object) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        return str(value.get("name") or "").strip()
    return ""


def _spanish_price(value: float) -> str:
    whole, decimals = f"{value:.2f}".split(".")
    grouped = f"{int(whole):,}".replace(",", ".")
    return f"{grouped},{decimals} €"


def _category(category_label: str, name: str) -> tuple[str, str]:
    searchable = f"{category_label} {name}".casefold()
    if any(term in searchable for term in ("lámpara", "lampara", "foco", "bombilla", "luz")):
        category = "iluminacion"
    elif any(term in searchable for term in ("lavabo", "ducha", "baño", "bano", "grifo")):
        category = "banos"
    elif any(
        term in searchable
        for term in ("cocina", "fregadero", "encimera", "metod", "enhet", "knoxhult")
    ):
        category = "cocinas"
    elif any(term in searchable for term in ("puerta", "tirador", "panel")):
        category = "carpinteria"
    elif any(term in searchable for term in ("suelo", "revestimiento")):
        category = "revestimientos"
    else:
        category = "equipamiento"
    return category, category_label.strip()[:120] or "general"


def parse_ikea_json_ld(
    documents: Sequence[str | dict[str, object] | list[object]],
    *,
    requested_url: str,
    observed_at: str | None = None,
) -> PriceProduct:
    if not _is_ikea_product_url(requested_url):
        raise ValueError("La URL no es una ficha de producto de IKEA España")

    decoded: list[object] = []
    for document in documents:
        if isinstance(document, str):
            try:
                decoded.append(json.loads(document))
            except json.JSONDecodeError:
                continue
        else:
            decoded.append(document)

    product = next((item for document in decoded for item in _walk_json(document)), None)
    if not product:
        raise ValueError("La ficha IKEA no contiene evidencia Product JSON-LD")

    offer = _first_offer(product.get("offers"))
    if not offer:
        raise ValueError("La ficha IKEA no publica una oferta oficial")

    name = re.sub(r"\s+", " ", str(product.get("name") or "")).strip()
    reference = str(product.get("sku") or product.get("mpn") or "").strip()
    seller = _seller_name(offer.get("seller"))
    currency = str(offer.get("priceCurrency") or "").strip().upper()
    evidence_url = str(offer.get("url") or product.get("url") or requested_url).strip()
    try:
        price = round(float(str(offer.get("price") or "")), 2)
    except ValueError as error:
        raise ValueError("La ficha IKEA no contiene un precio numérico") from error

    if not name or not IKEA_REFERENCE.fullmatch(reference):
        raise ValueError("La ficha IKEA no contiene nombre y referencia válidos")
    if seller.casefold() != "ikea" or currency != "EUR" or price <= 0:
        raise ValueError("La oferta IKEA no identifica vendedor, moneda y precio válidos")
    if not _is_ikea_product_url(evidence_url):
        raise ValueError("La evidencia de precio no apunta a una ficha IKEA España")
    if evidence_url.rstrip("/") != requested_url.rstrip("/"):
        raise ValueError("La evidencia IKEA no coincide con la URL solicitada")

    category_label = str(product.get("category") or "").strip()
    category, subcategory = _category(category_label, name)
    description = re.sub(r"\s+", " ", str(product.get("description") or "")).strip()
    display_name = f"{name} ({reference})"

    return PriceProduct(
        name=display_name[:240],
        price=price,
        unit="ud",
        category=category,
        subcategory=subcategory,
        brand=_brand_name(product.get("brand")) or "IKEA",
        sku=f"IKEA-{reference}",
        description=description[:1000],
        product_url=evidence_url,
        raw_price=_spanish_price(price),
        currency="EUR",
        seller="IKEA",
        price_basis="ud",
        price_includes_vat=True,
        vat_rate=21,
        price_scope="PVP público IKEA España con IVA",
        observed_at=observed_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        evidence_type="official_product_page",
        manufacturer_reference=reference,
        catalog_sha256="",
        catalog_published_at="",
    )


def fetch_ikea_product(url: str, *, check_robots: bool = True) -> PriceProduct:
    if check_robots:
        assert_robots_allowed(url)
    try:
        from scrapling.fetchers import Fetcher
    except ImportError as error:
        raise RuntimeError("Scrapling no está instalado en el worker") from error

    page = Fetcher.get(
        url,
        headers={"User-Agent": user_agent(), "Accept-Language": "es-ES,es;q=0.9"},
        stealthy_headers=False,
        follow_redirects="safe",
        timeout=45,
    )
    if page.status != 200:
        raise RuntimeError(f"IKEA devolvió HTTP {page.status}")
    documents = page.xpath('//script[@type="application/ld+json"]/text()').getall()
    return parse_ikea_json_ld(documents, requested_url=url)


def scrape_ikea_products(
    urls: Sequence[str],
    *,
    delay_seconds: float = 1.0,
) -> tuple[list[PriceProduct], list[dict[str, str]]]:
    products: list[PriceProduct] = []
    errors: list[dict[str, str]] = []
    robots_policy = load_robots_policy(urls[0]) if urls else None
    for index, url in enumerate(urls):
        try:
            if robots_policy is not None:
                assert_robots_allowed(url, robots_policy)
            products.append(fetch_ikea_product(url, check_robots=False))
        except (OSError, RuntimeError, ValueError, PermissionError) as error:
            errors.append({"url": url, "error": str(error)})
        if delay_seconds > 0 and index + 1 < len(urls):
            time.sleep(delay_seconds)
    return products, errors
