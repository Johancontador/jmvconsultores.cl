/**
 * PLANIFICACIÓN TRIBUTARIA — T0-A: tablas de ficha tributaria (2026-10-25).
 *
 * Módulo aislado e idempotente (mismo patrón que el resto de migraciones:
 * CREATE TABLE IF NOT EXISTS + índices; correrlo de nuevo no duplica ni
 * altera nada). NO toca tablas existentes: toda la nueva información vive
 * aquí, y las empresas existentes NO migran dato alguno.
 *
 * Principios de diseño (Fase T0/T1 aprobada):
 *  - SIN valores fiscales por defecto: los campos tributarios nacen en el
 *    estado centinela 'PENDIENTE' / 'SIN_CONFIGURAR'. Ninguna empresa actual
 *    recibe ficha ni régimen inferido automáticamente.
 *  - Una fila VIGENTE por empresa (UNIQUE(empresa_id)): la historia de los
 *    cambios vive en plan_ficha_historial (append-only por TRIGGER de BD:
 *    UPDATE y DELETE directos abortan con RAISE; ni el core ni la API tienen
 *    camino de reescritura). Ver "Restauración de backups" al final.
 *  - La escritura comercial (API/UI/motor de cálculo) llega en entregas
 *    posteriores (T0-B, T1): esta entrega solo inicializa el esquema.
 */

// Estados centinela: NO son valores fiscales, son la ausencia de decisión.
const CAMPOS_TRIBUTARIOS = {
  TIPO_CONTRIBUTUYENTE: ['PENDIENTE', 'PERSONA_NATURAL', 'PERSONA_JURIDICA'],
  REGIMEN: ['PENDIENTE', 'PRO_PMYE_GENERAL', 'PRO_PMYE_TRANSPARENTE', 'GENERAL_14A', 'PRESUNTO', 'NO_SUJETO_14'],
  ESTADO_FICHA: ['SIN_CONFIGURAR', 'CONFIGURADA'],
}

function planificacionTablas(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plan_ficha_tributaria (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id),
      rut TEXT NOT NULL,
      tipo_contribuyente TEXT NOT NULL DEFAULT 'PENDIENTE'
        CHECK (tipo_contribuyente IN ('PENDIENTE', 'PERSONA_NATURAL', 'PERSONA_JURIDICA')),
      regimen TEXT NOT NULL DEFAULT 'PENDIENTE'
        CHECK (regimen IN ('PENDIENTE', 'PRO_PMYE_GENERAL', 'PRO_PMYE_TRANSPARENTE', 'GENERAL_14A', 'PRESUNTO', 'NO_SUJETO_14')),
      estado_ficha TEXT NOT NULL DEFAULT 'SIN_CONFIGURAR'
        CHECK (estado_ficha IN ('SIN_CONFIGURAR', 'CONFIGURADA')),
      -- JSON array de rubros/actividades económicas del SII; vacío = pendiente.
      actividades_economicas TEXT NOT NULL DEFAULT '[]',
      -- YYYY-MM-DD u NULL: solo es obligatoria cuando incide (p.ej. tasa PPM
      -- del año de inicio). La exigencia la valida la capa de aplicación.
      fecha_inicio_actividades TEXT,
      -- Ejercicio comercial (AAAA) desde el que rige el régimen declarado.
      -- Libre de conflicto: si la ficha aún está PENDIENTE, no puede arrastrar
      -- una vigencia sin régimen de verdad (CHECK de consistencia de fila).
      regimen_desde_ac TEXT,
      -- JSON array de { rut, participacion, gravado_finales }: obligatorio para
      -- Transparente; la validación de composición es de la capa de aplicación.
      propietarios_json TEXT NOT NULL DEFAULT '[]',
      -- Opt-in explícito (0/1): activa la regla de retención BHE con calendario
      -- vigente. Es un dato declarado, no un valor fiscal asignado por omisión.
      sujeto_boletas_honorarios INTEGER NOT NULL DEFAULT 0 CHECK (sujeto_boletas_honorarios IN (0, 1)),
      vigente_desde TEXT NOT NULL DEFAULT (date('now')),
      vigente_hasta TEXT,
      creado_en TEXT DEFAULT (datetime('now')),
      actualizado_en TEXT DEFAULT (datetime('now')),
      CHECK ((regimen = 'PENDIENTE' AND regimen_desde_ac IS NULL) OR (regimen <> 'PENDIENTE')),
      UNIQUE(empresa_id)
    );
    CREATE INDEX IF NOT EXISTS idx_plan_ficha_tributaria_rut
      ON plan_ficha_tributaria(rut);

    CREATE TABLE IF NOT EXISTS plan_ficha_historial (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id),
      usuario_id INTEGER NOT NULL REFERENCES users(id),
      -- 'ficha.crear' | 'ficha.actualizar' (nomenclatura igual que auditoria.js)
      accion TEXT NOT NULL,
      -- Snapshot antes/despues del cambio, igual que la bitácora central.
      antes_json TEXT NOT NULL DEFAULT '{}',
      despues_json TEXT NOT NULL DEFAULT '{}',
      ip TEXT,
      creado_en TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_plan_ficha_historial_empresa
      ON plan_ficha_historial(empresa_id, creado_en DESC);

    -- APPEND-ONLY FUERTE: UPDATE y DELETE directos sobre el historial abortan.
    -- CREATE TRIGGER IF NOT EXISTS hace la protección idempotente igual que
    -- las tablas de arriba.
    CREATE TRIGGER IF NOT EXISTS trg_plan_ficha_historial_no_update
      BEFORE UPDATE ON plan_ficha_historial
    BEGIN
      SELECT RAISE(ABORT, 'plan_ficha_historial es append-only: escritura prohibida (UPDATE)');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_plan_ficha_historial_no_delete
      BEFORE DELETE ON plan_ficha_historial
    BEGIN
      SELECT RAISE(ABORT, 'plan_ficha_historial es append-only: borrado prohibido (DELETE)');
    END;

  `)
}

/**
 * Restauración de backups legítimos SIN debilitar la protección:
 *  - Restore COMPLETO (patrón scripts/restore-db.js / backup-restaurar.js): se
 *    reemplaza el ARCHIVO .db entero (con -wal/-shm); los triggers viajan
 *    dentro del esquema del archivo restaurado y la protección queda intacta
 *    sin pasos extra.
 *  - Restore a fila (poco probable): no hay bypass automático. La única vía es
 *    MANUAL y acotada, dentro de una conexión dedicada y transacción única:
 *    `DROP TRIGGER trg_plan_ficha_historial_no_update/no_delete;` → reinsertar
 *    → `CREATE TRIGGER IF NOT EXISTS ...` idéntico al de este módulo antes
 *    del COMMIT. Se registra la intervención en auditoría (quién, cuándo,
 *    qué filas) y JAMÁS se desactivan triggers globalmente (ni
 *    `PRAGMA recursive_triggers` ni `disable_triggers` improvisados):
 *    la protección nueva debe quedar creada antes de salir de la conexión.
 */

module.exports = { planificacionTablas, CAMPOS_TRIBUTARIOS }
