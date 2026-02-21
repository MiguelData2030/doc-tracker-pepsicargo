-- --- DRIVER MANAGEMENT SCHEMA (MULTI-LICENSE SUPPORT) ---
-- Objetivo: Gestión DETALLADA de conductores con múltiples licencias.

-- 1. ENUMS
DO $$ BEGIN
    CREATE TYPE categoria_empresa AS ENUM ('PEPSICARGO', 'PROPIA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. TABLA MAESTRA CONDUCTORES
CREATE TABLE IF NOT EXISTS conductores_maestro (
    cedula TEXT PRIMARY KEY,
    nombre_completo TEXT NOT NULL,
    
    -- Datos RUNT Identificados
    estado_conductor TEXT DEFAULT 'ACTIVO',
    nro_inscripcion_runt TEXT,
    fecha_inscripcion_runt DATE,
    
    -- LICENCIAS VEHÍCULOS (C1, C2, C3, B1, B2...)
    licencia_veh_nro TEXT,
    licencia_veh_categoria TEXT, 
    licencia_veh_vigencia DATE,
    licencia_veh_expedicion DATE,
    
    -- LICENCIAS MOTOS (A1, A2)
    licencia_moto_nro TEXT,
    licencia_moto_categoria TEXT,
    licencia_moto_vigencia DATE,
    licencia_moto_expedicion DATE,
    
    -- Infracciones y Trámites
    total_multas INTEGER DEFAULT 0,
    total_tramites INTEGER DEFAULT 0,
    paz_y_salvo TEXT DEFAULT 'S/D', 
    
    -- Organización
    categoria_empresa categoria_empresa NOT NULL DEFAULT 'PEPSICARGO',
    sede TEXT,
    foto_url TEXT,
    
    -- Almacenamiento Crudo (REQUERIDO)
    api_raw_data JSONB,
    
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    actualizado_en TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 3. COMPUTED COLUMNS (Vistas o Generadas para Dias Vencimiento)
-- Para simplificar, usaremos una VISTA para los cálculos de días, 
-- ya que columnas generadas stored son complejas con fechas dinámicas (now()).

CREATE OR REPLACE VIEW vista_conductores_vencimientos AS
SELECT 
    *,
    (licencia_veh_vigencia - CURRENT_DATE) AS dias_venc_vehiculo,
    (licencia_moto_vigencia - CURRENT_DATE) AS dias_venc_moto,
    CASE 
        WHEN (licencia_veh_vigencia - CURRENT_DATE) < 0 THEN 'VENCIDO'
        WHEN (licencia_veh_vigencia - CURRENT_DATE) <= 30 THEN 'POR VENCER'
        ELSE 'VIGENTE'
    END AS estado_licencia_veh,
    CASE 
        WHEN (licencia_moto_vigencia - CURRENT_DATE) < 0 THEN 'VENCIDO'
        WHEN (licencia_moto_vigencia - CURRENT_DATE) <= 30 THEN 'POR VENCER'
        ELSE 'VIGENTE'
    END AS estado_licencia_moto
FROM conductores_maestro;

-- 4. SEGURIDAD (RLS)
ALTER TABLE conductores_maestro ENABLE ROW LEVEL SECURITY;

-- Función SECURITY DEFINER para evitar recursión infinita en RLS
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT rol FROM perfiles_usuario WHERE id = auth.uid() LIMIT 1;
$$;

DROP POLICY IF EXISTS policy_drivers_select ON conductores_maestro;
CREATE POLICY policy_drivers_select ON conductores_maestro FOR SELECT USING (
    get_user_role() IN ('SUPER_ADMIN', 'ADMIN', 'GERENCIA', 'VISOR_TOTAL')
    OR
    (get_user_role() = 'GESTOR_PEPSICARGO' AND categoria_empresa = 'PEPSICARGO')
    OR
    (get_user_role() = 'GESTOR_PROPIOS' AND categoria_empresa = 'PROPIA')
);

DROP POLICY IF EXISTS policy_drivers_insert ON conductores_maestro;
CREATE POLICY policy_drivers_insert ON conductores_maestro FOR INSERT WITH CHECK (
    get_user_role() IN ('SUPER_ADMIN', 'ADMIN', 'GESTOR_PEPSICARGO', 'GESTOR_PROPIOS')
);

DROP POLICY IF EXISTS policy_drivers_update ON conductores_maestro;
CREATE POLICY policy_drivers_update ON conductores_maestro FOR UPDATE USING (
    get_user_role() IN ('SUPER_ADMIN', 'ADMIN', 'GESTOR_PEPSICARGO', 'GESTOR_PROPIOS')
);
