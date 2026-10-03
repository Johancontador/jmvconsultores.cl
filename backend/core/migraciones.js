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
      INSERT INTO cuentas (empresa_id, codigo, nombre, clase, naturaleza, es_resumen, cierre, alias, rubro_niif)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const { id: empresaId } of sinPlan) {
      seedPlanCuentas(db, empresaId, insertar)
    }
  }
}

/** Inserta la plantilla PUC para una empresa (asume que no tiene cuentas aún). */
function seedPlanCuentas(db, empresaId, stmtInsertar = null) {
  const insertar = stmtInsertar || db.prepare(`
    INSERT INTO cuentas (empresa_id, codigo, nombre, clase, naturaleza, es_resumen, cierre, alias, rubro_niif)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const tx = db.transaction(() => {
    for (const item of PLANTILLA) {
      const { clase, naturaleza, cierre } = clasificar(item.codigo)
      insertar.run(
        empresaId, item.codigo, item.nombre, clase, naturaleza,
        item.esResumen ? 1 : 0, cierre, item.alias || null, item.rubro || null
      )
    }
  })
  tx()
  return PLANTILLA.length
}

/**
 * FASE 3 — Documentos (bandeja), reglas contables y contrapartes.
 *
 * - `documentos`: bandeja persistente por empresa, INDEPENDIENTE de informes
 *   (DATA_MODEL §B.3, deuda §8.8 de CURRENT_STATE). Montos INTEGER en pesos:
 *   la conversión REAL→INTEGER ocurre SOLO en la frontera de ingesta
 *   (documentos/ingesta, Math.round), nunca después.
 * - Dedupe idempotente: clave_dedupe = hash(rut empresa | flujo | tipo doc |
 *   folio | período ingesta) con UNIQUE — re-ingesta del mismo RCV no duplica.
 * - `reglas_contables`: tipo_flujo como condición (compra/venta/null=ambos):
 *   una regla de compras no debe calzar con ventas del mismo tipo_doc.
 * - `contrapartes`: entidades derivadas del RCV con clasificación recordada
 *   (proveedor/cliente/ambos) para prellenar clasificaciones.
 */
function migracionesFase3(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS documentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id),
      tipo_flujo TEXT NOT NULL,            -- compra | venta
      tipo_doc INTEGER NOT NULL,
      folio TEXT NOT NULL,
      rut_contraparte TEXT NOT NULL,
      razon_social TEXT,
      fecha_docto TEXT,
      fecha_reclamo TEXT,
      monto_exento INTEGER NOT NULL DEFAULT 0,
      monto_neto INTEGER NOT NULL DEFAULT 0,
      monto_iva INTEGER NOT NULL DEFAULT 0,
      monto_total INTEGER NOT NULL DEFAULT 0,
      montos_sii_json TEXT,
      detalle_sii_json TEXT,
      estado TEXT NOT NULL DEFAULT 'PENDIENTE',
      regla_id INTEGER REFERENCES reglas_contables(id),
      cuenta_id INTEGER REFERENCES cuentas(id),
      centro_costo_id INTEGER REFERENCES centros_costo(id),
      tratamiento_iva TEXT,
      asiento_id INTEGER REFERENCES asientos(id),
      informe_id TEXT,
      origen TEXT NOT NULL DEFAULT 'sii',
      periodo_ingesta TEXT NOT NULL,
      clave_dedupe TEXT NOT NULL,
      creado_en TEXT DEFAULT (datetime('now')),
      actualizado_en TEXT,
      UNIQUE(empresa_id, clave_dedupe)
    );
    CREATE INDEX IF NOT EXISTS idx_documentos_empresa_estado ON documentos(empresa_id, estado);
    CREATE INDEX IF NOT EXISTS idx_documentos_empresa_periodo ON documentos(empresa_id, periodo_ingesta);

    CREATE TABLE IF NOT EXISTS reglas_contables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id),
      nombre TEXT NOT NULL,
      prioridad INTEGER NOT NULL DEFAULT 100,   -- mayor prioridad evalúa primero
      activa INTEGER NOT NULL DEFAULT 1,
      tipo_flujo TEXT,                          -- compra | venta | NULL = ambos
      rut_contraparte TEXT,
      tipo_doc INTEGER,
      patron_razon_social TEXT,
      patron_glosa TEXT,
      monto_min INTEGER,
      monto_max INTEGER,
      cuenta_id INTEGER NOT NULL REFERENCES cuentas(id),
      centro_costo_id INTEGER REFERENCES centros_costo(id),
      tratamiento_iva TEXT NOT NULL DEFAULT 'credito',
      cuenta_contraparte_id INTEGER REFERENCES cuentas(id),
      crear_desde_clasificacion INTEGER NOT NULL DEFAULT 0,
      creado_por INTEGER REFERENCES users(id),
      creado_en TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_reglas_empresa_prioridad ON reglas_contables(empresa_id, prioridad DESC);

    CREATE TABLE IF NOT EXISTS contrapartes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id),
      rut TEXT NOT NULL,
      razon_social TEXT,
      clasificacion TEXT NOT NULL DEFAULT 'desconocida',  -- proveedor | cliente | ambos | desconocida
      cuenta_id INTEGER REFERENCES cuentas(id),
      centro_costo_id INTEGER REFERENCES centros_costo(id),
      tratamiento_iva TEXT,
      primera_vez_en TEXT DEFAULT (datetime('now')),
      ultima_vez_en TEXT,
      UNIQUE(empresa_id, rut)
    );
    CREATE INDEX IF NOT EXISTS idx_contrapartes_empresa ON contrapartes(empresa_id);
  `)
}

/**
 * FASE 4 — Automatización: propuestas de asiento desde documentos clasificados
 * y conciliación SII ↔ contable.
 *
 * - `propuestas`: snapshot CONGELADO de las líneas del asiento propuesto
 *   (ACCOUNTING_DOMAIN §6: la propuesta es un asiento pre-validado pendiente de
 *   confirmación humana). El documento solo avanza a PROPUESTO con una propuesta
 *   PENDIENTE viva (UNIQUE documento_id); confirmar aplicará exactamente estas
 *   líneas — nunca regenera con reglas que pudieron cambiar entre medio.
 * - `conciliaciones`: resultado persistido por empresa+periodo (DATA_MODEL §B.3,
 *   ACCOUNTING_DOMAIN §9); el histórico se conserva por ejecución en auditoría.
 * - `asientos.origen`: ya estaba en el diseño (DATA_MODEL §B.2) pero la tabla
 *   de FASE 2 no lo tenía: se agrega por PRAGMA (idempotente). `asientos.crear`
 *   ya lo recibía y lo dejaba en la auditoría; ahora también queda en la fila.
 */
function migracionesFase4(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS propuestas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id),
      documento_id INTEGER NOT NULL REFERENCES documentos(id),
      cuenta_id INTEGER NOT NULL REFERENCES cuentas(id),
      centro_costo_id INTEGER REFERENCES centros_costo(id),
      tratamiento_iva TEXT NOT NULL,
      cuenta_contraparte_id INTEGER REFERENCES cuentas(id),
      regla_id INTEGER REFERENCES reglas_contables(id),
      estado TEXT NOT NULL DEFAULT 'PENDIENTE',   -- PENDIENTE | APLICADA | DESCARTADA
      lineas_json TEXT NOT NULL,                  -- snapshot de las líneas propuestas
      propuesta_por INTEGER REFERENCES users(id),
      aplicada_asiento_id INTEGER REFERENCES asientos(id),
      aplicada_por INTEGER REFERENCES users(id),
      aplicada_en TEXT,
      descartada_en TEXT,
      motivo_descarte TEXT,
      creado_en TEXT DEFAULT (datetime('now'))
    );
    -- Una sola propuesta VIVA por documento (re-propuesta descarta la anterior;
    -- el histórico DESCARTADA/APLICADA se conserva). Índice parcial UNIQUE.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_propuestas_viva_documento
      ON propuestas(documento_id) WHERE estado = 'PENDIENTE';
    CREATE INDEX IF NOT EXISTS idx_propuestas_empresa_estado ON propuestas(empresa_id, estado);

    CREATE TABLE IF NOT EXISTS conciliaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id),
      periodo TEXT NOT NULL,
      fuente TEXT NOT NULL DEFAULT 'bandeja',     -- bandeja | sii_resumen
      resultado_json TEXT NOT NULL,               -- diferencias tipificadas + totales (§9)
      diferencias INTEGER NOT NULL DEFAULT 0,
      ejecutado_por INTEGER REFERENCES users(id),
      ejecutado_en TEXT DEFAULT (datetime('now')),
      UNIQUE(empresa_id, periodo)
    );
  `)

  const asientosCols = db.prepare(`PRAGMA table_info(asientos)`).all()
  if (asientosCols.length && !asientosCols.some((c) => c.name === 'origen')) {
    db.exec(`ALTER TABLE asientos ADD COLUMN origen TEXT`)
  }
}

/**
 * FASE 5 — Reportes y cierres: snapshot JSON del cierre de período (§7).
 * Los reportes (§8) se calculan en vivo sobre asiento_lineas; lo único que se
 * persiste es el snapshot del cierre ejecutado (asientos de cierre + checklist
 * + resultado del período) para consulta/auditoría posterior.
 */
function migracionesFase5(db) {
  const cols = db.prepare(`PRAGMA table_info(periodos_contables)`).all()
  if (cols.length && !cols.some((c) => c.name === 'cierre_json')) {
    db.exec(`ALTER TABLE periodos_contables ADD COLUMN cierre_json TEXT`)
  }
}

/**
 * SAAS-1 — Acomplamiento comercial (docs/SAAS-ACCESO.md): licencias por
 * empresa + ficha tributaria para el onboarding autónomo vía SII.
 *  - suscripciones: UNA activa por empresa (UNIQUE empresa_id). La licencia se
 *    ata al RUT de la empresa, no al usuario. Estados §5.2 del documento.
 *  - empresas: columnas de la ficha que el onboarding llena desde el SII
 *    (o de formularios si el SII no la entrega — jamás scraping).
 */
function migracionesSaas1(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS suscripciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id),
      plan TEXT NOT NULL,                  -- PRUEBA | PYME | PRO | DESPACHO
      estado TEXT NOT NULL DEFAULT 'PRUEBA',   -- PRUEBA|ACTIVA|VENCIDA|SUSPENDIDA|CANCELADA
      inicio TEXT NOT NULL,                -- 'YYYY-MM-DD' (fecha de creación)
      fin TEXT NOT NULL,                   -- fin de vigencia (PRUEBA: inicio+90d)
      gracia_hasta TEXT,                   -- fin del período de gracia (7 días)
      monto_clp INTEGER,                   -- 0 en PRUEBA; precio del plan en los demás
      activada_por INTEGER REFERENCES users(id),   -- super_admin (o pago futuro)
      activada_en TEXT,
      cancelada_en TEXT,
      notas TEXT,
      creado_en TEXT DEFAULT (datetime('now')),
      UNIQUE(empresa_id)
    );
    CREATE INDEX IF NOT EXISTS idx_suscripciones_estado ON suscripciones(estado, fin);
  `)

  const cols = db.prepare(`PRAGMA table_info(empresas)`).all()
  if (cols.length) {
    const tiene = (n) => cols.some((c) => c.name === n)
    const agregar = (col) => { if (!tiene(col.nombre)) db.exec(`ALTER TABLE empresas ADD COLUMN ${col.def}`) }
    // Ficha tributaria (onboarding autónomo, SAAS-2 la llena desde el SII)
    agregar({ nombre: 'razon_social_sii', def: `razon_social_sii TEXT` })
    agregar({ nombre: 'inicio_actividades', def: `inicio_actividades TEXT` })
    agregar({ nombre: 'actividades_json', def: `actividades_json TEXT` })
    agregar({ nombre: 'regimen_tributario', def: `regimen_tributario TEXT` })
    agregar({ nombre: 'socios_json', def: `socios_json TEXT` })
    agregar({ nombre: 'onboarding_json', def: `onboarding_json TEXT` })
  }

  // Empresas preexistentes (migradas de clientes / creadas por JMV antes del
  // SaaS): reciben una licencia heredada sin límite práctico para que el gate
  // nunca las bloquee. Las registradas self-service YA tienen su fila (PRUEBA
  // o plan pagado) y este backfill las respeta (NOT IN).
  db.exec(`
    INSERT INTO suscripciones (empresa_id, plan, estado, inicio, fin, monto_clp, notas)
    SELECT id, 'DESPACHO', 'ACTIVA', date('now'), date('now', '+3650 days'), 0,
           'Heredada: empresa preexistente al SaaS (SAAS-1)'
    FROM empresas
    WHERE activo = 1 AND id NOT IN (SELECT empresa_id FROM suscripciones)
  `)
}

// ============================================================
// FASE 6 — TESORERÍA (§22): dominio de bancos SIN integraciones bancarias
// todavía. El libro banco vive en teso_movimientos respaldado SIEMPRE por un
// asiento del núcleo (partida doble, mismo asiento para las dos patas de una
// transferencia). La cartola se importa y la conciliación REPORTA — jamás
// corrige (ajustes por asiento manual, mismo principio que la conciliación SII).
// ============================================================
function migracionesFase6(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bancos_cuentas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id),
      banco TEXT NOT NULL,
      numero TEXT NOT NULL DEFAULT '',
      moneda TEXT NOT NULL DEFAULT 'CLP',
      cuenta_contable_id INTEGER NOT NULL REFERENCES cuentas(id),
      saldo_inicial INTEGER NOT NULL DEFAULT 0,
      activa INTEGER NOT NULL DEFAULT 1,
      creado_en TEXT DEFAULT (datetime('now')),
      UNIQUE(empresa_id, cuenta_contable_id)
    );
    CREATE INDEX IF NOT EXISTS idx_bancos_empresa ON bancos_cuentas(empresa_id);

    CREATE TABLE IF NOT EXISTS teso_movimientos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id),
      banco_cuenta_id INTEGER NOT NULL REFERENCES bancos_cuentas(id),
      tipo TEXT NOT NULL,                 -- PAGO | COBRO | TRANSFERENCIA
      fecha TEXT NOT NULL,
      monto INTEGER NOT NULL,             -- FIRMADO: egreso negativo, ingreso positivo
      glosa TEXT NOT NULL,
      documento_id INTEGER REFERENCES documentos(id),          -- factura aplicada (opcional)
      banco_destino_id INTEGER REFERENCES bancos_cuentas(id),  -- solo TRANSFERENCIA (fila origen)
      asiento_id INTEGER NOT NULL REFERENCES asientos(id),
      creado_en TEXT DEFAULT (datetime('now')),
      UNIQUE(banco_cuenta_id, asiento_id)
    );
    CREATE INDEX IF NOT EXISTS idx_teso_mov_banco ON teso_movimientos(empresa_id, banco_cuenta_id, fecha);

    CREATE TABLE IF NOT EXISTS teso_cartola (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id),
      banco_cuenta_id INTEGER NOT NULL REFERENCES bancos_cuentas(id),
      fecha TEXT NOT NULL,
      monto INTEGER NOT NULL,             -- FIRMADO según cartola del banco
      glosa TEXT NOT NULL DEFAULT '',
      movimiento_id INTEGER REFERENCES teso_movimientos(id),   -- match de conciliación
      importado_en TEXT DEFAULT (datetime('now')),
      UNIQUE(banco_cuenta_id, fecha, monto, glosa)
    );
    CREATE INDEX IF NOT EXISTS idx_teso_cartola_banco ON teso_cartola(empresa_id, banco_cuenta_id);
  `)
}

/**
 * MEMORIA DE CONTABILIZACIÓN + MODO SIMPLE — configuración por empresa.
 *  - `config_json` en empresas: modo_conciliacion ('simple' | 'completa'),
 *    cuenta_regular_gastos_id / cuenta_regular_ingresos_id (la "cuenta regular"
 *    donde las compras y ventas se netean — típica cuenta del banco en empresas
 *    pequeñas que no concilian). La memoria POR CONTRAPARTE ya vive en la tabla
 *    `contrapartes` (FASE 3): aquí solo se agrega el ajuste fino de la empresa.
 */
function migracionesMemoria(db) {
  const cols = db.prepare(`PRAGMA table_info(empresas)`).all()
  if (cols.length && !cols.some((c) => c.name === 'config_json')) {
    db.exec(`ALTER TABLE empresas ADD COLUMN config_json TEXT`)
  }
}

// ============================================================
// FASE 7 — ACTIVOS FIJOS: registro con cuenta contable del plan,
// depreciación mensual por línea recta respaldada SIEMPRE por un asiento
// del núcleo (UNIQUE activo+período: jamás se deprecia dos veces el mismo
// mes) y venta/baja con su asiento (baja del costo + depreciación acumulada
// + utilidad/pérdida). La venta/baja detiene la depreciación (estado).
// ============================================================
function migracionesFase7(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS activos_fijos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id),
      codigo TEXT NOT NULL,
      descripcion TEXT NOT NULL,
      cuenta_activo_id INTEGER NOT NULL REFERENCES cuentas(id),
      fecha_adquisicion TEXT NOT NULL,
      valor_adquisicion INTEGER NOT NULL,
      vida_util_meses INTEGER NOT NULL,
      valor_residual INTEGER NOT NULL DEFAULT 0,
      cuenta_dep_id INTEGER REFERENCES cuentas(id),
      cuenta_gasto_id INTEGER REFERENCES cuentas(id),
      estado TEXT NOT NULL DEFAULT 'ACTIVO',   -- ACTIVO | VENDIDO | BAJA
      fecha_baja TEXT,
      precio_venta INTEGER,
      cuenta_destino_id INTEGER REFERENCES cuentas(id),
      asiento_alta_id INTEGER REFERENCES asientos(id),
      asiento_baja_id INTEGER REFERENCES asientos(id),
      creado_en TEXT DEFAULT (datetime('now')),
      UNIQUE(empresa_id, codigo)
    );
    CREATE INDEX IF NOT EXISTS idx_activos_empresa ON activos_fijos(empresa_id, estado);

    CREATE TABLE IF NOT EXISTS activos_depreciaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id),
      activo_id INTEGER NOT NULL REFERENCES activos_fijos(id),
      periodo TEXT NOT NULL,
      monto INTEGER NOT NULL,
      asiento_id INTEGER NOT NULL REFERENCES asientos(id),
      creado_en TEXT DEFAULT (datetime('now')),
      UNIQUE(activo_id, periodo)
    );
    CREATE INDEX IF NOT EXISTS idx_activos_dep_empresa ON activos_depreciaciones(empresa_id, periodo);
  `)

  // Backfill idempotente del plan para empresas preexistentes: alias de la
  // depreciación acumulada + las cuentas de utilidad/pérdida en venta o baja
  // (las empresas nuevas ya nacen con ellas vía seedPlanCuentas).
  const empresas = db.prepare(`SELECT id FROM empresas WHERE activo = 1`).all()
  const backfillAlias = db.prepare(`
    UPDATE cuentas SET alias = 'DEPRECIACION_ACUMULADA'
    WHERE empresa_id = ? AND codigo = '1.2.2.01' AND alias IS NULL
      AND NOT EXISTS (SELECT 1 FROM cuentas x WHERE x.empresa_id = cuentas.empresa_id AND x.alias = 'DEPRECIACION_ACUMULADA')
  `)
  const insertarCuenta = db.prepare(`
    INSERT INTO cuentas (empresa_id, codigo, nombre, clase, naturaleza, es_resumen, cierre, alias)
    SELECT ?, ?, ?, ?, ?, 0, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM cuentas WHERE empresa_id = ? AND codigo = ?)
  `)
  for (const { id: empresaId } of empresas) {
    backfillAlias.run(empresaId)
    insertarCuenta.run(empresaId, '4.2.1.03', 'Utilidad en venta de activos fijos', 4, 'acreedora', 'resultado', 'UTILIDAD_VENTA_ACTIVO', empresaId, '4.2.1.03')
    insertarCuenta.run(empresaId, '6.1.5.03', 'Pérdida en venta o baja de activos fijos', 6, 'deudora', 'resultado', 'PERDIDA_BAJA_ACTIVO', empresaId, '6.1.5.03')
  }
}

// ============================================================
// FASE 8 — NIIF: mapeo cuentas → rubros de presentación. La columna
// `rubro_niif` vive en la propia cuenta (una cuenta pertenece a UN rubro) y
// el backfill siembra defaults por código del plan: la presentación NUNCA
// adivina — una cuenta sin rubro se reporta en SIN_CLASIFICAR (report-only).
// ============================================================
function migracionesFase8(db) {
  const cols = db.prepare(`PRAGMA table_info(cuentas)`).all()
  if (cols.length && !cols.some((c) => c.name === 'rubro_niif')) {
    db.exec(`ALTER TABLE cuentas ADD COLUMN rubro_niif TEXT`)
  }

  // Backfill para empresas PREEXISTENTES: el default de cada cuenta viene de
  // la MISMA plantilla (única fuente de verdad). Las empresas nuevas ya nacen
  // con el rubro vía seedPlanCuentas; las creadas a mano quedan sin rubro
  // (SIN_CLASIFICAR) hasta que el contador las mapee.
  const empresas = db.prepare(`SELECT id FROM empresas WHERE activo = 1`).all()
  const update = db.prepare(`
    UPDATE cuentas SET rubro_niif = ?
    WHERE empresa_id = ? AND rubro_niif IS NULL AND es_resumen = 0 AND codigo = ?
  `)
  for (const { id: empresaId } of empresas) {
    for (const item of PLANTILLA) {
      if (item.rubro) update.run(item.rubro, empresaId, item.codigo)
    }
  }
}

// ============================================================
// FASE 9 — INTEGRACIONES (9.1 receptor de asientos externos, Geo Daniela):
//  - `asientos.idempotencia` con UNIQUE parcial (empresa+clave): re-envío de
//    una centralización no duplica — la clave la provee el remitente o es el
//    SHA-256 del payload canónico (core/asientos-externos.js).
//  - `asientos_externos`: registro de centralizaciones recibidas para consulta
//    del contador (remitente, período, líneas, asiento generado).
// ============================================================
function migracionesFase9(db) {
  const cols = db.prepare(`PRAGMA table_info(asientos)`).all()
  if (cols.length && !cols.some((c) => c.name === 'idempotencia')) {
    db.exec(`ALTER TABLE asientos ADD COLUMN idempotencia TEXT`)
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_asientos_idempotencia
      ON asientos(empresa_id, idempotencia) WHERE idempotencia IS NOT NULL;

    CREATE TABLE IF NOT EXISTS asientos_externos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id),
      remitente TEXT NOT NULL DEFAULT 'geodaniela',
      idempotencia TEXT NOT NULL,
      periodo TEXT NOT NULL,
      glosa TEXT NOT NULL,
      lineas_json TEXT NOT NULL,
      asiento_id INTEGER NOT NULL REFERENCES asientos(id),
      creado_en TEXT DEFAULT (datetime('now')),
      UNIQUE(empresa_id, idempotencia)
    );
    CREATE INDEX IF NOT EXISTS idx_asientos_ext_empresa ON asientos_externos(empresa_id, periodo);

    -- 9.2: formatos de cartola guardados (mapeo manual de columnas por banco)
    CREATE TABLE IF NOT EXISTS teso_cartola_formatos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id),
      nombre TEXT NOT NULL,
      mapeo_json TEXT NOT NULL,
      creado_en TEXT DEFAULT (datetime('now')),
      UNIQUE(empresa_id, nombre)
    );
  `)
}

// ============================================================
// SAAS-3 — PAGOS Y FACTURACIÓN DE LA SUSCRIPCIÓN (SAAS-ACCESO §5.3):
//  - `pagos_suscripcion`: un intento de pago por checkout (adaptador de
//    pasarela — MercadoPago primero). external_reference = 'pago_suscripcion:<id>'
//    es el vínculo con la pasarela; UNIQUE(gateway, gateway_pago_id) hace que
//    el MISMO pago de la pasarela active la licencia UNA sola vez.
//  - `webhook_eventos`: registro de notificaciones entrantes (UNIQUE
//    gateway+evento_id) — re-entrega del webhook no re-procesa nada.
//  - `facturas_suscripcion`: el DTE (factura 33) de cada pago aprobado —
//    montos con IVA calculado de la tasa configurada; el XML/track-id queda
//    en la fila una vez emitida (emitir es idempotente por UNIQUE(pago_id)).
// El gate de licencia NO aplica a este módulo: pagar debe ser posible incluso
// con la licencia SUSPENDIDA (si no, la empresa no puede reactivarse sola).
// ============================================================
function migracionesSaas3(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pagos_suscripcion (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id),
      plan TEXT NOT NULL,
      monto_clp INTEGER NOT NULL,
      meses INTEGER NOT NULL DEFAULT 1,
      gateway TEXT NOT NULL,
      gateway_pref_id TEXT,
      gateway_pago_id TEXT,
      external_reference TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'PENDIENTE',   -- PENDIENTE | APROBADO | RECHAZADO
      respuesta_json TEXT,
      creado_en TEXT DEFAULT (datetime('now')),
      resuelto_en TEXT,
      UNIQUE(gateway, gateway_pago_id)
    );
    CREATE INDEX IF NOT EXISTS idx_pagos_empresa ON pagos_suscripcion(empresa_id, creado_en);

    CREATE TABLE IF NOT EXISTS webhook_eventos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gateway TEXT NOT NULL,
      evento_id TEXT NOT NULL,
      payload TEXT,
      procesado INTEGER NOT NULL DEFAULT 0,
      resultado TEXT,
      recibido_en TEXT DEFAULT (datetime('now')),
      UNIQUE(gateway, evento_id)
    );

    CREATE TABLE IF NOT EXISTS facturas_suscripcion (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id),
      pago_id INTEGER NOT NULL REFERENCES pagos_suscripcion(id),
      tipo_dte INTEGER NOT NULL DEFAULT 33,
      folio INTEGER,
      estado TEXT NOT NULL DEFAULT 'PENDIENTE',   -- PENDIENTE | EMITIDA | RECHAZADA
      monto_neto INTEGER NOT NULL,
      monto_iva INTEGER NOT NULL,
      monto_total INTEGER NOT NULL,
      receptor_json TEXT,
      xml TEXT,
      track_id TEXT,
      motivo_rechazo TEXT,
      emitido_en TEXT,
      creado_en TEXT DEFAULT (datetime('now')),
      UNIQUE(pago_id)
    );
  `)
}

module.exports = { migracionesFase1, migracionesFase2, migracionesFase3, migracionesFase4, migracionesFase5, migracionesSaas1, migracionesFase6, migracionesMemoria, migracionesFase7, migracionesFase8, migracionesFase9, migracionesSaas3, seedPlanCuentas }
