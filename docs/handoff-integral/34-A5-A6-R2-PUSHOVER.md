# 34 — Copia externa en R2 (A5) y alertas por Pushover (A6)

**Estado: implementado SOLO en local. Nada desplegado, nada ejecutado en producción.**
No hay bucket, no hay credenciales, no hay cron nuevo, no se ha enviado ninguna notificación
real. Continúa lo entregado en `33-MATRIZ-OPERACIONAL-VPS.md` §13 (§13.5 marcaba A5 y A6
como bloqueados por insumos del propietario).

| | A5 (copia externa) | A6 (alerta) |
|---|---|---|
| Código local | `backend/core/r2-plan.js`, `scripts/respaldo-r2.js` | `backend/core/pushover.js`, `scripts/notificar-backup.js` |
| Pruebas | `test/r2-plan.test.js` (8) | `test/pushover.test.js` (13) |
| Ejecutado en producción | **no** | **no** |
| Falta para cerrar | bucket + token R2 + `rclone config` + primera copia + drill desde el remoto | app token + user key + archivo de secretos + 1 alerta recibida en el móvil |

---

## A5 — Copia externa cifrada a Cloudflare R2

### Lo que hay

`r2-plan.js` es un planificador puro: valida el destino, decide **qué** se copia, arma los
argumentos de `rclone` y estima almacenamiento y costo. No habla con la red ni lanza procesos.
`respaldo-r2.js` ejecuta ese plan, y **sin `--ejecutar` no hace nada más que imprimirlo**
(`--dry-run` es el modo por defecto).

```
node scripts/respaldo-r2.js --remoto jmv-r2 --bucket jmv-backups                 # imprime el plan
node scripts/respaldo-r2.js --remoto jmv-r2 --bucket jmv-backups --estimar      # + almacenamiento
node scripts/respaldo-r2.js --remoto jmv-r2 --bucket jmv-backups --ejecutar     # sube de verdad
```

### Decisiones que el código impone

| Regla | Por qué |
|---|---|
| Solo `*.db.enc`, `*.manifest.json`, `*.sha256` | Copiar un `.db` en claro al remoto anularía el cifrado |
| `--exclude *.db`, `*.db-wal`, `*.db-shm`, `*.env` | Explícito: ni la BD viva, ni el `.env`, ni `data/sii-fichas` |
| `copy`, **nunca** `sync` | `sync` borra en el remoto lo que falte en local: una pérdida local se propagaría esa misma noche |
| `--immutable` | Evita que una copia **sobrescriba** un objeto existente y distinto |
| `--checksum` | Compara por contenido, no por fecha |
| `archivo-heredado` en su propio prefijo `/heredado` | No se mezcla con la rotación diaria |
| Retención `delete --min-age 90d --max-delete 10` | 90 días ≈ 30 copias de margen sobre la retención local de 30; el tope evita que un `--min-age` equivocado vacíe el bucket |
| Remoto `gdrive_johan` vetado | Ese remoto lo usa el cron de `geodaniela` a las 03:00 |

**Sobre `--immutable`, sin adornos:** protege contra una sobrescritura accidental, que es el
fallo realista (un reenvío con contenido cambiado que corrompe el respaldo sin avisar). **No**
protege contra borrado ni contra escritura deliberada: quien tenga las credenciales del bucket
puede borrar con o sin esa opción. La defensa frente a borrado es otra y no la da `rclone`:
token limitado al bucket, **versionado del objeto activado en R2**, y la clave de cifrado
guardada fuera del proveedor.

`--immutable` tampoco detecta que el objeto remoto se haya corrompido: para eso está
`rclone check --one-way` del plan y el drill mensual de restauración.

### Pasos manuales (los hace el propietario; no los ejecuta este programa)

1. **Bucket.** Panel de Cloudflare → R2 → *Create bucket* → nombre `jmv-backups`
   (uno dedicado a JMV; no reutilizar buckets de `geodaniela`). Activar **Object Versioning**
   en el bucket: es la única protección real contra un borrado con credenciales válidas.
2. **Token de mínimo privilegio.** R2 → *Manage API tokens* → *Create API token* →
   permiso **Object Read & Write**, **limitado a ese bucket** (`jmv-backups`), sin acceso a
   la cuenta ni a otros buckets. Anotar: *Access Key ID*, *Secret Access Key*, y el endpoint
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
rclone lsd jmv-r2:jmv-backups      # prueba de lectura: no sube nada
```

4. **Permisos del archivo de configuración.** `rclone.conf` en `600`, propiedad del usuario
   del cron. Las credenciales no se versionan ni se pasan por parámetro.

### Estimación con tamaños reales (medidos el 2026-10-25)

| Dato | Valor |
|---|---|
| Copia diaria cifrada de hoy | 72.224.807 B (~72 MB) — creciendo con la BD |
| `.enc` en `data/backups` | 18 |
| `data/archivo-heredado` completo | 193.203.503 B |
| Total a subir en la primera corrida | 1.404.797.915 B (1,40 GB) |
| Retención remota | 90 días |
| **Almacenamiento estable estimado (90 d)** | **6,69 GB** (6,23 GiB) |
| Cuota gratuita de R2 | 10 GB-mes · 1 M operaciones clase A · 10 M clase B · egreso gratis |
| Margen hasta la cuota | ~3,3 GB |
| Tamaño diario máximo que aún cabe | **108.963.605 B** (~109 MB) |
| Operaciones estimadas | ~150 clase A y ~120 clase B al mes (dos órdenes de magnitud bajo la cuota) |

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

# 30 4 * * 0  retención remota, domingos, acotada a 10 objetos por corrida
30 4 * * 0 cd /home/johan/apps/iva-mensual && /usr/bin/node scripts/respaldo-r2.js \
  --remoto jmv-r2 --bucket jmv-backups --solo retencion-remota --ejecutar >> logs-r2.log 2>&1
```

Ambas líneas fallan con exit 2 si falta configuración, así que una errata en el nombre del
bucket se ve en el log en vez de subir a un destino equivocado.

### Drill de recuperación desde el remoto — **NO EJECUTADO**

```bash
rclone copy jmv-r2:jmv-backups/iva-mensual /tmp/drill-r2 --include "iva_mensual_2026-*.db.enc" --include "*.manifest.json"
docker cp /tmp/drill-r2/. iva-mensual:/tmp/drill-r2/
docker exec iva-mensual node scripts/restore-db.js \
  --backup /tmp/drill-r2/<stamp>.db.enc --dest /tmp/drill-r2-restore
docker exec iva-mensual rm -rf /tmp/drill-r2 /tmp/drill-r2-restore && rm -rf /tmp/drill-r2
```

Criterio: `integrity_check ok`, `foreign_key_check` sin violaciones, conteos ≥ los del último
estado conocido y claves SII que descifran. **A5 no está cerrado** hasta que este drill se
ejecute desde el remoto (no desde el disco local) y se anote la fecha.

---

## A6 — Avisos por Pushover

### Lo que hay

`pushover.js` habla con la API oficial (`POST https://api.pushover.net/1/messages.json`,
`application/x-www-form-urlencoded`) y clasifica el resultado según el contrato publicado:

| Respuesta | Interpretación | `reintentable` |
|---|---|---|
| HTTP 200 + `status: 1` | aceptado y en cola | — |
| HTTP 4xx + `errors[]` | entrada inválida (token, usuario) | **no** (repetir no arregla nada) |
| HTTP 429 | cuota mensual de la cuenta agotada | **no** |
| HTTP 5xx, timeout, error de red | problema temporal | sí (≥5 s, máx. 2 conexiones) |
| HTTP 200 sin `status: 1` | respuesta inválida | sí |

`notificar-backup.js` envuelve al verificador existente: ejecuta `evaluar()` de
`backup-vigilancia.js`, imprime el mismo resumen y **solo si hay un problema** manda el aviso.

### Regla que no se rompe

El código de salida es **siempre** el de la verificación:

| Situación | Exit |
|---|---|
| Respaldo sano | 0 (no se envía nada) |
| Respaldo con problemas, aviso entregado | 1 |
| Respaldo con problemas, aviso **fallido** | **1** (`[ALERTA] NO ENTREGADA …`) |
| Respaldo sano pero falla el canal | 0 (el canal no ensucia un respaldo sano) |
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
programa.

### Cómo cerrar A6 de verdad

1. Crear el archivo de secretos y ejecutar el paso 2 de arriba **con la carpeta real**: debe
   salir exit 0 y no enviar nada.
2. Mover un backup de prueba a una carpeta temporal y apuntar el CLI ahí: exit 1 y
   **notificación recibida en el móvil**, con el texto `SIN BACKUPS …`.
3. Anotar fecha y captura. Hasta entonces A6 está implementado, no verificado.

---

## Pruebas ejecutadas (local, sin red externa, sin credenciales)

```
node --check backend/core/pushover.js backend/core/r2-plan.js \
               scripts/notificar-backup.js scripts/respaldo-r2.js   → OK
node --test test/r2-plan.test.js test/pushover.test.js              → 21/21, 0 fallos
npm test                                                            → ver §"Resultado"
```

| # | Qué fija |
|---|---|
| A6/1 | 200 + `status:1` → aceptado con id; el resultado no contiene token ni user key |
| A6/2 | 4xx → `rechazada` con los `errors[]` de la API y `reintentable:false` |
| A6/3 | timeout → `timeout`, `reintentable:true`, el cron no se cuelga |
| A6/4 | 200 sin `status:1`, cuerpo no JSON, 5xx y 429 → nunca se declara enviado |
| A6/5 | sin credenciales no se llama a la red y el motivo no revela valores |
| A6/6 | si la API devuelve el token en un error, se redacta |
| A6/7 | mensaje y título se recortan a 1024/250 |
| A6/8 | CLI con respaldo sano → exit 0 y cero peticiones |
| A6/9 | CLI con respaldo ausente → exit 1 y alerta recibida por un servidor HTTP local |
| A6/10 | canal caído (500) → el respaldo roto **sigue** saliendo 1 |
| A6/11 | sin archivo de secretos → `[ALERTA] NO ENTREGADA (no_configurado)`, exit 1 |
| A6/12 | archivo de secretos dentro del repositorio → exit 2 |
| A6/13 | `--sin-alerta` verifica y no toca la red |
| A5/1 | destino válido; `gdrive_johan` vetado; remoto/bucket/prefijo inválidos |
| A5/2 | solo se incluye lo cifrado y nunca se emite `sync` |
| A5/3 | heredado a su propio prefijo; plan de 4 pasos; advertencia correcta sobre `--immutable` |
| A5/4 | retención con `--min-age 90d` y `--max-delete` |
| A5/5 | configuraciones incompletas rechazadas con motivos |
| A5/6 | estimación con los tamaños reales (6,69 GB, margen y umbral de 108.963.605 B) |
| A5/7 | CLI en dry-run imprime el plan y no lanza `rclone` |
| A5/8 | CLI rechaza remoto ajeno y configuración incompleta con exit 2 |

## Riesgos residuales

| # | Riesgo | Cierra cuando |
|---|---|---|
| A5-R1 | No hay copia fuera del VPS todavía | primera corrida real + `rclone check` OK |
| A5-R2 | Recuperación desde el remoto nunca probada | drill del §"drill" ejecutado y fechado |
| A5-R3 | Clave de cifrado solo en el VPS | 2 copias en custodia externa documentadas |
| A5-R4 | Bucket sin versionado = borrado con credenciales válidas es definitivo | versionado activo en R2 |
| A6-R1 | Nadie recibe avisos: `pushover.env` no existe | notificación real recibida |
| A6-R2 | El cron sigue usando el wrapper que solo escribe al log | línea del crontab reemplazada (§"Cron propuesto") |

Nada de lo anterior está aplicado. Este documento describe lo implementado en local y lo que
falta ejecutar; **A5 y A6 no están cerrados**.
