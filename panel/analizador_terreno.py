#!/usr/bin/env python3
"""
analizador_terreno.py — Análisis geológico del relieve del AR Sandbox.

Lee el relieve que guarda el SARndbox (herramienta "BathymetrySaverTool",
archivo .dem) y genera un reporte con:

  1. Relieve general     elevaciones, sombreado y curvas de nivel
  2. Pendientes          pendiente y orientación de laderas
  3. Riesgo de deslave   factor de seguridad (modelo de talud infinito),
                         en seco y con el suelo saturado por lluvia
  4. Drenaje             ríos, acumulación de flujo y cuencas
  5. Inundación          zonas inundables (método HAND) y encharcamientos
  6. Perfil topográfico  corte del terreno a lo largo de una línea
  7. Cambios / deslaves  compara con la captura anterior: erosión,
                         depósito, volumen movido y deslaves detectados

Todo sale en una carpeta con imágenes PNG, un reporte HTML y rasters .asc
para abrir en QGIS / ArcGIS.

Uso:
  python3 analizador_terreno.py --demo                 # terreno de ejemplo
  python3 analizador_terreno.py --demo-deslave         # ejemplo con antes/después
  python3 analizador_terreno.py --archivo terreno.dem  # analizar un archivo
  python3 analizador_terreno.py --archivo nuevo.dem --anterior viejo.dem
  python3 analizador_terreno.py --vigilar BathymetrySaverTool.dem --abrir
      (modo en vivo: cada vez que el SARndbox guarda, analiza y compara
       con la captura anterior; --abrir muestra el reporte en el navegador)

Opciones útiles:
  --escala 10          metros de terreno por cada cm de arena
  --lluvia 0.5         saturación del suelo de 0 (seco) a 1 (saturado)
  --nivel-agua 15      metros que sube el agua sobre los ríos (inundación)
  --perfil 0.1,0.5,0.9,0.5   línea del perfil (x1,y1,x2,y2 de 0 a 1)
  --si / --no-instalar       instalar librerías faltantes sin preguntar / no instalar
"""

import argparse
import base64
import datetime as dt
import heapq
import os
import shutil
import sys
import time

import dependencias

if not ({"-h", "--help"} & set(sys.argv)):
    dependencias.verificar()

import numpy as np  # noqa: E402
import matplotlib  # noqa: E402
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.colors import LightSource, ListedColormap, BoundaryNorm  # noqa: E402
from scipy import ndimage  # noqa: E402

# ===================== CONFIGURACIÓN =========================================

CONFIG = {
    # --- Escala ---
    # El SARndbox guarda el relieve en centímetros de arena. Esto lo convierte
    # a un terreno "real": 1 cm de arena = metros_por_cm metros.
    "metros_por_cm": 10.0,
    "escala_vertical": 1.0,       # exageración vertical (1 = igual que la horizontal)
    "elevacion_base_m": 1400.0,   # elevación que se le asigna al nivel 0 del sandbox
    "origen_x": 400000.0,         # esquina inferior izquierda (coordenadas ficticias)
    "origen_y": 3170000.0,

    # --- Suelo (para riesgo de deslave) ---
    "cohesion_kpa": 5.0,          # cohesión del suelo (0 = arena suelta)
    "friccion_grados": 32.0,      # ángulo de fricción interna
    "peso_suelo_kn_m3": 19.0,     # peso específico del suelo
    "espesor_suelo_m": 2.0,       # profundidad de la capa que se puede deslizar
    "saturacion": 1.0,            # escenario "con lluvia": 0 = seco, 1 = saturado

    # --- Drenaje e inundación ---
    "umbral_rio_pct": 0.8,        # % del área que debe drenar a una celda para ser río
    "nivel_agua_m": None,         # cuánto sube el agua sobre los ríos (None = 5% del relieve)

    # --- Detección de cambios ---
    "cambio_minimo_cm": 0.4,      # menos que esto se considera ruido del Kinect
    "area_minima_celdas": 25,     # zonas de cambio más pequeñas se ignoran

    "carpeta_salida": "analisis",
}

PESO_AGUA = 9.81  # kN/m3

# ===================== LECTURA DE ARCHIVOS ===================================


def _num(s):
    """Convierte números tipo Fortran ('0.5D+03', ' 1.0e- 2') a float."""
    return float("".join(s.split()).replace("D", "E").replace("d", "e"))


def leer_dem_sarndbox(ruta):
    """Lee el .dem que escribe la BathymetrySaverTool del SARndbox (formato USGS
    DEM en texto, registros de 1024 bytes, un perfil por columna de sur a norte).
    Devuelve (z, celda) en las unidades del archivo (cm de arena en el SARndbox),
    con la fila 0 = norte."""
    datos = open(ruta, "rb").read().decode("latin-1")
    if len(datos) % 1024 and ("\n" in datos[:1100]):
        datos = datos.replace("\r", "").replace("\n", "")  # por si alguien lo editó
    A = datos[:1024]
    dx, dy, dz = (_num(A[816 + 12 * i: 828 + 12 * i]) for i in range(3))
    ncols = int(A[858:864])
    columnas = []
    pos = 1024
    for _ in range(ncols):
        h = datos[pos:pos + 144]
        filas = int(h[12:18])
        datum = _num(h[72:96])
        p = pos + 144
        valores = np.empty(filas)
        for i in range(filas):
            if (p % 1024) + 6 > 1020:          # salto al siguiente registro de 1024
                p = (p // 1024 + 1) * 1024
            valores[i] = int(datos[p:p + 6])
            p += 6
        columnas.append(datum + valores * dz)
        pos = ((p - 1) // 1024 + 1) * 1024
    z = np.array(columnas).T[::-1]  # filas de sur->norte a norte->sur
    return z, dx


def leer_asc(ruta):
    """Esri ASCII Grid (por ejemplo, el que exporta exportar_sandbox.py)."""
    cab = {}
    with open(ruta) as f:
        for _ in range(6):
            k, v = f.readline().split()
            cab[k.lower()] = float(v)
        z = np.loadtxt(f)
    nd = cab.get("nodata_value")
    if nd is not None:
        z[z == nd] = np.nan
    return z, cab["cellsize"]


def cargar_terreno(ruta, cfg):
    """Devuelve elevación en metros del terreno escalado y tamaño de celda en metros."""
    if ruta.lower().endswith(".asc"):
        z, celda = leer_asc(ruta)     # ya viene en metros
        return z, celda
    z_cm, celda_cm = leer_dem_sarndbox(ruta)
    return a_metros(z_cm, celda_cm, cfg)


def a_metros(z_cm, celda_cm, cfg):
    k = cfg["metros_por_cm"]
    z = z_cm * k * cfg["escala_vertical"] + cfg["elevacion_base_m"]
    return z, celda_cm * k

# ===================== TERRENOS DE DEMOSTRACIÓN ==============================


def terreno_demo_cm(deslave=False, semilla=3):
    """Terreno inventado en cm de arena: un cerro con una cara muy empinada,
    un valle con río, una depresión cerrada y lomeríos."""
    rng = np.random.default_rng(semilla)
    filas, cols = 240, 320
    celda = 100.0 / cols
    y, x = np.mgrid[0:filas, 0:cols] * celda
    sx = np.where(x < 30, 14.0, 6.5)  # cerro asimétrico: cara este muy empinada
    z = (
        16 * np.exp(-(((x - 30) / sx) ** 2 + ((y - 30) / 12) ** 2))
        + 9 * np.exp(-(((x - 72) / 16) ** 2 + ((y - 22) / 10) ** 2))
        + 6 * np.exp(-(((x - 20) / 20) ** 2 + ((y - 62) / 10) ** 2))
        + 2.5 * np.sin(x / 9) * np.cos(y / 11)
        + 0.06 * y
    )
    # valle con río en diagonal hacia la esquina inferior derecha
    linea = np.abs((y - 30) - 0.55 * (x - 40)) / np.hypot(1, 0.55)
    z -= 6 * np.exp(-(linea / 6) ** 2) * (x > 35)
    # depresión cerrada (laguna) arriba a la derecha
    z -= 5 * np.exp(-(((x - 85) / 6) ** 2 + ((y - 45) / 5) ** 2))
    z *= 0.55  # alturas realistas para arena (pendientes de hasta ~35-45°)
    z += rng.normal(0, 0.08, z.shape)
    z = ndimage.gaussian_filter(z, 2.0)

    if deslave:
        # parte alta de la ladera este del cerro se desliza hacia abajo
        cerro = np.exp(-(((x - 34) / 3) ** 2 + ((y - 30) / 4) ** 2))
        pie = np.exp(-(((x - 43) / 4) ** 2 + ((y - 32) / 4.5) ** 2))
        perdida = 2.0 * cerro
        ganancia = pie * perdida.sum() / pie.sum()
        z = z - perdida + ganancia
        z += rng.normal(0, 0.05, z.shape)
    return z, celda

# ===================== ANÁLISIS ==============================================

VECINOS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def pendiente_orientacion(z, celda):
    # suavizado ligero: el ruido del Kinect crea pendientes falsas entre celdas vecinas
    dz_dfila, dz_dx = np.gradient(ndimage.gaussian_filter(z, 1.0), celda)
    dz_dnorte = -dz_dfila
    pend = np.degrees(np.arctan(np.hypot(dz_dx, dz_dnorte)))
    orient = (np.degrees(np.arctan2(-dz_dx, -dz_dnorte)) + 360) % 360
    orient[pend < 1] = np.nan
    return pend, orient


def factor_seguridad(pend_deg, saturacion, cfg):
    """Talud infinito: FS = c / (γ z senβ cosβ) + (1 - m γw/γ) tanφ / tanβ.
    FS < 1 inestable, 1–1.3 crítico, 1.3–1.5 moderado, > 1.5 estable."""
    b = np.radians(np.clip(pend_deg, 0.5, 89))
    g, zs = cfg["peso_suelo_kn_m3"], cfg["espesor_suelo_m"]
    phi = np.radians(cfg["friccion_grados"])
    fs = (cfg["cohesion_kpa"] / (g * zs * np.sin(b) * np.cos(b))
          + (1 - saturacion * PESO_AGUA / g) * np.tan(phi) / np.tan(b))
    return np.clip(fs, 0, 5)


def rellenar_depresiones(z):
    """Priority-Flood: llena huecos para que todo drene hacia los bordes.
    Agrega un incremento mínimo para que el agua no se quede en zonas planas."""
    f, c = z.shape
    lleno = z.copy()
    visto = np.zeros(z.shape, bool)
    cola = []
    for i in range(f):
        for j in (0, c - 1):
            heapq.heappush(cola, (lleno[i, j], i, j)); visto[i, j] = True
    for j in range(1, c - 1):
        for i in (0, f - 1):
            heapq.heappush(cola, (lleno[i, j], i, j)); visto[i, j] = True
    eps = 1e-6 * max(1.0, float(np.nanmax(np.abs(z))))
    while cola:
        h, i, j = heapq.heappop(cola)
        for di, dj in VECINOS:
            a, b = i + di, j + dj
            if 0 <= a < f and 0 <= b < c and not visto[a, b]:
                visto[a, b] = True
                if lleno[a, b] <= h:
                    lleno[a, b] = h + eps
                heapq.heappush(cola, (lleno[a, b], a, b))
    return lleno


def direccion_flujo(lleno, celda):
    """D8: cada celda manda su agua al vecino con mayor caída. -1 = sale del mapa."""
    f, c = lleno.shape
    p = np.pad(lleno, 1, constant_values=np.inf)
    mejor = np.zeros((f, c))
    destino = np.full((f, c), -1, dtype=np.int64)
    idx = np.arange(f * c).reshape(f, c)
    for di, dj in VECINOS:
        vecino = p[1 + di:1 + di + f, 1 + dj:1 + dj + c]
        caida = (lleno - vecino) / (celda * np.hypot(di, dj))
        ii = np.clip(np.arange(f)[:, None] + di, 0, f - 1)
        jj = np.clip(np.arange(c)[None, :] + dj, 0, c - 1)
        mejora = caida > mejor
        mejor[mejora] = caida[mejora]
        destino[mejora] = idx[ii, jj][mejora]
    return destino.ravel()


def analisis_hidrologico(z, celda, cfg):
    f, c = z.shape
    lleno = rellenar_depresiones(z)
    destino = direccion_flujo(lleno, celda)
    orden = np.argsort(lleno.ravel(), kind="stable")  # de abajo hacia arriba

    # acumulación de flujo (de arriba hacia abajo)
    acum = np.ones(f * c)
    for k in orden[::-1]:
        d = destino[k]
        if d >= 0:
            acum[d] += acum[k]
    umbral = max(20, cfg["umbral_rio_pct"] / 100 * f * c)
    rios = acum >= umbral

    # cuencas y HAND (altura sobre el drenaje más cercano), de abajo hacia arriba
    zl = lleno.ravel()
    cuenca = np.zeros(f * c, dtype=np.int64)
    elev_dren = np.zeros(f * c)
    siguiente = 1
    for k in orden:
        d = destino[k]
        if d < 0:
            cuenca[k] = siguiente; siguiente += 1
        else:
            cuenca[k] = cuenca[d]
        if rios[k]:
            elev_dren[k] = zl[k]
        elif d < 0:
            elev_dren[k] = -np.inf   # escurre fuera del mapa sin pasar por un río
        else:
            elev_dren[k] = elev_dren[d]
    hand = np.maximum(z.ravel() - elev_dren, 0)  # inf = no lo alcanza ningún río

    # quedarse con las cuencas principales
    ids, areas = np.unique(cuenca, return_counts=True)
    principales = ids[np.argsort(areas)[::-1][:8]]
    remap = np.zeros(siguiente, dtype=np.int64)
    for n, cid in enumerate(principales, 1):
        remap[cid] = n
    cuencas = remap[cuenca]

    encharcamiento = lleno - z
    encharcamiento[encharcamiento < 0.002 * (np.nanmax(z) - np.nanmin(z))] = 0
    return {
        "lleno": lleno,
        "acum": acum.reshape(f, c),
        "rios": rios.reshape(f, c),
        "cuencas": cuencas.reshape(f, c),
        "areas_cuencas": np.sort(areas)[::-1][:8] * celda ** 2,
        "hand": hand.reshape(f, c),
        "encharcamiento": encharcamiento,
    }


def inundacion(hand, encharcamiento, nivel):
    """Profundidad de agua si los ríos suben 'nivel' metros (método HAND)
    más el agua que se queda en depresiones cerradas."""
    prof = np.where(hand < nivel, nivel - hand, 0.0)
    return np.maximum(prof, encharcamiento)


def detectar_cambios(z_ant, z_nue, pend_ant, fs_sat_ant, celda, cfg):
    """DEM de diferencias: erosión (pérdida) y depósito (ganancia).
    Un deslave = zona de pérdida con una zona de ganancia pegada y más abajo."""
    dif = z_nue - z_ant
    lod = cfg["cambio_minimo_cm"] * cfg["metros_por_cm"] * cfg["escala_vertical"]
    ocho = np.ones((3, 3))
    eros, n_e = ndimage.label(dif < -lod, ocho)
    depo, n_d = ndimage.label(dif > lod, ocho)
    a_min = cfg["area_minima_celdas"]
    ar = celda ** 2
    eventos = []
    for e in range(1, n_e + 1):
        m_e = eros == e
        if m_e.sum() < a_min:
            continue
        cerca = ndimage.binary_dilation(m_e, ocho, iterations=max(3, int(np.sqrt(m_e.sum()) / 2)))
        for d in np.unique(depo[cerca & (depo > 0)]):
            m_d = depo == d
            if m_d.sum() < a_min:
                continue
            if z_ant[m_d].mean() >= z_ant[m_e].mean():
                continue  # el material no bajó: no es deslave (puede ser alguien moviendo arena)
            ce = np.array(ndimage.center_of_mass(m_e)); cd = np.array(ndimage.center_of_mass(m_d))
            eventos.append({
                "vol_perdido": -dif[m_e].sum() * ar,
                "vol_depositado": dif[m_d].sum() * ar,
                "desplazamiento": np.hypot(*(cd - ce)) * celda,
                "caida": z_ant[m_e].mean() - z_ant[m_d].mean(),
                "pend_origen": pend_ant[m_e].mean(),
                "en_riesgo": float((fs_sat_ant[m_e] < 1.3).mean()),
                "centro": ce, "destino": cd,
                "mascara": m_e | m_d,
            })
    return {
        "dif": dif, "lod": lod,
        "vol_erosion": -dif[dif < -lod].sum() * ar,
        "vol_deposito": dif[dif > lod].sum() * ar,
        "area_cambio": (np.abs(dif) > lod).sum() * ar,
        "eventos": sorted(eventos, key=lambda ev: -ev["vol_perdido"]),
    }


def perfil(z, celda, linea):
    f, c = z.shape
    x1, y1, x2, y2 = linea
    n = int(np.hypot((x2 - x1) * c, (y2 - y1) * f)) + 1
    xs = np.linspace(x1 * (c - 1), x2 * (c - 1), n)
    ys = np.linspace(y1 * (f - 1), y2 * (f - 1), n)
    vals = ndimage.map_coordinates(z, [ys, xs], order=1)
    dist = np.hypot(xs - xs[0], ys - ys[0]) * celda
    return dist, vals, xs, ys

# ===================== GRÁFICAS ==============================================


def extension(z, celda, cfg):
    f, c = z.shape
    return [cfg["origen_x"], cfg["origen_x"] + c * celda, cfg["origen_y"], cfg["origen_y"] + f * celda]


def sombreado(z, celda):
    return LightSource(315, 45).hillshade(z, vert_exag=1, dx=celda, dy=celda)


def base_mapa(ax, z, celda, cfg, titulo):
    ext = extension(z, celda, cfg)
    ax.imshow(sombreado(z, celda), cmap="gray", extent=ext, vmin=0, vmax=1)
    ax.set_title(titulo, fontsize=11)
    ax.ticklabel_format(useOffset=False, style="plain")
    ax.tick_params(labelsize=7)
    return ext


def guardar(fig, ruta):
    fig.tight_layout()
    fig.savefig(ruta, dpi=130)
    plt.close(fig)


def mapa_relieve(z, celda, cfg, ruta):
    fig, ax = plt.subplots(figsize=(8, 6))
    ext = extension(z, celda, cfg)
    rgb = LightSource(315, 45).shade(z, cmap=plt.get_cmap("terrain"), vert_exag=1,
                                     dx=celda, dy=celda, blend_mode="soft")
    ax.imshow(rgb, extent=ext)
    rel = np.nanmax(z) - np.nanmin(z)
    paso = intervalo_bonito(rel / 15)
    cs = ax.contour(z, levels=np.arange(np.ceil(np.nanmin(z) / paso) * paso, np.nanmax(z), paso),
                    colors="k", linewidths=0.5, extent=ext, origin="upper")
    ax.clabel(cs, fontsize=6, fmt="%.0f")
    sm = plt.cm.ScalarMappable(cmap="terrain", norm=plt.Normalize(np.nanmin(z), np.nanmax(z)))
    fig.colorbar(sm, ax=ax, label="Elevación (m)", shrink=0.8)
    ax.set_title(f"Relieve — curvas cada {paso:g} m", fontsize=11)
    ax.ticklabel_format(useOffset=False, style="plain"); ax.tick_params(labelsize=7)
    guardar(fig, ruta)


def mapa_pendiente(z, pend, celda, cfg, ruta):
    fig, ax = plt.subplots(figsize=(8, 6))
    ext = base_mapa(ax, z, celda, cfg, "Pendiente de laderas")
    im = ax.imshow(pend, cmap="YlOrRd", extent=ext, alpha=0.75, vmin=0, vmax=max(40, np.nanpercentile(pend, 99)))
    fig.colorbar(im, ax=ax, label="Pendiente (°)", shrink=0.8)
    guardar(fig, ruta)


COLORES_FS = ListedColormap(["#b2182b", "#f4a582", "#fddbc7", "#d1e5f0"])
NORMA_FS = BoundaryNorm([0, 1.0, 1.3, 1.5, 5.01], 4)
CLASES_FS = ["Inestable (FS<1)", "Crítico (1–1.3)", "Moderado (1.3–1.5)", "Estable (>1.5)"]


def mapa_deslaves(z, fs_seco, fs_sat, celda, cfg, ruta):
    fig, axs = plt.subplots(1, 2, figsize=(13, 5.4))
    for ax, fs, t in [(axs[0], fs_seco, "Suelo seco"),
                      (axs[1], fs_sat, f"Con lluvia (saturación {cfg['saturacion']:.0%})")]:
        ext = base_mapa(ax, z, celda, cfg, f"Riesgo de deslave — {t}")
        ax.imshow(fs, cmap=COLORES_FS, norm=NORMA_FS, extent=ext, alpha=0.7)
    from matplotlib.patches import Patch
    fig.legend([Patch(color=COLORES_FS(i)) for i in range(4)], CLASES_FS,
               loc="lower center", ncol=4, fontsize=9, frameon=False)
    fig.tight_layout(rect=(0, 0.06, 1, 1))
    fig.savefig(ruta, dpi=130); plt.close(fig)


def mapa_drenaje(z, hidro, celda, cfg, ruta):
    fig, ax = plt.subplots(figsize=(8, 6))
    ext = base_mapa(ax, z, celda, cfg, "Cuencas y red de drenaje")
    cu = np.ma.masked_equal(hidro["cuencas"], 0)
    ax.imshow(cu, cmap="tab10", vmin=1, vmax=10, extent=ext, alpha=0.45, interpolation="nearest")
    rios = hidro["rios"]
    ax.imshow(ndimage.binary_dilation(rios) * 1.0, cmap=ListedColormap([(0, 0, 0, 0), "#0a4fa3"]),
              extent=ext, interpolation="nearest")
    for n in range(1, int(cu.max() or 0) + 1):
        m = hidro["cuencas"] == n
        if m.any():
            cy, cx = ndimage.center_of_mass(m)
            x = ext[0] + (cx + 0.5) * celda; y = ext[3] - (cy + 0.5) * celda
            ax.text(x, y, str(n), fontsize=11, weight="bold", ha="center", va="center",
                    color="white", bbox=dict(boxstyle="circle", fc="black", alpha=0.6))
    guardar(fig, ruta)


def mapa_inundacion(z, prof, hidro, nivel, celda, cfg, ruta, curva):
    fig, axs = plt.subplots(1, 2, figsize=(13, 5.2), gridspec_kw={"width_ratios": [1.5, 1]})
    ax = axs[0]
    ext = base_mapa(ax, z, celda, cfg, f"Zonas inundables — agua {nivel:.1f} m sobre los ríos")
    im = ax.imshow(np.ma.masked_equal(prof, 0), cmap="Blues", extent=ext, vmin=0,
                   vmax=max(nivel, np.nanmax(prof)), interpolation="nearest")
    fig.colorbar(im, ax=ax, label="Profundidad del agua (m)", shrink=0.8)
    hs, areas = curva
    axs[1].plot(hs, areas, color="#0a4fa3", lw=2)
    axs[1].axvline(nivel, color="#b2182b", ls="--", lw=1)
    axs[1].set_xlabel("Nivel del agua sobre los ríos (m)")
    axs[1].set_ylabel("Área inundada (% del terreno)")
    axs[1].set_title("¿Cuánto se inunda si sube el agua?", fontsize=11)
    axs[1].grid(alpha=0.3)
    guardar(fig, ruta)


def mapa_perfil(z, celda, cfg, linea, prof_agua, fs_sat, ruta):
    dist, vals, xs, ys = perfil(z, celda, linea)
    _, agua, _, _ = perfil(z + prof_agua, celda, linea)
    _, fsl, _, _ = perfil(fs_sat, celda, linea)
    fig, axs = plt.subplots(1, 2, figsize=(13, 4.6), gridspec_kw={"width_ratios": [1, 1.7]})
    ext = base_mapa(axs[0], z, celda, cfg, "Ubicación del perfil")
    px = ext[0] + (xs + 0.5) * celda; py = ext[3] - (ys + 0.5) * celda
    axs[0].plot(px, py, color="#b2182b", lw=2)
    axs[0].text(px[0], py[0], "A", weight="bold", color="#b2182b", fontsize=12)
    axs[0].text(px[-1], py[-1], "B", weight="bold", color="#b2182b", fontsize=12)
    ax = axs[1]
    base = np.nanmin(vals) - 0.05 * (np.nanmax(vals) - np.nanmin(vals))
    ax.fill_between(dist, base, vals, color="#c9a66b")
    ax.fill_between(dist, vals, np.maximum(agua, vals), color="#4a90d9", label="Agua (inundación)")
    riesgo = fsl < 1.0
    ax.scatter(dist[riesgo], vals[riesgo], s=6, color="#b2182b", label="Ladera inestable con lluvia", zorder=3)
    ax.plot(dist, vals, color="k", lw=1)
    ax.set_xlabel("Distancia (m)"); ax.set_ylabel("Elevación (m)")
    ax.set_title("Perfil topográfico A–B", fontsize=11)
    ax.legend(fontsize=8, loc="upper right"); ax.grid(alpha=0.3)
    ax.set_ylim(base, None)
    guardar(fig, ruta)
    return dist[-1], np.nanmax(vals) - np.nanmin(vals)


def mapa_cambios(z_nue, camb, celda, cfg, ruta):
    fig, ax = plt.subplots(figsize=(8, 6))
    ext = base_mapa(ax, z_nue, celda, cfg, "Cambios desde la captura anterior")
    dif = np.where(np.abs(camb["dif"]) > camb["lod"], camb["dif"], np.nan)
    lim = np.nanmax(np.abs(dif)) if np.isfinite(dif).any() else 1
    im = ax.imshow(dif, cmap="RdBu", vmin=-lim, vmax=lim, extent=ext, interpolation="nearest")
    fig.colorbar(im, ax=ax, label="Cambio de elevación (m)  rojo = pérdida, azul = depósito", shrink=0.8)
    for n, ev in enumerate(camb["eventos"], 1):
        (y0, x0), (y1, x1) = ev["centro"], ev["destino"]
        X0 = ext[0] + (x0 + .5) * celda; Y0 = ext[3] - (y0 + .5) * celda
        X1 = ext[0] + (x1 + .5) * celda; Y1 = ext[3] - (y1 + .5) * celda
        ax.annotate("", (X1, Y1), (X0, Y0), arrowprops=dict(arrowstyle="-|>", color="k", lw=2))
        ax.text(X0, Y0, f" Deslave {n}", fontsize=9, weight="bold",
                bbox=dict(fc="white", alpha=0.8, ec="none"))
    guardar(fig, ruta)

# ===================== UTILIDADES ============================================


def intervalo_bonito(x):
    if x <= 0:
        return 1
    e = 10 ** np.floor(np.log10(x))
    for m in (1, 2, 2.5, 5, 10):
        if x <= m * e:
            return m * e
    return 10 * e


def escribir_asc(ruta, z, celda, cfg):
    f, c = z.shape
    with open(ruta, "w") as fh:
        fh.write(f"ncols {c}\nnrows {f}\nxllcorner {cfg['origen_x']:.3f}\n"
                 f"yllcorner {cfg['origen_y']:.3f}\ncellsize {celda:.6f}\nNODATA_value -9999\n")
        z = np.asarray(z, float)
        np.savetxt(fh, np.where(np.isfinite(z), z, -9999), fmt="%.3f")


def img64(ruta):
    with open(ruta, "rb") as fh:
        return base64.b64encode(fh.read()).decode()


def fmt_area(m2):
    return f"{m2 / 1e6:,.3f} km²" if m2 >= 1e5 else f"{m2:,.0f} m²"


def fmt_vol(m3):
    return f"{m3 / 1e6:,.3f} millones de m³" if m3 >= 1e6 else f"{m3:,.0f} m³"

# ===================== REPORTE ===============================================

CSS = """
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:1100px;margin:24px auto;
padding:0 20px;color:#1d2433;line-height:1.5;background:#fafaf8}
h1{font-size:26px;margin-bottom:2px}.sub{color:#667;margin-top:0}
h2{font-size:19px;margin-top:36px;border-bottom:2px solid #e3e1da;padding-bottom:4px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:18px 0}
.kpi{background:#fff;border:1px solid #e3e1da;border-radius:8px;padding:12px}
.kpi b{display:block;font-size:20px}.kpi span{font-size:12px;color:#667}
img{width:100%;border:1px solid #e3e1da;border-radius:6px;background:#fff}
table{border-collapse:collapse;width:100%;font-size:14px;background:#fff}
td,th{border:1px solid #e3e1da;padding:6px 8px;text-align:left}th{background:#f1efe9}
.nota{font-size:13px;color:#556;background:#f1efe9;padding:10px 12px;border-radius:6px}
.alerta{background:#fde8e6;border-left:4px solid #b2182b;padding:10px 12px;border-radius:4px}
"""


def generar_reporte(carpeta, r, cfg, fuente):
    k = r["kpis"]
    p = []
    p.append(f"<h1>Análisis del terreno — AR Sandbox</h1>"
             f"<p class='sub'>{dt.datetime.now():%d/%m/%Y %H:%M} · Fuente: {fuente}</p>")
    alertas = []
    if k["inestable_sat_pct"] > 1:
        alertas.append(f"{k['inestable_sat_pct']:.1f}% del terreno sería inestable con lluvia.")
    if r.get("cambios") and r["cambios"]["eventos"]:
        alertas.append(f"Se detectaron {len(r['cambios']['eventos'])} deslave(s) desde la captura anterior.")
    if alertas:
        p.append("<div class='alerta'><b>Alertas:</b> " + " ".join(alertas) + "</div>")
    p.append("<div class='kpis'>" + "".join(
        f"<div class='kpi'><b>{v}</b><span>{t}</span></div>" for t, v in [
            ("Área del terreno", fmt_area(k["area"])),
            ("Elevación mín – máx", f"{k['zmin']:,.0f} – {k['zmax']:,.0f} m"),
            ("Pendiente media", f"{k['pend_media']:.1f}°"),
            ("Inestable en seco", f"{k['inestable_seco_pct']:.1f}%"),
            ("Inestable con lluvia", f"{k['inestable_sat_pct']:.1f}%"),
            ("Área inundable", f"{k['inund_pct']:.1f}%"),
        ]) + "</div>")

    secciones = [
        ("1. Relieve", "01_relieve.png",
         "Elevaciones con sombreado y curvas de nivel."),
        ("2. Pendientes", "02_pendiente.png",
         f"Pendiente media {k['pend_media']:.1f}°, máxima {k['pend_max']:.1f}°. "
         f"{k['pend30_pct']:.1f}% del terreno tiene más de 30°."),
        ("3. Riesgo de deslave", "03_deslaves.png",
         "Factor de seguridad con el modelo de talud infinito: compara la resistencia del suelo "
         "(cohesión y fricción) contra el peso que lo empuja ladera abajo. Con FS menor a 1 la ladera "
         "falla. El agua de lluvia reduce la resistencia, por eso el mapa de la derecha tiene más zonas rojas."),
        ("4. Drenaje y cuencas", "04_drenaje.png",
         f"El agua de cada punto se sigue cuesta abajo (método D8) para encontrar los ríos y las cuencas. "
         f"Longitud aproximada de ríos: {k['long_rios']:,.0f} m. Cuenca más grande: {fmt_area(k['cuenca_max'])}."),
        ("5. Inundación", "05_inundacion.png",
         f"Método HAND (altura sobre el drenaje más cercano): se marcan las zonas que quedan bajo el agua "
         f"si los ríos suben {k['nivel']:.1f} m. También se suma el agua que se queda atrapada en depresiones "
         f"cerradas ({fmt_vol(k['vol_encharc'])} en {fmt_area(k['area_encharc'])})."),
        ("6. Perfil topográfico", "06_perfil.png",
         f"Corte de {k['perfil_long']:,.0f} m con un desnivel de {k['perfil_desnivel']:,.0f} m."),
    ]
    for t, img, texto in secciones:
        p.append(f"<h2>{t}</h2><p>{texto}</p><img src='data:image/png;base64,{img64(os.path.join(carpeta, img))}'>")

    if r.get("cuadro_fs"):
        p.append("<h2>Clasificación de laderas</h2><table><tr><th>Clase</th><th>Seco</th><th>Con lluvia</th></tr>")
        for clase, s, h in r["cuadro_fs"]:
            p.append(f"<tr><td>{clase}</td><td>{s:.1f}%</td><td>{h:.1f}%</td></tr>")
        p.append("</table>")

    c = r.get("cambios")
    if c:
        p.append(f"<h2>7. Cambios y deslaves detectados</h2><p>Comparación contra la captura anterior "
                 f"(cambios menores a {c['lod']:.1f} m se toman como ruido). Material perdido: "
                 f"{fmt_vol(c['vol_erosion'])}; depositado: {fmt_vol(c['vol_deposito'])}; "
                 f"área modificada: {fmt_area(c['area_cambio'])}.</p>"
                 f"<img src='data:image/png;base64,{img64(os.path.join(carpeta, '07_cambios.png'))}'>")
        if c["eventos"]:
            p.append("<table><tr><th>#</th><th>Volumen desplazado</th><th>Recorrido</th><th>Caída</th>"
                     "<th>Pendiente de origen</th><th>¿Estaba marcado como riesgo?</th></tr>")
            for n, ev in enumerate(c["eventos"], 1):
                p.append(f"<tr><td>{n}</td><td>{fmt_vol(ev['vol_perdido'])}</td><td>{ev['desplazamiento']:,.0f} m</td>"
                         f"<td>{ev['caida']:,.0f} m</td><td>{ev['pend_origen']:.0f}°</td>"
                         f"<td>{'Sí' if ev['en_riesgo'] > 0.3 else 'No'} ({ev['en_riesgo']:.0%} del área)</td></tr>")
            p.append("</table>")
        else:
            p.append("<p>No se detectaron deslaves (hubo cambios, pero sin el patrón pérdida arriba / depósito abajo).</p>")

    p.append(f"<h2>Parámetros usados</h2><p class='nota'>Escala: 1 cm de arena = {cfg['metros_por_cm']:g} m · "
             f"exageración vertical {cfg['escala_vertical']:g} · celda de {k['celda']:.2f} m · "
             f"suelo: cohesión {cfg['cohesion_kpa']:g} kPa, fricción {cfg['friccion_grados']:g}°, "
             f"peso {cfg['peso_suelo_kn_m3']:g} kN/m³, espesor {cfg['espesor_suelo_m']:g} m · "
             f"saturación con lluvia {cfg['saturacion']:.0%}. Los rasters .asc de esta carpeta se abren en QGIS o ArcGIS. "
             f"Es un modelo educativo: los valores dependen de la escala y del suelo que se elija.</p>")
    html = f"<!DOCTYPE html><html lang='es'><head><meta charset='utf-8'><title>Análisis del terreno</title>" \
           f"<style>{CSS}</style></head><body>{''.join(p)}</body></html>"
    ruta = os.path.join(carpeta, "reporte.html")
    with open(ruta, "w", encoding="utf-8") as fh:
        fh.write(html)
    return ruta

# ===================== PROCESO COMPLETO ======================================


def calcular(z, celda, cfg, linea=None):
    """Hace todos los análisis de una captura y devuelve capas (arreglos) y resumen.
    Lo usan el reporte HTML y el panel web."""
    pend, orient = pendiente_orientacion(z, celda)
    fs_seco = factor_seguridad(pend, 0.0, cfg)
    fs_sat = factor_seguridad(pend, cfg["saturacion"], cfg)
    hidro = analisis_hidrologico(z, celda, cfg)
    relieve = float(np.nanmax(z) - np.nanmin(z))
    nivel = cfg["nivel_agua_m"] if cfg["nivel_agua_m"] is not None else 0.05 * relieve
    prof = inundacion(hidro["hand"], hidro["encharcamiento"], nivel)
    hs = np.linspace(0, 0.25 * relieve, 40)
    curva = (hs, np.array([100 * (inundacion(hidro["hand"], hidro["encharcamiento"], h) > 0).mean() for h in hs]))

    if linea is None:  # por defecto, oeste-este pasando por el punto más alto
        fi = np.unravel_index(np.nanargmax(z), z.shape)[0] / (z.shape[0] - 1)
        linea = (0.0, fi, 1.0, fi)
    dist, p_elev, p_x, p_y = perfil(z, celda, linea)
    _, p_agua, _, _ = perfil(z + prof, celda, linea)
    _, p_fs, _, _ = perfil(fs_sat, celda, linea)

    def pct(m):
        return float(100 * m.mean())
    cuadro = [(CLASES_FS[i], pct((fs_seco >= a) & (fs_seco < b)), pct((fs_sat >= a) & (fs_sat < b)))
              for i, (a, b) in enumerate([(0, 1), (1, 1.3), (1.3, 1.5), (1.5, 99)])]
    kpis = {
        "area": z.size * celda ** 2, "zmin": float(np.nanmin(z)), "zmax": float(np.nanmax(z)), "celda": celda,
        "pend_media": float(np.nanmean(pend)), "pend_max": float(np.nanmax(pend)), "pend30_pct": pct(pend > 30),
        "inestable_seco_pct": pct(fs_seco < 1), "inestable_sat_pct": pct(fs_sat < 1),
        "critico_sat_pct": pct(fs_sat < 1.3),
        "long_rios": float(hidro["rios"].sum() * celda), "cuenca_max": float(hidro["areas_cuencas"][0]),
        "nivel": float(nivel), "inund_pct": pct(prof > 0),
        "vol_encharc": float(hidro["encharcamiento"].sum() * celda ** 2),
        "area_encharc": float((hidro["encharcamiento"] > 0).sum() * celda ** 2),
        "perfil_long": float(dist[-1]), "perfil_desnivel": float(np.nanmax(p_elev) - np.nanmin(p_elev)),
    }
    return {
        "z": z, "celda": celda, "pend": pend, "orient": orient, "fs_seco": fs_seco, "fs_sat": fs_sat,
        "hidro": hidro, "prof": prof, "nivel": nivel, "curva": curva, "linea": linea,
        "perfil": {"dist": dist, "elev": p_elev, "agua": np.maximum(p_agua, p_elev), "fs": p_fs,
                   "x": p_x, "y": p_y},
        "cuadro": cuadro, "kpis": kpis,
    }


def comparar(z_ant, z_nue, celda, cfg):
    """Detección de cambios y deslaves entre dos capturas del mismo tamaño."""
    if z_ant.shape != z_nue.shape:
        return None
    pend_a, _ = pendiente_orientacion(z_ant, celda)
    return detectar_cambios(z_ant, z_nue, pend_a, factor_seguridad(pend_a, cfg["saturacion"], cfg), celda, cfg)


def analizar(z, celda, cfg, fuente, z_anterior=None, linea=None):
    carpeta = os.path.join(cfg["carpeta_salida"], dt.datetime.now().strftime("analisis_%Y%m%d_%H%M%S"))
    os.makedirs(carpeta, exist_ok=True)
    R = lambda n: os.path.join(carpeta, n)
    print(f"Analizando terreno de {z.shape[1]}x{z.shape[0]} celdas...")
    c = calcular(z, celda, cfg, linea)
    pend, fs_seco, fs_sat, hidro, prof, nivel = c["pend"], c["fs_seco"], c["fs_sat"], c["hidro"], c["prof"], c["nivel"]

    mapa_relieve(z, celda, cfg, R("01_relieve.png"))
    mapa_pendiente(z, pend, celda, cfg, R("02_pendiente.png"))
    mapa_deslaves(z, fs_seco, fs_sat, celda, cfg, R("03_deslaves.png"))
    mapa_drenaje(z, hidro, celda, cfg, R("04_drenaje.png"))
    mapa_inundacion(z, prof, hidro, nivel, celda, cfg, R("05_inundacion.png"), c["curva"])
    mapa_perfil(z, celda, cfg, c["linea"], prof, fs_sat, R("06_perfil.png"))

    cambios = None
    if z_anterior is not None:
        cambios = comparar(z_anterior, z, celda, cfg)
        if cambios is None:
            print("  Aviso: la captura anterior tiene otro tamaño; no se comparan.")
        else:
            mapa_cambios(z, cambios, celda, cfg, R("07_cambios.png"))
            escribir_asc(R("cambios.asc"), cambios["dif"], celda, cfg)
            print(f"  cambios listos: {len(cambios['eventos'])} deslave(s) detectado(s)")

    for nombre, capa in capas_exportables(c):
        escribir_asc(R(f"{nombre}.asc"), capa, celda, cfg)

    kpis = c["kpis"]
    reporte = generar_reporte(carpeta, {"kpis": kpis, "cuadro_fs": c["cuadro"], "cambios": cambios}, cfg, fuente)
    print(f"\nListo. Reporte: {reporte}")
    print(f"  Inestable con lluvia: {kpis['inestable_sat_pct']:.1f}% · Inundable: {kpis['inund_pct']:.1f}% "
          f"(agua a {nivel:.1f} m) · Ríos: {kpis['long_rios']:,.0f} m")
    return reporte


def capas_exportables(c):
    h = c["hidro"]
    return [("elevacion", c["z"]), ("pendiente", c["pend"]), ("orientacion", c["orient"]),
            ("fs_seco", c["fs_seco"]), ("fs_lluvia", c["fs_sat"]), ("acumulacion_flujo", h["acum"]),
            ("cuencas", h["cuencas"]), ("hand", h["hand"]), ("inundacion", c["prof"])]


def vigilar(ruta, cfg, linea, abrir):
    """Modo en vivo: cada vez que el SARndbox reescribe el archivo, se analiza
    y se compara con la captura anterior."""
    import webbrowser
    historial = os.path.join(cfg["carpeta_salida"], "historial")
    os.makedirs(historial, exist_ok=True)
    print(f"Vigilando {ruta}. Guarda el relieve en el SARndbox para analizar. Ctrl+C para salir.")
    ultima_mod, anterior = None, None
    while True:
        try:
            if os.path.exists(ruta):
                mod = os.path.getmtime(ruta)
                if mod != ultima_mod:
                    tam = -1
                    while tam != os.path.getsize(ruta):   # esperar a que termine de escribirse
                        tam = os.path.getsize(ruta); time.sleep(0.5)
                    ultima_mod = os.path.getmtime(ruta)
                    copia = os.path.join(historial, dt.datetime.now().strftime("captura_%H%M%S.dem"))
                    shutil.copy2(ruta, copia)
                    try:
                        z, celda = cargar_terreno(copia, cfg)
                    except Exception as e:  # archivo a medio escribir o dañado
                        print(f"No pude leer la captura ({e}); espero la siguiente.")
                        continue
                    print(f"\n=== Nueva captura {dt.datetime.now():%H:%M:%S} ===")
                    rep = analizar(z, celda, cfg, f"SARndbox ({os.path.basename(copia)})", anterior, linea)
                    anterior = z
                    if abrir:
                        webbrowser.open("file://" + os.path.abspath(rep))
            time.sleep(1)
        except KeyboardInterrupt:
            print("\nAdiós.")
            return


def main():
    ap = argparse.ArgumentParser(description="Análisis geológico del relieve del AR Sandbox.")
    ap.add_argument("--archivo", help="archivo .dem del SARndbox o .asc")
    ap.add_argument("--anterior", help="captura anterior para detectar cambios y deslaves")
    ap.add_argument("--vigilar", metavar="ARCHIVO", help="modo en vivo: analizar cada vez que cambie el archivo")
    ap.add_argument("--abrir", action="store_true", help="abrir el reporte en el navegador")
    ap.add_argument("--demo", action="store_true", help="terreno de ejemplo")
    ap.add_argument("--demo-deslave", action="store_true", help="ejemplo con un deslave entre dos capturas")
    ap.add_argument("--escala", type=float, help="metros de terreno por cm de arena")
    ap.add_argument("--lluvia", type=float, help="saturación del suelo de 0 a 1")
    ap.add_argument("--nivel-agua", type=float, help="metros que sube el agua sobre los ríos")
    ap.add_argument("--perfil", help="x1,y1,x2,y2 en fracciones de 0 a 1 (0,0 = esquina superior izquierda)")
    ap.add_argument("--si", action="store_true", help="instalar librerías faltantes sin preguntar")
    ap.add_argument("--no-instalar", action="store_true", help="no instalar librerías")
    a = ap.parse_args()

    cfg = dict(CONFIG)
    if a.escala: cfg["metros_por_cm"] = a.escala
    if a.lluvia is not None: cfg["saturacion"] = min(max(a.lluvia, 0), 1)
    if a.nivel_agua is not None: cfg["nivel_agua_m"] = a.nivel_agua
    linea = tuple(float(v) for v in a.perfil.split(",")) if a.perfil else None

    if a.vigilar:
        vigilar(a.vigilar, cfg, linea, a.abrir)
        return
    if a.demo or a.demo_deslave:
        z_cm, c_cm = terreno_demo_cm()
        z, celda = a_metros(z_cm, c_cm, cfg)
        anterior = None
        if a.demo_deslave:
            anterior = z
            z, _ = a_metros(terreno_demo_cm(deslave=True)[0], c_cm, cfg)
        rep = analizar(z, celda, cfg, "terreno de demostración", anterior, linea)
    elif a.archivo:
        z, celda = cargar_terreno(a.archivo, cfg)
        anterior = cargar_terreno(a.anterior, cfg)[0] if a.anterior else None
        rep = analizar(z, celda, cfg, os.path.basename(a.archivo), anterior, linea)
    else:
        ap.print_help()
        return
    if a.abrir:
        import webbrowser
        webbrowser.open("file://" + os.path.abspath(rep))


if __name__ == "__main__":
    main()
