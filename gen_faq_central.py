#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_faq_central.py — Genera el centro de ayuda en 8 páginas livianas.

Antes este generador volcaba las 350 preguntas en un único
`preguntas-frecuentes.html` de ~290 KB: en móvil eso son varios segundos de
espera antes de poder leer la primera respuesta. Ahora el contenido se reparte
en un índice (las 28 más consultadas + tarjetas por tema) y siete páginas de
50 preguntas cada una, una por servicio.

    python3 gen_faq_central.py
    python3 deploy/actualizar-chrome.py   # reaplica cabecera, menú y pie
    python3 deploy/versionar.py

El índice y cada página se generan con el chrome compartido (cabecera y pie
únicos) y con su propio canonical, así que el sitemap y los tests los cubren
solos. Cada bloque conserva su FAQPage en JSON-LD.
"""
import html as H
import json
import os
import sys

RAIZ = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(RAIZ, "data"))
import faq_contabilidad, faq_remuneraciones, faq_acompanamiento
import faq_tributaria, faq_pymes, faq_respaldo, faq_prevencion

sys.path.insert(0, RAIZ)
from deploy.assets import versionar_html

WA = "56975752213"
BASE = "https://jmvconsultores.cl/"

SECCIONES = [
    dict(
        id="contabilidad", nombre="Contabilidad completa", num="01",
        archivo="contabilidad-completa.html", data=faq_contabilidad.FAQS,
        desc="IVA y F29, renta y F22, regímenes tributarios, libros y conciliaciones: "
             "respuestas directas para llevar la contabilidad de tu pyme al día.",
        temas="IVA, F22, regímenes, libros y conciliaciones",
    ),
    dict(
        id="remuneraciones", nombre="Remuneraciones y finiquitos", num="02",
        archivo="remuneraciones.html", data=faq_remuneraciones.FAQS,
        desc="Sueldos, cotizaciones, finiquitos, vacaciones y Ley Karin: qué exige la "
             "normativa laboral chilena y cómo calcular cada pago sin errores.",
        temas="sueldos, cotizaciones, finiquitos y vacaciones",
    ),
    dict(
        id="acompanamiento", nombre="Acompañamiento contable", num="03",
        archivo="acompanamiento-contable.html", data=faq_acompanamiento.FAQS,
        desc="Cómo trabajar con un contador externo, qué información entregar cada mes, "
             "plazos de respuesta y control de la gestión de tu pyme.",
        temas="trabajo mensual, entregables y plazos",
    ),
    dict(
        id="tributaria", nombre="Asesoría tributaria", num="04",
        archivo="asesoria-tributaria.html", data=faq_tributaria.FAQS,
        desc="Fiscalizaciones, rectificatorias, devoluciones, prescripción y defensa ante "
             "el SII: qué hacer cuando llega una carta y cómo responder a tiempo.",
        temas="fiscalización, rectificatorias, devoluciones y SII",
    ),
    dict(
        id="pymes", nombre="Emprendedores y Pymes", num="05",
        archivo="emprendedores-pymes.html", data=faq_pymes.FAQS,
        desc="Inicio de actividades, régimen simplificado, boletas de honorarios y primeros "
             "empleados: los pasos formales para partir bien en Chile.",
        temas="inicio de actividades, régimen simplificado y honorarios",
    ),
    dict(
        id="respaldo", nombre="Respaldo y confidencialidad", num="06",
        archivo="respaldo-confidencialidad.html", data=faq_respaldo.FAQS,
        desc="Quién ve tus documentos, cómo se resguarda la información contable, respaldos "
             "y qué pasa con tus datos si terminas la asesoría.",
        temas="acceso a documentos, respaldos y confidencialidad",
    ),
    dict(
        id="prevencion", nombre="Prevención de riesgos", num="07",
        archivo="prevencion-riesgos.html", data=faq_prevencion.FAQS,
        desc="Obligaciones del empleador, MIPER, mutualidades, accidentes y fiscalizaciones "
             "de la Dirección del Trabajo explicadas para pymes.",
        temas="MIPER, mutualidades, accidentes y fiscalización",
    ),
]

TOTAL = sum(len(s["data"]) for s in SECCIONES)
DESTACADAS = [s["data"][i] for s in SECCIONES for i in (0, 2, 5, 9) if i < len(s["data"])]

CSS = ('<link rel="stylesheet" href="/css/styles.css?v=00000000" />\n'
       '  <script defer src="/js/main.js?v=00000000"></script>')


def head(titulo, desc, slug, og_desc, og_titulo=None):
    """Cabecera común: canonical, Open Graph y Twitter con el mismo texto."""
    og_titulo = og_titulo or titulo
    return f"""<!DOCTYPE html>
<html lang="es-CL">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{H.escape(titulo)}</title>
  <meta name="description" content="{H.escape(desc, quote=True)}" />
  <meta name="author" content="JMV Consultores" />
  <meta name="theme-color" content="#ffffff" />
  <link rel="canonical" href="{BASE}{slug}" />

  <meta property="og:type" content="website" />
  <meta property="og:title" content="{H.escape(og_titulo, quote=True)}" />
  <meta property="og:description" content="{H.escape(og_desc, quote=True)}" />
  <meta property="og:url" content="{BASE}{slug}" />
  <meta property="og:locale" content="es_CL" />
  <meta property="og:site_name" content="JMV Consultores" />
  <meta property="og:image" content="{BASE}assets/og-image.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="JMV Consultores — contabilidad, remuneraciones y asesoría tributaria en Chile" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{H.escape(og_titulo, quote=True)}" />
  <meta name="twitter:description" content="{H.escape(og_desc, quote=True)}" />
  <meta name="twitter:image" content="{BASE}assets/og-image.png" />

  <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg" />
  {CSS}
</head>
<body>

<!--SITE_HEADER-->
"""


def migas(items):
    """items: [(texto, href|None)] — el último lleva aria-current."""
    lis = []
    for i, (texto, href) in enumerate(items):
        if i == len(items) - 1:
            lis.append(f'            <li aria-current="page">{H.escape(texto)}</li>')
        else:
            lis.append(f'            <li><a href="{href}">{H.escape(texto)}</a></li>')
    return ("""        <nav class="breadcrumb" aria-label="Ruta de navegación">
          <ol>
%s
          </ol>
        </nav>""" % "\n".join(lis))


def migas_jsonld(items):
    nodos = []
    for i, (texto, href) in enumerate(items, 1):
        nodo = {"@type": "ListItem", "position": i, "name": texto}
        if href:
            nodo["item"] = BASE.rstrip("/") + href
        nodos.append(nodo)
    return json.dumps({"@context": "https://schema.org", "@type": "BreadcrumbList",
                       "itemListElement": nodos}, ensure_ascii=False, indent=2)


def item_faq(q, a, num, extra=""):
    return (
        '          <details class="faq__item" data-q="' + H.escape(q.lower(), quote=True) + '"' + extra + '>\n'
        f'            <summary><span class="faq__num gradient-text">{num:02d}</span>{H.escape(q)}</summary>\n'
        f'            <p>{H.escape(a)}</p>\n'
        '          </details>'
    )


BUSCADOR_JS = """
  <script>
  (function () {
    var input = document.getElementById("faqSearch");
    var items = Array.prototype.slice.call(document.querySelectorAll(".faq__item"));
    var count = document.getElementById("faqCount");
    if (!input || !count) return;
    var total = items.length;
    input.addEventListener("input", function () {
      var q = input.value.trim().toLowerCase();
      if (!q) {
        items.forEach(function (el) { el.hidden = false; });
        count.textContent = total + " preguntas en esta página";
        return;
      }
      var visibles = 0;
      items.forEach(function (el) {
        var match = (el.getAttribute("data-q") || "").indexOf(q) !== -1 ||
                    (el.textContent || "").toLowerCase().indexOf(q) !== -1;
        el.hidden = !match;
        if (match) visibles++;
      });
      count.textContent = visibles === 0
        ? "Sin resultados. Escríbenos y te responde un contador."
        : visibles + " de " + total + " preguntas coinciden";
    });
  })();
  </script>"""


def buscador(texto_ayuda):
    return f"""        <div class="faq-search">
          <label for="faqSearch">Busca por palabra clave</label>
          <input type="search" id="faqSearch" placeholder="Ej.: finiquito, F22, MIPER, boleta de honorarios" />
        </div>
        <p class="faq-search__hint" id="faqCount" aria-live="polite">{texto_ayuda}</p>"""


def cta(titulo, texto, boton="Preguntar por WhatsApp"):
    return f"""    <section class="cta">
      <div class="container cta__inner">
        <h2>{titulo}</h2>
        <p>{texto}</p>
        <a href="https://wa.me/{WA}?text=Hola%2C%20tengo%20una%20consulta" class="btn btn--light btn--lg" target="_blank" rel="noopener">{boton}</a>
      </div>
    </section>"""


# ── índice ───────────────────────────────────────────────────────────────────
def pagina_indice():
    tarjetas = []
    for s in SECCIONES:
        n = len(s["data"])
        tarjetas.append(f"""            <a class="card card--link" href="/{s['slug']}.html">
              <span class="card__num">{s['num']} · {n} preguntas</span>
              <h2 class="card__title">{H.escape(s['nombre'])}</h2>
              <p class="card__text">{H.escape(s['desc'])}</p>
              <span class="card__link">Ver las {n} respuestas <span class="svc__hint-arrow" aria-hidden="true">→</span></span>
            </a>""")

    destacadas = "\n".join(
        item_faq(q, a, i) for i, (q, a) in enumerate(DESTACADAS, 1)
    )
    nav = " ".join(
        f'<a href="/{s["slug"]}.html" class="related__link">{s["num"]} · {H.escape(s["nombre"])} '
        '<span class="svc__hint-arrow" aria-hidden="true">→</span></a>'
        for s in SECCIONES
    )
    items_migas = [("Inicio", "/"), ("Preguntas frecuentes", None)]

    return head(
        f"Preguntas frecuentes — {TOTAL} respuestas para pymes | JMV Consultores",
        f"{TOTAL} respuestas claras sobre contabilidad, remuneraciones, impuestos, finiquitos y "
        "prevención de riesgos para pymes chilenas, organizadas por tema.",
        "preguntas-frecuentes.html",
        "Respuestas claras sobre contabilidad, remuneraciones, finiquitos, impuestos y prevención de riesgos, organizadas por tema.",
        f"{TOTAL} preguntas frecuentes — JMV Consultores",
    ) + f"""
<main id="contenido">
    <section class="page-head">
      <div class="container">
{migas(items_migas)}
        <div class="detail__head">
          <p class="page-head__eyebrow">Centro de ayuda</p>
          <h1>Preguntas frecuentes de contabilidad y tributación</h1>
          <p>{TOTAL} respuestas directas, en tu idioma y sin letra chica, repartidas en siete temas. Si tu duda no está aquí, escríbenos: responde un contador, no un bot.</p>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <p class="section__eyebrow">Por tema</p>
        <h2 class="section__title">Siete bloques, {TOTAL} respuestas</h2>
        <p class="section__lead">Cada bloque cubre un servicio y responde lo que más nos preguntan por WhatsApp. Elige el tema que se parece a tu caso.</p>
        <div class="grid grid--3" style="margin-top:24px">
{chr(10).join(tarjetas)}
        </div>
      </div>
    </section>

    <section class="section section--alt">
      <div class="container">
        <p class="section__eyebrow">Las más consultadas</p>
        <h2 class="section__title">Las {len(DESTACADAS)} preguntas que más nos hacen</h2>
{buscador(f"{len(DESTACADAS)} preguntas en esta página")}
        <div class="faq__list" id="faqLista" style="margin-top:18px">
{destacadas}
        </div>

        <div class="related">
          <p class="related__title">Ir al bloque completo</p>
          <div class="related__links">
            {nav}
          </div>
        </div>
      </div>
    </section>

{cta(f'¿Tu duda no está entre las {TOTAL}?', 'Escríbenos y te responde un contador, no un bot. La primera consulta es gratis.')}
</main>

<!--SITE_FOOTER-->
{BUSCADOR_JS}

  <script type="application/ld+json">
  {{
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": {json.dumps([{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in DESTACADAS], ensure_ascii=False)}
  }}
  </script>
  <script type="application/ld+json">
{migas_jsonld(items_migas)}
  </script>

</body>
</html>
"""


# ── páginas por tema ─────────────────────────────────────────────────────────
def pagina_seccion(s):
    n = len(s["data"])
    items = "\n".join(item_faq(q, a, i) for i, (q, a) in enumerate(s["data"], 1))
    otras = [o for o in SECCIONES if o is not s]
    nav = " ".join(
        f'<a href="/{o["slug"]}.html" class="related__link">{o["num"]} · {H.escape(o["nombre"])} '
        '<span class="svc__hint-arrow" aria-hidden="true">→</span></a>'
        for o in otras
    )
    items_migas = [("Inicio", "/"), ("Preguntas frecuentes", "/preguntas-frecuentes.html"),
                   (s["nombre"], None)]

    return head(
        f"{s['nombre']} — {n} preguntas frecuentes | JMV Consultores",
        s["desc"], f"{s['slug']}.html",
        f"{n} respuestas sobre {s['temas']} para pymes chilenas.",
        f"{s['nombre']}: {n} preguntas frecuentes",
    ) + f"""
<main id="contenido">
    <section class="page-head">
      <div class="container">
{migas(items_migas)}
        <div class="detail__head">
          <p class="page-head__eyebrow">Centro de ayuda · {s['num']}</p>
          <h1>{H.escape(s['nombre'])}: {n} preguntas frecuentes</h1>
          <p>{H.escape(s['desc'])}</p>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
{buscador(f"{n} preguntas en esta página")}
        <div class="faq__list" id="faqLista" style="margin-top:18px">
{items}
        </div>

        <div class="faq__blocknav">
          <a href="/{s['archivo']}" class="related__link">Ver el servicio {s['num']} completo <span class="svc__hint-arrow" aria-hidden="true">→</span></a>
        </div>

        <div class="related">
          <p class="related__title">Otros temas del centro de ayuda</p>
          <div class="related__links">
            {nav}
          </div>
        </div>
      </div>
    </section>

{cta(f'¿Tu caso es de {H.escape(s["nombre"].lower())}?', 'Cuéntanos qué pasa y te decimos qué revisar primero. La primera consulta es gratis.')}
</main>

<!--SITE_FOOTER-->
{BUSCADOR_JS}

  <script type="application/ld+json">
  {{
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": {json.dumps([{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in s["data"]], ensure_ascii=False)}
  }}
  </script>
  <script type="application/ld+json">
{migas_jsonld(items_migas)}
  </script>

</body>
</html>
"""


def escribir(nombre, html_out):
    ruta = os.path.join(RAIZ, nombre)
    with open(ruta, "w", encoding="utf-8", newline="\n") as f:
        f.write(versionar_html(html_out))
    print(f"OK {nombre} — {len(versionar_html(html_out)) / 1024:.1f} KB")


def build():
    for s in SECCIONES:
        s["slug"] = "faq-" + s["id"]
    escribir("preguntas-frecuentes.html", pagina_indice())
    for s in SECCIONES:
        escribir(s["slug"] + ".html", pagina_seccion(s))
    print(f"Total: {TOTAL} preguntas en {len(SECCIONES) + 1} páginas")


if __name__ == "__main__":
    build()
