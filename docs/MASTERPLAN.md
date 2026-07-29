# MASTERPLAN — IVA Mensual

Auditoría completa del proyecto a la fecha, problemas detectados, y hoja de ruta priorizada
para las Fases 2-5. Reemplaza en autoridad a `REDISENO_PROPUESTA.md` (que sigue como referencia
histórica de por qué se decidió quedarse en vanilla JS) — este documento refleja el estado
**real y actual** del código, no lo planeado.

## 0. Resumen ejecutivo

La app funciona de punta a punta: conexión directa al SII (login + sesión + parseo de export
CSV), CRUD de clientes, proceso mensual con mensaje de WhatsApp, un libro de compras/ventas
estilo SII, un informe de gestión multi-año, un dashboard con gráficos, y un motor de 18
reportes con filtros y exportación a CSV/Excel/PDF. La navegación es un sidebar categorizado
(Tributarios / Comercial / Análisis).

El problema principal ahora no es funcionalidad faltante — es **consistencia interna**: la
Fase 1 del rediseño creó componentes compartidos (`shared/*.js`) que solo usa la página de
Reportes. Las 5 pantallas originales (Clientes, Proceso, Libro, Informe, Dashboard) siguen
con código duplicado de antes del rediseño. Eso es exactamente lo que ataca la Fase 5 de este
plan.

## 1. Estado actual por área

### Backend
| Archivo | Estado | Notas |
|---|---|---|
| `services/sii-session.js`, `sii-rcv.js` | ✅ Funciona | Login directo + sesión + parseo CSV, validado con captura HAR real. No tocar sin necesidad. |
| `services/calculos.js` | ✅ Funciona | Suma documentos, resta NC correctamente, agrupa por contraparte. |
| `services/informe.js` | ✅ Funciona | Devuelve meses, por_anio, resumen, top_clientes, top_proveedores, débito/crédito/IVA por período. |
| `services/proceso.js` | ✅ Funciona | Proceso mensual todos los clientes + mensaje WhatsApp. |
| `routes/*.js` | ✅ Funciona | clientes (CRUD), proceso, informe, sii (config/probar/libro). |
| `db.js` | ✅ Funciona | Migración de índice único aplicada (RUT reutilizable tras eliminar). |
| Caché de datos SII | ❌ No existe | Cada reporte multi-año vuelve a consultar el SII completo — ver sección 3. |
| Docker / despliegue | ❌ No existe | El PLAN.md original documentaba Dockerfile/docker-compose pero nunca se crearon en este proyecto. |

### Frontend — pantallas
| Pantalla | Usa sidebar nuevo | Usa `shared/*.js` | Usa tabla/filtros genéricos |
|---|---|---|---|
| Clientes | ✅ | ❌ (helpers duplicados) | ❌ (lista de cards a mano) |
| Proceso | ✅ | ❌ (helpers duplicados) | ❌ (cards a mano) |
| Libro | ✅ | ❌ (helpers duplicados) | ❌ (tabla a mano, aunque similar a `table.js`) |
| Informe | ✅ | ❌ (helpers duplicados) | N/A (formato de documento, no tabla) |
| Dashboard | ✅ | ❌ (helpers duplicados) | N/A (KPIs + gráficos) |
| Reportes (18 reportes) | ✅ | ✅ | ✅ |
| Configuración | ✅ | — | Placeholder, sin funcionalidad real |

### Documentación (`docs/`)
PRD, TRD, BACKEND, APPFLOW, UI-UX, PLAN, PROMPT_CURSOR describen el diseño **original** con
SimpleAPI — algunos ya actualizados a conexión directa SII, otros (APPFLOW, UI-UX, BACKEND)
no reflejan el rediseño del sidebar ni el motor de reportes. `REDISENO_PROPUESTA.md` documenta
la decisión de stack. Este `MASTERPLAN.md` es ahora la fuente de verdad del estado actual.

### Archivos sueltos en la raíz
`debug.log` (log de Chrome/Crashpad, no relacionado con la app) y `tmp-sii-test.json`
(`{"cliente_id":3}`, sin datos sensibles) — basura de pruebas, no vitales, mencionados en la
sección 3 para limpieza. No hay `.gitignore` en el proyecto.

## 2. Problemas detectados

### Duplicación de código (el hallazgo principal)
`clientes.js`, `proceso.js`, `libro.js`, `informe.js` y `dashboard.js` definen cada uno su
propia versión de `fmt()`, `showToast()`, `formatRut()`, `escapeHtml()` — las mismas funciones
que ya existen en `shared/format.js` y `shared/toast.js` desde la Fase 1. Riesgo concreto: si
se corrige un bug de formato en un lugar (como pasó con las Notas de Crédito), hay que acordarse
de repetirlo en 5 archivos más.

### Sin caché de datos históricos
Cada vez que se genera un Informe, Dashboard o Reporte, se vuelve a consultar el SII para
todos los meses del rango — incluso si ya se consultó ese mismo período hace un minuto. Con el
rate limit de 1.2s entre consultas, un reporte de 4 años (96 consultas) toma ~2 minutos siempre,
sin importar cuántas veces se repita.

### Sin manejo de errores parciales visible en Reportes
Si un mes falla al consultar el SII dentro de un reporte multi-año, el mes se marca `error`
internamente pero el motor de reportes no se lo muestra al usuario de forma clara (sí lo hace
Informe de Gestión, que tiene su propia sección de "Meses con error").

### Sin Docker/despliegue
El plan original consideraba Docker para el servidor Ubuntu; no se ha creado. Si Johan quiere
desplegarlo fuera de su máquina de desarrollo, hoy no hay una ruta clara para hacerlo.

### Configuración es un placeholder
La pantalla existe en el menú pero no permite editar nada — el nombre del contador y otros
parámetros siguen solo en `.env`.

### Sin pruebas automatizadas
No hay ningún test — todo el control de calidad ha sido revisión manual de código (no hay
entorno de ejecución confiable disponible durante el desarrollo). Riesgo real de regresiones
silenciosas a medida que crece el catálogo de reportes.

## 3. Hoja de ruta priorizada

### Fase 2 — Rediseño de interfaz y navegación ✅ Completa
Sidebar categorizado (Tributarios/Comercial/Análisis), sin submenús de un solo ítem, design
system reforzado. No requiere más trabajo salvo ajustes puntuales que surjan al usarlo.

### Fase 3 — Mejorar tablas, filtros y formularios
1. ✅ Migrar Clientes/Proceso/Libro/Informe/Dashboard a `shared/format.js` + `shared/toast.js` +
   `shared/api.js` — hecho, cero cambio de comportamiento visible, ~150 líneas duplicadas menos.
2. ⚠️ Pendiente: migrar la tabla de Libro a `shared/table.js` (ordenamiento gratis).
3. ⚠️ Pendiente: agregar `shared/filters.js` a Libro (filtrar el detalle por RUT/monto/tipo
   documento — el componente ya existe, solo falta conectarlo, igual que se hizo en Reportes).
4. ⚠️ Pendiente: mejorar el formulario de Clientes: usar `validarRut` de `shared/format.js`
   explícitamente en el submit (ya está disponible, falta el bloque `if (!validarRut(...))`
   que existía antes se mantuvo funcional, verificar que siga igual), agregar validación de
   teléfono.

### Fase 4 — Dashboards y reportes ✅ Completa
Dashboard con KPIs y 5 gráficos, motor de reportes con 18 reportes (Tributarios, Comercial,
Análisis), cada uno con filtros propios y exportación CSV/Excel/PDF.

### Fase 5 — Rendimiento y refactorización
1. ✅ Eliminar duplicación de helpers (parte de Fase 3, mismo trabajo) — hecho.
2. ✅ Caché local en SQLite (`rcv_cache`, vía `services/rcv.js`) de los documentos ya
   descargados por período cerrado — un reporte que se vuelve a generar para un período ya
   consultado no repite las llamadas al SII. El mes en curso nunca se cachea. `probarConexion`
   sigue sin caché a propósito (test real siempre).
3. ⚠️ Pendiente: manejo de errores parciales consistente en el motor de Reportes (mostrar qué
   meses fallaron, igual que ya hace Informe de Gestión).
4. ✅ `.gitignore` agregado (excluye `.env`, `data/`, `node_modules/`, logs). `debug.log` y
   `tmp-sii-test.json` quedan pendientes de borrar a mano (no tengo acceso a shell esta sesión):
   `Remove-Item debug.log, tmp-sii-test.json`.
5. ⚠️ Pendiente (si se retoma el despliegue): crear Dockerfile + docker-compose, ya documentados
   en el PLAN.md original pero nunca construidos.

## 4. Qué voy a hacer ahora

Empiezo por el punto 1 de la Fase 3/5 (son el mismo trabajo): migrar Clientes, Proceso, Libro,
Informe y Dashboard para que usen los módulos compartidos en vez de código duplicado. Es el
cambio de mayor apalancamiento — reduce el código a mantener sin tocar ninguna funcionalidad
visible. Después sigo con filtros en Libro y el resto de la Fase 5.
