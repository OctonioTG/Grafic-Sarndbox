#!/usr/bin/env bash
# shellcheck shell=bash
# =====================================================================
#  comun.sh — Funciones compartidas por iniciar_sandbox.sh, instalar.sh
#  y desinstalar.sh. No se ejecuta solo: los otros scripts lo cargan.
#  Compatible con bash 3.2 o más nuevo (Linux Mint trae bash 5).
# =====================================================================

# Carpeta raíz del repositorio (donde está sandbox.conf)
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCHIVO_CONF="$RAIZ/sandbox.conf"
CARPETA_ESTADO="$RAIZ/.estado"          # estado de la instalación (para deshacer)
CARPETA_RESPALDOS="$RAIZ/respaldos"     # copias de archivos antes de tocarlos
CARPETA_LOGS="$RAIZ/logs"
MARCA_GENERADO="# GENERADO POR EL PANEL DEL AR SANDBOX (iniciar_sandbox.sh)"

# ---------------------------------------------------------------------
# Mensajes
# ---------------------------------------------------------------------

hay_pantalla() { [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; }
tiene() { command -v "$1" >/dev/null 2>&1; }

info()  { printf '%s\n' "$*"; }
aviso() { printf 'AVISO: %s\n' "$*" >&2; }

# Muestra un error en la terminal y, si se abrió con doble clic, en una ventana.
error_grave() {
    printf '\nERROR: %s\n' "$*" >&2
    if [ "${SIN_VENTANAS:-0}" != "1" ] && hay_pantalla && tiene zenity; then
        zenity --error --title="AR Sandbox" --width=480 --no-markup \
            --text="$*" >/dev/null 2>&1 || true
    fi
}

aviso_ventana() {
    aviso "$*"
    if [ "${SIN_VENTANAS:-0}" != "1" ] && hay_pantalla && tiene zenity; then
        zenity --warning --title="AR Sandbox" --width=480 --no-markup \
            --text="$*" >/dev/null 2>&1 &
    fi
}

preguntar() {  # preguntar "texto" -> 0 si responde sí
    local r
    printf '%s [s/n]: ' "$1"
    read -r r || return 1
    case "$r" in s|S|si|Si|SI|sí|Sí|y|Y|yes) return 0 ;; *) return 1 ;; esac
}

# ---------------------------------------------------------------------
# Configuración
# ---------------------------------------------------------------------

cargar_config() {
    # Valores por defecto (por si alguien borra una línea del archivo)
    SARNDBOX_EJECUTABLE=""; ARCHIVO_BOXLAYOUT=""; ARCHIVO_PROYECTOR=""
    OPCIONES_SARNDBOX="-uhm"; AGUA_VELOCIDAD="1.0"; AGUA_PASOS_MAXIMOS="30"
    CALIDAD_AGUA="media"; AGUA_MALLA="640 480"
    RUTA_DEM="$HOME/SARndbox-capturas/BathymetrySaverTool.dem"; TECLA_GUARDAR="g"
    METODO_CONFIG_VRUI="mergeConfig"; VRUI_VERSION=""; SECCION_RAIZ_VRUI="Desktop"
    VRUI_OPCIONES_EXTRA=""; MONITOR_PROYECTOR="auto"; METODO_PANTALLA_COMPLETA="xdotool"
    TITULO_VENTANA="SARndbox"; PUERTO="8000"; ESCALA_METROS_POR_CM=""; AJUSTES_DESDE_OTROS_EQUIPOS="no"
    ABRIR_NAVEGADOR="si"; MOSTRAR_DIRECCION="si"; SIMULACION_CADA="20"; SIMULACION_DURACION="0"

    if [ ! -f "$ARCHIVO_CONF" ]; then
        error_grave "No encuentro el archivo de configuración:
$ARCHIVO_CONF"
        return 1
    fi
    if ! bash -n "$ARCHIVO_CONF" 2>/dev/null; then
        error_grave "El archivo sandbox.conf tiene un error de escritura (por ejemplo una comilla sin cerrar).
Ábrelo y revisa la última línea que editaste.
Detalle: $(bash -n "$ARCHIVO_CONF" 2>&1 | head -3)"
        return 1
    fi
    # shellcheck source=../sandbox.conf
    . "$ARCHIVO_CONF"
    RUTA_DEM="${RUTA_DEM/#\~/$HOME}"
}

# ---------------------------------------------------------------------
# Detección del SARndbox
# ---------------------------------------------------------------------

# Imprime candidatos al ejecutable SARndbox, uno por línea, el más probable primero.
candidatos_sarndbox() {
    local d
    if tiene SARndbox; then command -v SARndbox; fi
    # ~/src/SARndbox-X.Y/bin/SARndbox, de la versión más nueva a la más vieja
    for d in "$HOME"/src/SARndbox-*/bin/SARndbox "$HOME"/SARndbox-*/bin/SARndbox \
             /opt/SARndbox-*/bin/SARndbox /usr/local/SARndbox-*/bin/SARndbox; do
        [ -x "$d" ] && printf '%s\n' "$d"
    done | sort -t- -k2 -r
    for d in /usr/local/bin/SARndbox /usr/bin/SARndbox "$HOME/bin/SARndbox"; do
        [ -x "$d" ] && printf '%s\n' "$d"
    done
}

# Versión (por ejemplo 2.6) a partir de la ruta o del archivo VERSION vecino.
version_sarndbox() {
    local exe="$1" real dir v=""
    real="$(readlink -f "$exe" 2>/dev/null || printf '%s' "$exe")"
    dir="$(dirname "$(dirname "$real")")"
    if [ -f "$dir/VERSION" ]; then
        v="$(sed -n 's/.*Sandbox \([0-9][0-9.]*\).*/\1/p' "$dir/VERSION" | head -1)"
    fi
    if [ -z "$v" ]; then
        v="$(printf '%s' "$real" | sed -n 's/.*SARndbox-\([0-9][0-9.]*\).*/\1/p' | head -1)"
    fi
    printf '%s' "$v"
}

# ¿version >= minima?  (compara números tipo 2.6 / 2.10)
version_al_menos() {
    local v="$1" m="$2"
    [ -z "$v" ] && return 1
    awk -v a="$v" -v b="$m" 'BEGIN{
        split(a,x,"."); split(b,y,".");
        for(i=1;i<=3;i++){ if((x[i]+0)>(y[i]+0)) exit 0; if((x[i]+0)<(y[i]+0)) exit 1 }
        exit 0 }'
}

# Busca la carpeta de configuración del SARndbox (etc/SARndbox-X.Y) junto al ejecutable.
carpeta_etc_sarndbox() {
    local exe="$1" real raiz d
    real="$(readlink -f "$exe" 2>/dev/null || printf '%s' "$exe")"
    raiz="$(dirname "$(dirname "$real")")"
    for d in "$raiz"/etc/SARndbox-* /usr/local/etc/SARndbox-* "$HOME"/src/SARndbox-*/etc/SARndbox-*; do
        if [ -f "$d/BoxLayout.txt" ]; then printf '%s' "$d"; return 0; fi
    done
    return 1
}

detectar_vrui_version() {  # la versión más nueva instalada (por ejemplo 8.0)
    local d v
    v="$(for d in /usr/local/etc/Vrui-* /usr/etc/Vrui-* "$HOME"/Vrui-*/etc/Vrui-* /usr/local/share/Vrui-*; do
            [ -e "$d" ] && printf '%s\n' "$d" | sed -n 's/.*Vrui-\([0-9][0-9.]*[0-9]\).*/\1/p'
         done | sort -t. -k1,1n -k2,2n | tail -1)"
    [ -n "$v" ] && { printf '%s' "$v"; return 0; }
    return 1
}

ruta_config_usuario_vrui() {  # ~/.config/Vrui-X.Y/Applications/SARndbox.cfg
    printf '%s' "$HOME/.config/Vrui-$1/Applications/SARndbox.cfg"
}

# ---------------------------------------------------------------------
# Monitores (xrandr)
# ---------------------------------------------------------------------

# Imprime "NOMBRE ANCHO ALTO X Y" del proyector, o nada si no se puede decidir.
geometria_proyector() {
    local quiero="$1" lineas
    tiene xrandr && hay_pantalla || return 1
    # Ejemplo de línea: "HDMI-1 connected 1024x768+1920+0 (normal ...)"
    lineas="$(xrandr --query 2>/dev/null | awk '
        / connected/ {
            nombre=$1; prim=($3=="primary")?1:0; geo="";
            for(i=3;i<=NF;i++) if($i ~ /^[0-9]+x[0-9]+\+[0-9]+\+[0-9]+$/){geo=$i; break}
            if(geo!=""){ split(geo,a,/[x+]/); print nombre, a[1], a[2], a[3], a[4], prim }
        }')"
    if [ "$quiero" != "auto" ]; then
        printf '%s\n' "$lineas" | awk -v n="$quiero" '$1==n {print $1,$2,$3,$4,$5; f=1} END{exit !f}'
        return $?
    fi
    # auto: si hay exactamente 2 pantallas encendidas, la que no es la principal
    if [ "$(printf '%s\n' "$lineas" | grep -c .)" = "2" ]; then
        printf '%s\n' "$lineas" | awk '$6==0 {print $1,$2,$3,$4,$5; exit}'
        return 0
    fi
    return 1
}

# ---------------------------------------------------------------------
# Archivo de configuración de Vrui generado por nosotros
# ---------------------------------------------------------------------

# generar_config_vrui ARCHIVO_SALIDA [X Y ANCHO ALTO]
generar_config_vrui() {
    local salida="$1" gx="${2:-}" gy="${3:-}" gw="${4:-}" gh="${5:-}"
    mkdir -p "$(dirname "$salida")"
    {
        printf '%s\n' "$MARCA_GENERADO"
        printf '# Se vuelve a escribir cada vez que se abre el sandbox. No lo edites:\n'
        printf '# cambia sandbox.conf en su lugar.\n'
        printf '# VERIFICAR EN LA COMPUTADORA DEL SANDBOX: nombres de secciones de Vrui 4.x.\n\n'
        printf 'section Vrui\n'
        printf '    section %s\n' "$SECCION_RAIZ_VRUI"
        if [ "$METODO_PANTALLA_COMPLETA" = "vrui" ] && [ -n "$gx" ]; then
            printf '        section Window\n'
            printf '            # VERIFICAR: en Vrui 4.6 la posición podría llamarse distinto\n'
            printf '            windowPos (%s, %s), (%s, %s)\n' "$gx" "$gy" "$gw" "$gh"
            printf '            windowFullscreen true\n'
            printf '        endsection\n'
        fi
        printf '        section Tools\n'
        printf '            # Dónde guarda el relieve la herramienta "Save Bathymetry"\n'
        printf '            section BathymetrySaverTool\n'
        printf '                saveFileName "%s"\n' "$RUTA_DEM"
        printf '            endsection\n'
        printf '            # Herramienta creada al arrancar, asignada a la tecla %s\n' "$TECLA_GUARDAR"
        printf '            section DefaultTools\n'
        printf '                section PanelGuardarRelieve\n'
        printf '                    toolClass BathymetrySaverTool\n'
        printf '                    bindings ((Mouse, %s))\n' "$TECLA_GUARDAR"
        printf '                endsection\n'
        printf '            endsection\n'
        printf '        endsection\n'
        printf '    endsection\n'
        printf 'endsection\n'
    } > "$salida"
}

# ---------------------------------------------------------------------
# Red y puerto
# ---------------------------------------------------------------------

puerto_ocupado() {  # 0 si el puerto ya está en uso
    python3 - "$1" <<'PY'
import socket, sys
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
try:
    s.bind(("0.0.0.0", int(sys.argv[1])))
except OSError:
    sys.exit(0)
finally:
    s.close()
sys.exit(1)
PY
}

quien_usa_puerto() {
    if tiene ss; then ss -ltnp 2>/dev/null | grep -E "[:.]$1[[:space:]]" | head -3
    elif tiene lsof; then lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -3
    fi
}

# ---------------------------------------------------------------------
# Procesos
# ---------------------------------------------------------------------

proceso_vivo() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

# detener_proceso PID NOMBRE: pide cerrar (TERM), espera hasta 5 s y si no, lo fuerza (KILL).
detener_proceso() {
    local pid="$1" nombre="$2" i=0
    proceso_vivo "$pid" || return 0
    kill -TERM "$pid" 2>/dev/null
    while proceso_vivo "$pid" && [ $i -lt 50 ]; do sleep 0.1; i=$((i + 1)); done
    if proceso_vivo "$pid"; then
        aviso "$nombre no se cerró a tiempo; lo cierro a la fuerza."
        kill -KILL "$pid" 2>/dev/null
    fi
    wait "$pid" 2>/dev/null || true
}

# Traduce CALIDAD_AGUA a tamaño de malla y pasos máximos.
# Deja el resultado en AGUA_MALLA_ANCHO, AGUA_MALLA_ALTO y AGUA_PASOS. Devuelve 1 si el valor no es válido.
parametros_agua() {
    case "$CALIDAD_AGUA" in
        alta)   AGUA_MALLA_ANCHO=640; AGUA_MALLA_ALTO=480; AGUA_PASOS=30 ;;
        media)  AGUA_MALLA_ANCHO=480; AGUA_MALLA_ALTO=360; AGUA_PASOS=20 ;;
        ligera) AGUA_MALLA_ANCHO=320; AGUA_MALLA_ALTO=240; AGUA_PASOS=12 ;;
        manual)
            # shellcheck disable=SC2086
            set -- $AGUA_MALLA
            AGUA_MALLA_ANCHO="$1"; AGUA_MALLA_ALTO="$2"; AGUA_PASOS="$AGUA_PASOS_MAXIMOS"
            ;;
        *) return 1 ;;
    esac
    case "$AGUA_MALLA_ANCHO$AGUA_MALLA_ALTO$AGUA_PASOS" in
        ''|*[!0-9]*) return 1 ;;
    esac
    [ "$AGUA_MALLA_ANCHO" -ge 64 ] && [ "$AGUA_MALLA_ALTO" -ge 48 ] && [ "$AGUA_PASOS" -ge 2 ]
}
