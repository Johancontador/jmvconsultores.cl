# 33 · Matriz operacional del VPS (F8)

> **Qué es:** la lista de verificaciones que **no se pueden hacer desde el repositorio**, con el
> comando exacto, la evidencia que debe devolver el operador, la decisión que se toma según el
> resultado y la autorización que cada una exige.
>
> **Relación con `28`:** los bloques de comandos de solo lectura ya están escritos allí (§3
> identificación, §4 clave, §6 backups, §8 certificados). Este documento **no los repite**: agrega
> lo que faltaba para operar (estado de la salud, cron, disco, decisiones y autorizaciones) y
> convierte cada control en una decisión con criterio.
>
> **Estado de partida (2026-10-24, verificado desde fuera):** producción responde
> `{"ok":true,"message":"IVA Mensual API running"}`, sirve `app.js?v=bdf0e607` y
> `sistema.css?v=5738e017` y envía `X-Powered-By: Express`.
>
> **Correcciones tras la ejecución real del 2026-10-25 (§10):** HSTS **sí** se envía
> (`max-age=31536000; includeSubDomains`; la medición de F6 que no lo vio era un
> falso negativo); el commit desplegado **no** es `85f93e9` sino **`548f1d6`**; y el
> `x-powered-by` sigue expuesto pero **sin redirección 301 de HTTP a HTTPS**.

---

## 1. Cómo se usa

1. El operador ejecuta **un bloque por vez**, copia la salida a un archivo y la devuelve.
2. Nunca se pegan valores de secretos: los controles imprimen booleanos, longitudes y conteos.
3. Cada bloque tiene una **regla de decisión**. Si la evidencia no alcanza, el control queda
   `NO VERIFICADO` y **no** se autoriza el release.

**Taxonomía:** `VERIFICADO` · `FALLIDO` · `BLOQUEADO POR ACCESO` · `REQUIERE AUTORIZACIÓN` ·
`NO APLICA CON EVIDENCIA`.

---

## 2. Identificación de la versión desplegada

| Control | Comando | Evidencia esperada | Decisión |
|---|---|---|---|
| Imagen en ejecución | `docker inspect -f '{{.Image}} {{.State.Health.Status}}' iva-mensual` | `sha256:… healthy` | Si no es `healthy`, no se planifica nada hasta entenderlo |
| Registro del deploy | `cat /home/johan/deploy-state.json` | `commit`, `imagen`, `salud`, `escritura_ok`, `fecha` | Si `escritura_ok:false` → el cron de backup está roto (RK-03) |
| Commit del repo bare | `git -C /home/johan/repos/iva-mensual.git rev-parse --short master` | hash corto | Comparar con la tabla de `28` §3 |
| Hashes del contenedor | bloque `28` §3 (5 archivos) | 5/5 en una columna | 5/5 = base conocida · mixto = build intermedio o edición manual · ninguno = imagen de otro árbol |
| Health en caliente | `curl -s http://127.0.0.1:3500/api/health` | Hoy: `{"ok":true,"message":…}` · tras F8: `{"ok":true,"db":"ok","version":"1.0.0"}` | Un 503 tras el deploy obliga a rollback |
| Frontend | `curl -s https://<dominio>/sistema/ \| grep -oE '(app\|sistema)\.(js\|css)\?v=[0-9a-f]{8}'` | `app.js?v=bdf0e607`, `sistema.css?v=5738e017` (hoy) | Comparar con el build local antes de desplegar |
| Cabeceras | `curl -sI https://<dominio>/api/health \| grep -iE 'x-powered-by\|strict-transport'` | Hoy: `x-powered-by: Express`, sin HSTS | Tras el release: sin `x-powered-by`; HSTS según decisión de edge (RK-10) |

**Regla:** con menos de tres filas coincidentes no se autoriza el release (RK-04/RK-08).

---

## 3. Backups: frescura, integridad y cron

| Control | Comando | Evidencia esperada | Decisión |
|---|---|---|---|
| Copias presentes | `ls -lt /home/johan/apps/iva-mensual/data/backups \| head` | `.db.enc` + `.manifest.json` + `.sha256` del mismo stamp | Sin copia de las últimas 26 h → ejecutar backup manual **antes** de cualquier cambio |
| Vigilancia | `docker exec iva-mensual node scripts/verificar-backup.js` | `[BACKUP-CHECK] OK … (N h, cifrada, total M)` exit 0 | Exit 1 → no se autoriza release |
| Integridad externa | `cd data/backups && sha256sum -c iva_mensual_<stamp>.sha256` | `OK` | Fallo → esa copia se descarta |
| Cifrado real | `head -c 16 iva_mensual_<stamp>.db.enc \| xxd \| head -2` | marca `JMVBACKUP1` (no SQLite `SQLite format 3`) | `.db` plano en el volumen → hallazgo crítico, rotar copia y borrar el plano |
| Cron vivo | `crontab -l \| grep -i backup` y `grep -i backup /var/log/syslog \| tail` (o `journalctl -u cron \| tail`) | entrada `0 3 * * *` y ejecuciones nocturnas recientes | Sin ejecuciones → causa del incidente de 7 noches (RK-03) |
| Retención | `du -sh data/backups` y conteo de stamps | ≤ `BACKUP_RETENCION` (30) | Disco ajustado → subir retención antes de crear copias nuevas |
| Espacio | `df -h /home/johan` | > 20 % libre | Menos → liberar antes de cualquier backup/release |

Ojo con la ruta: el backup vive en el **volumen del contenedor** (`/app/data/backups`), mapeado a
`./data/backups` del host. Un `ls` en la ruta equivocada hace creer que no hay copias.

---

## 4. Clave maestra (solo lectura, sin revelar el valor)

Usar el bloque de `28` §4.1–§4.3. Lo que se decide con esa salida:

| Resultado | Caso (`29` §B) | Decisión |
|---|---|---|
| `definida:true` + `descifra:true` | Sano | Se puede planificar el release |
| `definida:false`, datos `v1:` no descifran, fallback **sí** | B1 | Rotar con `rotar-master-key.js` **antes** del deploy (RK-02/RK-05); requiere autorización |
| `definida:true` pero `descifra:false` | B2 | **Parar.** Buscar la clave original; si no aparece, reingreso de credenciales por empresa |
| Datos sin prefijo `v1:` | B3 | Desplegar F5 cifra el legado al arrancar; exige backup previo |
| Variable ausente pero el contenedor **sí** la tiene | B4 | Revisar `docker inspect` (nombres, no valores) antes de tocar el `.env` |

**Nunca** se reinicia el contenedor para «ver si arranca» mientras la clave no esté clasificada.
Con F5-B desplegado, un arranque sin clave aborta (verificado en local: exit 1 con mensaje
accionable, sin imprimir el valor).

---

## 5. Certificados por empresa emisora

| Momento | Cómo | Evidencia | Decisión |
|---|---|---|---|
| Antes del release | No hay endpoint público que lo exponga (`27` §9.5) | — | **BLOQUEADO POR ACCESO** hasta el deploy |
| Después del release | `GET /api/dte/empresas/<id>/config` autenticado | `certificado: {estado, dias, vence, rut, bloqueante}` | `vencido` / `rut_no_coincide` / `indescifrable` → **bloquear emisión de esa empresa** y avisar al cliente |
| Post-deploy, todas | Repetir por cada empresa emisora | Una fila por empresa | `identidad_no_verificada` (sin RUT en el `.pfx`) se bloquea en producción por diseño |

El bloqueo es técnico con F5-D desplegado; antes de eso es **operativo**: no emitir, registrar el
motivo, avisar.

---

## 6. Permisos, salud y observabilidad

| Control | Comando | Evidencia esperada | Decisión |
|---|---|---|---|
| Escritura del contenedor | `docker exec iva-mensual node -e "require('fs').writeFileSync('/app/data/.w','x');require('fs').rmSync('/app/data/.w')"` | sin salida (éxito) | Error → `chown -R 1000:1000 data` antes de cualquier deploy (causa del incidente de backups) |
| Permisos de datos | `ls -ld data data/backups` | dueño `1000:1000` | Otro dueño → corregir |
| Salud del contenedor | `docker inspect -f '{{.State.Health.Status}}' iva-mensual` | `healthy` | `unhealthy` → revisar `docker logs --tail 100 iva-mensual` |
| Errores recientes | `docker logs --since 24h iva-mensual 2>&1 \| grep -c '\[ERROR\]'` | 0–bajo | Aumento tras el deploy → revisar antes de continuar |
| Reinicios | `docker inspect -f '{{.RestartCount}}' iva-mensual` | 0 | > 0 → hay un fallo que el health no vio |
| Log del deploy | `tail -40 /home/johan/deploy-build.log` | build + recreate + health | Fallo de build → no tocar nada más |

---

## 7. Autorizaciones exactas

| # | Acción | Alcance | Riesgo | Punto de no retorno | Evidencia que debe volver | Decisión |
|---|---|---|---|---|---|---|
| A1 | Ejecutar `28` (solo lectura) | Contenedor, repo bare, `.env` sin valores | Nulo | — | Salidas de §2/§3/§4/§6 | Habilita A2–A4 |
| A2 | Backup manual | Escribe una copia; la retención puede borrar antiguas | Bajo | Ninguno | `[BACKUP] OK` + manifest + `sha256sum -c` | Si falla, no se sigue |
| A3 | Drill de restauración aislada | Lee un backup y escribe en `/tmp` | Bajo (claves en el entorno) | Ninguno | `[RESTORE] OK`, integridad, conteos | Sin esto no hay release |
| A4 | Rotación de clave maestra | **Re-cifra todos los secretos** de la BD | **Alto** | Una vez re-cifrado, la clave vieja ya no abre nada | `descifrables = total`, 0 fallback | Solo si A1 dio caso B1 |
| A5 | Release (push + rebuild) | Recrea el contenedor | Medio (1–5 min de corte; más si recompila) | Se pierden los cambios manuales del servidor | `estado-deploy.sh` OK, health nuevo, `?v=` del build | Cualquier fallo → rollback |
| A6 | Programar alerta de backup | Cron + webhook/correo | Bajo | — | Prueba de alerta recibida | Sin alerta probada, RPO no se declara |
| A7 | Copia externa cifrada | Datos de clientes fuera del VPS | **Alto** (privacidad) | Publicación del dato en un tercero | Restore desde la copia externa | Requiere decisión del propietario (proveedor, región, custodia) |
| A8 | HSTS / redirección en el edge | Configuración de Cloudflare/nginx | Medio (puede romper clientes con HTTP) | Cambio global inmediato | Cabecera HSTS + 301 | Se hace después del release |
| A9 | Drill con copia **real** de producción | Datos reales en un host aislado | Alto (privacidad) | — | RTO medido y acta | Requiere autorización específica |

**Estado de las autorizaciones:** en F8 no se ejecutó ninguna. El **2026-10-25** se
 ejecutaron **A1** (diagnóstico completo de `28`, solo lectura) y el equivalente de
 **A3** (drill de restauración de la copia más reciente, en `/tmp` del contenedor y
 borrado al terminar); **A2, A4, A5, A6, A7, A8 y A9 siguen sin ejecutarse**. Detalle
 y evidencia en §10.

---

## 8. Lo que no se ejecuta en ninguna circunstancia desde este programa

- Reiniciar el contenedor sin la clave clasificada (puede dejarlo sin poder descifrar).
- Restaurar un backup sobre `data/iva_mensual.db` sin exportar antes las operaciones posteriores.
- Copiar `.env`, `.pfx` o claves al chat, a un correo o a un issue.
- Subir el `.db` plano (sin cifrar) a cualquier destino.
- Emitir DTE, consumir folios, abrir sesión SII/TGR o ejecutar checkout de pago «para probar».
- Hacer `git checkout -f` en el servidor sin haber extraído antes los cambios manuales.

---

## 9. Formato de devolución del operador

```
BLOQUE:            §2 | §3 | §4 | §5 | §6
FECHA/HORA (UTC):
EJECUTADO POR:
COMANDO(S):
SALIDA (tal cual, sin secretos):
CONTROLES QUE QUEDARON "NO VERIFICADO" Y POR QUÉ:
```Con esa devolución se cierran las puertas G1–G8 de `29` y se decide el escenario (A–E)
con evidencia, no con supuestos.

---

## 10. Ejecución real del diagnóstico — 2026-10-25 (solo lectura)

> **Qué se hizo:** se ejecutaron los bloques de `28` §2–§8 y los controles de §2–§6 de
> este documento **contra el VPS de producción**, más un drill de restauración aislado.
> **Qué no se hizo:** ni `git push`, ni `ops/deploy.sh`, ni `docker compose`, ni reinicios,
> ni escritura sobre `.env`, claves, certificados, BD o backups. No se copió ningún
> secreto ni dato de cliente fuera del servidor.
>
> **Equivalencias de taxonomía con §1:** `PENDIENTE` = `REQUIERE AUTORIZACIÓN` ·
> `NO VERIFICABLE` = falta evidencia (acceso o configuración) · `NO APLICA CON EVIDENCIA`
> se mantiene igual.

### 10.1 Acceso utilizado

| Dato | Valor |
|---|---|
| Vía | `ssh johan@100.116.109.54` (host `remusaas`), clave `id_ed25519`, `BatchMode` |
| Privilegios | `johan` + grupo `docker` (sin `sudo`); `root` **no** acepta la clave |
| Naturaleza | 100 % lectura: `docker ps/inspect/logs/exec`, `sha256sum`, `stat`, `df`, `crontab -l`, `cat` de manifiestos, `node` con BD `readonly:true` |
| Único efecto secundario | drill de restauración en `/tmp` **del contenedor**, borrado al terminar (0 residuos) |

### 10.2 Runtime y versión desplegada

| Control | Evidencia | Estado |
|---|---|---|
| Contenedor | `iva-mensual` · `Up 2 days (healthy)` · `RestartCount 0` · Node `v24.22.1` · `pwd=/app` | `VERIFICADO` |
| Imagen | `sha256:9e1faaa08633…`, creada 2026-10-22T22:24:55Z, arrancada 22:25:18Z | `VERIFICADO` |
| Registro de deploy | `deploy-state.json`: `commit 548f1d608536…`, `origen push`, `salud healthy`, `escritura_ok true`, `2026-10-22T22:25:32+00:00` | `VERIFICADO` |
| Repo bare | `master = 548f1d608536…` (2026-10-22 19:21 −0300) | `VERIFICADO` |
| `ops/estado-deploy.sh` | `ESTADO: OK — el contenedor corre el código registrado` (sin diferencia) | `VERIFICADO` |
| **5 hashes (`28` §3)** | `index.js b189c181…` · `boveda.js ca1f43b8…` · `dte-emisor.js 008290b0…` · `routes/dte.js bc9ec335…` · `package.json 6d38a022…` → **5/5 = `548f1d6`** | `VERIFICADO` (**G6**) |
| Sin ediciones manuales | **163/163** archivos `.js/.css/.html` del contenedor con sha256 idéntico a `548f1d6`; 0 extra, 0 faltantes | `VERIFICADO` |
| Frontend | Producción: 28 referencias `?v=`. Local (`HEAD`): 29 (aparece `views-centro.js`). **9 assets distintos** + 1 nuevo | `VERIFICADO` (build anterior a F3) |
| Anti-caché del build vivo | **27/28** referencias coinciden con el sha1 del archivo; `views-salud.js?v=2d1d9c4b` apunta a un contenido cuyo sha1 es `a5ac631b` (semilla obsoleta ya presente en `548f1d6`; en `HEAD` **29/29** consistentes) | `FALLIDO` (defecto previo, lo corrige el release) |
| Health interno y público | `{"ok":true,"message":"IVA Mensual API running"}` (cuerpo anterior a F8) | `VERIFICADO` |
| Errores 24 h | `0` líneas `[ERROR]` | `VERIFICADO` |
| Cabeceras | HSTS `max-age=31536000; includeSubDomains`, CSP, `X-Frame-Options: DENY`, `Server: cloudflare`; `x-powered-by: Express`; **HTTP→HTTPS sin 301** (200) | `VERIFICADO` con hallazgo |

> **Corrección a `28` §3:** la tabla comparaba `85f93e9` contra el *working tree* y daba
> `package.json 6165374a…` como «línea base». El commit realmente desplegado es
> `548f1d6`, cuyo `package.json` es `6d38a022…` (difiere de `85f93e9`). Ya está corregido
> en ese documento.

### 10.3 Clave maestra (`G1`, `G2`)

| Control | Evidencia | Estado |
|---|---|---|
| Presencia | `{definida:true, longitud:64, hex64:true}` | `VERIFICADO` (**G1**) |
| Compatibilidad real | Cobertura completa, no una muestra: **empresas 10/10** y **clientes 5/5** filas `v1:` descifran; `dte_folios` 0 filas | `VERIFICADO` (**G2**) |
| Fallback de desarrollo | **No aplica**: la clave está definida y descifra | `NO APLICA` |
| Compatibilidad tras el release | `git diff 548f1d6..HEAD -- backend/core/boveda.js`: la rama `hex64` usa el valor **directo** (misma clave, mismo `SALT_APP`); `cifrar/descifrar` **sin cambios** | `VERIFICADO` (revisión de código) |
| Fallo seguro (F5-B) | Local con `NODE_ENV=production`: sin clave → aborta con mensaje accionable; con 64 hex → `ok/hex/produccion`, roundtrip de cifrado correcto. En el contenedor `NODE_ENV=production`, así que la guarda queda **activa** tras el release y la clave **cumple** | `VERIFICADO` |
| `BACKUP_ENCRYPTION_KEY` | `{definida:true, longitud:64, hex64:true}` | `VERIFICADO` |

### 10.4 Backups (`G3`, `G4`, `G5`)

| Control | Evidencia | Estado |
|---|---|---|
| Frescura | Última copia `2026-10-24T03:00:05Z`, **23,3 h** al medir (objetivo ≤ 26 h; próxima corrida 03:00) | `VERIFICADO` (**G3**) |
| Integridad | `sha256sum -c` → `OK`; manifiesto `sha256` y `tamano_bytes` coinciden | `VERIFICADO` (**G4**) |
| Cifrado real | Marca `JMVBACKUP1`, 72.171.559 B (`AES-256-GCM`), y su stamp **no** deja `.db` plano (las copias planas existentes son de stamps anteriores — ver H-1) | `VERIFICADO` |
| Descifrabilidad | `descifra:true`, `sha_original_coincide:true` (72.171.520 B en memoria) | `VERIFICADO` (**G4**) |
| **Recuperabilidad** | Drill en `/tmp` del contenedor: `integrity_check ok`, `foreign_key_check` = **0 violaciones**, 61 tablas, empresas 10, users 11, documentos 15.598, asientos 263; BD plana eliminada y `0` residuos | `VERIFICADO` (**G5**) |
| Coherencia con lo vivo | BD viva: 15.620 documentos (+22 en 27 h) — la copia es un corte real, no un archivo vacío | `VERIFICADO` |
| Retención y espacio | **17 juegos cifrados** (16→24 oct, con copias manuales duplicadas) + 10 `.db` planos heredados = 61 archivos / 1,5 GB; retención por defecto 30 → sin presión. Disco: 36 G usados, **58 G libres (39 %)** | `VERIFICADO` |
| Programación | `0 3 * * * docker exec iva-mensual node scripts/backup-db.js`; log con `[BACKUP] OK` diario del 19 al 24 de octubre | `VERIFICADO` |
| Sync diaria | `30 7 * * *`, última corrida 2026-10-24 07:30 | `VERIFICADO` |
| Vigilancia (F5-C) | `scripts/verificar-backup.js` **no existe** en la imagen desplegada y **no hay cron** de verificación → un fallo nocturno sigue siendo silencioso | `FALLIDO` (llega con el release) |
| Copia externa | **No existe** para `iva-mensual`: el remoto `gdrive_johan` lo usa el cron de `/opt/geodaniela`; la única mención de `rclone/gdrive` en el árbol de la app es `docs/DESPLIEGUE.md` | `FALLIDO` (**A7** pendiente) |
| Alertas | El único watchdog del cron es de `geodaniela`; no hay alerta para `iva-mensual` | `FALLIDO` (**A6** pendiente) |

### 10.5 Certificados DTE (`G7`)

| Control | Evidencia | Estado |
|---|---|---|
| Configuración de emisores | `dte_config` = **0 filas**; `dte_folios` = **0**; `dte_emitidos` = **0**; el esquema solo guarda certificados en `dte_config` | `NO APLICA CON EVIDENCIA` |
| Vigencia / RUT | Sin certificados que inspeccionar; el comando de `28` §8 devolvió `configs_dte:0` | `NO VERIFICABLE` (nada configurado) |

> La emisión DTE **está deshabilitada de hecho** en producción. El release no la activa.
> Cualquier alta futura de certificado/CAF debe cerrar `G7` **antes** de emitir el primer folio.

### 10.6 Hallazgos abiertos

| # | Gravedad | Hallazgo | Acción |
|---|---|---|---|
| **H-1** | Alta | **Copias planas de la BD con datos de clientes**: 10 backups `.db` heredados en `data/backups` (2–9 oct, **392,3 MB**, permisos `644`) más dos copias sueltas en `data/` (`…bak-preFKfix…` 27 MB del 31-jul `777` y `pre-deploy-crm…db` 66 MB del 16-oct `644`). La retención **sí** las cuenta (`.db` entra en el patrón), pero con **27 stamps < 30** nunca las alcanza: empezará a borrarlas **sola** el **2026-10-28 03:00**, una por noche, sin copia cifrada de esos estados (ver §11) | Sanear (cifrar) antes del 28-oct y luego retirar (**requiere autorización A2/A3**) |
| **H-2** | Alta | `/home/johan/apps/iva-mensual/data` y `/app/data` en **`777`** (host y contenedor) | `chmod 750` + dueño `1000:1000` en la ventana |
| **H-3** | Alta | BD y copias en **el mismo disco**; perder el VPS es perder todo | Decisión de copia externa (**A7**) |
| **H-4** | Media | Sin verificación posterior ni alerta de backup; un fallo silencioso repetiría el incidente de 7 noches. El VPS **no tiene MTA**, así que `MAILTO` no sirve como alerta | `verificar-backup.js` ya corre sin `node_modules` (cambio local) y su cadena de alerta se probó en loopback; falta el cron y un webhook real (**A4/A6**, ver §11.4) |
| **H-5** | Media | Semilla anti-caché obsoleta en el build vivo (`views-salud.js`) → hasta 4 h de JS viejo | **Lo corrige el release** (`HEAD` 29/29) |
| **H-6** | Baja | `x-powered-by` expuesto; HTTP sin 301 (HSTS sí presente) | Edge/nginx, después del release (**A8**) |
| **H-7** | Info | El directorio de backups está **completo y sin huérfanos**: 17 juegos (17 `.db.enc` + 17 `.manifest.json` + 17 `.sha256`) + las 10 copias planas de H-1 = 61 archivos | Se resuelve con H-1 |
| **H-8** | Info | `MP_ACCESS_TOKEN` no está definida en el contenedor (y según `.env.example` sin ella el checkout queda deshabilitado); `MP_WEBHOOK_SECRET` sí está — no es regresión del release | Decisión de producto |

### 10.7 Puertas de `29`

| Puerta | Estado |
|---|---|
| G1 clave presente y con formato | **VERIFICADO** |
| G2 clave compatible con los datos | **VERIFICADO** (15/15 filas `v1:`) |
| G3 backup reciente | **VERIFICADO** (23,3 h) |
| G4 backup íntegro y descifrable | **VERIFICADO** |
| G5 backup recuperable | **VERIFICADO** (drill aislado) |
| G6 versión identificada | **VERIFICADO** (`548f1d6`, 5/5 + 163/163 archivos) |
| G7 certificados vigentes y del RUT | **NO APLICA CON EVIDENCIA** (0 emisores configurados) |
| G8 ventana aprobada y comunicada | **PENDIENTE** (acto administrativo, no técnico) |

### 10.8 Decisión

**APTO CON CONDICIONES.** Las puertas técnicas (G1–G6) están cerradas con evidencia
verificable y el release es de una sola dirección (`548f1d6` → `HEAD`, migraciones
**aditivas**: `deuda_tgr` y `rcv_agregados` con `CREATE TABLE/INDEX IF NOT EXISTS`;
`pdf-parse` presente en `package-lock.json` con integridad). **No** se autoriza ni se
ejecuta el despliegue desde este programa: pasa a «APTO PARA VENTANA CONTROLADA»
cuando se cumplan C1–C3.

**Condiciones antes de autorizar:**

| # | Condición | Evidencia de cierre |
|---|---|---|
| C1 | **Backup manual inmediatamente antes del push** (**A2**) | `[BACKUP] OK` + manifiesto + `sha256sum -c` **OK** |
| C2 | **G8**: ventana aprobada y comunicada; rollback definido | Acta/correo; rollback = commit `548f1d6`, imagen `sha256:9e1faaa08633` |
| C3 | Verificación **post-deploy** antes de declarar éxito | `estado-deploy.sh` → `ESTADO: OK`; `/api/health` → `{"ok":true,"db":"ok","version":"1.0.0"}`; `?v=` servido = build local; login + 3 pantallas; `0 [ERROR]`; tablas `deuda_tgr` y `rcv_agregados` creadas |

**Condiciones posteriores (no bloquean el release, sí el RPO):** C4 programar
`15 3 * * * node scripts/verificar-backup.js` y probar la alerta (**A6**); C5 decidir
copia externa (**A7**); C6 remediar H-1 y H-2 en la misma ventana.

**Nada de esto se ejecutó:** no hubo push, deploy, reinicio ni escritura en producción.
El árbol local conserva los cinco commits y `iniciar-sistema.bat` intacto.

---

## 11. Remediación H-1…H-4 — inventario, permisos, copia externa y vigilancia

Medición del **2026-10-25** sobre el VPS real. Solo lectura: `ls/stat`, `sha256sum`,
firmas de cabecera, `docker inspect/top/exec` de lectura, `crontab -l`, `rclone listremotes`.
Única escritura: dos archivos temporales efímeros y una base **sintética de 2 KB** en
`/tmp` del contenedor para el ensayo de permisos (borrados; `0` residuos).
**No** se ejecutó `chmod`, `chown`, borrado, cifrado, `rclone`, cron, push, deploy ni reinicio.

### 11.1 Inventario de archivos planos (H-1)

Contexto verificado: montaje `bind /home/johan/apps/iva-mensual/data -> /app/data rw`;
contenedor `uid=1000(node) gid=1000(node)`; en el host **johan = 1000:1000**. Los 12
archivos son SQLite válidos (`SQLite format 3`), ninguno vacío, ninguno con manifiesto.

**`data/backups` — 10 copias heredadas (todas `644`, dueño `johan`)**

| Archivo | Bytes | Fecha | SHA-256 (16) | Contenido distinto |
|---|---|---|---|---|
| `iva_mensual_2026-10-02T18-17-40.db` | 38.174.720 | 02-10 18:17 | `3fd6ff0de21178ff` | 1 |
| `iva_mensual_2026-10-02T18-19-54.db` | 38.174.720 | 02-10 18:19 | `e0b3f3ff0a52cbfd` | 2 |
| `iva_mensual_2026-10-02T20-13-33.db` | 38.174.720 | 02-10 20:13 | `7b11c0ede78c9ef0` | 3 |
| `iva_mensual_2026-10-03T03-00-02.db` | 38.846.464 | 03-10 03:00 | `dd4ccdfd2fcaf223` | 4 |
| `iva_mensual_2026-10-04T03-00-02.db` | 39.825.408 | 04-10 03:00 | `806b8d7e1fa7dd2f` | 5 |
| `iva_mensual_2026-10-05T03-00-05.db` | 39.825.408 | 05-10 03:00 | `806b8d7e1fa7dd2f` | = 5 |
| `iva_mensual_2026-10-06T03-00-05.db` | 39.825.408 | 06-10 03:00 | `806b8d7e1fa7dd2f` | = 5 |
| `iva_mensual_2026-10-07T03-00-05.db` | 39.825.408 | 07-10 03:00 | `806b8d7e1fa7dd2f` | = 5 |
| `iva_mensual_2026-10-08T03-00-08.db` | 39.825.408 | 08-10 03:00 | `806b8d7e1fa7dd2f` | = 5 |
| `iva_mensual_2026-10-09T03-00-04.db` | 39.825.408 | 09-10 03:00 | `806b8d7e1fa7dd2f` | = 5 |

→ **392.323.072 B (374,2 MiB) para solo 5 estados distintos**: la BD no cambió del 4 al 9
de octubre (6 archivos byte a byte idénticos, hash `806b8d7e…`).

**`data/` — 2 copias sueltas**

| Archivo | Bytes | Fecha | Modo | SHA-256 (16) | Papel |
|---|---|---|---|---|---|
| `iva_mensual.db.bak-preFKfix-1785467333388` | 27.123.712 | 31-07 03:08 | **777** | `a8140d8e9279a0d2` | único artefacto **previo al arreglo de claves foráneas** (jul) |
| `pre-deploy-crm-99fd811-3d231a2-ad09d47.db` (+`.db-shm` 32.768 B `644`, `.db-wal` 0 B `644`) | 66.252.800 | 16-10 20:38 | 644 | `5364f1a5e7bd0396` | snapshot **previo** al deploy de CRM `99fd811` |

**BD activa** (no hasheada: cambia con cada transacción y su verdad incluye el `-wal`):
`iva_mensual.db` 72.196.096 B **`777`** · `-wal` 7.712.672 B **`777`** · `-shm` 32.768 B **`777`**.

Total plano a sanear: **485.699.584 B (463 MiB)**.

**Equivalencia con la cadena cifrada — comprobada, no supuesta:**

- Los 17 `.enc` (16→24 oct) **no cubren** ningún stamp del 2 al 9 de octubre: no hay
  equivalente cifrado de esos estados.
- `pre-deploy-crm…db` **no es redundante**: el `.enc` del 16-10 21:42 declara
  `sha256_original = b3df2663a62f6a70`, distinto del `5364f1a5e7bd0396` del snapshot
  (64 min de operación entre ambos). Son dos estados distintos.
- Recuperabilidad de la cadena cifrada: sí verificada (drill aislado del 24-oct, **G5**).

### 11.2 La retención borrará sola los planos a partir del 28-oct

`scripts/backup-db.js` agrupa por stamp con `\.(db|db\.enc|manifest\.json|sha256)$`, así que
los 10 `.db` heredados **sí** entran en el conteo. Hoy hay **27 stamps** (17 cifrados + 10
planos) y `RETENCION=30`, de modo que nada se borra. Simulado con la misma regex y orden:

| Corrida nocturna | Stamp que se elimina |
|---|---|
| 2026-10-28 03:00 | `2026-10-02T18-17-40` |
| 2026-10-29 | `2026-10-02T18-19-54` |
| 2026-10-30 | `2026-10-02T20-13-33` |
| 2026-10-31 | `2026-10-03T03-00-02` |
| 2026-11-01 | `2026-10-04T03-00-02` |

**Consecuencia:** la exposición se resuelve «sola» en ~10 noches, pero de forma **no
decidida, no auditada y sin copia cifrada** de esos estados. Si se quieren conservar, hay
que cifrarlos **antes del 2026-10-28 03:00**. Las dos copias sueltas están en `data/`, fuera
de ese patrón: la retención **nunca** las tocará.

### 11.3 Permisos mínimos (H-2)

Hechos verificados, no supuestos:

| Dato | Evidencia |
|---|---|
| Usuario efectivo del proceso | `docker exec iva-mensual id` → `uid=1000(node) gid=1000(node)`; `docker top` lo muestra como `johan` (mismo uid) |
| Remapeo de uid | **No hay**: contenedor 1000 = host 1000 = `johan` |
| Usuarios humanos en el host | **1** (`johan:1000:1000`); el resto del sistema son cuentas de servicio |
| Quién más comparte ese uid | **`/opt/geodaniela`** (cron, watchdog y runner) corre como `johan` |
| Directorios que ya escriben sin `777` | `data/sii-fichas` (`755`, 9 archivos, último del 23-10 02:16) y `data/exports` (`755`, 5 archivos, último del 25-08) |

**Ensayo en aislado** (base sintética de 2 KB en `/tmp` del contenedor, jamás la BD real):

| Configuración | Resultado |
|---|---|
| dir `750` + archivo `640` | lectura/escritura WAL **OK** |
| archivo `440` | **falla**: `SQLITE_READONLY` |
| dir `550` | **falla**: `SQLITE_READONLY_DIRECTORY` |

→ `640/750` basta; el **directorio** debe conservar escritura porque ahí nacen `-wal` y `-shm`.

**Propuesta A — mínima y reversible (sin reinicio, sin tocar servicios):**

| Ruta | Hoy | Propuesto |
|---|---|---|
| `data` | `777` | `750` |
| `data/iva_mensual.db`, `-wal`, `-shm` | `777` | `640` |
| `data/backups`, `data/exports`, `data/sii-fichas` | `755` | `750` |
| `data/backups/*.enc`, `*.manifest.json`, `*.sha256` | `600` | `600` (ya correcto) |
| `data/backups/*.db` y las 2 copias sueltas | `644`/`777` | `600` **interino**, hasta sanear |

Nada de `chmod -R`: lista explícita, un inodo por archivo, y los modos actuales quedan
registrados antes de cambiar (§12, bloque B2). Impacto esperado: **cero** para el
contenedor (dueño 1000) y para el cron (johan).

**Límite honesto:** esto **no aísla entre aplicaciones**. `geodaniela` corre con el mismo
uid 1000, así que un compromiso de esa app lee la BD contable y los planos con o sin bit
`world`. El cierre real de ese riesgo es la **Propuesta B**: uid dedicado (p. ej. `10001`)
para `iva-mensual` + `data` con dueño `10001:10001` y `750`, y verificación por
`docker exec` en vez de por el host. Requiere editar `compose`/`Dockerfile` y una ventana;
**no se ejecutó** (A7).

### 11.4 Vigilancia de backups (H-4)

| Comprobación | Resultado |
|---|---|
| ¿Está el verificador en la imagen `548f1d6`? | **No**: `ls /app/scripts` no lo lista; `docker exec … node scripts/verificar-backup.js` → `MODULE_NOT_FOUND` |
| ¿Hay cron de verificación? | **No** (`crontab -l` sin coincidencias) |
| Node en el host | `v20.20.2` (la app pide ≥24; el verificador es CommonJS sin APIs nuevas) |
| `node_modules` en el host | sí, pero el árbol desplegado **no** tiene `scripts/verificar-backup.js` |
| MTA en el VPS | **ninguno** (`mail`, `sendmail`, `msmtp`, `postfix`, `exim4`) → `MAILTO` no alerta |

**Cambio local aplicado:** `scripts/verificar-backup.js` ya no exige `dotenv`
(`try/catch`) → corre desde cualquier copia del árbol con solo Node, sin `npm install`.

Pruebas ejecutadas hoy (árbol aislado `.tmp-verif`, sin `node_modules`):

| Escenario | Salida | Exit |
|---|---|---|
| directorio inexistente | `[BACKUP-CHECK] SIN DIRECTORIO` | 1 |
| copia íntegra de 1,5 h | `{"estado":"ok",…,"total":3}` | 0 |
| copia de 30 h (límite 26) | `ANTIGUO … tiene 30 h` | 1 |
| hash alterado (+1 B) | `CORRUPTO … tamaño no coincide … SHA-256 no coincide` | 1 |
| **cadena de alerta** `verificar || curl -X POST` contra un listener en `127.0.0.1:9099` | recibido: `POST /alerta body="backup con problemas"` | 0 |

La cadena **detección → exit 1 → webhook** está probada en loopback. **No** está probada la
entrega al canal humano real: falta la URL (A6). Sin MTA, el canal tiene que ser HTTP
(webhook propio) o un servicio externo de *dead-man's switch*. El catálogo consultado no
tiene servicio S3-compatible ni de ese tipo; la única opción devuelta (Knock) exige SDK y
cuenta para un aviso diario, así que **no se recomienda** aquí.

Cron **EJECUTADO el 2026-10-25** (A4) — evidencia en §13.3. Lo instalado es:

```bash
# /home/johan/ops-verificacion/verificar-cron.sh  (FUERA del checkout: `git checkout -f` del
# deploy no lo pisa; el borrador anterior lo ponía dentro del árbol de trabajo)
15 3 * * * /bin/bash /home/johan/ops-verificacion/verificar-cron.sh
```

Diferencia con el borrador: la alerta **no** se encadena en la línea del crontab. El wrapper
lee `/home/johan/ops-verificacion/alerta.env` (`600`); si `ALERTA_WEBHOOK` está definida hace
el `POST`, y si el archivo no existe deja el fallo en `logs-backup.log` (**modo degradado
declarado** hasta cerrar A6). Así el cron queda instalado y probado sin depender de una URL
que todavía no existe, y activar la alerta es crear un archivo, no editar crontab.

### 11.5 Copia externa (H-3) — diseño

| Decisión | Valor |
|---|---|
| Transporte | `rclone v1.74.3` ya instalado en el host |
| Credenciales | **conjunto propio** limitado al prefijo `iva-mensual/`; nunca reutilizar `gdrive_johan:` (lo usa el cron de `geodaniela` a las 03:00) |
| Contenido | solo `*.db.enc` + `*.manifest.json` + `*.sha256` (ya cifrados `JMVBACKUP1`). **Nunca** `.db`, `.env` ni `data/sii-fichas` |
| Frecuencia | diaria **03:20** (backup 03:00, verificación 03:15) |
| Retención remota | 90 días (`rclone delete --min-age 90d`), mínimo 30 copias, nunca la más reciente |
| Integridad | `rclone copy --immutable --check-first` + `rclone check --one-way` posterior |
| Recuperación | mensual: bajar 1 juego a `/tmp`, `restore-db.js --dest` aislado, comparar conteos, borrar |
| Custodia de claves | `BACKUP_ENCRYPTION_KEY` **nunca** viaja al remoto; 2 copias fuera del VPS (gestor de contraseñas + sobre sellado, custodios distintos) |
| Riesgo asumido | con la clave y el remoto en el mismo sitio, el cifrado no protege: clave y bucket deben vivir en dominios separados |

`rclone.conf` debe quedar en `600` y las credenciales en el *keyring* del host; el remoto
no se crea desde este programa (A5).

### 11.6 Plan de saneamiento (orden obligatorio)

1. **Precondición ya cumplida:** copia cifrada verificada del 24-oct (**G4/G5**).
2. **Antes del 2026-10-28 03:00** (si se conservan los 5 estados del 2–9 oct): cifrar cada
   plano con la clave existente → verificar *round-trip* → escribir `manifest` con
   `sha256_original` → **sacar el `.enc` de `data/backups/` a `data/archivo-heredado/`**.
   ⚠️ Corregido el 2026-10-25: la versión original de este punto decía que bastaba cifrar
   «dejando las copias dentro del formato que `restore-db.js` entiende», es decir en la
   misma carpeta. **Es insuficiente**: `backup-db.js` agrupa por *stamp* y borra en bloque
   `.db`, `.db.enc`, `.manifest.json` y `.sha256` del stamp viejo, así que un `.enc` creado
   con el stamp original **muere en la misma purga que su plano** y la conservación no se
   logra. Ver §13.2.
3. **Duplicados:** de los 6 idénticos `806b8d7e…` se cifra **uno** (04-10) y se eliminan
   los otros 5 planos; justificación = hash idéntico, no antigüedad.
4. **`pre-deploy-crm…db`:** cifrar (no es redundante, §11.1) y conservar.
5. **`bak-preFKfix…`:** cifrar y conservar (único artefacto pre-arreglo FK).
6. **Cierre del círculo:** `sha256sum -c` del `.sha256` nuevo + `restore-db.js` aislado sobre
   al menos un juego saneado, **antes** de borrar el plano.
7. **Borrado:** `shred -u` **no** garantiza irreversibilidad en LVM/SSD (TRIM, snapshots del
   proveedor). Se declara *eliminación lógica*; el riesgo residual depende del proveedor y
   se acepta por escrito (**R6**).
8. **Conservación:** los registros contables siguen en la BD viva y en la cadena cifrada;
   los snapshots del 2–9 oct no aportan información que no esté en la BD actual. Aun así,
   el descarte lo confirma el **propietario/contador**, no este informe.

### 11.7 Autorizaciones necesarias

| # | Autoriza | Reversible | Riesgo si no se hace |
|---|---|---|---|
| **A1** | Aplicar Propuesta A de permisos (§11.3) | Sí (modos registrados, B2/B7) | BD y copias escribibles por cualquiera |
| **A2** | Cifrar los planos heredados antes del 28-10 | No (cambia formato; el plano se borra) | La retención los destruye sin copia cifrada |
| **A3** | Eliminar los 5 duplicados idénticos | No | 200 MB de datos expuestos sin valor añadido |
| **A4** | Copiar el verificador al host y programar el cron | Sí (`rm -rf ops-verificacion/`) | Fallo de backup silencioso |
| **A5** | Crear remoto rclone dedicado + cron de copia | Sí (borrar remoto/cron) | Pérdida total si falla el VPS |
| **A6** | Configurar webhook de alertas y probar 1 alerta real | Sí | Nadie se entera de un fallo |
| **A7** | Aislamiento por uid dedicado (Propuesta B) | Con ventana | `geodaniela` comprometida = BD contable legible |

### 11.8 Riesgos residuales y criterio de cierre

| # | Riesgo | Cierra cuando |
|---|---|---|
| R1 | Planos con datos de clientes en el volumen | `find data -name '*.db'` solo devuelva la BD viva (0 heredados) **y** exista copia cifrada verificada de cada estado conservado |
| R2 | Permisos `777`/`644` | `stat` muestre `750/640` en `data` y la BD, `600` en copias |
| R3 | Sin aislamiento entre apps (uid 1000 compartido) | `iva-mensual` corra con uid propio y `data` sea `750` de ese uid |
| R4 | Sin copia fuera del VPS | `rclone check --one-way` OK + drill de restauración desde el remoto |
| R5 | Sin alerta de backup | 1 alerta real recibida por el canal humano (no simulada) |
| R6 | Borrado no certificable | Aceptación escrita del propietario |
| R7 | Clave de backup solo en el VPS | 2 copias en custodia externa documentadas |

### 11.9 Estado

**Superado por §13 (2026-10-25).** A1 (permisos), A2 (cifrado de los estados heredados) y
A4 (verificador + cron) están **aplicados y verificados en el VPS**. Siguen pendientes A3
(borrado de los planos), A5 (remoto), A6 (webhook) y A7 (uid dedicado).

Este apartado se conserva como registro del análisis previo; **el estado vigente es §13.4**.
El release sigue **APTO CON CONDICIONES** (§10.8): H-1 se redujo y H-4 se cerró parcialmente,
pero ninguno de los dos está cerrado.

---

## 12. Comandos de producción — **NO EJECUTADOS**

Todos requieren autorización (A#). Copiar/pegar **uno por uno**; ninguno borra ni reinicia
de forma implícita. `S` = `ssh johan@100.116.109.54`.

### B1 — Inventario reproducible (solo lectura, ya ejecutado)

```bash
$S 'cd /home/johan/apps/iva-mensual/data && ls -la . backups && sha256sum backups/*.db iva_mensual.db.bak-* pre-deploy-crm-*.db'
```

### B2 — Permisos mínimos (A1)

```bash
$S 'cd /home/johan/apps/iva-mensual && \
  stat -c "%a %U:%G %n" data data/iva_mensual.db data/iva_mensual.db-wal data/iva_mensual.db-shm \
    data/backups data/exports data/sii-fichas data/backups/*.db data/iva_mensual.db.bak-* pre-deploy-crm-* \
    | tee /tmp/modos-antes.txt && \
  chmod 750 data data/backups data/exports data/sii-fichas && \
  chmod 640 data/iva_mensual.db data/iva_mensual.db-wal data/iva_mensual.db-shm && \
  chmod 600 data/backups/*.db data/iva_mensual.db.bak-* pre-deploy-crm-* && \
  stat -c "%a %U:%G %n" data data/iva_mensual.db data/iva_mensual.db-wal data/iva_mensual.db-shm \
    && docker exec iva-mensual node -e "const d=require(\"/app/node_modules/better-sqlite3\")(process.env.DB_PATH,{readonly:true});console.log(\"bd legible tras chmod:\",d.prepare(\"select count(*) c from empresas\").get().c>0);d.close()"'
```

- No hay reinicio: los descriptores abiertos siguen válidos y el proceso ya es dueño.
- Reversión: `chmod 777 data data/iva_mensual.db*` y `chmod 644 data/backups/*.db` (o leer
  `/tmp/modos-antes.txt`).

### B3 — Sanear un plano (A2/A3) — cifrar, verificar y solo entonces borrar

```bash
# UNA ruta por invocación. La clave vive en el entorno del contenedor: no se imprime.
$S 'docker exec iva-mensual node -e '\''
const fs=require("fs"),path=require("path"),c=require("/app/backend/core/backup-cifrado");
const f=process.argv[1],k=process.env.BACKUP_ENCRYPTION_KEY;
if(!k){console.error("SIN BACKUP_ENCRYPTION_KEY");process.exit(2)}
const plano=fs.readFileSync(f),sha=c.sha256Buffer(plano);
const enc=c.cifrarBuffer(plano,k);
if(c.sha256Buffer(c.descifrarBuffer(enc,k))!==sha){console.error("ROUND-TRIP FALLA");process.exit(1)}
const salida=f.replace(/\.db$/,".db.enc");
if(fs.existsSync(salida)){console.error("YA EXISTE "+salida);process.exit(1)}
fs.writeFileSync(salida,enc,{mode:0o600});
const m={archivo:path.basename(salida),sha256:c.sha256Archivo(salida),sha256_original:sha,
tamano_bytes:fs.statSync(salida).size,creado_en:new Date().toISOString(),
formato:"jmv-backup-"+c.VERSION,cifrado:true,base_datos:"iva_mensual.db",
origen:"saneamiento H-1",secretos:"ninguno"};
const base=salida.replace(/\.db\.enc$/,"");
fs.writeFileSync(base+".manifest.json",JSON.stringify(m,null,2)+"\n",{mode:0o600});
fs.writeFileSync(base+".sha256",m.sha256+"  "+m.archivo+"\n",{mode:0o600});
console.log("OK",salida,m.tamano_bytes,"B  sha256_original",sha.slice(0,16));
'\'' /app/data/backups/iva_mensual_2026-10-04T03-00-02.db'

# Verificación ANTES de borrar el plano: hash del .enc + restauración aislada
$S 'cd /home/johan/apps/iva-mensual/data/backups && sha256sum -c iva_mensual_2026-10-04T03-00-02.sha256'
$S 'docker exec iva-mensual node scripts/restore-db.js \
  --backup /app/data/backups/iva_mensual_2026-10-04T03-00-02.db.enc --dest /tmp/drill-04oct'
# Solo si los dos pasos son OK, retirar el plano (A2/A3):
$S 'shred -u /home/johan/apps/iva-mensual/data/backups/iva_mensual_2026-10-04T03-00-02.db'
```

Repetir por cada estado a conservar (5 del 2–9 oct) y por las 2 copias sueltas. Los 5
duplicados idénticos no se cifran: se borran (A3).

### B4 — Verificador en el host, sin tocar la imagen (A4)

```bash
cd "$(git rev-parse --show-toplevel)"   # desde el repo local
mkdir -p /tmp/ops-verificacion/scripts /tmp/ops-verificacion/backend/core
cp scripts/verificar-backup.js /tmp/ops-verificacion/scripts/
cp backend/core/backup-vigilancia.js backend/core/backup-cifrado.js /tmp/ops-verificacion/backend/core/
scp -r /tmp/ops-verificacion johan@100.116.109.54:/home/johan/apps/iva-mensual/ops-verificacion
# prueba en seco (solo lectura de la carpeta de backups)
ssh johan@100.116.109.54 '/usr/bin/node /home/johan/apps/iva-mensual/ops-verificacion/scripts/verificar-backup.js \
  --dir /home/johan/apps/iva-mensual/data/backups'
# cron (A6 exige además el webhook real)
crontab -e   # añadir la línea de §11.4
```

Reversión: `rm -rf /home/johan/apps/iva-mensual/ops-verificacion` y quitar la línea del cron.

### B5 — Copia externa (A5)

```bash
# 1) credenciales DEDICADAS (nunca gdrive_johan). El secreto se pega en el prompt de rclone.
rclone config create jmv-backups s3 provider="$PROVEEDOR" env_auth=false \
  access_key_id="$CLAVE_ID" secret_access_key="$CLAVE_SECRETA" region="$REGION" endpoint="$ENDPOINT"
chmod 600 ~/.config/rclone/rclone.conf

# 2) copia diaria (solo cifrado), inmutable y comprobada
20 3 * * * cd /home/johan/apps/iva-mensual && /usr/bin/rclone copy data/backups "jmv-backups:$BUCKET/iva-mensual" \
  --include "*.db.enc" --include "*.manifest.json" --include "*.sha256" \
  --immutable --check-first >> logs-backup.log 2>&1 \
  || /usr/bin/curl -fsS -m 10 -X POST --data 'copia externa FALLO' "$ALERTA_WEBHOOK"

# 3) comprobación semanal del remoto
0 4 * * 1 /usr/bin/rclone check /home/johan/apps/iva-mensual/data/backups "jmv-backups:$BUCKET/iva-mensual" \
  --one-way --include "*.db.enc" >> logs-backup.log 2>&1 \
  || /usr/bin/curl -fsS -m 10 -X POST --data 'espejo externo inconsistente' "$ALERTA_WEBHOOK"

# 4) retención remota 90 días (nunca la más reciente)
30 4 * * 0 /usr/bin/rclone delete "jmv-backups:$BUCKET/iva-mensual" --min-age 90d --include "iva_mensual_*.db.enc"
```

### B6 — Drill mensual de recuperación desde el remoto

```bash
mkdir -p /tmp/drill-externo && /usr/bin/rclone copy "jmv-backups:$BUCKET/iva-mensual" /tmp/drill-externo \
  --include "iva_mensual_2026-*.db.enc" --include "*.manifest.json"
docker cp /tmp/drill-externo/. iva-mensual:/tmp/drill-externo/
docker exec iva-mensual node scripts/restore-db.js \
  --backup /tmp/drill-externo/iva_mensual_2026-11-01T03-00-00.db.enc --dest /tmp/drill-remoto
docker exec iva-mensual rm -rf /tmp/drill-externo /tmp/drill-remoto && rm -rf /tmp/drill-externo
```

Criterio: `integrity_check ok`, `foreign_key_check` sin violaciones, conteos ≥ los del
último conocido, `claves SII` descifradas.

### B7 — Reversión de permisos (si algo deja de escribir)

```bash
$S 'cd /home/johan/apps/iva-mensual && chmod 750 data data/backups && chmod 640 data/iva_mensual.db* && \
  docker exec iva-mensual node -e "const d=require(\"/app/node_modules/better-sqlite3\")(process.env.DB_PATH);d.exec(\"pragma user_version\");console.log(\"escritura OK\");d.close()"'
```

---

## 13. Intervención ejecutada — 2026-10-25

Autorizaciones otorgadas: **A1, A2, A4, A5, A6, A7**. Resultado: **A1, A2 y A4 aplicados y
verificados**; A5, A6 y A7 quedaron bloqueados por insumos que solo el propietario puede dar
(§13.5). **A3 no fue autorizada**, así que los 10 `.db` heredados siguen en disco.

Sin `git push`, sin despliegue, sin reinicio: el contenedor se mantuvo `Up 2 days (healthy)` y
`/api/health` respondió `{"ok":true}` antes y después.

### 13.1 A1 — permisos (aplicado)

| Ruta | Antes | Después |
|---|---|---|
| `data` | `777` | `750` |
| `data/iva_mensual.db`, `-wal`, `-shm` | `777` | `640` |
| `data/backups`, `data/exports`, `data/sii-fichas` | `755` | `750` |
| `data/backups/*.db` (10) | `644` | `600` |
| `pre-deploy-crm-…db` | `644` | `600` |
| `iva_mensual.db.bak-preFKfix-…` | `777` | `600` |

Registro previo (modos + SHA-256 de las 13 rutas): `/home/johan/modos-antes-2026-10-25.txt`.

Pruebas posteriores, **sin reinicio**:

- lectura real: `empresas 10`, `documentos 15620` (solo conteos);
- **escritura**: base de prueba en `/app/data` → `journal_mode=wal`, `insert` OK, `filas: 1`,
  `-wal`/`-shm` creados y borrados al cerrar;
- `curl /api/health` → `{"ok":true,"message":"IVA Mensual API running"}`.

Reversión: `/home/johan/modos-antes-2026-10-25.txt` + bloque B7.

Lo que **no** cambió: el uid compartido con `geodaniela` (§11.3). Con `750`, un compromiso de
esa app sigue leyendo la BD contable. A7 no se ejecutó.

### 13.2 A2 — cifrado de los estados heredados (aplicado, con corrección de procedimiento)

Entre los 10 `.db` heredados hay **5 contenidos distintos** (verificado por hash). Por cada uno
se cifró **un representante** con `backup-cifrado.js`, comprobando el round-trip AES-256-GCM,
y se escribió `manifest` (con `sha256_original`) y `.sha256`.

| Fichero cifrado | Bytes | `sha256_original` |
|---|---|---|
| `iva_mensual_2026-10-02T18-17-40.db.enc` | 38.174.759 | `3fd6ff0d…` |
| `iva_mensual_2026-10-02T18-19-54.db.enc` | 38.174.759 | `e0b3f3ff…` |
| `iva_mensual_2026-10-02T20-13-33.db.enc` | 38.174.759 | `7b11c0ed…` |
| `iva_mensual_2026-10-03T03-00-02.db.enc` | 38.846.503 | `dd4ccdfd…` |
| `iva_mensual_2026-10-09T03-00-04.db.enc` | 39.825.447 | `806b8d7e…` |

**Corrección de §11.6.2:** creados en `data/backups/`, esos `.enc` **no se conservaban**.
`backup-db.js` agrupa por *stamp* con `\.(db|db\.enc|manifest\.json|sha256)$` y borra el grupo
completo, así que el `.enc` del 02-oct habría muerto en la misma purga que su plano. Por eso
los 15 archivos se **movieron** a `data/archivo-heredado/` (`750`, archivos `600`), fuera del
alcance de la retención y conservando el nombre original.

Comprobaciones: `sha256sum -c` de los cinco → `OK`. `stamps` en `data/backups` = **28** (no
bajó, porque los planos siguen contando). Con 28 stamps y `RETENCION=30`, la primera purga cae
la noche que se llegue a 31, es decir **2026-10-28 03:00**, y se llevará
`iva_mensual_2026-10-02T18-17-40.db`: el plano, ya sin gemelo cifrado en esa carpeta.

Restauración aislada, dos drills independientes:

```
# 09-oct desde data/backups (antes de mover)
[RESTORE] OK · integridad: ok · empresas 5 · documentos 451 · asientos 263 · claves SII 5/5
# 02-oct desde data/archivo-heredado (después de mover)
[RESTORE] OK · integridad: ok · empresas 4 · documentos 254 · claves SII 4/4
```

Ninguno tocó la BD real; los destinos `/tmp/drill-*` se borraron al terminar.

### 13.3 A4 — vigilancia de backups (aplicado)

- `scripts/verificar-backup.js`, `backend/core/backup-vigilancia.js` y `backup-cifrado.js`
  copiados a `/home/johan/ops-verificacion/` (`750`/`640`), **fuera del checkout**.
- Corre con el Node del host (`v20.20.2`) sin `npm install`: eso es lo que habilita el cambio
  local de `dotenv` opcional.
- Prueba real contra el volumen: `{"estado":"ok","ok":true,"total":33,…}`, última copia
  `iva_mensual_2026-10-25T03-00-03.db.enc` (0,5 h), exit `0`.
- Wrapper `/home/johan/ops-verificacion/verificar-cron.sh` probado en los dos caminos: caso OK
  → exit `0`; carpeta vacía → `SIN BACKUPS`, exit `1` y línea `[alerta]` en el log.
- `crontab` instalado con **diff mínimo** (`13a14,15`; se conservaron las líneas previas de
  geodaniela): `15 3 * * * /bin/bash /home/johan/ops-verificacion/verificar-cron.sh`.
  `systemctl is-active cron` → `active`.

Falta solo el canal humano: `alerta.env` no existe, así que hoy **el fallo se detecta y se
registra, pero nadie recibe aviso** (A6).

### 13.4 Estado de los riesgos después de §13

| # | Antes | Ahora | Cierra con |
|---|---|---|---|
| H-1 exposición | 12 planos en `644`/`777` | Planos siguen existiendo, ahora `600`; cada estado tiene gemelo cifrado verificado | **A3** + criterio R1 |
| H-2 permisos | `777`/`644` | `750`/`640`/`600` | R2 cumplido; falta R3 (uid) = A7 |
| H-3 copia externa | inexistente | inexistente | A5 |
| H-4 vigilancia | inexistente | detección automática diaria + log | A6, para que la alerta llegue a una persona |

`iniciar-sistema.bat` no se tocó (`sha256 3d975452…`, 3.536 B, mtime 2026-10-22 21:55).

### 13.5 Bloqueos reales (insumos que faltan)

| # | Qué falta | Por qué no se puede resolver desde aquí |
|---|---|---|
| A3 | Autorización de borrado | Destructivo e irreversible en la práctica (§11.6.7). No fue autorizada. |
| A5 | Proveedor, endpoint, bucket y credenciales dedicadas | **Decidido: Cloudflare R2.** Implementación local corregida tras dos pasadas de audit (`34-A5-A6-R2-PUSHOVER.md`); falta crear bucket y token. El plan tiene **7 pasos** (copia, heredado, verificación de hashes, auditoría de restaurabilidad, inventario, purga y comprobación posterior), la purga va **anclada a la raíz** (`/iva_mensual_*`, así que `heredado/` no se borra) y el tope debe cubrir los 21 objetos/semana que maduran o la cola crece para siempre. La purga **no usa `--max-delete`** (con más elegibles que el tope, rclone borra N y no termina): se decide sobre un inventario y se ejecuta con lista explícita; si el inventario supera el tope no se borra nada. Cada `--ejecutar` toma un lock y todo comando lleva timeout. El código no sube nada sin `--ejecutar`. |
| A6 | Canal de aviso | **Decidido: Pushover.** Implementación local corregida tras el audit; falta `pushover.env` (`600`, fuera del repo). La alerta de emergencia (`--prioridad 2`) envía `retry`/`expire` como exige el contrato; sin ellos la API devolvía 400. El wrapper de §13.3 sigue en modo «solo log». |
| A7 | Ventana con reinicio del contenedor | Cambia `Dockerfile`/`compose` y exige recrear: no hay forma de hacerlo sin corte. |

### 13.6 Correcciones del audit A5/A6 (2026-10-25, **solo local**)

El trabajo de §13 se auditó antes de conectar servicios externos. Seis defectos
reales quedaron corregidos sobre la base `a6e7619`; el commit de cierre y su
despliegue se registran en §15. Nada de esto se ejecutó contra R2 ni Pushover.

| # | Defecto encontrado | Corrección implementada |
|---|---|---|
| 1 | La purga con `--max-delete 10` semanal no converge: maduran 21 objetos/semana (3 por copia) y la cola crecía ~11/semana | Tope por defecto 63, mínimo calculado (`3 × cadencia`), rechazo de configuraciones que no convergen y simulación en pruebas. En la segunda pasada se cambió **cómo se aplica**: inventario + lista explícita (ver 13.7) |
| 2 | `--prioridad 2` de Pushover se enviaba sin `retry`/`expire` → 400 garantizado | Valores por defecto 60 s/3600 s, validación local y parámetros en el cuerpo |
| 3 | El restore sobrescribía un archivo existente sin aviso y sin distinguir la BD activa | Rechazo por defecto, `--sobrescribir` explícito, aborto si coincide con `DB_PATH`, escritura en temporal y `rename` atómico |
| 4 | El criterio del drill citaba `foreign_key_check`, que el código no ejecutaba | `PRAGMA foreign_key_check` junto a `integrity_check`; una base con FK rota **no se publica** |
| 5 | `rclone check` solo miraba `*.db.enc`: un manifiesto ausente en el remoto no se detectaba | Verificación de los tres objetos + auditoría `lsjson` que marca sellos no restaurables, huérfanos y faltantes |
| 6 | El patrón `iva_mensual_*` alcanzaba `heredado/` (rclone lo aplica a cualquier profundidad) | Patrón anclado a la raíz `/iva_mensual_*`; prueba con `rclone ls` real sobre un árbol raíz + subdirectorio |

**Preflight obligatorio antes de cualquier operación remota destructiva** (esto no
lo puede hacer el programa por ti):

```bash
# 1) el remoto dedicado existe y ve el bucket (no escribe)
rclone lsd jmv-r2:
rclone lsf jmv-r2:jmv-backups --max-depth 1 | head
# 2) el token NO ve otros buckets de la cuenta (debe fallar)
rclone lsf jmv-r2:otro-bucket 2>&1 | head -2
# 3) permisos del archivo de credenciales
stat -c '%U:%G %a %n' ~/.config/rclone/rclone.conf   # esperado 600 del usuario del cron
# 4) versionado activo + regla de ciclo de vida para versiones no vigentes
```

El **versionado** del bucket (recomendado en `34`) conserva las versiones
anteriores de cada objeto y R2 las **sigue cobrando**: sin una regla de ciclo de
vida que las expire, el almacenamiento crece de forma acumulativa y la estimación
de 6,69 GB deja de valer a partir de ~4 meses. El detalle y los límites están en
`34` §A5.

### 13.7 Segunda pasada del audit A5 (2026-10-25, **solo local**)

La auditoría independiente del árbol previo al cierre encontró que el diseño de purga
elegido en 13.6 era él mismo destructivo. Corregido antes del despliegue (§15), sin
conexión a R2:

| # | Defecto | Corrección |
|---|---|---|
| F-01 | `rclone delete --max-delete` con más elegibles que el tope **borra N y no termina** (medido: 30/6 vivo a los 240 s; 84/63 cortado a los 90 s); el CLI lo lanzaba sin timeout y sin lock | Inventario previo, rechazo sin borrar cuando se supera el tope, lista explícita, timeout por comando y lock por corrida |
| F-02 | La purga partía copias (sello con solo `.sha256` o `.db.enc` sin manifest) | Solo se borran sellos **completos**; un sello parcial o un objeto de subdirectorio aborta; comprobación posterior del remoto con `PURGA INCOHERENTE` si queda un sello partido o desaparece algo fuera de la lista |
| F-03 | El cron recomendado usaba `--solo retencion-remota`, que omitía verificación y auditoría: borrado sin barrera | `--solo retencion-remota` arrastra verificación, auditoría, inventario y comprobación posterior; sin inventario en la misma corrida no hay `delete` |

Pruebas: `test/r2-plan.test.js` A5/21–A5/29 (casos 30/6 y 84/63, sello partido,
subdirectorio, fallo de listado, timeout, purga parcial y reejecución con lock).

**Nota (restauración):** el audit también señaló dos límites del restore que **siguen
abiertos**: publica una base de 0 bytes o sin tablas críticas con `ok:true` (no exige
conteos) y la guarda de destino ocupado es *check-then-act*. Un drill debe revisar los
conteos a mano y usar un directorio recién creado; ver `34` §«Límites de la restauración».

---

## 14. A7 preparado — aislamiento por uid dedicado (**NO EJECUTADO**)

A7 fue autorizada, pero **no se puede aplicar sin build y sin recrear el contenedor**: el
`Dockerfile` actual crea y usa `node` (uid 1000) y el volumen `./data` pertenece a `johan`
(1000). Cambiar solo el `chown` deja la app sin escritura; cambiar solo el `USER` deja el
volumen inaccesible. Por eso aquí queda el procedimiento completo y sin ejecutar.

Verificado en el VPS antes de escribir esto: **uid y gid 10001 están libres**
(`getent passwd|group 10001` sin salida) y hoy el contenedor corre con `HOME=/home/node`,
`/home/node` propiedad de `node`.

### 14.1 Dos detalles que romperían la migración en silencio

1. **El verificador del host perdería acceso.** Tras el `chown` a `10001:10001`, `johan` ya no
   puede leer `data/backups` si el directorio queda en `750` de otro dueño. La migración tiene
   que crear en el host un grupo con **el mismo gid 10001** y meter a `johan` en él; así
   `750`/`640` siguen permitiendo la verificación diaria de §13.3 sin abrir el directorio.
2. **Chromium necesita `HOME` escribible.** `core/declaraciones-sii.js` lanza `/usr/bin/chromium`.
   Con un uid numérico sin entrada en `/etc/passwd`, `HOME` apunta a un directorio que no le
   pertenece y la sincronización de declaraciones falla de forma opaca. El usuario tiene que
   existir en la imagen, con su `HOME` propio.

Por eso el patch crea un usuario real y **no** usa `user: "10001:10001"` a secas.

### 14.2 Patch de imagen (no aplicado)

```dockerfile
# A7: usuario dedicado. Va ANTES de los COPY para poder usar --chown.
RUN groupadd -g 10001 jmv \
 && useradd -u 10001 -g 10001 -m -d /home/jmv -s /bin/bash jmv \
 && mkdir -p /home/jmv/.config \
 && chown -R 10001:10001 /home/jmv

COPY --chown=10001:10001 package.json package-lock.json ./
USER 10001:10001
RUN npm ci --omit=dev

COPY --chown=10001:10001 backend ./backend
COPY --chown=10001:10001 frontend ./frontend
COPY --chown=10001:10001 scripts ./scripts

ENV HOME=/home/jmv
USER 10001:10001
```

`compose` no necesita cambios si el `USER` está en la imagen; si se prefiere explicitud, añadir
`user: "10001:10001"` al servicio. Ojo: con `user:` explícito el `HOME` del `ENV` se respeta,
pero un `user:` numérico sin usuario en la imagen reintroduce el problema del punto 14.1.2.

### 14.3 Script de ventana (**NO EJECUTADO**)

```bash
#!/usr/bin/env bash
# A7 — migración a uid dedicado. Ejecutar SOLO en ventana. ~2-4 min de corte.
set -euo pipefail
APP=/home/johan/apps/iva-mensual
GID_DED=10001; UID_DED=10001
cd "$APP"

# 0) copia cifrada fresca y verificada ANTES de tocar nada
docker exec iva-mensual node scripts/backup-db.js
docker exec iva-mensual node scripts/verificar-backup.js --max-horas 2

# 1) grupo espejo en el host: el verificador de §13.3 sigue leyendo 750/640
sudo groupadd -g "$GID_DED" jmv-iva 2>/dev/null || true
sudo usermod -aG jmv-iva johan

# 2) build con el patch 14.2 (la imagen vieja queda etiquetada para volver)
docker image tag iva-mensual-iva-mensual:latest iva-mensual-iva-mensual:pre-a7

# 3) corte: parar, cambiar dueño del volumen, arrancar
docker compose stop iva-mensual
sudo chown -R "$UID_DED:$GID_DED" data
sudo chmod 750 data data/backups data/exports data/sii-fichas data/archivo-heredado
sudo chmod 640 data/iva_mensual.db data/iva_mensual.db-wal data/iva_mensual.db-shm
sudo chmod 600 data/backups/*.db data/*.db data/archivo-heredado/* data/backups/*.enc data/backups/*.manifest.json data/backups/*.sha256
docker compose up -d --build iva-mensual

# 4) verificación obligatoria
docker exec iva-mensual id
docker exec iva-mensual node -e '
const D=require("/app/node_modules/better-sqlite3"),fs=require("fs"),f="/app/data/.probe-a7.db";
const d=new D(f); d.pragma("journal_mode = wal"); d.exec("create table t(x)");
d.prepare("insert into t values (?)").run(1); console.log("escritura WAL:", d.prepare("select count(*) c from t").get().c); d.close();
for (const s of ["","-wal","-shm"]) { try{fs.unlinkSync(f+s)}catch{} }'
curl -fsS http://127.0.0.1:3500/api/health
/usr/bin/node /home/johan/ops-verificacion/scripts/verificar-backup.js --dir "$APP/data/backups"
# y una sincronización real del SII (chromium) para descartar 14.1.2:
docker exec iva-mensual node scripts/sincronizar-declaraciones.js 2>&1 | tail -5
```

### 14.4 Reversión

```bash
docker compose stop iva-mensual
sudo chown -R 1000:1000 /home/johan/apps/iva-mensual/data
git -C /home/johan/apps/iva-mensual checkout -- Dockerfile   # o revertir el commit del patch
docker image tag iva-mensual-iva-mensual:pre-a7 iva-mensual-iva-mensual:latest
docker compose up -d iva-mensual
```

### 14.5 Criterio de cierre de R3

`docker exec iva-mensual id` devuelve `uid=10001`, `data` es `10001:10001` en `750`, la escritura
WAL funciona, el verificador del host sigue leyendo, y un `/opt/geodaniela` comprometido
(uid 1000) **ya no** puede abrir la BD contable. Hasta entonces R3 sigue abierto.
