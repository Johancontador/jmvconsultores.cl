# 21 · F0 — Línea base, contratos y continuidad

> Ejecutado el **2026-10-23** sobre `master` @ `85f93e9`, con la documentación de
> los 21 documentos de este handoff como contrato. **No** se modificó ninguna
> regla contable, tributaria, de permisos ni de autenticación; no se ejecutaron
> operaciones externas (SII, TGR, MercadoPago, DTE) ni se tocó la base de datos
> productiva más allá de una lectura con `query_only`.

---

## 1. Estado verificado al iniciar

| Comprobación | Resultado |
|---|---|
| Rama / commit | `master` @ `85f93e9` (sin cambios pendientes de código) |
| Cambios preexistentes | `?? docs/handoff-integral/` (este handoff) y `?? iniciar-sistema.bat` — no se tocaron |
| Documentación | 21 documentos, 328 KB, referencias cruzadas sin enlaces rotos |
| Suite completa | **634 tests · 634 pasan · 0 fallan** · 106,6 s (`npm test`) |
| Node | v25.8.2 (el proyecto declara `>=24.0.0`) |
| BD productiva | `PRAGMA integrity_check = ok`, `journal_mode = wal`, 63 tablas |

Criterio de conteo de la suite: `npm test` enumera **69 archivos** explícitos en
`package.json`; nunca se usa `node --test test/`. Los dos archivos nuevos de F0
quedaron agregados a esa lista (67 → 69).

---

## 2. F0.2 · Contratos de navegación (golden de los 49 anchors)

**Defecto corregido — RK-21.** `renderRoute` resolvía la ruta solo contra
`TODOS_LOS_ITEMS` (el menú) y caía a `TODOS_LOS_ITEMS[0]` (Inicio). Las 6 vistas
de reportes sin entrada de menú (`balance8`, `clasificado`, `comprobacion`,
`niif`, `resultados`, `situacion`) se renderizaban entonces con:

- título «Panel del período» en vez del suyo;
- breadcrumb de otra sección;
- `route.permiso === null`, así que el gate de UI no bloqueaba nada.

El backend siempre devolvió 401/403 — **la autoridad de acceso no cambió** —,
pero la pantalla daba una identidad falsa. Se agregó `RUTAS_FUERA_DE_MENU` en
`frontend/sistema/app.js`: cada vista declara su etiqueta, su sección y la
capacidad **real** que exige su endpoint (`reportes:ver`, verificada contra
`backend/routes/reportes.js` y `backend/routes/niif.js`). `breadcrumbHTML` usa
la sección de la ruta cuando no hay ítem de menú.

**Contratos fijados** (`test/navegacion-contratos.test.js`, golden en
`test/fixtures/navegacion-anchors.json`):

| Test | Qué garantiza |
|---|---|
| T1 | 43 anchors de menú + 6 de reportes = **49**; el golden y el código coinciden; **cero vistas huérfanas** (`VIEWS` ≡ anchors) |
| T2 | Cada anchor resuelve su título, su sección en el breadcrumb y marca exactamente un ítem activo |
| T3 | **5 roles × 49 rutas**: el gate de UI se activa si y solo si el rol carece de la capacidad (RBAC real, no el menú) |
| T4 | Ruta desconocida → Inicio sin pantalla rota; `#balance8?periodo=…` conserva su query |
| T5 | Cada vista fuera de menú declara la misma capacidad que exige su endpoint real |
| RK-21 | Las 6 vistas ya no heredan la identidad de Inicio y quedan bloqueadas sin `reportes:ver` |

**Evidencia de que el test detecta el defecto**: se retiró temporalmente el
término `|| RUTAS_FUERA_DE_MENU[key]` del router y el archivo falló en T2, T3 y
RK-21 (3 de 6). Restaurado el código, los 6 pasan.

Diseño anti-falso-positivo: el sandbox reemplaza `render` por un stub, así que
estos tests **no** congelan HTML ni estilos; el render real de las 49 vistas
sigue cubierto por `test/ux-unificacion.test.js` (T5/T5b).

---

## 3. F0.3 · Fixtures y taxonomía de Salud Tributaria

**Problema.** Tres vocabularios para «no hay dato» (`no_consultado`,
`no_evaluable`, `sin_informacion`), un cero confirmado indistinguible de un
dato desconocido, y un fallo de red presentado con el mismo cartel que un dato
ausente.

**Solución — una sola fuente** (`frontend/shared/estados-salud.js`, cargada por
la SPA y requerida por el backend): los 9 estados del handoff §4.5 con su
significado, severidad, condición de activación, `es_hallazgo` (separa la
materia tributaria del defecto del sistema) y `requiere_accion`. Funciones
puras: `mensaje()`, `clasificarFallo()` (proveedor caído ≠ defecto propio ≠
fuente no habilitada), `valorDeclarado()` (cero ≠ desconocido) y `vigencia()`
(un dato de más de 45 días se conserva como evidencia marcada, no se presenta
como vigente).

**Fixtures deterministas** (`test/fixtures/salud-estados.js`): reloj congelado
en `2026-10-23T12:00:00Z`, RUT y montos inventados, sin cifras productivas.

| Test | Qué fija |
|---|---|
| E1 | Los 9 estados existen con etiqueta, condición y severidad válida; `es_hallazgo` separado |
| E2 | Cada estado nombra fuente y período; prohibido el mensaje genérico; lo que no es hallazgo lo declara |
| E3 | `$0` consultado = **verificado**; `$0` sin consultar = **pendiente**; sin dato = **no concluyente** |
| E4 | Vigencia 0/30/45 días = vigente; 46+ = «con observaciones», conservando la fecha |
| E5 | Proveedor caído / defecto propio / fuente no habilitada son estados distintos y ninguno es hallazgo |
| E6 | Los códigos del motor se traducen a la taxonomía, y con una empresa sin antecedentes el motor real no puntúa: `indice_evaluable = false`, dimensiones `no_evaluable` sin puntaje, declaraciones sin consultar en «pendiente» |

---

## 4. F0.4 · Respaldo recuperable e integridad (verificación no destructiva)

### 4.1 Qué respalda hoy `scripts/backup-db.js`

Backup **online** con la API de `better-sqlite3` (seguro con WAL y servidor
arriba) → `.db` → `sha256` + `manifest.json` → cifrado AES-256-GCM
(`JMVBACKUP1`) con `BACKUP_ENCRYPTION_KEY` → **round-trip verificado antes de
borrar el plano**. Retención `BACKUP_RETENCION` (30 días por defecto).

**Cobertura real: solo la base de datos.** Quedan **fuera** del respaldo:

| Fuera del `.db` | Contenido | Riesgo si se pierde |
|---|---|---|
| `data/sii-fichas/` | fichas del SII capturadas | hay que volver a consultar el SII (depende de sesión del contribuyente) |
| `data/certificados-tgr/` | certificados de deuda fiscal (PDF original) | se pierde la **evidencia** de un período; el PDF no es reconstruible desde el sistema |
| `data/exports/` | exportaciones generadas | regenerables |
| `.env` | `BACKUP_ENCRYPTION_KEY`, `SECRETOS_MASTER_KEY`, credenciales | **sin `BACKUP_ENCRYPTION_KEY` los backups son irrecuperables** |

### 4.2 Verificación de integridad disponible

`scripts/restore-db.js` → `core/backup-restaurar.js` verifica, en un destino
**aislado** y sin tocar la BD real: manifest → `sha256` del archivo →
descifrado → `sha256` del original → escritura → `PRAGMA integrity_check` →
conteos de 10 tablas críticas → descifrado de las claves SII `v1:` con
`SECRETOS_MASTER_KEY`. Nunca imprime secretos.

**Comprobado ahora (solo lectura):** `integrity_check = ok`; conteos de las 10
tablas críticas legibles (users 3 · empresas 22 · asientos 738 ·
asiento_lineas 2.173 · documentos 11.412 · auditoria 6.912 · periodos 3 ·
suscripciones 22 · bancos_cuentas 0). **No** se ejecutó una restauración: crear
un archivo desde un backup productivo excede el alcance de F0 y no aporta
evidencia nueva (el flujo ya está cubierto por `test/backup-seguro.test.js`).

### 4.3 Regla de aceptación propuesta (para F5, no ejecutada)

1. Copiar `data/backups/` **y** `data/sii-fichas/` + `data/certificados-tgr/` al
   almacenamiento externo; hoy esas dos carpetas dependen del snapshot del VPS.
2. Restauración de prueba **trimestral** a un directorio temporal, con
   comparación de conteos contra la producción.
3. Alerta si no aparece un backup nuevo en 26 h (el incidente de 7 noches sin
   respaldo fue silencioso: `job` fallando sin notificar).
4. Custodia separada de `BACKUP_ENCRYPTION_KEY` y `SECRETOS_MASTER_KEY`
   (sin ellas el respaldo existe pero no abre).

---

## 5. Riesgos críticos registrados — sin cambios (deliberado)

| ID | Riesgo | Estado en F0 |
|---|---|---|
| RK-05 | `clientes.clave_sii` en texto plano (capa legacy) | Documentado. **No** migrado: requiere ventana de mantenimiento y respaldo previo |
| RK-06 | Pérdida de `BACKUP_ENCRYPTION_KEY` ⇒ backups irrecuperables | Documentado. Custodia pendiente de decisión del dueño |
| RK-07 | Configuración de emisión DTE errónea (folios/CAF) | Sin tocar. Emitir con datos de prueba requiere autorización expresa |
| RK-21 | Identidad/permisos de vistas fuera de menú | **Resuelto y cubierto por test** |

---

## 6. Qué quedó habilitado para las fases siguientes

- `npm test` pasa de 634 a **646 casos** (634 + 6 de navegación + 6 de estados)
  y es reproducible en 107–110 s.
- Cualquier reordenamiento del menú (F2) romperá T1 hasta que el golden se
  actualice **en el mismo commit**: eso es el contrato, no un estorbo.
- F1 puede apoyarse en la taxonomía para sustituir los mensajes genéricos y en
  `valorDeclarado()` para separar un `$0` confirmado de un dato ausente.

## 7. Limitaciones declaradas

- No se abrió un navegador: la navegación se prueba sobre el router en sandbox,
  no con píxeles. El aspecto visual queda para revisión del usuario.
- No se ejecutaron consultas reales al SII/TGR ni una restauración de backup.
- `data/sii-fichas/` y `data/certificados-tgr/` no se abrieron (solo se verificó
  su existencia como directorios fuera del alcance del respaldo).
