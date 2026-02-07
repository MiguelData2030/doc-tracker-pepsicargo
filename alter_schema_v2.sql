-- --- INICIO EXTENSIÓN DATOS TÉCNICOS ---
-- Proyecto: Doc-Tracker Pepsicargo (Etapa 2)
-- Objetivo: Agregar campos técnicos para vehículos de categoría PROPIA/CORP.

ALTER TABLE vh_maestro 
ADD COLUMN IF NOT EXISTS vin TEXT,
ADD COLUMN IF NOT EXISTS numero_motor TEXT,
ADD COLUMN IF NOT EXISTS numero_chasis TEXT,
ADD COLUMN IF NOT EXISTS color TEXT,
ADD COLUMN IF NOT EXISTS capacidad_carga NUMERIC, -- En kilogramos o toneladas según preferencia
ADD COLUMN IF NOT EXISTS ejes INTEGER,
ADD COLUMN IF NOT EXISTS peso_bruto NUMERIC,
ADD COLUMN IF NOT EXISTS fecha_matricula_inicial DATE;

-- Comentario de anclaje para auditoría manual
COMMENT ON COLUMN vh_maestro.vin IS 'Vehicle Identification Number - Requerido para flota propia';
COMMENT ON COLUMN vh_maestro.fecha_matricula_inicial IS 'Base para cálculo de RTM si no existe registro previo';

-- --- FIN EXTENSIÓN ---
