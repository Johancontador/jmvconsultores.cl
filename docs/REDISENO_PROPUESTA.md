# Propuesta de Rediseño — IVA Mensual → Plataforma de Análisis Tributario

## 0. Resumen para decidir rápido

Pides mucho (decenas de reportes, dashboards, filtros, exportaciones, rediseño profesional) y pides
que no se rompa nada. Es correcto y es factible, pero antes de escribir una línea más de código hay
**una decisión tuya que condiciona todo lo demás**: ¿seguimos en HTML/CSS/JS vanilla (como está hoy)
o migramos a React/Next.js/Tailwind como mencionas al final?

Mi recomendación, con los argumentos abajo: **quedarnos en vanilla JS, pero con una arquitectura
de componentes mucho más seria** (design system, layout compartido, tabla/gráfico/filtro reutilizables).
Llegamos a un resultado visualmente idéntico a lo que pides, sin el riesgo de reescribir desde cero
la parte que ya funciona (la conexión al SII, que costó bastante dejar funcionando). Al final de este
documento te pregunto explícitamente para confirmar.

Todo lo que sigue es el análisis que pediste: estado actual, arquitectura propuesta, catálogo de
reportes (honesto sobre qué se puede construir con los datos que realmente entrega el SII y qué no),
y un roadmap por fases.

---

## 1. Estado actual — qué existe y qué funciona

### Backend (Node + Express + SQLite, funciona)
- `backend/services/sii-session.js` + `sii-rcv.js`: login directo al SII (sin intermediario pagado),
  manejo de cookies/sesión, parseo del export CSV-en-JSON que entrega el SII. **Esta es la parte más
  costosa de haber construido — requirió ingeniería inversa con captura HAR real. No se debe tocar
  salvo que sea estrictamente necesario.**
- `backend/services/calculos.js`: sumas, IVA determinado, PPM, categorización por tipo de documento.
  Recién corregido para restar Notas de Crédito correctamente.
- Rutas: `clientes` (CRUD), `proceso` (proceso mensual + WhatsApp), `informe` (informe multi-año),
  `sii` (probar conexión, libro mensual).
- Base de datos: SQLite con 2 tablas (`clientes`, `procesos`). Sin datos históricos persistidos del
  RCV en sí — cada consulta va en vivo al SII (no hay caché local de libros ya descargados).

### Frontend (HTML + CSS + JS vanilla, sin build)
- 5 pantallas: Clientes, Proceso, Libro, Informe, Dashboard.
- Un design system real ya en `app.css` (paleta oscura, tipografía Inter, variables CSS) — es una
  base sólida, no partimos de cero visualmente.
- Cada pantalla es un archivo JS independiente sin componentes compartidos (código repetido de
  toasts, formateo de RUT/montos, selects de mes/año en cada archivo).

### Lo que falta / limita hoy
- No hay capa de "datos históricos" — todo se recalcula contra el SII en cada consulta. Para reportes
  anuales rápidos y comparativos, conviene guardar en SQLite lo que ya se consultó (caché local).
- No hay concepto de "rubro", "comuna" o "región" en ningún lado del sistema ni en los datos del SII.
- No hay usuarios/roles (es intencional — app de un solo usuario, no se propone cambiar esto).

---

## 2. La decisión de stack (necesito tu confirmación)

| | Vanilla JS reforzado (recomendado) | React + Next.js + Tailwind |
|---|---|---|
| Riesgo de romper la conexión SII | Ninguno — el backend no cambia | Ninguno si solo se toca el frontend, pero Next.js normalmente implica repensar cómo se sirve la app (SSR, API routes) — más superficie para introducir bugs |
| Tiempo para tener el primer resultado visual | Días | Semanas (hay que montar proyecto, build, tooling, aprender/decidir convenciones) |
| Calidad visual final alcanzable | Igual de alta — el diseño no depende del framework | Igual de alta |
| Mantenimiento a futuro (un solo desarrollador, uso personal) | Simple: abrir un .html y listo | Requiere `npm run build`, entender Next, gestionar versiones de dependencias |
| Alinea con `.cursor/rules` actual | Sí | No — el proyecto define explícitamente "NUNCA instalar frameworks frontend" |
| Gráficos, tablas ricas, exportación Excel/PDF | Totalmente posible con librerías vía CDN (Chart.js ya está, se agregan SheetJS y jsPDF) | Igual de posible, con más piezas moviéndose |

**Recomendación:** vanilla JS reforzado con una arquitectura de componentes real (ver sección 3).
Se obtiene el mismo resultado visual y funcional que pides, con muchísimo menos riesgo y tiempo,
y es coherente con las reglas que tú mismo definiste para este proyecto. Si más adelante quieres
llevarlo a React/Next como proyecto aparte (por ejemplo si algún día lo vuelves un producto para
otros contadores, no solo para ti), tiene sentido reevaluarlo — pero no como el próximo paso.

---

## 3. Arquitectura propuesta (vanilla JS reforzado)

### 3.1 Estructura de archivos nueva
```
frontend/
├── shared/
│   ├── layout.js       ← navbar + sidebar renderizados desde JS (una sola fuente, no copiado en cada .html)
│   ├── toast.js        ← sistema de notificaciones único
│   ├── format.js       ← fmt(), formatRut(), formatPeriodo() — una sola vez, no repetido en cada página
│   ├── api.js          ← wrapper fetch con manejo de errores consistente
│   ├── table.js        ← componente de tabla genérico: ordenar, paginar, exportar
│   ├── filters.js       ← barra de filtros reutilizable (cliente, período, tipo doc, monto, etc.)
│   └── export.js       ← exportar a Excel (SheetJS), PDF (jsPDF), CSV — un solo lugar
├── pages/
│   ├── dashboard/
│   ├── clientes/
│   ├── libro/
│   ├── proceso/
│   └── reportes/       ← catálogo completo, un HTML por reporte o un motor genérico parametrizado
```

### 3.2 Navegación propuesta (sidebar, no solo navbar superior)
Con 5 pantallas un navbar alcanza; con 20+ reportes no. Propuesta: sidebar colapsable a la izquierda
con secciones:
- **Inicio** (Dashboard Ejecutivo)
- **Clientes**
- **Proceso Mensual**
- **Libros** (Compra / Venta — el mes único que ya construimos)
- **Reportes** (submenú desplegable con las categorías del punto 4)
- **Configuración** (nueva — datos del contador, tasa PPM por defecto, etc.)

### 3.3 Motor de reportes (para no construir 30 pantallas a mano)
En vez de 30 archivos HTML casi idénticos, un solo motor: `reportes.html` + `reportes.js` que recibe
un identificador de reporte (`?tipo=iva-mensual`, `?tipo=top-clientes`, etc.), pide los datos al
endpoint correspondiente, y renderiza tabla + gráfico + filtros + exportación de forma genérica.
Esto reduce drásticamente el código a mantener y hace que agregar un reporte nuevo sea configurar
un objeto, no escribir una pantalla.

---

## 4. Catálogo de reportes — honesto sobre qué se puede construir

Con los datos reales que entrega el SII (confirmados con la captura HAR: folio, tipo doc, RUT
contraparte, razón social, fechas, montos neto/exento/IVA/total, código sucursal), clasifico cada
reporte que pediste:

### Nivel 1 — Ya tenemos los datos, se construyen directo
Libro Compra · Libro Venta · IVA Mensual · IVA Anual · IVA por período · Ventas por mes ·
Ventas por año · Compras por mes · Comparativo mensual · Comparativo anual · Variaciones ·
Tendencias · Análisis histórico · Resumen tributario · Estado IVA · Top clientes (por razón social +
RUT en ventas) · Top proveedores (por RUT + razón social en compras) · Ranking mensual/anual ·
KPIs / Indicadores · Dashboard Ejecutivo.

### Nivel 2 — Se pueden construir, pero requieren más consultas al SII o cruces de datos
IVA por cliente / IVA por proveedor (agregando por RUT contraparte dentro del período) ·
Facturas anuladas (cruzando "Tipo Docto. Referencia" + "Folio Docto. Referencia" contra Notas de
Crédito que las referencian) · Documentos observados / Facturas pendientes (el SII permite consultar
por otros estados además de "REGISTRO" — habría que agregar esas consultas, duplicando el número de
llamadas al SII por período).

### Nivel 3 — Necesitan un dato que el SII no entrega, pero se puede agregar manualmente
Ventas/Compras por rubro (el SII no clasifica por rubro — se puede agregar un campo "rubro" al
cliente y a los proveedores/clientes frecuentes, pero es carga manual tuya, no automática) ·
Ventas por comuna / por región (el RCV no incluye dirección de la contraparte — inviable sin otra
fuente de datos) · Facturas con errores / Facturas sin RUT (se puede detectar si el campo RUT viene
vacío o con formato inválido en el export, eso sí es automático).

### Nivel 4 — No es información que el SII entregue por este medio
Facturas repetidas entre libros de distintos meses es viable (comparar folios ya vistos), pero
"repetidas" dentro de un mismo libro normalmente no ocurre porque el SII ya deduplica.

**Conclusión práctica:** en la Fase 2-3 del roadmap construyo todo el Nivel 1 (que es la mayoría de tu
lista). El Nivel 2 lo dejamos para una fase posterior porque duplica las consultas al SII (hay que
cuidar no pasarse de rate limit). El Nivel 3 lo activamos si me confirmas que quieres cargar el
"rubro" manualmente por cliente. El Nivel 4 (comuna/región) lo descarto salvo que me digas de dónde
sacaríamos ese dato.

---

## 5. Filtros — mapeo a datos reales
Disponibles hoy: Cliente/Empresa, Mes, Año, Rango de fechas, Proveedor (RUT contraparte en compras),
Tipo Documento, Monto mínimo/máximo, IVA, Exento, Afecto, RUT, Folio.
No disponibles sin dato adicional: Estado (más allá de "registro"), Sucursal (si el cliente no
factura por sucursal, el campo viene vacío), Usuario (app de un solo usuario, no aplica).

---

## 6. Exportaciones
- **CSV**: ya implementado en Libro, se generaliza al motor de reportes.
- **Excel**: SheetJS (`xlsx` vía CDN) — genera `.xlsx` real desde el navegador, sin backend adicional.
- **PDF**: jsPDF + jsPDF-AutoTable vía CDN — reportes con tabla + encabezado, o usar impresión del
  navegador (ya existe para Informe) que es más simple y se ve mejor para documentos largos.
- **XML**: es el único que no tiene un caso de uso claro para este contexto (el SII no consume XML
  de vuelta desde esta app, y no hay otro sistema integrado que lo requiera todavía) — lo dejo
  pendiente de que me digas para qué lo necesitas exactamente antes de construirlo.

---

## 7. Roadmap por fases (con checkpoint al final de cada una, como venimos trabajando)

**Fase 1 — Cimientos:** design system reforzado, layout compartido (sidebar + navbar), componentes
`table.js`/`filters.js`/`export.js`/`format.js`. Sin cambiar ninguna pantalla existente todavía —
solo la base para no repetir trabajo.

**Fase 2 — Dashboard Ejecutivo nuevo:** KPIs, gráficos de línea/barra/donut, calendario de
vencimientos F29, todo con datos que ya se consultan hoy (informe multi-mes).

**Fase 3 — Migrar Libro/Proceso/Informe al layout nuevo** sin cambiar su lógica interna — solo
el envoltorio visual y la navegación, para no arriesgar lo que ya funciona.

**Fase 4 — Motor de reportes + Nivel 1 completo** (todos los reportes de la sección 4).

**Fase 5 — Exportaciones** (Excel/PDF) integradas al motor de reportes y también a Libro/Informe.

**Fase 6 — Nivel 2** (IVA por cliente/proveedor, documentos observados) si decides que vale la pena
el costo adicional de consultas al SII.

Cada fase termina con un checkpoint tuyo antes de seguir, igual que en el PLAN.md original.

---

## 8. Lo que necesito que confirmes antes de la Fase 1
1. Stack: ¿vanilla JS reforzado (recomendado) o insistes en React/Next.js?
2. Nivel 3 (rubro por cliente): ¿lo agregamos como campo manual en la ficha de cliente?
3. XML: ¿para qué lo necesitas? (definir antes de construirlo para no perder tiempo en algo sin uso claro)
