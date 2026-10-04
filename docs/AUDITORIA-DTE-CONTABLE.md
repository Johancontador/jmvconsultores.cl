# Auditoría DTE → Contabilidad (BLOQUE 2A)

**Fecha:** 2026-10-04
**Modo:** solo lectura — durante la auditoría NO se modificó ningún archivo.
**Alcance:** la cadena completa de emisión de DTE entregada en el BLOQUE 2
(`core/dte-emisor.js`, `routes/dte.js`, migraciones y RBAC) y su interacción
potencial con el motor contable existente (bandeja, reglas, propuestas,
asientos), previo a construir el puente del BLOQUE 3.

---

## 1. Baseline verificado al inicio

- Suite completa: **267/267 PASS** (antes de los 12 tests del BLOQUE 3).
- Arranque real del servidor OK; `/api/dte/*` responde **401 sin sesión**
  (requireAuth global en `index.js` intacto).
- Tablas DTE (`dte_config`, `dte_folios`, `dte_emitidos`) **vacías en
  producción**: cero certificados, CAFs o resoluciones reales cargados.
- RBAC correcto: `dte:ver` en 5 roles; `dte:emitir` + `dte:configurar` solo
  contador, admin_empresa y super_admin; `requirePermiso` aplica el gate de
  licencia en escrituras.

## 2. Hallazgos

### H1 (crítico) — Brecha contable: el DTE aceptado nunca llegaba a la contabilidad

`dte_emitidos.asiento_id` existía como columna desde el BLOQUE 2 pero jamás
se escribía: un DTE ACEPTADO por el SII quedaba como registro aislado. La
empresa emitía facturas reales cuyo impacto en CxC / ventas / IVA débito
no existía en el libro — exactamente la promesa central del sistema.

### H2 (alto) — Duplicados por doble click sin idempotencia

`POST /api/dte/.../emitir` no tenía clave de idempotencia: un doble click
(o un reintentar del navegador) consumía **dos folios de CAF** y creaba dos
DTEs con el mismo contenido. El folio consumido no es recuperable.

### H3 (alto) — Notas de crédito sin control de referencia en el tramo contable

El BLOQUE 2 ya exige `Referencia` (TpoDocRef/FolioRef/CodRef) para emitir
56/61, pero no había garantía de que una NC aceptada produjera un asiento
con signo correcto (CxC al haber, ventas e IVA al debe). Contabilizar una
NC como si fuera una suma habría inflado ventas y CxC.

### H4 (medio) — Doble representación DTE ↔ bandeja-RCV

El RCV del SII trae las ventas emitidas de la empresa. Si el DTE local se
contabilizaba por un camino y la ingesta RCV creaba su propio documento de
bandeja para el mismo comprobante, el resultado era **doble conteo** de la
misma venta (dos documentos, dos propuestas, dos asientos).

### H5 (medio, abierto) — Contrapartes sin memoria

La clasificación automática del DTE depende exclusivamente de las reglas
del contador (`reglas.clasificarAutomatico`); sin regla el documento queda
PENDIENTE (correcto — jamás cuentas inventadas). La resolución de
contraparte al confirmar sí consulta memoria (regla → memoria → alias
CLIENTES/PROVEEDORES en `propuestas.js`), pero la observación de fondo —
que la auto-clasificación no dispone de memoria de contrapartes propia —
quedó abierta a decisión del dueño. Cerrada implícitamente para el flujo
DTE al pasar por el mismo motor de propuestas de la bandeja.

## 3. Cierre de riesgos (BLOQUE 3)

| Hallazgo | Cierre implementado | Cobertura |
|---|---|---|
| H1 | `core/dte-contable.js`: PASADA 1 (ACEPTADO sin documento → documento de bandeja `origen='dte'` → reglas → propuesta) y PASADA 2 (documento CONTABILIZADO → `dte_emitidos.asiento_id`, vínculo bidireccional) | T5, T8, T6 |
| H2 | Columna `idempotencia` + UNIQUE parcial `(empresa_id, idempotencia)` + pre-check en la ruta que devuelve `{deduplicado: true}` con el DTE original | T2 |
| H3 | Las notas corren por el MISMO motor de propuestas: `esNC` (60/61) invierte las patas (CxC al haber, ventas/IVA al debe); 34 exenta sin pata de IVA; sin regla → PENDIENTE visible | T10, T9, T11 |
| H4 | Documento con la **misma `clave_dedupe`** que la ingesta RCV (hash `rut\|venta\|tipo\|folio\|periodo`): si el RCV llegó primero se apunta a él; si llegó después, `ON CONFLICT DO NOTHING` dedupea | T7, T6 |
| Cadena §14 | El sistema jamás contabiliza solo: propuesta PENDIENTE → **confirmación humana** (`propuestas.confirmar`, única puerta al asiento) | T8, T11 |

Decisiones de diseño que la auditoría dejó fijadas (ver cabecera de
`core/dte-contable.js`):

- **Momento contable = aceptación del SII**: un DTE no-ACEPTADO jamás genera
  documento contable (T4).
- **Una sola representación**: misma clave_dedupe que el RCV, en ambas
  direcciones.
- **Devengo por fecha de emisión**: `fecha_docto = fecha_emision` → el
  asiento cae en su período (mismo criterio que la bandeja).
- **Honestidad §42**: sin regla el documento queda PENDIENTE visible y se
  lista en `sin_regla`; los omitidos por estado se reportan; todo auditado
  como UNA acción (`dte.contabilizar.sincronizar`).
- **Aislamiento**: la sincronización es por empresa y la auditoría registra
  por empresa (T12).

## 4. Estado final tras el cierre

- Suite: **279/279 PASS** (+12 de `test/dte-contable.test.js`).
- Verificación E2E del BLOQUE 3: backup cifrado previo a migración
  (`scripts/backup-db.js`), arranque real con migraciones re-ejecutadas sin
  error, sincronización sin sesión → 401.
- La emisión sigue siendo operable 100% por API y, desde el BLOQUE 4, por
  la UI de `/sistema/` (`views-dte.js`).

## 5. Pendientes de decisión del dueño

1. **H5** — observación de fondo sobre memoria de contrapartes en la
   auto-clasificación (ver §2).
2. Credenciales reales de emisión (certificado .pfx, CAFs, resolución):
   producción sigue con 0 filas en tablas DTE hasta cargarse.
3. Dos backups en texto plano antiguos en `data/backups` (fuera del alcance
   de esta auditoría; los nuevos son cifrados).
4. Docker non-root sin verificar en runtime (daemon caído al momento de la
   auditoría).
