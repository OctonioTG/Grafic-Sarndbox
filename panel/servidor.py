#!/usr/bin/env python3
"""
servidor.py — Panel web del analizador de terreno del AR Sandbox.

Abre un servidor en la computadora del sandbox. Cualquier computadora o
celular en la misma red puede entrar desde el navegador (Chrome, etc.) y ver
el análisis en vivo, con historial de capturas y descargas.

Uso:
  python3 servidor.py --vigilar ~/SARndbox/BathymetrySaverTool.dem
  python3 servidor.py --demo                  # sin sandbox, con capturas de ejemplo

Opciones:
  --puerto 8000         puerto del servidor (por defecto 8000)
  --escala 10           metros de terreno por cada cm de arena
  --sin-navegador       no abrir el navegador al iniciar
  --si / --no-instalar  instalar librerías faltantes sin preguntar / no instalar

No usa librerías extra para el servidor: todo viene con Python.
"""

import argparse
import datetime as dt
import io
import json
import os
import queue
import re
import shutil
import signal
import socket
import socketserver
import subprocess
import sys
import threading
import time
import webbrowser
import zipfile
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)

import dependencias  # noqa: E402

if not ({"-h", "--help"} & set(sys.argv)):
    dependencias.verificar()

import numpy as np  # noqa: E402
import analizador_terreno as at  # noqa: E402
import qr  # noqa: E402
from matplotlib.colors import LightSource  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402

WEB = os.path.join(AQUI, "web")
MAX_HISTORIAL = 60          # capturas que se muestran en el historial
MAX_EN_MEMORIA = 6          # análisis completos guardados en memoria

# ============================ DATOS ==========================================


def _limpio(v):
    """Convierte tipos de numpy a JSON; NaN/inf -> None."""
    if isinstance(v, dict):
        return {k: _limpio(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_limpio(x) for x in v]
    if isinstance(v, np.ndarray):
        return _limpio(v.tolist())
    if isinstance(v, (np.floating, float)):
        return float(v) if np.isfinite(v) else None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, np.bool_):
        return bool(v)
    return v


class Almacen:
    """Guarda las capturas, sus análisis y avisa a los navegadores conectados."""

    def __init__(self, cfg, carpeta_historial):
        self.cfg = cfg
        self.carpeta = carpeta_historial
        os.makedirs(carpeta_historial, exist_ok=True)
        self.lock = threading.RLock()
        self.capturas = OrderedDict()        # id -> info básica
        self.analisis = OrderedDict()        # id -> resultado de at.calcular (LRU)
        self.comparaciones = OrderedDict()   # (a, b) -> resultado (LRU)
        self.siguiente_id = 1
        self.clientes = []                   # colas de eventos (SSE)
        self.estado_fuente = "esperando"

    # ---------- eventos en vivo ----------
    def avisar(self, tipo, datos=None):
        msg = f"event: {tipo}\ndata: {json.dumps(_limpio(datos or {}))}\n\n"
        with self.lock:
            for q in list(self.clientes):
                q.put(msg)

    # ---------- capturas ----------
    def agregar(self, z, celda, fuente, ruta=None, hora=None, avisar=True, resumir=True):
        with self.lock:
            cid = self.siguiente_id
            self.siguiente_id += 1
            self.capturas[cid] = {
                "id": cid, "hora": hora or dt.datetime.now(), "fuente": fuente, "ruta": ruta,
                "z": z.astype(np.float32), "celda": float(celda), "resumen": None,
            }
            while len(self.capturas) > MAX_HISTORIAL:
                self.capturas.popitem(last=False)
        if resumir:
            self._resumir(cid)
        if avisar:
            self.avisar("nueva_captura", {"id": cid})
        return cid

    def _resumir(self, cid):
        """Calcula el análisis y un resumen corto para el historial."""
        r = self.obtener(cid)
        ids = list(self.capturas)
        pos = ids.index(cid)
        deslaves = None
        if pos > 0:
            comp = self.comparacion(ids[pos - 1], cid)
            deslaves = None if comp is None else len(comp["eventos"])
        k = r["kpis"]
        with self.lock:
            self.capturas[cid]["resumen"] = {
                "inestable_lluvia": k["inestable_sat_pct"], "inundable": k["inund_pct"],
                "zmax": k["zmax"], "deslaves": deslaves,
            }

    def obtener(self, cid):
        with self.lock:
            if cid in self.analisis:
                self.analisis.move_to_end(cid)
                return self.analisis[cid]
            info = self.capturas.get(cid)
        if info is None:
            return None
        res = at.calcular(info["z"].astype(np.float64), info["celda"], self.cfg)
        res["sombreado"] = LightSource(315, 45).hillshade(res["z"], vert_exag=1, dx=info["celda"], dy=info["celda"])
        res["curvas"] = curvas_de_nivel(res["z"])
        with self.lock:
            self.analisis[cid] = res
            while len(self.analisis) > MAX_EN_MEMORIA:
                self.analisis.popitem(last=False)
        return res

    def comparacion(self, a, b):
        clave = (a, b)
        with self.lock:
            if clave in self.comparaciones:
                return self.comparaciones[clave]
            ia, ib = self.capturas.get(a), self.capturas.get(b)
        if ia is None or ib is None:
            return None
        res = at.comparar(ia["z"].astype(np.float64), ib["z"].astype(np.float64), ib["celda"], self.cfg)
        with self.lock:
            self.comparaciones[clave] = res
            while len(self.comparaciones) > MAX_EN_MEMORIA:
                self.comparaciones.popitem(last=False)
        return res

    def lista(self):
        with self.lock:
            return [{"id": c["id"], "hora": c["hora"].isoformat(timespec="seconds"),
                     "fuente": c["fuente"], "resumen": c["resumen"],
                     "filas": c["z"].shape[0], "cols": c["z"].shape[1]}
                    for c in reversed(self.capturas.values())]

    def cargar_historial(self):
        """Al iniciar, recupera las capturas guardadas en sesiones anteriores."""
        archivos = sorted(f for f in os.listdir(self.carpeta) if f.endswith(".dem"))[-MAX_HISTORIAL:]
        for f in archivos:
            ruta = os.path.join(self.carpeta, f)
            try:
                z, celda = at.cargar_terreno(ruta, self.cfg)
                m = re.search(r"(\d{8})_(\d{6})", f)
                hora = dt.datetime.strptime("".join(m.groups()), "%Y%m%d%H%M%S") if m else None
                self.agregar(z, celda, "SARndbox", ruta, hora, avisar=False, resumir=False)
            except Exception as e:
                print(f"  No pude leer {f}: {e}")
        if self.capturas:
            print(f"  {len(self.capturas)} captura(s) recuperadas del historial.")

            def resumir_todo():  # en segundo plano, de la más nueva a la más vieja
                for cid in reversed(list(self.capturas)):
                    try:
                        if self.capturas.get(cid, {}).get("resumen") is None:
                            self._resumir(cid)
                            self.avisar("actualizado", {"id": cid})
                    except Exception as e:
                        print(f"  No pude analizar la captura {cid}: {e}")
            threading.Thread(target=resumir_todo, daemon=True).start()


def curvas_de_nivel(z):
    """Curvas de nivel en coordenadas de celda (x = columna, y = fila)."""
    rel = float(np.nanmax(z) - np.nanmin(z))
    paso = at.intervalo_bonito(rel / 15) if rel > 0 else 1
    niveles = np.arange(np.ceil(np.nanmin(z) / paso) * paso, np.nanmax(z), paso)
    lineas = []
    if len(niveles):
        fig, ax = plt.subplots()
        cs = ax.contour(z, levels=niveles)
        for nivel, segs in zip(cs.levels, cs.allsegs):
            maestra = abs((nivel / paso) % 5) < 1e-6
            for s in segs:
                if len(s) < 3:
                    continue
                s = s[::2] if len(s) > 40 else s
                lineas.append({"nivel": float(nivel), "maestra": bool(maestra),
                               "pts": np.round(s.ravel(), 1).tolist()})
        plt.close(fig)
    return {"intervalo": paso, "lineas": lineas}


def detalle_captura(alm, cid):
    r = alm.obtener(cid)
    if r is None:
        return None
    info = alm.capturas[cid]
    z, h = r["z"], r["hidro"]
    ids = list(alm.capturas)
    pos = ids.index(cid)
    cuencas = [{"n": i + 1, "area": float(a)} for i, a in enumerate(h["areas_cuencas"])]
    p = r["perfil"]
    paso = max(1, len(p["dist"]) // 400)
    return _limpio({
        "id": cid, "hora": info["hora"].isoformat(timespec="seconds"), "fuente": info["fuente"],
        "filas": z.shape[0], "cols": z.shape[1], "celda": r["celda"],
        "origen": [alm.cfg["origen_x"], alm.cfg["origen_y"]],
        "anterior": ids[pos - 1] if pos > 0 else None,
        "kpis": r["kpis"], "cuadro": [{"clase": c, "seco": s, "lluvia": l} for c, s, l in r["cuadro"]],
        "cuencas": cuencas,
        "curva": {"nivel": r["curva"][0], "area": r["curva"][1]},
        "perfil": {"dist": p["dist"][::paso], "elev": p["elev"][::paso], "agua": p["agua"][::paso],
                   "inestable": (p["fs"][::paso] < 1), "a": [p["x"][0], p["y"][0]], "b": [p["x"][-1], p["y"][-1]]},
        "curvas": r["curvas"],
        "parametros": {k: alm.cfg[k] for k in ("metros_por_cm", "escala_vertical", "cohesion_kpa",
                                                "friccion_grados", "peso_suelo_kn_m3", "espesor_suelo_m", "saturacion")},
    })


def capa_binaria(alm, cid, nombre):
    r = alm.obtener(cid)
    if r is None:
        return None
    h = r["hidro"]
    capas = {
        "elevacion": r["z"], "sombreado": r["sombreado"], "pendiente": r["pend"], "orientacion": r["orient"],
        "fs_seco": r["fs_seco"], "fs_lluvia": r["fs_sat"], "rios": h["rios"].astype(float),
        "cuencas": h["cuencas"].astype(float), "inundacion": r["prof"],
        "acumulacion": np.log10(h["acum"]),
    }
    if nombre not in capas:
        return None
    a = np.asarray(capas[nombre], dtype=np.float32)
    return np.where(np.isfinite(a), a, np.nan).astype("<f4").tobytes()


def detalle_comparacion(alm, a, b):
    c = alm.comparacion(a, b)
    if c is None:
        return {"error": "Las capturas tienen tamaños distintos o no existen."}
    lim = float(np.nanmax(np.abs(c["dif"])))
    return _limpio({
        "a": a, "b": b, "lod": c["lod"], "vol_erosion": c["vol_erosion"], "vol_deposito": c["vol_deposito"],
        "area_cambio": c["area_cambio"], "max_abs": lim,
        "eventos": [{k: ev[k] for k in ("vol_perdido", "vol_depositado", "desplazamiento", "caida",
                                        "pend_origen", "en_riesgo", "centro", "destino")} for ev in c["eventos"]],
    })


def zip_captura(alm, cid):
    r = alm.obtener(cid)
    info = alm.capturas.get(cid)
    if r is None:
        return None
    mem = io.BytesIO()
    with zipfile.ZipFile(mem, "w", zipfile.ZIP_DEFLATED) as zf:
        for nombre, capa in at.capas_exportables(r):
            tmp = io.StringIO()
            f, c = capa.shape
            tmp.write(f"ncols {c}\nnrows {f}\nxllcorner {alm.cfg['origen_x']:.3f}\nyllcorner {alm.cfg['origen_y']:.3f}\n"
                      f"cellsize {r['celda']:.6f}\nNODATA_value -9999\n")
            capa = np.asarray(capa, float)
            np.savetxt(tmp, np.where(np.isfinite(capa), capa, -9999), fmt="%.3f")
            zf.writestr(f"{nombre}.asc", tmp.getvalue())
        if info["ruta"] and os.path.exists(info["ruta"]):
            zf.write(info["ruta"], "captura_original.dem")
        k = r["kpis"]
        zf.writestr("LEEME.txt", (
            f"Captura {cid} — {info['hora']:%d/%m/%Y %H:%M:%S}\n"
            f"Escala: 1 cm de arena = {alm.cfg['metros_por_cm']} m. Celda: {r['celda']:.3f} m.\n"
            f"Elevación: {k['zmin']:.1f} a {k['zmax']:.1f} m.\n\n"
            "Los archivos .asc son Esri ASCII Grid: se abren en QGIS (arrastrar a la ventana),\n"
            "ArcGIS o Global Mapper. Si piden sistema de referencia, usar EPSG:32613.\n\n"
            "elevacion.asc         modelo digital de elevación (m)\n"
            "pendiente.asc         pendiente (grados)\n"
            "orientacion.asc       orientación de laderas (grados desde el norte)\n"
            "fs_seco.asc           factor de seguridad de laderas, suelo seco (<1 inestable)\n"
            "fs_lluvia.asc         factor de seguridad con suelo saturado\n"
            "acumulacion_flujo.asc celdas que drenan a cada punto\n"
            "cuencas.asc           número de cuenca (0 = cuencas pequeñas)\n"
            "hand.asc              altura sobre el río más cercano (m)\n"
            "inundacion.asc        profundidad de agua en el escenario de inundación (m)\n"))
    return mem.getvalue()


def miniatura_png(alm, cid):
    with alm.lock:
        info = alm.capturas.get(cid)
    if info is None:
        return None
    z = info["z"].astype(np.float64)
    paso = max(1, z.shape[1] // 160)
    z = z[::paso, ::paso]
    rgb = LightSource(315, 45).shade(z, cmap=plt.get_cmap("gist_earth"), vert_exag=1,
                                     dx=info["celda"] * paso, dy=info["celda"] * paso, blend_mode="soft")
    buf = io.BytesIO()
    plt.imsave(buf, rgb, format="png")
    return buf.getvalue()

# ============================ RED ============================================


def ips_locales():
    ips = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ips.append(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        salida = subprocess.run(["hostname", "-I"], capture_output=True, text=True, timeout=3).stdout
        ips += salida.split()
    except Exception:
        pass
    vistas = []
    for ip in ips:
        if ":" in ip or ip.startswith("127.") or ip.startswith("172.17.") or ip in vistas:
            continue
        vistas.append(ip)
    return vistas


def crear_manejador(alm, puerto):
    tipos = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
             ".js": "application/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png"}

    class Manejador(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *a):
            pass  # sin ruido en la terminal

        def enviar(self, cuerpo, tipo, codigo=200, extra=None):
            if isinstance(cuerpo, str):
                cuerpo = cuerpo.encode("utf-8")
            self.send_response(codigo)
            self.send_header("Content-Type", tipo)
            self.send_header("Content-Length", str(len(cuerpo)))
            if "Cache-Control" not in (extra or {}):
                self.send_header("Cache-Control", "no-store")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(cuerpo)

        def json(self, datos, codigo=200):
            self.enviar(json.dumps(datos, ensure_ascii=False), "application/json; charset=utf-8", codigo)

        def no_encontrado(self):
            self.json({"error": "No encontrado"}, 404)

        def do_GET(self):
            ruta = urlparse(self.path).path
            try:
                self.rutear(ruta)
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception as e:  # nunca tumbar el servidor por una petición
                import traceback
                traceback.print_exc()
                try:
                    self.json({"error": str(e)}, 500)
                except Exception:
                    pass

        def rutear(self, ruta):
            if ruta in ("/", "/index.html"):
                return self.archivo("index.html")
            if ruta.startswith("/static/"):
                return self.archivo(ruta[len("/static/"):])
            if ruta == "/api/estado":
                urls = [f"http://{ip}:{puerto}" for ip in ips_locales()]
                return self.json({"capturas": alm.lista(), "urls": urls, "fuente": alm.estado_fuente,
                                  "local": f"http://localhost:{puerto}"})
            if ruta == "/api/qr.svg":
                urls = [f"http://{ip}:{puerto}" for ip in ips_locales()] or [f"http://localhost:{puerto}"]
                return self.enviar(qr.qr_svg(urls[0]), "image/svg+xml")
            if ruta == "/api/eventos":
                return self.eventos()
            m = re.fullmatch(r"/api/captura/(\d+)", ruta)
            if m:
                d = detalle_captura(alm, int(m.group(1)))
                return self.json(d) if d else self.no_encontrado()
            m = re.fullmatch(r"/api/captura/(\d+)/capa/(\w+)", ruta)
            if m:
                b = capa_binaria(alm, int(m.group(1)), m.group(2))
                return self.enviar(b, "application/octet-stream") if b else self.no_encontrado()
            m = re.fullmatch(r"/api/captura/(\d+)/miniatura\.png", ruta)
            if m:
                b = miniatura_png(alm, int(m.group(1)))
                return self.enviar(b, "image/png", extra={"Cache-Control": "max-age=86400"}) if b else self.no_encontrado()
            m = re.fullmatch(r"/api/captura/(\d+)/descargar", ruta)
            if m:
                cid = int(m.group(1))
                b = zip_captura(alm, cid)
                if not b:
                    return self.no_encontrado()
                nombre = f"sandbox_captura_{cid}_{alm.capturas[cid]['hora']:%Y%m%d_%H%M%S}.zip"
                return self.enviar(b, "application/zip", extra={"Content-Disposition": f'attachment; filename="{nombre}"'})
            m = re.fullmatch(r"/api/comparar/(\d+)/(\d+)", ruta)
            if m:
                return self.json(detalle_comparacion(alm, int(m.group(1)), int(m.group(2))))
            m = re.fullmatch(r"/api/comparar/(\d+)/(\d+)/capa", ruta)
            if m:
                c = alm.comparacion(int(m.group(1)), int(m.group(2)))
                if c is None:
                    return self.no_encontrado()
                d = np.where(np.abs(c["dif"]) > c["lod"], c["dif"], np.nan).astype("<f4")
                return self.enviar(d.tobytes(), "application/octet-stream")
            return self.no_encontrado()

        def archivo(self, nombre):
            ruta = os.path.normpath(os.path.join(WEB, nombre))
            if not ruta.startswith(WEB) or not os.path.isfile(ruta):
                return self.no_encontrado()
            with open(ruta, "rb") as f:
                self.enviar(f.read(), tipos.get(os.path.splitext(ruta)[1], "application/octet-stream"))

        def eventos(self):
            q = queue.Queue()
            with alm.lock:
                alm.clientes.append(q)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            try:
                self.wfile.write(b"event: hola\ndata: {}\n\n")
                self.wfile.flush()
                while True:
                    try:
                        msg = q.get(timeout=15)
                    except queue.Empty:
                        msg = ": ping\n\n"
                    self.wfile.write(msg.encode("utf-8"))
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                with alm.lock:
                    if q in alm.clientes:
                        alm.clientes.remove(q)
                self.close_connection = True

    return Manejador

class Servidor(ThreadingHTTPServer):
    """Igual que ThreadingHTTPServer, pero sin buscar el nombre de la computadora
    en la red (socket.getfqdn), que en redes sin DNS tarda hasta ~30 s en arrancar."""

    def server_bind(self):
        socketserver.TCPServer.server_bind(self)
        self.server_name = "localhost"
        self.server_port = self.server_address[1]


# ============================ VIGILANCIA =====================================


def vigilar(alm, ruta):
    """Revisa cada segundo si el SARndbox guardó una captura nueva."""
    ultima = os.path.getmtime(ruta) if os.path.exists(ruta) else None
    alm.estado_fuente = "vigilando"
    while True:
        try:
            if os.path.exists(ruta):
                mod = os.path.getmtime(ruta)
                if mod != ultima:
                    tam = -1
                    while tam != os.path.getsize(ruta):  # esperar a que termine de escribirse
                        tam = os.path.getsize(ruta)
                        time.sleep(0.5)
                    ultima = os.path.getmtime(ruta)
                    ahora = dt.datetime.now()
                    copia = os.path.join(alm.carpeta, f"captura_{ahora:%Y%m%d_%H%M%S}.dem")
                    shutil.copy2(ruta, copia)
                    try:
                        z, celda = at.cargar_terreno(copia, alm.cfg)
                    except Exception as e:
                        print(f"No pude leer la captura ({e}); espero la siguiente.")
                        alm.avisar("fallo", {"mensaje": "No se pudo leer la última captura del SARndbox."})
                        continue
                    print(f"[{ahora:%H:%M:%S}] Nueva captura, analizando...")
                    alm.avisar("analizando", {})
                    cid = alm.agregar(z, celda, "SARndbox", copia, ahora)
                    print(f"[{dt.datetime.now():%H:%M:%S}] Captura {cid} lista.")
        except Exception as e:
            print(f"Error vigilando el archivo: {e}")
        time.sleep(1)


def main():
    ap = argparse.ArgumentParser(description="Panel web del analizador de terreno del AR Sandbox.")
    ap.add_argument("--vigilar", metavar="ARCHIVO", help="archivo .dem que guarda el SARndbox")
    ap.add_argument("--demo", action="store_true", help="cargar capturas de ejemplo")
    ap.add_argument("--puerto", type=int, default=8000)
    ap.add_argument("--escala", type=float, help="metros de terreno por cm de arena")
    ap.add_argument("--sin-navegador", action="store_true")
    ap.add_argument("--historial", metavar="CARPETA", help="carpeta donde guardar las capturas (por defecto historial/)")
    ap.add_argument("--si", action="store_true")
    ap.add_argument("--no-instalar", action="store_true")
    a = ap.parse_args()

    if not a.vigilar and not a.demo:
        ap.error("indica --vigilar ARCHIVO (el .dem del SARndbox) o --demo")

    cfg = dict(at.CONFIG)
    if a.escala:
        cfg["metros_por_cm"] = a.escala
    carpeta = os.path.join(AQUI, "historial" if not a.demo else "historial_demo")
    if a.historial:
        carpeta = os.path.abspath(os.path.expanduser(a.historial))
    alm = Almacen(cfg, carpeta)

    if a.demo:
        alm.estado_fuente = "demo"
        print("Cargando capturas de ejemplo...")
        z_cm, c_cm = at.terreno_demo_cm()
        hora = dt.datetime.now() - dt.timedelta(minutes=3)
        alm.agregar(*at.a_metros(z_cm, c_cm, cfg), "Demostración", None, hora, avisar=False)
        alm.agregar(at.a_metros(at.terreno_demo_cm(deslave=True)[0], c_cm, cfg)[0], c_cm * cfg["metros_por_cm"],
                    "Demostración", None, dt.datetime.now(), avisar=False)
    else:
        print("Revisando historial...")
        alm.cargar_historial()
        hilo = threading.Thread(target=vigilar, args=(alm, os.path.expanduser(a.vigilar)), daemon=True)
        hilo.start()

    try:
        srv = Servidor(("0.0.0.0", a.puerto), crear_manejador(alm, a.puerto))
    except OSError:
        sys.exit(f"El puerto {a.puerto} está ocupado. Usa otro con --puerto 8080")
    srv.daemon_threads = True

    print("\n" + "=" * 60)
    print("  Panel del AR Sandbox funcionando")
    print(f"  En esta computadora:  http://localhost:{a.puerto}")
    for ip in ips_locales():
        print(f"  Desde otras (misma red):  http://{ip}:{a.puerto}")
    print("  Ctrl+C para detener")
    print("=" * 60 + "\n")
    if a.vigilar:
        print(f"Vigilando {a.vigilar}. Guarda el relieve en el SARndbox para analizar.\n")
    def _cerrar(*_):  # el lanzador pide cerrar (TERM) o se cerró la sesión (HUP)
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, _cerrar)
    signal.signal(signal.SIGHUP, _cerrar)
    if not a.sin_navegador:
        threading.Timer(1.0, lambda: webbrowser.open(f"http://localhost:{a.puerto}")).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.")
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()
