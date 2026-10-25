# 34 — Copia externa en R2 (A5) y alertas por Pushover (A6)

**Estado: código desplegado el 2026-10-25 (ver `33` §15); A5/A6 siguen sin ejecutar en producción.**
No hay bucket, no hay credenciales, no hay cron nuevo, no se ha enviado ninguna notificación
real. Base: commit `a6e7619`; las correcciones de ambas pasadas del audit se consolidaron en el
commit de cierre y su despliegue (ver `33-MATRIZ-OPERACIONAL-VPS.md` §13.6, §13.7 y §15).

| | A5 (copia externa) | A6 (alerta) |
|---|---|---|
| Código local | `backend/core/r2-plan.js`, `scripts/respaldo-r2.js` | `backend/core/pushover.js`, `scripts/notificar-backup.js` |
| Pruebas | `test/r2-plan.test.js` (29) | `test/pushover.test.js` (20) |
| Ejecutado en producción | **no** | **no** |
| Falta para cerrar | bucket + token R2 + `rclone config` + preflight + primera copia + drill desde el remoto | app token + user key + archivo de secretos + 1 alerta recibida en el móvil |

---

## A5 — Copia externa cifrada a Cloudflare R2

### Lo que hay

`r2-plan.js` es un planificador puro: valida el destino, decide **qué** se copia, arma los
argumentos de `rclone`, estima almacenamiento/purga, audita un listado remoto y decide **qué se
purga** a partir del inventario. No habla con la red ni lanza procesos. `respaldo-r2.js` ejecuta ese plan, y **sin `--ejecutar` no hace nada más
que imprimirlo** (`--dry-run` es el modo por defecto).

```
node scripts/respaldo-r2.js --remoto jmv-r2 --bucket jmv-backups                 # imprime el plan
node scripts/respaldo-r2.js --remoto jmv-r2 --bucket jmv-backups --estimar      # + almacenamiento y purga
node scripts/respaldo-r2.js --remoto jmv-r2 --bucket jmv-backups --ejecutar     # ejecuta de verdad
```

El plan tiene **siete pasos, en este orden**:

| # | Paso | `rclone` | Qué hace |
|---|---|---|---|
| 1 | `copia-backups` | `copy` | Sube `.db.enc`, `.manifest.json` y `.sha256` (aditivo, `--immutable --checksum`) |
| 2 | `copia-heredado` | `copy` | Sube `data/archivo-heredado/` a `<prefijo>/heredado` |
| 3 | `verificacion-espejo` | `check --one-way --checksum` | Comprueba **los tres objetos** contra el remoto |
| 4 | `auditoria-remota` | `lsjson --recursive --files-only` | Lee el listado y detecta sellos incompletos/no restaurables, huérfanos y faltantes |
| 5 | `inventario-purga` | `lsjson --min-age 90d` | Lista lo que la purga borraría, sin borrar nada |
| 6 | `retencion-remota` | `delete --files-from-raw` | Borra **solo** los objetos de la lista explícita (sellos completos) |
| 7 | `verificacion-purga` | `lsjson` | Comprueba que se borró exactamente eso y que ningún sello quedó partido |

La purga va **después** de todas las comprobaciones. Si cualquier paso anterior falla, la
auditoría encuentra una copia no restaurable o el inventario no cuadra, el CLI sale **1** y
**no se borra nada** (`A5/14`, `A5/15`, `A5/21`–`A5/24`).

### Decisiones que el código impone

| Regla | Por qué |
|---|---|
| Solo `*.db.enc`, `*.manifest.json`, `*.sha256` | Copiar un `.db` en claro al remoto anularía el cifrado |
| `--exclude *.db`, `*.db-wal`, `*.db-shm`, `*.env` | Explícito: ni la BD viva, ni el `.env`, ni `data/sii-fichas` |
| `copy`, **nunca** `sync` | `sync` borra en el remoto lo que falte en local: una pérdida local se propagaría esa misma noche |
| `--immutable` | Evita que una copia **sobrescriba** un objeto existente y distinto |
| `--checksum` | Compara por contenido, no por fecha |
| `archivo-heredado` en su propio prefijo `/heredado` | No se mezcla con la rotación diaria |
| Inventario con `--include /iva_mensual_*` y purga con lista explícita | El patrón está **anclado a la raíz** y la lista solo lleva nombres de la raíz: `heredado/` queda fuera de la purga |
| Remoto `gdrive_johan` vetado | Ese remoto lo usa el cron de `geodaniela` a las 03:00 |

**Sobre `--immutable`, sin adornos:** protege contra una sobrescritura accidental, que es el
fallo realista (un reenvío con contenido cambiado que corrompe el respaldo sin avisar). **No**
protege contra borrado ni contra escritura deliberada: quien tenga las credenciales del bucket
puede borrar con o sin esa opción. La defensa frente a borrado es externa al cliente: token de
mínimo privilegio, **versionado del bucket** y la clave de cifrado fuera del proveedor.

`--immutable` tampoco detecta que el objeto remoto se haya corrompido: para eso están el paso 3
(hashes) y el drill mensual de restauración.

### La purga: inventario, lista explícita y por qué ya no se usa `--max-delete`

Cada copia son **3 objetos** (`.db.enc`, `.manifest.json`, `.sha256`). Con la corrida semanal
del cron, cada semana **maduran 21 objetos** (3 × 7) que ya superan los 90 días. El tope de
convergencia no cambió:

| Tope | Ritmo semanal | Resultado tras 52 semanas |
|---|---|---|
| 10 (valor anterior) | 21 | **no converge**: 572 pendientes acumulados |
| 21 (mínimo calculado) | 21 | converge, 0 pendientes |
| **63 (por defecto)** | 21 | converge con margen para recuperar atraso |

`construirPlan` **rechaza** un tope por debajo del mínimo (`exit 2`, mensaje `no converge`). El
mínimo se calcula con `--cada-dias` (default 7): con retención diaria bastan 3 objetos por
corrida.

Lo que cambió es **cómo se aplica el tope**. El audit del 2026-10-25 midió que
`rclone delete --max-delete N`, con más de N objetos elegibles, **borra exactamente N y no
termina**: 30 elegibles con tope 6 seguían vivos a los 240 s; 84 con tope 63 se cortaron a los
90 s. El CLI lanzaba ese proceso con `spawnSync` sin timeout, así que el cron podía quedar
bloqueado para siempre. Además, la partición del borrado llegó a dejar sellos a medias (un
`.sha256` huérfano y un `.db.enc` sin manifest): copias irrestaurables.

El flujo actual es:

1. **Inventario** (`inventario-purga`): `lsjson --min-age 90d` con el patrón anclado; solo lectura.
2. **Decisión en memoria** (`analizarPurga`): se borra únicamente un **sello completo** (sus tres
   objetos elegibles). Un sello con solo parte de sus objetos, o cualquier objeto de
   subdirectorio, **aborta la purga entera**. Si los objetos elegibles superan el tope, **no se
   borra nada** y se informa el número exacto; el operador sube `--max-borrado` de forma
   explícita. No hay truncamiento silencioso.
3. **Borrado con lista explícita**: `delete --files-from-raw <lista>` con los nombres aprobados.
   Sin `--max-delete` y sin `--include`: `--files-from-raw` es incompatible con otros filtros
   (verificado con rclone 1.74.3) y la lista *es* el alcance. El archivo de la lista vive dentro
   de `data/backups` con modo `0600` y se borra al terminar.
4. **Comprobación posterior** (`verificacion-purga`): lista el remoto otra vez y `verificarPurga`
   exige que no siga ningún objeto borrado, que no haya desaparecido nada fuera de la lista y que
   todo sello restante tenga sus tres objetos. Si no cuadra, sale **1** con `PURGA INCOHERENTE`.
   También se ejecuta cuando el `delete` falla o se agota su tiempo: un borrado a medias no puede
   quedar sin diagnóstico.

**Preflight obligatorio:** `--solo retencion-remota` **no** ejecuta el borrado solo. Arrastra
verificación de hashes, auditoría e inventario, y el CLI se niega a borrar si el inventario no
está disponible en esa misma corrida. La línea de cron de §«Cron propuesto» sigue siendo válida,
pero ahora ejecuta esos tres pasos previos.

Además, cada `--ejecutar` toma un **lock** (`<origen>/.respaldo-r2.lock`): si hay otra corrida
viva sale **1** sin tocar el remoto; un lock de un proceso muerto o de más de 12 h se retira.
Todo comando lleva timeout (copia 60 min, listados 10, purga 15): un `rclone` bloqueado se mata y
la corrida sale **1** con `se agotó el tiempo`, en vez de dejar el cron esperando.

Alcance: `PATRON_RETENCION = '/iva_mensual_*'`. rclone aplica un patrón **sin** barra a
cualquier profundidad, así que `iva_mensual_*` alcanzaba también `heredado/…` (los estados del
2–9 oct). Verificado con `rclone 1.74.3`: con `/` solo lista la raíz; sin `/` lista el
subdirectorio. La prueba `A5/8` lo fija con el binario real y se omite si `rclone` no está.

### Auditoría de restaurabilidad (paso 4)

`rclone check` compara hashes, pero por sí solo no ve que un manifiesto **no exista** en el
remoto. El paso 4 lee `rclone lsjson` (solo lectura) y agrupa por sello:

| Hallazgo | Significado |
|---|---|
| `noRestaurables` | Sello sin `.db.enc` o sin `.manifest.json` (el restore exige el manifest) |
| `incompletos` | Sello con `.enc` y manifest pero sin `.sha256` |
| `huerfanos` | Objetos sueltos sin su `.db.enc` |
| `faltantes` | `.db.enc` local que no está en el remoto |

Solo evalúa la raíz; `heredado/` se cuenta aparte y no se juzga en la rotación diaria. Cualquier
hallazgo ⇒ `exit 1` y **sin purga**.

### Restauración segura (base de los drills)

`backend/core/backup-restaurar.js` (y `scripts/restore-db.js`) ya no escriben sobre un destino
ocupado. Orden efectivo:

1. **Guardas antes de leer**: si el destino coincide con `DB_PATH` → aborta; si ya existe y no
   se pasó `--sobrescribir` → aborta; si existe y no es un archivo → aborta.
2. Manifest + SHA-256 del archivo + descifrado + SHA-256 del original (en memoria).
3. Escritura en un **temporal oculto** del mismo directorio, con modo `0600`.
4. `PRAGMA integrity_check` **y** `PRAGMA foreign_key_check`; conteos de tablas críticas; las
   claves SII `v1:` deben descifrar (si se pasa `SECRETOS_MASTER_KEY`).
5. Solo si todo pasa: `rename` atómico al nombre final. Cualquier fallo borra el temporal y deja
   el destino **intacto**; una base con FK rota o hash incorrecto **nunca** se publica.

El reporte incluye `publicado`, `integrity`, `foreignKey` y `claves`. Códigos: `0` restaurada y
publicada; `1` error o copia no válida.

**Límites de la restauración (audit 2026-10-25) — F-04/F-05 CORREGIDOS el mismo día:**
`restaurar` ya NO publica un archivo de 0 bytes (F-04: rechazo explícito «El backup está
vacío») ni una base válida a la que le falte una tabla crítica (los conteos del reporte
siguen disponibles, y `criticas.faltantes` lista lo ausente). Además la guarda de destino
ocupado ya no es check-then-act (F-05): la publicación SIN `sobrescribir` usa un **enlace
duro** que falla con EEXIST si el destino apareció entre la guarda inicial y la publicación —
el destino nunca es reemplazado sin permiso explícito (`--sobrescribir` conserva el rename
directo). Pruebas: `restaurar F-04*` y `restaurar F-05*` en `test/backup-seguro.test.js`.
La regla del drill (directorio recién creado) sigue siendo buena praxis, pero el caveat
de confianza en el código de salida queda cerrado: `exit 1` ⇔ no publicado.

### Pasos manuales (los hace el propietario; no los ejecuta este programa)

1. **Bucket.** Panel de Cloudflare → R2 → *Create bucket* → nombre `jmv-backups`
   (uno dedicado a JMV; no reutilizar buckets de `geodaniela`). Activar **Object Versioning**
   en el bucket: es la única protección real contra un borrado con credenciales válidas.
2. **Token de mínimo privilegio.** R2 → *Manage API tokens* → *Create API token* → permiso
   **Object Read & Write**, **limitado a ese bucket** (`jmv-backups`), sin acceso a la cuenta ni
   a otros buckets. Anotar: *Access Key ID*, *Secret Access Key*, y el endpoint
   `https://<account-id>.r2.cloudflarestorage.com`.
3. **Remoto de rclone dedicado** (en el VPS, con el usuario `johan`):

```bash
# NO EJECUTADO — requiere las credenciales del paso 2
rclone config create jmv-r2 s3 \
  provider=Cloudflare \
  access_key_id="$R2_ACCESS_KEY_ID" \
  secret_access_key="$R2_SECRET_ACCESS_KEY" \
  endpoint="https://<ACCOUNT_ID>.r2.cloudflarestorage.com" \
  acl=private \
  no_check_bucket=true
chmod 600 ~/.config/rclone/rclone.conf
```

4. **Preflight obligatorio antes de cualquier operación remota destructiva.** Ningún comando de
   este programa puede comprobar el alcance de un token; esto es manual y va antes del primer
   `--ejecutar`:

```bash
rclone lsd jmv-r2:                                    # el remoto existe
rclone lsf jmv-r2:jmv-backups --max-depth 1 | head    # lectura del bucket correcto
rclone lsf jmv-r2:otro-bucket 2>&1 | head -2          # DEBE fallar: token sin acceso a otros buckets
stat -c '%U:%G %a %n' ~/.config/rclone/rclone.conf    # esperado 600 del usuario del cron
```

5. **Versiones antiguas (obligatorio si se activa versionado).** R2 cobra también las versiones
   no vigentes: sin una regla de ciclo de vida, los objetos borrados por la purga **no liberan
   espacio** y el almacenamiento crece de forma acumulativa (~26 GB/año con el tamaño actual),
   no 6,69 GB. Crear en el bucket una regla de ciclo de vida que expire las versiones no
   vigentes a los ~30 días, y verificar el consumo real en el panel antes de dar por buena la
   estimación.

### Estimación con tamaños reales (medidos el 2026-10-25)

| Dato | Valor |
|---|---|
| Copia diaria cifrada de hoy | 72.224.807 B (~72 MB) — creciendo con la BD |
| `.enc` en `data/backups` | 18 |
| `data/archivo-heredado` completo | 193.203.503 B |
| Total a subir en la primera corrida | 1.404.797.915 B (1,40 GB) |
| Retención remota | 90 días |
| **Almacenamiento estable estimado (90 d)** | **6,69 GB** (6,23 GiB) — **solo con ciclo de vida de versiones** |
| Cuota gratuita de R2 | 10 GB-mes · 1 M operaciones clase A · 10 M clase B · egreso gratis |
| Margen hasta la cuota | ~3,3 GB |
| Tamaño diario máximo que aún cabe | **108.963.605 B** (~109 MB) |
| Operaciones estimadas | ~150 clase A y ~120 clase B al mes (dos órdenes de magnitud bajo la cuota) |
| Purga por corrida | 21 objetos/semana maduran; tope por defecto 63 |

**Costo:** por debajo de 10 GB, **0 USD**. Si la BD sigue creciendo y el diario pasa de
~109 MB, 90 días superan la cuota: 110 MB/día ⇒ 10,09 GB ⇒ **0,001 USD/mes**; incluso con
160 MB/día el exceso serían ~0,07 USD/mes. El límite realista **no es el dinero** (centavos),
sino la higiene: si el diario se acerca a los 110 MB, la respuesta sensata es bajar la
retención remota a **60 días** (4,4 GB con el tamaño actual) antes que pagar por acumular
copias que nadie va a restaurar.

La clave `BACKUP_ENCRYPTION_KEY` **no viaja nunca** al remoto: sin ella el bucket no se puede
descifrar, así que una copia de esa clave debe vivir fuera de Cloudflare (gestor de
contraseñas + sobre sellado, custodios distintos). Bucket y clave en el mismo proveedor =
cifrado decorativo.

### Cron propuesto — **NO EJECUTADO**

```bash
# 20 3 * * *  copia tras el backup (03:00) y la verificación (03:15)
20 3 * * * cd /home/johan/apps/iva-mensual && /usr/bin/node scripts/respaldo-r2.js \
  --remoto jmv-r2 --bucket jmv-backups --ejecutar >> logs-r2.log 2>&1

# 30 4 * * 0  retención remota, domingos: preflight + inventario, tope 63 objetos
30 4 * * 0 cd /home/johan/apps/iva-mensual && /usr/bin/node scripts/respaldo-r2.js \
  --remoto jmv-r2 --bucket jmv-backups --solo retencion-remota --cada-dias 7 --ejecutar >> logs-r2.log 2>&1
```

Si se cambia la cadencia, hay que cambiar `--cada-dias`: el tope mínimo que converge se calcula
con ese valor. Ambas líneas fallan con `exit 2` si falta configuración o si el tope no converge,
así que una errata se ve en el log en vez de subir/borrar en el destino equivocado.

La segunda línea ya no borra a ciegas: `--solo retencion-remota` ejecuta verificación, auditoría
e inventario antes de purgar. Si el inventario supera el tope, la corrida sale **1** con
`[R2] PURGA BLOQUEADA — …` y **no borra nada**; si el remoto queda incoherente después de
borrar, sale **1** con `PURGA INCOHERENTE`. Un 1 significa «revisar», no «subir el tope a ver
qué pasa»: primero hay que explicar por qué se acumuló el atraso.

### Drill de recuperación desde el remoto — **NO EJECUTADO**

```bash
rclone copy jmv-r2:jmv-backups/iva-mensual /tmp/drill-r2 \
  --include "iva_mensual_2026-*.db.enc" --include "*.manifest.json" --include "*.sha256"
docker cp /tmp/drill-r2/. iva-mensual:/tmp/drill-r2/
docker exec iva-mensual node scripts/restore-db.js \
  --backup /tmp/drill-r2/<stamp>.db.enc --dest /tmp/drill-r2-restore
docker exec iva-mensual rm -rf /tmp/drill-r2 /tmp/drill-r2-restore && rm -rf /tmp/drill-r2
```

Criterio: `integrity_check ok`, **`foreign_key_check` sin violaciones**, `publicado: sí`,
conteos ≥ los del último estado conocido y claves SII que descifran. Los conteos las
reporta el CLI; desde 2026-10-25 (F-04) el restore **exige que TODAS las tablas críticas
existan** — una base sin tablas críticas ya no se publica (`ok:false`, exit 1), así que el
código de salida vuelve a ser fiable para el drill.
El destino debe estar vacío: si existe, el restore se niega (no hace falta `--sobrescribir` en un
drill). **A5 no está cerrado** hasta que este drill se ejecute desde el remoto (no desde el disco
local), con la fecha anotada.

### Límites conocidos de A5

- `rclone check` compara el hash del metadato del objeto. En S3/R2 el ETag es MD5 solo para
  objetos subidos en una parte; por encima del corte multiparte (200 MiB por defecto) la
  comparación deja de ser por contenido. Con copias de ~72 MB no aplica, pero crecerá.
- La auditoría trabaja sobre **nombres**: detecta sellos incompletos y faltantes, no descarga
  contenido. Un objeto remoto corrupto solo se detecta con el `check` de hashes y el drill.
- `--min-age` usa la fecha de modificación del objeto remoto, que para lo subido por rclone es
  la fecha de subida.
- Nada de esto crea el bucket, el token ni el remoto: son pasos manuales del propietario.

---

## A6 — Avisos por Pushover

### Lo que hay

`pushover.js` habla con la API oficial (`POST https://api.pushover.net/1/messages.json`,
`application/x-www-form-urlencoded`) y clasifica el resultado según el contrato publicado:

| Respuesta | Interpretación | `reintentable` |
|---|---|---|
| HTTP 200 + `status: 1` | aceptado y en cola | — |
| HTTP 4xx + `errors[]` | entrada inválida (token, usuario, parámetros) | **no** (repetir no arregla nada) |
| HTTP 429 | cuota mensual de la cuenta agotada | **no** |
| HTTP 5xx, timeout, error de red | problema temporal | sí (≥5 s, máx. 2 conexiones) |
| HTTP 200 sin `status: 1` | respuesta inválida | sí |

`notificar-backup.js` envuelve al verificador existente: ejecuta `evaluar()` de
`backup-vigilancia.js`, imprime el mismo resumen y **solo si hay un problema** manda el aviso
(`--avisar-ok` añade el parte diario correcto).

### Prioridad 2 (emergencia): `retry` y `expire`

Pushover **exige** `retry` (≥ 30 s, mínimo 30) y `expire` (≤ 10.800 s, y ≥ `retry`) cuando
`priority=2`. Sin ellos la API devuelve 400 y la alerta de emergencia se pierde. Implementado:

| Situación | Comportamiento |
|---|---|
| `prioridad: 2` sin parámetros | se envían `retry=60` y `expire=3600` |
| `retry < 30`, no entero, `expire > 10800` o `expire < retry` | `entrada_invalida`, `reintentable:false`, **sin tocar la red** |
| prioridad ≠ 2 | `retry`/`expire` se ignoran (no se envían) |
| CLI `--retry`/`--expire` fuera de contrato | `exit 2` antes de leer secretos |

### Regla que no se rompe

El código de salida es **siempre** el de la verificación:

| Situación | Exit |
|---|---|
| Respaldo sano | 0 (no se envía nada) |
| Respaldo sano + `--avisar-ok` | 0 (se envía el parte) |
| Respaldo con problemas, aviso entregado | 1 |
| Respaldo con problemas, aviso **fallido** | **1** (`[ALERTA] NO ENTREGADA …`) |
| Respaldo sano pero falla el canal (con `--avisar-ok`) | 0 |
| Error de uso o de configuración del comando | 2 |

Es decir: un Pushover caído no puede maquillar un backup roto ni convertir un backup sano en
un fallo. Probado en `A6/10`.

### Secretos

Archivo **fuera del repositorio**, jamás versionado:

```bash
# /home/johan/ops-verificacion/pushover.env   (chmod 600, dueño del cron)
PUSHOVER_APP_TOKEN=<30 caracteres del panel de Pushover>
PUSHOVER_USER_KEY=<30 caracteres de tu perfil>
```

- El CLI se niega a arrancar (exit 2) si la ruta cae **dentro** del repositorio: así un
  `pushover.env` real no puede acabar en un commit por descuido.
- El archivo se lee con un parser `CLAVE=valor` mínimo: sin `source`, sin expansión, sin
  `dotenv` y sin dependencias nuevas.
- Ni el token ni la user key se imprimen o registran: todo texto que sale del módulo pasa por
  un redactor que los sustituye por `[REDACTADO]`, incluso si el servidor los devuelve dentro
  de un `errors[]` (probado en `A6/6`).
- El parámetro es `--secretos`, **no** `--env-file`: Node 24 intercepta `--env-file` como
  opción propia aunque vaya después del script y mata el proceso con exit 9. Se descubrió en
  las pruebas.

### Pasos manuales

1. Crear cuenta en Pushover y **comprar la licencia** de la plataforma que se use (pago único
   por plataforma; sin ella la app de escritorio/móvil no recibe mensajes).
2. *Register an Application* → nombre `JMV Backups` → copiar el **API token**.
3. Copiar la **user key** del perfil.
4. Crear `/home/johan/ops-verificacion/pushover.env` con las dos variables y `chmod 600`.
5. Probar un envío real (esto es lo único que cierra A6).

Cuota: 10.000 mensajes/mes por **cuenta** (todas las apps comparten el cupo). Un aviso diario
de fallo está tres órdenes de magnitud por debajo.

### Cron propuesto — **NO EJECUTADO**

Sustituye al wrapper `verificar-cron.sh` instalado en §13.3 (que solo escribía al log porque
no había canal). Primero copiar los archivos, luego cambiar la línea:

```bash
# 1) copiar el notificador y sus módulos junto a los del verificador (fuera del checkout)
mkdir -p /home/johan/ops-verificacion/{scripts,backend/core}
cp scripts/notificar-backup.js             /home/johan/ops-verificacion/scripts/
cp backend/core/pushover.js                /home/johan/ops-verificacion/backend/core/
chmod 750 /home/johan/ops-verificacion/scripts/notificar-backup.js
chmod 640 /home/johan/ops-verificacion/backend/core/pushover.js

# 2) prueba en seco (solo lectura de la carpeta de backups)
/usr/bin/node /home/johan/ops-verificacion/scripts/notificar-backup.js \
  --dir /home/johan/apps/iva-mensual/data/backups \
  --secretos /home/johan/ops-verificacion/pushover.env --json

# 3) crontab: reemplazar la línea de verificar-cron.sh de §13.3 por
15 3 * * * /usr/bin/node /home/johan/ops-verificacion/scripts/notificar-backup.js \
  --dir /home/johan/apps/iva-mensual/data/backups \
  --secretos /home/johan/ops-verificacion/pushover.env \
  >> /home/johan/apps/iva-mensual/logs-backup.log 2>&1
```

`--avisar-ok` envía también el parte diario correcto (heartbeat). Sirve para detectar que el
propio cron murió, pero suma 30 mensajes/mes de ruido: decisión del propietario, no del
programa. Para una alerta de emergencia: `--prioridad 2 --retry 60 --expire 3600`.

### Cómo cerrar A6 de verdad

1. Crear el archivo de secretos y ejecutar el paso 2 de arriba **con la carpeta real**: debe
   salir exit 0 y no enviar nada.
2. Mover un backup de prueba a una carpeta temporal y apuntar el CLI ahí: exit 1 y
   **notificación recibida en el móvil**, con el texto `SIN BACKUPS …`.
3. Repetir con `--prioridad 2 --retry 30 --expire 600` para comprobar que la emergencia no
   devuelve 400 y llega como tal.
4. Anotar fecha y captura. Hasta entonces A6 está implementado, no verificado.

---

## Pruebas ejecutadas (local, sin red externa, sin credenciales)

```
node --check backend/core/r2-plan.js scripts/respaldo-r2.js \
             backend/core/pushover.js scripts/notificar-backup.js \
             backend/core/backup-restaurar.js scripts/restore-db.js   → OK
node --test test/r2-plan.test.js test/pushover.test.js                → 49/49, 0 fallos
node --test test/backup-seguro.test.js                               → 11/11, 0 fallos
npm test                                                             → 756/756, 0 fallos (~94 s)
```

### A5 — `test/r2-plan.test.js` (29)

| # | Qué fija |
|---|---|
| A5/1 | Destino válido; `gdrive_johan` vetado; remoto/bucket/prefijo inválidos |
| A5/2 | Solo se incluye lo cifrado y nunca se emite `sync` |
| A5/3 | Heredado a su prefijo; plan de 7 pasos; verificación con los 3 objetos; auditoría e inventario con `lsjson` capturado |
| A5/4 | Purga con lista explícita, sin `--max-delete` ni `--include`, patrón raíz y tope convergente |
| A5/5 | Tope que no converge rechazado; configuraciones incompletas y `--solo` inválido |
| A5/6 | `estimarPurga`: 0 pendientes con 63, 572 con 10, cadencia diaria |
| A5/7 | Simulación de 399 días: converge y nunca purga copias con menos de 90 días |
| A5/8 | `rclone` real: el patrón anclado no alcanza `heredado/` (se omite sin binario) |
| A5/9 | Auditoría: sello completo, sin manifiesto, huérfano, incompleto, heredado, faltante y JSON inválido |
| A5/10 | Estimación de almacenamiento con los tamaños reales (6,69 GB, umbral 108.963.605 B) |
| A5/11 | CLI dry-run imprime los 7 pasos, el inventario con `--min-age` y la lista de purga; no ejecuta nada |
| A5/12 | CLI `exit 2` para remoto ajeno, bucket ausente, retención corta y tope que no converge |
| A5/13 | `--ejecutar` corre los pasos en orden, borra con lista explícita y verifica el remoto después |
| A5/14 | Fallo en cada paso (incluido el inventario) ⇒ `exit 1` y **sin purga** |
| A5/15 | Remoto con copia no restaurable ⇒ `exit 1` y sin purga |
| A5/16 | Binario inexistente ⇒ `exit 1` con mensaje |
| A5/17 | `--estimar` imprime almacenamiento y purga; sin copias locales ⇒ `exit 2` |
| A5/18 | `--solo retencion-remota` ejecuta el preflight completo (check, auditoría, inventario) y luego purga |
| A5/19 | Fallo de la purga → `exit 1` tras el preflight y revisión del estado posterior (detecta el sello partido de un borrado a medias) |
| A5/20 | `rclone` real: manifiesto ausente y hash alterado (mismo tamaño) hacen fallar la verificación |
| A5/21 | Purga solo por sellos completos: 30 elegibles/tope 6 y 84/63 se rechazan; media copia y subdirectorios abortan; nombres ajenos se ignoran |
| A5/22 | `verificarPurga`: detecta objetos que siguen, desaparecidos fuera de la lista y sellos partidos |
| A5/23 | CLI 30 elegibles con tope 6 ⇒ `exit 1` y **cero** `delete` (caso medido del audit) |
| A5/24 | CLI 84 elegibles con tope 63 ⇒ `exit 1` y **cero** `delete` |
| A5/25 | Sin elegibles no hay `delete` y la corrida sale 0 |
| A5/26 | `ETIMEDOUT` en preflight o en purga ⇒ `exit 1`; tras el timeout de purga se lista el estado y no se reintenta el borrado |
| A5/27 | Purga que deja un sello partido ⇒ `exit 1` con `PURGA INCOHERENTE` |
| A5/28 | Lock: corrida viva bloquea sin lanzar `rclone`; lock residual (pid muerto, +12 h) se retira y se libera al terminar |
| A5/29 | `--solo retencion-remota` en dry-run muestra el preflight completo, sin la copia |

Los tests de ejecución inyectan un `child_process.spawnSync` simulado con `--require`: no
necesitan `rclone`, ni credenciales, ni red.

### A6 — `test/pushover.test.js` (20)

| # | Qué fija |
|---|---|
| A6/1 | 200 + `status:1` → aceptado con id; el resultado no contiene token ni user key |
| A6/2 | 4xx → `rechazada` con los `errors[]` de la API y `reintentable:false` |
| A6/3 | timeout → `timeout`, `reintentable:true` |
| A6/4 | 200 sin `status:1`, cuerpo no JSON, 5xx y 429 → nunca se declara enviado |
| A6/5 | Sin credenciales no se llama a la red y el motivo no revela valores |
| A6/6 | Si la API devuelve el token en un error, se redacta |
| A6/7 | Mensaje y título se recortan a 1024/250 |
| A6/8 | CLI con respaldo sano → exit 0 y cero peticiones |
| A6/9 | CLI con respaldo ausente → exit 1 y alerta recibida por un servidor HTTP local |
| A6/10 | Canal caído (500) → el respaldo roto **sigue** saliendo 1 |
| A6/11 | Sin archivo de secretos → `[ALERTA] NO ENTREGADA (no_configurado)`, exit 1 |
| A6/12 | Archivo de secretos dentro del repositorio → exit 2 |
| A6/13 | `--sin-alerta` verifica y no toca la red |
| A6/14 | Prioridad 2 envía `retry=60` y `expire=3600` por defecto |
| A6/15 | Prioridad 2 valida `retry`/`expire` antes de la red (bordes 30 y 10800 incluidos) |
| A6/16 | Prioridad 1 no envía `retry`/`expire` |
| A6/17 | 400 de Pushover por prioridad 2 → rechazo definitivo |
| A6/18 | CLI `--avisar-ok` con respaldo sano → 1 mensaje y exit 0 |
| A6/19 | CLI `--prioridad 2 --retry --expire` llega al canal con el contrato completo |
| A6/20 | CLI con `retry`/`expire` fuera de contrato → exit 2 sin red |

### Restauración — `test/backup-seguro.test.js` (11)

| # | Qué fija |
|---|---|
| R/1–3 | Cifrado: round-trip, clave incorrecta, sha256 estable |
| R/4 | Restore completo verificado (integridad, tablas, claves v1) sobre copia aislada |
| R/5 | Hash manipulado, clave incorrecta y falta de clave → rechazo explícito |
| R/6 | Destino ocupado se rechaza y el archivo queda **intacto** |
| R/7 | `sobrescribir` explícito reemplaza y publica con `foreignKey.ok` |
| R/8 | Nunca escribe sobre `DB_PATH`, ni con `sobrescribir` |
| R/9 | FK rota → `integrity ok` pero **no se publica** y no quedan temporales |
| R/10 | Corrupción (no es SQLite) y hash manipulado dejan el destino intacto |
| R/11 | CLI: destino ocupado → exit 1; con `--sobrescribir` → exit 0 y publica |

---

## Riesgos residuales

| # | Riesgo | Cierra cuando |
|---|---|---|
| A5-R1 | No hay copia fuera del VPS todavía | primera corrida real + `rclone check` OK |
| A5-R2 | Recuperación desde el remoto nunca probada | drill ejecutado, fechado y con `foreign_key_check` |
| A5-R3 | Clave de cifrado solo en el VPS | 2 copias en custodia externa documentadas |
| A5-R4 | Bucket sin versionado = borrado con credenciales válidas es definitivo | versionado activo en R2 |
| A5-R5 | Versionado sin ciclo de vida = almacenamiento acumulativo y estimación falsa | regla de expiración de versiones no vigentes |
| A5-R6 | Alcance del token no verificable por el programa | preflight manual ejecutado y anotado |
| A5-R7 | `--cada-dias` es una **declaración**: si el cron corre con menos frecuencia de la declarada, el mínimo calculado puede no converger; y si el atraso supera el tope, la purga se bloquea a propósito y exige intervención | primer ciclo real con el cron definitivo, sin `PURGA BLOQUEADA` ni `PURGA INCOHERENTE` en el log |
| A6-R1 | Nadie recibe avisos: `pushover.env` no existe | notificación real recibida |
| A6-R2 | El cron sigue usando el wrapper que solo escribe al log | línea del crontab reemplazada |
| A6-R3 | Si Pushover falla y el backup también, el aviso solo queda en el log | monitor externo que vigile `exit 1` del cron |

Nada de lo anterior está aplicado. Este documento describe lo implementado en local y lo que
falta ejecutar; **A5 y A6 no están cerrados**.
