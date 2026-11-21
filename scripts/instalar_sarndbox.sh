#!/usr/bin/env bash
# =====================================================================
#  instalar_sarndbox.sh — Instala el AR Sandbox (SARndbox) desde cero,
#  siguiendo la guía oficial de Oliver Kreylos (UC Davis):
#  https://web.cs.ucdavis.edu/~okreylos/ResDev/SARndbox/SoftwareInstallation.html
#
#  Instala, en este orden:
#    1. Vrui 8.0       (la base gráfica; con el script oficial Build-Ubuntu.sh)
#    2. Kinect 3.10    (para leer la cámara Kinect)
#    3. SARndbox 2.8   (el AR Sandbox; queda en ~/src/SARndbox-2.8)
#    4. (Opcional) Lee la calibración interna del Kinect si está conectado.
#
#  Lo llama instalar.sh cuando no encuentra el SARndbox. También se puede
#  usar solo:   bash scripts/instalar_sarndbox.sh
#
#  - Pregunta antes de cada paso que usa la contraseña (sudo).
#  - Revisa la huella (SHA1) de cada descarga contra la que publica Kreylos.
#  - Si algo ya está instalado, se lo salta.
#  - NUNCA sobrescribe una carpeta ~/src/SARndbox-2.8 que ya exista (ahí
#    viven los archivos de calibración BoxLayout.txt y ProjectorMatrix.dat).
#  - La calibración de la caja y del proyector NO se puede automatizar:
#    se hace a mano frente al sandbox (al final se explica cómo).
#  - Todo lo que pasa queda en logs/instalar_sarndbox_*.log
# =====================================================================

set -u
# shellcheck source=comun.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/comun.sh"
SIN_VENTANAS=1

BASE_URL="https://web.cs.ucdavis.edu/~okreylos/ResDev"
SRC="$HOME/src"
VRUI_MIN="8.0"
KINECT_VER="3.10"
SARNDBOX_VER="2.8"
# Huellas SHA1 publicadas en las páginas de descarga de Kreylos
SHA1_BUILD_UBUNTU="55c5cd15bf547f38e02e6b16cc226466e441d6d5"
SHA1_KINECT="c676773a623596869ae2d9e01e3e941ef74efd9f"
SHA1_SARNDBOX="01e0803f7cb61ec9e1b193d03558daa5e1234eb2"
GUIA="https://web.cs.ucdavis.edu/~okreylos/ResDev/SARndbox/SoftwareInstallation.html"

mkdir -p "$RAIZ/logs"
REGISTRO="$RAIZ/logs/instalar_sarndbox_$(date +%Y%m%d_%H%M%S).log"
exec > >(tee -a "$REGISTRO") 2>&1

falla() {
    info ""
    info "[FALLA] $*"
    info ""
    info "La instalación del SARndbox se detuvo. Lo que ya quedó instalado se conserva;"
    info "si vuelven a correr este instalador, continúa donde se quedó."
    info "Todo lo que pasó quedó guardado en:"
    info "   $REGISTRO"
    info "Guía oficial (en inglés), por si hay que hacerlo a mano:"
    info "   $GUIA"
    exit 1
}

# descargar URL DESTINO SHA1 -> baja el archivo y revisa su huella
descargar() {
    local url="$1" destino="$2" sha1="$3" real
    info "   Descargando $(basename "$destino")..."
    if tiene wget; then
        wget -q --show-progress -O "$destino.parcial" "$url" || { rm -f "$destino.parcial"; return 1; }
    elif tiene curl; then
        curl -fL --progress-bar -o "$destino.parcial" "$url" || { rm -f "$destino.parcial"; return 1; }
    else
        info "   No hay wget ni curl para descargar."; return 1
    fi
    real="$(sha1sum "$destino.parcial" | cut -d' ' -f1)"
    if [ "$real" != "$sha1" ]; then
        info "   La huella del archivo no coincide con la que publica Kreylos."
        info "     esperada: $sha1"
        info "     obtenida: $real"
        if [ "$(basename "$destino")" = "Build-Ubuntu.sh" ]; then
            info "   (Puede ser que Kreylos actualizó su script después de escribir este instalador.)"
            if ! preguntar "   ¿Usarlo de todos modos?"; then rm -f "$destino.parcial"; return 1; fi
        else
            rm -f "$destino.parcial"; return 1
        fi
    fi
    mv "$destino.parcial" "$destino"
}

info "=============================================================="
info "  Instalación del AR Sandbox (Vrui $VRUI_MIN + Kinect $KINECT_VER + SARndbox $SARNDBOX_VER)"
info "=============================================================="

# ---------------------------------------------------------------------
# 0. Revisiones antes de empezar
# ---------------------------------------------------------------------
info ""
info "0) Revisando la computadora"
[ "$(uname -s)" = "Linux" ] || falla "Esto solo funciona en Linux (Linux Mint)."
tiene apt-get || falla "No encontré apt-get. Este instalador es para Linux Mint / Ubuntu."
[ "$(id -u)" -ne 0 ] || falla "No lo corran con sudo: córranlo como usuario normal (él pide la contraseña cuando la necesita)."

DISTRO="desconocida"; CODIGO=""
if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    DISTRO="${NAME:-?} ${VERSION_ID:-}"
    CODIGO="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
fi
info "   Sistema: $DISTRO ${CODIGO:+(base Ubuntu \"$CODIGO\")}"
if [ "$CODIGO" != "bionic" ]; then
    info ""
    info "   OJO: Kreylos probó su instalación en Linux Mint 19 (base Ubuntu \"bionic\")."
    info "   En otras versiones normalmente funciona, pero puede fallar algún paquete."
    info "   Si falla, el registro dirá en qué paso y se puede terminar a mano con la guía."
    preguntar "   ¿Continuar?" || exit 1
fi
if tiene lspci && ! lspci 2>/dev/null | grep -qi nvidia; then
    info ""
    info "   OJO: no veo una tarjeta de video NVIDIA. El AR Sandbox (sobre todo la"
    info "   simulación de agua) necesita una tarjeta potente; Kreylos recomienda NVIDIA"
    info "   con su controlador instalado (Menú > Administrador de controladores)."
    preguntar "   ¿Continuar de todos modos?" || exit 1
elif tiene glxinfo && ! glxinfo 2>/dev/null | grep -qi "vendor.*nvidia"; then
    info "   OJO: hay tarjeta NVIDIA, pero parece que no usa el controlador de NVIDIA."
    info "   Instálenlo en Menú > Administrador de controladores y reinicien (paso 2 de la guía)."
    preguntar "   ¿Continuar de todos modos?" || exit 1
fi
if tiene curl && ! curl -fsI --max-time 15 "$BASE_URL/SARndbox/Download.html" >/dev/null 2>&1; then
    falla "No puedo entrar a la página de Kreylos ($BASE_URL). Revisen el internet."
fi
info ""
info "   Esto descarga y compila todo: tarda entre 30 y 60 minutos y pide la"
info "   contraseña de Linux Mint varias veces. No cierren esta terminal."
preguntar "   ¿Empezamos?" || exit 1
mkdir -p "$SRC" || falla "No pude crear $SRC"

# ---------------------------------------------------------------------
# 1. Vrui
# ---------------------------------------------------------------------
info ""
info "1) Vrui (la base gráfica del AR Sandbox)"
VRUI_ACTUAL="$(detectar_vrui_version)"
if version_al_menos "$VRUI_ACTUAL" "$VRUI_MIN"; then
    info "   Ya está instalado Vrui $VRUI_ACTUAL. Me lo salto."
else
    [ -n "$VRUI_ACTUAL" ] && info "   Hay un Vrui viejo ($VRUI_ACTUAL); se instala el $VRUI_MIN junto a él."
    TMP="$(mktemp -d)"
    descargar "$BASE_URL/Vrui/Build-Ubuntu.sh" "$TMP/Build-Ubuntu.sh" "$SHA1_BUILD_UBUNTU" \
        || falla "No se pudo descargar el script oficial de Vrui."
    info "   Ahora corre el script oficial de Kreylos. Él:"
    info "     - instala con sudo los programas que Vrui necesita (pide la contraseña),"
    info "     - descarga y compila Vrui en ~/src y lo instala en /usr/local,"
    info "     - al final muestra un GLOBO TERRÁQUEO girando: eso significa que quedó bien."
    info "       Ciérrenlo (tecla Esc o la X de la ventana) para seguir."
    if ! preguntar "   ¿Lo corro? (usa sudo)"; then falla "Cancelado por el usuario."; fi
    ( cd "$HOME" && bash "$TMP/Build-Ubuntu.sh" ) || aviso "El script de Vrui terminó con un error; reviso si de todos modos quedó instalado."
    rm -rf "$TMP"
    VRUI_ACTUAL="$(detectar_vrui_version)"
    version_al_menos "$VRUI_ACTUAL" "$VRUI_MIN" \
        || falla "Vrui no quedó instalado (no encuentro /usr/local/share/Vrui-$VRUI_MIN). Revisen el registro para ver qué paquete falló."
    info "   Vrui $VRUI_ACTUAL instalado."
fi

# ---------------------------------------------------------------------
# 2. Kinect 3D Video Package
# ---------------------------------------------------------------------
info ""
info "2) Kinect $KINECT_VER (para leer la cámara)"
if [ -x /usr/local/bin/KinectUtil ] && [ -x /usr/local/bin/RawKinectViewer ]; then
    info "   Ya está instalado (KinectUtil y RawKinectViewer en /usr/local/bin). Me lo salto."
else
    DIR_K="$SRC/Kinect-$KINECT_VER"
    if [ ! -d "$DIR_K" ]; then
        descargar "$BASE_URL/Kinect/Kinect-$KINECT_VER.tar.gz" "$SRC/Kinect-$KINECT_VER.tar.gz" "$SHA1_KINECT" \
            || falla "No se pudo descargar Kinect-$KINECT_VER."
        tar xzf "$SRC/Kinect-$KINECT_VER.tar.gz" -C "$SRC" || falla "No se pudo descomprimir Kinect-$KINECT_VER."
        rm -f "$SRC/Kinect-$KINECT_VER.tar.gz"
    fi
    info "   Compilando (unos minutos)..."
    ( cd "$DIR_K" && make -j"$(nproc 2>/dev/null || echo 2)" ) || falla "No se pudo compilar Kinect-$KINECT_VER."
    info "   Para instalarlo en /usr/local y dar permiso de usar la cámara se necesita sudo."
    preguntar "   ¿Lo instalo? (usa sudo)" || falla "Cancelado por el usuario."
    ( cd "$DIR_K" && sudo make install && sudo make installudevrules ) || falla "No se pudo instalar Kinect-$KINECT_VER."
    [ -x /usr/local/bin/KinectUtil ] || falla "No encuentro /usr/local/bin/KinectUtil después de instalar."
    info "   Kinect $KINECT_VER instalado."
fi

# ---------------------------------------------------------------------
# 3. SARndbox
# ---------------------------------------------------------------------
info ""
info "3) SARndbox $SARNDBOX_VER (el AR Sandbox)"
DIR_S="$SRC/SARndbox-$SARNDBOX_VER"
if [ -x "$DIR_S/bin/SARndbox" ]; then
    info "   Ya está compilado en $DIR_S. Me lo salto."
else
    if [ -d "$DIR_S" ]; then
        # No se descomprime encima: ahí pueden estar BoxLayout.txt y ProjectorMatrix.dat
        info "   La carpeta $DIR_S ya existe; solo la compilo (no reemplazo nada)."
    else
        descargar "$BASE_URL/SARndbox/SARndbox-$SARNDBOX_VER.tar.gz" "$SRC/SARndbox-$SARNDBOX_VER.tar.gz" "$SHA1_SARNDBOX" \
            || falla "No se pudo descargar SARndbox-$SARNDBOX_VER."
        tar xzf "$SRC/SARndbox-$SARNDBOX_VER.tar.gz" -C "$SRC" || falla "No se pudo descomprimir SARndbox-$SARNDBOX_VER."
        rm -f "$SRC/SARndbox-$SARNDBOX_VER.tar.gz"
    fi
    info "   Compilando (unos minutos)..."
    ( cd "$DIR_S" && make -j"$(nproc 2>/dev/null || echo 2)" ) || falla "No se pudo compilar SARndbox-$SARNDBOX_VER."
    [ -x "$DIR_S/bin/SARndbox" ] || falla "Terminó de compilar pero no encuentro $DIR_S/bin/SARndbox."
    info "   SARndbox listo en $DIR_S/bin"
fi

# ---------------------------------------------------------------------
# 4. Calibración interna del Kinect (lee datos de fábrica de la cámara)
# ---------------------------------------------------------------------
info ""
info "4) Datos de fábrica del Kinect"
if tiene lsusb && lsusb 2>/dev/null | grep -qi "045e:"; then
    info "   Veo un Kinect conectado. El paso 6 de la guía lee sus datos de fábrica"
    info "   (KinectUtil getCalib 0). No cambia nada en la cámara; necesita sudo."
    if preguntar "   ¿Lo hago ahora? (usa sudo)"; then
        sudo /usr/local/bin/KinectUtil getCalib 0 || aviso "No funcionó. Conecten el Kinect a un puerto USB directo y repitan: sudo /usr/local/bin/KinectUtil getCalib 0"
    fi
else
    info "   No veo un Kinect conectado. Cuando lo conecten, corran una vez:"
    info "     sudo /usr/local/bin/KinectUtil getCalib 0"
fi

# ---------------------------------------------------------------------
# Lo que falta: calibrar a mano
# ---------------------------------------------------------------------
info ""
info "=============================================================="
info "  AR Sandbox instalado en $DIR_S"
info "=============================================================="
info "Falta CALIBRAR, frente al sandbox (no se puede automatizar porque depende"
info "de cómo están montados el Kinect y el proyector). Pasos 7 a 11 de la guía:"
info "  a) Alinear el Kinect:            cd $DIR_S && RawKinectViewer -compress 0"
info "  b) Medir el piso de la caja y sus 4 esquinas con RawKinectViewer y"
info "     escribirlos en:               $DIR_S/etc/SARndbox-$SARNDBOX_VER/BoxLayout.txt"
info "  c) Alinear el proyector:         XBackground   (F11 = pantalla completa)"
info "  d) Calibrar el proyector:        cd $DIR_S && ./bin/CalibrateProjector -s ANCHO ALTO"
info "     (ANCHO y ALTO = resolución del proyector, por ejemplo 1024 768)"
info "  e) Probar:                       cd $DIR_S && ./bin/SARndbox -uhm -fpv"
info "Guía con fotos (en inglés): $GUIA"
info "Después de calibrar, el ícono \"AR Sandbox\" ya lo encuentra solo."
info "Registro de esta instalación: $REGISTRO"
exit 0
