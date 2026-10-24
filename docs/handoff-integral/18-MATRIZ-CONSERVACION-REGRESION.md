# 18 · Matriz de conservación y regresión

> Principio: el rediseño **no es exitoso porque se vea mejor**. Debe conservar procesos, integridad, permisos, resultados contables y conexiones.
> Los resultados «antes» son los del repositorio actual (suite 634/634 en verde, 2026-10-23). «Después» se completa al implementar.

---

## 1. Matriz de conservación

| ID | Capacidad | Estado actual | Comportamiento esperado | Integraciones | Prueba de referencia | Antes | Después | Aceptación | Evidencia | Riesgo residual |
|---|---|---|---|---|---|---|---|---|---|---|
| CAP-01 | Login y sesión | Operativo | Usuario/clave → cookie sid → `/me` | — | `password`, `hardening`, `login-casesensitive` | Verde | — | Login y logout funcionan; clave incorrecta no crea sesión | Tests | Bajo |
| CAP-02 | Cambio de clave forzado | Operativo | Usuario nuevo debe cambiar antes de operar | — | `admin-usuarios-accesos` | Verde | — | No se puede saltar por URL | Tests | Bajo |
| CAP-03 | RBAC por capacidad | Operativo | 41 capacidades, 5 roles, gate de licencia | Licencia | `fase6`, `crm-tenant`, `perfil-admin` | Verde | — | Un rol sin capacidad recibe 403; escritura sin licencia 402 | Tests | Medio |
| CAP-04 | Aislamiento por empresa | Operativo | Ninguna consulta cruza `empresa_id` | — | `fase*`, `crm-tenant` | Verde | — | Un usuario no ve datos de otra empresa ni por URL | Tests | Medio |
| CAP-05 | Partida doble | Operativo | ≥2 líneas, ΣD=ΣC, entero | — | `fase2` | Verde | — | Asiento descuadrado rechazado | Tests | Bajo |
| CAP-06 | Reversión de asiento | Operativo | Asiento inverso, una sola vez | — | `fase2`, UX F2 | Verde | — | Revertir dos veces falla con mensaje | Tests | Bajo |
| CAP-07 | Cierre de período | Operativo | Bloquea mutaciones, snapshot | — | `fase5` | Verde | — | No se puede contabilizar en período cerrado | Tests | Medio |
| CAP-08 | Bandeja y dedupe | Operativo | RCV y DTE una sola representación | SII | `fase3`, `dte-contable` | Verde | — | Reingestar no duplica | Tests | Medio |
| CAP-09 | Clasificación y reglas | Operativo | Regla → memoria → alias | — | `memoria-reportes` | Verde | — | Propuesta usa la precedencia correcta | Tests | Medio |
| CAP-10 | Propuestas con confirmación | Operativo | Nunca contabiliza sin confirmar | — | `fase4`, `automatizacion` | Verde | — | Automatización deja propuestas, no asientos | Tests | Bajo |
| CAP-11 | Conciliación SII↔contable | Operativo | Report-only, diferencias tipificadas | SII | `fase4` | Verde | — | No corrige ni borra nada | Tests | Medio |
| CAP-12 | Reportes financieros | Operativo | ΣD=ΣC, A=P+PN, NIIF | — | `fase5`, `fase8` | Verde | — | Ecuaciones cuadran | Tests | Medio |
| CAP-13 | Tesorería y cartola | Operativo | Movimiento con asiento, import idempotente | Banco (archivo) | `fase6`, `cartola-formatos` | Verde | — | Reimportar no duplica; saldo corrido correcto | Tests | Medio |
| CAP-14 | Activos y depreciación | Operativo | Línea recta, venta/baja | — | `fase7` | Verde | — | UNIQUE activo+período; cuota final exacta | Tests | Bajo |
| CAP-15 | DTE emisión | Implementado; sin credenciales | 33/34/56/61, estado SII verbatim | SII | `dte-emision` | Verde | — | XML válido offline; folio correlativo | Tests | **Alto** (producción) |
| CAP-16 | DTE → contabilidad | Operativo | Aceptado → documento → propuesta | SII | `dte-contable` | Verde | — | Idempotente y con vínculo bidireccional | Tests | Medio |
| CAP-17 | Salud Tributaria: contrato | Operativo | `construirInforme` devuelve el mismo objeto | SII/TGR | `salud-tributaria`, `salud-informe` | Verde | — | Campos y fórmulas intactos; UI nueva consume el mismo contrato | Tests | **Alto** |
| CAP-18 | Salud: índice y dimensiones | Operativo | Pesos y reglas de no evaluable | — | T1–T12 | Verde | — | Mismo score con los mismos datos | Tests + golden file | Alto |
| CAP-19 | Salud: snapshots | Operativo | JSON inmutable por período | — | T7 | Verde | — | Snapshot recuperable y comparable | Tests | Medio |
| CAP-20 | Salud: informe imprimible | Operativo | 8 capítulos, A4, sin `[object Object]` | — | S5, S8–S11 | Verde | — | Capítulos, marca, tablas que caben | Tests | Medio |
| CAP-21 | Deuda TGR | Implementado | PDF oficial + total rotulado | TGR | D1–D6 | Verde | — | Sin total legible ⇒ null, no suma | Tests | Alto (sin credenciales) |
| CAP-22 | Navegación y anchors | Operativo | 43 anchors + 6 de reportes resuelven | — | `ux-unificacion`, `legado-retirado` | Verde | — | Todos los anchors abren una vista válida | Nuevo test de anchors | **Alto** |
| CAP-23 | Contexto en URL | Operativo | empresa/período compartibles | — | T11 | Verde | — | Copiar URL reproduce la vista | Tests | Medio |
| CAP-24 | Búsqueda global | Operativo | ≥2 caracteres, RBAC | — | `buscador` | Verde | — | No filtra datos sin permiso | Tests | Bajo |
| CAP-25 | Exportaciones | Operativo | CSV/XLS/ZIP con datos filtrados | — | `export-fecha`, `memoria-reportes` | Verde | — | Totales y columnas correctas | Tests | Bajo |
| CAP-26 | Notificaciones y campana | Operativo | 3 canales reales | — | `dashboard` | Verde | — | Sin permiso no hay canal | Tests | Bajo |
| CAP-27 | Suscripción y pagos | Implementado | Checkout, webhook idempotente | MercadoPago | `saas3` | Verde | — | Reenvío no duplica licencia | Tests | Medio |
| CAP-28 | CRM del despacho | Operativo | Solo contador/super_admin | — | `crm*` | Verde | — | Cliente no accede ni por URL | Tests | Bajo |
| CAP-29 | Portal read-only | Operativo | 10 vistas por empresa | — | `portal*` | Verde | — | No escribe contabilidad | Tests | Bajo |
| CAP-30 | Móvil sin scroll horizontal | Verificado en su momento | 320/390/768 px | — | T10, UX | Verde | — | Sin desborde ni texto < 12 px | Medición en navegador | Medio |
| CAP-31 | Migraciones idempotentes | Operativo | Reaplicar no rompe | — | `db-schema` | Verde | — | Base nueva y existente convergen | Tests | Medio |
| CAP-32 | Backups | Operativo | Cifrado y restore | FS | `backup-seguro` | Verde | — | Restaurar produce BD usable | Tests | Alto (clave) |
| CAP-33 | Salud: precisión de fuentes | Operativo | Fecha y condición por fuente | SII/TGR | S12–S14, D3–D5 | Verde | — | Cada fuente muestra su fecha | **Nuevo** | Alto |
| CAP-34 | Mensajes honestos | Parcial | Sin dato ≠ incumplimiento | — | S7 | Verde | — | 9 estados implementados | **Nuevo** | Medio |

---

## 2. Pruebas de regresión por fase

### Fase 0 — Línea base (sin cambios)
1. `npm test` completo (634).
2. Snapshot de anchors: recorrer los 49 `VIEWS` y los 43 ítems; cada uno debe renderizar sin excepción (test de humo con DOM simulado o navegador).
3. Golden files de Salud: 3 empresas sintéticas (sin datos, con RCV sin declaraciones, con todo) → JSON de `construirInforme` congelado (comparación estructural, no de fechas).
4. Golden files de reportes: comprobación, situación, resultados con datos sintéticos.

### Fase 1 — Defectos de Salud/informe
- Tests de contrato HTML: sin `var(--` indefinidas, sin `[object Object]`, sin «reflecten», una sola tabla mensual.
- Test de duplicación: el DOM de la vista contiene un solo `.sl-indice` y una sola tabla de plan.
- Test de KPI: no hay nodos con texto `": "`.

### Fase 2 — Navegación
- **Test de anchors**: los 43 + 6 deben resolver a una vista con `titulo` no vacío.
- **Test de permisos de ruta**: toda vista tiene un ítem con permiso; ninguna cae en `inicio` por defecto.
- **Test de URL**: empresa/período se conservan al cambiar de área; empresa ajena se ignora.
- **Test de teclado**: menú, tabs, modales y menú contextual operables sin ratón.

### Fase 3 — Catálogo de reportes
- Todo ítem del catálogo tiene endpoint y vista existentes.
- Ningún ítem dice «no disponible» si su función existe.
- F29/PPM/centros de costo enlazan a su función real.

### Fase 4 — Salud como centro
Casos obligatorios (sintéticos, sin SII real):

| Caso | Entrada | Salida esperada |
|---|---|---|
| Información válida | RCV + F29 declarado + ficha | Índice evaluable; sin hallazgos altos |
| Información incompleta | RCV parcial | Dimensión de calidad baja; hallazgo de cobertura |
| Fuente no disponible | Error simulado del SII | `FUENTE_NO_DISPONIBLE`; resto del informe intacto |
| Datos antiguos | `consultado_en` hace 90 días | Sello «datos al …» y vigencia vencida |
| Diferencias | F29 ≠ RCV | Hallazgo medio/alto con evidencia |
| Período sin información | Sin RCV ni ficha | `SIN_INFORMACION`, índice no evaluable |
| Requiere revisión | F29 pendiente | Nivel `REQUIERE_REVISION` |
| Fuente no habilitada | TGR sin configurar | `NO_HABILITADA`, sin resta de puntos |

### Fase 5 — Certificado
- Folio único y reproducible; hash estable para el mismo contenido.
- Verificación (si se implementa) devuelve el estado del documento.
- El PDF no contiene lenguaje de certificación oficial.

---

## 3. Pruebas SII sin efectos tributarios

| Prueba | Método | Nunca |
|---|---|---|
| Login correcto/incorrecto | Servidor simulado (`sii-sesion.test.js`) | Credenciales reales |
| 401 y reintento | Doble que responde 401 una vez | Reintentos masivos |
| Timeout | Fetch que nunca resuelve | Dejar jobs colgados |
| Tope de sesiones | Error `SII_TOPE_SESIONES` | Reintentar automáticamente |
| Sin navegador | `navegadorDisponible` sin ruta | Autenticar antes de comprobar |
| CSV con encabezados cambiados | Fixture alterado | Aceptar en silencio |
| PDF F29 ilegible | Fixture sin texto | Inventar montos |
| Certificado TGR «NO REGISTRA DEUDA» | Fixture real anonimizado | Sumar montos sueltos |
| Certificado TGR con deuda | Fixture real anonimizado | Recalcular intereses |

---

## 4. Criterios de aceptación globales

1. `npm test` ≥ 634 y 0 fallos.
2. Nuevos tests de humo de navegación y de contrato del informe en verde.
3. Los 49 anchors resuelven; ninguno cae en `inicio`.
4. Cero regresiones en las ecuaciones contables (ΣD=ΣC, A=P+PN).
5. Cero cambios en los montos de los golden files sin justificación documentada.
6. Cero errores de consola en las 10 pantallas principales (verificación en navegador).
7. Sin scroll horizontal a 320 px.
8. Contraste y foco conformes en las pantallas principales.
9. El informe no contiene lenguaje de certificación oficial.
10. Toda fuente muestra fecha y condición.

---

## 5. Estrategia de reversión

| Cambio | Reversión |
|---|---|
| Navegación | Bandera `?nav=legacy` o rama con el `MENU` anterior; los anchors se conservan |
| Vistas | Mantener las vistas actuales hasta que la nueva pase los golden files |
| Informe | Generador anterior accesible por `?formato=legacy` durante una versión |
| Datos | Ninguna migración destructiva en F1–F3; backups previos a cualquier migración |
| Configuración | Cambios por variable de entorno, no por edición manual en producción |

---

## 6. Riesgos residuales aceptados (por ahora)

| Riesgo | Motivo | Vigilancia |
|---|---|---|
| DTE sin verificación en producción | Faltan CAF/certificado | Checklist antes de emitir |
| TGR/SII dependen de portales no oficiales | No hay API oficial equivalente | Monitoreo sintético |
| Modelo dual `clientes`/`empresas` | Migración costosa | No introducir nuevas dependencias de `clientes` |
| Frontend sin pruebas de DOM | Deuda previa | Introducir humo de navegación en Fase 0 |
| Índice de salud con pesos de producto | Decisión de negocio | Versionar reglas y documentar |
