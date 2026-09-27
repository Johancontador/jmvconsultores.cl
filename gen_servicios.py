#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_servicios.py — Genera las 6 páginas de detalle de servicio.
Cada página: mensaje persuasivo del brand + 50 servicios numerados
ordenados por las búsquedas más recurrentes en Google (Chile).
"""
import html as H
from urllib.parse import quote as UQ

WA = "56975752213"

# ── 01 · CONTABILIDAD COMPLETA (ordenado por volumen de búsqueda en Google CL) ──
CONTABILIDAD = [
    ("Declaración mensual de IVA (F29)", "Preparamos y enviamos tu F29 a tiempo, aprovechando el uso de crédito fiscal."),
    ("Declaración anual de impuestos (F22)", "Operación Renta completa: te devolvemos lo que el SII te debe."),
    ("Balances y estados financieros", "Balances claros para bancos, inversionistas y decisiones internas."),
    ("Registro de compras y ventas", "Libros de compra y venta al día, conciliados con tu movimientos reales."),
    ("Conciliaciones bancarias", "Cada peso conciliado entre cartola, libros y caja."),
    ("Boletas de honorarios electrónicas", "Emisión, registro y declaración de tus honorarios boleta por boleta."),
    ("Facturación electrónica (DTE)", "Configuramos y controlamos toda tu facturación en el SII."),
    ("Libro de compras y ventas electrónico", "Envíos al SII sin atrasos ni multas."),
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
    ("Constitución de empresas contable", "Soporte contable completo al formar tu sociedad."),
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
    ("Certificados y informes para terceros", "Documentación contable formal ante bancos o auditors."),
    ("Conciliaciones con plataformas digitales", "Mercado Libre, Uber, Airbnb y demás reportes conciliados."),
    ("Respaldo y custodia documental", "Tu documentación contable respaldada y disponible siempre."),
]

# ── 02 · REMUNERACIONES ──
REMUNERACIONES = [
    ("Liquidaciones de sueldo electrónicas", "Claras, legalmente correctas y enviadas a cada trabajador."),
    ("Libro de remuneraciones electrónico", "Envío al SII de tu libro de remuneraciones cada mes."),
    ("Cálculo de imposiciones previsionales", "AFP, salud, seguro de cesantía: cada descuento exacto."),
    ("Pago de cotizaciones en PreviRed", "Generación y pago de planillas previsionales sin atrasos."),
    ("Contratos de trabajo", "Redacción según ley 21.561 (fraccionamiento, plazos, jornada)."),
    ("Finiquitos de contrato", "Cálculos de vacaciones, indemnizaciones y feriado proporcional."),
    ("Cálculo de gratificación legal", "25% o 35% según te convenga, bien aplicado."),
    ("Horas extras y jornada", "Cálculo exacto de sobretiempo según tu contrato colectivo."),
    ("Bonos e incentivos variables", "Comisiones, bonos de producción y asignaciones integradas."),
    ("Asignación familiar y maternal", "Trámites y cálculos ante la CHC o mutualidad."),
    ("Seguro de cesantía (AFC)", "Cotizaciones y giros gestionados correctamente."),
    ("Seguro de accidentes laborales", "Cotización a la mutualidad correspondiente."),
    ("Seguro de Ley Karin (Ley 21.643)", "Implementación de la nueva ley de tolerancia cero al acoso."),
    ("Certificados de vacaciones", "Anticipos, ventas y gestión de días tomados."),
    ("Ferias e indemnizaciones por años de servicio", "Cálculo según article 163 del Código del Trabajo."),
    ("Términos de contrato y aviso previo", "Comunicaciones al empleado y reglamento de despido."),
    ("Liquidaciones por renuncia voluntaria", "Cálculo y documents según causal correspondiente."),
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
    ("Bonos de juice legal por antigüedad", "Asignaciones por años de servicio bien calculadas."),
    ("Gratificaciones por incentivo", "Bonos no imponibles aplicados correctamente."),
    ("Asignaciones de colación y movilización", "Estructura remuneracional optimizada y legal."),
    ("Vestuario y equipamiento", "Asignaciones no imponibles según giro de la empresa."),
    ("Prestaciones familiares y becas", "Beneficios para trabajadores con carga familiar."),
    ("Mutualidades (ACHS, IST, CHC)", "Gestión de accidentes, licencias y excedencias."),
    ("Declaración y pago de SIS", "Seguro social gestionado para tus trabajadores."),
    ("Planilla de pago electrónico (PreviRed)", "Descuentos, planillas y pagos digitales integrados."),
    ("Gestión de licencias médicas", "Trámite, pago y descansos según ley de licencias."),
    ("Subsidio de incapacidad laboral (SIL)", "Cálculo y reposición de remuneraciones durante licencias."),
    ("Permiso postnatal y parental", "Gestión de permisos y prórrogas según ley 21.361."),
    ("Trabajo adolescente y aprendices", "Contratación y cotización de menores de edad permitidos."),
    ("Trabajo en faenas y Turnos Nocturnos", "Bonos y descuentos según jornadas especiales."),
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
    ("Alertas tributarias anticipadas", "Te avisamos antes de que una obligación se vuelva problema."),
    ("Planificación tributaria anual", "Decisiones inteligentes antes del cierre de diciembre."),
    ("Apoyo en decisiones de inversión", "Análisis de números antes de comprar o expandir."),
    ("Evaluación de rentabilidad por línea", "Cuál de tus productos o servicios deja más margen."),
    ("Control de gastos fijos y variables", "Detectamos fugas de dinero en tu estructura de costos."),
    ("Negociación con proveedores", "Apoyo en términos de pago y creditos comerciales."),
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
    ("Acompañamiento post-venta de clientes clave", "Rentabilidad por cliente y negotaciones grandes."),
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
    ("Devolución de impuestos (Renta)", "Recupera lo que te corresponde: formalizamos tu devolución."),
    ("Planificación tributaria legal", "Paga lo justo, aprovechando cada beneficio permitido."),
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
    ("Tasación de bienes raíces yrolls", "Revisión de avalúos fiscales para no pagar de más."),
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
    ("Registro de marca en INAPI", "Protege el nombre de tu negocio ante copias."),
    ("Patente comercial municipal", "Trámite y renovación según tu comuna."),
    ("Formalización como boletero", "Emisión de boletas de honorarios con régimen correcto."),
    ("Plan de negocio con modelo financiero", "Del idea al negocio con números que responden a inversión."),
    ("Presupuesto de arranque (capex inicial)", "Cuánto necesitas para partir y cuándo recuperarás la inversión."),
    ("Punto de equilibrio del negocio", "Cuánto debes vender cada mes para no perder dinero."),
    ("Estructura de precios inicial", "Cuánto cobrar según costos, competencia y valor percibido."),
    ("Estrategia de compras y stock inicial", "Inventario óptimo sin amarrar tu capital."),
    ("Definición de política de crédito a clientes", "Reglas claras para vender al crédito sin sorpresas."),
    ("Selección de pasarela de pagos", "Webpay, Mercado Pago, Transbank: comisiones y qué conviene."),
    ("Configuración de e-commerce y marketplaces", "Shopify, WooCommerce, Mercado Libre integrados contablemente."),
    ("Registro en redes sociales y Google Business", "Presencia digital mínima viable para validación temprana."),
    ("Emisión de boletas y facturas desde el día uno", "Facturación digital lista para vender formalmente."),
    ("Primeras liquidaciones de sueldo", "Contratación legal de tus primeros colaboradores."),
    ("Contrato y cotización del primer trabajador", "Todo listo para contratar sin riesgos laborales."),
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
    ("Bloqueo de suplantación de identidad tributaria", "Protección activa contra fraudulentos con tu RUT."),
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
            "Estos son los 50 servicios contables más solicitados y buscados por "
            "empresas y emprendedores en Google Chile, ordenados por frecuencia de búsqueda:"
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
            "Los 50 servicios de remuneraciones más buscados por empresas en Google Chile, "
            "ordenados según frecuencia de búsqueda:"
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
            "Los 50 servicios de acompañamiento y asesoría financiera más buscados en "
            "Google Chile, ordenados según frecuencia de búsqueda:"
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
            "Los 50 servicios tributarios más buscados por contribuyentes en Google Chile, "
            "ordenados según frecuencia de búsqueda:"
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
            "Los 50 servicios para emprendedores y pymes más buscados en Google Chile, "
            "ordenados según frecuencia de búsqueda:"
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
            "Los 50 servicios de respaldo, seguridad y confidencialidad más buscados en "
            "Google Chile, ordenados según frecuencia de búsqueda:"
        ),
        services=RESPALDO,
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
      <img src="assets/logo-light.svg" alt="JMV Consultores" class="topbar__logo" />
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
    </div>
  </main>

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

</body>
</html>
"""

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
            cta_topic=page["title"].lower(),
            wa=WA,
            wa_msg=wa_msg,
        )
        fname = page["file"] if page["file"].endswith(".html") else page["file"] + ".html"
        with open(fname, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"OK {fname} — {len(page['services'])} servicios")

if __name__ == "__main__":
    build()
