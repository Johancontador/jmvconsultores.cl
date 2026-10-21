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
