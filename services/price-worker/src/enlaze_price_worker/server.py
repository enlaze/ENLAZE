from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlsplit

from .bc3 import parse_roca_catalog
from .ingest import send_roca_products
from .source import download_roca_catalog, verify_roca_catalog_link


@dataclass(frozen=True)
class PriceWorkerServerConfig:
    state_dir: Path
    api_url: str
    api_key: str
    batch_size: int = 200
    send_enabled: bool = False


def health_payload(config: PriceWorkerServerConfig, running: bool) -> dict[str, Any]:
    return {
        "ok": True,
        "service": "enlaze-price-worker",
        "provider": "Roca",
        "send_enabled": config.send_enabled,
        "running": running,
    }


def send_precondition_error(
    config: PriceWorkerServerConfig,
) -> Optional[tuple[int, dict[str, Any]]]:
    if not config.send_enabled:
        return 403, {
            "ok": False,
            "error": "La escritura está desactivada; inicia con --enable-send",
        }
    if not config.api_url or not config.api_key:
        return 503, {"ok": False, "error": "Faltan URL o credenciales de ENLAZE"}
    return None


class LocalPriceWorkerHTTPServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(
        self,
        server_address: tuple[str, int],
        handler_class: type[BaseHTTPRequestHandler],
        config: PriceWorkerServerConfig,
    ) -> None:
        super().__init__(server_address, handler_class)
        self.config = config
        self.run_lock = threading.Lock()


class PriceWorkerRequestHandler(BaseHTTPRequestHandler):
    server: LocalPriceWorkerHTTPServer

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if urlsplit(self.path).path != "/health":
            self._send_json(404, {"ok": False, "error": "Ruta no encontrada"})
            return
        self._send_json(
            200,
            health_payload(self.server.config, self.server.run_lock.locked()),
        )

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        path = urlsplit(self.path).path
        if path not in {"/run/roca/dry-run", "/run/roca/send"}:
            self._send_json(404, {"ok": False, "error": "Ruta no encontrada"})
            return

        should_send = path.endswith("/send")
        config = self.server.config
        if should_send:
            precondition_error = send_precondition_error(config)
            if precondition_error:
                status, payload = precondition_error
                self._send_json(status, payload)
                return
        if not self.server.run_lock.acquire(blocking=False):
            self._send_json(409, {"ok": False, "error": "Ya hay una sincronización en curso"})
            return

        try:
            verify_roca_catalog_link()
            catalog_path = download_roca_catalog(config.state_dir)
            products = parse_roca_catalog(catalog_path)
            payload: dict[str, Any] = {
                "ok": True,
                "mode": "send" if should_send else "dry-run",
                "provider": "Roca",
                "products": len(products),
                "catalog_published_at": products[0].catalog_published_at,
                "catalog_sha256": products[0].catalog_sha256,
            }
            if should_send:
                payload["ingest"] = send_roca_products(
                    products,
                    api_url=config.api_url,
                    api_key=config.api_key,
                    batch_size=config.batch_size,
                )
            self._send_json(200, payload)
        except PermissionError as error:
            self._send_json(403, {"ok": False, "error": str(error)})
        except (OSError, RuntimeError, ValueError) as error:
            self._send_json(502, {"ok": False, "error": str(error)})
        finally:
            self.server.run_lock.release()

    def log_message(self, message_format: str, *args: object) -> None:
        print(f"[price-worker] {self.address_string()} {message_format % args}")


def create_server(
    host: str,
    port: int,
    config: PriceWorkerServerConfig,
) -> LocalPriceWorkerHTTPServer:
    return LocalPriceWorkerHTTPServer(
        (host, port),
        PriceWorkerRequestHandler,
        config,
    )


def serve(host: str, port: int, config: PriceWorkerServerConfig) -> None:
    server = create_server(host, port, config)
    print(f"ENLAZE Price Worker escuchando en http://{host}:{server.server_port}")
    print(f"Escritura en ENLAZE: {'activada' if config.send_enabled else 'desactivada'}")
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
