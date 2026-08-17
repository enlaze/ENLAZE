from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path

from .bc3 import parse_roca_catalog
from .ikea import IKEA_WEBSITE, list_ikea_product_urls, scrape_ikea_products
from .ingest import send_products, send_roca_products
from .source import download_roca_catalog, verify_roca_catalog_link

ALLOWED_ENV_KEYS = {
    "AGENT_API_KEY",
    "PRICE_INGEST_URL",
    "PRICE_WORKER_USER_AGENT",
    "SYNC_API_KEY",
    "VERCEL_AUTOMATION_BYPASS_SECRET",
}


def load_env_file(path: Path) -> None:
    if not path.is_file():
        raise ValueError(f"No existe el archivo de variables: {path}")

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].lstrip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key not in ALLOWED_ENV_KEYS or not re.fullmatch(r"[A-Z][A-Z0-9_]*", key):
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        os.environ.setdefault(key, value)


def _positive_integer(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("debe ser mayor que cero")
    return parsed


def _nonnegative_integer(value: str) -> int:
    parsed = int(value)
    if parsed < 0:
        raise argparse.ArgumentTypeError("no puede ser negativo")
    return parsed


def _nonnegative_float(value: str) -> float:
    parsed = float(value)
    if parsed < 0:
        raise argparse.ArgumentTypeError("no puede ser negativo")
    return parsed


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Importa tarifas oficiales verificables en ENLAZE")
    commands = parser.add_subparsers(dest="command", required=True)
    roca = commands.add_parser("roca", help="Importa el catálogo profesional oficial BC3 de Roca")
    roca.add_argument(
        "--catalog-file",
        type=Path,
        help="ZIP/BC3 local para una prueba sin descargar",
    )
    roca.add_argument(
        "--state-dir",
        type=Path,
        default=Path(os.environ.get("PRICE_WORKER_STATE_DIR", ".state")),
        help="Directorio persistente para caché y metadatos",
    )
    roca.add_argument(
        "--send",
        action="store_true",
        help="Envía los datos; sin esta opción es simulación",
    )
    roca.add_argument("--api-url", default=os.environ.get("PRICE_INGEST_URL", ""))
    roca.add_argument("--batch-size", type=_positive_integer, default=200)
    roca.add_argument("--max-products", type=_positive_integer)
    roca.add_argument("--env-file", type=Path, help="Carga únicamente variables permitidas")

    ikea = commands.add_parser(
        "ikea",
        help="Importa fichas oficiales de IKEA España relacionadas con reforma",
    )
    ikea.add_argument(
        "--send",
        action="store_true",
        help="Envía los datos; sin esta opción es simulación",
    )
    ikea.add_argument("--api-url", default=os.environ.get("PRICE_INGEST_URL", ""))
    ikea.add_argument("--batch-size", type=_positive_integer, default=100)
    ikea.add_argument(
        "--max-products",
        type=_positive_integer,
        default=25,
        help="Límite de fichas por ejecución; por seguridad el valor predeterminado es 25",
    )
    ikea.add_argument(
        "--start-at",
        type=_nonnegative_integer,
        default=0,
        help="Posición desde la que reanudar el catálogo filtrado",
    )
    ikea.add_argument(
        "--delay-seconds",
        type=_nonnegative_float,
        default=1.0,
        help="Pausa entre fichas para no sobrecargar la web oficial",
    )
    ikea.add_argument(
        "--all-products",
        action="store_true",
        help="Incluye todo IKEA; sin esta opción solo rastrea productos útiles para reformas",
    )
    ikea.add_argument("--env-file", type=Path, help="Carga únicamente variables permitidas")

    serve = commands.add_parser(
        "serve",
        help="Expone un disparador HTTP local para n8n",
    )
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=_positive_integer, default=8765)
    serve.add_argument(
        "--state-dir",
        type=Path,
        default=Path(os.environ.get("PRICE_WORKER_STATE_DIR", ".state")),
    )
    serve.add_argument("--api-url", default="")
    serve.add_argument("--batch-size", type=_positive_integer, default=200)
    serve.add_argument("--env-file", type=Path, help="Carga únicamente variables permitidas")
    serve.add_argument(
        "--enable-send",
        action="store_true",
        help="Permite que /run/roca/send escriba en ENLAZE",
    )
    return parser


def run_roca(args: argparse.Namespace) -> int:
    if args.env_file:
        load_env_file(args.env_file)
    if args.batch_size > 500:
        raise ValueError("El tamaño de lote no puede superar 500 productos")

    if args.catalog_file:
        catalog_path = args.catalog_file
        source_verified = "archivo local de prueba"
    else:
        verify_roca_catalog_link()
        catalog_path = download_roca_catalog(args.state_dir)
        source_verified = "enlace confirmado en la web oficial de Roca"

    products = parse_roca_catalog(catalog_path)
    if args.max_products:
        products = products[: args.max_products]

    summary = {
        "mode": "send" if args.send else "dry-run",
        "provider": "Roca",
        "source": source_verified,
        "products": len(products),
        "catalog_published_at": products[0].catalog_published_at,
        "catalog_sha256": products[0].catalog_sha256,
        "sample": [
            {"sku": product.sku, "name": product.name, "price_excl_vat": product.price}
            for product in products[:3]
        ],
    }

    if args.send:
        api_key = os.environ.get("SYNC_API_KEY") or os.environ.get("AGENT_API_KEY")
        if not args.api_url:
            raise ValueError("Falta PRICE_INGEST_URL o --api-url")
        if not api_key:
            raise ValueError("Falta SYNC_API_KEY o AGENT_API_KEY")
        summary["ingest"] = send_roca_products(
            products,
            api_url=args.api_url,
            api_key=api_key,
            batch_size=args.batch_size,
        )

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


def run_ikea(args: argparse.Namespace) -> int:
    if args.env_file:
        load_env_file(args.env_file)
    if args.batch_size > 500:
        raise ValueError("El tamaño de lote no puede superar 500 productos")

    candidates = list_ikea_product_urls(
        include_all=args.all_products,
        limit=args.start_at + args.max_products,
    )
    selected_urls = candidates[args.start_at : args.start_at + args.max_products]
    if not selected_urls:
        raise ValueError("No hay fichas IKEA en el intervalo solicitado")
    products, page_errors = scrape_ikea_products(
        selected_urls,
        delay_seconds=args.delay_seconds,
    )
    if not products:
        raise RuntimeError("IKEA no devolvió ninguna ficha verificable")

    summary = {
        "mode": "send" if args.send else "dry-run",
        "provider": "IKEA",
        "scope": "todos los productos" if args.all_products else "productos de reforma",
        "candidates_scanned": len(candidates),
        "start_at": args.start_at,
        "pages_requested": len(selected_urls),
        "products": len(products),
        "page_errors": len(page_errors),
        "next_start_at": args.start_at + len(selected_urls),
        "sample": [
            {
                "sku": product.sku,
                "name": product.name,
                "price_incl_vat": product.price,
                "category": product.category,
            }
            for product in products[:3]
        ],
    }
    if page_errors:
        summary["error_sample"] = page_errors[:3]

    if args.send:
        api_key = os.environ.get("SYNC_API_KEY") or os.environ.get("AGENT_API_KEY")
        if not args.api_url:
            raise ValueError("Falta PRICE_INGEST_URL o --api-url")
        if not api_key:
            raise ValueError("Falta SYNC_API_KEY o AGENT_API_KEY")
        summary["ingest"] = send_products(
            products,
            provider_name="IKEA",
            sector="construccion",
            source_url=IKEA_WEBSITE,
            api_url=args.api_url,
            api_key=api_key,
            batch_size=args.batch_size,
        )

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


def run_server(args: argparse.Namespace) -> int:
    if args.env_file:
        load_env_file(args.env_file)
    if args.batch_size > 500:
        raise ValueError("El tamaño de lote no puede superar 500 productos")
    if args.host not in {"127.0.0.1", "::1", "localhost"}:
        raise ValueError("El servicio local solo puede escuchar en la interfaz loopback")

    from .server import PriceWorkerServerConfig, serve

    api_url = args.api_url or os.environ.get("PRICE_INGEST_URL", "")
    api_key = os.environ.get("SYNC_API_KEY") or os.environ.get("AGENT_API_KEY", "")
    config = PriceWorkerServerConfig(
        state_dir=args.state_dir,
        api_url=api_url,
        api_key=api_key,
        batch_size=args.batch_size,
        send_enabled=args.enable_send,
    )
    serve(args.host, args.port, config)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "roca":
            return run_roca(args)
        if args.command == "ikea":
            return run_ikea(args)
        if args.command == "serve":
            return run_server(args)
    except (OSError, RuntimeError, ValueError, PermissionError) as error:
        parser.error(str(error))
    return 2
