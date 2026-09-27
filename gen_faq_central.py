#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_faq_central.py — Genera preguntas-frecuentes.html con las 350 FAQ
(portada de 50 destacadas con buscador + 7 bloques temáticos de 50).
Correr después de editar data/faq_*.py:  python3 gen_faq_central.py
"""
import html as H
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
import faq_contabilidad, faq_remuneraciones, faq_acompanamiento
import faq_tributaria, faq_pymes, faq_respaldo, faq_prevencion

WA = "56975752213"

SECCIONES = [
    dict(id="contabilidad-completa", nombre="Contabilidad completa",
         archivo="contabilidad-completa.html", num="01", data=faq_contabilidad.FAQS),
    dict(id="remuneraciones", nombre="Remuneraciones y finiquitos",
         archivo="remuneraciones.html", num="02", data=faq_remuneraciones.FAQS),
    dict(id="acompanamiento-contable", nombre="Acompañamiento contable",
         archivo="acompanamiento-contable.html", num="03", data=faq_acompanamiento.FAQS),
    dict(id="asesoria-tributaria", nombre="Asesoría tributaria",
         archivo="asesoria-tributaria.html", num="04", data=faq_tributaria.FAQS),
    dict(id="emprendedores-pymes", nombre="Emprendedores y Pymes",
         archivo="emprendedores-pymes.html", num="05", data=faq_pymes.FAQS),
    dict(id="respaldo-confidencialidad", nombre="Respaldo y confidencialidad",
         archivo="respaldo-confidencialidad.html", num="06", data=faq_respaldo.FAQS),
    dict(id="prevencion-riesgos", nombre="Prevención de riesgos",
         archivo="prevencion-riesgos.html", num="07", data=faq_prevencion.FAQS),
]

TOTAL = sum(len(s["data"]) for s in SECCIONES)
DESTACADAS = [s["data"][i] for s in SECCIONES for i in (0, 2, 5, 9) if i < len(s["data"])]  # 28 preguntas más buscadas

def bloques():
    out = []
    for s in SECCIONES:
        items = []
        for i, (q, a) in enumerate(s["data"], 1):
            num = f"{i:02d}"
            items.append(
                '        <details class="faq__item" data-q="' + H.escape(q.lower(), quote=True) + '">\n'
                f'          <summary><span class="faq__num gradient-text">{num}</span>{H.escape(q)}</summary>\n'
                f'          <p>{H.escape(a)}</p>\n'
                '        </details>'
            )
        items_html = "\n".join(items)
        out.append(f'''
      <p class="section__eyebrow reveal" style="text-align:left;margin-top:44px" id="{s["id"]}">{s["nombre"]} · {len(s["data"])} preguntas</p>
      <div class="faq__blocknav reveal">
        <a href="{s["archivo"]}" class="related__link">Ver el servicio {s["num"]} <span class="svc__hint-arrow">→</span></a>
      </div>
      <div class="faq__list" style="margin-top:14px">
{items_html}
      </div>''')
    return "\n".join(out)

def nav():
    links = " ".join(
        f'<a href="#{s["id"]}" class="related__link">{s["num"]} · {H.escape(s["nombre"])} <span class="svc__hint-arrow">→</span></a>'
        for s in SECCIONES
    )
    return links

def destacadas_html():
    items = []
    for i, (q, a) in enumerate(DESTACADAS, 1):
        num = f"{i:02d}"
        items.append(
            '        <details class="faq__item" data-q="' + H.escape(q.lower(), quote=True) + '">\n'
            f'          <summary><span class="faq__num gradient-text">{num}</span>{H.escape(q)}</summary>\n'
            f'          <p>{H.escape(a)}</p>\n'
            '        </details>'
        )
    return "\n".join(items)

def jsonld_all():
    main = []
    for s in SECCIONES:
        for q, a in s["data"]:
            main.append({"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}})
    return json.dumps({"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": main},
                      ensure_ascii=False, indent=2)

TEMPLATE = """<!DOCTYPE html>
<html lang="es-CL">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Preguntas frecuentes — {total} respuestas para tu negocio | JMV Consultores</title>
  <meta name="description" content="{total} preguntas frecuentes sobre contabilidad, finiquitos, Ley Papito Corazón, impuestos, F22, prevención de riesgos y más. Respuestas claras para pymes chilenas." />
  <meta name="author" content="JMV Consultores" />
  <meta name="theme-color" content="#0a0e1a" />
  <link rel="canonical" href="https://jmvconsultores.cl/preguntas-frecuentes.html" />

  <meta property="og:type" content="website" />
  <meta property="og:title" content="{total} preguntas frecuentes — JMV Consultores" />
  <meta property="og:description" content="Respuestas claras sobre contabilidad, remuneraciones, finiquitos, impuestos y prevención de riesgos para pymes chilenas." />
  <meta property="og:url" content="https://jmvconsultores.cl/preguntas-frecuentes.html" />
  <meta property="og:locale" content="es_CL" />

  <link rel="icon" type="image/svg+xml" href="assets/favicon.svg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@600&display=swap" />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@600&display=swap" media="print" onload="this.media='all'" />
  <noscript>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@600&display=swap" />
  </noscript>

  <link rel="stylesheet" href="css/styles.css" />
  <script defer src="js/bg3d.js"></script>
  <script defer src="js/main.js"></script>
</head>
<body>

  <canvas id="bg3d" aria-hidden="true"></canvas>

  <header class="topbar">
    <div class="container topbar__inner">
      <a href="index.html" class="topbar__logo-link" aria-label="JMV Consultores — volver al inicio"><img src="assets/logo-light.svg" alt="JMV Consultores" class="topbar__logo" /></a>
      <a href="#contacto" class="btn btn--primary btn--sm">Consulta gratis</a>
    </div>
  </header>

  <main class="detail">
    <div class="container">
      <a class="crumb" href="index.html"><span class="contact__arrow">←</span> Volver al inicio</a>

      <div class="detail__head">
        <span class="detail__num gradient-text">{total}</span>
        <p class="section__eyebrow reveal" style="text-align:left">Centro de ayuda · Respuestas reales</p>
        <h1 class="reveal">{total} preguntas frecuentes</h1>
        <p class="reveal">Sobre contabilidad, remuneraciones, finiquitos, impuestos y prevención de riesgos.
        Respuestas directas, en tu idioma y sin letra chica. Si tu duda no está aquí, escríbenos: responde un contador, no un bot.</p>
      </div>

      <div class="faq-search reveal">
        <input type="search" id="faqSearch" placeholder="Busca tu duda: finiquito, F22, Papito Corazón, MIPER..." aria-label="Buscar en preguntas frecuentes" />
      </div>
      <p class="faq-search__hint" id="faqCount" aria-live="polite">Mostrando las {dest_num} más consultadas</p>

      <div class="faq__list" id="faqDestacadas" style="margin-top:18px">
{destacadas}
      </div>

      <div id="faqTodo" hidden>
{bloques}
      </div>

      <div class="related reveal">
        <p class="related__title">Navegar por servicio</p>
        <div class="related__links">
{nav}
        </div>
      </div>
    </div>
  </main>

  <section class="cta reveal" id="contacto">
    <div class="container cta__inner">
      <h2>¿Tu duda no está <span class="gradient-text">entre las {total}</span>?</h2>
      <p>Escríbenos y te responde un contador, no un bot. La primera consulta es gratis.</p>
      <a href="https://wa.me/{wa}?text=Hola%2C%20tengo%20una%20consulta" class="btn btn--light btn--lg" target="_blank" rel="noopener">Preguntar por WhatsApp</a>
    </div>
  </section>

  <footer class="footer">
    <div class="container footer__inner">
      <a href="index.html" aria-label="JMV Consultores — volver al inicio"><img src="assets/logo-light.svg" alt="JMV Consultores" class="footer__logo" /></a>
      <p class="footer__legal">JMV CONSULTORES SPA · contacto@jmvconsultores.cl</p>
      <p class="footer__copy">© <span id="year">2026</span> JMV Consultores · jmvconsultores.cl · <a class="footer__faq-link" href="index.html">Inicio</a></p>
    </div>
  </footer>

  <a class="wa-float" href="https://wa.me/{wa}?text=Hola%2C%20tengo%20una%20consulta" target="_blank" rel="noopener">
    <span class="wa-float__text">WhatsApp</span>
    <span class="wa-float__dot" aria-hidden="true"></span>
  </a>

  <script>
  (function () {{
    var input = document.getElementById("faqSearch");
    var items = document.querySelectorAll(".faq__item");
    var count = document.getElementById("faqCount");
    var destacadas = document.getElementById("faqDestacadas");
    var todo = document.getElementById("faqTodo");
    if (!input) return;
    input.addEventListener("input", function () {{
      var q = input.value.trim().toLowerCase();
      if (!q) {{
        destacadas.hidden = false;
        todo.hidden = true;
        count.textContent = "Mostrando las {dest_num} más consultadas";
        items.forEach(function (el) {{ el.hidden = false; }});
        return;
      }}
      destacadas.hidden = true;
      todo.hidden = false;
      var visibles = 0;
      items.forEach(function (el) {{
        var match = (el.getAttribute("data-q") || "").indexOf(q) !== -1;
        el.hidden = !match;
        if (match) visibles++;
      }});
      count.textContent = visibles === 0
        ? "Sin resultados para \\"" + input.value + "\\". Escríbenos y te respondemos hoy."
        : visibles + " respuesta" + (visibles === 1 ? "" : "s") + " para \\"" + input.value + "\\"";
    }});
  }})();
  </script>

  <script type="application/ld+json">
{jsonld}
  </script>

</body>
</html>
"""

def build():
    html_out = TEMPLATE.format(
        total=TOTAL,
        dest_num=len(DESTACADAS),
        destacadas=destacadas_html(),
        bloques=bloques(),
        nav=nav(),
        jsonld=jsonld_all(),
        wa=WA,
    )
    with open("preguntas-frecuentes.html", "w", encoding="utf-8") as f:
        f.write(html_out)
    print(f"OK preguntas-frecuentes.html — {TOTAL} FAQ ({len(DESTACADAS)} destacadas)")
if __name__ == "__main__":
    build()
