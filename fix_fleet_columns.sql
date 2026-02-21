-- SCRIPT DE CORRECCIÓN DE BASE DE DATOS
-- Ejecutar este script en el SQL EDITOR de Supabase Dashboard

-- 1. Tabla: Flota Propia
ALTER TABLE gestion_vehiculos_flota_propia 
ADD COLUMN IF NOT EXISTS fumigacion_archivo TEXT,
ADD COLUMN IF NOT EXISTS fumigacion_expedicion DATE,
ADD COLUMN IF NOT EXISTS fumigacion_vencimiento DATE,
ADD COLUMN IF NOT EXISTS sanidad_archivo TEXT,
ADD COLUMN IF NOT EXISTS sanidad_expedicion DATE,
ADD COLUMN IF NOT EXISTS sanidad_vencimiento DATE;

-- 2. Tabla: Flota Corporativa
ALTER TABLE gestion_vehiculos_corporativos 
ADD COLUMN IF NOT EXISTS fumigacion_archivo TEXT,
ADD COLUMN IF NOT EXISTS fumigacion_expedicion DATE,
ADD COLUMN IF NOT EXISTS fumigacion_vencimiento DATE,
ADD COLUMN IF NOT EXISTS sanidad_archivo TEXT,
ADD COLUMN IF NOT EXISTS sanidad_expedicion DATE,
ADD COLUMN IF NOT EXISTS sanidad_vencimiento DATE;

-- 3. Tabla: Flota PepsiCargo (por seguridad, verificar si existen)
ALTER TABLE gestion_vehiculos_pepsicargo 
ADD COLUMN IF NOT EXISTS fumigacion_archivo TEXT,
ADD COLUMN IF NOT EXISTS fumigacion_expedicion DATE,
ADD COLUMN IF NOT EXISTS fumigacion_vencimiento DATE,
ADD COLUMN IF NOT EXISTS sanidad_archivo TEXT,
ADD COLUMN IF NOT EXISTS sanidad_expedicion DATE,
ADD COLUMN IF NOT EXISTS sanidad_vencimiento DATE;

COMMENT ON TABLE gestion_vehiculos_flota_propia IS 'Tablas actualizadas con columnas documentales de Fumigación y Sanidad';
