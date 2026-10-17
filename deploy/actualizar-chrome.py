#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""actualizar-chrome.py — mantiene iguales la cabecera, el menú y el pie en todas las páginas.

Este sitio no tiene framework ni build: son archivos HTML sueltos. Para no
duplicar la navegación en cada uno (y para que nunca queden piezas distintas
según la página), este script reemplaza los bloques compartidos por una única
definición y regenera el sitemap.

Es idempotente: correrlo dos veces deja los archivos iguales. Correrlo SIEMPRE
después de regenerar páginas con gen_servicios.py / gen_faq_central.py:

    python3 deploy/actualizar-chrome.py
    python3 deploy/versionar.py
"""

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ── Mapa del sitio ───────────────────────────────────────────────────────────
# archivo, etiqueta de menú (o None), prioridad sitemap, changefreq, nombre corto
PAGINAS = [
    ("index.html", "Inicio", "1.0", "weekly", "Inicio"),
    ("servicios.html", "Servicios", "0.9", "monthly", "Servicios"),
    ("contabilidad-completa.html", "Servicios", "0.8", "monthly", "Contabilidad completa"),
    ("remuneraciones.html", "Servicios", "0.8", "monthly", "Remuneraciones"),
    ("acompanamiento-contable.html", "Servicios", "0.8", "monthly", "Acompañamiento contable"),
    ("asesoria-tributaria.html", "Servicios", "0.8", "monthly", "Asesoría tributaria"),
    ("emprendedores-pymes.html", "Servicios", "0.8", "monthly", "Emprendedores y Pymes"),
    ("respaldo-confidencialidad.html", "Servicios", "0.8", "monthly", "Respaldo y confidencialidad"),
    ("prevencion-riesgos.html", "Servicios", "0.8", "monthly", "Prevención de riesgos"),
    ("soluciones-digitales.html", "Soluciones digitales", "0.8", "monthly", "Soluciones digitales"),
    ("preguntas-frecuentes.html", "Recursos", "0.8", "weekly", "Preguntas frecuentes"),
    ("faq-contabilidad.html", "Recursos", "0.6", "monthly", "FAQ Contabilidad completa"),
    ("faq-remuneraciones.html", "Recursos", "0.6", "monthly", "FAQ Remuneraciones"),
    ("faq-acompanamiento.html", "Recursos", "0.6", "monthly", "FAQ Acompañamiento contable"),
    ("faq-tributaria.html", "Recursos", "0.6", "monthly", "FAQ Asesoría tributaria"),
    ("faq-pymes.html", "Recursos", "0.6", "monthly", "FAQ Emprendedores y Pymes"),
    ("faq-respaldo.html", "Recursos", "0.6", "monthly", "FAQ Respaldo y confidencialidad"),
    ("faq-prevencion.html", "Recursos", "0.6", "monthly", "FAQ Prevención de riesgos"),
    ("blog.html", "Blog", "0.7", "weekly", "Blog"),
    ("blog-iva-credito-fiscal.html", "Blog", "0.5", "monthly", "Cómo recuperar el IVA de crédito fiscal"),
    ("blog-finiquito.html", "Blog", "0.5", "monthly", "Finiquito: qué debe incluir y cómo revisarlo"),
    ("blog-ley-21719.html", "Blog", "0.5", "monthly", "Ley 21.719: qué cambia para tu pyme"),
    ("testimonios.html", "Nosotros", "0.5", "yearly", "Testimonios"),
    ("nosotros.html", "Nosotros", "0.5", "yearly", "Nosotros"),
    ("contacto.html", "Contacto", "0.7", "yearly", "Contacto"),
    ("privacidad.html", None, "0.3", "yearly", "Política de Privacidad"),
    ("cookies.html", None, "0.3", "yearly", "Política de Cookies"),
    ("terminos.html", None, "0.3", "yearly", "Términos y Condiciones"),
]

# Páginas que traen sus propias migas y su propio BreadcrumbList (el generador
# no debe imponerles la ruta «Inicio › Servicios»).
MIGAS_PROPIAS = {
    "preguntas-frecuentes.html", "blog.html", "testimonios.html",
    "privacidad.html", "cookies.html", "terminos.html",
    "blog-iva-credito-fiscal.html", "blog-finiquito.html", "blog-ley-21719.html",
    "faq-contabilidad.html", "faq-remuneraciones.html", "faq-acompanamiento.html",
    "faq-tributaria.html", "faq-pymes.html", "faq-respaldo.html", "faq-prevencion.html",
}

IDS = {
    "index.html": "inicio",
    "servicios.html": "servicios",
    "soluciones-digitales.html": "soluciones",
    "preguntas-frecuentes.html": "recursos",
    "nosotros.html": "nosotros",
    "contacto.html": "contacto",
}

SERVICIOS = [
    ("contabilidad-completa.html", "Contabilidad completa"),
    ("remuneraciones.html", "Remuneraciones y finiquitos"),
    ("acompanamiento-contable.html", "Acompañamiento contable"),
    ("asesoria-tributaria.html", "Asesoría tributaria"),
    ("emprendedores-pymes.html", "Emprendedores y Pymes"),
    ("prevencion-riesgos.html", "Prevención de riesgos"),
    ("respaldo-confidencialidad.html", "Respaldo y confidencialidad"),
]

# ── Bloques compartidos ──────────────────────────────────────────────────────
CTA_HEADER = """<a class="btn btn--primary btn--sm" href="/contacto.html">Consulta gratis</a>"""


MENU = [
    ("/", "Inicio", "index.html"),
    ("/servicios.html", "Servicios", "servicios.html"),
    ("/soluciones-digitales.html", "Soluciones digitales", "soluciones-digitales.html"),
    ("/preguntas-frecuentes.html", "Recursos", "preguntas-frecuentes.html"),
    ("/blog.html", "Blog", "blog.html"),
    ("/nosotros.html", "Nosotros", "nosotros.html"),
    ("/contacto.html", "Contacto", "contacto.html"),
]


def header_html(archivo="index.html"):
    etiqueta = next((e for a, e, _, _, _ in PAGINAS if a == archivo), None)
    href_activo = next((h for h, _, a in MENU if a == archivo), None)
    if etiqueta and etiqueta != "Inicio":
        href_activo = next((h for h, l, _ in MENU if l == etiqueta), href_activo)
    lis = []
    for href, label, _ in MENU:
        actual = ' aria-current="page"' if href == href_activo else ""
        lis.append(f'          <li><a href="{href}"{actual}>{label}</a></li>')
    return """<header class="site-head">
    <div class="container site-head__inner">
      <a class="site-head__brand" href="/" aria-label="JMV Consultores — ir al inicio">
        <img src="/assets/marca-oscura.svg" alt="" width="36" height="36" aria-hidden="true" />
        <span class="site-head__brand-text">JMV<small>Consultores</small></span>
      </a>
      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="navPrincipal" aria-label="Abrir menú de navegación">
        <span class="nav-toggle__bar" aria-hidden="true"></span>
        <span class="nav-toggle__bar" aria-hidden="true"></span>
        <span class="nav-toggle__bar" aria-hidden="true"></span>
      </button>
      <nav class="nav" id="navPrincipal" aria-label="Navegación principal">
        <ul class="nav__list">
%s
        </ul>
        <div class="nav__cta">
          <a class="btn btn--ghost btn--sm" href="https://app.jmvconsultores.cl">Acceso clientes</a>
          %s
        </div>
      </nav>
    </div>
  </header>""" % ("\n".join(lis), CTA_HEADER)


def footer_html():
    servicios = "\n".join(
        f'            <li><a href="/{href}">{label}</a></li>' for href, label in SERVICIOS
    )
    return """<footer class="site-foot">
    <div class="container site-foot__grid">
      <div class="site-foot__brand">
        <a href="/" aria-label="JMV Consultores — ir al inicio"><img src="/assets/logo-light.svg" alt="JMV Consultores" width="168" height="126" /></a>
        <p>Consultoría contable, tributaria y de remuneraciones para pymes chilenas. Atención 100%% en línea, con información clara y respaldos ordenados.</p>
        <p class="site-foot__legal">JMV Consultores SpA · RUT 76.537.758-7<br />Johan Morales · Región Metropolitana, Chile</p>
        <a class="site-foot__mail" href="mailto:contacto@jmvconsultores.cl">contacto@jmvconsultores.cl</a>
      </div>
      <nav aria-label="Servicios">
        <h2>Servicios</h2>
        <ul>
%s
        </ul>
      </nav>
      <nav aria-label="Recursos">
        <h2>Recursos</h2>
        <ul>
          <li><a href="/preguntas-frecuentes.html">Preguntas frecuentes</a></li>
          <li><a href="/blog.html">Blog contable</a></li>
          <li><a href="/testimonios.html">Testimonios</a></li>
          <li><a href="/servicios.html">Catálogo de servicios</a></li>
          <li><a href="/soluciones-digitales.html">Soluciones digitales</a></li>
          <li><a href="/nosotros.html">Nosotros</a></li>
        </ul>
      </nav>
      <nav aria-label="Información legal">
        <h2>Información legal</h2>
        <ul>
          <li><a href="/privacidad.html">Política de Privacidad</a></li>
          <li><a href="/cookies.html">Política de Cookies</a></li>
          <li><a href="/terminos.html">Términos y Condiciones</a></li>
        </ul>
      </nav>
      <div>
        <h2>Contacto</h2>
        <ul>
          <li><a href="https://wa.me/56975752213">WhatsApp +56 9 7575 2213</a></li>
          <li><a href="mailto:contacto@jmvconsultores.cl">contacto@jmvconsultores.cl</a></li>
          <li><a href="https://app.jmvconsultores.cl">Acceso clientes</a></li>
          <li><a href="/contacto.html">Solicitar asesoría</a></li>
        </ul>
      </div>
      <!-- Redes oficiales: lo llena js/main.js solo con perfiles reales
           (constante REDES). Sin perfiles configurados, el bloque se elimina. -->
      <div data-redes hidden>
        <h2>Redes oficiales</h2>
        <ul></ul>
      </div>
    </div>
    <div class="container site-foot__bottom">
      <p>© <span id="year">2026</span> JMV Consultores SpA · jmvconsultores.cl</p>
      <p>Región Metropolitana, Chile · Atención en línea</p>
    </div>
  </footer>""" % servicios


def breadcrumb_html(archivo):
    """Migas para páginas hijas; None para las de primer nivel."""
    nombres = {a: n for a, _, _, _, n in PAGINAS}
    if archivo not in nombres or archivo in MIGAS_PROPIAS:
        return None
    if archivo in ("index.html", "servicios.html", "soluciones-digitales.html",
                   "nosotros.html", "contacto.html"):
        return None
    if archivo == "preguntas-frecuentes.html":
        return """<nav class="breadcrumb" aria-label="Ruta de navegación">
        <ol>
          <li><a href="/">Inicio</a></li>
          <li aria-current="page">Preguntas frecuentes</li>
        </ol>
      </nav>"""
    return """<nav class="breadcrumb" aria-label="Ruta de navegación">
        <ol>
          <li><a href="/">Inicio</a></li>
          <li><a href="/servicios.html">Servicios</a></li>
          <li aria-current="page">%s</li>
        </ol>
      </nav>""" % nombres[archivo]


def breadcrumb_jsonld(archivo):
    nombres = {a: n for a, _, _, _, n in PAGINAS}
    if archivo not in nombres or breadcrumb_html(archivo) is None:
        return None
    if archivo == "preguntas-frecuentes.html":
        return """<script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      {"@type": "ListItem", "position": 1, "name": "Inicio", "item": "https://jmvconsultores.cl/"},
      {"@type": "ListItem", "position": 2, "name": "Preguntas frecuentes", "item": "https://jmvconsultores.cl/preguntas-frecuentes.html"}
    ]
  }
  </script>"""
    return """<script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      {"@type": "ListItem", "position": 1, "name": "Inicio", "item": "https://jmvconsultores.cl/"},
      {"@type": "ListItem", "position": 2, "name": "Servicios", "item": "https://jmvconsultores.cl/servicios.html"},
      {"@type": "ListItem", "position": 3, "name": "%s", "item": "https://jmvconsultores.cl/%s"}
    ]
  }
  </script>""" % (nombres[archivo], archivo)


FUENTES = """<link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700&display=swap" />"""


def transformar(archivo, origen):
    html = origen.replace("\r\n", "\n")

    # 1. Tema y tipografía: una sola familia web (Sora); el cuerpo usa la del sistema.
    html = re.sub(r'<meta name="theme-color" content="[^"]*" />', '<meta name="theme-color" content="#ffffff" />', html)
    # Quita cualquier carga previa de fuentes (incluido el bloque con media=print).
    html = re.sub(r'\s*<link[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*/?>', "", html)
    html = re.sub(r'\s*<noscript>\s*<link[^>]*fonts\.googleapis\.com[^>]*/?>\s*</noscript>', "", html, flags=re.S)
    html = re.sub(
        r'(<link rel="icon"[^>]*/?>)',
        lambda m: m.group(1) + "\n  " + FUENTES,
        html,
        count=1,
    )

    # 2. Marca de «hay JS» antes de pintar: sin JS el contenido no se oculta.
    if 'classList.add("js")' not in html:
        html = re.sub(
            r'(<meta name="viewport"[^>]*/>)',
            r'\1\n  <script>document.documentElement.classList.add("js");</script>',
            html,
            count=1,
        )

    # 3. Fuera el canvas 3D y su script (el rediseño es sobrio, sin fondo animado).
    html = re.sub(r'\s*<canvas id="bg3d"[^>]*></canvas>', "", html)
    html = re.sub(r'\s*<script defer src="[^"]*bg3d\.js[^"]*"></script>', "", html)

    # 4. Cabecera y pie únicos. Las páginas nuevas usan marcadores; las
    #    antiguas (y los generadores) traen el bloque completo.
    header = header_html(archivo)
    footer = footer_html()
    html = html.replace("<!--SITE_HEADER-->", header)
    html = html.replace("<!--SITE_FOOTER-->", footer)
    if re.search(r'<header class="(topbar|site-head)">', html):
        html = re.sub(r'<header class="(topbar|site-head)">.*?</header>', lambda m: header, html, count=1, flags=re.S)
    else:
        html = re.sub(r"(<body[^>]*>)", lambda m: m.group(1) + "\n\n  " + header, html, count=1)

    if re.search(r'<footer class="(footer|site-foot)">', html):
        html = re.sub(r'<footer class="(footer|site-foot)">.*?</footer>', lambda m: footer, html, count=1, flags=re.S)
    else:
        html = re.sub(r"</body>", footer + "\n\n</body>", html, count=1)

    # 4bis. Enlace de salto: fuera del bloque de cabecera (así reemplazarla no
    # lo duplica) y una sola vez por página.
    if 'class="skip"' not in html:
        html = re.sub(
            r"(<body[^>]*>)",
            lambda m: m.group(1) + '\n\n  <a class="skip" href="#contenido">Saltar al contenido</a>',
            html,
            count=1,
        )

    # 5. Un solo <main id="contenido">: si no existe, envuelve el contenido.
    if "<main" not in html:
        cierre_header = html.find("</header>") + len("</header>")
        inicio_footer = html.find('<footer class="site-foot"')
        if inicio_footer < 0:
            inicio_footer = html.find("<!--SITE_FOOTER-->")
        if cierre_header > 0 and inicio_footer > cierre_header:
            html = (
                html[:cierre_header]
                + '\n\n  <main id="contenido">'
                + html[cierre_header:inicio_footer]
                + "\n  </main>\n\n  "
                + html[inicio_footer:]
            )
    elif 'id="contenido"' not in html:
        html = re.sub(r"<main\b", '<main id="contenido"', html, count=1)

    # 6. Migas de pan en las páginas de servicio (reemplazan el «Volver al inicio»).
    migas = breadcrumb_html(archivo)
    if migas and 'class="breadcrumb"' not in html:
        html = re.sub(r'<a class="crumb"[^>]*>.*?</a>', migas, html, count=1, flags=re.S)

    # 6bis. Etiqueta visible del buscador de la FAQ central.
    if 'for="faqSearch"' not in html:
        html = re.sub(
            r'<input type="search" id="faqSearch"',
            lambda m: '<label for="faqSearch">Busca por palabra clave</label>\n        ' + m.group(0),
            html,
            count=1,
        )

    # 7. Datos estructurados de migas (una sola vez).
    esquema = breadcrumb_jsonld(archivo)
    if esquema and "BreadcrumbList" not in html:
        html = re.sub(r"\n?</body>", lambda m: "\n\n  " + esquema + "\n\n</body>", html, count=1)

    # 8. Limpieza de restos del diseño anterior (comentarios y bloques vacíos).
    html = re.sub(r'(<a class="skip"[^>]*>[^<]*</a>)\n(?:[ \t]*\n)+', r'\1\n', html)
    html = re.sub(r'\s*<noscript>\s*</noscript>', "", html)
    html = re.sub(r'\s*<!--[^>]*(?:FONDO 3D|BARRA SUPERIOR|Fuentes asíncronas)[^>]*-->', "", html)
    html = re.sub(r'\n{3,}', "\n\n", html)

    return html


def sitemap():
    urls = []
    for archivo, _, prioridad, freq, _ in PAGINAS:
        loc = "https://jmvconsultores.cl/" + ("" if archivo == "index.html" else archivo)
        urls.append(
            "  <url><loc>%s</loc><changefreq>%s</changefreq><priority>%s</priority></url>"
            % (loc, freq, prioridad)
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(urls)
        + "\n</urlset>\n"
    )


def main():
    faltantes = []
    for archivo, *_ in PAGINAS:
        ruta = os.path.join(ROOT, archivo)
        if not os.path.exists(ruta):
            faltantes.append(archivo)
            continue
        with open(ruta, encoding="utf-8") as f:
            original = f.read()
        nuevo = transformar(archivo, original)
        if nuevo != original:
            with open(ruta, "w", encoding="utf-8", newline="\n") as f:
                f.write(nuevo)
            print("actualizado:", archivo)

    # La 404 también comparte cabecera y pie, pero no va al sitemap.
    ruta404 = os.path.join(ROOT, "404.html")
    if os.path.exists(ruta404):
        with open(ruta404, encoding="utf-8") as f:
            original = f.read()
        nuevo = transformar("404.html", original)
        if nuevo != original:
            with open(ruta404, "w", encoding="utf-8", newline="\n") as f:
                f.write(nuevo)
            print("actualizado: 404.html")

    with open(os.path.join(ROOT, "sitemap.xml"), "w", encoding="utf-8", newline="\n") as f:
        f.write(sitemap())
    print("sitemap.xml: %d URLs" % len(PAGINAS))

    if faltantes:
        print("\nFALTAN PÁGINAS:", ", ".join(faltantes), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
