# Roadmap de captación y analítica — JMV Consultores

**Fecha de revisión:** 2026-10-28
**Estado:** propuesta; no hay campaña lanzada ni configuración externa cambiada.
**Estrategia y gates:** [`PLAN-CEO-CAPTACION-SALUD-TRIBUTARIA.md`](PLAN-CEO-CAPTACION-SALUD-TRIBUTARIA.md)
**Registro de fase:** uno de los seis documentos de la fase documental D1 (28-10-2026), corregida en D2 (29-10-2026); el inventario completo vive en `CURRENT_STATE.md` §11 (D2 añadió este archivo al registro, que antes omitía este documento).

## Estado del producto y del roadmap existente

`../ROADMAP.md` es la hoja histórica de construcción del software. Sus fases 0–8 aparecen completadas, fase 9 sigue abierta y SAAS-1/2/3 aparecen implementadas, pero el documento conserva hitos, pendientes de validación real y fechas antiguas. No se asumió que lo implementado en pruebas equivale a validación actual en producción. No se eliminó documentación histórica.

## Secuencia propuesta

| Orden | Entrega | Criterio de salida | Estado |
|---|---|---|---|
| 1 | Actualizar auditoría del roadmap técnico | Verificar cada pendiente contra código/tests y evidencia reciente de producción; separar “implementado”, “probado en test” y “validado en producción” | Pendiente |
| 2 | Revisar privacidad, bases de tratamiento y retención con asesoría legal | Textos/consentimientos aprobados, finalidades separadas, canal para derechos y plazo de eliminación definidos | Bloqueado hasta revisión |
| 3 | Preparar el flujo autenticado de informe promocional | Cuenta previa; token individual y consumible; credenciales no persistidas/logueadas; opt-in comercial separado | Pendiente de especificación técnica y aprobación de seguridad |
| 4 | Piloto QA cerrado con empresas de prueba autorizadas | Cobertura por fuente, fallos parciales, reintentos, abandono, exportación, eliminación y auditoría probados | Pendiente |
| 5 | Instrumentación first-party minimizada | Eventos agregados sin RUT, credenciales, montos, informes, sesión o payload; política de cookies respetada | Pendiente |
| 6 | Contenido educativo orgánico | CTA lleva al dominio oficial, no pide credenciales por DM/comentario, capacidad de respuesta asignada | Pendiente |
| 7 | Piloto de pauta limitado | Criterios de parada, presupuesto y responsable aprobados; se mide oportunidad atendible, citas y clientes | Pendiente |
| 8 | Escalamiento condicionado | Solo con conversión de calidad, capacidad operacional y cero incidentes de privacidad | Pendiente |
| 9 | SEO: Search Console | Propiedad verificada; sitemap y canonicals comprobados; solo páginas públicas aprobadas enviadas | Acción externa del titular pendiente |

## Search Console

Confirmado por el usuario: el destino para “Google” es Google Search Console. Preparación documentada; **no se accedió a la cuenta, no se subió el roadmap, no se envió sitemap ni se solicitó indexación**. Esas acciones requieren autenticación y la propiedad verificada por el titular.

### Validación pública completada (28-10-2026)

Sondeo HTTPS en producción, seguido de redirects: `https://jmvconsultores.cl/sitemap.xml` responde 200 como XML y contiene 28 URLs. Las 28 respondieron 200, todas tienen `<title>` y canonical absoluto que coincide exactamente con su `<loc>`. `https://jmvconsultores.cl/robots.txt` responde 200, permite el sitio público y declara `Sitemap: https://jmvconsultores.cl/sitemap.xml`. El mapa corresponde al host corporativo canónico; no enviar el sitemap separado de `app.jmvconsultores.cl` (ese host sirve el portal y su landing canoniza a la web corporativa).

### Checklist para el titular en Search Console

- [ ] Abrir la propiedad verificada `https://jmvconsultores.cl/` (o su propiedad de dominio) con la cuenta Google de JMV.
- [ ] Confirmar que `/robots.txt` responde 200 y referencia el sitemap de este host.
- [ ] En **Indexación → Sitemaps**, enviar `https://jmvconsultores.cl/sitemap.xml`; comprobar “Correcto”, última lectura y URLs descubiertas (28 al validar).
- [ ] Inspeccionar la portada y al menos una URL de servicio, una guía/blog y una página legal; confirmar que Google puede rastrear y que la canonical seleccionada coincide con la declarada.
- [ ] Si una URL pública cambió recientemente, solicitar indexación solo para esa URL y revisar el informe de cobertura después del rastreo.
- [ ] No enviar `app.jmvconsultores.cl/sitemap.xml` a la propiedad corporativa ni solicitar indexación de `/sistema/`, API, login, registro, tokens promocionales o informes tributarios privados.
- [ ] Registrar fecha y resultado de envío en el checklist operativo; no publicar el roadmap interno.

El sondeo fue de solo lectura: no autenticó en Google, no envió el sitemap ni pidió indexación. Search Console requiere que el titular complete esos pasos y no garantiza indexación.

Fuentes oficiales: [Search Console: sitemaps](https://support.google.com/webmasters/answer/7451001?hl=es), [Inspección de URLs](https://support.google.com/webmasters/answer/9012289?hl=es).

## Métricas que gobiernan el piloto

- Generaciones completas / inicios y cobertura por fuente.
- Exportaciones / informes completos.
- Tasa de consentimiento comercial explícito (sin preselección).
- Tiempo de primera respuesta y solicitudes atendidas.
- Citas, propuestas, altas de servicio y costo por cliente.
- Errores SII, incidentes y solicitudes de eliminación.

No usar “claves recibidas”, RUTs ni montos tributarios como objetivos o propiedades de analítica.
