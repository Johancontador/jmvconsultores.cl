# 01 · Resumen ejecutivo

> Sistema inspeccionado: **Sistema Contable JMV** (`iva-mensual`), monolito Node 24 + Express 4 + SQLite (WAL) con SPA vanilla JS.
> Inspección de solo lectura sobre `master` @ `85f93e9` (2026-10-23). Suite completa: **634 tests, 0 fallos** (121 s).

---

## 1. Conclusión principal

El sistema **no es un prototipo**: tiene un núcleo contable real (partida doble, cierres, reversiones, conciliación, tesorería, activos, NIIF), una integración SII profunda (RCV, ficha del contribuyente, F29, F22, declaraciones juradas, boletas de honorarios) y una conexión TGR para deuda fiscal. La suite de 634 pruebas cubre la lógica de negocio del backend con seriedad inusual para un proyecto de este tamaño.

El problema **no es la falta de funcionalidades**: es la **ausencia de una arquitectura de información** que las haga descubribles y coherentes. Hoy conviven cuatro modelos de navegación (Centro de Aplicaciones, dock estilo iOS, menú lateral de 10 secciones con 43 ítems, buscador global + breadcrumb), los catálogos se contradicen entre sí (el Centro de Reportes declara «F29 — No disponible todavía» cuando el F29 se calcula en tres módulos), y el módulo prioritario —Salud Tributaria— arrastra defectos de presentación que transmiten una calidad menor que la de sus datos.

**El rediseño debe ser de arquitectura funcional y de componentes, no de CSS.** La base técnica permite hacerlo por etapas sin tocar el núcleo contable ni el SII.

---

## 2. Lo que está sólido y debe conservarse (evidencia)

| Capacidad | Evidencia |
|---|---|
| Partida doble con validaciones duras (≥2 líneas, ΣD=ΣC, monto entero en pesos, cuenta activa/imputable, centro de costo válido, período cerrado rechazado) | `backend/core/asientos.js` |
| Reversión de asientos (nunca edición/borrado) con detección de doble reversión | `asientos.revertir`, tests `fase2` |
| Propuestas con confirmación humana; precedencia regla → memoria RUT → cuenta regular → alias | `core/propuestas.js`, `memoria-reportes.test.js` |
| Conciliación SII↔contable report-only, con diferencias tipificadas | `core/conciliacion.js`, `fase4` |
| Tesorería con asiento por movimiento, cartola idempotente y conciliación 1↔1 | `core/tesoreria.js`, `fase6`, `cartola-formatos` |
| Activos fijos con depreciación mensual y venta/baja contabilizadas | `core/activos.js`, `fase7` |
| NIIF por rubros con `SIN_CLASIFICAR` visible y ecuación A = P + PN verificada | `core/niif.js`, `fase8` |
| Auth propia scrypt, sesiones revocables, RBAC de 5 roles y 41 capacidades | `core/permisos.js`, `middleware/requirePermiso.js` |
| Infraestructura de tests (68 archivos, 634 casos) y CI | `package.json`, `.github/workflows` |
| Mensajes de «no dato» honestos en el backend de Salud Tributaria (`no_consultado`, `no_evaluable`, `sin_informacion`) | `core/salud-tributaria.js` |

---

## 3. Hallazgos principales

### H-01 · Salud Tributaria: backend maduro, presentación con defectos concretos (crítico)
El backend es un motor de 1.820 líneas con índice ponderado por 5 dimensiones, matriz de riesgos, exposición sin doble conteo, plan de acción, comparación con el informe anterior y snapshot inmutable. La vista, en cambio, contiene:
- **el bloque de índice y el bloque «Plan de acción» renderizados dos veces** (`views-salud.js`, portada y `panelPlan`);
- **texto residual en cada KPI** por una llamada mal formada a `kpiContextoSII(t.k, '', t.v, t.s)` que concatena `": valor"` sin etiqueta;
- **animación infinita decorativa** (`kpiPulse`) y badges numéricos «Módulo 0…7» sin significado;
- **«Última actualización SII»** construida con `new Date()` en una función que hoy no se usa: si se usara, afirmaría una actualización que el sistema no conoce;
- **dos tablas de plan de acción idénticas** y una «Opinión Tributaria Profesional» duplicada;
- ausencia de un estado de error distinguible entre «fuente no disponible» y «error técnico» (un solo cartel con `err.message`).

### H-02 · Informe imprimible: variables CSS inexistentes y contenido mal escapado (alto)
`core/informe-salud-html.js` usa `var(--rojo)`, `var(--space-4)` y `var(--fs-sm)` en estilos inline, pero su CSS **no define esos tokens**: el navegador descarta la declaración. Consecuencia: el aviso de alerta crítica pierde color y borde, y la marca pierde margen. Además:
- `hechos` y `riesgos` son **arrays** y se interpolan con `esc()` directo en la sección final → salen concatenados por comas, no como lista;
- error tipográfico visible: «reflecten»;
- la tabla «Detalle por período» se imprime **dos veces** (capítulos 3 y 5);
- el texto de cierre afirma «Emisión profesional… se emite con la opinión profesional», en tensión con las propias limitaciones («no es una certificación tributaria»).

### H-03 · Catálogos que se contradicen (alto, descubrimiento)
El Centro de Reportes marca como «No disponible todavía» a **F29**, **PPM**, **centros de costo** y **antigüedad de saldos**, aunque F29/PPM se calculan en Calculadora, Proceso masivo y Salud Tributaria, y los centros de costo existen en el plan y en Administración. El usuario que busca F29 en Reportes concluye que no existe.

### H-04 · Cuatro modelos de navegación simultáneos (alto)
Coexisten el Centro de Aplicaciones (home de íconos), el dock (5 apps + Menú), el menú lateral (10 secciones, 43 ítems, plegables) y el buscador global/breadcrumb. «Inicio» y «Centro» compiten como home; el dueño de empresa ve Portal primero; el menú conserva ítems heredados (`informe-rango`, `proceso-masivo`, `exportacion-masiva`, `portafolio`) que son herramientas del despacho dentro de una sección llamada «Lote del despacho». La duplicación de superficies no aporta orientación: aporta cuatro lugares donde buscar.

### H-05 · El «certificado» no es un certificado (alto, confianza)
El entregable se rotula «Informe Ejecutivo de Salud Tributaria» y declara limitaciones correctamente en el cuerpo, pero la sección final usa lenguaje de emisión profesional y el botón dice «Emitir informe (PDF)» cuando en realidad abre HTML para imprimir. No existe folio verificable, hash ni mecanismo de verificación pública. **No debe presentarse como certificación oficial del SII** (el sistema no lo hace explícitamente, pero el diseño lo insinúa).

### H-06 · Deriva documental (medio)
Comentarios de cabecera afirman cosas que el código ya no cumple: `declaraciones-sii.js` dice que F22 y declaraciones juradas «NO se consultan», pero importa y ejecuta `rentaSii` y `djSii`. `CURRENT_STATE.md` describe un menú superior horizontal que ya no existe (hoy es lateral). La documentación es buena, pero no es confiable como fuente única.

### H-07 · Acciones destructivas y permisos: correctos en backend, desparejos en UI (medio)
El backend exige capacidades en cada ruta (230 handlers, casi todos con `requirePermiso`). La UI oculta acciones por capacidad, pero hay excepciones: la vista de Salud Tributaria usa `tesoreria:operar` para habilitar «Consultar deuda fiscal» (capacidad de otro módulo), y el botón «Emitir informe» no distingue si el usuario puede o no sostener el documento. La revocación de sesiones al cambiar clave está bien resuelta.

### H-08 · Seguridad: deuda conocida y acotada (medio)
- `clientes.clave_sii` (capa legacy) sigue en texto plano; las empresas del sistema contable usan bóveda AES-256-GCM. Está documentado, no resuelto.
- Rate-limit de login pasó a BD (`rate_limit`), lo que resuelve el problema multi-proceso.
- El `console.error` de excepciones no capturadas no tumba el proceso (decisión deliberada), pero puede enmascarar fallos sistémicos.
- `.env` está en `.gitignore` y no se versiona; el handoff no leyó su contenido.

### H-09 · Frontend sin pruebas de comportamiento (medio)
Las pruebas `ux-*.test.js` verifican cadenas del código fuente (que exista un `id`, que un texto aparezca), no el DOM ni el flujo. No hay build ni tipado. El rediseño de navegación necesitará pruebas de humo reales (Playwright o similar) para no repetir regresiones silenciosas.

---

## 4. Riesgos para la continuidad

| Riesgo | Impacto | Mitigación propuesta |
|---|---|---|
| Tocar la navegación y romper anchors históricos (`#documentos`, `#asientos`, `#tesoreria`) | Enlaces guardados, favoritos y flujos internos dejan de funcionar | Tabla de alias + pruebas de todos los anchors; el repo ya usa `REDIRECCIONES_ANCHOR` |
| Rediseñar Salud Tributaria sin congelar su contrato de datos | Se pierde la trazabilidad de indicadores y snapshots | Congelar `construirInforme` como contrato; rediseñar solo capa de presentación |
| Automatizar más consultas SII sin control de sesiones | Bloqueo del contribuyente por tope de sesiones simultáneas | Mantener cierre de sesión en `finally`, una sesión por corrida, y el límite documentado |
| Presentar el informe como certificación | Exposición legal y reputacional | Rotular «Informe técnico de JMV», no «certificado»; agregar folio/hash y alcance explícito |
| Cambios de esquema durante el rediseño | Pérdida de integridad contable | Cero migraciones en F1–F3; las necesarias, idempotentes y con respaldo |

---

## 5. Recomendación

1. **Fase 0 (sin código):** congelar contratos (endpoints, `construirInforme`, anchors) y agregar pruebas de humo de navegación.
2. **Fase 1 (UI, bajo riesgo):** corregir los defectos de Salud Tributaria y del informe (H-01, H-02) sin cambiar el backend.
3. **Fase 2 (arquitectura de información):** navegación de dos niveles (5–6 áreas + espacio de trabajo por módulo), retirando duplicaciones de superficie, con alias de anchors.
4. **Fase 3 (coherencia de catálogos):** un solo catálogo de reportes y funciones reales; eliminar «No disponible» falso.
5. **Fase 4 (Salud Tributaria como centro):** estado unificado, evidencia por indicador, certificado con folio y verificación.

**No se debe comenzar por el rediseño visual.** El orden correcto es contratos → defectos → información → componentes → estética.

---

## 6. Qué NO se pudo verificar

- Ninguna llamada real al SII, TGR, MercadoPago ni emisión de DTE.
- Ningún render en navegador ni medición visual (los hallazgos visuales son de código).
- Ningún dato productivo (no se leyó la BD de `data/`).
- Jobs largos (reunión de antecedentes, ingesta histórica) no ejecutados.

Ver limitaciones completas en `00-INDICE-GENERAL.md` §5.
