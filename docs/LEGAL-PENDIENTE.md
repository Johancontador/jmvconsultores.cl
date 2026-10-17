# Legal del sitio: estado y borradores

**Actualizado el 2026-10-17: las tres páginas están publicadas.**

- `/privacidad.html`, `/cookies.html` y `/terminos.html` responden 200, tienen
  canonical propio, están en el sitemap y se enlazan desde el pie de las 28
  páginas y de la 404 (lo verifica el test T18).
- Datos confirmados por el propietario y publicados: **JMV Consultores SpA**,
  **RUT 76.537.758-7** (dígito verificador validado por módulo 11), representada
  por **Johan Morales**, domicilio **Región Metropolitana, Chile**, correo de
  privacidad **privacidad@jmvconsultores.cl**.
- El RUT aparece en los tres textos legales y en el pie de las 28 páginas y de
  la 404; el test T18 falla si falta o si el módulo 11 no cuadra.
- **Correo de privacidad: aún sin buzón.** El dominio no tiene MX; hay que
  configurarlo (ver `docs/CORREO-DOMINIO.md`).

Lo que sigue son los borradores originales y el diagnóstico del sitio. **Esto
no es asesoría legal**: falta la revisión de un abogado antes de considerar los
textos definitivos.

## 1. Lo que el sitio hace hoy (medido, no supuesto)

| Hecho | Detalle |
|---|---|
| Cookies propias | **Ninguna.** El dominio no envía `Set-Cookie`. |
| Analítica / píxeles | **Ninguno.** No hay GA4, GTM, Meta Pixel, Hotjar ni Clarity. |
| Terceros que ven tu tráfico | **Cloudflare** (CDN/DNS, ve la IP), **Google Fonts** (`fonts.googleapis.com`, ve la IP al pedir las tipografías), **WhatsApp** (solo al pulsar un botón `wa.me`). |
| Formulario de contacto | En inicio y `/contacto.html` pide nombre, teléfono o correo, negocio (opcional), servicio y mensaje. **No llega a ningún servidor**: `js/main.js` arma un texto y abre WhatsApp. No se guarda nada en el sitio. Hay una trampa anti-bot oculta. |
| Páginas legales | **No existen**: `/privacidad`, `/terminos`, `/cookies` responden 404 y no hay ningún enlace legal en el pie. El rediseño del 2026-10-17 dejó el pie listo para colgarlas bajo «Información legal» en cuanto el texto esté aprobado. |
| Identificación de la empresa | El pie dice `© JMV Consultores SpA · jmvconsultores.cl`, **sin RUT ni domicilio** (no se inventan datos societarios). En `/nosotros.html` hay un aviso explícito de que esos datos están en proceso de confirmación. |

## 2. Normas que aplican

- **Ley 19.496** (protección al consumidor), art. 28: el proveedor debe
  individualizarse (nombre/razón social, RUT, domicilio) y publicar las
  condiciones de sus servicios antes de contratar.
- **Ley 19.628** (vigente hoy): tratamiento de datos personales, finalidad,
  derechos de acceso, rectificación, cancelación y oposición.
- **Ley 21.719**: reemplaza la anterior y **rige desde el 1 de diciembre de
  2026** (queda ~6 semanas). Crea la Agencia de Protección de Datos Personales,
  exige base de licitud, principio de finalidad, derechos ampliados (incluye
  portabilidad y oposición a decisiones automatizadas), deber de notificar
  brechas y multas de hasta 20.000 UTM. *Hay discusión pública sobre una posible
  postergación: confirmar la fecha antes de fijar plazos en los textos.*
- **Cookies**: Chile no exige consentimiento previo tipo GDPR, pero sí informar
  qué cookies hay. Hoy la respuesta honesta es "ninguna propia; solo las de
  terceros que ves al usar WhatsApp y las tipografías".

## 3. Datos del propietario

### Resueltos y publicados

1. **Responsable:** JMV Consultores SpA, RUT 76.537.758-7, representada por Johan
   Morales.
2. **Domicilio:** Región Metropolitana, Chile.
3. **Correo de privacidad:** `privacidad@jmvconsultores.cl` (publicado; el
   buzón se habilita con Cloudflare Email Routing, ver `docs/CORREO-DOMINIO.md`).
4. **Plazo de conservación:** 12 meses para consultas no convertidas y hasta 6
   años para datos de servicios contratados (obligación tributaria).

### Pendientes

5. **Revisión legal** de los tres textos por un abogado.
6. **Fecha de vigencia de la Ley 21.719**: confirmar si se postergó del 1 de
   diciembre de 2026 antes de fijar plazos internos.
7. **Buzón de correo:** el dominio sigue sin MX (ver `docs/CORREO-DOMINIO.md`).

## 4. Borradores

### 4.1 Política de Privacidad (`/privacidad.html`)

> **Política de Privacidad**
> Última actualización: {{fecha}}.
>
> **Quién trata tus datos.** JMV Consultores SpA, RUT {{RUT}}, domicilio
> {{domicilio}}, correo {{correo_privacidad}} (en adelante, "JMV").
>
> **Qué datos tratamos.** Los que tú nos entregas voluntariamente cuando nos
> contactas por WhatsApp, correo electrónico o el formulario del sitio: nombre,
> nombre de tu empresa o negocio, servicio de interés y el contenido de tu
> mensaje. El formulario del sitio **no guarda datos en nuestros servidores**:
> abre WhatsApp con tu mensaje y desde ahí nos llega.
>
> **Para qué los usamos.** Únicamente para responder tu consulta, elaborar una
> propuesta y, si contratas, prestar el servicio contable, tributario y de
> remuneraciones. No usamos tus datos para publicidad ni los vendemos.
>
> **Base de licitud.** Tu consentimiento al escribirnos y, si contratas, la
> ejecución del contrato.
>
> **Con quién se comparten.** Con los proveedores necesarios para operar:
> WhatsApp (mensajería), nuestro proveedor de correo y de infraestructura
> ({{proveedor_infra}}: alojamiento y CDN), y el Servicio de Impuestos Internos
> cuando la ley lo exige para tus declaraciones. No transferimos datos a otros
> terceros sin tu autorización.
>
> **Cuánto tiempo.** {{plazo_conservacion}}.
>
> **Tus derechos.** Puedes solicitar acceso, rectificación, cancelación y
> oposición (y, desde el 1 de diciembre de 2026, portabilidad y los demás
> derechos de la Ley 21.719) escribiendo a {{correo_privacidad}}. Responderemos
> dentro de los plazos legales.
>
> **Seguridad.** Aplicamos medidas técnicas y organizativas razonables:
> cifrado en tránsito (HTTPS), acceso restringido a la información de clientes y
> respaldos. Si ocurre una brecha que te afecte, te informaremos.
>
> **Cambios.** Publicaremos cualquier cambio en esta misma página.

### 4.2 Política de Cookies (`/cookies.html`)

> **Política de Cookies**
> Última actualización: {{fecha}}.
>
> Este sitio **no usa cookies propias** de navegación, publicidad ni analítica, y
> no incorpora herramientas de medición de terceros.
>
> Pueden intervenir cookies o almacenamiento de terceros solo en estos casos:
>
> - **Cloudflare** (red de entrega de contenido): puede usar cookies técnicas de
>   seguridad para filtrar tráfico abusivo.
> - **Google Fonts**: al cargar las tipografías, Google recibe la dirección IP
>   desde la que navegas.
> - **WhatsApp**: solo si pulsas un botón de contacto; desde ahí aplican las
>   políticas de Meta.
>
> Si más adelante incorporamos analítica, actualizaremos esta página con el
> detalle de cada cookie y su finalidad antes de activarla.
>
> Puedes bloquear o eliminar cookies desde la configuración de tu navegador; el
> sitio seguirá funcionando.

### 4.3 Términos y Condiciones (`/terminos.html`)

> **Términos y Condiciones de uso del sitio**
> Última actualización: {{fecha}}.
>
> **Identificación.** Sitio de JMV Consultores SpA, RUT {{RUT}}, domicilio
> {{domicilio}}, correo contacto@jmvconsultores.cl.
>
> **Objeto.** Este sitio entrega información sobre servicios de contabilidad,
> remuneraciones, asesoría tributaria y prevención de riesgos, y permite
> contactarnos. La información publicada es de carácter general y **no
> constituye asesoría tributaria para tu caso particular**.
>
> **Propuestas y contratación.** Los precios y alcances se acuerdan por escrito
> con cada cliente; la información del sitio no es una oferta vinculante.
>
> **Uso del acceso de clientes.** El acceso a `app.jmvconsultores.cl` es
> personal: cada usuario es responsable de la confidencialidad de sus
> credenciales y de la exactitud de la información que ingresa.
>
> **Propiedad intelectual.** Los contenidos, marca y diseño son de JMV
> Consultores SpA.
>
> **Responsabilidad.** JMV responde por la prestación del servicio contratado,
> con la diligencia propia de su actividad. No responde por decisiones tomadas
> sobre la base de la información general del sitio.
>
> **Ley aplicable.** Legislación chilena; tribunales de {{ciudad}}.

## 5. Pie de página

Hecho. El pie muestra `JMV Consultores SpA · Johan Morales · Región
Metropolitana, Chile` y una columna «Información legal» con las tres páginas.
La 404 también lo lleva.

## 6. Si cambia el RUT o la razón social

El RUT vive en cinco lugares y el test T18 exige que el pie lo lleve:

1. `privacidad.html`, `cookies.html` y `terminos.html` (frase de
   identificación).
2. `nosotros.html` (aviso de transparencia).
3. `deploy/actualizar-chrome.py`, función `footer_html` (pie de las 29 páginas).

Después: `python3 deploy/actualizar-chrome.py`, `python3 deploy/versionar.py`
y `node --test tests/sitio.test.mjs`.
