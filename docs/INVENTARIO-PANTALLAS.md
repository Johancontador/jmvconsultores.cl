# Inventario de pantallas y registro de cobertura — rediseño 2026.3

Generado el 2026-10-17 desde el código real (`frontend/sistema/views-*.js`) y los
resultados de QA en navegador. Solo figuran pantallas que existen en el repositorio.

- **Vistas inventariadas**: 44 (`window.VIEWS`)
- **Con rediseño propio (cambios en su vista)**: 24
- **Adaptadas por la capa de sistema (sin cambios de composición)**: 20
- **Módulos fuente**: 16 archivos `views-*.js`
- **Sub-pestañas detectadas en el código**: 31
- **Mediciones de QA**: 44 vistas × (1440, 1280, 768, 390 claro) + 44 en oscuro 1280 = 220
- **Vistas OK en claro (4 anchos)**: 44/44
- **Vistas OK en oscuro (1280)**: 44/44
- **Fallos registrados**: claro 0, oscuro 0

Criterio de "ok": la vista renderiza contenido, `document.documentElement.scrollWidth`
no supera el ancho de ventana (sin desbordamiento de página) y no hay excepciones ni
errores de consola durante la carga. Las tablas anchas pueden desplazarse dentro de
su propio contenedor; eso no cuenta como desbordamiento.

## 1. Vistas

| # | Ruta | Módulo | Estado de rediseño | Claro 1440/1280/768/390 | Oscuro 1280 |
|---|------|--------|--------------------|--------------------------|-------------|
| 1 | `#activos` | activos | Hereda capa | ok / ok / ok / ok | ok |
| 2 | `#alertas` | alertas | Hereda capa | ok / ok / ok / ok | ok |
| 3 | `#analitica` | analitica | Hereda capa | ok / ok / ok / ok | ok |
| 4 | `#automatizacion` | autom | Rediseñado 2026.3 | ok / ok / ok / ok | ok |
| 5 | `#centro` | centro | Rediseñado 2026.3 | ok / ok / ok / ok | ok |
| 6 | `#cobranza` | cobranza | Rediseñado 2026.3 | ok / ok / ok / ok | ok |
| 7 | `#admin` | conta | Rediseñado 2026.3 | ok / ok / ok / ok | ok |
| 8 | `#asientos` | conta | Rediseñado 2026.3 | ok / ok / ok / ok | ok |
| 9 | `#auditoria` | conta | Rediseñado 2026.3 | ok / ok / ok / ok | ok |
| 10 | `#balance8` | conta | Rediseñado 2026.3 | ok / ok / ok / ok | ok |
| 11 | `#cclientes` | conta | Rediseñado 2026.3 | ok / ok / ok / ok | ok |
| 12 | `#cierre` | conta | Rediseñado 2026.3 | ok / ok / ok / ok | ok |
| 13 | `#clasificado` | conta | Rediseñado 2026.3 | ok / ok / ok / ok | ok |
| 14 | `#comprobacion` | conta | Rediseñado 2026.3 | ok / ok / ok / ok | ok |
| 15 | `#cproveedores` | conta | Rediseñado 2026.3 | ok / ok / ok / ok | ok |
| 16 | `#externos` | conta | Rediseñado 2026.3 | ok / ok / ok / ok | ok |
| 17 | `#memoria` | conta | Rediseñado 2026.3 | ok / ok / ok / ok | ok |
| 18 | `#propuestas` | conta | Rediseñado 2026.3 | ok / ok / ok / ok | ok |
| 19 | `#reportes` | conta | Rediseñado 2026.3 | ok / ok / ok / ok | ok |
| 20 | `#resultados` | conta | Rediseñado 2026.3 | ok / ok / ok / ok | ok |
| 21 | `#situacion` | conta | Rediseñado 2026.3 | ok / ok / ok / ok | ok |
| 22 | `#crm` | crm | Rediseñado 2026.3 | ok / ok / ok / ok | ok |
| 23 | `#dte` | dte | Hereda capa | ok / ok / ok / ok | ok |
| 24 | `#dte-config` | dte | Hereda capa | ok / ok / ok / ok | ok |
| 25 | `#dte-emision` | dte | Hereda capa | ok / ok / ok / ok | ok |
| 26 | `#documentos` | fiscal | Rediseñado 2026.3 | ok / ok / ok / ok | ok |
| 27 | `#inicio` | fiscal | Rediseñado 2026.3 | ok / ok / ok / ok | ok |
| 28 | `#integraciones` | fiscal | Rediseñado 2026.3 | ok / ok / ok / ok | ok |
| 29 | `#libros` | fiscal | Rediseñado 2026.3 | ok / ok / ok / ok | ok |
| 30 | `#calculadora-iva` | herramientas | Hereda capa | ok / ok / ok / ok | ok |
| 31 | `#niif` | niif | Hereda capa | ok / ok / ok / ok | ok |
| 32 | `#onboarding` | onboarding | Hereda capa | ok / ok / ok / ok | ok |
| 33 | `#portal-cartera` | portal | Hereda capa | ok / ok / ok / ok | ok |
| 34 | `#portal-cobranza` | portal | Hereda capa | ok / ok / ok / ok | ok |
| 35 | `#portal-comercial` | portal | Hereda capa | ok / ok / ok / ok | ok |
| 36 | `#portal-costos` | portal | Hereda capa | ok / ok / ok / ok | ok |
| 37 | `#portal-cotizaciones` | portal | Hereda capa | ok / ok / ok / ok | ok |
| 38 | `#portal-credito` | portal | Hereda capa | ok / ok / ok / ok | ok |
| 39 | `#portal-inicio` | portal | Hereda capa | ok / ok / ok / ok | ok |
| 40 | `#portal-productos` | portal | Hereda capa | ok / ok / ok / ok | ok |
| 41 | `#portal-reportes` | portal | Hereda capa | ok / ok / ok / ok | ok |
| 42 | `#portal-ventas` | portal | Hereda capa | ok / ok / ok / ok | ok |
| 43 | `#suscripcion` | suscripcion | Hereda capa | ok / ok / ok / ok | ok |
| 44 | `#tesoreria` | teso | Rediseñado 2026.3 | ok / ok / ok / ok | ok |

## 2. Módulos, sub-pestañas y endpoints

| Archivo | Vistas | Sub-pestañas (código) | Endpoints distintos |
|---------|--------|------------------------|---------------------|
| `views-activos.js` | `#activos` | activos, depreciacion | 5 |
| `views-alertas.js` | `#alertas` | — | 1 |
| `views-analitica.js` | `#analitica` | — | 1 |
| `views-autom.js` | `#automatizacion` | — | 3 |
| `views-centro.js` | `#centro` | — | 1 |
| `views-cobranza.js` | `#cobranza` | — | 3 |
| `views-conta.js` | `#admin`, `#asientos`, `#auditoria`, `#balance8`, `#cclientes`, `#cierre`, `#clasificado`, `#comprobacion`, `#cproveedores`, `#externos`, `#memoria`, `#propuestas`, `#reportes`, `#resultados`, `#situacion` | auditoria, conciliacion, diario, empresas, historial, mayor, nuevo, pendientes, periodos, plan, seguridad, usuarios | 33 |
| `views-crm.js` | `#crm` | actividades, contactos, fichas, fidelizacion, informes, oportunidades, panel, prospectos | 14 |
| `views-dte.js` | `#dte`, `#dte-config`, `#dte-emision` | — | 7 |
| `views-fiscal.js` | `#documentos`, `#inicio`, `#integraciones`, `#libros` | compra, resumen, venta | 19 |
| `views-herramientas.js` | `#calculadora-iva` | — | 0 |
| `views-niif.js` | `#niif` | mapeo, resultados, situacion | 3 |
| `views-onboarding.js` | `#onboarding` | — | 5 |
| `views-portal.js` | `#portal-cartera`, `#portal-cobranza`, `#portal-comercial`, `#portal-costos`, `#portal-cotizaciones`, `#portal-credito`, `#portal-inicio`, `#portal-productos`, `#portal-reportes`, `#portal-ventas` | — | 24 |
| `views-suscripcion.js` | `#suscripcion` | — | 3 |
| `views-teso.js` | `#tesoreria` | bancos, conciliacion, movimientos | 10 |

## 3. Componentes y sistema

| Elemento | Ubicación | Uso |
|---|---|---|
| Tokens (color, superficie, tipografía, espaciado, radios, sombras, foco) | `frontend/css/app.css` | Toda la aplicación |
| Tabla de datos (búsqueda, orden, paginación, export, agrupación) | `frontend/shared/uitoolkit.js` (`UITabla`) | Bandeja, Libros, Analítica, CRM, Portal, Tesorería |
| Validación de formularios | `frontend/shared/uitoolkit.js` (`UIForms`) | Modales y formularios |
| Estados (carga, vacío, error, chips) | `frontend/sistema/ui.js` (`UIEstado`) | Vistas con datos |
| Capa de sistema del rediseño (shell, `.pg-*`, tablas, tarjetas, KPI, botones, estados) | `frontend/sistema/sistema.css` | Toda la aplicación |
| Shell, menú por flujo, contexto de empresa/período | `frontend/sistema/app.js` | Toda la aplicación |
| Tema claro/oscuro (`localStorage jmv_tema`, `data-theme`) | `frontend/sistema/tema.js` | Toda la aplicación |

## 4. Evidencia

- Suite automatizada: `npm test` — resultado en la entrega final (código de salida incluido).
- Matriz de navegador: 176 mediciones en claro + 44 en oscuro; medición = render + overflow + consola.
- Capturas por pantalla: `mx-<ruta>-1280.png` y `mx-<ruta>-390.png` (20 pantallas) y `dk-<ruta>-1280.png` en oscuro.
- Datos: base temporal con documentos ficticios; sin datos reales ni consultas al SII.

## 5. Condiciones conocidas del entorno de QA

- `GET /api/contable/empresas/1/cierre/202609/preparar` responde **400** con
  `"El período 202609 no existe (no hay movimientos que cerrar)"`. Es la validación
  normal del backend sobre la base ficticia (no hay asientos del período); las vistas
  la tratan como "sin datos" y no muestran error. No es un defecto introducido.

## 6. Pendientes y limitaciones

- Pantallas fuera del alcance acordado (DTE, activos, NIIF, onboarding, suscripción,
  herramientas, alertas, analítica): heredan el sistema visual y el shell, sin
  reescribir su composición interna.
- Accesibilidad verificada de forma práctica (foco visible, teclado, etiquetas, contraste
  de encabezados y estados); sin auditoría con lector de pantalla.
- Sub-pestañas: se valida el render del contenedor de cada vista; el detalle interno de
  cada pestaña se comprueba en el flujo del módulo, no una por una en la matriz.
