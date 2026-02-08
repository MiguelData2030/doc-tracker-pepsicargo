import asyncio, json, os, sys, re
from datetime import datetime
from io import BytesIO
from PIL import Image
try: import pytesseract
except ImportError: pytesseract = None
from playwright.async_api import async_playwright

if pytesseract: pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

# Carpeta para guardar capturas crudas (JSON) para análisis posterior
DUMP_DIR = "runt_dumps"
if not os.path.exists(DUMP_DIR): os.makedirs(DUMP_DIR)

async def solve_captcha(page):
    try:
        selectors = ['img[src^="data:image"]', 'img[alt*="captcha"]', '.captcha-image img']
        captcha_img = None
        for sel in selectors:
            try:
                captcha_img = await page.wait_for_selector(sel, timeout=5000)
                if captcha_img: break
            except: continue
        
        if not captcha_img: return None

        img_bytes = await captcha_img.screenshot()
        img = Image.open(BytesIO(img_bytes)).convert('L')
        
        print(f"[*] Captcha bytes: {len(img_bytes)} | Mode: {img.mode} | Size: {img.size}", file=sys.stderr)
        
        # Estrategia 1: Imagen original (solo escalada)
        w, h = img.size
        base_img = img.resize((w*3, h*3), Image.Resampling.LANCZOS)
        
        strategies = []
        strategies.append(("Raw", base_img))
        
        # Estrategia 2: Binarización simple
        from PIL import ImageOps, ImageFilter
        s2 = base_img.point(lambda x: 0 if x < 160 else 255, '1')
        strategies.append(("Threshold 160", s2))
        
        # Estrategia 3: Invertir + Binarizar
        s3 = ImageOps.invert(base_img)
        s3 = s3.point(lambda x: 0 if x < 160 else 255, '1')
        strategies.append(("Inverted", s3))

        final_text = ""
        for name, simg in strategies:
            extrema = simg.getextrema()
            print(f"[*] Debug {name}: Extrema {extrema}", file=sys.stderr)
            
            # Intentar PSM 7 (Linea), 8 (Palabra), 6 (Bloque)
            for psm in [7, 8, 6]:
                try:
                    txt = pytesseract.image_to_string(simg, config=f'--psm {psm} -c tessedit_char_whitelist=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789').strip()
                    txt = re.sub(r'[^a-zA-Z0-9]', '', txt)
                    if txt and len(txt) >= 4:
                        print(f"[*] Captcha ({name}) [PSM {psm}]: {txt}", file=sys.stderr)
                        final_text = txt
                        break
                except: pass
            
            if final_text: break
            else:
                print(f"[*] Captcha ({name}): Falló en todos los modos", file=sys.stderr)
        
        return final_text
    except Exception as e:
        print(f"[!] Error en OCR: {str(e)}", file=sys.stderr)
        return None

async def run_sync(placa, nit, categoria='PEPSICARGO'):
    async with async_playwright() as p:
        # Modo non-headless para ver qué sucede durante el debug si es necesario
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={'width': 1280, 'height': 800})
        page = await context.new_page()
        
        raw_responses = []
        captured_data = {"soat": [], "rtm": [], "vehiculo": []}

        async def handle_response(response):
            try:
                url = response.url.lower()
                ctype = await response.header_value("content-type") or ""
                if "application/json" in ctype:
                    try:
                        data = await response.json()
                        # Guardar todo para auditoría
                        raw_responses.append({"url": url, "data": data})
                        
                        # Clasificación básica
                        if any(k in url for k in ["poliza", "soat"]): captured_data["soat"].append(data)
                        elif any(k in url for k in ["revision", "rtm", "tecnica"]): captured_data["rtm"].append(data)
                        elif any(k in url for k in ["vehiculo", "datos", "auth"]): captured_data["vehiculo"].append(data)
                    except: pass
            except: pass

        page.on("response", handle_response)

        try:
            url = "https://portalpublico.runt.gov.co/#/consulta-vehiculo/consulta/consulta-ciudadana"
            print(f"[*] Navegando a RUNT...", file=sys.stderr)
            await page.goto(url, wait_until="networkidle", timeout=60000)
            
            await page.wait_for_selector('input[formcontrolname="placa"]', timeout=45000)
            await page.fill('input[formcontrolname="placa"]', placa)
            
            try:
                await page.click('mat-select[formcontrolname="tipoDocumento"]')
                await asyncio.sleep(0.5)
                await page.click('mat-option:has-text("Cédula")')
            except: pass
            
            await page.fill('input[formcontrolname="documento"]', nit)
            
            exito = False
            for i in range(5): # 5 intentos
                captcha = await solve_captcha(page)
                if captcha:
                    await page.fill('input[formcontrolname*="captcha"]', captcha)
                    await page.click('button:has-text("Consultar Información")')
                    await asyncio.sleep(2)
                    
                    # Verificar si hay error de captcha
                    error_msg = page.locator('mat-error')
                    if await error_msg.count() > 0:
                        txt = await error_msg.first.inner_text()
                        if "captcha" in txt.lower():
                            print(f"[!] Captcha incorrecto, reintentando...", file=sys.stderr)
                            await page.click('img[src^="data:image"]') # Click para refrescar si el selector existe
                            await asyncio.sleep(1)
                            continue

                    try:
                        # Esperar a que cargue la información o cambie la URL
                        await page.wait_for_selector('mat-expansion-panel-header', timeout=10000)
                        exito = True; break
                    except:
                        # Si no hay panel, puede ser un error de "Placa no encontrada"
                        if await page.locator('text=/Vehículo no encontrado|No existe información/i').count() > 0:
                            return {"status": "error", "message": "El vehículo con placa " + placa + " no existe en RUNT."}
                        
                        btn = page.locator('button:has-text("Aceptar")')
                        if await btn.count() > 0:
                            await btn.click()
                            await asyncio.sleep(1)
            
            if not exito: return {"status": "error", "message": "Falla al superar el código de seguridad después de varios intentos."}

            print("[*] Expandiendo secciones para forzar carga de JSON...", file=sys.stderr)
            panels = page.locator("mat-expansion-panel-header")
            count = await panels.count()
            for i in range(count):
                panel = panels.nth(i)
                text = await panel.inner_text()
                if any(s in text for s in ["SOAT", "Técnico", "Vehículo", "Información General"]):
                    print(f"[*] Click en panel: {text.strip()}", file=sys.stderr)
                    await panel.click()
                    await asyncio.sleep(1.5) # Esperar a que la red dispare los JSON

            # Procesar datos capturados
            res = {
                "placa": placa, 
                "categoria": categoria, 
                "status": "success", 
                "soat": "No encontrado", 
                "rtm": "No registrado", 
                "marca": "-", 
                "modelo": "-",
                "owner": nit,
                "datos_tecnicos": {}
            }

            # Guardar dump para análisis manual si el usuario lo necesita
            dump_file = os.path.join(DUMP_DIR, f"{placa}_{datetime.now().strftime('%Y%H%M')}.json")
            with open(dump_file, "w", encoding="utf-8") as f:
                json.dump(raw_responses, f, indent=2)

            # Extraer SOAT (Tomar el más reciente por fecha de vencimiento)
            soat_policies = []
            for sj in captured_data["soat"]:
                if not isinstance(sj, dict): continue
                # A veces viene como lista directa o dentro de "listaPolizas"
                l = sj.get("listaPolizas", []) or (sj if isinstance(sj, list) else [])
                for p in l:
                    if isinstance(p, dict) and p.get("fechaVencimSoat") or p.get("fechaVencimiento"):
                        soat_policies.append(p)
            
            # Ordenar por fecha de vencimiento descendente
            if soat_policies:
                soat_policies.sort(key=lambda x: x.get("fechaVencimSoat") or x.get("fechaVencimiento"), reverse=True)
                latest_soat = soat_policies[0]
                res["soat"] = latest_soat.get("fechaVencimSoat") or latest_soat.get("fechaVencimiento")
                res["soat_expedicion"] = latest_soat.get("fechaExpediSoat") or latest_soat.get("fechaExpedicion")

            # Extraer RTM
            rtm_revs = []
            for rj in captured_data["rtm"]:
                if not isinstance(rj, dict): continue
                l = rj.get("listaRevisiones", []) or (rj if isinstance(rj, list) else [])
                for r in l:
                    if isinstance(r, dict) and r.get("fechaVencimiento"):
                        rtm_revs.append(r)
            
            if rtm_revs:
                rtm_revs.sort(key=lambda x: x.get("fechaVencimiento"), reverse=True)
                latest_rtm = rtm_revs[0]
                res["rtm"] = latest_rtm.get("fechaVencimiento")
                res["rtm_expedicion"] = latest_rtm.get("fechaExpedicion")

            # Extraer Datos Vehículo (Prioridad: auth > otros)
            for vj in captured_data["vehiculo"]:
                if not isinstance(vj, dict): continue
                
                # Caso 1: Estructura Auth (infoVehiculo)
                if "infoVehiculo" in vj:
                    iv = vj["infoVehiculo"]
                    res["marca"] = iv.get("marca") or res["marca"]
                    res["modelo"] = iv.get("modelo") or res["modelo"]
                    res["clase"] = iv.get("clase") or "-"
                    res["datos_tecnicos"] = {
                        "vin": iv.get("vin") or iv.get("numChasis") or "N/A",
                        "motor": iv.get("numMotor") or "N/A",
                        "capacidad": iv.get("capacidadCarga", "0"),
                        "cilindraje": iv.get("cilindraje", "0")
                    }
                    # Si no hay RTM y tenemos fecha registro, estimar
                    if res["rtm"] == "No registrado" and iv.get("fechaRegistro"):
                        try:
                            f_reg = datetime.fromisoformat(iv.get("fechaRegistro").replace('Z', '+00:00'))
                            # Regla simple: Motos 2 años, Carros 6 años (aprox)
                            years = 2 if "MOTO" in (iv.get("clase") or "").upper() else 6
                            f_est = f_reg.replace(year=f_reg.year + years)
                            res["rtm"] = f_est.strftime("%Y-%m-%d") + " (Estimado)"
                        except: pass
                
                # Caso 2: Estructura standard (data)
                v = vj.get("data") or vj
                if isinstance(v, dict) and (v.get("marca") or v.get("modelo")):
                    res["marca"] = v.get("marca") or res["marca"]
                    res["modelo"] = v.get("modelo") or res["modelo"]
                    if not res["datos_tecnicos"]:
                        res["datos_tecnicos"] = {
                            "vin": v.get("vin") or v.get("numeroChasis") or "N/A",
                            "motor": v.get("numeroMotor") or "N/A",
                            "capacidad": v.get("capacidadCarga", "0")
                        }

            await browser.close()
            return res

        except Exception as e:
            print(f"[!] Error crítico: {str(e)}", file=sys.stderr)
            if browser: await browser.close()
            return {"status": "error", "message": f"Falla técnica: {str(e)}"}

if __name__ == "__main__":
    if len(sys.argv) < 3: sys.exit(1)
    p, n, c = sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv)>3 else 'PEPSICARGO'
    res = asyncio.run(run_sync(p, n, c))
    print("\n---RESULT_START---")
    print(json.dumps(res))
    print("---RESULT_END---")
