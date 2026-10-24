# 20 · Riesgos, pendientes y decisiones

> Los riesgos están ordenados por impacto operativo. Las decisiones se presentan con recomendación, ventajas, riesgos y consecuencia de no decidir.

---

## 1. Registro de riesgos

| ID | Riesgo | Prob. | Impacto | Evidencia | Mitigación actual | Mitigación propuesta |
|---|---|---|---|---|---|---|
| RK-01 | Rediseño de navegación rompe enlaces guardados | Alta | Alto | 43 anchors + URLs compartidas | `REDIRECCIONES_ANCHOR` (vacío), contexto URL | Alias + test de anchors + bandera legacy |
| RK-02 | Cambio en Salud altera cifras que el cliente ya vio | Media | Alto | Score depende de pesos/umbrales | Snapshots y tests | Congelar fórmulas en F1; golden files; aprobación del contador |
| RK-03 | Automatización SII se rompe por cambio de portal | Media | Alto | Parseo HTML/PDF y navegador headless | Errores explícitos, jobs por paso | Monitoreo sintético + alerta + fixtures |
| RK-04 | Tope de sesiones SII bloquea al cliente | Media | Alto | Cierre en `finally`, una sesión por corrida | Igual | Panel de sesiones y cierre manual |
| RK-05 | Migración `clientes`→`empresas` pierde datos | Baja | Crítico | Modelo dual | Sin migración | Backup verificado + doble lectura + rollback |
| RK-06 | DTE emitido con configuración errónea | Baja | Crítico | Certificado/CAF cifrados | Validación al cargar, confirmación por RUT | Checklist de emisión + prueba en certificación |
| RK-07 | Pérdida de `BACKUP_ENCRYPTION_KEY` | Baja | Crítico | Backups cifrados | Variable separada | Custodia documentada + prueba de restore |
| RK-08 | Backups fallan en silencio | Media | Alto | Incidente de 7 noches documentado | Verificación en deploy | Alerta si el backup no se completa |
| RK-09 | Datos fuera de la BD no se respaldan | Media | Alto | `data/sii-fichas`, `data/certificados-tgr` | No documentado | Incluir en backup y restore |
| RK-10 | Zona horaria del servidor cambia el período | Media | Medio | `new Date()` en backend/frontend | — | `TZ=America/Santiago` + prueba |
| RK-11 | Frontend sin pruebas de comportamiento | Alta | Medio | `ux-*` inspeccionan strings | — | Humo de navegación (Playwright o similar) |
| RK-12 | Índice de salud se interpreta como dictamen | Media | Alto | Lenguaje «Al día», «certificado» | Limitaciones en el texto | Estados + lenguaje + folio no oficial |
| RK-13 | Reportes muestran «no disponible» funciones existentes | Alta | Medio | Centro de Reportes | — | Catálogo desde capacidades reales |
| RK-14 | Deriva documental induce a error a futuros agentes | Alta | Medio | Comentario F22/DJ, `CURRENT_STATE` | — | Revisión documental en F0/F5 |
| RK-15 | Estilos inline y duplicados degradan la UI | Alta | Medio | 528 `style=`; duplicados en Salud | — | F3 componentes |
| RK-16 | Auditoría sin filtros de servidor | Media | Medio | `routes/contable.js` solo limit/offset | Búsqueda local | Filtros y export |
| RK-17 | Estados financieros sin exportación | Alta | Medio | Vistas sin UITabla | — | Export PDF/Excel |
| RK-18 | Portal/CRM confunden alcance (cliente vs despacho) | Media | Bajo | Ítems con `permiso:null`, sección «Lote» | RBAC | Reubicar en F2 |
| RK-19 | `clientes.clave_sii` en texto plano | Media | Alto | Tabla legacy | Bóveda solo en `empresas` | Migrar y cifrar; no crear nuevas dependencias |
| RK-20 | Jobs en memoria se pierden al reiniciar | Media | Medio | `Map` en Salud/informes legacy | Reanudación solo históricos/sync | Persistir jobs críticos |
| RK-21 | Vistas sin ítem de menú eluden el guard de permisos de la UI | Baja | Bajo | `app.js:1281` — `route = TODOS_LOS_ITEMS.find(...) || TODOS_LOS_ITEMS[0]`; 6 vistas (`balance8`, `clasificado`, `comprobacion`, `niif`, `resultados`, `situacion`) no están en `MENU`, así que `route.permiso` es `null` (el de `inicio`). El backend sigue devolviendo 401/403 en cada fetch, por lo que no hay fuga de datos; el efecto es de UX/consistencia (breadcrumb «Inicio / Inicio», sección plegada equivocada, mensaje de bloqueo ausente) | Guard del backend en cada endpoint | Derivar el permiso de la vista, no del ítem de menú; incluirlas en el registro de rutas y cubrirlo en el test de humo de anchors (F1) |

---

## 2. Decisiones pendientes

### DEC-01 · Alcance de la navegación de nivel 1

| Opción | Descripción |
|---|---|
| A (recomendada) | 6 áreas + Administración + Portal; nivel 2 contextual; Centro como «Todos los módulos» |
| B | Mantener 10 secciones y solo reordenar |
| C | Menú único plano con búsqueda |

- **Recomendación:** A.
- **Ventajas:** reduce superficie, agrupa por tarea, permite crecimiento sin sumar ítems.
- **Riesgos:** requiere alias y capacitación; cambia hábitos.
- **No decidir:** el menú sigue creciendo y el rediseño visual no resuelve el descubrimiento.

### DEC-02 · Unificación `clientes` (legacy) y `empresas`

| Opción | Descripción |
|---|---|
| A (recomendada) | Un maestro por RUT; `clientes` en solo lectura; migrar informes legacy |
| B | Mantener ambos y documentar |
| C | Eliminar `clientes` de inmediato |

- **Recomendación:** A, en F5, con backup y doble lectura.
- **Ventajas:** una verdad, clave SII cifrada una sola vez.
- **Riesgos:** migración de datos históricos; ventana de inconsistencia.
- **No decidir:** dos fuentes, dos claves, dos alcances (`user_id` vs `empresa_id`).

### DEC-03 · F29/PPM en el catálogo de reportes

| Opción | Descripción |
|---|---|
| A (recomendada) | Incluirlos ahora enlazando a la estimación existente, rotulada «estimación» |
| B | Dejarlos «en preparación» hasta tener declaración oficial integrada |
| C | Eliminarlos del catálogo |

- **Recomendación:** A. La capacidad existe; ocultarla genera desconfianza.
- **Riesgos:** que el usuario los lea como declaración. Mitigación: rótulo y enlace a F29 oficial.
- **No decidir:** contradicción visible entre módulos.

### DEC-04 · Verificación pública del informe de Salud

| Opción | Descripción |
|---|---|
| A (recomendada) | Folio + hash + endpoint autenticado de verificación (no público) |
| B | Folio + hash sin endpoint |
| C | Sin folio |

- **Recomendación:** A, con acceso autenticado por empresa.
- **Ventajas:** trazabilidad y defensa ante terceros.
- **Riesgos:** privacidad si se hace público; complejidad.
- **No decidir:** el documento no se puede distinguir de una copia editada.

### DEC-05 · Pesos y umbrales del índice de salud

| Opción | Descripción |
|---|---|
| A (recomendada) | Congelar los actuales, versionarlos y revisarlos con el contador cada año |
| B | Ajustarlos ahora |
| C | Eliminar el índice y dejar solo hallazgos |

- **Recomendación:** A. Cambiarlos ahora invalida la serie histórica.
- **No decidir:** cada cambio altera comparaciones sin explicación.

### DEC-06 · Producción de DTE

| Opción | Descripción |
|---|---|
| A (recomendada) | Completar CAF/certificado, probar en certificación y emitir con checklist |
| B | Mantener solo la suscripción |
| C | Diferir |

- **Recomendación:** A, con pruebas controladas.
- **Riesgos:** folios y firma; error fiscal.
- **No decidir:** la función queda «implementada pero no operativa», y así se comunica.

### DEC-07 · Dependencia de Chrome headless para SII/TGR

| Opción | Descripción |
|---|---|
| A (recomendada) | Asumirla, con readiness, monitoreo y fallback claro |
| B | Buscar API/proveedor alternativo |
| C | Desactivar las consultas que la requieren |

- **Recomendación:** A a corto plazo; evaluar B si el SII publica API.
- **Riesgos:** fragilidad y consumo de recursos.
- **No decidir:** fallos silenciosos en producción.

### DEC-08 · Grado de cambio visual

| Opción | Descripción |
|---|---|
| A (recomendada) | Evolución sobre tokens y marca actuales |
| B | Rediseño visual completo |
| C | Solo correcciones |

- **Recomendación:** A.
- **Riesgos:** B rompe familiaridad y multiplica pruebas; C no resuelve la inconsistencia.
- **No decidir:** se acumulan estilos inline y excepciones.

### DEC-09 · Ubicación del CRM y del lote del despacho

| Opción | Descripción |
|---|---|
| A (recomendada) | Administración › Comercial; herramientas de lote en sus áreas |
| B | Área «Despacho» propia |
| C | Dejarlos como están |

- **Recomendación:** A, salvo que el dueño prefiera B para separar la operación del despacho.
- **Riesgos:** que el contador pierda accesos rápidos. Mitigación: favoritos.
- **No decidir:** siguen mezclados con el trabajo del cliente.

### DEC-10 · Política de eliminación definitiva de usuarios

| Opción | Descripción |
|---|---|
| A (recomendada) | Anonimizar auditoría en lugar de borrarla; conservar trazabilidad |
| B | Mantener el borrado actual |
| C | Prohibir la eliminación |

- **Recomendación:** A. Hoy `DELETE /usuarios/:id/definitivo` borra auditoría del usuario.
- **Riesgos:** obligaciones de retención y auditoría.
- **No decidir:** se pierde evidencia de acciones pasadas.

### DEC-11 · Herramienta de pruebas de navegador

| Opción | Descripción |
|---|---|
| A (recomendada) | Añadir Playwright como devDependency y 10 pruebas de humo |
| B | No añadir y confiar en pruebas de strings |
| C | Usar otra herramienta ya disponible |

- **Recomendación:** A. Requiere aprobación de dependencia.
- **Riesgos:** peso del navegador en CI.
- **No decidir:** el rediseño avanza sin red de seguridad visual.

### DEC-12 · Exportación de estados financieros

| Opción | Descripción |
|---|---|
| A (recomendada) | Añadir export PDF/Excel a comprobación, situación, resultados, clasificado y NIIF |
| B | Solo pantalla |
| C | Exportar solo desde el Centro de Reportes |

- **Recomendación:** A.
- **Riesgos:** formato oficial; requiere revisión contable.
- **No decidir:** el contador no puede entregar el balance.

---

## 3. Pendientes operativos (no código)

| # | Pendiente | Responsable | Impacto |
|---|---|---|---|
| 1 | Confirmar `TZ=America/Santiago` en producción | Operaciones | Período correcto |
| 2 | Verificar que `data/sii-fichas` y `data/certificados-tgr` estén en el backup | Operaciones | Evidencia |
| 3 | Cerrar las credenciales SII pendientes de empresas que fallan | Dueño | Diagnóstico completo |
| 4 | Definir custodio de `SECRETOS_MASTER_KEY` y `BACKUP_ENCRYPTION_KEY` | Dueño | Recuperación |
| 5 | Prueba de restauración de backup | Operaciones | Continuidad |
| 6 | Completar CAF/certificado para DTE | Dueño | Facturación |
| 7 | Validar con el contador los cálculos de PPM/remanente | Contador | Exactitud |
| 8 | Limpiar residuos `tmp-*` de la raíz | Desarrollo | Higiene y posible fuga de datos de prueba |

---

## 4. Riesgos aceptados conscientemente

| Riesgo | Motivo | Condición |
|---|---|---|
| Sin verificación pública del informe | Privacidad y alcance | Se rotula como documento de trabajo |
| Sin integración bancaria automática | Costo/valor | Cartola manual documentada |
| Sin F22/F29 presentados por el sistema | No es un portal tributario | Se enlaza al SII |
| Índice con pesos de producto | Decisión de negocio | Versionado y explicado |
| Datos legacy en texto plano | Deuda histórica | No se crean nuevas dependencias |

---

## 5. Consecuencia de no decidir

Si no se toman DEC-01, DEC-03 y DEC-04 antes de implementar:

- El rediseño visual se hará sobre una navegación que seguirá siendo un catálogo (el problema persiste).
- Los catálogos seguirán contradiciéndose (F29 «no disponible»).
- El informe seguirá sin poder distinguirse de una copia editada.

Si no se toma DEC-02 antes de F5:

- La migración de datos se hará sin plan y con riesgo de pérdida.

Si no se toma DEC-11 antes de F2:

- El cambio de navegación se validará solo con pruebas de strings, que no detectan una vista en blanco.
