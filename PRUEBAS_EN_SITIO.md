# Pruebas en la computadora del sandbox

*English version: [ON_SITE_TESTING.md](ON_SITE_TESTING.md)*

Lista paso a paso para el día de las pruebas. Marquen cada casilla `[ ]` → `[x]` y anoten lo que encuentren en la columna de notas o al final.

**Tiempo estimado:** 1 a 2 horas.
**Lleven:** esta carpeta en una USB, un celular con wifi y, si la red de la escuela da problemas, un router o un celular para compartir internet.

> Regla de oro: **nunca editar ni borrar** `BoxLayout.txt` ni `ProjectorMatrix.dat`. En el paso 1.6 se hace una copia de seguridad, solo por precaución.

---

## Lo que quedó marcado "VERIFICAR EN LA COMPUTADORA DEL SANDBOX"

| # | Qué hay que confirmar | Dónde se ajusta | Paso |
|---|---|---|---|
| V1 | Dónde está instalado el SARndbox y qué versión es (debe ser 2.2 o más) | `SARNDBOX_EJECUTABLE` | 1.1 |
| V2 | Dónde está la calibración (`BoxLayout.txt`, `ProjectorMatrix.dat`) | `ARCHIVO_BOXLAYOUT`, `ARCHIVO_PROYECTOR` | 1.2 |
| V3 | Con qué opciones lo arrancaban antes | `OPCIONES_SARNDBOX` | 1.3 |
| V4 | Versión de Vrui y si existe una sección con el nombre de la computadora | `VRUI_VERSION`, `SECCION_RAIZ_VRUI` | 1.4 |
| V5 | Nombre de la salida del proyector | `MONITOR_PROYECTOR` | 1.5 |
| V6 | Que Vrui acepte `-mergeConfig` (tecla automática y ruta del .dem) | `METODO_CONFIG_VRUI` | 4 |
| V7 | Que la tecla `g` esté libre y que funcione la sección `DefaultTools` | `TECLA_GUARDAR` | 4 |
| V8 | Que el .dem quede en `RUTA_DEM` (por `saveFileName` o por la carpeta de arranque) | `RUTA_DEM` | 4 |
| V9 | Título de la ventana del SARndbox, y que xdotool la mueva al proyector y active F11 | `TITULO_VENTANA`, `METODO_PANTALLA_COMPLETA` | 3 |
| V10 | Que la ventanita con la dirección y el navegador aparezcan en la pantalla principal y no en el proyector | `MOSTRAR_DIRECCION`, `ABRIR_NAVEGADOR` | 5 |
| V11 | Que el ícono quede marcado como confiable (doble clic sin preguntas) | — | 2 |
| V12 | Si la computadora aguanta el agua (velocidad, fluidez) | `AGUA_VELOCIDAD`, `AGUA_PASOS_MAXIMOS` | 3 |

---

## 1. Revisar cómo está instalado (antes de cambiar nada)

Abran una Terminal. Copien cada comando, péguenlo con `Ctrl+Shift+V` y anoten el resultado.

- [ ] **1.1 Programa SARndbox**

  ```bash
  which SARndbox; ls -d ~/src/SARndbox-* /opt/SARndbox-* /usr/local/bin/SARndbox 2>/dev/null
  ```

  ```bash
  find ~ /usr/local /opt -name SARndbox -type f 2>/dev/null
  ```

  Anoten la ruta (por ejemplo `/home/sandbox/src/SARndbox-2.6/bin/SARndbox`) y la versión (el número en el nombre de la carpeta).

- [ ] **1.2 Calibración**

  ```bash
  find ~ /usr/local -name BoxLayout.txt -o -name ProjectorMatrix.dat 2>/dev/null
  ```

  Normalmente están juntas en `.../SARndbox-2.6/etc/SARndbox-2.6/`. Si hay varias copias, pregunten cuál es la buena (la fecha más reciente suele ser la correcta: `ls -l RUTA`).

- [ ] **1.3 Cómo lo arrancaban antes.** Pregunten a quien lo usa, o busquen:

  ```bash
  grep -h SARndbox ~/.bash_history 2>/dev/null | sort | uniq -c | sort -rn | head
  ```

  ```bash
  grep -rl SARndbox ~/Desktop ~/Escritorio ~/.local/share/applications ~/bin 2>/dev/null
  ```

  Copien las opciones que usaban (por ejemplo `-uhm -fpv -ucl 1.0`) a `OPCIONES_SARNDBOX`. **No** copien `-fpv`, `-slf` ni `-ws`: el lanzador las agrega solo. Si usaban `-ws 0 0` (agua apagada), anótenlo: eso quiere decir que la computadora iba lenta con agua (ver V12).

- [ ] **1.4 Vrui**

  ```bash
  ls -d /usr/local/etc/Vrui-* ~/Vrui-* /usr/local/share/Vrui-* 2>/dev/null; hostname
  ```

  ```bash
  grep -n "^section" /usr/local/etc/Vrui-*/Vrui.cfg | head -30
  ```

  Si en la lista aparece una sección con el **mismo nombre** que dio `hostname`, escriban ese nombre en `SECCION_RAIZ_VRUI`.

- [ ] **1.5 Pantallas.** Con el proyector encendido y conectado:

  ```bash
  xrandr --query | grep " connected"
  ```

  La línea con `primary` es la pantalla principal; la otra es el proyector. Anoten su nombre (por ejemplo `HDMI-1`) y su tamaño (por ejemplo `1024x768+1920+0`).

- [ ] **1.6 Copia de seguridad de la calibración** (solo copia, no cambia nada). Cambien la ruta por la del paso 1.2:

  ```bash
  cp -a ~/src/SARndbox-2.6/etc/SARndbox-2.6 ~/respaldo-calibracion-$(date +%Y%m%d)
  ```

- [ ] **1.7 Ayuda del programa** (para confirmar opciones; la ventana puede abrirse, ciérrenla con `Esc`):

  ```bash
  SARndbox -h 2>&1 | head -80
  ```

  Confirmen que existen `-ws`, `-fpv`, `-slf` y `-uhm`.

---

## 2. Instalar y configurar

- [ ] Copien la carpeta del proyecto a la computadora (por ejemplo `~/panel-sandbox`).
- [ ] En una terminal dentro de esa carpeta:

  ```bash
  bash instalar.sh
  ```

  Contesten `s` para instalar lo que falte.
- [ ] Abran `sandbox.conf` con el editor de textos y llenen lo que anotaron en el paso 1 (V1–V5). Guarden.
- [ ] Revisen:

  ```bash
  ./iniciar_sandbox.sh --revisar
  ```

  Todo debe salir `[ok]`. Si algo sale `[FALLA]`, el mensaje dice qué corregir.
- [ ] **Primero, la simulación** en esta computadora (sin tocar el SARndbox real):

  ```bash
  ./iniciar_sandbox.sh --simulacion
  ```

  Debe abrirse el navegador con el panel. Presionen `Enter` en la terminal: en unos segundos aparece una captura nueva en el panel. Escriban `q` y `Enter`: todo se cierra.
- [ ] **V11:** en el escritorio debe estar el ícono "AR Sandbox". Si al hacer doble clic Mint pregunta, elijan "Confiar y ejecutar" o "Marcar como confiable". Anoten si preguntó.

---

## 3. SARndbox con agua y en el proyector

- [ ] Abran el ícono **AR Sandbox** (o `./iniciar_sandbox.sh` en la terminal para ver mensajes).
- [ ] **V9:** el SARndbox debe aparecer **en el proyector, en pantalla completa**, a los pocos segundos.
  - Si se abre en la pantalla principal: anoten el título de la ventana con:

    ```bash
    xdotool search --name . getwindowname %@ 2>/dev/null | grep -i -e sandbox -e vrui
    ```

    Escríbanlo en `TITULO_VENTANA`.
  - Si se mueve pero no queda completa: hagan clic en la ventana y presionen `F11`. Prueben también `METODO_PANTALLA_COMPLETA="vrui"`.
- [ ] **Calibración correcta:** los colores y curvas de nivel deben coincidir con la arena real, igual que antes. Si están corridos, la ventana no quedó exactamente en pantalla completa en el proyector. **No recalibren**: primero revisen V5 y V9.
- [ ] **Agua:** pongan la mano abierta sobre la arena unos segundos: debe "llover" agua azul que corre hacia lo bajo. (En SARndbox 2.6 el agua está encendida mientras la velocidad sea mayor que 0; el lanzador usa `-ws 1.0 30`.)
- [ ] **V12:** si el sandbox va muy lento con agua, prueben `AGUA_VELOCIDAD="0.5"` y `AGUA_PASOS_MAXIMOS="20"`. No pongan 0: sin agua no se puede guardar el relieve.

---

## 4. Tecla para guardar el relieve (la parte más incierta)

- [ ] Revisen el registro más reciente (`logs/sandbox_..._real.log`). Si contiene la frase

  `Ignoring unrecognized command line switch -mergeConfig`

  significa que Vrui **no acepta** `-mergeConfig` (V6). El lanzador también lo avisa con una ventana. En ese caso vayan a "Plan B" más abajo.
- [ ] Hagan clic sobre la ventana del SARndbox y presionen **`g`** una vez.
- [ ] **V8:** confirmen que se creó o actualizó el archivo:

  ```bash
  ls -l --time-style=+%H:%M:%S ~/SARndbox-capturas/
  ```

  La hora de `BathymetrySaverTool.dem` debe ser la de hace unos segundos. Además, en el registro aparece una línea con dos números (alturas mínima y máxima), por ejemplo `-4.2, 13.7`: el SARndbox la escribe cada vez que guarda.
- [ ] Si al presionar `g` aparece un **menú de herramientas** en lugar de guardar, la tecla no quedó asignada automáticamente (V7). Sigan el Plan B.
- [ ] Si `g` ya hace otra cosa en el SARndbox, cambien `TECLA_GUARDAR` (por ejemplo a `9`) y prueben otra vez.

### Plan B (en este orden; prueben uno, cierren y vuelvan a abrir)

1. **Sección raíz:** si en el paso 1.4 vieron una sección con el nombre de la computadora, pongan ese nombre en `SECCION_RAIZ_VRUI`.
2. **Carpeta de usuario:** `METODO_CONFIG_VRUI="usuario"` y `VRUI_VERSION="4.6"` (o la versión del paso 1.4). El lanzador escribe `~/.config/Vrui-4.6/Applications/SARndbox.cfg`, y si ya existía, guarda primero un respaldo en `respaldos/`. Para deshacerlo: `./desinstalar.sh`.
3. **Asignar a mano y guardar las teclas de Vrui:** `METODO_CONFIG_VRUI="manual"`. Abran el sandbox, mantengan presionada `g`, elijan **"Save Bathymetry"** y suelten. Busquen en el menú de Vrui (botón derecho del mouse o el menú principal) una opción tipo **"Save Input Graph"**. Si existe, guarden el archivo en `~/SARndbox-capturas/teclas.inputgraph` y prueben `VRUI_OPCIONES_EXTRA="-loadInputGraph $HOME/SARndbox-capturas/teclas.inputgraph"`. (Ni el menú ni la opción están confirmados para Vrui 4.6.)
4. **Solo a mano:** `METODO_CONFIG_VRUI="manual"` y asignar la tecla cada vez que se abre (se explica en LEEME.md). Gracias a que el SARndbox arranca desde la carpeta de `RUTA_DEM`, el archivo debería quedar en el lugar correcto igualmente: confírmenlo con el comando de V8.

Anoten cuál funcionó: ______________________

---

## 5. Panel y celulares

- [ ] **V10:** al abrir el sandbox aparecieron, **en la pantalla principal** (no en el proyector):
  - una ventanita con la dirección del panel, y
  - el navegador con el panel.

  Si aparecen en el proyector, anótenlo. Mientras tanto, arrástrenlos a la pantalla principal, o pongan `ABRIR_NAVEGADOR="no"` y abran el navegador a mano.
- [ ] **Panel actualizándose:** presionen `g` en el SARndbox. En unos segundos, el panel muestra "analizando" y luego la captura nueva en el historial. También debe aparecer un archivo nuevo en `panel/historial/`.
- [ ] Muevan la arena (hagan un cerro y un valle), presionen `g` otra vez y revisen que el panel cambie y que compare con la captura anterior.
- [ ] **Celulares:** conecten un celular a la **misma red wifi**, escaneen el QR del botón "Conectar dispositivo" (o escriban la dirección). Debe abrir el panel. Presionen `g` y vean que el celular se actualiza solo.
  - Si no conecta: `sudo ufw status`. Si dice "active", ejecuten `sudo ufw allow 8000/tcp`. Si sigue sin conectar, la red bloquea conexiones entre equipos: prueben con un router propio o compartiendo internet desde un celular.

---

## 6. Cierre limpio

- [ ] Cierren el SARndbox con `Esc` (o cerrando su ventana).
- [ ] En unos segundos deben cerrarse también el panel y la ventanita de la dirección.
- [ ] Confirmen que no quedó nada abierto:

  ```bash
  ps aux | grep -e servidor.py -e SARndbox -e sarndbox_falso | grep -v grep
  ```

  No debe salir nada.

  ```bash
  ss -ltn | grep ':8000'
  ```

  Tampoco debe salir nada.
- [ ] Vuelvan a abrir el ícono: debe arrancar normal (sin "ya está abierto" ni "puerto ocupado").
- [ ] Con el sandbox abierto, hagan doble clic otra vez en el ícono: debe decir que **ya está abierto** y no abrir una segunda copia.

---

## 7. Al terminar

- [ ] Guarden una copia de `sandbox.conf` ya corregido (es lo único que cambió).
- [ ] Copien a la USB el registro de la carpeta `logs/` de una sesión que funcionó y de una que falló (si hubo), para revisarlos después.
- [ ] Llenen esta tabla:

| Parte | ¿Funcionó? | Notas |
|---|---|---|
| SARndbox arranca con calibración | | |
| En el proyector, en pantalla completa | | |
| Agua encendida | | |
| Tecla `g` guarda el .dem en la ruta fija | | Método que funcionó: |
| Panel se actualiza solo | | |
| Celulares se conectan | | |
| Ventanita de dirección en pantalla principal | | |
| Al cerrar, no quedan procesos | | |
| Doble clic sin preguntas | | |
