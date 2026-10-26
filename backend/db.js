const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { hashPassword } = require('./services/password')

const dbPath = process.env.DB_PATH || './data/iva_mensual.db'
const dbDir = path.dirname(dbPath)

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true })
}

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS clientes (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    rut       TEXT NOT NULL,
    nombre    TEXT NOT NULL,
    clave_sii TEXT NOT NULL,
    tasa_ppm  REAL NOT NULL DEFAULT 0,
    telefono  TEXT NOT NULL,
    exento    INTEGER NOT NULL DEFAULT 0,
    activo    INTEGER NOT NULL DEFAULT 1,
    creado_en TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS procesos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    periodo       TEXT NOT NULL,
    cliente_id    INTEGER NOT NULL,
    ventas_neto   REAL DEFAULT 0,
    ventas_iva    REAL DEFAULT 0,
    ventas_total  REAL DEFAULT 0,
    compras_neto  REAL DEFAULT 0,
    compras_iva   REAL DEFAULT 0,
    compras_total REAL DEFAULT 0,
    iva_determinado REAL DEFAULT 0,
    ppm_monto     REAL DEFAULT 0,
    total_pagar   REAL DEFAULT 0,
    estado        TEXT DEFAULT 'pendiente',
    error_msg     TEXT,
    creado_en     TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (cliente_id) REFERENCES clientes(id)
  );

  -- Caché de documentos RCV ya descargados, solo para períodos cerrados
  -- (nunca el mes en curso). Evita repetir consultas al SII cuando se vuelve
  -- a generar un Informe/Reporte/Dashboard para un rango ya consultado antes.
  CREATE TABLE IF NOT EXISTS rcv_cache (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    rut           TEXT NOT NULL,
    periodo       TEXT NOT NULL,
    tipo          TEXT NOT NULL,
    datos         TEXT NOT NULL,
    consultado_en TEXT DEFAULT (datetime('now')),
    UNIQUE(rut, periodo, tipo)
  );

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    activo        INTEGER NOT NULL DEFAULT 1,
    creado_en     TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    creado_en  TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`)

// Migración: cada cliente pasa a tener un dueño (user_id). Los clientes que
// ya existían antes de multiusuario se asignan al admin sembrado más abajo.
const clientesInfo = db.prepare(`PRAGMA table_info(clientes)`).all()
if (!clientesInfo.some((c) => c.name === 'user_id')) {
  db.exec(`ALTER TABLE clientes ADD COLUMN user_id INTEGER REFERENCES users(id)`)
}

// Siembra del usuario admin: reutiliza BASIC_AUTH_USER/BASIC_AUTH_PASS (el
// login que ya se usaba antes de tener tabla de usuarios) para no romper el
// acceso existente ni inventar una credencial nueva que nadie conoce.
let adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1`).get()?.id
if (!adminId) {
  const username = process.env.BASIC_AUTH_USER || 'admin'
  const password = process.env.BASIC_AUTH_PASS || crypto.randomBytes(9).toString('base64url')
  const info = db
    .prepare(`INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)`)
    .run(username, hashPassword(password))
  adminId = info.lastInsertRowid
}
db.prepare(`UPDATE clientes SET user_id = ? WHERE user_id IS NULL`).run(adminId)

// Contactos desde la landing pública (rediseño 2026-10): leads del form
// «Agendar consulta». Público (sin sesión) → se guarda solo lo enviado y la
// IP de origen (auditoría/abuso). Sin PII adicional. Longitud acotada:
// es un lead, no una carta.
db.exec(`
  CREATE TABLE IF NOT EXISTS contactos_web (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    creado_en TEXT NOT NULL DEFAULT (datetime('now')),
    nombre    TEXT NOT NULL,
    empresa   TEXT NOT NULL,
    contacto  TEXT NOT NULL,
    mensaje   TEXT NOT NULL,
    ip        TEXT,
    atendido  INTEGER NOT NULL DEFAULT 0
  )
`)

// Versionado del formato del caché RCV: cuando el shape de los documentos
// cacheados cambia (ej. se agregan columnas nuevas), hay que invalidar lo ya
// guardado o quedaría incompleto sin que nadie lo note — los períodos
// cerrados no vuelven a consultarse al SII salvo que el caché esté vacío.
db.exec(`CREATE TABLE IF NOT EXISTS meta (clave TEXT PRIMARY KEY, valor TEXT)`)
const RCV_CACHE_VERSION = '4' // v4: excluye identificadores/nacionalidad/indicadores mal clasificados como monto (validado con libro de ventas real)
const cacheVersion = db.prepare(`SELECT valor FROM meta WHERE clave = 'rcv_cache_version'`).get()?.valor
if (cacheVersion !== RCV_CACHE_VERSION) {
  db.exec(`DELETE FROM rcv_cache`)
  db.prepare(
    `INSERT INTO meta (clave, valor) VALUES ('rcv_cache_version', ?)
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`
  ).run(RCV_CACHE_VERSION)
}

// Tablas para persistencia de informes (historial, rehidratación sin re-consultar SII)
db.exec(`
  CREATE TABLE IF NOT EXISTS informes (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    cliente_id  INTEGER NOT NULL,
    cliente_nombre TEXT NOT NULL,
    cliente_rut TEXT NOT NULL,
    anio_inicio INTEGER NOT NULL,
    anio_fin    INTEGER NOT NULL,
    mes_inicio  INTEGER NOT NULL DEFAULT 1,
    mes_fin     INTEGER NOT NULL DEFAULT 12,
    modo        TEXT NOT NULL DEFAULT 'resumen',
    estado      TEXT NOT NULL DEFAULT 'procesando',
    consultas_estimadas INTEGER NOT NULL,
    total_meses INTEGER NOT NULL,
    resumen_json TEXT,       -- JSON con {ventas_neto, compras_neto, margen, pct_margen, debito_fiscal, credito_fiscal, iva_pagar}
    por_anio_json TEXT,      -- JSON array con totales por año
    observaciones_json TEXT, -- JSON array de strings
    error_msg   TEXT,
    creado_en   TEXT DEFAULT (datetime('now')),
    completado_en TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (cliente_id) REFERENCES clientes(id)
  );
  CREATE INDEX IF NOT EXISTS idx_informes_user ON informes(user_id);
  CREATE INDEX IF NOT EXISTS idx_informes_cliente ON informes(cliente_id);
  CREATE INDEX IF NOT EXISTS idx_informes_fecha ON informes(creado_en DESC);

  CREATE TABLE IF NOT EXISTS informe_meses (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      informe_id      TEXT NOT NULL,
      anio            INTEGER NOT NULL,
      mes             INTEGER NOT NULL,
      periodo         TEXT NOT NULL,
      mes_nombre      TEXT NOT NULL,
      ventas_neto     REAL DEFAULT 0,
      ventas_iva      REAL DEFAULT 0,
      compras_neto    REAL DEFAULT 0,
      compras_iva     REAL DEFAULT 0,
      margen          REAL DEFAULT 0,
      pct_margen      REAL DEFAULT 0,
      debito_fiscal   REAL DEFAULT 0,
      credito_fiscal  REAL DEFAULT 0,
      iva_pagar       REAL DEFAULT 0,
      estado          TEXT NOT NULL DEFAULT 'ok',
      error_msg       TEXT,
      detalle_ventas_json TEXT,  -- JSON con categorizarVentas
      detalle_compras_json TEXT, -- JSON con categorizarCompras
      docs_ventas     INTEGER DEFAULT 0,
      docs_compras    INTEGER DEFAULT 0,
      creado_en       TEXT DEFAULT (datetime('now')),
      actualizado_en  TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (informe_id) REFERENCES informes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_informe_meses_informe ON informe_meses(informe_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_informe_meses_periodo ON informe_meses(informe_id, periodo);

  CREATE TABLE IF NOT EXISTS informe_documentos (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    informe_id      TEXT NOT NULL,
    tipo            TEXT NOT NULL, -- 'ventas' | 'compras'
    periodo         TEXT NOT NULL,
    anio            INTEGER NOT NULL,
    mes             INTEGER NOT NULL,
    mes_nombre      TEXT NOT NULL,
    folio           TEXT,
    rut_doc         TEXT,
    razon_social    TEXT,
    monto_exento    REAL DEFAULT 0,
    monto_neto      REAL DEFAULT 0,
    monto_iva       REAL DEFAULT 0,
    monto_total     REAL DEFAULT 0,
    tipo_doc        INTEGER DEFAULT 0,
    fecha_docto     TEXT,
    fecha_reclamo   TEXT,
    estado_documento TEXT DEFAULT 'REGISTRO',
    montos_json     TEXT,        -- todos los montos extra del SII
    detalle_sii_json TEXT,       -- fila cruda completa
    FOREIGN KEY (informe_id) REFERENCES informes(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_informe_docs_informe ON informe_documentos(informe_id);
  CREATE INDEX IF NOT EXISTS idx_informe_docs_tipo_periodo ON informe_documentos(informe_id, tipo, periodo);

  CREATE TABLE IF NOT EXISTS informe_top_contrapartes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    informe_id      TEXT NOT NULL,
    tipo            TEXT NOT NULL, -- 'cliente' | 'proveedor'
    rut             TEXT NOT NULL,
    razon_social    TEXT,
    cantidad        INTEGER DEFAULT 0,
    neto            REAL DEFAULT 0,
    iva             REAL DEFAULT 0,
    total           REAL DEFAULT 0,
    FOREIGN KEY (informe_id) REFERENCES informes(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_informe_top_informe ON informe_top_contrapartes(informe_id);

  CREATE TABLE IF NOT EXISTS informe_reclamadas (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    informe_id      TEXT NOT NULL,
    mes_nombre      TEXT NOT NULL,
    anio            INTEGER NOT NULL,
    periodo         TEXT NOT NULL,
    folio           TEXT,
    razon_social    TEXT,
    rut_doc         TEXT,
    fecha_docto     TEXT,
    monto_neto      REAL DEFAULT 0,
    monto_iva       REAL DEFAULT 0,
    monto_total     REAL DEFAULT 0,
    fecha_reclamo   TEXT,
    FOREIGN KEY (informe_id) REFERENCES informes(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_informe_recl_informe ON informe_reclamadas(informe_id);
`)

// Migración: versiones anteriores tenían "rut TEXT NOT NULL UNIQUE" a nivel de
// columna, lo que impedía re-agregar un cliente con el mismo RUT después de
// eliminarlo (soft delete, activo=0). Se reemplaza por un índice único parcial
// que solo aplica a clientes activos.
const clientesSchema = db
  .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'clientes'`)
  .get()

if (clientesSchema && /rut\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(clientesSchema.sql)) {
  // PRAGMA foreign_keys no se puede cambiar dentro de una transacción, y
  // "procesos" tiene una FK hacia "clientes" — hay que desactivarla antes de
  // renombrar/recrear la tabla o SQLite rechaza el DROP con FOREIGN KEY constraint failed.
  db.pragma('foreign_keys = OFF')
  db.exec(`
    BEGIN TRANSACTION;
    ALTER TABLE clientes RENAME TO clientes_old_migracion;
    CREATE TABLE clientes (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      rut       TEXT NOT NULL,
      nombre    TEXT NOT NULL,
      clave_sii TEXT NOT NULL,
      tasa_ppm  REAL NOT NULL DEFAULT 0,
      telefono  TEXT NOT NULL,
      exento    INTEGER NOT NULL DEFAULT 0,
      activo    INTEGER NOT NULL DEFAULT 1,
      creado_en TEXT DEFAULT (datetime('now'))
    );
    INSERT INTO clientes SELECT * FROM clientes_old_migracion;
    DROP TABLE clientes_old_migracion;
    COMMIT;
  `)
  db.pragma('foreign_keys = ON')
  }

  // Migración: agregar cliente_nombre y cliente_rut a tabla informes (para listado sin JOIN)
  const informesSchema = db.prepare(`PRAGMA table_info(informes)`).all()
  const tieneClienteNombre = informesSchema.some(c => c.name === 'cliente_nombre')
  if (!tieneClienteNombre) {
    console.log('[MIGRACIÓN] Agregando cliente_nombre y cliente_rut a tabla informes...')
    db.exec(`
      ALTER TABLE informes ADD COLUMN cliente_nombre TEXT NOT NULL DEFAULT '';
      ALTER TABLE informes ADD COLUMN cliente_rut TEXT NOT NULL DEFAULT '';
    `)
  }

  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_rut_activo ON clientes(rut) WHERE activo = 1;`)

// Migración: BDs creadas por versiones anteriores del esquema no tienen las
// columnas de timestamp en informe_meses — guardarInformeEnBD las referencia en
// su INSERT y fallaba con "table informe_meses has no column named creado_en"
// DESPUÉS de descargar todo el rango al SII: el informe se marcaba error, no
// se persistía nada, y cada reintento repetía la descarga completa. Idempotente.
const informeMesesSchema = db.prepare(`PRAGMA table_info(informe_meses)`).all()
if (informeMesesSchema.length > 0) {
  const tiene = (n) => informeMesesSchema.some((c) => c.name === n)
  if (!tiene('creado_en')) db.exec(`ALTER TABLE informe_meses ADD COLUMN creado_en TEXT DEFAULT (datetime('now'))`)
  if (!tiene('actualizado_en')) db.exec(`ALTER TABLE informe_meses ADD COLUMN actualizado_en TEXT DEFAULT (datetime('now'))`)
}

// Migración: reparar la FK de "procesos". SQLite reescribe automáticamente las
// referencias FK de OTRAS tablas cuando se hace "ALTER TABLE ... RENAME TO"
// (desde SQLite 3.25+) — al renombrar clientes -> clientes_old_migracion en la
// migración de arriba, "procesos.cliente_id" quedó apuntando a
// "clientes_old_migracion", que se dropea después. Resultado: cualquier
// INSERT/UPDATE en "procesos" con foreign_keys=ON revienta con
// "no such table: main.clientes_old_migracion" (rompía por completo el flujo
// de "IVA por Cliente" / proceso masivo por período). Se repara recreando la
// tabla con la FK apuntando a la "clientes" real.
const procesosSchema = db
  .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'procesos'`)
  .get()

if (procesosSchema && /clientes_old_migracion/i.test(procesosSchema.sql)) {
  db.pragma('foreign_keys = OFF')
  db.exec(`
    BEGIN TRANSACTION;
    ALTER TABLE procesos RENAME TO procesos_old_migracion;
    CREATE TABLE procesos (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      periodo       TEXT NOT NULL,
      cliente_id    INTEGER NOT NULL,
      ventas_neto   REAL DEFAULT 0,
      ventas_iva    REAL DEFAULT 0,
      ventas_total  REAL DEFAULT 0,
      compras_neto  REAL DEFAULT 0,
      compras_iva   REAL DEFAULT 0,
      compras_total REAL DEFAULT 0,
      iva_determinado REAL DEFAULT 0,
      ppm_monto     REAL DEFAULT 0,
      total_pagar   REAL DEFAULT 0,
      estado        TEXT DEFAULT 'pendiente',
      error_msg     TEXT,
      creado_en     TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (cliente_id) REFERENCES clientes(id)
    );
    INSERT INTO procesos SELECT * FROM procesos_old_migracion;
    DROP TABLE procesos_old_migracion;
    COMMIT;
  `)
  db.pragma('foreign_keys = ON')
}

// ===== Software Contable — FASE 1 (fundación) =====
// Migraciones nuevas en módulos core (mismo patrón idempotente: se ejecutan
// en cada arranque; si ya aplicaron, no hacen nada). No tocan clientes,
// informes ni rcv_cache: la capa tributaria legada sigue funcionando igual.
require('./core/migraciones').migracionesFase1(db)
require('./core/migraciones').migracionesFase2(db)
require('./core/migraciones').migracionesFase3(db)
require('./core/migraciones').migracionesFase4(db)
require('./core/migraciones').migracionesFase5(db)
require('./core/migraciones').migracionesSaas1(db)
require('./core/migraciones').migracionesFase6(db)
require('./core/migraciones').migracionesMemoria(db)
require('./core/migraciones').migracionesFase7(db)
require('./core/migraciones').migracionesFase8(db)
require('./core/migraciones').migracionesFase9(db)
require('./core/migraciones').migracionesSaas3(db)
// BLOQUE 1 (seguridad): bóveda para clientes.clave_sii legacy (one-way, idempotente).
require('./core/migraciones').migracionesBovedaClientes(db)
// BLOQUE 2 (emisión de DTE para clientes): config del emisor, CAFs y DTEs emitidos.
require('./core/migraciones').migracionesDte(db)
// BLOQUE 3 (DTE → contabilidad): idempotencia de emisión en dte_emitidos.
require('./core/migraciones').migracionesDte2(db)
// ACCESO ADMIN: users.debe_cambiar_clave para el flujo admin→usuario temporal.
require('./core/migraciones').migracionesUsuarioTemporal(db)
require('./core/migraciones').migracionesPerfilYSalud(db)
require('./core/migraciones').migracionesDeclaracionesSii(db)
// Formulario Compacto del F29: casillas declaradas (la verdad del F29).
require('./core/migraciones').migracionesF29Formularios(db)
// Deuda fiscal TGR: certificados de deuda consultados (historial).
require('./core/migraciones').migracionesDeudaTgr(db)
// Agregados mensuales del RCV de ventas (boletas 39/41 y comprobantes 48):
// el SII no los entrega documento a documento, solo el total del mes.
require('./core/migraciones').migracionesRcvAgregados(db)
// CRM (Fase B): pipeline de clientes, recordatorios, campañas, engagement.
require('./core/migraciones').migracionesCrm(db)
// CRM comercial (rediseño 2026-10-15): fichas, contactos, prospectos,
// oportunidades con embudo configurable, actividades e informes.
require('./core/migraciones').migracionesCrmComercial(db)
// BLOQUE 2 (masterplan): persistencia de jobs largos en SQLite (recuperación
// tras restart). Al arrancar, libera locks vencidos y deja re-landizables los
// trabajos colgados.
require('./core/jobs-persistentes').migrar(db)
// BLOQUE 3 (masterplan): rate-limits en SQLite — sobreviven reinicios (un
// crash no resetea los contadores antifuerza-bruta) y preparan multiproceso.
require('./core/rate-limit-db').migrar(db)
// BLOQUE 4 (masterplan): aplicaciones de cobro/pago trazables 1↔n y n↔1.
require('./core/migraciones').migracionesTesoreriaAplicaciones(db)
// PLANIFICACIÓN TRIBUTARIA (T0-A): esquema de ficha tributaria. Idempotente,
// sin tablas nuevas dependencias previas y SIN poblar datos: las empresas
// existentes permanecen sin ficha hasta una incorporación explícita.
require('./core/migraciones').migracionesPlanificacion(db)
require('./core/jobs-persistentes').recuperarAlArranque(db)

module.exports = db
