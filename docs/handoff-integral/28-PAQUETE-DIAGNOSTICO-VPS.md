# 28 · Paquete de diagnóstico de solo lectura del VPS (F7)

> **Fecha:** 2026-10-24 (rev. 2026-10-25) · **Rama:** `master` · **Commit base local:** `a6e7619`
> + correcciones del audit A5/A6 en el árbol de trabajo, **sin commitear**
> **Naturaleza:** instrucciones para un **administrador autorizado**. Nada de este
> documento se ejecutó: no hay acceso al VPS desde esta estación (sin SSH, sin
> Docker local, sin lectura del `.env` de producción).
>
> **Ningún comando de este paquete escribe, crea, borra ni reinicia nada.** Todos
> se marcaron como `RO` (read-only) después de revisar su efecto. Las operaciones
> que sí escriben están **excluidas** y se listan en §9 para que nadie las ejecute
> por error durante el diagnóstico.

---

## 1. Cómo usar este paquete

1. Ejecutar en el **VPS de producción** (`app.jmvconsultores.cl`), como el usuario
   que administra el contenedor (`johan` o `root` con `docker`).
2. Copiar la salida a la **plantilla de §8** y **redactar** cualquier dato de
   cliente (RUT, razón social) antes de compartirla.
3. **No** pegar valores de variables, tokens, claves ni certificados en el chat,
   en un correo ni en un issue. Los comandos están diseñados para imprimir sólo
   booleanos, longitudes, conteos, fechas y hashes.
4. Si un comando falla, **anotar el error tal cual** (sin pegar rutas con datos de
   clientes) y **no improvisar** un reemplazo que escriba.

**Convención de estados del informe:** `VERIFICADO` (hay salida que lo demuestra)
· `FALLIDO` (la salida demuestra el problema) · `NO VERIFICADO` (no se ejecutó o
no hay evidencia) · `NO APLICA`.

---

## 2. Bloque 0 — Identificar qué está corriendo y dónde

| # | Comando | Clase | Qué demuestra |
|---|---|---|---|
| 0.1 | `docker ps --filter name=iva-mensual --format '{{.Names}} \| {{.Image}} \| {{.Status}}'` | RO | Existe el contenedor, imagen y salud |
| 0.2 | `docker inspect -f '{{.Config.Image}} {{.Image}} {{.Created}} {{.State.Health.Status}} {{.State.StartedAt}}' iva-mensual` | RO | Imagen efectiva, arranque y health |
| 0.3 | `docker exec iva-mensual pwd` | RO | Directorio de trabajo real (usualmente `/app`) |
| 0.4 | `docker exec iva-mensual node -v` | RO | Versión de Node en producción |
| 0.5 | `docker exec iva-mensual sh -c 'ls -l /app/backend/core/backup-vigilancia.js 2>&1 \|\| true'` | RO | ¿Está desplegado el verificador F5-C? (se espera que **no**) |
| 0.6 | `cat /home/johan/deploy-state.json 2>/dev/null \|\| echo SIN_REGISTRO` | RO | Último deploy sano registrado (commit, imagen, salud) |
| 0.7 | `bash /home/johan/apps/iva-mensual/ops/estado-deploy.sh` | RO | Contrasta registro, HEAD del repo bare y contenedor; **no escribe** (sólo lee) |

**Interpretación:** si 0.6 dice `SIN_REGISTRO`, el commit desplegado **no está
identificado** por registro; se resuelve con §3 (hashes).

---

## 3. Bloque 1 — Versión real del **backend** (hash por archivo)

El frontend ya se demostró anterior a F3 (F6). Para el backend, la prueba
definitiva es comparar el **hash del archivo dentro del contenedor** con:

- el commit **`548f1d6`**, que es el realmente desplegado (verificado el 2026-10-25:
  `deploy-state.json`, HEAD del repo bare y 5/5 hashes), y
- el `HEAD` local (F0–F8 **+ A5/A6**, **no desplegado**).

> **Corrección (2026-10-25):** esta tabla comparaba antes contra `85f93e9` y
> `package.json 6165374a…`, que **no** es lo que corre en producción. `85f93e9` es
> ancestro de `548f1d6` y solo difiere en `package.json`; se conserva como referencia.
>
> **Nota (audit A5/A6, 2026-10-25):** la columna local corresponde al commit
> `a6e7619`. Las correcciones posteriores del audit tocaron `r2-plan`,
> `pushover`, `backup-restaurar`, `restore-db`, `respaldo-r2`,
> `notificar-backup` y sus pruebas — **ninguno** de los cinco archivos de esta
> tabla — así que sus hashes no cambian. Si se despliega el árbol con las
> correcciones, el commit será distinto pero estos cinco hashes seguirán siendo
> los válidos; regenerar la tabla solo si se modifican estos archivos.

```bash
docker exec iva-mensual sha256sum \
  /app/backend/index.js \
  /app/backend/core/boveda.js \
  /app/backend/core/dte-emisor.js \
  /app/backend/routes/dte.js \
  /app/package.json
```

| Archivo | Desplegado — `548f1d6` | Local — `a6e7619` (y árbol corregido) |
|---|---|---|
| `backend/index.js` | `b189c1815501a8baf2c70a93986819529553bdfa45926b970873e06d7397fb00` | `2034593f542952e3df9739267bed9e279c67b0ca05064203f4b8203f99bcec94` |
| `backend/core/boveda.js` | `ca1f43b8de900962232f58432e45075f1e9d611b5f0b01d2d5ed4ea456c9d3b7` | `51aa67422721b50fea77096a954ebe164b1f5d674eb2751cb64ee4d7fde52a0f` |
| `backend/core/dte-emisor.js` | `008290b011b6e1c95a0072615917cd46d8d5a68e58d0f386877350084535d334` | `36878fb54f61ed956af9429c45af03dc9a471a3078c5186c5966f3887ee964db` |
| `backend/routes/dte.js` | `bc9ec3357192f476ef92a859e57f8f6e64827fc6b85847c05e09e03c23b29969` | `7cd7696a2ac7fa5ce25e0fa88aa90dfcd60ac3ce412f1e4893cab6c280392877` |
| `package.json` | `6d38a0222fb39945d4dae4c5b30b9aa0e5cc953925b758d03b54e9f2562c6d87` | `151b3dccaae122a56c849086671db32e10d5c2713edc154fcea0469b8d303e3e` |

**Criterio de aceptación (versión):**
- Backend **identificado** ⇔ los 5 hashes caen en la misma columna (basta el prefijo
  de 16 hex para comparar la salida de `sha256sum`).
- Los 5 en la columna `548f1d6` → el backend es exactamente ese commit y el
  despliegue de F0–F8 es un avance de una sola dirección (con las condiciones de `33` §10).
- Si alguno cae en la columna local → **ya hay** código nuevo desplegado sin registro;
  revisar `deploy-hook.log`.
- Columnas mixtas o ninguna → `NO VERIFICADO`: no programar el despliegue hasta
  explicarlo (`git log` del repo bare y log del hook).
- Comprobación complementaria ya ejecutada (2026-10-25): **163/163** archivos
  `.js/.css/.html` del contenedor coinciden con `548f1d6`, sin faltantes ni extra →
  no hay ediciones manuales en el servidor.

> Los hashes son de **contenido**, no secretos. Están calculados sobre el
> repositorio, no sobre el VPS.

---

## 4. Bloque 2 — Clave maestra: presencia, formato y compatibilidad

### 4.1 Presencia y formato (sin imprimir el valor)

```bash
docker exec iva-mensual node -e "const v=process.env.SECRETOS_MASTER_KEY||'';console.log({definida:!!v,longitud:v.length,hex64:/^[0-9a-f]{64}$/i.test(v)})"
```

- **Clase:** RO. **Imprime:** `{ definida, longitud, hex64 }`. **No imprime** el valor.
- Alternativa sin `node`: `docker exec iva-mensual sh -c 'printf %s "$SECRETOS_MASTER_KEY" | wc -c'`
  (sólo la longitud; el valor no sale del contenedor).
- **Aceptación:** `definida: true` y (`hex64: true` **o** `longitud >= 32`).
  Cualquier otra cosa = **FALLIDO** → no desplegar F5 (el arranque abortaría).

### 4.2 Compatibilidad con las credenciales ya cifradas (sin modificarlas)

```bash
docker exec iva-mensual node -e "
const Database=require('better-sqlite3'),b=require('/app/backend/core/boveda');
const db=new Database('/app/data/iva_mensual.db',{readonly:true});
const r=db.prepare(\"SELECT clave_sii FROM empresas WHERE clave_sii LIKE 'v1:%' LIMIT 1\").get();
db.close();
if(!r){console.log({muestra:false});process.exit(0)}
try{const v=b.descifrar(r.clave_sii);console.log({muestra:true,descifra:!!v&&!String(v).startsWith('v1:')})}
catch(e){console.log({muestra:true,descifra:false})}
"
```

- **Clase:** RO (abre la BD con `readonly:true`, descifra en memoria y **no imprime
  el valor**).
- **Imprime:** `{muestra:true|false, descifra:true|false}`.
- **Aceptación:** `muestra:true` y `descifra:true` → la clave vigente **es** la que
  cifró los datos. `muestra:false` → no hay credenciales cifradas con `v1:`
  (revisar si es esperado; no equivale a «compatible»). `descifra:false` →
  **FALLIDO**: no desplegar; ver escenario B de `29`.
- **Si falla con «unable to open database file»**: el `-shm` de WAL no está
  disponible para una conexión de solo lectura. **Detenerse**: no copiar la BD ni
  abrirla en modo escritura. Reportar y pasar a `29` §B.
- Repetir el chequeo con `clientes.clave_sii` y `dte_folios.caf_xml` (mismo patrón)
  si se quiere cobertura total; una muestra por tabla basta para decidir.

### 4.3 ¿Los datos están cifrados con el fallback de desarrollo?

Sólo si 4.1 dice `definida:false` o 4.2 dice `descifra:false`. **No modifica nada**:

```bash
docker exec -e SECRETOS_MASTER_KEY= iva-mensual node -e "
const Database=require('better-sqlite3'),b=require('/app/backend/core/boveda');
const db=new Database('/app/data/iva_mensual.db',{readonly:true});
const r=db.prepare(\"SELECT clave_sii FROM empresas WHERE clave_sii LIKE 'v1:%' LIMIT 1\").get();
db.close();
if(!r){console.log({muestra:false});process.exit(0)}
try{b.descifrar(r.clave_sii);console.log({descifra_con_fallback:true})}
catch(e){console.log({descifra_con_fallback:false})}
"
```

- **Clase:** RO. Fuerza la ausencia de la variable **sólo en ese proceso** (no toca
  el `.env` ni el contenedor en ejecución).
- **Interpretación:** `true` → los datos se cifraron con el fallback público del
  código: **riesgo crítico ya materializado** (ver `29` §B). `false` → están
  cifrados con una clave que **no** es la del entorno actual ni el fallback: no se
  puede operar sin identificar esa clave.

---

## 5. Bloque 3 — `BACKUP_ENCRYPTION_KEY`

```bash
docker exec iva-mensual node -e "const v=process.env.BACKUP_ENCRYPTION_KEY||'';console.log({definida:!!v,longitud:v.length,hex64:/^[0-9a-f]{64}$/i.test(v)})"
```

- **Clase:** RO. **Aceptación:** `definida:true` (formato 64 hex recomendado).
- `definida:false` → los backups se están generando **sin cifrar** (sólo warning en
  el log). **FALLIDO** para el criterio de protección; ver `29` §C.

---

## 6. Bloque 4 — Último backup: fecha, integridad, cifrado y descifrabilidad

### 6.1 Listado y antigüedad (sin abrir los archivos)

```bash
docker exec iva-mensual sh -c 'ls -lt --time-style=long-iso /app/data/backups | head -12'
```

**Aceptación:** la copia más reciente (`iva_mensual_<stamp>.db.enc`) tiene un
`stamp` dentro del objetivo aprobado (propuesta: **≤ 26 h**; F6 no pudo
determinarlo).

### 6.2 Integridad declarada vs. real

```bash
docker exec iva-mensual sh -c 'cd /app/data/backups && for f in $(ls -t *.sha256 2>/dev/null | head -1); do echo "== $f"; sha256sum -c "$f"; done'
```

- **Clase:** RO. **Aceptación:** `OK` (el `.sha256` es compatible con `sha256sum -c`).

### 6.3 Descifrabilidad y consistencia con el manifest (en memoria, sin escribir)

```bash
docker exec iva-mensual node -e "
const fs=require('fs'),path=require('path'),c=require('/app/backend/core/backup-cifrado');
const dir='/app/data/backups';
const f=fs.readdirSync(dir).filter(x=>/\.db\.enc$/.test(x)).sort().pop();
if(!f){console.log({copia:false});process.exit(0)}
const p=path.join(dir,f), bytes=fs.readFileSync(p);
const m=JSON.parse(fs.readFileSync(p.replace(/\.db\.enc$/,'.manifest.json'),'utf8'));
const out={copia:true,cifrada:true,sha_coincide:c.sha256Buffer(bytes)===m.sha256,tamano_coincide:bytes.length===m.tamano_bytes};
try{const plano=c.descifrarBuffer(bytes,process.env.BACKUP_ENCRYPTION_KEY);out.descifra=true;out.sha_original_coincide=!m.sha256_original||c.sha256Buffer(plano)===m.sha256_original}catch(e){out.descifra=false}
console.log(out)
"
```

- **Clase:** RO (lee y descifra **en memoria**; no escribe el `.db` plano).
- **Aceptación:** `sha_coincide`, `tamano_coincide`, `descifra` y
  `sha_original_coincide` en `true`.
- **Nota:** esto demuestra que el archivo **se puede descifrar**, no que el
  contenido esté sano. La salud del contenido se demuestra con una restauración
  aislada (§9, requiere autorización porque **escribe** una copia temporal).

---

## 7. Bloque 5 — Tareas programadas, copia externa, permisos y espacio

| # | Comando | Clase | Qué demuestra |
|---|---|---|---|
| 7.1 | `crontab -l \| grep -E 'backup\|sync'` | RO | Programación efectiva del backup/sync |
| 7.2 | `systemctl list-timers --all 2>/dev/null \| grep -iE 'backup\|iva'` | RO | ¿Hay timers en vez de cron? |
| 7.3 | `tail -30 /home/johan/apps/iva-mensual/logs-backup.log` | RO | Resultado de las últimas noches (revisar fechas y errores) |
| 7.4 | `df -h /home/johan/apps/iva-mensual/data` | RO | Espacio del volumen de datos |
| 7.5 | `du -sh /home/johan/apps/iva-mensual/data/backups` | RO | Volumen ocupado por copias |
| 7.6 | `findmnt -T /home/johan/apps/iva-mensual/data` | RO | ¿Es un volumen propio, un bind mount o el disco del sistema? |
| 7.7 | `stat -c '%U:%G %a %n' /home/johan/apps/iva-mensual/data /home/johan/apps/iva-mensual/data/backups` | RO | Dueño/permisos (el incidente de octubre fue de permisos) |
| 7.8 | `docker exec iva-mensual sh -c 'id; ls -ld /app/data /app/data/backups'` | RO | UID efectivo (1000) y permisos dentro del contenedor |
| 7.9 | `stat -c '%U:%G %a %n' /home/johan/apps/iva-mensual/.env` | RO | Permisos del `.env` (**no** imprimir su contenido) |
| 7.10 | `ls -1 /mnt /media 2>/dev/null; lsblk -o NAME,SIZE,MOUNTPOINT 2>/dev/null` | RO | ¿Existe otro disco montado para copias? |
| 7.11 | `command -v rclone restic borg 2>/dev/null \|\| echo SIN_HERRAMIENTA` | RO | Herramientas de copia externa instaladas |
| 7.12 | `docker system df` | RO | Espacio de imágenes/volúmenes (no borra nada) |

**Criterio de copia independiente:** existe ⇔ hay un destino **fuera** del
volumen `./data` con al menos un `.db.enc` reciente y verificable. Si no se puede
demostrar, el estado es **NO VERIFICADO** (y `29` §C lo trata como si no existiera).

---

## 8. Bloque 6 — Certificados por empresa (sin extraer claves privadas)

El build desplegado **no** tiene el endpoint nuevo de F5. Este comando usa la
librería del SII y la bóveda del propio contenedor, descifrando el `.pfx` **en
memoria** y devolviendo sólo metadatos:

```bash
docker exec iva-mensual node -e "
const Database=require('better-sqlite3'),b=require('/app/backend/core/boveda');
const lib=require('@devlas/dte-sii');
const db=new Database('/app/data/iva_mensual.db',{readonly:true});
const filas=db.prepare('SELECT c.empresa_id,c.cert_pfx,c.cert_pass,e.rut FROM dte_config c JOIN empresas e ON e.id=c.empresa_id WHERE c.cert_pfx IS NOT NULL').all();
db.close();
const norm=r=>String(r||'').replace(/[.\s]/g,'').toUpperCase();
for(const f of filas){const o={empresa_id:f.empresa_id};try{const d=lib.loadPfxFromBuffer(Buffer.from(b.descifrar(f.cert_pfx),'base64'),b.descifrar(f.cert_pass));Object.assign(o,{legible:true,vencido:lib.isCertificateExpired(d.notAfter),dias:lib.getDaysUntilExpiry(d.notAfter),vence:new Date(d.notAfter).toISOString().slice(0,10),coincide_rut_empresa:d.rut?norm(d.rut)===norm(f.rut):null})}catch(e){o.legible=false}console.log(o)}
"
```

- **Clase:** RO. **Imprime:** `empresa_id`, `legible`, `vencido`, `dias`, `vence`,
  `coincide_rut_empresa`. **No imprime** el `.pfx`, la contraseña, la clave privada
  ni el RUT (sólo el booleano de coincidencia).
- **Aceptación por empresa:** `legible:true`, `vencido:false`, `dias > 30`,
  `coincide_rut_empresa:true`.
- `coincide_rut_empresa:null` → el certificado no declara RUT: identidad
  **NO VERIFICADA**.
- **Nota:** el RUT del emisor sí es dato de cliente, pero el comando **no lo
  imprime**; sólo compara internamente.

---

## 9. Operaciones **excluidas** del diagnóstico (escriben o modifican)

| Operación | Por qué está excluida | Cuándo sí (con autorización) |
|---|---|---|
| `scripts/backup-db.js` | Crea una copia nueva y aplica retención (borra antiguas) | `29` §C, con autorización explícita |
| `scripts/restore-db.js` | Escribe una BD restaurada y **publica** en el destino | `29` §C, en directorio temporal, nunca sobre producción. Desde el audit: rechaza un destino ocupado (exige `--sobrescribir`) y cualquier destino que coincida con `DB_PATH`; valida en un temporal con `integrity_check` + `foreign_key_check` y solo entonces hace `rename` |
| `npm run seed:v` | Reescribe `frontend/**/*.html` en el árbol | No aplica al VPS |
| `git push` / `ops/deploy.sh` | Despliega (recrea el contenedor) | `29` §A |
| `scripts/rotar-master-key.js` | Re-cifra secretos (irreversible sin clave vieja) | `29` §B, con backup y ventana |
| `docker restart` / `compose up` | Reinicia el servicio | Sólo dentro de la ventana de `29` |
| `npm ci` / `apt install` | Modifica el entorno | Fuera de alcance |

---

## 10. Plantilla de informe (completar y redactar)

```
FECHA: ____  EJECUTÓ: ____  HOST: ____

[0] Runtime
  contenedor/imagen: ____   health: ____   arranque: ____
  node: ____   pwd: ____   ¿backup-vigilancia.js presente? (sí/no): ____
  deploy-state.json: (commit / imagen / fecha): ____

[1] Versión backend (5 hashes)
  coinciden con 548f1d6: __/5   coinciden con a6e7619: __/5
  veredicto: IDENTIFICADO / DESCONOCIDO

[2] Clave maestra
  definida: ____  longitud: ____  hex64: ____
  compatibilidad con datos (muestra/descifra): ____/____
  descifra_con_fallback: ____ (sólo si aplica)

[3] BACKUP_ENCRYPTION_KEY
  definida: ____  longitud: ____  hex64: ____

[4] Último backup
  archivo (sólo stamp): ____   antigüedad (h): ____
  sha_coincide: ____  tamano_coincide: ____  descifra: ____  sha_original: ____

[5] Programación y continuidad
  línea de cron: ____   última línea del log (fecha): ____
  df data: ____   tamaño backups: ____   montaje: ____
  permisos data/backups: ____   permisos .env: ____
  copia externa demostrada: sí/no/NO VERIFICADO

[6] Certificados
  empresas con certificado: ____
  (por empresa) legible/vencido/dias/coincide_rut: ____

[7] Incidencias encontradas: ____
```

**No pegar en el chat:** valores de variables, tokens, `.pfx`, contenidos de
`.env`, RUT o razones sociales de clientes, ni extractos de la BD.

---

## 11. Criterios de aceptación consolidados (F7.2)

| Control | Evidencia mínima que lo cierra | Si falta |
|---|---|---|
| **Clave maestra presente** | `definida:true` (§4.1) | `NO VERIFICADO` / `FALLIDO` |
| **Formato válido** | `hex64:true` o `longitud>=32` | `FALLIDO` |
| **Compatibilidad demostrada** | `descifra:true` sobre una fila `v1:` real (§4.2) | `NO VERIFICADO` (no se autoriza el despliegue) |
| **Backup reciente** | stamp ≤ objetivo acordado (§6.1) | `FALLIDO` |
| **Backup íntegro** | `sha256sum -c` OK + `sha_coincide` (§6.2–6.3) | `FALLIDO` |
| **Backup descifrable** | `descifra:true` y `sha_original_coincide:true` (§6.3) | `FALLIDO` |
| **Backup recuperable** | restauración aislada con `integrity_check ok`, `foreign_key_check` sin violaciones y conteos (§9, autorizado) | `NO VERIFICADO` |
| **Recuperación documentada** | docs `24` + `26` + procedimiento firmado | Parcial hasta que exista el acta |
| **Versión backend identificada** | 5/5 hashes en la misma columna (§3) | `NO VERIFICADO` |
| **Versión frontend identificada** | 9/28 assets distintos de F3 → build anterior (ya demostrado en F6) | — |
| **Certificados vigentes y del RUT** | `legible && !vencido && coincide_rut_empresa` por empresa (§8) | Bloquear emisión de esa empresa |
| **Monitorización + alerta** | cron/timer activo (§7.1–7.2) **y** alerta recibida de prueba | `NO VERIFICADO` |

**Regla:** ningún punto se considera cumplido por inferencia. Si no hay salida
que lo demuestre, es `NO VERIFICADO`, aunque el código lo implemente.

---

## 12. Validación local de estos comandos

Los one-liners de §4, §6.3 y §8 se ejecutaron **en esta estación** contra una BD
ficticia en un directorio temporal (nunca contra producción) antes de escribirlos
aquí. Salida obtenida (datos inventados):

```
[clave]      {"definida":true,"longitud":64,"hex64":true}
[compat]     {"muestra":true,"descifra":true}
[backup-key] {"definida":true,"longitud":64,"hex64":true}
[backup]     {"sha_coincide":true,"tamano_coincide":true,"descifra":true,"sha_original_coincide":true}
[cert]       {"empresa_id":1,"legible":true,"vencido":false,"dias":44,"vence":"2026-12-08","coincide_rut_empresa":true}
```

Es decir: los comandos **funcionan, no escriben y no imprimen valores**. Esto no
sustituye la ejecución real en el VPS (sigue pendiente de autorización).
