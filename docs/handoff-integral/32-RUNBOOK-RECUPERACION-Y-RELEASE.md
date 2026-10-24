# 32 · Runbook de recuperación y release (F8)

> **Uso:** este documento se ejecuta, no se lee. Cada paso tiene comando, salida esperada y
> criterio de aborto. La **autorización** de cada bloque está en `33` §7; el diagnóstico previo,
> en `28`; el plan de escenarios y riesgos, en `29` y `31`.
>
> **Regla de oro:** ninguna copia se declara buena por existir. La única prueba es la
> **restauración aislada con la aplicación abriendo la copia**.

---

## 1. Supuestos y alcance

- Host del VPS con Docker Compose, contenedor `iva-mensual`, volumen `./data`.
- Claves (`SECRETOS_MASTER_KEY`, `BACKUP_ENCRYPTION_KEY`) **nunca** se pegan en el chat ni en
  documentos: se leen del gestor de secretos o del entorno del operador.
- La app corre como uid 1000 y escribe `./data` (si no puede, el cron de backup falla en
  silencio — causa del incidente de 7 noches sin copia).
- Nada de este runbook se ejecutó en F8: producción no fue tocada.

---

## 2. Identificación del release (antes y después)

Un release se identifica con **cuatro** datos; con menos, un rollback apunta a ciegas.

| Dato | Cómo se obtiene | Valor esperado |
|---|---|---|
| Commit del árbol desplegado | `git -C /home/johan/repos/iva-mensual.git rev-parse --short master` + hashes de archivos del contenedor (`28` §3) | 5/5 archivos coinciden con el commit |
| Imagen | `docker inspect -f '{{.Image}}' iva-mensual` | `sha256:…` distinta de la anterior |
| Registro del deploy | `cat /home/johan/deploy-state.json` | `commit`, `imagen`, `salud:"healthy"`, `escritura_ok:true` |
| Backend en caliente | `curl -s http://127.0.0.1:3500/api/health` (o por el dominio) | Con F8 desplegado: `{"ok":true,"db":"ok","version":"1.0.0"}` |
| Frontend | `curl -s https://<dominio>/sistema/ \| grep -oE '(app\|sistema)\.(js\|css)\?v=[0-9a-f]{8}'` | idéntico a los hashes del build local |

**Estado actual (2026-10-24):** producción responde `{"ok":true,"message":"IVA Mensual API running"}`
y sirve `app.js?v=bdf0e607` / `sistema.css?v=5738e017`, mientras el build local produce
`app.js?v=c1d44190` / `sistema.css?v=7bae9444`. **Son builds distintos**: el release pendiente
no está desplegado y el commit del backend sigue sin identificar (`33` §2).

---

## 3. Precondiciones del release (todas o no se ejecuta)

| # | Precondición | Evidencia que la cierra |
|---|---|---|
| P1 | Clave maestra presente, válida y **compatible** | `33` §4 → `definida:true`, `descifra:true`, 0 filas con fallback |
| P2 | Backup reciente, íntegro y descifrable | `33` §3 → `[BACKUP-CHECK] OK`, `sha256sum -c` OK |
| P3 | Restauración aislada demostrada **de ese backup** | §4 de este runbook → `integridad: ok` + app abre la copia |
| P4 | Certificados de las empresas emisoras vigentes o bloqueo documentado | `33` §5 |
| P5 | Ventana aprobada y responsable disponible | Acta con fecha y hora |
| P6 | `rollback-target.txt` anotado **antes** del push | `cat /home/johan/rollback-target.txt` |
| P7 | Espacio en disco suficiente para imagen + backup | `33` §6 → `df -h` con margen |
| P8 | Suite local en verde en el commit a desplegar | `npm test` → **701/701** (hoy) |

Si P1–P8 no están cerradas, el release **no se ejecuta**. Reiniciar «para ver qué pasa» con una
clave dudosa es la forma más rápida de perder acceso a las credenciales cifradas.

---

## 4. Recuperación operativa (drill o incidente real)

### 4.1 Reglas

1. La restauración de prueba **nunca** apunta a `data/`.
2. El destino es un directorio temporal del host (`/tmp/restore-<fecha>`).
3. Si la verificación final falla, la copia **se descarta**: no se promueve.
4. Nunca se restaura sobre datos posteriores al backup (se perderían operaciones): primero se
   decide si el incidente es de código o de datos (§7).

### 4.2 Procedimiento

```bash
# 0) Copia de trabajo y su manifest, en un directorio aislado
TMP=/tmp/restore-$(date +%Y%m%d-%H%M)
mkdir -p "$TMP"
cp data/backups/iva_mensual_<stamp>.db.enc "$TMP"/
cp data/backups/iva_mensual_<stamp>.manifest.json "$TMP"/

# 1) Integridad del archivo, independiente de la aplicación
cd "$TMP" && sha256sum -c iva_mensual_<stamp>.sha256

# 2) Restauración + verificación (las claves vienen del gestor, NO de este documento)
BACKUP_ENCRYPTION_KEY=... SECRETOS_MASTER_KEY=... \
  node scripts/restore-db.js --backup "$TMP"/iva_mensual_<stamp>.db.enc --dest "$TMP"/db
```

### 4.3 Salida esperada (formato real, medido en local el 2026-10-24)

```
[RESTORE] OK
[RESTORE] destino aislado: …/iva_mensual_restaurada.db
[RESTORE] integridad SQLite: ok
[RESTORE] tablas críticas: {"users":5,"empresas":2,"auditoria":44,"asientos":6,"asiento_lineas":14,"documentos":12,"periodos_contables":3,"bancos_cuentas":2,"suscripciones":2}
[RESTORE] claves SII: {"clientes_v1":0,"empresas_v1":1,"descifrables":1,"error":null}
```

Criterios de aceptación: `[RESTORE] OK` · `integridad SQLite: ok` · 10 tablas presentes ·
`descifrables` = `clientes_v1 + empresas_v1` · `error: null`.

### 4.4 Verificación funcional de la copia (sin tocar producción)

```bash
DB_PATH="$TMP"/db/iva_mensual_restaurada.db PORT=3598 SECRETOS_MASTER_KEY=... \
  node backend/index.js
# en otra terminal:
curl -s http://127.0.0.1:3598/api/health              # {"ok":true,"db":"ok",…}
curl -s -H 'content-type: application/json' \
  -d '{"username":"<usuario>","password":"<clave>"}' http://127.0.0.1:3598/api/auth/login
curl -s -b <cookie> http://127.0.0.1:3598/api/auth/me  # user + acceso_contable.empresas[]
```

Al terminar, **detener el proceso** y confirmar que el puerto quedó cerrado.

### 4.5 Diagnóstico de claves (hallazgo F8-5)

`restore-db.js` carga `.env` del directorio de trabajo. Si se ejecuta dentro del proyecto,
**usa la clave del `.env`** aunque el operador crea que no hay ninguna, y el error será
«No se pudo descifrar» en vez de «BACKUP_ENCRYPTION_KEY no fue provista».

- Síntoma de **clave ausente**: el mensaje dice «no fue provista» (ocurre solo si se ejecuta
  fuera del proyecto o sin `.env`).
- Síntoma de **clave distinta**: «No se pudo descifrar el backup».
- Verificación sin imprimir el valor: comparar la **longitud** y los **primeros 4** caracteres
  del sha256 de la variable entre `.env` y el gestor.

---

## 5. Release: ventana, orden y criterios

| Paso | Acción | Verificación inmediata |
|---|---|---|
| R1 | Re-ejecutar `33` §2–§4 y confirmar P1–P3 | Salidas registradas |
| R2 | Backup manual + `sha256sum -c` + drill §4 | `[BACKUP-CHECK] OK` y restore OK |
| R3 | Anotar `rollback-target.txt` y `deploy-state.json` actuales | commit anterior registrado |
| R4 | `git push origin master` (hook reconstruye) o `DEPLOY_COMMIT=<sha> bash ops/deploy.sh` | `deploy-hook.log` / `deploy-build.log` |
| R5 | `bash ops/estado-deploy.sh` | `ESTADO: OK` |
| R6 | `curl -s https://<dominio>/api/health` | `{"ok":true,"db":"ok","version":"1.0.0"}` |
| R7 | Cabeceras: buscar `x-powered-by` | **ausente** |
| R8 | `curl -s https://<dominio>/sistema/ \| grep -o 'app\.js?v=[0-9a-f]\{8\}'` | = hash del build |
| R9 | Login real + recorrido de 5 pantallas | sin errores de consola |
| R10 | `docker exec iva-mensual node scripts/verificar-backup.js` | `[BACKUP-CHECK] OK` |
| R11 | `GET /api/dte/empresas/<id>/config` (autenticado) | campo `certificado` con estado |
| R12 | Programar `verificar-backup.js` + alerta y **probarla** | la alerta llega |

**Ventana:** día hábil fuera de 08:00–10:00 y 18:00–20:00; evitar día 1, 20 y 25–28 (F29/F22) y
cierres de mes. Duración estimada 30–45 min (build con `better-sqlite3` puede tardar más: en
`CURRENT_STATE.md` hay builds de 6–21 min por capas y chromium).

---

## 6. Ensayo de migraciones sobre una copia real (obligatorio antes del release)

1. Restaurar el backup real en aislado (§4) — **autorización requerida** (copia de datos reales).
2. Arrancar el build nuevo contra esa copia: `DB_PATH=<copia> PORT=3599 NODE_ENV=development node backend/index.js`.
3. Verificar: `integrity_check ok`, tablas nuevas presentes, `/api/health` 200, login, una consulta
   de documentos y una de asientos de un período cerrado.
4. Comparar conteos antes/después (`users`, `empresas`, `documentos`, `asientos`, `asiento_lineas`).
5. Si algo falla: **no se despliega**. La copia se descarta.

Las migraciones del proyecto son aditivas (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN`), pero eso
se demuestra sobre la copia, no se asume.

---

## 7. Rollback

### 7.1 Decidir qué se rompió

| Síntoma | Naturaleza | Acción |
|---|---|---|
| El contenedor no arranca / `FATAL` de clave | Configuración | **No** restaurar datos: corregir `.env` o volver al commit anterior |
| 500 en cadena, health 503 con base legible | Código | Rollback de código (§7.2) |
| Datos alterados o migración destructiva | Datos | §7.3 — con copia y ventana, nunca a ciegas |
| Solo la UI se ve mal | Frontend | Rollback de código; `?v=` cambia con el contenido |

### 7.2 Rollback de código

```bash
cat /home/johan/rollback-target.txt          # commit que estaba corriendo
GIT_DIR=/home/johan/repos/iva-mensual.git GIT_WORK_TREE=/home/johan/apps/iva-mensual \
  git checkout -f <commit>
DEPLOY_COMMIT=<commit> DEPLOY_ORIGEN=rollback bash ops/deploy.sh
bash ops/estado-deploy.sh                     # ESTADO: OK
```

Un `git checkout -f` **descarta** cambios manuales en el servidor: antes de ejecutarlo hay que
saber si existen (`28` §3 / `29` §D.2).

### 7.3 Rollback de datos (solo si hubo daño de datos)

Punto de no retorno: **restaurar el backup descarta toda operación posterior a su fecha**. Antes
de hacerlo: (a) exportar del sistema actual los documentos/asientos posteriores, (b) detener el
servicio, (c) restaurar a un directorio temporal y verificar, (d) recién entonces reemplazar
`data/iva_mensual.db` y arrancar. Si el daño es acotado, preferir **corrección hacia adelante**
(un asiento de ajuste auditado) a una restauración total.

### 7.4 Claves

En el release no se rotan claves. Si se rotó antes por RK-02, el rollback de código **no** las
revierte: los datos quedaron cifrados con la clave nueva.

---

## 8. Criterios de aborto

- `estado-deploy.sh` no devuelve `OK` en 5 min → revisar `deploy-build.log`; si el contenedor no
  quedó `healthy`, rollback de código.
- `/api/health` no responde 200 con `db:"ok"` → rollback (con F8, un 503 significa base ilegible).
- Login falla para un usuario conocido → rollback.
- Cualquier migración deja conteos alterados → detener, no seguir, evaluar §7.3.
- Aparece `x-powered-by` después del deploy → el build desplegado no es el esperado: verificar
  hashes antes de seguir.

---

## 9. RPO / RTO: definición, medición y evidencia

| Métrica | Definición operativa | Cómo se mide | Estado actual |
|---|---|---|---|
| **RPO** | Antigüedad máxima de los datos que se aceptan perder | `verificar-backup.js` informa la edad de la última copia; RPO = edad máxima tolerada (propuesta: **24 h** con cron 03:00) | **NO MEDIDO**: el cron no está verificado (`33` §3) |
| **RTO** | Tiempo desde la decisión de recuperar hasta servicio operativo | Cronómetro entre el inicio de §4 y el login exitoso sobre la copia; en incidente real, hasta el servicio arriba en producción | **Solo local**: 0,55 s backup + 0,51 s restore sobre 741 KB (no representativo) |

Para aprobar RPO/RTO se exige: (1) cron verificado y alerta probada, (2) drill con **copia real**
cronometrado, (3) acta con la cifra y el tamaño de la base. Sin esos tres, cualquier número es
una suposición.

---

## 10. Registro de la operación (obligatorio)

```
Fecha/hora (UTC):
Operador:
Acción:            backup | drill | release | rollback
Commit/imagen:
Backup usado:      <archivo> · sha256 <…>
Verificación:      integrity ok | tablas N/N | descifrables X/Y
Resultado:         OK | FALLO (<motivo>)
Duración:
Decisión tomada:
```

Sin este registro, el próximo operador no puede distinguir un backup probado de uno que solo
existe.
