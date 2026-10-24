#!/usr/bin/env node
'use strict'
/**
 * entorno-demo.js — BD FICTICIA para la validación visual/funcional (F3).
 *
 * POR QUÉ EXISTE
 * --------------
 * Las capturas y los recorridos de F3 no pueden hacerse sobre `data/iva_mensual.db`:
 * esa base tiene clientes reales y, además, cualquier login dispara el auto-sync
 * del SII (`routes/auth.js` → sync-diaria). Este generador crea una base NUEVA en
 * un directorio temporal con:
 *   - empresas y personas inventadas (RUT con dígito verificador válido pero
 *     sin relación con contribuyentes reales);
 *   - `empresas.clave_sii = ''` → sync-diaria filtra las empresas sin clave, así
 *     que NINGUNA ruta de sólo lectura puede intentar autenticarse en el SII;
 *   - usuarios de prueba con clave local, creados por el mismo `hashPassword`
 *     de la aplicación (nunca credenciales productivas).
 *
 * Uso:
 *   DB_PATH=/ruta/temporal/demo.db node scripts/validacion-pre-produccion/entorno-demo.js
 *
 * No toca el `.env` ni la BD productiva: `DB_PATH` se recibe por entorno y el
 * proceso muere al terminar el sembrado. No escribe auditoría fuera de la BD
 * temporal y no llama a ninguna red externa.
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const DB_PATH = process.env.DB_PATH
if (!DB_PATH) {
  console.error('Falta DB_PATH (base temporal donde sembrar la demo ficticia).')
  process.exit(1)
}
if (!/tmp|temp|demo|f3/i.test(DB_PATH)) {
  // Guarda explícita: jamás sembrar sobre la base real del proyecto.
  console.error(`DB_PATH no parece temporal (${DB_PATH}). Abortado por seguridad.`)
  process.exit(1)
}

process.env.DB_PATH = DB_PATH
process.env.BASIC_AUTH_USER = process.env.DEMO_USER || 'demo'
process.env.BASIC_AUTH_PASS = process.env.DEMO_PASS || 'DemoF3.2026'
// Clave maestra EFÍMERA: sólo cifra/descifra las claves ficticias de esta BD.
// Si el llamador ya definió una, se respeta.
if (!process.env.SECRETOS_MASTER_KEY) {
  process.env.SECRETOS_MASTER_KEY = crypto.randomBytes(32).toString('hex')
}

const db = require('../../backend/db')
const empresas = require('../../backend/core/empresas')
const cuentas = require('../../backend/core/cuentas')
const documentos = require('../../backend/core/documentos')
const propuestas = require('../../backend/core/propuestas')
const asientos = require('../../backend/core/asientos')
const tesoreria = require('../../backend/core/tesoreria')
const periodos = require('../../backend/core/periodos')
const reglasSemilla = require('../../backend/core/reglas-semilla')
const crm = require('../../backend/core/crm-comercial')
const cotizaciones = require('../../backend/core/portal-cotizaciones')
const costos = require('../../backend/core/portal-costos')
const { hashPassword } = require('../../backend/services/password')

// ---------- utilidades ----------

/** Dígito verificador módulo 11 (misma regla que empresas.validarRut). */
function dv(cuerpo) {
  let suma = 0
  let mult = 2
  for (let i = String(cuerpo).length - 1; i >= 0; i--) {
    suma += Number(String(cuerpo)[i]) * mult
    mult = mult === 7 ? 2 : mult + 1
  }
  const d = 11 - (suma % 11)
  return d === 11 ? 0 : d === 10 ? 'K' : String(d)
}
const rut = (cuerpo) => `${cuerpo}-${dv(cuerpo)}`

const RUT_A = rut('76543210')
const RUT_B = rut('77123456')
const RUT_CLI = rut('12345678')
const RUT_PROV = rut('87654321')

function rol(codigo) {
  return db.prepare(`SELECT id FROM roles WHERE codigo = ?`).get(codigo).id
}

function usuario(username, { admin = false } = {}) {
  const info = db.prepare(`INSERT INTO users (username, password_hash, is_admin, activo) VALUES (?, ?, ?, 1)`)
    .run(username, hashPassword(process.env.DEMO_PASS || 'DemoF3.2026'), admin ? 1 : 0)
  return info.lastInsertRowid
}

function asignar(usuarioId, empresaId, rolCodigo) {
  db.prepare(`INSERT INTO usuario_empresa (usuario_id, empresa_id, rol_id, activo) VALUES (?, ?, ?, 1)`)
    .run(usuarioId, empresaId, rol(rolCodigo))
}

// ---------- empresas (ficticias) ----------

const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1`).get().id

const empA = empresas.crear(db, {
  usuarioId: adminId, rut: RUT_A, nombre: 'Comercial Aurora SpA',
  claveSii: 'clave-ficticia-demo', tasaPpm: 0.01, telefono: '222555000', ip: '127.0.0.1',
})
const empB = empresas.crear(db, {
  usuarioId: adminId, rut: RUT_B, nombre: 'Servicios Bellavista Ltda',
  claveSii: 'clave-ficticia-demo', tasaPpm: 0.005, telefono: '222555111', ip: '127.0.0.1',
})
// SIN clave SII: es la barrera que impide que sync-diaria / cualquier acción
// automática abra sesión en el SII durante la validación (filtra !clave_sii).
db.prepare(`UPDATE empresas SET clave_sii = '' WHERE id IN (?, ?)`).run(empA.id, empB.id)

// ---------- usuarios de prueba (roles reales del RBAC) ----------

const uContador = usuario('demo.contador')
const uDueno = usuario('demo.dueno')
const uAuditor = usuario('demo.auditor')
const uTeso = usuario('demo.tesoreria')
asignar(uContador, empA.id, 'contador')
asignar(uDueno, empA.id, 'admin_empresa')
asignar(uAuditor, empA.id, 'auditor')
asignar(uTeso, empA.id, 'tesoreria')
asignar(uContador, empB.id, 'contador')

// ---------- datos contables de la empresa A ----------

reglasSemilla.instalarSiVacia(db, { empresaId: empA.id, usuarioId: uContador, ip: '127.0.0.1' })
periodos.obtenerOCrear(db, empA.id, '202608')
periodos.obtenerOCrear(db, empA.id, '202609')

const docA = (tipoFlujo, { tipoDoc, folio, contraparte, razon, fecha, neto, exento = 0 }) => {
  const iva = Math.round(neto * 0.19)
  return {
    tipoDoc, folio, rutDoc: contraparte, razonSocial: razon, fechaDocto: fecha,
    montoExento: exento, montoNeto: neto, montoIVA: iva, montoTotal: neto + iva + exento,
  }
}

const VENTAS = [
  docA('venta', { tipoDoc: 33, folio: '1001', contraparte: RUT_CLI, razon: 'Distribuidora Andes SpA', fecha: '03/09/2026', neto: 2400000 }),
  docA('venta', { tipoDoc: 33, folio: '1002', contraparte: rut('13579246'), razon: 'Comercial Maipú Ltda', fecha: '09/09/2026', neto: 1180000 }),
  docA('venta', { tipoDoc: 33, folio: '1003', contraparte: rut('9876543'), razon: 'Constructora Pehuenche SpA', fecha: '17/09/2026', neto: 4650000 }),
  docA('venta', { tipoDoc: 61, folio: '44', contraparte: RUT_CLI, razon: 'Distribuidora Andes SpA', fecha: '21/09/2026', neto: 300000 }),
  docA('venta', { tipoDoc: 39, folio: '778', contraparte: '', razon: '', fecha: '26/09/2026', neto: 89000 }),
  docA('venta', { tipoDoc: 33, folio: '998', contraparte: rut('24681357'), razon: 'Hotelería del Litoral Ltda', fecha: '14/08/2026', neto: 1500000 }),
]

const COMPRAS = [
  docA('compra', { tipoDoc: 33, folio: '5521', contraparte: RUT_PROV, razon: 'Insumos del Sur Ltda', fecha: '04/09/2026', neto: 860000 }),
  docA('compra', { tipoDoc: 33, folio: '5522', contraparte: RUT_PROV, razon: 'Insumos del Sur Ltda', fecha: '12/09/2026', neto: 1290000 }),
  docA('compra', { tipoDoc: 33, folio: '9090', contraparte: rut('11111111'), razon: 'Energía Metropolitana SpA', fecha: '15/09/2026', neto: 320000 }),
  docA('compra', { tipoDoc: 34, folio: '312', contraparte: rut('22222222'), razon: 'Asesorías Contables RM', fecha: '19/09/2026', neto: 500000 }),
  docA('compra', { tipoDoc: 61, folio: '77', contraparte: RUT_PROV, razon: 'Insumos del Sur Ltda', fecha: '24/09/2026', neto: 120000 }),
  docA('compra', { tipoDoc: 33, folio: '5400', contraparte: rut('33333333'), razon: 'Transportes Cuesta Abajo', fecha: '07/08/2026', neto: 410000 }),
]

const rVentas = documentos.ingestarBatch(db, {
  empresaId: empA.id, usuarioId: uContador, tipoFlujo: 'venta', periodo: '202609', documentos: VENTAS, ip: '127.0.0.1',
})
const rCompras = documentos.ingestarBatch(db, {
  empresaId: empA.id, usuarioId: uContador, tipoFlujo: 'compra', periodo: '202609', documentos: COMPRAS, ip: '127.0.0.1',
})

// Clasificar (cuentas reales del plan PUC sembrado) y proponer.
const ctaVentas = cuentas.cuentaPorAlias(db, empA.id, 'VENTAS_SERVICIOS')
const ctaGasto = cuentas.cuentaPorAlias(db, empA.id, 'GASTO_SERVICIOS_BASICOS')
const pendientes = db.prepare(`
  SELECT id, tipo_flujo FROM documentos WHERE empresa_id = ? AND estado = 'PENDIENTE' ORDER BY id LIMIT 8
`).all(empA.id)
for (const d of pendientes) {
  documentos.clasificar(db, {
    empresaId: empA.id, usuarioId: uContador, documentoId: d.id,
    cuentaId: d.tipo_flujo === 'venta' ? ctaVentas.id : ctaGasto.id,
    // El tratamiento describe el IVA del documento; las compras de la demo
    // llevan crédito y las ventas el crédito por defecto del módulo.
    tratamientoIva: 'credito', ip: '127.0.0.1',
  })
  propuestas.generar(db, { empresaId: empA.id, usuarioId: uContador, documentoId: d.id, ip: '127.0.0.1' })
}
// Confirmar dos propuestas → asientos reales (débito/crédito balanceados).
const vivas = db.prepare(`SELECT id FROM propuestas WHERE empresa_id = ? AND estado = 'PENDIENTE' ORDER BY id LIMIT 2`).all(empA.id)
for (const p of vivas) {
  propuestas.confirmar(db, { empresaId: empA.id, usuarioId: uContador, propuestaId: p.id, fecha: '2026-09-30', ip: '127.0.0.1' })
}
// Un asiento manual adicional (gasto bancario) para que el diario tenga variedad.
asientos.crear(db, {
  empresaId: empA.id, usuarioId: uContador, fecha: '2026-09-28',
  glosa: 'Comisión bancaria septiembre', tipo: 'manual',
  lineas: [
    { cuenta_codigo: '6.2.1.02', debe: 18900, haber: 0 },
    { cuenta_codigo: '1.1.1.02', debe: 0, haber: 18900 },
  ],
  ip: '127.0.0.1',
})

// ---------- tesorería ----------

const ctaBanco = cuentas.cuentaPorAlias(db, empA.id, 'BANCOS')
// crearBanco devuelve el ID de la cuenta bancaria (no el objeto).
const bancoId = tesoreria.crearBanco(db, {
  empresaId: empA.id, usuarioId: uContador, banco: 'Banco de Pruebas',
  numero: '000-9-00000-0', cuentaContableId: ctaBanco.id, saldoInicial: 3500000, ip: '127.0.0.1',
})
const primerDoc = db.prepare(`SELECT id, monto_total FROM documentos WHERE empresa_id = ? AND tipo_flujo = 'venta' AND estado = 'CONTABILIZADO' LIMIT 1`).get(empA.id)
if (primerDoc) {
  tesoreria.registrarPagoCobro(db, {
    empresaId: empA.id, usuarioId: uContador, bancoCuentaId: bancoId, tipo: 'COBRO',
    fecha: '2026-09-30', monto: primerDoc.monto_total, glosa: `Cobro factura folio ${primerDoc.id}`,
    documentoId: primerDoc.id, ip: '127.0.0.1',
  })
}
// Segundo banco/segunda cuenta contable: el selector de tesorería necesita más
// de una cuenta para probar el cambio de contexto.
const ctaAhorro = cuentas.cuentaPorAlias(db, empA.id, 'CAJA')
tesoreria.crearBanco(db, {
  empresaId: empA.id, usuarioId: uContador, banco: 'Caja Chica Demo',
  numero: '', cuentaContableId: ctaAhorro.id, saldoInicial: 120000, ip: '127.0.0.1',
})

// ---------- CRM comercial (despacho) ----------

crm.guardarFicha(db, {
  usuarioId: uContador, empresaId: empA.id, ip: '127.0.0.1',
  ficha: { nombre_comercial: 'Aurora', giro: 'Venta de insumos industriales', correo: 'contacto@aurora-demo.cl', direccion: 'Av. Ficticia 1234, Santiago', fuente: 'referido', prioridad: 'alta' },
})
crm.crearContacto(db, {
  usuarioId: uContador, empresaId: empA.id, ip: '127.0.0.1',
  contacto: { nombre: 'Camila Rojas (ficción)', correo: 'camila@aurora-demo.cl', telefono: '900000001', cargo: 'Gerente de administración', principal: true },
})
crm.crearProspecto(db, {
  usuarioId: uContador, ip: '127.0.0.1',
  prospecto: { nombre: 'Panadería Los Robles (ficción)', rut: rut('15555555'), correo: 'hola@losrobles-demo.cl', telefono: '900000002', fuente: 'web', notas: 'Pidió propuesta de contabilidad mensual' },
})
try {
  crm.crearOportunidad(db, {
    usuarioId: uContador, ip: '127.0.0.1',
    oportunidad: { nombre: 'Asesoría tributaria anual (ficción)', empresaId: empA.id, monto: 1800000, etapa: 'PROPUESTA', probabilidad: 60 },
  })
} catch (err) {
  // El embudo es configurable: si la etapa sembrada no existe en esta versión,
  // la oportunidad no se crea (se informa y se sigue).
  console.warn('[demo] oportunidad omitida:', err.message)
}

// ---------- portal del cliente (datos registrados por el dueño) ----------

// Tablas del portal que el router crea de forma perezosa al primer uso.
const credito = require('../../backend/core/portal-credito')
for (const mod of [cotizaciones, costos, credito]) mod.ensureTablas(db)

cotizaciones.crear(db, {
  empresaId: empA.id, usuarioId: uDueno, clienteRut: RUT_CLI, clienteRazon: 'Distribuidora Andes SpA',
  descripcion: 'Suministro trimestral de insumos (ficción)', monto: 7200000, estado: 'ENVIADA', ip: '127.0.0.1',
})
cotizaciones.crear(db, {
  empresaId: empA.id, usuarioId: uDueno, clienteRut: rut('24681357'), clienteRazon: 'Hotelería del Litoral Ltda',
  descripcion: 'Mantención anual (ficción)', monto: 3400000, estado: 'ACEPTADA', ip: '127.0.0.1',
})
costos.fijarCosto(db, {
  empresaId: empA.id, usuarioId: uDueno, producto: 'Insumo industrial A', costoUnitario: 45000, ip: '127.0.0.1',
})

// ---------- resumen de lo sembrado ----------

const cuenta = (tabla, where = '') => {
  try { return db.prepare(`SELECT COUNT(*) AS n FROM ${tabla} ${where}`).get().n } catch { return 'n/a' }
}
const resumen = {
  db: DB_PATH,
  empresas: [empA.id, empB.id],
  rutas_demo: { A: RUT_A, B: RUT_B },
  usuarios: {
    demo: { user: process.env.BASIC_AUTH_USER, pass: process.env.BASIC_AUTH_PASS, rol: 'super admin' },
    'demo.contador': 'contador (despacho)',
    'demo.dueno': 'admin_empresa',
    'demo.auditor': 'auditor',
    'demo.tesoreria': 'tesoreria',
  },
  documentos: { ventas: rVentas, compras: rCompras },
  filas: {
    documentos: cuenta('documentos'), propuestas: cuenta('propuestas'), asientos: cuenta('asientos'),
    bancos: cuenta('bancos_cuentas'), movimientos: cuenta('teso_movimientos'),
    prospectos: cuenta('crm_prospectos'), oportunidades: cuenta('crm_oportunidades'),
    cotizaciones: cuenta('portal_cotizaciones'), declaraciones: cuenta('declaraciones_sii'),
  },
}
console.log(JSON.stringify(resumen, null, 2))
db.close()
