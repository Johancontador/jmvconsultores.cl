# 29 · Plan de intervención controlada en producción (F7)

> **Fecha:** 2026-10-24 · **Rama:** `master` · **Commit local:** `85f93e9` + F0–F5 sin commitear
> **Naturaleza:** plan **condicionado a evidencia**. **Nada se ejecutó**: no hay
> deploy, reinicio, rotación, backup nuevo ni cambio de configuración.
>
> **Regla base:** ninguna intervención se programa sobre supuestos. Cada escenario
> tiene una **puerta** (precondición demostrada con la salida de `28`), un
> **riesgo**, una **ventana**, un **rollback** y una **prueba de aceptación**.
> Si la puerta no se abre, el escenario **no se ejecuta**.

---

## 1. Puerta de autorización (checklist previo a cualquier acción)

| # | Precondición | Evidencia que la cierra | Si falta |
|---|---|---|---|
| G1 | Clave maestra presente y con formato válido | `28` §4.1 → `definida:true` y (`hex64:true` o `longitud≥32`) | **No desplegar F5** (el arranque aborta) |
| G2 | Clave compatible con los datos cifrados | `28` §4.2 → `descifra:true` sobre una fila `v1:` real | Escenario **B** |
| G3 | Backup reciente del objetivo aprobado (propuesta ≤26 h) | `28` §6.1 | Escenario **C** (backup autorizado primero) |
| G4 | Backup íntegro y descifrable | `28` §6.2–6.3 → `sha256sum -c` OK, `descifra` y `sha_original_coincide` | Escenario **C** |
| G5 | Backup **recuperable** (restauración aislada) | `29` §C.3 con `integrity_check ok` y conteos | `NO VERIFICADO` → no se autoriza el deploy |
| G6 | Versión del backend identificada | `28` §3 → 5/5 hashes en una columna | Escenario **D** |
| G7 | Certificados vigentes y del RUT emisor | `28` §8 → `legible && !vencido && coincide_rut_empresa` | Escenario **E** (bloquear emisión afectada) |
| G8 | Ventana de mantenimiento aprobada y comunicada | Correo/acta con fecha y hora | No se ejecuta |

> Mientras G1–G5 no estén cerradas, **no se toca el servicio**. Reiniciar «para
> ver qué pasa» con una clave dudosa es la forma más rápida de quedarse sin
> acceso a las credenciales cifradas.

---

## 2. Árbol de decisión

```
Diagnóstico (28)
├── G1 falla ───────────────► B · Clave ausente/inválida (NO reiniciar)
│                               ├── B1 datos cifrados con fallback ──► rotar con la clave nueva ANTES de desplegar
│                               ├── B2 datos con clave desconocida ──► recuperar la clave o reingresar credenciales (no hay atajo)
│                               └── B3 datos en claro/legacy ────────► definir clave y re-cifrar en el arranque (F5)
├── G2 falla con G1 ok ─────► B2 (la clave no corresponde a los datos)
├── G3/G4/G5 fallan ────────► C · Backup autorizado + restore aislado ANTES de cualquier cambio
├── G6 falla ───────────────► D · Diferencias de versión (no planificar deploy hasta explicarlas)
├── G7 falla ───────────────► E · Bloquear emisión de esa empresa
└── Todo OK ────────────────► A · Despliegue F0–F5 en ventana (+ monitorización)
```

---

## 3. Escenario A — Clave válida y compatible: despliegue F0–F5

### A.1 Precondiciones
G1–G8 cerradas. Además: no hay ediciones manuales en el servidor (lo demuestra
`28` §3: si los hashes del contenedor coinciden con `85f93e9`, el árbol desplegado
no fue parcheado a mano; si no coincide con ninguna columna → escenario **D**).

### A.2 Ventana y comunicación
- **Duración estimada:** 30–45 min (build + recreación + verificaciones).
- **Franja recomendada:** día hábil, fuera de 08:00–10:00 y de 18:00–20:00; evitar
  el 1º, el 20, el 25–28 de cada mes y los cierres de F29/F22.
- **Aviso previo:** a usuarios internos (no a clientes: no hay cambio funcional
  visible más allá de la UI nueva).
- **Responsable:** quien puede hacer `git push` y ver el log del hook.

### A.3 Runbook (uno por uno, sin atajos)

| Paso | Acción | Verificación inmediata |
|---|---|---|
| A3.1 | Confirmar que G1–G8 siguen válidas (re-ejecutar `28` §4.1, §6.1) | salida registrada |
| A3.2 | Backup manual **autorizado** + verificación (`29` §C.2–C.3) | manifest, `.sha256`, restore aislado |
| A3.3 | Confirmar `BACKUP_ENCRYPTION_KEY` definida (`28` §5) | `definida:true` |
| A3.4 | Anotar el objetivo de rollback: `cat /home/johan/rollback-target.txt` **antes** del push | commit anterior registrado |
| A3.5 | `git push origin master` desde la estación (o `bash ops/deploy.sh` en el VPS con `DEPLOY_COMMIT`) | hook escribe en `deploy-hook.log` |
| A3.6 | Seguir `tail -f /home/johan/deploy-build.log` | build, recreate, health |
| A3.7 | `bash ops/estado-deploy.sh` | `ESTADO: OK` |
| A3.8 | `curl -s https://app.jmvconsultores.cl/api/health` | `{"ok":true,…}` |
| A3.9 | Login real de prueba y recorrido de 5 pantallas | sin errores de consola |
| A3.10 | `docker exec iva-mensual node scripts/verificar-backup.js` (ya desplegado) | `[BACKUP-CHECK] OK` |
| A3.11 | `GET /api/dte/empresas/<id>/config` (autenticado) | campo `certificado` con estado |

### A.4 Riesgos
| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Caída por clave ausente/inválida | Baja (G1 cerrada) | El arranque aborta y `deploy.sh` falla; rollback en A5 |
| Recreación más lenta que 300 s → health falla | Baja | Espera configurable `ESPERA_SEGUNDOS`; revisar `deploy-build.log` |
| Migraciones aditivas sobre datos reales | Baja | Backup previo (A3.2); las migraciones son `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN` idempotentes |
| Regresión funcional (UI nueva) | Media | F3 validó 39 pantallas + 686 tests; recorrido A3.9 |
| Cambio de comportamiento en `/config` | Nula | Campo aditivo |

### A.5 Rollback
1. **Código:** `cat /home/johan/rollback-target.txt` → ese commit. Desde la
   estación: `git push --force origin <commit>:master` (el hook reconstruye), o en
   el VPS `GIT_DIR=… GIT_WORK_TREE=… git checkout -f <commit> && DEPLOY_COMMIT=<commit> bash ops/deploy.sh`.
2. **Datos:** el backup de A3.2. Restaurar **sólo** si una migración corrompió algo
   (no es lo esperado: son aditivas). Restauración con `restore-db.js` a un destino
   temporal, verificación, y luego reemplazo con el servicio detenido.
3. **Claves:** no se tocaron en A; no hay rollback de claves.

### A.6 Aceptación
`estado-deploy.sh` OK · `/api/health` 200 · login y 5 pantallas sin errores ·
verificador de backup OK · `/config` devuelve `certificado` · sin `pageerror` en
consola · suite local 686/686 (previa).

---

## 4. Escenario B — Clave maestra ausente, inválida o incompatible

**No reiniciar. No cambiar la clave. No rotar a ciegas.** El orden importa porque
un error aquí puede dejar las credenciales SII, los CAF y el certificado de firma
**irrecuperables**.

### B.1 Clasificar el caso (sólo lectura)
| Caso | Cómo se detecta | Qué significa |
|---|---|---|
| **B1** Datos cifrados con el **fallback de desarrollo** | `28` §4.3 → `descifra_con_fallback:true` | Los secretos están protegidos por una clave pública del código: **riesgo crítico materializado**, pero **recuperable** |
| **B2** Datos con una clave **desconocida** | `28` §4.2 `descifra:false` y §4.3 `false` | La clave con la que se cifró no está en el entorno. Sin ella **no hay forma de leer** esos datos |
| **B3** Datos en claro (`legacy`) | `28` §4.2 `muestra:false` + filas sin prefijo `v1:` | El sistema viejo los guardó sin cifrar; la migración del arranque los cifrará con la clave nueva |
| **B4** Variable ausente pero datos con una clave real | §4.1 `definida:false` y §4.2 `descifra:false`, §4.3 `false` | La clave existe fuera del `.env` (¿gestor? ¿respaldo de configuración?) — **buscarla antes de tocar nada** |

### B.2 Procedimiento por caso

**B1 (fallback) — recuperación posible y planificada**
1. Backup autorizado + verificación (§C).
2. Generar la clave nueva **fuera del chat** y guardarla en el gestor de secretos:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` (no
   pegar la salida en ningún lado).
3. Ejecutar `scripts/rotar-master-key.js` **en una ventana**, con
   `ROTAR_NUEVA_KEY` definida en el entorno del comando. El script:
   - exige backup previo, verifica que **todos** los valores descifren con el
     fallback antes de tocar nada, re-cifra en **una transacción** y verifica
     después; si algo falla, no deja estado intermedio.
4. Definir `SECRETOS_MASTER_KEY=<nueva>` en el `.env` del host y reiniciar **con la
   versión desplegada** (que aún no exige la clave) o ya con F5 (que sí la exige:
   por eso este paso va **antes** del deploy).
5. Verificar: `28` §4.2 → `descifra:true`; luego desplegar F0–F5 (escenario A).
6. **Riesgo residual:** si el script falla a mitad, se restaura el backup de (1).
   La clave anterior (fallback) **no era secreta**: no hay nada que proteger de
   ella, sólo datos que re-cifrar.

**B2 (clave desconocida) — no hay atajo**
1. **Detenerse.** No reiniciar el servicio (sigue funcionando con la clave que
   tiene cargada en memoria; un reinicio lo dejaría sin poder descifrar).
2. Buscar la clave en: gestor de secretos, sobre físico, respaldo de
   configuración, historial del deploy, otra máquina del operador. **Nunca** en el
   chat ni en documentos del repositorio.
3. Si aparece: definirla en el `.env`, verificar §4.2, y sólo entonces planificar
   una rotación controlada (formato `v2`, doc `26` §4).
4. Si **no** aparece: los secretos son irrecuperables. Plan de reingreso, por
   empresa: claves SII (el cliente las informa), CAF (re-descargar del SII; los
   folios ya consumidos no se recuperan), certificado de firma (reinstalar el
   `.pfx` del cliente). Comunicación previa con cada cliente afectado.
5. Mientras no se resuelva: **no desplegar F5** (abortaría) y **no rotar**.

**B3 (legacy en claro)**
1. Backup + verificación.
2. Definir `SECRETOS_MASTER_KEY` (nueva, en el gestor).
3. Desplegar F5 en ventana: `migracionesBovedaClientes` cifra el legado al
   arrancar, con round-trip previo, transacción y guard post-commit (si queda algo
   en claro, **lanza** y no arranca).
4. Aceptación: `28` §4.2 `descifra:true` y 0 filas sin prefijo `v1:`.

**B4 (variable ausente con clave real perdida)**
Igual que B2 pero con la particularidad de que el sistema **ya está** corriendo
sin la variable en el `.env` (quizá se inyectó por `docker run -e`). Antes de
concluir nada: `docker inspect` (nombres, no valores) y `docker exec printenv`
(longitud) para ver si el contenedor **sí** la tiene aunque el `.env` no.

### B.3 Aceptación
`28` §4.1 `definida:true` **y** §4.2 `descifra:true` · sin claves en claro ·
backup post-rotación verificado · documentado en el acta con fecha y responsable
(**sin el valor de la clave**).

---

## 5. Escenario C — Sin backup recuperable: respaldo autorizado previo

### C.1 Cuándo aplica
`28` §6 da `FALLIDO`, `NO VERIFICADO`, o la copia más reciente es más vieja que el
objetivo. También si nunca se probó un restore de **ese** backup.

### C.2 Procedimiento (requiere autorización explícita: **escribe**)
1. Aviso: se crea una copia nueva; la retención puede borrar copias viejas
   (`BACKUP_RETENCION`, default 30). Si hay pocas copias, subir temporalmente el
   valor para no perder historia.
2. `docker exec iva-mensual node scripts/backup-db.js` (o el cron equivalente).
3. Verificar: manifest + `.sha256` + `sha256sum -c` + descifrado en memoria
   (`28` §6.3). **Nunca** dejar el `.db` plano en el volumen.
4. **Restauración aislada** en un directorio temporal del host (no en `data/`):
   `node scripts/restore-db.js --backup <…>.db.enc --dest /tmp/restore-<fecha>`
   con `BACKUP_ENCRYPTION_KEY` y `SECRETOS_MASTER_KEY` **desde el gestor** (no
   pegarlas en el chat).
5. Aceptación: `[RESTORE] OK`, `integridad SQLite: ok`, 10 tablas críticas con
   conteos > 0 y `claves` con `error:null` y `descifrables = empresas_v1 + clientes_v1`.
6. Archivar la salida (sin secretos) como evidencia del mes.

### C.3 Riesgos
| Riesgo | Mitigación |
|---|---|
| La retención borra copias valiosas al crear una nueva | Subir `BACKUP_RETENCION` antes; confirmar espacio |
| El restore se escribe por error sobre producción | `--dest` en `/tmp`; nunca `data/` |
| La clave del backup no está disponible | Verificar `28` §5 antes de empezar |
| Copia que «existe» pero no restaura | Por eso el criterio es la restauración, no el archivo |

**Sin C.2 y C.3 no se autoriza ningún cambio en la aplicación.**

---

## 6. Escenario D — Versión del backend distinta o desconocida

### D.1 Con la tabla de hashes (`28` §3)

| Resultado | Interpretación | Acción |
|---|---|---|
| 5/5 = `85f93e9` | Producción corre la línea base exacta | Deploy F0–F5 = avance conocido (escenario A) |
| 5/5 = working tree | Ya hay cambios locales desplegados (no esperado) | Revisar `deploy-hook.log`; no volver a desplegar hasta entender qué se subió |
| Mixto | Build intermedio o edición manual | `git log` del repo bare + log del hook; **no** planificar |
| Ninguno | Imagen construida desde otro árbol | `docker inspect` (labels/imagen) y reconstruir la trazabilidad |

### D.2 Si hay ediciones manuales en el servidor
El hook hace `git checkout -f master`: **descarta** cambios manuales. Antes de
desplegar hay que extraerlos (diff contra `85f93e9`) y decidir si se integran al
repositorio. Sin eso, el deploy los borra sin aviso.

### D.3 Aceptación
Backend identificado por hash **y** frontend identificado por `?v=` (F6) ·
`deploy-state.json` coherente · diferencias explicadas por escrito.

---

## 7. Escenario E — Certificados ausentes, vencidos o de otro RUT

### E.1 Con `28` §8 (pre-deploy) o `/config` (post-deploy)
| Resultado | Acción |
|---|---|
| `legible:false` | El `.pfx` o su contraseña no descifran: reinstalar certificado de esa empresa |
| `vencido:true` | **Bloquear emisión** de esa empresa hasta cargar uno vigente |
| `dias ≤ 30` | Avisar al cliente y programar la renovación |
| `coincide_rut_empresa:false` | **Bloquear**: el certificado es de otro contribuyente |
| `coincide_rut_empresa:null` | Identidad **NO VERIFICADA**: con F5 desplegado se bloquea en producción; sin F5, bloquear por procedimiento |

### E.2 Cómo bloquear sin tocar código
No hay interruptor por empresa en el build actual. El bloqueo es **operativo**:
no emitir desde esa empresa, registrar el motivo y avisar al cliente. Con F5
desplegado, el bloqueo pasa a ser técnico (vencido/ajeno/ilegible) y la identidad
sin RUT queda bloqueada en producción.

### E.3 Aceptación
Todas las empresas emisoras con `legible && !vencido && coincide_rut_empresa`, o
bloqueo documentado por empresa.

---

## 8. Riesgos transversales y qué **no** hacer

| No hacer | Por qué |
|---|---|
| Reiniciar «para ver si arranca» con clave dudosa | Si la clave no corresponde, el servicio queda sin poder descifrar |
| Rotar la clave antes de un backup verificado | Un fallo deja secretos irrecuperables |
| Desplegar F5 sin G1/G2 | El contenedor no arranca (fallo seguro) y hay caída |
| Restaurar «por si acaso» sobre `data/iva_mensual.db` | Pérdida de datos posteriores al backup |
| Copiar el `.env` o un `.pfx` a un chat, correo o issue | Exposición irreversible |
| Subir el `.db` plano a un destino externo | Fuga de datos de clientes |
| Forzar el push sin anotar `rollback-target.txt` | Sin vuelta atrás conocida |

---

## 9. Post-intervención (P1/P2 del plan `26`)

1. Programar `verificar-backup.js` (03:15) + alerta (`MAILTO` o webhook) y
   **probar** que la alerta llega.
2. Copia externa cifrada y custodia de claves (procedimiento `26` §5).
3. Redirección HTTP→HTTPS (Cloudflare "Always Use HTTPS" o nginx) — P2.
4. `x-powered-by` fuera, mensaje 500 genérico (N-1), CSP sin `unsafe-inline` — P2/P3.
5. Rotación `v2` cuando se apruebe (`26` §4).

---

## 10. Autorizaciones que se requieren (una por una)

| # | Autorización | Para qué | Riesgo si se salta |
|---|---|---|---|
| 1 | Acceso de solo lectura al VPS | Ejecutar `28` | Se decide sobre supuestos (prohibido) |
| 2 | Ejecutar un backup manual | Cubrir G3 | Cambios sin red de seguridad |
| 3 | Restauración aislada de prueba | Cubrir G5 | «Backup que nunca se restauró» |
| 4 | Definir/rotar la clave maestra (si B) | Salir del fallback | Secretos con clave pública |
| 5 | Ventana de mantenimiento + push | Desplegar F0–F5 | Caída sin aviso ni rollback |
| 6 | Configurar alertas y copia externa | P1 | Fallo silencioso (ya ocurrió) |

**Ninguna se solicitó por chat ni se ejecutó.** Este documento queda a la espera de
que el administrador autorizado cierre G1–G8 con la salida de `28` y apruebe el
escenario correspondiente.

---

## 11. Criterio de «listo para desplegar»

Se considera autorizable cuando, **con evidencia adjunta**:

1. Clave maestra presente, válida y **compatible** (§B.3 / `28` §4).
2. Backup reciente, íntegro, descifrable y **restaurado en aislado** (§C).
3. Backend identificado por hash y frontend por `?v=` (§D).
4. Certificados: vigentes o bloqueo documentado por empresa (§E).
5. Ventana aprobada, rollback anotado y responsable disponible.
6. Alerta de backup definida para activarse inmediatamente después.

Hasta entonces el estado correcto es: **producción operativa en su versión actual,
sin intervención**, con los riesgos documentados en `25`, `27` y este plan.
