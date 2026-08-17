from __future__ import annotations

import json
import os
import ssl
import urllib.error
import urllib.request
from collections.abc import Iterable, Sequence

from .bc3 import ROCA_CATALOG_URL
from .models import PriceProduct


def _tls_context() -> ssl.SSLContext:
    try:
        import certifi
    except ImportError:
        return ssl.create_default_context()
    return ssl.create_default_context(cafile=certifi.where())


def _chunks(products: Sequence[PriceProduct], size: int) -> Iterable[Sequence[PriceProduct]]:
    for index in range(0, len(products), size):
        yield products[index : index + size]


def send_roca_products(
    products: Sequence[PriceProduct],
    *,
    api_url: str,
    api_key: str,
    batch_size: int,
) -> dict[str, int]:
    totals = {"batches": 0, "inserted": 0, "updated": 0, "errors": 0}
    for product_batch in _chunks(products, batch_size):
        body = json.dumps(
            {
                "provider_name": "Roca",
                "sector": "construccion",
                "source_url": ROCA_CATALOG_URL,
                "products": [product.as_payload() for product in product_batch],
            },
            ensure_ascii=False,
        ).encode("utf-8")
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": os.environ.get(
                "PRICE_WORKER_USER_AGENT", "ENLAZE-Public-Price-Monitor/1.0"
            ),
        }
        bypass_secret = os.environ.get("VERCEL_AUTOMATION_BYPASS_SECRET")
        if bypass_secret:
            headers["x-vercel-protection-bypass"] = bypass_secret

        request = urllib.request.Request(api_url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(
                request,
                timeout=120,
                context=_tls_context(),
            ) as response:
                result = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            response_text = error.read(2000).decode("utf-8", errors="replace")
            raise RuntimeError(
                f"ENLAZE rechazó el lote {totals['batches'] + 1}: "
                f"HTTP {error.code} {response_text}"
            ) from error
        except (OSError, ValueError) as error:
            batch_number = totals["batches"] + 1
            raise RuntimeError(
                f"No se pudo enviar el lote {batch_number} a ENLAZE"
            ) from error

        if result.get("ok") is not True:
            raise RuntimeError(f"ENLAZE no confirmó el lote {totals['batches'] + 1}")
        totals["batches"] += 1
        for key in ("inserted", "updated", "errors"):
            totals[key] += int(result.get(key, 0))
    return totals
