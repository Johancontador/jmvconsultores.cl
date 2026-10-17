# Sitio técnico: servicio, 404, URLs y tests

Este documento explica cómo se publica `jmvconsultores.cl` y qué reglas fija
`tests/sitio.test.mjs`. Si algo de esto se cambia sin actualizar los tests, la
suite falla — es intencional.

## Cómo se sirve

| Pieza | Dónde |
|---|---|
| Contenido | este repo, en `/home/johan/jmv-www` |
| Proceso | `jmv-www.service` (siempre activo) |
| Comando | `python3 deploy/serve.py` |
| Puerto | `8090`, solo local (`127.0.0.1`/túnel de Cloudflare) |

Antes se usaba `python3 -m http.server`, que publicaba **todo** el directorio:
`/.git/config`, los generadores `.py`, `docs/`, `deploy/` y `data/` respondían
200. Además su 404 era la página gris del módulo, sin marca.

`deploy/serve.py` es un servidor estático mínimo (solo stdlib) con estas reglas:

- **Allowlist.** Se sirven `index.html`, `404.html`, `robots.txt`, `sitemap.xml`,
  cualquier `slug.html` de la raíz y archivos de `css/`, `js/` y `assets/` con
  extensiones permitidas. Todo lo demás responde **404** sin filtrar contenido.
- **404 propia.** Cualquier ruta inexistente devuelve `404.html` con estado
  `404` (y `noindex`).
- **Una URL por contenido.** `/remuneraciones` y `/remuneraciones/` redirigen
  `301` a `/remuneraciones.html`, que es el `canonical`; `/index.html` redirige
  a `/`. No se sirve el mismo contenido en dos URLs.
- **Sin listado de directorios.**
- **Headers.** `X-Content-Type-Options: nosniff`, `Referrer-Policy:
  strict-origin-when-cross-origin`, `X-Frame-Options: SAMEORIGIN`,
  `Permissions-Policy` restrictiva. HTML con `Cache-Control: no-cache` (un
  despliegue se ve al instante); CSS/JS/imágenes con un día de caché.

Prueba local:

```bash
PORT=8090 python3 deploy/serve.py
# y en otra terminal
node --test tests/sitio.test.mjs
```

## Qué fija la suite (`tests/sitio.test.mjs`)

Levanta el servidor real en un puerto efímero y le pide cada página por HTTP:

| Test | Regla |
|---|---|
| T1 | cada URL del sitemap responde 200 y su `canonical` coincide |
| T2 | `robots.txt` apunta al sitemap y el sitemap lista **exactamente** las páginas del disco |
| T3 | `title`, `description`, `canonical` y `og:url` únicos por página; ninguna `noindex` |
| T4 | URL inexistente → 404 con la página propia |
| T5 | `.git/`, `*.py`, `docs/`, `deploy/`, `data/` dan 404 |
| T6 | URLs limpias redirigen a la canónica, sin duplicar |
| T7 | headers de seguridad y de caché |
| T8 | ningún enlace interno roto |
| T9 | `og:image` real (PNG 1200×630) + `twitter:card` en todas las páginas |
| T10 | todas las páginas llevan a la app (`app.jmvconsultores.cl`) |
| T11 | sin listado de directorios |

## Generadores

`gen_servicios.py` (7 páginas de servicio) y `gen_faq_central.py` (FAQ central)
escriben HTML completo. **Los arreglos de estructura van en el generador, no en
el HTML**: si se edita a mano una página generada, la siguiente corrida lo
borra. `index.html` es la única página escrita a mano.

```bash
python3 gen_servicios.py      # reescribe las páginas de servicio
python3 gen_faq_central.py    # reescribe preguntas-frecuentes.html
node --test tests/sitio.test.mjs
```

## Tarjeta social (`assets/og-image.png`)

Fuente: `deploy/og-card.html` (1200×630). Para regenerarla:

```bash
google-chrome --headless --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1200,630 --virtual-time-budget=4000 \
  --screenshot=assets/og-image.png deploy/og-card.html
```

T9 comprueba que el PNG existe, mide 1200×630 y que todas las páginas lo
declaran en `og:image`.

## Desplegar

El sitio se sirve desde el working tree del repo: no hay build.

```bash
cd /home/johan/jmv-www
git status                # debe estar limpio
# (traer/copiar los archivos)
node --test tests/sitio.test.mjs
sudo systemctl restart jmv-www
curl -sI https://jmvconsultores.cl/ | head -5
```

El 404, los headers y los redirects no necesitan reload de nginx: los aplica
el proceso del sitio.

## Nota sobre la copia antigua en `/var/www/jmvconsultores.cl`

Existe una copia sin uso (la dejaba un bloque de nginx en el puerto 8081, hoy
inactivo). El sitio vivo es `/home/johan/jmv-www`. No editar `/var/www`.
