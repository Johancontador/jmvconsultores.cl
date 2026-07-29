-- Migración: agregar columnas creadas_faltantes a informe_meses
-- Ejecutar en la BD del VPS

ALTER TABLE informe_meses ADD COLUMN creado_en TEXT DEFAULT (datetime('now'));
ALTER TABLE informe_meses ADD COLUMN actualizado_en TEXT DEFAULT (datetime('now'));

-- Verificar
-- PRAGMA table_info(informe_meses);