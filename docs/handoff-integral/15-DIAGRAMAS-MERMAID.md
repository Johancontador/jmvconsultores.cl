# 15 · Diagramas Mermaid

> Convención: **línea continua** = conexión existente y verificada en código; **línea punteada** = propuesta o no verificada en ejecución.
> Los diagramas reflejan el repositorio al 2026-10-23; no incluyen integraciones inexistentes.

---

## 1. Arquitectura general

```mermaid
flowchart TB
  subgraph Cliente
    SPA["SPA /sistema/ app.js + VIEWS"]
    PUB["Sitio público landing login registro"]
  end

  subgraph Servidor["Node.js 24 · Express 4"]
    MW["Middleware: headers · auth · permisos · licencia"]
    R["23 montajes /api/*"]
    CORE["64 módulos core/ (dominio puro)"]
    SRV["10 servicios (SII RCV cálculo informe sesión)"]
  end

  DB[("SQLite WAL 61 tablas")]
  FS["Sistema de archivos: fichas SII · PDF TGR · backups"]
  SII[("SII")]
  TGR[("TGR")]
  MP[("MercadoPago")]
  CHROME["Chrome/Chromium headless"]

  SPA -->|HTTPS JSON + cookie sid| MW
  PUB --> MW
  MW --> R
  R --> CORE
  R --> SRV
  CORE --> DB
  SRV --> DB
  CORE --> FS
  SRV -->|HTTPS cookies| SII
  CORE --> CHROME
  CHROME --> SII
  CHROME --> TGR
  R -->|webhook| MP
```

---

## 2. Mapa de módulos y subfunciones (actual)

```mermaid
flowchart LR
  INI["Inicio"] --> P1["Panel del período"]
  INI --> SAL["Salud Tributaria"]
  INI --> ALE["Alertas"]
  INI --> CEN["Centro de Aplicaciones"]

  DOC["Documentos y libros"] --> BAN["Bandeja"]
  DOC --> LIB["Libros C/V"]
  DOC --> ONB["Onboarding"]
  DOC --> ANA["Dashboard tributario"]
  DOC --> CAL["Calculadora IVA"]

  FAC["Facturación"] --> EMI["Emitir DTE"]
  FAC --> BDT["Bandeja DTE"]
  FAC --> CFG["Configuración emisor"]

  CON["Contabilidad"] --> AUT["Contabilización"]
  CON --> PRO["Propuestas y conciliación"]
  CON --> ASI["Asientos diario mayor plan"]
  CON --> MEM["Memoria"]
  CON --> EXT["Receptor externo"]
  CON --> ACT["Activos fijos"]

  TES["Tesorería y cobranza"] --> BCO["Bancos · libro · cartola · conciliación"]
  TES --> COB["Cobranza y mora"]

  INF["Informes y control"] --> REP["Centro de Reportes"]
  INF --> CIE["Cierre de período"]
  REP --> R1["Comprobación · 8 columnas"]
  REP --> R2["Situación · resultados · clasificado · NIIF"]
  REP --> R3["Cuentas corrientes"]

  LOT["Lote del despacho"] --> POR["Portafolio"]
  LOT --> IR["Informe por rango"]
  LOT --> PM["Proceso masivo"]
  LOT --> EM["Exportación ZIP"]

  PORC["Portal de cliente"] --> P10["10 vistas read-only"]

  ADM["Administración"] --> AD["Empresas · usuarios · roles · cuentas"]
  ADM --> AUD["Auditoría"]
  ADM --> INT["Integraciones"]
  ADM --> SUS["Suscripción y pagos"]

  CRM["CRM Comercial"] --> C1["Pipeline · fichas · contactos · oportunidades · campañas · retención"]
```

---

## 3. Navegación entre pantallas (actual)

```mermaid
flowchart TD
  LOGIN["Login"] --> BOOT{"¿Tiene empresa?"}
  BOOT -->|No| ONB["Onboarding RUT + clave SII"]
  BOOT -->|Sí| CENTRO["Centro de Aplicaciones #centro"]
  ONB --> CENTRO

  CENTRO --> PANEL["Panel del período"]
  CENTRO --> MODULOS["Cualquier módulo autorizado"]

  PANEL --> SALUD
  PANEL --> AUTOM
  PANEL --> LIBROS
  PANEL --> ONBOARD
  PANEL --> DOCS
  PANEL --> ASIENTOS
  PANEL --> PROPUESTAS
  PANEL --> REPORTES

  DOCS -->|clasificar| PROP["Propuesta"]
  PROP -->|confirmar| ASIENTO["Asiento"]
  LIBROS -->|ingesta SII| DOCS
  SALUD -->|reunir antecedentes| JOB["Job 6 pasos"]
  JOB --> SALUD
  SALUD -->|emitir| INFORME["Informe HTML imprimible"]
  SALUD -->|deuda TGR| CERT["Certificado PDF TGR"]
  TESO -->|cartola| CONC["Conciliación bancaria"]
  CIE -->|cerrar| PER["Período CERRADO"]
  DTE -->|ACEPTADO| DOCS
end
```

---

## 4. Flujo contable principal (documento → asiento)

```mermaid
sequenceDiagram
  actor C as Contador
  participant UI as SPA
  participant API as /api/contable
  participant DOC as core/documentos
  participant REG as core/reglas
  participant PROP as core/propuestas
  participant AS as core/asientos

  C->>UI: Abre Bandeja
  UI->>API: GET /documentos?periodo=YYYYMM
  API->>DOC: listar
  DOC-->>API: documentos + conteos
  API-->>UI: JSON
  C->>UI: Clasifica (cuenta, CC, IVA)
  UI->>API: POST /documentos/:id/clasificar
  API->>DOC: clasificar + auditar
  C->>UI: Genera propuesta
  UI->>API: POST /documentos/:id/propuesta
  API->>PROP: generar (regla → memoria → alias)
  PROP->>REG: resolver regla
  PROP-->>API: snapshot de líneas
  C->>UI: Confirma
  UI->>API: POST /propuestas/:id/confirmar
  API->>AS: crear (Σd=Σh, período abierto)
  AS-->>API: asiento + folio
  API-->>UI: documento CONTABILIZADO
```

---

## 5. Integración SII

```mermaid
flowchart LR
  KEY["Bóveda AES-256-GCM"] --> LOGIN["loginSII"]
  LOGIN -->|cookies| SES["Sesión SII (TTL 25 min)"]
  SES --> RCV["RCV getResumen + getDetalle*"]
  SES --> FICHA["Ficha DatosCntrNow"]
  SES --> DECL["Declaraciones F29 F22 DJ BHE"]
  SES --> TGR["TGR certificado deuda"]

  RCV --> CACHE[("rcv_cache")]
  RCV --> DOC[("documentos")]
  DOC --> CONC["Conciliación SII vs contable"]
  FICHA --> EMP[("empresas + fichas JSON")]
  DECL --> DBD[("declaraciones_sii + f29_formularios")]
  TGR --> DBT[("deuda_tgr + PDF")]

  DBD --> SALUD["Salud Tributaria"]
  DOC --> SALUD
  EMP --> SALUD
  DBT --> SALUD
  CONC --> SALUD

  LOGIN -.cierre en finally.-> SIIEND["CAutCierra.cgi"]
```

---

## 6. Generación de Salud Tributaria

```mermaid
flowchart TD
  BTN["Reunir antecedentes"] --> JOB["salud-sincronizacion.iniciar"]
  JOB --> P1["1 Ficha SII"]
  JOB --> P2["2 RCV opcional"]
  JOB --> P3["3 Declaraciones"]
  JOB --> P4["4 Compacto F29"]
  JOB --> P5["5 Renta F22"]
  JOB --> P6["6 Deuda TGR"]
  P1 --> INF["construirInforme"]
  P2 --> INF
  P3 --> INF
  P4 --> INF
  P5 --> INF
  P6 --> INF
  INF --> H["Hallazgos"]
  INF --> D["5 dimensiones"]
  D --> IDX["Índice + clasificación"]
  H --> RIES["Matriz de riesgos + exposición"]
  INF --> PLAN["Plan de acción"]
  INF --> KPI["KPIs + serie"]
  INF --> OP["Opinión profesional"]
  INF --> SNAP[("snapshot JSON")]
  INF --> HTML["Informe imprimible 8 capítulos"]
  INF --> GRAF["Gráficos SVG compartidos"]
```

---

## 7. Generación de certificados y reportes

```mermaid
flowchart LR
  subgraph Reportes internos
    A1["Comprobación"] --> J1["JSON"]
    A2["8 columnas"] --> J1
    A3["Situación"] --> J1
    A4["Resultados"] --> J1
    A5["Clasificado / NIIF"] --> J1
    J1 --> UI1["Pantalla"]
    J1 -.sin export.-> X1["PDF / Excel"]
  end

  subgraph Documentos
    B1["Informe Salud"] --> H1["HTML A4"]
    H1 --> PDF1["PDF del navegador"]
    B2["TGR"] --> PDF2["PDF oficial descargado"]
    B3["DTE"] --> XML["XML firmado + estado SII"]
  end

  subgraph Exportaciones
    C1["Libros / Bandeja / Auditoría"] --> CSV["CSV o XLS en cliente"]
    C2["Informe por rango"] --> XLS["Excel servidor"]
    C3["Reporte masivo"] --> ZIP["ZIP"]
  end
```

---

## 8. Autenticación y autorización

```mermaid
flowchart TD
  REQ["Petición"] --> AUTH{"Cookie sid válida"}
  AUTH -->|No| E401["401"]
  AUTH -->|Sí| PERM{"requirePermiso capacidad"}
  PERM -->|Sin asignación| E403["403"]
  PERM -->|Sin capacidad| E403
  PERM -->|OK| LIC{"¿Escritura?"}
  LIC -->|No| OK["Ejecuta"]
  LIC -->|Sí| GATE{"Licencia operativa"}
  GATE -->|No| E402["402"]
  GATE -->|Sí| AUD["Audita si muta"]
  AUD --> OK
  OK --> DB[("empresa_id aislado")]
```

---

## 9. Entidades y relaciones (simplificado)

```mermaid
erDiagram
  USERS ||--o{ SESSIONS : tiene
  USERS ||--o{ USUARIO_EMPRESA : asignado
  EMPRESAS ||--o{ USUARIO_EMPRESA : recibe
  ROLES ||--o{ USUARIO_EMPRESA : define

  EMPRESAS ||--o{ CUENTAS : posee
  EMPRESAS ||--o{ PERIODOS_CONTABLES : abre
  EMPRESAS ||--o{ DOCUMENTOS : recibe
  EMPRESAS ||--o{ ASIENTOS : registra
  EMPRESAS ||--o{ REGLAS_CONTABLES : configura
  EMPRESAS ||--o{ CONTRAPARTES : memoriza
  EMPRESAS ||--o{ DECLARACIONES_SII : consulta
  EMPRESAS ||--o{ F29_FORMULARIOS : lee
  EMPRESAS ||--o{ DEUDA_TGR : certifica
  EMPRESAS ||--o{ SALUD_TRIBUTARIA_SNAPSHOTS : guarda
  EMPRESAS ||--o{ SUSCRIPCIONES : contrata
  EMPRESAS ||--o{ DTE_EMITIDOS : emite
  EMPRESAS ||--o{ BANCOS_CUENTAS : opera
  EMPRESAS ||--o{ ACTIVOS_FIJOS : posee

  CUENTAS ||--o{ ASIENTO_LINEAS : imputa
  ASIENTOS ||--o{ ASIENTO_LINEAS : contiene
  DOCUMENTOS ||--o{ PROPUESTAS : origina
  PROPUESTAS ||--o| ASIENTOS : confirma
  DOCUMENTOS }o--|| CUENTAS : clasifica
  DOCUMENTOS }o--o| REGLAS_CONTABLES : aplica
  DOCUMENTOS }o--o| ASIENTOS : contabiliza
  PERIODOS_CONTABLES ||--o{ ASIENTOS : agrupa
  BANCOS_CUENTAS ||--o{ TESO_MOVIMIENTOS : registra
  TESO_MOVIMIENTOS }o--|| ASIENTOS : respalda
  ACTIVOS_FIJOS ||--o{ ACTIVOS_DEPRECIACIONES : deprecia
  DTE_EMITIDOS }o--o| DOCUMENTOS : sincroniza
  USUARIO_EMPRESA ||--o{ AUDITORIA : actúa
  EMPRESAS ||--o{ AUDITORIA : registra
```

> El diagrama omite tablas CRM, portal, jobs y legacy para legibilidad; están inventariadas en `09`.

---

## 10. Dependencias entre módulos

```mermaid
flowchart TD
  SII --> DOCS
  DOCS --> CONT
  DOCS --> CONC
  CONT --> REP
  CONT --> TES
  CONT --> ACT
  CONT --> CIE
  CONC --> SALUD
  DOCS --> SALUD
  SII --> SALUD
  TGR --> SALUD
  TES --> SALUD
  REP --> SALUD
  SALUD --> INFORME
  DTE --> DOCS
  DTE --> CONT
  GEO --> CONT
  PORTAL -.comercial.-> SALUD
  CRM --> EMP
  ADM --> TODO["Todos"]
```

---

## 11. Errores, reintentos y recuperación

```mermaid
stateDiagram-v2
  [*] --> Pendiente
  Pendiente --> EnCurso
  EnCurso --> OK: respuesta válida
  EnCurso --> ErrorPaso: timeout / 401 / 409 / 424 / 5xx
  ErrorPaso --> Reintento: reintento permitido
  Reintento --> EnCurso
  ErrorPaso --> ConservaDatos: no se borra lo previo
  ConservaDatos --> InformeParcial: se emite con limitaciones
  OK --> Snapshot
  InformeParcial --> Snapshot
  Snapshot --> [*]
```

**Reglas:** un paso fallido no cancela los demás (test S2); la ficha previa se conserva; el tope de sesiones no se reintenta; el navegador ausente se detecta antes de autenticar.

---

## 12. Arquitectura funcional propuesta

```mermaid
flowchart LR
  subgraph N1["Nivel 1 · 6 áreas + 2 secundarias"]
    I["Inicio / Hoy"]
    D["Documentos"]
    C["Contabilidad"]
    T["Impuestos y Salud"]
    B["Tesorería"]
    R["Informes"]
    A["Administración"]
    P["Portal del cliente"]
  end

  I --> I1["Pendientes · obligaciones · anomalías · recientes"]

  D --> D1["Bandeja"]
  D --> D2["Libros C/V"]
  D --> D3["Importar / Sincronizar"]
  D --> D4["Clasificación y reglas"]
  D --> D5["DTE emitidos y emisión"]

  C --> C1["Asientos · diario · mayor"]
  C --> C2["Propuestas y contabilización"]
  C --> C3["Plan de cuentas · centros"]
  C --> C4["Activos fijos"]
  C --> C5["Cierre de período"]
  C --> C6["Conciliación SII vs contable"]

  T --> T1["Salud Tributaria"]
  T --> T2["F29 · PPM · IVA"]
  T --> T3["Declaraciones y obligaciones"]
  T --> T4["Deuda fiscal TGR"]

  B --> B1["Bancos y movimientos"]
  B --> B2["Cartola y conciliación"]
  B --> B3["Cobranza"]

  R --> R1["Estados financieros"]
  R --> R2["Reportes tributarios"]
  R --> R3["Exportaciones"]

  A --> A1["Empresas · usuarios · roles"]
  A --> A2["Integraciones"]
  A --> A3["Auditoría"]
  A --> A4["Suscripción"]

  P --> P1["10 vistas read-only"]
```

---

## 13. Comparación de navegación: actual vs objetivo

```mermaid
flowchart TB
  subgraph Actual
    A1["Centro de Aplicaciones"] --> A2["Dock 5 apps"]
    A1 --> A3["Menú lateral 10 secciones / 43 ítems"]
    A3 --> A4["Pestañas internas"]
    A3 --> A5["Centro de Reportes 14 atajos + 6 'no disponible'"]
    A1 --> A6["Búsqueda global"]
    A3 --> A7["Buscador del menú"]
  end

  subgraph Objetivo
    B1["Inicio / Hoy"] --> B2["6 áreas de trabajo"]
    B2 --> B3["Espacio de trabajo del módulo"]
    B3 --> B4["Subnavegación contextual"]
    B3 --> B5["Acciones primarias + filtros"]
    B3 --> B6["Reportes del módulo"]
    B7["Búsqueda global"] --> B3
    B8["Administración / Portal"] --> B2
  end

  Actual -.reducción de superficies y reubicación de ítems.-> Objetivo
```
