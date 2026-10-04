# Design Audit — Facturación Electrónica (BLOQUE 4)

**Fecha:** 2026-10-04
**Alcance:** las 3 vistas de la UI de emisión DTE en `/sistema/` — `#dte`
(bandeja), `#dte-emision` (formulario), `#dte-config` (emisor/CAFs) — sobre el
contenedor Docker real (`http://127.0.0.1:3500/sistema/`).
**Método:** auditoría visual con navegador automatizado (capturas desktop +
tablet, extracción del sistema de diseño por CSS computado, prueba de
flujos/interacciones) + fix loop con commit atómico por hallazgo y
verificación visual before/after.
**Clasificador:** APP UI (workspace de datos, tarea-focused). No existe
DESIGN.md: el sistema se infiere de `frontend/css/app.css` +
`frontend/sistema/sistema.css`.

## Resultado

| Métrica | Baseline | Final |
|---|---|---|
| Design Score | B | **A** (los 5 hallazgos resueltos) |
| AI Slop Score | A | A — cero patrones de la lista negra |
| Trunk test | PASS 6/6 en las 3 vistas | PASS |

## Sistema de diseño inferido

- **Tipografía:** Sora (display: título, nav) + Inter (cuerpo) + JetBrains
  Mono tabular para montos. Base **16px** (ver hallazgo F5).
- **Color:** dark navy coherente (~9 colores por vista); chips semánticos
  warning/success/danger consistentes con el resto del sistema.
- **Espaciado:** escala `var(--space-*)` (4px) sin valores mágicos.
- **Consistencia:** nav, chips, tablas y botones idénticos a las vistas
  existentes (mismo patrón `window.VIEWS` en `frontend/sistema/`).

## Hallazgos y fixes (commit atómico por hallazgo)

| ID | Hallazgo | Impacto | Fix | Commit |
|---|---|---|---|---|
| F1 | **El router expulsaba a Inicio al usar filtros**: el hash con query (`#dte?tipo=33&estado=`) no matcheaba la clave de la vista en `renderRoute` (bug funcional, no solo estético; afecta a cualquier vista con estado en el hash). | HIGH | `app.js`: la query se separa de la clave (`hash.split('?')[0]`) — beneficio compartido por TODAS las vistas. | `23d8912` |
| F2 | **Muro de texto de faltantes**: la tarjeta "Emisor incompleto" repetía los mismos 9 requisitos × 4 tipos (ruido visual, dominaba la pantalla). | MED | Matriz `Requisito / Detalle / Estado`: lo común se nombra UNA vez ("Todos los tipos") y por tipo queda solo lo específico (CAF). Misma honestidad §42 con menos ruido. | `fac2ff6` |
| F3 | **Jerarquía de acciones**: "Sincronizar contabilidad" en primary competía con "Emitir DTE" (dos CTAs azules en la misma barra). | MED | Baja a `btn-secondary`: la acción principal de la bandeja es emitir. | `952c69d` |
| F4 | **Montos en fuente proporcional** en KPIs (sin alineación tabular), mientras las tablas ya usan mono. | POLISH | Clase `.mono` (nueva, `sistema.css`) aplicada a KPIs de montos de bandeja y formulario — coherente con `.tbl .num`. | `31f4925` |
| F5 | **Base tipográfica 15px** (< 16px recomendado) — decisión a nivel de toda la app. | POLISH | Token `--fs-base: 0.9375rem → 1rem` en `app.css`: sube body de landing + sistema e inputs de contenido (elimina el auto-zoom de iOS al enfocar inputs); la escala tokenizada mantiene xs/sm/md intactos. | `0faad2f` |

## Verificación

- Cada fix re-verificado en el navegador sobre el contenedor reconstruido
  (imagen nueva), sin errores JS en consola.
- Suite backend intacta: **279/279 PASS** (los cambios son de frontend).
- Evidencia (capturas before/after + responsive tablet/desktop de las 3
  vistas): `.gstack/browse-reports/design-audit-20261004/` del workspace de
  ejecución (no versionado — son binarios). Baseline para futuros audits en
  modo regresión: `design-baseline.json` en
  `~/.gstack/projects/iva-mensual/designs/design-audit-20261004/`.

## Nota operativa (infra, no diseño)

Durante la sesión se observó una **divergencia WAL de SQLite** en el bind
mount Windows↔Linux (`./data`): escrituras hechas desde el host dejaron de
verse por el contenedor (respondía 401 con sesiones que el host veía).
`docker restart iva-mensual` lo resuelve sin pérdida. Para el VPS Linux esto
no aplica; en desarrollo en Windows, recordar reiniciar el contenedor si se
manipula la BD desde el host.

## Conclusión

La UI de DTE nace consistente con el sistema (mismo patrón VIEWS, chips y
tablas existentes) y cierra su primer audit sin deuda pendiente. Los fixes
F1 (router) y F5 (16px) benefician a toda la aplicación; F2–F4 dejan la
bandeja con jerarquía clara y lectura de números alineada.
