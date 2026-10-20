# MANUAL DEL SOFTWARE CONTABLE JMV

> Manual de funcionalidades y procedimientos paso a paso · Fecha: 2026-10-03 ·
> Versión del sistema: fases 1–9 + SAAS completas, suite 214 tests verdes.
> Documentos complementarios: [CURRENT_STATE](../CURRENT_STATE.md) (estado real del código),
> [ROADMAP](../ROADMAP.md) (plan e historia de fases), [ARCHITECTURE](../ARCHITECTURE.md),
> [ACCOUNTING_DOMAIN](../ACCOUNTING_DOMAIN.md), [DATA_MODEL](../DATA_MODEL.md),
> [INTEGRATIONS](../INTEGRATIONS.md), [SAAS-ACCESO](SAAS-ACCESO.md),
> [DESPLIEGUE](DESPLIEGUE.md), [SEGURIDAD](SEGURIDAD.md).

---

## 1. Qué es el sistema (una página)

**Software contable multiempresa en partida doble** para JMV Consultores, con
integración al SII chileno (RCV), automatización de contabilización, tesorería,
activos fijos, presentación NIIF y licencias por empresa con cobro self-service.

- **Quién lo usa:** el dueño de una pyme (rol `admin_empresa`), el contador JMV
  (rol `contador`), el auditor (solo lectura), tesorería (operación de bancos) y
  el super administrador (JMV, todo).
- **Regla central:** NADA vive fuera de los libros. Cada pago, cobro,
  transferencia, depreciación o baja genera un **asiento de partida doble** real
  (Σdebe = Σhaber verificado antes de guardar). Los reportes nunca se digitan:
  se derivan 100% de `asiento_lineas`.
- **Confirmación humana SIEMPRE:** la automatización solo PROPONE. Contabilizar,
  depreciar, cerrar o emitir un DTE requiere un clic humano auditable.
- **Las conciliaciones REPORTAN, jamás corrigen en silencio:** SII↔contable y
  banco↔libro muestran diferencias explicadas; el ajuste, si procede, es un
  asiento manual del contador.
- **Cero scraping:** el SII se consume por vías ya existentes (sesión RCV); las
  cartolas bancarias entran como ARCHIVO que el humano descarga.

---

## 2. Roles y permisos

Los permisos son **capacidades nombradas** (ej. `asientos:crear`), no nombres de
rol — ver el catálogo completo en `backend/core/permisos.js`. Resumen operativo:

| Módulo | contador | admin_empresa (dueño) | auditor | tesorería | super_admin |
|---|---|---|---|---|---|
| Empresas, usuarios, períodos | gestionar | ver su empresa | ver | ver | todo |
| SII / Bandeja (ingestar, clasificar, reglas) | sí | ingesta del histórico + ver | ver | ver | sí |
| Automatización del período | ejecutar | — | — | — | sí |
| Propuestas (contabilizar) | sí | ver | ver | ver | sí |
| Conciliación SII | ejecutar | ver | ver | ver | sí |
| Asientos (crear, revertir) | sí | ver | ver | ver | sí |
| Tesorería (pagos, cobros, conciliar banco) | sí | — | solo ver | sí | sí |
| Activos fijos y depreciación | sí | ver | ver | ver | sí |
| NIIF (mapeo) | editar mapeo | ver | ver | ver | sí |
| Reportes y cierre de período | sí | ver | ver | ver | sí |
| Suscripción y pagos | ver | **pagar** | ver | ver | sí |
| Factura electrónica (DTE) | emitir | — | — | — | sí |
| Onboarding | ejecutar | ejecutar | — | — | sí |

**El gate de licencia** bloquea ESCRITURAS (HTTP 402) de empresas sin licencia
operativa; la lectura nunca se bloquea. Excepción de diseño: **pagar la
suscripción nunca queda bloqueado por la propia licencia** (una empresa
suspendida debe poder reactivarse sola).

---

## 3. Inicio rápido

### 3.1 Entrar al sistema

1. Abrir `https://app.jmvconsultores.cl` (o el dominio configurado).
2. Login con usuario y contraseña (landing pública con login embebido).
3. El selector de empresa (arriba a la derecha) cambia de empresa si el usuario
   tiene acceso a varias. Todo lo que se ve pertenece a la empresa activa.

### 3.2 Crear cuenta nueva (self-service)

1. En la landing, "Crear cuenta" → `/registro.html`.
2. Ingresar usuario, contraseña, **RUT de la empresa** y **clave SII**.
3. El sistema valida el par RUT+clave **en vivo contra el SII** (sin scraping):
   - Clave válida → crea empresa + plan de cuentas PUC + rol dueño + **licencia
     PRUEBA de 90 días** en una sola transacción.
   - Clave inválida → NO se crea nada (evita empresas fantasma).
4. Una sola prueba por RUT. El banner de la app muestra el countdown.

### 3.3 Onboarding autónomo (conectar el histórico)

1. Menú **Empresa → Onboarding desde el SII**.
2. Revisar el checklist ✓/⚠ (automático vs. pendiente humano).
3. **Consultar SII**: la sesión RCV válida propone la razón social; el **inicio
   de actividades** se deriva de la primera venta del RCV. Confirmar la ficha.
4. Lo que el SII no entrega por vía existente (actividades, régimen, socios) se
   llena en el formulario — **jamás se adivina**.
5. **Ingesta del histórico**: elegir cuántos períodos (1–24) hacia atrás y
   ejecutar. Job en background con barra de progreso; re-corridas no duplican
   (dedupe idempotente por documento). El dueño no necesita a JMV para esto.

---

## 4. Funcionalidades y procedimientos paso a paso

### 4.1 Inicio — panel del período

**Qué muestra:** KPIs financieros del período (ingresos/costos/gastos/resultado
mes y acumulado), IVA determinado, CxP/CxC, estado de documentos, asientos del
período con ΣD=ΣH verificado, conciliación del período, serie de 6 meses y
**alertas accionables ordenadas por severidad** (cada alerta nombra el problema
verificado en BD, el porqué y el botón que lleva a la vista destino).

**Cómo usarlo:** resolver de arriba hacia abajo las alertas (error de ingesta →
sin reglas → sin clasificar → en revisión → listos para contabilizar →
conciliación → período anterior sin cerrar). Si todo está al día, la alerta
residual propone **cerrar el período**.

### 4.2 SII — Libros de Compras y Ventas (RCV)

1. Menú **SII → Libros de Compras y Ventas**.
2. Elegir período. El libro se llena desde el RCV del SII ya ingestado en la
   bandeja (ver 4.3) — no se consulta al SII en vivo aquí.
3. Totales por tipo de documento y la base para el IVA determinado.

### 4.3 SII — Bandeja de Documentos

**Ciclo de vida de un documento:**
`RECIBIDO` (reservado) → ingesta lo inserta como `PENDIENTE` → clasificado
(`CLASIFICADO` o `REVISIÓN` si no cuadra) → propuesta (`PROPUESTO`) →
`CONTABILIZADO` (con su asiento) → o `ANULADO` (anulación lógica, auditada,
nunca física). Monto 0 → `REVISIÓN` obligatoria.

**Procedimiento de ingesta:**
1. Botón de ingesta → elegir período → el sistema consulta `rcv.consultarRCV`
   existente y llena la bandeja en background (con progreso).
2. Re-ingesta del mismo período = 0 duplicados (dedupe SHA-256 de
   rut|flujo|tipo|folio|período).

**Clasificación:**
1. Abrir un documento PENDIENTE → diálogo de clasificación: cuenta contable,
   centro de costo, tratamiento de IVA, contraparte.
2. Marcar **"Recordar para este proveedor"** → crea una regla RUT+DTE+flujo
   (prioridad 50) que clasifica solo el próximo mes.
3. Clasificación automática en lote: el motor de reglas por prioridad DESC
   aplica las que corresponden; nunca pisa decisiones humanas ya tomadas.

### 4.4 Automatización del período (pipeline "cero digitación")

1. Menú **Contabilizaciones → Automatización del período**.
2. (Primera vez) Instalar **semilla de reglas**: venta catch-all →
   VENTAS_SERVICIOS, compra catch-all → GASTO_SERVICIOS_BASICOS, NC de compra
   sin crédito. Idempotente y auditada.
3. **Ejecutar**: en UNA operación hace
   (1) clasificar con reglas solo lo PENDIENTE/REVISIÓN,
   (2) generar propuestas de todo CLASIFICADO,
   (3) contabilizar en lote (confirmación humana ya dada por el botón).
4. El resumen muestra KPIs por eslabón y el detalle de omitidos con motivo
   (p. ej. documentos REVISIÓN que necesitan decisión humana).

### 4.5 Propuestas y Conciliación

**Contabilizar propuestas:**
1. Menú **Contabilizaciones → Propuestas y Conciliación**.
2. Cada propuesta es un **snapshot congelado**: confirmar aplica exactamente lo
   propuesto (nunca regenera). Vista previa de partidas + fecha opcional
   (por defecto, fecha de documento = devengo).
3. **Confirmar** individual o **confirmar lote** (los fallidos se omiten y se
   reportan — p. ej. período cerrado — sin quedar a medias).
4. **Descartar** devuelve el documento a CLASIFICADO.
5. Si un asiento contabilizado se revierte, se puede **re-proponer** el mismo
   documento (el sistema lo detecta por el vínculo del asiento).

**Conciliación SII ↔ contable (report-only):**
1. Ejecutar conciliación del período → compara documento por documento vía el
   vínculo del asiento (soporta devengo cruzado de período sin falsos positivos).
2. Diferencias reportadas: `SOLO_SII` (no contabilizado), `MONTO_DIVERGENTE`,
   `IMPUESTO_DIVERGENTE` (IVA por alias con signo de NC correcto).
3. Los asientos sin documento NO son diferencias (ajustes_sin_documento).
4. Opcional: comparar contra el resumen oficial del SII.
5. La corrección es SIEMPRE una decisión del contador; el sistema reporta.

### 4.6 Asientos — Diario, Mayor y Plan

- **Diario** (`asientos:ver`): asientos del período con folio correlativo,
  tipo (manual/propuesta/automatico/cierre/apertura/externo) y origen.
- **Mayor**: saldos por cuenta, filtro por RUT de contraparte (documento
  contabilizado o pago de tesorería).
- **Plan de cuentas** (PUC chileno precargado): crear cuentas y centros de
  costo (`cuentas:editar`). Cada cuenta tiene naturaleza, clase, alias de
  control (p. ej. `IVA_DEBITO`, `PROVEEDORES`) y rubro NIIF.
- **Revertir asiento** (`asientos:revertir`): crea el asiento de reversión
  cuadrado a cero; el original queda referenciado. Períodos cerrados se
  rechazan (reabrir es un evento excepcional auditado).
- **Crear asiento manual** (`asientos:crear`): líneas con una pata cada una,
  Σdebe = Σhaber obligatorio, período abierto con autocreación.

### 4.7 Tesorería

**Bancos:**
1. Menú **Tesorería → pestaña Bancos** → registrar cuenta bancaria: banco,
   número, y su cuenta contable del plan (clase 1). El **saldo inicial** se
   contabiliza como asiento de apertura (banco↔patrimonio) — sin él, libro y
   mayor divergen.

**Libro banco (pagos, cobros, transferencias):**
1. Pestaña **Libro banco** → registrar pago o cobro: fecha, monto, glosa y
   contraparte por precedencia: documento aplicado (línea proveedor/cliente de
   su asiento) > cuenta explícita (p. ej. comisión bancaria) > alias
   PROVEEDORES/CLIENTES.
2. Cada movimiento genera SU asiento de partida doble en la misma transacción:
   egreso = negativo en el libro, con su folio visible.
3. **Transferencia** entre cuentas: UN asiento con las dos patas bancarias.

**Conciliación bancaria (report-only):**
1. Pestaña **Conciliación** → pegar CSV del banco o **importar archivo**:
   - CSV (`;`, `,` o tab, con comillas) o **XLSX** — detección automática:
     - por **nombres de encabezado** (fecha/monto/cargo/abono/glosa…), o
     - por **estructura estadística** (funciona sin fila de encabezado).
   - Montos chilenos: `$1.234.567`, `-$56.789`, `1.234,56`, `(2.500)` = negativo.
   - Fechas: Date de Excel, ISO, DD/MM/YYYY, DD-MM-YY, serial Excel. Rechaza
     fechas inexistentes (31/02).
2. Si el formato no se reconoce: preview con filas vacías → **mapear columnas
   manualmente** (fecha/monto/cargo/abono/glosa, fila de inicio) y opcionalmente
   **guardar el formato con un nombre** (queda por empresa para siempre).
   Los formatos guardados aparecen listados bajo el selector de archivo con sus
   columnas descritas (`fecha col 1 · monto col 2 · glosa col 3 · desde fila 2`):
   **«Usar»** elige uno y, al analizar el archivo, ese mapeo manda sobre la
   detección automática. Elegir un formato **no importa nada**: primero ves la
   preview y solo después confirmas la importación.
3. Importar → dedupe idempotente (re-importar la misma cartola = 0 duplicados).
4. **Conciliar**: empareja cartola↔libro por monto firmado + ventana ±3 días;
   devuelve lo no conciliado de AMBOS lados y la diferencia libro−cartola con
   flag `cuadrado`. El ajuste, si procede, es un asiento manual — nunca
   automático.

### 4.8 Activos Fijos y Depreciación

1. Menú **Contabilizaciones → Activos Fijos** → registrar activo: código,
   descripción, cuenta imputable (clase 1), fecha/valor de adquisición, vida
   útil (meses), valor residual. Alta contable OPCIONAL (asiento de apertura
   activo↔contraparte) para activos que aún no están en los libros.
2. Pestaña **Depreciación del período**: preparar propone UN asiento con una
   línea por activo en cada pata (línea recta; la cuota final absorbe el
   depreciable exacto sin residuos de redondeo). Omitidos con motivo
   (vendido, no adquirido, ya depreciado, totalmente depreciado, período
   cerrado).
3. **Confirmar** = asiento fechado el último día del período + filas UNIQUE
   activo+período (jamás se deprecia dos veces el mismo mes). Re-confirmar lanza.
4. **Venta o baja**: panel inline con utilidad/pérdida calculada → UN asiento
   que limpia costo y depreciación acumulada y lleva la diferencia a
   UTILIDAD_VENTA_ACTIVO o PERDIDA_BAJA_ACTIVO. El activo deja de depreciarse.

### 4.9 NIIF — Estados por Rubros

1. Menú **Reportes → NIIF**.
2. **Mapeo**: cada cuenta pertenece a UN rubro de presentación (24 rubros). Las
   empresas nacen mapeadas por la plantilla; las cuentas creadas a mano quedan
   `SIN_CLASIFICAR` hasta mapearlas. Guardar envía solo los cambios, en UNA
   transacción auditada.
3. **Situación por rubros**: ESF con PYE neto (la depreciación acumulada se
   pliega en su rubro), patrimonio + resultado del período, ecuación
   A = P + PN verificada.
4. **Resultados por naturaleza**: ingresos/costos/gastos por rubro, mes y
   acumulado.
5. Principio: los estados NUNCA adivinan — una cuenta con movimientos y sin
   rubro aparece en `SIN_CLASIFICAR` (con aviso y conteo) y el cuadre se
   mantiene.

### 4.10 Reportes y Cierre de Período

- **Balance de 8 columnas**: saldos + movimientos del mes con ΣD=ΣC verificado
  y Pérdida/Utilidad (columnas deudor/acreedor por SIGNO del neto).
- **Balance clasificado**: corriente/no corriente, capital de trabajo,
  A = P + P.
- **Situación financiera** y **Estado de resultados** (mes + acumulado).
- **Cuenta corriente clientes/proveedores**: documentos contabilizados y
  pagos/cobros aplicados con saldo corrido.

**Cierre de período (paso a paso):**
1. Menú **Reportes → Cierre de Período** → elegir período.
2. **Checklist**: documentos sin contabilizar BLOQUEAN (salvo `forzar`
   explícito y auditado); la conciliación debe estar ejecutada y visible (sus
   diferencias NO bloquean — se muestran).
3. Asientos de cierre PROPUESTOS por alias de control: IVA determinado →
   F29_POR_PAGAR (el remanente de crédito fiscal lo arrastra el F29), PPM
   devengado (ingresos × tasa de la empresa), resultado acumulado →
   RESULTADO_EJERCICIO. Cada propuesto viene cuadrado y verificado.
4. **Confirmar cierre**: el diálogo muestra el impacto (período, documentos
   pendientes, conciliación, asientos propuestos con sus claves y el total del
   Debe) y exige **teclear el período exacto** para habilitar el botón
   destructivo; «Forzar con pendientes» advierte que se cierra igual y pide la
   misma confirmación. Escape o Cancelar no escriben nada. Al confirmar: UNA
   transacción auditada, asientos fechados el último día del período, período →
   CERRADO y snapshot persistido (consultable después).
5. Tras cerrar, NINGUNA mutación anterior es posible. Reabrir es excepcional y
   auditado (`periodos:reabrir`).

### 4.11 Memoria de Contabilización

- Configuración por empresa: `modo_conciliacion` simple/completa y
  **cuentas regulares** (donde compras y ventas se netean — típico banco de
  empresas pequeñas que no concilian).
- La memoria POR CONTRAPARTE aprende sola: al confirmar propuestas, el RUT
  queda vinculado para el mes siguiente. La precedencia es: regla > memoria
  RUT > cuenta regular > alias. Vista "contrapartes nuevas por ubicar".

### 4.12 Receptor Externo (Geo Daniela u otro sistema de remuneraciones)

**Para el integrador** (contrato completo en INTEGRATIONS §4):
1. `POST /api/contable/asientos-externos` con sesión del remitente +
   `asientos:crear`. Empresa por `empresa_rut` (dentro de las empresas del
   usuario — un remitente de A no puede escribir en B).
2. La centralización llega **ya cuadrada** (Σdebe = Σhaber; el mapa de cuentas
   de remuneraciones vive en Geo Daniela, no aquí). Rechazo COMPLETO 422 con
   `codigo` y lista exacta de códigos inválidos (`validar-codigos` para probar
   sin crear nada).
3. **Idempotencia**: clave explícita del remitente o SHA-256 del payload —
   re-envío responde 200 `deduplicado: true`. Si se envía clave, enviarla SIEMPRE.
4. El asiento queda tipo `externo` con folio correlativo; visible en el diario.

**Para el contador:** vista **Contabilizaciones → Receptor Externo** con el
histórico de centralizaciones recibidas y el contrato visible.

### 4.13 Suscripción y Pagos

1. Menú **Empresa → Suscripción y Pagos**.
2. Estado de la licencia: plan, estado, vencimiento, días restantes, gracia.
3. **Contratar o renovar**: elegir plan (PYME $29.900 / PRO $59.900 /
   DESPACHO $119.900 mensuales, IVA incluido) y período (1/3/12 meses — el
   precio es mensual × meses) → redirige a MercadoPago (Checkout Pro) → al
   aprobarse el pago, el webhook activa la licencia solo. No hay que esperar a
   JMV. El pago funciona incluso con licencia SUSPENDIDA.
4. **Historial de pagos** con estado de su factura.
5. **Factura electrónica (contador/JMV)**: botón "Emitir factura" en un pago
   APROBADO → llenar giro/dirección/comuna del receptor → DTE 33 firmado y
   enviado al SII con folio y track-id. Requiere configuración de emisor
   (ver §5.3); lo que falta se nombra exactamente, nunca se adivina.

### 4.14a Alertas y Cobranza (Fases 1-4 del flujo cliente nuevo)

**El flujo del cliente nuevo (2026-10-10):** el admin crea el usuario de la
empresa (Administración → usuarios temporales); la clave provisional la
manda por WhatsApp; el cliente la cambia en su primer login, entra su
RUT + clave SII, «Sincronizar» arma la empresa con la ficha oficial y el
**histórico de 3 años** se baja solo en background. Inmediatamente ve:

**Alertas (Operación → Alertas):** tres grupos con datos reales de la
bandeja —
- 🚨 **Reclamados** (RCV con `fecha_reclamo`): conflicto formal con la
  contraparte. NO contabilizar como gasto/crédito hasta resolver (el cierre
  los bloquea). Muestra el monto en juego.
- ⚠️ **En revisión / ERROR** y **sin contabilizar** (montos separados).
- 📡 **Sync atrasada**: >30 días sin bajar RCV (o nunca) — advertencia de
  datos viejos, enlaza a la bandejа.

**Cobranza (Operación → Cobranza de Clientes):** la lista de clientes con
saldo pendiente (cuenta corriente de facturas contabilizadas menos cobros),
clasificada por mora: verde (<15 d), amarilla (15–30), roja (>30). Por cada
factura abierta, el botón **«Pagada»** abre una confirmación que dice cliente,
folio, monto, banco, fecha del movimiento y el asiento que se creará (Debe
banco / Haber clientes); al confirmar registra el cobro en la Tesorería
elegida en la propia fila + movimiento aplicado a la factura + auditoría — el
saldo baja al instante y el cliente desaparece de la lista al quedar en cero.
Cancelar no escribe nada. El botón **«Aplicaciones»** de cada factura muestra
con qué movimientos se ha pagado (fecha, glosa, monto y asiento de cada uno) y
el cobrado acumulado, o avisa que aún no tiene aplicaciones.
Cobros PARCIALES o por transferencia no asociada: usaré el flujo normal de
Tesorería → Cobros (el plan B — detección pasiva en cartolas — se conecta
con la conciliación de la FASE 9.2).

**En el Inicio:** el KPI «Cobranza pendiente» (con enlace directo) muestra
el monto total y la cantidad de clientes en mora.

### 4.14 Administración (usuarios, empresas, períodos, auditoría)

- **Empresas** (super_admin): crear con RUT válido (módulo 11) + clave SII
  (cifrada AES-256-GCM en bóveda). Empresas creadas por JMV reciben licencia
  HEREDADA (nunca bloqueadas — son clientes de servicio cobrados fuera).
- **Usuarios** (super_admin, Administración → Usuarios): en la tarjeta
  «Usuarios del sistema", por cada usuario disponible:
  - **Reset clave**: genera clave provisional nueva; se muestra UNA vez para
    mandarla por WhatsApp; el usuario la cambia en su próximo login
    (cambio forzado). Todas sus sesiones vivas se cierran.
  - **Desactivar**: cierra conexión y sesiones, conserva el historial
    (bitácora, roles, auditoría). Reactivable en un click.
  - **Eliminar** (definitivo): IRRECUPERABLE — borra usuario, sesiones,
    roles y su rastro de auditoría. Protegido: no se puede eliminar al
    admin principal del sistema ni a ti mismo. Preferí Desactivar si solo
    pausa el acceso.
  - Asignar rol por empresa en «Roles en [empresa]»
    (`empresas/:id/usuarios`). Cambiar rol o quitar acceso es inmediato.
  - **Perfiles de usuario**: la tarjeta final del tab explica qué puede
    hacer cada rol por empresa (super_admin, contador, admin_empresa,
    auditor, tesorería) — qué puede y qué no; un mismo usuario puede
    tener roles distintos en empresas distintas. Consultar antes de
    asignar (el rol controla TODA la aislamiento y permisos de UI/API).
- **Períodos**: crear, cerrar (§4.10) y reabrir (excepcional, auditado).
- **Auditoría** (`auditoria:ver`): bitácora completa — quién, qué, cuándo,
  antes/después. Toda mutación del sistema queda aquí. Las acciones de
  gestión de usuarios (desactivar, reactivar, reset, eliminar, vínculo de
  onboarding) se registran en la bitácora sin claves ni secretos.

### 4.15 CRM — Fidelización de Clientes (exclusivo del despacho)

> Vista **CRM → Clientes — Pipeline y Salud**. Solo roles **contador y
> super_admin** la ven y operan (un cliente JAMÁS: es la gestión interna del
> despacho). No depende de la empresa activa: muestra el portafolio completo.

**A. Pipeline de clientes.** Cada empresa vive en una etapa:
`PROSPECTO → ONBOARDING → OPERATIVO → RIESGO → PERDIDO`. En la tabla del CRM
cambie la etapa con el selector de la fila (+ Interacción para registrar el
contacto de hoy). Cambiar de etapa queda auditado y actualiza "últ. contacto".

**B. Salud (engagement).** Score 0–100 por cliente calculado SOLO con datos
reales del sistema: frescura de la última sincronización SII (+40 ≤15 días,
+20 ≤30), documentos pendientes de contabilizar (+20 en cero, +10 si <5),
cierre del último período (+20 CERRADO, +10 en curso) y frescura del contacto
(+20 ≤30 días, +10 ≤60). Etiquetas: SANO ≥75 / ATENCIÓN ≥45 / CRÍTICO <45.
Nada adivinado: lo que no hay datos, no puntúa.

**C. Retención proactiva (Fase C).** Panel superior con las alertas
consolidadas por cliente y su motivo exacto:

| Señal | Umbral (puro dato, no opinión) |
|---|---|
| `sin_sincronizacion` / `sync_atrasada` | sin ingesta registrada / > 30 días |
| `documentos_acumulados` | ≥ 5 documentos PENDIENTE |
| `sin_contacto` / `contacto_lejano` | sin interacción registrada / > 60 días |
| `periodo_abierto_vencido` | último período del cliente aún ABIERTO y de un mes ya vencido |

Debajo, **"Lote por segmento"**: elija segmento (engagement CRÍTICO/ATENCIÓN o
una etapa del pipeline) + plantilla → "Generar mensajes por lote". Crea una
campaña por empresa del segmento; el resultado nombra lo generado, lo saltado
por ya existir y lo fuera de segmento. Re-lanzar el mismo lote NO duplica
(dedupe por plantilla+período mientras no se haya enviado).

**D. Recordatorios.** Tareas con fecha (cierre de período, F29, PPM, llamada,
sincronización) por cliente — la agenda operativa del despacho. Crear en el
card izquierdo, competar con ✓ (idempotente, auditado).

**E. Campañas de fidelización.** Mensajes generados desde plantillas
(bienvenida, ppm_f29, cierre, reactivación, frost) con datos reales del
sistema (nombre, período, días sin sincronizar, pendientes). Generar solo
PREPARA el texto: el envío por WhatsApp/correo lo hace el despacho FUERA del
sistema y se registra con "Marcar enviado" (acción humana, nunca automática).

**Interpretación en una frase:** el CRM no inventa oportunidades — todas las
señales salen del mismo datos que la contabilidad (documentos, sincronización,
períodos); su trabajo es la rutina semanal: mirar el panel de retención,
generar los mensajes del lote que corresponda y despacharlos a mano.

---

## 5. Administración del sistema (JMV)

### 5.1 Variables de entorno

Ver `.env.example` comentado — tabla resumen de las críticas:

| Variable | Para qué |
|---|---|
| `SESSION_DIAS` | Vida de la sesión (7 recomendado en producción pública) |
| `SECRETOS_MASTER_KEY` | Cifrado AES-256-GCM de claves SII (rotación con script) |
| `DB_PATH` | Ruta de la SQLite (`./data/iva_mensual.db`) |
| `RCV_PROVIDER` | `sii` o `simpleapi` |
| `MP_ACCESS_TOKEN` / `MP_WEBHOOK_SECRET` | Checkout y webhook MercadoPago |
| `PAGOS_NOTIFICATION_URL` / `PAGOS_URL_RETORNO` | Webhook y retorno del pago |
| `DTE_CERT_PFX` … `DTE_AMBIENTE` | Emisor de factura electrónica (firma, CAF, resolución) |

### 5.2 Despliegue y operación

- **Deploy:** `git push vps master` → el hook post-receive reconstruye Docker y
  recrea el contenedor (nginx-iva en 8080/8443; el 80/443 del VPS es de otra
  app). Las migraciones corren solas al arrancar (idempotentes).
- **Health:** `GET /api/health` → `{"ok":true}`; BD accesible.
- **Backups:** `sqlite3 data/iva_mensual.db ".backup ..."` diario con retención
  (ver DESPLIEGUE.md).
- **Secretos:** rotación de `SECRETOS_MASTER_KEY` con el script de
  `scripts/` (cifra de nuevo con la clave nueva).
- **Verificación post-deploy:** health + `node --test` en local antes de pushear
  (la suite SIEMPRE va verde antes de desplegar).

### 5.3 Habilitar pagos y facturación (credenciales del dueño)

1. **MercadoPago:** crear la cuenta → obtener `MP_ACCESS_TOKEN` y el secreto del
   webhook → configurar en el VPS + apuntar el webhook a
   `PAGOS_NOTIFICATION_URL`. Sin esto, el checkout aparece deshabilitado en la UI.
2. **Factura electrónica:** necesitar firma electrónica (.pfx), CAF de folios
   tipo 33 y resolución SII → variables `DTE_*` (lista exacta en
   `.env.example` y en el error de `core/dte.js`). Mientras falten, los pagos
   se aprueban y quedan con factura PENDIENTE; se emiten después.
3. Probar el webhook de MP en sandbox antes de producción (tarjetas de prueba).

### 5.4 Convenciones para el mantenimiento (equipo + IA)

- **Suite SIEMPRE verde antes de commitear/deployar** (`npm test`). Los tests
  de cada fase viven en `test/<nombre>.test.js` y se agregan EXPLÍCITAMENTE al
  script de `npm test` en `package.json`.
- **Arquitectura:** `core/` = dominio puro (la BD llega por parámetro, los
  adaptadores de red se INYECTAN — SII y pasarela se mockean en tests);
  `routes/` = solo HTTP; el frontend no tiene build (`window.*` son los
  contratos entre archivos).
- **Cada fase nueva:** migración idempotente en `core/migraciones.js`
  (encadenarla en `db.js`), capacidad RBAC si corresponde, UI en `views-*.js`
  + menú, tests, y **documentar**: nota ✅ en ROADMAP, CURRENT_STATE, README,
  INTEGRATIONS (si toca integraciones), `.env.example` (si hay env nuevas) y
  **este manual** (nueva funcionalidad → nueva subsección §4.x).
- **Commits:** `tipo(módulo): descripción` (ej. `feat(contable): …`,
  `fix(ops): …`).
- **RUTs válidos de prueba (módulo 11):** 77591234-0, 77581234-6, 77582345-3,
  77571234-1, 77561234-7. Los RUT inventados sin DV correcto fallan en
  `empresas.crear`.

---

## 6. Reglas de oro (las que no se negocian)

1. **Partida doble siempre** — Σdebe = Σhaber validado ANTES de guardar;
   folio correlativo; período abierto (o cierre explícito).
2. **Confirmación humana** para contabilizar, depreciar, cerrar y emitir DTE.
   La automatización propone; el humano confirma (y queda auditado quién).
3. **Las conciliaciones reportan, jamás corrigen en silencio** (SII y banco).
4. **Cero scraping** — el SII por vías existentes; los bancos por archivo.
5. **Los reportes se derivan, no se digitan.**
6. **Período cerrado = piedra** (reabrir es excepcional y auditado).
7. **El pago nunca queda bloqueado por la propia licencia** (si no, una
   empresa suspendida no puede reactivarse sola).
8. **Toda regla legal es configuración con fuente citada** (IVA 19% = D.L. 825
   / Ley 21.210; PPM = tasa por empresa). Nada inventado.
9. **Aislamiento estricto por empresa** — verificado por tests de permisos.
10. **Lo que falta se NOMBRA** (códigos inválidos, datos del receptor, env
    faltantes) — jamás se adivina ni se rellena con defaults silenciosos.

---

## 7. Solución de problemas (troubleshooting)

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| HTTP 402 al guardar | Licencia VENCIDA/SUSPENDIDA (fin de gracia) | Pagar plan en 💳 Suscripción y Pagos; o super_admin activa manualmente |
| `PERIODO_CERRADO` (422) | El período está cerrado | Reabrir (excepcional, auditado) o contabilizar en el período siguiente |
| Asiento rechazado por descuadre | Σdebe ≠ Σhaber | Corregir líneas; el sistema muestra el delta |
| Cartola "no reconocida" | Formato del banco no detectado | Usar el mapeo manual del preview y GUARDAR el formato con nombre para la próxima |
| Fecha 31/02 rechazada | Fecha inexistente en el archivo | Corregir el archivo fuente (protección anti-rollover) |
| Cartola duplicada tras re-importar | No pasa: dedupe UNIQUE | Verificar que el mensaje reporte "duplicadas" |
| Webhook de MP no activa la licencia | Webhook mal apuntado o firma inválida | Revisar `PAGOS_NOTIFICATION_URL`, `MP_WEBHOOK_SECRET` y logs (`[webhook mercadopago]`) |
| Documento en REVISIÓN | Neto+IVA ≠ total en el RCV (defecto de datos reales) | Decisión humana: clasificar a mano o anular; la automatización no lo pisa |
| NC de compra sin IVA crédito | Regla semilla sin crédito | Decisión del contador (INTEGRATIONS): editar la regla del proveedor |
| `EMISOR DTE no configurado` | Faltan variables `DTE_*` | El error lista exactamente cuáles faltan; ver §5.3 |
| Empresa suspendida no escribe | Licencia SUSPENDIDA | Lectura sigue disponible; pagar reactiva |
| Folio fuera del CAF | Secuencia local superó los folios autorizados | Descargar un CAF nuevo en el SII y actualizar `DTE_CAF_XML` |

---

## 8. Glosario

- **DTE** — Documento Tributario Electrónico (factura 33, nota de crédito 61…).
- **RCV** — Registro de Compras y Ventas del SII (fuente de la bandeja).
- **PUC** — Plan Único de Cuentas (plantilla precargada por empresa).
- **Alias de control** — nombre estable de una cuenta clave
  (`IVA_DEBITO`, `F29_POR_PAGAR`…) usado por los cierres en vez de código rígido.
- **Partida doble** — todo asiento tiene patas balanceadas: Σdebe = Σhaber.
- **Report-only** — el sistema muestra y explica diferencias; nunca corrige solo.
- **Gate de licencia** — bloqueo de escrituras (402) por licencia no operativa.
- **Idempotencia** — repetir la misma operación no duplica efectos (webhooks,
  re-envíos, re-importaciones).
- **CAF** — Código de Autorización de Folios del SII (rango autorizado para
  emitir DTE).
- **Snapshot congelado** — la propuesta se guarda tal cual y confirmar aplica
  exactamente eso (nunca regenera).
