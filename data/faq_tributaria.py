#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
faq_data_tributaria.py — 50 preguntas frecuentes de Asesoría Tributaria.
Bloques: Operación Renta, Multas y SII, Régmenes, Boletas honorarios,
Impuestos específicos, Patrimonio y planificación.
"""

FAQS = [
    # ── Operación Renta ──
    ("¿Qué pasa si no declaro mi F22 a tiempo?",
     "Multas del art. 97 N°6 del Código Tributario: 1 UTA (~$950.000) si no hay impuesto, o 10% más "
     "2% por mes (tope 30%) si hay impuesto, más intereses penales. El impuesto impago termina en "
     "cobranza judicial de Tesorería. Te regularizamos y negociamos las multas."),
    ("¿Cuándo es la Operación Renta 2026?",
     "Abril a junio según el rol del SII (terminación del RUT). La preparación de diciembre "
     "es lo que marca la diferencia: ahí se toman las decisiones que ahorran impuestos."),
    ("¿A quién le corresponde declarar renta?",
     "A quien tuvo rentas sobre los topes legales (13,5 UTA en la mayoría de los casos) o quiera "
     "recuperar retenciones, devoluciones o usar crédito fiscal. Te revisamos si te corresponde."),
    ("¿Por qué me sale a pagar si otros reciben devolución?",
     "Por tus pagos provisionales, tus gastos con crédito y tu régimen. A veces es estructura "
     "del negocio; a veces es planificación pendiente. Lo analizamos y optimizamos."),
    ("¿Qué documentos necesito para la Operación Renta?",
     "Certificados de retenciones, intereses bancarios, gastos con crédito, cotizaciones APV/previsionales "
     "y boletas de gastos. Armamos tu carpeta completa."),
    ("¿Puedo aplazar el pago de la Renta?",
     "Sí: hay prórrogas automáticas según el rol y opción de pagar en cuotas (hasta 5-7 según año). "
     "Calculamos si conviene aplazar o pagar al día."),
    ("¿Qué es la renta presunta y me conviene?",
     "Régimen simplificado para ciertas actividades (mineros, transportistas, agricultores): "
     "tributas sobre una base presunta sin contabilidad completa. Evaluamos si tu caso califica y conviene."),

    # ── Multas y SII ──
    ("¿Cómo sé si tengo multas o deudas con el SII?",
     "Con tu clave SII y una revisión completa de tu perfil: declaraciones, pagos y notificaciones. "
     "Hacemos ese chequeo en la consulta gratuita."),
    ("¿Se pueden condonar las multas del SII?",
     "Sí: atrasos sin intención, primera vez, dificultades económicas o montos pequeños. "
     "Presentamos la solicitud bien fundamentada: la tasa de éxito depende de cómo se pide."),
    ("¿Qué es la cobranza administrativa y la ejecutiva?",
     "Administrativa: avisos y cobros del propio SII. Ejecutiva: pasó a Tesorería, con embargos "
     "posibles. Si estás en la segunda, el tiempo corre en tu contra: actuamos de inmediato."),
    ("¿Me puede embargar Tesorería por impuestos impagos?",
     "Sí: cuentas bancarias, vehículos, inventario e incluso el giro. Antes de eso hay instancias "
     "de convenio de pago. Si ya llegó la notificación, hay opciones: la velocidad importa."),
    ("¿Qué hago si el SII me notifica una fiscalización?",
     "No firmes ni declares nada apresuradamente. Revisamos el alcance, preparamos respaldos y "
     "te acompañamos en todo el proceso. La fiscalización bien manejada termina sin multas mayores."),
    ("¿Puedo ir a la cárcel por deudas de impuestos?",
     "Por deudas no. Por delitos tributarios sí (facturas ideológicamente falsas, boletas sin respaldo, "
     "ocultación de ingresos). Si tu caso roza esa línea, hay que regularizar con asesoría inmediata."),

    # ── Régmenes y estructura ──
    ("¿Pro Pyme, Semitransparente o Régimen General?",
     "Pro Pyme General (14 D) para la mayoría de las pymes en crecimiento; Semitransparente para "
     "utilidades bajas o socios naturales de renta baja; General para grandes o con necesidades "
     "específicas. Simulamos con tus números."),
    ("¿Qué pasa si supero el tope de ventas de mi régimen?",
     "Debes migrar al régimen que corresponda al año siguiente. Planificamos la transición con "
     "anticipación: contabilidad completa, asignación de gastos y proyección de impuesto."),
    ("¿Me conviene ser SpA o persona natural con negocio?",
     "Depende de utilidades, riesgo y retiros. La SpA da flexibilidad de utilidades y tope de "
     "Primera Categoría (27%); la persona natural simplifica pero tributa directo. Simulamos ambos."),
    ("¿Puedo tener dos empresas y tributar juntas?",
     "Cada empresa tributa por sí sola (salvo transparencia). Hay reglas anti-elusión entre "
     "empresas relacionadas que hay que respetar. Te estructuramos bien."),

    # ── Boletas de honorarios y profesionales ──
    ("¿Cómo tributan las boletas de honorarios?",
     "Régimen 50%: la mitad es renta efectiva con gasto presunto del 30%, y la retención de 13,75% "
     "es crédito contra tu impuesto anual. Explicado simple: tributas sobre la mitad, y la "
     "retención normalmente cubre más de lo que debes."),
    ("¿Conviene el 50% o el régimen general para profesionales?",
     "Depende de tus gastos reales: si gastas poco (50% te deja tributar poco), el 50% es duro "
     "de batir. Con gastos altos y respaldo, el régimen general puede convenir. Comparamos con tus números."),
    ("¿Puedo ser boletero y tener empresa al mismo tiempo?",
     "Sí, son ingresos distintos que coexisten. Hay reglas de acumulación en la Renta. "
     "Estructuramos ambos para que no pagues de más."),
    ("¿Qué retención me hacen por boletas y me la devuelven?",
     "13,75% por boleta (11% hasta ~$7.725.700 anuales en 2026 con beneficio 1,75%). Se acredita "
     "en tu Renta y si sobra, se devuelve. Gestionamos todo el ciclo."),

    # ── IVA e impuestos específicos ──
    ("¿Quién debe pagar IVA?",
     "Todo contribuyente que venda bienes o servicios habituales afectos. Profesionales en boletas "
     "no pagan IVA; comercios sí. Revisamos tu situación correcta."),
    ("¿Puedo recuperar el IVA si vendo solo a empresas grandes?",
     "Sí: si tu crédito fiscal supera tu débito sistemáticamente, hay devolución o arrastre. "
     "Y en exportaciones, el IVA se recupera completo. Te ayudamos a recuperar."),
    ("¿Cómo tributan los arriendos que recibo?",
     "Régimen 14 N°1 (renta efectiva con gastos) o 14 N°4 (semipresunta, 11,5% aproximado sobre "
     "ingresos). Comparamos según tus gastos y antigüedad del contrato."),
    ("¿Cómo tributa la venta de una propiedad?",
     "Depende: primera vivienda (exenta con beneficio), propiedad no habitacional (Impuesto de "
     "Primera Categoría por la ganancia), o venta habitual (IVA además). Cada caso es distinto."),
    ("¿Qué impuestos pago si heredo o donan bienes?",
     "Impuesto a las Herencias y Donaciones con tasas progresivas por tramo y abonos según "
     "parentesco. La planificación anticipada (donaciones en vida, fideicomisos) reduce "
     "significativamente la carga."),
    ("¿Cómo tributan las criptomonedas e inversiones en el exterior?",
     "Son renta afecta y deben declararse. Las cuentas en el exterior están obligadas a "
     "reportarse (presentación de interesados). Regularizamos inversiones digitales y extranjeras."),

    # ── Gastos y créditos ──
    ("¿Qué gastos puedo deducir de mis impuestos?",
     "Los necesarios para producir la renta, con respaldo: arriendo del local, insumos, servicios, "
     "capacitación (SENCE), software (crédito), entre otros. Te enseñamos qué gasto es seguro."),
    ("¿Qué son los gastos rechazados y cuánto cuestan?",
     "Gastos sin respaldo o ajenos al giro: se suman a tu base con recargo del 35,5% (por sanción "
     "adicional). Cuidar el respaldo es la planificación más rentable."),
    ("¿El IVA de mi comida o mi auto lo puedo usar?",
     "En general no (gastos personales o semisuntuarios). Excepciones: giro de restaurant, "
     "autos de transportistas. Te decimos con precisión qué pasa con cada gasto tuyo."),
    ("¿El crédito SENCE lo puedo usar?",
     "Sí: recuperas hasta 1 UTM por trabajador capacitado al año (fruíble en la Renta o como "
     "pago de cotizaciones). Gestionamos la franquicia completa."),
    ("¿Qué es el crédito por Ley de Software?",
     "Recuperas 35,5% del gasto en software (tope 15 UTM) como crédito tributario. "
     "Si tu empresa compra o desarrolla software, lo aplicamos."),

    # ── Planificación ──
    ("¿Qué es la planificación tributaria y qué la hace legal?",
     "Organizar tus negocios usando las opciones que la ley ofrece (regímenes, créditos, timing). "
     "Es legal porque usa normas escritas; lo ilegal es simular operaciones u ocultar ingresos."),
    ("¿Cuándo se planifica: en abril o en diciembre?",
     "En diciembre. Abril solo revela lo que la gestión del año ya decidió. "
     "La planificación de fin de año es la que mueve los números reales."),
    ("¿Me conviene adelantar gastos o compras al diciembre?",
     "En Pro Pyme sí (depreciación instantánea y gastos que bajan tu base). En régimen "
     "semitransparente depende. Lo simulamos con tu caso antes de comprar."),
    ("¿Cómo planifico mis retiros de la empresa?",
     "Balanceando tu renta personal (Global Complementario) y la utilidad acumulada. "
     "Hay años conviene retirar más, años conviene esperar. Proyectamos 3 años."),
    ("¿Puedo cambiar el giro de mi empresa para pagar menos?",
     "El giro debe reflejar tu actividad real. Lo que sí se hace es actualizar giros y "
     "agregar actividades nuevas para tener acceso a los tratamientos que corresponden."),

    # ── Situaciones especiales ──
    ("¿Cómo tributo si trabajo para empresas de afuera (remoto)?",
     "Depende de tu residencia y de si la empresa extranjera tiene presencia en Chile. "
     "Hay reglas específicas para trabajadores remotos y nómadas digitales. Analizamos tu caso."),
    ("¿Tengo que declarar mi cuenta en el extranjero?",
     "Sí, si superas ciertos montos (declaración de interesados en el exterior). No declararla "
     "genera sanciones altas. Te ayudamos a regularizar."),
    ("¿Cómo tributo si vendo mi empresa?",
     "Depende de cómo esté estructurada (acción, activos, fondo de comercio) y del régimen. "
     "La preparación de una venta ideal parte 1-2 años antes. Te acompañamos en todo el proceso."),
    ("¿Qué hago con los impuestos si muere un familiar con negocio?",
     "Hay obligaciones de declaración y posesión efectiva, con plazos que corren. "
     "Ordenamos el patrimonio y los trámites con la menor carga posible."),
    ("¿Puedo regularizar años sin declarar?",
     "Sí: declaraciones atrasadas por cada período, multas (condonables en gran parte), "
     "convenios si hay deuda. Lo hemos hecho muchas veces: hay salida ordenada."),

    # ── Relación con el servicio ──
    ("¿Cuánto cuesta la asesoría tributaria?",
     "Depende de la complejidad: consultas puntuales, planificación anual o acompañamiento completo. "
     "La primera revisión de tu situación es gratis."),
    ("¿Me pueden representar ante el SII y Tesorería?",
     "Sí: requerimientos, cartas, fiscalizaciones y convenios con Tesorería. Estar bien "
     "representado cambia el resultado."),
    ("¿Trabajan con casos difíciles (años sin declarar, cobranza)?",
     "Sí, son parte de nuestro día a día. La regularización ordenada casi siempre es más "
     "barata que la opción de seguir ignorando el problema."),
    ("¿Qué necesito para partir con la asesoría?",
     "Tu RUT, clave SII y acceso a tus declaraciones anteriores. Con eso hacemos el diagnóstico "
     "completo y te proponemos el plan."),
    ("¿Puedo contratar solo la Operación Renta anual?",
     "Sí: hay clientes que solo nos ven en abril. Pero la mayoría termina pidiendo la "
     "planificación de diciembre cuando ve cuánto se ahorra."),
    ("¿Qué es el F29 rectificativo y cuándo lo uso?",
     "Cuando ya enviaste un F29 con errores: ventas mal informadas, crédito fiscal omitido, código "
     "equivocado. Corregir pronto evita multas y cruces raros en tu perfil. Lo gestionamos por ti."),
    ("¿Me conviene comprar en diciembre o enero para efectos tributarios?",
     "En Pro Pyme, comprar en diciembre te permite deducir el activo en ese año tributario. "
     "En enero ya corre para el año siguiente. Un mes de diferencia, un año de impuesto distinto."),
    ("¿Cómo empiezo?",
     "WhatsApp al +56 9 7575 2213 o el formulario de contacto. Revisamos tu situación tributaria "
     "gratis y te decimos dónde estás dejando plata."),
]

if __name__ == "__main__":
    print(f"Tributaria: {len(FAQS)} preguntas")
