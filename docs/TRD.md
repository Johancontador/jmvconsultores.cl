# TRD — IVA Mensual

## Stack

| Capa | Tecnología | Razón |
|---|---|---|
| Runtime | Node.js 20 LTS | Disponible, conocido |
| Servidor | Express 4 | Simple, sin magia |
| Base de datos | SQLite (better-sqlite3) | Sin servidor, un archivo, suficiente para 12 clientes |
| Frontend | HTML + CSS + JS vanilla | Sin build, sin dependencias, carga instantánea |
| Contenedor | Docker + docker-compose | Ya instalado en el servidor |
| API externa | Conexión directa al SII (sin intermediario) | RCV_PROVIDER=sii — el SII no tiene web services públicos, así que backend/services/sii.js hace login con rut+clave de cada cliente y consulta el RCV directamente, manejando cookies/sesión propias |

## Arquitectura

```
Navegador (Johan)
     │
     │ HTTP
     ▼
Express (puerto 3500)
     ├── GET  /api/clientes          → lista clientes
     ├── POST /api/clientes          → crear cliente
     ├── PUT  /api/clientes/:id      → editar cliente
     ├── DELETE /api/clientes/:id    → eliminar cliente
     ├── POST /api/proceso/generar   → procesa todos los clientes
     └── Static files (frontend/)
     │
     │ HTTPS (login + sesión con cookies, por cliente)
     ▼
SII (sii.cl / www4.sii.cl / misiir.sii.cl)
```

### Nota sobre el cambio de proveedor
El plan original (ver PLAN.md histórico) consideraba SimpleAPI como intermediario pagado.
Se decidió conectar directo al SII: cada cliente ya tiene su rut + clave_sii guardados,
y el SII no expone web services oficiales — todo es scraping de sesión autenticada
(login → cookie de sesión → endpoints internos de RCV). Esto significa:
- `backend/services/sii.js` reemplaza a `backend/services/simpleapi.js`
- Ya no se requiere `SIMPLEAPI_KEY` (se mantiene RCV_PROVIDER=sii en .env)
- Se necesita un manejo de cookies por request (no hay key fija, hay sesión por cliente)
- Los endpoints exactos de login y descarga de detalle de compras/ventas se confirman
  con Johan (rutas que usa hoy manualmente) antes de implementar la Fase 4 real

## Base de datos SQLite

### Tabla: clientes
```sql
CREATE TABLE clientes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  rut       TEXT NOT NULL UNIQUE,      -- "76123456-7"
  nombre    TEXT NOT NULL,             -- "Comercial XYZ Ltda."
  clave_sii TEXT NOT NULL,             -- clave SII (texto plano, app local)
  tasa_ppm  REAL NOT NULL DEFAULT 0,   -- 0.015 = 1.5%
  telefono  TEXT NOT NULL,             -- "56912345678"
  exento    INTEGER NOT NULL DEFAULT 0, -- 0=no, 1=si
  activo    INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT DEFAULT (datetime('now'))
);
```

### Tabla: procesos
```sql
CREATE TABLE procesos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  periodo     TEXT NOT NULL,   -- "202605"
  cliente_id  INTEGER NOT NULL,
  ventas_neto REAL DEFAULT 0,
  ventas_iva  REAL DEFAULT 0,
  ventas_total REAL DEFAULT 0,
  compras_neto REAL DEFAULT 0,
  compras_iva  REAL DEFAULT 0,
  compras_total REAL DEFAULT 0,
  iva_determinado REAL DEFAULT 0,
  ppm_monto   REAL DEFAULT 0,
  total_pagar REAL DEFAULT 0,
  estado      TEXT DEFAULT 'pendiente', -- pendiente | ok | error
  error_msg   TEXT,
  creado_en   TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (cliente_id) REFERENCES clientes(id)
);
```

## SII directo — integración (pendiente de confirmar rutas exactas con Johan)

### Flujo esperado
```
1. Login: POST con rut + clave_sii del cliente → cookie de sesión
2. Consulta RCV ventas del período (rut, periodo) → usa cookie de sesión
3. Consulta RCV compras del período (rut, periodo) → usa cookie de sesión
4. Parsear/descargar el detalle (idealmente el export/detalle, no solo el resumen)
```

Las URLs concretas (login, semilla/token si aplica, endpoints de detalle de compras/ventas)
se completan aquí una vez que Johan comparta las rutas que usa hoy manualmente en sii.cl.

### Respuesta esperada (array de documentos, formato objetivo tras normalizar)
```json
[
  {
    "folio": "123",
    "rutDoc": "12345678-9",
    "razonSocial": "Proveedor SA",
    "montoNeto": 100000,
    "montoIVA": 19000,
    "montoTotal": 119000,
    "tipoDoc": 33,
    "estadoDocumento": "VIGENTE"
  }
]
```

### Cálculo desde documentos
```javascript
// Sumar todos los documentos del período
ventas_neto  = sum(doc.montoNeto)
ventas_iva   = sum(doc.montoIVA)
ventas_total = sum(doc.montoTotal)

// IVA determinado
debito_fiscal  = ventas_iva
credito_fiscal = compras_iva
iva_pagar      = debito_fiscal - credito_fiscal  // puede ser negativo (remanente)

// PPM
ppm_monto = ventas_neto * tasa_ppm

// Total F29
total_pagar = iva_pagar + ppm_monto
```

### Cliente exento
- No se calcula IVA determinado (débito = 0)
- No se calcula PPM (tasa = 0)
- Total a pagar = 0
- Se muestra badge EXENTO en la card

## Variables de entorno (.env)
```
RCV_PROVIDER=sii
PORT=3500
DB_PATH=./data/iva_mensual.db
NOMBRE_CONTADOR=Johan Morales
```
Nota: SIMPLEAPI_KEY queda obsoleto tras el cambio a conexión directa. Si en el futuro
se agrega otro proveedor, RCV_PROVIDER permite elegir entre "sii" y el que corresponda.

## Docker
```yaml
# docker-compose.yml
services:
  iva-mensual:
    build: .
    ports:
      - "3500:3500"
    volumes:
      - ./data:/app/data   # SQLite persiste aquí
    env_file:
      - .env
    restart: unless-stopped
```

## Formato RUT
- Almacenado: "76123456-7" (con guión, sin puntos)
- Mostrado: "76.123.456-7" (con puntos y guión)
- Para API: "76123456-7" (con guión, sin puntos)

## Rate limiting / buenas prácticas de scraping SII
- Máx 1 consulta/segundo, igual que antes
- Entre cada cliente esperar 1200ms para no saturar los servidores del SII
- Reutilizar la sesión (cookie) mientras dure, evitar loguear más de una vez por cliente por corrida
- 24 consultas/mes en escenario normal (12 clientes × 2), sin costo por ser conexión directa
