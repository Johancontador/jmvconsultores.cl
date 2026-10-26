/**
 * plan-ficha.js — FICHA TRIBUTARIA (T0-B) sobre plan_ficha_tributaria (T0-A).
 *
 * Principios (Fase T0/T1 aprobada):
 *  - La declaración es EXPLÍCITA: ninguna operación del sistema incorpora o
 *    completa fichas por inferencia (ni por RUT, teléfono, exento ni RCV).
 *  - Sin valores fiscales por defecto: los campos omitidos nacen en los
 *    centinelas 'PENDIENTE'/'SIN_CONFIGURAR', que son ausencia de decisión,
 *    no un régimen asignado.
 *  - Historial de doble firma dentro de UNA transacción: la fila append-only
 *    en plan_ficha_historial (detallada, empresa) + la bitácora central
 *    auditoria (trazabilidad de toda mutación del software contable).
 *  - En caso de fallar el historial/auditoría, falla la operación entera
 *    (patrón registrarAccion del resto del core).
 */

const { CAMPOS_TRIBUTARIOS } = require('./planificacion-tablas')
const { normalizarRut, validarRut } = require('./empresas')
const { registrarAccion } = require('./auditoria')

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/
const RE_AC = /^(19|20)\d{2}$/ // ejercicio comercial AAAA

/** Ficha vigente de la empresa, o `null` si aún no hay incorporación explícita. */
function obtener(db, empresaId) {
  return db.prepare(`SELECT * FROM plan_ficha_tributaria WHERE empresa_id = ?`).get(empresaId) || null
}

/** Últimas N entradas del historial (más nuevas primero) para la ficha. */
function listarHistorial(db, empresaId, limite = 20) {
  const n = Number.isInteger(Number(limite)) ? Math.min(Math.max(Number(limite), 1), 100) : 20
  return db.prepare(`
    SELECT h.*, u.username AS usuario_nombre
    FROM plan_ficha_historial h LEFT JOIN users u ON u.id = h.usuario_id
    WHERE h.empresa_id = ?
    ORDER BY h.id DESC LIMIT ?
  `).all(empresaId, n)
}

// ---------- Validaciones ----------

function _actividades(valor, cambios, clave) {
  if (!(clave in valor)) return
  const lista = valor[clave]
  if (lista === null || lista === undefined || lista === '') {
    cambios[clave] = '[]'
    return
  }
  if (!Array.isArray(lista)) throw new Error('actividades_economicas debe ser una lista de rubros')
  const limpias = lista.map((x) => String(x).trim()).filter(Boolean)
  if (limpias.length !== lista.length) throw new Error('actividades_economicas: los rubros no pueden ser vacíos')
  if (limpias.length > 30) throw new Error('actividades_economicas: máximo 30 rubros')
  cambios[clave] = JSON.stringify(limpias)
}

function _propietarios(valor, cambios) {
  if (!('propietarios' in valor)) return
  const lista = valor.propietarios
  if (lista === null || (Array.isArray(lista) && lista.length === 0)) {
    cambios.propietarios_json = '[]'
    return
  }
  if (!Array.isArray(lista)) throw new Error('propietarios debe ser una lista')
  let suma = 0
  const norm = lista.map((p) => {
    const rut = normalizarRut(p && p.rut)
    // normalizarRut solo da formato; la validez (DV módulo 11) la da validarRut.
    if (!validarRut(rut)) throw new Error(`propietarios: RUT inválido (${rut})`)
    const participacion = Number(p && p.participacion)
    const gravado = !!(p && p.gravado_finales)
    if (!rut) throw new Error('propietarios: RUT inválido')
    if (!Number.isFinite(participacion) || participacion <= 0 || participacion > 100) {
      throw new Error(`propietarios: participación inválida para ${rut} (0 < % ≤ 100)`)
    }
    suma += participacion
    return { rut, participacion, gravado_finales: gravado }
  })
  if (suma > 100 + 1e-9) throw new Error(`propietarios: las participaciones suman ${Math.round(suma * 1e6) / 1e6}% (> 100%)`)
  cambios.propietarios_json = JSON.stringify(norm)
}

/** Normaliza y valida el payload (o los cambios) de la ficha. */
function normalizar(db, empresaId, entrada) {
  const fichaViva = obtener(db, empresaId)
  const destino = {}
  const src = entrada || {}

  if ('regimen' in src) {
    const r = String(src.regimen || '').trim()
    if (!CAMPOS_TRIBUTARIOS.REGIMEN.includes(r)) throw new Error(`Régimen inválido: ${r || '(vacío)'}`)
    if (fichaViva && fichaViva.regimen !== 'PENDIENTE' && r === 'PENDIENTE') {
      throw new Error('No se puede volver al centinela PENDIENTE una ficha ya declarada')
    }
    destino.regimen = r
  }
  if ('regimen_desde_ac' in src) {
    if (src.regimen_desde_ac === null || src.regimen_desde_ac === undefined || src.regimen_desde_ac === '') {
      destino.regimen_desde_ac = null
    } else {
      const ac = String(src.regimen_desde_ac).trim()
      if (!RE_AC.test(ac)) throw new Error(`regimen_desde_ac debe ser AAAA: ${ac}`)
      destino.regimen_desde_ac = ac
    }
  }
  // Consistencia declarativa: régimen real EXIGE vigencia (CHECK de la BD la
  // refuerza; acá solo precisamos el mensaje).
  const regimenFinal = 'regimen' in destino ? destino.regimen : (fichaViva ? fichaViva.regimen : 'PENDIENTE')
  const acFinal = 'regimen_desde_ac' in destino ? destino.regimen_desde_ac : (fichaViva ? fichaViva.regimen_desde_ac : null)
  if (regimenFinal !== 'PENDIENTE' && (acFinal === null || acFinal === undefined)) {
    throw new Error(`El régimen ${regimenFinal} exige regimen_desde_ac (ejercicio comercial AAAA desde el que rige)`)
  }

  if ('tipo_contribuyente' in src) {
    const t = String(src.tipo_contribuyente || '').trim()
    if (!CAMPOS_TRIBUTARIOS.TIPO_CONTRIBUTUYENTE.includes(t)) throw new Error(`Tipo de contribuyente inválido: ${t || '(vacío)'}`)
    destino.tipo_contribuyente = t
  }
  if ('sujeto_boletas_honorarios' in src) {
    destino.sujeto_boletas_honorarios = src.sujeto_boletas_honorarios ? 1 : 0
  }
  if ('fecha_inicio_actividades' in src) {
    if (src.fecha_inicio_actividades === null || src.fecha_inicio_actividades === undefined || src.fecha_inicio_actividades === '') {
      destino.fecha_inicio_actividades = null
    } else if (!RE_FECHA.test(String(src.fecha_inicio_actividades).trim())) {
      throw new Error(`fecha_inicio_actividades debe ser YYYY-MM-DD`)
    } else {
      destino.fecha_inicio_actividades = String(src.fecha_inicio_actividades).trim()
    }
  }
  _actividades(src, destino, 'actividades_economicas')
  _propietarios(src, destino)

  // estado_ficha se CALCULA, nunca se recibe: es la consecuencia de haber
  // declarado régimen + tipo + actividades. No es un valor fiscal, es un
  // estado de completitud. SOLO viaja en el delta si el pedido trae algún
  // campo real: un payload vacío no puede «cambiar» el estado (si no, el
  // guard de «sin cambios» nunca dispararía porque el delta no estaría vacío).
  if (Object.keys(destino).length > 0) {
    const regimen = destino.regimen ?? (fichaViva ? fichaViva.regimen : 'PENDIENTE')
    const tipo = destino.tipo_contribuyente ?? (fichaViva ? fichaViva.tipo_contribuyente : 'PENDIENTE')
    const activs = destino.actividades_economicas ?? (fichaViva ? fichaViva.actividades_economicas : '[]')
    destino.estado_ficha =
      (regimen !== 'PENDIENTE' && tipo !== 'PENDIENTE' && JSON.parse(activs).length > 0)
        ? 'CONFIGURADA' : 'SIN_CONFIGURAR'
  }

  return destino
}

// ---------- Escrituras (sempre transacción única con historial) ----------

function _historialInsert(db, { empresaId, usuarioId, accion, antes, despues, ip }) {
  return db.prepare(`
    INSERT INTO plan_ficha_historial (empresa_id, usuario_id, accion, antes_json, despues_json, ip)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(empresaId, usuarioId, accion, JSON.stringify(antes), JSON.stringify(despues), ip ?? null)
}

function _accionCentral(db, { empresaId, usuarioId, accion, fichaId, antes, despues, ip }) {
  registrarAccion(db, {
    empresaId, usuarioId, accion,
    entidad: 'plan_ficha_tributaria', entidadId: String(fichaId),
    antes, despues, ip,
  })
}

function _snapshot(f) {
  if (!f) return null
  return {
    rut: f.rut, regimen: f.regimen, tipo_contribuyente: f.tipo_contribuyente,
    estado_ficha: f.estado_ficha, actividades_economicas: f.actividades_economicas,
    fecha_inicio_actividades: f.fecha_inicio_actividades, regimen_desde_ac: f.regimen_desde_ac,
    propietarios_json: f.propietarios_json, sujeto_boletas_honorarios: f.sujeto_boletas_honorarios,
    vigente_desde: f.vigente_desde, vigente_hasta: f.vigente_hasta,
  }
}

/**
 * Incorporación EXPLÍCITA: crea la única fila vigente de la empresa. Solo se
 * admite si la empresa no tenía ficha; falla con 409 si ya existe. Los campos
 * tributarios omitidos nacen PENDIENTE/SIN_CONFIGURAR — nunca régimen asignado.
 */
function incorporar(db, { empresaId, usuarioId, datos, ip = null }) {
  const emp = db.prepare(`SELECT id, rut FROM empresas WHERE id = ? AND activo = 1`).get(empresaId)
  if (!emp) throw new Error('Empresa no encontrada en esta sesión')
  if (obtener(db, empresaId)) {
    const e = new Error('La empresa ya tiene ficha incorporada: use actualizar (PUT)')
    e.status = 409
    throw e
  }
  const cambios = normalizar(db, empresaId, datos)
  if (!String(cambios.rut ?? emp.rut)) throw new Error('RUT obligatorio')

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO plan_ficha_tributaria (empresa_id, rut)
      VALUES (?, ?)
    `).run(empresaId, emp.rut) // rut ESPEJO validado contra la propia empresa
    const fichaId = info.lastInsertRowid
    if (Object.keys(cambios).length > 0) {
      const sets = Object.keys(cambios).map((c) => `${c} = @${c}`).join(', ')
      db.prepare(`UPDATE plan_ficha_tributaria SET ${sets}, actualizado_en = datetime('now') WHERE id = @id`)
        .run({ ...cambios, id: fichaId })
    }
    const despues = obtener(db, empresaId)
    _historialInsert(db, { empresaId, usuarioId, accion: 'ficha.crear', antes: null, despues: _snapshot(despues), ip })
    _accionCentral(db, { empresaId, usuarioId, accion: 'planificacion.ficha.crear', fichaId, antes: null, despues: _snapshot(despues), ip })
    return despues
  })
  return { ficha: tx() }
}

/** Cambios sobre la ficha vigente. `cambios` vacío → rechazo (historial limpio). */
function actualizar(db, { empresaId, usuarioId, cambios = {}, ip = null }) {
  const antes = obtener(db, empresaId)
  if (!antes) {
    const e = new Error('La empresa no tiene ficha incorporada: use incorporación explícita (POST)')
    e.status = 404
    throw e
  }
  const delta = normalizar(db, empresaId, cambios)
  if (Object.keys(delta).length === 0) throw new Error('Sin cambios que registrar')
  if (_snapshotEquivale(antes, delta)) throw new Error('Los valores declarados son idénticos a los vigentes: nada que registrar')

  const tx = db.transaction(() => {
    const sets = Object.keys(delta).map((c) => `${c} = @${c}`).join(', ')
    db.prepare(`UPDATE plan_ficha_tributaria SET ${sets}, actualizado_en = datetime('now') WHERE empresa_id = @empresa_id`)
      .run({ ...delta, empresa_id: empresaId })
    const despues = obtener(db, empresaId)
    _historialInsert(db, { empresaId, usuarioId, accion: 'ficha.actualizar', antes: _snapshot(antes), despues: _snapshot(despues), ip })
    _accionCentral(db, { empresaId, usuarioId, accion: 'planificacion.ficha.actualizar', fichaId: despues.id, antes: _snapshot(antes), despues: _snapshot(despues), ip })
    return despues
  })
  return { ficha: tx() }
}

function _snapshotEquivale(ficha, delta) {
  return Object.entries(delta).every(([clave, valor]) => {
    const actual = ficha[clave]
    if (['actividades_economicas', 'propietarios_json'].includes(clave)) {
      try { return JSON.stringify(JSON.parse(String(actual))) === JSON.stringify(JSON.parse(String(valor))) } catch { return false }
    }
    return String(actual) === String(valor)
  })
}

module.exports = { obtener, listarHistorial, normalizar, incorporar, actualizar, CAMPOS_TRIBUTARIOS }
