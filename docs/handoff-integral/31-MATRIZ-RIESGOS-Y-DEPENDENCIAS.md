# 31 · Matriz única de riesgos y dependencias (F8)

> **Fecha:** 2026-10-24 · **Base:** `master @ 85f93e9` + cambios locales sin commitear.
> **Regla:** cada fila tiene evidencia localizable y una prueba de aceptación objetiva.
> **Estados:** `VERIFICADO` · `FALLIDO` · `BLOQUEADO POR ACCESO` · `REQUIERE AUTORIZACIÓN` ·
> `NO APLICA CON EVIDENCIA`.
>
> Este registro consolida `24` §8 (R-1…R-6), `25` (N-*), `27` (P0–P3) y los hallazgos de F8.
> No reemplaza esos documentos: los ordena por impacto y les agrega la prueba que cierra cada uno.

---

## 1. Registro priorizado

| ID | Hallazgo | Evidencia | Impacto | Probabilidad | Severidad | Dependencias | Corrección propuesta | Prueba de aceptación | Requiere autorización | Estado |
|---|---|---|---|---|---|---|---|---|---|---|
| **RK-01** | Backups en el mismo volumen que la BD: perder el VPS borra datos **y** respaldos | `docker-compose.yml` (volumen `./data`); `24` §1.2 | Pérdida total e irreversible | Media | **Crítica** | Proveedor de almacenamiento externo; custodia de claves | Copia diaria cifrada a almacenamiento externo + retención propia | Restaurar desde la copia externa en un directorio aislado y abrir la app contra ella | Sí (proveedor, costo, claves) | **REQUIERE AUTORIZACIÓN** |
| **RK-02** | `SECRETOS_MASTER_KEY` sin verificar en producción; antes de F5 el fallback era público | `boveda.js` (histórico); `27` §6; `28` §4 | Claves SII, CAF y `.pfx` legibles con una clave del código | Media (no medida) | **Crítica** | Acceso de lectura al VPS | Si falta: rotar con `scripts/rotar-master-key.js` **antes** de desplegar F5 | `28` §4.1 `definida:true` **y** §4.2 `descifra:true`, 0 filas con fallback | Sí (solo lectura primero) | **BLOQUEADO POR ACCESO** |
| **RK-03** | Cron de backups estuvo **7 noches** sin generar copias y nadie se enteró | `24` §1.5; `deploy.sh` (comentario del 2026-10-10→16) | Pérdida de hasta una semana de operaciones | Alta si no se vigila | **Alta** | Acceso al VPS; canal de alerta | Programar `verificar-backup.js` (03:15) + alerta real conectada al exit code | La alerta llega a una persona cuando se fuerza un fallo | Sí (cron y webhook/correo) | **BLOQUEADO POR ACCESO** |
| **RK-04** | Commit/imagen del backend en producción no identificado (el frontend sí por hash) | `30` §1.2; `27` §9.3 | No se sabe qué código corre: un rollback apunta a ciegas | Alta | **Alta** | Acceso al VPS | `docker inspect` + hashes de archivos + `deploy-state.json` (`33` §2) | 5/5 hashes en una columna y `deploy-state.json` coherente | Sí (solo lectura) | **BLOQUEADO POR ACCESO** |
| **RK-05** | Sin rotación de clave maestra: cambiar la clave deja ilegibles los datos cifrados con la anterior | `boveda.js` (`v1:`); `scripts/rotar-master-key.js` | Pérdida de acceso a credenciales si se rota a mano | Media | **Alta** | Definición de `v2` + ventana | Formato `v2:` con re-cifrado transaccional y verificación previa | Rotación en BD ficticia con `descifrables = total` antes y después | Sí (afecta secretos) | **REQUIERE AUTORIZACIÓN** |
| **RK-06** | `.env` fuera del backup y sin custodia documentada | `24` §2; `.gitignore` | Si se pierde el VPS y el `.env`, los backups cifrados **no se pueden abrir** | Media | **Alta** | Gestor de secretos | Custodia en gestor + procedimiento de recuperación escrito y probado | Restaurar en aislado usando solo el gestor (sin el `.env` del servidor) | Sí (acceso al gestor) | **REQUIERE AUTORIZACIÓN** |
| **RK-07** | Certificados DTE por empresa sin verificar (vigencia e identidad) | `dte-emisor.js` (F5-D, local); `27` P1-6 | Emisión con certificado vencido o de otro contribuyente | Media | **Alta** (tributaria) | Acceso autenticado al VPS o `/config` | Desplegar F5-D y revisar `GET /dte/empresas/:id/config` por empresa | `legible && !vencido && coincide_rut_empresa` en todas, o bloqueo documentado | Sí (tras deploy) | **BLOQUEADO POR ACCESO** |
| **RK-08** | Frontend y backend de producción son de builds distintos al local; el deploy mezclaría tres estados | `30` §1.2 (`app.js?v=bdf0e607` vs local `c1d44190`) | Regresión funcional o UI nueva con backend viejo | Alta si se despliega sin orden | **Alta** | Ventana de mantenimiento | Un solo release identificable con hashes (`32` §3) y verificación post-deploy | `?v=` servido = `?v=` del build; `/api/health` con `version` | Sí (deploy) | **REQUIERE AUTORIZACIÓN** |
| **RK-09** | Migraciones de arranque sobre datos reales (aditivas, idempotentes) sin ensayo sobre copia de producción | `backend/db.js` / `core/migraciones.js`; `29` §A.4 | Bloqueo o corrupción si una migración falla a mitad | Baja | **Alta** | Backup verificado + ventana | Restaurar copia real en aislado y arrancar ahí el build nuevo (`32` §6) | Arranque correcto sobre la copia, `integrity_check ok` | Sí (manejo de copia real) | **REQUIERE AUTORIZACIÓN** |
| **RK-10** | HTTP plano (puerto 80) responde **200** con el contenido de la app, sin redirección a HTTPS (HSTS sí está presente) | `curl http://app.jmvconsultores.cl/` → `status=200`, sin `Location`; HSTS verificado 3/3 en HTTPS (`30` §1.2) | Primer acceso de un cliente sin TLS, sin forzar el canal seguro | Media | **Media** | Configuración del edge (Cloudflare/nginx) | «Always Use HTTPS» o `return 301 https://…` en nginx, tras el release | `http://` devuelve **301** a `https://` con la misma ruta | Sí (config del edge) | **FALLIDO** (producción) |
| **RK-11** | `500` devolvía `err.message` al cliente | Código previo en `backend/index.js`; corregido en F8 | Filtra SQL, rutas y detalles de la bóveda | Alta | **Media** | — | `middleware/errores.js`: genérico en producción | `test/salud-y-errores.test.js` E1–E3 | No | **VERIFICADO** (local; se activa al desplegar) |
| **RK-12** | `/api/health` no comprobaba la base: contenedor «healthy» sin poder leer datos | Código previo; corregido en F8 | Deploy declarado exitoso con el servicio inservible | Alta | **Media** | — | `middleware/health.js` con `SELECT 1` y 503 | H1–H3 + verificación en vivo (`{ok:true,db:'ok'}`) | No | **VERIFICADO** (local) |
| **RK-13** | `X-Powered-By: Express` en producción | `curl` hoy a `app.jmvconsultores.cl` | Reconocimiento del stack | Alta | **Baja** | — | `app.disable('x-powered-by')` | Cabecera ausente en el servidor local (W1) | No | **FALLIDO** en producción · corregido en local |
| **RK-14** | CSP con `unsafe-inline` (handlers inline del frontend) | `seguridad-headers.js`; `25` N-6 | XSS mitigado pero no eliminado | Media | **Media** | Migración de handlers a listeners + nonces | Plan de eliminación incremental | CSP sin `unsafe-inline` y 0 errores de consola en las 39 pantallas | No (código) | **REQUIERE AUTORIZACIÓN** (cambio funcional) |
| **RK-15** | Emisión DTE idempotente pero sin control de folios consumidos ante reintentos externos | `dte-emisor.js` (`siguienteFolio`, idempotencia); `24` §6 | Folio perdido o documento duplicado ante fallo de red | Baja | **Media** | Prueba en certificación SII | Documentar y probar el flujo de reintento con el SII en ambiente de certificación | Reintento no consume folio nuevo ni duplica documento | Sí (SII certificación) | **BLOQUEADO POR ACCESO** |
| **RK-16** | Restauración nunca probada con un backup **real** de producción ni con su volumen | `24` §4 (salvedad); `30` §10 | RTO desconocido; un fallo real no está cronometrado | Media | **Media** | Copia real + host aislado | Drill de restauración con copia real y medición (`32` §9) | RTO medido y documentado; app abre la copia | Sí (manejo de copia real) | **REQUIERE AUTORIZACIÓN** |
| **RK-17** | Hallazgo F8-5: la CLI de restore toma la clave del `.env` del directorio de trabajo, lo que confunde el diagnóstico de «clave ausente» | Ejecución de hoy (`30` §4.1) | Operador cree que falta la clave cuando en realidad hay otra distinta | Media | **Baja** | — | Documentado en `32` §4 con la verificación (longitud/huella, sin imprimir el valor) | El operador distingue los dos casos siguiendo el runbook | No | **VERIFICADO** (documentado) |
| **RK-18** | Copias de evidencia (`data/sii-fichas/`, `data/certificados-tgr/`) fuera del backup | `24` §2 | Pérdida de PDFs de respaldo (no de la contabilidad, que está en la BD) | Media | **Baja** | Espacio + política | Incluirlas en un tar cifrado junto al backup o regenerarlas desde el SII/TGR | Existe copia verificable de ambas carpetas o decisión escrita de no respaldarlas | Sí | **REQUIERE AUTORIZACIÓN** |
| **RK-19** | Tests dependientes del reloj/paralelismo (uno corregido: timeout 8 s → 20 s) | `test/salud-informe.test.js` | Falsos negativos en la suite; pérdida de confianza en el verde | Media | **Baja** | — | Revisión de tests con fechas fijas y esperas acotadas cuando aparezcan | Suite 3 corridas consecutivas en verde | No | **VERIFICADO** (parcial) |
| **RK-20** | Riesgo fiscal/contable clásico: mezcla de empresas, duplicación de documentos, asientos fuera de período | `test/invariantes-contables.test.js` I1–I7 | Cifras atribuidas a la empresa equivocada | Baja (controles presentes) | **Crítica** si ocurre | — | Invariantes ya fijadas por test; revisar en cada cambio del núcleo | 8/8 invariantes en verde en la suite | No | **VERIFICADO** (local) |

---

## 2. Riesgos descartados con evidencia (no hay que perseguirlos)

| Afirmación a descartar | Por qué se descarta |
|---|---|
| «Las claves SII se guardan en texto plano» | `clientes.clave_sii` y `empresas.clave_sii` se escriben cifradas con `v1:`; verificado por round-trip hoy y por `restore-db.js` (`empresas_v1:1, descifrables:1`) |
| «Los backups se escriben en claro siempre» | Sin `BACKUP_ENCRYPTION_KEY` sí (con aviso explícito); con la variable, `JMVBACKUP1` AES-256-GCM y round-trip antes de borrar el plano — verificado hoy |
| «Un backup que existe es un backup válido» | Falso por diseño: la aceptación es la restauración aislada, no el archivo (`30` §4) |
| «El 500 exponía trazas completas» | Exponía `err.message`, no la traza; la traza iba al log. Corregido igualmente (RK-11) |
| «`secretos` viajan dentro del backup» | El manifest declara `secretos: "ninguno"`; las claves viven en la BD cifradas y el `.env` **no** se respalda (eso es RK-06, no fuga) |

---

## 3. Dependencias entre riesgos

```
RK-02 (clave válida) ─┬─► RK-05 (rotación)         ─► RK-06 (custodia)
                      └─► RK-07 (certificados: necesitan clave para descifrar .pfx)
RK-03 (backup vigilado) ─► RK-01 (copia externa) ─► RK-16 (drill con copia real)
RK-04 (commit identificado) ─► RK-08 (release coherente) ─► RK-09 (migraciones)
RK-12 / RK-11 (health y errores) ─► despliegue observable (RK-08)
```

Lectura práctica: **no se puede desplegar (RK-08) sin resolver RK-02**, porque F5-B aborta el
arranque sin clave válida; y no se debe desplegar sin RK-03/RK-16 cerrados, porque no habría red
de seguridad verificada.

---

## 4. Orden recomendado de cierre

1. **RK-04** (identificar la versión) y **RK-02** (clave) — solo lectura, un operador, sin ventana.
2. **RK-03** (backup reciente + vigilancia) y **RK-16** (drill aislado) — escrituras controladas.
3. **RK-08/RK-09** (release con hashes y ensayo sobre copia) — ventana aprobada.
4. **RK-01/RK-06** (copia externa + custodia) — decisión de proveedor.
5. **RK-10/RK-14/RK-05** (edge, CSP, rotación) — endurecimiento posterior, ya con red de seguridad.

Cada paso tiene su comando exacto, la evidencia que debe devolver el operador y la decisión que
se toma según el resultado en `33` (verificación) y `32` (ejecución y reversión).
