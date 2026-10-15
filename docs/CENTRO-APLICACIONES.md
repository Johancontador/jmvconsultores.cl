# Centro de Aplicaciones — 2026-10-15

Punto de entrada del sistema después del inicio de sesión. El usuario elige el
módulo en el que desea trabajar mediante tarjetas de aplicaciones (descripción
breve + secciones reales), en lugar de caer directo en una pantalla
sobrecargada. Solicitud: prompt 2026-10-15; responde a `docs/REDISENO-2026-10-15.md`
que dejaba el Dashboard como única entrada.

## 1. Experiencia

- **Aterrizaje post-login** (`hashInicial()` en `frontend/sistema/app.js`):
  - Dueño de UNA empresa cliente (rol `admin_empresa`, no super admin): entra
    directo a su Portal (`#portal-inicio`) — su superficie comercial, decidido
    en el rediseño anterior y conservado porque ES una de las apps del Centro.
  - El resto (JMV interno, contadores multi‑empresa): entra a `#centro`.
- **Tarjetas** con icono coherente (SVG inline, tokens del design system),
  título, descripción breve y chips por sección del menú real de la app.
- **Continuar donde quedó** y **módulos recientes**: `localStorage`
  `jmv.centro.recientes.<usuarioId>` (por usuario, grabado en `renderRoute`,
  máximo 8, el propio Centro se excluye).
- **Retorno claro**: el Centro vive en el grupo `Inicio` del menú; el bloqueo
  de permisos al navegar por URL ofrece «Volver al Centro de Aplicaciones».
- **Sesión coherente al cambiar de módulo**: el Centro no cambia empresa ni
  sesión; el cambio de empresa sigue siendo el selector del shell (misma
  limpieza de caches, mismo rol en `usuario_empresa`).

## 2. Cuatro conceptos, separados y validados (server-side SIEMPRE)

| Concepto | Fuente | Dónde se valida |
|---|---|---|
| Usuario autenticado | `sessions` (cookie `sid`, `requireAuth`) | `GET /api/auth/centro` y TODA ruta data |
| Empresa autorizada | `usuario_empresa` (asignación activa) | `rolEnEmpresa` / `centroParaUsuario`: `?empresa=<id>` ajena → `500` con «No tiene acceso a esta empresa», jamás datos |
| Permiso de acceso | capacidades RBAC (`core/permisos.js`) del rol EN ESA empresa | `requirePermiso('<capacidad>')` en cada ruta; centro omite apps sin capacidades |
| Módulo habilitado comercialmente | `licencias` (`puedeEscribir`: PRUEBA/ACTIVA, gracia VENCIDA) | gate de licencia dentro de `requirePermiso` para capacidades de escritura (`402`); en el Centro solo el chip `habilitado_comercial` (la lectura nunca se bloquea) |

La interfaz muestra solo lo autorizado; el Backend revalida todo en cada
solicitud (el Centro es presentación, no control de acceso).

## 3. Mapa de navegación (menú real del SPA)

```
Login → boot() → hashInicial()
   ├─ admin_empresa (1 empresa)  →  #portal-inicio (Portal de cliente)
   └─ resto                       →  #centro (Centro de Aplicaciones)

#centro
   ├─ CONTABILIDAD E IVA      saldo: secciones del menú 'Compras y ventas (SII)',
   │                          'Facturación', 'Contabilidad' (bandeja SII, libros,
   │                          DTEs, asientos...) — depende de docs:ver / dte:ver /
   │                          asientos:ver que tenga el rol
   ├─ INTELIGENCIA DE NEGOCIOS → 'Informes y control' (#reportes y demás balances,
   │                             NIIF, cierre) — reportes:ver
   ├─ GESTIÓN COMERCIAL        → 'Gestión comercial' (CRM #crm, #cclientes,
   │                             #cproveedores, cobranza #cobranza) — empresas:ver /
   │                             reportes:ver / tesoreria:ver por sección
   ├─ FINANZAS (TESORERÍA)     → 'Tesorería' (#tesoreria) — tesoreria:ver *
   ├─ PORTAL DE CLIENTE        → 'Portal de cliente' (dashboard, ventas, cartera,
   │                             productos...) — empresas:ver + modo externo
   └─ ADMINISTRACIÓN           → 'Inicio + Administración' (#admin, #auditoria,
                                 #integraciones, #suscripcion) — área RESTRICTIDA:
                                 solo roles con periodos:ver / auditoria:ver /
                                 empresas:ver (super admin, contador, admin_empresa,
                                 auditor)
El resto del menú (Panel del período, Alertas, Calculadora de IVA) queda como
accesos rápidos siempre disponibles del shell: no son "apps".
```

\* Finanzas se incluye porque Tesorería es un módulo IMPLEMENTADO con fuentes
de datos reales (cuentas bancarias, cartola `teso_movimientos`/`teso_cartola`,
conciliación bancaria). Cobranza vive dentro de Gestión Comercial, como en el
menú (módulo `core/cobranza.js` con seguimiento de mora real). **No se creó
ningún módulo nuevo** ni se duplicó nada: el catálogo `CATALOGO_APPS`
(`backend/core/centro-apps.js`) referencia SECCIONES, RUTAS (anchors) y
PERMISOS que ya existían en el `MENU` del SPA; `test/centro-apps.test.js` T1
compara el catálogo contra el menú leído del frontend (TODA ruta y grupo deben
existir; si el menú cambia y se desincroniza, el test rompe).

## 4. Rutas/API

| Ruta | Permiso | Uso |
|---|---|---|
| `GET /api/auth/centro` | `requireAuth` | Catálogo para el usuario: `empresa=<id>` (siempre asignada); devuelve `{ empresas[], empresa_activa, licencia, apps[] }` con `secciones[{grupo,ruta,capacidad}]` y `habilitado_comercial` |
| `#centro` (SPA) | entrada en MENU `permiso: null` | Renderiza solo lo que el backend autorizó; guarded además por el filtro del router (`route.permiso && !tiene()`) |
| — todas las demás | `requireAuth` + `requirePermiso(...)` + gate licencia | sin cambio; el Centro no abre preceding paths |

Rutas NUEVAS de negocio: ninguna. Endpoint nuevo: `GET /api/auth/centro` (auth.js).
Módulo nuevo de solo lectura: `backend/core/centro-apps.js` (puro: db por parámetro).

## 5. Interno vs externo (mismo servicio, otra superficie)

- **Interna (JMV/contador)**: Centro de Aplicaciones completo (sistema
  operativo + BI + comercial), aterrizaje `#centro`.
- **Externa (dueño de empresa cliente)**: superficie principal = Portal de
  cliente (read-only, consume `core/portal-metricas.js` y afines que resuelven
  SIEMPRE server-side con aislamiento por empresa); menú del shell reordenado
  como en el rediseño (Portal primero). El Centro le muestra igualmente las
  apps que su rol habilite (ej. administrar su propia licencia).

## 6. Cambios implementados (commit orden)

1. **Backend**
   - `backend/core/centro-apps.js` (NUEVO): `CATALOGO_APPS` (6 apps, mapeo del
     menú real), `validarCatalogo()`, `centroParaUsuario(db, usuarioId,
     empresaId)` → empresas/rol/capacidades/licencia de la empresa activa;
     empresa ajena → `Error('No tiene acceso a esta empresa')` (aislamiento).
   - `backend/routes/auth.js`: `GET /centro` (`requireAuth`; recibe
     `?empresa=`; sin estado de sesión afectado).
2. **Frontend**
   - `frontend/sistema/views-centro.js` (NUEVO): vista `#centro` — saludo con
     empresa/rol, tarjeta «Continuar donde quedó», chips de recientes, grid de
     apps con icono SVG, descripción, chips por sección y chip de licencia.
     Pinta EXACTAMENTE lo autorizado por el backend (sin apps(hostname) de relleno).
   - `frontend/sistema/app.js`: entrada del menú `Inicio → Centro de
     Aplicaciones`; `hashInicial()` → `#centro` (dueño → Portal, igual que
     antes); registro de recientes por usuario en `renderRoute`; bloqueo de
     ruta no autorizada ahora ofrece volver al Centro.
   - `frontend/sistema/sistema.css`: estilos `.centro-*` (tokens del sistema,
     sin colores hardcodeados; respeta `prefers-reduced-motion`).
   - `frontend/sistema/index.html`: `views-centro.js` registrado y reversionado
     con `npm run seed:v` (anti-caché de 4 h del nginx VPS).
3. **Tests** — `test/centro-apps.test.js` (9 casos, BD temporal):
   T1 catálogo sin módulos ficticios (rutas + grupos + capacidades existen);
   T2a super admin ve todo; T2b dueño con Portal externo y chip de licencia;
   T2c el centro respeta el RBAC exacto (auditor; rol sin capacidades → cero
   apps); T3 aislamiento de empresa ajena; T4 licencia SUSPENDIDA → apps
   visibles pero `habilitado_comercial=false` (la lectura nunca se bloquea);
   T5a/T5b HTTP 401/200/500-by-aislamiento; T6 sanidad de `listarParaUsuario`.
   Suite completa: **440/440** (`npm test`, listado explícito en package.json).

## 7. Pendiente (declarado)

- Experiencia de UI real en navegador (QA visual) y prueba con roles reales en
  producción — el QA automatizado aquí es de catálogo/HTTP/permisos, no de
  píxel (el seed:v cubre el caché).
- `CARACTERÍSTICAS` futuras sugeridas: métricas por tarjeta (p. ej. docs
  pendientes por app reutilizando las pills existentes), ordenar apps por uso
  real (hoy es `orden` declarativo), y paginación si crece el catálogo.
- El Centro no migró ni duplicó tecnología/computación: reusa RBAC, licencias
  y menú. Cálculos contables/tributarios: cero cambios (no aplica).
