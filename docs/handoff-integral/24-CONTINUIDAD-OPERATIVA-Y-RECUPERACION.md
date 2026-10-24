# 24 · Continuidad operativa, respaldo y recuperación (F4)

> **Fecha:** 2026-10-24 · **Rama:** `master` · **Commit base:** `85f93e9` (+ cambios F3 sin commitear)
> **Modo:** solo lectura/análisis + **una prueba de restauración en un entorno temporal aislado**.
> No se restauró sobre producción, no se ejecutaron migraciones nuevas y no se
> modificaron datos.

Etiquetas: **Inspeccionado** · **Verificado** (ejecutado aquí) · **NO VERIFICADO** · **Propuesta**.

---

## 1. Mecanismo de respaldo actual

### 1.1 Qué existe

| Pieza | Archivo | Función |
|---|---|---|
| Backup | `scripts/backup-db.js` | Copia online de la BD SQLite + cifrado + manifest + retención |
| Cifrado | `backend/core/backup-cifrado.js` | AES-256-GCM, formato `JMVBACKUP1` |
| Restauración verificada | `backend/core/backup-restaurar.js` | Manifest → SHA-256 → descifrado → integridad → conteos → claves SII |
| CLI de restauración | `scripts/restore-db.js` | `--backup <ruta> --dest <carpeta aislada>` |
| Programación | `crontab` del VPS (`docs/DESPLIEGUE.md`) | `0 3 * * * docker exec iva-mensual node scripts/backup-db.js` |
| Documentación previa | `docs/SEGURIDAD.md` §P6 | Variables, pérdida de claves, procedimiento |

### 1.2 Qué respalda

- **`data/iva_mensual.db` completo**, mediante la API de backup online de
  better-sqlite3 (`db.backup()`): consistente con WAL activo y con el servidor en
  marcha (no hace falta detener la aplicación).
- Incluye **todo el estado de negocio**: empresas, clientes, documentos RCV,
  asientos, tesorería, DTE emitidos (XML/timbre viven en la BD, no en archivos),
  **CAF de folios y certificados de firma cifrados** (`dte_folios.caf_xml`,
  `dte_config.cert_pfx`), auditoría, jobs, rate-limits y CRM.
- Los agregados del RCV, declaraciones SII (F29/F22/BHE), fichas y deuda TGR
  también están **en la BD**; los archivos de `data/` (§2) son copias de evidencia.

### 1.3 Cómo cifra y verifica

1. `db.backup()` escribe `iva_mensual_<stamp>.db` y calcula su **SHA-256**.
2. Si existe `BACKUP_ENCRYPTION_KEY`: deriva la clave (64 hex = bytes directos;
   passphrase = `scrypt` con salt propia `jmv-backup-v1`), cifra con **AES-256-GCM**
   (IV aleatorio de 12 B, tag de 16 B) y **verifica el round-trip en memoria antes
   de borrar el archivo plano**. Si el round-trip no coincide: error, exit 1 y el
   `.db` en claro se conserva.
3. Escribe `<stamp>.db.enc`, `<stamp>.manifest.json` (hash, tamaño, formato,
   `cifrado`, `sha256_original`, `secretos: "ninguno"`) y `<stamp>.sha256`
   (compatible con `sha256sum -c`).
4. `chmod 600` best-effort (en NTFS no aplica: se controla por ACL del directorio).
5. **Retención**: `BACKUP_RETENCION` (default **30**), agrupando `.db` / `.db.enc` /
   `.manifest.json` / `.sha256` por stamp; borra los más antiguos.

**Verificado:** corrida real sobre una BD ficticia → `[BACKUP] OK … cifrado:
AES-256-GCM (JMVBACKUP1)` con manifest y `.sha256` junto al archivo.

### 1.4 Gestión de `BACKUP_ENCRYPTION_KEY`

- Vive **solo** en el `.env` del VPS (nunca versionada, nunca impresa por el
  script ni por el restore).
- Es **independiente** de `SECRETOS_MASTER_KEY` a propósito (salt distinta): rotar
  una no invalida la otra; comprometer una no expone la otra.
- **Si falta** al hacer backup: el backup se genera **sin cifrar** con un warning
  en el log (no falla). Si falta al restaurar un `.enc`: error explícito y exit 1.
- **Si se pierde:** los backups cifrados existentes son irrecuperables
  (`docs/SEGURIDAD.md`). Debe custodiarse en el gestor de secretos del VPS, fuera
  del mismo disco que los backups.

### 1.5 Cómo se detectan los fallos (estado real)

| Situación | Detección actual |
|---|---|
| La BD no existe / no se puede abrir | Mensaje `[BACKUP] No existe…` + **exit 1** |
| Error de copia o de cifrado | `[BACKUP] ERROR: …` + **exit 1**, sin borrar el plano |
| Clave de backup ausente | **Solo warning** en el log (backup en claro) |
| Disco lleno / permisos | Error de Node → `[BACKUP] ERROR` + exit 1 |
| **El cron falla todas las noches** | **Ninguna alerta activa**: solo queda la línea en `logs-backup.log` del host |
| Backup **incompleto** (proceso muerto a mitad de escritura) | No se escribe manifest (el manifest se crea al final): el restore aborta con «Manifest no encontrado». Un `.enc` truncado con manifest presente falla por SHA-256 |
| Backup **corrupto** en reposo | Se detecta **solo al restaurar** (SHA-256 del archivo vs manifest). No hay verificación periódica programada |
| Backups antiguos | La retención borra por `stamp` los que exceden `BACKUP_RETENCION`, incluidos manifest y `.sha256` |

**Incidente real documentado** (`docs/DESPLIEGUE.md`): entre el **2026-10-10 y el
2026-10-16** el volumen `./data` quedó de `root` y el backup del cron falló **7
noches seguidas en silencio** («unable to open database file»). Se detectó leyendo
el log a mano. Hoy `ops/deploy.sh` comprueba la escritura de `/app/data` y
`/app/data/backups` al final de cada despliegue, pero **no existe** un monitor de
frescura del backup (p. ej. «el último backup tiene más de 26 h») ni alerta.

**Riesgo alto pendiente:** no hay verificación automática de que el backup de anoche
exista, pese a que el propio `docs/DESPLIEGUE.md` recomienda probar el restore una
vez al mes.

### 1.6 Condiciones para una recuperación completa

1. El archivo `.db.enc` **y** su `.manifest.json` (el restore los exige juntos).
2. `BACKUP_ENCRYPTION_KEY` vigente al momento del backup.
3. `SECRETOS_MASTER_KEY` vigente al momento del backup (para descifrar claves SII,
   CAF y certificados de firma que viven en la BD).
4. Un host con Node 24+, `better-sqlite3` compilado (`npm ci`) y espacio para la BD.
5. La configuración del `.env` restante (provider RCV, token MP, URLs) — no está
   en el backup.
6. Conectividad al SII/TGR solo para **regenerar** las fichas y certificados de
   evidencia (§2), no para restaurar la operación contable.

### 1.7 Dependencias externas que podrían impedir la restauración

- **Pérdida de `SECRETOS_MASTER_KEY`**: la BD restaura, pero las claves SII, los CAF
  y el certificado de firma **no se pueden descifrar** → no hay sync ni emisión
  hasta reingresar todo (y los CAF ya consumidos no se recuperan del SII sin trámite).
- **Pérdida de `BACKUP_ENCRYPTION_KEY`**: el backup es ilegible.
- **`npm ci` sin compilador** para `better-sqlite3` en un host nuevo.
- **SII/TGR caídos**: no impide restaurar; solo impide refrescar evidencia.
- **Reloj/zona**: los `stamp` de los archivos son UTC; ordenar por nombre es correcto.

---

## 2. Matriz de cobertura de respaldo

| Elemento | Contenido | ¿En el backup? | Recuperable si se pierde | Acción recomendada |
|---|---|---|---|---|
| `data/iva_mensual.db` (+ `-wal`, `-shm`) | Todo el estado contable y tributario | **Sí** (copia online consistente) | — | — |
| `data/sii-fichas/<rut>.json` | Ficha SII cruda por empresa | **No** | **Sí**, regenerable con login SII (`asegurarFicha`) | Respaldo opcional; no es fuente de verdad |
| `data/certificados-tgr/*.pdf` | PDF de certificado de deuda TGR (evidencia) | **No** | **Sí**, reconsultando TGR (puede cambiar el saldo) | Respaldar si se exige evidencia histórica inmutable |
| `data/exports/` | CSV/XLSX generados | **No** | **Sí**, se regeneran | No respaldar (temporal) |
| `data/backups/` | Los propios backups | Es el destino | — | **Copiar fuera del VPS** (§6, riesgo R1) |
| `.env` | `SECRETOS_MASTER_KEY`, `BACKUP_ENCRYPTION_KEY`, `MP_ACCESS_TOKEN`, `SIMPLEAPI_KEY`, `BASIC_AUTH_*` | **No** | **No** (claves) | Custodia en gestor de secretos; nunca junto al backup |
| `nginx/` (config + `certs/`) | Proxy TLS y certificados autofirmados | **No** | Regenerable (Cloudflare tunnel) | Documentado en `docs/DESPLIEGUE.md` |
| Código (`backend/`, `frontend/`) | Aplicación | **No** (vive en git) | Sí, desde el repositorio | Etiquetar la versión desplegada |
| `node_modules/` | Dependencias | **No** | `npm ci` | — |
| CAF de folios y certificado de firma DTE | **Dentro de la BD**, cifrados `v1:` | **Sí** (pero cifrados) | Solo con `SECRETOS_MASTER_KEY` | Custodia de la clave maestra |
| Secretos de clientes (`clientes.clave_sii`, `empresas.clave_sii`) | Claves SII cifradas `v1:` | **Sí** (cifradas) | Solo con `SECRETOS_MASTER_KEY` | Ver §4 |

**Conclusión:** la cobertura de **datos de negocio es completa** (todo vive en la
BD). Lo que queda fuera es **configuración y secretos**, y son justamente los que
hacen inútil un backup si se pierden. La cobertura es buena; la **custodia de
claves y la copia fuera del host** no están resueltas.

---

## 3. Procedimiento de restauración aislada (diseñado y ejecutado)

### 3.1 Reglas

1. **Nunca** restaurar sobre `data/iva_mensual.db` ni sobre el volumen de producción.
2. Restaurar en un directorio temporal **fuera** del árbol del proyecto.
3. El servidor de producción puede seguir corriendo: el restore no lo toca.
4. No imprimir secretos: el reporte solo muestra conteos y estados.

### 3.2 Pasos

```bash
# 0) Copiar el backup y su manifest a un host/directorio aislado (mismo par base)
#    iva_mensual_<stamp>.db.enc + iva_mensual_<stamp>.manifest.json

# 1) Verificación de integridad del archivo (independiente de la app)
sha256sum -c iva_mensual_<stamp>.sha256

# 2) Restauración + verificación (dentro del contenedor/host con dependencias)
BACKUP_ENCRYPTION_KEY=<clave-del-backup> \
SECRETOS_MASTER_KEY=<clave-maestra> \
node scripts/restore-db.js \
  --backup /ruta/iva_mensual_<stamp>.db.enc \
  --dest   /tmp/restore-test
```

Salida esperada:

```
[RESTORE] OK
[RESTORE] destino aislado: /tmp/restore-test/iva_mensual_restaurada.db
[RESTORE] integridad SQLite: ok
[RESTORE] tablas críticas: {"users":…,"empresas":…,"clientes":…,"auditoria":…,"asientos":…,
                           "asiento_lineas":…,"documentos":…,"periodos_contables":…,
                           "bancos_cuentas":…,"suscripciones":…}
[RESTORE] claves SII: {"clientes_v1":…,"empresas_v1":…,"descifrables":…,"error":null}
```

### 3.3 Criterios de aceptación

| # | Criterio | Cómo se comprueba |
|---|---|---|
| A1 | El SHA-256 del archivo coincide con el manifest | Paso 1 / el restore aborta si no |
| A2 | El contenido descifrado coincide con `sha256_original` | El restore aborta si no |
| A3 | `PRAGMA integrity_check` = `ok` | Salida del restore |
| A4 | Las 10 tablas críticas existen y tienen conteos > 0 coherentes | Salida del restore |
| A5 | **Todas** las claves `v1:` descifran con la clave maestra vigente (`descifrables == clientes_v1 + empresas_v1` y `error: null`) | Salida del restore |
| A6 | El documento contable de control cuadra (partida doble / saldo del período) | Consulta manual sobre la copia restaurada |
| A7 | La copia abre con la versión de código a desplegar (migraciones idempotentes al arrancar) | Arranque del servidor contra la copia en otro puerto |

> A6 y A7 no están automatizados en `restore-db.js`. No hay tabla de versión de
> esquema, así que la compatibilidad se comprueba arrancando (las migraciones son
> idempotentes). Se recomienda agregar `PRAGMA foreign_key_check` y un chequeo de
> `user_version` al reporte.

---

## 4. Prueba real de restauración (entorno aislado)

**Verificado el 2026-10-24** con una BD **ficticia** sembrada en `%TEMP%` (no la de
producción), claves aleatorias por corrida y `restore-db.js` sobre directorios
temporales. Resultados:

| # | Caso | Resultado |
|---|---|---|
| 1 | Backup cifrado de una BD con una clave SII `v1:` real | **OK** — `AES-256-GCM (JMVBACKUP1)`, manifest + `.sha256`, sin `.db` plano residual |
| 2 | Restore con la clave correcta | **OK** — `integridad: ok`, 10 tablas críticas con conteos, `empresas_v1: 1, descifrables: 1, error: null` |
| 3 | Restore con `BACKUP_ENCRYPTION_KEY` **incorrecta** | **Rechazado** — «No se pudo descifrar el backup» |
| 4 | Restore **sin** `BACKUP_ENCRYPTION_KEY` | **Rechazado** — «El backup está cifrado y BACKUP_ENCRYPTION_KEY no fue provista» |
| 5 | Restore con el archivo **alterado en 1 byte** | **Rechazado** — «Integridad del archivo FALLIDA: sha256 real … ≠ manifest …» |
| 6 | Restore con `SECRETOS_MASTER_KEY` **distinta** | **Rechazado** (exit 1) — `descifrables: 0`, error «No se pudo descifrar un secreto de la bóveda»; la integridad SQLite sí era `ok` |

| 7 | **La aplicación abre la copia restaurada** (sin tocar producción) | **OK** — servidor en `PORT=3598` con `DB_PATH=<copia restaurada>`: `GET /api/auth/estado` → 200, `POST /api/auth/login` con el usuario demo de la copia → 200, `GET /api/auth/me` → 200 con empresa y permisos |

Detalle del caso 7: los conteos de la copia coinciden con el origen
(`users: 5`, `empresas: 2`, `documentos: 12`, `asientos: 6`), el login valida
contra la copia y el `me` devuelve la empresa y su set de permisos. El proceso se
detuvo al terminar; no quedó ningún servicio escuchando en 3598.

**Veredicto:** la **recuperabilidad técnica está demostrada en un entorno aislado**,
incluyendo los modos de fallo que importan (clave de backup ausente o equivocada,
archivo corrupto, clave maestra equivocada) **y** que la aplicación es capaz de
operar contra la copia restaurada.

**Salvedad honesta:** lo demostrado es el mecanismo con una BD ficticia. **NO
VERIFICADO**: restaurar un backup **real de producción** (no se hizo, por mandato y
porque implicaría manipular datos de clientes). Tampoco se midió el tiempo de
restauración con el volumen real ni se probó un restore en un host limpio sin
`node_modules`.

**Salvedad menor:** cuando la verificación final falla (caso 6), la copia
restaurada **ya quedó escrita** en el directorio destino (se escribe antes de
verificar la bóveda). No es peligroso —el destino es aislado y el exit code es 1—
pero el operador debe **descartar** ese archivo, no promoverlo.

---

## 5. Credenciales SII: riesgo real de `clientes.clave_sii` en texto plano

### 5.1 Estado actual (corrige la premisa de la fase)

El riesgo **está mitigado en el código** desde el «BLOQUE 1» de seguridad:

| Mecanismo | Evidencia |
|---|---|
| Cifrado en reposo AES-256-GCM formato `v1:<iv>:<tag>:<ct>` | `backend/core/boveda.js` |
| Migración **one-way, idempotente y transaccional** de las claves legacy al arrancar | `backend/core/migraciones.js` → `migracionesBovedaClientes()`, invocada en `backend/db.js` |
| Round-trip en memoria **antes** de abrir la transacción (aborta sin tocar la BD si algo falla) | idem |
| Guard post-commit: si queda alguna clave en claro, **lanza** y pide revisar con backup | idem |
| Registro de auditoría de la migración (solo conteo, nunca la clave) | idem (`migracion.boveda_clientes`) |
| Lectores tolerantes a ambos formatos (permite desplegar en cualquier orden) | `boveda.descifrar()` devuelve legacy tal cual |
| Escrituras nuevas ya cifradas (clientes y empresas) | `routes/clientes.js`, `core/empresas.js` (`cifrar()` al guardar) |
| El restore verifica que las claves `v1:` descifren | `backup-restaurar.js` |

### 5.2 Riesgos que **sí** quedan abiertos

| ID | Riesgo | Severidad | Detalle |
|---|---|---|---|
| CR-1 | **`SECRETOS_MASTER_KEY` ausente en producción** | **Crítico** | `boveda.cargarClave()` cae a una clave **determinista** (`scrypt('iva-mensual-fallback-dev')`) y solo emite un warning. Sin la variable, el cifrado es reversible por cualquiera con el código: equivale a texto plano. **No se pudo verificar** el `.env` real del VPS (no se lee), así que **no se puede afirmar** que esté definida. |
| CR-2 | Filas legacy no migradas hasta el próximo arranque | Medio | La migración corre al abrir la BD; entre el deploy y el reinicio, las filas viejas siguen en claro. El guard falla ruidosamente, pero después de haber servido. |
| CR-3 | Sin rotación de `SECRETOS_MASTER_KEY` | Alto | No hay procedimiento ni versionado de clave (`v2:` con id de clave). Cambiarla hoy **inutiliza** claves SII, CAF y certificados; la única salida es reingresarlos. |
| CR-4 | Clave maestra y backups en el mismo host | Alto | Si el VPS se compromete, el atacante obtiene ambos. `docs/SEGURIDAD.md` lo advierte; no hay control técnico. |
| CR-5 | Texto plano en memoria | Bajo | `descifrar()` devuelve `string`; no se puede borrar de memoria en JS. Mitigable solo acotando el alcance (no loggear, no serializar). |
| CR-6 | Fuga por logs | Bajo (no reproducido) | Se revisó que el log de sync nombra el error («Clave SII incorrecta») sin el valor y que la auditoría no guarda secretos. **No** se hizo un barrido exhaustivo de todos los `console.log` ni de los mensajes de librerías de terceros. |

### 5.3 Estrategia de migración propuesta (NO implementada)

1. **Cerrar CR-1 primero:** hacer que la aplicación **falle al arrancar** en
   `NODE_ENV=production` si `SECRETOS_MASTER_KEY` falta o no tiene 64 hex (hoy solo
   advierte). Sin esto, cualquier migración es cosmética.
2. **Formato versionado con id de clave:** `v2:<keyId>:<iv>:<tag>:<ct>`, con mapa
   `keyId → clave` en el entorno (`SECRETOS_MASTER_KEY` + `SECRETOS_MASTER_KEY_PREV`).
   Descifrar acepta `v2:`, `v1:` y legacy; cifrar **siempre** escribe `v2:`.
3. **Re-cifrado gradual (online):** script `scripts/rotar-boveda.js` que recorre
   filas en lotes, descifra con la clave vigente y re-cifra con la nueva; guarda un
   checkpoint (`boveda_rotacion` tabla o `jobs-persistentes`) para reanudar.
4. **Compatibilidad temporal:** los lectores aceptan los tres formatos durante la
   ventana; el guard post-commit solo exige que **no queden** valores legacy en claro.
5. **Verificación previa y posterior:** round-trip en memoria por fila, conteo de
   `v1:`/legacy restantes = 0, y una prueba de descifrado muestral (sin imprimir
   valores) antes de retirar la clave anterior.
6. **Backup obligatorio antes de rotar** (`scripts/backup-db.js`) y **prohibido**
   borrar la clave anterior hasta completar el re-cifrado y validar el restore.
7. **Rotación de las claves de los clientes:** las claves SII son del contribuyente;
   rotarlas significa que el cliente la cambió en el SII. El sistema debe detectar
   «clave rechazada» (ya lo hace: `sync-diaria` corta el segundo flujo para no
   bloquear la cuenta) y marcar la empresa para reingreso, no reintentar en bucle.
8. **Protección de logs:** un solo helper de logging que redacte `v1:`/`v2:` y
   strings de 8–12 caracteres junto a `clave`; test que escanee los logs de la suite.
9. **Eliminación del dato antiguo:** tras el re-cifrado, `UPDATE` de la columna con
   el valor nuevo (nunca `DELETE` de la fila) y `VACUUM` para recuperar páginas
   libres del archivo SQLite (si no, el ciphertext viejo puede quedar en páginas
   libres del `.db`).

**Decisión:** nada de esto se implementa en esta fase (por mandato). Lo que sí se
concluye: **hoy no hay claves SII en texto plano en reposo**, salvo que
`SECRETOS_MASTER_KEY` falte (CR-1), que es el riesgo que hay que cerrar primero.

---

## 6. Emisión DTE: controles preventivos

### 6.1 Controles **existentes** (inspeccionados en el código)

| # | Control | Dónde | Efecto |
|---|---|---|---|
| C1 | Adaptador de emisión obligatorio | `dte-emisor.emitir` | Sin `dteAdapter` no se emite |
| C2 | Tipo de DTE restringido a 33/34/56/61 | `esTipoValido` | Rechaza cualquier otro tipo |
| C3 | Ítems validados (cantidad, precio, descripción, montos) | `validarItems` | Rechaza el documento completo |
| C4 | Receptor validado (RUT, razón social, giro, dirección) | `validarReceptor` | ídem |
| C5 | Referencia validada en notas (56/61) | `validarReferencia` | ídem |
| C6 | Configuración del emisor completa | `faltantesPorTipo` | Nombra **qué** falta: razón social, giro, dirección, comuna, ACTECO, `FchResol`, `NroResol` y **CAF del tipo** |
| C7 | Folio sin saltos | `siguienteFolio` | Si el folio cae en un hueco entre CAF, **error nombrando el hueco** (no salta en silencio) |
| C8 | CAF pertenece a la empresa | `guardarCaf` | `El CAF pertenece al RUT X y la empresa es Y` |
| C9 | CAF de un tipo emitible | `guardarCaf` | Rechaza tipos que el sistema no emite |
| C10 | CAF parseado por la librería del SII | `new CAF(xml)` | XML inválido no se guarda |
| C11 | Ambiente restringido | `guardarConfig` | Solo `certificacion` o `produccion`; default `certificacion` en la tabla |
| C12 | Formatos de `FchResol` / `NroResol` / `ACTECO` | `guardarConfig` | Rechaza valores no conformes |
| C13 | Idempotencia de emisión | `dte_emitidos.idempotencia` (UNIQUE) | Reenviar la misma intención no duplica el DTE |
| C14 | Documento de la bandeja debe ser de la empresa | `emitir` | Evita emitir contra el documento de otro tenant |
| C15 | Aislamiento + permisos por ruta | `routes/dte.js` (`dte:emitir`, `dte:configurar`, `dte:ver`) | 403/401 del backend |
| C16 | Secretos cifrados en reposo | bóveda `v1:` (`caf_xml`, `cert_pfx`) | CAF/certificado no quedan en claro |
| C17 | Metadatos de folios sin exponer la clave privada | `listarFolios` | Devuelve rangos y uso, **nunca** el XML |
| C18 | Estado del DTE consultado al SII, no inferido | `consultarEstadoDTE` | No se declara aceptado sin respuesta |

### 6.2 Controles **recomendados** (no implementados)

| # | Recomendación | Por qué |
|---|---|---|
| R1 | **Confirmación explícita de ambiente por emisión** (doble paso si es `produccion`) | Hoy el ambiente es un campo de configuración; un cambio accidental persiste en silencio |
| R2 | **Chequeo de vigencia del certificado** antes de firmar | No existe ninguna comprobación de expiración (`grep venc/expira` sin resultados en `dte-emisor.js`) |
| R3 | Identidad de empresa contra la ficha SII | Validar que el RUT emisor y la razón social coinciden con `empresas_sii` antes de emitir en producción |
| R4 | Alerta de folios bajos (p. ej. < 10 % del rango) | Hoy solo se descubre al agotarse |
| R5 | Modo simulación (`dry-run`) que firma y valida sin enviar | Permite probar la configuración sin consumir folios reales |
| R6 | Auditoría del cambio de ambiente (de certificación a producción) | `guardarConfig` audita el cambio, pero no lo destaca ni lo restringe |
| R7 | Bloqueo de emisión si el período contable está cerrado | Evita DTE sin asiento posible |

### 6.3 Pruebas seguras propuestas

1. Con `dteAdapter` simulado: emisión válida, folio agotado, hueco entre CAF,
   CAF de otro RUT, ambiente inválido, idempotencia (mismo `idempotencia` dos veces
   → un solo registro), documento de otra empresa → 403. **Ya cubiertas** por
   `test/dte-emision.test.js` y `test/dte-contable.test.js` con adaptador falso.
2. En ambiente de **certificación** del SII, con un certificado de prueba y folios
   de certificación: emisión de un DTE de prueba, consulta de estado y anulación.
   **NO VERIFICADO** en esta pasada; requiere autorización y credenciales.
3. Nunca en producción sin R1–R4 resueltos.

---

## 7. Integraciones externas: matriz de verificación

| Integración | Implementación (código) | Pruebas automatizadas | Respuestas simuladas | Verificación real | Última verificación con evidencia | Limitaciones conocidas |
|---|---|---|---|---|---|---|
| **SII — RCV / sesión / ficha** | **Sí** — `services/sii-rcv.js`, `services/sii-session.js`, `core/empresas-sii.js`, `core/sync-diaria.js`, `core/declaraciones-sii.js` | **Sí** — `sync-diaria`, `sii-sesion`, `empresas-sii`, `declaraciones-sii`, `salud-informe` (HTTP/fetch stubbeado) | **Sí** — respuestas simuladas de login/RCV/F29 | **NO VERIFICADO** en esta pasada | Sin evidencia fechada en este repositorio; `data/sii-fichas/` guarda la última ficha por RUT (no se abrió: contiene datos de clientes) | Depende de la clave del cliente, del bloqueo por intentos y de cambios de HTML/servicios del SII; `SII_MAX_EMPRESAS` limita la corrida diaria |
| **SII — TGR (deuda fiscal)** | **Sí** — `core/deuda-tgr.js` (login con la misma clave tributaria, descarga el PDF y extrae el texto; guarda el PDF en `data/certificados-tgr/`) | **Sí** — `test/deuda-tgr.test.js` | **Sí** | **NO VERIFICADO** | — | El PDF es evidencia externa; el parseo puede romperse si TGR cambia el formato |
| **MercadoPago (suscripción)** | **Sí** — `routes/pagos.js` (checkout + webhook con re-confirmación contra la API) | **Parcial** — `test/saas3.test.js` | **Sí** | **NO VERIFICADO** | — | Requiere `MP_ACCESS_TOKEN`; el webhook debe ser público; sin token el checkout queda deshabilitado |
| **Emisión DTE (SII)** | **Sí** — `core/dte-emisor.js` + `@devlas/dte-sii` | **Sí** — `dte-emision`, `dte-contable` (adaptador falso) | **Sí** | **NO VERIFICADO** (no se emitió nada) | — | Requiere certificado, CAF y resolución **por empresa**; sin ellos la emisión se rechaza nombrando lo que falta |
| **Cartolas bancarias** (archivo del banco) | **Sí** — `routes/tesoreria.js` (`POST /tesoreria/cartola-archivo`), `core/tesoreria-cartola-formatos.js` (formatos por banco configurables) | **Sí** — `test/ux-tesoreria.test.js`, `test/teso-aplicaciones.test.js` | **Sí** — Excel/CSV de prueba | **NO VERIFICADO** (no hay conexión bancaria directa: es carga de archivo) | — | Depende del formato del portal de cada banco; el mapeo se configura y se prueba con archivos reales del cliente |
| **Geo Daniela** (asientos externos) | **Sí** — receptor `core/asientos-externos.js` + `routes/asientos-externos.js` (recibe centralizaciones ya cuadradas, valida Σdebe=Σhaber, período abierto, idempotencia) | **Sí** — `test/fase9.test.js` | **Sí** — payloads de ejemplo | **NO VERIFICADO** (ningún remitente real conectado) | — | Es un **receptor**: la integración no está probada contra el sistema de origen; el contrato está fijado por tests |
| **Generación de PDF** | **Sí** — el informe de Salud Tributaria se sirve como HTML (`/api/.../salud-tributaria/informe`) y el navegador lo imprime a PDF («Emitir informe (PDF)»); `pdf-parse` **lee** PDFs del SII/TGR; no hay generación de PDF en servidor | **Sí** — `test/salud-informe.test.js` (contenido del HTML) | **Sí** — capturas con media `print` | **Verificado en navegador** (las 6 páginas se renderizaron con la emulación `print` de Chrome); **NO VERIFICADO** en una impresora/visualizador externo | 2026-10-24 (`capturas-f3/informe-impreso-parte-1..6.png`) | El PDF depende del motor del navegador del usuario; no se firma ni se archiva automáticamente |
| **CRM / Geo u otros conectores** | Inspeccionado en `10-INTEGRACIONES-CONECTORES.md` | — | — | **NO VERIFICADO** | — | Fuera del alcance de F3/F4 |

**Regla aplicada:** ninguna de estas integraciones se declara «operativa en vivo».
Lo único afirmado es lo que el código y los tests con respuestas simuladas demuestran.

---

## 8. Riesgos y próximos pasos

| ID | Riesgo | Severidad | Acción sugerida |
|---|---|---|---|
| R-1 | Backups **en el mismo volumen** que la BD: perder el VPS = perder BD y respaldos | **Alto** | Copia diaria a almacenamiento externo (S3/Backblaze/rclone) + retención propia |
| R-2 | Sin monitor de frescura ni alerta de backup fallido | **Alto** | Chequeo post-cron («existe un backup < 26 h») con alerta por correo/Telegram; ya hubo 7 noches sin backup |
| R-3 | `SECRETOS_MASTER_KEY` ausente → clave determinista de desarrollo | **Crítico** | Fallar al arrancar en producción si falta (ver §5.3 paso 1) |
| R-4 | Sin rotación de clave maestra | Alto | Formato `v2:` + re-cifrado por lotes (§5.3) |
| R-5 | `.env` (claves) fuera del backup y sin custodia documentada | Alto | Gestor de secretos + procedimiento de recuperación escrito y probado |
| R-6 | Emisión DTE sin validación de certificado vencido ni de identidad contra la ficha | Alto | R2/R3 de §6.2 |
| R-7 | Restore de producción nunca probado | Medio | Ejercicio trimestral en host aislado con el backup real (fuera de horario) |
| R-8 | `restore-db.js` no verifica `foreign_key_check` ni la versión de esquema | Bajo | Agregar al reporte |
| R-9 | Copia restaurada persiste si falla la verificación final | Bajo | Borrar el destino o marcarlo `.rechazado` en el mismo paso |

Nada de lo anterior se implementó: son recomendaciones de esta fase.
