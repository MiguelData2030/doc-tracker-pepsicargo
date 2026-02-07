import asyncio, json, os, sys, re
from datetime import datetime
from io import BytesIO
from PIL import Image
try: import pytesseract
except ImportError: pytesseract = None
from playwright.async_api import async_playwright
if pytesseract: pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

async def solve_captcha(page):
    try:
        captcha_img = await page.wait_for_selector('img[src^="data:image"]', timeout=10000)
        img_bytes = await captcha_img.screenshot()
        img = Image.open(BytesIO(img_bytes)).convert('L')
        # Pre-procesamiento avanzado: Escalar y Binarizar
        width, height = img.size
        img = img.resize((width*4, height*4), Image.Resampling.LANCZOS)
        img = img.point(lambda x: 0 if x < 140 else 255, '1') # Threshold
        text = pytesseract.image_to_string(img, config='--psm 7 -c tessedit_char_whitelist=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789').strip()
        print(f"[*] Captcha Decodificado: {text}", file=sys.stderr)
        return text
    except: return None

async def run_sync(placa, nit, categoria='PEPSICARGO'):
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        context = await browser.new_context()
        page = await context.new_page()
        captured_data = {"soat": [], "rtm": [], "vehiculo": []}
        async def handle_response(response):
            try:
                url, ctype = response.url.lower(), await response.header_value("content-type") or ""
                if "application/json" in ctype and any(k in url for k in ["poliza", "soat", "revision", "rtm", "tecnica", "vehiculo"]):
                    data = await response.json()
                    if not isinstance(data, (dict, list)): return
                    if "poliza" in url or "soat" in url: captured_data["soat"].append(data)
                    elif "revision" in url or "rtm" in url: captured_data["rtm"].append(data)
                    else: captured_data["vehiculo"].append(data)
            except: pass
        page.on("response", handle_response)
        try:
            url = "https://portalpublico.runt.gov.co/#/consulta-vehiculo/consulta/consulta-ciudadana"
            await page.goto(url, timeout=60000)
            await page.wait_for_selector('input[formcontrolname="placa"]', timeout=45000)
            await page.fill('input[formcontrolname="placa"]', placa)
            try:
                await page.click('mat-select[formcontrolname="tipoDocumento"]')
                await asyncio.sleep(0.5)
                await page.click('mat-option:has-text("Cédula")')
            except: pass
            await page.fill('input[formcontrolname="documento"]', nit)
            exito = False
            for i in range(4): # Aumentar a 4 intentos
                captcha = await solve_captcha(page)
                if captcha:
                    await page.fill('input[formcontrolname*="captcha"]', captcha)
                    await page.click('button:has-text("Consultar Información")')
                    await asyncio.sleep(3)
                    try:
                        await page.wait_for_selector('text=/Información general|Datos del Vehículo/i', timeout=10000)
                        exito = True; break
                    except:
                        btn = page.locator('button:has-text("Aceptar")')
                        if await btn.count() > 0:
                            await btn.click()
                            await page.click('img[src^="data:image"]')
                            await asyncio.sleep(1)
            if not exito: return {"status": "error", "message": "Captcha fallido"}
            print("[*] Abriendo secciones...", file=sys.stderr)
            for s in ["Póliza SOAT", "Revisión Técnico-Mecánica", "Datos del Vehículo"]:
                try:
                    h = page.locator("mat-expansion-panel-header").filter(has_text=re.compile(s, re.I))
                    if await h.count() > 0:
                        await h.first.click(); await asyncio.sleep(4)
                except: pass
            res = {"placa": placa, "categoria": categoria, "status": "success", "soat_expedicion": "No encontrado", "soat": "No encontrado", "rtm_expedicion": "No encontrado", "rtm": "No encontrado", "datos_tecnicos": {}}
            for sj in captured_data["soat"]:
                if not isinstance(sj, dict): continue
                items = sj.get("listaPolizas") or sj.get("data") or []
                for it in (items if isinstance(items, list) else [items]):
                    if isinstance(it, dict) and str(it.get("estado") or "").upper() == "VIGENTE":
                        res["soat_expedicion"], res["soat"] = it.get("fechaExpedicion"), it.get("fechaVencimiento")
            for rj in captured_data["rtm"]:
                if not isinstance(rj, dict): continue
                items = rj.get("listaRevisiones") or rj.get("data") or []
                for it in (items if isinstance(items, list) else [items]):
                    if isinstance(it, dict) and str(it.get("vigente") or "").upper() == "SI":
                        res["rtm_expedicion"], res["rtm"] = it.get("fechaExpedicion"), it.get("fechaVencimiento"); break
            for vj in captured_data["vehiculo"]:
                if not isinstance(vj, dict): continue
                v = vj.get("data") or vj
                if isinstance(v, dict) and (v.get("vin") or v.get("numeroMotor")):
                    res["marca"], res["modelo"], res["fecha_matricula"] = v.get("marca"), v.get("modelo"), v.get("fechaMatricula")
                    res["datos_tecnicos"] = {"vin": v.get("vin") or v.get("numeroChasis") or "N/A", "motor": v.get("numeroMotor") or "N/A", "capacidad": v.get("capacidadCarga", "0"), "ejes": v.get("numeroEjes", "0")}
            if not res.get("rtm") and res.get("fecha_matricula"):
                try:
                    d = datetime.strptime(res["fecha_matricula"], "%d/%m/%Y")
                    res["rtm"], res["rtm_proyectada"] = d.replace(year=d.year+2).strftime("%d/%m/%Y"), True
                except: pass
            await browser.close()
            return res
        except Exception as e:
            if browser: await browser.close()
            return {"status": "error", "message": str(e)}

if __name__ == "__main__":
    if len(sys.argv) < 3: sys.exit(1)
    p, n, c = sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv)>3 else 'PEPSICARGO'
    res = asyncio.run(run_sync(p, n, c))
    print("\n---RESULT_START---")
    print(json.dumps(res))
    print("---RESULT_END---")
