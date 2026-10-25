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
 * SOBRE LA PURGA (inventario primero, borrado después)
 *   Cada copia son tres objetos (`.db.enc`, `.manifest.json`, `.sha256`), así que
 *   una corrida semanal deja 21 objetos nuevos en condiciones de purga. Un tope
 *   menor que ese ritmo no converge: la cola crece para siempre y la retención
 *   de 90 días deja de cumplirse. `construirPlan` rechaza ese caso y
 *   `estimarPurga` lo demuestra con una simulación.
 *
 *   El tope NO se aplica con `rclone delete --max-delete`: cuando los objetos
 *   elegibles superan el tope, rclone borra exactamente N y NO TERMINA (medido
 *   con 1.74.3: 30 elegibles con tope 6 quedó colgado). Por eso el flujo es
 *   inventario (`lsjson --min-age`) → decisión en memoria → `delete` con una
 *   lista EXPLÍCITA de objetos (`--files-from-raw`). Si el inventario supera el
 *   tope, no se borra NADA: la corrida falla con el número exacto y el operador
 *   decide subir el tope de forma explícita. `analizarPurga` además exige que
 *   cada sello aporte sus tres objetos: borrar un sello a medias deja una copia
 *   irrestaurable.
 *
 * SOBRE EL ALCANCE DE LA PURGA
 *   `PATRON_RETENCION` empieza por `/`: rclone solo lo aplica en el primer nivel
 *   del prefijo, de modo que `heredado/…` (archivo del 2–9 oct) queda fuera del
 *   inventario. Verificado con rclone 1.74: sin la barra el patrón también
 *   alcanza los objetos del subdirectorio. La lista explícita de purga solo
 *   contiene nombres de la raíz, y `verificarPurga` falla si aparece cualquier
 *   objeto de subdirectorio o un sello partido.
 *
 * SOBRE LA VERIFICACIÓN
 *   `rclone check` compara hashes; `rclone lsjson` permite auditar que cada
 *   sello tenga sus tres objetos (uno sin manifiesto no es restaurable).
 *
 * SOBRE LOS TIEMPOS
 *   Todo comando lleva `timeoutMs` y el CLI lo pasa a `spawnSync`: un rclone
 *   colgado no puede dejar el cron esperando para siempre.
 *
 * Módulo puro (sin fs, sin red, sin proceso): testeable.
 */

const REMOTOS_VETADOS = ['gdrive_johan']
const INCLUIR = ['*.db.enc', '*.manifest.json', '*.sha256']
const EXCLUIR = ['*.db', '*.db-wal', '*.db-shm', '*.env']
/** Objetos que forman UNA copia restaurable: `.db.enc` + `.manifest.json` + `.sha256`. */
const OBJETOS_POR_COPIA = 3
const SUFIJOS_COPIA = ['.db.enc', '.manifest.json', '.sha256']
/**
 * Patrón RAÍZ (empieza por `/`). Sin la barra rclone lo aplica a cualquier
 * profundidad y la purga alcanzaría `heredado/…`; con ella solo borra los
 * respaldos ordinarios del primer nivel del prefijo.
 */
const PATRON_RETENCION = '/iva_mensual_*'
/** Corrida semanal por defecto del cron de retención. */
const DIAS_ENTRE_RETENCIONES = 7
/** Ritmo de purga que sí converge: tantos objetos como los que maduran por corrida. */
const MAX_BORRADO_MINIMO = OBJETOS_POR_COPIA * DIAS_ENTRE_RETENCIONES
/** Tope por defecto: 3× el ritmo semanal (margen para recuperar atraso sin vaciar el bucket). */
const MAX_BORRADO_POR_DEFECTO = MAX_BORRADO_MINIMO * 3

/**
 * Tiempo máximo por comando. `spawnSync` mata el proceso al vencer: un rclone
 * bloqueado no deja el cron sin terminar.
 */
const TIMEOUT_COPIA_MS = 60 * 60 * 1000
const TIMEOUT_LISTADO_MS = 10 * 60 * 1000
const TIMEOUT_PURGA_MS = 15 * 60 * 1000
/** En dry-run no hay inventario todavía: la lista se genera al ejecutar. */
const LISTA_PURGA_PLACEHOLDER = '<lista-de-purga>'
/** Nombres de comando, en el orden en que se ejecutan. */
const ORDEN_COMANDOS = [
  'copia-backups',
  'copia-heredado',
  'verificacion-espejo',
  'auditoria-remota',
  'inventario-purga',
  'retencion-remota',
  'verificacion-purga',
]
/**
 * Preflight obligatorio de la purga: verificación de hashes, auditoría de
 * restaurabilidad, inventario de elegibles, purga y comprobación posterior.
 * `--solo retencion-remota` ejecuta este conjunto completo, nunca el borrado solo.
 */
const COMANDOS_PURGA = [
  'verificacion-espejo',
  'auditoria-remota',
  'inventario-purga',
  'retencion-remota',
  'verificacion-purga',
]

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
    timeoutMs: TIMEOUT_COPIA_MS,
    argv: ['copy', origen, destino, ...argumentosComunes(), '--log-level', 'INFO'],
  }
}

/** Los estados heredados van a un prefijo propio: no se mezclan con la rotación diaria. */
function comandoCopiaHeredado({ heredado, destino }) {
  return {
    nombre: 'copia-heredado',
    descripcion: 'Sube el archivo heredado (estados del 2–9 oct ya cifrados) a /heredado',
    timeoutMs: TIMEOUT_COPIA_MS,
    argv: ['copy', heredado, `${destino}/heredado`, ...argumentosComunes(), '--log-level', 'INFO'],
  }
}

/** Comprobación de que todo lo local está en el remoto (nunca al revés). */
function comandoVerificacion({ origen, destino }) {
  const argv = ['check', origen, destino, '--one-way', '--checksum']
  // Los tres objetos, no solo el .enc: un manifiesto ausente o distinto en el
  // remoto deja una copia que no se puede restaurar, y `check` del .enc no lo ve.
  for (const patron of INCLUIR) argv.push('--include', patron)
  return {
    nombre: 'verificacion-espejo',
    descripcion: 'Comprueba hash y presencia de .db.enc, manifest y .sha256 en el remoto (solo un sentido)',
    timeoutMs: TIMEOUT_LISTADO_MS,
    // Sin `--size-only`: se comparan hashes (rclone los toma del metadato del objeto
    // en R2, no descarga contenido), así un objeto remoto dañado no pasa por bueno.
    argv,
  }
}

/**
 * Listado remoto para auditar la restaurabilidad. No borra ni modifica nada:
 * `lsjson` es solo lectura. La salida se evalúa con `analizarObjetosRemotos`.
 */
function comandoListadoRemoto({ destino }) {
  const argv = ['lsjson', destino, '--recursive', '--files-only']
  for (const patron of INCLUIR) argv.push('--include', patron)
  return {
    nombre: 'auditoria-remota',
    descripcion: 'Lista los objetos remotos y detecta sellos incompletos o no restaurables',
    capturar: true,
    timeoutMs: TIMEOUT_LISTADO_MS,
    argv,
  }
}

/**
 * Inventario de lo que la purga borraría: objetos que ya cruzaron la retención.
 * Solo lectura; `--min-age` sobre la fecha de subida y el patrón anclado a la
 * raíz dejan fuera `heredado/`.
 */
function comandoInventarioPurga({ destino, diasRetencion = 90 }) {
  return {
    nombre: 'inventario-purga',
    descripcion: `Lista lo que la purga borraría (más de ${diasRetencion} días) sin borrar nada`,
    capturar: true,
    timeoutMs: TIMEOUT_LISTADO_MS,
    argv: ['lsjson', destino, '--recursive', '--files-only', '--include', PATRON_RETENCION, '--min-age', `${diasRetencion}d`],
  }
}

/**
 * Listado posterior a la purga: la corrida no se da por buena solo porque
 * `delete` salió 0. `verificarPurga` compara el antes y el después.
 */
function comandoVerificacionPurga({ destino }) {
  const argv = ['lsjson', destino, '--recursive', '--files-only']
  for (const patron of INCLUIR) argv.push('--include', patron)
  return {
    nombre: 'verificacion-purga',
    descripcion: 'Comprueba que no quedaron sellos partidos ni objetos perdidos fuera de la lista',
    capturar: true,
    timeoutMs: TIMEOUT_LISTADO_MS,
    argv,
  }
}

/**
 * Purga remota por antigüedad con LISTA EXPLÍCITA.
 *
 * `--files-from-raw` desactiva el resto de filtros de rclone (verificado en
 * 1.74.3: combinarlo con `--include` es un error de inicialización), así que la
 * lista ES el alcance: solo los nombres que `analizarPurga` aprobó — los tres
 * objetos de cada sello completo. No se pasa `--max-delete`: ese flag era el que
 * colgaba el proceso al alcanzarse, y con lista explícita el tope ya se decidió
 * antes de lanzar nada.
 */
function comandoRetencion({ destino, diasRetencion = 90, objetos, rutaLista = LISTA_PURGA_PLACEHOLDER }) {
  const n = Number(objetos)
  return {
    nombre: 'retencion-remota',
    descripcion: Number.isInteger(n)
      ? `Borra ${n} objetos inventariados (más de ${diasRetencion} días), con lista explícita`
      : `Borra los objetos inventariados (más de ${diasRetencion} días), con lista explícita`,
    requiereInventario: true,
    timeoutMs: TIMEOUT_PURGA_MS,
    argv: ['delete', destino, '--files-from-raw', rutaLista, '--log-level', 'INFO'],
  }
}

/**
 * Plan completo. `solo` permite ejecutar un comando suelto, con una excepción
 * deliberada: `solo: 'retencion-remota'` arrastra el preflight completo
 * (verificación, auditoría, inventario y comprobación posterior). Purgar sin
 * verificar ni inventariar no es una opción del CLI.
 * @returns {{ok:boolean, errores:string[], destino:string|null, comandos:object[], advertencias:string[]}}
 */
function construirPlan({ origen, heredado, remoto, bucket, prefijo = '', diasRetencion = 90, maxBorrado = MAX_BORRADO_POR_DEFECTO, diasEntreRetenciones = DIAS_ENTRE_RETENCIONES, solo = null, rutaLista = LISTA_PURGA_PLACEHOLDER } = {}) {
  const validacion = validarConfiguracion({ remoto, bucket, prefijo })
  const errores = [...validacion.errores]
  if (!origen) errores.push('falta la carpeta de backups de origen')
  if (!heredado) errores.push('falta la carpeta del archivo heredado')
  if (!Number.isFinite(diasRetencion) || diasRetencion < 31) errores.push('la retención remota no puede ser menor que 31 días')
  if (!Number.isFinite(maxBorrado) || maxBorrado < 1) errores.push('--max-borrado debe ser al menos 1')
  if (!Number.isInteger(diasEntreRetenciones) || diasEntreRetenciones < 1 || diasEntreRetenciones > 31) {
    errores.push('--cada-dias debe ser un entero entre 1 y 31')
  }
  const ritmoPurga = OBJETOS_POR_COPIA * diasEntreRetenciones
  if (Number.isFinite(maxBorrado) && maxBorrado < ritmoPurga) {
    errores.push(
      `--max-borrado ${maxBorrado} no converge: ${OBJETOS_POR_COPIA} objetos por copia × ${diasEntreRetenciones} días = ${ritmoPurga} objetos nuevos por corrida; usa al menos ${ritmoPurga}`
    )
  }
  if (errores.length) return { ok: false, errores, destino: null, comandos: [], advertencias: [] }

  const destino = validacion.normalizado.destino
  const todos = [
    comandoCopia({ origen, destino }),
    comandoCopiaHeredado({ heredado, destino }),
    comandoVerificacion({ origen, destino }),
    comandoListadoRemoto({ destino }),
    comandoInventarioPurga({ destino, diasRetencion }),
    comandoRetencion({ destino, diasRetencion, rutaLista }),
    comandoVerificacionPurga({ destino }),
  ]

  const nombres = todos.map((c) => c.nombre)
  if (solo && !nombres.includes(solo)) {
    return { ok: false, errores: [`no existe el comando ${solo} (válidos: ${nombres.join(', ')})`], destino, comandos: [], advertencias: [] }
  }
  // La purga nunca viaja sola: su selección incluye preflight y comprobación.
  const seleccion = solo === 'retencion-remota' ? COMANDOS_PURGA : solo ? [solo] : ORDEN_COMANDOS
  const porNombre = new Map(todos.map((c) => [c.nombre, c]))
  const comandos = seleccion.map((nombre) => porNombre.get(nombre))

  const advertencias = [
    '`--immutable` evita sobrescrituras accidentales; NO impide que alguien con las credenciales borre el contenido.',
    '`copy` es aditivo: nunca se usa `sync`, que propagaría al remoto la pérdida de un backup local.',
    'La clave BACKUP_ENCRYPTION_KEY no viaja nunca al remoto; sin ella el bucket no es recuperable.',
    'El inventario usa `--include /iva_mensual_*` (raíz) y la lista de purga solo lleva nombres de la raíz: `heredado/` queda fuera.',
    `La purga necesita al menos ${ritmoPurga} objetos por corrida para converger; con menos, la cola crece para siempre.`,
    'La purga se decide con un inventario previo y se ejecuta con una lista explícita: si los objetos elegibles superan el tope, no se borra NADA.',
    '`--solo retencion-remota` ejecuta igualmente verificación, auditoría, inventario y comprobación posterior: no existe una purga sin preflight.',
  ]

  return { ok: true, errores: [], destino, comandos, advertencias }
}

/**
 * Simula la cola de purga para demostrar que converge.
 *
 * Cada corrida maduran `OBJETOS_POR_COPIA × diasEntreCorridas` objetos (los que
 * cruzan `diasRetencion`) y se borran como mucho `maxBorrado`. Si el tope queda
 * por debajo del ritmo, lo pendiente crece de forma lineal.
 *
 * @returns {{porCorrida:number, necesario:number, converge:boolean,
 *            pendientesFinales:number, picoPendientes:number}}
 */
function estimarPurga({ objetosPorCopia = OBJETOS_POR_COPIA, diasEntreCorridas = DIAS_ENTRE_RETENCIONES, maxBorrado = MAX_BORRADO_POR_DEFECTO, semanas = 52 } = {}) {
  const porCorrida = objetosPorCopia * diasEntreCorridas
  const tope = Number.isFinite(maxBorrado) ? maxBorrado : MAX_BORRADO_POR_DEFECTO
  let pendientes = 0
  let pico = 0
  for (let s = 0; s < semanas; s++) {
    pendientes += porCorrida
    pendientes -= Math.min(tope, pendientes)
    pico = Math.max(pico, pendientes)
  }
  return {
    objetosPorCopia,
    diasEntreCorridas,
    porCorrida,
    necesario: porCorrida,
    maxBorrado: tope,
    converge: tope >= porCorrida,
    pendientesFinales: pendientes,
    picoPendientes: pico,
  }
}

/** `iva_mensual_2026-10-25T03-00-03.db.enc` → `{sello, tipo}`. */
function separarSello(nombre) {
  for (const sufijo of SUFIJOS_COPIA) {
    if (nombre.endsWith(sufijo)) return { sello: nombre.slice(0, -sufijo.length), tipo: sufijo }
  }
  return null
}

function nombreDeObjeto(entrada) {
  if (typeof entrada === 'string') return entrada
  if (entrada && typeof entrada === 'object') return String(entrada.Path || entrada.Name || '')
  return ''
}

/** Salida de `rclone lsjson` → array de objetos. Un texto vacío es una lista vacía. */
function parsearLsjson(salida) {
  if (typeof salida !== 'string') return salida
  const texto = salida.trim()
  if (!texto) return []
  try {
    return JSON.parse(texto)
  } catch {
    throw new Error('la lista remota no es JSON válido (rclone lsjson)')
  }
}

/**
 * Decide qué se borra a partir del inventario de elegibles (`lsjson --min-age`).
 *
 * Reglas, en duro:
 *  - Solo se borra un sello COMPLETO (sus tres objetos son elegibles). Borrar un
 *    sello a medias produce una copia irrestaurable y es exactamente el fallo que
 *    se observó al particionar la purga con `--max-delete`.
 *  - Si un sello tiene solo parte de sus objetos en el inventario, o aparece
 *    cualquier objeto en subdirectorios, se aborta: no se puede garantizar una
 *    eliminación coherente.
 *  - Si los objetos elegibles superan `maxBorrado`, no se borra nada. No se
 *    trunca en silencio: el operador decide el tope y lo declara.
 *
 * @returns {{ok:boolean, total:number, sellos:number, completos:object[],
 *            parciales:object[], inesperados:string[], ignorados:string[],
 *            borrar:string[], maxBorrado:number, problemas:string[]}}
 */
function analizarPurga(salida, { maxBorrado = MAX_BORRADO_POR_DEFECTO } = {}) {
  const objetos = parsearLsjson(salida)
  if (!Array.isArray(objetos)) throw new Error('la lista remota debe ser un array (rclone lsjson)')
  const tope = Number.isFinite(maxBorrado) ? maxBorrado : MAX_BORRADO_POR_DEFECTO
  const porSello = new Map()
  const inesperados = []
  const ignorados = []

  for (const entrada of objetos) {
    const nombre = nombreDeObjeto(entrada)
    if (!nombre) continue
    if (nombre.split('/').length > 1) {
      inesperados.push(nombre)
      continue
    }
    const partes = separarSello(nombre)
    if (!partes) {
      ignorados.push(nombre)
      continue
    }
    if (!porSello.has(partes.sello)) porSello.set(partes.sello, new Map())
    porSello.get(partes.sello).set(partes.tipo, nombre)
  }

  const completos = []
  const parciales = []
  for (const [sello, tipos] of porSello) {
    if (tipos.size === SUFIJOS_COPIA.length) {
      completos.push({ sello, objetos: SUFIJOS_COPIA.map((sufijo) => tipos.get(sufijo)) })
    } else {
      parciales.push({ sello, objetos: [...tipos.values()], falta: SUFIJOS_COPIA.filter((sufijo) => !tipos.has(sufijo)) })
    }
  }

  const borrar = completos.flatMap((c) => c.objetos)
  const problemas = []
  if (parciales.length) {
    problemas.push(
      `${parciales.length} sello(s) con solo parte de sus objetos elegibles: borrarlos dejaría copias a medias (${parciales.slice(0, 3).map((p) => p.sello).join(', ')})`
    )
  }
  if (inesperados.length) {
    problemas.push(`${inesperados.length} objeto(s) en subdirectorios dentro del inventario (${inesperados.slice(0, 3).join(', ')}): la purga no los toca y no se puede garantizar coherencia`)
  }
  if (borrar.length > tope) {
    problemas.push(
      `la purga elegible son ${borrar.length} objetos en ${completos.length} sellos completos y el tope es ${tope}: no se borra nada. ` +
        `Si el atraso es intencional, sube --max-borrado a ${borrar.length} (o más) de forma explícita`
    )
  }

  return {
    ok: problemas.length === 0,
    total: objetos.length,
    sellos: porSello.size,
    completos,
    parciales,
    inesperados,
    ignorados,
    borrar,
    maxBorrado: tope,
    problemas,
  }
}

/**
 * Comprueba el estado POSTERIOR a la purga contra el anterior. Un `delete` con
 * salida 0 no basta: hay que demostrar que se borró exactamente lo planeado y
 * que ningún sello quedó partido.
 *
 * @param {{antes:string|Array, despues:string|Array, borrados?:string[]}} p
 * @returns {{ok:boolean, problemas:string[], sellos:number, borrados:number}}
 */
function verificarPurga({ antes, despues, borrados = [] } = {}) {
  const listaAntes = parsearLsjson(antes)
  const listaDespues = parsearLsjson(despues)
  if (!Array.isArray(listaAntes) || !Array.isArray(listaDespues)) {
    throw new Error('las listas de verificación deben ser arrays (rclone lsjson)')
  }
  const nombres = (lista) => new Set(lista.map(nombreDeObjeto).filter(Boolean))
  const antesSet = nombres(listaAntes)
  const despuesSet = nombres(listaDespues)
  const borradosSet = new Set(borrados)
  const problemas = []

  const siguen = borrados.filter((n) => despuesSet.has(n))
  if (siguen.length) {
    problemas.push(`${siguen.length} objeto(s) de la lista de purga siguen en el remoto (${siguen.slice(0, 3).join(', ')})`)
  }
  const perdidos = [...antesSet].filter((n) => !borradosSet.has(n) && !despuesSet.has(n))
  if (perdidos.length) {
    problemas.push(`${perdidos.length} objeto(s) desaparecieron sin estar en la lista de purga (${perdidos.slice(0, 3).join(', ')})`)
  }

  const porSello = new Map()
  for (const nombre of despuesSet) {
    if (nombre.split('/').length > 1) continue
    const partes = separarSello(nombre)
    if (!partes) continue
    if (!porSello.has(partes.sello)) porSello.set(partes.sello, new Set())
    porSello.get(partes.sello).add(partes.tipo)
  }
  const partidos = [...porSello].filter(([, tipos]) => tipos.size !== SUFIJOS_COPIA.length).map(([sello]) => sello)
  if (partidos.length) {
    problemas.push(`${partidos.length} sello(s) quedaron partidos en el remoto (${partidos.slice(0, 3).join(', ')})`)
  }

  return { ok: problemas.length === 0, problemas, sellos: porSello.size, borrados: borrados.length }
}

/**
 * Audita la lista de objetos remotos (`rclone lsjson`) y responde si cada sello
 * es restaurable. No descarga nada: trabaja con nombres.
 *
 * - `noRestaurables`: sello sin `.db.enc` o sin `.manifest.json` (el restore exige el manifest).
 * - `incompletos`: sello con `.enc` y manifest pero sin `.sha256`.
 * - `huerfanos`: objetos sueltos sin `.db.enc` (manifest o hash sin copia).
 * - `faltantes`: `.db.enc` locales que no están en el remoto.
 *
 * Solo evalúa la raíz: `heredado/` es archivo permanente y no entra en la
 * rotación diaria; se cuenta aparte (`heredado`).
 *
 * @param {string|Array} salida salida de `rclone lsjson` (texto o array)
 * @param {{locales?:string[]}} opciones nombres de `.db.enc` locales
 */
function analizarObjetosRemotos(salida, { locales = [] } = {}) {
  const objetos = parsearLsjson(salida)
  if (!Array.isArray(objetos)) throw new Error('la lista remota debe ser un array (rclone lsjson)')

  const porSello = new Map()
  let heredado = 0
  let objetosRaiz = 0
  for (const entrada of objetos) {
    const nombre = nombreDeObjeto(entrada)
    if (!nombre) continue
    if (nombre.split('/').length > 1) {
      heredado++
      continue
    }
    const partes = separarSello(nombre)
    if (!partes) continue
    objetosRaiz++
    if (!porSello.has(partes.sello)) porSello.set(partes.sello, new Set())
    porSello.get(partes.sello).add(partes.tipo)
  }

  const noRestaurables = []
  const incompletos = []
  const huerfanos = []
  for (const [sello, tipos] of porSello) {
    const falta = SUFIJOS_COPIA.filter((sufijo) => !tipos.has(sufijo))
    if (!tipos.has('.db.enc')) {
      // Huérfano = objeto que existe sin su .db.enc (manifest o hash sueltos).
      huerfanos.push(...SUFIJOS_COPIA.filter((sufijo) => tipos.has(sufijo)).map((sufijo) => `${sello}${sufijo}`))
    }
    if (!tipos.has('.db.enc') || !tipos.has('.manifest.json')) noRestaurables.push({ sello, falta })
    else if (falta.length) incompletos.push({ sello, falta })
  }

  const remotos = new Set([...porSello.keys()].map((sello) => `${sello}.db.enc`))
  const faltantes = (Array.isArray(locales) ? locales : []).filter((nombre) => !remotos.has(nombre))

  return {
    ok: noRestaurables.length === 0 && incompletos.length === 0 && faltantes.length === 0 && huerfanos.length === 0,
    sellos: porSello.size,
    objetosRaiz,
    heredado,
    noRestaurables,
    incompletos,
    huerfanos,
    faltantes,
  }
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
  OBJETOS_POR_COPIA,
  SUFIJOS_COPIA,
  DIAS_ENTRE_RETENCIONES,
  MAX_BORRADO_MINIMO,
  MAX_BORRADO_POR_DEFECTO,
  TIMEOUT_COPIA_MS,
  TIMEOUT_LISTADO_MS,
  TIMEOUT_PURGA_MS,
  LISTA_PURGA_PLACEHOLDER,
  ORDEN_COMANDOS,
  COMANDOS_PURGA,
  CUOTA_LIBRE_BYTES,
  PRECIO_GB_MES_USD,
  normalizarRemoto,
  validarConfiguracion,
  destinoRemoto,
  comandoCopia,
  comandoCopiaHeredado,
  comandoVerificacion,
  comandoListadoRemoto,
  comandoInventarioPurga,
  comandoRetencion,
  comandoVerificacionPurga,
  construirPlan,
  estimarPurga,
  analizarObjetosRemotos,
  analizarPurga,
  verificarPurga,
  parsearLsjson,
  separarSello,
  estimarOperaciones,
  estimarAlmacenamiento,
}
