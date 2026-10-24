# 23 · Validación visual y funcional en navegador (F3)

> **Fecha de ejecución:** 2026-10-24 · **Rama:** `master` · **Commit base:** `85f93e9`
> **Modo:** validación en Chrome real sobre una **base de datos ficticia** en el
> directorio temporal del sistema. No se usaron credenciales productivas, no se
> consultó el SII/TGR/MercadoPago y no se emitió ningún DTE.
> **Cambios:** solo en el frontend, el script de capturas y los tests. Sin commits
> ni despliegues (ver §9).

Etiquetas usadas: **Verificado** (ejecutado con resultado) · **Inspeccionado**
(leído en el código) · **NO VERIFICADO** (no se pudo comprobar en esta pasada).

---

## 1. Entorno de validación

### 1.1 Herramientas disponibles (sin agregar dependencias)

| Herramienta | Estado | Uso |
|---|---|---|
| `puppeteer-core` 25.x | Ya es dependencia (`package.json`); el proyecto la usa para leer el portal del SII | Automatización y capturas |
| Chrome instalado en el equipo | Verificado (`puppeteer-core` lo resuelve por canal/`CHROME_PATH`) | Navegador real |
| `node --test` (Node 25.8.2 en la corrida) | Verificado | Suite |
| `better-sqlite3` | Ya en el stack | BD temporal |

No se instaló nada nuevo: la herramienta de navegador que faltaba se resolvió con
la dependencia que el proyecto ya tenía.

### 1.2 Cómo se levanta el sistema sin tocar producción

`scripts/validacion-pre-produccion/capturas-f3.js` (nuevo, solo para QA):

1. **Siembra** `scripts/validacion-pre-produccion/entorno-demo.js` sobre
   `os.tmpdir()/jmv-f3/demo.db` — **nunca** `data/iva_mensual.db`.
   `entorno-demo.js` aborta si `DB_PATH` no parece temporal
   (`/tmp|temp|demo|f3/i`), así que un error de tipeo no puede sembrar la base real.
2. Las empresas ficticias se crean con **`clave_sii = ''`**: `sync-diaria` filtra
   las empresas sin clave, por lo que **ninguna** ruta de lectura puede intentar
   autenticarse contra el SII durante la corrida.
3. `SECRETOS_MASTER_KEY` es **efímera** (32 bytes aleatorios por corrida): solo
   cifra/descifra las claves ficticias de esa BD temporal.
4. Servidor en `127.0.0.1:3599` (`F3_PORT`), `NODE_ENV=test`, `DB_PATH` temporal.
5. Login con usuario `demo` / `DemoF3.2026` (creado con el `hashPassword` real de la
   aplicación, no credenciales productivas).

**Verificado:** en la corrida completa no hubo ninguna petición saliente al SII
(el adaptador no se invoca porque no hay clave) y `data/iva_mensual.db` no se abrió.

---

## 2. Auditoría de `npm run seed:v` (F2)

Pregunta a responder: ¿qué hace, dónde escribe y pudo afectar datos productivos?

**Implementación inspeccionada** (`scripts/seed-versionado.js`, 83 líneas):

- Recorre **solo** `frontend/**/*.html` y reescribe el query `?v=` de las
  referencias a `/sistema|shared|css|assets/*.js|.css` con
  `sha1(contenido del archivo).slice(0, 8)`.
- No abre la base de datos, no lee `.env`, no hace red, no toca `data/`, no toca
  `package.json` ni el backend. Escribe **un solo archivo** en el repo:
  `frontend/sistema/index.html`.
- Falla (y no escribe) si una referencia apunta a un archivo inexistente.

**Ejecutado en esta pasada** después de los cambios de F3:

```
· frontend\sistema\index.html: 29 referencia(s) rehashadas
Versionado por contenido: 75 referencia(s) en 1 página(s)
```

Lectura correcta de esos números: **75** referencias versionadas en total (todas
las páginas de `frontend/`), **29** de ellas en `sistema/index.html`, que fue la
única página cuyo HTML cambió (porque cambió `app.js`/`sistema.css`).

**Conclusión:** `npm run seed:v` **no puede** afectar datos productivos — no
accede a la BD ni a la red. La afirmación de F2 («75 referencias reversionadas»)
se refiere al total versionado en el sitio, no a escrituras de datos, y se
confirma aquí con el diff: solo cambian query strings `?v=`.

---

## 3. Cobertura real de la inspección visual

Corrida completa: `node scripts/validacion-pre-produccion/capturas-f3.js`
(informe máquina: `docs/handoff-integral/capturas-f3/informe-f3.json`).

| Conjunto | Cantidad | Resolución |
|---|---|---|
| Escritorio | **39** pantallas → **47 PNG** (incluye 8 capturas de detalle: inicio/centro/salud/reportes completos, las 2 del informe con media `print`, menú acordeón, ruta inexistente y ruta restringida) | 1440 × 900 |
| Tableta | **7** pantallas | 768 × 1024 |
| Móvil | **7** pantallas → **8 PNG** (+ menú abierto) | 390 × 844 |
| Informe imprimible de Salud Tributaria | **6** páginas (`informe-impreso-parte-1..6.png`) | media print |
| Casos de borde | ruta inexistente, ruta restringida por rol, menú móvil abierto, documento filtrado por URL | mixto |
| **Total** | **68 PNG + `informe-f3.json` = 69 archivos** (`ls docs/handoff-integral/capturas-f3/*.png \| wc -l` → 68) | — |

Por cada pantalla el script registra: título, breadcrumb, ítem de menú activo,
empresa/período del header, `error_visible`, desbordes horizontales, textos
recortados (`nowrap` que excede su caja), tablas con scroll propio y errores de
consola.

**Resultado de la última corrida (post-correcciones):**

```
pantallas 39 · responsive 14 · recorridos 7 · errores de consola []
con defectos: ninguna
```

Es decir: **0 desbordes, 0 textos recortados, 0 vistas con error visible, 0
errores de consola, 0 respuestas ≥ 400** en las 39 pantallas de escritorio, y las
14 capturas responsive limpias. (Las respuestas ≥ 400 se registran en el mismo
arreglo `consola` — `page.on('response')` del script —, que quedó vacío en todas
las pantallas.)

### 3.1 Pantallas efectivamente inspeccionadas (navegador real)

Inicio: `inicio`, `centro` (Todos los módulos), `alertas`.
Documentos: `documentos`, `libros`, `dte`, `dte-config`.
Contabilidad: `automatizacion`, `propuestas`, `asientos`, `memoria`, `activos`, `cierre`.
Impuestos y Salud: `salud`, `analitica`, `calculadora-iva`, **informe imprimible de Salud Tributaria**.
Tesorería: `tesoreria`, `cobranza`.
Informes: `reportes` + los **6 reportes de F0** (`comprobacion`, `balance8`,
`situacion`, `resultados`, `clasificado`, `niif`), `cclientes`, `cproveedores`.
Portal del cliente: `portal-inicio`, `portal-ventas`, `portal-cartera`,
`portal-cotizaciones`, `portal-costos` (con el usuario demo, que tiene acceso).
Administración: `crm`, `portafolio`, `admin`, `auditoria`, `integraciones`, `suscripcion`.

Navegación lateral y acordeón: las 8 áreas y sus 44 funciones se recorrieron
programáticamente (§5, paso 2) y se capturó el estado de cada sección.

---

## 4. Matriz de defectos (encontrados → corregidos)

Todos se reprodujeron en el navegador antes de corregirlos y quedaron fijados por
un test en `test/ux-f3-validacion.test.js`.

| ID | Severidad | Síntoma observable | Evidencia | Corrección | Test |
|---|---|---|---|---|---|
| F3-1 | **Alto** | La marca JMV del sidebar y del login embebido era `logo-light.svg` (wordmark **blanco**) sobre fondo claro: solo se veían los puntos del logo | `escritorio-1440-inicio.png`, `escritorio-1440-centro.png` | `logoMarcaHTML()` emite las dos variantes y el CSS muestra la que corresponde a `data-theme` | F3-1 |
| F3-2 | Medio | En el Centro de Reportes las descripciones de «Próximamente» iban dentro de `.chip` (`white-space: nowrap`) y se derramaban sobre la tarjeta vecina | `escritorio-1440-reportes-completo.png` | Las tarjetas no disponibles usan `.rep-desc` (envolvente); el chip global sigue siendo de una línea | F3-2 |
| F3-3 | **Alto** | Tesorería mostraba «Ingresos/Egresos del mes» en **$0** con un cobro del período visible en la misma tabla (usaba el mes del calendario del servidor, no el período del header) | `escritorio-1440-tesoreria.png` | `resumen()` recibe y valida `periodo` (AAAA-MM), la ruta lo exige y la vista manda el período global; el rótulo dice «del período» | F3-3 |
| F3-4 | **Alto** (tributario) | La nota de alerta crítica del informe afirmaba «El índice es favorable» con el índice en **Crítica (34/100)** | `escritorio-1440-salud.png`, `informe-impreso-parte-1.png` | La nota depende de la clasificación real (`indiceBueno`); el texto «favorable» ya no se usa por defecto | F3-4 |
| F3-5 | **Alto** (dato contable) | El alta de activo fijo preseleccionaba **CAJA** (primera cuenta 1.x) como cuenta del activo | `escritorio-1440-activos.png` | Placeholder sin valor + validación antes de enviar | F3-5 |
| F3-6 | Bajo | RUT y fechas se partían en el guion dentro de las tablas (dígito verificador / día sueltos en otra línea) | `escritorio-1440-libros.png`, `movil-390-documentos.png` | `.tbl .rut` / `.tbl .fecha` con `white-space: nowrap` | F3-6 |
| F3-7 | **Alto** (móvil) | El dock (z-index 130) tapaba el panel de secciones abierto (z-index 120): las últimas entradas no se podían pulsar | `movil-390-menu-abierto.png` | Con `body.menu-movil` el dock se oculta en ≤960 px | F3-7 |
| F3-8 | **Alto** (afirmación falsa) | Integraciones mostraba el chip «Conectado» con la clave SII **vacía** | `escritorio-1440-integraciones.png` | El chip depende de `empresa.clave_sii_configurada`; sin clave dice «Sin clave SII» | F3-8 |
| F3-9 | Bajo | El badge de «área restringida» del Centro de Aplicaciones no se explicaba (ni con ratón ni con lector de pantalla) | `escritorio-1440-centro.png` | `title` + `aria-label` «Área restringida» | F3-9 |
| F3-10 | Bajo (a11y) | El ítem activo del sidebar solo se marcaba con la clase `.active` | Inspección de `renderRoute` | Además `aria-current="page"` en el enlace activo (y se retira del resto) | F3-10 |

---

## 5. Recorridos funcionales ejecutados

Registrados en `informe-f3.json → recorridos` (7 pasos automatizados) más la
navegación pantalla a pantalla de §3.

| # | Recorrido pedido | Resultado |
|---|---|---|
| 1 | Iniciar sesión con usuario de prueba | **OK** — login real contra el servidor aislado; aterriza en `#centro` con empresa y período resueltos |
| 2 | Entrar a un módulo desde la navegación principal | **OK** — 8 áreas, 44 ítems, todos con ruta válida |
| 3 | Acceder a una subfunción | **OK** — nivel 1 (área) → nivel 2 (función), p. ej. Informes → Balance de 8 Columnas |
| 4 | Cambiar de módulo y regresar | **OK** — sin estado pegado; el dock y el sidebar conservan la marca correcta |
| 5 | Filtros de fecha/período | **OK** — el período viaja en el hash (`?periodo=202609`) y se aplica en documentos, libros, tesorería y reportes |
| 6 | Abrir el detalle de un resultado | **OK** — detalle de documento y de asiento abren sin error de consola |
| 7 | Acciones de los reportes | **OK** — exportar/CSV e imprimir disponibles; las acciones sin datos suficientes quedan deshabilitadas con motivo |
| 8 | Vista imprimible con datos de prueba | **OK** — informe de Salud Tributaria, 6 páginas, sin enlaces rotos ni variables CSS sin resolver |
| 9 | Anchor directo con filtros | **OK** — `#documentos?estado=PENDIENTE&empresa=1&periodo=202609` resuelve título, breadcrumb e ítem activo y conserva el filtro |
| 10 | Comportamiento de las 6 vistas corregidas en F0 | **OK** — las 6 resuelven su identidad propia (`Inicio/Informes/<reporte>`), su capacidad `reportes:ver` y dejan de presentarse como Inicio |
| 11 | Rutas restringidas por rol | **OK** — `#crm` con rol tesorería muestra el bloqueo de UI (`escritorio-1440-ruta-restringida-crm-tesoreria.png`); el backend además responde 403 |
| 12 | Rutas desconocidas | **OK** — `#ruta-que-no-existe` aterriza en Inicio sin pantalla rota ni error de consola |

En todos los recorridos **breadcrumb, título, ítem activo y contenido coinciden**
(verificado por el contrato T2 de `test/navegacion-contratos.test.js` para los 49
anchors, y por el campo `breadcrumb`/`activo` del informe para las 39 capturas).

### 5.1 Nota de diseño (no es un defecto)

Los 6 reportes fuera de menú **no marcan ningún ítem del sidebar** (`activo: null`
en el informe). Es el contrato explícito de F0: no señalar como activo un ítem en
el que el usuario no está; la identidad la da el breadcrumb `Inicio/Informes/…`.
Se evaluó marcar «Centro de Reportes» como padre y **se descartó** para no cambiar
un contrato ya probado (T2). Queda como decisión de producto, no como defecto.

---

## 6. Calidad de Salud Tributaria

### 6.1 Los nueve estados de disponibilidad

Fuente única: `frontend/shared/estados-salud.js` + espejo del motor. Los 9 estados
existen con etiqueta, condición de uso, severidad y acción sugerida:

`verificado` · `con_observaciones` · `diferencia` · `requiere_revision` ·
`pendiente` · `fuente_no_disponible` · `error_tecnico` · `fuente_no_habilitada` ·
`no_concluyente`.

Fijado por `test/salud-estados.test.js` (E1–E6):

| Requisito de F3.4 | Cómo se cumple | Evidencia |
|---|---|---|
| Cero confirmado ≠ información desconocida | Un `$0` solo se trata como dato cuando la fuente fue consultada; sin consulta el valor es «no disponible» | E3 (fixtures de valor) |
| Indicadores sin datos suficientes | Cobertura y confianza explícitas («Cobertura 35% · Confianza BAJA»); el informe sin antecedentes **no puntúa** | E6 + `informe-impreso-parte-1.png` |
| Fuente no disponible | Estado propio, distinto de «defecto propio» | E5 |
| Error técnico | Estado propio con mensaje de qué pasó y qué sigue disponible | E2, E5 |
| Información antigua | Se conserva como evidencia **marcada** (no se borra ni se presenta como vigente) | E4 |
| Diferencias detectadas | `diferencia` con la conciliación F29 vs RCV | `escritorio-1440-salud-completo.png` |
| Mensajes de reintento | Cada estado explica qué hacer a continuación (sin mensajes genéricos) | E2 |
| Coherencia período ↔ indicador ↔ evidencia | El período evaluado (`202510 a 202609`) aparece en cabecera, en cada bloque y en el anexo del informe | `informe-impreso-parte-1..6.png` |
| Coherencia pantalla ↔ informe imprimible | Mismo motor (`salud-tributaria.js`) y mismo formato de clasificación en pantalla y PDF | `escritorio-1440-salud.png` vs `informe-impreso-parte-1.png` |
| Sin duplicaciones | El informe no repite la conciliación en dos secciones; el resumen ejecutivo remite al bloque | inspección de las 6 páginas |
| No se presenta como certificado oficial del SII | El informe declara: «Documento de trabajo técnico; no constituye certificación tributaria» y «**No es un certificado oficial del SII**» | `informe-salud-html.js:1121,1148` |

**NO VERIFICADO:** ninguna cifra de Salud Tributaria se contrastó contra el SII
real. Los datos son ficticios y el sistema **no** simuló una conexión exitosa; el
módulo se validó en su comportamiento de presentación y de estados, no en la
exactitud de los datos oficiales.

---

## 7. Regresión

- Después de cada corrección: archivo de test específico en verde.
- **Línea base reportada al empezar F3:** 652/652 (cierre de F2; no se volvió a
  ejecutar como paso previo de esta pasada).
- **Suite completa al terminar F3/F4:** `npm test` → **662 pruebas, 662
  aprobadas, 0 fallos, 0 canceladas, 0 omitidas** (exit 0).
  > **Actualización (2026-10-24, tras F5):** la suite es **686/686** (exit 0),
  > re-ejecutada dos veces en esta fecha (70,8 s y 106,8 s). Las 24 pruebas
  > nuevas son de F5 (`seguridad-f5`, `dte-certificado`, `backup-vigilancia`).
  > El número 662 es el de esta fase, no el vigente.
  Las 10 pruebas nuevas son las regresiones F3-1…F3-10 de
  `test/ux-f3-validacion.test.js`; **ninguna aserción existente se eliminó ni se
  debilitó**. En esta pasada la suite completa se ejecutó tres veces: en la
  primera, un cambio propio (marcar el ítem padre en el sidebar) rompió 2
  contratos de F0; se detectó, se revirtió el cambio y las dos corridas
  siguientes quedaron en 662/662.
- Archivos de test relevantes: `test/ux-f3-validacion.test.js` (10 casos, nuevo),
  `test/navegacion-contratos.test.js`, `test/ux-unificacion.test.js`,
  `test/salud-estados.test.js`, `test/salud-presentacion.regression.test.js`.
- `npm run seed:v` ejecutado tras el último cambio de frontend (`?v=` actualizados).

Nota de proceso: durante la validación se intentó además marcar el ítem padre en
el sidebar para las 6 vistas fuera de menú. Eso rompió el contrato T2 de F0 (que
exige «vista sin menú = ningún ítem activo»); **se revirtió** y se documentó como
decisión de producto (§5.1) en lugar de reescribir el contrato.

---

## 8. Limitaciones declaradas

1. **Integraciones en vivo:** no se validó ninguna llamada real a SII, TGR,
   MercadoPago ni emisión de DTE. La BD ficticia usa `clave_sii = ''` y el sistema
   no contacta a nadie. Ver `24` §7 para la matriz.
2. **Portal del cliente:** se inspeccionó con el usuario demo (acceso completo).
   No se probó con un usuario cliente restringido real.
3. **Accesibilidad:** se revisaron foco, `aria-*` y contraste de forma dirigida
   (no una auditoría WCAG completa con lector de pantalla).
4. **Imprenta:** las 6 páginas del informe se capturaron con la emulación de media
   `print` de Chrome, no con una impresora física ni con otro motor.
5. **Datos:** todas las cifras son ficticias; no se afirma exactitud tributaria.

---

## 9. Índice de capturas verificadas

Carpeta: `docs/handoff-integral/capturas-f3/` (68 PNG + `informe-f3.json` = 69 archivos; verificado con `ls *.png | wc -l`).

**Escritorio 1440 (47 PNG / 39 pantallas + 8 de detalle):**
`inicio`, `inicio-completo`, `centro`, `alertas`, `documentos`,
`documentos-filtrado`, `libros`, `dte`, `dte-config`, `automatizacion`,
`propuestas`, `asientos`, `memoria`, `activos`, `cierre`, `salud`,
`salud-completo`, `salud-informe-print`, `salud-informe-print-media`,
`analitica`, `calculadora-iva`, `tesoreria`, `cobranza`, `reportes`,
`reportes-completo`, `comprobacion`, `balance8`, `situacion`, `resultados`,
`clasificado`, `niif`, `cclientes`, `cproveedores`, `portal-inicio`,
`portal-ventas`, `portal-cartera`, `portal-cotizaciones`, `portal-costos`,
`crm`, `portafolio`, `admin`, `auditoria`, `integraciones`, `suscripcion`,
`menu-acordeon`, `ruta-inexistente`, `ruta-restringida-crm-tesoreria`.

**Tableta 768 (7):** `centro`, `inicio`, `documentos`, `salud`, `tesoreria`,
`reportes`, `asientos`.
**Móvil 390 (8):** los mismos 7 + `menu-abierto`.
**Informe imprimible (6):** `informe-impreso-parte-1..6.png`.

Todas fueron revisadas una por una en esta pasada; el informe máquina
(`informe-f3.json`) conserva las métricas objetivas de cada una.

---

## 10. Archivos modificados por F3

| Archivo | Cambio |
|---|---|
| `frontend/sistema/app.js` | Marca por tema (`logoMarcaHTML`), `aria-current` del ítem activo |
| `frontend/sistema/sistema.css` | Variantes de logo, `.rep-desc` envolvente, `.rut`/`.fecha` nowrap, dock oculto con menú móvil |
| `frontend/sistema/views-fiscal.js` | Descripciones de reportes, chip de Integraciones condicionado a la clave |
| `frontend/sistema/views-conta.js` | Tarjetas «Próximamente» sin `.chip` |
| `frontend/sistema/views-teso.js` | Tesorería por período del header |
| `frontend/sistema/views-activos.js` | Placeholder de cuenta (sin preseleccionar Caja) |
| `frontend/sistema/views-centro.js` | `title`/`aria-label` del badge de área restringida |
| `frontend/sistema/views-salud.js`, `views-portal.js` | Ajustes de presentación detectados en las capturas |
| `backend/core/tesoreria.js`, `backend/routes/tesoreria.js` | Resumen por período + validación |
| `backend/core/salud-tributaria.js` | Nota de alerta según la clasificación real |
| `backend/core/informe-salud-html.js`, `backend/core/centro-apps.js` | Coherencia de textos/datos del informe y del Centro |
| `frontend/sistema/index.html` | Solo `?v=` (anti-caché por contenido) |
| `scripts/validacion-pre-produccion/capturas-f3.js`, `entorno-demo.js` | Herramienta de capturas y sembrado ficticio (nuevos) |
| `test/ux-f3-validacion.test.js` | 10 regresiones (nuevo) |
| `docs/handoff-integral/capturas-f3/**` | 68 capturas + `informe-f3.json` |

Sin commits ni despliegues.
