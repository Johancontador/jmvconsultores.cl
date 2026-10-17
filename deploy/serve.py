#!/usr/bin/env python3
"""Servidor estático de jmvconsultores.cl.

Reemplaza a `python3 -m http.server`, que publicaba todo el directorio del
repo (incluido `.git/` y los generadores `.py`) y devolvía su 404 genérica.

Qué agrega este servidor:
  - Allowlist: solo se sirven las páginas del sitio, robots.txt, sitemap.xml y
    los directorios css/, js/ y assets/. Todo lo demás (`.git/`, `*.py`,
    docs/, deploy/, data/) responde 404 sin filtrar su existencia.
  - 404 propia con estado 404 (404.html).
  - URLs limpias: /remuneraciones → 301 a /remuneraciones.html, que es la URL
    canónica declarada en cada página. No se sirve el mismo contenido en dos
    URLs: la limpia redirige, no duplica.
  - Sin listado de directorios.
  - Headers de seguridad y caché: HTML siempre revalidado (un despliegue se ve
    al instante) y estáticos con un día de caché.

Uso: PORT=8090 python3 deploy/serve.py
"""

import os
import posixpath
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8090"))

# Archivos servidos desde la raíz del repo.
ROOT_FILES = {"index.html", "robots.txt", "sitemap.xml", "404.html"}
PAGE_NAME = re.compile(r"^[a-z0-9][a-z0-9-]*\.html$")

# Directorios públicos y las extensiones permitidas dentro de cada uno.
SUBDIRS = {
    "css": {".css"},
    "js": {".js"},
    "assets": {".svg", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".woff2"},
}

# Tipos que siempre viajan como texto: charset explícito para no depender del
# locale del sistema.
TEXT_TYPES = {".html": "text/html", ".css": "text/css", ".js": "text/javascript",
              ".svg": "image/svg+xml", ".txt": "text/plain", ".xml": "application/xml",
              ".json": "application/json"}

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "SAMEORIGIN",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
}

FOUR_OH_FOUR = os.path.join(ROOT, "404.html")


def is_public(url_path):
    """True si `url_path` (absoluto, ya normalizado) es un archivo publicable."""
    if url_path in ("/robots.txt", "/sitemap.xml"):
        return True
    rel = url_path.lstrip("/")
    if "/" not in rel:
        return rel in ROOT_FILES or bool(PAGE_NAME.match(rel))
    directorio, _, nombre = rel.partition("/")
    permitidas = SUBDIRS.get(directorio)
    if permitidas is None or not nombre or "/" in nombre:
        return False
    if nombre.startswith("."):
        return False
    return os.path.splitext(nombre)[1].lower() in permitidas


def to_disk(url_path):
    """Ruta absoluta en disco para `url_path`, o None si escapa del repo."""
    destino = os.path.normpath(os.path.join(ROOT, url_path.lstrip("/")))
    if destino != ROOT and not destino.startswith(ROOT + os.sep):
        return None
    return destino


def normalize(raw_path):
    """Normaliza el path de la URL y descarta intentos de escape."""
    path = unquote(raw_path)
    if "\x00" in path or "\\" in path:
        return None
    # neutraliza ../ y //: si algo se sale de la raíz, es 404
    path = posixpath.normpath(path)
    if not path.startswith("/"):
        path = "/" + path
    if path == "//":
        path = "/"
    return path


class Handler(BaseHTTPRequestHandler):
    server_version = "jmv-www"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    # ── métodos ──────────────────────────────────────────────────────────────
    def do_GET(self):
        self.route(head_only=False)

    def do_HEAD(self):
        self.route(head_only=True)

    def send_error(self, code, message=None, explain=None):
        """Los errores de parseo también usan la 404 propia, nunca un traceback."""
        self.responder_404(head_only=False)

    # ── ruteo ────────────────────────────────────────────────────────────────
    def route(self, head_only):
        crudo = urlsplit(self.path).path or "/"
        path = normalize(crudo)
        if path is None:
            return self.responder_404(head_only)

        # URL limpia: /remuneraciones → /remuneraciones.html (canónica).
        if path != "/" and not os.path.splitext(path)[1]:
            candidata = path + ".html"
            if is_public(candidata) and os.path.isfile(to_disk(candidata)):
                return self.redirect(301, candidata)
        # La portada se sirve en /, no en /index.html (su canónica es /).
        if path == "/index.html":
            return self.redirect(301, "/")
        # Barra final sobre una página: una sola URL por contenido.
        if path.endswith("/") and path != "/":
            limpia = path.rstrip("/")
            if is_public(limpia + ".html") and os.path.isfile(to_disk(limpia + ".html")):
                return self.redirect(301, limpia)

        if path == "/":
            path = "/index.html"

        if not is_public(path):
            return self.responder_404(head_only)

        destino = to_disk(path)
        if destino is None or not os.path.isfile(destino):
            return self.responder_404(head_only)

        with open(destino, "rb") as f:
            cuerpo = f.read()
        return self.responder(200, path, cuerpo, head_only)

    # ── respuestas ───────────────────────────────────────────────────────────
    def responder_404(self, head_only):
        try:
            with open(FOUR_OH_FOUR, "rb") as f:
                cuerpo = f.read()
        except OSError:
            cuerpo = b"<h1>404</h1><p>Pagina no encontrada.</p>"
            return self.responder(404, "/404.html", cuerpo, head_only,
                                  content_type="text/html; charset=utf-8")
        return self.responder(404, "/404.html", cuerpo, head_only)

    def redirect(self, code, destino):
        cuerpo = b""
        self.send_response(code)
        self.send_header("Location", destino)
        self.send_header("Content-Length", str(len(cuerpo)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(cuerpo)

    def responder(self, code, url_path, cuerpo, head_only, content_type=None):
        if content_type is None:
            ext = os.path.splitext(url_path)[1].lower()
            base = TEXT_TYPES.get(ext)
            if base is None:
                import mimetypes
                base = mimetypes.guess_type(url_path)[0] or "application/octet-stream"
            content_type = base + ("; charset=utf-8" if base.startswith(("text/", "application/xml", "image/svg", "application/json")) else "")

        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(cuerpo)))
        if url_path.endswith((".html", ".txt", ".xml")):
            self.send_header("Cache-Control", "no-cache")
        else:
            self.send_header("Cache-Control", "public, max-age=86400")
        for nombre, valor in SECURITY_HEADERS.items():
            self.send_header(nombre, valor)
        self.end_headers()
        if not head_only:
            self.wfile.write(cuerpo)


def main():
    if not os.path.isfile(os.path.join(ROOT, "index.html")):
        print(f"error: {ROOT} no parece el sitio (falta index.html)", file=sys.stderr)
        return 1
    servidor = ThreadingHTTPServer((HOST, PORT), Handler)
    servidor.daemon_threads = True
    # PORT=<real> en su propia línea: los tests leen el puerto efectivo cuando
    # se arranca con PORT=0 (puerto efímero).
    print(f"PORT={servidor.server_address[1]}", flush=True)
    print(f"jmv-www escuchando en http://{HOST}:{servidor.server_address[1]} desde {ROOT}", flush=True)
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        servidor.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
