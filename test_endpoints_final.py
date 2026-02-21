import requests
import json
import os
import sys

def get_token():
    try:
        with open('.env', 'r') as f:
            for line in f:
                if line.startswith('VERIFIK_TOKEN='):
                    val = line.split('=', 1)[1].strip()
                    return val.strip('"').strip("'")
    except:
        return None

token = get_token()
if not token:
    print("Error: No se encontró VERIFIK_TOKEN en .env")
    sys.exit(1)

headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}

# 1. Probar token con endpoint de Vehículo (Debería funcionar)
print("\n--- PRUEBA DE TOKEN (Vehículo JKA191) ---")
try:
    url_veh = "https://api.verifik.co/v2/co/runt/vehicle"
    res_veh = requests.get(url_veh, headers=headers, params={"plate": "JKA191"}, timeout=10)
    if res_veh.status_code == 200:
        print("✅ TOKEN VALIDO (Vehículo OK)")
    else:
        print(f"❌ TOKEN INVÁLIDO O ERROR API ({res_veh.status_code}): {res_veh.text}")
        sys.exit(1)
except Exception as e:
    print(f"⚠️ Error conexión: {e}")
    sys.exit(1)

# 2. Probar Endpoints de Persona
cedula = "1001605191"
print(f"\n--- PRUEBA ENDPOINTS PERSONA ({cedula}) ---")

endpoints = [
    ("https://api.verifik.co/v2/co/runt/person", {"documentNumber": cedula, "documentType": "CC"}),
    ("https://api.verifik.co/v2/co/runt/driver", {"documentNumber": cedula, "documentType": "CC"}),
    ("https://api.verifik.co/v2/co/runt/consult", {"documentNumber": cedula, "documentType": "CC"}),
    ("https://api.verifik.co/v2/co/runt/persona", {"documentNumber": cedula, "documentType": "CC"}),
    ("https://api.verifik.co/v2/co/runt/conductor", {"documentNumber": cedula, "documentType": "CC"}),
    # Endpoint común en otras APIs colombianas
    ("https://api.verifik.co/v2/co/runt/person", {"documentId": cedula, "documentType": "CC"}), 
]

for url, params in endpoints:
    print(f"Probando: {url} con {params} ...")
    try:
        response = requests.get(url, headers=headers, params=params, timeout=10)
        if response.status_code == 200:
            print(f"✅ ÉXITO ENCONTRADO EN: {url}")
            print("\nRESULTADOS RAW:")
            print(json.dumps(response.json(), indent=2, ensure_ascii=False))
            sys.exit(0)
        else:
            print(f"❌ {response.status_code}") # : {response.text[:100]}
    except Exception as e:
        print(f"⚠️ Error: {e}")

print("\n❌ NINGÚN ENDPOINT FUNCIONÓ.")
