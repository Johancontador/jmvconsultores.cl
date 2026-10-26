# 35 — AUDITORÍA SALUD TRIBUTARIA · FASE 1 (solo lectura)

**Fecha:** 2026-10-26
**Alcance:** módulo Salud Tributaria + informe ejecutivo PDF (`JMV Tax Health Intelligence`), caso «COMERCIALIZADORA JOSÉ MENDOZA E.I.R.L.», período octubre 2025 – septiembre 2026, informe del 26-10-2026.
**Estado:** **Fase 1 cerrada. Fases 2–4 analizadas. Fase 5 (implementación) NO iniciada.**
**Garantía de no intervención:** no se editaron archivos de código, no se preparó el índice de Git, no hubo commit/push/despliegue, no se ejecutaron migraciones y no se abrió la BD de desarrollo en modo escritura (se trabajó sobre copias en `os.tmpdir()` y sobre bases `:memory:`).

> Este documento es el punto de retorno de la próxima sesión. Léelo completo antes de tocar código.

---

## 1. Estado del repositorio al cerrar la auditoría

```
rama: master · HEAD: 7db88a7 (2026-10-25)
upstream: github/master  →  ahead 2
staged: 0 archivos

 M backend/core/plan-ficha.js              ← trabajo previo (Planificación), NO tocar
 M backend/core/planificacion-tablas.js    ← trabajo previo, NO tocar
 M frontend/sistema/index.html             ← trabajo previo (seed:v), NO tocar
 M frontend/sistema/views-plan.js          ← trabajo previo, NO tocar
 M package.json                            ← trabajo previo, NO tocar
 M test/plan-ficha.test.js                 ← trabajo previo, NO tocar
?? test/planificacion-expansion.test.js    ← trabajo previo, NO tocar
+  docs/handoff-integral/35-AUDITORIA-SALUD-TRIBUTARIA-FASE1.md  (este documento)
```

**Advertencia para la próxima sesión:** los cambios de **Planificación T0-B (`fecha_vigencia`)** siguen sin commitear y **están verificados** (800/800 tests, migración probada sobre copia, `seed:v` aplicado). No los descartes, no hagas `git checkout --` sobre esos archivos y no los mezcles en un commit de Salud Tributaria: son dos frentes distintos.

Contexto de ese frente, por si se retoma: ver la sección 12 de este documento.

---

## 2. Resumen ejecutivo

El módulo tiene una **arquitectura de honestidad** correcta y poco común: distingue «no consultado» de «cero», no inventa deuda TGR, no calcula diferencias sin RCV y separa la diferencia de ventas de la exposición tributaria. Eso está en el código y **debe conservarse**.

La auditoría encontró **seis defectos demostrados** que, en conjunto, explican el perfil del informe del caso (85/100, cobertura 100%, confianza alta, con alertas altas y una F22 pendiente):

| # | Defecto | Consecuencia en el informe del caso |
|---|---|---|
| 1 | El IVA estimado **no arrastra remanente de crédito fiscal** | «IVA estimado negativo» en varios períodos; diferencia contra F29 parcialmente artificial |
| 2 | `monto_total` del F29 desde Consulta Integral es una **celda posicional** (`c[5]`) sin verificar concepto | La diferencia $63.892 puede comparar magnitudes distintas |
| 3 | «Cobertura 100% / Confianza ALTA» **no mide cobertura de fuentes** | TGR/F22/DJ/BHE pueden estar sin consultar y la portada sigue diciendo 100% ALTA |
| 4 | La exposición suma `|diferencia|` | Una sobre-declaración (dinero ya pagado de más) cuenta como exposición |
| 5 | El índice puede evaluarse **solo con la dimensión «riesgos»** | ~82/100 sin RCV ni F29 si existe ficha |
| 6 | «Margen bruto» = `(ventas − compras RCV)/ventas` | −813% con compras ≈ 9,13× ventas; no es margen bruto contable |

> **Estado 2026-10-26:** los seis defectos de esta tabla están corregidos — ST-01 (§6.4), ST-02 (§6.2), ST-03 (§6.1) y ST-04 a ST-09 (§6.3). El texto siguiente se conserva como evidencia de la auditoría original; el estado vigente está en §6 y §10.

**Decisión recomendada: corregir antes de liberar** el uso del informe como base de decisión (no es bloqueo total del producto, sí del uso comercial del PDF en su estado actual). Detalle en §10.

---

## 3. Qué NO pudo verificarse (declarado, no oculto)

| Materia | Motivo | Qué haría falta |
|---|---|---|
| Importes exactos $63.892 y $1.454.207 y sus períodos | La empresa del caso **no existe** en `data/iva_mensual.db` (22 empresas, ninguna «COMERCIALIZADORA JOSÉ MENDOZA E.I.R.L.») y el PDF no está en el repositorio | Copia anonimizada de la BD de esa empresa **o** el PDF + los JSON del informe |
| `salud_tributaria_snapshots` del caso | La tabla tiene **0 filas** en dev | Snapshot del informe emitido |
| Concepto real del `monto_total` scrapeado | Depende del HTML del SII al momento de la consulta; no se guarda el HTML | Log de la corrida o el HTML de la grilla |
| Si el F22 «2026 pendiente» es año tributario o comercial | Depende del parámetro con que se llamó a `renta-sii` | Registro de la sincronización (o `consultado_en` + parámetros) |
| Si TGR se intentó y falló, o no se ejecutó | `deuda_tgr` tiene 1 fila en dev, de otra empresa | Log de la sincronización del caso |
| Impacto cuantitativo de ST-01 en el caso | Requiere el remanente por período | Cartolas/RCV del caso |

**No se afirma ningún importe como reproducido.** Lo reproducido son **las fórmulas y su comportamiento numérico**.

---

## 4. Flujo de generación (inventario verificado)

```
SII: RCV · F29 Formulario Compacto (PDF) · Consulta Integral F29 · F22 · DJ · BHE
TGR: Certificado de Deuda Fiscal (PDF)
Sistema: bandeja de documentos · rcv_agregados (boletas 39/41, comprobantes 48) · teso_cartola
        │
        ├─ backend/core/declaraciones-sii.js   → scrape → tabla `declaraciones_sii`
        ├─ backend/core/f29-formulario.js      → casillas → indicadores (091, 089, 062, 563, 538)
        ├─ backend/core/renta-sii.js           → F22 por año → `declaraciones_sii` tipo F22
        ├─ backend/core/deuda-tgr.js           → certificado → tabla `deuda_tgr`
        └─ backend/core/salud-sincronizacion.js→ orquesta y persiste
                │
        backend/core/salud-tributaria.js · construirInforme()   (1828 líneas)
                ├─ mensuales[]  ← calcularIVA / calcularPPM / calcularTotalF29
                ├─ comparacion  ← declarado (SII) vs estimado (RCV)
                ├─ hallazgos[]  ← severidad alta/media/baja/info
                ├─ dimensiones[5] → score → clasificación
                ├─ cobertura_diagnostico / nivel_confianza
                ├─ matriz_riesgos[] → exposicion.total
                └─ opinion{resumen, hechos, diferencias, riesgos, conclusion, limitaciones}
                        │
        backend/core/informe-salud-html.js · renderInformeHtml()  (1191 líneas) → PDF (puppeteer)
        backend/routes/salud.js → GET /salud-tributaria · /informe · /graficos · /resumen
        frontend/sistema/views-salud.js → mismas cifras en pantalla
```

**Archivos y tamaños**

| Archivo | Líneas |
|---|---|
| `backend/core/salud-tributaria.js` | 1828 |
| `backend/core/informe-salud-html.js` | 1191 |
| `backend/core/declaraciones-sii.js` | 1066 |
| `backend/core/deuda-tgr.js` | 485 |
| `backend/routes/salud.js` | 287 |
| `frontend/sistema/views-salud.js` | 811 |
| `frontend/shared/estados-salud.js` | 231 |
| `test/salud-tributaria.test.js` · `salud-informe.test.js` · `salud-presentacion.regression.test.js` · `salud-estados.test.js` · `salud-y-errores.test.js` | 295 · 494 · 252 · 172 · 131 |

---

## 5. Fórmulas exactas (con ubicación)

| Cifra | Fórmula | Ubicación |
|---|---|---|
| IVA del mes (neto) | `débito_IVA_RCV − crédito_IVA_RCV` | `services/calculos.js` → `calcularIVA()` |
| IVA a pagar (CFT) | `max(0, neto − remanente_anterior)`; `remanente_siguiente = max(0, remanente_anterior − neto)` | `services/calculos.js` → `calcularIVAConRemanente()` |
| PPM estimado | `ventas_neto × empresa.tasa_ppm` | `services/calculos.js` → `calcularPPM()` |
| Total F29 estimado | `iva_a_pagar + PPM` (nunca IVA negativo) | `services/calculos.js` → `calcularTotalF29()` |
| Tasa PPM | `Number(emp.tasa_ppm) \|\| 0` (config manual de la empresa) | `salud-tributaria.js:752` |
| Diferencia F29 | `totalF29_estimado − monto_091` (solo con casilla 091; si no, `null`) | `salud-tributaria.js` (`monto091`) |
| Diferencia ventas | `base_imponible(563) − ventas_neto_RCV` | `salud-tributaria.js:896` |
| Explicación de la diferencia | reconstruye base con IVA de boletas (111) / recibos (759) ÷ 0,19 | `salud-tributaria.js:899-912` |
| Margen bruto | `(ventas − compras) / ventas × 100` | `salud-tributaria.js:613` |
| Pesos del índice | 25 / 25 / 20 / 15 / 15 | `salud-tributaria.js:1164` |
| Dimensión riesgos | `max(0, 100 − 18·altas − 6·medias − 2·bajas)` | `salud-tributaria.js:1221` |
| Índice | `Σ(puntaje×peso) / Σpeso_evaluable` | `salud-tributaria.js:1257-1258` |
| Cobertura del índice | `Σ peso de dimensiones evaluables × 100` | `salud-tributaria.js:1319` (`cobertura_diagnostico`) |
| Cobertura de fuentes | `consultadas / 9 fuentes × 100` (ficha, RCV, F29 integral, F29 compacto, F22, DJ, BHE, TGR, tesorería) | `salud-tributaria.js:1321-1386` (`cobertura_fuentes`) |
| Confianza | `cobertura de fuentes ≥ 80% y RCV ≥ 75% → ALTA · fuentes ≥ 50% → MEDIA · resto BAJA` | `salud-tributaria.js:1388` (`nivel_confianza`) |
| Exposición | `Σ subdeclaración F29 (>0) + deudaTGR + Σ(IVA+PPM de F29 pendientes)`; la sobre-declaración no suma | `salud-tributaria.js` (`exposicionDiferencias`, `sobreDeclaracion`) |
| Diferencia ventas − compras RCV | `(ventas − compras) / ventas`; `null` si ventas < $1.000 o \|%\| > 100 | `salud-tributaria.js` (`margenEvaluable`) |
| Monto compacto | ≥ $1.000.000 → «$1,45 MM» (2 dec.) · ≥ $1.000 → «$63,89 mil» · resto exacto | `informe-salud-html.js` (`mm`) |

---

## 6. Matriz de hallazgos

| ID | Sev | Tipo | Hallazgo | Evidencia | Impacto | Prueba necesaria |
|---|---|---|---|---|---|---|
| **ST-01** | **P0** | ✅ **Implementado 2026-10-26** (ver §6.4) | El IVA estimado no arrastra remanente de crédito fiscal (CFT). `calcularIVA` resta solo débito−crédito del mes | `services/calculos.js → calcularIVA()`; grep «remanente»: solo aparece en F22 (renta), nunca en IVA | Meses con crédito>débito dan IVA negativo; `calcularTotalF29` descarta ese crédito. El crédito acumulado desaparece → diferencia artificial vs F29 y exposición distorsionada | IVA con débito<crédito durante 2–3 meses consecutivos; verificar remanente arrastrado y total F29 |
| **ST-02** | **P1** | ✅ **Implementado 2026-10-26** (ver §6.2) | `declaraciones_sii.monto_total` del F29 (Consulta Integral) sale de la **posición 5** de la fila, sin validar encabezado ni concepto | `declaraciones-sii.js:342-353` (`monto: c[5]`), `:948-951` (`montoTotal: d.monto`) | Si esa celda no es «total a pagar», `f29_diferencia` compara magnitudes distintas. La vía Compacto sí usa 091 | Mismo período por ambas vías (Consulta Integral vs Compacto) debe dar el mismo concepto; si no hay 091 → `f29_diferencia = null` |
| **ST-03** | **P1** | ✅ **Implementado 2026-10-26** (ver §6.1) | «Cobertura 100% / Confianza ALTA» = peso de dimensiones evaluables. TGR, F22, DJ y BHE **no participan** de ninguna dimensión | `salud-tributaria.js:1164` (pesos), `:1227-1234` (calidad: RCV+F29+ficha), `:1239-1252` (controles: F29+banco), `:1309-1310`; PDF `informe-salud-html.js:1111` | Un informe declara 100%/ALTA con TGR sin consultar y F22 pendiente — exactamente el caso auditado | Fixture con RCV 12/12 + ficha completa + F29, TGR `no_consultado`, F22 pendiente → la cobertura de fuentes NO puede ser 100% |
| **ST-04** | **P1** | ✅ **Implementado 2026-10-26** (ver §6.3) | Exposición usa `Math.abs(f29_diferencia)` | `salud-tributaria.js:1339` (`exposicionDiferencias`) | Una sobre-declaración (contribuyente pagó de más) se cuenta como exposición | Caso con estimado 200.000 / declarado 300.000 → exposición debe ser 0 (o signo separado), no 100.000 |
| **ST-05** | **P1** | ✅ **Implementado 2026-10-26** (ver §6.3) | Con ficha pero sin RCV ni F29, solo «riesgos» es evaluable y el índice = ese puntaje. El guard `sinEvidencia` solo cubre ausencia de ficha | `salud-tributaria.js:1221` y `:1257-1265` | Índice ~82/100 sin ninguna fuente de datos; cobertura 20% lo delata, pero la portada muestra el número | Empresa con ficha completa, cero documentos y F29 no consultado → `indice_evaluable === false` |
| **ST-06** | **P1** | ✅ **Implementado 2026-10-26** (ver §6.3) | «Margen bruto» mezcla compras del RCV (incluye bienes de capital y compras sin relación con costo de ventas) con ventas; sin umbral de no evaluabilidad | `salud-tributaria.js:613`; PDF `informe-salud-html.js:1012` | −813% reproducible (ventas 1.000.000 / compras 9.130.000). Ratio válido, **no es margen bruto** | Ventas 100.000 / compras 900.000 → debe rotularse distinto o «No evaluable» |
| **ST-07** | **P2** | ✅ **Implementado 2026-10-26** (ver §6.3) | `mm()` redondea a 0,1 MM | `informe-salud-html.js:86-89`; uso en portada `:517` y ejes SVG | `mm(63.892)="$0,1 MM"` (37% de error relativo); `mm(30.000)="$0 MM"` | Casos 30.000 / 49.999 / 63.892 / 1.454.207 en portada y gráficos |
| **ST-08** | **P2** | ✅ **Implementado 2026-10-26** (ver §6.3) | «IVA det.» / «IVA determinado estimado» rotula `iva_estimado`, que puede ser negativo | `informe-salud-html.js:217, 362, 663, 685` | Un «IVA determinado» negativo es imposible en el F29: es remanente | Período con crédito>débito → la etiqueta debe decir «IVA estimado (RCV)» y el remanente aparte |
| **ST-09** | **P2** | ✅ **Implementado 2026-10-26** (ver §6.3) | «F29 declarado» = **total a pagar (091)**, no la declaración completa | `informe-salud-html.js:664, 697`; `f29-formulario.js:486` (091), `:548` | Se lee como «ventas/IVA declarado»; convive con columnas estimadas | Verificar rótulo exacto contra la casilla |
| **ST-10** | **P2** | Limitación funcional | «Cumplimiento» mide declarada/consultada, no oportunidad; no usa `fecha_presentacion` ni vencimiento para F29 | `salud-tributaria.js:1191-1197`; `calendario.cumplida` en `:1391` | No puede afirmar presentación en plazo; «aceptada» ≠ «oportuna» | F29 aceptada con fecha posterior al vencimiento → debe marcarse «fuera de plazo» |
| **ST-11** | **P2** | Ambigüedad | El año del F22 se rotula «Año» sin indicar comercial vs tributario | `renta-sii.js:107-108, 242-251`; PDF `:600, 610` | «F22 2026 pendiente» puede leerse como renta 2026 cuando suele ser AT 2026 = renta 2025 | Rótulo «Año tributario (AT)» |
| **ST-12** | **P3** | Cobertura de pruebas | No hay tests de remanente, margen con denominador pequeño, doble conteo, formato `mm`, F22 fuera de plazo (la cobertura con fuentes no consultadas ya la cubre T13 de ST-03) | `test/salud-*.test.js` (grep) | 800 tests verdes con estos defectos abiertos | Ver §8 |
| **ST-13** | **P3** | Documentación | La metodología no declara que el índice no pondera fuentes no consultadas | `salud-tributaria.js` bloque `metodologia`; PDF cap. 08 | El lector asume que 100% cubre todo el diagnóstico | Texto explícito en cap. 08 |

### 6.1 ST-03 — separación de índice, cobertura de fuentes y confianza (implementado)

El informe publica ahora **tres indicadores independientes**, y no un solo número rotulado «cobertura»:

| Indicador | Qué mide | Dónde se calcula |
|---|---|---|
| `score` (índice) | Salud tributaria: promedio ponderado de las cinco dimensiones evaluables | `salud-tributaria.js` (dimensiones) |
| `cobertura_diagnostico` | Peso del índice que tiene evidencia (se conserva el nombre por compatibilidad) | `salud-tributaria.js:1319` |
| `cobertura_fuentes` | Fuentes del diagnóstico consultadas sobre 9, con `por_fuente[]` (estado y detalle), `faltantes[]`, `consultadas`, `parciales`, `requeridas` | `salud-tributaria.js:1321-1386` |
| `nivel_confianza` + `confianza_motivos[]` | Confianza derivada de la cobertura de fuentes y de la calidad del RCV — **nunca** del índice | `salud-tributaria.js:1388-1393` |

Reglas de la corrección:

- Una fuente cuenta como `consultada`, `parcial` o `no_consultada`; **TGR, F22, DJ, BHE y tesorería** entran al conteo aunque no ponderen en ninguna dimensión.
- `ALTA` exige cobertura de fuentes ≥ 80% **y** RCV ≥ 75% de la ventana. Con la TGR sin consultar no hay confianza alta.
- Los motivos del nivel se imprimen junto al indicador (panel, cap. 02 y portada del PDF), y las fuentes pendientes se listan por nombre.
- Un informe con RCV 12/12 + ficha + F29 puede seguir mostrando índice 100% de su peso, pero declara `Cobertura de fuentes 44% (4/9)` y confianza `BAJA`.

Superficies actualizadas: `backend/core/salud-tributaria.js` (cálculo, resumen y metodología),
`backend/core/informe-salud-html.js` (portada, cap. 02, tabla de KPI), `frontend/sistema/views-salud.js`
(tarjeta de índice, tabla de fuentes y motivos), `backend/core/salud-sincronizacion.js` (resumen del job).
Regresión: **T13** de `test/salud-tributaria.test.js` (44% → BAJA con índice completo, 78% → MEDIA, y el índice no se mueve al consultar fuentes anuales).

### 6.2 ST-02 — el monto del F29 solo se concilia si trae casilla 091 (implementado)

Dos correcciones, una en el lector y otra en el informe:

1. **Lector (`declaraciones-sii.js`)** — `parsearTablaBusquedaF29` identifica las columnas
   de la grilla anual del SII por su **encabezado** (`Periodo`, `Folio`, `Fecha`, `Estado`,
   `Monto`), no por posición. Si el encabezado no se reconoce, no devuelve filas: antes se
   leía `c[5]` a ciegas y un corrimiento de columnas convertía otra celda en «monto». Cada
   fila se guarda con `monto_concepto: 'no_identificado'` (la grilla no informa la casilla).
2. **Informe (`salud-tributaria.js`)** — la diferencia solo se calcula contra un monto de
   **casilla 091** (total a pagar), que únicamente entrega el Formulario Compacto. Sin 091:
   `f29_oficial.conciliable = false`, `f29_diferencia = null` y la exposición por diferencias
   no suma nada. El monto igual se **informa** en el detalle mensual (marcado con `*`) y se
   agrega una limitación explicando por qué no se concilia.

Reglas:

- `f29_oficial` expone `monto_concepto` (`total_a_pagar_091` | `no_identificado`) y `conciliable`.
- Si hay 091, ese es el monto que se muestra y el que se compara (no el de la grilla).
- `metodologia.conciliacion_f29` declara la regla en el capítulo 08 del PDF.

Superficies: `backend/core/declaraciones-sii.js`, `backend/core/salud-tributaria.js`,
`backend/core/informe-salud-html.js` (nota al pie del detalle mensual),
`frontend/sistema/views-salud.js` (marca `*` y aclaración).
Regresión: **T8/T8b** de `test/salud-tributaria.test.js` y **T5** de `test/declaraciones-sii.test.js`
(columnas movidas, sin encabezado y monto sin 091).

> Nota de mantenimiento: `test/salud-informe.test.js` ahora inyecta también
> `consultarAgregadosVenta` y `guardarAgregados`. Faltaban, así que el paso RCV caía en la
> dependencia real (`services/rcv`) y los tests S1–S3 esperaban al portal del SII.

### 6.3 ST-04 a ST-09 — signo de la exposición, índice sin evidencia y rótulos (implementados)

| ID | Corrección | Verificación |
|---|---|---|
| **ST-04** | Solo suma a la exposición la **subdeclaración** (`f29_diferencia > 0`). La sobre-declaración se informa en `exposicion.por_naturaleza.sobre_declaracion` y en la matriz como «no suma». `exposicion.total` ya no usa `Math.abs`. | **T15**: declarado 300.000 / estimado 200.000 ⇒ total 0 y `sobre_declaracion` 100.000; declarado 150.000 ⇒ total 50.000. |
| **ST-05** | `indice_evaluable = false` cuando la única dimensión evaluable es «riesgos» (ficha sin RCV ni declaraciones). El resumen dice que la ficha no basta y el índice sale «—» con clasificación `NO_EVALUABLE`. | **T14**. |
| **ST-06** | El ratio se rotula «Ventas − compras RCV» (no «Margen bruto») y queda `margen_bruto_pct = null` con `margen_bruto_evaluable = false` si ventas < $1.000 o \|%\| > 100. Regla en `metodologia.margen`. | **T16** (40% real; −800% ⇒ no evaluable) y **S15** (el PDF no contiene «Margen bruto»). |
| **ST-07** | `mm()`: ≥ $1.000.000 → millones con 2 decimales; ≥ $1.000 → «mil» con 2 decimales; resto pesos exactos. La unidad se declara en cada caso. | **S16**: `$30 mil`, `$63,89 mil`, `$1.999`… y `$3.000 MM` intacto. |
| **ST-08** | «IVA det.» → «IVA est. RCV» en la tabla mensual, leyenda y tooltip del gráfico. Nota al pie cuando hay IVA estimado negativo: es remanente de crédito, no impuesto a pagar. | **S5/S11** + nota condicional. |
| **ST-09** | «F29 declarado» → «F29 total (091)» en la tabla mensual, el panel y la comparativa. | **S5** y textos de `views-salud.js`. |

### 6.4 ST-01 — arrastre del remanente de crédito fiscal (implementado)

`calcularIVA()` se mantiene intacta (devuelve débito − crédito del mes y la usan
los resúmenes por período). El arrastre vive en una función pura nueva:

```js
calcularIVAConRemanente(ventasIva, comprasIva, remanenteAnterior)
// → { iva, neto, remanente_anterior, remanente_siguiente }
//   iva  = max(0, neto − remanente)      // IVA A PAGAR (nunca negativo)
//   remanente_siguiente = max(0, remanente − neto)
```

En `salud-tributaria.js` el informe recorre la ventana en orden cronológico y
arrastra el remanente mes a mes:

- `iva_estimado` sigue siendo el neto del mes (puede ser negativo y se rotula
  «IVA est. RCV»); `iva_a_pagar` es lo que se declara y `f29_estimado` =
  `iva_a_pagar + PPM`.
- Se publican `remanente_anterior`, `remanente_siguiente` y `remanente_origen`
  (`casilla_504` | `estimado_propio`).
- Si el Formulario Compacto del período trae la **casilla 504** (remanente de
  crédito mes anterior), esa cifra oficial manda sobre el arrastre calculado.
- Un mes **sin RCV ingerido** no mueve el arrastre (no es un mes en cero); un
  mes «sin movimiento» confirmado por el SII sí (neto 0).
- La exposición de F29 pendientes usa `iva_a_pagar + PPM`, no el neto.

**Límite declarado:** el arrastre empieza en el primer período de la ventana (o
en la casilla 504 si está). Si existiera remanente anterior al inicio de la
ventana y no estuviera declarado, el primer mes puede quedar sobrestimado; el
informe lo dice en la nota del detalle mensual. Los resúmenes mensuales por
período (`services/informe.js`, `services/proceso.js`) siguen calculando el mes
aislado: no tienen estado del mes anterior.

Superficies: `backend/services/calculos.js`, `backend/core/salud-tributaria.js`,
`backend/core/informe-salud-html.js` (nota con el remanente aplicado),
`frontend/sistema/views-salud.js` (columna «CFT aplicado»).
Regresión: **T17** y **T17b** de `test/salud-tributaria.test.js` (tres meses
consecutivos: 10.000 + 10.000 + 200.000 = 220.000, contra 410.000 sin arrastre;
casilla 504 sobre el cálculo propio).

### Comportamientos correctos que NO deben cambiarse

- «No consultado» **no** es hallazgo: va a `limitaciones` (`salud-tributaria.js:980-988`).
- Sin RCV del mes **no** se calculan diferencias (evita falsos positivos) `:868-873, 892`.
- La diferencia de ventas **no** suma a la exposición (`cuenta_exposicion=false`, `:1345`).
- TGR no consultada ⇒ limitación; jamás se afirma «sin deuda».
- F29 «No Declarante» no se cuenta como pendiente (`compactoDeclarado`, `:250-252`).
- Notas de crédito restan con signo correcto (`calculos.js`).
- Alerta alta siempre visible + `nivel = REQUIERE_REVISION` (`:1289-1305`).
- Corrección 538 (débito) vs 563 (base imponible) aplicada y documentada (`:820-829`).
- Frontend ya distingue 0 confirmado de dato ausente (`estados-salud.js`, `views-salud.js:90-100`).

---

## 7. Reproducciones ejecutadas (evidencia de esta sesión)

Todo se ejecutó con `node` sobre `:memory:` o sobre **copias** en `os.tmpdir()`; la BD de desarrollo no se abrió en escritura.

### 7.1 Formato de montos (ST-07)

```
mm(63.892)    = $0,1 MM        clp(63.892)    = $63.892
mm(1.454.207) = $0,5 MM
mm(30.000)    = $0 MM
mm(49.999)    = $0 MM
mm(50.000)    = $0,1 MM
mm(1.000.000) = $1 MM
```

### 7.2 IVA / PPM / Total F29 (ST-01)

```
ventas 1.000.000 / compras   800.000 → IVA  38.000 · PPM 10.000 · totalF29 48.000
ventas 1.000.000 / compras 1.200.000 → IVA -38.000 · PPM 10.000 · totalF29 10.000
ventas 1.000.000 / compras 1.500.000 → IVA -95.000 · PPM 10.000 · totalF29 10.000
ventas         0 / compras   500.000 → IVA -95.000 · PPM      0 · totalF29      0
```

El crédito de 38.000 / 95.000 **no se arrastra**: el total simplemente lo ignora.

### 7.3 Independencia de las dos cifras del caso

```
19% de $1.454.207            = $276.299
$63.892 / $1.454.207         = 4,39%
¿coinciden?                  = NO
```
⇒ La diferencia de ventas **no explica** la diferencia de impuesto. Son dos hechos distintos: una es base bruta, la otra impuesto total (IVA+PPM). Sumarlas duplicaría la exposición (el código ya lo evita).

### 7.4 Margen −813% (ST-06)

```
ventas 1.000.000 / compras   800.000 →  20%
ventas 1.000.000 / compras 9.130.000 → -813%   ← reproduce el valor del caso
ventas   100.000 / compras   900.000 → -800%
ventas         0 / compras   500.000 → null (no evaluable)
```

### 7.5 Peso de una alerta en el índice

```
una alerta alta  = 18 pts de «riesgos» = 3,60 pts del índice global
tres alertas altas                     = 10,80 pts
```
⇒ Estructuralmente, el índice puede seguir en 85 con contingencias críticas. Las mitigaciones (tarjeta «Alertas críticas», `nivel=REQUIERE_REVISION`, nota) existen y deben conservarse.

### 7.6 Estado de datos verificados en la BD de desarrollo (copia)

```
empresas: 22 (ninguna del caso)
salud_tributaria_snapshots: 0 filas
f29_formularios: 217 filas
deuda_tgr: 1 fila
```

---

## 8. Pruebas que faltan (diseño listo para implementar)

Todas con **resultados numéricos esperados**, no con búsqueda de subcadenas. Fixtures sintéticos; en su momento, copias anonimizadas.

1. IVA con remanente del mes anterior (débito < crédito en 2–3 meses consecutivos).
2. `calcularTotalF29` con IVA negativo + remanente (hoy descarta el crédito).
3. F29 con `total_a_pagar` (091) ≠ `total_determinado` (547) ≠ `subtotal` (595).
4. Mismo período por Consulta Integral y por Formulario Compacto: mismo concepto, mismo monto.
5. RCV incompleto → `f29_diferencia = null` (existe; ampliar a borde).
6. Monto realmente 0 vs no consultado vs error de integración.
7. F22 pendiente y F22 aceptada **fuera de plazo**.
8. Tasa PPM 0 / no validada / distinta por período.
9. Ventas 0 o muy pequeñas → margen «No evaluable».
10. Diferencia de ventas sin impacto tributario confirmado → no suma a exposición.
11. Sobre-declaración (declarado > estimado) → exposición 0 (ST-04).
12. Alerta alta con índice alto y cobertura < 100%.
13. `mm()` para 30.000 / 49.999 / 63.892 / 1.454.207.
14. Índice con solo «riesgos» evaluable → no evaluable (ST-05).

---

## 9. Plan de corrección priorizado

### P0 — alteran conclusiones tributarias

| Cambio | Comportamiento actual | Comportamiento esperado | Aceptación |
|---|---|---|---|
| ST-01 remanente CFT | IVA mes = débito−crédito; crédito negativo se descarta | `IVA_mes`, `remanente_anterior`, `remanente_siguiente` explícitos; F29 estimado = IVA a pagar + PPM, con remanente arrastrado | Serie de 3 meses con crédito acumulado cuadra contra F29 real; diferencia residual explicada |
| ST-02 concepto del monto | `monto_total` posicional `c[5]` | Solo se compara si el origen identifica casilla 091; si no, `f29_diferencia = null` y nota «no conciliable» | Período sin 091 no genera diferencia; con 091 coincide con Compacto |

### P1 — integridad, procedencia, cobertura

| Cambio | Esperado |
|---|---|
| ST-03 separar indicadores | (a) índice; (b) **cobertura de fuentes** por fuente y período (incluye TGR/F22/DJ/BHE); (c) **confianza** derivada de fuentes + calidad. La portada no puede decir 100%/ALTA con una fuente `no_consultado` |
| ST-04 signo de exposición | Solo subdeclaración suma; sobre-declaración se muestra aparte (o no suma) |
| ST-05 índice sin evidencia | `indice_evaluable = false` cuando la única dimensión evaluable es «riesgos» |
| ST-06 rótulo del margen | «Diferencia ventas − compras RCV»; «No evaluable» si ventas insuficientes o \|%\| > 100 |

### P2 — presentación y semántica

- ST-07 `mm` con 2 decimales o `clp` bajo $1.000.000; ejes con unidad explícita.
- ST-08 «IVA estimado (RCV)», con remanente indicado.
- ST-09 «F29 — total a pagar declarado (091)».
- ST-10 separar «declarada» de «oportuna».
- ST-11 «Año tributario (AT)».

### P3 — documentación y pruebas
- ST-12 (14 pruebas de §8), ST-13 (texto en cap. 08).

**Orden de ejecución recomendado:** ST-02 (bajo riesgo, aísla la diferencia) → ST-01 (mayor impacto, requiere validación contable) → ST-03/04/05 → ST-06 → P2 → P3.

---

## 10. Decisión recomendada

**Corregir antes de liberar** (no bloqueo del producto; sí del uso del PDF como base de decisión):

1. **ST-01 a ST-09 cerrados (2026-10-26):** el informe arrastra el remanente de crédito fiscal (ST-01), no compara montos sin casilla 091 (ST-02), separa índice/cobertura de fuentes/confianza (ST-03), no suma sobre-declaraciones a la exposición (ST-04), no puntúa el índice sin evidencia (ST-05) y rotula montos y conceptos por lo que miden (ST-06 a ST-09). Antes de usar el PDF como base de una declaración, queda la **validación del contador** sobre las 5 materias de esta tabla (especialmente remanente y casilla 091).
2. **Mitigación inmediata barata** (sin tocar fórmulas): rótulos ST-08/ST-09 y `mm` ST-07.
3. **Corrección de fondo**: ST-01 y ST-02, con validación del contador responsable.

### Validaciones profesionales requeridas (no las resuelve el código)

| Materia | Norma / fuente a confirmar |
|---|---|
| Arrastre de remanente de crédito fiscal | D.L. 825, art. 26 (remanente) y mecánica del F29; confirmar tratamiento de remanente de crédito fiscal y de crédito por gastos |
| Concepto de «total a pagar» frente a otras casillas | Instrucciones del F29 vigentes al período (casillas 091 / 547 / 595) |
| Tasa PPM aplicable por período y régimen | Régimen declarado por la empresa (14 D N°3 general/transparente, 14 A) y tasa vigente del período |
| Semántica del año en F22 | Año tributario vs año comercial (AT 2026 = renta 2025) |
| Oportunidad de presentación | Código Tributario y calendario SII del período |

---

## 11. Archivos que se modificarían y riesgo

| Archivo | Cambio previsto | Riesgo |
|---|---|---|
| `backend/services/calculos.js` | `calcularIVAConRemanente` nueva; `calcularIVA` **sin cambios de firma ni semántica** | Bajo — aditivo; los consumidores actuales no se tocan |
| `backend/core/salud-tributaria.js` | dimensiones, cobertura/confianza, exposición, margen, `f29_diferencia` | **Alto** — 808 tests + PDF + frontend |
| `backend/core/declaraciones-sii.js` | concepto de `monto_total` y validación de encabezado | Medio |
| `backend/core/f29-formulario.js` | exponer 091 con marca de origen | Bajo |
| `backend/core/informe-salud-html.js` | etiquetas, `mm`, tablas | Medio (tests S1–S12 de presentación) |
| `frontend/sistema/views-salud.js` | mismos rótulos/indicadores | Medio — **exige `npm run seed:v`** (CLAUDE.md) |
| `test/salud-*.test.js` | 14 pruebas nuevas | Bajo |

Sin migraciones nuevas para P0/P1. Si se persiste el concepto del `monto_total`, sería columna aditiva e idempotente (`PRAGMA table_info` + `ALTER TABLE`), probada en copia.

**Estrategia de reversión:** cambios en commits separados por prioridad (P0 / P1 / P2), con `npm test` verde en cada uno; sin borrado de datos ni rollback destructivo. El PDF no persiste datos: revertir el renderer es seguro.

---

## 12. Continuidad — cómo retomar la próxima sesión

### 12.1 Frente Salud Tributaria (este documento)

```bash
# 1) Confirmar estado y que los cambios de Planificación siguen intactos
git status --short

# 2) Reproducir la línea base
npm test                    # esperado: 810 pass / 0 fail

# 3) Antes de tocar cálculos, releer estas secciones del código
#    backend/services/calculos.js          → calcularIVA / calcularPPM / calcularTotalF29
#    backend/core/salud-tributaria.js      → mensuales, dimensiones (1164-1310), exposición (1339-1366)
#    backend/core/declaraciones-sii.js     → 342-353 (c[5]) y 948-951
#    backend/core/informe-salud-html.js    → 86-89 (mm), 663-685 (tabla), 1108-1112 (portada)
```

**Reglas para la fase de implementación (no negociables):**
1. No usar producción ni datos reales: fixtures sintéticos y copias anonimizadas.
2. No ejecutar migraciones sin probarlas antes sobre una copia.
3. No mezclar estos cambios con el trabajo de Planificación (`fecha_vigencia`) en el mismo commit.
4. Ante cualquier cambio en `frontend/`: `npm run seed:v` **antes** de commitear.
5. Cada corrección con su prueba de resultado numérico; no basta con que «pase» la existente.
6. Si un cambio exige una regla legal, marcarla como pendiente hasta validación del contador.

### 12.2 Frente Planificación T0-B (trabajo previo, sin commitear)

Resumen del estado, para no perderlo:

- Se implementó `fecha_vigencia` (inicio de vigencia del régimen, día exacto, admite fechas históricas, año coherente con `regimen_desde_ac`, `PENDIENTE ⇒ NULL`).
- Esquema con CHECK deterministas + **migración idempotente** (`PRAGMA table_info` + `ALTER TABLE`), probada sobre copia de `data/iva_mensual.db` (15 → 16 columnas, original intacto).
- `_snapshot()` incluye el campo → historial y auditoría registran antes/después.
- Tests: 12 de expansión (`test/planificacion-expansion.test.js`, registrado en `package.json`) + 3 nuevos en `test/plan-ficha.test.js`.
- `npm test`: **800 pass / 0 fail**. `npm run seed:v` aplicado.
- **Pendiente:** commit (revisar diff; el changeset incluye esquema + core + frontend + tests + `index.html`). Push y despliegue requieren autorización explícita (la rama está **ahead 2**).

### 12.3 Secuencia sugerida

1. Cerrar el commit de Planificación T0-B (está verificado y bloquea la limpieza del árbol).
2. Salud Tributaria: **ST-01 a ST-09 cerrados** (2026-10-26). Quedan ST-10 a ST-13 (oportunidad de presentación, rótulo del año tributario, cobertura de pruebas y documentación de metodología).
3. Validación con el contador de las 5 materias de §10 antes de publicar el PDF corregido.

---

## 13. Registro de verificación de esta sesión

| Verificación | Método | Resultado |
|---|---|---|
| Estado de Git | `git status --short`, `git diff --cached` | Índice vacío; 7 entradas preexistentes preservadas |
| Localización del módulo | `ls` + `wc -l` | 5 archivos de código y 5 de test identificados |
| Fórmulas | Lectura dirigida de `salud-tributaria.js`, `calculos.js`, `f29-formulario.js` | Todas localizadas y documentadas en §5 |
| IVA/PPM/Total F29 | `node` con las funciones reales de `calculos.js` | Ejecutado (§7.2) |
| Formato de montos | `node` con `mm()`/`clp()` exportados de `informe-salud-html.js` | Ejecutado (§7.1) |
| Independencia de las cifras | Aritmética sobre $1.454.207 / $63.892 | 19% = $276.299 ≠ $63.892 (§7.3) |
| Margen −813% | Reproducción de la fórmula `:613` | Reproducido con 1.000.000 / 9.130.000 (§7.4) |
| ST-03 implementado | `node --test test/salud-tributaria.test.js` (T13) + escenario reproducido con la BD real del renderer | Índice 100% de su peso → cobertura de fuentes 44% (4/9) y confianza `BAJA`; al consultar F22/DJ/BHE → 78% y `MEDIA`, índice intacto (§6.1) |
| ST-02 implementado | `node --test test/declaraciones-sii.test.js test/salud-tributaria.test.js` (T5, T8, T8b) | Monto sin 091 ⇒ `conciliable:false`, diferencia `null`, exposición 0; con 091 ⇒ diferencia calculada (§6.2) |
| ST-01 implementado | `node --test test/salud-tributaria.test.js` (T17, T17b) | Tres meses con crédito: 10.000 + 10.000 + 200.000 = 220.000 (sin arrastre: 410.000); casilla 504 manda (§6.4) |
| Suite completa | `npm test` | **810 pass / 0 fail** |
| Datos del caso | Copia de `data/iva_mensual.db` en `os.tmpdir()`, `readonly` | Empresa ausente; snapshots 0; original intacto |
| Suite de tests | `npm test` (referencia, no ejecutada de nuevo tras la auditoría) | 800/800 en la sesión previa; esta sesión no modificó código |
| Cumplimiento de solo lectura | `git status` al cierre | Idéntico + este documento |

**Fin del documento. Fase 5 no iniciada.**
