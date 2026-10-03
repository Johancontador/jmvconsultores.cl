/**
 * Plantilla PUC simplificado chileno — precargada al crear cada empresa
 * (ACCOUNTING_DOMAIN §3). Los códigos son de uso común del gremio, EDITABLES
 * por empresa: esto es una semilla de configuración, no una regla legal.
 *
 * Convenciones:
 *  - esResumen: nodo con hijos, NO recibe movimientos.
 *  - naturaleza derivada de la clase: 1/5/6 → deudora; 2/3/4 → acreedora.
 *  - cierre: 1/2/3 → 'balance'; 4/5/6 → 'resultado'.
 *  - alias: nombre de control interno para reglas/cierres — el motor los
 *    busca por alias, nunca por código rígido.
 *  - rubro: rubro NIIF de presentación por defecto (FASE 8 — catálogo en
 *    core/niif.js). Las cuentas creadas a mano nacen sin rubro: quedan en
 *    SIN_CLASIFICAR hasta que el contador las mapee (nunca se adivina).
 */

const NATURALEZA = { 1: 'deudora', 2: 'acreedora', 3: 'acreedora', 4: 'acreedora', 5: 'deudora', 6: 'deudora' }
const CIERRE = { 1: 'balance', 2: 'balance', 3: 'balance', 4: 'resultado', 5: 'resultado', 6: 'resultado' }

const PLANTILLA = [
  // ===== 1 ACTIVOS =====
  { codigo: '1', nombre: 'ACTIVOS', esResumen: true },
  { codigo: '1.1', nombre: 'Activos corrientes', esResumen: true },
  { codigo: '1.1.1', nombre: 'Efectivo y equivalentes', esResumen: true },
  { codigo: '1.1.1.01', nombre: 'Caja', alias: 'CAJA', rubro: 'EFECTIVO_EQUIVALENTES' },
  { codigo: '1.1.1.02', nombre: 'Banco cuenta corriente', alias: 'BANCOS', rubro: 'EFECTIVO_EQUIVALENTES' },
  { codigo: '1.1.1.03', nombre: 'Banco cuenta ahorro', rubro: 'EFECTIVO_EQUIVALENTES' },
  { codigo: '1.1.2', nombre: 'Cuentas por cobrar comerciales', esResumen: true },
  { codigo: '1.1.2.01', nombre: 'Clientes / deudores por ventas', alias: 'CLIENTES', rubro: 'DEUDORES_COMERCIALES' },
  { codigo: '1.1.2.02', nombre: 'Honorarios por cobrar', rubro: 'DEUDORES_COMERCIALES' },
  { codigo: '1.1.2.03', nombre: 'Deudores varios', rubro: 'DEUDORES_COMERCIALES' },
  { codigo: '1.1.3', nombre: 'Otros activos corrientes', esResumen: true },
  { codigo: '1.1.3.01', nombre: 'Anticipos y depósitos', rubro: 'OTROS_ACTIVOS_CTES' },
  { codigo: '1.1.3.02', nombre: 'IVA crédito fiscal', alias: 'IVA_CREDITO', rubro: 'OTROS_ACTIVOS_CTES' },
  { codigo: '1.1.3.03', nombre: 'PPM pagado por adelantado', rubro: 'OTROS_ACTIVOS_CTES' },
  { codigo: '1.2', nombre: 'Activos no corrientes', esResumen: true },
  { codigo: '1.2.1', nombre: 'Propiedad, planta y equipo', esResumen: true },
  { codigo: '1.2.1.01', nombre: 'Terrenos', rubro: 'PYE' },
  { codigo: '1.2.1.02', nombre: 'Construcciones', rubro: 'PYE' },
  { codigo: '1.2.1.03', nombre: 'Maquinarias y equipos', rubro: 'PYE' },
  { codigo: '1.2.1.04', nombre: 'Vehículos', rubro: 'PYE' },
  { codigo: '1.2.1.05', nombre: 'Mobiliario e instalaciones', rubro: 'PYE' },
  { codigo: '1.2.1.06', nombre: 'Equipos informáticos', rubro: 'PYE' },
  { codigo: '1.2.2', nombre: 'Depreciación acumulada', esResumen: true },
  { codigo: '1.2.2.01', nombre: 'Depreciación acumulada', alias: 'DEPRECIACION_ACUMULADA', rubro: 'PYE' },
  { codigo: '1.2.3', nombre: 'Intangibles', esResumen: true },
  { codigo: '1.2.3.01', nombre: 'Software, marcas y llaves', rubro: 'INTANGIBLES' },

  // ===== 2 PASIVOS =====
  { codigo: '2', nombre: 'PASIVOS', esResumen: true },
  { codigo: '2.1', nombre: 'Pasivos corrientes', esResumen: true },
  { codigo: '2.1.1', nombre: 'Cuentas por pagar comerciales', esResumen: true },
  { codigo: '2.1.1.01', nombre: 'Proveedores', alias: 'PROVEEDORES', rubro: 'CXP_COMERCIALES' },
  { codigo: '2.1.1.02', nombre: 'Honorarios por pagar (boletas recepcionadas)', rubro: 'CXP_COMERCIALES' },
  { codigo: '2.1.2', nombre: 'Impuestos por pagar', esResumen: true },
  { codigo: '2.1.2.01', nombre: 'IVA débito fiscal', alias: 'IVA_DEBITO', rubro: 'OBLIGACIONES_TRIBUTARIAS' },
  { codigo: '2.1.2.02', nombre: 'Impuesto F29 por pagar', alias: 'F29_POR_PAGAR', rubro: 'OBLIGACIONES_TRIBUTARIAS' },
  { codigo: '2.1.2.03', nombre: 'PPM por pagar', alias: 'PPM_POR_PAGAR', rubro: 'OBLIGACIONES_TRIBUTARIAS' },
  { codigo: '2.1.3', nombre: 'Remuneraciones por pagar', esResumen: true },
  { codigo: '2.1.3.01', nombre: 'Sueldos por pagar', alias: 'REMUNERACIONES_POR_PAGAR', rubro: 'OTRAS_CXP' },
  { codigo: '2.1.3.02', nombre: 'Cotizaciones previsionales por pagar', rubro: 'OTRAS_CXP' },
  { codigo: '2.1.3.03', nombre: 'Impuesto único por pagar', rubro: 'OTRAS_CXP' },
  { codigo: '2.1.4', nombre: 'Obligaciones financieras corto plazo', esResumen: true },
  { codigo: '2.1.4.01', nombre: 'Préstamos bancarios corto plazo', rubro: 'OBLIGACIONES_FINANCIERAS' },
  { codigo: '2.1.4.02', nombre: 'Tarjetas de crédito', rubro: 'OBLIGACIONES_FINANCIERAS' },
  { codigo: '2.1.5', nombre: 'Otras cuentas por pagar', esResumen: true },
  { codigo: '2.1.5.01', nombre: 'Acreedores varios', rubro: 'OTRAS_CXP' },
  { codigo: '2.2', nombre: 'Pasivos no corrientes', esResumen: true },
  { codigo: '2.2.1', nombre: 'Obligaciones financieras largo plazo', esResumen: true },
  { codigo: '2.2.1.01', nombre: 'Préstamos bancarios largo plazo', rubro: 'OBLIGACIONES_LARGO_PLAZO' },

  // ===== 3 PATRIMONIO =====
  { codigo: '3', nombre: 'PATRIMONIO', esResumen: true },
  { codigo: '3.1', nombre: 'Capital y reservas', esResumen: true },
  { codigo: '3.1.1', nombre: 'Capital y reservas', esResumen: true },
  { codigo: '3.1.1.01', nombre: 'Capital', alias: 'CAPITAL', rubro: 'CAPITAL_EMITIDO' },
  { codigo: '3.1.1.02', nombre: 'Reservas', rubro: 'RESERVAS' },
  { codigo: '3.2', nombre: 'Resultados', esResumen: true },
  { codigo: '3.2.1', nombre: 'Resultados', esResumen: true },
  { codigo: '3.2.1.01', nombre: 'Resultados acumulados de ejercicios anteriores', alias: 'RESULTADO_ACUMULADO', rubro: 'RESULTADOS_ACUMULADOS' },
  { codigo: '3.2.2.01', nombre: 'Resultado del ejercicio', alias: 'RESULTADO_EJERCICIO', rubro: 'RESULTADO_EJERCICIO' },

  // ===== 4 INGRESOS =====
  { codigo: '4', nombre: 'INGRESOS', esResumen: true },
  { codigo: '4.1', nombre: 'Ingresos operacionales', esResumen: true },
  { codigo: '4.1.1', nombre: 'Ventas', esResumen: true },
  { codigo: '4.1.1.01', nombre: 'Ventas netas de bienes', alias: 'VENTAS_BIENES', rubro: 'INGRESOS_ORDINARIOS' },
  { codigo: '4.1.1.02', nombre: 'Ventas netas de servicios', alias: 'VENTAS_SERVICIOS', rubro: 'INGRESOS_ORDINARIOS' },
  { codigo: '4.2', nombre: 'Otros ingresos', esResumen: true },
  { codigo: '4.2.1', nombre: 'Otros ingresos', esResumen: true },
  { codigo: '4.2.1.01', nombre: 'Ingresos financieros (intereses ganados)', rubro: 'OTROS_INGRESOS' },
  { codigo: '4.2.1.02', nombre: 'Otros ingresos varios', rubro: 'OTROS_INGRESOS' },
  { codigo: '4.2.1.03', nombre: 'Utilidad en venta de activos fijos', alias: 'UTILIDAD_VENTA_ACTIVO', rubro: 'OTROS_INGRESOS' },

  // ===== 5 COSTOS =====
  { codigo: '5', nombre: 'COSTOS', esResumen: true },
  { codigo: '5.1', nombre: 'Costos operacionales', esResumen: true },
  { codigo: '5.1.1', nombre: 'Costos', esResumen: true },
  { codigo: '5.1.1.01', nombre: 'Costo de ventas de bienes', alias: 'COSTO_BIENES', rubro: 'COSTO_VENTAS' },
  { codigo: '5.1.1.02', nombre: 'Costo de servicios prestados', alias: 'COSTO_SERVICIOS', rubro: 'COSTO_VENTAS' },

  // ===== 6 GASTOS =====
  { codigo: '6', nombre: 'GASTOS', esResumen: true },
  { codigo: '6.1', nombre: 'Gastos operacionales', esResumen: true },
  { codigo: '6.1.1', nombre: 'Personal y remuneraciones', esResumen: true },
  { codigo: '6.1.1.01', nombre: 'Sueldos y jornales', alias: 'GASTO_SUELDOS', rubro: 'GASTO_PERSONAL' },
  { codigo: '6.1.1.02', nombre: 'Cotizaciones patronales (cargas)', rubro: 'GASTO_PERSONAL' },
  { codigo: '6.1.1.03', nombre: 'Honorarios profesionales', alias: 'GASTO_HONORARIOS', rubro: 'GASTO_PERSONAL' },
  { codigo: '6.1.2', nombre: 'Administración', esResumen: true },
  { codigo: '6.1.2.01', nombre: 'Arriendos', alias: 'GASTO_ARRIENDO', rubro: 'GASTO_ADMINISTRACION' },
  { codigo: '6.1.2.02', nombre: 'Servicios básicos (luz, agua, gas)', alias: 'GASTO_SERVICIOS_BASICOS', rubro: 'GASTO_ADMINISTRACION' },
  { codigo: '6.1.2.03', nombre: 'Telefonía e internet', rubro: 'GASTO_ADMINISTRACION' },
  { codigo: '6.1.2.04', nombre: 'Insumos y materiales', rubro: 'GASTO_ADMINISTRACION' },
  { codigo: '6.1.2.05', nombre: 'Mantenimiento y reparaciones', rubro: 'GASTO_ADMINISTRACION' },
  { codigo: '6.1.2.06', nombre: 'Gastos de representación', rubro: 'GASTO_ADMINISTRACION' },
  { codigo: '6.1.3', nombre: 'Comerciales y ventas', esResumen: true },
  { codigo: '6.1.3.01', nombre: 'Publicidad y marketing', rubro: 'GASTO_VENTAS' },
  { codigo: '6.1.3.02', nombre: 'Transporte y distribución', rubro: 'GASTO_VENTAS' },
  { codigo: '6.1.4', nombre: 'Tributarios', esResumen: true },
  { codigo: '6.1.4.01', nombre: 'PPM (pago provisional mensual)', alias: 'GASTO_PPM', rubro: 'GASTOS_TRIBUTARIOS' },
  { codigo: '6.1.4.02', nombre: 'Multas e intereses tributarios', rubro: 'GASTOS_TRIBUTARIOS' },
  { codigo: '6.1.5', nombre: 'Seguros y otros', esResumen: true },
  { codigo: '6.1.5.01', nombre: 'Seguros', rubro: 'OTROS_GASTOS' },
  { codigo: '6.1.5.02', nombre: 'Otros gastos operacionales', rubro: 'OTROS_GASTOS' },
  { codigo: '6.1.5.03', nombre: 'Pérdida en venta o baja de activos fijos', alias: 'PERDIDA_BAJA_ACTIVO', rubro: 'OTROS_GASTOS' },
  { codigo: '6.2', nombre: 'Gastos financieros', esResumen: true },
  { codigo: '6.2.1', nombre: 'Gastos financieros', esResumen: true },
  { codigo: '6.2.1.01', nombre: 'Intereses pagados', rubro: 'GASTOS_FINANCIEROS' },
  { codigo: '6.2.1.02', nombre: 'Comisiones bancarias', alias: 'GASTO_BANCO', rubro: 'GASTOS_FINANCIEROS' },
  { codigo: '6.3', nombre: 'Depreciaciones', esResumen: true },
  { codigo: '6.3.1', nombre: 'Depreciaciones', esResumen: true },
  { codigo: '6.3.1.01', nombre: 'Depreciación del ejercicio', alias: 'GASTO_DEPRECIACION', rubro: 'DEPRECIACION_AMORTIZACION' },
]

/** Deriva clase/naturaleza/cierre desde el código. */
function clasificar(codigo) {
  const clase = Number(String(codigo).charAt(0))
  if (!NATURALEZA[clase]) throw new Error(`Clase de cuenta inválida: ${codigo} (debe empezar por 1-6)`)
  return { clase, naturaleza: NATURALEZA[clase], cierre: CIERRE[clase] }
}

module.exports = { PLANTILLA, clasificar, NATURALEZA, CIERRE }
