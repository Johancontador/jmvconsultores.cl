# UI/UX — IVA Mensual

## Estética general
- Tema oscuro sofisticado
- Fondo base: #0f1117 (negro azulado profundo)
- Superficie cards: #1a1d27
- Superficie elevada: #21253a
- Acento principal: #6366f1 (índigo)
- Acento hover: #818cf8
- Texto primario: #f1f5f9
- Texto secundario: #94a3b8
- Texto muted: #475569
- Borde sutil: rgba(255,255,255,0.08)
- Borde hover: rgba(255,255,255,0.15)
- Success: #10b981
- Error: #ef4444
- Warning: #f59e0b
- Fuente: Inter (Google Fonts, weights 300/400/500/600)
- Border radius cards: 16px
- Border radius inputs/botones: 10px
- Transiciones: 0.2s ease

## Pantalla 1: Clientes (/index.html)

### Layout
```
┌─────────────────────────────────────────────────┐
│  💼 IVA Mensual            [Clientes] [Proceso] │  ← navbar
├─────────────────────────────────────────────────┤
│  Clientes                        [+ Agregar]    │  ← header
│  12 clientes activos                            │
├─────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────┐ │
│ │ 76.123.456-7  Comercial XYZ Ltda.      [✏️][🗑️]│ │  ← row cliente
│ │ Tasa PPM: 1.5%  •  +56 9 1234 5678  •  IVA │ │
│ └─────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────┐ │
│ │ 12.345.678-9  Juan Pérez Natural       [✏️][🗑️]│ │
│ │ Tasa PPM: 0%   •  +56 9 8765 4321  • EXENTO│ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

### Modal agregar/editar cliente
```
┌──────────────────────────────────┐
│  Agregar cliente            [X]  │
│                                  │
│  RUT *                           │
│  [76123456-7              ]      │
│                                  │
│  Nombre empresa *                │
│  [Comercial XYZ Ltda.     ]      │
│                                  │
│  Clave SII *                     │
│  [••••••••                ]  👁  │
│                                  │
│  Tasa PPM (ej: 0.015 = 1.5%) *  │
│  [0.015                   ]      │
│                                  │
│  Teléfono (con código país) *    │
│  [56912345678              ]      │
│                                  │
│  ☐ Cliente exento de IVA         │
│                                  │
│  [Cancelar]        [Guardar]     │
└──────────────────────────────────┘
```

## Pantalla 2: Proceso (/proceso.html)

### Estado inicial
```
┌─────────────────────────────────────────────────┐
│  💼 IVA Mensual            [Clientes] [Proceso] │
├─────────────────────────────────────────────────┤
│  Proceso mensual                                │
│                                                 │
│  Período                                        │
│  [Mayo ▾] [2026 ▾]                             │
│                                                 │
│  12 clientes activos listos para procesar       │
│                                                 │
│  [⚡ Generar todo]                              │
└─────────────────────────────────────────────────┘
```

### Durante el proceso
```
┌─────────────────────────────────────────────────┐
│  Procesando clientes... 3 de 12                 │
│  ████████░░░░░░░░░░░░░░░░░░░  25%              │
│  Consultando: Comercial XYZ Ltda.               │
│                                                 │
│  ✅ Cliente 1 - ok                              │
│  ✅ Cliente 2 - ok                              │
│  ⏳ Cliente 3 - consultando...                  │
└─────────────────────────────────────────────────┘
```

### Resultados (cards por cliente)
```
┌─────────────────────────────────────────────────┐
│  ✅ 11/12 procesados  ⚠️ 1 error    [Reintentar]│
├─────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────┐ │
│ │ Comercial XYZ Ltda.           76.123.456-7  │ │
│ │ ─────────────────────────────────────────── │ │
│ │ 📦 Compras    Neto $1.250.000  IVA $237.500 │ │
│ │ 🧾 Ventas     Neto $2.100.000  IVA $399.000 │ │
│ │ ─────────────────────────────────────────── │ │
│ │ Débito      $399.000                        │ │
│ │ Crédito    -$237.500                        │ │
│ │ IVA a pagar $161.500                        │ │
│ │ PPM 1.5%     $31.500                        │ │
│ │ ─────────────────────────────────────────── │ │
│ │ TOTAL F29   $193.000                        │ │
│ │                                             │ │
│ │ [Ver mensaje]  [📋 Copiar]  [💬 WhatsApp]   │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ ┌─────────────────────────────────────────────┐ │
│ │ Juan Pérez Natural      EXENTO 12.345.678-9 │ │
│ │ ─────────────────────────────────────────── │ │
│ │ 📦 Compras    Neto $450.000   IVA $0        │ │
│ │ 🧾 Ventas     Neto $890.000   IVA $0        │ │
│ │ ─────────────────────────────────────────── │ │
│ │ Sin IVA determinado (exento)                │ │
│ │ TOTAL F29   $0                              │ │
│ │                                             │ │
│ │ [Ver mensaje]  [📋 Copiar]  [💬 WhatsApp]   │ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

## Componentes UI

### Navbar
- Fondo #0f1117 con border-bottom sutil
- Logo: emoji 💼 + "IVA Mensual" en Inter 600
- Links: texto secundario, hover acento índigo

### Cards clientes (lista)
- Fondo #1a1d27, border rgba(255,255,255,0.08)
- Hover: border rgba(255,255,255,0.15), fondo #21253a
- Badge EXENTO: fondo #f59e0b20, texto #f59e0b, border #f59e0b40

### Cards resultado (proceso)
- Fondo #1a1d27, border izquierdo 3px acento según estado
  - ok: #6366f1
  - error: #ef4444
  - exento: #f59e0b
- Total F29 destacado: texto grande, color acento

### Botones
- Primary (Generar todo): fondo #6366f1, hover #818cf8
- Secondary (Copiar, etc.): fondo transparent, border rgba(255,255,255,0.15)
- WhatsApp: fondo #25d366, hover #20ba5a, texto blanco
- Danger (Eliminar): fondo transparent, texto #ef4444, hover fondo #ef444420

### Inputs / Selects
- Fondo #21253a
- Border: 1px solid rgba(255,255,255,0.12)
- Focus: border #6366f1, box-shadow 0 0 0 3px rgba(99,102,241,0.15)
- Texto: #f1f5f9
- Placeholder: #475569

### Barra de progreso
- Track: rgba(255,255,255,0.08)
- Fill: gradiente #6366f1 → #818cf8
- Animación: transición suave width

### Modal
- Overlay: rgba(0,0,0,0.7) backdrop-blur(4px)
- Card: #1a1d27, border rgba(255,255,255,0.12), border-radius 20px
- Ancho máximo: 480px

## Responsive
- Mobile: columna única, cards full width
- Desktop: max-width 900px centrado
