-- COPIA Y PEGA ESTE CÓDIGO EN EL SQL EDITOR DE SUPABASE
-- Objetivo: Agregar la columna clase_vehiculo a las tablas de flota

ALTER TABLE gestion_vehiculos_pepsicargo ADD COLUMN IF NOT EXISTS clase_vehiculo TEXT;
ALTER TABLE gestion_vehiculos_flota_propia ADD COLUMN IF NOT EXISTS clase_vehiculo TEXT;
ALTER TABLE gestion_vehiculos_corporativos ADD COLUMN IF NOT EXISTS clase_vehiculo TEXT;
ALTER TABLE vh_maestro ADD COLUMN IF NOT EXISTS clase_vehiculo TEXT;

COMMENT ON COLUMN vh_maestro.clase_vehiculo IS 'Clase de vehículo (ej. CAMIÓN, REMOLQUE, etc) extraída de RUNT';
