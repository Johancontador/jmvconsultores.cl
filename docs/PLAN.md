# PLAN DE IMPLEMENTACIÓN — IVA Mensual

## Fase 1 — Estructura base y BD
**Objetivo:** Proyecto corriendo localmente con SQLite inicializado.

Tareas:
1. Crear estructura de carpetas según TRD
2. Inicializar package.json con dependencias:
   - express
   - better-sqlite3
   - dotenv
   - node-fetch (si Node < 18)
3. Crear backend/db.js con inicialización de tablas (clientes + procesos)
4. Crear backend/index.js con Express básico sirviendo frontend estático
5. Crear .env.example y .env local
6. Verificar que `node backend/index.js` levanta sin errores en puerto 3500

--- DETENTE — confirmar que el servidor levanta antes de continuar ---

## Fase 2 — CRUD Clientes (backend)
**Objetivo:** API REST de clientes funcionando.

Tareas:
1. Crear backend/routes/clientes.js con los 4 endpoints (GET/POST/PUT/DELETE)
2. Incluir validación de RUT chileno en POST
3. Nunca devolver clave_sii al frontend
4. Soft delete (activo = 0)
5. Probar con curl o Postman:
   - POST /api/clientes (crear)
   - GET /api/clientes (listar)
   - PUT /api/clientes/1 (editar)
   - DELETE /api/clientes/1 (eliminar)

--- DETENTE — confirmar que los 4 endpoints responden correctamente ---

## Fase 3 — Frontend Clientes
**Objetivo:** Pantalla de clientes funcional con diseño oscuro sofisticado.

Tareas:
1. Crear frontend/css/app.css con variables de color y estilos base (ver UI-UX.md)
2. Crear frontend/index.html con:
   - Navbar con links Clientes / Proceso
   - Lista de clientes con cards
   - Botones editar/eliminar por cliente
   - Badge EXENTO cuando corresponde
3. Crear frontend/js/clientes.js con:
   - Carga inicial de clientes (fetch GET /api/clientes)
   - Modal agregar/editar con validación RUT en frontend
   - Confirmación antes de eliminar
4. Verificar en navegador: http://localhost:3500

--- DETENTE — confirmar que la pantalla se ve bien y el CRUD funciona desde el navegador ---

## Fase 4 — Servicio de conexión directa al SII
**Objetivo:** Consulta real al SII funcionando (sin intermediario pagado).

Tareas:
0. Confirmar con Johan las rutas exactas (login, semilla/token si aplica,
   endpoint de detalle de compras/ventas por período) — son las que usa hoy
   manualmente en sii.cl para descargar el RCV
1. Crear backend/services/sii.js con:
   - Función login(rut, clave) → cookie de sesión, con manejo de sesión inválida/expirada
   - Función consultarRCV(rut, clave, tipo, periodo) que reutiliza la sesión
   - Manejo de errores (clave incorrecta, sesión rechazada, SII caído, timeout)
   - Sleep de 1200ms entre consultas
2. Crear backend/services/calculos.js con:
   - sumarDocumentos(docs) → { neto, iva, total }
   - calcularIVA(ventasIva, comprasIva) → iva_pagar
   - calcularPPM(ventasNeto, tasa) → ppm_monto
   - calcularTotalF29(ivaPagar, ppmMonto) → total
3. Probar con 1 cliente real (rut + clave_sii reales) antes de continuar — este es
   el "test de conexión" que confirma si, una vez conectados, se pueden emitir reportes

--- DETENTE — confirmar que la consulta al SII devuelve datos reales ---

## Fase 5 — Proceso mensual (backend)
**Objetivo:** Endpoint que procesa todos los clientes y guarda resultados.

Tareas:
1. Crear backend/routes/proceso.js con:
   - POST /api/proceso/generar (lanza proceso en background)
   - GET /api/proceso/:proceso_id/estado (polling)
   - POST /api/proceso/reintentar/:cliente_id
2. El proceso corre asíncrono: no bloquea la respuesta HTTP
3. Guarda progreso en memoria (Map) + resultados en SQLite tabla procesos
4. Manejar cliente exento (skip cálculo IVA y PPM)

--- DETENTE — confirmar que el proceso corre y guarda resultados en BD ---

## Fase 6 — Frontend Proceso
**Objetivo:** Pantalla de proceso completa con resultados y WhatsApp.

Tareas:
1. Crear frontend/proceso.html con:
   - Selector mes + año
   - Botón "Generar todo"
   - Barra de progreso con polling cada 2s
   - Cards de resultado por cliente
2. Crear frontend/js/proceso.js con:
   - Lanzar proceso → polling → renderizar cards
   - Función generarMensajeWhatsApp(cliente, datos, periodo)
   - Botón copiar (navigator.clipboard)
   - Botón WhatsApp (window.open con wa.me)
3. Cards con diseño según UI-UX.md:
   - Border izquierdo color según estado
   - Total F29 destacado
   - Texto mensaje colapsable

--- DETENTE — confirmar que el flujo completo funciona de punta a punta ---

## Fase 7 — Docker y deploy
**Objetivo:** App corriendo en servidor Ubuntu en puerto 3500.

Tareas:
1. Crear Dockerfile:
   ```dockerfile
   FROM node:20-alpine
   WORKDIR /app
   COPY package*.json ./
   RUN npm ci --only=production
   COPY . .
   RUN mkdir -p /app/data
   EXPOSE 3500
   CMD ["node", "backend/index.js"]
   ```
2. Crear docker-compose.yml con volumen para /app/data (SQLite persiste)
3. Crear .gitignore (excluir .env, data/, node_modules/)
4. Subir al servidor:
   ```bash
   scp -i C:\Users\JohanMorales\.ssh\id_geodaniela -r ./iva-mensual johan@100.116.109.54:/opt/
   ssh -i C:\Users\JohanMorales\.ssh\id_geodaniela johan@100.116.109.54
   cd /opt/iva-mensual
   cp .env.example .env
   # Editar .env con SIMPLEAPI_KEY y NOMBRE_CONTADOR
   docker-compose up -d
   ```
5. Verificar: http://100.116.109.54:3500

--- DETENTE — confirmar que la app corre en el servidor ---

## Dependencias package.json

```json
{
  "name": "iva-mensual",
  "version": "1.0.0",
  "description": "Consulta RCV SII y genera resúmenes IVA para WhatsApp",
  "main": "backend/index.js",
  "scripts": {
    "start": "node backend/index.js",
    "dev": "node --watch backend/index.js"
  },
  "dependencies": {
    "better-sqlite3": "^9.4.3",
    "dotenv": "^16.4.5",
    "express": "^4.18.3"
  }
}
```

## .env.example

```
RCV_PROVIDER=sii
PORT=3500
DB_PATH=./data/iva_mensual.db
NOMBRE_CONTADOR=Johan Morales
```
(Actualizado: ya no se usa SimpleAPI, ver TRD.md sección "Nota sobre el cambio de proveedor")
