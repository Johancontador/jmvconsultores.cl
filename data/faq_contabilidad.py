#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
faq_data_contabilidad.py — 50 preguntas frecuentes de Contabilidad Completa.
Bloques: F29/IVA, Renta/F22, Régmenes, Registros, Pagos y multas, SII y representación.
La respuesta sobre F22 está verificada contra el art. 97 N°6 del Código Tributario.
"""

FAQS = [
    # ── F29 / IVA ──
    ("¿Qué pasa si no declaro mi F29 a tiempo?",
     "El F29 sin movimiento o con saldo a favor se puede presentar atrasado sin multa. "
     "Pero si tienes impuesto por pagar, se aplican multas e intereses del artículo 97 del Código Tributario. "
     "Te lo regularizamos y gestionamos la condonación parcial de multas si corresponde."),
    ("¿Cuándo se declara el IVA?",
     "El F29 se presenta mensualmente, a más tardar el día 20 del mes siguiente (12 si es febrero). "
     "Nosotros lo preparamos, te lo mostramos antes del envío y lo declaramos por ti."),
    ("¿Qué es el crédito fiscal y el débito fiscal?",
     "El débito es el IVA que cobras en tus ventas; el crédito, el IVA que pagaste en tus compras. "
     "La diferencia es lo que pagas o recuperas en el F29. Registrarlo bien es la clave para no pagar de más."),
    ("¿Puedo recuperar el IVA de mis gastos?",
     "Sí, si son gastos asociados a tu giro con factura. Algunos tienen restricciones (comida, auto semisuntuario). "
     "Te asesoramos sobre qué gastos sí generan crédito fiscal y cómo documentarlos."),
    ("¿Qué pasa si no tengo movimientos en el mes?",
     "Aun así debes presentar el F29 sin movimiento. Si no lo envías, te arriesgas a multas y a que el SII "
     "te marque como contribuyente irregular."),
    ("¿Qué es la prórroga del F29?",
     "Algunos rubros (agroindustria, exportadores) tienen fechas especiales de declaración. "
     "Si tu actividad está en ese caso, lo gestionamos para usar la fecha correcta."),

    # ── Renta / F22 ──
    ("¿Qué pasa si no declaro mi F22 a tiempo?",
     "Te expones a multas del artículo 97 N°6 del Código Tributario: 1 UTA (~$950.000) si no hay impuesto, "
     "o 10% del impuesto más 2% por mes de atraso (tope 30%) si hay impuesto por pagar, más intereses penales. "
     "Y el impuesto impago termina en cobranza judicial de Tesorería, que puede embargar bienes y cuentas. "
     "Si ya estás atrasado, rectificamos la declaración y negociamos multas e intereses: la key es partir antes de que el SII te tome la lista."),
    ("¿Cuándo es la Operación Renta?",
     "Entre abril y junio, según el rol que asigna el SII. La preparación ideal parte en diciembre: "
     "una buena planificación de fin de año ahorra impuestos reales en abril."),
    ("¿Qué es la Operación Renta con devolución?",
     "Si tus pagos provisionales (PPM) superaron tu impuesto anual, el SII te devuelve la diferencia. "
     "Muchos contribuyentes recuperan plata todos los años: hay que declararla correctamente y a tiempo."),
    ("¿Qué es el PPM y cómo se calcula?",
     "Es el pago provisional mensual: 1% de tus ingresos (con topes según régimen). "
     "Optimizamos el PPM para no sobre-pagar durante el año ni sorprenderte en abril."),
    ("¿Puedo rectificar una declaración ya enviada?",
     "Sí, mediante F22 rectificatoria (o F29 según el caso). Gestionamos la corrección, "
     "y en muchos casos las multas asociadas se condonan total o parcialmente."),

    # ── Régmenes ──
    ("¿Qué régimen tributario me conviene?",
     "Depende de tus ventas, utilidades y planes. Pro Pyme General (14 D) es el más común para pymes; "
     "el Semitransparente conviene a utilidades bajas. Lo comparamos con tus números reales antes de decidir."),
    ("¿Qué es el régimen Pro Pyme?",
     "Es la línea de regímenes simplificados (14 D N°3 y 14 N°3) para ventas bajo ~450 y 75 millones "
     "respectivamente. Menos obligaciones formales, depreciación instantánea y crédito por gastos sin docs."),
    ("¿Puedo cambiar de régimen tributario?",
     "Sí, normalmente una vez al año, en la declaración anual. Analizamos si el cambio te conviene "
     "y gestionamos todo el proceso en tu F22."),
    ("¿Qué pasa si mis ventas superan el tope de mi régimen?",
     "Debes migrar al régimen general al año siguiente. Lo planificamos con anticipación para que "
     "no sea un salto traumático: cambio de contabilidad, asignación de gastos y proyección de impuestos."),

    # ── Registros y documentos ──
    ("¿Qué libros contables debo llevar?",
     "Depende del régimen: al menos libro de compras y ventas, y contabilidad completa en el régimen general. "
     "Nosotros mantenemos todo digitalizado y al día."),
    ("¿Cuánto tiempo debo guardar mis documentos contables?",
     "Mínimo 6 años según el Código Tributario. Guardamos tus respaldos digitales con esa vigencia y más."),
    ("¿Qué documentos debo exigir a mis proveedores?",
     "Facturas (para crédito fiscal), guías de despacho y boletas si aplica. Sin documento correcto, "
     "el gasto puede ser rechazado por el SII y pierdes el beneficio."),
    ("¿Qué hago con las boletas de honorarios que emito?",
     "Se registran como ingreso y tributan según tu régimen. En la Operación Renta hay retenciones que "
     "se convierten en crédito. Conciliamos cada boleta para que tributes justo."),
    ("¿Debo emitir factura o boleta a mis clientes?",
     "Factura si tu cliente es empresa (necesita crédito fiscal); boleta si es consumidor final. "
     "También hay boleta de servicios para casos específicos. Te configuramos el criterio correcto "
     "en tu sistema de facturación para no emitir documentos errados."),
    ("¿Me puedo equivocar en un F29 y corregirlo?",
     "Sí, se corrige con F29 rectificativo. Si lo detectamos a tiempo, la corrección no tiene multa; "
     "por eso revisamos cada declaración antes de enviarla."),

    # ── Pagos y multas ──
    ("¿Cómo pago mis impuestos?",
     "Por Tesorería General (tesoreria.cl) con transferencia o en bancos convenios. "
     "Te avisamos cuándo, cuánto y cómo pagar cada obligación."),
    ("¿Qué pasa si no pago un impuesto a tiempo?",
     "Se generan intereses penales diarios y el impuesto puede pasar a cobranza judicial de Tesorería. "
     "Si ya te notificaron, negociamos el convenio de pago y evitamos el embargo."),
    ("¿Se pueden condonar las multas del SII?",
     "Sí, en varios casos: atraso por primera vez, dificultades económicas, o atrasos pequeños. "
     "Presentamos la solicitud de condonación con los fundamentos correctos."),
    ("¿Qué es el cobro ejecutivo de Tesorería?",
     "Es la cobranza judicial del impuesto impago: embargos de cuentas, bienes y hasta el giro del negocio. "
     "Si llegaste ahí, actuamos rápido: convenios de pago y suspensión del cobro mientras negocia."),
    ("¿Qué intereses cobra Tesorería?",
     "Interés penal diario (actualmente 1,5% mensual aproximado) más reajuste por IPC. "
     "Por eso conviene negociar rápido: cada mes suma."),

    # ── SII y representación ──
    ("¿Qué hago si el SII me manda una carta o requerimiento?",
     "No lo ignores: los plazos de respuesta son cortos. La revisamos, armamos el respaldo y la "
     "respondemos dentro del plazo. La mayoría de los requerimientos se resuelven sin fiscalización."),
    ("¿Me pueden fiscalizar si soy una pyme chica?",
     "Sí, el SII fiscaliza por cruces de datos (ventas vs. compras, transferencias, boletas de terceros). "
     "La mejor defensa es la orden: declaraciones correctas y respaldos guardados."),
    ("¿Qué es una situación tributaria irregular?",
     "Es cuando el SII detecta incoherencias en tu perfil (ventas fuera de tu giro, boletas sin respaldo). "
     "Te lo regularizamos: actualización de giros, rectificatorias y respaldo documental."),
    ("¿Me representan ante el SII en una fiscalización?",
     "Sí: preparamos la documentación, te acompañamos en las entrevistas y defendemos tu caso. "
     "Estar bien representado cambia radicalmente el resultado de una fiscalización."),
    ("¿Qué hago si el SII me marca como no declarante?",
     "Regularizamos de inmediato: declaramos los períodos atrasados y solicitamos la condonación de multas "
     "asociadas. Mientras antes, mejores condiciones."),

    # ── Cierres y estados financieros ──
    ("¿Para qué sirven los estados financieros?",
     "Para el banco, para tus socios, para postular a licitaciones y para decidir con datos. "
     "Los preparamos mensuales y anuales, listos para cualquier tercero."),
    ("¿Qué es el cierre contable de diciembre?",
     "Es la revisión completa del año: devengados, depreciaciones, provisiones y conciliaciones. "
     "Un cierre bien hecho ahorra impuestos en abril y evita rectificatorias."),
    ("¿Necesito balance si soy persona natural con negocio?",
     "Depende del régimen: en 14 D sí (contabilidad completa). En Pro Pyme simplificado no es obligatorio, "
     "pero te lo recomendamos para créditos y decisiones."),
    ("¿Puedo pagar menos impuestos invirtiendo en la empresa?",
     "Sí: en Pro Pyme los activos se pueden depreciar instantáneamente (deducción total en el año). "
     "Compraste equipos? Lo analizamos para maximizar el beneficio."),

    # ── Cuentas y caja ──
    ("¿Cómo controlo si me están pagando o cobrando de más?",
     "Con conciliaciones bancarias mensuales: cada movimiento contra libros. Detectamos cobros dobles, "
     "pagos olvidados y errores bancarios cada mes."),
    ("¿Qué hago con los clientes que no pagan?",
     "Te ayudamos con la gestión: carta de cobro, registro de deudores y evaluación de castigo de deudas. "
     "La clave es actuar en los primeros 30 días."),
    ("¿Cómo proyectó mi caja para los próximos meses?",
     "Con un flujo de caja proyectado: cobros esperados, pagos fijos, impuestos y remuneraciones. "
     "Te entregamos la proyección mensual para que no te tomen por sorpresa."),
    ("¿Qué son los gastos rechazados y cómo los evito?",
     "Son gastos que el SII no acepta (sin respaldo, o ajenos al giro). Cuesta 35,5% del monto en impuestos. "
     "Te enseñamos qué gastos son seguros y cómo respaldarlos correctamente."),

    # ── Específicos de rubros ──
    ("¿Tienen experiencia con mi rubro?",
     "Trabajamos con comercio, servicios, restaurantes, construcción, salud, educación, e-commerce y más. "
     "Cada rubro tiene sus particularidades: las conocemos y las aplicamos."),
    ("¿Qué le cambio de tributación si vendo por internet?",
     "Nada en la tasa, pero hay obligaciones específicas: registro de ventas por pasarela, IVA correcto por "
     "despacho, y conciliación con Mercado Libre/Shopify. Lo implementamos completo."),
    ("¿Cómo se declara si trabajo con Uber, Cabify o delivery?",
     "La ley 21.420 obliga a las plataformas a reportar tus ingresos al SII. Hay que declarar esos ingresos "
     "correctamente: te ayudamos a regularizar si llevas años sin hacerlo."),
    ("¿Y si vendo en Mercado Libre o Amazon?",
     "Esas ventas son ingresos gravados como cualquier otro. La clave es conciliar los liquidations de la "
     "plataforma con tus ventas reales y tus impuestos. Lo hacemos por ti."),
    ("¿Cómo tributan los arriendos que recibo?",
     "Depende del régimen: los arriendos son rentas de capital (14 N°1 o 14 N°4). Analizamos tu caso "
     "y te decimos si te conviene el régimen de arriendo o incorporarlo a tu negocio."),

    # ── Cierre general ──
    ("¿Puedo cambiarme a JMV si ya tengo contador?",
     "Sí. Gestionamos la transferencia completa de tu información de forma segura, hablamos con tu contador "
     "anterior si hace falta, y partimos limpio sin perder historial."),
    ("¿Qué pasa si llevo varios años sin declarar?",
     "Regularizamos todo: declaraciones atrasadas, multas, convenios si hay deudas. Hemos visto de todo: "
     "la peor decisión es no hacer nada. La mejor es partir ya."),
    ("¿Cuánto cuesta la contabilidad mensual?",
     "Depende del volumen de documentos y trabajadores. Te cotizamos un plan fijo mensual en la consulta "
     "gratuita: sin cobros por hora ni sorpresas."),
    ("¿Qué pasa si quiero terminar el servicio?",
     "Entregamos toda tu información completa y ordenada, y te apoyamos en la transición. "
     "Sin atados: el compromiso de confidencialidad continúa después de terminar."),
    ("¿Trabajan solo en Santiago?",
     "No: atención 100% en línea para todo Chile. La contabilidad moderna no requiere estar en la misma ciudad."),
    ("¿Cómo empiezo?",
     "WhatsApp al +56 9 7575 2213 o el formulario de contacto. Respondemos en menos de 24 horas hábiles "
     "y la primera consulta es gratis."),
]

if __name__ == "__main__":
    print(f"Contabilidad: {len(FAQS)} preguntas")
