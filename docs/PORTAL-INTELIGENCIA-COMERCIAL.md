# PORTAL DE INTELIGENCIA COMERCIAL — auditoría, arquitectura, datos y plan

> Estado actual (commit `de20931`): **FASES 1-5, 7 implementadas y probadas (suite 392/392)**.
> Sin deploy a producción (requisito del masterplan §11: no desplegar sin autorización).
> Este documento se actualiza con lo QUE EXISTE en el código, no con lo que se supone.

## 1. Arquitectura real encontrada (FASE 1)

- **Backend**: Node 24 + Express 4 + `better-sqlite3` (WAL), módulos puros con BD por parámetro.
- **Una sola bandeja**: tabla `documentos` (ingesta idempotente del RCV del SII con
  `clave_dedupe` UNIQUE, estados `PENDIENTE → CLASIFICADO → PROPUESTO → CONTABILIZADO`,
  `ANULADO`/`ERROR` excluidos). Es la ÚNICA fuente del portal — nada duplicado.
- **Sesión**: cookies httpOnly `sid` (tabla `sessions`), `requireAuth` en backend/index.js.
- **Aislamiento multiempresa**: `usuarioEmpresa` (users ↔ empresas, rol, activo) con
  `rolEnEmpresa()` / `esSuperAdmin()` en `core/empresas.js`.
- **Tratamiento de NC en el código real**: la bandeja guarda montos POSITIVOS y el
  consumidor aplica el signo (`routes/sii.js` línea 156: `signo = -1` para 60/61;
  `conciliacion.js`, `reportes.js`, `propuestas.js` usan `esNC = [60, 61]`).
  El portal comparte esa MISMA convención (ver §3).
- **Frontend**: SPA vanilla (`window.VIEWS`) con menú en `app.js`; se añadió la
  sección «Portal de cliente» con 4 vistas propias.

## 2. Catálogo de datos (FASE 2) — verificado contra el código, sin inventar

| Campo | Estado | Fuente real | Uso |
|---|---|---|---|
| Fecha / período | **A** | `documentos.fecha_docto`, `periodo_ingesta` (AAAAMM) | Tendencias, agrupación mensual |
| Folio y tipo (33/34/56/60/61) | **A** | `tipo_doc`, `folio` (validados en la ingesta) | Trazabilidad, desglose NC |
| RUT y razón social | **A** | `rut_contraparte`, `razon_social` (+ `contrapartes`) | Análisis de clientes |
| Neto / IVA / total / exento | **A** | `monto_neto`, `monto_iva`, `monto_total`, `monto_exento` | Ventas neta, ticket, concentración |
| Estado del documento | **A** | `estado` (vivos = NOT IN ANULADO, ERROR) | Solo vivos en métricas |
| Vendedor | **E** | No existe en el RCV | Rendimiento comercial (pendiente) |
| Código/descripción de producto | **E** | Sin detalle de ítems en la fuente | Análisis por SKU (pendiente) |
| Familia / categoría | **E** | Ídem | Categorías (pendiente) |
| Cantidad | **E** | Ídem | Unidades y frecuencia por producto (pendiente) |
| Costo neto | **E** | No hay fuente de costos | Margen (pendiente, no se estima) |
| Condición de pago | **E** | No llega del RCV | Condiciones (pendiente) |
| Deuda / morosidad | **C(parcial)** | `teso_aplicaciones` + `cobranza.js` ya cubren cobros aplicados | §F futuro con fuente propia (fuera de esta fase) |
| Crédito autorizado | **E** | No existe | Exposición (pendiente) |
| Cotizaciones | **E** | No existe | Embudo (pendiente) |

**Regla aplicada**: los campos E **no se dibujan** como si existieran (§10 del
masterplan): ninguna sección de productos/rentabilidad/cobranza/cotizaciones
aparece en el portal actual.

## 3. Métricas implementadas (FASE 3) — `core/portal-metricas.js`

Catálogo central `CATALOGO` (expuesto en `GET /api/portal/metricas`; el
constructor §H usa ese listado, no uno hardcodeado en el front):

| id | Fórmula | Notas |
|---|---|---|
| `venta_neta_mes` | `SUM(CASE WHEN tipo_doc IN (60,61) THEN -monto_neto ELSE monto_neto END)` | NC descuenta UNA vez (convención `routes/sii.js`), ANULADO/ERROR fuera |
| `variacion_periodo` | `(venta_actual - venta_previa) / venta_previa` | `null` si el comparable no tiene datos (no 0% ni −100%) |
| `clientes_compradores` | `COUNT(DISTINCT rut_contraparte)` | |
| `ticket_promedio_documento` | `venta_neta / COUNT(docs)` | por documento (el cliente tiene `ticket_promedio_cliente`) |
| `ticket_promedio_cliente` | `venta_neta / COUNT(DISTINCT rut)` | |
| `frecuencia_compra` | `COUNT(*) GROUP BY rut` | |
| `concentracion_ventas` | top-5 neto / neto total | **null** si no hay docs |

**Sin datos ≠ cero**: todo resumen responde `null` y `sin_datos: true` si el
período no tiene documentos vivos (§7 del masterplan) — el front lo muestra
como «Sin RCV de ventas para este período», distinta de «0».

**Regla de cartera explícita** (viaja en la respuesta `regla`):
`cuidar` = compró período Y previo · `desarrollar` = solo período ·
`recuperar` = solo previo · `controlar` = sin compras en ambos pero activo en
la ventana (12 meses, configurable 1-24) · `sin_datos` = sin documentos en la
ventana; **nunca** se califica como «perdido».

## 4. API `/api/portal` (FASE 4) — aislamiento estricto §8

Router factory `routes/portal.js` (módulo puro, `db` por parámetro), montado en
`backend/index.js` con `/api/portal` + `requireAuth` global.

| Ruta | Método | Aislamiento |
|---|---|---|
| `/empresas` | GET | Solo las explícitamente asignadas (super_admin: todas) |
| `/empresas/:id/resumen` | GET | Guard server-side antes de tocar datos |
| `/empresas/:id/movimientos` | GET (filtros server-side) | Ídem |
| `/empresas/:id/exportar.csv` | GET | Ídem + **auditoría** `portal.exportar_csv` |
| `/empresas/:id/cartera` | GET | Ídem |
| `/metricas` | GET | Catálogo (sin datos, no en riesgo) |
| `/empresas/:id/reportes` | GET/POST/DELETE | Reportes DE SU usuario en ESA empresa; `DELETE` rechaza reportes ajenos (404 sin borrar) |

- Todo endpoint revalida `rolEnEmpresa` **server-side** — cambiar el ID, la URL
  o un parámetro NO expone otra empresa.
- `empresa_id` inválido → 400; ajena/inexistente → 403 (idéntico, sin fuga de
  existencia); sin sesión → 401.
- No SQL arbitrario: el constructor solo envía config acotada (métrica del
  catálogo, rango, tipo_doc) — nunca crudo.
- Cache: no innecesaria (better-sqlite3 + índices); tabla
  `portal_reportes` (config, no datos; UNIQUE usuario+empresa+nombre; upsert).

## 5. Frontend (FASE 4-5)

`views-portal.js` con 4 vistas (`#portal-inicio`, `#portal-ventas`,
`#portal-cartera`, `#portal-reportes`) + sección de menú «Portal de cliente».
Estados honestos en toda vista: cargando · error (reintentable) · vacío con
causa («Sin RCV…» ≠ «0») · coberturas y períodos comparables visibles.
Formatos CLP chileno; exportación CSV con BOM y separador `;` (Excel es-CL).
Constructor guiado (§H): métrica → filtros → Ejecutar → Guardar (config) →
Abrir/Duplicar/Eliminar. Sin lienzo libre ni SQL.

## 6. Pruebas (FASE 7) — `test/portal.test.js`, TODAS en suite (`npm test`, 392)

- **Motor**: resumen (NC una vez, ANULADO excluido, compra fuera de ventas),
  serie anual, variación null sin comparable, cartera con regla visible,
  movimientos (filtros/sumas honestas), sin-datos = null, cobertura real.
- **Aislamiento NEGATIVO (HTTP real, sesión de A contra empresa B)**:
  resumen 403 · movimientos 403 · cartera 403 · **CSV 403 sin filtrar datos de
  B en el cuerpo** · `/empresas` solo da a A su empresa · 401 sin sesión ·
  empresa inexistente 403 · expuesta no: reportes ajenos NO borrables ni
  listables (T3.2, T3.3).

## 7. Brechas y plan (FASE 6 aún no ejecutada)

| # | Brecha | Fuente propuesta | Condición |
|---|---|---|---|
| 1 | Vendedor | No existe; se necesita campo en ERP futuro o DTE (`FolioRef` no lo trae) | Nueva integración |
| 2 | SKU / cantidad / familia | Detalle de ítems del DTE propio (emisor BLOQUE 2) | **Existe** — el emisor DTE guarda `items` con `descripcion/cantidad/precio`; alimentar el portal desde él |
| 3 | Costo y margen | Hoja de costos por SKU a definir | Nueva fuente; NO estimar |
| 4 | Deuda/banco §F | `cobranza.js` + `teso_aplicaciones` ya cubren cobros aplicados; falta crédito autorizado | Síntesis portal §F con esa fuente |
| 5 | Cotizaciones §G | Nuevo módulo con estados reales | Fuera de alcance declarado (no inventar) |

## 8. Archivos (todos verificados con `node --check` y suite)

- `backend/core/portal-metricas.js` (nuevo) · `backend/routes/portal.js` (nuevo) ·
  `backend/index.js` (2 líneas de montaje) · `frontend/sistema/views-portal.js` (nuevo) ·
  `frontend/sistema/app.js` (sección de menú) · `frontend/sistema/index.html` (script tag) ·
  `package.json` (suite) · `test/portal.test.js` (nuevo).

## 9. Pendientes para producción (FASE 6 + deploy)

1. Sección Productos (desde el emisor DTE, cuando las empresas emitan).
2. Sección Cobranza §F con `cobranza.js` + crédito autorizado.
3. Vendedor / margen / cotizaciones (fuentes nuevas).
4. Sincronización y deploy una vez aprobado (VPS/GitHub) — **no hecho a propósito**.
