# PRD — IVA Mensual

## Qué es
App web interna para uso personal de un contador chileno. Permite consultar el RCV del SII
de múltiples clientes y generar automáticamente el resumen mensual de IVA listo para
enviar por WhatsApp a cada uno.

## Problema que resuelve
Hoy el contador entra manualmente al SII por cada cliente, saca las cifras de compras y
ventas, calcula el IVA determinado y el PPM, y redacta un mensaje por WhatsApp. Con 12
clientes eso toma 30-40 minutos cada mes. Esta app lo hace en un clic.

## Usuario
Un solo usuario: el contador (Johan). App local, sin login, sin multiusuario.

## Funcionalidades core

### 1. Gestión de clientes
- Listar todos los clientes
- Agregar cliente (RUT, nombre empresa, clave SII, tasa PPM, teléfono, exento S/N)
- Editar cliente
- Eliminar cliente
- Los datos persisten en SQLite

### 2. Proceso mensual
- Seleccionar período (mes + año)
- Botón "Generar todo" → consulta RCV de todos los clientes en secuencia
- Barra de progreso visible mientras consulta
- Si un cliente falla (clave incorrecta, SII caído) muestra error y continúa con el siguiente

### 3. Resultados
- Card por cada cliente con:
  - Nombre empresa y RUT
  - Compras del mes: Neto / IVA / Total
  - Ventas del mes: Neto / IVA / Total
  - Impuesto determinado: Débito - Crédito = IVA a pagar
  - PPM: tasa × ventas netas
  - Total a pagar F29
  - Badge especial si cliente es EXENTO (no calcula IVA)
- Texto WhatsApp prellenado (colapsado, expandible)
- Botón "Enviar WhatsApp" → abre wa.me con mensaje prellenado
- Botón "Copiar texto" como alternativa

### 4. Texto WhatsApp generado
```
Hola [Nombre Empresa] 👋

A continuación le envío información correspondiente a la declaración de IVA del período [MM-YYYY]:

📦 COMPRAS DEL MES
  Neto:    $X.XXX.XXX
  IVA:     $X.XXX.XXX
  Total:   $X.XXX.XXX

🧾 VENTAS DEL MES
  Neto:    $X.XXX.XXX
  IVA:     $X.XXX.XXX
  Total:   $X.XXX.XXX

📊 IMPUESTO DETERMINADO
  Débito fiscal:    $X.XXX.XXX
  Crédito fiscal:  -$X.XXX.XXX
  IVA a pagar:      $X.XXX.XXX

💼 PPM ([X]%)
  Monto PPM:        $X.XXX.XXX

💰 TOTAL A PAGAR F29: $X.XXX.XXX

Saludos,
[Nombre contador]
```

## Restricciones
- Solo funciona con clientes afectos a IVA (19%) y un cliente exento
- No consulta el F29 automáticamente — PPM se ingresa manualmente por cliente
- Plan gratuito SimpleAPI: 30 consultas/mes (2 por cliente × 12 clientes = 24 consultas)
- App local — accesible via IP del servidor Ubuntu o Tailscale

## Métricas de éxito
- Generar resúmenes de 12 clientes en menos de 3 minutos
- Cero errores de cálculo en IVA determinado y PPM
- Texto WhatsApp listo para enviar sin edición manual
