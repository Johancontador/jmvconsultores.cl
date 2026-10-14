# PORTAL DE INTELIGENCIA COMERCIAL — auditoría, arquitectura, datos y plan

> Estado actual (fases A–E): **FASES 1-5, 7 + Dashboard interactivo + Productos + Cobranza + Crédito autorizado + Costos/Margen + Cotizaciones, probadas (suite 412/412)**.
> Deploy a producción ACTIVO: https://app.jmvconsultores.cl (VPS hook post-receive, `git push vps master`).
> Este documento se actualiza con lo que EXISTE en el código, no con lo que se supone.

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

## 7. Brechas y plan (FASE 6 restante)

| # | Brecha | Fuente propuesta | Condición |
|---|---|---|---|
| 1 | Vendedor | No existe; se necesita campo en ERP futuro o DTE (`FolioRef` no lo trae) | Nueva integración |
| 2 | ~~SKU / cantidad / familia~~ **EQUISTO EN FASE A (§7.2)** | `dte_emitidos.items_json` del emisor propio | **IMPLEMENTADO** — `core/portal-productos.js` + `/api/portal/empresas/:id/productos` + vista `portal-productos` |
| 3 | ~~Costo y margen~~ **HECHO en FASE D (§7.3)** | `portal_costos` — hoja de costos DIGITADA por la empresa (costo unitario entero por producto) | **IMPLEMENTADO** — `core/portal-costos.js` + `/api/portal/empresas/:id/{costos,margen}` + hoja de costos y columnas de margen en `portal-productos`; lo SIN costear NO se estima (margen null + cobertura declarada) |
| 4 | ~~Deuda/banco §F~~ **HECHO en FASE B (§7.4)** | `cobranza.js` (saldosClientes, mora) — lectura sola | **IMPLEMENTADO** — `/api/portal/empresas/:id/cobranza` + vista `portal-cobranza` (solo lectura) |
| — | ~~Crédito autorizado~~ **HECHO en FASE C (§7.1)** | `portal_credito` — ficha digitada por RUT (dato de negocio del dueño) | **IMPLEMENTADO** — `core/portal-credito.js` + `/api/portal/empresas/:id/credito` (GET lectura / PUT del dueño) + vista `portal-credito` con exposición de cartera (saldo vs autorizado: DISPONIBLE / SOBREPASADO / SIN_CREDITO, nunca estimado) |
| 5 | ~~Cotizaciones §G~~ **HECHO en FASE E (§7.5)** | `portal_cotizaciones` — registro con estados reales BORRADOR/ENVIADA/ACEPTADA/PERDIDA | **IMPLEMENTADO** — `core/portal-cotizaciones.js` + `/api/portal/empresas/:id/cotizaciones` (GET/POST/PUT/DELETE) + vista `portal-cotizaciones` con embudo y tasa de conversión sobre lo ENVIADO del registro propio (no se infiere de facturas; una cerrada no vuelve a abierta) |

### Dashboard interactivo (incremento sobre §A)

`portal-inicio` reescrito como dashboard: serie móvil `/serie` (1-24 meses,
anla configurable, toggle venta/compra), barras SVG CLIABLES con drill-down
del mes (y por cliente RUT) vía `/movimientos`, chips de segmento en cartera
que filtran la tabla local. Tests T4.* + T5.*(26 en portal.test.js).

## 8. Archivos (todos verificados con `node --check` y suite)

- `backend/core/portal-metricas.js` (nuevo) · `backend/routes/portal.js` (nuevo) ·
  `backend/index.js` (2 líneas de montaje) · `frontend/sistema/views-portal.js` (nuevo) ·
  `frontend/sistema/app.js` (sección de menú) · `frontend/sistema/index.html` (script tag) ·
  `package.json` (suite) · `test/portal.test.js` (nuevo).

## 9. Pendientes (FASE 6 restante)

1. **Vendedor** (única brecha sin fuente posible hoy: NO existe en el RCV ni en el DTE — no se dibuja).
2. QA visual en navegador con sesión real (bloqueado por entorno de cookies del dueño).
3. Validar las vistas nuevas (crédito/costos/cotizaciones) con datos reales en producción tras el deploy.

## 10. FASES C/D/E — fuentes digitadas de negocio (2026-10-14)

Las tres fases agregaron escrituras DIGITADAS al portal sin romper su principio: el
portal sigue sin tocar datos contables — lo nuevo es dato de NEGOCIO que el SII no
tiene y que el dueño (admin_empresa o super_admin) registra; los demás roles
asignados solo leen. Regla transversal (§42): lo sin fuente NO se estima:

| Fase | Tabla | API | Vista | Principio |
|---|---|---|---|---|
| C — Crédito autorizado | `portal_credito` (UNIQUE empresa + RUT normalizado) | `GET/PUT /empresas/:id/credito` | `portal-credito`: fichas + exposición de cartera | sin ficha → SIN_CREDITO; exposición = saldos reales de cobranza (saldosClientes) vs autorizado |
| D — Costos y margen | `portal_costos` (UNIQUE empresa + producto normalizado) | `GET/PUT /empresas/:id/costos`, **`POST /empresas/:id/costos-csv`** (carga masiva), `GET /empresas/:id/margen` | `portal-costos` (hoja + importador CSV con resumen) + columnas de margen/cobertura en `portal-productos` | margen SOLO con costo digitado; cobertura declara el % de venta con margen; CSV upsert idempotente con líneas inválidas REPORTADAS (nunca media import silenciosa) |
| E — Cotizaciones | `portal_cotizaciones` (estados con CHECK en la BD) | `GET/POST/PUT/DELETE /empresas/:id/cotizaciones` | `portal-cotizaciones`: embudo por estado + tasa ACEPTADA/ENVIADA | tasa null sin enviadas (no 0%); una ACEPTADA/PERDIDA no vuelve a abierta; todo auditado |

**Tests (11 nuevos, portal.test.js T6/T7/T8):** upsert idempotente por RUT/producto
normalizados, validaciones de dominio (monto/costo enteros ≥ 0 — un decimal tipo
1.5 se rechaza ANTES de redondear), exposición con saldosFn inyectable
(SOBREPASADO/DISPONIBLE/SIN_CREDITO), margen con cobertura y NC-descuentada-una-
vez, ciclo y embudo de cotizaciones con fecha de cierre, aislamiento §8 en las
6 rutas nuevas (403 en lectura y escritura cruzadas, datos de B jamás en el
cuerpo para A) y escritura SOLO del dueño (contador de la misma empresa: lee
200, escribe 403). Suite completa: 412/412.

## 11. Incrementos del mismo día: CSV de costos + crédito en Cobranza interna

1. **Carga masiva de la hoja de costos** (`importarCostosCSV` + `POST /empresas/:id/costos-csv`, escritura del dueño): CSV "producto;costo" con separador ; o ,, encabezado opcional, montos chilenos con puntos de miles (`20.000`), comillas toleradas; upsert idempotente — re-importar el MISMO archivo actualiza en vez de duplicar (probado); las líneas inválidas se REPORTAN con su línea y motivo sin abortar el resto; si NADA es importable → 400 sin media import (nada se escribe). UI: en Hoja de costos, plegable con textarea y resumen importados/actualizados/saltados. Fix de raíz cazado por el test: `Number('abc'→'')` era 0 — el texto limpio vacío se rechaza ANTES de convertir.
2. **Crédito visible en Cobranza del sistema interno** (`enriquecerConCredito`, lectura pura en `GET /api/contable/empresas/:id/cobranza`): la respuesta conserva TODOS los campos de saldosClientes y agrega por cliente `credito_autorizado` (+`rut_norm`) y en la cabecera `credito {regla, total_autorizado, sobrepasados, sin_ficha}` — cliente sin ficha: null (no se estima). UI views-cobranza.js: KPI "Sobre su crédito" con conteo de sobrepasados y ficha por cliente con chip rojo cuando el saldo excede el crédito. El contador ve lo mismo que el portal — una sola fuente (portal_credito).

**Tests 3 nuevos (T7.4/T7.5/T6.5):** importación idempotente con miles chilenos, saltadas con motivo, error limpio sin media import, 403 del contador y de la empresa cruzada, y enriquecimiento con sin-ficha=null. Suite completa: **415/415**.
