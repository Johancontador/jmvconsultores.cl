#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
faq_data_remuneraciones.py — 50 preguntas frecuentes de Remuneraciones.
Bloques: Finiquitos, Leyes vigentes, Previsión y salud, Beneficios, Liquidaciones, Contratos.
Respuestas legales verificadas: Papito Corazón (21.478), retiros AFP (21.389),
reforma previsional (21.735), art. 163/174 CT, gratificación art. 50.
"""

FAQS = [
    # ── Finiquitos (bloque más buscado) ──
    ("¿Cuánto me corresponde de finiquito si me despiden?",
     "Depende de la causal. Sin justa causa: indemnización por años de servicio (1 mes por año, tope 11), "
     "feriado proporcional y días trabajados. Con justa causa del art. 160, solo feriado y días trabajados. "
     "Revisamos tu caso para que no te paguen menos de lo que corresponde."),
    ("¿Qué me corresponde si renuncio voluntariamente?",
     "Días trabajados del mes y feriado proporcional. No hay indemnización por años de servicio salvo "
     "que tu contrato la pacte. Ojo: si renuncias por incumplimientos graves del empleador (art. 171), "
     "puedes demandar la indemnización igual: te asesoramos si es tu caso."),
    ("¿Cómo tributa un finiquito? ¿Me devuelven impuestos?",
     "El finiquito tributa como remuneración (art. 174 CT). Si sumando todas tus rentas del año no "
     "superas las 13,5 UTA, puedes recuperar el impuesto retenido en la Operación Renta. "
     "Calculamos tus finiquitos optimizando la retención para no perder plata."),
    ("¿Los retiros del 10% AFP afectan mi finiquito?",
     "Sí: el empleador puede rebajar hasta el 50% de la indemnización por años de servicio con cargo "
     "al seguro de cesantía (ley 21.389 y modificaciones). Si retiraste plata, tu finiquito puede ser "
     "menor: te calculamos el impacto exacto antes de firmar."),
    ("¿Cuándo deben pagarme el finiquito?",
     "No hay un plazo legal único, pero la práctica y el SII recomiendan el último día o dentro de los "
     "primeros días hábiles. Si se demoran meses, hay acciones: te orientamos."),
    ("¿Puedo descontar deudas del trabajador en el finiquito?",
     "Solo si hay autorización escrita y dentro de límites legales. Los descuentos indebidos son "
     "causa de reclamación. Te asesoramos sobre qué sí se puede descontar."),
    ("¿Qué es la causal necesidades de la empresa?",
     "Es una causal objetiva (art. 161) que exige aviso previo de 30 días o indemnización sustitutiva, "
     "más la indemnización por años. Mal aplicada, genera indemnizaciones adicionales: la revisamos bien."),

    # ── Ley Papito Corazón y alimentos ──
    ("¿Qué es la Ley Papito Corazón y cómo se aplica?",
     "Es la ley 21.478. Si un trabajador debe pensión de alimentos, puede pedir al juzgado el descuento "
     "del 50% de las cotizaciones de los capítulos 3 (salud) y 4 (leyes sociales) de su sueldo, "
     "para destinarlo a la deuda. El empleador debe aplicarlo cuando llega la orden judicial."),
    ("¿El descuento Papito Corazón es obligatorio para el empleador?",
     "Sí, cuando el juzgado lo notifica. No aplicarlo hace responsable al empleador del monto no "
     "descontado. Lo gestionamos: recepción de la orden, cálculo exacto del 50% y reporte correcto."),
    ("¿Cuánto me descuentan de pensión de alimentos del sueldo?",
     "El juzgado fija el porcentaje sobre tu remuneración (generalmente 20% a 50%) antes de que el "
     "Papito Corazón aplique sobre los capítulos 3 y 4. Coordinamos todos los descuentos para que "
     "el líquido nunca quede bajo el mínimo legal."),
    ("¿Puedo pedir el Papito Corazón si soy el deudor?",
     "Sí: se solicita ante el juzgado de familia que lleva tu causa de alimentos. Una vez notificado "
     "el empleador, este debe aplicarlo. Te orientamos sobre el proceso y el efecto en tu liquidación."),

    # ── Leyes vigentes que cambian cálculos ──
    ("¿Qué es la Ley Karin y qué debo implementar?",
     "Ley 21.643, vigente desde agosto 2024: obliga a toda empresa a tener un protocolo de prevención, "
     "investigación y sanción del acoso laboral, sexual y la violencia en el trabajo. Sin protocolo "
     "actualizado, la empresa queda expuesta en fiscalizaciones y demandas. Lo implementamos completo."),
    ("¿Cómo afecta la jornada de 44 horas a las liquidaciones?",
     "La reducción gradual (40h en 2024 → 44h en 2026 → 42h en 2028) puede cambiar el valor de horas "
     "extras, la distribuciones de jornada y los sueldos pactados por hora. Revisamos tus contratos "
     "y ajustamos los cálculos en cada etapa."),
    ("¿Qué cambia con la reforma previsional 2025 (ley 21.735)?",
     "Crea un aporte del empleador que llega al 8,6% (transición 2025-2032) y un Seguro Social. "
     "Tu nómina y costos laborales cambian cada año de la transición: actualizamos tus cálculos "
     "y proyectamos el impacto en tu negocio."),
    ("¿Qué es la sala cuna universal?",
     "La ley extendió el beneficio: ahora toda trabajadora con contrato vigente tiene derecho a sala "
     "cuna o compensación en dinero, independientemente del número de trabajadoras de la empresa. "
     "Lo incluimos en tus costos de contratación."),
    ("¿Sigue existiendo el tope imponible de AFP?",
     "Sí, con ajustes. Los topes de cotización obligatoria y voluntaria se actualizan periódicamente "
     "y la reforma añade tramos. Aplicamos los topes vigentes en cada liquidación para no "
     "descontar de más."),

    # ── Liquidaciones y sueldos ──
    ("¿Qué debe incluir una liquidación de sueldo?",
     "Sueldo base, gratificación legal (si corresponde), bonos, descuentos legales (AFP, salud, cesantía), "
     "otros descuentos autorizados y el líquido a pagar. Emitimos liquidaciones electrónicas que "
     "cumplen todo y las enviamos a cada trabajador."),
    ("¿Sueldo base o sueldo líquido en el contrato?",
     "Cambiar la negociación: el líquido pactado se ajusta cuando cambian cargas previsionales. "
     "Te asesoramos sobre la estructura más conveniente y legal para tu empresa."),
    ("¿Cómo se calcula la gratificación legal?",
     "Por defecto: 25% de lo devengado en el año, con tope de 4,75 ingresos mínimos mensuales "
     "(art. 50 del CT). Alternativa pactada: 35% de las utilidades líquidas. Analizamos cuál "
     "te conviene y la aplicamos bien."),
    ("¿Las horas extras se pagan al doble?",
     "Sí: 50% de recargo mínimo sobre el valor de la hora ordinaria (art. 32 CT), y solo si se pactó "
     "jornada ordinaria. En 44 horas, las extras se cuentan distinto. Las calculamos exactas y "
     "con el respaldo documental correcto."),
    ("¿Puedo pagar bonos en vez de sueldo base?",
     "Hay estructuras (asignaciones no imponibles: colación, movilización, víveres) que reducen "
     "cotizaciones legalmente. Pero mal aplicadas, son rechazadas por la Inspección del Trabajo "
     "y el SII. Te armamos la estructura legal optimizada."),
    ("¿Qué hago si me pagan menos horas extras o comisiones?",
     "Tienes derecho a reclamar en la Inspección del Trabajo y a demandar diferencias por hasta "
     "4 y 11 meses según el tema. Te acompañamos en el reclamo y el cálculo de lo que te deben."),

    # ── Previsión y salud ──
    ("¿Qué descuentos legales se aplican a mi sueldo?",
     "AFP (10% más comisión), salud (7% con tope 80 UF en Fonasa o según isapre), seguro de cesantía "
     "(0,6% trabajador + 2,4% empleador en contrato indefinido) y SIS según ingreso. Te mostramos "
     "cada descuento línea por línea en tu liquidación."),
    ("¿Fonasa o isapre: qué me conviene?",
     "Depende de tu edad, cargas y uso médico. Fonasa es más barata y de cobertura amplia; las "
     "isapres, más caras pero con cobertura de convenios libres. Analizamos tu caso con números."),
    ("¿Qué es el SIS y por qué me lo descuentan?",
     "El Seguro de la Industria, Salubridad y Servicios (ley 21.342) financia la atención de trabajadores "
     "con contratos por turnos o faenas. Se descuenta según tu ingreso: lo explicamos y verificamos "
     "que se aplique solo cuando corresponde."),
    ("¿El empleador puede pagarme el AFP en vez de cotizar?",
     "No. La evasión previsional es delito y deja al trabajador sin pensión ni cobertura. Si tu "
     "empleador no cotiza, puedes reclamar: te orientamos sobre el proceso."),

    # ── Beneficios y asignaciones ──
    ("¿Cuándo corresponde asignación familiar?",
     "Para trabajadores con cargas familiares (hijos menores, estudiantes hasta 24 años, discapacidad) "
     "y según tu ingreso imponible (tramo del INP). La matriculamos y pagamos correctamente."),
    ("¿Qué es la asignación maternal?",
     "Subsidio mensual para madres trabajadoras por cada carga menor de 18 años, independientemente "
     "del ingreso. Se incluye en la liquidación con los datos de carga bien registrados."),
    ("¿Me corresponde sala cuna si tengo pocos trabajadores?",
     "Con la sala cuna universal (2026): sí, si eres trabajadora con contrato vigente. La empresa "
     "paga el beneficio o la compensación según tu elección. Lo gestionamos completo."),
    ("¿Qué beneficios tiene el seguro de cesantía?",
     "Cuenta individual (4 pagos con contrato vigente, según tiempo) y cuenta solidaria (2 pagos "
     "con cargo al fondo común, con exigencias de cotizaciones). Te calculamos cuánto te toca "
     "y cómo girarlo."),
    ("¿Puedo cotizar APV y descontarlo del sueldo?",
     "Sí: el APV colectivo se puede pactar como descuento por planilla, y los aportes voluntarios "
     "con tope tributario (900 UF anuales) generan beneficio en la Renta. Coordinamos el descuento "
     "y el registro."),

    # ── Contratos y jornada ──
    ("¿Qué tipos de contrato existen y cuál me conviene?",
     "Indefinido, plazo fijo (máx. renovable una vez, 12 meses totales salvo gerentes), por obra o "
     "faena, y a jornadas especiales (part-time, turnos). Elegimos el correcto para tu negocio "
     "sin exponerte a reconvenciones."),
    ("¿Puedo convertir un contrato a plazo fijo en indefinido?",
     "Sí, automáticamente si se renueva más de una vez o supera los plazos legales. La conversión "
     "tiene efectos en indemnizaciones. Controlamos los vencimientos para que no te pase sin querer."),
    ("¿Qué es el contrato parcial y qué límites tiene?",
     "Menos de 44 horas semanales, con reglas especiales de cotización y el tope de 2 contractos "
     "parciales simultáneos. Te asesoramos si te conviene para tu operación."),
    ("¿Turnos nocturnos y festivos: cómo se pagan?",
     "No hay recargo legal por noche (salvo pacto), pero los festivos trabajados con descanso "
     "compensatorio sí tienen recargos. Configuramos tus turnos con los cálculos correctos."),
    ("¿Teletrabajo: qué debo cumplir como empleador?",
     "Ley 21.220: provisión de equipos, compensación de gastos, derecho a desconexión y registro. "
     "Implementamos la documentación y cláusulas correctas para contratar remoto sin riesgo."),

    # ── Documentos y trámites ──
    ("¿Qué hago si me multan por cotizaciones impagas?",
     "Negociamos el plan de pago, regularizamos los períodos y evitamos sanciones mayores. "
     "Si la deuda es del trabajador autónomo o del empleador, cambia el tratamiento: lo revisamos."),
    ("¿Cómo obtengo certificado de cotizaciones o antigüedad?",
     "Los emitimos digitalmente con validez legal para créditos, arriendos y trámites de tus "
     "trabajadores, y los registros están siempre disponibles."),
    ("¿Qué pasa si la Inspección del Trabajo me fiscaliza?",
     "Te acompañamos: revisamos la documentación que te van a pedir, corregimos lo corregible "
     "antes y respondemos las observaciones con respaldo. La mejor fiscalización es la que no llega."),
    # ── Casos especiales ──
    ("¿Cómo contrato extranjeros correctamente?",
     "Con visa vigente (o en trámite con constancia), RUT, y las mismas cotizaciones que un chileno. "
     "Hay reglas especiales para refugiados y visados temporales. Te guiamos en cada caso."),
    ("¿Puedo contratar estudiantes o aprendices?",
     "Sí: hay regímenes especiales (aprendices, prácticas profesionales) con cotización reducida "
     "y beneficios. Configuramos el contrato correcto."),
    ("¿Qué pasa si mi trabajador tiene una licencia médica larga?",
     "El contrato se suspende (no se termina por ese motivo durante la licencia), el SUBDH paga "
     "el subsidio y tú controlas el descanso. Gestionamos el trámite y los pagos."),
    ("¿Embarazo: qué no puedo hacer como empleador?",
     "No puedes despedir por la causal de necesidades de la empresa sin autorización previa del "
     "juzgado (fuero maternal), y debes respetar descanso prenatal y postnatal. Te orientamos "
     "en cada caso para no incurrir en nulidad de despido."),
    ("¿Sindicalizados: qué cambia en la nómina?",
     "Cotizaciones sindicales autorizadas, negociación colectiva y descuentos por planilla. "
     "Coordinamos los descuentos y el respeto de los acuerdos en las liquidaciones."),
    ("¿Cómo termino un contrato sin juicios?",
     "Con la causal correcta, la documentación completa, el finiquito bien calculado y firmado, "
     "y la copia de actas al trabajador. Armamos el paquete completo para que el término no "
     "vuelva como demanda."),

    # ── Cierre general ──
    ("¿Cuánto cuesta el servicio de remuneraciones?",
     "Depende del número de trabajadores y la complejidad (turnos, comisiones, faenas). "
     "Plan fijo mensual cotizado en la consulta gratuita: sin cobros por ticket."),
    ("¿Qué pasa si ya llevo atraso en cotizaciones o libros?",
     "Regularizamos: libros atrasados, pagos con interés, multas y convenios. Hemos visto de todo: "
     "la mejor fecha para partir es hoy."),
    ("¿Puedo cambiar de proveedor de remuneraciones a mitad de año?",
     "Sí: transferimos la nómina, el libro y los registros sin perder historial. "
     "La transición se hace entre meses para no afectar el pago de sueldos."),
    ("¿Trabajan con faenas y contratos por obra?",
     "Sí: remuneraciones de faena, carpetas de ingreso, coordinación con mandantes y contratos "
     "por obra con las causales de término correctas."),
    ("¿Cómo empiezo?",
     "WhatsApp al +56 9 7575 2213 o el formulario de contacto. Revisamos tu nómina actual gratis "
     "y te decimos exactamente qué ajustar."),
]

if __name__ == "__main__":
    print(f"Remuneraciones: {len(FAQS)} preguntas")
