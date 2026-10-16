# Incidencia — `/sistema/` no cabe en móvil (2026-10-16)

**Severidad:** media · **Estado:** reproducida, causa raíz identificada, **sin corregir**
· **Origen:** código previo (ya en producción), **no** forma parte del rediseño del
sitio público ni del despliegue de `97934fd` / `1caacf8` / `4935f2f`.

Registrada aparte, a propósito, para corregirla sin mezclar cambios con ese despliegue.

## Síntoma

En un teléfono la app se ve «alejada»: el navegador maqueta la página más ancha que la
pantalla y la encoge (zoom-out). En producción se percibía como «desborde a ~1048 px».

## Medición (Chrome real, sesión de cliente, carga limpia por ancho)

Sesión de cliente creada para la medición (usuario temporal + vínculo a empresa, ambos
eliminados al terminar). El viewport se fija **antes** de navegar: redimensionar la
misma página invalida la emulación y falsea el resultado (fue mi primer error de
medición, descartado).

| vista | ancho de ventana | ancho maquetado | exceso |
|---|---|---|---|
| `#centro` | 390 px | **1048 px** | **658 px** |
| `#libros` | 390 px | **1124 px** | **734 px** |
| `#centro` | 1366 px | 1366 px | 0 |

Evidencia: `.gstack/sitio/sistema-390-real.png` · `sistema-390-centro.png` ·
`sistema-390-libros.png` · `sistema-movil-incidencia.png`.

El `<meta name="viewport" content="width=device-width…">` **sí está** en
`sistema/index.html`: no es un meta faltante, es contenido que no puede encogerse. Por
eso `window.innerWidth` reporta 1048 px en un teléfono de 390 px.

## Causa raíz

Cadena medida en `#centro` a 390 px:

```
div#app            w=390
 └ div.sys         w=390   (grid, una sola pista de 390px)
    └ main.sys-main w=1048  ← se desborda de su pista
       └ div.sys-header / .sys-titlebar / #sys-banner / .centro-hola / .centro-grid  w=1032
```

`.centro-grid` usa **columnas fijas de 320 px** (`.sys .centro-grid`,
`frontend/sistema/sistema.css:682`): `320 + 320 + 320` + huecos = 1032 px de
*min-content* que no se reduce. En `#libros` el mismo efecto lo producen las filas
flexibles que no envuelven (`.frm-row`, `#lb-tabs`, `.tbl-toolbar`, w=1108).

Es preexistente: `git show vps/master:frontend/sistema/sistema.css` ya contiene la regla,
y `sistema.css` **no** figura en el rango de archivos del despliegue pendiente.

## Reproducir

Con una sesión de cliente (rol 2 con empresa vinculada), en Chrome:

1. DevTools → dimensión de dispositivo 390×844, **recargar** (no solo redimensionar).
2. `document.documentElement.scrollWidth` → 1048 en `#centro`, 1124 en `#libros`.

## Dirección de arreglo propuesta (para el ticket, no aplicada)

1. `.sys .centro-grid`: pasar de columnas fijas a fluido — `repeat(auto-fill,
   minmax(240px, 1fr))` con `min-width: 0` en las tarjetas.
2. `.sys-main` y `#sys-view`: `min-width: 0` explícito para que la pista del grid
   pueda encogerse.
3. Barras y tablas (`.tbl-toolbar`, `.frm-row`, `#lb-tabs`): envoltura (`flex-wrap`) o
   `overflow-x: auto` en un contenedor, en vez de empujar el ancho de la página.
4. Pasada `@media (max-width: 640px)` sobre el shell (menú lateral colapsado) y
   comprobación de que `scrollWidth === innerWidth` a 390 px en `#centro`, `#libros`
   y `#crm`.

Criterio de aceptación: a 390 px, `document.documentElement.scrollWidth` igual al ancho
de ventana (±1 px) en las vistas principales, sin scroll horizontal.

## Alcance del despliegue actual

El rango a publicar toca `/sistema/` solo en `frontend/sistema/app.js` (**una línea**: la
entrada de menú `portal-comercial`) y en 2 referencias `?v=` de `index.html`. Ningún
cambio de maquetación del shell. Este defecto **no debe bloquear** ese despliegue, pero
tampoco conviene arrastrarlo: al no poder verse bien en teléfono, la app queda de facto
en escritorio.
