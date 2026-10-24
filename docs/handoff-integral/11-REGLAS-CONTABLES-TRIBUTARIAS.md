# 11 · Reglas contables y tributarias

> Cada regla indica **dónde está implementada**, **qué recibe**, **qué condición aplica**, **qué produce**, **excepciones** y **grado de certeza**.
> Certeza: `Verificada` (código + test), `Implementada` (código, sin test específico), `Requiere validación tributaria` (criterio de negocio que un especialista debe confirmar).

---

## 1. Núcleo contable

| ID | Regla | Implementación | Entradas → condición → resultado | Excepciones | Certeza |
|---|---|---|---|---|---|
| RN-001 | **Partida doble** | `core/asientos.normalizarLineas/crear` | ≥2 líneas; Σdebe = Σhaber; total > 0; cada línea tiene débito **o** crédito, no ambos ni cero | Ninguna | Verificada (`fase2`) |
| RN-002 | **Montos enteros en pesos** | `validarMontoEntero` | `Number.isInteger`; rechaza decimales | La capa tributaria legacy usa REAL | Verificada (`fase2`) |
| RN-003 | **Cuenta imputable y activa** | `normalizarLineas` | Cuenta existe en la empresa, `activa=1`, no es RESUMEN | — | Verificada |
| RN-004 | **Centro de costo válido** | `normalizarLineas` | Si viene, existe en la empresa y está activo | — | Verificada |
| RN-005 | **Período cerrado bloquea** | `asientos.crear` + `periodos_contables` | `fecha` cae en período CERRADO → error | Reapertura auditada con `periodos:reabrir` | Verificada (`fase5`) |
| RN-006 | **Asiento inmutable** | `asientos.revertir` | No se edita ni borra; se crea asiento inverso fechado hoy, referenciando el original | Solo una reversión por asiento | Verificada |
| RN-007 | **Folio correlativo por año** | `asientos.crear` | Siguiente folio por empresa+año | — | Verificada |
| RN-008 | **Saldos por naturaleza** | `asientos.mayor` | Deudora: Σdebe−Σhaber; acreedora: Σhaber−Σdebe | — | Verificada |
| RN-009 | **Saldos derivados** | `reportes.*` | No se persisten saldos; se agregan desde `asiento_lineas` | — | Verificada |
| RN-010 | **Cierre con snapshot** | `reportes.cerrarPeriodo` | Checklist + asientos de cierre propuestos + snapshot JSON; estado CERRADO | Reapertura excepcional auditada | Verificada (`fase5`) |
| RN-011 | **Ecuación A = P + PN** | `reportes.situacion` | Activo = Pasivo + Patrimonio; se verifica y se reporta | Si no cuadra, se muestra el descuadre | Verificada (`fase5`) |
| RN-012 | **NIIF por rubros con SIN_CLASIFICAR** | `niif` | Rubro por cuenta (plantilla + edición); lo no mapeado va a `SIN_CLASIFICAR` sin romper el cuadre | — | Verificada (`fase8`) |
| RN-013 | **Activo fijo: línea recta** | `activos` | (costo − residual) / vida útil meses; cuota final ajustada al depreciable exacto; UNIQUE activo+período | Períodos cerrados rechazados | Verificada (`fase7`) |
| RN-014 | **Venta/baja de activo** | `activos.ventaBaja` | Limpia costo y depreciación acumulada contra utilidad/pérdida por alias; avisa cuota pendiente | — | Verificada |
| RN-015 | **Tesorería con asiento** | `tesoreria` | Todo movimiento nace con asiento; UNIQUE banco+asiento; saldo inicial = asiento de apertura | — | Verificada (`fase6`) |
| RN-016 | **Cartola idempotente** | `tesoreria.importarCartola` | Dedupe por banco+fecha+monto+glosa; reimportar no duplica | — | Verificada |
| RN-017 | **Conciliación bancaria 1↔1** | `tesoreria.conciliar` | Empareja ±3 días; persiste matches; reporta no conciliados de ambos lados | Pago que cubre varias facturas queda sin match individual (documentado) | Verificada; mejora 1↔n pendiente |
| RN-018 | **Conciliación SII↔contable report-only** | `conciliacion.ejecutar` | Compara bandeja, asientos y resumen SII; tipifica diferencias; **no corrige** | — | Verificada (`fase4`) |
| RN-019 | **Documento único (dedupe)** | `documentos.clave_dedupe` | UNIQUE empresa+clave; RCV y DTE comparten la misma clave | — | Verificada (`fase3`, `dte-contable`) |
| RN-020 | **NC restan** | `SIGNO_NC`, `sumarDocumentos` | Tipos 60/61 restan neto, IVA y total | — | Verificada (`calculos`) |
| RN-021 | **Propuesta no contabiliza** | `propuestas` | Genera snapshot; solo `confirmar` crea el asiento | Confirmación individual o lote | Verificada |
| RN-022 | **Precedencia de contraparte** | `propuestas.resolverContraparte` | 1) regla → 2) memoria RUT → 3) cuenta regular del modo simple → 4) alias de control | Sin resolución → error explícito | Verificada (`memoria-reportes`) |
| RN-023 | **Aprendizaje de memoria** | `propuestas.recordarMemoria` | Al confirmar, el RUT queda vinculado a la cuenta para el mes siguiente | Solo si el usuario lo pide/confirma el flujo | Verificada |
| RN-024 | **Asiento externo cuadrado** | `asientos-externos` | Σd=Σh, ≥2 líneas, período abierto, códigos válidos; rechazo completo 422 | Reenvío deduplicado | Verificada (`fase9`) |
| RN-025 | **Aislamiento por empresa** | routers + core | Toda operación valida pertenencia; consultas filtran `empresa_id` | `super_admin` opera todas | Verificada (tests por módulo) |
| RN-026 | **Auditoría de mutaciones** | `auditoria.registrarAccion` | Quién, qué, cuándo, antes/después, IP | Jobs usan usuario sistema | Verificada; la auditoría no se borra salvo eliminación definitiva de usuario (protegida) |

---

## 2. Reglas tributarias implementadas

| ID | Regla | Implementación | Fórmula / condición | Certeza |
|---|---|---|---|---|
| RN-030 | **IVA determinado (estimación)** | `calculos.calcularIVA` | `IVA ventas (débito) − IVA compras (crédito)` | Verificada (`calculos`) |
| RN-031 | **PPM estimado** | `calculos.calcularPPM` | `ventas_neto × tasa_ppm`; la tasa se guarda como decimal (0.015 = 1,5 %) | Implementada / **Requiere validación** (base y tasa por régimen) |
| RN-032 | **Total F29 estimado** | `calculos.calcularTotalF29` | Si IVA < 0 → solo PPM; si IVA ≥ 0 → IVA + PPM | Implementada / **Requiere validación** (remanente de crédito fiscal no se arrastra) |
| RN-033 | **Ventas del período** | `salud-tributaria` | RCV ventas (con NC restando) + `rcv_agregados` (boletas 39/41 y comprobantes 48) | Verificada (S14) |
| RN-034 | **F29 declarado vs estimado** | `salud-tributaria` | Diferencia solo si el mes tiene RCV y el SII informó monto | Verificada (S12) |
| RN-035 | **Casillas del F29** | `f29-formulario` | `base_imponible` (563) = ventas netas; `total_debitos` (538) = IVA débito (no ventas); `iva_determinado`, `ppm_neto`, `total_a_pagar` | Verificada (S12) |
| RN-036 | **Diferencia de ventas explicada** | `salud-tributaria` | Si la diferencia ≈ IVA de boletas (111)/recibos (759) ÷ 0.19, se rotula como explicada (aproximación) | Verificada (S14) / **Requiere validación** del % exacto |
| RN-037 | **Estado F29** | `declaraciones-sii` | `declarada` / `rectificada` / `pendiente` / `no_presentada` / `sin_informacion` | Verificada (T1/T2) |
| RN-038 | **F29 sin casillas** | `salud-tributaria.compactoDeclarado` | Un «No Declarante» no cuenta como declaración ni como pendiente | Verificada (S13) |
| RN-039 | **Boletas de honorarios** | `declaraciones-sii` | Totales anuales por mes (bruto, retención, líquido), emitidas y recibidas | Verificada (T4) |
| RN-040 | **Deuda TGR** | `deuda-tgr` | Solo el total **rotulado** del certificado; si no es legible, `NULL`; «NO REGISTRA DEUDA» ⇒ 0 con evidencia | Verificada (D1/D2) |
| RN-041 | **DJ pendiente/vencida** | `dj-sii` + `salud-tributaria` | Folio 0 sin fecha = sin presentación; vencida si `fecha_vencimiento < hoy` | Verificada (D7) |
| RN-042 | **Exposición sin doble conteo** | `salud-tributaria` | Suma deuda TGR + diferencia F29 (pesos de impuesto) + contingencia de pendientes; la diferencia de ventas **no suma** | Verificada; requiere validación del criterio |
| RN-043 | **Prescripción** | — | **No se calcula.** Se declara que debe evaluarse caso a caso (art. 200 CT) | Correcto no implementarlo |

---

## 3. Índice de Salud Tributaria (metodología implementada)

| Dimensión | Peso | Fórmula | Fuente |
|---|---|---|---|
| Cumplimiento de obligaciones | 25 % | `F29 declaradas / F29 consultados × 100` | `declaraciones_sii` + `f29_formularios` |
| Consistencia y conciliación | 25 % | `100 − min(70, difVentas×12) − min(30, verificacionesFallidas×10)` sobre períodos comparables | F29 compacto vs RCV |
| Riesgos y contingencias | 20 % | `max(0, 100 − altas×18 − medias×6 − bajas×2)` | Hallazgos |
| Calidad y cobertura de datos | 15 % | `coberturaRCV×0,6 + consultasDeclaraciones×0,2 + ficha×0,2` | Documentos + ficha |
| Controles y regularización | 15 % | Promedio ponderado de verificaciones internas del F29 (0,6) y ratio de conciliación bancaria (0,4) | F29 + tesorería |

**Reglas del índice (implementadas):**
- Dimensión sin antecedentes ⇒ `no_evaluable`; su peso se redistribuye entre las evaluables.
- Sin RCV **y** sin ficha ⇒ `indice_evaluable = false` y `nivel = SIN_INFORMACION` (no se muestra 0).
- `nivel`: `REQUIERE_REVISION` si hay cualquier hallazgo alto; `CON_OBSERVACIONES` si hay medios/bajos; `AL_DIA` si no hay hallazgos.
- `alerta_critica` se adjunta siempre que haya altas; una clasificación «Sólida» con alertas se degrada a «Favorable con observaciones» con nota.
- Escala: 90–100 Sólida · 75–89 Favorable con observaciones · 60–74 Requiere atención · 40–59 Riesgo elevado · 0–39 Crítica.

**Certeza:** implementada y cubierta por tests T1–T12 y S1–S14. **Requiere validación de negocio**: los pesos y los castigos (18/6/2, 12/10, 0,6/0,2/0,2) son decisiones de producto, no normas.

---

## 4. Reglas de negocio transversales (producto)

| ID | Regla | Implementación |
|---|---|---|
| RN-050 | Ningún documento se contabiliza sin confirmación humana | `propuestas.confirmar` es la única puerta; automatización también deja propuestas |
| RN-051 | Nada se inventa: sin dato ⇒ `no_consultado` / `sin_informacion` / `no_evaluable` | `salud-tributaria`, `deuda-tgr`, `declaraciones-sii` |
| RN-052 | No consultar no es incumplir | Los meses sin consulta no cuentan como pendientes ni como hallazgo |
| RN-053 | Un error técnico no es un hallazgo tributario | `routes/salud` devuelve aviso, no hallazgo; el informe declara limitación |
| RN-054 | El estado SII se muestra verbatim | `dte_emitidos.sii_codigo`, `sii_respuesta_json` |
| RN-055 | La licencia no bloquea lectura ni pago | `requirePermiso` aplica gate solo a escrituras; pagos usa `permisoSinGate` |
| RN-056 | El dueño de empresa no ve el CRM ni el lote del despacho | `crm:ver` solo en contador/super_admin |
| RN-057 | Un usuario temporal debe cambiar clave y vincular su empresa | `debe_cambiar_clave` + onboarding con RUT+clave SII |
| RN-058 | Revocar sesiones al cambiar clave/desactivar | `auth` cierra todas las sesiones |

---

## 5. Reglas recomendadas (no implementadas)

| ID | Regla propuesta | Por qué | Riesgo de no tenerla |
|---|---|---|---|
| RR-01 | Arrastre de remanente de crédito fiscal entre períodos | El F29 estimado actual no lo modela | Subestima el crédito y sobreestima el F29 |
| RR-02 | Prorrateo de IVA por operaciones exentas | Hoy `exento` es un flag de empresa, no un cálculo | Empresas mixtas mal estimadas |
| RR-03 | Validación de tasa PPM por régimen y actividad | La tasa es un dato manual | PPM estimado incorrecto |
| RR-04 | Detección de prescripción por período | No se calcula | Alertas de deuda prescrita |
| RR-05 | Chequeo de consistencia entre las dos lecturas del F29 | Se unen, no se comparan entre sí | Divergencia silenciosa |
| RR-06 | Bloqueo de emisión de DTE a empresa con término de giro | La ficha lo detecta, pero la emisión no lo impide | Documentos inválidos |
| RR-07 | Validación de RUT con DV en todos los filtros | Hoy documentos usa LIKE parcial | Resultados engañosos |

---

## 6. Puntos que requieren validación de un especialista tributario

1. **F29 estimado**: base de PPM, tratamiento del remanente y de las boletas; la estimación nunca debe presentarse como declaración.
2. **Comparación F29 vs RCV**: la «explicación» de la diferencia por boletas usa 19 % fijo; puede no aplicar a todas las operaciones.
3. **Instalación de reglas semilla**: los códigos de cuenta y alias (CLIENTES, PROVEEDORES, IVA_DEBITO, IVA_CREDITO, VENTAS_SERVICIOS, etc.) deben corresponder al plan real del contribuyente.
4. **Depreciación**: vida útil por tipo de activo es un dato manual; la línea recta no considera depreciación acelerada.
5. **Cierre**: los asientos de cierre propuestos deben revisarse; el sistema no determina obligaciones tributarias del cierre.
6. **Exposición**: la suma de diferencias y contingencias es una estimación de gestión, no una determinación de impuestos adeudados.

---

## 7. Lo que el sistema NO hace (y no debe aparentar)

- No presenta declaraciones ante el SII.
- No emite certificados oficiales (solo descarga los de la TGR).
- No calcula intereses, reajustes ni multas (los muestra si el certificado TGR los trae).
- No determina renta líquida imponible ni F22.
- No reemplaza la revisión profesional: el informe lo declara en sus limitaciones.
