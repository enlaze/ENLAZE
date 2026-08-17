from __future__ import annotations

import hashlib
import json
import os
import ssl
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from pathlib import Path
from importlib import resources

from .bc3 import ROCA_CATALOG_URL

ROCA_CATALOG_PAGE = "https://www.roca.es/zona-profesional/catalogo-roca-presto"
DEFAULT_USER_AGENT = "ENLAZE-Public-Price-Monitor/1.0"
MAX_DOWNLOAD_BYTES = 300 * 1024 * 1024


def tls_context() -> ssl.SSLContext:
    try:
        import certifi
    except ImportError:
        context = ssl.create_default_context()
    else:
        context = ssl.create_default_context(cafile=certifi.where())

    # ACAE no entrega este intermedio en su handshake. Está firmado por la raíz
    # pública Sectigo R46 y fue verificado antes de incluirlo en el paquete.
    intermediate = resources.files("enlaze_price_worker").joinpath(
        "certs/SectigoPublicServerAuthenticationCAEVR36.pem"
    )
    if intermediate.is_file():
        context.load_verify_locations(cafile=str(intermediate))
    return context


def user_agent() -> str:
    configured = os.environ.get("PRICE_WORKER_USER_AGENT", DEFAULT_USER_AGENT).strip()
    return configured or DEFAULT_USER_AGENT


def assert_robots_allowed(target_url: str) -> None:
    parsed = urllib.parse.urlparse(target_url)
    robots_url = urllib.parse.urlunparse((parsed.scheme, parsed.netloc, "/robots.txt", "", "", ""))
    request = urllib.request.Request(robots_url, headers={"User-Agent": user_agent()})
    parser = urllib.robotparser.RobotFileParser()
    parser.set_url(robots_url)

    try:
        with urllib.request.urlopen(
            request,
            timeout=30,
            context=tls_context(),
        ) as response:
            robots_text = response.read(2 * 1024 * 1024).decode("utf-8", errors="replace")
    except urllib.error.HTTPError as error:
        if error.code in (404, 410):
            return
        raise RuntimeError(
            f"No se pudo verificar robots.txt de {parsed.netloc}: HTTP {error.code}"
        ) from error
    except OSError as error:
        raise RuntimeError(f"No se pudo verificar robots.txt de {parsed.netloc}") from error

    parser.parse(robots_text.splitlines())
    if not parser.can_fetch(user_agent(), target_url):
        raise PermissionError(f"robots.txt no autoriza el acceso automatizado a {target_url}")


def verify_roca_catalog_link() -> str:
    """Confirma con Scrapling que la página oficial de Roca publica el enlace esperado."""
    assert_robots_allowed(ROCA_CATALOG_PAGE)
    try:
        from scrapling.fetchers import Fetcher
    except ImportError as error:
        raise RuntimeError(
            "Scrapling no está instalado. Instala el worker con: pip install -e ."
        ) from error

    page = Fetcher.get(
        ROCA_CATALOG_PAGE,
        headers={"User-Agent": user_agent(), "Accept-Language": "es-ES,es;q=0.9"},
        stealthy_headers=False,
        follow_redirects="safe",
        timeout=30,
    )
    links = {
        urllib.parse.urljoin(ROCA_CATALOG_PAGE, str(link).strip())
        for link in page.css("a::attr(href)").getall()
        if link
    }
    if ROCA_CATALOG_URL not in links:
        raise RuntimeError(
            "Roca ya no publica el enlace BC3 oficial esperado; no se importará nada"
        )
    return ROCA_CATALOG_URL


def download_roca_catalog(state_dir: Path) -> Path:
    """Descarga el archivo oficial con caché condicional y sustitución atómica."""
    assert_robots_allowed(ROCA_CATALOG_URL)
    state_dir.mkdir(parents=True, exist_ok=True)
    destination = state_dir / "roca.bc3.zip"
    metadata_path = state_dir / "roca.bc3.metadata.json"
    metadata: dict[str, str] = {}
    if metadata_path.is_file():
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            metadata = {}

    headers = {"User-Agent": user_agent(), "Accept": "application/zip,application/octet-stream"}
    if destination.is_file():
        if metadata.get("etag"):
            headers["If-None-Match"] = metadata["etag"]
        if metadata.get("last_modified"):
            headers["If-Modified-Since"] = metadata["last_modified"]

    request = urllib.request.Request(ROCA_CATALOG_URL, headers=headers)
    partial = state_dir / "roca.bc3.zip.part"
    try:
        with urllib.request.urlopen(
            request,
            timeout=120,
            context=tls_context(),
        ) as response, partial.open("wb") as output:
            digest = hashlib.sha256()
            total = 0
            while chunk := response.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_DOWNLOAD_BYTES:
                    raise RuntimeError("El catálogo Roca supera el límite de descarga permitido")
                output.write(chunk)
                digest.update(chunk)
            response_headers = response.headers
    except urllib.error.HTTPError as error:
        if error.code == 304 and destination.is_file():
            return destination
        partial.unlink(missing_ok=True)
        raise RuntimeError(f"No se pudo descargar el catálogo Roca: HTTP {error.code}") from error
    except Exception:
        partial.unlink(missing_ok=True)
        raise

    if total == 0:
        partial.unlink(missing_ok=True)
        raise RuntimeError("El catálogo Roca descargado está vacío")

    partial.replace(destination)
    metadata_path.write_text(
        json.dumps(
            {
                "source_url": ROCA_CATALOG_URL,
                "etag": response_headers.get("ETag", ""),
                "last_modified": response_headers.get("Last-Modified", ""),
                "sha256_zip": digest.hexdigest(),
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return destination
