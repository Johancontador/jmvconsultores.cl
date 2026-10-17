#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
faq_data_acompanamiento.py — 50 preguntas frecuentes de Acompañamiento Contable.
Bloques: Servicio, Decisiones, Finanzas, Crecimiento, Relación con el contador.
"""

FAQS = [
    # ── El servicio ──
    ("¿En qué se diferencia del servicio de contabilidad mensual?",
     "La contabilidad registra lo que pasó; el acompañamiento te ayuda a decidir qué hacer. "
     "Incluye reuniones mensuales de análisis, alertas y apoyo directo en decisiones."),
    ("¿Tengo que dejar a mi contador actual?",
     "No. Podemos darte una segunda opinión o trabajar en conjunto. Si quieres cambiarte, "
     "gestionamos la transferencia completa sin baches."),
    ("¿Cómo funciona la primera reunión?",
     "Sin costo y sin compromiso: revisamos tu situación, detectamos riesgos y oportunidades, "
     "y te proponemos un plan. Tú decides si avanzamos."),
    ("¿Quién me atenderá realmente?",
     "Un contador asignado que conoce tu negocio, con canal directo por WhatsApp o correo. "
     "No tickets anónimos ni call centers."),
    ("¿Cada cuánto nos reunimos?",
     "Mensualmente para la revisión de resultados, y cuando lo necesites para decisiones "
     "puntuales (una compra grande, un crédito, un socio nuevo)."),
    ("¿Recibo informes escritos?",
     "Sí: reporte mensual claro con indicadores, alertas y comparaciones. Y documentos "
     "puntuales cuando hay una decisión sobre la mesa."),

    # ── Decisiones de negocio ──
    ("¿Me ayudan a decidir si compro una máquina o arriendo?",
     "Sí: comparamos leasing, crédito y compra directa con tus números reales, "
     "incluyendo el beneficio tributario de cada opción."),
    ("¿Vale la pena abrir una segunda sucursal?",
     "Lo evaluamos con datos: costos fijos nuevos, punto de equilibrio, impacto tributario. "
     "Muchas expansiones fracasan por no hacer este análisis antes."),
    ("¿Cómo sé si estoy ganando plata de verdad?",
     "Con estados financieros bien hechos y márgenes por línea de negocio. "
     "Ventas altas con márgenes negativos son más comunes de lo que crees."),
    ("¿Cómo sé qué producto deja más margen?",
     "Con costeo por producto o servicio: asignamos costos directos y gastos, y te mostramos "
     "la rentabilidad real de cada línea. Suele haber sorpresas."),
    ("¿Debo subir mis precios?",
     "Analizamos tus márgenes, tu competencia y la elasticidad de tu demanda. "
     "Con inflación, no subir precios es perder margen mes a mes."),
    ("¿Me conviene contratar o subcontratar?",
     "Comparamos costo total (sueldo + cargas + gestión) contra honorarios + riesgo. "
     "Depende de la continuidad y criticidad del puesto."),

    # ── Finanzas y caja ──
    ("¿Por qué mi empresa vende y no hay plata?",
     "Porque vender no es cobrar. Analizamos tu ciclo de conversión de efectivo: días de "
     "inventario, días de cobro y días de pago. Ahí está la respuesta."),
    ("¿Cómo proyecto mi caja de los próximos meses?",
     "Con flujo de caja proyectado: cobros esperados, pagos fijos, remuneraciones e impuestos. "
     "Actualizado mensualmente para anticipar faltantes."),
    ("¿Cuánto dinero debería tener de reserva?",
     "La regla práctica para pymes: entre 2 y 4 meses de costos fijos. "
     "Calculamos tu número según tu estacionalidad y riesgo del rubro."),
    ("¿Cómo negoció mejor con mis proveedores?",
     "Con información: te mostramos tu poder de compra real y proponemos términos de pago "
     "que cuiden tu caja sin dañar la relación."),
    ("¿Qué hago con clientes que pagan a 90 días?",
     "Puedes financiar la venta (factoring), cobrar interés por mora o exigir anticipos. "
     "Evaluamos el costo de cada opción y la política de crédito ideal."),
    ("¿Me conviene un crédito o un leasing para crecer?",
     "Depende del activo, tu tributación y tu flujo. Comparamos el costo real de cada "
     "alternativa, incluyendo el efecto en tu impuesto anual."),

    # ── Crecimiento ──
    ("¿Estoy listo para crecer?",
     "Lo medimos: márgenes estables, caja proyectada, obligaciones al día y procesos simples. "
     "Crece la empresa que tiene la casa en orden."),
    ("¿Cómo evito que la contabilidad se me venga encima al crecer?",
     "Escalando procesos a tiempo: facturación automática, conciliaciones mensuales y "
     "reportes que funcionan igual con 2 o 20 empleados."),
    ("¿Cuándo debo contratar mi primer administrador/contador interno?",
     "Cuando la carga administrativa te quite más de 8 horas semanales de tu negocio principal. "
     "Hasta ahí, externalizar es más barato y profesional."),
    ("¿Me conviene invertir en software de gestión?",
     "Evaluamos el retorno real: horas ahorradas, errores evitados, datos para decidir. "
     "A veces sí, a veces una planilla bien hecha alcanza por años."),
    ("¿Cómo preparo mi empresa para pedir un crédito grande?",
     "Estados financieros ordenados, impuestos al día, historial de ventas y plan de uso "
     "de los fondos. Armamos tu carpeta bancaria completa."),
    ("¿Qué números me piden los inversionistas?",
     "Ventas, márgenes, burn rate, punto de equilibrio y proyección a 24 meses. "
     "Preparamos tu modelo financiero para esas conversaciones."),

    # ── Tributación aplicada a decisiones ──
    ("¿Cómo impacto el régimen tributario en mis decisiones?",
     "En Pro Pyme, comprar activos en diciembre puede deducirse casi completo ese año. "
     "En general, el régimen define el timing de cada gasto e inversión. Lo cruzamos siempre."),
    ("¿Me conviene retirar plata o dejarme como utilidades?",
     "Los retiros tributan en tu Global Complementario; dejarlas acumuladas puede convenir "
     "según tu régimen y tu nivel de renta personal. Simulamos ambos escenarios."),
    ("¿Puedo poner mi auto o mi casa en la empresa?",
     "Hay formas legales (comodato, arriendo, activo de la sociedad) con límites y efectos "
     "tributarios distintos. Te mostramos qué conviene y qué riesgo tiene cada una."),
    ("¿Cómo separo mis gastos personales de la empresa?",
     "Con estructura: cuentas separadas, criterios de gastos definidos y respaldo correcto. "
     "Es el error más común y el más caro en una fiscalización."),

    # ── Indicadores y control ──
    ("¿Qué indicadores debería mirar mensualmente?",
     "Mínimo: ventas, margen bruto, gastos fijos, caja proyectada y deudores vencidos. "
     "Te armamos un dashboard de 1 página con tus KPIs reales."),
    ("¿Cómo comparo mi empresa con otras del rubro?",
     "Con benchmarks: márgenes típicos, rotación y estructura de gastos por industria. "
     "Te mostramos dónde estás sobre o bajo la referencia."),
    ("¿Qué es la brecha tributaria y cómo la detecto?",
     "Es la diferencia entre lo que pagas y lo que pagarías con una estructura óptima. "
     "La medimos con una revisión completa: suele ser más grande de lo que se imagina."),
    ("¿Cómo controlo que mis administradores no se me pasen de la raya?",
     "Con controles internos simples: autorizaciones dobles, conciliaciones independientes "
     "y reportes cruzados. Sin burocracia, pero sin ciego total."),

    # ── Socios y familia ──
    ("¿Cómo organizo la contabilidad entre socios?",
     "Reglas claras de retiros, reportes mensuales iguales para todos y decisión informada. "
     "El 80% de los conflictos entre socios son por plata sin claridad."),
    ("¿Me conviene formar sociedad o seguir como persona natural?",
     "Depende de tus utilidades, riesgo del rubro y planes. Simulamos ambos escenarios "
     "con tus números antes de recomendar."),
    ("¿Cómo preparó la sucesión de mi empresa familiar?",
     "Con orden documental, valuación simple y estructura de traspaso que minimice carga "
     "tributaria. El mejor momento para empezarlo es 3 años antes."),
    ("¿Mi cónyuge puede trabajar en la empresa?",
     "Sí, con contrato y cotizaciones correctas (o como socio según estructura). "
     "Ojo: hay reglas especiales para cónyuges en sociedades de personas."),

    # ── Crisis y problemas ──
    ("Las ventas cayeron, ¿qué hago primero?",
     "Congelar contrataciones, revisar gastos fijos, proyectar caja a 90 días y renegociar "
     "plazos. Te acompañamos con el plan completo y la priorización."),
    ("Tengo deudas tributarias y de bancos, ¿por dónde parto?",
     "Por el mapa completo de deudas: tasas, garantías y urgencias. Luego convenios "
     "priorizados. Negociar a medias empeora el escenario."),
    ("¿Me conviene cerrar la empresa y abrir otra?",
     "Casi nunca es la mejor opción: el término de giro mal hecho arrastra deudas y "
     "responsabilidades. Evaluamos reestructuración primero."),
    ("¿Qué hago si mi socio se quiere ir?",
     "Revisamos el pacto de socios, valuamos su participación y estructuramos la salida "
     "sin desangrar la caja. Si no hay pacto, te ayudamos a negociar uno."),

    # ── Relación con el servicio ──
    ("¿Cuánto cuesta el acompañamiento contable?",
     "Depende del tamaño y complejidad. Plan fijo mensual que incluye reuniones y reportes: "
     "te lo cotizamos en la consulta gratuita."),
    ("¿Se puede combinar con contabilidad y remuneraciones?",
     "Es lo ideal: el acompañamiento usa los mismos datos. La mayoría de nuestros clientes "
     "de acompañamiento contrata el paquete completo."),
    ("¿Qué pasa si tengo una urgencia a mitad de mes?",
     "Escribes directo a tu contador asignado. Las urgencias (carta del SII, problema de caja, "
     "negocio puntual) se atienden en el día o el siguiente."),
    ("¿Trabajan con socios que no son contadores?",
     "La mayoría de nuestros clientes son dueños de negocio, no contadores. "
     "Nuestro trabajo es traducir los números a decisiones."),
    ("¿Qué herramientas uso yo para trabajar con ustedes?",
     "Las mínimas: tu correo, WhatsApp y acceso a tu banco/SII. Nosotros operamos el resto "
     "y te entregamos lo que necesitas leer."),
    ("¿Qué pasa con mi información si terminamos?",
     "Entrega completa y ordenada, transferencia asistida y confidencialidad que continúa "
     "indefinidamente. Igual que en nuestro servicio de respaldo."),
    ("¿Cómo mido si el servicio me está sirviendo?",
     "Tres señales claras: obligaciones al día, decisiones documentadas y menos sorpresas. "
     "Revisamos juntos el valor entregado cada trimestre."),
    ("¿Cómo preparo mi empresa para venderla algún día?",
     "Desde años antes: contabilidad ordenada, contratos formales, sin deudas ocultas y números "
     "que un comprador pueda auditar. Las empresas ordenadas se venden más caro y más rápido."),
    ("¿Qué reviso antes de firmar un contrato grande con un cliente?",
     "Márgenes reales considerando volumen y plazos de pago, penalidades del contrato, capacidad "
     "de tu operación y efecto en tu caja. Un contrato grande mal cotizado puede quebrar una pyme."),
    ("¿Cómo empiezo?",
     "WhatsApp al +56 9 7575 2213 o el formulario de contacto. La primera reunión de "
     "diagnóstico es gratis y sin compromiso."),
]

if __name__ == "__main__":
    print(f"Acompañamiento: {len(FAQS)} preguntas")
