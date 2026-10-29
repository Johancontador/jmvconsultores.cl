# Planificación Tributaria — Especificación Técnica y Handoff

**Fecha:** 28-10-2026  
**Compromiso:** Código implementado y testeado; estado de producción no verificado en este diagnóstico.  
**Fuente:** Inspección de `backend/core/plan-ficha.js`, `backend/core/planificacion-tablas.js`, `backend/routes/planificacion.js`, `test/plan-ficha.test.js`, `test/planificacion-tablas.test.js`, `test/planificacion-expansion.test.js`.
**Revisión D2 (29-10-2026):** correcciones según auditoría independiente del 29-10: catálogo real de regímenes, estructura real de `CAMPOS_TRIBUTARIOS`, comportamiento real de las rutas (POST 409 / GET 200 con `ficha:null` / PUT 404), alcance real de los tests y comportamiento actual de `fecha_vigencia` (no obligatoria; decisión de negocio pendiente).

---

## 1. Propósito y alcance funcional

El módulo de **Planificación Tributaria** administra la ficha tributaria por empresa, capturando el régimen tributario, el tipo de contribuyente, la fecha de vigencia del régimen y las actividades económicas. Se declara como base para los siguientes usos, que **hoy no están integrados** en ningún módulo (ver «Estado de integración» más abajo):

- Determinar la tasa PPM aplicable
- Clasificar la empresa para efectos de reportes y salud tributaria
- Habilitar o bloquear funcionalidades según el estado de la ficha (PENDIENTE / SIN_CONFIGURAR / CONFIGURADA)

**Estado de integración de esos tres propósitos (verificado en código el 29-10-2026):** hoy la ficha es **declarativa**: ningún módulo la consume todavía. `plan-ficha` solo se requiere desde `routes/planificacion.js`; la tasa PPM del informe de Salud Tributaria se lee de `empresas.tasa_ppm` (`salud-tributaria.js` L777 y L821) y el informe se construye con la **ficha del SII** o, en su defecto, con las columnas de onboarding de `empresas` (`fichaDesdeEmpresa`, L297-316). Ninguna funcionalidad queda bloqueada por el estado `SIN_CONFIGURAR`/`PENDIENTE`. Los tres propósitos se mantienen como **uso previsto**, no como integración implementada.

**Dos fichas distintas que no deben confundirse (verificado en código el 29-10-2026):**

| | Ficha oficial del SII | Ficha de planificación tributaria |
|---|---|---|
| Qué es | Ficha del contribuyente que entrega el SII | Declaración tributaria interna de la empresa (`regimen`, `regimen_desde_ac`, `fecha_vigencia`, `tipo_contribuyente`, actividades) |
| Dónde vive | `data/sii-fichas/<rut>.json` (fuera del repo) + columnas de onboarding en `empresas` (`onboarding.confirmarFicha`) | Tabla `plan_ficha_tributaria` (§3) |
| Quién la crea | `empresas-sii.crearDesdeSii` (alta desde el SII, SAAS-1) y `empresas-sii.asegurarFicha` (al final de cada sync diaria, si falta o tiene >7 días) | Solo el flujo **explícito** de incorporación: `POST .../planificacion/ficha` → `plan-ficha.incorporar` |
| ¿Es automática? | Sí, en el alta desde el SII y en la sync diaria | **No**: ninguno de esos flujos escribe en `plan_ficha_tributaria` (único `INSERT` de la tabla: `plan-ficha.js` → `incorporar`, invocado solo por el `POST`) |

En consecuencia, **crear una empresa desde el SII no crea la ficha de planificación**: la empresa queda **sin fila** en `plan_ficha_tributaria` (el `GET` responde `200` con `ficha: null` y la vista muestra `SIN_FICHA`) hasta que un usuario con `planificacion:gestionar` ejecute la incorporación explícita descrita en §2 y §4.

**Alcance:** Solamente lo implementado en código y tests. El estado en producción (datos reales, login, persistencia) no ha sido verificado en este diagnóstico.

---

## 2. Rutas HTTP, métodos, permisos y comportamiento

| Ruta | Método | Permiso | Comportamiento |
|---|---|---|---|
| `GET /api/contable/empresas/:empresaId/planificacion/ficha` | GET | `planificacion:ver` | Obtiene la ficha vigente. Responde **200** con `{ ok: true, ficha: <fila completa> }` o, si aún no hay incorporación explícita, **200 con `{ ok: true, ficha: null }`** (es la ausencia de declaración, no un 404). El gate `requirePermiso('planificacion:ver')` permite lecturas a auditor, tesorería y dueño (y a contador/super_admin, que tienen todas las capacidades). |
| `GET /api/contable/empresas/:empresaId/planificacion/ficha/historial` | GET | `planificacion:ver` | Historial append-only. Responde `{ ok: true, entradas }` con `?limite=N` (por defecto 20, tope 100), más nuevo primero. Cada entrada es `h.*` de `plan_ficha_historial` — `accion`, `antes_json`, `despues_json`, `ip`, `usuario_id`, `creado_en` — más `usuario_nombre` (join con `users`). |
| `POST /api/contable/empresas/:empresaId/planificacion/ficha` | POST | `planificacion:gestionar` | **Incorporación EXPLÍCITA: crea la única fila vigente, una sola vez.** Si la empresa ya tiene ficha responde **409** «La empresa ya tiene ficha incorporada: use actualizar (PUT)»; si no, **200** `{ ok: true, ficha }`. Body: `{ regimen, regimen_desde_ac, fecha_vigencia, tipo_contribuyente, actividades_economicas, fecha_inicio_actividades, propietarios }`. Los campos omitidos nacen en centinela PENDIENTE/SIN_CONFIGURAR. Gate solo contador y super_admin. |
| `PUT /api/contable/empresas/:empresaId/planificacion/ficha` | PUT | `planificacion:gestionar` | **Actualiza la ficha vigente** sobre un delta validado. Sin ficha → **404** «La empresa no tiene ficha incorporada: use incorporación explícita (POST)». Delta vacío → 400 «Sin cambios que registrar»; delta idéntico a lo vigente → 400 «Los valores declarados son idénticos…». Rechaza volver a PENDIENTE una ficha ya declarada. Responde `{ ok: true, ficha }`. |

**Notas de comportamiento:**
- **No hay creación automática de la ficha de planificación** (corregido en D2.2, 29-10-2026): ni el alta desde SII (SAAS-1) ni `sync-diaria` escriben en `plan_ficha_tributaria`; el único `INSERT` de la tabla está en `plan-ficha.js` (`incorporar`) y solo lo invoca el `POST` de `routes/planificacion.js`. Sin incorporación, el `GET` responde **200 con `ficha: null`** (ausencia de declaración, no un error).
- `empresas-sii.asegurarFicha` (`backend/core/empresas-sii.js`) gestiona **otra entidad distinta**: la ficha oficial del contribuyente descargada del SII (`data/sii-fichas/<rut>.json`), que refresca al final de cada `sync-diaria` si falta o tiene >7 días. **No toca `plan_ficha_tributaria`.**
- **Flujo real de creación (según código):** sin fila → `views-plan.js` muestra el chip `SIN_FICHA` y, solo con `planificacion:gestionar`, la CTA «Incorporar ficha»; el clic dispara el `POST` → `plan-ficha.incorporar` crea la **única** fila con defaults `PENDIENTE`/`SIN_CONFIGURAR` y firma historial + bitácora; a partir de ahí los cambios van por `PUT` (en la vista: `f ? apiPut : apiPost`).
- Si la ficha tiene `regimen = PENDIENTE`, no se permite `fecha_vigencia` (throw Error).
- `fecha_vigencia` exige `regimen_desde_ac` coherente **solo si se informa**: la fecha debe pertenecer al ejercicio `regimen_desde_ac` (año idéntico).
- `fecha_vigencia` **no es obligatoria**: si no viene en el payload no se valida ni se exige (comportamiento actual de la capa de aplicación y del CHECK de BD — ver §5).

---

## 3. Esquema de base de datos (`plan_ficha_tributaria`)

Tabla `plan_ficha_tributaria` con los siguientes campos (tipos según better-sqlite3):

| Campo | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | INTEGER | PK AUTOINCREMENT | Identificador de la fila |
| `empresa_id` | INTEGER | FK → `empresas.id`, NOT NULL, **UNIQUE** | Empresa a la que pertenece la ficha (una fila vigente por empresa) |
| `rut` | TEXT | NOT NULL | Espejo del RUT de la empresa, validado contra ella en la incorporación |
| `regimen` | TEXT | NOT NULL DEFAULT `'PENDIENTE'`; CHECK IN (`'PENDIENTE'`, `'PRO_PMYE_GENERAL'`, `'PRO_PMYE_TRANSPARENTE'`, `'GENERAL_14A'`, `'PRESUNTO'`, `'NO_SUJETO_14'`) | Régimen tributario actual de la empresa (catálogo real; `PERSONA_NATURAL`/`PERSONA_JURIDICA` **no** son valores de régimen) |
| `regimen_desde_ac` | TEXT | Formato `AAAA` (`RE_AC` = `^(19\|20)\d{2}$` en la capa de aplicación); CHECK de fila: si `regimen = 'PENDIENTE'` entonces **debe ser NULL**. Con régimen distinto de PENDIENTE, la **capa de aplicación lo exige**; el CHECK de BD no prohíbe NULL en ese caso | Ejercicio comercial desde el que rige el régimen |
| `fecha_vigencia` | TEXT | **NULL permitido en cualquier régimen** (ni app ni CHECK lo exigen). Si no es NULL: `length = 10`, `YYYY-MM-DD` con mes 1-12 y día 1-31 (CHECK), `regimen_desde_ac IS NOT NULL` y año = `regimen_desde_ac` (CHECK). La validez de calendario completa (p. ej. `2025-02-30`) la valida la capa de aplicación | INICIO de vigencia del régimen, día exacto; puede ser histórico |
| `tipo_contribuyente` | TEXT | NOT NULL DEFAULT `'PENDIENTE'`; CHECK IN (`'PENDIENTE'`, `'PERSONA_NATURAL'`, `'PERSONA_JURIDICA'`) | Tipo de contribuyente |
| `estado_ficha` | TEXT | NOT NULL DEFAULT `'SIN_CONFIGURAR'`; CHECK IN (`'SIN_CONFIGURAR'`, `'CONFIGURADA'`) | Estado **calculado** por la capa de aplicación (nunca se recibe del cliente) |
| `actividades_economicas` | TEXT | NOT NULL DEFAULT `'[]'` | JSON array de rubros/glosas (máx. 30, no vacíos) |
| `fecha_inicio_actividades` | TEXT | `YYYY-MM-DD` o NULL | Fecha de inicio de actividades |
| `propietarios_json` | TEXT | NOT NULL DEFAULT `'[]'` | JSON array de `{ rut, participacion, gravado_finales }`; la API recibe `propietarios` y el núcleo persiste en `propietarios_json` |
| `sujeto_boletas_honorarios` | INTEGER | NOT NULL DEFAULT 0; CHECK IN (0, 1) | Opt-in explícito de la regla BHE |
| `vigente_desde` / `vigente_hasta` | TEXT | `vigente_desde` NOT NULL DEFAULT `date('now')`; `vigente_hasta` NULL | Marcas de vigencia de la fila; **no versionan el historial**: existe **una sola fila por empresa** (`UNIQUE(empresa_id)`) que el `PUT` **sobrescribe** (`plan-ficha.js` L265), y los cambios quedan en `plan_ficha_historial` (append-only). Hoy solo se snapshotean al firmar el historial (`_snapshot`, L212); ningún cálculo ni filtro las consume |
| `creado_en` / `actualizado_en` | TEXT | DEFAULT `datetime('now')` | Marcas de tiempo (los nombres reales de columna; no son `created_at`/`updated_at`) |

**Índices y protecciones:** `UNIQUE(empresa_id)` (una ficha por empresa) + índice `idx_plan_ficha_tributaria_rut` sobre `rut`. El historial `plan_ficha_historial` es **append-only por triggers de BD** (UPDATE y DELETE abortan con `RAISE`).

---

## 4. Flujo de creación, actualización, estados y validaciones

### Estados de la ficha

Los centinelas `PENDIENTE`/`SIN_CONFIGURAR` son **ausencia de decisión**.

Distinción de capas: `regimen` y `tipo_contribuyente` admiten el **valor** `PENDIENTE` (catálogo y CHECK de BD); `estado_ficha` solo admite `SIN_CONFIGURAR`/`CONFIGURADA` y se **calcula** en la capa de aplicación (nunca se recibe del cliente): `CONFIGURADA` ⇔ `regimen ≠ PENDIENTE` **y** `tipo_contribuyente ≠ PENDIENTE` **y** `actividades_economicas` con ≥ 1 rubro. `fecha_vigencia` **no** entra en ese cálculo.

| Estado / centinela | Significado | Comportamiento |
|---|---|---|
| `regimen = 'PENDIENTE'` (valor) | Declaración pendiente: no hay régimen definido | No se admite `fecha_vigencia` (throw); throw si se intenta volver a `PENDIENTE` una ficha ya declarada |
| `estado_ficha = 'SIN_CONFIGURAR'` | Datos incompletos: falta régimen, tipo o actividades | Valor por defecto de la fila; ausencia de decisión |
| `estado_ficha = 'CONFIGURADA'` | Régimen + tipo + ≥ 1 actividad declarados | Estado **calculado** en cada delta; escritura con `planificacion:gestionar` |

### Flujo de creación

1. **Estado inicial real (sin fila):** el alta desde SII (SAAS-1) **no** crea la ficha de planificación (corregido en D2.2): mientras nadie declare, no hay fila en `plan_ficha_tributaria`, el `GET` responde `ficha: null` y la vista muestra `SIN_FICHA`. La fila nace **solo** con la incorporación explícita: «Incorporar ficha» → `POST .../ficha` → `plan-ficha.incorporar` (INSERT de `empresa_id` + `rut` con defaults `PENDIENTE`/`SIN_CONFIGURAR`). No se requiere intervención inmediata.
2. **Completado de ficha:** El contador o super_admin completa los campos:
   - `regimen` (valores reales: `PRO_PMYE_GENERAL`, `PRO_PMYE_TRANSPARENTE`, `GENERAL_14A`, `PRESUNTO`, `NO_SUJETO_14`; `PERSONA_NATURAL`/`PERSONA_JURIDICA` son valores de `tipo_contribuyente`, no de régimen)
   - `regimen_desde_ac` (formato `AAAA`, ej. `2025`)
   - `fecha_vigencia` (**opcional**, ver §5; si se informa: `YYYY-MM-DD` real y año = `regimen_desde_ac`)
   - `tipo_contribuyente`
   - `actividades_economicas` (JSON opcional)
   - `fecha_inicio_actividades` (YYYY-MM-DD opcional)
3. **Validación automática (capa de aplicación, `plan-ficha.js`):**
   - `regimen` debe estar en `CAMPOS_TRIBUTARIOS.REGIMEN` = `['PENDIENTE', 'PRO_PMYE_GENERAL', 'PRO_PMYE_TRANSPARENTE', 'GENERAL_14A', 'PRESUNTO', 'NO_SUJETO_14']` (el objeto completo agrega `TIPO_CONTRIBUTUYENTE` y `ESTADO_FICHA`)
   - Si `regimen ≠ PENDIENTE`, `regimen_desde_ac` es obligatorio (si falta: throw `El régimen X exige regimen_desde_ac…`)
   - `regimen_desde_ac` debe pasar `RE_AC` = `^(19|20)\d{2}$`
   - `fecha_vigencia` solo se valida **si viene en el payload**: debe ser fecha real `YYYY-MM-DD`; si `regimen = PENDIENTE`, throw; exige `regimen_desde_ac`; y el año debe coincidir con `regimen_desde_ac` (si no: `fecha_vigencia (${vigFinal}) debe pertenecer al ejercicio regimen_desde_ac (${acFinal})`)
   - **Capa de BD (CHECK):** valida la forma de `fecha_vigencia`, el año = `regimen_desde_ac` cuando no es NULL y `regimen = PENDIENTE ⇒ regimen_desde_ac IS NULL`. **No** exige `fecha_vigencia`, ni `regimen_desde_ac` con régimen cargado: esas exigencias son solo de la capa de aplicación.
4. **Estado final:** con `regimen ≠ PENDIENTE` + `tipo_contribuyente ≠ PENDIENTE` + ≥ 1 actividad, `estado_ficha` pasa a `CONFIGURADA` (**sin requerir `fecha_vigencia`**).

### Actualización

- Igual que creación, con la restricción adicional: **no se puede volver a PENDIENTE una ficha ya declarada** (ficha que ya tenía regimen diferente de PENDIENTE).
- Si se intenta actualizar regimen a PENDIENTE sobre una ficha CONFIGURADA, se lanza Error.

---

## 5. Semántica y relación entre `regimen`, `regimen_desde_ac` y `fecha_vigencia`

### `regimen`

- Define **qué régimen** tributario aplica a la empresa.
- Valores posibles (catálogo real): `PENDIENTE` (centinela de ausencia), `PRO_PMYE_GENERAL`, `PRO_PMYE_TRANSPARENTE`, `GENERAL_14A`, `PRESUNTO`, `NO_SUJETO_14`. **No** incluye `PERSONA_NATURAL`/`PERSONA_JURIDICA`: esos son valores de `tipo_contribuyente`.
- **No** determina por sí solo la tasa PPM ni las reglas de contabilización (verificado en código el 29-10-2026): ningún módulo deriva la tasa desde `regimen`, y la que usa el informe de Salud Tributaria viene de `empresas.tasa_ppm` (`salud-tributaria.js` L777/L821). Su efecto hoy es descriptivo: declara el régimen de la empresa, sin consumidores.

### `regimen_desde_ac`

- Define el **ejercicio comercial** desde el que rige el régimen.
- Formato obligatorio: `AAAA` (4 dígitos, ej. `2025`; `RE_AC` = `^(19|20)\d{2}$`).
- Es **exigido por la capa de aplicación** cuando `regimen ≠ PENDIENTE` (throw `El régimen X exige regimen_desde_ac…`). El CHECK de fila solo obliga a NULL cuando `regimen = 'PENDIENTE'`; con régimen cargado la BD tolera NULL — límite documentado (auditoría 29-10).
- Permite históricizar cambios de régimen: si la empresa cambia de régimen, se actualiza este campo.

### `fecha_vigencia`

- Es el **INICIO de vigencia** del régimen, día exacto.
- Formato: `YYYY-MM-DD` (ej. `2025-01-01`); la capa de aplicación valida que sea fecha real de calendario (rechaza `2025-02-30`).
- **Puede quedar NULL:** ni la capa de aplicación ni el CHECK de BD exigen su presencia (comportamiento verificado en código el 29-10; la afirmación anterior «No admite NULL si `regimen ≠ PENDIENTE`» era incorrecta y fue corregida por la auditoría D2).
- Si `regimen = PENDIENTE`, `fecha_vigencia` debe ser NULL: la capa de aplicación rechaza la fecha con throw («Una ficha PENDIENTE no admite fecha_vigencia»).
- Si se informa, debe ser **coherente** con `regimen_desde_ac`: el año debe coincidir con el ejercicio `AAAA` (CHECK de BD + validación de aplicación).
- Ejemplo: `regimen_desde_ac = 2025` y `fecha_vigencia = 2025-06-15` es válido (dentro del ejercicio 2025).
- **Decisión de negocio pendiente:** si debe ser obligatoria cuando `regimen ≠ PENDIENTE`. Hoy **no lo es**; hacerlo obligatorio exigiría un cambio de código/CHECK en una **fase de código autorizada** (esta fase solo documenta, no modifica código).

### Relación lógica

```
regimen = PENDIENTE          → regimen_desde_ac = NULL (CHECK de fila);
                                fecha_vigencia = NULL (si se informa, la capa de aplicación la rechaza)
regimen ≠ PENDIENTE          → regimen_desde_ac = AAAA obligatorio (capa de aplicación)
                                → fecha_vigencia es OPCIONAL (ni app ni CHECK la exigen)
                                → si se informa: YYYY-MM-DD real y año = regimen_desde_ac
```

---

## 6. Comportamiento de empresas sin ficha

- Si una empresa no tiene ficha en `plan_ficha_tributaria`, las vistas del sistema (`views-plan.js`) muestran un chip `SIN_FICHA` (estado `pendiente` rojo).
- Sin ficha: `GET .../planificacion/ficha` responde **200 con `ficha: null`** (ausencia de declaración, no un error). Solo `PUT .../planificacion/ficha` responde **404** («use incorporación explícita (POST)») y el `POST` sobre una empresa con ficha responde **409**.
- **La ficha no se crea automáticamente** (corregido en D2.2): ni el alta desde SII (SAAS-1) ni la primera `sync-diaria` escriben en `plan_ficha_tributaria`. Hasta una incorporación explícita (`POST` con `planificacion:gestionar`) la empresa queda **sin fila** — chip `SIN_FICHA` y CTA «Incorporar ficha» en `views-plan.js` — y la fila nace `PENDIENTE`/`SIN_CONFIGURAR` en ese `POST`, no antes.

---

## 7. Archivos relevantes del backend y frontend

### Backend

| Archivo | Rol |
|---|---|
| `backend/core/plan-ficha.js` | Núcleo lógico: validación de estados, creación (`incorporar`, solo vía `POST`), actualización (`PUT`), normalización; **define `RE_AC`** = `^(19\|20)\d{2}$` (línea 22), la regex que valida `regimen_desde_ac`. Exporta: `obtener`, `listarHistorial`, `normalizar`, `incorporar`, `actualizar`, `CAMPOS_TRIBUTARIOS`. |
| `backend/core/planificacion-tablas.js` | Define `CAMPOS_TRIBUTARIOS` y el DDL de las tablas (CHECK de `tipo_contribuyente`, `regimen`, `fecha_vigencia` y de consistencia `regimen`/`regimen_desde_ac`) más su migración idempotente. Exporta: `planificacionTablas`, `CAMPOS_TRIBUTARIOS`. **No define `RE_AC`** (atribución corregida en D2.2: esa regex vive en `plan-ficha.js`). |
| `backend/routes/planificacion.js` | Rutas Express: `GET /empresas/:empresaId/planificacion/ficha`, `GET .../historial`, `POST .../ficha`, `PUT .../ficha`. Usa `requirePermiso` para RBAC. |
| `backend/core/empresas-sii.js` (parcial) | `asegurarFicha` — corre al final de sync diaria; descarga ficha si falta o >7 días; anota fallos en `resumen.fichas` sin tumbar la corrida. (Ruta corregida en D2.1: no existe `backend/services/empresas-sii.js`; el módulo vive en `backend/core/`, como ya decía la §2 de este documento.) |

### Frontend

| Archivo | Rol |
|---|---|
| `frontend/sistema/views-plan.js` | Renderiza la vista de planificación: ficha, chips de estado (`CONFIGURADA`/ `PENDIENTE`/`SIN_FICHA`), formulario de completado, validación en vivo. |
| `frontend/sistema/app.js` | Boot, shell, selector de empresa, propaga período y contexto de ruta. |
| `frontend/shared/uitoolkit.js` | Componentes UI: chips, formularios validación, etc. (usados en views-plan.js). |

---

## 8. Pruebas existentes y qué verifican realmente

### `test/plan-ficha.test.js`

Tests unitarios del core que cubren:

1. **Estados iniciales:** Ficha nueva nace `PENDIENTE`/`SIN_CONFIGURAR`.
2. **Validación de régimen:** `regimen` inválido lanza Error; `CAMPOS_TRIBUTARIOS` son los únicos valores permitidos.
3. **Validación de `regimen_desde_ac`:** Formato `AAAA` obligatorio; formato inválido lanza Error.
4. **Validación de `fecha_vigencia`:** el campo es **opcional** (comportamiento actual: ni la capa de aplicación ni el CHECK de BD exigen su presencia — ver §5); **si se proporciona**, su formato `YYYY-MM-DD` es obligatorio (fecha real de calendario, año = `regimen_desde_ac`), y si `regimen = PENDIENTE` lanza Error "Una ficha PENDIENTE no admite fecha_vigencia".
5. **No retroceso a PENDIENTE:** No se puede cambiar a PENDIENTE una ficha ya declarada (CONFIGURADA).
6. **Historial:** `listarHistorial` devuelve las entradas de `plan_ficha_historial` con `antes_json`, `despues_json`, `ip`, `usuario_id`, `usuario_nombre` (join con `users`) y `creado_en` (límite por defecto 20, tope 100).
7. **Incorporación coherente:** `incorporar` valida todas las restricciones antes de guardar.

**Qué NO cubren:** Datos reales, login a producción, persistencia en BD real bajo carga, integración con sync-diaria en entorno de producción.

### `test/planificacion-tablas.test.js`

Tests de validación de las tablas de planificación: tipos de contribuyente, formato de `regimen_desde_ac`, campos CAMPOS_TRIBUTARIOS.

### `test/planificacion-expansion.test.js`

Tests de expansión de criterios: qué sucede al completar distintos campos, cómo interactúan `regimen`, `regimen_desde_ac`, `fecha_vigencia`, `tipo_contribuyente`.

**Alcance de los tests (reclasificado el 29-10-2026):** — *Archivos listados:* los 3 archivos figuran en la lista de `npm test` de `package.json` (82 archivos listados en total). — *Última corrida documentada:* 816/816 del 28-10-2026, **no reejecutada en la fase D2**. — *Conteo estático 29-10:* 38 declaraciones `test`/`it` en estos 3 archivos (`plan-ficha` 14, `planificacion-tablas` 12, `planificacion-expansion` 12); 815 en los 82 listados. — *Excepción:* `test/confirmar-atomico.regression.test.js` (2 declaraciones, commit `7db88a7`) **no figura en la lista de `npm test`** y hoy no se ejecuta; incorporarlo queda **pendiente de una fase de código autorizada**.

---

## 9. Limitaciones, riesgos y pendientes operativos

### Limitaciones documentadas en código

1. **`PENDIENTE` no admite `fecha_vigencia`:** Si se intenta asignar `fecha_vigencia` cuando `regimen = PENDIENTE`, el núcleo lanza Error. El flujo esperado es completar el régimen primero.
2. **Empresas sin ficha:** Si la empresa no tiene fila en `plan_ficha_tributaria`, las vistas muestran `SIN_FICHA` (informativo). **Ninguna funcionalidad queda bloqueada por esa ausencia**: no hay gating ni consumidores de la ficha fuera del módulo (verificado el 29-10-2026), por lo que Salud Tributaria y el resto del sistema operan igual.
3. **Concurrencia:** Dos sincronizaciones concurrentes podrían intentar actualizar la misma ficha; el núcleo no tiene bloqueo optimista explícito. La concurrencia la resuelve SQLite: better-sqlite3 opera la base en **modo WAL** — propiedad del diario de la BD, **no** «de las migraciones» (redacción corregida en D2.2) — con un único escritor a la vez en el nodo único actual.
4. **Validación contable no incluida:** El esquema y validaciones son tributarias; la coherencia contable (partida doble, ΣD=ΣH) depende de FASE 2 y no se validó en este módulo.

### Pendientes operativos (no bloquean MVP, requiere decisión)

1. **Validación contable de coherencia `fecha_vigencia`/`regimen_desde_ac`:** Revisar con el contador que el tratamiento de estas fechas en la contabilización es el adecuado (queda por definir si el régimen empieza el 1° o el 15° del mes y cómo incide en el devengo del PPM, etc.).
2. **Migración de `clientes.clave_sii` legado:** Las empresas creadas antes de la FASE 1 tienen `clave_sii` en texto plano en `clientes`. El plan de migración a bóveda AES-256-GCM (FASE 1) incluye actualizar el régimen y la ficha tributaria, pero no está automatizada.
3. **Tratamiento de empresas con ficha `PENDIENTE` antigua:** Algunas empresas pueden tener ficha `PENDIENTE` desde hace meses/años por falta de intervención. Definir política: ¿notificar al contador? ¿forzar completado? ¿dejar como está?
4. **Integración con Salud Tributaria (pendiente, no implementada):** hoy el `score`, la cobertura `cobertura_fuentes` y la dimensión de calidad se calculan con la **ficha del SII** (o las columnas de onboarding de `empresas`) y con los datos RCV/F29 — `fichaPct` (`salud-tributaria.js` L1299) usa `inicioActividades`, `regimen` y `actividades` de esa ficha, no de `plan_ficha_tributaria`. Una empresa con ficha de planificación `PENDIENTE`/`SIN_CONFIGURAR` **no** ve alterado su score. Integrar ambas fichas es trabajo futuro.
5. **API pública vs internal:** Las rutas actuales están pensadas para consumo interno (`/api/contable/`). Si se requiere exposición externa, considerar versión pública con auth diferente y rate-limit.

---

## 10. Relación con Salud Tributaria, RCV y F29

### Conexiones documentadas

1. **Salud Tributaria ← ficha del SII (no la de planificación):** el indicador `score`, la cobertura `cobertura_fuentes` y la dimensión de calidad se construyen con la **ficha oficial del SII** (`leerFichaGuardada`) o, en su defecto, con las columnas de onboarding de `empresas` (`fichaDesdeEmpresa`, L297-316; `fichaPct` L1299), más los datos RCV/F29. La ausencia de esa ficha produce el hallazgo `FICHA_AUSENTE` (L1120). **`plan_ficha_tributaria` no participa en el cálculo** (verificado el 29-10-2026: cero referencias en `salud-tributaria.js`).
2. **F29 estimado ← `empresas.tasa_ppm` (no la ficha de planificación):** el PPM estimado se calcula como `ingresos netos × tasa_ppm` con la tasa de la tabla `empresas` (`salud-tributaria.js` L777, L821); `regimen` de la ficha de planificación no interviene. Si `tasa_ppm` es 0 o falta, el PPM estimado resulta 0 — no hay una «tasa por defecto» derivada del régimen.
3. **Ficha SII en sync-diaria (entidad distinta de la ficha de planificación):** `empresas-sii.asegurarFicha` corre al final de cada sync diaria exitosa y refresca la **ficha oficial del SII** (`data/sii-fichas/<rut>.json`) si falta o tiene >7 días; si el RCV falla, no se busca (test T8 de sync-diaria). Esta función **no escribe en `plan_ficha_tributaria`**: la ficha de Planificación solo nace por incorporación explícita (§4). La redacción anterior («la ficha se crea…») inducía a creer lo contrario — corregido en D2.2.
4. **Datos históricos citados (no re-validados en D2):** la evidencia documental (`CURRENT_STATE.md`, 21-10) registra 5 años de F29 + boletas en **5 de 6 empresas** — 1, 2, 3, 5 y 6; la **empresa 4 falló por sesión/credenciales** (clave SII incorrecta) y no tiene datos. Scores de esa corrida: empresas 1 y 6 con score 90 (CON_OBSERVACIONES, con `F29_DIFERENCIA`), empresas 2 y 3 con score 75 (REQUIERE_REVISION, `COBERTURA_RCV_PARCIAL`), empresa 4 con 32 SIN_INFORMACION y empresa 5 con 87. Son cifras de esa corrida histórica, no una validación actual ni cobertura completa.
5. **Resuelto en código (29-10-2026):** la tasa PPM del cálculo proviene de `empresas.tasa_ppm` y la ficha que alimenta el informe es la del SII; la ficha de planificación no participa (ver los puntos 1 y 2). Queda como **decisión de producto** (no verificable en esta fase) si debería pasar a alimentarlas en el futuro.

### Conexiones no verificadas en este diagnóstico

- No se ejecutó login a producción ni se consultaron datos reales del SII desde este programa.

---

## 11. Historial de cambios (resumen)

| Fecha | Commit | Cambio |
|---|---|---|
| 2026-10-25 | `7db88a7` | Commit 2 - Propuestas y confirmar-atomico (continuación Planificación Tributaria). Implementación de `regimen`, `regimen_desde_ac`, `fecha_vigencia`, `CAMPOS_TRIBUTARIOS`, estados PENDIENTE/SIN_CONFIGURAR/CONFIGURADA, validaciones coherentes. 3 archivos de test nuevos. |
| 2026-10-28 | `8f215f2` | Make tax health reports verify complete SII coverage. Integración de salud tributaria con datos reales; las rutas de planificación ya formaban parte del código desde antes. |

**Nota (corregida en D2.1, 29-10-2026):** la afirmación anterior —«no hay migraciones nuevas; el esquema `plan_ficha_tributaria` ya existía o de FASE 1»— era **incorrecta** y se sustituye por la distinción de tres niveles —creación del esquema, migración idempotente y ejecución— más una aclaración sobre dónde viven las validaciones, verificada en código:

1. **Creación del esquema (no es de FASE 1):** las tablas las crea `backend/core/planificacion-tablas.js` (módulo T0-A, commit `7db88a7`, 25-10-2026): `CREATE TABLE IF NOT EXISTS plan_ficha_tributaria` (con sus CHECK, `UNIQUE(empresa_id)` e índice `idx_plan_ficha_tributaria_rut`) y `CREATE TABLE IF NOT EXISTS plan_ficha_historial` (índice `idx_plan_ficha_historial_empresa` + los dos triggers append-only `trg_plan_ficha_historial_no_update` / `trg_plan_ficha_historial_no_delete`).
2. **Migración idempotente:** además del `CREATE TABLE IF NOT EXISTS`, el módulo ejecuta `PRAGMA table_info(plan_ficha_tributaria)` y, si la columna falta en una BD preexistente, `ALTER TABLE … ADD COLUMN fecha_vigencia` **con sus CHECK** (los CHECK viajan con la columna, de modo que el esquema migrado y el recién creado quedan equivalentes). No hay carpeta `migrations/` con SQL versionado (decisión de proyecto, `CURRENT_STATE.md` §8.6): el DDL vive en el core, patrón idempotente habitual.
3. **Estado de ejecución (no verificado en esta fase):** la función se invoca desde `backend/core/migraciones.js` (`migracionesPlanificacion`, línea 1135) y ésta desde `backend/db.js:402`, en la cadena de migraciones que corre al abrir la BD. **No se abrió ninguna BD ni se arrancó el backend en D2.1**, así que la ejecución efectiva en una BD real queda **pendiente de verificación**; los tests la invocan directamente (`test/planificacion-tablas.test.js`, `test/planificacion-expansion.test.js`).
4. **Validaciones = dos capas (no «solo core Node.js»):** capa de aplicación (`plan-ficha.js`: catálogos, `RE_AC`, exigencias, calendario real) **y** CHECK del esquema escritos en `planificacion-tablas.js`. Sin migraciones SQL versionadas, pero con restricciones de BD reales.

---