# DATA_MODEL — Modelo de datos (actual → objetivo)

> Fecha: 2026-10-01 · SQLite (better-sqlite3), WAL. Convenciones: snake_case, `creado_en/actualizado_en` TEXT ISO con default `datetime('now')`, montos contables **INTEGER en pesos** (nunca REAL), toda tabla de negocio con `empresa_id NOT NULL`.
> Las migraciones siguen el patrón existente de `backend/db.js`: idempotentes, chequeo `PRAGMA table_info` / `sqlite_master`, sin framework.

---

## PARTE A — Esquema actual (resumen factual; detalle íntegro en `backend/db.js`)

```text
clientes(id, rut, nombre, clave_sii PLAIN, tasa_ppm REAL, telefono, exento, activo, creado_en, user_id→users)
users(id, username UNIQUE, password_hash scrypt, is_admin, activo, creado_en)
sessions(id TEXT PK, user_id→users, expires_at, creado_en)
procesos(id, periodo, cliente_id→clientes, ventas/compras neto/iva/total, iva_determinado, ppm_monto,
         total_pagar, estado, error_msg, creado_en)
rcv_cache(id, rut, periodo, tipo, datos JSON, consultado_en, UNIQUE(rut,periodo,tipo))  [solo períodos cerrados]
meta(clave PK, valor)                              [rcv_cache_version = v4]
informes(id TEXT PK, user_id, cliente_id, cliente_nombre, cliente_rut, anio/mes inicio/fin, modo,
         estado, total_meses, consultas_estimadas, resumen_json, por_anio_json, observaciones_json,
         error_msg, creado_en, completado_en)
informe_meses(id, informe_id→informes CASCADE, anio, mes, periodo, mes_nombre, ventas/compras neto/iva,
         margen, pct_margen, debito/credito fiscal, iva_pagar, estado, error_msg, detalle_*_json,
         docs_ventas, docs_compras, creado_en, actualizado_en, UNIQUE(informe_id,periodo))
informe_documentos(id, informe_id→informes CASCADE, tipo ventas|compras, periodo, anio, mes, mes_nombre,
         folio, rut_doc, razon_social, montos (exento/neto/iva/total REAL), tipo_doc, fecha_docto,
         fecha_reclamo, estado_documento, montos_json, detalle_sii_json)   [fuente de verdad de documentos]
informe_top_contrapartes(id, informe_id, tipo cliente|proveedor, rut, razon_social, cantidad, neto, iva, total)
informe_reclamadas(id, informe_id, mes_nombre, anio, periodo, folio, razon_social, rut_doc, fecha_docto,
         montos, fecha_reclamo)
```

Notas de estado: montos en REAL (solo tributario-informativo), sin entidades empresa/rol/cuenta/asiento, aislamiento por `user_id`.

## PARTE B — Esquema objetivo del software contable

### B.1 Fundación (FASE 1)

```sql
-- Empresas: los clientes actuales migran 1:1 (rut, nombre, tasa_ppm, clave_sii, user_id→admin empresa)
CREATE TABLE empresas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rut TEXT NOT NULL,
  nombre TEXT NOT NULL,
  clave_sii TEXT NOT NULL,            -- cifrada en reposo (ver §B.7)
  tasa_ppm REAL NOT NULL DEFAULT 0,
  telefono TEXT, exento INTEGER NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_empresas_rut ON empresas(rut) WHERE activo=1;

CREATE TABLE roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,        -- super_admin | contador | admin_empresa | auditor | tesoreria
  nombre TEXT NOT NULL
);

CREATE TABLE usuario_empresa (       -- asignación persona↔empresa con rol (multiempresa estricta)
  usuario_id INTEGER NOT NULL REFERENCES users(id),
  empresa_id INTEGER NOT NULL REFERENCES empresas(id),
  rol_id INTEGER NOT NULL REFERENCES roles(id),
  activo INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (usuario_id, empresa_id)
);

CREATE TABLE periodos_contables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id),
  periodo TEXT NOT NULL,              -- 'AAAAMM'
  estado TEXT NOT NULL DEFAULT 'ABIERTO',   -- ABIERTO | CERRADO
  cerrado_por INTEGER REFERENCES users(id), cerrado_en TEXT, reapertura_motivo TEXT,
  UNIQUE(empresa_id, periodo)
);

CREATE TABLE auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER,                 -- nullable: acciones globales
  usuario_id INTEGER NOT NULL REFERENCES users(id),
  accion TEXT NOT NULL,               -- 'asiento.crear', 'periodo.cerrar', 'regla.editar'...
  entidad TEXT NOT NULL, entidad_id TEXT,   -- tabla/registro afectado
  antes_json TEXT, despues_json TEXT, -- diff completo (asientos: referencia, no copia)
  ip TEXT, creado_en TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_auditoria_empresa_fecha ON auditoria(empresa_id, creado_en DESC);
```

### B.2 Núcleo contable (FASE 2)

```sql
CREATE TABLE cuentas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id),
  codigo TEXT NOT NULL,               -- '1.1.2.01' (únicos por empresa)
  nombre TEXT NOT NULL,
  clase INTEGER NOT NULL,             -- 1..6 (ACCOUNTING_DOMAIN §3)
  naturaleza TEXT NOT NULL,           -- deudora | acreedora
  es_resumen INTEGER NOT NULL DEFAULT 0,   -- resumen no recibe movimientos
  imputable INTEGER NOT NULL DEFAULT 1,
  cierre TEXT NOT NULL DEFAULT 'balance',  -- balance | resultado
  alias TEXT,                         -- IVA_CREDITO, PROVEEDORES, BANCOS... (control interno)
  activa INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT DEFAULT (datetime('now')),
  UNIQUE(empresa_id, codigo)
);
CREATE INDEX idx_cuentas_empresa ON cuentas(empresa_id);

CREATE TABLE centros_costo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id),
  codigo TEXT NOT NULL, nombre TEXT NOT NULL, activo INTEGER NOT NULL DEFAULT 1,
  UNIQUE(empresa_id, codigo)
);

CREATE TABLE asientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id),
  folio INTEGER NOT NULL,             -- correlativo por empresa+anio
  anio INTEGER NOT NULL,
  fecha TEXT NOT NULL,                -- 'YYYY-MM-DD', debe caer en período abierto
  periodo TEXT NOT NULL,              -- 'AAAAMM' derivado
  tipo TEXT NOT NULL,                 -- manual | automatico | ajuste | reversion | cierre | apertura | externo
  origen TEXT,                        -- 'geodaniela' | 'regla:<id>' | NULL
  glosa TEXT NOT NULL,
  usuario_id INTEGER NOT NULL REFERENCES users(id),
  asiento_revertido_id INTEGER REFERENCES asientos(id),  -- si es reversión de X
  creado_en TEXT DEFAULT (datetime('now')),
  UNIQUE(empresa_id, anio, folio)
);
CREATE INDEX idx_asientos_empresa_periodo ON asientos(empresa_id, periodo);

CREATE TABLE asiento_lineas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id),   -- redundancia deliberada para aislamiento por fila
  asiento_id INTEGER NOT NULL REFERENCES asientos(id),
  cuenta_id INTEGER NOT NULL REFERENCES cuentas(id),
  debe INTEGER NOT NULL DEFAULT 0,    -- INTEGER pesos; una de las dos es 0
  haber INTEGER NOT NULL DEFAULT 0,
  centro_costo_id INTEGER REFERENCES centros_costo(id),
  glosa TEXT,
  FOREIGN KEY (empresa_id, asiento_id) ...   -- ver nota de integridad §B.8
);
CREATE INDEX idx_lineas_empresa_cuenta ON asiento_lineas(empresa_id, cuenta_id);
CREATE INDEX idx_lineas_asiento ON asiento_lineas(asiento_id);
```

**Invariante de partida doble**: `SUM(debe) = SUM(haber)` por asiento — validado en `core/asientos.js` dentro de la transacción de inserción (no hay TRIGGER en MVP; el núcleo es la única puerta de escritura, y los routers nunca escriben directo).

### B.3 Documentos y automatización (FASE 3–4)

```sql
CREATE TABLE documentos (            -- bandeja persistente, independiente de informes
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id),
  tipo_flujo TEXT NOT NULL,           -- compra | venta
  tipo_doc INTEGER NOT NULL,          -- 33, 34, 39, 41, 56, 61...
  folio TEXT NOT NULL,
  rut_contraparte TEXT NOT NULL,
  razon_social TEXT,
  fecha_docto TEXT, fecha_recepcion TEXT, fecha_reclamo TEXT,
  monto_exento INTEGER DEFAULT 0, monto_neto INTEGER DEFAULT 0,
  monto_iva INTEGER DEFAULT 0, monto_total INTEGER DEFAULT 0,
  -- tributario: montos extras SII en JSON (iva uso común, no recuperable...)
  montos_sii_json TEXT,
  estado TEXT NOT NULL DEFAULT 'RECIBIDO',
  -- RECIBIDO|PENDIENTE|CLASIFICADO|PROPUESTO|CONTABILIZADO|REVISION|ERROR|ANULADO
  regla_id INTEGER REFERENCES reglas_contables(id),
  cuenta_id INTEGER REFERENCES cuentas(id),        -- clasificación imputable
  centro_costo_id INTEGER REFERENCES centros_costo(id),
  tratamiento_iva TEXT,               -- credito | sin_credito | uso_comun | no_recuperable
  asiento_id INTEGER REFERENCES asientos(id),      -- al contabilizar
  informe_id TEXT,                    -- origen tributario (trazabilidad con sistema actual)
  origen TEXT NOT NULL DEFAULT 'sii', -- sii | manual
  clave_dedupe TEXT,                  -- ver §B.8
  creado_en TEXT DEFAULT (datetime('now')), actualizado_en TEXT,
  UNIQUE(empresa_id, tipo_flujo, tipo_doc, folio, periodo_ingesta)
);
CREATE INDEX idx_documentos_empresa_estado ON documentos(empresa_id, estado);
CREATE INDEX idx_documentos_empresa_periodo ON documentos(empresa_id, periodo_ingesta);

CREATE TABLE reglas_contables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id),
  nombre TEXT NOT NULL,
  prioridad INTEGER NOT NULL DEFAULT 100,          -- mayor prioridad evalúa primero
  activa INTEGER NOT NULL DEFAULT 1,
  -- condiciones (todas opcionales, se combinan AND)
  rut_contraparte TEXT, tipo_doc INTEGER, patron_razon_social TEXT, patron_glosa TEXT,
  monto_min INTEGER, monto_max INTEGER,
  -- resultado
  cuenta_id INTEGER NOT NULL REFERENCES cuentas(id),
  centro_costo_id INTEGER REFERENCES centros_costo(id),
  tratamiento_iva TEXT NOT NULL DEFAULT 'credito',
  cuenta_contraparte_id INTEGER REFERENCES cuentas(id),  -- default: alias PROVEEDORES/CLIENTES
  crear_desde_clasificacion INTEGER NOT NULL DEFAULT 0,  -- aprendida desde clasificación manual
  creado_por INTEGER REFERENCES users(id), creado_en TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_reglas_empresa_prioridad ON reglas_contables(empresa_id, prioridad DESC);

CREATE TABLE conciliaciones (        -- ejecución por empresa+periodo (resultado persistido)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id),
  periodo TEXT NOT NULL,
  resultado_json TEXT,               -- diferencias tipificadas + totales (ACCOUNTING_DOMAIN §9)
  diferencias INTEGER DEFAULT 0,
  ejecutado_por INTEGER REFERENCES users(id), ejecutado_en TEXT DEFAULT (datetime('now')),
  UNIQUE(empresa_id, periodo)
);
```

Estados del documento sin tabla de catálogo: constantes en `documentos/bandeja.js` (máquina de estados del dominio, ACCOUNTING_DOMAIN §5).

### B.4 Relación con el esquema actual (transición)

- `clientes` → `empresas`: migración 1:1 (INSERT SELECT). `clientes` y sus tablas de informes **no se eliminan**: el sistema tributario sigue funcionando; `documentos.informe_id` y `empresas.rut` son el puente.
- `users.is_admin` se interpreta como SUPER ADMIN al sembrar `roles`; la asignación `usuario_empresa` se siembra con el dueño actual (`user_id`) como ADMIN EMPRESA (y el admin global como CONTADOR/SUPER ADMIN).
- `rcv_cache` e informes quedan como están — la ingesta los lee/produce, no los modifica.
- Los reportes de portafolio se alimentarán de ambas fuentes (tributaria ya existente; contable cuando exista).

### B.7 Bóveda de secretos (claves SII)

- `empresas.clave_sii` se guarda cifrada: AES-256-GCM, clave maestra en `env` del servidor (`SECRETOS_MASTER_KEY`), formato `v1:<iv>:<tag>:<ciphertext>`; descifrado solo dentro de `integraciones/sii` al construir la sesión. `clientes.clave_sii` (legado) migra cifrada en la misma migración.

### B.8 Decisiones de integridad y portabilidad

1. **Dedupe de documentos** (idempotencia de ingesta): `clave_dedupe = hash(rut_empresa | tipo_flujo | tipo_doc | folio | periodo_ingesta)` + UNIQUE — re-ingesta del mismo RCV no duplica nada.
2. **FK compuestas**: SQLite soporta FK de dos columnas si ambas tablas las definen; en lugar de complicar, la redundancia de `empresa_id` en `asiento_lineas`/`documentos` es la defensa primaria de aislamiento por fila, verificada por el núcleo en cada consulta (WHERE empresa_id = ?).
3. **INTEGER pesos en todo el núcleo contable** (debe/haber/montos): elimina errores de coma flotante; los montos REAL del sistema tributario se convierten con `Math.round()` en la frontera (ingesta), nunca después.
4. **Sin saldos materializados en MVP**: mayor y balance = GROUP BY sobre `asiento_lineas` con índices (escala contable de un despacho: miles de líneas/mes). Si hiciera falta, tabla `saldos(empresa_id, cuenta_id, periodo, debe, haber)` mantenida en la misma transacción — decisión documentada, no urgente.
5. **Portabilidad a Postgres** (si algún día se requiere): tipos usados son INTEGER/TEXT; sin SQL propietario más allá de `datetime('now')` (fácilmente sustituible). SQLite ya demostró manejar el volumen del caso real (2.826 documentos en 9 meses con detalle completo).
6. `clave_sii` de `clientes` legado: lectura cifrada fallback a texto plano durante la transición (migración one-way).

### B.9 Índices pensados para las consultas críticas

- Bandeja: `(empresa_id, estado)`, `(empresa_id, periodo_ingesta)` — filtro principal de la UI.
- Diario: `(empresa_id, periodo)` en asientos + `asiento_id` en líneas.
- Mayor: `(empresa_id, cuenta_id)` en líneas.
- Auditoría: `(empresa_id, creado_en DESC)`.
- Reglas: `(empresa_id, prioridad DESC)`.

---

Definiciones de negocio de estas tablas: [ACCOUNTING_DOMAIN.md](ACCOUNTING_DOMAIN.md). Punto de acople con el SII: [INTEGRATIONS.md](INTEGRATIONS.md). Orden de implementación: [ROADMAP.md](ROADMAP.md).
