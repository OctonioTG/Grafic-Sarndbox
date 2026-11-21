#!/usr/bin/env bash
# =====================================================================
#  iniciar_sandbox.sh — Arranca el AR Sandbox y el panel web.
#
#  Uso:
#    ./iniciar_sandbox.sh               arrancar todo (uso normal)
#    ./iniciar_sandbox.sh --simulacion  probar sin Kinect/proyector (SARndbox falso)
#    ./iniciar_sandbox.sh --revisar     solo revisar que todo esté listo, sin abrir nada
#    ./iniciar_sandbox.sh --ayuda
#
#  Orden: revisar -> panel -> mostrar dirección -> SARndbox -> pantalla completa
#  Cuando el SARndbox se cierra, se cierra también el panel.
#  Todo lo que pasa queda en la carpeta logs/.
# =====================================================================

set -u
# shellcheck source=scripts/comun.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts/comun.sh"

MODO="real"
SOLO_REVISAR=0
SIN_VENTANAS=0
for arg in "$@"; do
    case "$arg" in
        --simulacion|--simulación) MODO="simulacion" ;;
        --revisar) SOLO_REVISAR=1 ;;
        --sin-ventanas) SIN_VENTANAS=1 ;;   # no abrir ventanas ni navegador (para pruebas)
        -h|--ayuda|--help)
            sed -n '2,16p' "$0" | sed 's/^#  \{0,1\}//'
            exit 0 ;;
        *) error_grave "Opción desconocida: $arg  (usa --ayuda)"; exit 2 ;;
    esac
done
export SIN_VENTANAS

cargar_config || exit 1

# ---------------------------------------------------------------------
# Registro (log): todo lo que se muestra también se guarda en logs/
# ---------------------------------------------------------------------
mkdir -p "$CARPETA_LOGS" "$CARPETA_ESTADO"
if [ "$SOLO_REVISAR" = "0" ]; then
    LOG="$CARPETA_LOGS/sandbox_$(date +%Y%m%d_%H%M%S)_$MODO.log"
    # conservar solo los 20 registros más recientes
    # shellcheck disable=SC2012
    ls -1t "$CARPETA_LOGS"/sandbox_*.log 2>/dev/null | tail -n +20 | while IFS= read -r viejo; do rm -f "$viejo"; done
    exec > >(tee -a "$LOG") 2>&1
    info "Registro de esta sesión: $LOG"
fi
info "=== AR Sandbox — $(date '+%d/%m/%Y %H:%M:%S') — modo: $MODO ==="

# ---------------------------------------------------------------------
# 1. Revisiones
# ---------------------------------------------------------------------
PROBLEMAS=""
problema() { PROBLEMAS="${PROBLEMAS}
 - $*"; info "  [FALLA] $*"; }
ok() { info "  [ok]    $*"; }

info ""
info "Revisando..."

# Python y librerías del panel
if ! tiene python3; then
    problema "No está instalado python3. Ejecuta instalar.sh."
else
    ok "python3 $(python3 -c 'import sys; print(sys.version.split()[0])')"
    faltan="$(python3 -c '
import importlib.util as u
print(" ".join(m for m in ("numpy","matplotlib","scipy") if u.find_spec(m) is None))' 2>/dev/null)"
    if [ -n "$faltan" ]; then
        problema "Faltan librerías de Python: $faltan. Ejecuta instalar.sh (una sola vez)."
    else
        ok "librerías del panel (numpy, matplotlib, scipy)"
    fi
fi

# Puerto del panel
case "$PUERTO" in ''|*[!0-9]*) problema "PUERTO en sandbox.conf debe ser un número (ahora: \"$PUERTO\")." ;;
    *)
        if tiene python3 && puerto_ocupado "$PUERTO"; then
            problema "El puerto $PUERTO ya está ocupado (¿quedó otro panel abierto?).
   Ciérralo o cambia PUERTO en sandbox.conf (por ejemplo a 8080).
   $(quien_usa_puerto "$PUERTO")"
        else
            ok "puerto $PUERTO libre"
        fi ;;
esac

# Ruta del .dem
if [ "$MODO" = "simulacion" ]; then
    RUTA_DEM="$CARPETA_ESTADO/simulacion/BathymetrySaverTool.dem"
fi
CARPETA_DEM="$(dirname "$RUTA_DEM")"
case "$RUTA_DEM" in
    /*) ;;
    *) problema "RUTA_DEM debe ser una ruta completa (que empiece con / o con \$HOME). Ahora: $RUTA_DEM" ;;
esac
case "$RUTA_DEM" in *" "*) aviso "RUTA_DEM tiene espacios; es más seguro usar una ruta sin espacios." ;; esac
padre="$CARPETA_DEM"   # en --revisar no se crea nada: basta con poder crearla
while [ ! -d "$padre" ] && [ "$padre" != "/" ]; do padre="$(dirname "$padre")"; done
if [ "$SOLO_REVISAR" = "1" ] && [ -w "$padre" ]; then
    ok "carpeta del relieve: $CARPETA_DEM"
elif mkdir -p "$CARPETA_DEM" 2>/dev/null && [ -w "$CARPETA_DEM" ]; then
    ok "carpeta del relieve: $CARPETA_DEM"
else
    problema "No puedo escribir en la carpeta del relieve: $CARPETA_DEM (revisa RUTA_DEM en sandbox.conf)."
fi

# Que no esté abierto ya
LOCK="$CARPETA_ESTADO/ejecutando"
if [ -d "$LOCK" ]; then
    pid_viejo="$(cat "$LOCK/lanzador.pid" 2>/dev/null)"
    if proceso_vivo "$pid_viejo"; then
        error_grave "El AR Sandbox ya está abierto (proceso $pid_viejo).
No se abre una segunda copia. Si no lo ves, ciérralo primero o reinicia la computadora."
        exit 1
    fi
fi

SARNDBOX=""
GEO=""
if [ "$MODO" = "real" ]; then
    if ! hay_pantalla; then
        problema "No hay pantalla gráfica (DISPLAY vacío). Abre esto desde el escritorio de Mint."
    fi

    # Ejecutable
    if [ -n "$SARNDBOX_EJECUTABLE" ]; then
        SARNDBOX="${SARNDBOX_EJECUTABLE/#\~/$HOME}"
        [ -x "$SARNDBOX" ] || problema "SARNDBOX_EJECUTABLE no existe o no se puede ejecutar: $SARNDBOX
   Corrige la ruta en sandbox.conf (sección 1)."
    else
        SARNDBOX="$(candidatos_sarndbox | head -1)"
        if [ -z "$SARNDBOX" ]; then
            problema "No encontré el programa SARndbox. Búscalo con:
     find ~ /usr/local /opt -name SARndbox -type f 2>/dev/null
   y escribe la ruta en SARNDBOX_EJECUTABLE dentro de sandbox.conf."
        fi
    fi
    if [ -n "$SARNDBOX" ] && [ -x "$SARNDBOX" ]; then
        VERSION="$(version_sarndbox "$SARNDBOX")"
        if [ -z "$VERSION" ]; then
            aviso "No pude saber la versión del SARndbox. Se necesita 2.2 o más nueva para guardar el relieve."
            ok "SARndbox: $SARNDBOX (versión desconocida)"
        elif version_al_menos "$VERSION" 2.2; then
            ok "SARndbox $VERSION: $SARNDBOX"
        else
            problema "El SARndbox es versión $VERSION. La herramienta para guardar el relieve necesita 2.2 o más nueva."
        fi
    fi

    # Calibración (solo se lee; nunca se modifica)
    ETC=""
    [ -n "$SARNDBOX" ] && [ -x "$SARNDBOX" ] && ETC="$(carpeta_etc_sarndbox "$SARNDBOX")"
    BOX="${ARCHIVO_BOXLAYOUT/#\~/$HOME}"
    [ -z "$BOX" ] && [ -n "$ETC" ] && BOX="$ETC/BoxLayout.txt"
    PROY="${ARCHIVO_PROYECTOR/#\~/$HOME}"
    if [ -z "$PROY" ]; then
        if [ -n "$BOX" ]; then PROY="$(dirname "$BOX")/ProjectorMatrix.dat"; fi
    fi
    if [ -n "$BOX" ] && [ -r "$BOX" ]; then ok "calibración de la caja: $BOX"
    else problema "No encuentro BoxLayout.txt (calibración de la caja). Escribe su ruta en ARCHIVO_BOXLAYOUT (sandbox.conf)."; fi
    if [ -n "$PROY" ] && [ -r "$PROY" ]; then ok "calibración del proyector: $PROY"
    else problema "No encuentro ProjectorMatrix.dat (calibración del proyector). Escribe su ruta en ARCHIVO_PROYECTOR (sandbox.conf)."; fi

    # Agua
    if awk -v v="$AGUA_VELOCIDAD" 'BEGIN{exit !(v+0>0)}'; then
        if parametros_agua; then
            ok "simulación de agua encendida, calidad \"$CALIDAD_AGUA\" (malla ${AGUA_MALLA_ANCHO}x${AGUA_MALLA_ALTO}, hasta $AGUA_PASOS pasos por cuadro)"
        else
            problema "CALIDAD_AGUA=\"$CALIDAD_AGUA\" no es válido. Usa alta, media, ligera o manual (con AGUA_MALLA=\"ancho alto\" y AGUA_PASOS_MAXIMOS)."
        fi
    else
        problema "AGUA_VELOCIDAD debe ser mayor que 0; sin agua no existe la herramienta de guardar relieve."
    fi

    # Método de configuración de Vrui
    case "$METODO_CONFIG_VRUI" in
        mergeConfig|manual) ok "configuración de Vrui: $METODO_CONFIG_VRUI" ;;
        usuario)
            [ -z "$VRUI_VERSION" ] && VRUI_VERSION="$(detectar_vrui_version)"
            if [ -z "$VRUI_VERSION" ]; then
                problema "No pude detectar la versión de Vrui. Escríbela en VRUI_VERSION (sandbox.conf), por ejemplo 4.6"
            else
                ok "configuración de Vrui en $(ruta_config_usuario_vrui "$VRUI_VERSION")"
            fi ;;
        *) problema "METODO_CONFIG_VRUI debe ser mergeConfig, usuario o manual." ;;
    esac

    # Proyector
    case "$METODO_PANTALLA_COMPLETA" in
        xdotool|vrui)
            [ "$METODO_PANTALLA_COMPLETA" = "xdotool" ] && ! tiene xdotool && \
                problema "Falta el programa xdotool (para la pantalla completa). Ejecuta instalar.sh o usa METODO_PANTALLA_COMPLETA=\"manual\"."
            GEO="$(geometria_proyector "$MONITOR_PROYECTOR")"
            if [ -n "$GEO" ]; then
                ok "proyector: $GEO  (nombre ancho alto x y)"
            else
                problema "No pude identificar el proyector (MONITOR_PROYECTOR=\"$MONITOR_PROYECTOR\").
   Mira los nombres con:  xrandr --query   y escribe el del proyector en MONITOR_PROYECTOR."
            fi ;;
        manual) ok "pantalla completa: manual (mover ventana al proyector y presionar F11)" ;;
        *) problema "METODO_PANTALLA_COMPLETA debe ser xdotool, vrui o manual." ;;
    esac

    # Otro SARndbox abierto
    if tiene pgrep && pgrep -x SARndbox >/dev/null 2>&1; then
        problema "Ya hay un SARndbox abierto. Ciérralo antes de usar este ícono."
    fi
fi

if [ "$SOLO_REVISAR" = "0" ] && [ "$SIN_VENTANAS" = "0" ] && [ "$MOSTRAR_DIRECCION" = "si" ] && hay_pantalla && ! tiene zenity; then
    aviso "No está zenity; la dirección del panel solo se verá en la terminal y en el navegador."
fi

if [ -n "$PROBLEMAS" ]; then
    error_grave "No se puede iniciar el AR Sandbox. Hay que arreglar esto:
$PROBLEMAS

Edita el archivo:  $ARCHIVO_CONF
Registro: ${LOG:-(sin registro)}"
    exit 1
fi
info "Todo listo."
[ "$SOLO_REVISAR" = "1" ] && exit 0

# ---------------------------------------------------------------------
# 2. Candado (una sola copia) y limpieza al salir
# ---------------------------------------------------------------------
if [ -d "$LOCK" ]; then
    # Quedó de una sesión que terminó mal: cerrar lo que haya quedado colgado
    for f in "$LOCK"/*.pid; do
        [ -f "$f" ] || continue
        pid="$(cat "$f")"
        if proceso_vivo "$pid" && ps -p "$pid" -o command= 2>/dev/null | grep -q -e servidor.py -e SARndbox -e sarndbox_falso -e zenity; then
            aviso "Cerrando un proceso que quedó de una sesión anterior ($(basename "$f" .pid), $pid)."
            kill -TERM "$pid" 2>/dev/null
        fi
    done
    rm -rf "$LOCK"
fi
if ! mkdir "$LOCK" 2>/dev/null; then
    error_grave "El AR Sandbox ya se está abriendo en otra ventana."
    exit 1
fi
echo $$ > "$LOCK/lanzador.pid"

PID_PANEL=""; PID_SANDBOX=""; PID_VENTANA=""; PID_PANTALLA=""; PID_REVISOR=""
YA_LIMPIO=0
limpiar() {
    [ "$YA_LIMPIO" = "1" ] && return
    YA_LIMPIO=1
    trap '' INT TERM HUP
    info ""
    info "Cerrando todo..."
    detener_proceso "$PID_PANTALLA" "ayudante de pantalla completa"
    detener_proceso "$PID_REVISOR" "revisor del registro"
    detener_proceso "$PID_SANDBOX" "SARndbox"
    detener_proceso "$PID_PANEL" "panel"
    detener_proceso "$PID_VENTANA" "ventana de la dirección"
    rm -rf "$LOCK"
    info "Listo: no quedó nada abierto. ($(date '+%H:%M:%S'))"
}
trap limpiar EXIT
trap 'exit 130' INT TERM HUP

# ---------------------------------------------------------------------
# 3. Panel web
# ---------------------------------------------------------------------
info ""
info "Iniciando el panel (puerto $PUERTO), vigilando: $RUTA_DEM"
HISTORIAL="$RAIZ/panel/historial"
[ "$MODO" = "simulacion" ] && HISTORIAL="$RAIZ/panel/historial_simulacion"
set -- --vigilar "$RUTA_DEM" --puerto "$PUERTO" --historial "$HISTORIAL" --sin-navegador --no-instalar
[ -n "$ESCALA_METROS_POR_CM" ] && set -- "$@" --escala "$ESCALA_METROS_POR_CM"
[ "$AJUSTES_DESDE_OTROS_EQUIPOS" = "si" ] && set -- "$@" --ajustes-remotos
python3 -u "$RAIZ/panel/servidor.py" "$@" </dev/null &
PID_PANEL=$!
echo "$PID_PANEL" > "$LOCK/panel.pid"

# Esperar a que responda (la primera vez matplotlib puede tardar hasta un minuto)
URLS=""
i=0
while [ $i -lt 120 ]; do
    URLS="$(python3 - "$PUERTO" <<'PY' 2>/dev/null
import json, sys, urllib.request
d = json.load(urllib.request.urlopen(f"http://127.0.0.1:{sys.argv[1]}/api/estado", timeout=2))
print(" ".join(d.get("urls") or []) or "-")
PY
)" && break
    if ! proceso_vivo "$PID_PANEL"; then
        error_grave "El panel se cerró al arrancar. Revisa el registro:
${LOG}"
        exit 1
    fi
    sleep 1; i=$((i + 1))
done
if [ -z "$URLS" ]; then
    error_grave "El panel no respondió después de 2 minutos. Revisa el registro:
${LOG}"
    exit 1
fi
[ "$URLS" = "-" ] && URLS=""
ok "panel funcionando"

# ---------------------------------------------------------------------
# 4. Mostrar la dirección en la pantalla principal
# ---------------------------------------------------------------------
TEXTO_DIR="Panel del AR Sandbox

En esta computadora:   http://localhost:$PUERTO"
for u in $URLS; do TEXTO_DIR="$TEXTO_DIR
Celulares y otras computadoras (misma red wifi):   $u"; done
[ -z "$URLS" ] && TEXTO_DIR="$TEXTO_DIR
(No se detectó conexión de red: los celulares no podrán entrar.)"
TEXTO_DIR="$TEXTO_DIR

En el panel, el botón \"Conectar dispositivo\" muestra un código QR.
Tecla para guardar el relieve en el sandbox:  $TECLA_GUARDAR
(Esta ventana se cierra sola al cerrar el sandbox.)"
info ""
info "$TEXTO_DIR"
info ""

if [ "$SIN_VENTANAS" = "0" ] && hay_pantalla; then
    if [ "$MOSTRAR_DIRECCION" = "si" ] && tiene zenity; then
        # VERIFICAR EN LA COMPUTADORA DEL SANDBOX: que la ventana aparezca en la pantalla principal
        zenity --info --title="AR Sandbox — dirección del panel" --no-markup --width=560 \
            --text="$TEXTO_DIR" >/dev/null 2>&1 &
        PID_VENTANA=$!
        echo "$PID_VENTANA" > "$LOCK/ventana.pid"
    fi
    if [ "$ABRIR_NAVEGADOR" = "si" ]; then
        if tiene xdg-open; then xdg-open "http://localhost:$PUERTO" >/dev/null 2>&1 &
        elif tiene open; then open "http://localhost:$PUERTO" >/dev/null 2>&1 &
        fi
    fi
fi

# ---------------------------------------------------------------------
# 5. SARndbox (real o falso)
# ---------------------------------------------------------------------
info ""
if [ "$MODO" = "simulacion" ]; then
    info "Iniciando el SARndbox FALSO (simulación)."
    set -- "$RAIZ/scripts/sarndbox_falso.py" --dem "$RUTA_DEM" --cada "$SIMULACION_CADA" --duracion "$SIMULACION_DURACION"
    if [ -t 0 ] && [ -r /dev/tty ]; then
        python3 -u "$@" </dev/tty &
    else
        python3 -u "$@" </dev/null &
    fi
    PID_SANDBOX=$!
else
    # Opciones de Vrui primero, luego las del SARndbox.
    # VERIFICAR EN LA COMPUTADORA DEL SANDBOX: que Vrui acepte sus opciones en esta posición.
    set --
    case "$METODO_CONFIG_VRUI" in
        mergeConfig)
            CFG_VRUI="$CARPETA_ESTADO/vrui_sandbox.cfg"
            # shellcheck disable=SC2086
            generar_config_vrui "$CFG_VRUI" $(printf '%s' "$GEO" | awk '{print $4, $5, $2, $3}')
            set -- -mergeConfig "$CFG_VRUI"
            info "Configuración para Vrui (tecla y ruta del .dem): $CFG_VRUI" ;;
        usuario)
            CFG_VRUI="$(ruta_config_usuario_vrui "$VRUI_VERSION")"
            if [ -f "$CFG_VRUI" ] && ! grep -qF "$MARCA_GENERADO" "$CFG_VRUI"; then
                mkdir -p "$CARPETA_RESPALDOS"
                copia="$CARPETA_RESPALDOS/SARndbox.cfg.$(date +%Y%m%d_%H%M%S)"
                cp -p "$CFG_VRUI" "$copia"
                printf '%s\t%s\n' "$CFG_VRUI" "$copia" >> "$CARPETA_ESTADO/respaldos.txt"
                info "Respaldo del archivo de Vrui que ya existía: $copia"
            fi
            # shellcheck disable=SC2086
            generar_config_vrui "$CFG_VRUI" $(printf '%s' "$GEO" | awk '{print $4, $5, $2, $3}')
            grep -qxF "$CFG_VRUI" "$CARPETA_ESTADO/creados.txt" 2>/dev/null || \
                printf '%s\n' "$CFG_VRUI" >> "$CARPETA_ESTADO/creados.txt"
            info "Configuración para Vrui escrita en: $CFG_VRUI" ;;
        manual)
            info "Sin configuración de Vrui: asigna la tecla a mano (ver LEEME.md)." ;;
    esac
    # shellcheck disable=SC2086
    set -- "$@" $VRUI_OPCIONES_EXTRA $OPCIONES_SARNDBOX -slf "$BOX" -fpv "$PROY" -wts "$AGUA_MALLA_ANCHO" "$AGUA_MALLA_ALTO" -ws "$AGUA_VELOCIDAD" "$AGUA_PASOS"
    info "Iniciando: $SARNDBOX $*"
    info "(desde la carpeta $CARPETA_DEM, para que el .dem quede ahí)"
    # "exec" hace que el número de proceso guardado sea el del propio SARndbox
    ( cd "$CARPETA_DEM" && exec "$SARNDBOX" "$@" ) </dev/null &
    PID_SANDBOX=$!
fi
echo "$PID_SANDBOX" > "$LOCK/sandbox.pid"

# Pantalla completa en el proyector
if [ "$MODO" = "real" ] && [ "$METODO_PANTALLA_COMPLETA" = "xdotool" ]; then
    (
        # shellcheck disable=SC2086
        set -- $GEO   # nombre ancho alto x y
        id=""; n=0
        while [ -z "$id" ] && [ $n -lt 60 ] && proceso_vivo "$PID_SANDBOX"; do
            id="$(xdotool search --onlyvisible --pid "$PID_SANDBOX" 2>/dev/null | head -1)"
            [ -z "$id" ] && id="$(xdotool search --onlyvisible --name "^${TITULO_VENTANA}\$" 2>/dev/null | head -1)"
            [ -z "$id" ] && sleep 1
            n=$((n + 1))
        done
        if [ -z "$id" ]; then
            echo "AVISO: no encontré la ventana del SARndbox (TITULO_VENTANA=\"$TITULO_VENTANA\"). Muévela al proyector y presiona F11."
            exit 0
        fi
        sleep 2
        xdotool windowmove "$id" "$4" "$5"
        sleep 1
        xdotool windowactivate --sync "$id" 2>/dev/null
        xdotool key --window "$id" F11
        echo "Ventana del SARndbox enviada al proyector ($1) y puesta en pantalla completa (F11)."
    ) &
    PID_PANTALLA=$!
fi

# Revisiones mientras corre el SARndbox:
#  - si Vrui ignoró -mergeConfig (la tecla de guardar no quedó asignada);
#  - si la simulación de agua no alcanza a ir en tiempo real. El SARndbox
#    escribe "Ran out of time by ..." cada cuadro en que le faltaron pasos.
if [ "$MODO" = "real" ]; then
    (
        n=0
        while [ $n -lt 15 ] && proceso_vivo "$PID_SANDBOX"; do sleep 1; n=$((n + 1)); done
        if [ "$METODO_CONFIG_VRUI" = "mergeConfig" ] && grep -q "unrecognized command line switch -mergeConfig" "$LOG" 2>/dev/null; then
            aviso_ventana "Vrui no reconoció la opción -mergeConfig.
La tecla \"$TECLA_GUARDAR\" NO quedó asignada automáticamente.
Por ahora asígnala a mano (LEEME.md, \"Asignar la tecla a mano\") o cambia
METODO_CONFIG_VRUI a \"usuario\" en sandbox.conf."
        fi
        antes=0
        while proceso_vivo "$PID_SANDBOX"; do
            sleep 60
            ahora=$(grep -c "Ran out of time" "$LOG" 2>/dev/null)
            ahora=${ahora:-0}
            # Más de ~5 cuadros por segundo sin terminar durante un minuto
            if [ $((ahora - antes)) -gt 300 ]; then
                echo "AVISO: la simulación de agua no alcanza a ir en tiempo real (el agua se mueve más lento)."
                echo "       Si se nota, bajen CALIDAD_AGUA en sandbox.conf (ahora: \"$CALIDAD_AGUA\")."
                break
            fi
            antes=$ahora
        done
    ) &
    PID_REVISOR=$!
fi

info ""
info "Todo arrancado. Para terminar, cierra el SARndbox (tecla Esc o cerrando su ventana)."
[ "$MODO" = "simulacion" ] && info "En simulación: Enter = guardar relieve, q + Enter = cerrar, o Ctrl+C."

# ---------------------------------------------------------------------
# 6. Esperar a que se cierre el SARndbox; luego se cierra todo (limpiar)
# ---------------------------------------------------------------------
while proceso_vivo "$PID_SANDBOX"; do
    if ! proceso_vivo "$PID_PANEL"; then
        aviso_ventana "El panel se cerró inesperadamente. El SARndbox sigue funcionando; revisa el registro: $LOG"
        PID_PANEL=""
        wait "$PID_SANDBOX" 2>/dev/null
        break
    fi
    sleep 1
done
info "El SARndbox se cerró."
exit 0
