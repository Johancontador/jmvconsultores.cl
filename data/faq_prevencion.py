#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
faq_data_prevencion.py — 50 preguntas frecuentes de Prevención de Riesgos.
Bloques: Obligaciones legales, Documentación base, Ley Karin y mutualidad,
Contratistas, Emergencias, Capacitación, Alto riesgo, Gestión.
"""

FAQS = [
    # ── Obligaciones legales ──
    ("¿Toda empresa necesita experto en prevención de riesgos?",
     "Toda empresa con trabajadores debe cumplir la ley 16.744 (cotización, inducciones, EPP, "
     "documentación básica). Experto obligatorio a partir de 25 trabajadores (o 100 según el "
     "reglamento interno). Nosotros te cubrimos según tu tamaño real."),
    ("¿Qué es la ley 16.744?",
     "Es la ley de accidentes del trabajo y enfermedades profesionales: financia la prevención "
     "con tu cotización a la mutualidad y define tus obligaciones preventivas como empleador."),
    ("¿Qué es el D.S. 44 y desde cuándo rige?",
     "Es el reglamento que moderniza la gestión preventiva (reemplaza el D.S. 40): exige evaluar "
     "y actualizar riesgos por puesto, mantener documentación vigente y evidencia verificable. "
     "Revisamos tu cumplimiento completo y te dejamos plan de regularización."),
    ("¿Qué me pasa si no cumplo la normativa preventiva?",
     "Multas de la Dirección del Trabajo, responsabilidad civil si hay accidente, sobrecotización "
     "de la mutualidad y exclusión de licitaciones. Y lo más grave: un trabajador lesionado que "
     "se podía prevenir."),
    ("¿Me fiscalizan aunque tenga 3 trabajadores?",
     "Sí: la DT fiscaliza por denuncias, accidentes y rubros de riesgo. El tamaño chico no exime: "
     "RIOHS, inducción y EPP se exigen igual."),

    # ── Documentación base ──
    ("¿Qué es el RIOHS y cuándo lo necesito?",
     "Reglamento Interno de Orden, Higiene y Seguridad: obligatorio desde 1 trabajador, aprobado "
     "por la DT, con sanciones y obligaciones de seguridad. Lo redactamos, actualizamos y tramitamos."),
    ("¿Qué es el MIPER?",
     "Matriz de Identificación de Peligros y Evaluación de Riesgos: la base de todo tu sistema "
     "preventivo. Se levanta en terreno, puesto por puesto. Sin MIPER real, todo lo demás es papel."),
    ("¿Qué son los programas preventivos?",
     "El plan de trabajo derivado de tu evaluación de riesgos: qué se va a corregir, quién, "
     "cuándo y con qué recursos. Exigidos por D.S. 44 y por las mutualidades."),
    ("¿Cada cuánto se actualiza la documentación preventiva?",
     "Con cada cambio de proceso, equipos o personal, y al menos anualmente (D.S. 44 lo exige "
     "explícitamente). Mantenemos tu documentación viva, no archivada."),

    # ── Ley Karin ──
    ("¿Qué es la Ley Karin?",
     "Ley 21.643, vigente desde agosto 2024: prevención, investigación y sanción del acoso "
     "laboral, sexual y la violencia en el trabajo. Es la 'tolerancia cero': cambió el estándar "
     "para todos los empleadores."),
    ("¿La Ley Karin me aplica si tengo 2 trabajadores?",
     "Sí: es obligatoria para todos los empleadores, sin mínimo. El protocolo debe estar "
     "incorporado al reglamento interno y difundido. Lo implementamos completo."),
    ("¿Qué debe incluir el protocolo de Ley Karin?",
     "Medidas de prevención, procedimiento de denuncia, plazos de investigación, medidas de "
     "protección y sanciones. Hay requisitos mínimos legales: el protocolo mal hecho no te protege."),
    ("¿Qué pasa si un trabajador denuncia acoso y no hago nada?",
     "Responsabilidad del empleador, multas de la DT, posible tutela con indemnizaciones "
     "agravadas y daño reputacional. La investigación correcta y oportuna es tu mejor defensa."),

    # ── Mutualidad y SUSESO ──
    ("¿Qué es la cotización adicional de la mutualidad?",
     "Es el recargo (0% a 6,8%) que la mutualidad aplica según tu siniestralidad. Se puede "
     "rebajar con gestión preventiva documentada: trabajamos para bajarla año a año."),
    ("¿Qué son la DIAT y la DDSS?",
     "Denuncia Individual de Accidente de Trabajo y Declaración de Siniestro Sonoro/Sistémica: "
     "reportes obligatorios a SUSESO con plazos cortos. Los gestionamos para que nunca se pasen."),
    ("¿Debo investigar todos los accidentes?",
     "Todos los accidentes con tiempo perdido y los incidentes relevantes: con causa raíz, "
     "medidas correctivas y seguimiento de cierre. La DT y la mutualidad lo exigen."),
    ("ACHS, ISL o IST: ¿cuál me conviene?",
     "La ISL es pública; ACHS e IST son privadas con tasas y programas distintos. Comparamos "
     "tasas, servicio y cobertura para tu rubro antes de elegir."),
    ("¿Qué me exige la mutualidad todos los años?",
     "Programa anual de actividades, adición de trabajadores, estadísticas y cumplimiento "
     "de la pauta. Coordinamos todo el ciclo con tu mutualidad."),

    # ── Salud ocupacional ──
    ("¿Qué exámenes ocupacionales deba hacer a mis trabajadores?",
     "Ingreso, periódicos y de retiro, según los riesgos de cada puesto (ruido, químicos, "
     "alturas, pantallas). Coordinamos y controlamos documentalmente todo el ciclo."),
    ("¿Mi empresa debe medir ruido?",
     "Si hay exposición probable sobre 85 dB(A), sí: vigilancia obligatoria con medición por "
     "puesto y control documental. Coordinamos las mediciones con servicios certificados."),
    ("¿Qué es la ley de sobrecarga física (20.949)?",
     "Obliga a evaluar y controlar la manipulación manual de cargas y posturas forzadas. "
     "Aplica a bodegas, reparto, producción. Evaluamos tus puestos y documentamos los controles."),
    ("¿Qué exige el D.S. 594?",
     "Condiciones sanitarias mínimas: ventilación, iluminación, baños, comedores, agua potable. "
     "Es el reglamento más fiscalizado en terreno. Revisamos tus instalaciones contra su checklist."),

    # ── Contratistas y faenas ──
    ("¿Qué es el D.S. 76?",
     "Reglamento de subcontratación: si tienes contratistas en tu obra o instalación, debes "
     "coordinar y exigir su documentación de seguridad. Como mandante, respondes si no exiges."),
    ("¿Qué es la homologación de contratistas?",
     "El proceso por el que grandes empresas validan tu documentación de seguridad para poder "
     "trabajar para ellas. La mantenemos al día en SIRC, SISTECRED y Homologa."),
    ("¿Qué lleva una carpeta de prevención para licitaciones?",
     "RIOHS, MIPER, PTS, programa anual, capacitaciones, EPP, estadísticas y mutualidad al día. "
     "Una carpeta incompleta te deja fuera antes de mostrar tu precio."),
    ("¿Cómo exijo seguridad a mis subcontratistas sin ser experto?",
     "Con el paquete documental mínimo exigible por D.S. 76 y un checklist de entrada. "
     "Te armamos el sistema: qué pedir, cómo archivarlo y cuándo bloquear el ingreso."),

    # ── Emergencias ──
    ("¿Necesito plan de emergencia en una oficina chica?",
     "Sí, en versión proporcional: vías de evacuación, roles, reunión de interoperabilidad y "
     "simulacro anual. Lo esencial cabe en pocas páginas pero salva vidas y cumple la normativa."),
    ("¿Cada cuánto se hace un simulacro?",
     "Al menos uno anual (recomendable dos: incendio y sismo), con registro documentado y "
     "mejoras aplicadas. Lo coordinamos completo."),
    ("¿Quién controla los extintores?",
     "Empresa certificada: inspección y recarga con periodicidad normativa. Nosotros gestionamos "
     "los registros para que nunca encuentren uno vencido."),
    ("¿Qué señalización de seguridad necesito?",
     "Vías de evacuación, equipos de emergencia y riesgos puntuales según normativa. "
     "Levantamos tu instalación y te entregamos el plan de señalización."),

    # ── Capacitación y terreno ──
    ("¿Cada cuánto debo inducir y capacitar?",
     "Inducción obligatoria al ingreso y ante cambios de puesto. Capacitación periódica según "
     "tu matriz de riesgos y exigencias de la mutualidad. Todo con registro firmado."),
    ("¿Sirven las charlas de 5 minutos?",
     "Sí y mucho: son la herramienta preventiva de mayor frecuencia y menor costo. "
     "Te entregamos el calendario temático según tus riesgos reales."),
    ("¿Qué es una inspección planeada?",
     "Recorrido periódico con checklist para detectar condiciones inseguras antes del accidente. "
     "Te dejamos los checklists y el flujo de cierre de hallazgos."),
    ("¿Qué son las observaciones de seguridad?",
     "Registro de conductas y condiciones observadas en terreno, para corregir y retroalimentar. "
     "Es la práctica que más baja la siniestralidad cuando se usa con constancia."),
    ("¿Por qué contratar visita técnica si tengo la documentación?",
     "Porque el papel no levanta riesgos: la visita en terreno valida tu MIPER, detecta lo que "
     "el escritorio no ve y da coherencia real a todo tu sistema."),

    # ── Alto riesgo ──
    ("¿Qué es un permiso de trabajo de alto riesgo?",
     "Autorización formal para trabajos críticos: altura, caliente, eléctrico, espacios confinados, "
     "excavaciones. Con requisitos, controles y firma de responsables. Te entregamos los formatos."),
    ("¿Qué es el bloqueo y etiquetado (LOTO)?",
     "Control de energías peligrosas en mantención: bloqueo físico de fuentes y etiqueta de "
     "identificación. Obligatorio para evitar arranques accidentales. Implementamos el procedimiento."),
    ("¿Trabajo en altura: desde cuánto aplica?",
     "Sobre 1,8 metros aplica normativa y requisitos (arnés, línea de vida, permiso). "
     "El procedimiento correcto y la capacitación son exigibles desde la primera altura."),
    ("¿Cómo manejo químicos en mi empresa?",
     "Hojas de seguridad (HDS) de cada producto, rotulado correcto, almacenamiento segregado "
     "y capacitación. Te ordenamos el inventario químico completo."),
    ("¿Qué resguardos deben tener mis máquinas?",
     "Resguardos físicos de puntos de operación, paradas de emergencia funcionales y mantención "
     "registrada. El D.S. 594 y la normativa de máquinas lo exigen con detalle."),

    # ── Gestión e indicadores ──
    ("¿Qué indicadores de prevención debería mirar?",
     "Tasa de frecuencia y gravedad, hallazgos abiertos, cumplimiento de capacitación y "
     "observaciones por mes. Te armamos el tablero de una página."),
    ("¿Para qué me sirven las estadísticas si nunca tengo accidentes?",
     "Para licitaciones, para la mutualidad (cotización adicional) y para ver la deriva antes "
     "del accidente. Las estadísticas también se presentan cuando fiscalizan."),
    ("¿Cómo bajo mi cotización adicional de la mutualidad?",
     "Con gestión documentada: menos siniestros, investigación de calidad y programa cumplido. "
     "La rebaja se solicita con evidencia: te llevamos el proceso anual."),
    ("¿Qué es una auditoría de prevención?",
     "Revisión completa de tu sistema contra la normativa: brechas, prioridades y plan de "
     "regularización con plazos. La hacemos con informe ejecutivo claro."),
    ("¿Me sirve para certificarme en ISO 45001?",
     "Es la base documental sobre la que se construye la certificación. Si luego quieres "
     "certificar, el camino ya está andado."),

    # ── Cierre general ──
    ("¿Cuánto cuesta implementar todo esto en una pyme?",
     "Mucho menos que un accidente: multa, detención de faena, sobrecotización o demanda. "
     "Te cotizamos el plan según tu tamaño en la consulta gratuita."),
    ("¿Puedo tercerizar solo la documentación y yo hago el terreno?",
     "Sí, o al revés: el modelo se adapta a tu equipo. Lo importante es que el sistema sea "
     "coherente, no quién ejecute cada pieza."),
    ("¿Atienden faenas o solo oficinas y plantas?",
     "Ambos: construimos el sistema según tu operación real, desde oficina hasta faena en terreno."),
    ("¿Qué necesito para partir con la revisión?",
     "Tu documentación preventiva actual (si existe) y una visita breve a tu operación. "
     "Con eso te entregamos el diagnóstico de brechas."),
    ("¿Cómo empiezo?",
     "WhatsApp al +56 9 7575 2213 o el formulario de contacto. Diagnosticamos tu cumplimiento "
     "preventivo actual gratis y te decimos qué corregir primero."),
]

if __name__ == "__main__":
    print(f"Prevención: {len(FAQS)} preguntas")
