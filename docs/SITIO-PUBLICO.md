# Sitio público — arquitectura, URLs y pendientes

> Estado: **implementado y desplegado** (2026-10-17). Este documento explica cómo
> está armado el sitio, qué decisiones se tomaron y qué falta por completar. El
> sitio privado (`/sistema/`) no se toca desde acá.
>
> ⚠️ **Leer §9 primero: hay DOS sitios.** El corporativo canónico
> (`https://jmvconsultores.cl`) lo sirve otro host y ya existía; lo de este repo
> se publica en `https://app.jmvconsultores.cl` y va `noindex`.

## 1. Decisiones de arquitectura

- **Sitio estático multipágina, sin build.** Se sirve con `express.static` desde
  `frontend/`. No se agregó framework ni generador: el tráfico actual no lo
  justifica y una migración habría puesto en riesgo la landing que ya funcionaba.
- **URLs limpias por carpeta.** Cada página vive en `frontend/<ruta>/index.html`,
  así que `/servicios/contabilidad/` se sirve sin extensión. `/servicios` (sin
  barra) responde 301 a la forma con barra.
- **Un solo sistema visual.** Todo el sitio público carga `frontend/css/sitio.css`
  (tokens marfil/grafito/bronce, Sora + Inter, 16 px de base). Las páginas nuevas
  **no** agregan colores ni tipografías: reutilizan `pv-*`. La app (`/css/app.css`)
  sigue aislada.
- **Chrome compartido sin template engine.** El encabezado y el pie están
  duplicados en cada HTML (no hay build). Para que no divergan, `test/sitio-seo.test.js`
  (T8) exige en **todas** las páginas públicas el mismo menú, el burger con su
  drawer, el pie con las tres legales y el skip-link. Si una página queda sin
  menú móvil, el test falla.
- **Menú móvil y redes, en archivos compartidos**: `/shared/sitio-nav.js`
  (drawer accesible + año del pie) y `/shared/sitio-social.js` (perfiles
  sociales centralizados; sin URL configurada el bloque queda oculto).

## 2. Mapa de URLs

| URL | Archivo | Indexable | Contenido |
|---|---|---|---|
| `/` | `frontend/landing.html` | sí | Landing comercial (hero, servicios, plataforma, método, FAQ, contacto, acceso) |
| `/servicios/` | `frontend/servicios/index.html` | sí | Catálogo de los 6 servicios |
| `/servicios/contabilidad/` | `…/servicios/contabilidad/index.html` | sí | Servicio |
| `/servicios/remuneraciones/` | `…/servicios/remuneraciones/index.html` | sí | Servicio |
| `/servicios/cumplimiento-tributario/` | `…/cumplimiento-tributario/index.html` | sí | Servicio |
| `/servicios/asesoria/` | `…/servicios/asesoria/index.html` | sí | Servicio |
| `/servicios/emprendedores-pymes/` | `…/emprendedores-pymes/index.html` | sí | Servicio |
| `/servicios/prevencion-de-riesgos/` | `…/prevencion-de-riesgos/index.html` | sí | Servicio |
| `/nosotros/` | `frontend/nosotros/index.html` | sí | Metodología, principios y qué se puede verificar |
| `/privacidad/` | `frontend/privacidad/index.html` | sí | Tratamiento real de datos |
| `/cookies/` | `frontend/cookies/index.html` | sí | Cookies reales (solo `sid` de sesión) |
| `/terminos/` | `frontend/terminos/index.html` | sí | Condiciones de uso y servicio |
| `/login.html` | `frontend/login.html` | no (`noindex`) | Acceso de clientes |
| `/registro.html` | `frontend/registro.html` | no (`noindex`) | Alta con RUT + clave SII |
| `/sistema/` | `frontend/sistema/index.html` | no (`noindex` + robots) | Aplicación privada (requiere sesión) |
| `/*.html` heredadas | `index`, `dashboard`, `informe`, `libro`, `proceso`, `configuracion`, `exportacion-masiva` | no (`noindex`) | Pantallas internas antiguas |
| cualquier otra | `frontend/404.html` | no | 404 con identidad + salidas |

## 3. SEO técnico

- `frontend/robots.txt`: `Allow: /`, `Disallow: /sistema/` y `/api/`, más la
  línea `Sitemap:`. Las páginas de acceso e internas **no** se desautorizan a
  propósito: llevan `noindex` en su HTML, y bloquear el rastreo impediría leerlo.
- `frontend/sitemap.xml`: solo las 12 URLs indexables. Un test verifica que cada
  `<loc>` exista en disco y que no se liste nada con `noindex`.
- Cada página pública tiene `title` único, `meta description`, `canonical`,
  Open Graph/Twitter y **JSON-LD**: `ProfessionalService` en la portada,
  `CollectionPage` en el catálogo, `Service` en cada servicio, `AboutPage` en
  nosotros y `WebPage` en las legales.
- Sin datos inventados: **no se publica dirección, RUT ni horario** (decisión del
  propietario), y el bloque de redes queda oculto hasta que exista URL real.

## 4. Accesibilidad aplicada

Skip-link en todas las páginas, `aria-current="page"` en la sección activa,
migas de pan con `aria-label`, menú móvil con `aria-expanded`/`aria-controls`,
cierre con `Escape` devolviendo el foco, foco visible con `:focus-visible`,
`prefers-reduced-motion` respetado, contraste sobre tokens AA y formularios con
`label` asociado y mensajes de error con `role="alert"`.

## 5. Anti-caché (importante al editar)

El nginx del VPS fija `max-age=14400` a los `.css`/`.js`. Por eso **antes de
commitear cualquier cambio en `frontend/`** hay que correr `npm run seed:v`:
versiona cada referencia con el sha1 del contenido. El script ahora **descubre
todas las páginas** (antes era una lista fija y las nuevas quedaban sin versión).
`test/sitio-seo.test.js` (T9) falla si una referencia pública queda sin `?v=`.

## 6. Pendientes que requieren información del propietario

1. **Redes sociales**: pegar la URL real en `frontend/shared/sitio-social.js`
   (`CONFIG.linkedin` / `instagram` / `facebook`). Sin URL, el bloque no se muestra.
2. **Datos corporativos** (razón social, RUT, dirección, teléfono fijo, horario):
   hoy el pie y el JSON-LD usan solo WhatsApp + correo por decisión explícita.
3. **Fotografía y trayectoria del responsable**, si se autoriza publicarlas.
4. **Testimonios/casos reales** con autorización: mientras no existan, la
   credibilidad se sostiene en la metodología (ya publicado así).
5. **Blog y recursos**: no hay contenido ni autoría verificable todavía; se
   publicará cuando exista, para no crear páginas vacías.
6. **Revisión legal** de `/privacidad/`, `/cookies/` y `/terminos/`: describen el
   funcionamiento real, pero deben validarse con abogado.

## 7. Deuda conocida

- El encabezado y el pie se repiten en cada HTML (sin build). Aceptado a cambio
  de no introducir un paso de compilación; los tests cubren la consistencia.
- `/landing.html` sigue accesible y duplica `/`; el `canonical` de la landing
  apunta a `/`, que es la URL canónica.
- No hay página de contacto independiente: el formulario vive en `/#contacto` y
  todas las páginas apuntan ahí. Si se quiere `/contacto/`, hay que mover el JS
  del formulario a un archivo compartido.

## 8. Validación en producción

```bash
npm run seed:v && npm test           # suite completa
git push vps master                   # hook → build desacoplado
# contra el host que sirve este repo:
curl -sI https://app.jmvconsultores.cl/servicios/ | head -1
curl -s  https://app.jmvconsultores.cl/sitemap.xml | grep -c '<loc>'
curl -s  https://app.jmvconsultores.cl/robots.txt
```

## 9. Dos sitios: hallazgo del despliegue (2026-10-17)

Al desplegar se verificó que **el dominio de marca no lo sirve este repo**:

| Host | Quién sirve | Qué publica |
|---|---|---|
| `https://jmvconsultores.cl` | servicio `jmv-www` (`python3 -m http.server`, dir `/home/johan/jmv-www`, repo **propio** con el remoto de GitHub) | Sitio corporativo con 9 páginas (`index`, `contabilidad-completa`, `remuneraciones`, `acompanamiento-contable`, `asesoria-tributaria`, `emprendedores-pymes`, `respaldo-confidencialidad`, `prevencion-riesgos`, `preguntas-frecuentes`), su propio `robots.txt` y `sitemap.xml` |
| `https://app.jmvconsultores.cl` | este repo (contenedor `iva-mensual`) | La app + la landing + las 11 páginas de este trabajo |

Decisiones tomadas para no romper nada:

1. Las 11 páginas de este repo llevan **`noindex, nofollow`** y su `canonical`
   apunta a la URL real que las sirve (`app.jmvconsultores.cl`). Antes declaraban
   canónicos a `jmvconsultores.cl/servicios/…`, que en ese host **no existen** (404):
   eso se corrigió en el mismo despliegue.
2. `robots.txt` de este host desautoriza esas rutas y su `sitemap.xml` lista solo
   la portada: así no se compite ni se duplica el sitio de marca.
3. El repo `jmv-www` **no se tocó** (tenía cambios sin commitear de una sesión
   anterior; reemplazarlo habría sido destructivo).

**Decisión tomada: A — consolidar en el dominio de marca** (autorizada 2026-10-17).

El sitio corporativo sigue en su repo (`jmv-www`), que es el canónico; este repo
mantiene la app y sus páginas públicas como vista previa `noindex` (§2).

### 9.1 Lo hecho en `jmv-www` (3 commits, 2026-10-17)

| Commit | Qué |
|---|---|
| `59a73cd` | Se commitea el trabajo pendiente que existía en el servidor: acceso a clientes (`app.jmvconsultores.cl`) en la barra y el pie de las 9 páginas. Antes vivía solo en el disco del VPS. |
| `50c9dd4` | `deploy/serve.py` reemplaza a `python3 -m http.server`; `404.html` propia; 301 de URLs limpias a la canónica; headers de seguridad; tarjeta social `og-image.png` (1200×630); `tests/sitio.test.mjs`. |
| `812e4c4` | Arreglo del fondo 3D con `prefers-reduced-motion` y versionado `?v=<sha1>` de css/js. |

Hallazgos que justificaron el cambio:

- **El repositorio se publicaba.** `/.git/config` (con la URL del remoto),
  `gen_servicios.py`, `docs/`, `deploy/` y `data/` respondían **200** en
  producción.
- **La 404 era la del módulo**, sin marca ni enlaces de recuperación.
- **Los arreglos se perdían al regenerar**: el trabajo pendiente estaba editado
  a mano sobre HTML generado por `gen_servicios.py` / `gen_faq_central.py`. Ahora
  el acceso a la app y los metadatos viven en los generadores (verificado: los
  generadores reproducen los HTML byte a byte).
- **`bg3d.js` fallaba con `prefers-reduced-motion`**: `resize()` corría antes de
  inicializar `parts`/`mx` (ReferenceError), y el fondo quedaba en blanco justo
  para quien pide menos animación.
- **Cloudflare cachea `.css`/`.js` 4 h** y el navegador por heurística: se vio en
  vivo (Chrome sirvió un `bg3d.js` viejo). De ahí el `?v=<sha1>`.

Reglas fijadas por `tests/sitio.test.mjs` (12 tests, `npm test`): sitemap↔disco,
canonical/OG únicos, 404 propia, repo no público, URLs limpias, headers, enlaces
internos, tarjeta social, acceso a la app, sin listado de directorios y
versionado de estáticos. Detalle en `jmv-www:docs/SITIO-TECNICO.md`.

### 9.2 Cambio de servicio aplicado (2026-10-17)

`jmv-www.service` ya ejecuta `python3 /home/johan/jmv-www/deploy/serve.py`
(unit idéntico al versionado en `deploy/jmv-www.service`; se aplicó con
`sudo install` + `daemon-reload` + `restart`).

Verificado en producción después del cambio:

- 9 páginas, `robots.txt`, `sitemap.xml`, `og-image.png`, `css/` y `js/`: **200**.
- `/.git/config`, `/.git/HEAD`, `gen_servicios.py`, `gen_faq_central.py`,
  `README.md`, `docs/`, `deploy/`, `data/`, `tests/`, `package.json`,
  `/.gitignore`, `/css/` y `/js/`: **404**.
- URL inexistente: **404** con `404.html` (título «Página no encontrada»,
  `noindex`, enlaces de recuperación y acceso a la app); ninguna huella de la
  404 del módulo.
- `/index.html` → 301 a `/`; `/remuneraciones` y `/remuneraciones/` → 301 a
  `/remuneraciones.html`.
- Headers en HTML: `nosniff`, `SAMEORIGIN`, `strict-origin-when-cross-origin`,
  `Permissions-Policy`, `Cache-Control: no-cache`.
- Chrome real a 390 px en las 9 páginas + 404: sin desbordes, sin errores de
  consola, fondo 3D activo, `og:image` presente. La 404 carga el CSS y el logo
  correctamente.
- `npm test` del sitio (12 tests) verde en el VPS.

Nota de caché: Cloudflare sigue sirviendo `.css`/`.js` con `max-age=14400`
(HIT) aunque el origen envíe otro valor; por eso el `?v=<sha1>` es lo que
garantiza que un cambio de estilos se vea al instante. El HTML queda `DYNAMIC`
(sin caché de borde).

### 9.3 Riesgo residual

- **Copia obsoleta** en `/var/www/jmvconsultores.cl` (la dejaba un bloque de
  nginx en el 8081, hoy inactivo). El sitio vivo es `/home/johan/jmv-www`. No
  editarla: si algún día se reactiva nginx, serviría contenido viejo.
- **Dos túneles** `cloudflared` activos (`cloudflared.service` y
  `jmv-tunnel.service`); el del sitio es `jmv-tunnel`. Conviene apagar el otro si
  no tiene un uso concreto.
- El repo `jmv-www` tiene **3 commits locales sin push** a GitHub: se commiteó en
  el VPS para no perder el trabajo, no se publicó.
