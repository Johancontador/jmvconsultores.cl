# Correo del dominio: estado y cómo habilitarlo

Estado medido el 2026-10-17.

## El problema

`jmvconsultores.cl` **no tiene registros MX**. Eso significa que hoy ninguna
dirección `@jmvconsultores.cl` puede recibir correo:

- `contacto@jmvconsultores.cl` aparece en el pie de las 28 páginas y en los
  textos legales, pero un mensaje enviado ahí rebota.
- `privacidad@jmvconsultores.cl`, que ahora está publicado en la Política de
  Privacidad, tampoco existe todavía.

Verificación:

```bash
dig +short MX jmvconsultores.cl        # vacío
dig +short TXT jmvconsultores.cl       # sin SPF
```

(Diagnóstico hecho con `nslookup -type=MX` y `-type=TXT`: ambas consultas
devolvieron el SOA del dominio, que es lo que responde un servidor cuando no hay
registros del tipo pedido. Los nombres de servidor son de Cloudflare:
`ethan.ns.cloudflare.com`, `weston.ns.cloudflare.com`.)

## La solución más rápida y sin costo: Cloudflare Email Routing

El DNS del dominio ya está en Cloudflare, así que el reenvío se configura en el
mismo panel donde están los registros. No requiere contratar buzón ni cambiar
de proveedor.

1. Entrar a <https://dash.cloudflare.com> con la cuenta que administra el
   dominio y elegir `jmvconsultores.cl`.
2. Menú **Email → Email Routing**. Cloudflare agrega automáticamente los MX
   (`route1.mx.cloudflare.net`, `route2…`, `route3…`) y el SPF
   (`v=spf1 include:_spf.mx.cloudflare.net ~all`). Aceptar los registros
   sugeridos.
3. En **Destination addresses**, agregar el buzón real donde quieres leer el
   correo (por ejemplo tu Gmail) y confirmarlo desde el enlace que llega a esa
   casilla.
4. En **Custom addresses**, crear dos direcciones:
   - `contacto@jmvconsultores.cl` → tu buzón.
   - `privacidad@jmvconsultores.cl` → el mismo u otro buzón.
5. Verificar desde otra casilla: enviar a `privacidad@jmvconsultores.cl` y
   confirmar que llega.

> Cloudflare Email Routing **recibe y reenvía**; para *responder* como
> `privacidad@jmvconsultores.cl` hay que agregar esa dirección como «enviar
> como» en el cliente de correo (Gmail lo permite con un servidor SMTP de
> salida). Mientras no se configure, responder desde tu casilla personal es
> aceptable, pero conviene decirlo en el texto de la respuesta.

## Alternativa si se quiere buzón propio

Contratar correo con el dominio (Google Workspace, Zoho Mail, Fastmail) e
importar los MX que entregue el proveedor. Es la vía correcta si más adelante
varias personas necesitan cuentas `@jmvconsultores.cl`, pero para dos
direcciones de contacto el reenvío de Cloudflare alcanza.

## Qué cambia en el sitio cuando existan

Nada: las direcciones ya están publicadas y enlazadas. Si cambia el buzón de
destino, solo se actualiza en Cloudflare. Si se decide usar otra dirección para
privacidad, hay que cambiarla en tres archivos (`privacidad.html`,
`terminos.html`, `cookies.html`) y en el pie (`deploy/actualizar-chrome.py`,
función `footer_html`).

## Mientras no esté configurado

- El canal que sí funciona hoy es **WhatsApp +56 9 7575 2213**.
- Si alguien escribe a `contacto@`, el mensaje rebota y se pierde: es la razón
  para configurar esto antes de cualquier campaña.
