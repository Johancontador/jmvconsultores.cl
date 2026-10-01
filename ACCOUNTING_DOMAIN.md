# ACCOUNTING_DOMAIN — Dominio contable del software JMV Consultores

> Fecha: 2026-10-01 · Rol: Arquitecto + Contador Auditor. Este documento fija el **lenguaje del dominio** (ubícuous language) y las reglas contables que el software implementará.
> Regla del PROMPT MAESTRO: **no inventar reglas legales** — lo aquí definido son convenciones contables estándar y criterios de diseño; las tasas, plazos y obligaciones legales vigentes se parametrizan en configuración y se citan como referencia, no se codifican a mano alzada.

---

## 1. Los tres niveles de información (principio fundamental)

```text
┌────────────────────────────────────────────────────────────────┐
│ TRIBUTARIO (lo que el SII declara y conoce)                    │
│   RCV, F29, PPM, documentos electrónicos                       │
│   Fuente: integración SII existente. NO se modifica.           │
├────────────────────────────────────────────────────────────────┤
│ CONTABLE (lo que la contabilidad de la empresa declara)        │
│   Plan de cuentas, asientos, diario, mayor, centros de costo   │
│   Fuente: software contable (nuevo).                           │
├────────────────────────────────────────────────────────────────┤
│ FINANCIERO (lo que se puede concluir de lo contable)           │
│   Balance de comprobación, situación financiera, resultados    │
│   Fuente: derivado de lo contable, nunca digitado.             │
└────────────────────────────────────────────────────────────────┘
```

- Un documento del SII es **evidencia**, no un asiento. Un asiento puede no tener documento SII (asiento de apertura, depreciación, ajustes). La conciliación compara ambos mundos y **reporta** diferencias, jamás las corrige en silencio.
- Las cuentas se clasifican además con **naturaleza financiera** (activo/pasivo/patrimonio/ingreso/costo/gasto) para los estados financieros, independientemente de cómo tributen. Ejemplo: el IVA crédito fiscal es tributariamente recuperable, pero contablemente es un **activo** (impuestos por recuperar).

## 2. Entidades del dominio y su vocabulario

| Entidad | Definición |
|---|---|
| **Empresa** | Persona jurídica o natural con contabilidad propia y aislada. Unidad de aislamiento total. |
| **Período contable** | Mes calendario tributario (AAAAMM) dentro de una empresa, con estado abierto/cerrado. |
| **Plan de cuentas** | Catálogo jerárquico de cuentas de la empresa. |
| **Cuenta** | Unidad de acumulación contable, con clase, naturaleza, nivel y comportamiento de cierre. |
| **Centro de costo** | Dimensión analítica opcional de gasto (línea de negocio, sucursal, administración). |
| **Documento** | DTE u otro comprobante, con ciclo de vida propio (bandeja). |
| **Regla contable** | Instrucción configurable que transforma documento(s) en propuesta de asiento. |
| **Propuesta** | Asiento pre-validado, pendiente de confirmación humana. |
| **Asiento** | Registro contable en partida doble; unidad atómica e inmodificable del diario. |
| **Línea de asiento** | Débito o crédito a una cuenta, con monto entero y descripción. |
| **Diario** | Listado cronológico de asientos. |
| **Mayor** | Agregación de líneas por cuenta. |
| **Cierre** | Proceso que congela un período: bloquea mutaciones y genera asientos de cierre. |

## 3. Plan de cuentas: clases, codificación y diseño

Codificación decimal chilena estándar (no inventada, uso común del gremio):

```text
1. ACTIVOS            1.1 Corrientes (caja, bancos, deudores, IVA crédito, PPM)
                      1.2 No corrientes (activos fijos, depreciación acumulada)
2. PASIVOS            2.1 Corrientes (proveedores, remuneraciones por pagar, IVA débito, F29 por pagar)
                      2.2 No corrientes (préstamos LP)
3. PATRIMONIO         capital, reservas, resultados acumulados
4. INGRESOS           4.1 Operacionales (ventas netas)  4.2 No operacionales
5. COSTOS             costo de ventas, servicios prestados
6. GASTOS             6.1 Operacionales (sueldos, honorarios, arriendo, luz...)
                      6.2 Financieros  6.3 Impuestos (PPM, renta)  6.4 Depreciaciones
7. (libre / analíticas por empresa)
```

Reglas estructurales que el software valida:

1. Toda cuenta tiene: código único por empresa, nombre, clase (1–6), naturaleza (deudora/acreedora), tipo (resumen o movimiento), y **cuenta de cierre** (resultado → patrimonio) o de balance.
2. Las cuentas **resumen** (ej. 1.1) no reciben movimientos; solo las **de movimiento** (imputables) reciben líneas.
3. Jerarquía por prefijo de código: el saldo de un resumen = suma de sus hijos de movimiento.
4. El plan viene de una **plantilla PUC simplificada chilena** precargada al crear la empresa, editable por quien tenga permiso. Nunca se eliminan cuentas con movimientos: se desactivan.
5. Cuentas obligatorias de control interno que el sistema exige existan y las usa por código reservado (mapping configurable, ej. `IVA_CREDITO`, `IVA_DEBITO`, `PROVEEDORES`, `CLIENTES`, `BANCOS`, `PPM_POR_PAGAR`, `RESULTADO_EJERCICIO`): las reglas y cierres las buscan por este alias, no por código rígido.

## 4. Partida doble — reglas del núcleo

1. Un asiento tiene ≥ 2 líneas; **Σ débitos = Σ créditos** (validación atómica, montos INTEGER en pesos).
2. Toda línea indica: cuenta imputable, monto entero positivo, debe/haber, y opcionalmente centro de costo y glosa.
3. El asiento indica: fecha (dentro de un período abierto), tipo (manual, automático-desde-documento, ajuste, reversión, cierre, apertura), origen (documento o usuario), glosa.
4. **Inmutabilidad**: un asiento registrado no se edita ni elimina. Corrección = asiento de reversión que lo referencia. El estado `ANULADO` conserva el original para trazabilidad.
5. Numeración correlativa por empresa y año (folios contables), sin huecos lógicos.
6. Un asiento con fecha en período cerrado es rechazado por el núcleo (defensa, no solo UI).
7. Reversibilidad controlada: solo el último asiento de una cadena puede revertirse directamente; reversiones quedan marcadas para no revertirse en cascada.

## 5. Ciclo de vida del documento (estados y transiciones)

Estados (PROMPT MAESTRO §10, sin cambios):

```text
RECIBIDO → PENDIENTE → CLASIFICADO → PROPUESTO → CONTABILIZADO
                        │                        │
                        └──► REVISIÓN ◄──────────┘ (diferencias o rechazo)
ERROR (falla de ingesta/validación)    ANULADO (NC/anulación)
```

Transiciones válidas (máquina de estados en `documentos/bandeja.js`):

- RECIBIDO→PENDIENTE: ingesta verificada (dedupe ok, montos íntegros).
- PENDIENTE→CLASIFICADO: clasificación manual o regla automática (cuenta imputable + CC).
- CLASIFICADO→PROPUESTO: motor genera propuesta de asiento con la regla.
- PROPUESTO→CONTABILIZADO: confirmación (por usuario con permiso) ejecuta el asiento en transacción y guarda `asiento_id` en el documento.
- →REVISIÓN: cualquier divergencia (total documento ≠ Σ montos, IVA incoherente con tasa, duplicado sospechoso, monto 0, regla ambigua).
- →ANULADO: solo por documento inverso (NC) o anulación explícita auditada; **nunca** un delete físico.
- Un documento CONTABILIZADO no vuelve a PROPUESTO: su corrección es asiento de reversión + nueva propuesta.

## 6. Motor de reglas contables (diseño funcional)

Objetivo: transformar documentos en propuestas con **cero digitación** en el caso común. Una regla tiene:

```text
CUANDO (condiciones, todas combinables)
  - RUT contraparte (o patrón de razón social)      - Tipo de DTE (33, 34, 39, 41, 56, 61...)
  - Glosa/descripción contiene (texto)              - Monto en rango
  - Sin clasificación previa (catch-all)
ENTONCES
  - Cuenta imputable (de gasto/activo/costo según DTE)
  - Centro de costo (opcional, default por empresa)
  - Tratamiento IVA: crédito fiscal (33/34) / sin crédito (34 exento, boleta) / uso común / no recuperable
  - Cuenta contraparte: PROVEEDORES (compra) — en ventas: CLIENTES o CAJA/BANCOS
  - Prioridad (orden de evaluación) + estado activa/inactiva
```

- **Orden de evaluación**: prioridad descendente; la primera regla que calza gana; las reglas registran cuál se aplicó en el documento (auditable).
- **Aprendizaje simple**: al clasificar manualmente un documento, el sistema ofrece "crear regla desde esta clasificación" (RUT + tipo DTE → cuenta + CC). No hay IA mágica: hay reglas explícitas, visibles y editables.
- **Catch-all por tipo de DTE** (ej. "toda factura de compra → gasto de administración, pendiente de reclasificar") para maximizar automatización inicial, con marca `REVISIÓN` opcional.
- La propuesta para una factura de compra con IVA (ejemplo del PROMPT MAESTRO): Debe: cuenta imputable (neto) + IVA crédito fiscal (IVA); Haber: Proveedores (total). Con NC se invierten los signos conservando la partida doble.

## 7. Períodos y cierres

- Período = mes tributario (AAAAMM) por empresa; estado: ABIERTO / CERRADO.
- **Cierre de período** (permiso `periodos:cerrar`): verifica precondiciones y congela:
  1. Sin documentos PENDIENTE/CLASIFICADO/PROPUESTO/REVISIÓN del período (o confirmación explícita de dejarlos fuera).
  2. Conciliación SII ↔ contabilidad ejecutada y diferencias listadas (no necesariamente en $0, pero visibles).
  3. Generación de asientos de cierre: IVA determinado → cuenta F29 por pagar; PPM devengado → PPM por pagar; **saldo de cuentas de resultados → Resultado del ejercicio (patrimonio)**.
  4. El período pasa a CERRADO; toda mutación con fecha anterior queda bloqueada por el núcleo.
- **Reapertura**: evento excepcional, permiso distinto, auditado con motivo obligatorio; genera nota en la auditoría y re-ejecuta cierres posteriores si el cierre lo requiere (fase avanzada; en MVP la reapertura solo permite asientos de ajuste fechados en el período abierto corriente).

## 8. Reportes financieros (definición de cálculo)

Todos derivados de `asiento_lineas` + plan de cuentas; **ninguno digitado**:

- **Balance de comprobación y sumas**: por cuenta y período: débitos, créditos, saldo; verificación ΣD = ΣC.
- **Estado de situación financiera** (Balance): activos (clase 1), pasivos (clase 2), patrimonio (clase 3 + resultado del ejercicio desde cuentas 4/5/6 por naturaleza). Ecuación verificada: A = P + Patrimonio.
- **Estado de resultados**: ingresos (4) − costos (5) − gastos (6) = resultado del período, con acumulado año.
- **Mayor por cuenta**: T-account con saldo corrido.
- Comparativos por período (mes vs mes, acumulado vs acumulado) como capa de presentación.

## 9. Conciliación SII ↔ contabilidad (definición)

Por empresa y período, comparar por triplo (tipo DTE, folio, RUT contraparte):

1. Documentos en SII (fuente: caché/ingesta) vs documentos contabilizados (documentos con asiento).
2. Diferencias tipificadas: `SOLO_SII` (no contabilizado), `SOLO_CONTABLE` (asiento sin documento SII — legítimo para ajustes), `MONTO_DIVERGENTE`, `IMPUESTO_DIVERGENTE`.
3. Totales: IVA débito/crédito tributario vs contable, ventas y compras netas.
4. Resultado visible en dashboard contable y condición previa del cierre (§7).

## 10. Impuestos en el dominio contable (separación tributaria)

- IVA débito y crédito fiscal son **cuentas de control**, no de resultado; su saldo se liquida al cierre contra `F29 por pagar` (pasivo) o remanente (activo).
- PPM devengado mensualmente: gasto (6.3) contra PPM por pagar (pasivo); su uso real contra F29 es tributario, no contable.
- Los montos "extras" del SII (IVA uso común, no recuperable) se modelan como atributo del documento y determinan la cuenta de IVA en la regla — la decisión fina (proporcionalidad) es humana y queda en REVISIÓN si la regla no la resuelve.
- Tasas y valores legales (19%, PPM art. 14, interés art. 53) viven en **configuración por empresa/período**, citados como referencia legal en docs, no hardcodeados en el núcleo.

## 11. NIIF/IFRS — consideración temprana (no implementación en MVP)

- El plan de cuentas chileno ya usado es compatible con la estructura NIIF básica (activos/pasivos/patrimonio/ingresos/gastos); la fase 8 añadirá: mapeo de cuentas locales → rubros NIIF, devengo de depreciación estándar, y presentación de estados con formatos NIIF. El diseño de datos (naturaleza financiera por cuenta) ya reserva esa evolución.

## 12. Geo Daniela (remuneraciones) — solo contrato de entrada

Fuera de alcance total como funcionalidad (PROMPT MAESTRO §2.C). Única reserva de diseño: el núcleo acepta **asientos externos** (`tipo='externo'`, `origen='geodaniela'`) que lleguen ya cuadrados por partida doble, con período abierto y validación idéntica a cualquier asiento. Contrato detallado en [INTEGRATIONS.md](INTEGRATIONS.md) §4.

---

Contratos de datos concretos de estas entidades: [DATA_MODEL.md](DATA_MODEL.md). Orden de construcción y criterios de aceptación: [ROADMAP.md](ROADMAP.md).
