# ARCHITECTURE — Arquitectura del Software Contable JMV Consultores

> Fecha: 2026-10-01 · Partiendo del estado real documentado en [CURRENT_STATE.md](CURRENT_STATE.md)
> Principio rector del PROMPT MAESTRO: **no reconstruir lo que funciona** (integración SII, shell frontend, auth, informes). Extender, no reemplazar.

---

## 1. Decisión arquitectónica fundamental

**Monolito modular en un solo proceso Node.js, un solo repositorio, una sola base SQLite — con módulos de dominio claramente separados dentro del backend.**

Alternativas evaluadas:

| Opción | Veredicto | Motivo |
|---|---|---|
| Monolito modular sobre el código actual | **ELEGIDA** | Reutiliza auth, SII, informes, shell UI, deploy Docker/nginx ya probados. Escala sobradamente para el tamaño real (un despacho contable, decenas de empresas). El aislamiento multiempresa se resuelve en datos y permisos, no en procesos. |
| Microservicios (servicio contable separado) | Descartada | Complejidad distribuida (deploy, transacciones entre servicios, auth duplicada) injustificada. La transaccionalidad contable exige consistencia fuerte que SQLite en proceso da gratis. |
| Rewrite sobre framework (NestJS/Next) | Descartada | Viola el mandato de no reconstruir; no aporta al dominio contable. |

**SQLite sigue siendo la base** para el MVP. La escala contable (asientos por año: decenas de miles, no millones) está dentro de lo que SQLite en WAL maneja sobradamente en un solo nodo. DATA_MODEL.md deja documentado el camino de migración a Postgres **si** alguna vez hiciera falta (tipos INTEGER ya diseñados para ser portables; sin SQL propietario exótico).

## 2. Estructura objetivo del backend (monolito modular)

```text
backend/
  index.js                    (existente) bootstrap + static + routers
  db.js                       (existente) esquema + migraciones idempotentes
  core/                       NÚCLEO CONTABLE (fases 1–2) — puro, testeable, sin Express
    empresas.js               alta/baja/estado de empresas
    usuarios.js               usuarios, roles, asignaciones empresa↔usuario
    permisos.js               RBAC: resolverPermisos(usuario, empresa) → capacidades
    auditoria.js              bitácora inmutable de acciones (quién, qué, cuándo, antes/después)
    periodos.js               períodos contables por empresa, estados, cierres
    plan-cuentas.js           árbol de cuentas, validación de clase, saldos acumulados
    asientos.js               construcción, validación partida doble, registro, anulación
    libro-diario.js           consulta de asientos por período/filtro
    libro-mayor.js            mayor por cuenta (T-account), saldos
    reportes-financieros.js   balance de comprobación, situación financiera, resultados
  documentos/                 DOMINIO DOCUMENTOS (fases 3–4)
    bandeja.js                documento persistente por empresa, ciclo de vida de estados
    clasificacion.js          clasificación contable de documentos (cuenta, CC, impuesto)
    reglas.js                 motor de reglas contables configurables
    propuestas.js             propuesta de asiento desde documento(s) + regla
    conciliacion.js           conciliación SII ↔ contabilidad
  integraciones/
    sii/                      (existente, NO se toca: sii-session.js, sii-rcv.js, rcv.js)
    geodaniela/               (futuro, fase 9) receptor de asientos externos
  routes/                     (existente) routers HTTP delgados sobre los módulos core
  middleware/
    requireAuth.js            (existente)
    requirePermiso.js         (nuevo) requirePermiso('asientos:crear', {empresaId})
```

Reglas del monolito:

1. **Los módulos de `core/` y `documentos/` no importan Express** ni leen `req/res`. Reciben datos, devuelven datos o errores de dominio. Todo test se escribe contra ellos.
2. **Cada módulo valida el aislamiento de empresa internamente** (recibe `empresaId` obligatorio) — nunca confiar solo en que el router filtró.
3. **Transacciones de asiento son atómicas**: cabecera + líneas + actualización de estados de documentos en una sola transacción SQLite.
4. Los routers HTTP existentes (informes, proceso, clientes) quedan intactos; los nuevos módulos exponen routers nuevos (`/api/contable/...`).

## 3. El "anillo" entre SII y contabilidad

```text
        [SISTEMA ACTUAL — intacto]                [SISTEMA NUEVO — contable]
   clientes / informes / rcv_cache               empresas / documentos / asientos
              │                                              ▲
              │  consultarRCV(rut,clave,tipo,periodo)        │ documentos/ingesta
              └────────────► documentos/ingesta ─────────────┘
                             (único punto de acople)
```

`documentos/ingesta` (fase 3) es el **único** punto de contacto: llama al `rcv.js` existente, normaliza y **inserta documentos en la bandeja contable** con idempotencia (dedupe por empresa + rut + tipo + folio + periodo). La contabilidad jamás consulta el SII directamente; los informes tributarios actuales siguen funcionando en paralelo. Esto cumple la separación conceptual del PROMPT MAESTRO:

- **Tributario** = lo que dice el SII (informes, RCV, F29) — hoy existe.
- **Contable** = lo que declara la contabilidad (asientos, mayor) — nuevo.
- **Financiero** = derivado de lo contable (balance, resultados) — nuevo.
- La **conciliación** compara tributario vs contable y reporta diferencias; no mezcla los niveles.

## 4. Multiempresa y aislamiento (diseño)

- Entidad nueva `empresas` (ver DATA_MODEL.md). Los `clientes` actuales **se convierten en empresas** (migración 1:1: cliente → empresa, conservando RUT, PPM, clave SII).
- Toda tabla contable lleva `empresa_id NOT NULL` + índice compuesto que empieza por `empresa_id` + `FOREIGN KEY` a empresas.
- **Defensa en 3 capas** contra acceso cruzado:
  1. Router: resuelve `empresaId` de la URL/contexto y verifica asignación usuario↔empresa con rol.
  2. Módulo core: revalida que la operación y cada fila operada pertenezcan a esa empresa.
  3. BD: FK + checks; las consultas de reportes siempre filtran por `empresa_id`.
- El scoping actual por `user_id` en clientes/informes **se mantiene** durante la transición (el usuario dueño es el ADMIN EMPRESA inicial de cada empresa migrada).

## 5. RBAC (diseño)

Roles iniciales (tabla `roles` + `usuario_empresa(rol)`), extensible sin cambios de código:

| Rol | Alcance | Capacidades típicas |
|---|---|---|
| SUPER ADMIN | global | todo, incl. gestión de usuarios y roles, configuración global |
| CONTADOR | empresas asignadas | contabilidad completa, documentos, cierres, reportes |
| ADMIN EMPRESA | su empresa | consulta + configuración de su empresa, no modifica asientos cerrados |
| AUDITOR | empresas asignadas | solo lectura + trazabilidad (auditoría, historial) |
| TESORERÍA | empresas asignadas | pagos/cobros/bancos, conciliación; no modifica plan de cuentas |

- Permisos como capacidades nombradas (`documentos:clasificar`, `asientos:crear`, `periodos:cerrar`, `reportes:ver`, `config:editar`...). Los módulos exigen capacidades, no nombres de rol: agregar un rol = insertar filas.
- Middleware nuevo `requirePermiso(capacidad, {empresaId})` junto a `requireAuth` existente.
- Auditoría (`auditoria.js`): toda mutación escribe quién/qué/antes/después/cuándo; sin deletes (anulación con asiento/documento inverso marcado).

## 6. Frontend (evolución del shell actual)

- Mismo shell vanilla (dashboard.html + `shared/layout.js` NAV_ITEMS + router hash + módulos `window.*`). **Sin build, sin framework nuevo.**
- Nuevo grupo de nav **📚 Contabilidad** (desbloqueado por permisos desde `GET /api/auth/me`, que pasará a incluir `{ rol, empresas, permisos }`): Dashboard contable, Documentos (bandeja), Clasificación/Reglas, Asientos, Libro Diario, Libro Mayor, Reportes (Balance/ER), Períodos y Cierres, Configuración (plan de cuentas, centros de costo).
- Reutilización directa de `shared/`: `datagrid.js`, `filters.js`, `table.js`, `rango.js` (períodos), `export.js` (Excel), `toast.js`, `format.js` (extendido con `fmtEntero` para montos INTEGER).
- El nav tributario/herramientas actual sigue existiendo; el portafolio muestra ambas caras (tributaria y contable) por empresa.
- Nada se muestra como terminado si no existe (regla 42 del PROMPT MAESTRO): el nav se genera desde la lista de capacidades reales del usuario.

## 7. Concurrencia, transaccionalidad e integridad

- Escrituras contables en transacciones `db.transaction()` de better-sqlite3 (sincrónicas, sin carrera): asiento válido por partida doble **o nada**.
- Un asiento registrado **no se edita ni borra**: corrección con asiento de reversión referenciado. Los cierres de período bloquean mutaciones anteriores a la fecha de cierre (check en `core/asientos.js` + estado del período).
- Saldos: se **derivan** con consultas agregadas sobre líneas (fuente única de verdad: `asiento_lineas`). No se persisten saldos acumulados en el MVP (evita desincronización); si el rendimiento lo pidiera, tabla de saldos materializados por (empresa, cuenta, período) recalculada en la misma transacción.
- Montos en **INTEGER pesos** (ver DATA_MODEL.md): sin errores de redondeo de punto flotante.
- WAL ya activado: lecturas concurrentes no bloquean al escritor.

## 8. Seguridad del software contable

- Hereda todo lo endurecido (headers, rate-limit, scrypt, sesiones, CI/gitleaks) — ver [docs/SEGURIDAD.md](docs/SEGURIDAD.md).
- Añade, por orden de prioridad:
  1. **Cifrado en reposo de claves SII** (y de cualquier secreto por empresa): AES-256-GCM con clave maestra en variable de entorno del servidor; la bóveda se usa solo dentro de `integraciones/sii`.
  2. **RBAC + auditoría inmutable** (fase 1).
  3. Doble control en cierres: `periodos:cerrar` requiere rol CONTADOR y queda auditado con detalle.
- La landing pública y el login actual no cambian; el software contable vive tras la misma sesión.

## 9. Despliegue (sin cambios de topología)

Mismo modelo ya documentado en [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md): un proceso Node, nginx opcional, Cloudflare Tunnel como vía recomendada de publicación pública (cero puertos abiertos, TLS/WAF gratis), backup del `data/*.db` como operación crítica nueva (la contabilidad es irremplazable): backup diario con `sqlite3 .backup` + retención, documentado y automatizado en fase 1.

## 10. Riesgos arquitectónicos y mitigación

| Riesgo | Mitigación |
|---|---|
| Mezclar tributario con contable y perder la trazabilidad | Único punto de acople (ingesta) + conciliación explícita + documentos con `informe_id`/origen |
| Regresiones en lo que funciona | Módulos nuevos sin tocar los existentes; `npm test` + CI en cada paso; tests unitarios del core contable |
| Crecimiento del schema sin control | Migraciones idempotentes numeradas en `db.js` siguiendo el patrón existente; DATA_MODEL.md como contrato |
| SQLite se quedara corto (improbable) | Tipos y SQL portables a Postgres; decisión documentada, no acción |
| Sesiones/rate-limit en memoria con múltiples procesos | Restricción operativa: un solo nodo (como hoy); escala futura requeriría mover eso a BD — anotado en CURRENT_STATE |

---

La separación tributario/contable/financiero y el detalle entidad por entidad están en [DATA_MODEL.md](DATA_MODEL.md); el dominio contable chileno en [ACCOUNTING_DOMAIN.md](ACCOUNTING_DOMAIN.md); los contratos de integración en [INTEGRATIONS.md](INTEGRATIONS.md); el plan de construcción en [ROADMAP.md](ROADMAP.md).
