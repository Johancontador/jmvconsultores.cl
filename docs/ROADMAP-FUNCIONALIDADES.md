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
