# 14 · Certificados, reportes y mensajes

> Fuente: `core/informe-salud-html.js`, `views-salud.js`, `views-conta.js` (reportes, cierre), `views-fiscal.js` (export), `views-teso.js` (cartola, TGR), `views-dte.js`, `shared/toast.js`, `ui.js`.
> Distinción central: **certificado oficial ≠ informe de JMV ≠ diagnóstico automatizado ≠ análisis preliminar.**

---

## 1. Inventario de salidas documentales

| ID | Salida | Formato | Emisor | Estado | ¿Certificado? |
|---|---|---|---|---|---|
| DOC-01 | Informe Ejecutivo de Salud Tributaria | HTML imprimible (A4), 8 capítulos | JMV Consultores (sistema) | Implementado | **No** (declara limitaciones) |
| DOC-02 | Certificado de Deuda Fiscal | PDF oficial descargado de la TGR | TGR | Implementado (descarga) | **Sí, oficial** |
| DOC-03 | DTE emitido (33/34/56/61) | XML firmado + estado SII | Empresa cliente | Implementado; pendiente CAF/certificado | Documento tributario oficial |
| DOC-04 | Factura de la suscripción | DTE 33 | JMV | Implementado; pendiente credenciales | Documento tributario oficial |
| DOC-05 | Informe por rango (legacy) | Pantalla + Excel + mensaje WhatsApp | JMV | Implementado | No |
| DOC-06 | Reporte masivo ZIP | ZIP de Excel por cliente/período | JMV | Implementado | No |
| DOC-07 | Libros C/V y Bandeja | CSV / XLS desde el navegador | JMV | Implementado | No |
| DOC-08 | Reportes financieros (comprobación, 8 columnas, situación, resultados, clasificado, NIIF) | Pantalla | JMV | Implementado | No |
| DOC-09 | Cartola importada / conciliación | Pantalla + archivo | JMV | Implementado | No |
| DOC-10 | Snapshot de Salud Tributaria | JSON interno | JMV | Implementado | Evidencia interna |

**Regla propuesta:** la palabra **«certificado»** se reserva para DOC-02 y los documentos del SII. Todo lo demás es «informe», «reporte» o «diagnóstico».

---

## 2. Informe de Salud Tributaria (DOC-01)

### 2.1 Lo que hace bien

- Genera el PDF con el navegador sobre el mismo HTML que se ve en pantalla → **panel e informe nunca se contradicen** (decisión excelente).
- 8 capítulos con índice, portada, marca, pie y numeración.
- Declara limitaciones y base normativa.
- Distingue hechos, diferencias, riesgos y recomendación.
- Incluye gráficos SVG generados por la misma función que el panel.
- Test S5 verifica capítulos/marca/opinión; S11 verifica que cabe en A4.

### 2.2 Lo que debe corregirse

| # | Problema | Corrección |
|---|---|---|
| 1 | Variables CSS inexistentes (`--rojo`, `--space-4`, `--fs-sm`) | Definir tokens en `css()` o usar valores literales |
| 2 | `esc(array)` en hechos/riesgos de la sección final | Usar `listaBloque` (ya existe) |
| 3 | «reflecten» | «reflejan» |
| 4 | Tabla mensual dos veces (cap. 3 y 5) | Dejar una; el cap. 5 usa solo tendencia |
| 5 | «Emisión profesional» + «no es certificación» | Un solo descargo claro, sin lenguaje de certificación |
| 6 | Sin fecha por fuente | Bloque «Estado de las fuentes» |
| 7 | Sin folio verificable | Folio + hash + URL de verificación (o declarar que no existe) |
| 8 | Sin firma/responsable | «Elaborado por …» + usuario/rol, o «Documento generado automáticamente» |
| 9 | Sin «alcance» en portada | Dos líneas: qué se revisó y qué no |
| 10 | Portada con robot y bloques duplicados (en pantalla) | Portada sobria, un solo índice |

### 2.3 Estructura propuesta (14 puntos)

1. **Portada**: contribuyente, RUT, período, generado el (hora y zona), folio, versión, clasificación, alcance en 2 líneas.
2. **Estado general**: índice (si evaluable), cobertura, confianza, alerta crítica, resumen en 3 frases.
3. **Estado de las fuentes**: tabla `fuente | última consulta | resultado | vigencia`.
4. **Hallazgos**: código, severidad, título, fundamento, evidencia, período.
5. **Indicadores**: valor, fórmula, fuente, fecha, cobertura.
6. **Diferencias**: declarado vs estimado, con naturaleza («por investigar», no «incumplimiento»).
7. **Información pendiente**: qué falta, cómo obtenerlo, quién.
8. **Riesgos y exposición**: matriz sin doble conteo, con nota.
9. **Plan de acción**: acción, motivo, responsable, plazo, evidencia de cierre.
10. **Cumplimiento**: calendario y declaraciones.
11. **Tendencias**: serie e IVA.
12. **Metodología**: pesos, reglas, versión.
13. **Limitaciones y base normativa**.
14. **Emisión**: «Informe técnico generado por el Sistema Contable JMV. No constituye certificación tributaria ni del SII. Verificación: <folio/hash o “no disponible”>.»

---

## 3. Certificado TGR (DOC-02)

| Aspecto | Estado |
|---|---|
| Origen | PDF oficial descargado, no reconstruido |
| Datos mostrados | Estado, total rotulado, emisión, liquidada al, código de verificación, detalle, fuente, última consulta |
| Regla | Si el total no es legible, `NULL`; no se suma a mano |
| Presentación | Pestaña en Salud y pestaña en Tesorería (duplicado) |
| Riesgo | Se muestra junto al informe de JMV y puede leerse como si el informe fuera certificado |

**Corrección:** separar visualmente «Documento oficial de la TGR» (con su código de verificación y fecha) del «Informe de JMV». Nunca mezclar ambos en la misma tarjeta sin rótulo.

---

## 4. Reportes financieros y exportaciones

| Reporte | Pantalla | Export | Problema |
|---|---|---|---|
| Balance de comprobación | `#comprobacion` | — | Sin export (UITabla no montada) |
| Balance 8 columnas | `#balance8` | — | Sin export |
| Situación financiera | `#situacion` | — | Sin export |
| Resultados | `#resultados` | — | Sin export |
| Clasificado | `#clasificado` | — | Sin export |
| NIIF | `#niif` | — | Mapeo editable; sin export |
| Cuenta corriente | `#cclientes/#cproveedores` | — | Filtros básicos |
| Libros | `#libros` | CSV/XLS (UITabla) | — |
| Bandeja | `#documentos` | CSV/XLS | — |
| Auditoría | `#auditoria` | CSV/XLS | Sin filtros de servidor |
| Informe por rango | `#informe-rango` | Excel | Legacy |
| ZIP masivo | `#exportacion-masiva` | ZIP | Legacy |

**Hallazgo:** los estados financieros «oficiales» no se pueden exportar ni imprimir desde la vista, mientras que las tablas operativas sí. Es una brecha de producto: el contador necesita entregar el balance.

---

## 5. Auditoría de mensajes

### 5.1 Mensajes actuales y su problema

| Texto actual | Dónde | Problema | Reemplazo propuesto |
|---|---|---|---|
| «No se pudo cargar el diagnóstico» + `err.message` | P-002 | No dice qué falló, ni qué sigue disponible | «No fue posible cargar el diagnóstico. Los demás módulos siguen disponibles. Reintentar · Ver detalle» |
| «No evaluable con los antecedentes disponibles» | P-002 KPIs | Se usa para «sin datos» y para «valor 0» | «Sin datos para calcularlo» / «$0 (sin exposición identificada)» |
| «No disponible todavía» | P-021 | Contradice funciones existentes | Enlazar o eliminar |
| «Sin información» | Chips F29 | Ambiguo | «El SII no informa declaración para este período» |
| «No consultado» | Tablas | Correcto, pero sin acción | «No consultado — Consultar ahora» |
| «Al día» | Salud, Centro | Sugiere conformidad absoluta | «Sin hallazgos en el alcance revisado» |
| «Error» (cartel genérico) | Vistas | No distingue causa | Taxonomía de 9 estados (`12` §6) |
| Toast con `err.message` crudo | Toda la app | Puede exponer jerga técnica | Mensaje de usuario + detalle técnico plegable |
| «Licencia SUSPENDIDA: puedes consultar, pero no registrar movimientos» | Banner | Correcto | Conservar |
| «El navegador bloqueó la ventana emergente…» | Salud/TGR | Correcto | Conservar; añadir enlace alternativo |

### 5.2 Taxonomía de mensajes (tono y estructura)

Todo mensaje debe responder: **qué pasó**, **qué alcance tiene**, **qué sigue disponible**, **qué puede hacer el usuario**.

```text
[Título: hecho, sin culpar]
[Alcance: "Este apartado no está verificado para el período"]
[Contexto: "Los demás análisis con información válida siguen disponibles"]
[Acción: Reintentar · Ver detalle técnico · Consultar ahora]
```

**Prohibido:**
- «Error inesperado» sin detalle.
- Mostrar un `stack` o un SQL al usuario.
- Rojo para «sin datos» o «fuente no habilitada».
- «Al día» sin alcance.
- «Certificado» para un informe propio.

### 5.3 Mensajes por estado (definitivos propuestos)

| Estado | Título | Cuerpo | Acción |
|---|---|---|---|
| Verificado | «Verificado en el SII» | «Consultado el DD/MM/AAAA HH:MM.» | Ver evidencia |
| Diferencia | «Diferencia detectada» | «El F29 declarado y el RCV difieren en $X. Es materia de investigación, no un incumplimiento.» | Ver detalle |
| Pendiente | «F29 pendiente» | «El SII registra N períodos sin declaración vigente.» | Ver plan |
| Sin datos | «Sin datos para este análisis» | «La fuente no se ha consultado. Esto no significa que no exista.» | Consultar |
| Fuente no disponible | «No fue posible completar la consulta» | «Los resultados de este apartado no están verificados. El resto del informe sigue disponible. Motivo: …» | Reintentar / detalle |
| No habilitada | «Fuente no habilitada» | «Esta empresa no tiene habilitada la consulta de … .» | Configurar |
| No concluyente | «Análisis no concluyente» | «No hay antecedentes suficientes para emitir un índice.» | Completar datos |
| Tope SII | «El SII alcanzó el límite de sesiones» | «Cierra las sesiones abiertas del contribuyente y vuelve a intentar.» | Ver instrucciones |
| Sin navegador | «El servidor no puede leer el portal» | «Falta Chrome/Chromium en el servidor. Avisa a soporte.» | Copiar detalle |

---

## 6. Verificación y confianza del documento

| Requisito | Estado actual | Propuesta |
|---|---|---|
| Folio único | `JMV-TH-<empresa>-<periodo>-<timestamp>` (determinista) | Añadir hash SHA-256 del contenido y correlativo |
| URL de verificación | No existe | `GET /verificar/:folio` con hash y estado (o declarar «sin verificación pública») |
| Firma | No | «Generado automáticamente por el Sistema Contable JMV» + usuario |
| Versión de reglas | No | `version_reglas` en el snapshot y en el pie |
| Trazabilidad | Snapshot JSON completo | Enlazar snapshot al folio |

**Decisión pendiente (DEC-04):** ¿el informe debe ser verificable públicamente? Si sí, implica endpoint y privacidad; si no, debe declararlo explícitamente.

---

## 7. Recomendaciones

1. **P0**: corregir los 9 defectos del informe (§2.2) antes de cualquier rediseño visual.
2. **P0**: prohibir «certificado» para el informe de salud y separar el PDF de la TGR.
3. **P1**: implementar el bloque «Estado de las fuentes» con fecha y vigencia.
4. **P1**: aplicar la taxonomía de 9 estados en vista y documento.
5. **P1**: exportar los estados financieros (PDF/Excel) desde sus vistas.
6. **P2**: folio + hash + verificación.
7. **P2**: firma/responsable y versión de reglas.
