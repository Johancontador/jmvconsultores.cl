#!/usr/bin/env node
/**
 * scripts/sincronizar-fichas.js — descarga la ficha oficial del SII de las
 * empresas activas (carga inicial o refresco manual).
 *
 * Uso:
 *   node scripts/sincronizar-fichas.js                  # solo las que faltan o >7 días
 *   node scripts/sincronizar-fichas.js --dias=0         # fuerza todas
 *   node scripts/sincronizar-fichas.js --empresa=1,5    # solo esas
 *
 * Por qué existe: la sincronización diaria ya refresca la ficha al conectar
 * con el SII (`core/empresas-sii.asegurarFicha`), pero ese hook solo corre
 * cuando el RCV de la empresa termina bien. Para una carga inicial —o para una
 * empresa cuya sync nunca pasa— se fuerza aquí, empresa por empresa.
 *
 * Garantías:
 *  - Una sesión SII por empresa (la abre y la cierra `consultarFichaSii`).
 *  - Nunca imprime claves ni datos de la bóveda.
 *  - Un fallo del SII se informa con su código (`SII_TOPE_SESIONES`,
 *    `SII_SIN_NAVEGADOR`…) y NO detiene las demás empresas.
 *  - Sale con código 1 si alguna empresa falló (útil en cron/CI).
 */
require('dotenv').config()
const db = require('../backend/db')
const { asegurarFicha, fichaGuardadaEn } = require('../backend/core/empresas-sii')
const licencias = require('../backend/core/licencias')

function arg(nombre, def = null) {
  const f = process.argv.find((a) => a.startsWith(`--${nombre}=`))
  return f ? f.split('=').slice(1).join('=') : def
}

const dias = arg('dias') == null ? 7 : Number(arg('dias'))
const filtro = String(arg('empresa') || '').split(',').map(Number).filter(Boolean)

async function main() {
  const actor = licencias.usuarioSistema(db)
  const empresas = db.prepare(`SELECT id, rut, nombre FROM empresas WHERE activo = 1 ORDER BY id`).all()
    .filter((e) => !filtro.length || filtro.includes(e.id))

  if (!empresas.length) {
    console.log('No hay empresas activas que procesar.')
    return { total: 0, actualizadas: 0, vigentes: 0, errores: 0 }
  }

  const resumen = { total: 0, actualizadas: 0, vigentes: 0, errores: 0 }
  for (const e of empresas) {
    resumen.total += 1
    const antes = fichaGuardadaEn(e.rut)
    const r = await asegurarFicha(db, {
      empresaId: e.id,
      usuarioId: actor,
      dias: Number.isFinite(dias) ? dias : 7,
      ip: 'script:sincronizar-fichas',
    })
    const etiqueta = `[${e.id}] ${e.rut} ${e.nombre.slice(0, 38)}`
    if (r.actualizada) {
      resumen.actualizadas += 1
      console.log(`${etiqueta} → ficha ${r.motivo}${r.regimen ? ` · régimen: ${r.regimen}` : ''}`)
    } else if (r.motivo === 'vigente') {
      resumen.vigentes += 1
      console.log(`${etiqueta} → vigente (${r.edad_dias} día(s)${antes ? `, guardada ${antes.slice(0, 10)}` : ''})`)
    } else if (r.motivo === 'error') {
      resumen.errores += 1
      console.log(`${etiqueta} → ERROR ${r.codigo || ''} ${r.error}`)
    } else {
      resumen.errores += 1
      console.log(`${etiqueta} → ${r.motivo}`)
    }
  }

  console.log(`\nTotal ${resumen.total} · actualizadas ${resumen.actualizadas} · vigentes ${resumen.vigentes} · errores ${resumen.errores}`)
  return resumen
}

if (require.main === module) {
  main()
    .then((r) => process.exit(r.errores ? 1 : 0))
    .catch((err) => {
      console.error(`Fallo: ${err.message}`)
      process.exit(1)
    })
}

module.exports = { main }
