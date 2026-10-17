# Contenido de demostración del sitio

Estado a 2026-10-17. Este archivo existe para que nadie confunda contenido de
ejemplo con información verificada. **Todo lo listado aquí es ficticio** y se
escribió para que las páginas no quedaran a medio hacer. Se reemplaza por
material real en cuanto el propietario lo entregue.

## Regla

- Lo que está aquí **no** se usa en publicidad pagada, campañas de correo ni
  presentaciones a clientes.
- Si un dato pasa a ser real, se actualiza este archivo en el mismo commit.
- Los datos legales (razón social, representante, domicilio) **no** son
  ficticios: son los que confirmó el propietario (`docs/LEGAL-PENDIENTE.md`).

## Inventario

| Dónde | Qué es ficticio | Reemplazo |
|---|---|---|
| `testimonios.html` | Los 6 testimonios: Carolina Fuentes (Ñuñoa), Rodrigo Salinas (Maipú), Paula Herrera (Providencia), Ignacio Rojas (Las Condes), Marcela Pinto (San Bernardo), Diego Aravena (Valparaíso). Nombres, empresas, comunas y resultados. | Testimonios reales con autorización escrita. La página ya advierte en «Nota editorial» que son ejemplos. |
| `nosotros.html` | Perfil de Johan Morales: «doce años trabajando con pymes», rubros atendidos y lista de especialidades. | Trayectoria real: años, formación, colegiatura si corresponde. Foto autorizada cuando exista. |
| `blog-iva-credito-fiscal.html` | Cifras de ejemplo ($300.000 de factura, $57.000 de crédito) y escenarios genéricos. | Se pueden mantener como ejemplo aritmético; el resto del artículo es información general verificable. |
| `blog-finiquito.html` | Ejemplos de partidas y topes; no menciona montos concretos de clientes. | Revisión de un abogado laboral antes de difundirlo. |
| `blog-ley-21719.html` | Descripción de la ley, correcta en lo general; la fecha y la posible postergación deben reconfirmarse. | Verificar fecha vigente y revisión legal. |
| `blog.html` | Fechas de publicación (17/10, 10/10, 02/10 de 2026) y tiempos de lectura. | Ajustar a la fecha real de publicación. |
| `preguntas-frecuentes.html` y `faq-*.html` | Las 350 preguntas vienen de `data/faq_*.py`, escritas para el sitio. No son ficticias en el sentido de inventar clientes, pero **no están revisadas por un abogado**: son información general. | Revisión por servicio cuando se actualice la normativa. |
| Pie de página | Correo `contacto@jmvconsultores.cl` y `privacidad@jmvconsultores.cl`. | **Hoy no pueden recibir correo**: el dominio no tiene registros MX. Ver `docs/CORREO-DOMINIO.md`. |

## Qué NO se inventó, a propósito

- **RUT de la sociedad.** No se publicó: un RUT inventado puede corresponder a
  un tercero real. Los textos legales dicen que se entrega a solicitud.
- **Resultados de clientes** (montos ahorrados, multas evitadas): no se
  publicaron cifras de ahorro tributario en ninguna página.
- **Credenciales profesionales** (universidad, colegiatura, certificaciones): el
  perfil no las menciona porque no fueron confirmadas.
- **Redes sociales**: la constante `REDES` de `js/main.js` sigue vacía y el
  bloque desaparece del pie.
