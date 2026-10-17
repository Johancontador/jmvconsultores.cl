"""Versionado anti-caché de los estáticos.

El borde de Cloudflare cachea `.css` y `.js` por 4 horas, y el navegador los
reutiliza por heurística. Sin un `?v=` en la URL, un cambio de estilos puede
convivir horas con HTML nuevo (o no verse). Igual que en la app, la solución es
versionar la referencia con el sha1 del contenido: cambia el archivo, cambia la
URL.

Uso:
    python3 deploy/versionar.py     # reescribe ?v= en todos los .html
"""

import hashlib
import os
import re

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Archivos versionables (rutas servidas, relativas a la raíz del sitio).
VERSIONABLES = ("css/styles.css", "js/main.js", "js/bg3d.js")

REF = re.compile(
    r'(?P<pre>(?:href|src)=")(?P<barra>/?)(?P<ruta>css/styles\.css|js/main\.js|js/bg3d\.js)'
    r'(?:\?v=[0-9a-f]{8})?(?P<post>")'
)


def sha1(rel):
    with open(os.path.join(RAIZ, rel), "rb") as f:
        return hashlib.sha1(f.read()).hexdigest()[:8]


def versionar_html(texto, hashes=None):
    """Reescribe las referencias a estáticos con ?v=<sha1 del contenido>."""
    hashes = hashes or {rel: sha1(rel) for rel in VERSIONABLES}

    def repl(m):
        ruta = m.group("ruta")
        return f"{m.group('pre')}{m.group('barra')}{ruta}?v={hashes[ruta]}{m.group('post')}"

    return REF.sub(repl, texto)


def versionar_pagina(nombre, hashes=None):
    """Versiona un archivo .html en disco. Devuelve True si cambió algo."""
    destino = os.path.join(RAIZ, nombre)
    with open(destino, encoding="utf-8", newline="") as f:
        original = f.read()
    nuevo = versionar_html(original, hashes)
    if nuevo == original:
        return False
    with open(destino, "w", encoding="utf-8", newline="") as f:
        f.write(nuevo)
    return True
