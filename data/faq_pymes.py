#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
faq_data_pymes.py — 50 preguntas frecuentes de Emprendedores y Pymes.
Bloques: Formalización, Partir bien, Primeros pasos, Crecimiento, Fondos y apoyo, Estructura.
"""

FAQS = [
    # ── Formalización ──
    ("¿Cómo formalizo mi negocio en Chile?",
     "Iniciación de actividades en el SII (puede ser el mismo día), régimen tributario correcto, "
     "facturación electrónica y patente si tu comuna lo exige. Te acompañamos en todo el proceso."),
    ("¿Cuánto cuesta formalizarse?",
     "La iniciación de actividades en el SII es gratuita. Los costos reales son la patente municipal "
     "(varía por comuna y rubro) y la contabilidad mensual. Te armamos el presupuesto completo."),
    ("¿Qué pasa si vendo sin iniciar actividades?",
     "Es evasión: el SII cruza datos de plataformas, transferencias y clientes. Regularizarse después "
     "cuesta más (multas, impuestos atrasados). Hay caminos de regularización ordenada: te guiamos."),
    ("¿Iniciación de actividades o constituir empresa: qué parto?",
     "Si partes solo, la empresa individual con iniciación de actividades alcanza. Si hay socios o "
     "quieres proteger tu patrimonio, evalúa una SpA. Te recomendamos según tu caso real."),
    ("¿Qué es el RUT y para qué me sirve?",
     "Es tu identificador tributario. Con él facturas, declaras y contratas. El RUT de persona natural "
     "sirve también para tu negocio individual; las sociedades tienen RUT propio."),
    ("¿Necesito patente comercial para vender online?",
     "Depende de la comuna y si tienes local. Muchas comunas hoy la exigen incluso para e-commerce "
     "con bodega en su territorio. Revisamos tu caso específico."),

    # ── Partir bien ──
    ("¿Qué régimen tributario me conviene al partir?",
     "Pro Pyme simplificado si vendes bajo 75 millones al año (contabilidad simplificada); "
     "Pro Pyme General si vas a crecer rápido. La decisión correcta al inicio evita migraciones traumáticas."),
    ("¿Qué es el 14 N°3 y por qué lo recomiendan a emprendedores?",
     "Es el régimen Pro Pyme Simplificado: tributas sobre ingresos efectivos con contabilidad "
     "simplificada, sin balance. Ideal para partir: menos costo administrativo."),
    ("¿Puedo partir emitiendo boletas y después facturar?",
     "Sí, se configuran los documentos que necesites (boletas, facturas, guías) desde la "
     "iniciación. Te dejamos el sistema listo para vender formalmente desde el día uno."),
    ("¿Cómo separo mi plata personal de la del negocio?",
     "Cuenta corriente tributaria separada, un sueldo o retiro fijo, y disciplina de no mezclar. "
     "Es la base para que tu contabilidad sirva de algo y para sobrevivir a una fiscalización."),
    ("¿Cuánto debía ahorrar para partir?",
     "Depende del giro, pero la regla mínima: 3-6 meses de costos fijos proyectados + capital de "
     "trabajo para el ciclo de venta (stock, créditos a clientes). Te ayudamos a proyectarlo."),
    ("¿Qué es el capital de trabajo y cuánto necesito?",
     "Es la plata para operar mientras cobras: inventario, sueldos, arriendo, impuestos. "
     "Se calcula con tu ciclo de venta real. Muchos negocios mueren por subestimarlo."),

    # ── Primeros pasos del negocio ──
    ("¿Cuánto impuesto pago al partir?",
     "Con pocas ventas, poco impuesto: el F29 sale con IVA neto pequeño y el PPM es 1% de tus ingresos. "
     "El error es no declarar: las multas crecen aunque vendas poco. Te llevamos el calendario completo."),
    ("¿Debo declarar IVA desde el primer mes?",
     "Sí, desde el mes siguiente a tu iniciación. Aunque no vendas: F29 sin movimiento. "
     "Nosotros lo llevamos completo para que no te preocupes por fechas."),
    ("¿Cómo calculo cuánto cobrar por mi producto o servicio?",
     "Costo directo + gastos asignados + margen objetivo, comparado con el mercado. "
     "El error típico: cobrar solo por costo y no por valor. Te armamos la estructura de precios."),
    ("¿Necesito marca registrada para partir?",
     "No es obligatorio, pero registrarte en INAPI cuesta poco y protege tu nombre antes de que "
     "otro lo tome. Lo recomendamos al partir, especialmente si invertirás en marketing."),
    ("¿Cómo emito mi primera factura?",
     "Con tu iniciación de actividades y el SII habilitado, generas DTE desde tu sistema o el portal "
     "MIPYME del SII. Te configuramos todo y te enseñamos el flujo completo."),
    ("¿Qué hacer si me piden factura siendo pequeño?",
     "Emítela sin miedo: facturar no te sube impuestos (el IVA lo paga tu cliente, y tus impuestos "
     "dependen de tus utilidades). Rechazar vender formal es dejar plata y oportunidades."),

    # ── Contrataciones primeras ──
    ("¿Cuándo conviene contratar al primer trabajador?",
     "Cuando tu tiempo valga más que el costo del puesto, o cuando la demanda supere tu capacidad. "
     "Calculamos el punto exacto: contratar antes de tiempo quema caja; después, quema oportunidad."),
    ("¿Cuánto cuesta realmente contratar a alguien?",
     "Sueldo + cargas previsionales (aprox. 2-4% extra según contrato) + gestión de nómina + "
     "equipamiento. Con la reforma previsional, el costo del empleador sube gradualmente. "
     "Te proyectamos el costo real completo."),
    ("¿Boleta o contrato para mi primer colaborador?",
     "Boletas solo si es un proveedor real e independiente (trae sus propios clientes, usa sus "
     "herramientas). Si parece trabajador pero pagas con boletas, es riesgo de tutela y multas. "
     "Te asesoramos sobre la frontera legal."),
    ("¿Qué contratos debo tener firmados desde el día uno?",
     "Contrato de trabajo (obligatorio en 15 días), reglamento interno si tienes 10+ trabajadores, "
     "y acuerdos de confidencialidad si tu negocio lo amerita. Armamos tu carpeta legal laboral."),

    # ── Crecimiento ──
    ("¿Cómo paso de freelance a empresa formal?",
     "Evaluamos estructura (SpA si hay socios o riesgo), régimen, facturación a empresas grandes "
     "y remuneraciones propias. Es el salto que conviene dar cuando facturas estable y quieres crecer."),
    ("¿Vendo más de lo que imaginaba, qué reviso primero?",
     "Tu régimen (¿supiste el tope?), tus PPM (¿estás pagando de más?), tu caja (¿estás cobrando "
     "igual de rápido que vendes?) y tus precios (¿tu margen sobrevivió al crecimiento?). "
     "Es la revisión de los que están creciendo bien."),
    ("¿Cómo abro una segunda sucursal sin caos?",
     "Nueva patente, ordenanzas, contabilidad por centro de costo y stock sincronizado. "
     "La segunda sucursal multiplica los errores si la primera no está ordenada: primero orden, después expansión."),
    ("¿Me conviene vender en marketplaces o tienda propia?",
     "Marketplaces traen volumen con comisiones altas y conciliación compleja; tienda propia, "
     "margen completo con costo de marketing. Muchas pymes mezclan. Te mostramos los números de cada canal."),
    ("¿Cuándo automatizo mis procesos administrativos?",
     "Cuando la tarea te quite más de 3-4 horas semanales o genere errores recurrentes. "
     "Facturación, cobranza y reportes son las primeras candidatas."),

    # ── Fondos y apoyo público ──
    ("¿Qué fondos existen para emprendedores?",
     "Sercotec (capital semilla y desarrollo), CORFO (instrumentos de innovación y escala), "
     "SENCE (capacitación), FOSIS si corresponde. Te orientamos al fondo correcto para tu etapa."),
    ("¿Me ayudan a postular a Sercotec o CORFO?",
     "Sí: presupuesto realista, plan de números coherente y documentación contable que respalde "
     "la postulación. Los proyectos caen más por números flojos que por mala idea."),
    ("¿Necesito contabilidad para postular a fondos?",
     "Sí: te piden historial o proyecciones financieras formales. Partir con contabilidad ordenada "
     "desde el inicio te habilita todos los fondos después."),
    ("¿Qué es SENCE y cómo lo uso?",
     "Franquicia tributaria de capacitación: recuperas hasta 1 UTM por trabajador al año en "
     "capacitación. Lo gestionamos: cursos elegibles, registros y recuperación del beneficio."),

    # ── Estructura y protección ──
    ("¿Qué protege una SpA que no protege la persona natural?",
     "Tu patrimonio personal: las deudas del negocio se limitan al capital aportado (salvo "
     "garantías personales que firmes). Con riesgo del rubro o socios, la SpA es casi siempre mejor."),
    ("¿Cuánto cuesta mantener una SpA?",
     "Razonable: constitución desde ~1 UTM en línea (o notaría), más contabilidad completa que "
     "la persona natural simplificada. Lo comparamos contra el beneficio patrimonial."),
    ("¿Necesito pacto de socios?",
     "Si hay más de un dueño: sí. Reglas de retiros, salida, toma de decisiones y valoración. "
     "El 80% de las empresas que mueren por socios, mueren por no tenerlo."),
    ("¿Cómo hago que mi negocio no dependa de mí todo el día?",
     "Procesos documentados, delegación con controles (no ciego) y números que te avisen antes "
     "de que algo explote. Es un trabajo de meses, y la contabilidad es el sistema nervioso."),

    # ── Obligaciones según tamaño ──
    ("¿A partir de cuánto tengo obligaciones laborales especiales?",
     "Con 10 trabajadores: reglamento interno. Con 25: comité paritario y experto en prevención. "
     "Con 100+: departamentos según normativa. Te mantenemos un paso adelante en cada umbral."),
    ("¿Qué me exige el SII cuando crezco?",
     "Migrar de régimen si superas topes, contabilidad completa si pasas de 14 N°3, y mayor "
     "escrutinio de coherencia entre ventas y gastos. Crecer bien es ordenar antes de que pidan."),
    ("¿Cómo se prepara una pyme para una fiscalización?",
     "Respaldos ordenados, conciliaciones al día, contratos correctos y coherencia de ingresos. "
     "La fiscalización indeseada es la que no llega."),

    # ── Rubros específicos ──
    ("¿Cómo formalizo un negocio de comida?",
     "Resolución sanitaria, patente, IVA sobre todo el menú, propinas electrónicas (ley 21.269) "
     "y costeo de platos. Es un rubro con muchas obligaciones paralelas: te llevamos todas."),
    ("¿Y un negocio de venta online?",
     "Iniciación, facturación/boleta electrónica, IVA correcto por despacho, conciliación de "
     "pasarelas y marketplaces, y registro de costos por producto. Lo implementamos completo."),
    ("¿Y servicios profesionales (diseño, marketing, consultoría)?",
     "Boletas de honorarios o facturación según cliente, régimen 50% vs. general, gastos "
     "deducibles y previsión para independientes. Optimizamos tu estructura concreta."),
    ("¿Y si vendo en Instagram/WhatsApp sin local?",
     "Igual que cualquier venta: es ingreso gravado. El SII cruza transferencias y publicidad. "
     "Formalizarse cuesta menos que regularizarse: te hacemos el camino corto."),

    # ── Cierre general ──
    ("¿Por qué las pymes fracasan según los números?",
     "Falta de capital de trabajo, márgenes mal calculados, impuestos y cargas no presupuestados. "
     "Todas son problemas contables que se prevén con números: ese es nuestro trabajo."),
    ("¿Cuánto cuesta tener la pyme ordenada contablemente?",
     "Menos de lo que cuesta no tenerla: multas, gastos rechazados, créditos negados y decisiones a ciegas. "
     "Te cotizamos el plan fijo en la consulta gratuita."),
    ("¿Puedo partir con ustedes solo con la contabilidad básica?",
     "Sí: partimos con lo esencial y escalamos contigo. Lo importante es partir ordenado ya, "
     "no perfecto después."),
    ("¿Atienden emprendedores fuera de Santiago?",
     "Todo Chile, 100% en línea. La formalización y contabilidad moderna no dependen de la ciudad."),
    ("¿Cómo facturo a una empresa grande sin morir de espera en los pagos?",
     "Con contrato claro (plazos e intereses por mora), factoring como respaldo de caja y negocio "
     "diversificado. Los mandantes grandes pagan bien pero tarde: tu caja debe estar diseñada para eso."),
    ("¿Qué reviso antes de aceptar un socio o inversor?",
     "Qué aporta (plata, clientes, trabajo), cómo sale si algo sale mal, y qué poder de decisión "
     "tiene. Después, pacto de socios por escrito. Antes de eso, solo conversaciones informales."),
    ("¿Me conviene franquiciar mi negocio o comprar una franquicia?",
     "Son caminos opuestos: franquiciar exige modelo probado y documentado; comprar una exige "
     "analizar sus números reales y obligaciones. Evaluamos la matemática de cualquiera de las dos."),
    ("¿Cómo empiezo?",
     "WhatsApp al +56 9 7575 2213 o el formulario de contacto. Contamos tu idea o tu negocio "
     "actual y te mostramos el camino formal más barato y seguro."),
]

if __name__ == "__main__":
    print(f"Pymes: {len(FAQS)} preguntas")
