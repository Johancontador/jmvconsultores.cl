# Roadmap de Funcionalidades — IVA Mensual

Fuente de verdad del **qué se puede construir** aprovechando la conexión SII que ya
funciona (login directo, RCV compras/ventas, caché de períodos cerrados, informes
persistidos en SQLite, multiusuario). Cada opción indica el dato que la hace posible:
si el dato ya llega, la funcionalidad es solo presentación + lógica, sin tocar el
scraper (la parte frágil).

## 0. Implementado

### Portafolio multi-cliente (nueva landing) + Herramientas (6 vistas)

**Landing rediseñada ("Dashboard del Contador"):** al abrir la app ya no se ve un empty
state vacío — se muestra el estado de TODAS las empresas: KPIs agregados (ventas,
compras, IVA), próximos vencimientos F29 con días restantes, tarjetas por empresa con
su resumen (clic = seleccionarla) y accesos rápidos a todas las herramientas. Cero
consultas al SII al abrir: lee solo lo persistido.

| Vista | Qué hace | Verificado con datos reales |
|---|---|---|
| **Duplicadas** | Detecta facturas (30/32/33/34/43/46/52) con folio+contraparte repetidos en el rango | 2.744 analizadas → 10 folios duplicados ($3.000.000) |
| **Comparador F29** | F29 estimado mes a mes (IVA+PPM), gráfico y delta vs promedio | 9 meses, promedio $4,8M |
| **Interés penal** | Calculadora art. 53 CT: monto + fechas + tasa → días, interés, total | Prellena el último vencimiento |
| **Checklist cierre** | 10 pasos de cierre mensual, persistente por empresa+mes (localStorage) | Septiembre 2026, 10 ítems |
| **Cobranza** | Mensaje de cobranza en 3 tonos (cordial/formal/firme) → wa.me prellenado | — |
| **Conversor DTE** | XML DTE → Excel 100% en el navegador (nada sale del computador) | — |

### Centro Tributario (5 nuevas vistas, menú 🛡️)
| Vista | Qué hace | Dato que usa |
|---|---|---|
| **Validador de IVA** | Recalcula débito/crédito documento a documento y lo concilia contra el informe — diferencias en rojo, veredicto "Concilia/Diferencias" | Informe en modo detalle (NC con signo) |
| **Calculadora PPM y F29** | Base de ventas editable + tasa 0,4/0,5/1% → PPM, IVA y F29 estimado, con escenarios anuales | Ventas sincronizadas como default |
| **Calendario tributario** | Vencimiento F29 por mes declarado (día 20, mes siguiente) con badges Venció/Esta semana/En plazo + F22 de abril | Meses del informe |
| **Documentos pendientes** | Reclamadas, ventas sin RUT, NC de compras, compras sin IVA recuperable — agrupados con detalle | Documentos del informe |
| **Observaciones** | Panel "¿mi empresa tiene observaciones?": checklist + alertas + KPIs del período | Todo lo anterior |

Cambios de soporte: informeDocumentos ahora se persiste de verdad (tabla informe_documentos, antes existía pero nunca se escribía), migración de columnas creado_en/actualizado_en en informe_meses, sincronizaciones del shell en modo detalle, nueva etiqueta de docs con mes numérico.

Del listado original de ideas: el **Conciliador SII vs contabilidad** queda como el validador de IVA (conciliación interna doc-vs-informe); comparar contra un ERP externo requiere importación de datos (pendiente). "Actividades económicas" requiere un endpoint nuevo del SII (no está en el RCV actual). El **Generador de descripción de actividad** es independiente del SII (pura redacción) — pendiente.

### UX y congruencia de reportes

| Mejora | Dónde |
|---|---|
| Presets de período con un clic (Este mes · Últimos 3 meses · Año actual · Año anterior · Últimos 12 meses) con resaltado del preset activo | Barra de filtros global del shell |
| Chips de contexto bajo el título de cada reporte: empresa · RUT · período · fuente de datos | `reportes.js` — responden "¿de quién es esto?, ¿de cuándo?, ¿se puede confiar?" |
| Dashboard con subtítulo dinámico (empresa + período) y empty states accionables con botón "⚡ Sincronizar con el SII" | `dashboard.js` / `reportes.js` |
| Etiqueta legible de rango compartida (`etiquetaRangoMesAnio`) para que dashboard y reportes nombren el período igual | `shared/format.js` |

## 1. Quick wins — el dato ya existe, falta presentarlos

Estos usan exclusivamente lo que `informe.js` ya guarda en SQLite:

1. **Comparación YoY (mismo mes, año anterior).** `informe_meses` tiene todos los
   períodos históricos por cliente. Un reporte "Ventas Sept 2026 vs Sept 2025" con
   delta absoluto y % es una consulta agrupada + tabla.
2. **Concentración de cartera y de compras.** `informe_top_contrapartes` ya agrega
   por RUT. KPI tipo "tus 3 mayores clientes = 61% de las ventas" con barra de
   riesgo (concentración alta es señal de alerta comercial).
3. **Análisis de Notas de Crédito.** Los documentos con `tipoDoc` 60/61 ya llegan en
   `informe_documentos`. Reporte: NC por mes, % sobre ventas, ranking de clientes que
   más NC generan (indicador de discusiones de precio o problemas de facturación).
4. **Mapa de calor de estacionalidad.** Mes (fila) × año (columna) con ventas netas
   coloreadas — se arma con `informe_meses`, ideal para ver patrones anuales.
5. **Reporte de boletas vs facturas.** Mix de `tipoDoc` por período: cuánto se vende
   con boleta (39/41) vs factura (33/34) — útil para clientes tipo retail.
6. **Proyección de cierre del mes en curso.** Con ventas parciales del mes actual
   (el caché excluye el mes corriente, pero una consulta "live" al abrir el reporte
   es factible) proyectar ventas/IVA de cierre.

## 2. Automatización — convertir la app en "corre sola"

7. **Sincronización automática mensual.** Cron interno (o al primer login del día):
   generar el informe del mes cerrado para todos los clientes. La caché de períodos
   cerrados (`rcv_cache`) garantiza que no se repita una consulta exitosa, así que
   el costo de reintentos es cero.
8. **Resumen por WhatsApp programado.** `proceso.js` ya redacta
   `generarMensajeWhatsApp()` con el IVA determinado + PPM. Extenderlo a envío
   programado por cliente (hoy es botón manual que abre wa.me) y a un resumen
   mensual para el contador con todos los clientes.
9. **Alertas activas.** `calcularAlertas()` (caída de ventas ≥30%, remanente 3 meses,
   documentos sin RUT, facturas reclamadas) hoy es un reporte que hay que abrir.
   Enviar las críticas por WhatsApp/correo al detectarse, tras cada sincronización.
10. **Recordatorio de calendario tributario.** F29 vence el día 12–20 según rol del
    RUT; con `tasa_ppm` guardada se puede estimar el F29 y avisar X días antes.
11. **Detector de clave SII vencida.** Guardar el resultado del último intento por
    cliente (ya hay `estado/error_msg` en informes y procesos); si N intentos seguidos
    fallan con error de credenciales, marcar el cliente con badge "clave vencida" y
    avisar — evita descubrirlo cuando se necesita el dato.

## 3. Profundidad analítica — consultas nuevas sobre los documentos ya descargados

12. **Detalle de IVA no recuperable / uso común.** El motor de "montos de gestión"
    (`columnasMontosGestion`) ya detecta columnas dinámicas del SII (activo fijo,
    uso común, tabacos…). Falta un reporte dedicado "crédito recuperable vs no
    recuperable" — es exactamente lo que el contador necesita para el asiento.
13. **Libro mayor por contraparte.** Click en un cliente/proveedor de Top Clientes →
    drill-down a sus documentos en el rango (el detalle ya está en
    `informe_documentos`, solo hay que filtrar por `rut_doc`).
14. **Conciliación compras vs ventas (crucial para exportadores).** Clientes con
    ventas exentas y compras con crédito alto = remanente estructural; el reporte
    "Exportaciones" puede volverse analítico con los montos exentos por RUT.
15. **Auditoría de folios.** Detección de huecos de folio por tipo de documento —
    señal de facturas anuladas sin NC. Es un `GROUP BY tipoDoc, folio` con detección
    de saltos.

## 4. Plataforma — producto para el contador

16. **Carpetas de clientes / equipos.** `clientes.user_id` ya existe; agregar
    `cliente_grupos` para que un contador con 50 clientes los agrupe por giro o
    responsable, y filtre el sidebar/dashboard por grupo.
17. **Roles secundarios (solo-lectura, solo-un-cliente).** `users.is_admin` ya existe;
    agregar `users.cliente_id` opcional para "dueño de empresa que solo ve lo suyo".
18. **Configuración desde la app.** Hoy `NOMBRE_CONTADOR`, `RCV_PROVIDER`, etc. viven
    en `.env` (lo dice la pantalla de Configuración). Mover a tabla `config` editable
    desde la UI, con la pantalla ya existente como destino.
19. **Historial de consultas SII (auditoría).** Tabla `sii_log`: quién consultó qué
    período y cuándo. Protege al contador ante reclamos y diagnostica fallos.
20. **API para el contador externo.** Token por usuario + endpoints
    `/api/informe/:id/export?formato=csv` para integrar con su ERP/sistema contable
    actual sin pasar por la UI.

## Prioridad sugerida

| Fase | Ítems | Por qué primero |
|---|---|---|
| 1 (esta semana) | 1, 2, 7, 8, 11 | Máximo valor por esfuerzo: todo el dato ya está guardado o es un cron sencillo |
| 2 | 3, 9, 10, 12, 18 | El contador empieza a depender de la app sin abrirla |
| 3 | 4, 5, 13, 14, 16 | Profundidad analítica y organización |
| 4 | 6, 15, 17, 19, 20 | Producto y escala |

## Nota técnica que condiciona todo el roadmap

El scraper del SII (`sii-session.js` / `sii-rcv.js`) es la parte frágil y está
marcado "no tocar sin necesidad" en MASTERPLAN.md. Todas las funcionalidades de
este roadmap fueron diseñadas para consumir **solo** lo que esas dos capas ya
entregan hoy (documentos RCV con montos) más lo persistido en SQLite. Si mañana
cambia el SII, el roadmap sobrevive.

--- estado de implementación al 28-10-2026 ---

| Funcionalidad | Evidencia |
|---|---|
| Duplicadas (detecta folios repetidos) | Implementada y verificada: 2.744 analizadas → 10 folios duplicados ($3.000.000) |
| Comparador F29 (IVA+PPM mes a mes) | Implementada: 9 meses, promedio $4,8M en datos reales |
| Interés penal art. 53 CT | Implementada; prellena último vencimiento |
| Checklist cierre (10 pasos) | Implementada: persistente por empresa+mes (localStorage) Septiembre 2026 |
| Cobranza (wa.me prellenado) | Implementada; mensaje en 3 tonos (cordial/formal/firme) |
| Conversor DTE → Excel | Implementada; 100% en navegador, nada sale del computador |
| Validador IVA (doc-to-doc + conciliación) | Implementada; concilia a $0 con datos reales |
| Calculadora PPM y F29 (editable) | Implementada; ventas sincronizadas como default; escenarios anuales |
| Calendario tributario (F29/F22) | Implementada; badges Venció/Esta semana/En plazo; F22 de abril |
| Documentos pendientes (reclamadas, sin RUT, NC, sin IVA) | Implementada; agrupados con detalle desde `informe_documentos` |
| Observaciones (checklist + alertas + KPIs) | Implementada; panel completo con todo lo anterior |
| Comparación YoY (mismo mes año anterior) | Usa `informe_meses`; consulta agrupada + tabla; dato ya existe |
| Concentración de cartera y compras | Usa `informe_top_contrapartes`; KPI "3 mayores clientes = 61% ventas" |
| Análisis de Notas de Crédito | Usa `informe_documentos` (tipoDoc 60/61); NC por mes, % ventas, ranking clientes |
| Mapa de calor estacionalidad | Usa `informe_meses`; mes×año con ventas netas coloreadas |
| Boletas vs facturas (mix tipoDoc) | Usa `informe_meses`; boleta 39/41 vs factura 33/34; útil retail |
| Proyección cierre mes en curso | Consulta "live” al abrir reporte; ventas/IVA proyectado de cierre |
| Sincronización automática mensual | Usa cron + `rcv_cache`; informe mes cerrado para todos clientes; costo reintentos cero |
| Resumen WhatsApp programado | `proceso.js` redacta `generarMensajeWhatsApp()`; extensión a envío programado pendiente |
| Alertas activas (caída ≥30%, remanente 3M, sin RUT, facturas reclamadas) | Hoy es reporte que hay que abrir; pendiente enviar por WhatsApp/correo post-sync |
| Recordatorio calendario tributario (F29) | Con `tasa_ppm` guardada; estimar F29 y avisar X días antes |
| Detector clave SII vencida | Guardar último intento por cliente (estado/error_msg en informes/processes); N fallos → badge "clave vencida" |
| Crédito no recuperable / uso común | Motor `columnasMontosGestion` detecta columnas dinámicas; falta reporte dedicado |
| Libro mayor por contraparte | Click cliente/proveedor Top → drill-down a documentos por `rut_doc` (ya en `informe_documentos`) |
| Conciliación compras vs ventas (exportadores) | Clientes con ventas exentas + compras crédito alto = remanente estructural; reporte "Exportaciones" analítico con montos exentos por RUT |
| Auditoría de folios | GROUP BY tipoDoc, folio con detección de saltos; señal facturas anuladas sin NC |
| Carpetas clientes/equipos | `clientes.user_id` existe; pendiente `cliente_grupos` para filtrar por giro/responsable |
| Roles secundarios (solo-lectura, solo-un-cliente) | `users.is_admin` existe; pendiente `users.cliente_id` opcional |
| Configuración desde la app | `NOMBRE_CONTADOR`, `RCV_PROVIDER` en `.env`; pendiente mover a tabla `config` editable UI |
| Historial consultas SII (auditoría) | Tabla `sii_log`; quién consultó qué período y cuándo |
| API para contador externo | Token por usuario + `/api/informe/:id/export?formato=csv`; implementado |
| Planificación Tributaria (ficha régimen/fecha_vigencia) | Implementada en código: rutas `/api/contable/empresas/:id/planificacion/*` (GET devuelve 200 con `ficha:null` si aún no hay incorporación — no 404; POST crea una única vez y devuelve **409** si ya existe; PUT actualiza y devuelve **404** sin ficha); esquema con `regimen`, `regimen_desde_ac`, `fecha_vigencia`; 3 archivos de test listados en `package.json`; `CAMPOS_TRIBUTARIOS` es un objeto: `TIPO_CONTRIBUTUYENTE = ['PENDIENTE','PERSONA_NATURAL','PERSONA_JURIDICA']`, `REGIMEN = ['PENDIENTE','PRO_PMYE_GENERAL','PRO_PMYE_TRANSPARENTE','GENERAL_14A','PRESUNTO','NO_SUJETO_14']`, `ESTADO_FICHA = ['SIN_CONFIGURAR','CONFIGURADA']`. **No marcada como terminada solo por existir prueba** — `fecha_vigencia` hoy **no es obligatoria** (ni capa de aplicación ni CHECK de BD; decisión de negocio pendiente), se requiere validación contable de coherencia `fecha_vigencia`/`regimen_desde_ac` y tratamiento de empresas sin ficha.
| Salud Tributaria v2 (F29+boletas+F22+indicadores+PDF) | Implementada en código: `declaraciones-sii.js`, `salud-tributaria.js`, formularios F29, `renta-sii.js`, `informe-salud-html.js`; tests: corrida documentada 28-10 citada como «82 de salud» (no reejecutada en D2; conteo estático 29-10: 76 declaraciones en 7 suites relacionadas); datos históricos: **5 de 6 empresas** con 5 años F29+boletas (1, 2, 3, 5, 6 — la **empresa 4 falló por sesión/credenciales**, sin datos); PDF generable; score/cobertura/confianza. **No marcada como terminada solo por existir prueba** — pendientes ST-10 a ST-13 (rótulos, año tributario AT, 14 pruebas numéricas §8, metodología); diferencias tributarias requieren revisión contable comparando conceptos equivalentes.
| TGR (Deuda Fiscal) | *Implementado en código:* SSO delegado en SII (clave Tributaria → OAuth SII), certificado PDF embebido, token `vr`; lectura estructurada (`backend/core/deuda-tgr.js`, detalle por línea), persistencia (tabla `deuda_tgr` con `INSERT`), endpoints en `backend/routes/tesoreria.js`, panel «Deuda fiscal (TGR)» en `frontend/sistema/views-salud.js` e informe (`deudas.fiscal_tgr`); `test/deuda-tgr.test.js` en `npm test` (commit `85f93e9`, 23-10). *Pendiente de verificación en producción (VPS):* filas reales, ejecución programada y funcionamiento efectivo. **No marcada como terminada:** la verificación de datos en producción no se hizo.
| Backups R2 + notificaciones Pushover | *Cron local de backup cifrado — evidencia documental histórica:* `docs/33` §15 (25-10) registra `[BACKUP-CHECK] OK` cada 6 h y backup de las 03:00 cifrado «verificado y restaurado en aislado»; no re-ejecutado en D2. *Integración externa R2 + Pushover:* implementados técnicamente (script, flujo, bucket, credenciales) **sin cron ni ejecución documentados**; estado operativo no verificado. **No se afirma que falten respaldos automáticos.** |
| Captación / CEO (roadmap interno) | Documentado en `docs/ROADMAP-CAPTACION-2026-10-28.md`; pendiente validación legal, revisión privacidad/retención, Search Console (checklist 7 pasos sin autenticar), piloto QA cerrado, contenido orgánico, pauta requiere gates legales. **No marcar como lista para pauta pagada.**
