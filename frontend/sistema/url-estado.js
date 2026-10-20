/**
 * Contexto de ruta en la URL (F1): empresa y período viajan en la query del
 * hash, junto a los filtros de cada vista. Este módulo es PURO (sin DOM, sin
 * red) para que la suite lo ejecute en un sandbox: la aritmética de
 * `#vista?filtro=…&empresa=…&periodo=…` se prueba sin navegador.
 *
 * Contrato:
 *  - `partes('#documentos?estado=PENDIENTE&empresa=3')`
 *      → { key: 'documentos', query: <URLSearchParams> }
 *  - `contexto(hash)` → { empresa, periodo } (null cuando faltan)
 *  - `conContexto(hash, { empresa, periodo })` → hash con el contexto puesto y
 *    TODAS las claves de la vista conservadas (no se borra ni se reordena la
 *    intención de la vista: `estado`, `tipo`, `p`, …). Por defecto RESPETA el
 *    contexto que el hash ya trae (solo rellena lo que falta): así navegar a
 *    un enlace compartido no lo sobrescribe con lo guardado en la sesión.
 *  - `conContexto(hash, ctx, { forzar: true })` → sobrescribe el contexto
 *    existente; es lo que usa el router al normalizar una URL con datos
 *    inválidos o de otra empresa.
 *  - `periodoValido('202609')` → true; '202613', '2026-09', '' → false
 *
 * El período del sistema es `YYYYMM` (así lo devuelve el backend y así lo
 * guarda `iva_periodo_activo`); aquí solo se escribe si tiene esa forma, para
 * que un `?periodo=hola` no llegue nunca a un fetch. La empresa se escribe con
 * su id. Nunca se inventa contexto en la URL.
 */
;(function () {
  const PERIODO_RE = /^\d{4}(0[1-9]|1[0-2])$/

  function partes(hash) {
    const h = String(hash || '#inicio').replace(/^#/, '')
    const i = h.indexOf('?')
    return {
      key: i === -1 ? h : h.slice(0, i),
      query: new URLSearchParams(i === -1 ? '' : h.slice(i + 1)),
    }
  }

  function contexto(hash) {
    const { query } = partes(hash)
    return { empresa: query.get('empresa'), periodo: query.get('periodo') }
  }

  function conContexto(hash, { empresa = null, periodo = null } = {}, { forzar = false } = {}) {
    const { key, query } = partes(hash)
    const poner = (k, v) => {
      if (v === null || v === undefined || String(v) === '') return
      if (!forzar && query.get(k)) return // el enlace manda: no se pisa
      query.set(k, String(v))
    }
    poner('empresa', empresa)
    if (periodo !== null && periodo !== undefined && PERIODO_RE.test(String(periodo))) poner('periodo', periodo)
    const qs = query.toString()
    return `#${key}${qs ? `?${qs}` : ''}`
  }

  function periodoValido(p) {
    return PERIODO_RE.test(String(p || ''))
  }

  window.UrlEstado = { partes, contexto, conContexto, periodoValido, PERIODO_RE }
})()
