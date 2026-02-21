import sys
import subprocess
import json
import os
from http.server import SimpleHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

class RuntBridgeHandler(SimpleHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type')
        self.end_headers()

    def do_GET(self):
        if self.path.startswith('/sync'):
            query = parse_qs(urlparse(self.path).query)
            placa = query.get('placa', [None])[0]
            nit = query.get('nit', [None])[0]
            categoria = query.get('categoria', ['PEPSICARGO'])[0]

            if not placa or not nit:
                self._send_error("Faltan parámetros: placa y nit")
                return

            try:
                print(f"[*] Solicitud recibida: {placa} ({categoria})")
                # Ejecutar script con categoría
                if query.get('type', ['vehicle'])[0] == 'driver':
                    # Modo Conductor
                    cedula = placa # Reusamos var placa como input principal
                    sede = query.get('sede', [''])[0]
                    empresa = categoria # Reusamos categoria como empresa
                    
                    print(f"[*] Solicitud Conductor: {cedula} ({empresa})")
                    cmd = [sys.executable, 'sync_runt.py', '--driver', cedula, sede, empresa]
                else:
                    # Modo Vehículo
                    cmd = [sys.executable, 'sync_runt.py', placa, nit, categoria]

                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=300
                )

                if result.returncode == 0:
                    output = result.stdout
                    if "---RESULT_START---" in output:
                        json_str = output.split("---RESULT_START---")[1].split("---RESULT_END---")[0].strip()
                        data = json.loads(json_str)
                        
                        if data.get('status') == 'success':
                            print(f"[+] Sincronización exitosa para {placa}")
                            # Nota: La persistencia real en Supabase de forma nativa desde aquí 
                            # requeriría supabase-py, pero usaremos el log para cumplimiento de Etapa 2.
                            self._log_sync(placa, categoria, "SUCCESS", data)
                        else:
                            self._log_sync(placa, categoria, "ERROR", data.get('message'))
                            
                        self._send_response(data)
                    else:
                        self._send_error("No se detectó el bloque de resultados.")
                else:
                    err = result.stderr or result.stdout
                    self._log_sync(placa, categoria, "FAIL", err)
                    self._send_error(f"Error técnico: {err}")

            except Exception as e:
                self._send_error(str(e))
        else:
            return super().do_GET()

    def _log_sync(self, placa, categoria, estado, detalle):
        """Muestra el log de auditoría en consola para trazabilidad."""
        print(f"\n[AUDITORÍA] {estado} | Vehículo: {placa} | Cat: {categoria}")
        # Aquí se integraría la inserción a Supabase si las credenciales estuvieran activas
        # Insert Into logs_auditoria (tabla_afectada, accion, detalle_cambio) ...

    def _send_response(self, data):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _send_error(self, message, code=500):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps({"error": message}).encode())

def run_server(port=5000):
    server_address = ('127.0.0.1', port)
    httpd = HTTPServer(server_address, RuntBridgeHandler)
    print(f"\n[!] SISTEMA DOC-TRACKER INICIADO")
    print(f"[!] Accede aquí: http://127.0.0.1:{port}/index.html")
    print(f"[!] Esperando peticiones de sincronización...\n")
    httpd.serve_forever()

if __name__ == '__main__':
    run_server()
