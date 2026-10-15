# Rediseño del módulo CRM — JMV Consultores (2026-10-15)

Prompt maestro "Rediseño y profesionalización del módulo CRM". Reglas aplicadas:
NO se instala Twenty/Frappe/EspoCRM; NO se copia código ni dependencias
(las tres referencias son AGPL-3.0 — se adaptan solo PATRONES funcionales);
NO se cambia framework/DB/auth; NO se tocan SII ni procesos contables;
NO se despliega a producción automáticamente (solo commits locales; deploy por
decisión explícita aparte, como siempre).

## 1. Diagnóstico del CRM ACTUAL (comprobado en el código)

**Existente (Fase B "Fidelización del despacho") — `backend/core/crm.js` (436
líneas) + `backend/routes/crm.js` (157) + `frontend/sistema/views-crm.js`
(219) + `test/crm.test.js` (289):**

| Módulo | Qué hace | Dónde |
|---|---|---|
| Pipeline | etapa por EMPRESA (`empresas` es la única entidad): PROSPECTO→ONBOARDING→OPERATIVO→RIESGO→PERDIDO, notas, próximo contacto | `crm_pipeline` (1:1 empresas) |
| Recordatorios | tareas con fecha/tipo/done del calendario del despacho (cierre, F29, PPM…) | `crm_recordatorios` |
| Campañas | mensajes de WhatsApp por plantillas con datos REALES (engagement), lote por segmento, nunca automáticos | `crm_campanas` |
| Engagement/Retención | score 0-100 por datos reales (sync SII, docs pendientes, cierre, contacto) + alertas | calculado on-the-fly |

**Más**: `guardCrm` (solo rol contador/super_admin — CRM del despacho, jamás
del cliente), `accesoEmpresa` (aislamiento por asignación `usuario_empresa`),
todo con auditoría (`registrarAccion`). Montura: `/api/crm` con `requireAuth`
(`backend/index.js:85`). Migraciones idempotentes invocadas por
`backend/core/migraciones.js:949` y `backend/db.js:377`.

**Lo que NO existe (brecha vs. prompt Fase 3):** contactos, oportunidades,
prospectos como entidad (hoy "prospecto" es solo una etiqueta de etapa sobre
`empresas`), ficha comercial (nombre comercial/giro/correo/dirección/fuente),
exclusión de duplicados, Kanban, historial de etapas, actividades con
prioridad/asociaciones, informes de embudo/conversión/proyección, filtros
combinables, búsqueda global del CRM, importación/CSV. La UI es UNA vista
monolítica sin competencia de pestañas/filtros.

**Funcionalidad que hay que CONSERVAR intacta** (no eliminar): pipeline de
etapas, recordatorios, campañas (única/lote), engagement, retención, guards.

## 2. Patrones adaptados de las referencias (sin dependencias)

- **Twenty** (AGPL-3.0): ficha-fila con timeline; Kanban de oportunidades sync
  con tabla (mismos datos, dos vistas del mismo endpoint);内的 panel con
  KPIs y "oposiciones activas pendientes"; búsqueda global.
- **Frappe CRM** (AGPL-3.0): Lead→Deal→Customer con conversión que CONSERVA el
  historial; pestañas en la ficha (Notas/Emails Llamadas/Tareas) — aquí como
  cronológico de actividades; campos de Lead: fuente/necesidad/prioridad.
- **EspoCRM** (AGPL-3.0): etapas del embudo CONFIGURABLES con probabilidad
  default por etapa; monto ponderado calculado de UNA fuente; informes por
  etapa/responsable/estado con causa de pérdida; exportación CSV respetando
  permisos.

## 3. Mapa ANTES → DESPUÉS

```
ANTES                          DESPUÉS
#crm (una vista)               #crm (pestañas: Panel · Oportunidades · Fichas ·
                               Contactos · Prospectos · Actividades · Fidelización)
empresas → etapa               empresas (= cliente maestro, sin paralelos)
                               + crm_fichas (1:1, datos comerciales)
                               + crm_contactos (N:1 empresa)
                               + crm_prospectos (pre-empresa, DESPUÉS convierte)
                               + crm_oportunidades (N:1 empresa; contacto optional)
                               + crm_oportunidad_historial (auditoria del embudo)
                               + crm_actividades (N:1 empresa/contacto/oportunidad)
                               + crm_oportunidad_etapas (embudo CONFIGURABLE)
/get todas sin filtros         filtros combinables (empresa/etapa/responsable/fecha/texto),
                               paginación y orden en oportunidades; búsqueda /buscar
informes: solo engagement      informes: embudo, conversión, por responsable,
                               ganadas/perdidas con motivo, proyección ponderada
```

## 4. Plan de etapas verificables (Fase 7 del prompt)

1. `backend/core/crm-comercial.js` (NUEVO módulo; NO muta crm.js): fichas,
   contactos, prospectos (+conversión), oportunidades (+historial),
   actividades, embudo configurable, informes con `MONTO_PESADO` en SQL
   expresión compartida (única fuente), búsqueda. Migraciones idempotentes
   dentro (`migracionesCrmComercial`), llamadas desde `crm.js` y `db.js`.
2. `backend/routes/crm.js`: endpoints nuevos SIEMPRE con `guardCrm` +
   `accesoEmpresa` (multitenant server-side; la URL/herramienta correcta no
   basta). Normas: no se exponen datos contables (documentos/asientos/SII) a
   los comerciales.
3. `frontend/sistema/views-crm.js`: reescritura por pestañas SIN cambiar el
   hash (`#crm` sigue en el menú 'Gestión comercial', anchor intacto — T1 UX)
   ni eliminar las tarjetas de retención/campañas. CSS `.crm-*` con tokens.
4. Tests `test/crm-comercial.test.js` + suite completa en `package.json`.
5. Entrega documentada (este archivo pasa a informe completo). **Sin deploy.**

## 5. Riesgos

- `empresas` sigue siendo el maestro de clientes: la creación de empresa REAL
  de prospecto conversión exige el flujo de onboarding existente (clave SII +
  super admin). La conversión CRM VINCULA si la empresa ya existe; si no,
  marca CONVERTIDO y deja apuntada la necesidad de onboarding (sin inventar
  empresas con clave SII falsa — protegería flujos SII operativos).
- SQLite/Integer de montos en CLP (convención del sistema); moneda aceptada
  solo 'CLP' en esta versión (otras advertidas).
- Kanban sin librería de drag: cambio de etapa con control en la tarjeta
  (consistente con la política cero-dependencias del sistema).

## 6. Criterios de aceptación (resumen Fase 8)

CRUD verificado, RUT validado (regla Chile existente `empresas.validarRut`),
dedupe por RUT/correo, transiciónes del embudo + terminal GANADA/PERDIDA,
monto ponderado consistente en kanban/tabla/informes, multitenant 403+ sin
fuga, regresión total en verde, sin deploy automático.

---

# ENTREGA FINAL (implementación realizada)

## 1. Diagnóstico inicial

Ver §1 arriba: CRM de fidelización sólido (pipeline/recordatorios/campañas/
engagement con guards y auditoría) y SIN lado comercial (contactos,
oportunidades, prospectos, fichas, informes). UI monolítica.

## 2. Mapa CRM anterior → nuevo

Ver §3 arriba (mapa ANTES → DESPUÉS). El menú conserva el anchor `#crm`
(`Gestión comercial → Pipeline y Salud`); ahora el título de vista es
"CRM Comercial" con 8 pestañas internas.

## 3. Archivos modificados y motivo

| Archivo | Cambio | Motivo |
|---|---|---|
| `backend/core/crm-comercial.js` (NUEVO ~800) | Fichas, contactos, prospectos (+conversión/importación), oportunidades (+historial, embudo configurable), actividades, informes, búsqueda, dedupe; migraciones idempotentes | Lado comercial sin tocar el módulo de fidelización |
| `backend/core/migraciones.js` | + `migracionesCrmComercial()` y export | Montar tablas nuevas en la cadena de migraciones |
| `backend/db.js` | + 2 líneas de llamada | Crear tablas al arranque (idempotente) |
| `backend/routes/crm.js` | + ~250 líneas: rutas nuevas SIEMPRE con `guardCrm`+`accesoEmpresa` | Multitenant server-side en CADA endpoint nuevo |
| `frontend/sistema/views-crm.js` | Reescritura: pestañas Panel/Oportunidades(Kanban↔Tabla)/Fichas/Contactos/Prospectos/Actividades/Informes/Fidelización; estados de carga/vacío/error de UIEstado; filtros combinables + vistas guardadas (localStorage por usuario); export CSV client-side | Fase 2/3 del prompt; §antirrecursos: nada de librería de drag |
| `frontend/shared/api.js` | + `apiPatch()` | Métodos PATCH de la API comercial |
| `frontend/sistema/sistema.css` | + `.crm-tabs/.crm-kanban/.crm-kcol/.crm-kcard` (tokens; móvil ≤768/≤480; reduced-motion) | Arte del web coherente con el resto del sistema |
| `frontend/sistema/index.html` | Rehash `seed:v` (25 referencias) | Anticaché 4 h nginx — OBLIGATORIO antes de commitear `frontend/` |
| `test/crm-comencial.test.js`→`test/crm-comercial.test.js` (NUEVO) | 13 casos | Fase 8 |
| `package.json` | + test al listado explícito | Regla del repo (NUNCA `node --test test/`) |

## 4. Funcionalidades implementadas / pendientes

**Implementado** — Ficha comercial (1:1 maestro, sin duplicar RUT); contactos
con dedupe y contacto principal; prospectos con RUT M11, fuente/necesidad/
prioridad, conversión controlada (vincula por RUT; sin empresa NO inventa
`empresas` — apunta al onboarding) e importación CSV (≤500, aceptados/errores);
oportunidades con Kanban↔Tabla sincronizados, montos CLP enteros, embudo
CONFIGURABLE (tabla `crm_oportunidad_etapas`), probabilidad default por etapa,
transiciones con historial+usuario, GANADA/PERDIDA terminales, motivo de
pérdida obligatorio, monto ponderado con UNA expresión (kanban=ficha=informes);
actividades (tarea/llamada/reunión/nota) ancladas obligatoriamente a
empresa/contacto/oportunidad con vencimientos y estados; informes (embudo,
conversión, por responsable, causas de pérdida, proyección, clientes nuevos,
seguimiento pendiente) con filtros combinables y CSV; búsqueda global del
módulo (empresas/prospectos/contactos/oportunidades — sin datos contables);
la vista conserva 1:1 la fidelización existente (retención, campañas única y
lote, recordatorios, engagement).

**Pendiente (declarado)** — drag & drop real en Kanban (cambio por selector);
moneda distinta de CLP; vistas guardadas con NOMBRE compartible (hoy son
localStorage del usuario); importación de empresas (hoy solo prospectos);
recordatorios automáticos programados (requiere infra de jobs — existe
`jobs-persistentes`, no se tocó); UI de configuración del embudo (hoy vía
SQL del despacho); QA visual del navegador con datos reales.

## 5. Cambios de base de datos y reversión

**CREADAS** (todas `IF NOT EXISTS`, cero migración destructiva):
`crm_oportunidad_etapas` (sembrada con 6 etapas), `crm_fichas`,
`crm_contactos` (+índices parciales/dedupe), `crm_prospectos` (+índices),
`crm_oportunidades` (+índices), `crm_oportunidad_historial`,
`crm_actividades` (+índices). **Ninguna tabla existente fue alterada.**

**Reversión**: `DROP TABLE IF EXISTS crm_actividades; DROP TABLE IF EXISTS
crm_oportunidad_historial; DROP TABLE IF EXISTS crm_oportunidades; DROP TABLE
IF EXISTS crm_prospectos; DROP TABLE IF EXISTS crm_contactos; DROP TABLE IF
EXISTS crm_fichas; DROP TABLE IF EXISTS crm_oportunidad_etapas;` —
las tablas/pipeline/campañas de fidelización quedan intactas.

## 6. Pruebas ejecutadas (reales)

- `test/crm-comercial.test.js` — **13/13** (fichas, contactos/dedupe,
  prospectos RUT+importación+conversión, oportunidades terminal/ponderado/
  historial, actividades ancla, informes coherentes, **multitenant HTTP:
  403 sin fuga en 5 endpoints cruzados de empresa, 401 sin sesión**, y
  regresión de fidelización).
- **Suite completa `npm test`: 453/453** (antes: 440; +13 nuevos, 0 regresiones;
  se detectó y corrigió una colisión del escáner T1 con `VIEWS._pipelineCache`).
- Humo backend previo: crear/convertir/transiciones/terminal/ponderado verificados.
- Pendiente: QA visual del navegador (no automatizable aquí).

## 7. Riesgos residuales y recomendaciones

- La conversión de prospecto SIN empresa no crea `empresas` (protege el SII):
  el despacho debe completar el onboarding existente — dejado explícito en la
  UI («registra su empresa vía onboarding con su clave SII»). Si se quiere
  creación automática de empresa, requiere decisión del responsable (clave SII
  obligatoria REAL).
- Roles: el CRM sigue siendo exclusivo del despacho (contador/super admin);
  si se quisiera dar acceso a un rol comercial nuevo, es una fila en
  `PERMISOS_POR_ROL` + nada más (capacidades por nombre).
- El ponderado es una convención, no un pronóstico: la UI lo etiqueta como
  tal. No toca cálculos tributarios (ni SII ni IVA).

## 8. Validación local

```bash
npm test                       # 453/453 incl. crm-comercial
node --test test/crm-comercial.test.js   # solo el módulo nuevo
node .tools/server-local.js    # server local + login JMV → menú 'Gestión comercial → Pipeline y Salud'
```

## 9. Producción — confirmación explícita

**NO se alteró producción**: cero push/pull/deploy en esta fase; el commit
queda local en master. El deploy (mismo mecanismo del hook post-receive
validado antes) queda a decisión expresa del responsable.

