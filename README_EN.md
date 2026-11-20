# AR Sandbox + Terrain Analysis Panel

*Versión en español: [LEEME.md](LEEME.md)*

With a **double click** on the "AR Sandbox" icon:

1. Everything needed is checked.
2. The **web panel** starts. It analyzes the terrain: slopes, landslides, rivers and flooding.
3. A small window on the main screen shows the **panel address** for phones.
4. **SARndbox** starts with the calibration, the **water simulation on**, and **full screen on the projector**.
5. Each time someone presses **`g`** on the keyboard, SARndbox saves the terrain. The panel analyzes it and shows it on every connected device.
6. When **SARndbox is closed** (`Esc` key or closing its window), the panel closes too.

> **Important:** several parts could not be tested on the real computer yet.
> They are marked **VERIFICAR EN LA COMPUTADORA DEL SANDBOX** ("verify on the sandbox computer") in `sandbox.conf`
> and in [ON_SITE_TESTING.md](ON_SITE_TESTING.md). Follow that list on test day.

> Note: the scripts, their on-screen messages and the comments in `sandbox.conf` are in Spanish.
> This document explains what each one does.

---

## What is in this folder

| File / folder | Purpose |
|---|---|
| `sandbox.conf` | **The only configuration file you edit.** Paths, key, projector, port. Commented (in Spanish). |
| `instalar.sh` | Install script. Run it **once**: it installs what is missing and creates the icon. |
| `iniciar_sandbox.sh` | Start script. The icon runs it, and it starts everything in order. |
| `desinstalar.sh` | Uninstall script. Undoes what the installation did. |
| `ON_SITE_TESTING.md` | Step-by-step checklist for test day on the real computer. |
| `panel/` | The web panel (`servidor.py`, the analysis code and the web page). |
| `scripts/` | Internal pieces: shared functions and the **fake SARndbox** used for testing. |
| `lanzador/` | Icon image. |
| `SARndbox-2.6/` | Original AR Sandbox source by Oliver Kreylos (UC Davis), **unchanged**. Kept for reference. |
| `logs/` | Logs of each run (created automatically). |

---

## Install (once)

1. Copy this whole folder to the sandbox computer (for example to `~/panel-sandbox`).
2. Open a **Terminal** in that folder (right-click the folder → "Open in Terminal").
3. Run:

   ```bash
   bash instalar.sh
   ```

4. The installer **asks before** using your password (`sudo`). Answer `s` ("sí", yes) to install what is missing.
5. At the end it runs a check. If something says `[FALLA]` (failure), open `sandbox.conf` with a text editor and fix what it says. Then check again with:

   ```bash
   ./iniciar_sandbox.sh --revisar
   ```

---

## Starting

- **Normal use:** double-click the **AR Sandbox** icon on the desktop, or find it in the Mint menu.
  - The first time, Mint may ask whether you trust the launcher: choose "Trust and launch".
- **From the terminal** (to see the messages):

  ```bash
  ./iniciar_sandbox.sh
  ```

- **Test without the Kinect or projector.** A fake SARndbox saves sample terrains every 20 seconds:

  ```bash
  ./iniciar_sandbox.sh --simulacion
  ```

  It is also in the menu as **AR Sandbox (simulación)**. In the terminal, `Enter` saves a terrain right away; `q` then `Enter` closes everything.

### Connecting phones

- The small window shown at startup gives the address, something like `http://192.168.1.50:8000`.
- In the panel, the **"Conectar dispositivo"** ("Connect device") button shows a **QR code**.
- Phones must be **on the same Wi-Fi network** as the computer.

---

## The key that saves the terrain

The default is **`g`**. Change it with `TECLA_GUARDAR` in `sandbox.conf`.

- Press it while the **SARndbox window is active**. If you clicked on another window, click on SARndbox first.
- It needs the **water simulation on**. The launcher always turns it on (`-ws 1.0 30`).
- The terrain is saved to `~/SARndbox-capturas/BathymetrySaverTool.dem`. Change it with `RUTA_DEM`. The panel keeps a copy of every capture in `panel/historial/`.

### Assigning the key by hand (if the automatic setup does not work)

Use this if the launcher warns that Vrui did not recognize the configuration, or if nothing happens when you press `g`:

1. With SARndbox open, **press and hold** `g`. A tool menu appears.
2. Still holding `g`, move the mouse to **"Save Bathymetry"** and release `g`.
3. From now on, each press of `g` saves the terrain.

This manual assignment only lasts **until SARndbox is closed**. To make it permanent, follow section 4 of [ON_SITE_TESTING.md](ON_SITE_TESTING.md).

---

## If something fails

The error messages are in Spanish; the English meaning is given in quotes.

| What happens | What to do |
|---|---|
| An error window appears when opening the icon | Read the message: it says which line of `sandbox.conf` to fix. |
| "El AR Sandbox ya está abierto" ("already open") | A copy is already running. Close it. If you can't see it, restart the computer. |
| "El puerto 8000 ya está ocupado" ("port already in use") | Another panel was left open, or something else uses that port. Set `PUERTO="8080"` in `sandbox.conf`. |
| "No encontré el programa SARndbox" ("SARndbox not found") | Put its path in `SARNDBOX_EJECUTABLE`. To find it, in a terminal: `find ~ /usr/local /opt -name SARndbox -type f 2>/dev/null` |
| "No encuentro BoxLayout.txt / ProjectorMatrix.dat" (calibration file not found) | Write the calibration paths in `ARCHIVO_BOXLAYOUT` / `ARCHIVO_PROYECTOR`. |
| SARndbox does not end up on the projector | Click its window, drag it to the projector and press `F11`. Then check `MONITOR_PROYECTOR` in `sandbox.conf`. |
| I press `g` and the panel does not change | See "Assigning the key by hand". Check that a `.dem` file appears in `~/SARndbox-capturas/`. |
| Phones cannot open the panel | Use the same Wi-Fi. Some school networks block this: use your own router or a phone hotspot. If the firewall is active: `sudo ufw allow 8000/tcp`. |
| I want to see what happened | Open the latest log in the `logs/` folder. |

---

## Undoing the installation

```bash
./desinstalar.sh
```

- Removes the icons.
- If `METODO_CONFIG_VRUI="usuario"` was used, it puts back the original Vrui configuration from the backup in `respaldos/`.
- Offers to close the firewall port.
- **Does not delete** SARndbox, the calibration, or the captures.

Nothing in this project modifies the calibration files (`BoxLayout.txt`, `ProjectorMatrix.dat`); they are only read.

---

## Technical notes

- **Water:** in SARndbox 2.6 the simulation exists while `waterSpeed > 0` (see `Sandbox.cpp`). The `BathymetrySaverTool` is only registered when the water simulation exists.
- **.dem path:** the tool reads `saveFileName` from its class section in the Vrui configuration (`.../Tools/BathymetrySaverTool`). The default is `BathymetrySaverTool.dem`, relative to the current directory. That is why the launcher starts SARndbox **from the `RUTA_DEM` folder**.
- **Permanent key:** the launcher writes `.estado/vrui_sandbox.cfg` with a `DefaultTools` section (`toolClass BathymetrySaverTool`, `bindings ((Mouse, g))`). It passes it to Vrui with `-mergeConfig`. This is what must be **verified** on site.
- **Full screen:** `xdotool` moves the window to the projector position given by `xrandr`, then sends `F11`, as the original README says.
- **Clean shutdown:** the launcher stores the process IDs in `.estado/ejecutando/`. When SARndbox exits, or on Ctrl+C, it closes the panel: it sends TERM, then KILL if the panel does not stop within 5 s. If a previous session ended badly, the next one closes anything left running.
- The panel also works on its own: `python3 panel/servidor.py --demo` (see `panel/LEEME_panel.txt`).
