# Sitio público JMV — rediseño unificado (2026-10-16)

Rediseño de las tres superficies públicas del producto: landing comercial,
acceso al sistema y registro. La aplicación (`/sistema/`, `backend/`) no se
tocó.

## 1. Diagnóstico del punto de partida

| Antes | Problema real |
|---|---|
| `frontend/landing.html` (538 líneas) | ~230 líneas de `<style>` propio (`lp-*`) sobre `/css/app.css` |
| `frontend/login.html` (155) | Otro bloque `<style>` (`lg-*`) replicando barra/tarjeta |
| `frontend/registro.html` (224) | Tercer bloque (`reg-*`) con la barra copiada del login |
| Tema | Design system de la **app** (oscuro, slate-950, acento azul `#2e86c8`) usado como base del sitio |
| Tipografía | Bloqueaba el render: el stylesheet de Google Fonts tardaba >3 s en QA |
| Pruebas | Cero cobertura de estas páginas |

Las tres páginas repetían estructura y tokens en `<style>` locales, y heredaban
la identidad de una interfaz de trabajo (densa y oscura) para una superficie
editorial y comercial.

## 2. Sistema visual nuevo

`frontend/css/sitio.css` (única fuente de identidad de las tres páginas).

- **Paleta:** papel marfil `#faf7f2`, superficie blanca, tinta grafito
  `#1a1815`, acento **bronce** `#8a5a2b` (hover `#6d4419`, soft `#f5e9d9`).
  Secciones oscuras de alto contraste `#14120f` solo para el escaparate del
  producto.
- **Tipografía:** Sora (display) + Inter (texto) — las que ya cargaba el sitio,
  sin dependencias nuevas. Escala con `clamp()` y `--pv-fs-*`.
- **Componentes:** barra + drawer móvil, botones (primary/ghost/quiet/light),
  tarjetas, pasos numerados, chips de confianza, formularios con estados,
  FAQ con `<details>` nativo, footer legal, toast.
- **Motion:** duraciones 140/260/460 ms, aparición progresiva, parallax e
  inclinación del escenario 3D con `rAF`, flotación de paneles.
- **Accesibilidad:** foco visible, skip-link, `aria-expanded`/`aria-live`,
  contraste reforzado con `prefers-contrast: more`, y **todo el motion
  desactivado** con `prefers-reduced-motion: reduce`.

El escenario 3D es **CSS puro** (perspectiva, `rotateX/rotateY`,
`translate3d`, `preserve-3d`, sombras y capas). No se agregó Three.js ni
ninguna biblioteca: impacto cero en el peso y compatible con la CSP vigente.

## 3. Identidad de marca

`frontend/assets/logo-ink.svg` — variante del logo existente para fondos
claros: mismo símbolo (espiral de puntos) y misma composición; solo cambia la
tinta del wordmark (blanco → grafito) y los subrayados (azul → bronce). El
`logo-light.svg` original se conserva intacto para el sistema.

## 4. Integraciones preservadas (sin cambios de contrato)

- **Login:** `shared/login-auth.js` es la única lógica; el rediseño solo la
  monta. Conserva `#login-form`, `#login-error`, `#btn-login`, `data-user`,
  `data-pass`, `data-pass-toggle`, destino `/sistema/`. Probado end-to-end en
  navegador: credenciales → redirección al sistema.
- **Registro:** mismo POST a `/api/auth/registro`, misma validación en vivo
  (`/api/auth/registro/disponible`), honeypot `f-web` intacto, mismos ids.
- **Contacto:** sigue siendo `POST /api/contacto` real (sin simular éxito);
  ante fallo de red ofrece WhatsApp con el texto ya redactado.
- **Rutas:** `/`, `/login.html`, `/registro.html` y `/sistema/` sin cambios.

## 5. Anti-caché (nginx `max-age=14400` en .js/.css)

`scripts/seed-versionado.js` ahora versiona **las 4 páginas** que referencian
assets (antes solo `frontend/sistema/index.html`): landing, login y registro
incluidos. El `?v=` es el sha1 del contenido del archivo referenciado, con
`?v=` opcional en el regex, así una página nueva no puede quedar sin
anti-caché. La corrida es idempotente (segunda corrida: "Sin cambios").

## 6. Rendimiento real medido (Chromium, local)

| Métrica | Antes | Después |
|---|---|---|
| `DOMContentLoaded` | 4119 ms (bloqueado por el CSS externo de fuentes) | **114 ms** |
| First Contentful Paint | — | 236 ms |
| TTFB | 29 ms | **8 ms** |
| Peso propio (sin caché) | — | **~38 KB** (sitio.css 29 + logo 2 + api.js 3 + login-auth.js 3) |
| Dependencias nuevas | — | ninguna |

La fuente dejó de bloquear con `rel="preload"` + `media="print"`
`onload="this.media='all'"` y fallback `<noscript>` (permitido por la CSP
vigente: `style-src ... fonts.googleapis.com`).

## 7. Pruebas

- `test/sitio-publico.test.js` (**nuevo, 6 casos**): identidad compartida y
  aislamiento del CSS de la app; autenticación intacta; flujo real de registro;
  contacto real (sin éxito simulado); anti-caché por contenido en cada
  referencia `.css/.js`; y **verificador de referencias locales y anclas**
  (atrapó un ancla rota real introducida durante el rediseño).
- Suite completa: **480/480, exit 0**.

## 8. Incidencias encontradas y resueltas en la misma pasada

1. **Ancla rota** en login (`#acceso-form` inexistente) — detectada por el test
   nuevo, corregida a `#login-form`.
2. **Registro mal maquetado**: usaba la grilla de dos columnas del layout de
   acceso y el split interno quedaba en cuadrantes → clase
   `.pv-auth__main--single`.
3. **Desborde horizontal en login a 390 px**: un `transform` inline anulaba la
   regla responsive del escenario 3D → se quitó el estilo inline (medido: 0
   desborde a 390/768/1366 en las tres páginas).
4. **Contenido oculto si el observador no dispara** (capturas full-page, print):
   se añadió una red de seguridad que revela todo a los 3 s y en `beforeprint`.

## 9. Pendiente / no verificado

- **Rendimiento en dispositivo real** (móvil de gama media) y Lighthouse: no
  medido; lo reportado es del navegador de QA en local.
- **Registro end-to-end** contra el SII: no ejecutado (requiere clave
  tributaria real; no corresponde en QA).
- **Overflow preexistente de la app** a 390 px (`/sistema/`, `sys-main` 1048 px):
  observado durante la QA, **fuera del alcance** de este rediseño.
- Capturas reales de la interfaz dentro de la landing: se mantiene la
  composición CSS con datos simbólicos (sin cifras inventadas ni datos de
  clientes).

## 10. Cómo validar localmente

```bash
npm start                                  # http://127.0.0.1:3500
node --test test/sitio-publico.test.js     # regresión del sitio público
npm test                                   # suite completa
npm run seed:v                             # rehash anti-caché (antes de commitear frontend/)
```

## 11. Publicación y reversión (no ejecutado)

Sin `push` ni despliegue en esta pasada. Cuando se autorice, el mecanismo es el
ya validado (hook `post-receive` del bare del VPS: `checkout -f` + `docker
compose up -d --build`), con respaldo previo de la BD y smoke test posterior.
Reversión: `git revert` del commit del rediseño o `update-ref` al commit
anterior + rebuild en el VPS.
