# 26 · Plan de hardening, continuidad y recuperación (F5)

> **Fecha:** 2026-10-24 · **Rama:** `master` · **Commit base:** `85f93e9`
> **Naturaleza:** plan + lo efectivamente implementado en F5. **Nada de este
> documento se desplegó**: no hay cron nuevo, no hay proveedor externo
> contratado, no se rotó ninguna clave y no se verificó el VPS.
>
> Cada medida se clasifica en cuatro niveles, que **no** son intercambiables:
>
> | Nivel | Significado |
> |---|---|
> | **A · Código implementado** | Existe y está probado en el repositorio |
> | **B · Configuración presente** | Hay variables/cron/archivo en el host que lo activan |
> | **C · Servicio externo configurado** | Proveedor contratado y conectado |
> | **D · Operación real comprobada** | Se ejecutó y hay evidencia del resultado |
>
> En F5 sólo se alcanzó **A** en tres medidas. Todo lo demás es propuesta.

---

## 1. Objetivos de recuperación (propuestos, NO garantizados)

| Objetivo | Propuesta inicial | Qué lo sostiene hoy | Qué falta |
|---|---|---|---|
| **RPO** (pérdida máxima de datos) | ≤ 24 h | Backup diario 03:00 · WAL | Confirmar que el cron corre; copia externa |
| **RPO "duro"** (peor caso aceptable) | ≤ 48 h | Retención de 30 copias | Alerta si una noche falla (F5-C conectado) |
| **RTO** (tiempo de restauración) | ≤ 2 h en el VPS; ≤ 4 h en host nuevo | `restore-db.js` verificado en aislado (F4) | Medir con el volumen real; documentar `npm ci` |
| **Retención** | 30 copias diarias + 1 mensual externa | `BACKUP_RETENCION=30` | Copia mensual fuera del host |
| **Ventana de prueba de restore** | Trimestral | — | Agenda + evidencia archivada |

Estos números son **propuestas para aprobar**, no compromisos del sistema.

---

## 2. Estado de las medidas (matriz A/B/C/D)

| # | Medida | A código | B config | C servicio | D operación | Nota |
|---|---|---|---|---|---|---|
| 1 | Fallo seguro sin clave maestra | **Sí** (`boveda.validarClaveMaestra` + guarda en `index.js`) | **No** (el `.env` del VPS no se verificó) | — | **No** | Corregido en código; producción debe reiniciarse para que tome efecto |
| 2 | Certificado DTE validado antes de emitir | **Sí** (`estadoCertificado` + `exigirCertificadoEmisor`) | — | — | **No** (no se emitió nada) | Los `.pfx` de prueba son ficticios |
| 3 | Verificación de frescura/integridad de backup | **Sí** (`backup-vigilancia.js` + `verificar-backup.js`) | **No** (no hay cron que lo llame) | — | **Parcial**: ejecutado contra `data/backups` local (detectó 330 h de antigüedad) | No se ejecutó en el VPS |
| 4 | Copia de backup fuera del host | No | No | **No** | **No** | Ver §3 |
| 5 | Alerta de backup fallido | No (solo exit code) | No | **No** | **No** | Ver §3.3 |
| 6 | Rotación de clave maestra | Parcial (`scripts/rotar-master-key.js`, solo desde el fallback) | — | — | **No** | Ver §4 |
| 7 | Custodia de claves documentada | Doc (este archivo) | **No** | **No** | **No** | Ver §5 |

> **No se declara que exista una copia externa**: sólo hay código para verificar
> copias locales. No se declara resuelto CR-1 en producción: sólo está resuelto
> en código, a la espera de la configuración efectiva.

---

## 3. Backup externo, monitor y alertas (diseño)

### 3.1 Copia fuera del volumen (R-1)

El backup actual queda en `data/backups` del **mismo volumen** que la BD. Si el
VPS se pierde, se pierden ambos. Opciones evaluadas (ninguna contratada):

| Opción | Requisitos | Ventajas | Riesgos / costos |
|---|---|---|---|
| **Snapshot/backup del proveedor del VPS** | Panel del proveedor | Cero cambios en la app; restaura el host completo | Suele ser diario y del disco entero; verificar cifrado en reposo del proveedor |
| **Objeto compatible S3** (p. ej. Backblaze B2, Cloudflare R2, Wasabi) con `rclone`/`aws-cli` en el host | Bucket + credenciales de **solo escritura**; `rclone` instalado (dependencia nueva, requiere aprobación) | Copia incremental, retención por lifecycle, versión de objetos | Costo mensual bajo; hay que custodiar la credencial y no dejarla junto al backup |
| **`restic`/`borg` a un host secundario** | Segundo host + SSH + clave | Deduplicación y verificación (`restic check`) | Operación de dos hosts |
| **Copia manual cifrada a almacenamiento del contador** | Procedimiento humano mensual | Cero infraestructura | Depende de la disciplina; hay que registrar la evidencia |

**Nota de esta fase:** se consultó el catálogo de servicios disponible para
recomendar un proveedor de almacenamiento de objetos/monitor con alerta tipo
dead-man switch y **no devolvió candidatos aplicables**; por eso las opciones se
presentan como alternativas a evaluar con el proveedor, sin recomendación de
marca ni instalación de dependencias.

**Reglas no negociables para la copia externa:**

1. Se sube el archivo **ya cifrado** (`.db.enc` + `.manifest.json`). Nunca el
   `.db` en claro ni el `.env`.
2. La `BACKUP_ENCRYPTION_KEY` **no viaja con el archivo**: se custodia aparte
   (§5). Sin ella la copia externa es ilegible, que es el objetivo.
3. Credenciales del bucket con permiso mínimo (escritura + listado de su
   prefijo) y rotación anual.
4. Verificación mensual: descargar la copia más reciente y correr
   `scripts/restore-db.js` en un directorio temporal (procedimiento de F4).

**Comando propuesto** (a ejecutar por el operador, tras instalar la herramienta):

```bash
# 03:20, después del backup local y de su verificación
rclone copy /ruta/iva-mensual/data/backups \
  remoto:jvm-backups/$(date -u +%Y/%m) \
  --include "iva_mensual_*.db.enc" --include "iva_mensual_*.manifest.json"
```

### 3.2 Monitor de frescura (R-2) — **código listo**

```bash
# 03:15 todos los días: falla (exit 1) si no hay backup de las últimas 26 h
15 3 * * * cd /ruta/iva-mensual && /usr/bin/node scripts/verificar-backup.js --max-horas 26 \
           >> logs-backup.log 2>&1
```

Estados que reporta (probados): `ok`, `sin_directorio`, `ausente`,
`incompleto`, `corrupto`, `antiguo`. Ejemplo real de esta máquina de trabajo:

```
[BACKUP-CHECK] ANTIGUO última=iva_mensual_2026-10-11T00-25-03.db.enc (330.3 h, cifrada, total 6)
- La copia más reciente tiene 330.3 h (límite 26 h)
```

### 3.3 Alerta (falta transporte)

El monitor **no envía nada**: expone un exit code. Opciones, de menor a mayor
 infraestructura:

| Opción | Cómo | Requisitos |
|---|---|---|
| **Cron + correo** | `MAILTO=ops@…` en el crontab: cron envía la salida si el comando falla | Servidor de correo local o `msmtp` |
| **Webhook** | `… || curl -fsS -m 10 "$ALERTA_WEBHOOK" -d 'backup con problemas'` | Endpoint del operador (Slack/Telegram/ntfy) y la URL en el `.env` del host |
| **Dead-man switch** | El cron hace `curl` a un chequeo externo **solo si el backup quedó OK**; si no llega, el servicio alerta | Servicio externo (nivel C) + URL en el host |
| **systemd timer** | `OnFailure=` con una unidad de alerta | Migrar el cron a timer |

**Recomendación:** empezar por cron + `MAILTO` (cero dependencias) y agregar el
dead-man switch cuando exista un canal de alertas aprobado. Cualquier opción con
terceros requiere aprobación (regla 12 de la fase: no instalar sin justificar).

### 3.4 Protección de las copias

- Retención local 30 (ya implementada) + lifecycle del remoto (propuesto).
- Permisos `600` en los archivos y `700` en el directorio (el script lo intenta;
  en el VPS el dueño debe ser uid 1000 — incidente de octubre).
- El manifest **no** contiene secretos (`secretos: "ninguno"`).

---

## 4. Rotación de la clave maestra (F5-E) — plan, sin ejecución

### 4.1 Situación actual

- Formato único `v1:<iv>:<tag>:<ct>` **sin identificador de clave**: al cambiar
  `SECRETOS_MASTER_KEY`, todos los valores dejan de descifrarse (falla ruidosa,
  no corrupción).
- `scripts/rotar-master-key.js` cubre **un solo caso**: pasar del *fallback de
  desarrollo* a una clave nueva, en una transacción, con backup previo y
  verificación posterior. **No** permite rotar de una clave real A a B, ni
  convivir con datos mixtos (aborta a propósito).
- Interacción con F5-B (N-5): el script arranca con `NODE_ENV=production`; si la
  BD tuviera filas legacy en claro, la migración del arranque ahora exige la
  clave. **Mitigación operativa:** ejecutarlo con `SECRETOS_MASTER_KEY` igual a
  la clave **nueva** (el script ya recibe `ROTAR_NUEVA_KEY`).

### 4.2 Diseño propuesto: formato `v2` con id de clave

```
v2:<keyId>:<iv b64>:<tag b64>:<ct b64>
```

- `keyId` = 8 hex derivados de `sha256(clave)` (identificador, **no** secreto).
- Entorno: `SECRETOS_MASTER_KEY` (activa, usada para cifrar) y
  `SECRETOS_MASTER_KEY_PREV` (solo lectura, para descifrar lo viejo).
- Descifrado: `v2:` con la clave cuyo `keyId` coincide; `v1:` con la activa;
  legacy en claro tal cual (compatibilidad histórica).
- Cifrado: **siempre** `v2:` con la clave activa.

### 4.3 Procedimiento (cuando se autorice)

1. **Backup + verificación** previos (`backup-db.js` y `verificar-backup.js`).
2. Definir la clave nueva: `SECRETOS_MASTER_KEY_PREV=<actual>` y
   `SECRETOS_MASTER_KEY=<nueva>` en el `.env`; reiniciar (la app sigue leyendo
   todo: la nueva se usa para escribir, la previa para leer).
3. Script de re-cifrado por **lotes** (`scripts/rotar-boveda.js`, a crear):
   - lee `empresas.clave_sii`, `clientes.clave_sii`, `dte_config.cert_pfx`,
     `dte_config.cert_pass`, `dte_folios.caf_xml`;
   - descifra con la versión que corresponda y re-cifra con la activa;
   - guarda un **checkpoint** por lote (tabla `boveda_rotacion` o
     `jobs-persistentes`) con `{tabla, ultimoId, total, re_cifrados}` — **sin
     valores**;
   - verifica cada valor re-cifrado (descifrar y comparar en memoria);
   - si algo falla, **aborta el lote** y deja el estado consistente (cada fila
     es atómica).
4. Reanudación: al arrancar, el script retoma desde el checkpoint.
5. **Rollback**: mientras `SECRETOS_MASTER_KEY_PREV` siga presente, los datos
   viejos siguen legibles → revertir es cambiar las variables y reiniciar. La
   clave anterior **no se destruye** hasta completar y validar.
6. Verificación final: conteo de `v1:` restantes = **0**, `v2:` = total,
   descifrado muestral (sin imprimir valores) y `restore-db.js` sobre un backup
   posterior.
7. Retiro: eliminar `SECRETOS_MASTER_KEY_PREV`, reiniciar y **archivar** la clave
   anterior sólo si hay respaldos históricos que la necesiten (si no, destruirla
   de forma segura y registrarlo).
8. `VACUUM` de la BD para recuperar páginas libres con ciphertext viejo.

### 4.4 Pruebas requeridas antes de autorizar

- Descifrar `v1:` con la clave activa y `v2:` con la del `keyId` (unitario).
- `keyId` distinto → error explícito, sin intentar la clave equivocada.
- Re-cifrado: N filas → N verificadas, 0 `v1:` al final.
- Interrupción simulada a mitad de lote → reanudar sin duplicar ni perder.
- Rollback: datos re-cifrados con la nueva se leen con `PREV` presente.
- Restore de un backup **anterior** a la rotación sigue funcionando con la clave
  que le corresponde (custodia por fecha — §5).
- Conteos y auditoría sin secretos.

**Estado:** diseño. No se implementó ni ejecutó. Ninguna clave real se tocó.

---

## 5. Custodia y recuperación de claves (R-5)

### 5.1 Inventario de lo que hay que custodiar

| Secreto | Para qué sirve | Si se pierde |
|---|---|---|
| `SECRETOS_MASTER_KEY` | Descifrar claves SII, CAF y certificado de firma **en la BD y en los backups** | Hay que reingresar claves SII, recargar CAF (los consumidos se pierden) y reinstalar el certificado |
| `BACKUP_ENCRYPTION_KEY` | Descifrar los `.enc` | Los backups cifrados son ilegibles |
| `SIMPLEAPI_KEY` | Proveedor RCV alternativo | Se regenera en el proveedor |
| `MP_ACCESS_TOKEN` / `MP_WEBHOOK_SECRET` | Cobros de suscripción | Se regeneran en MercadoPago (afecta cobros hasta regenerar) |
| `BASIC_AUTH_PASS` (admin semilla) | Sólo primera siembra | No aplica después del primer arranque |
| Certificados `.pfx` de clientes | Firma DTE | Se reobtienen con el cliente (trámite) |

### 5.2 Procedimiento propuesto

1. **Dos custodios**: el dueño del sistema y una copia en un gestor de secretos
   (Bitwarden/1Password/Vault) **fuera del VPS**.
2. **Copia física sellada** de `SECRETOS_MASTER_KEY` y `BACKUP_ENCRYPTION_KEY`
   en sobre cerrado en oficina (para el escenario «el gestor también falla»).
3. **Registro de versiones**: `fecha · qué clave · qué respaldos abre`. Los
   respaldos de una fecha sólo se restauran con la clave vigente en esa fecha.
4. **Nunca**: la clave en el mismo bucket que el backup, en un chat, en un
   correo, en un `.txt` del repo o en una captura de pantalla.
5. **Prueba anual de recuperación** con la copia externa (nivel D).
6. **Alta/baja de personal**: rotar claves de backup y del gestor.

### 5.3 Inventario de reconstrucción del servicio

| Pieza | Fuente | Notas |
|---|---|---|
| Código | Repositorio git (etiqueta de versión) | Registrar el commit desplegado |
| Dependencias | `npm ci` (Node ≥ 24) | `better-sqlite3` compila nativo |
| Base de datos | Último `.db.enc` + manifest | `restore-db.js` |
| Claves | Gestor + sobre sellado | §5.2 |
| `.env` | Plantilla documentada + valores del gestor | No viaja en el backup |
| nginx / TLS | `docs/DESPLIEGUE.md` (Cloudflare tunnel) | Certificados autofirmados regenerables |
| Datos de `data/` no respaldados | `sii-fichas` y `certificados-tgr` se regeneran consultando SII/TGR | Requiere claves vigentes |
| Impresión del informe PDF | Navegador del usuario | No requiere servidor |

---

## 6. Endurecimiento pendiente de DTE (R-6 / N-10)

| # | Medida | Estado | Riesgo de regresión |
|---|---|---|---|
| 1 | Bloquear certificado vencido / de otro RUT / indescifrable | **Implementado** (F5-D) | Bajo: probado; bloquea antes de consumir folio |
| 2 | Bloquear en producción un `.pfx` ilegible o sin RUT | **Implementado** | Bajo |
| 3 | Aviso «vence en N días» en la UI | **Pendiente** (el endpoint ya lo expone) | Nulo |
| 4 | Confirmación explícita al emitir en **producción** | Pendiente | Medio (cambia el flujo de la vista) |
| 5 | Identidad del emisor contra la **ficha SII** | Pendiente; requiere red. Si no hay ficha fresca → `NO VERIFICADO`, nunca «confirmado» | Medio (puede bloquear emisiones legítimas si la ficha está vieja) |
| 6 | Alerta de folios bajos (< 10 % del rango) | Pendiente (`listarFolios` ya calcula uso) | Nulo |
| 7 | Modo simulación (firma y valida sin enviar) | Pendiente | Bajo |
| 8 | Bloqueo si el período contable está cerrado | Pendiente | Bajo |
| 9 | Auditoría destacada del cambio `certificacion → produccion` | Parcial (se audita el cambio, no se destaca) | Nulo |

Regla que se mantiene: **sin información verificable no se afirma**; el estado
queda como `NO VERIFICADO` en la respuesta y en el informe.

---

## 7. Pruebas y regresión de F5

| Conjunto | Antes | Ahora | Δ |
|---|---|---|---|
| Suite completa (`npm test`) | **662** | **686** | +24 |
| `test/seguridad-f5.test.js` | — | 8 | Clave maestra: ausente/inválida/passphrase/round-trip/arranque |
| `test/dte-certificado.test.js` | — | 8 | Vigente, vencido, otro RUT, por vencer, sin RUT, ilegible, indescifrable, orden del gate |
| `test/backup-vigilancia.test.js` | — | 8 | ok/antiguo/ausente/incompleto/corrupto/orden por stamp/CLI exit codes |

Toda la suite: **686/686, 0 fallos**. Ninguna aserción existente se eliminó ni
se debilitó; los tests de DTE existentes (48) siguen igual porque el `.pfx`
ficticio de los mocks queda como `invalido` y sólo bloquea en producción.

### 7.1 Riesgos de regresión de los cambios F5

| Cambio | Quién puede verse afectado | Mitigación / rollback |
|---|---|---|
| Guarda de clave maestra | Cualquier despliegue que arranque **sin** `SECRETOS_MASTER_KEY` (hoy arrancaría con fallback) | Es el objetivo; para volver atrás basta revertir el commit. El mensaje explica qué hacer |
| Guarda de arranque en `index.js` | Scripts que importan `backend/index.js` | Ningún test lo importa; sólo el proceso real |
| Gate de certificado en `emitir` | Emisión con certificado vencido/ajeno | Bloqueo intencional; los mocks de certificación siguen pasando |
| `certificado` en `GET /config` | Clientes que validen el JSON estrictamente | Campo **aditivo**; el frontend lo ignora hasta que se use |
| Módulo/CLI de backup | Nada del runtime (no se importa desde `index.js`) | Aislado |

---

## 8. Próximos pasos priorizados

| Prioridad | Acción | Nivel a alcanzar | Requiere |
|---|---|---|---|
| **P0** | Verificar en el VPS que `SECRETOS_MASTER_KEY` existe (sólo longitud/hash) y reiniciar para activar F5-B | B + D | Acceso al VPS |
| **P0** | Revisar el certificado de cada empresa emisora con `GET /config` → `certificado` | D | Acceso + sesión |
| **P1** | Programar `verificar-backup.js` en cron + alerta (`MAILTO` o webhook) | B + D | Acceso al VPS + canal de alerta |
| **P1** | Copia externa cifrada (elegir opción de §3.1) | C + D | Aprobación + credenciales |
| **P1** | Custodia de claves (§5.2) y prueba de restore con la copia externa | D | Humano |
| **P2** | Formato `v2` + rotación por lotes (§4) | A/B/D | Aprobación + ventana de mantenimiento |
| **P2** | Exigir `BACKUP_ENCRYPTION_KEY` en producción (N-4) y mensaje genérico en 500 (N-1) | A | Aprobación |
| **P2** | DTE: confirmación en producción, folios bajos, ficha SII cuando exista | A | Aprobación |
| **P3** | CSP sin `unsafe-inline`; cifrar `data/sii-fichas` y `certificados-tgr` | A | Trabajo de frontend / migración |

---

## 9. Conclusión honesta

- **Resuelto en código y probado:** fallo seguro sin clave maestra (CR-1),
  validación local del certificado antes de emitir (R-6 parcial), y detección de
  backups ausentes/viejos/corruptos (R-2 parcial).
- **No resuelto:** copia externa, transporte de alertas, rotación real de la
  clave maestra, custodia documentada, identidad del emisor contra el SII.
- **No verificado:** nada del VPS (clave, cron, volumen, TLS, certificados
  reales). Hasta verificarlo, **no se puede afirmar** que producción esté
  protegida: sólo que el código ya no la deja insegura por omisión.
