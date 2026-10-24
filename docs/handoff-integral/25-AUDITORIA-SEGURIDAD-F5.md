# 25 · Auditoría de seguridad, hardening y preparación para producción (F5)

> **Fecha:** 2026-10-24 · **Rama:** `master` · **Commit base:** `85f93e9`
> **Modo:** auditoría de solo lectura + correcciones locales mínimas y probadas.
> **No** se hizo deploy, push, commit, migración ni llamada real a SII/TGR/MercadoPago.
> **No** se leyó ni transcribió ningún valor de `.env`, clave, token ni certificado.
>
> Etiquetas: **Confirmado** (evidencia en código/ejecución) · **Descartado**
> (se comprobó que NO aplica) · **NO VERIFICABLE** (requiere el VPS o un secreto
> que no está disponible) · **Propuesto** (diseño, no implementado).

---

## 1. Estado de partida verificado

| Dato | Valor observado |
|---|---|
| Rama / commit | `master` · `85f93e9` (sin commits nuevos) |
| Working tree | 20 archivos modificados + 10 sin seguimiento (F0–F4) |
| Suite de partida (esta pasada) | **662/662** (la cifra reportada por F4 se confirma ejecutando) |
| Navegador / capturas | 68 PNG de F3 en `docs/handoff-integral/capturas-f3/` |
| Restore aislado | Demostrado en F4 (7 casos) sobre BD ficticia |
| Configuración del VPS | **NO VERIFICABLE** desde el repositorio |

---

## 2. Superficie revisada

| Área | Archivos | Qué se comprobó |
|---|---|---|
| Clave maestra / bóveda | `backend/core/boveda.js` | Derivación, formato `v1:`, fallback, validación, caché |
| Cifrado de backup | `backend/core/backup-cifrado.js` | AES-256-GCM, salt propia, round-trip |
| Restore | `backend/core/backup-restaurar.js`, `scripts/restore-db.js` | Manifest → SHA-256 → descifrado → integridad → claves `v1:` |
| Backup / retención / cron | `scripts/backup-db.js`, `docs/DESPLIEGUE.md` | Cobertura, exclusión, retención, programación, incidentes |
| Autenticación | `backend/routes/auth.js`, `backend/services/password.js`, `backend/services/session.js` | Hash scrypt + `timingSafeEqual`, id de sesión de 32 bytes aleatorios, cookie `httpOnly`/`sameSite=lax`/`secure` en prod |
| Autorización | `backend/middleware/requireAuth.js`, `requirePermiso.js`, `backend/core/permisos.js` | RBAC por empresa, 401 vs 403, gates por ruta |
| Límites de solicitud | `backend/routes/auth.js` (login 5, registro, cambio de clave), `core/rate-limit-db.js` | Rate-limit persistido en SQLite (sobrevive reinicios) |
| Cabeceras | `backend/middleware/seguridad-headers.js` | CSP, nosniff, XFO, CORP, HSTS solo con HTTPS real |
| Emisión DTE | `backend/core/dte-emisor.js`, `backend/routes/dte.js` | Todos los caminos que llegan a `emitir` / `reintentar` / `generarXMLDTE` |
| Errores | `backend/index.js` | Manejador global y qué devuelve al cliente |
| Secretos versionados | Repositorio completo (patrones de clave/token, `.gitignore`) | Sin `.env`, `.pfx`, `.key`, `.pem` ni tokens versionados |

**Caminos que alcanzan una emisión DTE** (trazados):

1. `POST /api/dte/empresas/:empresaId/emitir` → `emisor.emitir()` → `_enviar()` → `dteAdapter.emitirDTE()` (adaptador real = `@devlas/dte-sii`).
2. `POST /api/dte/empresas/:empresaId/dtes/:dteId/estado` → `emisor.consultarEstado()` → `dteAdapter.consultarEstadoDTE()` (no emite, consulta).
3. Reintento de un DTE en `ERROR`/`RECHAZADO` por el mismo endpoint de estado o el de reintento → `_enviar()` (mismo adaptador).
4. `routes/pagos.js` (factura de suscripción) → usa un adaptador DTE para la empresa de JMV; **no** es el camino de las empresas cliente.

Los cuatro caminos comparten `emitir()`/`_enviar()`, que es donde ahora se aplica la puerta de certificado (§4).

---

## 3. Matriz de riesgos

Prioridad: **P0** bloquea producción · **P1** antes del próximo cliente · **P2** planificado · **P3** aceptado/documentado.

### 3.1 Riesgos heredados de F4

| ID | Riesgo | Evidencia concreta | Impacto | Prob. | Prioridad | Componente | Estado F5 | Mitigación / prueba |
|---|---|---|---|---|---|---|---|---|
| **CR-1** | Fallback a clave **determinista y pública** si falta `SECRETOS_MASTER_KEY` | `boveda.js` (antes): `scryptSync('iva-mensual-fallback-dev')` sin distinguir entorno | Crítico: cifrado reversible por cualquiera con el repo | Alta | **P0** | Bóveda / arranque | **Corregido en código** (F5-B). En producción ahora **lanza** y `backend/index.js` aborta | `test/seguridad-f5.test.js` (8 casos) |
| **R-1** | Backups en el **mismo volumen** que la BD | `docs/DESPLIEGUE.md`: cron escribe en `data/backups` (volumen `./data`) | Pérdida del VPS = pérdida de BD y respaldos | Media | **P1** | Operación | **Propuesto** (doc `26`) — sin código nuevo que copie afuera | Requiere proveedor externo + aprobación |
| **R-2** | Sin monitor de frescura ni alerta de backup fallido | Incidente 2026-10-10→16: 7 noches sin backup, detectado leyendo el log | Pérdida silenciosa de continuidad | **Alta (ya ocurrió)** | **P1** | Operación | **Corregido en código** (F5-C): `core/backup-vigilancia.js` + `scripts/verificar-backup.js` con exit codes. **Sin configurar** en el VPS (no hay cron nuevo) | `test/backup-vigilancia.test.js` (8 casos) |
| **CR-3** | Sin rotación real de la clave maestra | `scripts/rotar-master-key.js` solo rota **desde el fallback de desarrollo** a una clave nueva; no soporta rotar de clave real A → B ni datos mixtos | Cambiar la clave inutiliza claves SII/CAF/certificado | Media | **P2** | Bóveda | **Plan en `26` §4**; no se ejecutó ni se modificó | Pruebas propuestas en `26` |
| **R-6** | Emisión DTE sin validar certificado | (Antes) `emitir()` sin ninguna comprobación del `.pfx` | Emisión firmada con certificado vencido o de otro RUT | Media | **P0** | DTE | **Corregido en código** (F5-D): vencimiento, RUT emisor, ilegible, indescifrable; bloquea antes de consumir folio | `test/dte-certificado.test.js` (8 casos, `.pfx` ficticios) |
| **R-5** | `.env`/claves fuera del backup, sin custodia documentada | Backup = solo la BD; `.env` no se copia; `docs/SEGURIDAD.md` advierte pero no define custodia | Backup irrecuperable si se pierde la clave | Media | **P1** | Operación | **Propuesto** (`26` §6): custodia + inventario + procedimiento | Checklist ejecutable por el operador |

### 3.2 Hallazgos nuevos de esta auditoría

| ID | Riesgo | Evidencia | Impacto | Prob. | Prioridad | Mitigación propuesta | Regresión |
|---|---|---|---|---|---|---|---|
| **N-1** | El manejador global devuelve `err.message` al cliente | `backend/index.js:127` → `{ ok:false, error: err.message }` | Fuga de detalles internos (rutas, SQL, nombres de tablas) en 500 | Media | **P2** | En producción responder mensaje genérico + `id` de correlación; log interno con el detalle | Baja (los tests suelen leer `error`; requiere revisar mensajes esperados) |
| **N-2** | CSP con `'unsafe-inline'` en scripts | `seguridad-headers.js:30` | XSS con inline script posible si hay un punto de inyección | Baja | **P2** | Migrar a nonce/hash (deuda ya documentada en el middleware) | Media (todo el frontend usa `<script>` inline) |
| **N-3** | Passphrase de la clave maestra con **salt fija** | `boveda.js`: `scrypt(passphrase, SALT_APP)` con `SALT_APP` constante | Ataque offline precomputado entre instalaciones | Baja | **P2** | Recomendar 64 hex (sin KDF) y, en el formato v2, salt por instalación | Media (cambia derivación → requiere re-cifrado) |
| **N-4** | Backup **sin cifrar** si falta `BACKUP_ENCRYPTION_KEY` | `scripts/backup-db.js`: warning + `.db` en claro | Copia con claves SII cifradas pero con datos de clientes en claro | Media | **P1** | En producción: **fallar** el backup sin clave (como F5-B) o exigir `BACKUP_ENCRYPTION_KEY` al arrancar | Baja-media (cron dejaría de producir copias sin clave, a propósito) |
| **N-5** | `scripts/rotar-master-key.js` asume el fallback y aborta en estado mixto | Cabecera del script; `NODE_ENV=production` por defecto | Tras F5-B, si hay filas legacy en claro el script aborta al migrar (mensaje de clave obligatoria) | Media | **P2** | Documentar que la rotación debe correr con `SECRETOS_MASTER_KEY` = nueva clave; plan en `26` §4 | Media (script de emergencia) |
| **N-6** | `data/sii-fichas/` y `data/certificados-tgr/` con datos de contribuyentes **sin cifrar** y fuera del backup | `empresas-sii.js:140-168`, `deuda-tgr.js:331-334` | Exposición de datos tributarios si se filtra el disco | Baja | **P2** | Cifrar en reposo o reducir a caché efímera; permisos 600 del directorio | Media (cambia lectura de fichas) |
| **N-7** | `/api/health` público | `backend/index.js:114` | Reconocimiento mínimo (no expone datos) | Baja | **P3** | Aceptado: solo `{ok, message}` | Nula |
| **N-8** | `trust proxy = 1` | `backend/index.js` | Si el origen no siempre pasa por nginx, el rate-limit por IP podría sortearse | Baja | **P3** | Aceptado con el despliegue actual (Cloudflare → nginx → app) | Nula |
| **N-9** | Sin CSRF tokens | Cookies `sameSite=lax` (`auth.js:95`) | POST cross-site no envía la cookie en navegadores modernos | Baja | **P3** | Aceptado; revisar si se agrega `SameSite=None` | Nula |
| **N-10** | Identidad del emisor **contra la ficha SII** no se valida | F5-D compara el RUT del certificado con `empresas.rut` (local). No hay consulta a la ficha | Configuración incoherente con el SII no se detecta offline | Media | **P2** | Validar contra `empresas_sii` **cuando exista ficha fresca**; si no hay, declarar NO VERIFICADO (nunca confirmar) | Media (requiere red) |
| **N-11** | Certificado **sin RUT** en el subject | F5-D: `identidad_no_verificada` | No se puede afirmar identidad | Baja | **P2** | Ya bloquea en producción; falta guía de carga en la UI | Nula |
| **N-12** | Alerta de backup sin transporte | F5-C produce exit code, no envía nada | El monitor existe pero nadie se entera si no se conecta | Media | **P1** | Cron con `|| curl` a webhook / `MAILTO` / dead-man switch (`26` §3) | Nula |

### 3.3 Riesgos **descartados** (se comprobó que no aplican)

| Afirmación a verificar | Resultado | Evidencia |
|---|---|---|
| `clientes.clave_sii` en texto plano | **Descartado**: se cifra en reposo y la migración al arranque convierte el legado, con guard post-commit | `migraciones.js` → `migracionesBovedaClientes()`; `test/boveda-clientes.test.js` |
| Secretos versionados en el repo | **Descartado**: `git ls-files` no devuelve `.env`, `.pfx`, `.key`, `.pem`; `.gitignore` los excluye | `git ls-files`, `.gitignore` |
| Tokens/API keys hardcodeados | **Descartado**: búsqueda de literales de 16+ chars en `backend/` y `scripts/` sin resultados fuera de `process.env` | grep dirigido |
| Contraseñas de usuarios en claro | **Descartado**: scrypt con salt aleatoria por usuario + comparación en tiempo constante | `services/password.js` |
| Sesiones adivinables | **Descartado**: id de 32 bytes aleatorios | `services/session.js:9` |
| `npm run seed:v` afecta datos | **Descartado en F3**: solo reescribe `?v=` en HTML | doc `23` §2 |
| Emisión con folio duplicado al reintentar | **Descartado**: idempotencia con UNIQUE + verificación previa en la ruta | `migraciones.js` (`dte_emitidos.idempotencia`), tests |
| CAF de otro RUT aceptado | **Descartado**: se compara el RUT del CAF con la empresa | `dte-emisor.js:173` |

### 3.4 NO VERIFICABLE sin acceso al VPS / sin secretos

| Pregunta | Por qué no se puede responder aquí | Cómo verificarlo (autorizado) |
|---|---|---|
| ¿`SECRETOS_MASTER_KEY` está definida y es de 64 hex? | El `.env` de producción no se lee | En el VPS: `docker exec iva-mensual printenv SECRETOS_MASTER_KEY \| wc -c` (solo longitud) y `sha256sum` del valor para comparar contra el gestor |
| ¿La clave es la misma con la que se cifraron los datos? | Requiere descifrar un valor real | `node scripts/restore-db.js` sobre el último backup: si `claves.error` es null y `descifrables > 0`, coincide |
| ¿El cron de backup corre y produce copias frescas? | No hay acceso al VPS ni a su `data/` | `node scripts/verificar-backup.js` en el VPS (implementado) + revisar `logs-backup.log` |
| ¿Hay copia fuera del host? | No hay evidencia en el repo | Inventario del operador |
| ¿El certificado de cada empresa está vigente? | Los `.pfx` reales no están en el repo | `GET /api/dte/empresas/:id/config` (campo `certificado`) en producción |
| ¿TLS/HSTS efectivos? | Depende de nginx/Cloudflare | Revisar cabeceras con `curl -I https://…` |

---

## 4. Qué se implementó (y por qué es seguro)

### 4.1 F5-B — fallo seguro de la clave maestra

- **`boveda.validarClaveMaestra(env)`** (nueva, pura): en `NODE_ENV=production`
  exige clave presente y con formato válido (64 hex, o passphrase ≥ 32).
  Devuelve `{ok, origen, produccion}`; **nunca** incluye el valor.
- **`cargarClave()`** usa esa validación: en producción ya no existe el camino
  al fallback. En desarrollo/pruebas el comportamiento histórico se mantiene.
- **`backend/index.js`** la llama **antes** de `require('./db')`: el proceso
  termina con código 1 y un mensaje accionable, en lugar de cifrar secretos con
  una clave pública.
- **Compatibilidad:** el formato `v1:` no cambió; los datos cifrados existentes
  se siguen leyendo con la misma clave. No se rotó nada.
- **Riesgo de regresión:** un despliegue que hoy corre sin la variable dejará de
  arrancar. Es el comportamiento buscado; el mensaje indica exactamente qué
  hacer y **no** revela valores.

### 4.2 F5-D — certificado de firma antes de emitir

- **`estadoCertificado(db, empresaId)`**: parsea el `.pfx` descifrado con la
  librería del SII y devuelve `{estado, bloqueante, motivo, rut, dias, vence}`.
  Estados: `ausente`, `indescifrable`, `invalido`, `vencido`, `rut_no_coincide`,
  `identidad_no_verificada`, `por_vencer`, `vigente`.
- **`exigirCertificadoEmisor()`** se llama en `emitir()` **antes** de reservar
  folio (línea ~510) y bloquea:
  - vencido · de otro RUT · indescifrable → **siempre**;
  - ilegible o sin RUT → **solo en producción** (en certificación los `.pfx` de
    los tests/mocks son ficticios y el adaptador es un doble).
- **`GET /api/dte/empresas/:id/config`** ahora incluye `certificado` (metadatos,
  sin `.pfx` ni contraseña) para que la UI pueda avisar «vence en N días».
- **NO se implementó** la comparación contra la ficha SII: requiere red y una
  ficha fresca. Queda como `NO VERIFICADO` explícito (N-10).

### 4.3 F5-C — vigilancia de backups

- **`backend/core/backup-vigilancia.js`**: módulo puro; evalúa el directorio y
  devuelve `ok` / `sin_directorio` / `ausente` / `incompleto` / `corrupto` /
  `antiguo`, con la antigüedad medida por el **stamp del nombre** (UTC) y
  verificación opcional de SHA-256 contra el manifest.
- **`scripts/verificar-backup.js`**: CLI con exit `0/1/2`, `--dir`,
  `--max-horas`, `--sin-hash`, `--json`. No descifra, no imprime secretos y no
  hace red (la alerta se conecta con el exit code).
- **Evidencia real local** (no del VPS): ejecutado contra `./data/backups` de
  esta copia de trabajo →
  `[BACKUP-CHECK] ANTIGUO última=iva_mensual_2026-10-11T00-25-03.db.enc (330.3 h, cifrada, total 6)` → exit 1.
  Es exactamente el fallo que el monitor debe detectar.

---

## 5. Protección de secretos: qué se comprobó (sin revelar valores)

| Comprobación | Resultado |
|---|---|
| ¿Hay secretos versionados? | **No** (`git ls-files`), `.gitignore` cubre `.env*`, `*.db`, `data/` |
| ¿Los logs imprimen claves? | El log de sync nombra el error, no el valor; la auditoría guarda conteos. Barrido dirigido sin hallazgos (no exhaustivo, ver N-1) |
| ¿Las respuestas HTTP devuelven el `.pfx`/contraseña? | `configPublica()` los elimina; `estadoCertificado()` solo devuelve metadatos; tests lo fijan |
| ¿Los tests contaminan con claves reales? | Usan claves efímeras (`crypto.randomBytes`) o fixtures ficticios |
| ¿Los documentos de F5 contienen valores? | No: solo nombres de variables y procedimientos |
| ¿Se imprimió la clave al ejecutar? | No: `validarClaveMaestra` y los scripts no la incluyen en mensajes |

---

## 6. Archivos de esta fase

| Archivo | Cambio |
|---|---|
| `backend/core/boveda.js` | `validarClaveMaestra`, `esProduccion`, guarda en `cargarClave`, `_olvidarClave` (tests) |
| `backend/index.js` | Guarda de arranque **antes** de abrir la base |
| `backend/core/dte-emisor.js` | `estadoCertificado`, `exigirCertificadoEmisor` y su llamada en `emitir` |
| `backend/routes/dte.js` | `certificado` en `GET /config` (metadatos) |
| `backend/core/backup-vigilancia.js` | **Nuevo** — evaluación de frescura/integridad |
| `scripts/verificar-backup.js` | **Nuevo** — CLI de vigilancia (exit codes) |
| `test/seguridad-f5.test.js` | **Nuevo** — 8 casos F5-B |
| `test/dte-certificado.test.js` | **Nuevo** — 8 casos F5-D con `.pfx` ficticios |
| `test/backup-vigilancia.test.js` | **Nuevo** — 8 casos F5-C + CLI |
| `package.json` | Registro de los 3 archivos de test |

Suite: **686/686** (662 + 24 nuevas). Detalle y comparación en `26` §7.
