# 🌐 jmvconsultores.cl

Sitio web oficial de **JMV Consultores** — Contabilidad y Remuneraciones.
Construido con HTML + CSS + JS puro. Sin frameworks, sin build, sin dependencias.

---

## 📁 Estructura

```
├── index.html          → Página principal (todo el contenido)
├── css/styles.css      → Estilos y diseño
├── js/main.js          → Interactividad + CONFIG de datos
├── assets/favicon.svg  → Ícono de la pestaña
└── README.md
```

---

## ✏️ PASO 1 — Personalizar con tus datos reales

### 1.1 Número de WhatsApp y correo (¡el más importante!)

Abre `js/main.js` y edita las primeras líneas:

```js
const CONFIG = {
  whatsapp: "56912345678",        // Tu número: 56 + 9 + número, sin + ni espacios
  email: "contacto@jmvconsultores.cl",
};
```

> Con esto se actualizan automáticamente el botón flotante, la tarjeta de contacto
> y el formulario (que envía el mensaje directo a tu WhatsApp).

### 1.2 Razón social y RUT (legal en Chile)

Abre `index.html`, busca `razonSocial` y completa:

```html
<p class="footer__legal" id="razonSocial">Razón social: TU RAZÓN SOCIAL SPA · RUT: 12.345.678-9</p>
```

### 1.3 Zona de atención (opcional)

En `index.html` busca `zonaText` y cambia el texto si atiendes presencialmente en alguna ciudad.

### 1.4 Textos

Todos los textos están en `index.html` directamente — puedes editarlos con cualquier editor.
Los placeholders marcados con `[COMPLETAR ...]` son los únicos pendientes.

---

## 🧪 PASO 2 — Probar localmente

```bash
# Opción A: abrir index.html con doble clic en tu navegador
# Opción B (mejor, con servidor local):
python3 -m http.server 8000
# → visita http://localhost:8000
```

---

## 🐙 PASO 3 — Subir a GitHub

```bash
git init
git add .
git commit -m "Sitio inicial JMV Consultores"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/jmvconsultores.cl.git
git push -u origin main
```

> Crea primero el repositorio vacío `jmvconsultores.cl` en github.com (sin README inicial).

---

## ☁️ PASO 4 — Cloudflare (DNS + SSL + correo)

### 4.1 Mover el dominio a Cloudflare

1. Entra a [dash.cloudflare.com](https://dash.cloudflare.com) → **Add a site** → escribe `jmvconsultores.cl`
2. Elige el plan **Free**
3. Cloudflare detecta tus registros DNS actuales → confirma
4. Cloudflare te dará **2 nameservers** (ej: `ana.ns.cloudflare.com`, `bob.ns.cloudflare.com`)
5. Ve a tu registrador del dominio `.cl` (Nic Chile) → cambia los nameservers por los de Cloudflare
6. Espera la propagación (de minutos a 24h)
7. En Cloudflare → **SSL/TLS** → modo **Full (strict)** si tu servidor tiene certificado, o **Flexible** si aún no (recomendado instalar luego certificado de origen)

### 4.2 Registros DNS recomendados (en Cloudflare → DNS)

| Tipo  | Nombre | Contenido                | Proxy (nube) |
|-------|--------|--------------------------|--------------|
| A     | `@`    | IP pública de tu servidor | 🟠 Activado  |
| A     | `www`  | IP pública de tu servidor | 🟠 Activado  |
| MX    | `@`    | según tu proveedor de correo | —         |

> Con la nube naranja activada, Cloudflare entrega **HTTPS gratis** y oculta la IP de tu servidor.

### 4.3 Correo con tu dominio

Opciones (elige una):
- **Cloudflare Email Routing (gratis)**: reenvía `contacto@jmvconsultores.cl` a tu Gmail/Outlook personal. Ideal para empezar.
- **Zoho Mail / Google Workspace**: buzón propio completo.

En Cloudflare: **Email → Email Routing → Create address** → `contacto@` → tu correo real.

---

## 🖥️ PASO 5 — Publicar en tu servidor web

Sube los archivos a la raíz pública de tu servidor:

```bash
# Desde tu computadora (reemplaza usuario, IP y ruta según tu servidor)
scp -r index.html css js assets usuario@TU_IP:/var/www/jmvconsultores.cl/
```

En el servidor, configura el VirtualHost (Nginx ejemplo):

```nginx
server {
    listen 80;
    server_name jmvconsultores.cl www.jmvconsultores.cl;
    root /var/www/jmvconsultores.cl;
    index index.html;
}
```

Luego instala el **certificado de origen** de Cloudflare o certificado con certbot, y
cambia SSL/TLS en Cloudflare a **Full (strict)**.

> Verifica que `usuario:grupo` y permisos de la carpeta permitan lectura al servidor web.

---

## ✅ Checklist final

- [ ] Número de WhatsApp real en `js/main.js`
- [ ] Razón social y RUT en el footer
- [ ] Sitio probado en celular (Chrome → F12 → modo móvil)
- [ ] Repositorio en GitHub
- [ ] Nameservers cambiados a Cloudflare
- [ ] DNS apuntando a la IP del servidor
- [ ] HTTPS funcionando (candado en el navegador)
- [ ] Correo `contacto@jmvconsultores.cl` recibiendo
- [ ] Probar el formulario → debe abrir WhatsApp con el mensaje

---

## 📈 Mejoras futuras sugeridas

- Google Analytics 4 o Plausible para estadísticas
- Sección de testimonios de clientes
- Blog de noticias tributarias (excelente para SEO)
- Google Business Profile vinculado al dominio
