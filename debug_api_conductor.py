import requests
import json
import os
from dotenv import load_dotenv

load_dotenv()

VERIFIK_TOKEN = os.getenv("VERIFIK_TOKEN")
# Probamos el endpoint que parece más probable según el análisis previo
URL = "https://api.verifik.co/v2/co/runt/conductor" 

headers = {
    "Authorization": f"Bearer {VERIFIK_TOKEN}",
    "Content-Type": "application/json"
}

params = {
    "documentNumber": "91264273",
    "documentType": "CC"
}

print(f"Consultando {URL} para 91264273...")
try:
    response = requests.get(URL, headers=headers, params=params, timeout=20)
    print(f"Status Code: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        with open("debug_raw_conductor.json", "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
        print("✅ Respuesta guardada en debug_raw_conductor.json")
    else:
        print(f"❌ Error: {response.text}")
except Exception as e:
    print(f"⚠️ Exception: {e}")
