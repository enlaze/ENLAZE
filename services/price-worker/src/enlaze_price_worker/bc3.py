from __future__ import annotations

import hashlib
import re
import unicodedata
import zipfile
from datetime import date, datetime, timezone
from pathlib import Path

from .models import CatalogEvidence, PriceProduct

ROCA_CATALOG_URL = "https://www.acae.es/catalogos/roca/fiebdc-roca.zip"
MAX_BC3_BYTES = 50 * 1024 * 1024


def _decode_bc3(data: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError("No se pudo decodificar el catálogo BC3")


def _read_catalog_bytes(path: Path) -> bytes:
    if not path.is_file():
        raise ValueError(f"No existe el catálogo: {path}")

    if not zipfile.is_zipfile(path):
        data = path.read_bytes()
        if len(data) > MAX_BC3_BYTES:
            raise ValueError("El BC3 supera el límite de tamaño permitido")
        return data

    with zipfile.ZipFile(path) as archive:
        members = [
            member
            for member in archive.infolist()
            if not member.is_dir() and member.filename.lower().endswith(".bc3")
        ]
        if len(members) != 1:
            raise ValueError("El ZIP oficial debe contener exactamente un archivo BC3")
        member = members[0]
        if member.file_size > MAX_BC3_BYTES:
            raise ValueError("El BC3 comprimido supera el límite de tamaño permitido")
        with archive.open(member) as stream:
            data = stream.read(MAX_BC3_BYTES + 1)
        if len(data) > MAX_BC3_BYTES:
            raise ValueError("El BC3 extraído supera el límite de tamaño permitido")
        return data


def _logical_records(text: str) -> list[str]:
    records: list[str] = []
    current: list[str] = []
    for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if line.startswith("~"):
            if current:
                records.append("\n".join(current))
            current = [line]
        elif current:
            current.append(line)
    if current:
        records.append("\n".join(current))
    return records


def _parse_bc3_date(value: str) -> date:
    digits = re.sub(r"\D", "", value)
    formats = {6: "%d%m%y", 8: "%d%m%Y"}
    date_format = formats.get(len(digits))
    if not date_format:
        raise ValueError(f"Fecha BC3 no reconocida: {value!r}")
    return datetime.strptime(digits, date_format).date()


def _catalog_date(records: list[str]) -> date:
    for record in records:
        if not record.startswith("~V|"):
            continue
        fields = record.split("|")
        if len(fields) < 3:
            continue
        version_and_date = fields[2].split("\\")
        if len(version_and_date) > 1:
            return _parse_bc3_date(version_and_date[-1])
    raise ValueError("El catálogo no incluye una fecha FIEBDC válida")


def _normalize_for_category(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value.casefold())
    return "".join(character for character in normalized if not unicodedata.combining(character))


def _classify(name: str) -> tuple[str, str]:
    value = _normalize_for_category(name)
    rules = (
        (("grifer", "mezclador", "monomando"), ("fontaneria", "griferia")),
        (("ducha", "rociador", "teleducha"), ("fontaneria", "duchas")),
        (("banera",), ("sanitarios", "baneras")),
        (("inodoro", "wc ", "taza "), ("sanitarios", "inodoros")),
        (("cisterna",), ("sanitarios", "cisternas")),
        (("urinario",), ("sanitarios", "urinarios")),
        (("bide",), ("sanitarios", "bides")),
        (("lavabo",), ("sanitarios", "lavabos")),
        (("mueble", "columna ", "armario"), ("mobiliario", "muebles_de_bano")),
        (("espejo",), ("mobiliario", "espejos")),
        (
            ("asiento", "tapa ", "toallero", "portarrollos", "jabonera"),
            ("accesorios_bano", "accesorios"),
        ),
    )
    for keywords, category in rules:
        if any(keyword in value for keyword in keywords):
            return category
    return "sanitarios", "catalogo_roca"


def _format_spanish_price(price: float) -> str:
    return f"{price:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".") + " €"


def _reference(code: str) -> str:
    # El código FIEBDC es la clave estable. Algunos textos del catálogo 2026
    # repiten por error la referencia de otro acabado, aunque su código sí cambia.
    if not code.startswith("PROCA") or len(code) <= len("PROCA"):
        raise ValueError(f"Código de producto Roca no reconocido: {code}")
    return f"A{code[len('PROCA'):]}".upper()


def parse_roca_catalog(path: Path, source_url: str = ROCA_CATALOG_URL) -> list[PriceProduct]:
    raw_catalog = _read_catalog_bytes(path)
    catalog_sha256 = hashlib.sha256(raw_catalog).hexdigest()
    records = _logical_records(_decode_bc3(raw_catalog))
    published_at = _catalog_date(records)
    evidence = CatalogEvidence(source_url, catalog_sha256, published_at)

    descriptions: dict[str, str] = {}
    for record in records:
        if not record.startswith("~T|"):
            continue
        fields = record.split("|", 2)
        if len(fields) == 3:
            descriptions[fields[1].split("\\", 1)[0]] = fields[2].rstrip("|").strip()

    observed_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    products: list[PriceProduct] = []
    seen_skus: set[str] = set()

    for record in records:
        if not record.startswith("~C|"):
            continue
        fields = record.split("|")
        if len(fields) < 8:
            continue

        raw_code, unit, summary, raw_price, concept_type = (
            fields[1],
            fields[2],
            fields[3].strip(),
            fields[4].strip(),
            fields[6].strip(),
        )
        code = raw_code.split("\\", 1)[0]
        if not code.startswith("PROCA") or concept_type != "3":
            continue
        try:
            price = float(raw_price.replace(",", "."))
        except ValueError:
            continue
        if price <= 0:
            continue

        manufacturer_reference = _reference(code)
        sku = f"ROCA-{manufacturer_reference}"
        if sku in seen_skus:
            continue
        seen_skus.add(sku)
        category, subcategory = _classify(summary)
        description = descriptions.get(code, "")

        products.append(
            PriceProduct(
                name=summary,
                price=price,
                unit=unit or "u",
                category=category,
                subcategory=subcategory,
                brand="Roca",
                sku=sku,
                description=description,
                product_url=evidence.source_url,
                raw_price=_format_spanish_price(price),
                currency="EUR",
                seller="Roca",
                price_basis=unit or "u",
                price_includes_vat=False,
                vat_rate=21,
                price_scope="PVPR profesional España sin IVA (BC3/FIEBDC)",
                observed_at=observed_at,
                evidence_type="official_bc3_catalog",
                manufacturer_reference=manufacturer_reference,
                catalog_sha256=evidence.sha256,
                catalog_published_at=evidence.published_at.isoformat(),
            )
        )

    if not products:
        raise ValueError("El catálogo no contiene productos Roca con precio válido")
    return products
