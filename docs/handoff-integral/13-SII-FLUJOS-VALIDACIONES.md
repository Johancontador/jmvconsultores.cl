# 13 · SII — flujos, validaciones y confianza

> Basado en `services/sii-session.js`, `services/sii-rcv.js`, `services/rcv.js`, `core/empresas-sii.js`, `core/declaraciones-sii.js`, `core/f29-formulario.js`, `core/renta-sii.js`, `core/dj-sii.js`.
> **No se ejecutó ninguna llamada real.** Lo marcado «verificado previamente» proviene de comentarios y tests del repo, no de esta pasada.

---

## 1. Recorrido completo de la información

```text
[1] Solicitud      SPA → POST /api/contable/... (o job)
[2] Auth           requireAuth → requirePermiso → licencia (si escribe)
[3] Credencial     bóveda AES-256-GCM → clave SII de la empresa
[4] Sesión SII     login (CAutInicio.cgi) → cookies → token RCV
[5] Consulta       facadeService / portal / CGI / PDF
[6] Respuesta      JSON, HTML, CSV-en-JSON o PDF
[7] Transformación parseo → normalización → validación
[8] Almacenamiento documentos / declaraciones_sii / f29_formularios / deuda_tgr
[9] Cálculo        IVA/PPM/F29 estimado, comparaciones, índice
[10] Presentación  panel (10 pestañas) + informe imprimible
[11] Evidencia     snapshot JSON + PDF TGR + ficha cruda
```

---

## 2. Autenticación

| Paso | Detalle | Validación |
|---|---|---|
| GET login | Cookies de balanceador | Se guardan por salto |
| POST `CAutInicio.cgi` | `form-urlencoded` con RUT, DV, referencia | Nunca GET |
| Éxito | Cookies de sesión (`TOKEN`, `CSESSIONID`, `RUT_NS`, `DV_NS`, `NETSCAPE_LIVEWIRE.*`, `X-SII-STATE-*`) | Si solo hay cookies de balanceador → login rechazado |
| Clave incorrecta | Contenido de la respuesta / redirección a login | Variantes: «no es correcta», «La Clave Tributaria ingresada no es correcta» |
| Token RCV | `getResumen` devuelve `TOKEN` o `metaData.conversationId` | Sin ninguno → error explícito «login básico ok, pero la sesión no habilita el RCV» |
| Caché | `Map` por RUT, TTL 25 min | Se reutiliza entre consultas |
| Cierre | `CAutCierra.cgi` / `autTermino.cgi` | **Siempre** en `finally` en declaraciones y TGR |

---

## 3. RCV

| Aspecto | Detalle |
|---|---|
| Métodos | `getDetalleCompraExport`, `getDetalleVentaExport`, `getResumen` |
| Formato | Array JSON de strings CSV (`;`), `data[0]` encabezados |
| Paginación | `metaData.page.totalPages` / `pageNro`; se recorren todas |
| Rate limit | `INTERVALO_MS` global entre consultas; reintento por sesión expirada |
| Normalización | `tipo_doc`, `folio`, `rut`, `razon_social`, `monto_neto`, `monto_iva`, `monto_exento`, `monto_total`, fechas, `montos_sii_json`, `detalle_sii_json` |
| Agregados | Tipos 39/41/48: una fila por total; se guardan en `rcv_agregados` (sin folio) |
| Validaciones | RUT y DV; exclusión de ANULADO/ERROR en agregaciones de analítica (documentado en tests) |
| Caché | `rcv_cache` solo períodos cerrados; `meta.rcv_cache_version` invalida |
| Idempotencia | `clave_dedupe` en `documentos` |

**Riesgo de integridad:** el CSV no trae un esquema versionado. Un cambio de columnas se detecta por posición; el sistema conserva el crudo (`montos_sii_json`) para diagnóstico, pero la normalización fallaría en silencio si cambia el orden. **Recomendación:** validar encabezados contra una lista y fallar ruidosamente.

---

## 4. Ficha del contribuyente

| Aspecto | Detalle |
|---|---|
| Fuente | `misiir.sii.cl/cgi_misii/siihome.cgi`, JSON `DatosCntrNow` embebido en HTML |
| Datos | Identidad, tipo/subtipo, inicio/término de giro, actividades, dirección, capital, atributos (régimen), email, teléfono, alertas |
| Regla | El RUT de la ficha debe coincidir con el solicitado; si no, se rechaza |
| Persistencia | Campos en `empresas` + crudo en `data/sii-fichas/<rut>.json` |
| Fallback | Si la cuenta no habilita token RCV, login básico para la ficha |
| Validación | Parser tolerante; `null` si el atributo no está (nada inventado) |
| Riesgo | Depende de la maqueta HTML; no hay contrato oficial |

---

## 5. Declaraciones (F29, F22, DJ, BHE)

| Consulta | Mecanismo | Datos | Persistencia | Idempotencia |
|---|---|---|---|---|
| F29 estado | Chrome headless; tooltip de la matriz + «Buscar Formulario» | Estado, folio, fecha, monto | `declaraciones_sii` | UPSERT empresa/tipo/período |
| F29 casillas | Descarga del Formulario Compacto (PDF) + `pdf-parse` + texto | Casillas 538/563/111/759/etc. | `f29_formularios` | UPSERT |
| F22 | Fachada JSON (`consultaestadof22ui`) | Folio, concordancia, estado, remanente, eventos | `declaraciones_sii` | UPSERT |
| DJ | Fachada JSON (`perfilamientodjui`) | Formulario, estado, folio, fechas, vencimiento | `declaraciones_sii` | UPSERT |
| BHE | CGI `loa.sii.cl` (SSO) | Honorario bruto, retención, líquido por mes | `declaraciones_sii` | UPSERT |

**Reglas de oro implementadas**
1. Una autenticación por corrida; cierre siempre.
2. Navegador ausente ⇒ 424 **antes** de autenticar.
3. Tope de sesiones ⇒ 409, no reintentar.
4. Sin dato ⇒ `sin_informacion`; sin consulta ⇒ no hay fila y el informe dice `no_consultado`.
5. Ningún monto se reconstruye a mano: si el PDF no es legible, `null`.

**Deuda documental:** el encabezado de `declaraciones-sii.js` dice que F22 y DJ «no se consultan aquí», pero el código las consulta (importa `rentaSii` y `djSii` y las ejecuta). **Corregir el comentario** para que un nuevo agente no desactive la función.

---

## 6. TGR

| Paso | Detalle |
|---|---|
| Portal | `tgr.gob.cl/tramites-tgr/certificado-de-deuda-fiscal` |
| SSO | `www2.sii.cl/oauthsii-v1-org` con RUT + clave tributaria |
| Token | `LoginPortalPagosTGR12Web/redirect?vr=<base64>` de un solo uso |
| Documento | PDF embebido en iframe (`data:application/pdf;base64`) |
| Evidencia | PDF en `data/certificados-tgr/` + texto extraído |
| Parseo | `NO REGISTRA DEUDA` ⇒ 0; total rotulado; detalle tolerante (no inventa filas) |
| Riesgo | Captcha en la cartola fiscal (no se automatiza); cambios del portal |

---

## 7. Errores, reintentos y recuperación

| Situación | Detección | Respuesta | Reintento |
|---|---|---|---|
| Clave incorrecta | Contenido/redirect | Error de login con mensaje del SII | No automático; el usuario corrige |
| Sin cookies de sesión | Validación de cookies | Error explícito | Un reintento interno en login |
| Sesión RCV sin token | `getResumen` sin TOKEN/conversationId | Error explícito | No; requiere revisar la cuenta |
| 401 en facadeService | HTTP 401 | Reintento con re-login | Sí, una vez |
| Timeout / red | Excepción de fetch | Error de paso; el job sigue | Sí, por paso |
| Tope de sesiones | Código `SII_TOPE_SESIONES` | 409 con instrucción | No; cerrar sesiones |
| Sin navegador | `SII_SIN_NAVEGADOR` | 424 antes de autenticar | No; instalar Chrome |
| SII caído | 5xx | 502 | Sí, manual |
| PDF ilegible | Parser sin total | `total = null`, PDF conservado | Sí, manual |

**Patrón de jobs:** cada paso es independiente; un fallo no impide los demás (test S2). El estado se expone por paso (`pendiente`, `en_curso`, `ok`, `error`) y el front hace polling cada 3 s.

---

## 8. Vigencia y datos antiguos

| Control | Estado |
|---|---|
| `consultado_en` por registro | Sí |
| `generado_en` del informe | Sí |
| Snapshot inmutable | Sí |
| Caché de resumen 60 s | Sí, invalidada al sincronizar |
| **Marca de «vigente/vencida» en la UI** | **No** |
| **Fecha por fuente en la portada** | **No** |
| **Detección de fuente caída vs dato viejo** | Parcial (el backend conserva lo último; no lo rotula) |

**Riesgo:** un informe generado hoy puede contener un F29 consultado hace 90 días y una TGR de hace 6 meses, y la portada no lo dice. La sección 8 del informe lista fuentes, pero sin fecha por fuente.

**Propuesta:** bloque «Estado de las fuentes» con `fuente · última consulta · resultado · vigencia (vigente/vencida/sin datos)` y un sello global «Diagnóstico generado el … con datos al …».

---

## 9. Qué afirmaciones tributarias se pueden sostener

| Afirmación | ¿Se puede sostener? | Condición |
|---|---|---|
| «El SII registra N períodos con F29 declarado» | Sí | Solo si se consultó la fuente y hay folio/estado |
| «Hay N períodos con F29 pendiente» | Sí | Solo si la consulta cubrió esos períodos |
| «El F29 declarado difiere del RCV» | Sí, como **diferencia por investigar** | Requiere RCV ingerido y monto declarado |
| «La empresa incumplió» | **No** | Una diferencia o falta de datos no prueba incumplimiento |
| «No hay deuda fiscal» | Solo si el certificado TGR lo dice | Fecha de emisión obligatoria |
| «Está al día» | **No** de forma absoluta | Solo «sin hallazgos dentro del alcance revisado» |
| «El índice es 85/100» | Sí, como indicador propio | Debe mostrarse con cobertura y metodología |

---

## 10. Plan de validación sin efectos tributarios (para la fase de implementación)

1. **Fixtures congelados** de respuestas reales anonimizadas (CSV RCV, HTML ficha, PDF F29, PDF TGR) y pruebas de parser.
2. **Simulador de SII** local (ya usado en `sii-sesion.test.js`) para login, 401, timeouts y topes.
3. **Prueba de contrato del informe**: 8 capítulos, sin `[object Object]`, sin variables CSS indefinidas, tablas que caben en A4.
4. **Prueba de vigencia**: dos snapshots con fechas distintas; la UI debe mostrar la más antigua por fuente.
5. **Prueba de ausencia**: sin TGR/F22/DJ, el informe debe decir «no consultado» y **no** restar puntos.
6. **Nunca** ejecutar emisión de DTE, declaraciones ni pagos en pruebas.

---

## 11. Hallazgos SII (resumen)

| # | Hallazgo | Severidad |
|---|---|---|
| SII-01 | Sin validación de encabezados del CSV del RCV | Media |
| SII-02 | Comentario obsoleto sobre F22/DJ en `declaraciones-sii.js` | Baja (pero induce a error) |
| SII-03 | Sin fecha por fuente en portada del informe | Alta |
| SII-04 | UI no distingue fallo técnico de dato ausente | Alta |
| SII-05 | Dependencia de Chrome no chequeada en readiness | Media |
| SII-06 | Tope de sesiones sin panel de cierre | Media |
| SII-07 | F29 leído por dos vías sin comparación entre sí | Media |
| SII-08 | Parseo de HTML de ficha frágil y sin alarma de cambio | Media |
| SII-09 | `periodoActual()` depende de la zona horaria del servidor | Media |
| SII-10 | Sin monitoreo sintético de las fuentes | Media |
