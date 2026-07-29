# APPFLOW — IVA Mensual

## Flujo principal mensual

```
INICIO
  │
  ▼
[Pantalla Clientes]
  │ Click "Proceso" en navbar
  ▼
[Pantalla Proceso]
  │ Selecciona mes + año
  │ Click "Generar todo"
  ▼
[Loop por cada cliente activo]
  │
  ├── Consulta ventas → SimpleAPI → suma documentos
  │     Espera 1200ms
  ├── Consulta compras → SimpleAPI → suma documentos
  │     Espera 1200ms
  ├── Calcula IVA determinado, PPM, total F29
  ├── Guarda resultado en tabla procesos (SQLite)
  ├── Muestra card con resultado
  │
  ├── [Si error] → muestra badge ERROR, continúa con siguiente
  │
  └── [Siguiente cliente...]
  │
  ▼
[Todos procesados]
  │
  ├── Resumen: X ok / Y errores
  │
  └── Por cada card:
        ├── [Ver mensaje] → despliega texto WhatsApp
        ├── [Copiar] → copia al portapapeles
        └── [WhatsApp] → abre wa.me/{telefono}?text={mensaje_encoded}
```

## Flujo gestión clientes

```
[Lista clientes]
  │
  ├── [+ Agregar]
  │     └── Modal formulario
  │           ├── Validar RUT chileno
  │           ├── Validar campos obligatorios
  │           └── POST /api/clientes → actualiza lista
  │
  ├── [✏️ Editar]
  │     └── Modal formulario prellenado
  │           └── PUT /api/clientes/:id → actualiza lista
  │
  └── [🗑️ Eliminar]
        └── Confirm dialog "¿Eliminar [nombre]?"
              └── DELETE /api/clientes/:id → actualiza lista
```

## Cálculos IVA

```javascript
// Cliente afecto (normal)
debito_fiscal  = sum(ventas.montoIVA)
credito_fiscal = sum(compras.montoIVA)
iva_pagar      = debito_fiscal - credito_fiscal
ppm_monto      = sum(ventas.montoNeto) * cliente.tasa_ppm
total_f29      = iva_pagar + ppm_monto

// Cliente exento
debito_fiscal  = 0
credito_fiscal = 0
iva_pagar      = 0
ppm_monto      = 0
total_f29      = 0

// Caso remanente (iva_pagar < 0)
// Se muestra como "Remanente: $XXX" en el mensaje
// total_f29 = solo ppm_monto en ese caso
```

## Generación texto WhatsApp

```javascript
function generarMensaje(cliente, datos, periodo) {
  const p = formatPeriodo(periodo) // "05-2026"
  const signo = datos.iva_pagar < 0 ? 'REMANENTE' : 'IVA a pagar'
  const ivaDisplay = Math.abs(datos.iva_pagar)

  return `Hola ${cliente.nombre} 👋

A continuación le envío información correspondiente a la declaración de IVA del período ${p}:

📦 COMPRAS DEL MES
  Neto:    ${fmt(datos.compras_neto)}
  IVA:     ${fmt(datos.compras_iva)}
  Total:   ${fmt(datos.compras_total)}

🧾 VENTAS DEL MES
  Neto:    ${fmt(datos.ventas_neto)}
  IVA:     ${fmt(datos.ventas_iva)}
  Total:   ${fmt(datos.ventas_total)}

📊 IMPUESTO DETERMINADO
  Débito fiscal:    ${fmt(datos.debito_fiscal)}
  Crédito fiscal:  -${fmt(datos.credito_fiscal)}
  ${signo}:         ${fmt(ivaDisplay)}

💼 PPM (${(cliente.tasa_ppm * 100).toFixed(1)}%)
  Monto PPM:        ${fmt(datos.ppm_monto)}

💰 TOTAL A PAGAR F29: ${fmt(datos.total_f29)}

Saludos,
${process.env.NOMBRE_CONTADOR}`
}
```

## Manejo de errores

| Error | Causa probable | Comportamiento |
|---|---|---|
| HTTP 401 | Clave SII incorrecta | Badge rojo "Clave incorrecta" |
| HTTP 429 | Rate limit SimpleAPI | Espera 5s y reintenta 1 vez |
| HTTP 500 | SII caído | Badge rojo "SII no disponible" |
| Timeout | SII lento | Badge rojo "Timeout — reintentar" |
| Sin documentos | Período sin movimiento | Card vacía con $0 en todo |

## Estados de una card resultado

- `procesando` → spinner animado
- `ok` → datos completos, botones activos
- `error` → mensaje de error, botón reintentar individual
- `exento` → datos de compras/ventas, sin cálculo IVA
