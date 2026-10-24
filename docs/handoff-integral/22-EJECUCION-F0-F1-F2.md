# 22 · Ejecución F0 · F1 · F2 — cambios, evidencia y límites

> Ejecutado el **2026-10-23** sobre `master` @ `85f93e9`. Este documento
> registra lo que se **implementó y verificó** (no lo que se propuso). El
> handoff (docs 00–21) sigue siendo el diagnóstico; donde el sistema cambió, la
> fuente vigente es este archivo + el código + los tests.

---

## F0 · Contratos y línea base

| Entregable | Archivo | Estado |
|---|---|---|
| Línea base (suite 634/634, commit, BD `integrity_check ok`) | `21-F0-LINEA-BASE-Y-CONTINUIDAD.md` | Verificado |
| Golden de navegación de los 49 anchors | `test/fixtures/navegacion-anchors.json` | Creado |
| Contratos de navegación + RK-21 | `test/navegacion-contratos.test.js` (6 casos) | Verde |
| Taxonomía de 9 estados (una sola fuente) | `frontend/shared/estados-salud.js` | Creado |
| Fixtures deterministas + contratos del motor | `test/fixtures/salud-estados.js`, `test/salud-estados.test.js` (6 casos) | Verde |
| Respaldo recuperable e integridad | doc `21` §4 | Documentado |

**Defecto corregido (RK-21):** las 6 vistas de reportes sin entrada de menú se
renderizaban con la identidad de Inicio y sin gate de permisos en la UI. Ahora
`RUTAS_FUERA_DE_MENU` declara etiqueta, sección y capacidad real (`reportes:ver`,
la misma del endpoint). El backend nunca dejó de autorizar: lo que cambió es que
la pantalla ya no miente.

---

## F1 · Salud Tributaria e informe imprimible

### Vista (`frontend/sistema/views-salud.js`)

| Defecto | Corrección |
|---|---|
| Bloque de índice duplicado en la portada | Uno solo; la bienvenida ocupa la segunda columna |
| Plan de acción impreso dos veces + cita fija atribuida a «opinión profesional» | Una sola tabla (con evidencia, responsable y plazo) |
| «Opinión Tributaria Profesional» repetida dentro del resumen | Eliminada: la conclusión ya encabeza el panel |
| `${kpiContextoSII(t.k,'',t.v,t.s)}` dejaba texto suelto por tarjeta | Helper y llamada eliminados |
| Animación infinita `kpiPulse` + badges «Módulo 0…7» | Eliminados (marcado, CSS y vista) |
| «Última actualización SII» construida con `new Date()` | Eliminada (afirmaba una actualización que el sistema no conoce) |
| Exposición `$0` y créditos `$0` mostrados como «No evaluable» | `valorDeclarado()`: `$0` confirmado si la fuente se consultó; «Sin consultar» si no |
| «Cumplimiento oportuno» (12 meses) vs dimensión «Cumplimiento» (hasta 5 años) | Renombrado a «Cumplimiento en la ventana (12 meses)», con el alcance explicado en el tooltip |
| Error de carga con cartel genérico | Taxonomía: fuente no disponible / error técnico, qué sigue disponible y «Reintentar» |

### Informe (`backend/core/informe-salud-html.js`)

| Defecto | Corrección |
|---|---|
| `var(--rojo)`, `var(--space-4)`, `var(--fs-sm)` inexistentes en el documento | Reemplazados por la paleta `MARCA` y medidas en pt/px del propio informe (0 `var(--)` en el archivo) |
| `hechos`/`riesgos` (arrays) interpolados con `esc()` → texto con comas | `listaBloque()`: cada elemento es un `<li>` |
| Typo «reflecten» | «reflejan» |
| Tabla «Detalle por período» impresa en capítulos 03 y 05 | Solo en 03; el 05 remite a él |
| Lenguaje de emisión profesional que insinuaba certificación | Nuevo párrafo de alcance: «No es un certificado oficial del SII ni una certificación tributaria» |
| Opinión duplicada en el cierre | Una sola, con hechos y riesgos como listas |

Sin cambios en el motor: índice, dimensiones, matriz de riesgos, exposición y
snapshots quedan intactos (`test/salud-tributaria.test.js` y
`test/salud-informe.test.js` siguen en verde: 14 + 14 casos).

---

## F2 · Navegación de dos niveles

**Antes:** 10 secciones / 43 ítems simultáneos, con «Lote del despacho» (4
herramientas) y «Gestión comercial» (CRM + cuentas corrientes) como áreas.

**Ahora:** 6 áreas de trabajo + 2 destinos secundarios, con **los 43 anchors
intactos**:

| Área | Ítems | Pregunta que responde |
|---|---|---|
| **Inicio** | Hoy · Alertas · Todos los módulos | ¿Qué requiere mi atención? |
| **Documentos** | Bandeja · Libros · Onboarding · Emitir DTE · DTEs emitidos · Config. emisor | ¿Qué entró y qué emití? |
| **Contabilidad** | Contabilización · Propuestas · Asientos · Memoria · Activos · Cierre | ¿Cómo está registrado? |
| **Impuestos y Salud** | Salud Tributaria · Dashboard IVA · Calculadora IVA · Proceso masivo (F29) | ¿Cómo está mi situación tributaria? |
| **Tesorería** | Bancos y conciliación · Cobranza · Cartola externa | ¿Qué dinero entró y salió? |
| **Informes** | Centro de Reportes · Cta. cte. clientes · Cta. cte. proveedores · Informe por rango · Reporte masivo | ¿Qué reporte entrego? |
| **Administración** (secundaria) | Admin · Auditoría · Integraciones · Suscripción · CRM · Portafolio | ¿Cómo está configurado? |
| **Portal de cliente** (secundaria) | 10 vistas read-only | ¿Cómo va mi negocio? |

Cambios asociados:
- **Acordeón**: abrir un área cierra las demás. El estado se sigue guardando por
  usuario; al recargar queda una sola área abierta.
- `#centro` pasa a llamarse **«Todos los módulos»** y conserva su anchor; sigue
  siendo el catálogo completo (el lateral ya no lo es).
- `backend/core/centro-apps.js`: los grupos del catálogo se alinean con las
  áreas nuevas (test de coherencia en verde).
- **Catálogo de reportes**: F29 y «antigüedad de saldos» salen de
  «Próximamente» y apuntan a donde están implementados (`#salud`, `#cobranza`);
  PPM y centros de costo quedan declarados con lo que sí existe y lo que falta.
- `#externos` (cartola Geo Daniela) se movió de Contabilidad a Tesorería; el
  anchor no cambió.

**Compatibilidad:** los 49 anchors siguen resolviendo (T1/T2 del golden),
el breadcrumb muestra el área nueva y el gate de UI se mantiene atado al RBAC
(T3: 5 roles × 49 rutas).

---

## Pruebas

| Comando | Resultado |
|---|---|
| `npm test` (70 archivos) | **652 tests · 652 pasan · 0 fallan · 109 s** (línea base: 634/634, 107 s) |
| `node --test test/navegacion-contratos.test.js` | 6/6 |
| `node --test test/salud-estados.test.js` | 6/6 |
| `node --test test/salud-presentacion.regression.test.js` | 6/6 |
| `node --test test/salud-informe.test.js` | 14/14 |
| `node --test test/salud-tributaria.test.js` | 14/14 |
| `node --test test/centro-apps.test.js` | 10/10 |
| `node --test test/ux-unificacion.test.js` | 14/14 |

**Evidencia de detección (no solo de paso):** al retirar el fallback
`RUTAS_FUERA_DE_MENU[key]` del router, `test/navegacion-contratos.test.js` falla
en T2, T3 y RK-21. Restaurado el código, pasa.

**Dos tests existentes se actualizaron por cambio deliberado de contrato** (no
para "hacerlos pasar"):

- `ux-unificacion` T10: el clic del menú ya no solo alterna el pliegue, también
  lo abre en acordeón. Se agregó esa aserción; la de alternancia sigue igual.
- `legado-retirado` R4 y `ux-tesoreria` T4: fijaban «Informes y control» con
  `reportes + cierre` y las 6 tarjetas de «Próximamente». F2 movió el cierre a
  Contabilidad y sacó F29 y antigüedad de saldos de lo no implementado. Los
  tests ahora exigen la nueva estructura **y siguen prohibiendo** lo que
  protegían: un solo catálogo de reportes, sin repetir las vistas que tienen
  tarjeta, y lo ausente aislado en su bloque.

**Ajuste de infraestructura:** el presupuesto de espera del job de antecedentes
en `salud-informe.test.js` pasó de 8 s a 20 s. Con la suite completa (archivos
en paralelo) la reunión de seis pasos medía 8,0 s y fallaba por contención de
CPU; en solitario tarda 5,8 s. El test sigue fallando si el job no termina.

**Conservación:** no se tocaron reglas contables, tributarias, permisos,
autenticación, esquemas ni endpoints. Los cambios de F1 son de presentación y de
texto; los de F2 son de agrupación y navegación.

---

## Riesgos residuales

| Riesgo | Detalle |
|---|---|
| Cambio de estructura del menú en clientes con estado guardado | `jmv.nav.cerradas.<usuario>` guarda nombres de sección antiguos: en el primer render las áreas nuevas arrancan plegadas y la activa se abre sola. No requiere migración, pero el usuario verá el menú «cerrado» una vez |
| Portada por área | No se creó una portada dedicada por área: la portada es el primer ítem de cada una y `#centro` sigue siendo el catálogo. Crear 6 portadas nuevas es trabajo de F3 |
| Estilos inline del informe | Se reemplazaron solo los tokens inexistentes; el informe mantiene estilos inline (ver doc 17 para la migración a hoja propia) |
| Verificación visual | Sin navegador: los cambios se validaron por DOM/sandbox y por la suite, no con capturas |

---

## Siguiente paso recomendado

F3 (`19-PLAN-IMPLEMENTACION.md`): plantillas de portada por área y migración de
los `style=` de Salud y del informe a clases del sistema de diseño, con el
golden de F0 como red de seguridad.
