# 30 · Informe maestro F8 — estabilización, recuperación y madurez operacional

> **Fecha:** 2026-10-24 · **Rama:** `master` · **HEAD:** `85f93e9` · **Sin commit, sin push, sin deploy.**
> **Qué es este documento:** el estado consolidado del programa F8, con evidencia de lo
> ejecutado en local y el inventario explícito de lo que sigue bloqueado por acceso al VPS.
> El detalle de fases anteriores vive en `23` (F3), `24` (F4), `25` (F5), `27`/`28`/`29` (F6/F7);
> aquí no se repite, se referencia y se verifica.

---

## 0. Resumen para el propietario

1. **El sistema no se tocó.** Producción sigue sirviendo el build anterior; no hubo deploy,
   reinicio, migración, rotación de claves ni operación en el SII. Todo lo de esta pasada
   fue local, sobre bases de datos ficticias en `%TEMP%`.
2. **Se corrigieron tres defectos reales** que afectaban la operación diaria: el chequeo de
   salud no comprobaba la base (el contenedor podía estar «healthy» sin poder leer datos),
   los errores 500 devolvían el mensaje interno al cliente, y el servidor anunciaba
   `X-Powered-By: Express` (confirmado hoy mismo en el servidor real).
3. **La recuperación quedó demostrada otra vez, con números:** backup cifrado 0,55 s →
   verificación 0,34 s → restauración aislada 0,51 s → la aplicación abre la copia y deja
   entrar a sus usuarios. Los cinco modos de fallo (clave equivocada, clave ausente, archivo
   alterado, clave maestra distinta, integridad rota) se rechazan con mensaje y exit code.
4. **Los números de recuperación no son los de producción:** se midieron sobre 741 KB. El RTO
   real depende del tamaño de la base del VPS y sigue sin medirse (procedimiento en `32`).
5. **Sigue bloqueado lo mismo que en F7:** no se puede confirmar desde aquí la clave maestra,
   los backups del cron, los certificados por empresa ni el commit desplegado. La matriz con
   los comandos exactos, la evidencia esperada y la autorización que cada uno requiere está
   en `33`.

---

## 1. Estado del repositorio y de producción (verificado hoy)

### 1.1 Repositorio

| Dato | Valor |
|---|---|
| Rama / HEAD | `master` / `85f93e9` |
| Modificados | 25 archivos (F0–F5 + F8) |
| Sin seguimiento | 15 rutas (115 archivos con `-uall`) |
| Commits / push / deploy | **ninguno** |
| Anti-caché | 29/29 referencias de `sistema/index.html` con `?v=` = sha1 del contenido real (verificado **sin ejecutar** `seed:v`) |

### 1.2 Producción (solo lectura, `GET` públicos)

| Control | Evidencia | Lectura |
|---|---|---|
| `/api/health` | `{"ok":true,"message":"IVA Mensual API running"}` | Producción corre un build **anterior a F8** (el cuerpo nuevo trae `db` y `version`) |
| Frontend servido | `app.js?v=bdf0e607`, `sistema.css?v=5738e017` | **Distinto** del build local (`app.js` → `c1d44190`, `sistema.css` → `7bae9444`): lo construido en F0–F5 **no está desplegado** |
| `X-Powered-By` | `Express` | Confirmado en el servidor real (F8-3, corregido en local) |
| CSP / XFO / nosniff / CORP | presentes | Activos en producción |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` en `/`, `/sistema/` y `/api/health` (3/3 peticiones) | Activo en el edge. **Corrección de un dato previo de esta misma pasada:** una primera medición no lo detectó; al repetir el control 3 veces aparece en todas. Queda registrado el método, no la impresión inicial |
| HTTP plano (puerto 80) | `200` con el cuerpo de la app, **sin** `Location` | **FALLIDO**: no hay redirección a HTTPS (hallazgo P2 de `27`, vigente) |
| Commit del backend | no verificable desde aquí | **BLOQUEADO POR ACCESO** → comando en `33` §2 |

---

## 2. Lo que se corrigió en F8 (con prueba)

| ID | Defecto | Evidencia de la falla | Corrección | Prueba |
|---|---|---|---|---|
| **F8-1** | `/api/health` respondía siempre `{ok:true}`: el proceso podía estar arriba con la base bloqueada o corrupta y el contenedor seguía «healthy». El healthcheck de `docker-compose.yml` y la espera de `ops/deploy.sh` dependen de ese endpoint, así que el deploy se declaraba exitoso sin servicio real. | Código anterior: `res.json({ok:true,…})` sin tocar la base | `middleware/health.js`: `SELECT 1` por petición; 200 `{ok:true,db:'ok',version}` / **503** `{ok:false,db:'error',version}`; el error de SQLite va al log, nunca al cuerpo | `test/salud-y-errores.test.js` H1–H3 (incluye que el cuerpo no contenga `SQLITE` ni la ruta del archivo) |
| **F8-2** | El manejador de errores devolvía `err.message` al cliente: en producción eso filtra nombres de tabla, rutas de archivo y detalles de la bóveda. | `res.status(500).json({ error: err.message })` | `middleware/errores.js`: **genérico en producción**, detalle en desarrollo; siempre loguea mensaje + traza; no re-responde si `headersSent` | E1–E3 (`salud-y-errores`) |
| **F8-3** | `X-Powered-By: Express` en cada respuesta (verificado hoy en producción) | Cabecera observada por `curl` al dominio real | `app.disable('x-powered-by')` | W1 + verificación en vivo: la cabecera **ya no aparece** en el servidor local |

**Cambios de archivos:** `backend/middleware/health.js` y `backend/middleware/errores.js`
(nuevos), `backend/index.js` (cableado), `test/salud-y-errores.test.js` y
`test/invariantes-contables.test.js` (nuevos), `test/sitio-seo.test.js` (T7 actualizado al
middleware extraído: **el contrato es el mismo**, el 404 sigue antes del manejador de errores),
`package.json` (los dos archivos nuevos en la suite).

> Nota de integridad: T7 se actualizó porque la extracción cambió la forma del `app.use`, no
> para que pasara. La aserción sigue exigiendo el orden 404 → errores; si el orden se invierte,
> el test falla.

---

## 3. Suite completa

| Corrida | Resultado |
|---|---|
| Al entrar a F8 | 686/686 (exit 0) |
| Con los cambios F8 | **701/701 (exit 0), 72,1 s** |
| Pruebas nuevas | 15 (7 de salud/errores + 8 de invariantes) |
| Regresiones | **0** tras actualizar T7 con el mismo contrato |

Fragilidad encontrada y corregida en esta línea de trabajo (no en F8): `test/salud-informe.test.js`
esperaba 8 s a un job de 6 pasos que, con la suite en paralelo, tardaba 6–8 s → subió a 20 s
(sigue fallando si el job no termina). No se debilitó ninguna aserción.

---

## 4. Recuperación: ejecución real y medición (entorno aislado)

BD **ficticia** de 741 KB sembrada con `entorno-demo.js` en `%TEMP%`; claves aleatorias por
corrida, guardadas solo en el directorio temporal de la prueba.

| Paso | Comando | Resultado | Tiempo |
|---|---|---|---|
| Siembra | `DB_PATH=… entorno-demo.js` | BD con 2 empresas, 5 usuarios, 12 documentos, 6 asientos | 1,11 s |
| Backup | `backup-db.js` | `.db.enc` AES-256-GCM (`JMVBACKUP1`) + manifest + `.sha256` | **0,55 s** |
| Vigilancia | `verificar-backup.js` | `[BACKUP-CHECK] OK … (0 h, cifrada, total 2)` exit 0 | **0,34 s** |
| Restauración | `restore-db.js --dest <aislado>` | `integridad: ok`; 10 tablas con conteos (users 5, empresas 2, auditoría 44, asientos 6, líneas 14, documentos 12, períodos 3, bancos 2, suscripciones 2) | **0,51 s** |
| Restauración con secreto `v1:` | ídem, con una clave SII cifrada en la empresa 1 | `empresas_v1: 1, descifrables: 1, error: null` | **0,55 s** |
| App sobre la copia | `PORT=3597 DB_PATH=<restaurada> node backend/index.js` | `/api/health` 200 en 2 s · `/api/auth/estado` 200 · login `demo.contador` OK · `/me` devuelve **2 empresas, 38 permisos c/u** | — |

### 4.1 Modos de fallo (todos rechazan, ninguno restaura en silencio)

| Caso | Resultado |
|---|---|
| `BACKUP_ENCRYPTION_KEY` incorrecta | exit 1 — «No se pudo descifrar el backup» |
| Sin clave de backup (cwd sin `.env`) | exit 1 — «El backup está cifrado y BACKUP_ENCRYPTION_KEY no fue provista» |
| Archivo alterado en 1 byte | exit 1 — «Integridad del archivo FALLIDA: sha256 real … ≠ manifest …» |
| `SECRETOS_MASTER_KEY` distinta | exit 1 — integridad SQLite `ok` pero `descifrables: 0` con el motivo explícito |

**Hallazgo operativo (F8-5):** la CLI de restauración hace `dotenv` desde el directorio de
trabajo. Si el operador la ejecuta dentro del proyecto, toma la clave del `.env` **aunque crea
que no hay clave**; el mensaje entonces es «no se pudo descifrar» en vez de «no fue provista».
No es un defecto de seguridad (la clave sigue siendo la del entorno), pero confunde el
diagnóstico: en `32` se indica cómo verificar qué clave se está usando, sin imprimirla.

---

## 5. Invariantes contables y tributarios (`test/invariantes-contables.test.js`)

Datos sintéticos, dos empresas, módulos reales (no mocks). 8/8 en verde.

| ID | Invariante | Qué se comprueba |
|---|---|---|
| I1 | Partida doble | Un asiento descuadrado (`1000 vs 900`) se rechaza **y no deja encabezado ni líneas**; uno en cero también |
| I2 | Cuadre y folios | Cada asiento y el total de la empresa cuadran; folios `1..n` sin huecos por empresa/año |
| I3 | Reversión | El saldo vuelve exactamente al punto de partida; el original **no se borra**; la segunda reversión falla; el total sigue cuadrado |
| I4 | Aislamiento | Un asiento de la empresa B no se obtiene por id desde A y no aparece en el diario de A |
| I5 | Idempotencia | La misma clave no crea dos asientos (`IDEMPOTENCIA_CONFLICTO`), sin duplicar |
| I6 | Período cerrado | Tras cerrar 202608, un asiento en ese período falla y no inserta nada |
| I7 | Ingesta RCV | El mismo lote dos veces: `insertados 1` → `insertados 0 / duplicados 1`, una sola fila |

Cobertura existente que se apoya en lo mismo: `dashboard` (aislamiento), `dte-emision`
(no se emite ni se ve de otra empresa), `fase3`/`fase4` (cuentas y propuestas de otra empresa),
`crm-tenant`, `resumenes-consistencia`, `dte-contable` (asiento desde DTE).

---

## 6. Controles: clasificación honesta

| Control | Estado | Evidencia / límite |
|---|---|---|
| Fallo seguro sin clave maestra en producción | **VERIFICADO** (local) | `NODE_ENV=production` sin clave → `[FATAL]` + **exit 1**, sin imprimir valores |
| Fallo seguro con formato inválido | **VERIFICADO** | `test/seguridad-f5.test.js` |
| Certificado vencido / de otro RUT / ilegible bloquea emisión | **VERIFICADO** (local, `.pfx` ficticios) | `test/dte-certificado.test.js` |
| Backup cifrado + manifest + sha256 | **VERIFICADO** | §4 |
| Restauración aislada + app operando | **VERIFICADO** (BD ficticia) | §4 |
| Vigilancia de frescura/integridad con exit codes | **VERIFICADO** (local) | `verificar-backup.js` + `test/backup-vigilancia.test.js`; **no programada** |
| Health con verificación de base | **VERIFICADO** (local, 200 y 503) | §2 F8-1 |
| 500 sin fuga de internos | **VERIFICADO** (local) | §2 F8-2 |
| Cabeceras de seguridad | **VERIFICADO** en producción (CSP/XFO/nosniff/CORP/HSTS) · **FALLIDO**: HTTP plano responde 200 sin redirección | §1.2 |
| `X-Powered-By` fuera | **FALLIDO en producción** (presente) · corregido en local, se activa al desplegar | §1.2 |
| Clave maestra válida y compatible en el VPS | **BLOQUEADO POR ACCESO** | `33` §2 |
| Backups del cron recientes y restaurables | **BLOQUEADO POR ACCESO** | `33` §3 |
| Commit/imagen desplegados | **BLOQUEADO POR ACCESO** (frontend identificado por hash, backend no) | `33` §2 |
| Certificados por empresa vigentes y del RUT | **BLOQUEADO POR ACCESO** | `33` §5 |
| Copia externa cifrada | **REQUIERE AUTORIZACIÓN** (proveedor y custodia) | `31` R-01 |
| Rotación de clave maestra `v2` | **REQUIERE AUTORIZACIÓN** | `31` R-05 |
| Emisión DTE real | **NO APLICA CON EVIDENCIA**: no se emitió nada (mandato) | `24` §7 |
| SII/TGR/MercadoPago en vivo | **NO APLICA CON EVIDENCIA**: sin credenciales ni llamadas | `24` §7 |

---

## 7. Contradicciones reconciliadas

| Afirmación previa | Estado real | Acción |
|---|---|---|
| `23` §3/§9 y `25` decían **70 PNG** de F3 | `ls *.png` → **68** (47 escritorio + 7 tableta + 8 móvil + 6 informe) + 1 JSON | Corregido en `23` y `25` con el desglose |
| `23` §7 cerraba en **662/662** | Hoy **701/701** (F5 + F8 agregaron 39) | Nota de actualización en `23` |
| «El estado inicial tiene 15 archivos sin seguimiento» | Son 15 **rutas**; al expandir carpetas, 115 archivos | Se informa con `-uall` |
| `iniciar-sistema.bat` en el árbol | Duplica `iniciar.bat`, sintaxis `cmd` inválida, crea `.env` con `admin123` sin clave maestra | Documentado como no versionable; no se tocó |

---

## 8. Riesgos reducidos en F8

- **Falso «healthy»**: el healthcheck ahora distingue disponible de operable; un deploy con la
  base rota ya no se declarará exitoso.
- **Fuga de internos en 500**: cerrada en código y fijada por test.
- **Reconocimiento por cabecera**: `X-Powered-By` fuera (se activa con el próximo deploy).
- **Diagnóstico de recuperación**: los cinco modos de fallo tienen mensaje y exit code
  verificados, y el error de «clave ausente» vs «clave incorrecta» quedó documentado.

---

## 9. Bloqueos y siguientes acciones

| Bloqueo | Por qué | Siguiente acción concreta |
|---|---|---|
| Clave maestra no verificada | Requiere acceso al VPS | `33` §2 (G1/G2) |
| Backups y cron no verificados | Requiere acceso al VPS | `33` §3 |
| Commit desplegado desconocido | Requiere acceso al VPS | `33` §2 |
| Certificados por empresa | Requiere acceso o sesión autenticada | `33` §5 |
| Ventana y rollback | Requiere aprobación del propietario | `32` §5–§8 + `29` §A |

El plan de release, los criterios de aborto y el rollback de **datos** (no solo de código)
están en `32`; el registro de riesgos con dependencias y pruebas de aceptación, en `31`.

---

## 10. Limitaciones declaradas

1. Las mediciones de backup/restauración son de una BD de **741 KB**; no representan el volumen
   ni el tiempo de producción. El RTO real se mide con el procedimiento de `32` §9.
2. Todas las pruebas de recuperación usan datos **ficticios**; no se restauró ningún backup real.
3. No se validaron integraciones en vivo (SII, TGR, MercadoPago, DTE): sin credenciales y por mandato.
4. El HSTS solo se activa con `req.secure`; se documenta como hallazgo, **no** se cambió (decisión
   de infraestructura sobre el edge).
5. No se leyeron `.env`, `.pfx` ni datos tributarios de clientes en ninguna parte de esta pasada.
