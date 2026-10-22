# Integración con Tesorería General de la República (TGR) — investigación verificada

> Fecha: 2026-10-22 · Estado: **investigado y viable, NO implementado todavía**.
> Todo lo de este documento se comprobó contra el portal real con la clave SII de
> una empresa del portafolio (empresa 1, `76312274-3`). Nada es suposición.

## 1. Qué se quiere

Saber la **deuda fiscal** de cada empresa en la TGR y, cuando se necesite, el
**certificado de deuda** oficial, usando las MISMAS credenciales que ya están en
la bóveda (RUT + clave SII). Con eso, la deuda fiscal entra al informe de salud
tributaria y a Tesorería como una obligación real (no estimada).

## 2. Lo que existe hoy (verificado)

`tesoreria.cl` ya no es un portal propio: **redirige a `tgr.gob.cl`** y los
trámites viven detrás de un SSO propio:

| Paso | URL / detalle verificado |
|---|---|
| Portal | `https://tgr.gob.cl/` (200 con navegador real; **403 con curl/UA simple** — hay WAF, se requiere navegador) |
| Trámite | `https://tgr.gob.cl/tramites-tgr/certificado-de-deuda-fiscal` |
| Login | `https://autentica.tgr.cl/oauth2/authorize-front?client_id=…&redirect_uri=https%3A%2F%2Fwww.tesoreria.cl%2FLoginPortalCognito%2F&response_type=code&providers=ClaveTesoreria,ClaveTributaria,ClaveUnica` |
| Selector de clave | botón **Clave Tributaria** = `#id-button-idp-claveTributaria` (sin texto, solo clase) |
| Login Clave Tributaria | redirige a `https://www2.sii.cl/oauthsii-v1-org/?…&redirect_uri=https%3A%2F%2Fapi.tgr.cl%2Fclave-tributaria-v2%2Fv1%2Foauth2%2Fidpresponse` con formulario `#inputRut`, `#inputPass` y botón `#bt_ingresar` |
| Resultado | sesión autenticada en `www.tesoreria.cl`; el portal muestra «Comercializadora c&e clima limitada» arriba |
| Certificado (app legado) | `https://www.tesoreria.cl/CertDeudasRutCutAixWeb/internet/begin.do?RUT=<cuerpo>&DV=<dv>` → **200**, título «Certificado de Deudas» |
| Cartola fiscal | `https://www.tesoreria.cl/CartolaFiscalInterWeb/cartolaFiscal/begin?RUT=…&DV=…` → **401 sin el token de sesión** (requiere el `vr` emitido por `LoginPortalPagosTGR12Web/redirect`) |
| Token de trámite | el iframe del trámite apunta a `https://www.tesoreria.cl/LoginPortalPagosTGR12Web/redirect?vr=<base64>`, que codifica `RUT`, `DV`, nombre y la app destino (p. ej. `/CertDeudasRutCutAixWeb/internet/begin.do`) |

### Hallazgo clave

**La clave tributaria del SII sirve tal cual**: el portal TGR delega en el OAuth
del SII (`www2.sii.cl/oauthsii-v1-org`), donde los campos son RUT + clave
tributaria. No hace falta ClaveÚnica ni una integración institucional.

El certificado se renderiza como **PDF embebido** (frames
`data:application/pdf;base64,…`), así que se puede **descargar como evidencia**
tal como hoy se guardan los snapshots del informe.

## 3. Lo que falta para cerrarlo (orden propuesto)

1. **Leer la deuda en estructura** (documento, período, monto, total). El
   certificado es un PDF, y la cartola exige el token `vr`. Dos caminos:
   - a) entrar al trámite desde `tgr.gob.cl` y leer **dentro del iframe** del
     trámite (el token es de un solo uso: navegarlo desde el frame de arriba
     devuelve «Sesión expirada», comprobado), o
   - b) guardar el PDF y extraer el texto con un lector de PDF (dependencia
     nueva) para parsear los totales.
2. **Persistencia**: tabla `deuda_tgr` (empresa, consultado_en, total, detalle
   JSON, `pdf_base64` o ruta en `data/certificados-tgr/<rut>-<fecha>.pdf`) +
   auditoría `tesoreria.tgr_consultar`.
3. **UI**: tarjeta «Deuda fiscal (TGR)» en Tesorería y un hallazgo en Salud
   Tributaria (`DEUDA_TGR`, severidad según monto y mora), con el botón
   «Descargar certificado».
4. **Automatización**: el cron diario ya refresca ficha, RCV y declaraciones;
   la TGR se sumaría con cadencia mensual (la deuda no cambia a diario) y solo
   para empresas con clave válida.

## 4. Riesgos y decisiones que requieren al dueño

- **Uso de credenciales en un tercero**: hoy la clave SII se usa para el SII.
  Usarla también en TGR es lo que el dueño pidió, pero debe quedar declarado en
  el aviso de privacidad y en el manual (el sistema actúa como el contribuyente).
- **WAF y fragilidad**: TGR bloquea clientes sin navegador y su login es un SPA;
  los selectores pueden cambiar. Igual que con el SII: fallar en voz alta
  (`TGR_SIN_NAVEGADOR`, `TGR_SESION_INVALIDA`, `TGR_TOPE`) y nunca inventar deuda.
- **No confundir** la deuda TGR (fisco) con la deuda comercial de la empresa:
  son cuentas distintas y la UI debe rotularlo.
