# Sitio público — arquitectura, URLs y pendientes

> Estado: **implementado y verificado** (2026-10-17). Este documento explica cómo
> está armado el sitio corporativo, qué decisiones se tomaron y qué falta por
> completar. El sitio privado (`/sistema/`) no se toca desde acá.

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

## 8. Validación en producción (cuando se autorice el despliegue)

```bash
npm run seed:v && npm test          # 491 tests
git push vps master                  # hook → build desacoplado
# luego, contra el dominio:
curl -sI https://jmvconsultores.cl/servicios/ | head -1
curl -s  https://jmvconsultores.cl/sitemap.xml | grep -c '<loc>'
curl -s  https://jmvconsultores.cl/robots.txt
```

Después, en Search Console: verificar la propiedad del dominio y enviar
`sitemap.xml`. La indexación no es inmediata ni está garantizada.
