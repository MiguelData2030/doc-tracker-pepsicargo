import requests
import json
import os
import sys

def get_token():
    try:
        with open('.env', 'r') as f:
            for line in f:
                if line.startswith('VERIFIK_TOKEN='):
                    # Split by first = and get the rest, strip whitespace and quotes
                    val = line.split('=', 1)[1].strip()
                    return val.strip('"').strip("'")
    except:
        return None

token = get_token()
if not token:
    print("Error: No se encontró VERIFIK_TOKEN en .env")
    sys.exit(1)

# Intentar endpoint RUNT Person específico
url = "https://api.verifik.co/v2/co/runt/consult"
cedula = "1001605191"

print(f"--- CONSULTA RUNT CONDUCTOR ({cedula}) ---")
# print(f"Token (parcial): {token[:10]}...") # Debug only

try:
    response = requests.get(
        url,
        headers={
            "Authorization": f"Bearer {token}", # Ensure Bearer prefix is used
            "Content-Type": "application/json"
        },
        params={
            "documentNumber": cedula,
            "documentType": "CC"
        },
        timeout=30
    )
    
    if response.status_code == 200:
        print("✅ ÉXITO")
        print("\nRESULTADOS RAW:")
        print(json.dumps(response.json(), indent=2, ensure_ascii=False))
    else:
        print(f"❌ Error {response.status_code}: {response.text}")

except Exception as e:
    print(f"⚠️ Excepción: {e}")
