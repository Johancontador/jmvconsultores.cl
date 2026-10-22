const path = require('path')
const PROJECT = 'C:/Proyectos/iva-mensual'
process.env.DB_PATH = path.join(PROJECT, 'data', 'iva_mensual.db')
const db = require(path.join(PROJECT, 'backend', 'db'))
const salud = require(path.join(PROJECT, 'backend', 'core', 'salud-tributaria'))
const inf = salud.construirInforme(db, { empresaId: 1, periodo: '202610', meses: 24 })
console.log('--- mensuales ---')
for (const m of inf.mensuales.slice(0, 6)) {
  console.log(JSON.stringify({
    nombre: m.nombre,
    ventas_neto: m.ventas_neto, ventas_iva: m.ventas_iva, compras_iva: m.compras_iva,
    iva_estimado: m.iva_estimado, ppm_estimado: m.ppm_estimado,
    f29: m.f29_oficial?.monto_total, dif: m.comparacion?.diferencia_total,
    etiqueta: m.f29_oficial?.etiqueta,
  }))
}
console.log('--- declaraciones f29 ---')
console.log(JSON.stringify(inf.declaraciones?.f29, null, 1).slice(0, 900))
