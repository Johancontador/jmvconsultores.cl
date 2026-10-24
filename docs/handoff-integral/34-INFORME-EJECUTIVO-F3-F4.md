# 34 · Informe ejecutivo F3 + F4 (validación real y continuidad operativa)

> **Fecha:** 2026-10-24 · **Rama:** `master` · **HEAD:** `85f93e9`
> **Nota:** este informe se escribió al cerrar F3/F4; el estado consolidado posterior está
> en `30` (F8). Se conserva por su valor de evidencia de esa fase.
>
> **Naturaleza:** informe de cierre de fase. **Sin commit, sin push, sin deploy,
> sin migraciones y sin operaciones en SII/TGR/DTE/MercadoPago.**
> El detalle técnico vive en `23` (F3) y `24` (F4); este documento responde los
> diez puntos del encargo con la evidencia y sus límites.

---

## 1. Estado Git inicial y final

| Momento | Estado |
|---|---|
| Al empezar | `HEAD = 85f93e9` · 25 archivos modificados · 15 rutas sin seguimiento en `git status` (115 archivos al expandirlas con `-uall`) |
| Al terminar | **idéntico**: `HEAD = 85f93e9`, los mismos 25 modificados y los mismos archivos sin seguimiento |
| `git log` | Sin commits nuevos en la rama |
| Remotos | `github` y `vps` configurados; **no se ejecutó ningún `push`** |

Trazabilidad: durante la sesión se crearon tres commits locales para consolidar
F0–F5 y se deshicieron con `git reset 85f93e9` a pedido del responsable. El árbol
de trabajo y el historial quedaron como estaban; no se descartó ningún cambio.

---

## 2. Evidencia visual real

- **Dónde:** `docs/handoff-integral/capturas-f3/` → **68 PNG + `informe-f3.json`** (69 archivos; verificado con `ls *.png | wc -l`).
- **Cómo se generó:** `node scripts/validacion-pre-produccion/capturas-f3.js`, contra un servidor local con **BD ficticia en `%TEMP%`** (`entorno-demo.js`), no contra `data/iva_mensual.db`.
- **Máquina:** Chrome real vía `puppeteer-core` (ya era dependencia; no se agregó ninguna).
- **Aislamiento, según el propio informe:** `base: http://127.0.0.1:3599` y `db: %TEMP%\jmv-f3\demo.db` — ni el puerto ni la base de producción.
- **Métricas por captura:** título, breadcrumb, ítem de menú activo, empresa/período del header, `error_visible`, desbordes horizontales, textos recortados, tablas con scroll propio y errores de consola.
- **Corrida post-correcciones:** `pantallas 39 · responsive 14 · recorridos 7 · errores de consola [] · con defectos: ninguna`.

Corrección de evidencia aplicada en esta pasada: `23` (§3, §9, §10) y `25` decían
**70 PNG**; el conteo real es **68** (47 escritorio + 7 tableta + 8 móvil + 6 del
informe imprimible). La diferencia no es cosmética: 47 escritorio = 39 pantallas
+ 8 capturas de detalle (vistas completas, media `print`, menú acordeón, ruta
inexistente, ruta restringida).

---

## 3. Pantallas y recorridos probados

**Pantallas (39 escritorio · 7 tableta · 7 móvil):** inicio, centro de
aplicaciones, alertas; documentos, libros, DTE, configuración DTE;
automatización, propuestas, asientos, memoria, activos, cierre; salud, analítica,
calculadora de IVA, informe imprimible de Salud (6 páginas); tesorería, cobranza;
reportes y los 6 reportes fuera de menú (comprobación, balance 8, situación,
resultados, clasificado, NIIF), cuentas de clientes y proveedores; portal del
cliente (inicio, ventas, cartera, cotizaciones, costos); CRM, portafolio,
administración, auditoría, integraciones, suscripción.

**Recorridos:** 7 automatizados y registrados en `informe-f3.json` (login real
contra el servidor aislado, menú área → función, abrir un área cierra las demás,
anchor directo con filtros `#documentos?estado=PENDIENTE`, informe imprimible de
Salud, ruta restringida por rol `#crm` con rol tesorería, menú móvil a 390 px) y
5 verificados en la inspección pantalla a pantalla (cambio de módulo y regreso,
período en el hash, detalle de documento y de asiento, acciones de reportes, ruta
inexistente).

---

## 4. Defectos encontrados y corregidos

10 defectos (F3-1 … F3-10), todos reproducidos antes de corregir, con captura y
test de regresión en `test/ux-f3-validacion.test.js`:

| Severidad | Defectos |
|---|---|
| **Alto** | F3-1 marca JMV invisible en tema claro · F3-3 KPI de Tesorería en $0 (mes del servidor en vez del período) · F3-4 nota «índice favorable» con índice Crítica 34/100 · F3-5 alta de activo preseleccionando CAJA · F3-7 dock móvil tapando el menú · F3-8 chip «Conectado» sin clave SII |
| **Medio** | F3-2 descripciones derramadas sobre la tarjeta vecina |
| **Bajo** | F3-6 RUT/fechas partidos · F3-9 badge de área restringida sin explicación · F3-10 `aria-current` ausente en el ítem activo |

**Riesgo residual:** ninguno de estos defectos queda abierto; F3-4 y F3-3 eran
los de mayor impacto (una afirmación tributaria falsa y una cifra contable
engañosa) y quedaron fijados por test. Lo que **no** se corrigió por ser decisión
de producto: las 6 vistas fuera de menú no marcan ítem activo en el sidebar
(contrato de F0, documentado en `23` §5.1).

---

## 5. Suite completa, antes y después

| Momento | Resultado |
|---|---|
| Línea base reportada al entrar a F3 | 652/652 (cierre de F2; no se re-ejecutó como paso previo) |
| Al cerrar F3/F4 | **662/662**, exit 0 (10 regresiones nuevas) |
| Hoy (post F5, re-verificado) | **686/686**, exit 0 — dos corridas: 70,8 s y 106,8 s |

Ninguna aserción existente se eliminó ni se debilitó. Las 24 pruebas nuevas
respecto de 662 son de F5 (`seguridad-f5`, `dte-certificado`,
`backup-vigilancia`).

---

## 6. Confirmación de no intervención externa

| Afirmación | Cómo se sostiene |
|---|---|
| No hubo deploy ni push | `HEAD` sigue en `85f93e9`; no se ejecutó `git push`; no se tocó el hook ni el VPS |
| No hubo migraciones ni cambios de datos productivos | El servidor de validación usó `DB_PATH` en `%TEMP%` y una BD sembrada por `entorno-demo.js`; `data/` no se abrió |
| No se operó en SII/TGR/MercadoPago/DTE | La BD ficticia tiene `clave_sii = ''`; ninguna corrida hizo petición saliente real (los tests stubean `fetch`) |
| No se tocaron claves ni credenciales | No se rotó, leyó ni copió ningún secreto; los `.pfx` de test son ficticios generados con `node-forge` |
| Las comprobaciones de runtime de hoy fueron locales | Arranque en producción sin clave → `exit 1` con mensaje accionable; arranque en desarrollo → `/api/health` 200 en 4 s; ambos con BD en `/tmp` y puerto propio, procesos terminados al finalizar |

---

## 7. Cobertura real de respaldos y recuperación

**Cubre:** `data/iva_mensual.db` completo por la API online de better-sqlite3
(consistente con WAL y servidor en marcha), incluidos CAF y certificados
cifrados, DTE emitidos, asientos, tesorería, jobs y auditoría.

**No cubre (`24` §2):** `data/sii-fichas/`, `data/certificados-tgr/` (copias de
evidencia, reproducibles desde el SII/TGR) y **`.env`** (claves fuera del
respaldo: es el riesgo R-5).

**Cifrado e integridad:** AES-256-GCM (`JMVBACKUP1`) con round-trip verificado
antes de borrar el archivo plano; manifest + `.sha256`; retención 30. Sin
`BACKUP_ENCRYPTION_KEY` el backup se escribe **sin cifrar y con aviso** — no
falla.

**Recuperación probada (entorno aislado, BD ficticia, 2026-10-24):** 7 casos —
restore correcto (`integridad: ok`, 10 tablas, `descifrables = empresas_v1`),
clave de backup incorrecta, clave ausente, archivo alterado en 1 byte, clave
maestra distinta y **la aplicación operando contra la copia restaurada** (login y
`/me` 200 en el puerto 3598). Los 5 modos de fallo se rechazan con mensaje.

**No verificado:** restaurar un backup **real de producción**, el tiempo de
restauración con el volumen real y un restore en un host limpio. Y el hueco
operativo sigue abierto: el cron estuvo **7 noches sin generar copias** sin que
nada avisara (de ahí `backup-vigilancia.js` + `verificar-backup.js` de F5, que
aún no están programados).

---

## 8. Estado de cada integración (`24` §7)

| Integración | Código | Tests / mocks | Real |
|---|---|---|---|
| SII — RCV, sesión, ficha | Sí | Sí (respuestas simuladas) | **NO VERIFICADO** |
| SII — TGR (deuda fiscal) | Sí | Sí | **NO VERIFICADO** |
| Emisión DTE | Sí | Sí (adaptador falso) | **NO VERIFICADO** (no se emitió nada) |
| MercadoPago | Sí | Parcial (`saas3`) | **NO VERIFICADO** |
| Cartolas bancarias (carga de archivo) | Sí | Sí | **NO VERIFICADO** con archivo real |
| Geo Daniela (receptor de asientos) | Sí | Sí (payloads de ejemplo) | **NO VERIFICADO** (no hay emisor conectado) |
| Generación de PDF | Vía impresión del navegador | Sí (HTML del informe) | **Verificado en navegador** con media `print`; no en impresora/visor externo |

Regla aplicada: un test verde **no** se cuenta como integración operativa.

---

## 9. Archivos modificados y documentos

**Código (F3):** `frontend/sistema/{app.js, sistema.css, index.html, views-fiscal.js,
views-conta.js, views-teso.js, views-activos.js, views-centro.js, views-salud.js,
views-portal.js}`, `backend/core/{tesoreria.js, salud-tributaria.js,
informe-salud-html.js, centro-apps.js}`, `backend/routes/tesoreria.js`.

**Herramientas nuevas:** `scripts/validacion-pre-produccion/{capturas-f3.js,
entorno-demo.js}`, `test/ux-f3-validacion.test.js`.

**Documentos:** `23` (actualizado: conteo real de capturas y suite vigente), `24`,
`25` (conteo de capturas), este `34`.

---

## 10. Riesgos críticos y plan recomendado

| Prioridad | Riesgo | Acción |
|---|---|---|
| **P0** | `SECRETOS_MASTER_KEY` ausente → clave de desarrollo pública (R-3) | Desplegar F5-B (ya implementado y probado localmente: sin clave el arranque aborta) — requiere cerrar G1/G2 del plan `29` |
| **P0** | Backups en el mismo volumen y **7 noches sin copia** sin alerta (R-1, R-2) | Verificar el cron en el VPS; programar `verificar-backup.js` con alerta real; copia externa cifrada |
| **P1** | Emisión DTE sin validar certificado vencido/ajeno | F5-D ya bloquea localmente; desplegarlo y revisar `/config` por empresa |
| **P1** | `.env` fuera del respaldo y sin custodia (R-5) | Gestor de secretos + procedimiento de recuperación escrito y probado |
| **P2** | Sin rotación de clave maestra (R-4) | Formato `v2` + re-cifrado por lotes (`26` §4) |
| **P2** | HTTP→HTTPS sin redirección; CSP con `unsafe-inline` | Endurecimiento P2 de `27` |

**Recomendación:** el paso siguiente no es más código local. Es ejecutar el
paquete de diagnóstico `28` (solo lectura) en el VPS para cerrar G1–G8 y recién
entonces programar el despliegue con el runbook de `29` §A. Cualquier despliegue
antes de eso se hace a ciegas sobre la clave maestra y los respaldos.

---

## Limitaciones declaradas

1. Sin acceso al VPS: no se verificaron clave maestra, cron, copias, permisos,
   commit desplegado ni certificados de las empresas.
2. Portal del cliente probado con el usuario demo (acceso completo), no con un
   cliente restringido real.
3. Accesibilidad revisada de forma dirigida (foco, `aria-*`, contraste), no con
   una auditoría WCAG ni lector de pantalla.
4. El informe imprimible se capturó con la emulación `print` de Chrome.
5. Todas las cifras de la validación son ficticias: no se afirma exactitud
   tributaria ni conformidad con el SII.
