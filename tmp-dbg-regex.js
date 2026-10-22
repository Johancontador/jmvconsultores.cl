const html = '<table class="tabla tabla-mensual"><tr>x</tr></table>'
const clase = 'tabla-mensual'
const re = new RegExp(`<table class="tabla ${clase}">([\s\S]*?)<\/table>`)
console.log('source:', re.source)
console.log('match:', html.match(re))
