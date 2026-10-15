# Sistema Contable JMV (iva-mensual)

Sistema contable/tributario chileno: bandeja SII (RCV), partida doble,
reportes, tesorería y emisión de DTE. Backend Node 24+ + Express 4 +
better-sqlite3 (WAL); frontend vanilla JS en `frontend/sistema/` (SPA con
`window.VIEWS`). Tests: `npm test` (archivos explícitos en package.json —
NUNCA `node --test test/`).

**Anti-caché del frontend (OBLIGATORIO):** el nginx del VPS fija
`max-age=14400` a los `.js`/`.css`. Antes de commitear cualquier cambio en
`frontend/` correr `npm run seed:v` — versiona las referencias de
`frontend/sistema/index.html` con sha1 del contenido de cada archivo (NUNCA
usar el SHA de HEAD como semilla: esa URL ya fue cacheada por el navegador
con el código anterior).

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
