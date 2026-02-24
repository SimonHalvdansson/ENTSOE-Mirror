#!/usr/bin/env python3
from __future__ import annotations

import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
HOST = "127.0.0.1"
PORT = 8000


def discover_countries() -> list[dict[str, str]]:
    countries: list[dict[str, str]] = []

    if not DATA_DIR.exists():
        return countries

    for path in DATA_DIR.glob("*.json"):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue

        slug = path.stem
        countries.append(
            {
                "slug": slug,
                "display_name": payload.get("display_name") or slug.replace("-", " ").title(),
                "country_code": payload.get("country_code") or "",
                "timezone": payload.get("timezone") or "UTC",
            }
        )

    countries.sort(key=lambda item: item["display_name"].casefold())
    return countries


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/countries":
            self._serve_country_index()
            return
        super().do_GET()

    def _serve_country_index(self) -> None:
        payload = json.dumps({"countries": discover_countries()}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Serving {BASE_DIR} on http://{HOST}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
