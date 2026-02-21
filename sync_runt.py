import asyncio, json, os, sys, re, requests
from datetime import datetime

import os
from dotenv import load_dotenv

load_dotenv()

# Configuración API Verifik
VERIFIK_TOKEN = os.getenv("VERIFIK_TOKEN")
VERIFIK_URL = os.getenv("VERIFIK_URL")

def fetch_verifik(placa, nit, document_type="CC"):
    """Consulta la API de Verifik para obtener datos del RUNT."""
    headers = {
        "Authorization": f"Bearer {VERIFIK_TOKEN}",
        "Content-Type": "application/json"
    }
    params = {
        "plate": placa,
        "documentNumber": nit,
        "documentType": document_type
    }
    
    try:
        response = requests.get(VERIFIK_URL, headers=headers, params=params, timeout=30)
        # Modo Ahorro: No imprimimos el body para proteger el saldo y la privacidad
        if response.status_code == 200:
            return response.json()
        else:
            return {"status": "error", "code": response.status_code, "message": response.text}
    except Exception as e:
        return {"status": "error", "message": f"Connection error: {str(e)}"}

def fetch_driver_runt(cedula, tipo_doc="CC"):
    """Consulta la API de Verifik para obtener datos de un CONDUCTOR (Persona)."""
    headers = {
        "Authorization": f"Bearer {VERIFIK_TOKEN}",
        "Content-Type": "application/json"
    }
    
    # Lista de endpoints probables (basado en pruebas anteriores donde algunos fallaron pero uno funcionó)
    endpoints = [
        "https://api.verifik.co/v2/co/runt/persona",
        "https://api.verifik.co/v2/co/runt/conductor",
        "https://api.verifik.co/v2/co/runt/person",
        "https://api.verifik.co/v2/co/runt/consult"
    ]
    
    params = {
        "documentNumber": cedula,
        "documentType": tipo_doc
    }
    
    last_error = ""
    
    for url in endpoints:
        try:
            # print(f"Probando endpoint: {url}", file=sys.stderr)
            response = requests.get(url, headers=headers, params=params, timeout=20)
            if response.status_code == 200:
                return response.json()
            else:
                last_error = f"{response.status_code} {response.text}"
        except Exception as e:
            last_error = str(e)
            
    return {"status": "error", "message": f"Todos los endpoints fallaron. Último error: {last_error}"}

async def run_sync_driver(cedula, sede, empresa):
    print(f"[*] Consultando Conductor {cedula}...", file=sys.stderr)
    
    api_res = await asyncio.to_thread(fetch_driver_runt, cedula)
    
    if api_res.get("data"):
        data = api_res["data"]
        
        # --- EXTRACCIÓN DE DATOS ---
        fname = data.get('firstName') or data.get('primerNombre') or ""
        lname = data.get('lastName') or data.get('primerApellido') or ""
        nombre_completo = f"{fname} {lname}".strip() or data.get('nombreCompleto') or "DESCONOCIDO"
        
        # RUNT Info
        nro_inscripcion = data.get('inscriptionNumber') or data.get('numeroInscripcion')
        fecha_inscripcion = data.get('inscriptionDate') or data.get('fechaInscripcion')
        estado = data.get('driverStatus') or data.get('estadoPersona') or "ACTIVO"
        
        # --- LICENCIAS (Búsqueda Agresiva de Campos) ---
        lic_data = (
            data.get('licenses') or 
            data.get('licenciasConduccion') or 
            data.get('licencias') or 
            data.get('licenciaConduccion') or 
            data.get('driversLicense') or
            data.get('licencia') or
            []
        )
        
        # Normalizar a lista si es un objeto único
        licencias = [lic_data] if isinstance(lic_data, dict) else lic_data
        
        lic_veh = None
        
        # Helper para parsear fechas
        def parse_date(date_str):
            if not date_str: return '1900-01-01'
            if isinstance(date_str, dict): 
                date_str = date_str.get('date') or date_str.get('fecha') or date_str.get('value') or ''
            
            date_str = str(date_str).strip()
            # Formatos comunes: DD/MM/YYYY, YYYY-MM-DD
            if '/' in date_str:
                try:
                    parts = date_str.split('/')
                    if len(parts) == 3: return f"{parts[2]}-{parts[1]}-{parts[0]}"
                except: pass
            return date_str
            
        list_c = []
        list_b = []
        
        if isinstance(licencias, list):
            for lic in licencias:
                if not isinstance(lic, dict): continue
                
                # Búsqueda de Categoría (C1, C2, C3, B1...)
                cat_val = (
                    lic.get('category') or
                    lic.get('categoria') or 
                    lic.get('clase') or 
                    lic.get('tipoLicencia') or
                    lic.get('tipo') or 
                    ""
                )
                cat = str(cat_val).upper()
                if 'C' in cat:
                    list_c.append(lic)
                elif 'B' in cat:
                    list_b.append(lic)
                
        if list_c:
            list_c.sort(key=lambda x: parse_date(x.get('dueDate') or x.get('fechaVencimiento') or x.get('vencimiento')), reverse=True)
            lic_veh = list_c[0]
        elif list_b:
            list_b.sort(key=lambda x: parse_date(x.get('dueDate') or x.get('fechaVencimiento') or x.get('vencimiento')), reverse=True)
            lic_veh = list_b[0]

        # Multas / Trámites
        multas = data.get('multasInfracciones') or []
        total_multas = len(multas)
        total_tramites = len(data.get('tramitesRealizados') or [])
        if isinstance(data.get('tramitesRealizados'), str):
             try: total_tramites = int(data.get('tramitesRealizados'))
             except: total_tramites = 0
             
        res = {
            "cedula": cedula,
            "nombre_completo": nombre_completo,
            "estado_conductor": estado,
            "nro_inscripcion_runt": nro_inscripcion,
            "fecha_inscripcion_runt": fecha_inscripcion,
            
            # Licencia Vehículo (Unificada con fallback de campos)
            "licencia_veh_nro": lic_veh.get('licenceNumber') or lic_veh.get('nroLicencia') or lic_veh.get('numero') if lic_veh else None,
            "licencia_veh_categoria": lic_veh.get('category') or lic_veh.get('categoria') or lic_veh.get('clase') if lic_veh else None,
            "licencia_veh_vigencia": lic_veh.get('dueDate') or lic_veh.get('fechaVencimiento') or lic_veh.get('vencimiento') if lic_veh else None,
            "licencia_veh_expedicion": lic_veh.get('expeditionDate') or lic_veh.get('fechaExpedicion') or lic_veh.get('expedicion') if lic_veh else None,
            
            "total_multas": total_multas,
            "total_tramites": total_tramites,
            "paz_y_salvo": "NO" if total_multas > 0 else "SI",
            
            "categoria_empresa": empresa,
            "sede": sede,
            "api_raw_data": api_res
        }
        return res
        
    return {
        "status": "error",
        "message": f"API Falló: {api_res.get('message', 'No se encontraron datos')}"
    }

async def run_sync(placa, nit, categoria):
    print(f"[*] Consultando API Verifik para {placa}...", file=sys.stderr)
    
    # 1. Intentar con API - Primero como Cédula (CC)
    api_res = await asyncio.to_thread(fetch_verifik, placa, nit, "CC")
    
    # Si falla por "current_owners_dont_match" o error similar, reintentar como NIT
    need_retry = False
    if api_res.get("status") == "error":
        msg = api_res.get("message", "").lower()
        if "current_owners_dont_match" in msg or "notfound" in msg or api_res.get("code") == 404:
            need_retry = True
            
    if need_retry:
        print(f"[*] Reintentando como NIT para {placa}...", file=sys.stderr)
        api_res = await asyncio.to_thread(fetch_verifik, placa, nit, "NIT")

    if api_res.get("data"):
        data = api_res["data"]
        # El objeto 'informacionGeneral' tiene la mayoría de los datos técnicos
        ig = data.get("informacionGeneral", {})
        
        res = {
            "placa": placa,
            "categoria": categoria,
            "status": "success",
            "fuente": "API_VERIFIK",
            # Datos principales
            # Información General (ig)
            # Datos principales con fallbacks agresivos para marca y clase
            "marca": (
                ig.get("marca") or 
                ig.get("brand") or 
                data.get("marca") or 
                data.get("brand") or 
                "-"
            ),
            "modelo": ig.get("modelo") or ig.get("modelYear") or "-",
            "linea": ig.get("linea") or "-",
            "clase": (
                ig.get("claseVehiculo") or 
                ig.get("vehicleClass") or 
                data.get("claseVehiculo") or 
                data.get("vehicleClass") or 
                data.get("clase") or
                "-"
            ),
            "color": ig.get("color") or ig.get("colour") or "-",
            "combustible": ig.get("tipoCombustible") or "-",
            "cilindraje": ig.get("cilindraje") or "0",
            "propietario": data.get("propietario") or "-",
            "nit_cedula": nit,
            
            # Datos técnicos exhaustivos
            "datos_tecnicos": {
                "vin": ig.get("noVin") or ig.get("noChasis") or "N/A",
                "motor": ig.get("noMotor") or "N/A",
                "chasis": ig.get("noChasis") or "N/A",
                "serie": ig.get("noSerie") or "N/A",
                "ejes": ig.get("noEjes") or "0",
                "pasajeros": ig.get("pasajerosSentados") or "0",
                "carga": str(ig.get("capacidadCarga", "0")).strip(),
                "peso_bruto": ig.get("pesoBruto") or "0",
                "carroceria": ig.get("tipoCarroceria") or "-",
                "servicio": ig.get("tipoServicio") or "-",
                "puertas": ig.get("puertas") or "0",
                "organismo": ig.get("organismoTransito") or "-",
                "licencia": ig.get("noLicenciaTransito") or "-",
                "fecha_matricula": ig.get("fechaMatricula") or "-",
                "repotenciado": ig.get("repotenciado") or "NO",
                "gravamenes": ig.get("tieneGravamenes") or "NO",
                "estado_vehiculo": ig.get("estadoDelVehiculo") or "-",
                "clase_vehiculo": ig.get("claseVehiculo") or "-"
            },
            
            # Documentación
            "soat": "No encontrado",
            "soat_vencimiento": None,
            "soat_expedicion": None,
            "soat_estado": "-",
            "rtm": "No registrado",
            "rtm_vencimiento": None,
            "rtm_expedicion": None,
            "rtm_estado": "-",
            "api_raw_data": api_res
        }
        
        # SOAT (La lista se llama 'soat' en este objeto de Verifik)
        s_list = data.get("soat", [])
        if s_list and isinstance(s_list, list):
            # Ordenar por fecha fin vigencia (formato DD/MM/AAAA requiere parseo para sort exacto, 
            # pero usualmente el primero es el más reciente)
            # Para mayor seguridad, confiamos en el campo 'estado' == 'VIGENTE'
            videntes = [x for x in s_list if x.get("estado") == "VIGENTE"]
            s = videntes[0] if videntes else s_list[0]
            
            res["soat"] = s.get("fechaVencimiento")
            res["soat_vencimiento"] = s.get("fechaVencimiento")
            res["soat_expedicion"] = s.get("fechaExpedicion")
            res["soat_estado"] = s.get("estado") or "-"

        # RTM (La lista se llama 'tecnoMecanica')
        r_list = data.get("tecnoMecanica", [])
        if r_list and isinstance(r_list, list):
            videntes = [x for x in r_list if x.get("vigente") == "SI"]
            r = videntes[0] if videntes else r_list[0]
            
            res["rtm"] = r.get("fechaVencimiento")
            res["rtm_vencimiento"] = r.get("fechaVencimiento")
            res["rtm_expedicion"] = r.get("fechaExpedicion")
            res["rtm_estado"] = r.get("estado") or "-"

        return res
    
    return {
        "status": "error", 
        "message": f"API Falló: {api_res.get('message', 'Error desconocido')}"
    }
    
    # 2. Si falla API, se podría reincorporar el scraping, pero el usuario pidió API.
    return {
        "status": "error", 
        "message": f"API Falló: {api_res.get('message', 'Error desconocido')}"
    }


if __name__ == "__main__":
    # Modo Vehículo: python sync_runt.py PLACA NIT CATEGORIA
    # Modo Conductor: python sync_runt.py --driver CEDULA SEDE EMPRESA
    
    if len(sys.argv) < 3:
        print(json.dumps({"status": "error", "message": "Parámetros insuficientes"}))
        sys.exit(1)

    if sys.argv[1] == '--driver':
        # Modo Conductor
        c, s, e = sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv)>4 else 'PEPSICARGO'
        try:
            res = asyncio.run(run_sync_driver(c, s, e))
        except Exception as ex:
            res = {"status": "error", "message": str(ex)}
    else:
        # Modo Vehículo (Default)
        p, n, c = sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv)>3 else 'PEPSICARGO'
        try:
            res = asyncio.run(run_sync(p, n, c))
        except Exception as ex:
            res = {"status": "error", "message": str(ex)}
        
    print("\n---RESULT_START---")
    print(json.dumps(res))
    print("---RESULT_END---")
