#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_servicios.py — Genera las 6 páginas de detalle de servicio.
Cada página: mensaje persuasivo del brand + 50 servicios numerados
ordenados por las búsquedas más recurrentes en Google (Chile).
"""
import html as H
import json
import os
import sys
from urllib.parse import quote as UQ

# FAQ por servicio (50 preguntas cada una, en data/)
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
import faq_contabilidad, faq_remuneraciones, faq_acompanamiento
import faq_tributaria, faq_pymes, faq_respaldo, faq_prevencion

FAQ_DATA = {
    "contabilidad-completa": faq_contabilidad.FAQS,
    "remuneraciones": faq_remuneraciones.FAQS,
    "acompanamiento-contable": faq_acompanamiento.FAQS,
    "asesoria-tributaria": faq_tributaria.FAQS,
    "emprendedores-pymes": faq_pymes.FAQS,
    "respaldo-confidencialidad": faq_respaldo.FAQS,
    "prevencion-riesgos": faq_prevencion.FAQS,
}

WA = "56975752213"
WA_URL = f"https://wa.me/{WA}"
WA_MSG_CONSULTA = UQ("Hola, tengo una consulta")

# ── 01 · CONTABILIDAD COMPLETA (ordenado por volumen de búsqueda en Google CL) ──
CONTABILIDAD = [
    ("Declaración mensual de IVA (F29)", "Preparamos y enviamos tu F29 a tiempo, aprovechando el uso de crédito fiscal."),
    ("Declaración anual de impuestos (F22)", "Operación Renta completa: te devolvemos lo que el SII te debe."),
    ("Balances y estados financieros", "Balances claros para bancos, inversionistas y decisiones internas."),
    ("Registro de compras y ventas", "Libros de compra y venta al día, conciliados con tus movimientos reales."),
    ("Libro de compras y ventas electrónico", "Envíos al SII sin atrasos ni multas."),
    ("Conciliaciones bancarias", "Cada peso conciliado entre cartola, libros y caja."),
    ("Boletas de honorarios electrónicas", "Emisión, registro y declaración de tus honorarios boleta por boleta."),
    ("Facturación electrónica (DTE)", "Configuramos y controlamos toda tu facturación en el SII."),
    ("Devolución de crédito fiscal IVA", "Recupera tu IVA de activos, exportaciones o crédito acumulado."),
    ("Determinación de utilidades tributarias", "Renta líquida imponible bien calculada, sin pagar de más."),
    ("Contabilidad de personas naturales", "Boleteros, profesionales y dueños de negocios independientes."),
    ("Contabilidad de empresas individuales", "Tu negocio como persona natural con actividad empresarial, ordenado."),
    ("Contabilidad de SpA y Ltda.", "Sociedades mercantiles con estados financieros y actas al día."),
    ("Remuneraciones y contabilidad integradas", "Sueldos, imposiciones y contabilidad en un solo equipo."),
    ("Propinas electrónicas (ley 21.269)", "Implementación y envío mensual sin sanciones."),
    ("Régimen Pro Pyme (14 N°3)", "Transparencia y contabilidad simplificada para pymes."),
    ("Régimen Semitransparente (14 N°8)", "Contabilidad completa exigida por este régimen, sin dolores."),
    ("Régimen Pro Pyme General (14 D N°3)", "Asignación de gastos, corrección monetaria y activos fijos."),
    ("Depreciaciones y activos fijos", "Vehículos, maquinaria e inmuebles depreciados correctamente."),
    ("Provisiones y ajustes contables", "Devengados, castigos y ajustes al cierre de cada mes."),
    ("Cierre contable anual", "Cierre ordenado de diciembre con todo listo para la Renta."),
    ("Conciliación de impuestos (provisionales)", "Tus pagos provisionales (PPM, retenciones) siempre trazables."),
    ("Pago Provisional Mensual (PPM)", "Cálculo optimizado para no sobre-pagar ni quedar corto."),
    ("Tasas de impuestos y timbraje", "Aplicación correcta de cada tasa según tu giro."),
    ("Situación tributaria SII", "Revisión y corrección de tu situación tributaria en el SII."),
    ("Inscripción y actualización de giros", "Inicio, modificación y término de giros ante el SII."),
    ("Contabilidad de constitución de empresas", "Soporte contable completo al formar tu sociedad."),
    ("Estados financieros para leasing y créditos", "Documentación sólida para tus gestiones bancarias."),
    ("Auditoría interna básica", "Revisión de cuentas para detectar errores a tiempo."),
    ("Control interno de caja chica", "Fondos fijos administrados con comprobantes y rendiciones."),
    ("Cuentas por cobrar y pagar", "Seguimiento de deudores y proveedores para cuidar tu caja."),
    ("Informe mensual de gestión", "Un reporte claro de cómo va tu negocio cada mes."),
    ("Análisis de márgenes y costos", "Cuánto ganas realmente en cada venta o proyecto."),
    ("Presupuestos y proyecciones", "Planifica el próximo trimestre con números reales."),
    ("Punto de equilibrio financiero", "Cuánto debes vender para cubrir todos tus costos."),
    ("Flujo de caja proyectado", "Anticipa faltantes de caja antes de que ocurran."),
    ("Ley de Software (crédito 17.452)", "Recupera parte del gasto en software como crédito fiscal."),
    ("Crédito por capacitación (SENCE)", "Recupera hasta 1 UTM por gasto en capacitación."),
    ("Crédito por Gastos en I+D", "Beneficios tributarios por innovación en tu empresa."),
    ("Contabilidad para exportadores", "Ventas al exterior, IVA exportación y devoluciones."),
    ("Contabilidad para importadores", "Nacionalizaciones, IVA importación y costos en bodega."),
    ("Contabilidad e-commerce", "Tiendas online, pasarelas de pago y conciliación de ventas."),
    ("Contabilidad para restaurantes", "Boletas, propinas y costos de materias primas controlados."),
    ("Contabilidad para constructoras", "Costos por proyecto, márgenes y contabilidad por obra."),
    ("Contabilidad para agencias", "Honorarios, rembolso de gastos y comisiones ordenados."),
    ("Traspaso de contador anterior", "Recuperamos tu información y partimos limpio, sin baches."),
    ("Regularización de contabilidad atrasada", "Nos ponemos al día con meses o años pendientes."),
    ("Respuestas a cartas del SII", "Contestamos observaciones y requerimientos del SII."),
    ("Certificados y informes para terceros", "Documentación contable formal ante bancos o auditores."),
    ("Conciliaciones con plataformas digitales", "Mercado Libre, Uber, Airbnb y demás reportes conciliados."),
]

# ── 02 · REMUNERACIONES ──
REMUNERACIONES = [
    ("Liquidaciones de sueldo electrónicas", "Claras, legalmente correctas y enviadas a cada trabajador."),
    ("Libro de remuneraciones electrónico", "Envío al SII de tu libro de remuneraciones cada mes."),
    ("Cálculo de imposiciones previsionales", "AFP, salud, seguro de cesantía: cada descuento exacto."),
    ("Finiquitos de contrato", "Cálculos de vacaciones, indemnizaciones y feriado proporcional: el servicio más crítico y más buscado."),
    ("Contratos de trabajo", "Contratos claros y conformes a la legislación vigente, desde el día uno."),
    ("Pago de cotizaciones en PreviRed", "Generación y pago de planillas previsionales sin atrasos."),
    ("Cálculo de gratificación legal", "25% o 35% según te convenga, bien aplicado."),
    ("Horas extras y jornada", "Cálculo exacto de sobretiempo según tu contrato colectivo."),
    ("Bonos e incentivos variables", "Comisiones, bonos de producción y asignaciones integradas."),
    ("Asignación familiar y maternal", "Trámites y cálculos ante la CHC o mutualidad."),
    ("Seguro de cesantía (AFC)", "Cotizaciones y giros gestionados correctamente."),
    ("Seguro de accidentes laborales", "Cotización a la mutualidad correspondiente."),
    ("Seguro de Ley Karin (Ley 21.643)", "Implementación de la nueva ley de tolerancia cero al acoso."),
    ("Certificados de vacaciones", "Anticipos, ventas y gestión de días tomados."),
    ("Feriado legal e indemnizaciones", "Cálculo según el artículo 163 del Código del Trabajo."),
    ("Término de contrato y aviso previo", "Aviso previo y causal de término bien documentados."),
    ("Liquidaciones por renuncia voluntaria", "Cálculo y documentos según causal correspondiente."),
    ("Sueldo base vs. sueldo líquido", "Te explicamos y calculamos ambos de forma óptima."),
    ("Tope imponible AFP y Fonasa", "Aplicación correcta de techos previsionales vigentes."),
    ("Trabajadores a Honorarios (boletas)", "Gestión de honorarios, retención de impuestos y certificados."),
    ("Trabajadores extranjeros", "Contratación, visación y cotizaciones de extranjeros."),
    ("Contratos a plazo fijo e indefinido", "Gestión de vencimientos y renovaciones a tiempo."),
    ("Contratos por obra o faena", "Términos correctos y causales de término bien documentadas."),
    ("Turnos y jornada parcial", "Cálculo de horas y descansos según ley."),
    ("Teletrabajo y trabajo híbrido", "Cumplimiento de la ley 21.220 para trabajadores remotos."),
    ("Reglamento interno de trabajo", "Redacción y registro ante la Dirección del Trabajo."),
    ("Reglamentos de higiene y seguridad", "Comités, políticas y normativa vigente."),
    ("Comité Paritario de Higiene y Seguridad", "Constitución y asesoría de tu comité paritario."),
    ("Amonestaciones y sanciones", "Procesos disciplinarios correctos que resistan juicio."),
    ("Tutela laboral y defensas", "Acompañamiento ante reclamos en la Dirección del Trabajo."),
    ("Certificados de antigüedad laboral", "Emisión formal para créditos y trámites de tus trabajadores."),
    ("Certificados de remuneraciones", "Para crédito hipotecario, arriendos y gastos comunes."),
    ("Cotizaciones voluntarias APV", "Gestión de ahorro previsional voluntario colectivo."),
    ("Asignaciones por años de servicio", "Bonos legales de antigüedad bien calculados."),
    ("Gratificaciones por incentivo", "Bonos no imponibles aplicados correctamente."),
    ("Asignaciones de colación y movilización", "Estructura remuneracional optimizada y legal."),
    ("Vestuario y equipamiento", "Asignaciones no imponibles según giro de la empresa."),
    ("Prestaciones familiares y becas", "Beneficios para trabajadores con carga familiar."),
    ("Mutualidades (ACHS, IST, CHC)", "Gestión de accidentes, licencias y excedencias."),
    ("Declaración y pago de SIS", "Seguro social gestionado para tus trabajadores."),
    ("Conciliación de remuneraciones con contabilidad", "Tus sueldos cuadrados con el libro contable cada mes."),
    ("Gestión de licencias médicas", "Trámite, pago y descansos según ley de licencias."),
    ("Ley Papito Corazón (descuento 50% caps. 3 y 4)", "Solicitud, cálculo y vigencia del descuento por deudas de pensión de alimentos según la ley 21.478."),
    ("Retiros del 10% de AFP y su impacto en finiquitos", "Cómo afectan los retiros a tu seguro de cesantía y a los cálculos de término (ley 21.389 y modificaciones)."),
    ("Reajuste y reajustabilidad de remuneraciones", "Reajustes pactados, legales (ley 21.611: jornadas y suelos) y cláusulas de reajustabilidad."),
    ("Reforma previsional 2025 (ley 21.735)", "Nuevo aporte del empleador y Seguro Social: preparación de tu nómina para la transición 2025-2032."),
    ("Descuentos judiciales por alimentos", "Tratamiento de descuentos directos por órdenes judiciales sobre la remuneración (art. 58 del Código del Trabajo)."),
    ("Embargos y retenciones legales de sueldo", "Cálculo correcto de retenciones por embargo, pensión de alimentos y deudas fiscales."),
    ("Impuesto Único del Trabajo en liquidaciones", "Cálculo de la SEGUNDA CATEGORÍA en finiquitos: rebajas, tramos y devoluciones (art. 174 CT)."),
    ("Gratificación en finiquitos (proporcional)", "Gratificación proporcional al tiempo trabajado, con tope de 4,75 IMA bien calculado."),
    ("Vacaciones pendientes y proporcionales", "Compensación de feriado no tomado, proporcionalidad y valor diario correcto (ley 20.823)."),
    ("Indemnización por años de servicio", "Un mes por cada año, tope de 11 años: cálculo exacto y situaciones especiales (art. 163 CT)."),
    ("Indemnización convencional y pactada", "Indemnizaciones a convenir, su tratamiento tributario y previsión en contratos."),
    ("Feriado colectivo y días feriados", "Manejo de feriados legales (ley 20.215, 2 de octubre) en turnos y jornadas especiales."),
    ("Sala cuna y derechos de lactancia", "Provisión de sala cuna o pago de directo según SENCE para madres trabajadoras (art. 203 CT)."),
    ("Descanso diurno y compensatorios", "Descansos mínimos, compensación de días festivos trabajados y documentación (arts. 22 a 40 CT)."),
    ("Seguro escolar y beneficios para cargas", "Matrícula de cargas, seguro escolar (ley 16.744) y asignaciones familiares actualizadas."),
    ("Subsidio de incapacidad laboral (SIL)", "Cálculo y reposición de remuneraciones durante licencias."),
    ("Permiso postnatal y parental", "Gestión de permisos y prórrogas según ley 21.361."),
    ("Trabajo adolescente y aprendices", "Contratación y cotización de menores de edad permitidos."),
    ("Trabajo en faenas y turnos nocturnos", "Bonos y descuentos según jornadas especiales."),
    ("Outsourcing de remuneraciones completo", "Nos hacemos cargo de todo tu ciclo de nómina."),
    ("Implementación de sistemas de nómina", "Configuración de software de remuneraciones."),
    ("Auditoría de remuneraciones", "Revisión de cálculos anteriores para detectar errores."),
    ("Asesoría en conflictos laborales", "Te acompañamos en negociaciones y demandas."),
]

# ── 03 · ACOMPAÑAMIENTO CONTABLE ──
ACOMPANAMIENTO = [
    ("Contador asignado a tu empresa", "Un profesional que conoce tu negocio, no un ticket anónimo."),
    ("Reuniones mensuales de revisión", "Análisis juntos de tus números cada mes."),
    ("Interpretación de estados financieros", "Te explicamos qué dicen tus números y qué hacer con ellos."),
    ("Dashboards financieros simples", "Tu negocio de un vistazo: ventas, gastos, márgenes."),
    ("Planificación tributaria anual", "Decisiones inteligentes antes del cierre de diciembre."),
    ("Apoyo en decisiones de inversión", "Análisis de números antes de comprar o expandir."),
    ("Alertas tributarias anticipadas", "Te avisamos antes de que una obligación se vuelva problema."),
    ("Evaluación de rentabilidad por línea", "Cuál de tus productos o servicios deja más margen."),
    ("Control de gastos fijos y variables", "Detectamos fugas de dinero en tu estructura de costos."),
    ("Negociación con proveedores", "Apoyo en términos de pago y créditos comerciales."),
    ("Apoyo en negociaciones bancarias", "Presentación de información para créditos y refinanciamientos."),
    ("Diagnóstico financiero inicial", "Radiografía completa de la salud contable de tu empresa."),
    ("Plan de acción financiero", "Ruta clara con hitos y objetivos medibles."),
    ("Acompañamiento en crecimiento", "Escalabilidad: la contabilidad crece cuando tu empresa crece."),
    ("Soporte para franquicias", "Reportes estándar para casas matriz y sucursales."),
    ("Contabilidad para sociedades de profesionales", "Estudios, clínicas y consultoras con socios."),
    ("Asesoría para familias empresarias", "Sucesión, separación de patrimonios y orden familiar."),
    ("Indicadores de gestión (KPIs)", "Métricas que sí importan para tomar decisiones."),
    ("Benchmarking de tu industria", "Cómo te comparas con tus pares del rubro."),
    ("Análisis de brecha tributaria", "Qué pagas de más y qué puedes optimizar legalmente."),
    ("Revisión de contratos comerciales", "Implicancias contables y tributarias de cada firma."),
    ("Apoyo en licitaciones públicas", "Documentación contable para ChileCompra y licitaciones."),
    ("Presentación de proyectos (CORFO, Sercotec)", "Números sólidos para postular a fondos públicos."),
    ("Apoyo en rondas de inversión", "Información financiera para atraer inversionistas."),
    ("Valuación simple de tu empresa", "Cuánto vale tu negocio según sus números."),
    ("Due diligence básica", "Revisión contable al comprar o vender un negocio."),
    ("Estructuración de sucursales", "Apertura contable de nuevas ubicaciones."),
    ("Gestión de caja y tesorería", "Políticas simples para que nunca te quedes sin fondos."),
    ("Políticas de crédito a clientes", "Cómo y cuándo dar crédito sin arruinar tu caja."),
    ("Gestión de deudores morosos", "Estrategias de cobranza que preservan relaciones."),
    ("Negociación de deudas tributarias", "Convenios y pagos ante el SII y Tesorería."),
    ("Apoyo en fiscalizaciones", "Te representamos y acompañamos ante el SII."),
    ("Interpretación de normas tributarias", "Las reglas explicadas en lenguaje claro."),
    ("Capacitación a tu equipo", "Talleres contables para administrativos y dueños."),
    ("Revisiones trimestrales estratégicas", "Paradas de agenda para revisar rumbo y ajustar."),
    ("Plan de contingencia financiera", "Qué hacer si las ventas caen o cambia el mercado."),
    ("Análisis de precios y tarifas", "Cuánto cobrar según tus costos y tu mercado."),
    ("Presupuesto anual por área", "Cada departamento con su techo de gastos."),
    ("Comparativo real vs. presupuesto", "Detección temprana de desvíos y ajustes."),
    ("Apoyo en adquisición de activos", "Leasing, compra directa o financiamiento: qué conviene."),
    ("Evaluación de inversión en tecnología", "Retorno real de sistemas y automatizaciones."),
    ("Acompañamiento en clientes clave", "Rentabilidad por cliente y negociaciones grandes."),
    ("Estructura de reportes a socios", "Informes claros cuando hay más de un dueño."),
    ("Medición de productividad interna", "Costos por hora, por proyecto o por cliente."),
    ("Análisis de estacionalidad", "Prepárate para los meses buenos y los flojos."),
    ("Gestión de márgenes en inflación", "Cómo proteger tu rentabilidad cuando suben los costos."),
    ("Plan de negocio con números reales", "Del plan de negocio al modelo financiero ejecutable."),
    ("Contabilidad patrimonial personal", "Orden de tus finanzas personales como dueño."),
    ("Acompañamiento en crisis empresarial", "Reestructuración de deudas y plan de salida."),
    ("Segunda opinión contable", "Revisión independiente de lo que te dice otro contador."),
]

# ── 04 · ASESORÍA TRIBUTARIA ──
TRIBUTARIA = [
    ("Operación Renta completa", "Tu declaración anual de principio a fin, sin multas ni sorpresas."),
    ("Planificación tributaria legal", "Paga lo justo, aprovechando cada beneficio permitido."),
    ("Devolución de impuestos (Renta)", "Recupera lo que te corresponde: formalizamos tu devolución."),
    ("Cambio de régimen tributario", "Pro Pyme, Semitransparente o General: cuál te conviene."),
    ("Optimización de PPM", "Pago provisional mensual ajustado a tus ingresos reales."),
    ("Rectificatoria de declaraciones", "Corrección de F29 o F22 cuando algo quedó mal."),
    ("Respuesta a requerimientos del SII", "Cartas fiscales respondidas con respaldo técnico."),
    ("Defensa en fiscalizaciones", "Acompañamiento en auditorías del SII de principio a fin."),
    ("Condonación y convenios de pago", "Reestructuración de deudas tributarias y multas."),
    ("Tasas y recargos: revisión de multas", "Reclamación de multas mal aplicadas."),
    ("Boletas de honorarios (régimen 50%)", "Retenciones, créditos y optimización para profesionales."),
    ("Impuesto Único de Segunda Categoría", "Cálculo correcto para trabajadores y boleteros."),
    ("Impuesto de Primera Categoría", "Determinación y pago optimizado de tu impuesto empresa."),
    ("Impuestos Globales Complementarios", "Declaración correcta para dueños de empresas."),
    ("Retiros y distribuciones de utilidades", "Cuánto retirar y cómo impacta tu impuesto personal."),
    ("Ley de plataformas digitales (ley 21.420)", "Cumplimiento para Uber, Airbnb, delivery y afines."),
    ("IVA Propiedad y ventas habitacionales", "Tratamiento del IVA en ventas de inmuebles."),
    ("Ventas exentas y no gravadas", "Clasificación correcta para no pagar IVA de más."),
    ("Crédito fiscal IVA: uso y devolución", "Recuperación de IVA en exportaciones y activos."),
    ("Impuestos a los activos", "Optimización de tasas por activos fijos y no operacionales."),
    ("Timbraje y tasas de justicia", "Aplicación correcta en contratos y documentos."),
    ("Impuesto a la herencia y donaciones", "Planificación de sucesión con carga tributaria menor."),
    ("Impuesto al valor de venta de inmuebles", "Beneficios y excepciones al vender propiedades."),
    ("Beneficio tributario vivienda (Art. 55 bis)", "Crédito por compra de tu primera vivienda."),
    ("Donaciones con beneficio tributario", "Donaciones a fundaciones con crédito o gasto deducible."),
    ("Gastos rechazados: minimización", "Qué gastos son aceptados y cómo documentarlos bien."),
    ("Asignación de gastos (régimen 14 D)", "Gastos de administración bien asignados al negocio."),
    ("Corrección monetaria anual", "Cálculo técnico del reajuste de tus activos y pasivos."),
    ("Diferencias de cambio (moneda extranjera)", "Tratamiento de ganancias y pérdidas por divisa."),
    ("Impuestos para extranjeros con rentas en Chile", "Cumplimiento de no residentes y turistas inversores."),
    ("Tributación de inversiones en el extranjero", "Declaración de cuentas y activos en el exterior."),
    ("Convenio de doble tributación", "Aplicación de tratados para evitar doble pago."),
    ("Precios de transferencia", "Operaciones entre empresas relacionadas bien documentadas."),
    ("Beneficio PYME: inventarios simplificados", "Criterios permitidos para valuar tu stock."),
    ("Deducción instantánea de activos (Pro Pyme)", "Gasto inmediato de equipos en vez de depreciar."),
    ("Crédito por gastos en educación de hijos", "Beneficios para trabajadores con hijos estudiantes."),
    ("Crédito por mutuallyidades y previsión", "Optimización de cotizaciones voluntarias y APV."),
    ("Impuesto territorial agrícola", "Exenciones y beneficios para predios rurales."),
    ("Tributación de agricultores y bosques", "Régimen especial del 14 N°2 y rentas agrícolas."),
    ("Tributación de mineros artesanales", "Beneficios y obligaciones del pequeño minero."),
    ("Impuestos para transportistas", "Regímenes especiales para dueños de camiones y taxis."),
    ("Tributación de artesanos y pescadores", "Beneficios para artesanos y trabajadores del mar."),
    ("Devolución de crédito fiscal a pymes", "Recuperación de IVA cuando tu crédito supera el débito."),
    ("Tasación de bienes raíces y roles", "Revisión de avalúos fiscales para no pagar de más."),
    ("Tributación de rentas de arriendo", "Régimen 14 N°1 vs. 14 N°4: cuál te conviene."),
    ("Capitalización de utilidades diferidas", "Reinversión de ganancias sin impuesto adicional."),
    ("Fusiones y divisiones de empresas", "Tratamiento tributario de reorganizaciones empresariales."),
    ("Término de giro y liquidación", "Cierre ordenado de empresa sin deudas ocultas."),
    ("Apelación a tributos ante el Tribunal Tributario", "Reclamaciones formales ante resoluciones del SII."),
    ("Acompañamiento en Operación Renta como profesional", "Renta anual de boleteros, médicos y consultores explicada."),
]

# ── 05 · EMPRENDEDORES Y PYMES ──
PYMES = [
    ("Iniciación de actividades ante el SII", "Tu negocio formalizado en 48 horas, listo para facturar."),
    ("Elección del régimen tributario inicial", "Pro Pyme simplificado o general: partimos bien desde el día uno."),
    ("Constitución de empresa individual o SpA", "Estructura legal correcta según tus planes de crecimiento."),
    ("Apertura de RUT y certificados", "Documentación completa para bancos, clientes y proveedores."),
    ("Configuración de facturación electrónica", "SII, folios y emisión de boletas y facturas listas."),
    ("Alta en PreviRed y Tesorería", "Canales de pago previsional y tributario configurados."),
    ("Primeras liquidaciones de sueldo", "Contratación legal de tus primeros colaboradores, sin errores."),
    ("Contrato y cotización del primer trabajador", "Todo listo para contratar sin riesgos laborales."),
    ("Registro de marca en INAPI", "Protege el nombre de tu negocio ante copias."),
    ("Patente comercial municipal", "Trámite y renovación según tu comuna."),
    ("Formalización como boletero", "Emisión de boletas de honorarios con régimen correcto."),
    ("Plan de negocio con modelo financiero", "De la idea al negocio con números que responden a inversión."),
    ("Presupuesto de arranque (capex inicial)", "Cuánto necesitas para partir y cuándo recuperarás la inversión."),
    ("Punto de equilibrio del negocio", "Cuánto debes vender cada mes para no perder dinero."),
    ("Estructura de precios inicial", "Cuánto cobrar según costos, competencia y valor percibido."),
    ("Estrategia de compras y stock inicial", "Inventario óptimo sin amarrar tu capital."),
    ("Definición de política de crédito a clientes", "Reglas claras para vender al crédito sin sorpresas."),
    ("Selección de pasarela de pagos", "Webpay, Mercado Pago, Transbank: comisiones y qué conviene."),
    ("Configuración de e-commerce y marketplaces", "Shopify, WooCommerce, Mercado Libre integrados contablemente."),
    ("Registro en redes sociales y Google Business", "Presencia digital mínima viable para validación temprana."),
    ("Emisión de boletas y facturas desde el día uno", "Facturación digital lista para vender formalmente."),
    ("Subsidios y bonos para nuevos emprendedores", "Capital Semilla, Sercotec, Subsidio al Empleo Joven."),
    ("Postulación a fondos CORFO y Sercotec", "Proyectos bien presentados con números sólidos."),
    ("Programa de apoyo a mujeres emprendedoras", "Fondos y redes específicas para emprendedoras."),
    ("Certificaciones para vender al Estado", "ChileCompra, registro de proveedores públicos."),
    ("Formalización de negocio en calle", "Patente, permisos y tributación simplificada."),
    ("Régimen simplificado 14 N°3 (Pro Pyme)", "Transparencia tributaria para ventas hasta 75 millones."),
    ("Transición a régimen general al crecer", "Cambio de régimen sin sustos cuando superas los topes."),
    ("Contabilidad desde el primer mes", "Historial limpio desde el inicio (clave para créditos)."),
    ("Kit contable para emprendedores", "Planillas, calendario de obligaciones y checklist mensual."),
    ("Apertura de cuenta bancaria empresa", "Documentación y gestiones para tu cuenta corriente tributaria."),
    ("Créditos de respaldo para pymes (FOGAES, CORFO)", "Garantías estatales para acceder a financiamiento."),
    ("Relación con inversionistas ángeles", "Números claros para conversaciones de inversión."),
    ("Estructuración de sociedades entre socios", "Pactos, participaciones y obligaciones bien definidas."),
    ("Separación de finanzas personales y de negocio", "Orden básico que evita problemas futuros."),
    ("Facturación y cobranza a empresas grandes", "Cómo facturar a corporativos sin quedar sin caja."),
    ("Digitalización de procesos administrativos", "Papeleo convertido en flujos digitales simples."),
    ("Automatización de cobranza recurrente", "Suscripciones, mensualidades y pagos automáticos."),
    ("Análisis de canal de venta más rentable", "Tienda física, online o mixta: decisiones con datos."),
    ("Expansión a segunda sucursal", "Contabilidad multi-sucursal sin caos."),
    ("Contratación de comerciales y comisiones", "Estructura de incentivos que motiva sin quebrar."),
    ("Plan de marketing con retorno medible", "Presupuesto de marketing con indicadores de conversión."),
    ("Gestión de proveedores y negociación", "Términos de pago y crédito con tus proveedores clave."),
    ("Cumplimiento tributario del emprendedor", "Calendario de F29, PPM y libro de ventas sin atrasos."),
    ("Auditoría simple del negocio a los 6 meses", "Revisión de lo que funciona y lo que hay que corregir."),
    ("Preparación para presentar tu negocio a un banco", "Carpeta financiera sólida para tu primera deuda."),
    ("Franquicia: apertura como franquiciado", "Contabilidad y estructura para operar una franquicia."),
    ("Traspaso de negocio familiar a hijos", "Sucesión ordenada con mínima carga tributaria."),
    ("Conversión de emprendimiento informal a formal", "Regularización completa sin multas abrumadoras."),
    ("Crecimiento ordenado: del freelancer a empresa", "Estructura legal y contable para el siguiente nivel."),
]

# ── 06 · RESPALDO Y CONFIDENCIALIDAD ──
RESPALDO = [
    ("Respaldos diarios automáticos de tu contabilidad", "Tu información contable nunca se pierde."),
    ("Plataformas cloud con cifrado de extremo a extremo", "Datos protegidos en tránsito y en reposo."),
    ("Accesos con doble factor de autenticación", "Capa extra de seguridad en todas tus cuentas fiscales."),
    ("Gestión de claves SII y claves únicas", "Administramos tus accesos fiscales con protocolo seguro."),
    ("Confidencialidad contractual (NDA)", "Acuerdo de confidencialidad firmado antes de partir."),
    ("Protección de datos según ley 19.628", "Cumplimiento de la normativa chilena de datos personales."),
    ("Preparación para la nueva ley de datos (21.719)", "Adelántate a la nueva Agencia de Protección de Datos."),
    ("Protocolo de respuesta a incidentes", "Plan claro si algo sale mal: quiénes, cómo y cuándo."),
    ("Copia de respaldo en ubicaciones separadas", "Redundancia geográfica de tu información crítica."),
    ("Historial de versiones de tus documentos", "Recuperación de archivos de meses o años anteriores."),
    ("Custodia documental digital", "Tus facturas, contratos y comprobantes organizados y seguros."),
    ("Digitalización y OCR de documentos", "Papeles físicos convertidos en archivos buscables."),
    ("Control de accesos por rol", "Cada persona ve solo lo que necesita ver."),
    ("Registro de auditoría de accesos", "Quién vio o modificó qué, y cuándo: todo trazado."),
    ("Aislamiento de información entre clientes", "Tu información nunca se mezcla con otros clientes."),
    ("Contratos con cláusulas de indemnidad", "Responsabilidades claras ante errores de terceros."),
    ("Seguro de responsabilidad profesional", "Cobertura ante errores u omisiones profesionales."),
    ("Continuidad de servicio ante imprevistos", "Plan de contingencia si tu contador o tu sistema falla."),
    ("Transferencia segura al cambiar de contador", "Protocolo de migración sin pérdida ni filtración."),
    ("Retención legal de documentos contables", "Cuánto tiempo guardar cada documento según la ley."),
    ("Destrucción segura de documentos vencidos", "Eliminación certificada de información sensible."),
    ("Canal directo con tu contador asignado", "WhatsApp y correo directo, sin call centers ni intermediarios."),
    ("Compromiso de tiempos de respuesta", "SLA claro: cuánto demoramos en responder cada consulta."),
    ("Continuidad ante cambio de personal", "Conocimiento documentado: nadie irremplazable, todo registrado."),
    ("Respaldos de tus claves y certificados digitales", "Firma electrónica respaldada y recuperable."),
    ("Protección contra phishing y fraude fiscal", "Te alertamos de correos y webs falsas del SII."),
    ("Verificación de identidad en solicitudes", "Protocolo anti-suplantación en cambios y giros."),
    ("Monitoreo de movimientos fiscales anómalos", "Detectamos actividades extrañas en tus cuentas SII."),
    ("Alertas de uso de tu RUT por terceros", "Aviso temprano si alguien usa tu RUT sin autorización."),
    ("Bloqueo de suplantación de identidad tributaria", "Protección activa contra fraudes con tu RUT."),
    ("Cifrado de comunicaciones sensibles", "Documentos confidenciales enviados cifrados."),
    ("Almacenamiento en servidores con estándar bancario", "Infraestructura con niveles de seguridad de banca."),
    ("Pruebas de restauración periódicas", "No basta respaldar: verificamos que se puedan recuperar."),
    ("Inventario de activos de información", "Qué datos tienes, dónde están y quién los cuida."),
    ("Clasificación de información (pública/confidencial)", "Niveles de sensibilidad definidos para cada documento."),
    ("Capacitación antiphishing a tu equipo", "Tu personal entrenado para no caer en fraudes."),
    ("Políticas de contraseñas corporativas", "Reglas simples que evitan accesos comprometidos."),
    ("Gestión segura de ex-trabajadores", "Revocación de accesos al terminar contratos."),
    ("Acuerdos de confidencialidad con subcontratistas", "Toda la cadena de servicio comprometida por escrito."),
    ("Auditoría anual de seguridad de información", "Revisión periódica de tus controles digitales."),
    ("Plan de recuperación ante desastres (PRA)", "Cuánto tiempo tomaría retomar la operación tras un siniestro."),
    ("Respaldos de tu sitio web y dominio", "Tu presencia digital también protegida."),
    ("Renovación y protección de tu dominio", "Alertas de vencimiento y bloqueo de transferencias."),
    ("Protección de tu correo corporativo", "SPF, DKIM y DMARC contra suplantación de tu marca."),
    ("Cumplimiento tributario documentado", "Cada decisión con respaldo normativo por escrito."),
    ("Archivo de declaraciones y respaldos SII", "Historial completo de tus declaraciones ante consultas."),
    ("Certificación de respaldos ante notaría", "Documentos críticos notarizados cuando la ley lo pide."),
    ("Bóveda digital de documentos societarios", "Escrituras, actas y estatutos siempre disponibles."),
    ("Plan de sucesión documental del negocio", "Qué pasa con la información si algo te sucede."),
    ("Confidencialidad perpetua post-contrato", "Tu información sigue protegida aunque terminemos la relación."),
]

# ── 07 · PREVENCIÓN DE RIESGOS Y CUMPLIMIENTO DOCUMENTAL ──
PREVENCION = [
    ("Revisión y actualización de RIOHS", "Tu Reglamento Interno de Orden, Higiene y Seguridad vigente y ajustado a tu operación."),
    ("Elaboración o actualización de PTS", "Procedimientos de Trabajo Seguro para cada puesto y proceso crítico."),
    ("Levantamiento y actualización de MIPER", "Matriz de riesgos por puesto y proceso, levantada en terreno y actualizada."),
    ("Mapa de riesgos", "Visualización clara de dónde se concentra el riesgo en tu operación."),
    ("Programas preventivos derivados de la evaluación", "Plan de trabajo preventivo construido a partir de tu matriz de riesgos."),
    ("Revisión de obligaciones del D.S. 44", "Revisión de obligaciones y documentación asociada al nuevo reglamento."),
    ("Preparación de IRL / información de riesgos laborales", "Información de riesgos laborales lista para mutuales, contratos y licitaciones."),
    ("Procedimientos de EPP", "Entrega, uso, mantención y reposición de elementos de protección personal, con registros."),
    ("Registros y respaldos de capacitaciones e inducciones", "Toda la evidencia documentada y disponible ante fiscalización."),
    ("Revisión documental de brechas preventivas", "Detectamos qué falta, qué está desactualizado y armamos tu plan de regularización."),
    ("Coordinación de visita técnica en terreno", "Cuando es necesario levantar correctamente los riesgos de cada puesto y proceso."),
    ("Protocolo de Ley Karin", "Implementación del protocolo obligatorio contra el acoso laboral, sexual y la violencia en el trabajo (ley 21.643)."),
    ("Constitución del Comité Paritario", "Constitución, renovación, actas y capacitación de miembros del CPHS según la ley 16.744."),
    ("Reportabilidad SUSESO (DIAT y DDSS)", "Emisión y seguimiento de las denuncias individuales y síntesis de siniestros dentro de los plazos legales."),
    ("Investigación de accidentes laborales", "Investigación técnica de accidentes e incidentes, con medidas correctivas y seguimiento de cierre."),
    ("Estadísticas e indicadores de seguridad", "Tasas de frecuencia, gravedad y accidentalidad para tomar decisiones y responder a fiscalizaciones."),
    ("Cotización adicional de la mutualidad", "Análisis de tu siniestralidad y plan de trabajo para rebajar el excedente de cotización."),
    ("Coordinación con tu mutualidad", "Gestión del programa anual, adición de trabajadores y actividades con ACHS, IST, ISL o CHC."),
    ("Exámenes ocupacionales", "Coordinación y control documental de exámenes preocupacionales, periódicos y de retiro."),
    ("Condiciones sanitarias y ambientales (D.S. 594)", "Revisión de cumplimiento del reglamento de condiciones sanitarias en tus instalaciones."),
    ("Vigilancia de ruido ocupacional", "Coordinación de mediciones y control documental de la exposición a ruido por puesto."),
    ("Ergonomía y manipulación manual de cargas", "Evaluación de puestos según la ley 20.949, con medidas de control documentadas."),
    ("Gestión documental de contratistas (D.S. 76)", "Exigencia y archivo ordenado de la documentación de seguridad de tus subcontratistas."),
    ("Homologación de contratistas", "Registro y mantención de tu documentación en plataformas SIRC, SISTECRED y Homologa."),
    ("Carpetas de prevención para licitaciones", "Carpeta completa de seguridad para postular a licitaciones públicas y privadas."),
    ("Carpetas de ingreso a faenas", "Documentación de prevención lista para el ingreso a faenas y centros de clientes."),
    ("Plan de emergencia y evacuación", "Elaboración del plan, vías de evacuación, roles y coordinación según tu instalación."),
    ("Coordinación de simulacros", "Planificación, ejecución y registro de simulacros de emergencia con aprendizajes."),
    ("Control de extintores y equipos de emergencia", "Gestión documental de inspecciones y recargas con empresas certificadas."),
    ("Primeros auxilios y botiquines", "Estandarización y control de botiquines y procedimientos de primeros auxilios."),
    ("Señalización de seguridad", "Plan de señalización de instalaciones y riesgos según la normativa vigente."),
    ("Charlas de seguridad diarias y semanales", "Charlas de 5 minutos y reuniones de seguridad con registro documentado."),
    ("Programa anual de capacitación en prevención", "Matriz de capacitación anual según los riesgos de cada puesto, con seguimiento de cierre."),
    ("Inducción en seguridad para nuevos trabajadores", "Formato de inducción y registro obligatorio para cada ingreso a la empresa."),
    ("Inspecciones planeadas de seguridad", "Checklists de inspección en terreno con registro y seguimiento de hallazgos."),
    ("Observaciones de seguridad", "Registros de observaciones de conducta y condiciones para corregir a tiempo."),
    ("Matriz de EPP por puesto", "Definición técnica de los elementos de protección personal según cada riesgo."),
    ("Fichas de identificación de peligros", "Fichas por puesto y proceso que alimentan tu MIPER y tus procedimientos."),
    ("Permisos de trabajo de alto riesgo", "Formatos de permiso para trabajo en altura, caliente, eléctrico y espacios confinados."),
    ("Bloqueo y etiquetado de energías (LOTO)", "Control de energías peligrosas en mantención de máquinas y equipos."),
    ("Procedimientos de trabajo en altura", "Requisitos, controles y registros para trabajos sobre 1,8 metros."),
    ("Procedimientos para espacios confinados", "Ingresos controlados con medición de atmósfera y vigías documentados."),
    ("Manejo seguro de productos químicos", "Hojas de seguridad, rotulado y almacenamiento según normativa."),
    ("Control de mantenimiento de máquinas", "Registros documentales de mantención preventiva y resguardos de seguridad."),
    ("Inspección de andamios y estructuras", "Registros de inspección de equipos de acceso y estructuras elevadas."),
    ("Gestión documental de flota vehicular", "Permisos de circulación, revisión técnica y seguros de los vehículos de la empresa."),
    ("Ordenanzas de trabajo por centro", "Ordenanzas específicas para cada centro o sucursal según el Código del Trabajo."),
    ("Informes mensuales de gestión preventiva", "Reporte mensual para gerencia: accidentes, hallazgos, capacitaciones y avance del plan."),
    ("Auditoría interna de prevención", "Revisión completa del sistema preventivo con informe de brechas y plan de regularización."),
    ("Apoyo documental para ISO 45001", "Preparación de la documentación base para certificarte en seguridad y salud en el trabajo."),
]

PAGES = [
    dict(
        file="contabilidad-completa.html",
        num="01",
        slug="contabilidad-completa",
        title="Contabilidad completa",
        eyebrow="Servicio 01 · Contabilidad",
        h1="Contabilidad completa para tu empresa",
        persuasive=(
            "Deja de perseguir papeles, multas y vencimientos. En JMV Consultores "
            "tomamos tu contabilidad de principio a fin: cada factura, cada impuesto, "
            "cada balance. Tú solo miras los números claros y tomas decisiones. "
            "Todo en regla, todo a tiempo, todo explicado en tu idioma."
        ),
        lead=(
            "Estos son algunos de los servicios contables en los que te podemos ayudar:"
        ),
        services=CONTABILIDAD,
    ),
    dict(
        file="remuneraciones",
        num="02",
        slug="remuneraciones",
        title="Remuneraciones",
        eyebrow="Servicio 02 · Remuneraciones",
        h1="Remuneraciones impecables, trabajadores tranquilos",
        persuasive=(
            "Las remuneraciones mal calculadas son la fuente número uno de conflictos "
            "laborales y multas de la Dirección del Trabajo. Nosotros administramos tu "
            "nómina completa: liquidaciones exactas, imposiciones pagadas a tiempo y "
            "cada trabajador contento. Cero juicios, cero sobresaltos."
        ),
        lead=(
            "Más de 60 servicios de remuneraciones en los que te podemos ayudar, "
            "incluyendo todas las leyes vigentes que afectan sueldos, finiquitos y descuentos legales:"
        ),
        services=REMUNERACIONES,
    ),
    dict(
        file="acompanamiento-contable",
        num="03",
        slug="acompanamiento-contable",
        title="Acompañamiento contable",
        eyebrow="Servicio 03 · Acompañamiento",
        h1="Acompañamiento contable que sí te ayuda a decidir",
        persuasive=(
            "Un contador que solo te dice cuánto debes pagar se quedó en el siglo pasado. "
            "Nosotros nos sentamos contigo cada mes, interpretamos tus números juntos y "
            "te ayudamos a decidir: dónde invertir, qué recortar, cuándo crecer. "
            "Tu contador, tu socio estratégico."
        ),
        lead=(
            "Estos son algunos de los servicios de acompañamiento en los que te podemos ayudar:"
        ),
        services=ACOMPANAMIENTO,
    ),
    dict(
        file="asesoria-tributaria",
        num="04",
        slug="asesoria-tributaria",
        title="Asesoría tributaria",
        eyebrow="Servicio 04 · Tributario",
        h1="Asesoría tributaria: paga lo justo, ni un peso más",
        persuasive=(
            "El SII no perdona el desconocimiento, pero la ley permite pagar menos "
            "cuando sabes cómo. Planificamos tus impuestos legalmente, te defendemos "
            "en fiscalizaciones y recuperamos lo que te deben. La primera consulta "
            "es gratis y podría ahorrarte millones."
        ),
        lead=(
            "Estos son algunos de los servicios tributarios en los que te podemos ayudar:"
        ),
        services=TRIBUTARIA,
    ),
    dict(
        file="emprendedores-pymes",
        num="05",
        slug="emprendedores-pymes",
        title="Emprendedores y Pymes",
        eyebrow="Servicio 05 · Emprendedores",
        h1="Formaliza y crece tu negocio desde el día uno",
        persuasive=(
            "Cada gran empresa empezó siendo una idea con un RUT. Te acompañamos desde "
            "la iniciación de actividades hasta tu expansión: régimen tributario correcto, "
            "facturación lista, primeros trabajadores contratados bien y fondos públicos "
            "postulados a tiempo. Emprender ordenado es crecer más rápido."
        ),
        lead=(
            "Estos son algunos de los servicios para emprendedores y pymes en los que te podemos ayudar:"
        ),
        services=PYMES,
    ),
    dict(
        file="respaldo-confidencialidad",
        num="06",
        slug="respaldo-confidencialidad",
        title="Respaldo y confidencialidad",
        eyebrow="Servicio 06 · Respaldo",
        h1="Tu información más valiosa, protegida siempre",
        persuasive=(
            "Tu información contable y tributaria es tan sensible como tu cuenta bancaria. "
            "La protegemos con cifrado, accesos controlados, contratos de confidencialidad "
            "y respaldos verificados. Si algo falla, hay plan. Si alguien pregunta, hay silencio. "
            "Tranquilidad total para tu negocio."
        ),
        lead=(
            "Estos son algunos de los servicios de respaldo y confidencialidad en los que te podemos ayudar:"
        ),
        services=RESPALDO,
    ),
    dict(
        file="prevencion-riesgos",
        num="07",
        slug="prevencion-riesgos",
        title="Prevención de riesgos",
        eyebrow="Servicio 07 · Prevención de riesgos",
        h1="Prevención de riesgos y cumplimiento documental",
        persuasive=(
            "Apoyamos a pequeñas y medianas empresas en materias de prevención de "
            "riesgos y cumplimiento documental. La idea no es solamente preparar "
            "documentos: revisamos qué necesita realmente tu empresa y dejamos un "
            "sistema preventivo coherente con sus actividades y sus riesgos."
        ),
        lead=(
            "Dentro de los servicios de prevención en los que podemos trabajar están:"
        ),
        services=PREVENCION,
    ),
]

TEMPLATE = """<!DOCTYPE html>
<html lang="es-CL">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{title} — JMV Consultores | Chile</title>
  <meta name="description" content="{description}" />
  <meta name="author" content="JMV Consultores" />
  <meta name="theme-color" content="#0a0e1a" />
  <link rel="canonical" href="https://jmvconsultores.cl/{slug}" />

  <meta property="og:type" content="website" />
  <meta property="og:title" content="{og_title} — JMV Consultores" />
  <meta property="og:description" content="{og_desc}" />
  <meta property="og:url" content="https://jmvconsultores.cl/{slug}" />
  <meta property="og:locale" content="es_CL" />

  <link rel="icon" type="image/svg+xml" href="assets/favicon.svg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@600&display=swap" />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@600&display=swap" media="print" onload="this.media='all'" />
  <noscript>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@600&display=swap" />
  </noscript>

  <link rel="stylesheet" href="css/styles.css" />
  <script defer src="js/bg3d.js"></script>
  <script defer src="js/main.js"></script>
</head>
<body>

  <canvas id="bg3d" aria-hidden="true"></canvas>

  <header class="topbar">
    <div class="container topbar__inner">
      <a href="index.html" class="topbar__logo-link" aria-label="JMV Consultores — volver al inicio"><img src="assets/logo-light.svg" alt="JMV Consultores" class="topbar__logo" /></a>
      <a href="#contacto" class="btn btn--primary btn--sm">Consulta gratis</a>
    </div>
  </header>

  <main class="detail">
    <div class="container">
      <a class="crumb" href="index.html"><span class="contact__arrow">←</span> Volver al inicio</a>

      <div class="detail__head">
        <span class="detail__num gradient-text">{num}</span>
        <p class="section__eyebrow reveal" style="text-align:left">{eyebrow}</p>
        <h1 class="reveal">{h1}</h1>
        <p class="reveal">{persuasive}</p>
      </div>

      <p class="list-hint reveal">{lead}</p>

      <div class="svc">
{rows}
      </div>

      <div class="related reveal">
        <p class="related__title">Otros servicios que podrían interesarte</p>
        <div class="related__links">
{related_links}
        </div>
      </div>
    </div>
  </main>

  <section class="faq">
    <div class="container">
      <p class="section__eyebrow reveal">Preguntas frecuentes</p>
      <h2 class="section__title reveal">Dudas típicas sobre <span class="gradient-text">{faq_topic}</span></h2>
      <p class="faq__badge reveal">{faq_count} preguntas respondidas · respuestas directas, sin letra chica</p>
      <div class="faq__list reveal">
{faq_items}
      </div>
      <p class="faq__more reveal">¿Tienes otra duda? <a href="preguntas-frecuentes.html#{slug}">Ver todas las {faq_count} preguntas frecuentes</a></p>
    </div>
  </section>

  <section class="cta reveal">
    <div class="container cta__inner">
      <h2>¿Necesitas <span class="gradient-text">{cta_topic}</span> para tu empresa?</h2>
      <p>La primera consulta es gratis y sin compromiso. Respondemos en menos de 24 horas.</p>
      <a href="https://wa.me/{wa}?text={wa_msg}" class="btn btn--light btn--lg" target="_blank" rel="noopener">Consultar por WhatsApp</a>
    </div>
  </section>

  <section class="section" id="contacto">
    <div class="container">
      <p class="section__eyebrow reveal">Contacto</p>
      <h2 class="section__title reveal">Hablemos de tu <span class="gradient-text">negocio</span></h2>
      <p class="section__lead reveal">Elige el canal que prefieras. Respondemos en menos de 24 horas hábiles.</p>

      <div class="contact">
        <div class="contact__info reveal">
          <a class="contact__item" href="https://wa.me/{wa}?text={wa_msg}" target="_blank" rel="noopener">
            <span class="contact__label">WhatsApp</span>
            <span class="contact__value">+56 9 7575 2213</span>
            <span class="contact__arrow">→</span>
          </a>
          <a class="contact__item" href="mailto:contacto@jmvconsultores.cl">
            <span class="contact__label">Correo</span>
            <span class="contact__value">contacto@jmvconsultores.cl</span>
            <span class="contact__arrow">→</span>
          </a>
          <div class="contact__item">
            <span class="contact__label">Zona de atención</span>
            <span class="contact__value">Chile · Atención 100% en línea</span>
          </div>
        </div>
      </div>
    </div>
  </section>

  <footer class="footer">
    <div class="container footer__inner">
      <img src="assets/logo-light.svg" alt="JMV Consultores" class="footer__logo" />
      <p class="footer__legal">JMV CONSULTORES SPA · contacto@jmvconsultores.cl</p>
      <p class="footer__copy">© <span id="year">2026</span> JMV Consultores · jmvconsultores.cl · Hecho con precisión contable</p>
    </div>
  </footer>

  <a class="wa-float" href="https://wa.me/{wa}?text={wa_msg}" target="_blank" rel="noopener">
    <span class="wa-float__text">WhatsApp</span>
    <span class="wa-float__dot" aria-hidden="true"></span>
  </a>

  <script type="application/ld+json">
{jsonld}
  </script>

</body>
</html>
"""

# ── FAQ por página de servicio (4 preguntas + schema FAQPage) ──
FAQS = {
    "contabilidad-completa": [
        ("¿Qué necesito para partir con mi contabilidad?", "Solo tu RUT, clave SII y acceso a tus documentos (facturas, cartolas, boletas). Nosotros nos encargamos del resto, incluso si llevas meses atrasados."),
        ("¿Qué pasa si tengo impuestos atrasados?", "Lo revisamos y regularizamos. El SII permite rectificar declaraciones y en muchos casos las multas se reducen o condonan. La clave es partir antes, no después."),
        ("¿Cada cuánto me informan cómo va mi empresa?", "Mensualmente: recibes un reporte claro con tus resultados, impuestos a pagar y alertas. Y puedes consultar a tu contador cuando lo necesites."),
        ("¿Trabajan con mi rubro?", "Trabajamos con pymes de todos los rubros: comercio, servicios, restaurants, construcción, salud, e-commerce y más. Pregúntanos por tu caso específico, la primera consulta es gratis."),
    ],
    "remuneraciones": [
        ("¿Qué es la Ley Papito Corazón?", "Es la ley 21.478. Si un trabajador tiene deudas de pensión de alimentos y lo solicita, se descuenta el 50% de las cotizaciones de los capítulos 3 (salud) y 4 (leyes sociales) de su sueldo para pagar la deuda. El empleador debe aplicarlo si el juzgado lo ordena y notificar al trabajador."),
        ("¿Cuánto me descuentan de un finiquito por impuestos?", "El finiquito tributa como remuneración (art. 174 del Código del Trabajo). Si sumado a tus otras rentas del año no supera los 13,5 UTA, puedes solicitar la devolución con la Operación Renta. Calculamos todo para que no pierdas plata."),
        ("¿Cuánto me corresponde de indemnización por años de servicio?", "Un mes de remuneración por cada año trabajado, con tope de 11 remuneraciones (art. 163 CT). Los retiros del 10% de AFP pueden reducir lo que recibe el trabajador, porque el empleador puede rebajar hasta el 50% con cargo al seguro de cesantía."),
        ("¿Qué leyes nuevas debo cumplir con mis trabajadores?", "Ley Karin (acoso laboral, obligatoria desde agosto 2024), sala cuna universal para todas las trabajadoras (2026), reducción de jornada a 44 horas (transición hasta 2028) y la reforma previsional con aporte del empleador (desde 2025). Te mantenemos al día en todo."),
    ],
    "acompanamiento-contable": [
        ("¿En qué se diferencia de la contabilidad mensual?", "La contabilidad te dice qué pasó; el acompañamiento te ayuda a decidir qué hacer. Incluye reuniones mensuales, análisis de tus números y apoyo directo en decisiones de inversión, precios y crecimiento."),
        ("¿Tengo que cambiar mi contador actual?", "No necesariamente. Podemos trabajar en conjunto o darte una segunda opinión. Si quieres cambiarte, gestionamos la transferencia de toda tu información de forma segura y sin baches."),
        ("¿Cómo es la primera reunión?", "Sin costo y sin compromiso. Revisamos tu situación actual, identificamos riesgos y oportunidades, y te proponemos un plan. Tú decides si avanzamos."),
        ("¿Trabajan con empresas en crecimiento?", "Es justo nuestro foco: pymes que están creciendo y necesitan orden contable que escale con ellas, desde la primera contratación hasta la segunda sucursal."),
    ],
    "asesoria-tributaria": [
        ("¿Es legal la planificación tributaria?", "Sí. Planificar es usar las reglas que la propia ley ofrece (regímenes, créditos, beneficios) para pagar lo justo. Lo que no es legal es ocultar ingresos o falsear información. Nosotros solo usamos el camino legal."),
        ("¿Me pueden ayudar si ya tengo multas o deudas?", "Sí. Evaluamos convenios de pago, condonaciones y rectificatorias. Mientras más rápido actúas, más opciones tienes de reducir el costo total."),
        ("¿Qué me conviene: Pro Pyme o régimen general?", "Depende de tus ventas, tus utilidades y tus planes de inversión. Lo analizamos con tus números reales y te mostramos la comparación antes de decidir."),
        ("¿Cuándo es la Operación Renta?", "Entre abril y junio de cada año, según el rol que asigna el SII. Pero la preparación ideal parte en diciembre: una buena planificación de fin de año ahorra impuestos en abril."),
    ],
    "emprendedores-pymes": [
        ("¿Cuánto demora la iniciación de actividades?", "En el SII puede ser el mismo día. Lo importante es partir con el régimen tributario correcto y la facturación configurada, para no arrastrar errores que después cuestan."),
        ("¿Convictorio o boletas? ¿SpA o empresa individual?", "Depende de tu rubro, tus ventas proyectadas y si tienes socios. En la consulta gratuita analizamos tu caso y te recomendamos la estructura que menos impuestos y menos problemas te dé."),
        ("¿Puedo formalizarme si tengo deudas o castigos?", "En la mayoría de los casos sí. Hay regímenes y herramientas para partir limpio. Lo revisamos juntos en la primera conversación."),
        ("¿Me ayudan a postular a fondos como Sercotec o CORFO?", "Sí: preparamos los números, el presupuesto y la documentación contable que exigen las postulaciones. Un expediente financiero sólido aumenta mucho las probabilidades."),
    ],
    "respaldo-confidencialidad": [
        ("¿Quién puede ver mi información?", "Solo tu contador asignado. Los accesos son por rol, con registro de auditoría: queda trazado quién vio o modificó qué, y cuándo."),
        ("¿Qué pasa con mi información si terminamos el servicio?", "La entregamos completa y de forma segura al contador que elijas, y el compromiso de confidencialidad continúa indefinidamente después de terminar la relación."),
        ("¿Qué pasa si se pierde un documento?", "Los respaldos son diarios y están verificados con pruebas de restauración periódicas. Cualquier documento de los últimos años se recupera del historial de versiones."),
        ("¿Firman acuerdo de confidencialidad?", "Sí, antes de partir y por escrito. Además trabajamos con plataformas cifradas, doble factor de autenticación y contratos con cláusulas de indemnidad."),
    ],
    "prevencion-riesgos": [
        ("¿Mi empresa necesita experto en prevención aunque sea pequeña?", "Toda empresa con trabajadores debe cumplir la ley 16.744: RIOHS, inducciones, EPP y documentación básica. Si tienes 25 o más trabajadores, además necesitas comité paritario y experto. Te ayudamos a cumplir según tu tamaño real."),
        ("¿Qué es el MIPER y por qué es importante?", "Es la matriz de identificación de peligros y evaluación de riesgos: la base de todo tu sistema preventivo. Sin MIPER bien levantado en terreno, los procedimientos y capacitaciones no apuntan a los riesgos reales."),
        ("¿Qué me exige el D.S. 44?", "Es el nuevo reglamento que moderniza la gestión preventiva: obliga a revisar y actualizar periódicamente tu documentación, evaluar riesgos por puesto y mantener evidencia de todo. Lo revisamos completo y te dejamos un plan de regularización."),
        ("¿Sirve para postular a licitaciones?", "Sí: preparamos tu carpeta de prevención completa (IRL, MIPER, PTS, capacitaciones, EPP) para homologación, licitaciones públicas y de ingreso a faenas de grandes empresas."),
    ],
}

# Servicios relacionados por página (excluye la propia)
SLUGS_ALL = [p["slug"] for p in [
    dict(slug="contabilidad-completa.html", title="Contabilidad completa"),
    dict(slug="remuneraciones.html", title="Remuneraciones"),
    dict(slug="acompanamiento-contable.html", title="Acompañamiento contable"),
    dict(slug="asesoria-tributaria.html", title="Asesoría tributaria"),
    dict(slug="emprendedores-pymes.html", title="Emprendedores y Pymes"),
    dict(slug="respaldo-confidencialidad.html", title="Respaldo y confidencialidad"),
    dict(slug="prevencion-riesgos.html", title="Prevención de riesgos"),
]]
RELATED_TITLES = {
    "contabilidad-completa.html": "Contabilidad completa",
    "remuneraciones.html": "Remuneraciones",
    "acompanamiento-contable.html": "Acompañamiento contable",
    "asesoria-tributaria.html": "Asesoría tributaria",
    "emprendedores-pymes.html": "Emprendedores y Pymes",
    "respaldo-confidencialidad.html": "Respaldo y confidencialidad",
    "prevencion-riesgos.html": "Prevención de riesgos",
}

def related_for(slug):
    others = [s for s in SLUGS_ALL if s != slug]
    links = []
    for s in others:
        t = RELATED_TITLES[s]
        links.append(f'          <a href="{s}" class="related__link">{t} <span class="svc__hint-arrow">→</span></a>')
    return "\n".join(links)

def faq_for(slug, limit=None):
    faqs = FAQ_DATA.get(slug, [])
    if limit:
        faqs = faqs[:limit]
    items = []
    for i, (q, a) in enumerate(faqs, 1):
        num = f"{i:02d}"
        items.append(
            '        <details class="faq__item">\n'
            f'          <summary><span class="faq__num gradient-text">{num}</span>{H.escape(q)}</summary>\n'
            f'          <p>{H.escape(a)}</p>\n'
            '        </details>'
        )
    return "\n".join(items)

def jsonld_for(page):
    faqs = FAQ_DATA.get(page["slug"], [])[:25]
    data = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "ProfessionalService",
                "name": f"JMV Consultores — {page['title']}",
                "description": page["persuasive"][:250],
                "url": f"https://jmvconsultores.cl/{page['slug']}.html",
                "areaServed": "Chile",
                "priceRange": "$$",
            },
            {
                "@type": "FAQPage",
                "mainEntity": [
                    {
                        "@type": "Question",
                        "name": q,
                        "acceptedAnswer": {"@type": "Answer", "text": a},
                    }
                    for q, a in faqs
                ],
            },
        ],
    }
    return json.dumps(data, ensure_ascii=False, indent=2)

def build():
    for page in PAGES:
        rows = []
        for i, (name, desc) in enumerate(page["services"], 1):
            num = f"{i:02d}"
            rows.append(
                f'        <article class="svc__row svc__row--plain reveal">\n'
                f'          <span class="svc__num gradient-text">{num}</span>\n'
                f'          <div class="svc__body">\n'
                f'            <h3>{H.escape(name)}</h3>\n'
                f'            <p>{H.escape(desc)}</p>\n'
                f'          </div>\n'
                f'        </article>'
            )
        rows_html = "\n".join(rows)
        wa_msg = UQ(f"Hola, necesito asesoría en {page['title'].lower()}")
        content = TEMPLATE.format(
            title=page["title"],
            description=page["persuasive"][:155],
            slug=page["slug"] + ".html",
            og_title=page["title"],
            og_desc=page["lead"][:180],
            num=page["num"],
            eyebrow=page["eyebrow"],
            h1=page["h1"],
            persuasive=page["persuasive"],
            lead=page["lead"],
            rows=rows_html,
            related_links=related_for(page["slug"] + ".html"),
            faq_topic=page["title"].lower(),
            faq_count=len(FAQ_DATA.get(page["slug"], [])),
            faq_items=faq_for(page["slug"]),
            faq_full_items=faq_for(page["slug"]),
            jsonld=jsonld_for(page),
            cta_topic=page["title"].lower(),
            wa=WA,
            wa_msg=wa_msg,
            wa_url=WA_URL,
            wa_consulta=WA_MSG_CONSULTA,
        )
        fname = page["file"] if page["file"].endswith(".html") else page["file"] + ".html"
        with open(fname, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"OK {fname} — {len(page['services'])} servicios")

if __name__ == "__main__":
    build()
