'use strict'
/**
 * A5 — PLANIFICADOR DE LA COPIA EXTERNA A CLOUDFLARE R2 (S3-compatible).
 *
 * Este módulo NO habla con la red ni con `rclone`: construye y valida los
 * argumentos. Ejecutarlos es una decisión aparte (`scripts/respaldo-r2.js
 * --ejecutar`), que nunca corre por defecto.
 *
 * QUÉ SE COPIA Y QUÉ NO
 *   sí: *.db.enc, *.manifest.json, *.sha256   (ya cifrados con JMVBACKUP1)
 *   no: *.db, *.db-wal, *.db-shm, .env, data/sii-fichas
 *   Copiar un `.db` en claro al remoto anularía todo el trabajo de cifrado.
 *
 * SOBRE `--immutable` (importante, sin adornos)
 *   Evita que una copia SOBRESCRIBA un objeto existente distinto: protege de una
 *   corrupción silenciosa del respaldo y de un reenvío con contenido cambiado.
 *   NO protege contra borrado ni contra escritura maliciosa: quien tenga las
 *   credenciales del bucket puede borrar igual, y ninguna opción de `rclone`
 *   cambia eso. La protección real frente a borrado es externa al cliente:
 *   credenciales de mínimo privilegio, versionado del bucket y una copia de la
 *   clave de cifrado fuera del mismo proveedor.
 *
 * SOBRE `sync` (prohibido)
 *   `rclone sync` borra en el destino lo que no exista en el origen. Un backup
 *   local perdido se propagaría al remoto en la misma noche. Aquí solo se emite
 *   `copy` (aditivo) y la purga va por `delete --min-age`, acotada y con tope.
 *
 * Módulo puro (sin fs, sin red, sin proceso): testeable.
 */

const REMOTOS_VETADOS = ['gdrive_johan']
const INCLUIR = ['*.db.enc', '*.manifest.json', '*.sha256']
const EXCLUIR = ['*.db', '*.db-wal', '*.db-shm', '*.env']
const PATRON_RETENCION = 'iva_mensual_*'

/** Cuota gratuita de R2 (2026): 10 GB-mes, 1 M operaciones clase A, 10 M clase B, egreso gratis. */
const CUOTA_LIBRE_BYTES = 10 * 1000 ** 3
const PRECIO_GB_MES_USD = 0.015
const CUOTA_LIBRE_CLASE_A = 1_000_000
const CUOTA_LIBRE_CLASE_B = 10_000_000

function normalizarRemoto(valor) {
  return String(valor == null ? '' : valor).trim().replace(/:+$/, '')
}

/**
 * Valida y normaliza el destino. Devuelve `ok:false` con motivos legibles en vez
 * de lanzar, para que el CLI pueda imprimir todo lo que está mal de una vez.
 */
function validarConfiguracion({ remoto, bucket, prefijo = '' } = {}) {
  const errores = []
  const r = normalizarRemoto(remoto)
  const b = String(bucket == null ? '' : bucket).trim()
  const p = String(prefijo == null ? '' : prefijo).trim().replace(/^\/+|\/+$/g, '')

  if (!r) errores.push('falta el nombre del remoto de rclone')
  else if (!/^[a-z][a-z0-9_-]{1,30}$/.test(r)) errores.push(`nombre de remoto inválido: ${r} (minúsculas, dígitos, - y _)`)
  else if (REMOTOS_VETADOS.includes(r)) errores.push(`el remoto ${r} pertenece a otra aplicación: usa uno dedicado a JMV`)

  if (!b) errores.push('falta el bucket')
  else if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(b)) errores.push(`bucket inválido: ${b}`)

  if (p && (p.includes('..') || p.startsWith('.'))) errores.push(`prefijo inválido: ${p}`)

  return {
    ok: errores.length === 0,
    errores,
    normalizado: { remoto: r, bucket: b, prefijo: p, destino: errores.length ? null : `${r}:${b}${p ? '/' + p : ''}` },
  }
}

/** `remoto:bucket/prefijo`, con el prefijo opcional. */
function destinoRemoto({ remoto, bucket, prefijo = '' }) {
  const r = normalizarRemoto(remoto)
  const p = String(prefijo || '').trim().replace(/^\/+|\/+$/g, '')
  return `${r}:${bucket}${p ? '/' + p : ''}`
}

function argumentosComunes() {
  const args = []
  for (const patron of INCLUIR) args.push('--include', patron)
  for (const patron of EXCLUIR) args.push('--exclude', patron)
  args.push('--checksum', '--immutable', '--transfers', '4')
  return args
}

/** Copia aditiva de los backups cifrados. Nunca `sync`. */
function comandoCopia({ origen, destino }) {
  return {
    nombre: 'copia-backups',
    descripcion: 'Sube solo *.db.enc / *.manifest.json / *.sha256 (aditivo, sin sobrescribir)',
    argv: ['copy', origen, destino, ...argumentosComunes(), '--log-level', 'INFO'],
  }
}

/** Los estados heredados van a un prefijo propio: no se mezclan con la rotación diaria. */
function comandoCopiaHeredado({ heredado, destino }) {
  return {
    nombre: 'copia-heredado',
    descripcion: 'Sube el archivo heredado (estados del 2–9 oct ya cifrados) a /heredado',
    argv: ['copy', heredado, `${destino}/heredado`, ...argumentosComunes(), '--log-level', 'INFO'],
  }
}

/** Comprobación de que todo lo local está en el remoto (nunca al revés). */
function comandoVerificacion({ origen, destino }) {
  return {
    nombre: 'verificacion-espejo',
    descripcion: 'Comprueba que cada backup local exista igual en el remoto (solo un sentido)',
    // Sin `--size-only`: se comparan hashes (rclone los toma del metadato del objeto
    // en R2, no descarga contenido), así un objeto remoto dañado no pasa por bueno.
    argv: ['check', origen, destino, '--one-way', '--include', '*.db.enc'],
  }
}

/**
 * Purga remota por antigüedad. `--min-age` actúa sobre la fecha de subida, y los
 * tres objetos de un mismo stamp se suben juntos, así que envejecen igual y se
 * van en la misma corrida (no quedan manifiestos huérfanos).
 *
 * El tope `--max-delete` es una red de seguridad: si alguien deja `--min-age` en
 * un valor equivocado, la peor corrida borra 10 objetos, no el bucket entero.
 */
function comandoRetencion({ destino, diasRetencion = 90, maxBorrado = 10 }) {
  return {
    nombre: 'retencion-remota',
    descripcion: `Purga lo subido hace más de ${diasRetencion} días (tope ${maxBorrado} objetos por corrida)`,
    argv: [
      'delete',
      destino,
      '--min-age',
      `${diasRetencion}d`,
      '--include',
      PATRON_RETENCION,
      '--max-delete',
      String(maxBorrado),
      '--log-level',
      'INFO',
    ],
  }
}

/**
 * Plan completo. `solo` permite ejecutar un comando suelto (p. ej. la retención).
 * @returns {{ok:boolean, errores:string[], destino:string|null, comandos:object[], advertencias:string[]}}
 */
function construirPlan({ origen, heredado, remoto, bucket, prefijo = '', diasRetencion = 90, maxBorrado = 10, solo = null } = {}) {
  const validacion = validarConfiguracion({ remoto, bucket, prefijo })
  const errores = [...validacion.errores]
  if (!origen) errores.push('falta la carpeta de backups de origen')
  if (!heredado) errores.push('falta la carpeta del archivo heredado')
  if (!Number.isFinite(diasRetencion) || diasRetencion < 31) errores.push('la retención remota no puede ser menor que 31 días')
  if (!Number.isFinite(maxBorrado) || maxBorrado < 1) errores.push('--max-delete debe ser al menos 1')
  if (errores.length) return { ok: false, errores, destino: null, comandos: [], advertencias: [] }

  const destino = validacion.normalizado.destino
  const comandos = [
    comandoCopia({ origen, destino }),
    comandoCopiaHeredado({ heredado, destino }),
    comandoVerificacion({ origen, destino }),
    comandoRetencion({ destino, diasRetencion, maxBorrado }),
  ].filter((c) => !solo || c.nombre === solo)

  if (!comandos.length) return { ok: false, errores: [`no existe el comando ${solo}`], destino, comandos: [], advertencias: [] }

  const advertencias = [
    '`--immutable` evita sobrescrituras accidentales; NO impide que alguien con las credenciales borre el contenido.',
    '`copy` es aditivo: nunca se usa `sync`, que propagaría al remoto la pérdida de un backup local.',
    'La clave BACKUP_ENCRYPTION_KEY no viaja nunca al remoto; sin ella el bucket no es recuperable.',
  ]

  return { ok: true, errores: [], destino, comandos, advertencias }
}

/** Consumo de operaciones estimado (una corrida diaria de `copy` + `check`). */
function estimarOperaciones({ objetosPorCopia = 3, corridasPorMes = 30 } = {}) {
  // Clase A (escrituras y listados): una por objeto subido + un par de listados.
  const claseA = corridasPorMes * (objetosPorCopia + 2)
  // Clase B (lecturas/heads): el `check` compara contra el remoto.
  const claseB = corridasPorMes * (objetosPorCopia + 1)
  return {
    claseA,
    claseB,
    dentroCuotaLibre: claseA <= CUOTA_LIBRE_CLASE_A && claseB <= CUOTA_LIBRE_CLASE_B,
  }
}

/**
 * Almacenamiento y costo. `metadatosPorCopiaBytes` cubre manifest + .sha256
 * (~650 B reales; se redondea hacia arriba).
 */
function estimarAlmacenamiento({ tamanoDiarioBytes, diasRetencion = 90, heredadoBytes = 0, metadatosPorCopiaBytes = 800 } = {}) {
  if (!Number.isFinite(tamanoDiarioBytes) || tamanoDiarioBytes <= 0) throw new Error('tamanoDiarioBytes debe ser mayor que 0')
  if (!Number.isFinite(diasRetencion) || diasRetencion <= 0) throw new Error('diasRetencion debe ser mayor que 0')

  const copias = diasRetencion
  const bytesCopias = copias * (tamanoDiarioBytes + metadatosPorCopiaBytes)
  const totalBytes = bytesCopias + heredadoBytes
  const gb = totalBytes / 1e9
  const excesoGb = Math.max(0, gb - CUOTA_LIBRE_BYTES / 1e9)
  // Mayor tamaño diario que todavía cabe en la cuota libre con esta retención.
  const tamanoDiarioMaximo = Math.floor((CUOTA_LIBRE_BYTES - heredadoBytes) / copias) - metadatosPorCopiaBytes
  return {
    copias,
    bytesCopias,
    heredadoBytes,
    totalBytes,
    gb: Math.round(gb * 100) / 100,
    gib: Math.round((totalBytes / 1024 ** 3) * 100) / 100,
    cuotaLibreGb: CUOTA_LIBRE_BYTES / 1e9,
    dentroCuotaLibre: totalBytes <= CUOTA_LIBRE_BYTES,
    excesoGb: Math.round(excesoGb * 100) / 100,
    // Tres decimales a propósito: por encima de la cuota, el exceso típico cuesta
    // fracciones de centavo; redondear a 2 decimales lo mostraría como "0,00" y
    // haría creer que el exceso es gratis.
    costoMensualUsd: Math.round(excesoGb * PRECIO_GB_MES_USD * 1000) / 1000,
    tamanoDiarioMaximo,
    operaciones: estimarOperaciones(),
  }
}

module.exports = {
  REMOTOS_VETADOS,
  INCLUIR,
  EXCLUIR,
  PATRON_RETENCION,
  CUOTA_LIBRE_BYTES,
  PRECIO_GB_MES_USD,
  normalizarRemoto,
  validarConfiguracion,
  destinoRemoto,
  comandoCopia,
  comandoCopiaHeredado,
  comandoVerificacion,
  comandoRetencion,
  construirPlan,
  estimarOperaciones,
  estimarAlmacenamiento,
}
