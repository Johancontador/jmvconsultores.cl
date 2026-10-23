# Auditoría — perfil administrador y conexión SII

> Fecha: 2026-10-21 · Base: `data/iva_mensual.db` (copia previa en `data/backups/`)
> Regla aplicada: **nada se inventa**. Cada capacidad del SII se declara
> `disponible`, `parcial` o `no_integrado` según el código que existe hoy.

---

## 1. Perfil de administrador

### 1.1 Qué hay realmente

La tabla `users` **no tenía columna de correo**. El perfil que se pidió auditar
(`johan.morales.vasquez@gmail.com`) no existía como identificador: el usuario
administrador es `johan` (`users.id = 1`, `is_admin = 1`, `activo = 1`).

| Dato | Valor |
|---|---|
| Usuario | `johan` (id 1) |
| Email | no existía en el esquema |
| Rol | `is_admin = 1` (super admin global) |
| Asignaciones explícitas | 22 filas `usuario_empresa` con rol `super_admin` |
| Clave provisional pendiente | no |
| Otros usuarios | `qa_onb` (contador de la empresa 1), `regresion-case-login@example.org` (prueba) |

### 1.2 Redundancias detectadas

1. **22 asignaciones `super_admin` que no otorgan acceso adicional.** El rol
   super admin es global: `empresas.asignacionesDeUsuario` y `rolEnEmpresa`
   devuelven todas las empresas por `is_admin`, sin mirar `usuario_empresa`.
   Las filas solo agregaban ruido y un problema real: una empresa nueva no
   aparecía hasta asignarla a mano.
2. **El perfil no tenía identidad de contacto.** Sin `users.email`, el login
   solo aceptaba `johan` y no había forma de auditar por el correo real.
3. **El Centro de Aplicaciones se rompía para un super admin sin filas.**
   `centroParaUsuario` leía `usuario_empresa` directo y devolvía `apps: []` si
   no había asignaciones. Al limpiar las redundantes, el admin habría quedado
   sin pantalla de inicio. Se corrigió el fallback global.

### 1.3 Ajustes aplicados en código

- Migración `migracionesPerfilYSalud`: `users.email` + índice único
  `lower(email)` (dos cuentas no pueden compartir correo).
- Login (`POST /api/auth/login`) acepta **username o email**, sin distinguir
  mayúsculas. `/api/auth/me` y el listado de usuarios devuelven `email`.
- `centroParaUsuario`: el super admin siempre ve todas las empresas activas.
- Script `scripts/auditar-perfil-admin.js` para fijar el correo y eliminar las
  asignaciones redundantes, con copia de seguridad y auditoría.

```bash
node scripts/auditar-perfil-admin.js
node scripts/auditar-perfil-admin.js --aplicar --dedupe --email=johan.morales.vasquez@gmail.com
```

---

## 2. ¿Qué puede consultar hoy la conexión SII?

### 2.1 Matriz de capacidades

| Consulta | Estado | Evidencia | Qué significa |
|---|---|---|---|
| Ficha del contribuyente (razón social, tipo, inicio/término de giro, actividad, dirección, capital, atributos, alertas) | **Disponible** | `backend/core/empresas-sii.js` (`DatosCntrNow` de misiir) | Se obtiene con el login tributario existente y se guarda en `data/sii-fichas/<rut>.json`. |
| RCV compras y ventas por período | **Disponible** | `backend/services/sii-rcv.js` + `sii-session.js` | Endpoints `facadeService` (getResumen / getDetalle*Export), paginados y con caché de períodos cerrados. |
| Ingresos de años anteriores | **Parcial** | `backend/core/salud-tributaria.js` | Solo años con RCV ingerido. **No** es una consulta oficial de ingresos. |
| Estado y monto de declaraciones F29 | **Disponible** | `backend/core/declaraciones-sii.js` | Consulta Integral F29 + «Buscar Formulario»: por período, estado (declarada/pendiente), folio, fecha de presentación y monto declarado. 6 años disponibles. |
| Boletas de honorarios emitidas/recibidas | **Disponible** | `backend/core/declaraciones-sii.js` | `loa.sii.cl` Informe Anual (emitidas y recibidas): honorario bruto, retenciones y líquido, mes a mes y totales. |
| Estado de declaraciones de renta (F22) | **No integrado** | — | No se encontró una consulta de estado F22 por RUT con el login simple; el flujo de Renta exige la operación renta. Se declara `no_consultado`. |
| Declaraciones juradas | **No integrado** | — | La Consulta Integral las busca formulario por formulario, no por RUT. No se implementó para no inventar resultados. |

### 2.2 Prueba en vivo (2026-10-21)

Se ejecutó `consultarFichaSii` contra el SII real con la credencial cifrada de
la empresa 1 (`76312274-3`): login HTTP 200, token RCV obtenido, ficha
`DatosCntrNow` leída. Resultado: inicio de actividades 2013-12-06, régimen
«Pro Pyme General (14 D)» (atributo `14D1`), dirección «STA ELVIRA 101,
SANTIAGO», sin alertas. La ficha quedó guardada y la empresa actualizada.

Esto prueba que **la sesión autenticada es válida y el RCV está operativo**.

### 2.3 Declaraciones F29 y boletas (implementado y verificado)

Por instrucción expresa del usuario se amplió la consulta a 5 años. La vía
elegida **no inventa endpoints**: automatiza el portal autenticado del SII con
Chrome headless reutilizando la misma sesión del RCV.

Flujos verificados contra el SII real (21-10-2026, RUT 77255326-9):

1. **Consulta Integral F29** (`sifmConsultaInternet`): la matriz mes × año
   expone el estado en el tooltip de cada celda («Declaración sin
   observaciones» / «Periodo sin declaración»). Una sola carga entrega 6 años.
2. **Buscar Formulario** (mismo portal, tipo DPS, formulario 29, opción
   «Anual»): devuelve los 12 períodos del año con **folio, fecha de
   presentación, estado y monto declarado**. Verificado: 12 filas para 2025.
3. **Informe Anual de Boletas de Honorarios** (`loa.sii.cl`, CGI): tabla mes a
   mes de emitidas y recibidas con honorario bruto, retención de terceros,
   retención del contribuyente y total líquido. La sesión de `zeusr.sii.cl` es
   aceptada por SSO dentro del mismo navegador.

Límites conocidos:

- Requiere Chrome/Chromium en el servidor (`CHROME_PATH`).
- Los selectores dependen del HTML del SII: si el portal cambia, la consulta
  falla de forma ruidosa (`SII_SESION_INVALIDA` / aviso), nunca con datos
  inventados.
- El SII limita las sesiones simultáneas por RUT (01.01.2xx.500.720.27). El
  módulo abre UNA sesión por corrida y la cierra al terminar; además
  `sii-session.js` ahora cierra la sesión al expirar o invalidarse, para no
  acumular sesiones colgadas entre sincronizaciones.

### 2.4 Primera corrida real (caso de éxito)

Empresa 3 — `77255326-9`, INVERSIONES SANTA CAMILA SPA, 5 años a septiembre 2026:

| Dato | Resultado |
|---|---|
| F29 declarados | **57 períodos** (2022-01 → 2026-09), todos «Vigente», con folio, fecha y monto |
| F29 pendientes | 0 |
| Boletas emitidas | $0 en los 5 años |
| Boletas recibidas | $1.151.947 (2025: $90.000 · 2026: $1.061.947, con retención de $161.947) |
| Ejemplo F29 2025-01 | Folio 8102290566 · presentado 19/02/2025 · **$1.027.539** |

Comandos:

```bash
node scripts/sincronizar-declaraciones.js --empresa=3 --anios=5   # lee del SII
node scripts/informe-salud.js --empresa=3 --meses=60 \
  --out=docs/ejemplos/INFORME-SALUD-EJEMPLO-77255326-9.md        # genera el informe
```

El informe de ejemplo quedó en `docs/ejemplos/INFORME-SALUD-EJEMPLO-77255326-9.md`.

> **Nota operativa (sesiones SII):** el SII devuelve «máximo de sesiones
> autenticadas» cuando un RUT acumula sesiones abiertas. El módulo lo informa
> como `SII_TOPE_SESIONES` (HTTP 409) y no como «clave incorrecta», porque el
> problema es de sesiones, no de credenciales. Cada corrida cierra la sesión
> al terminar (también en los caminos de error), así que el tope no se vuelve
> a alcanzar con el uso normal; si aparece de golpe, hay sesiones abiertas en
> el sitio del SII y se resuelven cerrando sesión allí o esperando su
> expiración. Al 21-10-2026 el `sync` de 5 años de la empresa 1
> (`76312274-3`) terminó con 57 F29 y 5 BHE sincronizados.

---

## 3. Consulta Salud Tributaria (implementada)

`GET /api/contable/empresas/:id/salud-tributaria?periodo=YYYYMM&meses=12`
(`salud:ver`) y `POST …/sincronizar` (`salud:sincronizar`).

### 3.1 Contenido del informe

- **Identidad y actividad**: RUT, razón social, tipo y subtipo de
  contribuyente, inicio y término de giro, actividad, dirección, unidad
  operativa, capital (enterado / por enterar, en miles de CLP), segmento,
  contacto, régimen y atributos vigentes, alertas del SII **verbatim**.
- **Declaraciones**: F29 y boletas se leen del SII (estado, folio, fecha y
  monto); F22 y juradas se muestran como `No consultado` con la explicación de
  qué falta. Nunca como cero.
- **Anuales**: F22, boletas emitidas y recibidas por año, junto al RCV del año.
- **Ingresos por año**: agregados del RCV, con meses cubiertos.
- **Mensuales**: ventas/compras netas e IVA, IVA estimado, PPM estimado y F29
  estimado, por período. Estados: `Con RCV`, `Sin movimiento` (solo si el SII
  ya fue consultado y devolvió cero) y `Sin sincronizar`.
- **Cobertura**: meses con datos, sin movimiento y sin sincronizar.
- **Opinión automatizada**: nivel (`AL_DIA`, `CON_OBSERVACIONES`,
  `REQUIERE_REVISION`, `SIN_INFORMACION`), score 0–100, fundamentos,
  recomendaciones, limitaciones y base normativa citada.
- **Snapshot**: cada informe se guarda en `salud_tributaria_snapshots` como
  evidencia (opinión + score + JSON), sin sobrescribir el anterior.

### 3.2 Reglas de la opinión

Suben severidad: término de giro, alerta del SII, sin RCV en el período, sin
RCV en los últimos 3 meses, cobertura incompleta. Bajan: ficha incompleta,
régimen no determinado, sin actividad, sin dirección, sin contacto, capital
por enterar. El F29 estimado se marca como limitación, nunca como declaración.

### 3.3 Hallazgo real detectado en los datos

La ficha de `77838371-3` (RREALSTATEHT SPA) trae una alerta del SII:
«Periodo de Termino de Giro es: 01-01-2025 hasta 31-01-2025», mientras la
empresa figura activa y sin fecha de inicio en la base. El informe lo muestra
como hallazgo **alta**. Es exactamente el tipo de inconsistencia que este
módulo debe sacar a la superficie.

### 3.4 Bug corregido en el camino

`fichaSiiARegistro` mapeaba el régimen solo con `14TT` y `14GG`. Las fichas
reales usan **`14D1`** para «REGIMEN PRO PYME GENERAL (14D)», por lo que el
régimen quedaba `null` en todas las empresas Pro Pyme General. Corregido con
`REGIMEN_POR_ATRIBUTO` (14TT, 14D1, 14GG, 14A).

---

## 4. Alta masiva de clientes

No había base adjunta. Queda listo el pipeline y la plantilla:

```bash
node scripts/importar-clientes.js --csv docs/plantilla-clientes.csv          # dry-run
node scripts/importar-clientes.js --csv mi-base.csv --aplicar \
  --base-url=https://app.jmvconsultores.cl/sistema/
```

- Crea la empresa **solo** con `crearDesdeSii` (ficha oficial). Si la empresa
  ya existe, vincula el usuario con rol `admin_empresa`.
- Crea el usuario con clave provisional y `debe_cambiar_clave = 1`.
- Con `--aplicar` escribe en `data/importacion-<fecha>/`:
  - `clientes.csv` con la clave provisional (archivo sensible);
  - `mensajes.md` con un mensaje personalizado por cliente.
- El script es idempotente por correo: reejecutar no duplica usuarios.

### 4.1 Mensaje generado (plantilla)

Incluye saludo personalizado, link, usuario, clave provisional, qué puede
hacer dentro y el recordatorio de cambio de clave. **No promete F29 oficial,
F22, juradas ni boletas** porque esas conexiones no existen todavía. Prometer
eso sería exponer al despacho a una expectativa incumplida.

### 4.2 Seguridad y datos personales

- Las claves provisionales deben enviarse por un canal privado y de uso único;
  el sistema fuerza el cambio en el primer ingreso.
- La base de clientes contiene RUT, correo y clave tributaria: son datos
  personales y secretos comerciales. La clave SII se guarda cifrada (bóveda
  AES-256-GCM). No subir `data/` ni el CSV al repositorio.
- La Ley 21.719 (protección de datos personales) entra en vigencia el
  2026-12-01: conviene documentar base de licitud, finalidad y plazo de
  conservación del acceso de cada cliente antes de esa fecha.

---

## 5. Advertencia profesional

La «opinión de salud tributaria» es un análisis automatizado sobre datos
verificables. **No es una certificación, no es una declaración jurada y no
reemplaza la revisión de un asesor.** Los montos de IVA, PPM y F29 son
estimaciones desde el RCV. La prescripción (Código Tributario art. 200) y los
plazos especiales deben evaluarse caso a caso. Las citas normativas del
informe son referencias generales (D.L. 825 art. 29, Ley de la Renta art. 65,
Ley 21.210, Ley 20.727).

---

## 6. Auditoría de conexiones 2026-10-22 (correcciones)

Se revisó el módulo completo contra el SII/TGR reales. Cuatro conexiones que el
informe declaraba «disponibles» estaban rotas en silencio y se corrigieron:

| # | Problema encontrado | Efecto real | Corrección |
|---|---|---|---|
| 1 | `declaraciones-sii.js` usaba `comacto` / `comulto` (typo) en el INSERT del Formulario Compacto | El INSERT fallaba dentro del `try`: `f29_formularios` **nunca se llenaba** y la conciliación «declarado vs RCV» era imposible aunque la capacidad decía `disponible` | Se extrajo `guardarFormularioF29()` (probada en `test/deuda-tgr.test.js` D6) y se corrigió el flujo |
| 2 | `abrirBuscador()` esperaba 1,2 s fijos tras el encabezado GWT | La sincronización de formularios fallaba entera: «No se encontró el botón Buscar Formulario» | Sondeo hasta 25 s del botón; verificado en vivo (202608 y 202609 con 33/31 casillas y 5/5 verificaciones) |
| 3 | `renta-sii.consultarRenta()` sin `jar` llamaba `loginSII(rut, dv)` (el DV como clave) | El paso «Renta (F22)» de la reunión siempre fallaba y el informe mostraba F22 «no consultado» | `consultarRenta` exige `clave`; la reunión la descifra desde la bóveda. Verificado: F22 2026 vigente con folio real |
| 4 | La conciliación comparaba `total_debitos` (538 = **IVA débito**) contra las ventas netas del RCV | Diferencia fantasma de millones por período (p. ej. «dif. ventas 3.340.054» con RCV vacío) | Se compara `base_imponible` (563 = ventas netas). Sin RCV del mes no se calculan diferencias (`comparable: false`) |

Además:

- **Login SII intermitente:** con la misma clave válida el SII a veces responde
  200 solo con la cookie del balanceador. `loginSII` reintenta UNA vez antes de
  culpar a la credencial y ya no considera el texto genérico «no existe» como
  clave incorrecta.
- **Declaraciones juradas (nuevo):** `backend/core/dj-sii.js` lee «Mis
  Declaraciones Juradas» (`www4.sii.cl/perfilamientodjui`) por año. Requiere
  enviar SOLO los atributos de RÉGIMEN; con el segmento incluido el SII
  responde «No Existen Datos para la Consulta». Entrega DJ presentadas (estado,
  folio, fechas) y DJ aplicables **sin presentación registrada**. Verificado:
  empresa 77255326-9 → DJ 1947 Aceptada en 2026, DJ 1948 Aceptada en 2024, DJ
  1947 sin presentación en 2025 (hallazgo `DJ_PENDIENTE` severidad alta).
- **Deuda fiscal (nuevo):** certificado de deuda de la TGR con la misma Clave
  Tributaria. Ver `docs/INTEGRACION-TGR.md` §5.

Matriz de capacidades actualizada: `declaraciones_juradas` pasa a
`disponible`; la deuda fiscal se declara en `capacidades_tgr` (no en las del
SII, porque la emite la Tesorería).

---

## 7. Conciliación F29 declarado vs RCV — corrida real de 12 meses (2026-10-23)

Corrida completa sobre **77.255.326-9 (Inversiones Santa Camila SpA)**,
períodos `202510`–`202609`, contra el SII real:

| Resultado | Valor |
|---|---|
| Formulario Compacto F29 leído | **12/12** períodos (folios reales) |
| Verificaciones internas de casillas | **42/42** cuadran |
| Cobertura RCV | **12/12** meses (436 documentos) |
| Períodos comparables | **12/12** |
| Diferencias de ventas relevantes | **2** (202603 y 202606) |

Lo que se corrigió para que esa conciliación fuera posible:

- **Lectura de respaldo del compacto.** El parser por posiciones (bloques `BT`
  con coordenadas) no reconoce todos los PDF que emite el SII: el compacto
  imprime `563BASE IMPONIBLE16.840.242`, con código, glosa y valor **pegados**.
  Ahora, si el parseo por posiciones no devuelve casillas, se lee el texto plano
  (`pdf-parse`) y se aceptan solo códigos del catálogo del SII. Probado con el
  PDF real (202609: 16 casillas, 4/4 cuadraturas) y en `test/declaraciones-sii.test.js` T7.
- **Casillas 512/513 (notas de débito).** Cuando existen, suman al total de
  débitos: en 202604 la cuadratura «502 − 510 = 538» fallaba por exactamente
  31.933, el monto de la nota de débito. El catálogo las incluye y la
  verificación `DEBITOS_NETOS` calcula `502 + 513 − 510`. Ese mes pasó de
  4/5 a 5/5 y el hallazgo falso `F29_INCONSISTENTE` desapareció del informe
  (índice 81 → 85).
- **`total_a_pagar` (091):** el compacto imprime el código pegado al monto
  (`TOTAL A PAGAR DENTRO DEL PLAZO LEGAL911.769.027`). Se contrasta con 547
  para no leer 911.769.027 donde dice 1.769.027.

### Hallazgos reales que quedan (no son errores del sistema)

Diez períodos cuadran con el RCV dentro de ±10 CLP (redondeo del SII). Dos no:

- **202603:** declarado 11.470.574 vs RCV 8.571.426 → **+2.899.148** de base.
  La casilla 502 (débitos facturas) coincide exactamente con el RCV, pero 538
  (total débitos) supera a 502 en 550.841 de IVA: la declaración incluye
  documentos que el RCV no trae (boletas u otros débitos fuera de la bandeja).
- **202606:** declarado 12.047.311 vs RCV 10.576.723 → **+1.470.588**, mismo
  patrón (538 − 502 = 279.412 de IVA).

El informe los expone como `F29_VS_RCV` (severidad alta) con el monto exacto y
la explicación de que el F29 declarado es la verdad y la diferencia apunta a
documentos faltantes en el RCV. No se ajusta el monto declarado ni se inventan
casillas para "cuadrar" el mes.

---

## 8. Corrida del portafolio completo (2026-10-23)

La misma sincronización de 12 meses se repitió sobre las 22 empresas activas.
El portafolio destapó cuatro casos que una sola empresa no mostraba:

| Síntoma en el informe | Causa real | Corrección |
|---|---|---|
| «Total créditos» no cuadraba y el IVA determinado salía negativo | La empresa **arrastra remanente de crédito** (casilla 504) y el formulario trae además 077 (remanente resultante) | Casillas 504 y 077 al catálogo; la cuadratura es `537 = 511 + 504` (antes se comparaba `520 − 528` contra 537) |
| Débitos declarados mayores que facturas, sin explicación | Boletas (**111**) y recibos de medios electrónicos (**759**) también son débito | Casillas 110/111/758/759 al catálogo; `538 = 502 + 111 + 759 + 513 − 510` |
| Tasa PPM leída como 125 % y PPM descuadrado | La tasa se imprime con tres decimales («0,125») y el lector por posiciones convertía «0.125» en 125 | La tasa se relee siempre desde el texto impreso; acepta cualquier cantidad de decimales |
| Meses con IVA a pagar 0 marcados como inconsistentes | Con remanente, `538 − 537` es negativo y 089 es 0 por definición | La resta solo se exige cuando los débitos superan los créditos; si no, se verifica que 089 sea 0 |

Además:

- **RCV sin documentos no es un error.** El SII responde «No es posible realizar
  esta consulta, no hay documentos o debe ser de forma diferida» en los meses
  sin movimiento. En un período cerrado eso es un mes vacío (0 documentos, se
  cachea); en el período en curso se devuelve `SII_RCV_DIFERIDO` en vez de
  inventar un vacío. Antes cada mes sin movimiento contaba como falla.
- **La grilla anual del F29 se sondea.** Se esperaban 4 s fijos tras
  «Consultar»: si la tabla se pintaba después, la corrida «no encontraba»
  períodos con declaración y el año quedaba vacío sin error visible.
- **Sesión por año.** El SII corta la sesión al pasar de un año al siguiente
  (y a veces a mitad de año). Antes el año completo se perdía con «sesión
  expirada»; ahora cada año abre sesión propia y, si se cae a mitad, se reabre
  y se reintenta una vez.
- **Las cuadraturas se recalculan al conservar casillas.** Si una lectura nueva
  no trae casillas se conservan las anteriores, pero indicadores y
  verificaciones se recalculan con el catálogo vigente (antes quedaban con las
  reglas viejas para siempre).
- **El Formulario Compacto cuenta como declaración consultada.** La sección
  «Estado de las declaraciones», el historial de cumplimiento y el detalle
  mensual se armaban sólo con `declaraciones_sii`; el lector nuevo escribe en
  `f29_formularios`, así que 18 de 20 empresas mostraban «F29 — No consultado»
  junto a sus 12 meses ya conciliados (y la dimensión de cumplimiento quedaba
  «no evaluable»). Ahora el compacto con casillas entra al historial como
  `declarada` y el detalle mensual declara de dónde salió (`origen: compacto`).
  Un período leído que el SII marca «No Declarante» queda `sin_informacion`: se
  muestra como leído, pero no se cuenta como pendiente del contribuyente.

### Diferencias de ventas explicadas

Cuando la diferencia entre el F29 declarado y el RCV coincide con la base
reconstruida desde las casillas 111 (boletas) o 759 (recibos de medios
electrónicos), el informe lo dice: `diferencia_ventas_explicada_por`. En
77.255.326-9 las dos diferencias de la corrida anterior quedaron explicadas:
marzo 2026 → 2 boletas ($550.841 de IVA, ≈ $2.899.163 de base) y junio 2026 →
1 boleta ($279.412 de IVA, ≈ $1.470.589 de base). No son documentos perdidos:
son documentos propios que el RCV no trae en esa bandeja.

**Ingesta de esos agregados (2026-10-23, súpercede la explicación).** El SII no
entrega boletas (39) ni comprobantes de pago electrónico (48) documento a
documento: `getDetalleVentaExport` con `codTipoDoc='0'` devuelve solo facturas.
Al pedirlo filtrado por tipo (`codTipoDoc='39'/'48'`) responde UNA fila por mes
(y por «Tipo Venta»), con la **cantidad** de documentos en la columna «Folio» y
sin fecha de documento ni Rut cliente. La bandeja nueva guarda ese total en la
tabla `rcv_agregados` (`guardarAgregados`, UPSERT por empresa+período+tipo+
«Tipo Venta») y el informe lo suma a las ventas del mes (campo
`ventas_agregados`; `documentos` NO cambia: un total mensual no es un
documento). Con los dos meses de 77.255.326-9 ya ingeridos, 202603 quedó en
dif −11 y 202606 en dif 0 (redondeo del SII, bajo el umbral de $1.000). Falta
correr la reunión de antecedentes de las demás empresas para ingerir los ~61
meses — **~$52,6M de IVA débito declarado en boletas/comprobantes que el
informe aún contará como diferencia** hasta re-sincronizarlas: el paso «rcv» de
la reunión ya lo hace automáticamente para los períodos que consulta.

### Resultado de la corrida: 21 empresas activas

Ventana 202510–202609. «F29» son los períodos con Formulario Compacto leído en
la ventana; «RCV» los meses con algún documento; «Conc.» los meses que el
informe pudo conciliar contra el F29 declarado (los demás son meses sin
movimiento: el SII no tiene documentos, no es una falla); «Dif.» los meses con
diferencia de ventas de al menos $1.000; «Verif.» las cuadraturas internas del
compacto que pasan.

| # | RUT | Empresa | F29 | RCV | Conc. | Dif. | Verif. |
|---|---|---|---|---|---|---|---|
| 1 | 76312274-3 | Comercializadora C&E Clima Ltda. | 12/12 | 12/12 | 12 | 2 | 60/60 |
| 3 | 77255326-9 | Inversiones Santa Camila SpA | 12/12 | 12/12 | 12 | 2 | 58/58 |
| 4 | 78198601-1 | Inversiones Santa Ignacia SpA | 12/12 | 12/12 | 12 | 0 | 39/39 |
| 5 | 78478611-0 | Maestranza Santa Camila SpA | 2/12 | 2/12 | 2 | 1 | 4/4 |
| 6 | 78181543-8 | Panadería San Juan SpA | 12/12 | 12/12 | 12 | 12 | 53/53 |
| 7 | 77539337-8 | Laserpiente.13 SpA | 12/12 | 9/12 | 9 | 0 | 28/28 |
| 8 | 77838371-3 | Rrealstateht SpA | 6/12 | 2/12 | 2 | 0 | 0/0 |
| 9 | 77747139-2 | Inversiones Castell SpA | 12/12 | 12/12 | 12 | 9 | 57/57 |
| 10 | 77810509-8 | Producciones Castell SpA | 12/12 | 11/12 | 11 | 0 | 53/53 |
| 11 | 77721016-5 | Comercializador de Alimentos Ivana Rattalino E.I.R.L. | 12/12 | 12/12 | 12 | 12 | 58/58 |
| 12 | 77338917-9 | Transportes Atacama Express Ltda. | 12/12 | 12/12 | 12 | 12 | 24/24 |
| 13 | 78087844-4 | Trasporte de Carga por Carretera… Sepúlveda Ortiz E.I.R.L. | 12/12 | 12/12 | 12 | 0 | 60/60 |
| 14 | 14322956-4 | Mariela Angelina Rodríguez Jofré | 12/12 | 9/12 | 9 | 0 | 20/20 |
| 15 | 78174505-7 | D.A.V.A. Servicios SpA | 12/12 | 11/12 | 11 | 5 | 35/35 |
| 16 | 77351074-1 | Oso de Agua SpA | 12/12 | 12/12 | 12 | 7 | 44/44 |
| 17 | 76104079-0 | Sociedad Comercial Pao Food SpA | 12/12 | 12/12 | 12 | 0 | 60/60 |
| 18 | 77854044-4 | Gas Lasm Organic SpA | 12/12 | 1/12 | 1 | 0 | 5/5 |
| 19 | 77907448-K | All-Ford SpA | 10/12 | 12/12 | 10 | 4 | 33/33 |
| 20 | 77468067-5 | Carbón Libros SpA | — | 0/12 | 0 | 0 | 0/0 |
| 21 | 15806078-7 | Simey Diana Mena Arancibia | 7/12 | 10/12 | 7 | 6 | 12/12 |
| 22 | 78206354-5 | Family Burger SpA | 12/12 | 11/12 | 11 | 9 | 35/35 |

Total: **193 meses conciliables, 738/738 cuadraturas internas OK y 81 meses
con diferencia de ventas** entre lo declarado y el RCV ingerido. Las 738
verificaciones sin excepción confirman que el lector del compacto funciona
igual en las 20 empresas con datos: remanentes, boletas, recibos y tasas con
decimales quedan cubiertos por el catálogo nuevo.

### Lo que quedó pendiente (y por qué)

- **77.468.067-5 (Carbón Libros):** el SII rechaza la clave guardada
  («Clave SII incorrecta»). No hay dato que sincronizar hasta corregirla en el
  maestro de la empresa; el informe queda en «F29 no consultado», sin inventar
  ceros.
- **Rrealstateht:** la grilla del SII devuelve sólo 202510 para 2025 y marca
  202601–202605 como «No Declarante» (folios sin casillas, por definición). Sus
  únicos dos meses con documentos coinciden con los conciliables.
- **Maestranza Santa Camila:** sólo se leyeron 202608 y 202609, y el RCV sólo
  trae documentos de agosto; el resto de la ventana queda como mes sin
  movimiento. Una relectura posterior devolvió la grilla vacía, así que con los
  datos del SII no se puede afirmar más que eso.
- **All-Ford:** la grilla no trae 202606 ni 202609 (no hay declaración), y
  202605 y 202608 llegaron como «No Declarante».
- **Simey Diana Mena:** faltan 202510–202511 en la grilla de 2025 y 202607–202609
  en la de 2026; el resto concilia.

### Nota operativa: la grilla anual se cae al cambiar de año

En tres empresas la búsqueda del año anterior falló con «sesión perdida» aunque
se reabriera la sesión, y la corrida dejaba ese año vacío. Consultar **sólo** el
año pendiente (ventana de tres meses, `sincronizarFormularios` con
`periodo=202512`, `periodos=3`) lo recupera de inmediato: fue lo que completó
Panadería San Juan (202510–202512) en esta corrida. Cuando el año pendiente no
aparece ni con sesión propia, la grilla simplemente no tiene declaraciones.
