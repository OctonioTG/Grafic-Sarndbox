# Testing on the sandbox computer

*Versión en español: [PRUEBAS_EN_SITIO.md](PRUEBAS_EN_SITIO.md)*

Step-by-step list for test day. Tick each box (`[ ]` → `[x]`) and write down what you find in the notes column or at the end.

**Estimated time:** 1 to 2 hours.
**Bring:** this folder on a USB drive, a phone with Wi-Fi, and a router or a phone hotspot in case the school network causes trouble.

> Golden rule: **never edit or delete** `BoxLayout.txt` or `ProjectorMatrix.dat`. Step 1.6 makes a backup copy anyway, just in case.

The configuration variables keep their Spanish names (they are what you edit in `sandbox.conf`).

---

## What was marked "VERIFICAR EN LA COMPUTADORA DEL SANDBOX" (verify on the sandbox computer)

| # | What to confirm | Setting | Step |
|---|---|---|---|
| V1 | Where SARndbox is installed and its version (must be 2.2 or newer) | `SARNDBOX_EJECUTABLE` | 1.1 |
| V2 | Where the calibration is (`BoxLayout.txt`, `ProjectorMatrix.dat`) | `ARCHIVO_BOXLAYOUT`, `ARCHIVO_PROYECTOR` | 1.2 |
| V3 | Which options it was started with before | `OPCIONES_SARNDBOX` | 1.3 |
| V4 | Vrui version, and whether a section named after the computer exists | `VRUI_VERSION`, `SECCION_RAIZ_VRUI` | 1.4 |
| V5 | Name of the projector's video output | `MONITOR_PROYECTOR` | 1.5 |
| V6 | That Vrui accepts `-mergeConfig` (automatic key and .dem path) | `METODO_CONFIG_VRUI` | 4 |
| V7 | That the `g` key is free and the `DefaultTools` section works | `TECLA_GUARDAR` | 4 |
| V8 | That the .dem lands in `RUTA_DEM` (through `saveFileName` or through the start folder) | `RUTA_DEM` | 4 |
| V9 | The SARndbox window title, and that xdotool moves it to the projector and triggers F11 | `TITULO_VENTANA`, `METODO_PANTALLA_COMPLETA` | 3 |
| V10 | That the address window and the browser open on the main screen, not the projector | `MOSTRAR_DIRECCION`, `ABRIR_NAVEGADOR` | 5 |
| V11 | That the icon is marked as trusted (double click with no questions) | — | 2 |
| V12 | Whether the computer can handle the water (speed, smoothness) | `CALIDAD_AGUA` (alta / media / ligera) | 3 |

---

## 1. Check how things are installed (before changing anything)

Open a Terminal. Copy each command, paste it with `Ctrl+Shift+V`, and write down the result.

- [ ] **1.1 SARndbox program**

  ```bash
  which SARndbox; ls -d ~/src/SARndbox-* /opt/SARndbox-* /usr/local/bin/SARndbox 2>/dev/null
  ```

  ```bash
  find ~ /usr/local /opt -name SARndbox -type f 2>/dev/null
  ```

  Write down the path (for example `/home/sandbox/src/SARndbox-2.8/bin/SARndbox`) and the version (the number in the folder name).

- [ ] **1.2 Calibration**

  ```bash
  find ~ /usr/local -name BoxLayout.txt -o -name ProjectorMatrix.dat 2>/dev/null
  ```

  They are usually together in `.../SARndbox-2.8/etc/SARndbox-2.8/`. If there are several copies, ask which one is right. The most recent date is usually the correct one (`ls -l PATH`).

- [ ] **1.3 How it was started before.** Ask whoever uses it, or search:

  ```bash
  grep -h SARndbox ~/.bash_history 2>/dev/null | sort | uniq -c | sort -rn | head
  ```

  ```bash
  grep -rl SARndbox ~/Desktop ~/Escritorio ~/.local/share/applications ~/bin 2>/dev/null
  ```

  Copy the options they used (for example `-uhm -fpv -ucl 1.0`) into `OPCIONES_SARNDBOX`. Do **not** copy `-fpv`, `-slf` or `-ws`: the launcher adds those itself. If they used `-ws 0 0` (water off), write that down: it means the computer was slow with water (see V12).

- [ ] **1.4 Vrui**

  ```bash
  ls -d /usr/local/etc/Vrui-* ~/Vrui-* /usr/local/share/Vrui-* 2>/dev/null; hostname
  ```

  ```bash
  grep -n "^section" /usr/local/etc/Vrui-*/Vrui.cfg | head -30
  ```

  If the list shows a section with the **same name** that `hostname` printed, put that name in `SECCION_RAIZ_VRUI`.

- [ ] **1.5 Screens.** With the projector on and connected:

  ```bash
  xrandr --query | grep " connected"
  ```

  The line with `primary` is the main screen; the other one is the projector. Write down its name (for example `HDMI-1`) and its geometry (for example `1024x768+1920+0`).

- [ ] **1.6 Back up the calibration** (only copies, changes nothing). Replace the path with the one from step 1.2:

  ```bash
  cp -a ~/src/SARndbox-2.8/etc/SARndbox-2.8 ~/respaldo-calibracion-$(date +%Y%m%d)
  ```

- [ ] **1.7 Program help** (to confirm the options; if a window opens, close it with `Esc`):

  ```bash
  SARndbox -h 2>&1 | head -80
  ```

  Confirm that `-ws`, `-fpv`, `-slf` and `-uhm` exist.

---

## 2. Install and configure

- [ ] Copy the project folder to the computer (for example `~/panel-sandbox`).
- [ ] In a terminal inside that folder:

  ```bash
  bash instalar.sh
  ```

  Answer `s` (yes) to install what is missing.
- [ ] Open `sandbox.conf` with the text editor and fill in what you wrote down in step 1 (V1–V5). Save.
- [ ] Check:

  ```bash
  ./iniciar_sandbox.sh --revisar
  ```

  Everything should say `[ok]`. If something says `[FALLA]` (failure), the message says what to fix.
- [ ] **Run the simulation first** on this computer (it does not touch the real SARndbox):

  ```bash
  ./iniciar_sandbox.sh --simulacion
  ```

  The browser should open with the panel. Press `Enter` in the terminal: a few seconds later a new capture appears in the panel. Type `q` and `Enter`: everything closes.
- [ ] **V11:** the "AR Sandbox" icon should be on the desktop. If Mint asks on double click, choose "Trust and launch" or "Mark as trusted". Note whether it asked.

---

## 3. SARndbox with water, on the projector

- [ ] Open the **AR Sandbox** icon (or run `./iniciar_sandbox.sh` in the terminal to see the messages).
- [ ] **V9:** SARndbox should appear **on the projector, in full screen**, within a few seconds.
  - If it opens on the main screen, get the window title with:

    ```bash
    xdotool search --name . getwindowname %@ 2>/dev/null | grep -i -e sandbox -e vrui
    ```

    Put it in `TITULO_VENTANA`.
  - If the window moves but does not go full screen: click the window and press `F11`. Also try `METODO_PANTALLA_COMPLETA="vrui"`.
- [ ] **Correct calibration:** the colors and contour lines must match the real sand, as before. If they are shifted, the window did not end up exactly full screen on the projector. **Do not recalibrate**: check V5 and V9 first.
- [ ] **Water:** hold an open hand over the sand for a few seconds. Blue water should "rain" and flow downhill. (In SARndbox 2.6 water is on while the speed is above 0; the launcher uses `-ws 1.0 30`.)
- [ ] **V12:** start with `CALIDAD_AGUA="media"`. If the water looks smooth, try `"alta"`; if it stutters, `"ligera"`. Also check the log in `logs/`: if it says the water simulation cannot keep up in real time, go one level down. Confirm the save key still works at each level (the saved terrain has the size of the water grid). Never set `AGUA_VELOCIDAD="0"`: without water the terrain cannot be saved.

---

## 4. The save-terrain key (the most uncertain part)

- [ ] Check the latest log (`logs/sandbox_..._real.log`). If it contains

  `Ignoring unrecognized command line switch -mergeConfig`

  then Vrui **does not accept** `-mergeConfig` (V6). The launcher also shows a warning window. In that case, go to "Plan B" below.
- [ ] Click on the SARndbox window and press **`g`** once.
- [ ] **V8:** confirm the file was created or updated:

  ```bash
  ls -l --time-style=+%H:%M:%S ~/SARndbox-capturas/
  ```

  The time of `BathymetrySaverTool.dem` should be a few seconds ago. The log also gets a line with two numbers (minimum and maximum height), for example `-4.2, 13.7`. SARndbox prints it every time it saves.
- [ ] If pressing `g` opens a **tool menu** instead of saving, the key was not assigned automatically (V7). Follow Plan B.
- [ ] If `g` already does something else in SARndbox, change `TECLA_GUARDAR` (for example to `9`) and try again.

### Plan B (in this order; try one, close, and open again)

1. **Root section:** if step 1.4 showed a section named after the computer, put that name in `SECCION_RAIZ_VRUI`.
2. **User folder:** set `METODO_CONFIG_VRUI="usuario"` and `VRUI_VERSION="4.6"` (or the version from step 1.4). The launcher writes `~/.config/Vrui-4.6/Applications/SARndbox.cfg`. If that file already existed, it first saves a backup in `respaldos/`. To undo: `./desinstalar.sh`.
3. **Assign by hand and save Vrui's key bindings:** set `METODO_CONFIG_VRUI="manual"`. Open the sandbox, hold `g`, choose **"Save Bathymetry"** and release. In the Vrui menu (right mouse button or the main menu), look for an option like **"Save Input Graph"**. If it exists, save the file as `~/SARndbox-capturas/teclas.inputgraph` and try `VRUI_OPCIONES_EXTRA="-loadInputGraph $HOME/SARndbox-capturas/teclas.inputgraph"`. (Neither the menu item nor the option is confirmed for Vrui 4.6.)
4. **By hand only:** set `METODO_CONFIG_VRUI="manual"` and assign the key each time you open it (explained in README_EN.md). Because SARndbox starts from the `RUTA_DEM` folder, the file should still end up in the right place. Confirm with the V8 command.

Write down which one worked: ______________________

---

## 5. Panel and phones

- [ ] **V10:** when the sandbox opened, these appeared **on the main screen** (not on the projector):
  - a small window with the panel address, and
  - the browser showing the panel.

  If they appear on the projector, write that down. Meanwhile, drag them to the main screen, or set `ABRIR_NAVEGADOR="no"` and open the browser yourself.
- [ ] **Panel updating:** press `g` in SARndbox. Within a few seconds the panel shows "analizando" (analyzing), then the new capture in the history. A new file should also appear in `panel/historial/`.
- [ ] Move the sand (make a hill and a valley), press `g` again, and check that the panel changes and compares with the previous capture.
- [ ] **Phones:** connect a phone to the **same Wi-Fi**, then scan the QR code from the "Conectar dispositivo" button (or type the address). The panel should open. Press `g` and check that the phone updates by itself.
  - If it does not connect, run `sudo ufw status`. If it says "active", run `sudo ufw allow 8000/tcp`. If it still does not connect, the network blocks connections between devices: try your own router or a phone hotspot.

---

## 6. Clean shutdown

- [ ] Close SARndbox with `Esc` (or by closing its window).
- [ ] Within a few seconds the panel and the address window should close too.
- [ ] Confirm nothing is left running:

  ```bash
  ps aux | grep -e servidor.py -e SARndbox -e sarndbox_falso | grep -v grep
  ```

  This should print nothing.

  ```bash
  ss -ltn | grep ':8000'
  ```

  This should print nothing either.
- [ ] If the computer didn't have the AR Sandbox: write down the Linux Mint version and whether `bash instalar.sh` managed to install Vrui, Kinect and SARndbox 2.8. If it failed, copy the `logs/instalar_sarndbox_*.log` file to the USB drive. After calibrating, check that `./iniciar_sandbox.sh --revisar` finds `~/src/SARndbox-2.8`, that the `g` key saves, and that water works with `CALIDAD_AGUA`.
- [ ] In the panel, open Settings (gear button): switch to Español, change the soil type to "Loose sand" and save. The numbers should change on every connected device. On a phone, scale and soil should appear locked. At the end, press "Restore defaults" and save.
- [ ] Open the icon again. It should start normally, with no "ya está abierto" (already open) or "puerto ocupado" (port in use) message.
- [ ] With the sandbox open, double-click the icon again. It should say it is **already open** and not start a second copy.

---

## 7. When you are done

- [ ] Keep a copy of the corrected `sandbox.conf` (it is the only thing that changed).
- [ ] Copy to the USB drive the log from the `logs/` folder of a session that worked and of one that failed (if any), to review later.
- [ ] Fill in this table:

| Part | Worked? | Notes |
|---|---|---|
| SARndbox starts with calibration | | |
| On the projector, full screen | | |
| Water on | | |
| `g` key saves the .dem to the fixed path | | Method that worked: |
| Panel updates by itself | | |
| Phones connect | | |
| Address window on the main screen | | |
| No processes left after closing | | |
| Double click with no questions | | |
