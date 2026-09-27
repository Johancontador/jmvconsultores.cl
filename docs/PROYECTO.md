# 📋 Documentación del proyecto — JMV Consultores

> **Memoria de sesión para cualquier agente o persona que retome este proyecto.**
> Última actualización: 27-sep-2026

---

## 1. Estado actual

| Componente | Estado |
|---|---|
| Sitio (landing + 7 servicios + FAQ) | ✅ Publicado en GitHub Pages |
| Repo | `github.com/Johancontador/jmvconsultores.cl` (rama `main`) |
| Dominio `jmvconsultores.cl` | ⏳ **Pendiente de renovar en NIC Chile (vence 02/03-oct-2026)** |
| Nameservers Cloudflare | Asignados: `ethan` / `tessa.ns.cloudflare.com` (activar tras renovar) |
| Túnel Cloudflare | Activo en la PC local como estaging (`pc.jmvconsultores.cl` cuando el DNS esté activo) |
| Git | SSH configurado con clave ed25519 (push funciona sin pasos extra) |
| Servidor local (Linux Mint) | nginx :8080 (copia) + servicios usuario `jmv-www` (puerto 8000, archivos vivos) y `jmv-share` (túnel) |

**Enlaces:**
- Permanente: https://johancontador.github.io/jmvconsultores.cl/
- Demo temporal (trycloudflare, requiere PC encendida): se regenera con `bash deploy/share-link.sh`
- Definitivo (cuando el dominio esté activo): https://jmvconsultores.cl

---

## 2. Estructura del sitio

```
index.html                     → Landing de un solo objetivo (7 servicios clicables)
contabilidad-completa.html     → 50 servicios
remuneraciones.html            → 65 servicios (incluye leyes: Papito Corazón, Karin, 21.735…)
acompanamiento-contable.html   → 50 servicios
asesoria-tributaria.html       → 50 servicios
emprendedores-pymes.html       → 50 servicios
respaldo-confidencialidad.html → 50 servicios
prevencion-riesgos.html        → 50 servicios (RIOHS, PTS, MIPER, D.S. 44/594/76, EPP…)
preguntas-frecuentes.html      → 350 Q&A (28 destacadas + buscador + 7 bloques) — GENERADA
data/faq_*.py                   → ⚙️ DATOS de las 350 FAQ (50 por servicio, editables)
gen_faq_central.py             → ⚙️ genera preguntas-frecuentes.html desde data/
robots.txt · sitemap.xml       → SEO técnico (8 URLs)
gen_servicios.py               → ⚙️ GENERADOR: edita las listas y corre `python3 gen_servicios.py`
css/styles.css · js/main.js · js/bg3d.js · assets/
deploy/setup-tunnel.sh         → instalación nginx + cloudflared + túnel (token)
deploy/share-link.sh           → enlace temporal trycloudflare (systemd --user)
```

**Reglas de diseño vigentes (del dueño):**
1. Un solo objetivo por página (sin menús de navegación ni enlaces distractores).
2. Mobile-first estricto (inputs 16px, targets táctiles ≥44px).
3. Velocidad extrema (fuentes async, scripts defer, canvas pausado si la pestaña está oculta).
4. Jerarquía visual en Z (un solo CTA primario por vista).
5. **PROHIBIDO usar iconos o emojis** — diseño 100% tipográfico (números editoriales, gradiente, color).

---

## 2b. Sistema FAQ (350 preguntas, creado 27-sep-2026)

- **50 FAQ por servicio** en `data/faq_*.py` (7 archivos). Editar ahí y regenerar:
  `python3 gen_servicios.py && python3 gen_faq_central.py`
- **Cada página de servicio** muestra sus 50 FAQ en acordeón numerado + badge "50 preguntas respondidas".
- **FAQ central**: buscador en vivo (filtra por texto), portada de 28 destacadas + bloques por servicio.
- **Home**: 6 tarjetas FAQ persuasivas (F22, finiquito, Papito Corazón, devolución Renta, prevención, Instagram) + CTA a FAQ central.
- **Schema JSON-LD**: máx. 25 preguntas por página de servicio; 350 en la FAQ central (límite práctico de Google respetado).
- **Respuesta F22 verificada legalmente**: art. 97 N°6 CT (1 UTA / 10%+2% mensual tope 30% + cobranza Tesorería).

## 3. Auditoría legal de remuneraciones (27-sep-2026)

Leyes incorporadas a `remuneraciones.html` en esta sesión:

| Ley / norma | Qué toca | Estado |
|---|---|---|
| **Ley 21.478 "Papito Corazón"** | Descuento hasta 50% de capítulos 3 y 4 para deudas de alimentos, con orden judicial | ✅ Servicio + FAQ |
| **Ley 21.389 / retiros 10% AFP** | Impacto en finiquitos (rebaja hasta 50% con cargo al seguro de cesantía) | ✅ Servicio + FAQ |
| **Ley 21.643 "Karin"** | Protocolo de acoso laboral y sexual (obligatoria desde ago-2024) | ✅ Servicio en 02 y 07 + FAQ |
| **Ley 21.611 / 21.561** | Jornada 44 horas (transición a 2028) y ajustes de jornada | ✅ Servicios (corregida cita errónea de 21.561) |
| **Ley 21.735 (reforma previsional 2025)** | Aporte del empleador 8,6% y Seguro Social, transición 2025-2032 | ✅ Servicio + FAQ |
| **Ley 20.823 (feriado)** | Compensación de feriado proporcional en finiquitos | ✅ Servicio |
| **Ley 20.123 / SIC** | Subcontratación y suministro (control de pagos) | ⏳ Candidato a agregar |
| **Art. 58 y 163 CT** | Descuentos judiciales e indemnizaciones | ✅ Servicios + FAQ |
| **Art. 174 CT / 13,5 UTA** | Tributación de finiquitos y devolución Operación Renta | ✅ Servicio + FAQ |
| **Sala cuna universal (2026)** | Extensión del beneficio a toda trabajadora | ✅ Servicio + FAQ |

**Pendientes sugeridos (no bloqueantes):** Ley 21.269 (propinas electrónicas — ya está en Contabilidad 01), cotización diferenciada jóvenes (art. 22 CT), SENCE fruíble como sueldo (ahí está "Crédito SENCE" en 01).

---

## 4. Plan Google Ads (preparado, pendiente de comprar dominio)

### 4.1 Lo que ya quedó listo en el sitio
- **Páginas de aterrizaje dedicadas por servicio** → cada campaña puede apuntar a su URL específica (Calidad de destino alta → CPC menor).
- **Esquema FAQPage + ProfessionalService (JSON-LD)** en index y las 7 páginas → mayor superficie en resultados orgánicos (rich snippets).
- **CTA único por página + WhatsApp directo con mensaje precargado** → mejor conversión post-clic.
- **Meta titles/descriptions persuasivos por página** → mejor CTR también en anuncios.
- **Sitemap + robots** → indexación limpia para el Quality Score.

### 4.2 Pasos cuando el dominio esté activo
1. **Google Search Console**: verificar `jmvconsultores.cl`, enviar `sitemap.xml`, pedir indexación de las 8 URLs.
2. **Google Business Profile**: crear perfil con categoría "Contador", vincular al sitio (clave para SEO local + Ads).
3. **Google Ads — estructura sugerida**:
   - Campaña 1 "Contabilidad" → grupo "declaración F29", "contador para pymes", "contabilidad online chile" → destino `contabilidad-completa.html`
   - Campaña 2 "Remuneraciones" → "liquidaciones de sueldo", "finiquito calculo", "book remuneraciones" → destino `remuneraciones.html`
   - Campaña 3 "Tributario" (estacional: marzo-abril) → "operación renta", "devolución renta chile" → `asesoria-tributaria.html`
   - Campaña 4 "Prevención" → "asesor prevención de riesgos", "DS 44", "carpeta homologación" → `prevencion-riesgos.html`
   - Extensión de llamada + extensión de WhatsApp + extensión de sitio (7 servicios).
4. **Conversiones a medir**: clic en WhatsApp (cualquier `wa.me`), envío del formulario, clic en "Consulta gratis".
5. **Presupuesto inicial sugerido**: CLP 30.000–50.000/mes en campaña "Contabilidad" + "Remuneraciones" (mayor intención comercial).

### 4.3 Sobre el "skill secreta" de posicionamiento
No hay truco secreto: lo que posiciona (orgánico y Ads) es **relevancia + experiencia + datos estructurados**. Ya está aplicado lo máximo efectivo:
- FAQ reales con schema (Google las muestra desplegadas → más espacio en pantalla).
- Contenido por intención de búsqueda (cada servicio = una intención).
- Velocidad y mobile-first (Core Web Vitals afectan el Quality Score de Ads).
- **Siguiente palanca real**: crear 2–4 artículos de blog por mes respondiendo búsquedas concretas ("cómo calcular un finiquito 2026", "qué es el MIPER"). Si quieres, lo montamos como sección `/blog/` con el mismo generador.

---

## 5. Seguridad — checklist verificado (27-sep-2026)

- [x] Sin formularios que envíen datos a servidores de terceros (todo sale por WhatsApp del usuario).
- [x] Enlaces externos con `rel="noopener"` (WhatsApp).
- [x] Sin APIs ni claves expuestas en el código (no hay).
- [x] `rel="canonical"` en todas las páginas (evita duplicados).
- [x] Túnel con token guardado solo en `/etc/cloudflared/` del servidor (nunca en el repo).
- [x] Repo sin credenciales: el push es por SSH local, no hay tokens en archivos.
- [x] `X-Frame-Options` / headers: pendiente de configurar en nginx cuando el dominio esté activo (ver abajo).
- [x] Logo clicable a home en las 8 páginas (corregido en esta sesión).

**Pendiente al activar el dominio (agregar a `deploy/setup-tunnel.sh`):**
```nginx
add_header X-Frame-Options "SAMEORIGIN";
add_header X-Content-Type-Options "nosniff";
add_header Referrer-Policy "strict-origin-when-cross-origin";
```

---

## 6. Roadmap competitivo (próximas sesiones)

| # | Mejora | Impacto | Esfuerzo |
|---|---|---|---|
| 1 | Activar dominio (renovar NIC + DNS + Enforce HTTPS en Pages) | 🔥 Crítico | 1 sesión |
| 2 | Blog `/blog/` con generador (2-4 artículos/mes por intención de búsqueda) | 🔥 Alto SEO | Medio |
| 3 | Página "Casos de éxito" (2-3 relatos anónimos con números) | Alto (confianza) | Bajo |
| 4 | Botón "Agendar videollamada" (Calendly gratis o Cal.com) | Medio (conversión) | Bajo |
| 5 | Versión PDF descargable "Guía del finiquito 2026" como lead magnet | Medio-alto | Medio |
| 6 | Email transaccional con dominio propio (Cloudflare Email Routing, gratis) | Medio | Bajo |
| 7 | Analytics (GA4 o Plausible) antes de activar Ads (medir todo desde el día 1) | 🔥 Necesario para Ads | Bajo |
| 8 | Google Business Profile + reseñas de clientes | Alto SEO local | Bajo |
| 9 | Enlaces cruzados entre servicios relacionados (ya implementado en las 7 páginas) | ✅ Hecho | — |
| 10 | Testimonios en video (WhatsApp grabado) para Ads | Alto | Alto |

---

## 7. Comandos rápidos de esta máquina

```bash
# Regenerar páginas de servicio tras editar gen_servicios.py
python3 gen_servicios.py && git add -A && git commit -m "..." && git push

# Enlace temporal para compartir (túnel + servidor, systemd --user)
bash deploy/share-link.sh          # crear
bash deploy/share-link.sh url      # ver URL actual
bash deploy/share-link.sh stop     # detener

# Publicar cambios en el servidor local (nginx, requiere sudo)
sudo cp -r index.html css js assets *.html /var/www/jmvconsultores.cl/
```

---

## 8. Pendientes críticos (no olvidar)

1. ⏳ **Renovar dominio en NIC Chile ANTES del 02/03-oct-2026** — sin esto no hay dominio, ni Ads, ni correo propio.
2. Tras renovar: nameservers en NIC → Cloudflare → DNS (CNAME `@` y `www` a `Johancontador.github.io`, CNAME `pc` al túnel).
3. GitHub Pages → Custom domain → `jmvconsultores.cl` → Enforce HTTPS.
4. Verificar sitio en el dominio real, agregar headers de seguridad a nginx.
5. Activar Google Search Console + Google Business Profile.
6. Recién entonces: abrir cuenta Google Ads con la estructura del punto 4.2.
