#!/usr/bin/env python3

"""Extract verified OBRAMAT prices from an official store catalogue PDF."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pdfplumber


PRICE_RE = re.compile(r"^(?P<value>\d{1,5}(?:[.,]\d{1,2})?)\s*€$")
REFERENCE_RE = re.compile(r"^\d{6,8}$")
UNIT_LABELS = {
    "UNIDAD": ("ud", "Unidad"),
    "UD": ("ud", "Unidad"),
    "UDS": ("ud", "Unidad"),
    "PIEZA": ("ud", "Pieza"),
    "PIEZAS": ("ud", "Pieza"),
    "CAJA": ("caja", "Caja"),
    "BOTE": ("ud", "Bote"),
    "PAQUETE": ("ud", "Paquete"),
    "PACK": ("ud", "Pack"),
    "ROLLO": ("ud", "Rollo"),
    "SACO": ("ud", "Saco"),
    "PAR": ("par", "Par"),
    "JUEGO": ("ud", "Juego"),
    "METRO": ("ml", "Metro"),
    "ML": ("ml", "Metro"),
    "M2": ("m2", "m²"),
    "M²": ("m2", "m²"),
    "LITRO": ("l", "Litro"),
    "KILO": ("kg", "Kg"),
}


def normalize_token(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).strip().upper()
    return value.replace("²", "2").replace(".", "")


def parse_price(value: str) -> tuple[float, str] | None:
    match = PRICE_RE.match(value.replace(" ", ""))
    if not match:
        return None
    numeric = match.group("value").replace(".", "").replace(",", ".")
    price = float(numeric)
    if not 0 < price < 100_000:
        return None
    raw = f"{price:.2f}".replace(".", ",").rstrip("0").rstrip(",") + " €"
    return price, raw


def extract_price_words(words: list[dict[str, Any]]) -> list[dict[str, Any]]:
    prices = [
        {**word, "synthetic_price": False}
        for word in words
        if parse_price(str(word["text"]).strip())
    ]
    numeric_words = [
        word
        for word in words
        if parse_price(f"{str(word['text']).strip()}€")
        and not str(word["text"]).strip().endswith("€")
    ]
    for currency_word in words:
        if str(currency_word["text"]).strip() not in {"€", "¤"}:
            continue
        currency_center_y = (
            float(currency_word["top"]) + float(currency_word["bottom"])
        ) / 2
        candidates = [
            word
            for word in numeric_words
            if abs(
                (float(word["top"]) + float(word["bottom"])) / 2
                - currency_center_y
            )
            <= 25
            and abs(float(currency_word["x0"]) - float(word["x1"])) <= 10
        ]
        if not candidates:
            continue
        numeric_word = min(
            candidates,
            key=lambda word: abs(
                float(currency_word["x0"]) - float(word["x1"])
            ),
        )
        prices.append(
            {
                **numeric_word,
                "text": f"{str(numeric_word['text']).strip()}€",
                "x0": min(float(numeric_word["x0"]), float(currency_word["x0"])),
                "x1": max(float(numeric_word["x1"]), float(currency_word["x1"])),
                "top": min(float(numeric_word["top"]), float(currency_word["top"])),
                "bottom": max(
                    float(numeric_word["bottom"]), float(currency_word["bottom"])
                ),
                "height": max(
                    float(numeric_word["bottom"]), float(currency_word["bottom"])
                )
                - min(float(numeric_word["top"]), float(currency_word["top"])),
                "synthetic_price": True,
            }
        )
    return prices


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def page_heading(
    page: Any, words: list[dict[str, Any]] | None = None
) -> str:
    words = words or page.extract_words(use_text_flow=False, keep_blank_chars=False)
    top_words = [word for word in words if float(word["top"]) < 55]
    if not top_words:
        return "catálogo OBRAMAT"
    lines: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for word in top_words:
        lines[round(float(word["top"]) / 3) * 3].append(word)
    for _, line_words in sorted(lines.items()):
        text = " ".join(
            word["text"] for word in sorted(line_words, key=lambda item: item["x0"])
        ).strip()
        if len(text) >= 4 and not re.search(r"consulta disponibilidad", text, re.I):
            return text[:120]
    return "catálogo OBRAMAT"


def infer_product_name(
    words: list[dict[str, Any]],
    reference: str,
    evidence: dict[str, Any],
    heading: str,
) -> str:
    """Build a useful name from the nearest uppercase catalogue heading."""
    reference_top = float(evidence["reference_top"])
    reference_center_x = (
        float(evidence["reference_x0"]) + float(evidence["reference_x1"])
    ) / 2
    reference_height = float(evidence["reference_height"])
    reference_words = [
        word
        for word in words
        if REFERENCE_RE.fullmatch(str(word["text"]).strip())
        and abs(
            (float(word["top"]) + float(word["bottom"])) / 2
            - (reference_top + reference_height / 2)
        )
        <= max(4.5, reference_height)
    ]
    centers = sorted(
        (float(word["x0"]) + float(word["x1"])) / 2
        for word in reference_words
    )
    previous_centers = [center for center in centers if center < reference_center_x]
    next_centers = [center for center in centers if center > reference_center_x]
    left = (
        (max(previous_centers) + reference_center_x) / 2
        if previous_centers
        else 0
    )
    right = (
        (min(next_centers) + reference_center_x) / 2
        if next_centers
        else max(float(word["x1"]) for word in words)
    )

    excluded = {
        "REF",
        "REFERENCIA",
        "PRODUCTO",
        "DESCRIPCION",
        "UNIDAD",
        "UD",
        "CAJA",
        "M2",
        "M²",
        "CM",
        "MM",
        "PVP",
        "PRECIO",
        "IVA",
    }
    lines: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for word in words:
        center_x = (float(word["x0"]) + float(word["x1"])) / 2
        gap = reference_top - float(word["bottom"])
        if not 6 <= gap <= 110 or not left <= center_x <= right:
            continue
        lines[round(float(word["top"]) / 3) * 3].append(word)

    for _, line_words in sorted(lines.items(), reverse=True):
        tokens = [
            str(word["text"]).strip()
            for word in sorted(line_words, key=lambda item: item["x0"])
        ]
        tokens = [
            token
            for token in tokens
            if token
            and normalize_token(token) not in excluded
            and token not in {"€", "¤"}
            and not REFERENCE_RE.fullmatch(token)
            and not parse_price(token)
            and not parse_price(f"{token}€")
        ]
        text = " ".join(tokens).strip(" -·")
        if tokens and sum(len(token) == 1 and token.isalpha() for token in tokens) / len(
            tokens
        ) > 0.3:
            continue
        letters = [character for character in text if character.isalpha()]
        if len(letters) < 3:
            continue
        uppercase_ratio = sum(character.isupper() for character in letters) / len(letters)
        if uppercase_ratio >= 0.75:
            return re.sub(r"\s+", " ", text)[:140]
    return heading[:140]


def unit_for_price(
    words: list[dict[str, Any]], reference: dict[str, Any], price_word: dict[str, Any]
) -> tuple[str, str]:
    price_center = (float(price_word["x0"]) + float(price_word["x1"])) / 2
    reference_top = float(reference["top"])
    candidates: list[tuple[float, float, str, str]] = []
    for word in words:
        token = normalize_token(str(word["text"]))
        if token not in UNIT_LABELS:
            continue
        gap = reference_top - float(word["bottom"])
        if not 0 <= gap <= 45:
            continue
        word_center = (float(word["x0"]) + float(word["x1"])) / 2
        horizontal = abs(word_center - price_center)
        if horizontal > 35:
            continue
        unit, label = UNIT_LABELS[token]
        candidates.append((gap, horizontal, unit, label))
    if not candidates:
        return "ud", "Unidad"
    _, _, unit, label = min(candidates)
    return unit, label


def sale_column_rank(
    words: list[dict[str, Any]], price_word: dict[str, Any]
) -> tuple[int, str]:
    """Prefer catalogue columns that represent the product's checkout price."""
    price_center = (float(price_word["x0"]) + float(price_word["x1"])) / 2
    price_top = float(price_word["top"])
    header_tokens: list[str] = []
    for word in words:
        gap = price_top - float(word["bottom"])
        if not -2 <= gap <= 60:
            continue
        word_center = (float(word["x0"]) + float(word["x1"])) / 2
        if abs(word_center - price_center) > 38:
            continue
        header_tokens.append(normalize_token(str(word["text"])))

    header = " ".join(header_tokens)
    sale_markers = ("ALMACEN", "ENVASE", "UNIDAD", "CAJA", "PAQUETE", "PIEZA")
    derived_markers = ("CONTENIDO", "COSTE", "PRECIO/M2", "PRECIO/KG", "PRECIO/L")
    if any(marker in header for marker in sale_markers):
        return 2, header
    if any(marker in header for marker in derived_markers):
        return -1, header
    return 0, header


def find_price(
    words: list[dict[str, Any]],
    reference: str,
    price_words: list[dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    references = [word for word in words if str(word["text"]).strip() == reference]
    price_words = price_words or extract_price_words(words)
    same_row_candidates: list[dict[str, Any]] = []
    above_reference_candidates: list[dict[str, Any]] = []
    for reference_word in references:
        reference_center = (
            float(reference_word["top"]) + float(reference_word["bottom"])
        ) / 2
        reference_center_x = (
            float(reference_word["x0"]) + float(reference_word["x1"])
        ) / 2
        for word in price_words:
            parsed = parse_price(str(word["text"]).strip())
            if not parsed:
                continue
            word_center = (float(word["top"]) + float(word["bottom"])) / 2
            word_center_x = (float(word["x0"]) + float(word["x1"])) / 2
            vertical = abs(word_center - reference_center)
            horizontal = float(word["x0"]) - float(reference_word["x1"])
            is_same_row = vertical <= max(4.5, float(reference_word["height"]))
            is_price_above_reference = (
                word_center < reference_center
                and vertical <= 60
                and abs(word_center_x - reference_center_x) <= 80
            )
            if not is_same_row and not is_price_above_reference:
                continue
            # Some catalogue system tables place the official sale price several
            # columns to the right of the reference; a narrow distance limit
            # drops otherwise valid rows.
            if not -180 <= horizontal <= 420:
                continue
            unit, basis = unit_for_price(words, reference_word, word)
            sale_rank, column_header = sale_column_rank(words, word)
            price, raw = parsed
            candidate = (
                {
                    "price": price,
                    "raw_price": raw,
                    "unit": unit,
                    "price_basis": basis,
                    "distance": (
                        abs(horizontal) + vertical * 5
                        if is_same_row
                        else abs(word_center_x - reference_center_x) + vertical * 5
                    ),
                    "sale_rank": sale_rank,
                    "column_header": column_header,
                    "recognized_unit": unit != "ud" or basis == "Unidad",
                    "reference_x0": float(reference_word["x0"]),
                    "reference_x1": float(reference_word["x1"]),
                    "reference_top": float(reference_word["top"]),
                    "reference_height": float(reference_word["height"]),
                    "price_x0": float(word["x0"]),
                    "price_x1": float(word["x1"]),
                    "price_top": float(word["top"]),
                }
            )
            if is_same_row:
                same_row_candidates.append(candidate)
            else:
                above_reference_candidates.append(candidate)
    candidates = same_row_candidates or above_reference_candidates
    return (
        min(candidates, key=lambda item: (-item["sale_rank"], item["distance"]))
        if candidates
        else None
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--links", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--catalog-url", required=True)
    parser.add_argument("--publication-url", required=True)
    parser.add_argument("--store", required=True)
    parser.add_argument("--published-at", required=True)
    parser.add_argument("--max-products", type=int)
    parser.add_argument("--max-pages", type=int)
    parser.add_argument("--discover-all", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    pdf_path = Path(args.pdf).resolve()
    links_path = Path(args.links).resolve()
    output_path = Path(args.output).resolve()
    report_path = Path(args.report).resolve()
    link_data = json.loads(links_path.read_text(encoding="utf-8"))
    links = link_data.get("links", [])
    by_page: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for link in links:
        by_page[int(link["page"])].append(link)

    catalog_hash = sha256_file(pdf_path)
    observed_at = datetime.now(timezone.utc).isoformat()
    occurrences: list[dict[str, Any]] = []
    unmatched: list[dict[str, Any]] = []
    discovered_references: set[str] = set()
    publication_url = args.publication_url.rstrip("/")

    with pdfplumber.open(pdf_path) as document:
        page_numbers = (
            range(
                1,
                min(len(document.pages), args.max_pages or len(document.pages)) + 1,
            )
            if args.discover_all
            else [
                page_number
                for page_number in sorted(by_page)
                if not args.max_pages or page_number <= args.max_pages
            ]
        )
        for page_number in page_numbers:
            if not 1 <= page_number <= len(document.pages):
                unmatched.extend(by_page[page_number])
                continue
            page = document.pages[page_number - 1]
            words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
            price_words = extract_price_words(words)
            heading = page_heading(page, words)
            page_links = {
                str(link["reference"]): {
                    **link,
                    "source_kind": "official_product_page",
                }
                for link in by_page[page_number]
            }
            if args.discover_all:
                for word in words:
                    reference = str(word["text"]).strip()
                    if not REFERENCE_RE.fullmatch(reference):
                        continue
                    page_links.setdefault(
                        reference,
                        {
                            "page": page_number,
                            "reference": reference,
                            "name": "",
                            "product_url": f"{publication_url}/page/{page_number}",
                            "source_kind": "official_catalog_page",
                        },
                    )
                    discovered_references.add(reference)
            for link in page_links.values():
                evidence = find_price(
                    words, str(link["reference"]), price_words
                )
                if not evidence:
                    unmatched.append(link)
                    continue
                name = str(link.get("name") or "").strip() or infer_product_name(
                    words,
                    str(link["reference"]),
                    evidence,
                    heading,
                )
                occurrences.append(
                    {
                        **link,
                        **evidence,
                        "name": name,
                        "subcategory": heading,
                    }
                )
            if page_links or page_number % 25 == 0:
                print(
                    f"Página {page_number}: {len(page_links)} referencias, "
                    f"{sum(1 for row in occurrences if row['page'] == page_number)} precios"
                )

    by_reference: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for occurrence in occurrences:
        by_reference[str(occurrence["reference"])].append(occurrence)

    products: list[dict[str, Any]] = []
    conflicts: list[dict[str, Any]] = []
    selected_source_counts: Counter[str] = Counter()
    for reference, rows in by_reference.items():
        variants = Counter(
            (round(float(row["price"]), 2), str(row["unit"])) for row in rows
        )
        ranked_variants: list[
            tuple[tuple[int, float, int], tuple[float, str], dict[str, Any]]
        ] = []
        for variant, count in variants.items():
            variant_rows = [
                row
                for row in rows
                if (round(float(row["price"]), 2), str(row["unit"])) == variant
            ]
            best_row = min(
                variant_rows,
                key=lambda row: (
                    -int(row["sale_rank"]),
                    float(row["distance"]),
                    int(row["page"]),
                ),
            )
            ranked_variants.append(
                (
                    (
                        int(best_row["sale_rank"]),
                        -float(best_row["distance"]),
                        count,
                    ),
                    variant,
                    best_row,
                )
            )
        ranked_variants.sort(key=lambda item: item[0], reverse=True)
        _, selected_variant, selected = ranked_variants[0]
        if len(variants) > 1:
            conflicts.append(
                {
                    "reference": reference,
                    "selected": {
                        "price": selected_variant[0],
                        "unit": selected_variant[1],
                        "page": selected["page"],
                        "column_header": selected["column_header"],
                    },
                    "variants": [
                        {"price": price, "unit": unit, "count": variants[(price, unit)]}
                        for price, unit in variants
                    ],
                }
            )
            if len({price for price, _ in variants}) > 1:
                continue
        selected_source_counts[str(selected["source_kind"])] += 1
        products.append(
            {
                "name": f"{selected['name']} ({reference})",
                "price": selected["price"],
                "unit": selected["unit"],
                "category": "material",
                "subcategory": selected["subcategory"],
                "sku": f"OB-{reference}",
                "product_url": selected["product_url"],
                "raw_price": selected["raw_price"],
                "currency": "EUR",
                "seller": "OBRAMAT",
                "price_basis": selected["price_basis"],
                "price_includes_vat": True,
                "vat_rate": 21,
                "price_scope": (
                    f"Catálogo OBRAMAT 2026 {args.store}; IVA incluido; "
                    "consultar disponibilidad y posibles cambios"
                ),
                "observed_at": observed_at,
                "evidence_type": "official_pdf_catalog",
                "manufacturer_reference": reference,
                "catalog_sha256": catalog_hash,
                "catalog_published_at": args.published_at,
                "catalog_url": args.catalog_url,
                "catalog_store": args.store,
                "catalog_page": int(selected["page"]),
                "description": (
                    f"Precio del catálogo oficial OBRAMAT {args.store}, "
                    f"página {selected['page']}"
                ),
            }
        )

    products.sort(key=lambda product: product["sku"])
    if args.max_products:
        products = products[: args.max_products]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(products, ensure_ascii=False), encoding="utf-8")
    report = {
        "pdf": str(pdf_path),
        "catalog_sha256": catalog_hash,
        "links": len(links),
        "unique_link_references": len({link["reference"] for link in links}),
        "discovered_pdf_references": len(discovered_references),
        "matched_occurrences": len(occurrences),
        "unmatched_occurrences": len(unmatched),
        "conflicting_references": len(conflicts),
        "products": len(products),
        "units": Counter(product["unit"] for product in products),
        "selected_sources": selected_source_counts,
        "unmatched_sample": unmatched[:100],
        "conflicts_sample": conflicts[:100],
    }
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, default=dict))


if __name__ == "__main__":
    main()
