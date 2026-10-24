# 12 · Salud Tributaria — auditoría funcional

> Módulo prioritario. Se inspeccionaron: `core/salud-tributaria.js` (1.820 líneas), `routes/salud.js` (287), `core/salud-sincronizacion.js` (352), `core/informe-salud-html.js` (1.187), `frontend/sistema/views-salud.js` (831), `core/declaraciones-sii.js` (1.066), `core/deuda-tgr.js` (485), `core/renta-sii.js`, `core/dj-sii.js`, `core/f29-formulario.js`.
> Pruebas asociadas: `salud-tributaria.test.js` (12), `salud-informe.test.js` (14), `declaraciones-sii.test.js` (7), `deuda-tgr.test.js` (8). **Todas en verde** (verificado).

---

## 1. Qué es hoy

No es una pantalla de tarjetas: es un **motor de diagnóstico** con contrato de datos propio.

```text
6 pasos de sincronización (salud-sincronizacion)
  1 ficha del contribuyente (SII)
  2 compras y ventas (RCV)
  3 declaraciones F29, boletas y juradas (SII)
  4 Formulario Compacto del F29 (SII)
  5 renta F22 (SII)
  6 deuda fiscal TGR
  7 informe y evidencia (snapshot)
        ↓
construirInforme(db, {empresaId, periodo, meses, ficha})
        ↓
10 pestañas + informe imprimible de 8 capítulos
```

**Persistencia:** `salud_tributaria_snapshots` guarda el JSON completo del informe (evidencia inmutable por período). El resumen se cachea 60 s en proceso y se invalida al sincronizar.

---

## 2. Pantalla principal (P-002)

### 2.1 Estructura renderizada

| Zona | Contenido | Observación |
|---|---|---|
| Portada | Kicker «JMV Tax Health Intelligence · MM/AAAA», título, clasificación, resumen, aviso de alerta crítica | **El bloque de índice se imprime dos veces** (dos `<div class="sl-indice">` consecutivos) |
| Bienvenida | Robot SVG + «Salud Tributaria» + subtítulo | Decorativo; empuja el dato hacia abajo |
| Acciones | «Reunir antecedentes», «Emitir informe (PDF)» | El segundo abre HTML, no PDF |
| 8 tarjetas KPI | Índice, cumplimiento, observadas, conciliación, exposición, créditos, riesgos altos, resolución de alertas | Cada una con `title` (fórmula) y una línea residual `": valor"` |
| Badges animados | 8 badges «Módulo 0…7» con `kpiPulse` | Decorativos, sin función |
| Comparativa F29/RCV | 3 primeros meses | Duplica información de pestañas |
| 10 pestañas | Resumen, Cumplimiento, IVA y conciliación, Riesgos, Tendencias, Deuda TGR, Impacto financiero, Plan, Metodología, Identificación | — |

### 2.2 Las 8 tarjetas y su cálculo real

| KPI | Fórmula en la vista | Fuente | Problema |
|---|---|---|---|
| Índice de Salud Tributaria | `op.score` si `indice_evaluable`; si no, «No evaluable» | 5 dimensiones | Correcto |
| Cumplimiento oportuno | `cumplidos / revisados` sobre `op.calendario` (ventana de 12 meses) | `mensuales[].f29_estado` | **No coincide con la dimensión «Cumplimiento» del índice**, que usa el historial de 5 años (`f29Declaradas/f29Consultados`). Dos cifras distintas con el mismo nombre en la misma pantalla |
| Tasa de declaraciones observadas | `observados / conFormulario` | `f29_formulario.monto_observado` o `situacion` con «observ» | Aceptable; depende de que el compacto se haya leído |
| Tasa de conciliación | `conciliables / comparables` (dif. ventas < $1.000) | `mensuales[].comparacion` | Si no hay comparables → «No evaluable» (correcto) |
| Exposición tributaria | `fmtCorto(op.exposicion.total)` si > 0 | Matriz de riesgos | **Si el total es $0 muestra «No evaluable»**, confundiendo «sin exposición» con «sin datos» |
| Créditos y remanentes | Suma de `renta[].remanente_devuelto` si > 0 | F22 | **Si es 0 muestra «No evaluable»**; además «créditos» incluye solo remanente devuelto, no otros créditos |
| Riesgos críticos abiertos | Conteo de hallazgos `alta` | Hallazgos | Correcto |
| Resolución de alertas | **Hardcodeado «No evaluable»** | — | Declara honestamente que no existe seguimiento; no debería ocupar una tarjeta de portada |

### 2.3 Defectos verificados en código (no visuales)

| # | Defecto | Evidencia | Impacto |
|---|---|---|---|
| ST-D1 | Índice duplicado en portada | Dos bloques `.sl-indice` idénticos en el template | Ruido y pérdida de credibilidad |
| ST-D2 | Plan de acción duplicado | `panelPlan` contiene dos tablas con `op.plan_accion` | El usuario no sabe cuál es la acción vigente |
| ST-D3 | Texto residual por KPI | `kpiContextoSII(t.k, '', t.v, t.s)` devuelve `": valor"` para claves no mapeadas | Basura visual en las 8 tarjetas |
| ST-D4 | Badges «Módulo N» + animación infinita | `kpiModuloSeleccion` + `kpiPulse` | Decoración sin significado; contradice «movimiento discreto» |
| ST-D5 | «Última actualización SII» = hoy | `kpiUltimaActualizacion()` usa `new Date()`; hoy no se invoca | Si se invocara, afirmaría una actualización que no ocurrió |
| ST-D6 | Columna «Período» de la matriz siempre «—» | `matrizRiesgos` no incluye `periodo`; la vista lee `r.periodo` | Pérdida de trazabilidad por período |
| ST-D7 | Sin fecha de actualización por fuente en la portada | `consultado_en` existe por sección | El usuario no sabe si el diagnóstico es de hoy o de hace 3 meses |
| ST-D8 | Error de carga = un cartel con `err.message` | `catch` de la vista | No distingue error técnico de fuente no disponible |
| ST-D9 | Pestañas no persisten | Estado en memoria | Recargar vuelve a Resumen |
| ST-D10 | «Emitir informe (PDF)» | `window.open` de HTML | Etiqueta engañosa |
| ST-D11 | Deuda TGR con capacidad de otro módulo | `puedeDeuda = tiene('tesoreria:operar')` | Un rol con `salud:ver` y sin tesorería no puede consultar; y `Ver certificado` exige `tesoreria:ver` |
| ST-D12 | Dos tablas Comparativa F29/RCV | Una en Cumplimiento y otra «Comparativa» | Duplicación |

### 2.4 Estados y mensajes

| Situación | Qué muestra hoy | Qué debería mostrar |
|---|---|---|
| Sin ficha ni RCV | Nivel `SIN_INFORMACION`, índice «—», resumen «No hay información suficiente…» | Correcto; falta acción directa «Sincronizar» en el mismo bloque |
| Sin consulta F29 | `no_consultado` en tabla, limitación en opinión | Correcto |
| F29 pendiente | Hallazgo alta + nivel `REQUIERE_REVISION` | Correcto |
| TGR no consultada | «No consultada» + nota «no significa que no exista» | Correcto |
| TGR con deuda | Hallazgo alta + importe | Correcto |
| SII falla al sincronizar | Aviso en la respuesta; informe con ficha cacheada | La UI solo muestra toast; no muestra el aviso de ficha |
| Job con pasos fallidos | Toast con nombres de pasos | Falta detalle del error por paso y acción de reintento selectivo |
| Error de la vista | Cartel rojo con mensaje crudo | Estado «fuente no disponible» con alcance y reintento |

---

## 3. Matriz de alimentación de información

Estado de disponibilidad: `disponible` (integrado y leído), `parcial` (solo con cobertura), `no_consultado` (existe la conexión pero no se ejecutó), `no_integrado` (no existe).

| Indicador / análisis | Fuente | Módulo | Período | Regla de cálculo | Disponibilidad | Evidencia |
|---|---|---|---|---|---|---|
| Identidad, giro, régimen, alertas | Ficha SII (`DatosCntrNow`) | `empresas-sii` | Vigente | Extracción directa; régimen desde atributos 14TT/14GG/14D1 | disponible si se sincronizó; si no, `fichaDesdeEmpresa` | `data/sii-fichas/<rut>.json` + `empresas` |
| Ventas del mes (neto/IVA) | `documentos` + `rcv_agregados` | Ingesta | `periodo_ingesta` | Suma con signo NC (60/61) + agregados 39/41/48 | disponible si hay RCV | `documentos`, `rcv_agregados` |
| Compras del mes | `documentos` | Ingesta | `periodo_ingesta` | Suma con signo NC | idem | `documentos` |
| IVA estimado | Cálculo | `services/calculos` | Mes | `IVA ventas − IVA compras` | calculado | `calcularIVA` |
| PPM estimado | Cálculo | `services/calculos` | Mes | `ventas_neto × tasa_ppm` | calculado | `calcularPPM` |
| F29 estimado | Cálculo | `services/calculos` | Mes | `IVA + PPM`; si IVA<0, solo PPM | calculado | `calcularTotalF29` |
| F29 declarado (estado/folio/monto) | Consulta Integral F29 | `declaraciones-sii` | 5 años | Matriz por tooltip + búsqueda de formulario | `disponible` si se consultó; `no_consultado` si no | `declaraciones_sii` |
| Casillas del F29 | Formulario Compacto | `f29-formulario` | Mensual | Descarga PDF y extrae casillas | ídem | `f29_formularios` |
| Comparación declarado vs RCV | Cruce | `salud-tributaria` | Mensual | `declarado − estimado`, solo con RCV y monto | calculado | `mensuales[].comparacion` |
| Verificaciones internas del F29 | Compacto | `f29-formulario` | Mensual | Débito−NC=IVA, IVA−crédito=determinado, etc. | disponible con compacto | `verificaciones` |
| Renta F22 | Consulta de estado F22 | `renta-sii` | Anual (5) | Folio, concordancia, estado, remanente | `disponible`/`no_consultado` | `declaraciones_sii` tipo F22 |
| Declaraciones juradas | Portal DJ | `dj-sii` | Anual | Formulario, estado, folio, vencimiento | `disponible`/`no_consultado` | `declaraciones_sii` tipo DJ |
| Boletas de honorarios | `loa.sii.cl` | `declaraciones-sii` | Anual | Totales mensuales emitidas/recibidas | `disponible`/`no_consultado` | `declaraciones_sii` tipo BHE |
| Deuda fiscal | Certificado TGR | `deuda-tgr` | Foto | Total rotulado; 0 si «NO REGISTRA DEUDA» | `disponible`/`no_consultado` | `deuda_tgr` + PDF |
| Tesorería (fondos, cobranza, conciliación) | `banco_cuentas`, `teso_*`, `documentos` | `tesoreria` | Ventana | Saldos y aging | `disponible` si hay movimientos | `resumenTesoreria` |
| Exposición | Matriz de riesgos | `salud-tributaria` | Ventana | Suma sin duplicidad (ver `11` RN-042) | calculado | `opinion.exposicion` |
| Índice y dimensiones | Todo lo anterior | `salud-tributaria` | Ventana + historial | Pesos 25/25/20/15/15; no evaluable redistribuye | calculado | `opinion.dimensiones` |
| Qué cambió | Snapshot anterior | `salud_tributaria_snapshots` | — | Diferencia de códigos de hallazgos y score | disponible desde el segundo informe | `opinion.que_cambio` |
| Plan de acción | Matriz | `salud-tributaria` | — | Hallazgos alta/media con acción, plazo y evidencia | calculado | `opinion.plan_accion` |
| Resolución de alertas | — | — | — | **No existe seguimiento de cierre** | `no_integrado` (declarado en la tarjeta) | — |
| Remuneraciones / retenciones | — | — | — | **No integrado** | `no_integrado` (declarado en metodología) | — |

### 3.1 Fuentes por empresa (permisos y configuración)

- El diagnóstico usa **la empresa activa** y su clave en bóveda. Un usuario sin `salud:ver` no puede abrirlo; `salud:sincronizar` es necesario para consultar el SII.
- Si la empresa no tiene clave SII válida, la ficha y las declaraciones fallan; el informe se arma con lo que haya y **lo declara**.
- Si una fuente no está habilitada para el cliente, el informe debe decir «no habilitada», no «incumplimiento». Hoy el backend lo hace para TGR/F22/DJ/BHE (`no_consultado` + limitación), pero la UI no siempre lo distingue de un error.

---

## 4. Precisión y confianza de la información SII

| Aspecto | Implementación actual | Evaluación |
|---|---|---|
| Qué se consulta | Ficha, RCV, F29 (estado + compacto), F22, DJ, BHE, TGR | Amplio y verificable en código |
| Período solicitado | RCV: ventana (`meses`, 12 por defecto); F29: 5 años; F22/DJ/BHE: 5–6 años; TGR: foto | Correcto, pero la UI no muestra la ventana del RCV ni el rango del historial |
| Qué se guarda | Ficha cruda, documentos, declaraciones, compactos, TGR, snapshots | Trazable |
| Qué se consulta en vivo | Ficha al sincronizar; todo lo demás se persiste | El informe se arma de BD, no de llamadas en vivo (bueno: reproducible) |
| Fecha de actualización | `consultado_en` por registro; `generado_en` del informe | **No visible en la portada**; el usuario no puede juzgar vigencia |
| Ausencia de datos vs fallo | `no_consultado` / `sin_informacion` / `null` + limitaciones | Backend correcto; UI los colapsa en chips y pierde matiz |
| Respuestas incompletas | Se guarda lo que llega; el paso falla y sigue | Correcto (S2) |
| Timeouts / auth / proveedor | Errores con códigos (`SII_TOPE_SESIONES`, `SII_SIN_NAVEGADOR`, 502) | Correcto en backend; UI muestra solo el texto |
| Información antigua | Se conserva la última ficha y el último snapshot | **No se marca «vigente/vencida»** en la UI |
| Conciliación con interno | Comparación F29 vs RCV y conciliación bancaria | Buena; el puente es explicable |
| Afirmaciones respaldadas | El informe separa hechos, diferencias y riesgos | Correcto en el texto; el diseño de portada sugiere más certeza de la que hay |

**Conclusión:** el backend es honesto y trazable; **la capa de presentación no comunica esa honestidad**. Un informe con datos de hace 60 días se ve igual que uno de hoy.

---

## 5. Certificado / informe imprimible

### 5.1 Estructura actual (8 capítulos)

1. Resumen ejecutivo (opinión, hallazgos, fortalezas, qué cambió)
2. Cumplimiento tributario (calendario, F29, DJ, F22, BHE, cobertura)
3. Análisis del IVA y conciliaciones (gráfico, puente, detalle mensual, **tabla repetida en cap. 5**)
4. Matriz de riesgos (severidad, exposición, plan)
5. Tendencias (gráfico + **misma tabla de detalle**)
6. Impacto financiero y proyecciones (KPIs, escenarios, TGR, renta)
7. Plan de acción
8. Metodología, alcance y anexos (índice, origen de datos, limitaciones, normativa, fuentes)

Portada: contribuyente, RUT, período, emisión, identificador `JMV-TH-<empresa>-<periodo>-<timestamp>`, versión 2.0, índice, hallazgo prioritario y descargo.

### 5.2 Defectos del documento

| # | Defecto | Evidencia | Severidad |
|---|---|---|---|
| ST-C1 | Variables CSS inexistentes (`--rojo`, `--space-4`, `--fs-sm`) | `informe-salud-html.js` estilos inline; el CSS del informe no las define | Alto (el aviso crítico pierde color y borde) |
| ST-C2 | `hechos` y `riesgos` (arrays) interpolados con `esc()` en la sección final | `renderInformeHtml`, bloque final | Medio (salen como lista separada por comas) |
| ST-C3 | «reflecten» | Descargo de portada | Bajo (pero visible en un documento «profesional») |
| ST-C4 | Tabla mensual duplicada | Cap. 3 y cap. 5 | Medio |
| ST-C5 | Lenguaje de «emisión profesional» junto a «no es certificación» | Sección final | Alto (riesgo de confusión) |
| ST-C6 | Sin folio verificable ni hash | `idInforme` es determinista pero no se verifica en ningún endpoint | Medio |
| ST-C7 | Sin fecha de actualización por fuente en portada | `consultado_en` no se imprime en la portada | Alto (vigencia) |
| ST-C8 | Sin firma ni responsable | Solo «Emitido por JMV Consultores» | Medio |
| ST-C9 | Sin enlace de verificación | No existe endpoint de verificación | Medio |

### 5.3 Estructura propuesta (14 puntos del mandato, mapeados)

| # | Requisito | Dónde está hoy | Acción |
|---|---|---|---|
| 1 | Identificación de empresa y RUT | Portada | Conservar |
| 2 | Fecha y hora de generación | Portada | Conservar + zona horaria |
| 3 | Período analizado | Portada (desde–hasta) | Añadir «ventana RCV» y «rango de declaraciones» |
| 4 | Alcance de la revisión | Cap. 8 | Subir a portada (2 líneas) |
| 5 | Estado general explicado | Portada | Conservar; quitar duplicación |
| 6 | Hallazgos y fundamento | Cap. 1 y 4 | Añadir «evidencia» enlazada por hallazgo |
| 7 | Indicadores y origen | Cap. 1/8 | Tabla indicador → fuente → fecha |
| 8 | Diferencias/inconsistencias | Cap. 3/4 | Conservar; marcar «por investigar», no «incumplimiento» |
| 9 | Información pendiente/validar | Limitaciones | Convertir en lista accionable con «cómo obtenerla» |
| 10 | Evidencias y fuentes | Cap. 8 | Añadir fecha por fuente y enlaces |
| 11 | Fecha de actualización de fuentes | Parcial | **Nuevo bloque obligatorio** |
| 12 | Limitaciones | Cap. 8 | Conservar, más visible |
| 13 | Recomendaciones | Cap. 7 | Conservar |
| 14 | Sistema emisor y verificación | Solo firma textual | **Nuevo**: folio, hash y URL de verificación (o declarar que no existe) |

**Regla:** el documento debe rotularse **«Informe técnico de Salud Tributaria — JMV Consultores»**, no «certificado». «Certificado» se reserva para el PDF oficial de la TGR y los documentos del SII.

---

## 6. Taxonomía de estados propuesta

Hoy conviven: `no_consultado`, `sin_informacion`, `no_evaluable`, `pendiente`, `no_presentada`, `declarada`, `rectificada`, `observada`, `con_deuda`, `sin_deuda`, `disponible`, `parcial`, `no_integrado`. La UI los reduce a 4 colores.

| Estado propuesto | Significado | Condición | Severidad | Mensaje | Acción |
|---|---|---|---|---|---|
| `VERIFICADO` | Dato leído de la fuente y vigente | `consultado_en` dentro de la ventana | Ninguna | «Verificado en el SII el DD/MM HH:MM» | Ver evidencia |
| `CON_OBSERVACIONES` | Dato válido con hallazgos | Hay medio/bajo | Baja | «Disponible, con observaciones» | Revisar detalle |
| `DIFERENCIA` | Dos fuentes discrepan | Diferencia ≥ umbral y ambas disponibles | Media/alta | «Diferencia detectada entre X e Y» | Conciliar |
| `REQUIERE_REVISION` | Hallazgo alto | Severidad alta | Alta | «Requiere revisión antes de declarar/emitir» | Plan de acción |
| `PENDIENTE` | Falta un acto del contribuyente | F29/DJ sin presentación | Alta | «Pendiente de presentación» | Regularizar |
| `SIN_DATOS` | No hay antecedente | `no_consultado` | **Ninguna** (no es incumplimiento) | «No se ha consultado esta fuente» | Sincronizar |
| `FUENTE_NO_DISPONIBLE` | Fallo técnico de la fuente | Timeout/HTTP/auth | **Ninguna tributaria** | «No fue posible completar la consulta… los demás análisis siguen disponibles» | Reintentar / ver detalle |
| `NO_HABILITADA` | El cliente no habilitó la fuente | Configuración | Ninguna | «Fuente no habilitada para esta empresa» | Habilitar |
| `NO_CONCLUYENTE` | Datos insuficientes para opinar | `indice_evaluable=false` | Ninguna | «Análisis no concluyente con los antecedentes disponibles» | Completar datos |

**Regla de UI:** `SIN_DATOS`, `FUENTE_NO_DISPONIBLE` y `NO_HABILITADA` **nunca** usan rojo ni restan puntos.

---

## 7. Motor de análisis y trazabilidad

### 7.1 Lo que existe

- Un solo `construirInforme` (no hay cálculos contradictorios entre pantallas).
- Hallazgos con `codigo`, `severidad`, `titulo`, `detalle`, `fuente`.
- Matriz de riesgos con naturaleza, importe, responsable, plazo y evidencia.
- Snapshot completo por período.
- Comparación con el informe anterior (nuevas/resueltas, variación de índice).
- Tests que fijan reglas (T1–T12, S1–S14).

### 7.2 Lo que falta

| Requisito | Estado | Propuesta |
|---|---|---|
| Registro de reglas con ID y versión | Parcial (códigos de hallazgo, sin versión) | `REGLAS_SALUD` con id, versión, severidad, fuente, vigencia |
| Evidencia por indicador | Parcial (fuente textual) | `evidencia: {tabla, consulta, fecha, registro}` por indicador |
| Tratamiento de información incompleta | Implementado | Conservar y exponer en la UI |
| Reglas de actualización | Manual (sincronizar) + caché 60 s | Mostrar antigüedad y permitir «actualizar esta fuente» |
| Detección de duplicidades | No | Comparar F29 de ambas vías y marcar divergencia |
| Versionado de reglas | No | `version_reglas` en el snapshot |
| Explicabilidad | Alta en texto; baja en UI | «Cómo se calcula» visible por KPI |
| Permisos | `salud:ver` / `salud:sincronizar` | Separar `salud:exportar` y `salud:ver_deuda` |
| Pruebas automatizadas | 41 casos | Añadir pruebas de contrato del informe (HTML) y de estados |

### 7.3 Contrato a congelar antes de rediseñar

```text
construirInforme(db, {empresaId, periodo, meses, ficha}) → Informe
  { empresa, periodo, generado_en, identidad, declaraciones, declaraciones_anuales,
    ingresos_historicos, mensuales, cobertura, capacidades_sii, capacidades_tgr,
    deudas, declaraciones_juradas, opinion, kpis, serie, tesoreria, renta,
    f29_declarado, metodologia }
```

El rediseño de UI **no debe cambiar este contrato**; sí puede añadir campos (`evidencia`, `vigencia`, `version_reglas`) de forma aditiva.

---

## 8. Recomendaciones priorizadas para Salud Tributaria

| Prioridad | Acción | Esfuerzo | Riesgo | Beneficio |
|---|---|---|---|---|
| P0 | Eliminar duplicaciones (índice, plan, opinión, tabla mensual) | Bajo | Nulo | Credibilidad inmediata |
| P0 | Corregir CSS del informe (`--rojo`, espaciados) y `esc(array)` | Bajo | Nulo | Documento presentable |
| P0 | Corregir `kpiContextoSII` y retirar badges/animación | Bajo | Nulo | Limpieza |
| P1 | Unificar «cumplimiento» (una sola definición visible) | Medio | Medio (cambia cifras mostradas) | Coherencia |
| P1 | Exposición y créditos: distinguir «$0» de «sin datos» | Bajo | Bajo | Honestidad |
| P1 | Fecha de actualización por fuente en portada e informe | Medio | Bajo | Vigencia |
| P1 | Estados semánticos (9 estados) en la vista y el informe | Medio | Bajo | Comprensión |
| P2 | Evidencia enlazada por hallazgo | Medio | Bajo | Auditabilidad |
| P2 | Folio/hash y verificación del informe | Medio | Bajo | Confianza |
| P2 | Separar capacidades (`salud:exportar`, deuda) | Bajo | Bajo | Seguridad |
| P3 | Registro de reglas versionado y detección de divergencia F29 | Alto | Medio | Escalabilidad |

**No se debe** rehacer el backend ni cambiar las fórmulas en la primera fase: el valor está en la presentación, la vigencia y la trazabilidad.
