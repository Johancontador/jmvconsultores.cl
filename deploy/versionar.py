#!/usr/bin/env python3
"""Versiona las referencias a css/js en todos los .html del sitio.

Correr después de tocar css/, js/ o cualquier HTML:

    python3 deploy/versionar.py
    python3 gen_servicios.py && python3 gen_faq_central.py   # si aplica
    node --test tests/sitio.test.mjs
"""
import glob
import os

from assets import VERSIONABLES, sha1, versionar_pagina

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

print("hash por archivo:")
hashes = {rel: sha1(rel) for rel in VERSIONABLES}
for rel, h in hashes.items():
    print(f"  {rel} -> ?v={h}")

cambiadas = []
for ruta in sorted(glob.glob(os.path.join(RAIZ, "*.html"))):
    nombre = os.path.basename(ruta)
    if versionar_pagina(nombre, hashes):
        cambiadas.append(nombre)

print("páginas actualizadas: " + (", ".join(cambiadas) if cambiadas else "ninguna (ya estaban al día)"))
