#!/usr/bin/env python3
"""
sarndbox_falso.py — Un "SARndbox de mentira" para probar sin Kinect ni proyector.

Escribe archivos .dem en la ruta indicada, con el MISMO formato que la
herramienta BathymetrySaverTool del SARndbox 2.6 (formato USGS DEM en texto,
registros de 1024 caracteres, una columna por perfil, de sur a norte).
El código de escritura es una traducción directa de BathymetrySaverTool.cpp
(función writeDEMFile) del código fuente del SARndbox 2.6 de Oliver Kreylos.

Cuándo guarda un relieve nuevo:
  - cada --cada segundos (0 = nunca automáticamente),
  - al presionar Enter en la terminal (si hay terminal),
  - al recibir la señal USR1  (kill -USR1 <pid>), útil para pruebas.
Se cierra con Ctrl+C, con "q" + Enter, con la señal TERM, o al pasar --duracion.

Uso:
  python3 scripts/sarndbox_falso.py --dem ~/SARndbox-capturas/BathymetrySaverTool.dem --cada 20
"""

import argparse
import math
import os
import select
import signal
import sys
import threading
import time

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(AQUI), "panel"))

# --------------------------------------------------------------------------
# Escritura del formato .dem (igual que BathymetrySaverTool.cpp)
# --------------------------------------------------------------------------


def _int6(v):
    return "%6d" % int(v)


def _float4(v):
    """printFloat4: mantisa con 5 decimales en 7 caracteres + 'e' + exponente '+000'."""
    if v == 0.0:
        return "0.00000e+000"
    exp = int(math.floor(math.log10(abs(v))))
    man = v / (10.0 ** exp)
    return "%7.5f" % man + "e" + "%+04d" % exp


def _float8(v):
    """printFloat8: mantisa con 15 decimales en 19 caracteres + 'D' + exponente '+000'."""
    if v == 0.0:
        return "  0.000000000000000D+000"
    exp = int(math.floor(math.log10(abs(v))))
    man = v / (10.0 ** exp)
    return "%19.15f" % man + "D" + "%+04d" % exp


def _rellenar(partes, tam):
    """Agrega espacios hasta el siguiente múltiplo de 1024."""
    destino = (tam + 1023) & ~1023
    if destino > tam:
        partes.append(" " * (destino - tam))
    return destino


def texto_dem(z_cm, celda_cm, gs=1.0):
    """z_cm: matriz (filas, columnas) con fila 0 = NORTE, en cm de arena.
    Devuelve el contenido del archivo .dem como texto."""
    import numpy as np

    filas, cols = z_cm.shape
    # el buffer del SARndbox va de sur a norte (fila 0 = sur)
    buf = np.asarray(z_cm, dtype=np.float32)[::-1]
    p = []

    cab = "Augmented Reality Sandbox bathymetry grid"
    p.append(cab.ljust(144))
    p += [_int6(1), _int6(1), _int6(1), _int6(10)]
    p += [_float8(0.0)] * 15
    p += [_int6(2), _int6(2)]
    p.append(_int6(4))
    centro = (609959.0, 4268028.0)
    oeste = centro[0] - (cols - 1) * celda_cm * gs * 0.5
    este = centro[0] + (cols - 1) * celda_cm * gs * 0.5
    norte = centro[1] + (filas - 1) * celda_cm * gs * 0.5
    sur = centro[1] - (filas - 1) * celda_cm * gs * 0.5
    p += [_float8(oeste), _float8(sur), _float8(oeste), _float8(norte),
          _float8(este), _float8(norte), _float8(este), _float8(sur)]
    emin, emax = float(buf.min()) * gs, float(buf.max()) * gs
    p += [_float8(emin), _float8(emax)]
    base = 0.0
    rango = max(abs(emax - base), abs(emin - base))
    zscale = 1000.0 if rango == 0.0 else 10.0 ** math.floor(math.log10(9999.0 / rango))
    p.append(_float8(0.0))
    p.append(_int6(0))
    p += [_float4(celda_cm * gs), _float4(celda_cm * gs), _float4(1.0 / zscale)]
    p += [_int6(1), _int6(cols)]
    tam = 864
    assert len("".join(p)) == tam

    for c in range(cols):
        tam = _rellenar(p, tam)
        col = buf[:, c]
        p += [_int6(1), _int6(c + 1), _int6(filas), _int6(1),
              _float8(oeste + c * celda_cm * gs), _float8(sur), _float8(base),
              _float8(float(col.min()) * gs), _float8(float(col.max()) * gs)]
        tam += 6 * 4 + 24 * 5
        for v in col:
            destino = (tam + 1023) & ~1023
            if destino - tam < 10:   # los últimos 4 caracteres de cada registro van en blanco
                tam = _rellenar(p, tam)
            p.append(_int6(math.floor((float(v) * gs - base) * zscale + 0.5)))
            tam += 6
    tam = _rellenar(p, tam)
    p += [_int6(0)] * 10
    tam += 60
    _rellenar(p, tam)
    return "".join(p)


def escribir_dem(ruta, z_cm, celda_cm):
    """Escribe el archivo directamente (como el SARndbox real, sin archivo temporal)."""
    datos = texto_dem(z_cm, celda_cm).encode("latin-1")
    with open(ruta, "wb") as f:
        f.write(datos)


# --------------------------------------------------------------------------
# Terrenos que van cambiando (como si alguien moviera la arena)
# --------------------------------------------------------------------------


def terreno(n):
    import numpy as np
    import analizador_terreno as at

    z, celda = at.terreno_demo_cm(deslave=(n % 2 == 1), semilla=3 + n // 2)
    filas, cols = z.shape
    y, x = np.mgrid[0:filas, 0:cols] * celda
    # un montículo que se va moviendo, para que cada captura sea distinta
    cx, cy = 20 + (n * 13) % 60, 15 + (n * 7) % 45
    z = z + 1.5 * np.exp(-(((x - cx) / 5) ** 2 + ((y - cy) / 5) ** 2))
    return z, celda


# --------------------------------------------------------------------------


def main():
    ap = argparse.ArgumentParser(description="SARndbox falso para pruebas sin hardware.")
    ap.add_argument("--dem", required=True, help="ruta del .dem a escribir")
    ap.add_argument("--cada", type=float, default=20, help="segundos entre capturas (0 = solo con Enter)")
    ap.add_argument("--duracion", type=float, default=0, help="cerrar solo después de N segundos (0 = nunca)")
    a = ap.parse_args()

    ruta = os.path.abspath(os.path.expanduser(a.dem))
    os.makedirs(os.path.dirname(ruta), exist_ok=True)

    import dependencias  # noqa: E402  (solo revisa; no instala nada)
    dependencias.verificar(auto_si=False, no_instalar=True)

    pedir = threading.Event()
    salir = threading.Event()
    signal.signal(signal.SIGUSR1, lambda *_: pedir.set())
    signal.signal(signal.SIGTERM, lambda *_: salir.set())
    signal.signal(signal.SIGHUP, lambda *_: salir.set())

    print("=" * 60)
    print("  SARndbox FALSO (modo simulación)")
    print(f"  Guardando en: {ruta}")
    if a.cada > 0:
        print(f"  Captura automática cada {a.cada:g} s")
    hay_teclado = sys.stdin is not None and sys.stdin.isatty()
    if hay_teclado:
        print("  Enter = guardar relieve ahora     q + Enter = cerrar")
    print("=" * 60, flush=True)

    n = 0
    inicio = time.monotonic()
    proxima = inicio + 3 if a.cada > 0 else float("inf")   # la primera, a los 3 s
    try:
        while not salir.is_set():
            ahora = time.monotonic()
            if a.duracion > 0 and ahora - inicio >= a.duracion:
                print("Tiempo de simulación terminado; cerrando el SARndbox falso.", flush=True)
                break
            if hay_teclado:
                listo, _, _ = select.select([sys.stdin], [], [], 0.2)
                if listo:
                    linea = sys.stdin.readline()
                    if linea == "" or linea.strip().lower() == "q":
                        if linea == "":
                            hay_teclado = False   # se cerró la entrada; seguir sin teclado
                        else:
                            break
                    else:
                        pedir.set()
            else:
                time.sleep(0.2)
            if pedir.is_set() or time.monotonic() >= proxima:
                pedir.clear()
                z, celda = terreno(n)
                escribir_dem(ruta, z, celda)
                n += 1
                print(f"[{time.strftime('%H:%M:%S')}] Relieve guardado (captura falsa {n}).", flush=True)
                if a.cada > 0:
                    proxima = time.monotonic() + a.cada
    except KeyboardInterrupt:
        pass
    print("SARndbox falso cerrado.", flush=True)


if __name__ == "__main__":
    main()
