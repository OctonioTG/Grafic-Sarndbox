"""Revisa que estén instaladas las librerías y ofrece instalar las que falten.
En Linux Mint usa primero apt (lo más estable) y luego pip como plan B."""

import importlib
import importlib.util
import os
import shutil
import subprocess
import sys

# (módulo, paquete pip, paquete apt en Mint/Ubuntu, para qué sirve)
REQUERIDAS = [
    ("numpy", "numpy", "python3-numpy", "cálculos con la malla de alturas"),
    ("matplotlib", "matplotlib", "python3-matplotlib", "curvas de nivel y mapas"),
    ("scipy", "scipy", "python3-scipy", "detectar zonas de deslave"),
]


def esta_instalado(modulo):
    importlib.invalidate_caches()
    return importlib.util.find_spec(modulo) is not None


def _preguntar(texto, auto_si):
    if auto_si:
        return True
    try:
        return input(f"{texto} [s/n]: ").strip().lower() in ("s", "si", "sí", "y", "yes")
    except EOFError:
        return False


def _instalar_con_apt(paquetes):
    sudo = [] if os.geteuid() == 0 else ["sudo"]
    print(f"\n  Instalando con apt: {' '.join(paquetes)}  (te va a pedir tu contraseña)")
    subprocess.run(sudo + ["apt-get", "update", "-qq"])
    if subprocess.run(sudo + ["apt-get", "install", "-y"] + paquetes).returncode != 0:
        for p in paquetes:
            subprocess.run(sudo + ["apt-get", "install", "-y", p])


def _instalar_con_pip(paquete):
    base = [sys.executable, "-m", "pip", "install"]
    print(f"  Instalando {paquete} con pip...")
    r = subprocess.run(base + [paquete], capture_output=True, text=True)
    if r.returncode != 0 and "externally-managed" in (r.stderr + r.stdout):
        r = subprocess.run(base + ["--user", "--break-system-packages", paquete],
                           capture_output=True, text=True)
    if r.returncode != 0:
        ultima = (r.stderr or r.stdout).strip().splitlines()
        print(f"  No se pudo instalar {paquete}: {ultima[-1] if ultima else 'error'}")
        return
    import site
    if site.getusersitepackages() not in sys.path:
        site.addsitedir(site.getusersitepackages())


def verificar(auto_si=None, no_instalar=None):
    """Llamar ANTES de importar numpy/matplotlib/scipy."""
    if auto_si is None:
        auto_si = "--si" in sys.argv
    if no_instalar is None:
        no_instalar = "--no-instalar" in sys.argv
    faltan = [lib for lib in REQUERIDAS if not esta_instalado(lib[0])]
    if not faltan:
        return
    print("Faltan librerías:")
    for lib in faltan:
        print(f"  [FALTA] {lib[0]:<11} {lib[3]}")
    en_venv = sys.prefix != getattr(sys, "base_prefix", sys.prefix)
    if not no_instalar and _preguntar("¿Las instalo?", auto_si):
        if shutil.which("apt-get") and not en_venv:
            _instalar_con_apt([l[2] for l in faltan])
        for lib in faltan:
            if not esta_instalado(lib[0]):
                _instalar_con_pip(lib[1])
    siguen = [l[0] for l in REQUERIDAS if not esta_instalado(l[0])]
    if siguen:
        sys.exit(f"No puedo continuar; faltan: {', '.join(siguen)}")
    print("Todo listo.\n")
