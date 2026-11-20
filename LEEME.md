# AR Sandbox + Panel de análisis del relieve

*English version: [README_EN.md](README_EN.md)*

Con un **doble clic** en el ícono "AR Sandbox":

1. Se revisa que esté todo lo necesario.
2. Arranca el **panel web**, que analiza el relieve (pendientes, deslaves, ríos, inundación).
3. Aparece en la pantalla principal una ventanita con la **dirección del panel** para los celulares.
4. Arranca el **SARndbox** con la calibración, la **simulación de agua encendida** y en **pantalla completa en el proyector**.
5. Cada vez que alguien presiona la tecla **`g`** en el teclado, el SARndbox guarda el relieve y el panel lo analiza y lo muestra en todos los dispositivos conectados.
6. Al **cerrar el SARndbox** (tecla `Esc` o cerrando su ventana), el panel también se cierra solo.

> **Importante:** varias partes no se pudieron probar todavía en la computadora real.
> Están marcadas como **VERIFICAR EN LA COMPUTADORA DEL SANDBOX** en `sandbox.conf`
> y en [PRUEBAS_EN_SITIO.md](PRUEBAS_EN_SITIO.md). Sigan esa lista el día de las pruebas.

---

## Qué hay en esta carpeta

| Archivo / carpeta | Para qué sirve |
|---|---|
| `sandbox.conf` | **La única configuración que se edita.** Rutas, tecla, proyector, puerto. Tiene comentarios. |
| `instalar.sh` | Se ejecuta **una sola vez**: instala lo que falta y crea el ícono. |
| `iniciar_sandbox.sh` | Lo que ejecuta el ícono. Arranca todo en orden. |
| `desinstalar.sh` | Deshace lo que hizo la instalación. |
| `PRUEBAS_EN_SITIO.md` | Lista paso a paso para el día de las pruebas en la computadora real. |
| `panel/` | El panel web (`servidor.py`, el análisis y la página). |
| `scripts/` | Piezas internas: funciones compartidas y el **SARndbox falso** para pruebas. |
| `lanzador/` | Imagen del ícono. |
| `SARndbox-2.6/` | Código original del AR Sandbox de Oliver Kreylos (UC Davis), **sin cambios**. Sirve de referencia. |
| `logs/` | Registros de cada vez que se abre (se crea solo). |

---

## Instalar (una sola vez)

1. Copien esta carpeta completa a la computadora del sandbox (por ejemplo a `~/panel-sandbox`).
2. Abran una **Terminal** dentro de la carpeta (clic derecho en la carpeta → "Abrir en una terminal").
3. Escriban:

   ```bash
   bash instalar.sh
   ```

4. El instalador **pregunta antes** de usar la contraseña (`sudo`). Contesten `s` para instalar lo que falte.
5. Al final hace una revisión. Si dice `[FALLA]` en algo, abran `sandbox.conf` con el editor de textos, corrijan lo que indica y prueben otra vez con:

   ```bash
   ./iniciar_sandbox.sh --revisar
   ```

---

## Iniciar

- **Uso normal:** doble clic en el ícono **AR Sandbox** del escritorio, o búsquenlo en el menú de Mint.
  - La primera vez, Mint puede preguntar si confían en el lanzador: elijan "Confiar y ejecutar".
- **Desde la terminal** (para ver los mensajes):

  ```bash
  ./iniciar_sandbox.sh
  ```

- **Probar sin Kinect ni proyector** (SARndbox falso que guarda relieves de ejemplo cada 20 segundos):

  ```bash
  ./iniciar_sandbox.sh --simulacion
  ```

  También está en el menú como **AR Sandbox (simulación)**. En la terminal: `Enter` guarda un relieve al momento; `q` y luego `Enter` lo cierra.

### Conectar celulares

- La ventanita que aparece al iniciar dice la dirección, algo como `http://192.168.1.50:8000`.
- En el panel, el botón **"Conectar dispositivo"** muestra un **código QR**.
- Los celulares tienen que estar **en la misma red wifi** que la computadora.

---

## La tecla que guarda el relieve

Por defecto es **`g`** (se cambia en `sandbox.conf`, `TECLA_GUARDAR`).

- Hay que presionarla con la **ventana del SARndbox activa** (si hicieron clic en otra ventana, hagan clic sobre el SARndbox primero).
- Necesita la **simulación de agua encendida**. El lanzador siempre la enciende (`-ws 1.0 30`).
- El relieve se guarda en `~/SARndbox-capturas/BathymetrySaverTool.dem` (se cambia en `RUTA_DEM`). El panel guarda una copia de cada captura en `panel/historial/`.

### Asignar la tecla a mano (si la automática no funciona)

Esto aplica si el lanzador avisa que Vrui no reconoció la configuración, o si al presionar `g` no pasa nada:

1. Con el SARndbox abierto, **mantengan presionada** la tecla `g`. Aparece un menú de herramientas.
2. Sin soltar `g`, muevan el mouse hasta **"Save Bathymetry"** y suelten `g`.
3. Ahora, cada vez que presionen `g`, se guarda el relieve.

Esta asignación a mano dura **solo hasta cerrar el SARndbox**. Para dejarla permanente, sigan la sección 3 de [PRUEBAS_EN_SITIO.md](PRUEBAS_EN_SITIO.md).

---

## Qué hacer si algo falla

| Lo que pasa | Qué hacer |
|---|---|
| Sale una ventana de error al abrir el ícono | Lean el mensaje: dice qué línea de `sandbox.conf` corregir. |
| "El AR Sandbox ya está abierto" | Ya hay una copia abierta. Ciérrenla. Si no la ven, reinicien la computadora. |
| "El puerto 8000 ya está ocupado" | Quedó otro panel abierto, o algo más usa ese puerto. Cambien `PUERTO="8080"` en `sandbox.conf`. |
| "No encontré el programa SARndbox" | Escriban la ruta en `SARNDBOX_EJECUTABLE`. Para encontrarla, en una terminal: `find ~ /usr/local /opt -name SARndbox -type f 2>/dev/null` |
| "No encuentro BoxLayout.txt / ProjectorMatrix.dat" | Escriban la ruta de la calibración en `ARCHIVO_BOXLAYOUT` / `ARCHIVO_PROYECTOR`. |
| El SARndbox no queda en el proyector | Hagan clic en su ventana, arrástrenla al proyector y presionen `F11`. Luego revisen `MONITOR_PROYECTOR` en `sandbox.conf`. |
| Presiono `g` y el panel no cambia | Vean "Asignar la tecla a mano". Revisen que aparezca el archivo `.dem` en `~/SARndbox-capturas/`. |
| Los celulares no abren el panel | Misma red wifi. Algunas redes escolares bloquean esto: usen un router propio o compartan internet desde un celular. Si el firewall está activo: `sudo ufw allow 8000/tcp`. |
| Quiero ver qué pasó | Abran el registro más reciente en la carpeta `logs/`. |

---

## Deshacer la instalación

```bash
./desinstalar.sh
```

- Quita los íconos.
- Si se usó el modo `METODO_CONFIG_VRUI="usuario"`, devuelve la configuración de Vrui como estaba, desde el respaldo en `respaldos/`.
- Ofrece cerrar el puerto del firewall.
- **No borra** el SARndbox, la calibración ni las capturas.

Nada de este proyecto modifica los archivos de calibración (`BoxLayout.txt`, `ProjectorMatrix.dat`): solo se leen.

---

## Para quien quiera saber más (técnico)

- **Agua:** en SARndbox 2.6 la simulación existe mientras `waterSpeed > 0` (ver `Sandbox.cpp`). La herramienta `BathymetrySaverTool` solo se registra si hay simulación de agua.
- **Ruta del .dem:** la herramienta lee `saveFileName` de la sección de su clase en la configuración de Vrui (`.../Tools/BathymetrySaverTool`). El valor por defecto es `BathymetrySaverTool.dem`, relativo a la carpeta actual. Por eso el lanzador arranca el SARndbox **desde la carpeta de `RUTA_DEM`**.
- **Tecla permanente:** el lanzador genera `.estado/vrui_sandbox.cfg` con una sección `DefaultTools` (`toolClass BathymetrySaverTool`, `bindings ((Mouse, g))`) y se la pasa a Vrui con `-mergeConfig`. Es lo que hay que **verificar** en sitio.
- **Pantalla completa:** con `xdotool` se mueve la ventana a la posición del proyector, según `xrandr`, y se envía `F11`, como indica el README original.
- **Cierre limpio:** el lanzador guarda los números de proceso en `.estado/ejecutando/`. Al cerrarse el SARndbox, o con Ctrl+C, cierra el panel (señal TERM, y si no responde en 5 s, KILL). Si una sesión anterior terminó mal, la siguiente cierra lo que haya quedado colgado.
- El panel también funciona solo: `python3 panel/servidor.py --demo` (ver `panel/LEEME_panel.txt`).
