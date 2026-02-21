-- --- MIGRACIÓN: CAMPOS TÉCNICOS EXTENDIDOS (Verifik API) ---
-- Objetivo: Almacenar la totalidad de la información técnica del vehículo provista por Verifik.

ALTER TABLE vh_maestro 
ADD COLUMN IF NOT EXISTS combustible TEXT,
ADD COLUMN IF NOT EXISTS cilindraje TEXT,
ADD COLUMN IF NOT EXISTS numero_serie TEXT,
ADD COLUMN IF NOT EXISTS capacidad_pasajeros INTEGER,
ADD COLUMN IF NOT EXISTS tipo_carroceria TEXT,
ADD COLUMN IF NOT EXISTS tipo_servicio TEXT,
ADD COLUMN IF NOT EXISTS numero_puertas INTEGER,
ADD COLUMN IF NOT EXISTS linea TEXT,
ADD COLUMN IF NOT EXISTS clase_vehiculo TEXT,
ADD COLUMN IF NOT EXISTS rtm_vencimiento DATE,
ADD COLUMN IF NOT EXISTS soat_vencimiento DATE,
ADD COLUMN IF NOT EXISTS rtm_estado TEXT,
ADD COLUMN IF NOT EXISTS soat_estado TEXT,
ADD COLUMN IF NOT EXISTS nro_licencia_transito TEXT,
ADD COLUMN IF NOT EXISTS repotenciado TEXT,
ADD COLUMN IF NOT EXISTS tiene_gravamenes TEXT,
ADD COLUMN IF NOT EXISTS estado_runt TEXT,
ADD COLUMN IF NOT EXISTS fecha_matricula DATE;

-- Tabla para almacenar el JSON crudo completo por si se requiere auditoría profunda o campos no mapeados
ALTER TABLE vh_maestro 
ADD COLUMN IF NOT EXISTS api_raw_data JSONB;

-- Comentarios para documentación técnica
COMMENT ON COLUMN vh_maestro.combustible IS 'Tipo de combustible del vehículo';
COMMENT ON COLUMN vh_maestro.cilindraje IS 'Cilindraje en cc';
COMMENT ON COLUMN vh_maestro.api_raw_data IS 'Copia íntegra de la respuesta de Verifik API';
