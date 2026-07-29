# BACKEND — IVA Mensual

## Endpoints API

### SII — Libro de Compras y Ventas (un solo mes)

#### GET /api/sii/libro?cliente_id=&periodo=YYYYMM&tipo=compras|ventas
Devuelve, para UN período y UN tipo de operación:
- `resumen`: por tipo de documento, igual a la tabla que muestra el SII (Total Documentos,
  Monto Exento, Monto Neto, IVA Recuperable, IVA Uso Común, IVA No Recuperable, Monto Total).
  Viene directo de `getResumen`, es la fuente de verdad para "cuadrar" contra lo que el
  contador ve en el portal.
- `detalle`: documento a documento, parseado desde el CSV que entrega `getDetalleCompraExport`
  / `getDetalleVentaExport`.
- `totales`: sumas de ambas fuentes + `cuadra` (boolean) comparando resumen vs. detalle.

```json
// Response 200
{
  "ok": true,
  "cliente": { "id": 3, "nombre": "...", "rut": "76312274-3" },
  "periodo": "202601",
  "tipo": "compras",
  "resumen": [ { "tipoDoc": 33, "nombreTipoDoc": "Factura Electrónica", "cantidad": 132, "exento": 10624, "neto": 40592588, "iva": 7712597, "ivaUsoComun": 0, "ivaNoRecuperable": 0, "total": 48545635 } ],
  "detalle": [ { "folio": "2050", "rutDoc": "76413286-6", "razonSocial": "...", "montoExento": 0, "montoNeto": 59592, "montoIVA": 11322, "montoTotal": 70914, "tipoDoc": 33 } ],
  "totales": { "resumen": { "neto": 0, "iva": 0, "exento": 0, "total": 0 }, "detalle": { "...": "..." }, "cuadra": true }
}
```

Nota: el resumen no resta Notas de Crédito de las Facturas — es una tabla categorizada,
igual que en el SII. El cálculo de Impuesto Determinado (proceso mensual / F29) sí debe
restar el IVA de las NC del crédito/débito fiscal; son dos cosas distintas.

### Clientes

#### GET /api/clientes
Lista todos los clientes activos.
```json
// Response 200
[
  {
    "id": 1,
    "rut": "76123456-7",
    "nombre": "Comercial XYZ Ltda.",
    "tasa_ppm": 0.015,
    "telefono": "56912345678",
    "exento": 0,
    "activo": 1
  }
]
// NOTA: clave_sii NO se devuelve al frontend nunca
```

#### POST /api/clientes
```json
// Body
{
  "rut": "76123456-7",
  "nombre": "Comercial XYZ Ltda.",
  "clave_sii": "miClave123",
  "tasa_ppm": 0.015,
  "telefono": "56912345678",
  "exento": false
}
// Response 201
{ "ok": true, "id": 1 }

// Response 400 (validación)
{ "ok": false, "error": "RUT inválido" }

// Response 409 (duplicado)
{ "ok": false, "error": "Ya existe un cliente con ese RUT" }
```

#### PUT /api/clientes/:id
```json
// Body (mismos campos que POST, todos opcionales)
{ "tasa_ppm": 0.02 }
// Response 200
{ "ok": true }
```

#### DELETE /api/clientes/:id
```json
// Response 200
{ "ok": true }
// Soft delete: activo = 0, no borra el registro
```

### Proceso

#### POST /api/proceso/generar
Lanza el proceso para todos los clientes. Responde inmediatamente
con lista de clientes, luego el frontend hace polling o usa SSE.

```json
// Body
{ "periodo": "202605" }

// Response 202
{
  "ok": true,
  "proceso_id": "abc123",
  "clientes": [
    { "id": 1, "nombre": "Comercial XYZ Ltda." },
    { "id": 2, "nombre": "Juan Pérez Natural" }
  ]
}
```

#### GET /api/proceso/:proceso_id/estado
Polling del frontend cada 2 segundos para ver progreso.
```json
// Response 200
{
  "total": 12,
  "procesados": 3,
  "resultados": [
    {
      "cliente_id": 1,
      "nombre": "Comercial XYZ Ltda.",
      "rut": "76123456-7",
      "telefono": "56912345678",
      "exento": false,
      "estado": "ok",
      "ventas_neto": 2100000,
      "ventas_iva": 399000,
      "ventas_total": 2499000,
      "compras_neto": 1250000,
      "compras_iva": 237500,
      "compras_total": 1487500,
      "debito_fiscal": 399000,
      "credito_fiscal": 237500,
      "iva_pagar": 161500,
      "ppm_monto": 31500,
      "total_f29": 193000
    },
    {
      "cliente_id": 2,
      "nombre": "Juan Pérez Natural",
      "estado": "error",
      "error_msg": "Clave SII incorrecta"
    }
  ]
}
```

#### POST /api/proceso/reintentar/:cliente_id
Reintenta un cliente específico que falló.
```json
// Body
{ "periodo": "202605" }
// Response: mismo formato que un resultado individual
```

## Estructura de archivos backend

```javascript
// backend/index.js
const express = require('express')
const path = require('path')
const app = express()

app.use(express.json())
app.use(express.static(path.join(__dirname, '../frontend')))

app.use('/api/clientes', require('./routes/clientes'))
app.use('/api/proceso', require('./routes/proceso'))

app.listen(process.env.PORT || 3500)

// backend/db.js
const Database = require('better-sqlite3')
const db = new Database(process.env.DB_PATH || './data/iva_mensual.db')
db.pragma('journal_mode = WAL')
// Crear tablas si no existen
module.exports = db

// backend/routes/clientes.js
// CRUD completo de clientes

// backend/routes/proceso.js
// Lanza proceso, polling estado, reintentar

// backend/services/sii.js
// Login + sesión directa al SII, consulta RCV compras/ventas, con retry y rate limiting
```

## Validación RUT chileno

```javascript
function validarRut(rut) {
  // Acepta formato: 76123456-7 o 761234567
  const clean = rut.replace(/[.\-]/g, '')
  if (clean.length < 8 || clean.length > 9) return false
  const body = clean.slice(0, -1)
  const dv = clean.slice(-1).toUpperCase()
  
  let suma = 0
  let multiplo = 2
  for (let i = body.length - 1; i >= 0; i--) {
    suma += parseInt(body[i]) * multiplo
    multiplo = multiplo < 7 ? multiplo + 1 : 2
  }
  const dvEsperado = 11 - (suma % 11)
  const dvCalc = dvEsperado === 11 ? '0' : dvEsperado === 10 ? 'K' : String(dvEsperado)
  return dv === dvCalc
}
```

## Formato montos

```javascript
function fmt(monto) {
  return '$' + Math.round(monto).toLocaleString('es-CL')
}
```

## Conexión directa al SII (backend/services/sii.js)

Pendiente de implementar con las rutas reales que Johan usa hoy manualmente
(login, semilla/token si aplica, endpoint de detalle de compras/ventas por período).
Forma esperada de la interfaz, para que routes/proceso.js no cambie:

```javascript
// backend/services/sii.js
async function consultarRCV(rut, clave, tipo, periodo) {
  // tipo: 'ventas' | 'compras'
  // 1. login(rut, clave) → cookie de sesión (o reutilizar si sigue vigente)
  // 2. GET/POST al endpoint de detalle RCV del período, con esa cookie
  // 3. normalizar la respuesta al mismo shape que usaba SimpleAPI:
  //    [{ folio, rutDoc, razonSocial, montoNeto, montoIVA, montoTotal, tipoDoc, estadoDocumento }]

  // Manejo de errores esperado:
  //   clave incorrecta      → throw new Error('Clave SII incorrecta')
  //   sesión rechazada/captcha → throw new Error('SII rechazó la sesión — reintentar')
  //   timeout / sii caído    → throw new Error('SII no disponible')
}

// Entre consultas esperar 1200ms, igual que antes
const sleep = ms => new Promise(r => setTimeout(r, ms))
```
