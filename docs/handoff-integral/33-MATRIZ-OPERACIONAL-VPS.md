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
> `sistema.css?v=5738e017`, envía `X-Powered-By: Express` y **no** envía HSTS.

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

**Ninguna de A1–A9 se ejecutó en F8.**

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
```

Con esa devolución se cierran las puertas G1–G8 de `29` y se decide el escenario (A–E) con
evidencia, no con supuestos.
