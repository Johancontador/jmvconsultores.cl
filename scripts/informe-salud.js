#!/usr/bin/env node
/**
 * scripts/informe-salud.js — Informe de Salud Tributaria en Markdown.
 *
 * Construye el mismo informe que la vista #salud (core/salud-tributaria) y lo
 * escribe en un .md listo para revisar/imprimir. No consulta el SII: usa la
 * ficha guardada, el RCV ingerido y las declaraciones ya sincronizadas en
 * `declaraciones_sii`. Así el documento es reproducible y auditable.
 *
 * Uso:
 *   node scripts/informe-salud.js --empresa=1 [--periodo=YYYYMM] [--meses=60]
 *                                 [--out=docs/INFORME-SALUD-<rut>.md]
 */
require('dotenv').config()
const fs = require('fs')
const path = require('path')
const db = require('../backend/db')
const salud = require('../backend/core/salud-tributaria')
const { leerFichaGuardada } = require('../backend/core/empresas-sii')

function arg(nombre, def = null) {
  const p = process.argv.find((a) => a.startsWith(`--${nombre}=`))
  return p ? p.split('=').slice(1).join('=') : def
}

const empresaId = Number(arg('empresa', 0))
if (!empresaId) {
  console.error('Falta --empresa=<id>')
  process.exit(1)
}
const ahora = new Date()
const periodo = String(arg('periodo', `${ahora.getFullYear()}${String(ahora.getMonth() + 1).padStart(2, '0')}`))
const meses = Number(arg('meses', 60))

const emp = db.prepare(`SELECT * FROM empresas WHERE id = ? AND activo = 1`).get(empresaId)
if (!emp) {
  console.error(`Empresa ${empresaId} no encontrada`)
  process.exit(1)
}
const ficha = leerFichaGuardada(emp.rut)
const inf = salud.construirInforme(db, { empresaId, periodo, meses, ficha })

const clp = (n) => (n == null ? '—' : `$${Number(n).toLocaleString('es-CL')}`)
const pct = (n) => `${n}/100`
const md = []
const p = (t = '') => md.push(t)

p(`# Informe de Salud Tributaria — ${inf.identidad.razon_social || emp.nombre}`)
p()
p(`- **RUT:** ${inf.identidad.rut}`)
p(`- **Período analizado:** ${inf.cobertura.desde} → ${inf.cobertura.hasta} (${inf.cobertura.meses} meses)`)
p(`- **Generado:** ${new Date().toLocaleString('es-CL')}`)
p(`- **Score:** ${pct(inf.opinion.score)} · **Opinión:** ${inf.opinion.titulo} (${inf.opinion.nivel})`)
p()
p(`> ${inf.opinion.resumen}`)
p()
p('## 1. Identificación y régimen')
p()
p('| Dato | Valor |')
p('|---|---|')
p(`| Razón social (SII) | ${inf.identidad.razon_social || '—'} |`)
p(`| Inicio de actividades | ${inf.identidad.inicio_actividades || '—'} |`)
p(`| Término de giro | ${inf.identidad.termino_giro || 'sin término registrado'} |`)
p(`| Régimen | ${inf.identidad.regimen || 'no determinado'}${inf.identidad.regimen_atributo ? ` (${inf.identidad.regimen_atributo.codigo})` : ''} |`)
p(`| Actividad | ${(inf.identidad.actividades || []).join(' · ') || '—'} |`)
p(`| Domicilio | ${inf.identidad.direccion || '—'} |`)
p(`| Capital | ${inf.identidad.capital ? `${inf.identidad.capital.enterado_miles_clp} miles enterados / ${inf.identidad.capital.por_enterar_miles_clp} por enterar` : '—'} |`)
p(`| Fuente de la ficha | ${inf.identidad.fuente} |`)
p()

if ((inf.identidad.alertas_sii || []).length) {
  p('### Alertas del SII')
  p()
  for (const a of inf.identidad.alertas_sii) {
    p(`- ${a.descripcion || a.descripcionAlerta || 'Alerta'} (código ${a.codigo || 's/c'}, ${a.fechaActiv || 's/f'})`)
  }
  p()
}

p('## 2. Declaraciones oficiales')
p()
p('| Declaración | Estado de la consulta | Resultado | Última consulta |')
p('|---|---|---|---|')
for (const [k, nombre] of [['f29', 'F29 mensual'], ['renta_f22', 'Renta F22'], ['juradas', 'Declaraciones juradas'], ['boletas_honorarios', 'Boletas de honorarios']]) {
  const d = inf.declaraciones[k]
  p(`| ${nombre} | ${d.estado === 'disponible' ? 'Consultado' : 'No consultado'} | ${d.detalle} | ${d.ultima_consulta || '—'} |`)
}
p()

const pendientes = inf.mensuales.filter((m) => m.f29_estado === 'pendiente' || m.f29_estado === 'no_presentada')
if (pendientes.length) {
  p('### F29 pendientes según el SII')
  p()
  for (const m of pendientes) p(`- **${m.nombre}** — estado ${m.f29_oficial?.etiqueta || 'pendiente'}`)
  p()
}

p('## 3. Ingresos y cobertura')
p()
p('| Año | Ventas neto (RCV) | IVA ventas | Compras neto | IVA compras | Meses con datos |')
p('|---|---|---|---|---|---|')
for (const a of inf.ingresos_historicos.anios) {
  p(`| ${a.anio} | ${clp(a.ventas_neto)} | ${clp(a.ventas_iva)} | ${clp(a.compras_neto)} | ${clp(a.compras_iva)} | ${a.meses_con_datos} |`)
}
p()
p(`Cobertura: ${inf.cobertura.con_datos} mes(es) con RCV, ${inf.cobertura.sin_movimiento} sin movimiento confirmado, ${inf.cobertura.sin_datos} sin sincronizar.`)
p()

p('## 4. Declaraciones anuales (F22 y boletas)')
p()
p('| Año | Ventas RCV | F22 | Monto F22 | BHE emitidas | BHE recibidas |')
p('|---|---|---|---|---|---|')
for (const a of inf.declaraciones_anuales.anios) {
  p(`| ${a.anio} | ${a.rcv ? clp(a.rcv.ventas_neto) : '—'} | ${a.f22 ? a.f22.etiqueta : 'no consultado'} | ${a.f22 ? clp(a.f22.monto_total) : '—'} | ${a.boletas_honorarios?.emitidas?.totales ? clp(a.boletas_honorarios.emitidas.totales.honorario_bruto) : '—'} | ${a.boletas_honorarios?.recibidas?.totales ? clp(a.boletas_honorarios.recibidas.totales.honorario_bruto) : '—'} |`)
}
p()

p('## 5. Detalle mensual')
p()
p('| Período | RCV | F29 SII | Ventas neto | IVA est. | PPM est. | F29 est. | F29 declarado | Diferencia |')
p('|---|---|---|---|---|---|---|---|---|')
for (const m of inf.mensuales) {
  p(`| ${m.nombre} | ${m.estado.replaceAll('_', ' ')} | ${m.f29_oficial ? m.f29_oficial.etiqueta : '—'} | ${clp(m.ventas_neto)} | ${clp(m.iva_estimado)} | ${clp(m.ppm_estimado)} | ${clp(m.f29_estimado)} | ${m.f29_oficial ? clp(m.f29_oficial.monto_total) : '—'} | ${m.f29_diferencia == null ? '—' : clp(m.f29_diferencia)} |`)
}
p()

p('## 6. Hallazgos')
p()
if (!inf.opinion.hallazgos.length) p('Sin hallazgos.')
for (const h of inf.opinion.hallazgos) {
  p(`### [${h.severidad.toUpperCase()}] ${h.titulo}`)
  p()
  p(h.detalle)
  p()
  p(`*Fuente: ${h.fuente}*`)
  p()
}

p('## 7. Fundamentos, recomendaciones y limitaciones')
p()
p('**Fundamentos**')
p()
for (const f of inf.opinion.fundamentos) p(`- ${f}`)
p()
p('**Recomendaciones**')
p()
for (const r of inf.opinion.recomendaciones) p(`- ${r}`)
p()
p('**Limitaciones**')
p()
for (const l of inf.opinion.limitaciones) p(`- ${l}`)
p()
p('**Base normativa citada**')
p()
for (const b of inf.opinion.base_normativa) p(`- ${b}`)
p()

const out = arg('out', path.join('docs', `INFORME-SALUD-${emp.rut.replace(/[^\d-]/g, '')}.md`))
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, md.join('\n'))
console.log(`Informe escrito en ${out} (${inf.opinion.nivel}, score ${inf.opinion.score})`)
db.close()
