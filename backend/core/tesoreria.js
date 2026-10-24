/**
 * TESORERÍA (FASE 6 — PROMPT MAESTRO §22): dominio base de bancos, pagos,
 * cobros, transferencias y conciliación bancaria.
 *
 * Principios (los mismos del resto del núcleo):
 *  - Todo movimiento bancario queda respaldado por UN asiento del núcleo FASE 2
 *    (partida doble, período abierto con autocreación, folio correlativo,
 *    auditoría). El libro banco NO es contabilidad paralela: es una vista del
 *    mayor filtrada por las cuentas de banco de la empresa. La pata bancaria
 *    se resuelve por ALIAS de control (BANCOS por defecto, CAJA si la cuenta
 *    contable elegida lo es) — nunca código rígido (§3.5).
 *  - La contraparte de cada pago/cobro: la factura aplicada (documento_id) si
 *    se indicó, si no el alias de control (PROVEEDORES/CLIENTES), si no
 *    GASTO_BANCO (comisiones) — explícita, visible y auditable.
 *  - Conciliación bancaria REPORT-ONLY (§22/§9): la cartola se importa y se
 *    empareja contra el libro; las diferencias se REPORTAN (no conciliado por
 *    cada lado, diferencias de monto) y se corrigen por asiento manual — el
 *    sistema nunca corrige en silencio.
 *  - Módulo puro: recibe la BD como parámetro (testeable).
 */

const asientos = require('./asientos')
const cuentasCore = require('./cuentas')
const { registrarAccion } = require('./auditoria')

const TIPOS_MOV = ['PAGO', 'COBRO', 'TRANSFERENCIA']

function fechaHoy() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ============================================================
// Cuentas bancarias
// ============================================================

function crearBanco(db, { empresaId, usuarioId, banco, numero = '', moneda = 'CLP', cuentaContableId, saldoInicial = 0, ip = null }) {
  if (!banco || !String(banco).trim()) throw new Error('El nombre del banco es obligatorio')
  const cta = db.prepare(`SELECT id, nombre FROM cuentas WHERE id = ? AND empresa_id = ? AND activa = 1`).get(Number(cuentaContableId), empresaId)
  if (!cta) throw new Error('Cuenta contable no encontrada en esta empresa')
  const dup = db.prepare(`SELECT id FROM bancos_cuentas WHERE empresa_id = ? AND cuenta_contable_id = ?`).get(empresaId, cta.id)
  if (dup) throw new Error('Esa cuenta contable ya está asociada a otro banco')

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO bancos_cuentas (empresa_id, banco, numero, moneda, cuenta_contable_id, saldo_inicial)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(empresaId, String(banco).trim().slice(0, 120), String(numero || '').trim().slice(0, 40), moneda === 'CLP' ? 'CLP' : 'CLP', cta.id, Math.round(Number(saldoInicial) || 0))

    // El saldo inicial se contabiliza (no es un número suelto): apertura contra
    // la contraparte de apertura del plan. Sin ese asiento, libro y mayor divergen.
    const inicial = Math.round(Number(saldoInicial) || 0)
    if (inicial !== 0) {
      const contra = db.prepare(`SELECT id FROM cuentas WHERE empresa_id = ? AND alias = 'RESULTADO_EJERCICIO' AND activa = 1 AND es_resumen = 0`).get(empresaId)
        || db.prepare(`SELECT id FROM cuentas WHERE empresa_id = ? AND clase = 3 AND activa = 1 AND es_resumen = 0 LIMIT 1`).get(empresaId)
      if (!contra) throw new Error('Falta una cuenta de patrimonio (clase 3) para contabilizar el saldo inicial')
      asientos.crear(db, {
        empresaId, usuarioId, fecha: fechaHoy(),
        glosa: `Saldo inicial ${String(banco).trim()} ${numero || ''}`.trim(),
        tipo: 'apertura',
        lineas: inicial > 0
          ? [{ cuenta_id: cta.id, debe: inicial, haber: 0, glosa: 'Saldo inicial' }, { cuenta_id: contra.id, debe: 0, haber: inicial, glosa: 'Contrapartida saldo inicial' }]
          : [{ cuenta_id: contra.id, debe: -inicial, haber: 0, glosa: 'Contrapartida saldo inicial' }, { cuenta_id: cta.id, debe: 0, haber: -inicial, glosa: 'Saldo inicial (sobregiro)' }],
        origen: null, ip,
      })
    }

    registrarAccion(db, {
      empresaId, usuarioId,
      accion: 'tesoreria.banco_crear', entidad: 'bancos_cuentas', entidadId: String(info.lastInsertRowid),
      despues: { banco: String(banco).trim(), numero: String(numero || '').trim(), cuenta_contable_id: cta.id, saldo_inicial: Math.round(Number(saldoInicial) || 0) },
      ip,
    })
    return info.lastInsertRowid
  })
  return tx()
}

function listarBancos(db, empresaId) {
  return db.prepare(`
    SELECT b.*, c.codigo AS cuenta_codigo, c.nombre AS cuenta_nombre
    FROM bancos_cuentas b JOIN cuentas c ON c.id = b.cuenta_contable_id
    WHERE b.empresa_id = ? AND b.activa = 1
    ORDER BY b.id
  `).all(empresaId).map((b) => {
    const movs = db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN m.monto > 0 THEN m.monto ELSE 0 END), 0) AS ingresos,
             COALESCE(SUM(CASE WHEN m.monto < 0 THEN -m.monto ELSE 0 END), 0) AS egresos
      FROM teso_movimientos m WHERE m.banco_cuenta_id = ?
    `).get(b.id)
    return { ...b, saldo: b.saldo_inicial + movs.ingresos - movs.egresos, ingresos: movs.ingresos, egresos: movs.egresos }
  })
}

function obtenerBanco(db, empresaId, bancoId) {
  return listarBancos(db, empresaId).find((b) => b.id === Number(bancoId)) || null
}

// ============================================================
// Contraparte del movimiento (precedencia explícita §6)
// ============================================================

function cuentaContraparte(db, empresaId, { documentoId = null, tipo, cuentaContraparteId = null }) {
  if (cuentaContraparteId) {
    const cta = db.prepare(`SELECT id FROM cuentas WHERE id = ? AND empresa_id = ? AND activa = 1 AND es_resumen = 0`).get(Number(cuentaContraparteId), empresaId)
    if (!cta) throw new Error('Cuenta de contraparte no encontrada en esta empresa')
    return cta.id
  }
  if (documentoId) {
    const d = db.prepare(`SELECT asiento_id FROM documentos WHERE id = ? AND empresa_id = ?`).get(Number(documentoId), empresaId)
    if (!d) throw new Error('Documento aplicado no encontrado en esta empresa')
    if (!d.asiento_id) throw new Error('El documento aplicado aún no está contabilizado (contabilízalo primero en la bandeja)')
    const lin = db.prepare(`
      SELECT al.cuenta_id FROM asiento_lineas al
      JOIN cuentas c ON c.id = al.cuenta_id
      WHERE al.asiento_id = ? AND c.clase = ? AND c.es_resumen = 0
      ORDER BY ${tipo === 'PAGO' ? 'al.debe DESC' : 'al.haber DESC'} LIMIT 1
    `).get(d.asiento_id, tipo === 'PAGO' ? 2 : 1)
    if (!lin) throw new Error('La factura no tiene una línea de contraparte (proveedor/cliente) en su asiento')
    return lin.cuenta_id
  }
  const alias = tipo === 'PAGO' ? 'PROVEEDORES' : 'CLIENTES'
  const cta = db.prepare(`SELECT id FROM cuentas WHERE empresa_id = ? AND alias = ? AND activa = 1 AND es_resumen = 0`).get(empresaId, alias)
  if (!cta) throw new Error(`Falta la cuenta con alias ${alias} en el plan de la empresa`)
  return cta.id
}

// ============================================================
// Movimientos: pago, cobro, transferencia
// ============================================================

function validarMovimiento(db, { empresaId, usuarioId, bancoCuentaId, tipo, fecha, monto, glosa }) {
  if (!TIPOS_MOV.includes(tipo)) throw new Error(`Tipo de movimiento inválido: ${tipo}`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))) throw new Error('Fecha inválida (esperado YYYY-MM-DD)')
  const m = Math.round(Number(monto))
  if (!Number.isInteger(m) || m <= 0) throw new Error('El monto debe ser un entero en pesos mayor que cero')
  const g = String(glosa || '').trim()
  if (!g) throw new Error('La glosa es obligatoria')
  const banco = db.prepare(`SELECT * FROM bancos_cuentas WHERE id = ? AND empresa_id = ? AND activa = 1`).get(Number(bancoCuentaId), empresaId)
  if (!banco) throw new Error('Cuenta bancaria no encontrada en esta empresa')
  return { banco, monto: m, glosa: g.slice(0, 300) }
}

function registrarPagoCobro(db, { empresaId, usuarioId, bancoCuentaId, tipo, fecha, monto, glosa, documentoId = null, cuentaContraparteId = null, ip = null }) {
  const { banco, monto: m, glosa: g } = validarMovimiento(db, { empresaId, usuarioId, bancoCuentaId, tipo, fecha, monto, glosa })
  const esPago = tipo === 'PAGO'
  const contraparte = cuentaContraparte(db, empresaId, { documentoId, tipo, cuentaContraparteId })

  const tx = db.transaction(() => {
    const a = asientos.crear(db, {
      empresaId, usuarioId, fecha,
      glosa: `${tipo === 'PAGO' ? 'Pago' : 'Cobro'} — ${g}`,
      tipo: 'manual',
      lineas: esPago
        ? [
            { cuenta_id: contraparte, debe: m, haber: 0, glosa: g },
            { cuenta_id: banco.cuenta_contable_id, debe: 0, haber: m, glosa: `Débito banco ${banco.banco}` },
          ]
        : [
            { cuenta_id: banco.cuenta_contable_id, debe: m, haber: 0, glosa: `Abono banco ${banco.banco}` },
            { cuenta_id: contraparte, debe: 0, haber: m, glosa: g },
          ],
      origen: null, ip,
    })

    const info = db.prepare(`
      INSERT INTO teso_movimientos (empresa_id, banco_cuenta_id, tipo, fecha, monto, glosa, documento_id, asiento_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(empresaId, banco.id, tipo, fecha, esPago ? -m : m, g, documentoId ? Number(documentoId) : null, a.id)

    registrarAccion(db, {
      empresaId, usuarioId,
      accion: `tesoreria.${tipo.toLowerCase()}`, entidad: 'teso_movimientos', entidadId: String(info.lastInsertRowid),
      despues: { banco: banco.banco, fecha, monto: esPago ? -m : m, glosa: g, documento_id: documentoId || null, asiento_id: a.id, folio_asiento: a.folio },
      ip,
    })
    return { movimientoId: info.lastInsertRowid, asiento: a }
  })
  return tx()
}

function registrarTransferencia(db, { empresaId, usuarioId, bancoCuentaId, bancoDestinoId, fecha, monto, glosa, ip = null }) {
  const { banco: origen, monto: m, glosa: g } = validarMovimiento(db, { empresaId, usuarioId, bancoCuentaId, tipo: 'TRANSFERENCIA', fecha, monto, glosa })
  if (Number(bancoDestinoId) === origen.id) throw new Error('La cuenta de destino debe ser distinta a la de origen')
  const destino = db.prepare(`SELECT * FROM bancos_cuentas WHERE id = ? AND empresa_id = ? AND activa = 1`).get(Number(bancoDestinoId), empresaId)
  if (!destino) throw new Error('Cuenta de destino no encontrada en esta empresa')

  const tx = db.transaction(() => {
    // UN solo asiento con las dos patas bancarias (ambas clase 1): partida
    // doble natural, el transferencia no toca resultados ni pasivos.
    const a = asientos.crear(db, {
      empresaId, usuarioId, fecha,
      glosa: `Transferencia — ${g}`,
      tipo: 'manual',
      lineas: [
        { cuenta_id: destino.cuenta_contable_id, debe: m, haber: 0, glosa: `Abono ${destino.banco}` },
        { cuenta_id: origen.cuenta_contable_id, debe: 0, haber: m, glosa: `Débito ${origen.banco}` },
      ],
      origen: null, ip,
    })

    const info = db.prepare(`
      INSERT INTO teso_movimientos (empresa_id, banco_cuenta_id, tipo, fecha, monto, glosa, banco_destino_id, asiento_id)
      VALUES (?, ?, 'TRANSFERENCIA', ?, ?, ?, ?, ?)
    `).run(empresaId, origen.id, fecha, -m, g, destino.id, a.id)

    registrarAccion(db, {
      empresaId, usuarioId,
      accion: 'tesoreria.transferencia', entidad: 'teso_movimientos', entidadId: String(info.lastInsertRowid),
      despues: { origen: origen.banco, destino: destino.banco, fecha, monto: -m, glosa: g, asiento_id: a.id, folio_asiento: a.folio },
      ip,
    })
    return { movimientoId: info.lastInsertRowid, asiento: a }
  })
  return tx()
}

// ============================================================
// Libro banco
// ============================================================

function libroBanco(db, { empresaId, bancoCuentaId, desde = null, hasta = null, limit = 200 }) {
  const banco = db.prepare(`SELECT * FROM bancos_cuentas WHERE id = ? AND empresa_id = ?`).get(Number(bancoCuentaId), empresaId)
  if (!banco) throw new Error('Cuenta bancaria no encontrada en esta empresa')
  const filas = db.prepare(`
    SELECT m.id, m.tipo, m.fecha, m.monto, m.glosa, m.documento_id, m.banco_destino_id, m.asiento_id,
           a.folio AS folio_asiento, a.anio AS anio_asiento, d.folio AS folio_doc, d.tipo_doc AS tipo_doc
    FROM teso_movimientos m
    JOIN asientos a ON a.id = m.asiento_id
    LEFT JOIN documentos d ON d.id = m.documento_id
    WHERE m.banco_cuenta_id = ? AND (? IS NULL OR m.fecha >= ?) AND (? IS NULL OR m.fecha <= ?)
    ORDER BY m.fecha DESC, m.id DESC
    LIMIT ?
  `).all(Number(bancoCuentaId), desde, desde, hasta, hasta, Math.min(Number(limit) || 200, 1000))

  // Saldo corrido cronológico (el listado viene DESC → reordenar para calcular).
  // Los "previos" solo aplican si hay filtro `desde`: sin filtro el loop cubre
  // todos los movimientos y sumarlos dos veces inflaría el saldo.
  const cronologico = [...filas].reverse()
  let saldo = banco.saldo_inicial
  if (desde) {
    saldo += db.prepare(
      `SELECT COALESCE(SUM(monto), 0) AS s FROM teso_movimientos WHERE banco_cuenta_id = ? AND fecha < ?`
    ).get(Number(bancoCuentaId), desde).s
  }
  for (const f of cronologico) f.saldo_despues = (saldo += f.monto)

  return { banco, saldo_final: saldo, filas: filas.map((f) => ({ ...f, tipo_flujo: f.monto < 0 ? 'egreso' : 'ingreso' })) }
}

// ============================================================
// Cartola + conciliación (report-only)
// ============================================================

function importarCartola(db, { empresaId, usuarioId, bancoCuentaId, filas, ip = null }) {
  const banco = db.prepare(`SELECT * FROM bancos_cuentas WHERE id = ? AND empresa_id = ? AND activa = 1`).get(Number(bancoCuentaId), empresaId)
  if (!banco) throw new Error('Cuenta bancaria no encontrada en esta empresa')
  if (!Array.isArray(filas) || filas.length === 0) throw new Error('La cartola no trae filas')
  let insertadas = 0
  let duplicadas = 0
  const tx = db.transaction(() => {
    for (const f of filas) {
      const fecha = String(f.fecha || '').trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error(`Fecha inválida en cartola: ${fecha}`)
      const monto = Math.round(Number(f.monto))
      if (!Number.isFinite(monto) || monto === 0) throw new Error(`Monto inválido en cartola: ${f.monto}`)
      const glosa = String(f.glosa || '').trim().slice(0, 300)
      const r = db.prepare(`
        INSERT INTO teso_cartola (empresa_id, banco_cuenta_id, fecha, monto, glosa)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(banco_cuenta_id, fecha, monto, glosa) DO NOTHING
      `).run(empresaId, banco.id, fecha, monto, glosa)
      if (r.changes > 0) insertadas++
      else duplicadas++
    }
    registrarAccion(db, {
      empresaId, usuarioId,
      accion: 'tesoreria.cartola_importar', entidad: 'teso_cartola', entidadId: String(banco.id),
      despues: { filas: filas.length, insertadas, duplicadas },
      ip,
    })
  })
  tx()
  return { insertadas, duplicadas }
}

/**
 * Conciliación bancaria del banco a `hasta` (inclusive). REPORT-ONLY:
 *  - empareja cartola ↔ libro con coincidencia exacta (monto firmado + fecha ±3 días);
 *  - lo emparejado queda marcado (cartola.movimiento_id) — idempotente;
 *  - devuelve NO_CONCILIADO_LIBRO (pagos/cobros sin cartola) y
 *    NO_CONCILIADO_CARTOLA (ingresos/egresos del banco sin libro);
 *  - el ajuste, si procede, es un asiento manual del contador — nunca automático.
 */
function conciliarBanco(db, { empresaId, usuarioId, bancoCuentaId, hasta, ip = null }) {
  const banco = db.prepare(`SELECT * FROM bancos_cuentas WHERE id = ? AND empresa_id = ? AND activa = 1`).get(Number(bancoCuentaId), empresaId)
  if (!banco) throw new Error('Cuenta bancaria no encontrada en esta empresa')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(hasta || ''))) throw new Error('Fecha hasta inválida (esperado YYYY-MM-DD)')

  const libro = db.prepare(`
    SELECT m.id, m.fecha, m.monto, m.glosa, m.tipo, m.asiento_id
    FROM teso_movimientos m
    WHERE m.banco_cuenta_id = ? AND m.fecha <= ?
    ORDER BY m.fecha, m.id
  `).all(banco.id, hasta)
  const cartola = db.prepare(`
    SELECT id, fecha, monto, glosa, movimiento_id
    FROM teso_cartola
    WHERE banco_cuenta_id = ? AND fecha <= ?
    ORDER BY fecha, id
  `).all(banco.id, hasta)

  const emparejados = []
  const noConciliadoLibro = []
  const usadasCartola = new Set()

  // 1) Matches ya persistidos (idempotencia): cartola.movimiento_id válido.
  for (const c of cartola) {
    if (c.movimiento_id && libro.some((m) => m.id === c.movimiento_id)) usadasCartola.add(c.id)
  }

  // 2) Emparejamiento exacto por monto firmado con ventana de fechas de ±3 días.
  const msDia = 86400000
  const tHasta = Date.parse(`${hasta}T00:00:00Z`)
  for (const m of libro) {
    const yaEmparejado = cartola.some((c) => c.movimiento_id === m.id)
    if (yaEmparejado) { emparejados.push({ libro: m.id, cartola: cartola.find((c) => c.movimiento_id === m.id).id }); continue }
    const tM = Date.parse(`${m.fecha}T00:00:00Z`)
    if (tM > tHasta) continue
    const candidatas = cartola
      .filter((c) => !usadasCartola.has(c.id) && c.monto === m.monto && Math.abs(Date.parse(`${c.fecha}T00:00:00Z`) - tM) <= 3 * msDia)
      .sort((a, b) => Math.abs(Date.parse(`${a.fecha}T00:00:00Z`) - tM) - Math.abs(Date.parse(`${b.fecha}T00:00:00Z`) - tM))
    if (candidatas.length > 0) {
      const elegida = candidatas[0]
      usadasCartola.add(elegida.id)
      db.prepare(`UPDATE teso_cartola SET movimiento_id = ? WHERE id = ?`).run(m.id, elegida.id)
      emparejados.push({ libro: m.id, cartola: elegida.id })
    } else {
      noConciliadoLibro.push(m)
    }
  }

  const noConciliadoCartola = cartola.filter((c) => !usadasCartola.has(c.id))
  const t0 = Date.parse(`${banco.creado_en || '1970-01-01'}T00:00:00Z`)

  const movs = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN monto > 0 THEN monto ELSE 0 END), 0) AS ing,
           COALESCE(SUM(CASE WHEN monto < 0 THEN -monto ELSE 0 END), 0) AS egr
    FROM teso_movimientos WHERE banco_cuenta_id = ? AND fecha <= ?
  `).get(banco.id, hasta)
  const saldoLibro = banco.saldo_inicial + movs.ing - movs.egr
  const saldoCartola = cartola.reduce((s, c) => s + c.monto, 0)
  const cartolaPrevia = db.prepare(`
    SELECT COALESCE(SUM(monto), 0) AS s FROM teso_cartola
    WHERE banco_cuenta_id = ? AND fecha <= ? AND id NOT IN (${cartola.length ? cartola.map(() => '?').join(',') : 'NULL'})
  `).get(banco.id, hasta, ...cartola.map((c) => c.id)).s

  const diferencia = saldoLibro - (cartolaPrevia + saldoCartola)

  const resultado = {
    banco: { id: banco.id, banco: banco.banco, numero: banco.numero },
    hasta,
    saldo_libro: saldoLibro,
    saldo_cartola: cartolaPrevia + saldoCartola,
    diferencia,
    cuadrado: diferencia === 0,
    emparejados: emparejados.length,
    no_conciliado_libro: noConciliadoLibro.map((m) => ({ id: m.id, fecha: m.fecha, tipo: m.tipo, monto: m.monto, glosa: m.glosa, asiento_id: m.asiento_id })),
    no_conciliado_cartola: noConciliadoCartola.map((c) => ({ id: c.id, fecha: c.fecha, monto: c.monto, glosa: c.glosa })),
  }

  registrarAccion(db, {
    empresaId, usuarioId,
    accion: 'tesoreria.conciliar', entidad: 'bancos_cuentas', entidadId: `${banco.id}:${hasta}`,
    despues: { emparejados: resultado.emparejados, no_libro: resultado.no_conciliado_libro.length, no_cartola: resultado.no_conciliado_cartola.length, diferencia },
    ip,
  })
  return resultado
}

function listarCartola(db, { empresaId, bancoCuentaId, soloPendientes = false, limit = 300 }) {
  return db.prepare(`
    SELECT id, fecha, monto, glosa, movimiento_id
    FROM teso_cartola
    WHERE banco_cuenta_id = ? AND empresa_id = ? AND (? = 0 OR movimiento_id IS NULL)
    ORDER BY fecha DESC, id DESC LIMIT ?
  `).all(Number(bancoCuentaId), empresaId, soloPendientes ? 1 : 0, Math.min(Number(limit) || 300, 1000))
}

// ============================================================
// Resumen para el dashboard de tesorería
// ============================================================

/**
 * Resumen del módulo. `periodo` (AAAAMM) es el período del HEADER: los KPI de
 * ingresos/egresos son del período seleccionado, no del mes del calendario del
 * servidor. Antes el KPI decía «Ingresos del mes $0» mientras la tabla mostraba
 * el cobro del 30/09 bajo un header en Septiembre (F3: dos verdades en la
 * misma pantalla). Sin período explícito se mantiene el mes en curso.
 */
function resumen(db, empresaId, { periodo = null } = {}) {
  const bancos = listarBancos(db, empresaId)
  const totalBancos = bancos.reduce((s, b) => s + b.saldo, 0)
  const caja = (() => {
    const cta = db.prepare(`SELECT id FROM cuentas WHERE empresa_id = ? AND alias = 'CAJA' AND activa = 1`).get(empresaId)
    if (!cta) return null
    const s = db.prepare(`
      SELECT COALESCE(SUM(al.debe), 0) AS debe, COALESCE(SUM(al.haber), 0) AS haber
      FROM asiento_lineas al WHERE al.empresa_id = ? AND al.cuenta_id = ?
    `).get(empresaId, cta.id)
    return s.debe - s.haber
  })()
  const p = String(periodo || '')
  const mesActual = /^\d{4}(0[1-9]|1[0-2])$/.test(p)
    ? `${p.slice(0, 4)}-${p.slice(4, 6)}`
    : new Date().toISOString().slice(0, 7) // 'YYYY-MM' (UTC)
  const delMes = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN monto > 0 THEN monto ELSE 0 END), 0) AS ingresos,
      COALESCE(SUM(CASE WHEN monto < 0 THEN -monto ELSE 0 END), 0) AS egresos,
      COUNT(*) AS n
    FROM teso_movimientos
    WHERE empresa_id = ? AND substr(fecha, 1, 7) = ?
  `).get(empresaId, mesActual)
  return {
    bancos,
    total_bancos: totalBancos,
    caja,
    // `mes_actual` conserva el nombre por compatibilidad con los consumidores
    // existentes; `periodo` declara a qué mes corresponden estos totales.
    periodo: mesActual.replace('-', ''),
    mes_actual: { ingresos: delMes.ingresos, egresos: delMes.egresos, movimientos: delMes.n },
  }
}

module.exports = {
  TIPOS_MOV,
  crearBanco, listarBancos, obtenerBanco,
  registrarPagoCobro, registrarTransferencia,
  libroBanco, importarCartola, conciliarBanco, listarCartola,
  resumen,
}
