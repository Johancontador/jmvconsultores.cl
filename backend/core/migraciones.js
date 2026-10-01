/**
 * Migraciones FASE 1 — Fundación del software contable (DATA_MODEL §B.1).
 *
 * Patrón del proyecto: idempotentes, se ejecutan en cada arranque desde
 * backend/db.js. Nada de lo existente (clientes, informes, rcv_cache) se
 * modifica ni se elimina: `empresas` es la capa nueva y `clientes` sigue
 * siendo la fuente del sistema tributario legado.
 *
 * - La clave SII de cada empresa nueva se guarda CIFRADA (core/boveda.js).
 *   La clave legada en clientes queda como está (texto plano) para no tocar
 *   los servicios tributarios existentes; DATA_MODEL §B.7 documenta el plan.
 * - El dueño actual del cliente (user_id) queda asignado como admin_empresa
 *   de su empresa; el admin global (users.is_admin) queda además super_admin.
 */

const { cifrar } = require('./boveda')
const { PLANTILLA, clasificar } = require('./plan-cuentas-plantilla')

function migracionesFase1(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS empresas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rut TEXT NOT NULL,
      nombre TEXT NOT NULL,
      clave_sii TEXT NOT NULL,
      tasa_ppm REAL NOT NULL DEFAULT 0,
      telefono TEXT,
      exento INTEGER NOT NULL DEFAULT 0,
      activo INTEGER NOT NULL DEFAULT 1,
      creado_en TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_empresas_rut ON empresas(rut) WHERE activo = 1;

    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT NOT NULL UNIQUE,
      nombre TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS usuario_empresa (
      usuario_id INTEGER NOT NULL REFERENCES users(id),
      empresa_id INTEGER NOT NULL REFERENCES empresas(id),
      rol_id INTEGER NOT NULL REFERENCES roles(id),
      activo INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (usuario_id, empresa_id)
    );
    CREATE INDEX IF NOT EXISTS idx_usuario_empresa_empresa ON usuario_empresa(empresa_id);

    CREATE TABLE IF NOT EXISTS periodos_contables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id),
      periodo TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'ABIERTO',
      cerrado_por INTEGER REFERENCES users(id),
      cerrado_en TEXT,
      reapertura_motivo TEXT,
      UNIQUE(empresa_id, periodo)
    );

    CREATE TABLE IF NOT EXISTS auditoria (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER,
      usuario_id INTEGER NOT NULL REFERENCES users(id),
      accion TEXT NOT NULL,
      entidad TEXT NOT NULL,
      entidad_id TEXT,
      antes_json TEXT,
      despues_json TEXT,
      ip TEXT,
      creado_en TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_auditoria_empresa_fecha ON auditoria(empresa_id, creado_en DESC);
  `)

  // Semilla de roles (idempotente). El catálogo de permisos vive en core/permisos.js;
  // aquí solo se fijan los códigos válidos en BD para las FK de usuario_empresa.
  const roles = [
    ['super_admin', 'Super Administrador'],
    ['contador', 'Contador'],
    ['admin_empresa', 'Administrador de Empresa'],
    ['auditor', 'Auditor'],
    ['tesoreria', 'Tesorería'],
  ]
  // INSERT OR IGNORE: idempotente — si el rol ya existe, no pasa nada.
  const insertarRol = db.prepare(`INSERT OR IGNORE INTO roles (codigo, nombre) VALUES (?, ?)`)
  for (const [codigo, nombre] of roles) {
    insertarRol.run(codigo, nombre)
  }

  // Migración clientes → empresas (1:1, idempotente).
  const rolAdminEmpresa = db.prepare(`SELECT id FROM roles WHERE codigo = 'admin_empresa'`).get()
  const rolSuperAdmin = db.prepare(`SELECT id FROM roles WHERE codigo = 'super_admin'`).get()
  const clientesSinEmpresa = db.prepare(`
    SELECT c.id, c.rut, c.nombre, c.clave_sii, c.tasa_ppm, c.telefono, c.exento, c.user_id
    FROM clientes c
    WHERE c.activo = 1
      AND c.rut IS NOT NULL AND c.rut != ''
      AND NOT EXISTS (SELECT 1 FROM empresas e WHERE e.rut = c.rut AND e.activo = 1)
  `).all()

  const insertarEmpresa = db.prepare(`
    INSERT INTO empresas (rut, nombre, clave_sii, tasa_ppm, telefono, exento)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const asignar = db.prepare(`
    INSERT OR IGNORE INTO usuario_empresa (usuario_id, empresa_id, rol_id)
    VALUES (?, ?, ?)
  `)

  const tx = db.transaction(() => {
    for (const c of clientesSinEmpresa) {
      const claveCifrada = cifrar(c.clave_sii) // la bóveda maneja legacy/valores vacíos
      const info = insertarEmpresa.run(c.rut, c.nombre, claveCifrada, c.tasa_ppm, c.telefono || null, c.exento)
      const empresaId = info.lastInsertRowid
      if (c.user_id) {
        asignar.run(c.user_id, empresaId, rolAdminEmpresa ? rolAdminEmpresa.id : null)
      }
    }
  })
  tx()

  // El admin global (is_admin) obtiene super_admin sobre TODAS las empresas activas.
  const admins = db.prepare(`SELECT id FROM users WHERE is_admin = 1 AND activo = 1`).all()
  const empresas = db.prepare(`SELECT id FROM empresas WHERE activo = 1`).all()
  if (rolSuperAdmin && admins.length && empresas.length) {
    const txAdmin = db.transaction(() => {
      for (const u of admins) {
        for (const e of empresas) {
          // Si ya tiene una asignación (p. ej. como admin_empresa por ser dueño),
          // se actualiza a super_admin; si no, se inserta.
          db.prepare(`
            INSERT INTO usuario_empresa (usuario_id, empresa_id, rol_id)
            VALUES (?, ?, ?)
            ON CONFLICT(usuario_id, empresa_id) DO UPDATE SET rol_id = excluded.rol_id, activo = 1
          `).run(u.id, e.id, rolSuperAdmin.id)
        }
      }
    })
    txAdmin()
  }
}

/**
 * FASE 2 — Núcleo contable: plan de cuentas, centros de costo, asientos.
 * Idempotente; precarga la plantilla PUC en toda empresa que aún no tenga cuentas.
 */
function migracionesFase2(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS centros_costo (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id),
      codigo TEXT NOT NULL,
      nombre TEXT NOT NULL,
      activo INTEGER NOT NULL DEFAULT 1,
      UNIQUE(empresa_id, codigo)
    );

    CREATE TABLE IF NOT EXISTS cuentas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id),
      codigo TEXT NOT NULL,
      nombre TEXT NOT NULL,
      clase INTEGER NOT NULL,
      naturaleza TEXT NOT NULL,
      es_resumen INTEGER NOT NULL DEFAULT 0,
      cierre TEXT NOT NULL DEFAULT 'balance',
      alias TEXT,
      activa INTEGER NOT NULL DEFAULT 1,
      creado_en TEXT DEFAULT (datetime('now')),
      UNIQUE(empresa_id, codigo)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cuentas_alias ON cuentas(empresa_id, alias) WHERE alias IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_cuentas_empresa ON cuentas(empresa_id);

    CREATE TABLE IF NOT EXISTS asientos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id),
      folio INTEGER NOT NULL,
      anio INTEGER NOT NULL,
      fecha TEXT NOT NULL,
      periodo TEXT NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'manual',
      glosa TEXT NOT NULL,
      usuario_id INTEGER NOT NULL REFERENCES users(id),
      asiento_revertido_id INTEGER REFERENCES asientos(id),
      creado_en TEXT DEFAULT (datetime('now')),
      UNIQUE(empresa_id, anio, folio)
    );
    CREATE INDEX IF NOT EXISTS idx_asientos_empresa_periodo ON asientos(empresa_id, periodo);

    CREATE TABLE IF NOT EXISTS asiento_lineas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id),
      asiento_id INTEGER NOT NULL REFERENCES asientos(id),
      cuenta_id INTEGER NOT NULL REFERENCES cuentas(id),
      debe INTEGER NOT NULL DEFAULT 0,
      haber INTEGER NOT NULL DEFAULT 0,
      centro_costo_id INTEGER REFERENCES centros_costo(id),
      glosa TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_lineas_asiento ON asiento_lineas(asiento_id);
    CREATE INDEX IF NOT EXISTS idx_lineas_empresa_cuenta ON asiento_lineas(empresa_id, cuenta_id);
  `)

  // Precarga de la plantilla PUC para toda empresa activa sin plan (idempotente)
  const sinPlan = db.prepare(`
    SELECT e.id FROM empresas e
    WHERE e.activo = 1 AND NOT EXISTS (SELECT 1 FROM cuentas c WHERE c.empresa_id = e.id)
  `).all()
  if (sinPlan.length) {
    const insertar = db.prepare(`
      INSERT INTO cuentas (empresa_id, codigo, nombre, clase, naturaleza, es_resumen, cierre, alias)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const { id: empresaId } of sinPlan) {
      seedPlanCuentas(db, empresaId, insertar)
    }
  }
}

/** Inserta la plantilla PUC para una empresa (asume que no tiene cuentas aún). */
function seedPlanCuentas(db, empresaId, stmtInsertar = null) {
  const insertar = stmtInsertar || db.prepare(`
    INSERT INTO cuentas (empresa_id, codigo, nombre, clase, naturaleza, es_resumen, cierre, alias)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const tx = db.transaction(() => {
    for (const item of PLANTILLA) {
      const { clase, naturaleza, cierre } = clasificar(item.codigo)
      insertar.run(
        empresaId, item.codigo, item.nombre, clase, naturaleza,
        item.esResumen ? 1 : 0, cierre, item.alias || null
      )
    }
  })
  tx()
  return PLANTILLA.length
}

module.exports = { migracionesFase1, migracionesFase2, seedPlanCuentas }
