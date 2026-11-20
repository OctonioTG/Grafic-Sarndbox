#!/usr/bin/env bash
# =====================================================================
#  desinstalar.sh — Deshace lo que hicieron instalar.sh e iniciar_sandbox.sh
#
#    - Borra los íconos que se crearon (escritorio y menú).
#    - Si el lanzador escribió un archivo de configuración de Vrui
#      (modo METODO_CONFIG_VRUI="usuario"), lo quita y devuelve el respaldo
#      del archivo original, si había uno.
#    - Si se abrió el puerto en el firewall, ofrece cerrarlo.
#
#  NO borra: el SARndbox, la calibración, las capturas guardadas
#  (panel/historial y la carpeta de RUTA_DEM) ni los programas instalados
#  con apt (al final se muestra el comando por si quieres quitarlos).
# =====================================================================

set -u
# shellcheck source=scripts/comun.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts/comun.sh"
SIN_VENTANAS=1
cargar_config || true

info "Deshaciendo la instalación del panel del AR Sandbox..."

if [ -d "$CARPETA_ESTADO/ejecutando" ] && proceso_vivo "$(cat "$CARPETA_ESTADO/ejecutando/lanzador.pid" 2>/dev/null)"; then
    error_grave "El AR Sandbox está abierto. Ciérralo antes de desinstalar."
    exit 1
fi

# 1. Restaurar respaldos (del más nuevo al más viejo; el más viejo es el original)
RESTAURADOS=""
if [ -f "$CARPETA_ESTADO/respaldos.txt" ]; then
    # tail -r no existe en Linux y tac no existe en macOS: invertimos con awk
    awk '{l[NR]=$0} END{for(i=NR;i>0;i--) print l[i]}' "$CARPETA_ESTADO/respaldos.txt" |
    while IFS="$(printf '\t')" read -r original copia; do
        if [ -f "$copia" ]; then
            cp -p "$copia" "$original" && info "  Restaurado: $original  (desde $copia)"
        fi
    done
    RESTAURADOS="$(cut -f1 "$CARPETA_ESTADO/respaldos.txt" | sort -u)"
    mv "$CARPETA_ESTADO/respaldos.txt" "$CARPETA_ESTADO/respaldos.txt.restaurado"
fi

# 2. Borrar lo que creamos (solo si lleva nuestra marca)
if [ -f "$CARPETA_ESTADO/creados.txt" ]; then
    while IFS= read -r f; do
        [ -n "$f" ] || continue
        if printf '%s\n' "$RESTAURADOS" | grep -qxF "$f"; then
            continue   # ya se devolvió el archivo original
        fi
        if [ -f "$f" ] && grep -q -e "X-Panel-AR-Sandbox=true" -e "$MARCA_GENERADO" "$f"; then
            rm -f "$f" && info "  Borrado: $f"
        fi
    done < "$CARPETA_ESTADO/creados.txt"
    rm -f "$CARPETA_ESTADO/creados.txt"
fi
rm -f "$CARPETA_ESTADO/vrui_sandbox.cfg"

# 3. Firewall
if [ -f "$CARPETA_ESTADO/ufw.txt" ] && tiene ufw; then
    while IFS= read -r regla; do
        if preguntar "  ¿Cierro en el firewall el puerto $regla que abrió el instalador? (usa sudo)"; then
            sudo ufw delete allow "$regla" && info "  Puerto $regla cerrado."
        fi
    done < "$CARPETA_ESTADO/ufw.txt"
    rm -f "$CARPETA_ESTADO/ufw.txt"
fi

info ""
info "Listo. Se conservaron las capturas y el código."
info "Si también quieres quitar los programas que instaló instalar.sh (normalmente NO hace falta):"
info "  sudo apt-get remove zenity xdotool"
info "(python3-numpy, python3-matplotlib y python3-scipy pueden usarlos otros programas.)"
