# 19 · Plan de implementación

> **No se implementó nada en este handoff.** Este plan ordena el trabajo por valor, riesgo y dependencia.
> Estimación relativa: **S** ≤ 1 día · **M** 2–4 días · **L** 1–2 semanas · **XL** > 2 semanas (una persona; ajustar por equipo).

---

## 1. Secuencia y dependencias

```text
F0 Contratos y línea base
   └─ F1 Defectos de Salud e informe        (puede ir en paralelo con F2)
        └─ F4 Salud como centro de análisis
   └─ F2 Navegación de dos niveles
        └─ F3 Componentes y plantillas
             └─ F6 Accesibilidad y pulido visual
   └─ F5 Consolidación de datos y catálogos (requiere decisiones)
```

**Regla:** ninguna fase comienza sin que la anterior tenga sus pruebas de aceptación en verde. F1 y F2 pueden ejecutarse en paralelo porque tocan archivos distintos (Salud/informe vs shell/navegación).

---

## 2. F0 · Contratos y línea base

| Campo | Detalle |
|---|---|
| Objetivo | Poder cambiar sin romper: congelar contratos y medir el estado actual. |
| Problemas que resuelve | No hay pruebas de navegación; los golden files no existen; la documentación interna miente en puntos concretos. |
| Funcionalidades afectadas | Ninguna visible. |
| Archivos | `test/` (nuevos), `docs/handoff-integral/`, comentarios de `core/declaraciones-sii.js`, `.env.example`. |
| Cambios frontend | Ninguno. |
| Cambios backend | Solo comentarios/documentación (sin lógica). |
| Cambios de datos | Ninguno. |
| Dependencias | — |
| Riesgos | Bajo. |
| Pruebas | Snapshot de `construirInforme` (3 escenarios), golden de reportes, test de los 49 anchors, `npm test`. |
| Aceptación | 634+ tests verdes; 49 anchors resuelven; golden files versionados. |
| Reversión | Borrar los tests nuevos. |
| Complejidad | **S–M** |
| Resultado | Red de seguridad y contratos explícitos. |

**Incluye quick wins documentales:** corregir el comentario obsoleto de F22/DJ, documentar las 12 variables de entorno no listadas, actualizar `CURRENT_STATE.md` (menú lateral, suite 634).

---

## 3. F1 · Defectos de Salud Tributaria y del informe

| Campo | Detalle |
|---|---|
| Objetivo | Que el módulo prioritario se vea tan sólido como sus datos. |
| Problemas | ST-D1 a ST-D12 y ST-C1 a ST-C9 (`12`, `14`). |
| Funcionalidades afectadas | P-002 y DOC-01. |
| Archivos | `frontend/sistema/views-salud.js`, `backend/core/informe-salud-html.js`, `backend/core/salud-tributaria.js` (solo campos aditivos si hiciera falta). |
| Cambios frontend | Eliminar duplicados (índice, plan, opinión), corregir `kpiContextoSII`, retirar badges/animación, distinguir $0 de sin datos, agregar «Estado de las fuentes», persistir pestaña en URL. |
| Cambios backend | `informe-salud-html.js`: tokens CSS, `listaBloque` en hechos/riesgos, «reflejan», quitar tabla duplicada, folio/hash, fecha por fuente. **No tocar fórmulas.** |
| Cambios de datos | Ninguno. |
| Dependencias | F0. |
| Riesgos | Medio: cambiar la portada puede alterar la lectura del score. Mitigación: golden files y revisión con el contador. |
| Pruebas | Contrato HTML (sin variables indefinidas, sin `[object Object]`, sin duplicados), comparación de score antes/después, 8 capítulos, A4. |
| Aceptación | Un solo índice, un solo plan, cero texto residual, cero animación infinita, informe sin defectos C1–C5. |
| Reversión | Rama con la vista anterior; el contrato de datos no cambia. |
| Complejidad | **M** |
| Resultado | Módulo presentable y documento defendible. |

---

## 4. F2 · Navegación de dos niveles

| Campo | Detalle |
|---|---|
| Objetivo | Reemplazar el catálogo de 43 ítems por 6 áreas + 2 secundarias, sin perder anchors. |
| Problemas | N-01 a N-13 (`05`), H-03/H-04. |
| Funcionalidades afectadas | Shell, `MENU`, `ORDEN_FLUJO`, `DOCK`, breadcrumb, `Centro de Reportes`, permisos de ruta. |
| Archivos | `frontend/sistema/app.js`, `views-centro.js`, `views-conta.js` (catálogo), `url-estado.js`, `sistema.css`. |
| Cambios frontend | Nuevo `MENU` de 8 entradas; subnavegación por área; `#centro` como «Todos los módulos»; reubicación de ítems (`16` §3); `?tab=` en URL; corregir el fallback de `route` para vistas sin ítem. |
| Cambios backend | Ninguno (los endpoints no cambian). |
| Cambios de datos | Ninguno. |
| Dependencias | F0 (test de anchors). |
| Riesgos | **Alto**: enlaces guardados, hábitos, permisos. Mitigación: alias + test de anchors + bandera `?nav=legacy` por una versión. |
| Pruebas | Anchors 43+6, permisos por vista, contexto URL, teclado, móvil. |
| Aceptación | ≤8 entradas de nivel 1; 100 % anchors; ningún ítem visible sin capacidad; 0 vistas que caigan en `inicio`. |
| Reversión | Bandera o rama; los anchors se mantienen en ambos modos. |
| Complejidad | **L** |
| Resultado | Navegación por objetivos de negocio, no por archivos. |

---

## 5. F3 · Componentes y plantillas

| Campo | Detalle |
|---|---|
| Objetivo | Un solo lenguaje de componentes y eliminar la deuda de estilos inline. |
| Problemas | 528 `style=`, dos implementaciones de tabs, chips que mezclan estado y severidad, iconos emoji. |
| Funcionalidades afectadas | Todas las vistas, de a una. |
| Archivos | `frontend/sistema/sistema.css`, `ui.js`, nuevo `componentes.js` (si se autoriza), `views-*.js`. |
| Cambios frontend | `PageHeader`, `Toolbar`, `StatusBadge`, `SeverityBadge`, `Notice`, `Evidence`, `EmptyState`, `Skeleton`; migración incremental vista por vista. |
| Cambios backend | Ninguno. |
| Cambios de datos | Ninguno. |
| Dependencias | F2 (la estructura de página debe estar definida). |
| Riesgos | Medio: regresiones visuales. Mitigación: migrar una vista por PR, con captura antes/después y tests de humo. |
| Pruebas | Sin estilos inline nuevos; contraste; foco; 320/390/768/1366; consola limpia. |
| Aceptación | 10 pantallas principales con los componentes nuevos; 0 diferencias funcionales. |
| Reversión | Por vista (cada migración es independiente). |
| Complejidad | **L** |
| Resultado | Consistencia y velocidad de cambio. |

---

## 6. F4 · Salud Tributaria como centro de análisis

| Campo | Detalle |
|---|---|
| Objetivo | De diagnóstico con tarjetas a centro explicable, trazable y con evidencia. |
| Problemas | Ausencia de fecha por fuente, estados colapsados, sin evidencia enlazada, sin verificación del informe. |
| Funcionalidades afectadas | P-002, DOC-01, endpoints de salud. |
| Archivos | `views-salud.js`, `salud-tributaria.js`, `informe-salud-html.js`, `routes/salud.js`, `core/salud-sincronizacion.js`. |
| Cambios frontend | 9 estados semánticos, bloque de fuentes, evidencia por hallazgo, «cómo se calcula» visible, pestaña persistente. |
| Cambios backend | Campos aditivos: `evidencia`, `vigencia`, `version_reglas`; endpoint de verificación (si se decide); separar capacidades `salud:exportar`/deuda. |
| Cambios de datos | Migración idempotente para `version_reglas` en snapshots (opcional). |
| Dependencias | F1, F0 (golden), decisión DEC-04. |
| Riesgos | Alto si se tocan fórmulas; bajo si solo se agrega evidencia. Mitigación: no cambiar pesos ni umbrales en esta fase. |
| Pruebas | Los 8 casos de `18` §2, contrato HTML, snapshots, permisos. |
| Aceptación | Toda cifra muestra fuente y fecha; los estados no confunden ausencia con incumplimiento; folio verificable o declarado. |
| Reversión | Campos aditivos y vista anterior por bandera. |
| Complejidad | **L** |
| Resultado | Salud defendible ante el cliente y el SII. |

---

## 7. F5 · Consolidación de datos y catálogos (requiere decisiones)

| Campo | Detalle |
|---|---|
| Objetivo | Una fuente de verdad por concepto y un catálogo de reportes real. |
| Problemas | Modelo dual `clientes`/`empresas`, F29/PPM «no disponible», estados financieros sin export, auditoría sin filtros, datos fuera de la BD. |
| Funcionalidades afectadas | Administración, Informes, Auditoría, respaldos. |
| Archivos | `migraciones.js`, `empresas.js`, `reportes.js`, `auditoria.js`, `views-conta.js`, `views-lote.js`, `ops/`. |
| Cambios frontend | Catálogo único; exports de estados financieros; filtros de auditoría. |
| Cambios backend | Filtros de auditoría; endpoint de export; migración de `clientes` (solo lectura) → `empresas`. |
| Cambios de datos | **Sí**: migración controlada con backup previo y rollback documentado. |
| Dependencias | DEC-01, DEC-02, DEC-03. |
| Riesgos | **Alto**: datos productivos. Mitigación: backup verificado, migración idempotente, ejecución fuera de horario, doble lectura temporal. |
| Pruebas | Migración en copia; comparación de conteos y sumas; restore. |
| Aceptación | Un solo maestro por RUT; cero pérdida de datos; reportes cuadran. |
| Reversión | Restore del backup + versión anterior. |
| Complejidad | **XL** |
| Resultado | Integridad y fin de la ambigüedad. |

---

## 8. F6 · Accesibilidad y pulido visual

| Campo | Detalle |
|---|---|
| Objetivo | Cerrar la experiencia: contraste, foco, teclado, móvil, movimiento. |
| Problemas | Contraste no medido, menú contextual sin teclado, emoji, animaciones. |
| Archivos | `sistema.css`, `app.css`, vistas migradas. |
| Dependencias | F3. |
| Riesgos | Bajo. |
| Pruebas | Auditoría automatizada + manual en 10 pantallas; 320/390/768/1366. |
| Aceptación | 0 violaciones críticas; sin scroll horizontal; todo operable por teclado. |
| Complejidad | **M** |
| Resultado | Producto usable por cualquier usuario, incluido táctil y teclado. |

---

## 9. Priorización de quick wins (≤ 1 día cada uno)

| # | Acción | Impacto | Riesgo |
|---|---|---|---|
| 1 | Quitar duplicados de Salud (índice/plan/opinión) | Alto | Nulo |
| 2 | Corregir CSS del informe y `esc(array)` | Alto | Nulo |
| 3 | Corregir `kpiContextoSII` y retirar badges animados | Medio | Nulo |
| 4 | Quitar «No disponible» de F29/PPM/CC y enlazar | Alto | Bajo |
| 5 | Corregir comentario F22/DJ y documentar env vars | Medio | Nulo |
| 6 | Distinguir $0 de «sin datos» en exposición/créditos | Medio | Bajo |
| 7 | Bloquear vistas sin ítem de menú (permiso/breadcrumb) | Alto | Bajo |
| 8 | Agregar fecha de última consulta en portada de Salud | Alto | Bajo |

---

## 10. Definition of Done (por fase)

- Código revisado y sin estilos inline nuevos.
- Pruebas nuevas y existentes en verde.
- Demostración funcional en navegador (capturas o grabación) para la vista afectada.
- Documentación actualizada (`CURRENT_STATE`, este handoff).
- Sin cambios de datos sin backup y plan de reversión.
- Aceptación firmada por producto/contador cuando cambie una cifra visible.
