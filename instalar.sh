#!/usr/bin/env bash
# =====================================================================
#  instalar.sh — Preparación de una sola vez en la computadora del sandbox
#  (Linux Mint). Se ejecuta en una terminal:   ./instalar.sh
#
#  Qué hace (pregunta antes de cada cosa que necesita contraseña):
#    1. Instala con apt lo que falte: python3-numpy, python3-matplotlib,
#       python3-scipy, zenity (ventanas), xdotool (pantalla completa),
#       x11-xserver-utils (xrandr, para encontrar el proyector).
#    2. Crea el ícono "AR Sandbox" en el escritorio y en el menú de Mint,
#       marcado como confiable, y otro "AR Sandbox (simulación)" solo en el menú.
#    3. Crea la carpeta donde se guarda el relieve (RUTA_DEM).
#    4. Si el firewall (ufw) está activo, ofrece abrir el puerto del panel.
#    5. Revisa que todo esté listo (iniciar_sandbox.sh --revisar).
#
#  NO toca los archivos de calibración ni la configuración del SARndbox.
#  Todo lo que crea queda anotado en .estado/ para que desinstalar.sh lo quite.
# =====================================================================

set -u
# shellcheck source=scripts/comun.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts/comun.sh"
SIN_VENTANAS=1   # el instalador se usa desde la terminal

cargar_config || exit 1
mkdir -p "$CARPETA_ESTADO"
anotar_creado() { grep -qxF "$1" "$CARPETA_ESTADO/creados.txt" 2>/dev/null || printf '%s\n' "$1" >> "$CARPETA_ESTADO/creados.txt"; }

info "=============================================================="
info "  Instalación del panel del AR Sandbox"
info "  Carpeta: $RAIZ"
info "=============================================================="

# ---------------------------------------------------------------------
# 1. Paquetes del sistema
# ---------------------------------------------------------------------
info ""
info "1) Programas necesarios"
PAQUETES="python3 python3-numpy python3-matplotlib python3-scipy zenity xdotool x11-xserver-utils iproute2"
if tiene dpkg && tiene apt-get; then
    FALTAN=""
    for p in $PAQUETES; do
        dpkg -s "$p" >/dev/null 2>&1 || FALTAN="$FALTAN $p"
    done
    if [ -z "$FALTAN" ]; then
        info "   Ya está todo instalado."
    else
        info "   Faltan:$FALTAN"
        info "   Para instalarlos se usa 'sudo apt-get' (pide tu contraseña de Linux Mint)."
        if preguntar "   ¿Los instalo ahora?"; then
            # shellcheck disable=SC2086
            if sudo apt-get update && sudo apt-get install -y $FALTAN; then
                info "   Instalados."
            else
                aviso "No se pudo instalar todo. Revisa la conexión a internet y vuelve a ejecutar ./instalar.sh"
            fi
        else
            info "   De acuerdo, no instalo nada. Puedes hacerlo después con:"
            info "     sudo apt-get install$FALTAN"
        fi
    fi
else
    aviso "No encontré apt-get (¿no es Linux Mint?). Me salto la instalación de programas."
fi

# ---------------------------------------------------------------------
# 2. Íconos (lanzadores .desktop)
# ---------------------------------------------------------------------
info ""
info "2) Íconos del escritorio y del menú"
chmod +x "$RAIZ/iniciar_sandbox.sh" "$RAIZ/instalar.sh" "$RAIZ/desinstalar.sh" "$RAIZ/scripts/sarndbox_falso.py" 2>/dev/null

# En los archivos .desktop, dentro de comillas hay que escapar \ " ` $ y duplicar %
escapar_desktop() {
    printf '%s' "$1" | sed -e 's/\\/\\\\\\\\/g' -e 's/"/\\\\"/g' -e 's/`/\\\\`/g' -e 's/\$/\\\\$/g' -e 's/%/%%/g'
}
RAIZ_ESC="$(escapar_desktop "$RAIZ")"

escribir_desktop() {  # escribir_desktop ARCHIVO NOMBRE OPCION TERMINAL COMENTARIO
    cat > "$1" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=$2
Comment=$5
Exec=bash "$RAIZ_ESC/iniciar_sandbox.sh"$3
Path=$RAIZ
Icon=$RAIZ/lanzador/ar-sandbox.svg
Terminal=$4
Categories=Education;Science;
StartupNotify=true
X-Panel-AR-Sandbox=true
EOF
    chmod +x "$1"
    # Marcar como confiable (Nemo / escritorio de Mint). VERIFICAR EN LA COMPUTADORA DEL SANDBOX.
    if tiene gio; then gio set "$1" metadata::trusted true 2>/dev/null || true; fi
    anotar_creado "$1"
}

MENU="$HOME/.local/share/applications"
mkdir -p "$MENU"
escribir_desktop "$MENU/ar-sandbox.desktop" "AR Sandbox" "" "false" \
    "Abre el sandbox en el proyector y el panel de análisis del relieve"
escribir_desktop "$MENU/ar-sandbox-simulacion.desktop" "AR Sandbox (simulación)" " --simulacion" "true" \
    "Prueba el panel sin Kinect ni proyector (SARndbox falso)"
info "   Menú de Mint: AR Sandbox y AR Sandbox (simulación)"

ESCRITORIO="$HOME/Desktop"
if tiene xdg-user-dir; then ESCRITORIO="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"; fi
if [ -d "$ESCRITORIO" ]; then
    cp "$MENU/ar-sandbox.desktop" "$ESCRITORIO/ar-sandbox.desktop"
    chmod +x "$ESCRITORIO/ar-sandbox.desktop"
    if tiene gio; then gio set "$ESCRITORIO/ar-sandbox.desktop" metadata::trusted true 2>/dev/null || true; fi
    anotar_creado "$ESCRITORIO/ar-sandbox.desktop"
    info "   Escritorio: $ESCRITORIO/ar-sandbox.desktop"
else
    aviso "No encontré la carpeta del escritorio; el ícono solo queda en el menú."
fi
if tiene update-desktop-database; then update-desktop-database "$MENU" >/dev/null 2>&1 || true; fi

# ---------------------------------------------------------------------
# 3. Carpeta del relieve
# ---------------------------------------------------------------------
info ""
info "3) Carpeta donde se guarda el relieve"
if mkdir -p "$(dirname "$RUTA_DEM")"; then
    info "   $(dirname "$RUTA_DEM")"
fi

# ---------------------------------------------------------------------
# 4. Firewall
# ---------------------------------------------------------------------
info ""
info "4) Firewall (para que los celulares puedan entrar al panel)"
if tiene ufw; then
    info "   Para saber si el firewall está activo se necesita sudo."
    if preguntar "   ¿Reviso el firewall y, si está activo, abro el puerto $PUERTO?"; then
        if sudo ufw status 2>/dev/null | grep -qi "active\|activo"; then
            if sudo ufw status | grep -q "^$PUERTO"; then
                info "   El puerto $PUERTO ya estaba abierto."
            elif sudo ufw allow "$PUERTO/tcp"; then
                printf '%s\n' "$PUERTO/tcp" >> "$CARPETA_ESTADO/ufw.txt"
                info "   Puerto $PUERTO abierto."
            fi
        else
            info "   El firewall no está activo; no hace falta abrir nada."
        fi
    fi
else
    info "   ufw no está instalado; no hace falta."
fi

# ---------------------------------------------------------------------
# 5. Revisión final
# ---------------------------------------------------------------------
info ""
info "5) Revisión de la configuración (sandbox.conf)"
if bash "$RAIZ/iniciar_sandbox.sh" --revisar --sin-ventanas; then
    info ""
    info "Instalación terminada. Abre el ícono \"AR Sandbox\" del escritorio."
else
    info ""
    info "Instalación terminada, pero falta ajustar lo de arriba en:"
    info "   $ARCHIVO_CONF"
    info "Luego prueba con:  ./iniciar_sandbox.sh --revisar"
fi
info "Para probar sin el sandbox:  ./iniciar_sandbox.sh --simulacion"
info "Para deshacer la instalación:  ./desinstalar.sh"
