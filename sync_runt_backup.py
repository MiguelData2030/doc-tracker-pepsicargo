import asyncio
import json
import os
import sys
from io import BytesIO
from PIL import Image
try:
    import pytesseract
except ImportError:
    pytesseract = None
from playwright.async_api import async_playwright

# Configuración de Tesseract para Windows
if pytesseract: # Only configure if pytesseract was successfully imported
    pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

async def solve_captcha(page):
    """Localiza el CAPTCHA, lo captura y lo lee con OCR."""
    try:
        # El CAPTCHA en RUNT PRO es una imagen Base64 (comienza con data:image)
        captcha_img = await page.wait_for_selector('img[src^="data:image"]', timeout=10000)
        if not captcha_img:
            print("[!] No se encontró imagen Base64 de CAPTCHA.", file=sys.stderr)
            return None
        
        # 'Foto' del captcha
        img_bytes = await captcha_img.screenshot()
        img = Image.open(BytesIO(img_bytes)).convert('L') # Escala de grises
        
        # Lectura OCR
        text = pytesseract.image_to_string(img, config='--psm 7').strip()
        print(f"[*] CAPTCHA Detectado: {text}", file=sys.stderr)
        return text
    except Exception as e:
        print(f"[!] Error al procesar CAPTCHA: {e}", file=sys.stderr)
        return None

async def run_sync(placa, nit):
    async with async_playwright() as p:
        # Lanzamos en headless=True para que el usuario no vea nada, todo es por detrás
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        try:
            # Nueva URL detectada en el portal del RUNT
            url = "https://portalpublico.runt.gov.co/#/consulta-vehiculo/consulta/consulta-ciudadana"
            print(f"[*] Navegando a {url}...", file=sys.stderr)
            await page.goto(url, timeout=60000)
            
            # Llenar datos conocidos con selectores ROBUSTOS
            try:
                # Esperar a que los inputs aparezcan (el portal es lento)
                await page.wait_for_selector('input', timeout=45000)
                
                # DEPUREMOS: Listar todos los atributos de los inputs detectados
                print("[*] Inspeccionando atributos de inputs:", file=sys.stderr)
                inputs = await page.query_selector_all('input')
                for idx, inp in enumerate(inputs):
                    attrs = await page.evaluate('(el) => { \
                        let res = {}; \
                        for (let a of el.attributes) { res[a.name] = a.value; } \
                        return res; \
                    }', inp)
                    print(f"    {idx}. {attrs}", file=sys.stderr)
            except Exception as e:
                print("[!!] La página no cargó los inputs a tiempo.", file=sys.stderr)
                raise e
            
            # Llenar datos conocidos con selectores ROBUSTOS de Angular
            # Placa
            await page.fill('input[formcontrolname="placa"]', placa)
            
            # Tipo Documento (CC es value '1' o similar, pero intentaremos por texto si el select falla)
            try:
                # En RUNT PRO suele ser un mat-select, intentamos por click + click
                await page.click('mat-select[formcontrolname="tipoDocumento"]')
                await page.click('mat-option:has-text("Cédula")')
            except:
                # Fallback: intentar select estándar si existe
                try: await page.select_option('select[formcontrolname="tipoDocumento"]', label='Cédula de Ciudadanía')
                except: pass

            # Documento
            await page.fill('input[formcontrolname="documento"]', nit)
            
            print("[*] Formulario base completado. Iniciando ciclo de CAPTCHA...", file=sys.stderr)

            # Bucle de reintento de CAPTCHA
            for intento in range(3):
                captcha_text = await solve_captcha(page)
                if captcha_text:
                    # El campo de captcha en RUNT PRO suele ser 'captchaValue'
                    mount_captcha = 'input[formcontrolname*="captcha"]'
                    try:
                        await page.fill(mount_captcha, captcha_text)
                    except:
                        # Fallback: buscar cualquier input cerca de la imagen
                        await page.fill('input:near(img[src^="data:image"])', captcha_text)
                    
                    await page.click('button:has-text("Consultar Información")')
                    await asyncio.sleep(2) # Esperar a que reaccione
                    await page.screenshot(path="debug_runt.png")
                    print("[*] Screenshot de depuración guardado en debug_runt.png", file=sys.stderr)
                    
                    # ¿Entró o salió error?
                    try:
                        # 1. ¿Acceso exitoso?
                        await page.wait_for_selector('text=/Información general|Datos del Vehículo|Matrícula/i', timeout=8000)
                        print("[+] CAPTCHA resuelto con éxito.", file=sys.stderr)
                        # Guardar HTML para inspección
                        with open("debug_runt.html", "w", encoding="utf-8") as f:
                            f.write(await page.content())
                        break
                    except:
                        # 2. ¿Modal de error?
                        modal_btn = page.locator('button:has-text("Aceptar")')
                        if await modal_btn.count() > 0:
                            print("[!] Captcha inválido. Cerrando modal y reintentando...", file=sys.stderr)
                            await modal_btn.click()
                            await asyncio.sleep(1)
                        else:
                            print(f"[?] No se detectó éxito ni error claro. Reintentando...", file=sys.stderr)
                    
                    # Recargar captcha si es necesario
                    try:
                        await page.click('img[src^="data:image"]')
                        await asyncio.sleep(1)
                    except: pass
            
            # --- EXTRACCIÓN DE RESULTADOS (RUNT PRO) ---
            # El nuevo portal usa una estructura de celdas divs/mat-cells
            await asyncio.sleep(3) 
            content = await page.inner_text("body")
            # print(f"DEBUG CONTENT: {content[:1000]}", file=sys.stderr)
            
            res = {
                "placa": placa,
                "soat": "No encontrado",
                "rtm": "No encontrado",
                "marca": "No encontrado",
                "linea": "No encontrada",
                "modelo": "No encontrado",
                "status": "success"
            }

            import re
            
            # 1. Marca, Modelo y Línea
            # Buscamos en el texto plano extraído anteriormente
            marca_match = re.search(r"MARCA:?\s*([^\n]+)", content, re.I)
            if marca_match: res["marca"] = marca_match.group(1).strip()
            
            linea_match = re.search(r"LÍNEA:?\s*([^\n]+)", content, re.I)
            if linea_match: res["linea"] = linea_match.group(1).strip()
            
            modelo_match = re.search(r"MODELO:?\s*(\d{4})", content, re.I)
            if modelo_match: res["modelo"] = modelo_match.group(1).strip()

            # Extraemos Fecha de Matrícula Inicial (Muy importante para la regla de los 2 años)
            matricula_match = re.search(r"Fecha de Matrícula Inicial:?\s*(\d{2}/\d{2}/\d{4})", content, re.I)
            fecha_matricula = matricula_match.group(1).strip() if matricula_match else None
            if fecha_matricula: 
                 res["fecha_matricula"] = fecha_matricula
                 print(f"[*] Fecha de Matrícula detectada: {fecha_matricula}", file=sys.stderr)

            # 2. SOAT
            try:
                print("[*] Expandiendo sección SOAT...", file=sys.stderr)
                # Buscamos el header específico del panel de SOAT
                soat_header = page.locator("mat-expansion-panel-header").filter(has_text=re.compile(r"Póliza SOAT", re.I))
                await soat_header.click()
                await asyncio.sleep(3) # Tiempo extra para carga de tabla
                
                # Intentar encontrar la fila VIGENTE
                vigente_row = page.locator("tr").filter(has_text=re.compile(r"VIGENTE", re.I))
                if await vigente_row.count() > 0:
                    cells = await vigente_row.first.locator("td").all_inner_texts()
                    if len(cells) >= 4:
                        res["soat"] = cells[3].strip()
                        print(f"[+] SOAT Vigente: {res['soat']}", file=sys.stderr)
                else:
                    # Fallback: buscar cualquier fecha si no hay marcada como vigente
                    print("[!] No hay fila VIGENTE. Buscando última fecha...", file=sys.stderr)
                    all_dates = re.findall(r"(\d{2}/\d{2}/\d{4})", await page.inner_text("body"))
                    if all_dates: res["soat"] = all_dates[-1]
            except Exception as e:
                print(f"[!] Error en sección SOAT: {e}", file=sys.stderr)

            # 3. RTM
            try:
                print("[*] Expandiendo sección RTM...", file=sys.stderr)
                rtm_header = page.locator("mat-expansion-panel-header").filter(has_text=re.compile(r"Revisión Técnico", re.I))
                await rtm_header.click()
                await asyncio.sleep(3)
                
                # Buscar fila con SI en columna Vigente
                rtm_row = page.locator("tr").filter(has_text=re.compile(r"\bSI\b", re.I))
                found_rtm = False
                for i in range(await rtm_row.count()):
                    cells = await rtm_row.nth(i).locator("td").all_inner_texts()
                    if len(cells) >= 5 and cells[4].strip().upper() == "SI":
                        res["rtm"] = cells[2].strip()
                        found_rtm = True
                        print(f"[+] RTM Vigente: {res['rtm']}", file=sys.stderr)
                        break
                
                # Regla de +2 años si no hay RTM
                if not found_rtm and fecha_matricula:
                    from datetime import datetime
                    try:
                        d_mat = datetime.strptime(fecha_matricula, "%d/%m/%Y")
                        d_venc = d_mat.replace(year=d_mat.year + 2)
                        res["rtm"] = d_venc.strftime("%d/%m/%Y")
                        print(f"[*] RTM no vigente. Usando Matrícula+2: {res['rtm']}", file=sys.stderr)
                    except: pass
            except Exception as e:
                print(f"[!] Error en sección RTM: {e}", file=sys.stderr)

            await browser.close()
            # Devolvemos TODO el objeto res para que el frontend tenga los campos, 
            # aunque solo muestre SOAT y RTM
            res["status"] = "success"
            res["placa"] = placa
            return res

        except Exception as e:
            if browser: await browser.close()
            print(f"[!!] Error fatal en sync_runt: {e}", file=sys.stderr)
            return {"status": "error", "message": f"Error en automatización OCR: {str(e)}"}

if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(1)
    p, n = sys.argv[1], sys.argv[2]
    loop = asyncio.get_event_loop()
    
    # Ejecutamos la lógica primero
    resultado_obj = loop.run_until_complete(run_sync(p, n))
    
    # Imprimimos los marcadores AL FINAL para que nada se cuele entre ellos
    print("\n---RESULT_START---")
    print(json.dumps(resultado_obj))
    print("---RESULT_END---")
