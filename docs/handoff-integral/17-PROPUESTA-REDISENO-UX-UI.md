# 17 · Propuesta de rediseño UX/UI

> **Propuesta**, no implementación. Respeta la identidad JMV existente y el shell sin build.
> Base: hallazgos de `08` (diseño real) y `16` (arquitectura funcional).

---

## 1. Dirección visual

**Empresarial, sobrio, preciso.** Fondo claro, superficies blancas, azul JMV como acento, azul marino para jerarquía. Densidad alta pero legible. Sin gradientes decorativos en el área de trabajo, sin emoji en acciones, sin animaciones infinitas.

| Principio | Aplicación |
|---|---|
| Jerarquía por tipografía y espacio | No por cajas de colores |
| Un acento | `#2e86c8` solo para acción/selección |
| Semántica explícita | Estados y severidades con nombre, no solo color |
| Densidad controlada | Dos modos: cómoda (dueño) y compacta (contador) |
| Consistencia | Un componente por patrón; cero estilos inline nuevos |

---

## 2. Tokens (evolución, no reemplazo)

Se conservan los tokens actuales (`--c-jmv-*`, slate, escala de 4 px, radios, sombras). Se **añaden**:

```css
:root {
  /* Superficies */
  --surface-0: var(--bg-canvas);
  --surface-1: var(--bg-surface);
  --surface-2: var(--bg-elevated);

  /* Estado de proceso (no severidad) */
  --state-neutral:   #64748b;
  --state-progress:  #2e86c8;
  --state-done:      #059669;
  --state-warning:   #d97706;
  --state-blocked:   #dc2626;

  /* Severidad de riesgo (independiente del estado) */
  --sev-info:   #2e86c8;
  --sev-low:    #059669;
  --sev-medium: #d97706;
  --sev-high:   #dc2626;

  /* Foco y foco de tabla */
  --focus-ring: 0 0 0 3px rgba(46,134,200,0.35);

  /* Densidad */
  --row-h-comoda: 48px;
  --row-h-compacta: 36px;

  /* Tipografía de datos */
  --fs-data: 0.875rem; /* 14px, cifras tabulares */
}
```

**Contraste:** todo texto sobre `--surface-1` debe alcanzar 4.5:1; los chips usan fondo `-soft` + texto oscuro del mismo tono, no texto claro sobre color saturado.

---

## 3. Tipografía y datos

| Rol | Fuente | Tamaño / peso |
|---|---|---|
| Título de página | Sora | 22 px / 700 |
| Título de sección | Sora | 17 px / 600 |
| Cuerpo | Inter | 16 px / 400 |
| Secundario | Inter | 13 px / 400 |
| Etiqueta / tabla | Inter | 12–13 px / 500–600 |
| Cifras | JetBrains Mono | 14 px, `font-variant-numeric: tabular-nums` |
| KPI | JetBrains Mono | 24–28 px / 600 |

Regla: **toda cifra monetaria en mono tabular**, alineada a la derecha; los negativos con signo y color semántico solo si representan pérdida/riesgo, no por ser negativos.

---

## 4. Componentes a estandarizar

| Componente | Contrato | Reemplaza |
|---|---|---|
| `PageHeader` | kicker (empresa · RUT), título, subtítulo de alcance, acciones primaria/secundaria | Titlebar + encabezados ad-hoc de cada vista |
| `Toolbar` | filtros + contador «mostrando X de Y» + acciones | `.pg-toolbar`, `.frm-row` repetidos |
| `DataTable` | UITabla actual + densidad + columnas fijas + acciones por fila agrupadas | Tablas manuales |
| `StatusBadge` | `estado` (proceso) con icono + texto | Chips que mezclan estado y severidad |
| `SeverityBadge` | `severidad` con icono + texto | `chipSev` que reutiliza chips documentales |
| `Kpi` | etiqueta, valor, contexto, «cómo se calcula» visible | Tarjetas con `title` |
| `Notice` | tono (info/atención/riesgo), título, cuerpo, acción | Carteles rojos genéricos |
| `Evidence` | fuente, fecha, registro, enlace | Texto «Fuente: …» |
| `EmptyState` | causa + acción | `.empty` con texto suelto |
| `Skeleton` | carga con forma del contenido | «Cargando…» genérico |
| `ConfirmDialog` | consecuencia + texto a escribir si es irreversible | `UIEstado.confirmar` (conservar y unificar) |
| `Tabs` | pestañas con URL (`?tab=`) | `window._*Tab` |
| `Stepper` | pasos de un job con estado y reintento | Lista de progreso de Salud |

**Meta:** reducir los 528 estilos inline a menos de 50 (solo casos dinámicos: anchos de barra, colores de serie).

---

## 5. Plantillas de pantalla

### 5.1 Espacio de trabajo de módulo

```text
┌ PageHeader ─────────────────────────────────────────────┐
│ DOCUMENTOS · Empresa X · 76.123.456-7                   │
│ Documentos                            [Actualizar SII]  │
│ Bandeja · Libros · Emitidos · Reglas                    │
├ Toolbar ────────────────────────────────────────────────┤
│ [Buscar] [Estado ▾] [Tipo ▾] [Cuenta ▾]  32 de 1.240    │
├ Contenido ──────────────────────────────────────────────┤
│ Tabla / detalle / estado vacío                          │
└─────────────────────────────────────────────────────────┘
```

### 5.2 Portada de área

```text
Título del área + una línea de estado
[Acción primaria]  [Acción secundaria]
4–7 tarjetas de tarea (título, una línea, enlace)
Bloque «Requiere atención» (si hay)
```

### 5.3 Detalle

```text
Volver · Título (folio) · Estado · Acciones
Resumen (montos clave)
Secciones: Datos · Clasificación · Contabilidad · Evidencia
Historial / auditoría del registro
```

### 5.4 Reporte

```text
Período visible · Alcance · [Exportar] [Imprimir]
Resumen (3–5 cifras)
Tabla principal
Notas metodológicas plegables
```

---

## 6. Sistema de acciones

| Tipo | Estilo | Dónde | Regla |
|---|---|---|---|
| Primaria | sólido azul | Header o toolbar | Una por pantalla |
| Secundaria | outline | Junto a la primaria | Alternativas |
| Terciaria | texto | En tablas y enlaces | Bajo peso |
| Contextual | menú `⋮` | Fila | Agrupa 3+ acciones; teclado completo |
| Destructiva | rojo outline + confirmación | Zona separada | Nunca junto a la primaria |
| Navegación | enlace | — | No se ve como botón que escribe |
| Exportar | secundaria + icono | Toolbar de tabla | Siempre disponible si hay datos |
| Ayuda | icono `?` | Header de sección | Abre explicación contextual |

**Prohibido:** dos primarias en la misma pantalla; botones deshabilitados sin motivo visible; emoji como icono de acción.

---

## 7. Movimiento

| Interacción | Duración | Curva |
|---|---|---|
| Hover / focus | 120 ms | ease-out |
| Apertura de panel/modal | 180 ms | ease-out |
| Cambio de pestaña | 150 ms | ease-out |
| Aparición de fila nueva | 200 ms, sin rebote | ease-out |
| Skeletons | pulso suave 1.2 s, solo si no hay `prefers-reduced-motion` | — |

**Eliminar:** `kpiPulse` infinito, `login-in` de 0.5 s (reducir a 200 ms), cualquier animación decorativa en tablas.

**Regla:** con `prefers-reduced-motion`, todo queda funcional sin transición.

---

## 8. Accesibilidad (criterios de aceptación)

1. Contraste ≥ 4.5:1 en texto y ≥ 3:1 en bordes de control (medir con herramienta, no a ojo).
2. Foco visible en todo control; orden de tabulación lógico.
3. `aria-live` para cambios de vista y resultados de filtros.
4. Tablas con `<caption>` o título asociado; encabezados `scope="col"`.
5. Menú contextual de fila con `role="menu"`, flechas y Escape.
6. Iconos decorativos `aria-hidden`; iconos con acción, `aria-label`.
7. Estado nunca solo por color: icono + texto.
8. Texto mínimo 12 px; objetivos táctiles ≥ 44×44 px en móvil.
9. Formularios con `label` asociado, error inline y `aria-describedby`.
10. Sin scroll horizontal a 320 px.

---

## 9. Antes / después (ejemplos concretos)

### 9.1 Portada de Salud Tributaria

**Antes**
- Dos bloques de índice idénticos.
- Robot + título + subtítulo + 8 badges animados.
- 8 KPI con `title` y una línea residual `": 85/100"`.
- Dos tablas de plan de acción.

**Después**
```text
SALUD TRIBUTARIA · Empresa X · octubre 2026
Diagnóstico no concluyente / Favorable con observaciones / Requiere revisión
Índice 78/100 · Cobertura 65% · Confianza MEDIA · Fuentes al 22/10 18:40
[Reunir antecedentes]  [Ver informe]  [Estado de las fuentes ▾]

┌ Requiere atención (3) ────────────────────────────────┐
│ F29 pendiente · 2 períodos · vence 12/11  [Ver plan]  │
│ Diferencia F29 vs RCV · $1.240.000        [Conciliar] │
│ Deuda TGR · $380.000                      [Ver PDF]   │
└───────────────────────────────────────────────────────┘

Indicadores (5)     · valor, contexto y «cómo se calcula»
Cumplimiento        · calendario + tabla
IVA y conciliación  · serie + puente
Riesgos             · matriz con evidencia
Plan de acción      · una tabla
Metodología         · plegada
```

### 9.2 Bandeja de Documentos

**Antes:** 6 filtros + 3 botones de acción + chips de estado + menú `⋮` que mezcla anular con ver detalle.

**Después:** una toolbar con búsqueda + estado + tipo + cuenta + «más filtros»; contador «32 de 1.240»; acciones primarias «Clasificar» y «Contabilizar»; `⋮` solo con acciones contextuales; «Anular» en zona destructiva del detalle.

### 9.3 Informe imprimible

**Antes:** 8 capítulos con tabla mensual duplicada, aviso crítico sin color por CSS inválido, «reflecten».

**Después:** portada con alcance y estado de fuentes; 8 capítulos sin duplicados; aviso crítico visible; descargo único; folio + hash; tipografía y tablas que caben en A4.

---

## 10. Criterios de éxito del rediseño

| Criterio | Medición |
|---|---|
| Menos superficie de navegación | 43 ítems de nivel 1 → ≤ 8 entradas; el resto en nivel 2 |
| Descubrimiento | Un usuario nuevo encuentra «emitir factura», «ver F29» y «conciliar banco» en ≤ 2 clics |
| Consistencia | 0 estilos inline nuevos; 1 componente por patrón |
| Claridad de estado | Toda pantalla distingue carga, vacío, error, sin permiso y fuente no disponible |
| Confianza | Todo indicador muestra fuente y fecha; ningún «certificado» impropio |
| Accesibilidad | 0 violaciones críticas de contraste/foco en las 10 pantallas principales |
| Continuidad | 100 % de anchors y endpoints vigentes; 634 tests siguen verdes |

---

## 11. Lo que no cambia

- Paleta de marca (`#2e86c8`, `#1e2a5e`), tema claro por defecto y toggle.
- Tipografías (Sora/Inter/JetBrains Mono) y escala de 4 px.
- Shell sin build, SPA por hash, `window.VIEWS`.
- UITabla como base de tablas.
- Skip-link, `aria-live`, foco gestionado y reduced-motion.
