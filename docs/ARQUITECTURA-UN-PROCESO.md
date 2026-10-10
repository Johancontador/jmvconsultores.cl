# Arquitectura de ejecución de un solo proceso — garantías y límites

> BLOQUE 3 del plan de corrección de riesgos (auditoría 2026-10-10, R2/R3).
> Este documento declara QUÉ garantiza hoy el backend cuando corre como UN
> proceso Node (la forma en que está desplegado en el VPS con Docker) y QUÉ
> no garantiza — para que nadie confíe en supuestos implícitos.

## Estado actual (verificado en código, octubre 2026)

| Área | Antes | Ahora | Garantía tras este bloque |
|---|---|---|---|
| Sesiones | SQLite (`sessions`) desde siempre | sin cambios | ✅ Sobreviven reinicios y sirven a N procesos |
| Rate-limits | Map en proceso — un reinicio ponía los contadores a cero exactly cuando hay un ataque en curso | tabla `rate_limit` en SQLite (UPSERT por clave `scope:ip`) | ✅ Sobreviven reinicios; listos para N procesos |
| Jobs largos (histórico RCV) | Map en proceso — un reinicio a mitad PERDÍA el trabajo de 36 meses | tabla `jobs_persistentes` + checkpoint por período + reanudación al arranque | ✅ Tras reinicio se re-ejecuta solo lo que falta |
| Sync diaria | no existía | `jobs_persistentes` tipo `sync_diaria` + script de cron | ✅ Reanudable al arranque y vía `scripts/sync-diaria.js --reanudar` |
| Locks de jobs | — | latido (`actualizado_en`) + liberación de huérfanos a los 30 min | ✅ Un crash no deja el job bloqueado para siempre |
| Conciliación bancaria | emparejamiento 1↔1 estricto (cartola↔movimiento) | se mantiene REPORT-ONLY (ajuste humano §22/§9) + `teso_aplicaciones` para la aplicación fina a documentos 1↔n/n↔1 | ✅ Trazabilidad completa; jamás asignación automática ambigua |

## Qué NO garantiza esta arquitectura (límites explícitos)

1. **Escalado horizontal TODAY no está activo.** El SQLite es single-writer
   (`WAL` permite lecturas concurrentes, una escritura a la vez). Si mañana
   corre a 2+ instancias detrás de nginx, la capa de datos sigue siendo
   correcta transaccionalmente (better-sqlite3 serializa escrituras), pero el
   rendimiento se convierte en el cuello de botella y los jobsDevem correr
   con el patrón de lock ya implementado (exclusión por `clave_unicidad` +
   latido). Este documento NO afirma soporte multi-instancia verificado.
2. **Un reinicio durante la ventana entre `POST` y respuesta HTTP** (menos de
   unos ms) puede devolver error de red a un cliente aunque la operación haya
   persistido. Mitigación existente: idempotencia transversal (asientos,
   pagos, DTE, ingesta) — el cliente re-intenta sin duplicar.
3. **Timers internos** (`setInterval` para purgas) viven en el proceso: un
   reinicio las reprograma al arrancar; nada se pierde de manera permanente.
4. **El lock de job expira a los 30 min de silencio** (`JOB_LOCK_TIMEOUT_MIN`).
   Un job individual cuyo paso bloquea MÁS de 30 min sin latido puede ser
   tomado por otro proceso. Mitigación implementada: latido por período en la
   ingesta (los períodos RCV tardan segundos, no minutos).

## Cambios de código de este bloque

- `core/jobs-persistentes.js` — NUEVO: estados pendiente|ejecutando|completado|fallido|cancelado, checkpoint por período, latido, liberación de huérfanos, ventaja de unicidad con ventana de idempotencia (BLOQUE 5).
- `core/sync-diaria.js` — NUEVO: la tarea diaria por empresa (persistente, idempotente, observable).
- `scripts/sync-diaria.js` — NUEVO: disparador de cron con `--reanudar`.
- `core/rate-limit-db.js` — NUEVO: rate-limits en SQLite.
- `routes/auth.js` + `routes/sii.js` — los middleware de login/registro/password/sii-probar ahora usan rate-limit SQLite (misma semántica y límites).
- `core/cobranza.js` — NUEVO `aplicarMovimientoADocumentos` (aplicación fina 1↔n trazable) y `cobradoDeDocumento` (saldo por documento).
- `routes/tesoreria.js` — NUEVO `POST /tesoreria/movimientos/:id/aplicar` y `GET /tesoreria/documentos/:id/aplicaciones`.
- `index.js` — al arrancar: `reanudarHistoricosPendientes()` + `reanudarSyncDiaria()`.

## Procedimiento de despliegue de este bloque (sin ejecutar)

1. Backup previo de la BD (siempre, ops): `node scripts/backup-db.js` (ver DESPLIEGUE.md) u `sqlite3 data.db ".backup 'pre-bloques.db'"`.
2. `git pull` en el VPS + `npm ci` (sin dependencias NUEVAS: todo usa better-sqlite3/stdlib).
3. Reiniciar el servicio: `docker compose restart app` (o systemctl).Las migraciones (`jobs_persistentes`, `rate_limit`, `teso_aplicaciones`) son CREATE TABLE IF NOT EXISTS: corren idempotentes al arrancar.
4. Instalar el cron de sync: `30 7 * * * cd /srv/iva-mensual && /usr/bin/node scripts/sync-diaria.js >> /var/log/iva-sync.log 2>&1`.
5. Observación post-deploy: `sqlite3 data.db "SELECT id,tipo,estado,intentos,periodo_desde FROM jobs_persistentes ORDER BY id DESC LIMIT 5"` (los jobs con checkpoint y estado explícito son la fuente de verdad).

## Rollback

Los cambios son additive (tablas nuevas, sin ALTER destructivos). Volver a
la imagen anterior del backend no requiere revertir la BD: las tablas nuevas
quedan inertas; los rate-limits vuelven a Map (memoria) porque el código
antiguo no lee `rate_limit`; los jobs históricos vuelven a Map ya liberados.
