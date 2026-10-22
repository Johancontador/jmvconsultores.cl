# UX minimalista tipo iPhone — plan por fases

> Decisión del dueño (2026-10-21): el sistema se siente «de teléfono» — íconos
> grandes, pocas decisiones por pantalla y **una casa que siempre vuelve al
> inicio**. Este documento es el plan por fases y el registro de lo entregado y
> verificado, no una promesa.

## Principios (no negociables)

1. **Nada ficticio.** Los íconos del home salen de `GET /api/auth/centro`
   (empresa + rol + capacidades + licencia). Si el rol no puede abrir un módulo,
   su ícono no existe en el DOM. Un ícono a una ruta sin permiso es un 403
   disfrazado de botón.
2. **Una sola fuente de estado por cosa.** El dock no inventa una clase de menú
   paralela: dispara el panel real (`#sys-menu-btn`) y su `aria-expanded` sigue
   al sidebar (✕, fondo, Escape).
3. **Un dato, un lugar.** La descripción y las subsecciones de cada módulo no se
   repiten en el home: viven en el `title` del ícono y en el menú (dock →
   *Menú*).
4. **Pocos tokens.** Solo tokens del design system (`app.css`); ningún color ni
   tamaño nuevo suelto.
5. **Nada tapa nada.** El dock flota, así que el contenido **reserva su alto**
   (el bug de la capa móvil: 40 px de padding contra 76 px de barra).

## Fase 1 — Home de aplicaciones y dock con casa (ENTREGADA 2026-10-21)

| Pieza | Comportamiento | Verificación |
|---|---|---|
| Home (`#centro`) | Rejilla de **íconos grandes**: 68 px escritorio / 60 px teléfono, 4 columnas a 390 px, nombre debajo, tinte por familia de módulo | Chrome real: 8 íconos, sin scroll horizontal (390 = 390) |
| Casa | Primer acceso del dock, **más grande** (52 px / 46 px), color de marca, siempre a `#centro` | Clic desde `#documentos` → `#centro`, casa marcada `active` |
| Dock | Casa + Bandeja + Libros + Salud + Tesorería, **solo lo autorizado** (`documentos:ver`, `salud:ver`, `tesoreria:ver`) | 6 ítems a 390 px (5 + Menú), 5 a 1280 px |
| *Menú* | Aparece solo donde el sidebar está plegado (≤960 px) y abre el panel existente | `display:flex` a 390, `display:none` a 1280 |
| Continuidad | «Continuar donde quedó» y recientes por usuario siguen en el home | Prueba T13 |
| Espacio | `.sys-main` reserva 136 px (móvil) / 168 px (escritorio) de alto del dock | último bloque a 708 px vs barra en 760 px → no cubierto |

Pruebas: **T13** en `test/ux-unificacion.test.js` (estructura, tamaños, casa,
delegación del menú y reserva de espacio). Verificado también en Chrome real con
la base de desarrollo: 0 errores de consola en 390 px y 1280 px.

## Fase 2 — «Spotlight» y badges reales (siguiente)

- **Buscador tipo Spotlight** en el home: un solo campo que filtre módulos,
  secciones y empresas (reutiliza `core/buscador.js`, ya en producción). Criterio
  de aceptación: escribir «iva» lleva a la sección de IVA en ≤2 teclas, con
  teclado navegable y sin resultados inventados.
- **Badge en el dock con dato real**: documentos pendientes en *Bandeja* y alertas
  de salud en *Salud*, usando los endpoints ya existentes. Nunca un número
  decorativo: si el dato no se pudo cargar, no hay badge.
- **Módulos sin licencia visibles pero apagados** (hoy se marcan con «!»): pasado
  a ícono en gris + candado y explicación al tocar, sin abrir la vista.

## Fase 3 — Ajustes y widgets (después)

- Vista **Ajustes** única (empresa, período, tema, notificaciones, usuarios) en
  vez de repartirlos entre header y Administración.
- **Widgets del mes** en el home (IVA del período, cobranza pendiente, salud
  tributaria) reutilizando `/resumen` cacheados; cada widget declara su período.
- Transición de apertura de app (escala desde el ícono) solo con
  `prefers-reduced-motion: no-preference`.

## Lo que NO se hace

- Copiar iOS literal (gestos, blur agresivo, animaciones largas): el sistema es
  contable y se usa con teclado y datos densos.
- Esconder funciones detrás de íconos sin rótulo: todo módulo lleva su nombre.
- Reemplazar el menú lateral: es el catálogo completo (44 ítems) y la única vía
  cuando el rol necesita una sección que no cabe en 5 accesos.
