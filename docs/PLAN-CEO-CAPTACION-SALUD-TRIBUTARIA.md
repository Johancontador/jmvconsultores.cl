# Plan CEO: adquisición mediante informe de salud tributaria

**Estado:** propuesta estratégica, no lanzamiento aprobado
**Fecha:** 2026-10-28
**Producto:** Sistema Contable JMV / JMV Consultores
**Roadmap de producto:** `../ROADMAP.md`
**Roadmap de captación:** este documento

## Recomendación ejecutiva

Usar el informe gratuito como **diagnóstico de entrada para una conversación comercial consentida**, no como una forma de obtener claves SII o una base de datos encubierta. La promesa publicitaria debe ser un informe informativo con datos consultados al SII y limitaciones visibles, nunca una certificación, auditoría legal ni garantía de que se cubrieron cinco años completos.

No lanzar todavía una campaña de acceso anónimo con RUT y clave SII. Primero establecer titularidad y consentimiento, preservar la clave solo en el flujo autenticado existente, probar la cobertura real de las fuentes, documentar retención/eliminación y validar el texto legal con asesoría competente. La legislación chilena de protección de datos tiene cambios y fechas de vigencia que requieren revisión jurídica actual antes de producción.

## Objetivo y métrica de negocio

**Objetivo:** convertir parte de la audiencia de videos de Instagram, TikTok y Meta en empresas que solicitan un diagnóstico profesional y, cuando corresponde, contratan servicios contables/tributarios.

Medir por cohortes, no por volumen bruto de leads:

1. Visita atribuida a campaña.
2. Inicio de registro.
3. Cuenta validada.
4. Consentimiento de tratamiento para generar el informe.
5. Consulta SII iniciada y completada, con cobertura por fuente.
6. Informe exportado.
7. Solicitud voluntaria de contacto comercial.
8. Contacto atendido, diagnóstico agendado, propuesta y cliente convertido.

Indicadores: tasa de generación completa, abandono por paso, errores SII, exportaciones, contactos explícitamente solicitados, tiempo de primera respuesta, citas, propuestas, conversión a cliente, costo por oportunidad atendida y costo por cliente. No optimizar por “claves captadas”, RUT ingresados sin contexto ni descargas sin consentimiento.

## Segmento, mensaje y campaña

**Audiencia inicial:** dueños/administradores de micro y pequeñas empresas chilenas que necesitan entender su situación tributaria y no buscan reemplazar a su contador.

**Concepto del video:** “¿Sabes qué aparece de tu empresa en el SII? Revisa un resumen tributario con información consultada y sus fuentes, y conversa con un profesional si necesitas interpretarlo.”

Evitar el texto “imagina ingresar el RUT y la clave SII” en anuncios: normaliza entregar una credencial sensible desde un enlace social y puede parecer phishing. Nunca pedir claves en comentarios, DM, formularios de Meta/TikTok ni herramientas de analítica. El dominio destino debe mostrarse claramente y enlazar a políticas de privacidad y términos antes de registro.

**CTA recomendado:** “Solicita tu informe informativo de salud tributaria” → landing del dominio oficial → explicación de alcance, fuentes y privacidad → cuenta/autenticación → consentimiento para generar informe → consulta del SII → revisión de cobertura → vista previa/exportación → invitación comercial opcional separada.

## Diseño del acceso promocional de un solo uso

Un URL público idéntico no puede ser de un solo uso para cada espectador. El sitio debe emitir un token individual, aleatorio y de alta entropía al abrir la campaña; el token identifica una oportunidad promocional, no una identidad ni una empresa.

Flujo propuesto, pendiente de especificación técnica y aprobación de seguridad:

1. El visitante ve desde el enlace una página de aviso/alcance y crea o autentica una cuenta antes de introducir clave SII. No incluir RUT, clave SII, email, nombre de empresa ni identificadores directos en la URL.
2. La cuenta acredita sesión; registrar por separado el consentimiento requerido para procesar credenciales/datos con propósito, versión de texto y momento. El contacto comercial es un consentimiento opcional, desmarcado por defecto, separado del consentimiento de servicio.
3. La credencial SII solo se recibe por HTTPS en el servidor, se utiliza para la consulta y se descarta al finalizar; no persistirla en base de datos, logs, trazas, errores, analítica, grabación de sesión ni herramientas de terceros. No habilitar sincronización persistente por defecto ni asociar la clave al usuario.
4. El token cambia a “consumido” de forma atómica al comenzar un intento de generación autenticado, con ventana de reintento acotada para fallos técnicos. Política de reintento, expiración y límite por cuenta/IP debe fijarse en la especificación para evitar agotamiento malicioso y consumo accidental.
5. Almacenar el mínimo necesario: cuenta, identificador interno de corrida, estado/cobertura por fuente, expiración y consentimientos. Retener informe/exportación por plazo corto comunicado y ofrecer eliminación. No crear ficha de prospecto comercial sin consentimiento independiente.
6. Entregar informe con fecha, período real cubierto por cada fuente, fallos/limitaciones, origen de datos y aviso de que no es certificado oficial ni reemplaza asesoría profesional.
7. Al final, ofrecer: “Quiero que JMV me contacte” (checkbox opcional) y canal preferido. Sin opt-in, borrar datos identificadores/no necesarios según plazo aprobado y conservar solo métricas agregadas no reidentificables.

**Abuso y seguridad:** TLS, CSRF si el diseño lo requiere, rate limit por IP/cuenta/token, limitación de concurrencia, respuestas que no revelen si un RUT existe, expiración/revocación, protección contra bots, auditoría sin secretos, pruebas de aislamiento de empresas, pruebas de eliminación y un kill switch para pausar emisión de tokens. Revisar obligaciones de privacidad, seguridad y derechos de titulares con asesoría legal antes del lanzamiento.

## Fases y gates

### Fase 0 — No lanzar credenciales desde anuncios
- Revisar avisos, términos, flujo de registro, retención, exportación y política de incidentes con asesoría legal.
- Acordar cobertura ofrecida y textos permitidos; confirmar qué datos quedan persistidos por la ruta de Salud actual.
- No enviar datos tributarios a Pixel/Meta, TikTok Pixel, Google Analytics ni parámetros UTM.

### Fase 1 — Preparar captación orgánica y analítica mínima
- Publicar contenido educativo sin recoger claves ni datos tributarios en plataforma social.
- Definir eventos first-party, agregados y sin RUT/empresa/clave; respetar consentimiento de cookies y privacidad.
- Verificar sitemap, robots, metadata y formularios del dominio oficial.
- Establecer dashboard y responsable de responder contactos, con SLA operacional realista.

### Fase 2 — Piloto cerrado del informe
- Probar con usuarios que ya tienen cuenta y empresas de prueba autorizadas, nunca RUTs reales en fixtures.
- Medir generación, cobertura, errores, abandono, carga, exportación y eliminación.
- Reconciliar el informe frente a fuentes oficiales y revisar falsos “completo”/cero.
- Gate: ninguna credencial en persistencia/logs/telemetría; cobertura comunicada correctamente; borrado probado; apoyo legal listo.

### Fase 3 — Campaña pequeña y controlada
- Test de creatividades/mensajes primero en audiencia propia; después presupuesto piloto con límites diarios y criterios de parada.
- A/B solo sobre mensaje y CTA, nunca sobre transparencia o consentimiento.
- Detener si aumentan errores del SII, abandono por falta de confianza, incidentes de privacidad o demanda sin capacidad de atender.
- Ampliar únicamente si hay citas y clientes atribuibles, coste por oportunidad atendible aceptable y capacidad operativa.

### Fase 4 — Escalar y optimizar
- Retargeting solo con consentimiento y políticas de plataforma cumplidas; excluir datos sensibles.
- Analizar cohortes por campaña/creatividad/canal con datos agregados.
- Revalidar avisos, proveedores, retención, seguridad y legislación antes de cambiar el uso de datos.

## Analítica: eventos permitidos y prohibidos

**Permitidos (first-party, minimizados):** `campaign_landing_view`, `signup_started`, `account_created`, `report_consent_given`, `report_generation_started`, `report_generation_completed`, `report_generation_failed` con código no sensible, `report_exported`, `contact_opt_in`, `appointment_requested`. Incluir campaign/source/medium/content saneados y un identificador aleatorio rotatorio, sujeto a consentimiento aplicable.

**Prohibidos en telemetría/píxeles/URLs:** RUT, clave SII, nombre/Razón Social, email/teléfono, contraseña, HTML/PDF del informe, períodos/montos tributarios, detalle de declaraciones, cookie/session/token, payload del formulario, texto libre y mensajes de error con respuestas del SII. No cargar trackers de terceros en pantallas autenticadas o del informe.

## Roadmap de producto relacionado

`ROADMAP.md` describe fases funcionales históricas (fases 0–9 y SAAS), con entregas marcadas implementadas y pendientes de validación operativa. No es un roadmap comercial de crecimiento y contiene estados/fechas anteriores al 2026-10-28. Mantener ese archivo como historia de producto; no borrar contenido histórico en una “limpieza”. Registrar esta propuesta como roadmap de captación separado.

### Revisiones recomendadas de roadmap (no ejecutadas)
- Actualizar fecha/estado de cabecera y verificar las fases 9.2/9.3, la validación SII real y todos los “pendientes tras deploy”.
- Crear issues/dependencias para Salud Tributaria pública, privacidad/consentimientos, eliminación, seguridad, piloto, medición, SEO/Search Console y adquisición. No marcar como implementado por existir este documento.
- Evitar anunciar los cinco años como cobertura garantizada: la consulta debe exponer cobertura efectiva por fuente.

## Google Search Console: preparación, no envío

La propiedad y las credenciales de Search Console pertenecen a una cuenta externa, no disponibles en este entorno. No se ha publicado el roadmap en Google ni solicitado indexación. Para SEO, solo indexar páginas públicas aprobadas (no `/sistema/`, endpoints, reportes, registro ni páginas de tokens).

Antes de usar Search Console:
1. Verificar que la propiedad `https://jmvconsultores.cl/` está bajo control de JMV.
2. Validar `https://jmvconsultores.cl/sitemap.xml` y URLs canonicals/robots.
3. Enviar el sitemap y revisar el reporte de indexación y la inspección de URLs públicas.
4. No subir el roadmap interno como página pública ni exponer información de clientes.

Google Search Console requiere acción desde una propiedad autenticada y no garantiza indexación. Fuente oficial: [Informe de sitemaps de Search Console](https://support.google.com/webmasters/answer/7451001?hl=es) y [Inspección de URLs](https://support.google.com/webmasters/answer/9012289?hl=es).

## Riesgos y decisiones abiertas

| Riesgo/decisión | Tratamiento propuesto | Responsable/gate |
|---|---|---|
| Credenciales SII capturadas por enlace público | Bloquear el flujo anónimo; cuenta previa y descarte en memoria | Seguridad + dueño + legal |
| “Un solo uso” impide compartir anuncio a audiencia | Token por visitante, no token fijo en video | Producto/ingeniería |
| Fuentes o períodos incompletos presentados como cinco años | Etiquetar cobertura por fuente; no emitir afirmación no verificada | Responsable tributario |
| Datos de informe retenidos sin propósito comercial claro | Minimización, expiración, eliminación y opt-in separado | Privacidad/legal |
| Publicidad de servicios sin capacidad de responder leads | Piloto acotado y SLA asignado antes de pauta | Operaciones |
| Métricas con información tributaria en plataformas de ads | Prohibición técnica de payload sensible, revisar tags y network | Seguridad/marketing |
| “Subir roadmap a Google” ambiguo | Interpretado como Search Console por confirmación del usuario; preparar checklist, sin acceso a cuenta | Dueño de propiedad |

## Decisión de lanzamiento

**Estado actual: NO LISTO PARA PUBLICIDAD DE INFORME GRATUITO.** Primero validar legalmente el flujo y alcance, implementar la experiencia autenticada y el token individual, probar borrado y cobertura, y preparar la atención comercial. Esta recomendación protege la confianza que la propia campaña necesita para convertir.
