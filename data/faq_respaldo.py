#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
faq_data_respaldo.py — 50 preguntas frecuentes de Respaldo y Confidencialidad.
Bloques: Protección de datos, Accesos, Respaldo técnico, Cambio de contador,
Fraudes y suplantación, Cumplimiento legal, Continuidad del negocio.
"""

FAQS = [
    # ── Protección de datos ──
    ("¿Quién puede ver la información de mi empresa?",
     "Solo tu contador asignado. Los accesos son por rol, con doble factor de autenticación "
     "y registro de auditoría: queda trazado quién vio o modificó qué, y cuándo."),
    ("¿Firman acuerdo de confidencialidad?",
     "Sí, antes de partir y por escrito. Además, el compromiso continúa indefinidamente "
     "aunque terminemos la relación comercial."),
    ("¿Mi información queda en la nube de ustedes?",
     "En plataformas cloud con cifrado en tránsito y en reposo, estándares de seguridad "
     "bancarios y respaldos en ubicaciones separadas. Nunca en correos personales ni discos sueltos."),
    ("¿Qué pasa con mis datos si ustedes tienen un problema informático?",
     "Hay plan de continuidad: respaldos verificados, restauración probada y operación "
     "alternativa. Tu información no depende de un solo equipo ni de una sola persona."),
    ("¿Cumplen la ley chilena de protección de datos?",
     "Sí: ley 19.628 vigente, y preparados para la 21.719 (nueva Agencia de Protección de "
     "Datos). Tratamos tu información contable como lo que es: dato sensible."),
    ("¿Pueden filtrar mi información a mi competencia o al fisco sin aviso?",
     "No. No compartimos con nadie sin tu autorización escrita, salvo obligación legal "
     "requerida por autoridad competente — y en ese caso te avisamos de inmediato."),

    # ── Accesos y claves ──
    ("¿Ustedes piden mis claves del SII?",
     "Trabajamos con delegación de permisos o clave de terceros según el caso, siempre "
     "cifradas y gestionadas con protocolo. Nunca por WhatsApp ni correo sin cifrar."),
    ("¿Qué pasa si un empleado nuestro se va de la empresa?",
     "Revocación inmediata de accesos y conocimiento documentado: tu información nunca "
     "depende de la memoria de una persona."),
    ("¿Puedo limitar qué información ve cada persona de su equipo?",
     "Sí: definimos accesos por rol y por documento. Si solo quieres que se vea la "
     "contabilidad y no tu nómina, se configura así."),
    ("¿Cómo sé que nadie revisó algo que no debía?",
     "Registro de auditoría de accesos: puedes solicitar el historial completo de "
     "visualizaciones y modificaciones cuando quieras."),
    ("¿Ustedes usan mi RUT para otras cosas?",
     "No. Tu RUT se usa solo para tus obligaciones. Vigilamos además que nadie más lo use: "
     "si aparece actividad anómala, te alertamos de inmediato."),

    # ── Respaldo técnico ──
    ("¿Cada cuánto se respalda mi información?",
     "Diario automático, con copias en ubicaciones separadas. Y no basta respaldar: "
     "hacemos pruebas de restauración periódicas para verificar que se pueda recuperar."),
    ("¿Puedo recuperar un documento de hace 2 años?",
     "Sí: historial de versiones y custodia documental de al menos 6 años (lo que exige "
     "el Código Tributario). Todo organizado y buscable."),
    ("¿Qué pasa con mis papeles físicos?",
     "Los digitalizamos con OCR (buscables por texto), guardamos los originales o te los "
     "devolvemos según acuerdes, y todo queda respaldado digitalmente."),
    ("¿Si me roban el computador, pierdo mi contabilidad?",
     "No: tu información no vive en tu computador. Está en la nube con respaldos diarios. "
     "Tu acceso se restaura en otro equipo en minutos."),
    ("¿Tienen certificación de seguridad?",
     "Trabajamos con plataformas de estándar bancario y buenas prácticas documentadas. "
     "Te mostramos exactamente dónde y cómo se guarda tu información."),

    # ── Cambio de contador y continuidad ──
    ("¿Qué pasa con mi información si quiero cambiar de contador?",
     "Protocolo de transferencia segura: entrega completa y ordenada, verificación de "
     "integridad y confidencialidad que continúa. Nada se pierde ni se filtra."),
    ("¿Y si mi contador asignado se enferma o renuncia?",
     "El conocimiento de tu cuenta está documentado, no en su cabeza. Otra persona del "
     "equipo continúa sin que notes el cambio."),
    ("¿Qué pasa si ustedes cierran el negocio?",
     "Contrato con cláusula de entrega: tu información se te entrega completa y en "
     "formato estándar, siempre. Es tu propiedad, no la nuestra."),
    ("¿Puedo pedir mi información cuando quiera?",
     "Sí, en cualquier momento y en formatos estándar (Excel, PDF, XML). Es tuya."),
    ("¿Cuánto demoran en entregarme todo si termino el servicio?",
     "Días, no semanas: el archivo está organizado permanentemente, no se arma al despedir."),

    # ── Fraudes y suplantación ──
    ("¿Cómo sé si un correo del SII es falso?",
     "Los correos del SII no piden claves ni datos por enlace. Ante la duda, no hagas clic: "
     "consultanos y verificamos. Te entrenamos a ti y a tu equipo en esto."),
    ("¿Qué es el phishing tributario?",
     "Webs y correos falsos que imitan al SII para robar tu clave única. Con tu clave "
     "roban devoluciones, emiten boletas falsas y endeudan tu RUT. Te protegemos y te entrenamos."),
    ("¿Puede alguien emitir boletas con mi RUT?",
     "Es una de las fraudes más comunes. Monitoreamos la actividad de tu RUT y te alertamos "
     "de movimientos anómalos para denunciar y bloquear rápido."),
    ("¿Qué hago si me suplantaron la identidad tributaria?",
     "Denuncia inmediata al SII y a la PDI, rectificación de declaraciones falsas y "
     "protección de tu perfil. Lo hemos hecho: la clave es actuar en las primeras horas."),
    ("¿Mis trabajadores pueden usar el nombre de la empresa para fraudar?",
     "Con controles internos: autorizaciones dobles, límites de gasto y revisión de "
     "documentos emitidos. Te dejamos el sistema de control mínimo viable."),
    ("¿El fraude con facturas me afecta aunque no participe?",
     "Comprar a factureras falsas te deja sin crédito fiscal y con riesgo de fiscalización "
     "(gasto rechazado o delito según el caso). Auditamos tus proveedores críticos."),

    # ── Cumplimiento y custodia legal ──
    ("¿Cuántos años debo guardar facturas y libros?",
     "Mínimo 6 años desde el término de las operaciones según el Código Tributario. "
     "Nosotros custodiamos todo ese período y más."),
    ("¿Qué pasa si el SII me pide documentos de hace 4 años?",
     "Se los entregamos completos y ordenados en horas: custodia documental digital con "
     "historial completo. La fiscalización sin respaldo es la que asusta; con respaldo, es trámite."),
    ("¿Puedo destruir documentos viejos?",
     "Solo pasados los plazos legales y con procedimiento certificado. Destruir antes "
     "es infracción; guardar para siempre es riesgo innecesario. Te decimos qué y cuándo."),
    ("¿Sirve un respaldo si no puedo probar cuándo se hizo?",
     "No: por eso hay trazabilidad de fecha y hora en cada respaldo y restauración. "
     "El respaldo sin evidencia no vale nada ante una auditoría."),
    ("¿Notarizan documentos si hace falta?",
     "Sí: documentos críticos (actas, escrituras, respaldos anuales) pueden notarizarse "
     "o sellarse con sello de tiempo cuando el caso lo amerita."),

    # ── Comunicaciones ──
    ("¿Cómo me envían documentos sensibles?",
     "Por canales cifrados o enlaces con expiración, nunca adjuntos sueltos por correo "
     "abierto con datos críticos."),
    ("¿Puedo hablar de mi negocio por WhatsApp con ustedes?",
     "Sí para coordinación y consultas; para documentos críticos usamos los canales cifrados. "
     "Y la confidencialidad cubre todas las conversaciones."),
    ("¿Qué pasa si alguien se hace pasar por ustedes para pedirme datos?",
     "Protocolo de verificación de identidad en cada solicitud sensible: confirmamos por "
     "canal alterno antes de mover nada. Si recibes una solicitud rara que dice ser nuestra, "
     "verifícala llamándonos."),
    ("¿Cómo protegen mi correo corporativo?",
     "Asesoramos la configuración SPF, DKIM y DMARC para que nadie envíe correos "
     "fingiendo ser tu empresa. Protege tu marca y a tus clientes."),

    # ── Continuidad del negocio ──
    ("¿Qué pasa si hay un incendio o robo en mi oficina?",
     "Tu información contable sigue intacta en la nube. Operas desde cualquier equipo "
     "al día siguiente. Probamos la restauración exactamente para esto."),
    ("¿Tienen plan de recuperación ante desastres?",
     "Sí: objetivos de recuperación definidos, respaldos verificados y procedimientos "
     "escritos. Te mostramos cuánto demoraría tu operación en retomar."),
    ("¿Y si se cae internet o la energía en mi empresa?",
     "Tu contabilidad sigue corriendo de nuestro lado; al reconectarte, todo está al día. "
     "Te ayudamos además con planes de contingencia básicos para tu operación."),
    ("¿Pueden operar si algo pasa con una plataforma (SII, banco)?",
     "Sí: hay rutas alternativas de declaración y consulta, y calendarios que no dependen "
     "del último día. La prudencia de fechas es parte del servicio."),

    # ── Confidencialidad comercial ──
    ("¿Pueden contarles a otros clientes con qué trabaja mi empresa?",
     "No. La información comercial (márgenes, clientes, precios) es confidencial igual "
     "que la tributaria. Nunca usamos tu caso para marketing sin tu autorización escrita."),
    ("¿Trabajan con mi competencia directa?",
     "Si llegara a ocurrir, está garantizado por contrato que no hay cruce de información "
     "ni ventaja para nadie. Si prefieres exclusividad en tu zona o rubro, se pacta."),
    ("¿Firman NDA con terceros que subcontratan?",
     "Sí: toda la cadena de servicio está comprometida por escrito, con las mismas "
     "obligaciones que firmamos contigo."),

    # ── Cierre general ──
    ("¿Cuánto cuesta este servicio?",
     "Se integra al plan mensual según el tamaño y complejidad. En la consulta gratuita "
     "te cotizamos el plan completo con respaldo y confidencialidad incluidos."),
    ("¿Es exagerado preocuparme de esto siendo una pyme?",
     "Las pymes son el blanco favorito del fraude tributario y de los ransomwares justamente "
     "porque creen que no les va a pasar. La protección cuesta mucho menos que la recuperación."),
    ("¿Qué necesito para partir con este nivel de seguridad?",
     "Una reunión para mapear tu información y accesos. Después nosotros implementamos "
     "y te entregamos tu protocolo documentado."),
    ("¿Qué hago con las claves cuando un trabajador se va de mi empresa?",
     "Revocación inmediata: clave SII de tu representante, accesos al banco, sistemas de ventas y "
     "correo. La mayoría de los fraudes internos ocurre en los primeros días tras una salida mal gestionada."),
    ("¿Mi información está segura si trabajo desde el celular?",
     "Con condiciones: bloqueo por huella, actualizaciones al día y sin claves guardadas en notas. "
     "Te entregamos las reglas mínimas de seguridad móvil para tu equipo."),
    ("¿Qué pasa si un cliente mío sufre un filtro de datos y aparecen mis documentos?",
     "Nuestro deber es que los documentos circulen cifrados y con acceso limitado, pero si un "
     "tercero se ve comprometido, te acompañamos en la respuesta: notificación, cambio de accesos "
     "y evaluación del impacto. La documentación ordenada es tu mejor defensa."),
    ("¿Cómo empiezo?",
     "WhatsApp al +56 9 7575 2213 o el formulario de contacto. Revisamos gratis dónde "
     "está expuesta tu información hoy."),
]

if __name__ == "__main__":
    print(f"Respaldo: {len(FAQS)} preguntas")
