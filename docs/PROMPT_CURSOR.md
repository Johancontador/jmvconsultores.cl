# PROMPT MAESTRO — IVA Mensual
# Pegar completo en Cursor Composer

Lee primero TODOS los archivos de la carpeta docs/ antes de escribir una sola línea de código:
- docs/PRD.md
- docs/TRD.md
- docs/UI-UX.md
- docs/APPFLOW.md
- docs/BACKEND.md
- docs/PLAN.md

Y el archivo .cursor/rules.

Una vez que los hayas leído todos, implementa el proyecto siguiendo EXACTAMENTE el plan
definido en docs/PLAN.md, fase por fase.

REGLAS CRÍTICAS:
1. Sigue el plan en orden. No saltes fases.
2. En cada punto "DETENTE" para completamente y muestra un resumen de lo implementado.
   Espera confirmación explícita ("continúa" o "sigue") antes de pasar a la siguiente fase.
3. El stack es fijo: Node.js + Express + SQLite (better-sqlite3) + HTML/JS vanilla.
   No propongas alternativas ni agregues dependencias no listadas en PLAN.md.
4. El diseño visual debe seguir EXACTAMENTE los colores y estilos de docs/UI-UX.md.
5. NUNCA devuelvas clave_sii al frontend en ningún endpoint.
6. Respeta el rate limiting de SimpleAPI: 1200ms entre cada consulta al SII.

Comienza por la Fase 1. Muéstrame los archivos creados y confirma que el servidor
levanta antes de continuar.
