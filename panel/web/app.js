"use strict";
/* Panel del AR Sandbox — interfaz web (sin librerías externas: funciona sin internet). */

const $ = (s, el = document) => el.querySelector(s);
const svgNS = "http://www.w3.org/2000/svg";

// ============================== IDIOMA ======================================
// Inglés por defecto. Se cambia en Configuración y se guarda solo en este dispositivo.
const IDIOMA = (() => { try { return localStorage.getItem("idioma") === "es" ? "es" : "en"; } catch { return "en"; } })();
const EN = IDIOMA === "en", LOC = EN ? "en-US" : "es-MX";
const t = (es, en) => EN ? en : es;   // t("texto en español", "text in English")
const pl = (n, uno, varios) => n === 1 ? uno : varios;
function traducirPagina() {
  document.documentElement.lang = IDIOMA;
  if (!EN) { document.title = "Sandbox · Análisis de terreno"; return; }
  document.querySelectorAll("[data-en]").forEach(e => { e.innerHTML = e.dataset.en; });
  document.querySelectorAll("[data-en-title]").forEach(e => { e.title = e.dataset.enTitle; });
  document.querySelectorAll("[data-en-alt]").forEach(e => { e.alt = e.dataset.enAlt; });
  document.querySelectorAll("[data-en-aria]").forEach(e => e.setAttribute("aria-label", e.dataset.enAria));
}
traducirPagina();
const fuenteTxt = f => f === "Demostración" ? t("Demostración", "Demo") : f;
// ============================== ESTADO ======================================
const S = {
  capturas: [], urls: [], local: "", fuente: "",
  actual: null, compararCon: null,
  meta: new Map(), capas: new Map(), comp: new Map(), compCapa: new Map(), imagenes: new Map(),
  capa: "relieve", curvas: true, seguir: true,
  nivel: null,      // nivel del agua elegido por el usuario (null = el del análisis)
  lluvia: null,     // qué tan mojado está el suelo, 0 a 1 (null = el del análisis)
  linea: null,      // puntos A y B del perfil, en celdas
  perfilFijo: null, // punto marcado en el perfil (0 = A, 1 = B)
  vista: { escala: 1, ox: 0, oy: 0, ajustada: false },
  hover: null, perfilHover: null, token: 0, conectado: false,
};

// ============================== FORMATO =====================================
const nf = (v, d = 0) => (v == null || !isFinite(v)) ? "—" :
  Number(v).toLocaleString(LOC, { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtArea = m2 => m2 < 1e4 ? `${nf(m2)} m²` : m2 < 1e6 ? `${nf(m2 / 1e4, 1)} ha` : `${nf(m2 / 1e6, 2)} km²`;
const fmtVol = m3 => m3 >= 1e6 ? `${nf(m3 / 1e6, 2)} ${t("millones de m³", "million m³")}` : `${nf(m3)} m³`;
const fmtLen = m => m < 1000 ? `${nf(m)} m` : `${nf(m / 1000, m < 1e4 ? 2 : 1)} km`;
const horaDe = iso => new Date(iso).toLocaleTimeString(LOC, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
function relativo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 45) return t("hace un momento", "just now");
  if (s < 3600) return t(`hace ${Math.round(s / 60)} min`, `${Math.round(s / 60)} min ago`);
  if (s < 86400) return t(`hace ${Math.round(s / 3600)} h`, `${Math.round(s / 3600)} h ago`);
  return new Date(iso).toLocaleDateString(LOC, { day: "numeric", month: "short" });
}
function fechaLarga(iso) {
  const d = new Date(iso), hoy = new Date();
  const dia = d.toDateString() === hoy.toDateString() ? t("Hoy", "Today") :
    d.toLocaleDateString(LOC, { weekday: "long", day: "numeric", month: "long" });
  return `${dia[0].toUpperCase() + dia.slice(1)}, ${horaDe(iso)}`;
}
const cardinal = o => (o == null || isNaN(o)) ? null : (EN ? ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] : ["N", "NE", "E", "SE", "S", "SO", "O", "NO"])[Math.round(o / 45) % 8];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ============================== COLORES =====================================
function rampa(paradas) {
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < paradas.length - 2 && t > paradas[k + 1][0]) k++;
    const [t0, c0] = paradas[k], [t1, c1] = paradas[k + 1];
    const f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    for (let j = 0; j < 3; j++) lut[i * 3 + j] = c0[j] + (c1[j] - c0[j]) * f;
  }
  return lut;
}
const RAMPA = {
  relieve: rampa([[0, [42, 96, 135]], [.1, [74, 148, 140]], [.26, [126, 178, 108]], [.44, [206, 204, 138]],
    [.62, [198, 158, 100]], [.8, [148, 108, 78]], [.93, [192, 178, 168]], [1, [250, 250, 247]]]),
  pendiente: rampa([[0, [255, 250, 205]], [.3, [254, 204, 92]], [.55, [247, 129, 50]], [.8, [214, 46, 38]], [1, [120, 10, 40]]]),
  agua: rampa([[0, [190, 224, 248]], [.35, [107, 174, 222]], [.7, [33, 113, 181]], [1, [8, 48, 107]]]),
  cambios: rampa([[0, [178, 24, 43]], [.25, [233, 128, 98]], [.5, [245, 245, 245]], [.75, [103, 169, 207]], [1, [33, 102, 172]]]),
};
const lutCss = (lut, n = 7) => `linear-gradient(90deg, ${Array.from({ length: n }, (_, i) => {
  const k = Math.round(i / (n - 1) * 255) * 3; return `rgb(${lut[k]},${lut[k + 1]},${lut[k + 2]})`;
}).join(",")})`;

const FS = [
  { max: 1, color: [192, 57, 43], nombre: t("Inestable", "Unstable"), rango: t("FS menor a 1", "FS below 1"), a: .88 },
  { max: 1.3, color: [232, 131, 58], nombre: t("Crítico", "Critical"), rango: t("FS 1 a 1.3", "FS 1 to 1.3"), a: .8 },
  { max: 1.5, color: [242, 201, 76], nombre: t("Moderado", "Moderate"), rango: t("FS 1.3 a 1.5", "FS 1.3 to 1.5"), a: .65 },
  { max: Infinity, color: [143, 196, 160], nombre: t("Estable", "Stable"), rango: t("FS mayor a 1.5", "FS above 1.5"), a: .18 },
];
const claseFS = v => FS.find(c => v < c.max) || FS[3];
const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;
const CUENCAS = ["#4e79a7", "#f28e2b", "#59a14f", "#e15759", "#b07aa1", "#edc948", "#76b7b2", "#ff9da7"];
const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

const CAPAS = [
  { id: "relieve", nombre: t("Relieve", "Relief"), icono: "#8fb573", datos: ["elevacion"] },
  { id: "pendiente", nombre: t("Pendiente", "Slope"), icono: "#f08c3c", datos: ["pendiente"] },
  { id: "riesgo_seco", nombre: t("Deslave · seco", "Landslide · dry"), icono: "#e8833a", datos: ["fs_seco"] },
  { id: "riesgo_lluvia", nombre: t("Deslave · lluvia", "Landslide · rain"), icono: "#c0392b", datos: ["fs_lluvia", "pendiente"] },
  { id: "drenaje", nombre: t("Drenaje", "Drainage"), icono: "#4e79a7", datos: ["cuencas", "rios"] },
  { id: "inundacion", nombre: t("Inundación", "Flooding"), icono: "#2f7fd1", datos: ["hand", "encharcamiento"] },
  { id: "cambios", nombre: t("Cambios", "Changes"), icono: "#8e5ab5", datos: [], comp: true },
];
const TODAS_LAS_CAPAS = ["elevacion", "sombreado", "pendiente", "orientacion", "fs_seco", "fs_lluvia", "hand", "encharcamiento", "cuencas", "rios"];

// ============================== RED =========================================
async function getJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status} en ${url}`);
  return r.json();
}
async function capaDatos(id, nombre) {
  const k = `${id}:${nombre}`;
  if (S.capas.has(k)) return S.capas.get(k);
  const p = fetch(`/api/captura/${id}/capa/${nombre}`).then(r => {
    if (!r.ok) throw new Error("capa");
    return r.arrayBuffer();
  }).then(b => new Float32Array(b));
  S.capas.set(k, p);
  try { const v = await p; S.capas.set(k, v); return v; } catch (e) { S.capas.delete(k); throw e; }
}
const capaLista = (id, nombre) => { const v = S.capas.get(`${id}:${nombre}`); return v instanceof Float32Array ? v : null; };

// ---- Inundación con cualquier nivel de agua (mismo método HAND que el analizador) ----
// HAND = altura de cada punto sobre el río más cercano. Si el agua sube "nivel" metros,
// se moja todo lo que está a menos de esa altura; además se suma el agua de los hundimientos.
const nivelActual = m => S.nivel != null ? S.nivel : m.kpis.nivel;
function profundidad(id, i, nivel) {
  const h = capaLista(id, "hand"), e = capaLista(id, "encharcamiento");
  if (!h || !e) return undefined;
  return Math.max(h[i] < nivel ? nivel - h[i] : 0, e[i] > 0 ? e[i] : 0);
}
function interpCurva(m, nivel) {
  const h = m.curva.nivel, a = m.curva.area;
  let i = 1; while (i < h.length - 1 && h[i] < nivel) i++;
  const t = Math.max(0, Math.min(1, (nivel - h[i - 1]) / ((h[i] - h[i - 1]) || 1)));
  return a[i - 1] + (a[i] - a[i - 1]) * t;
}
// ---- Riesgo de deslave con cualquier cantidad de lluvia (mismo talud infinito que el analizador) ----
// FS = c / (γ z senβ cosβ) + (1 − m γw/γ) tanφ / tanβ ;  m = qué tan mojado está el suelo (0 a 1)
const lluviaActual = m => S.lluvia != null ? S.lluvia : m.parametros.saturacion;
let cacheFS = { clave: "", arr: null };
function fsLluvia(m) {
  const sat = lluviaActual(m), base = capaLista(m.id, "fs_lluvia");
  if (Math.abs(sat - m.parametros.saturacion) < 1e-6) return base;
  const pend = capaLista(m.id, "pendiente"); if (!pend) return base;
  const clave = `${m.id}:${sat.toFixed(3)}`;
  if (cacheFS.clave === clave) return cacheFS.arr;
  const P = m.parametros, g = P.peso_suelo_kn_m3, zs = P.espesor_suelo_m, tphi = Math.tan(P.friccion_grados * Math.PI / 180);
  const fr = (1 - sat * 9.81 / g) * tphi, arr = new Float32Array(pend.length);
  for (let i = 0; i < pend.length; i++) {
    const d = pend[i];
    if (isNaN(d)) { arr[i] = NaN; continue; }
    const b = Math.min(89, Math.max(.5, d)) * Math.PI / 180;
    arr[i] = Math.min(5, Math.max(0, P.cohesion_kpa / (g * zs * Math.sin(b) * Math.cos(b)) + fr / Math.tan(b)));
  }
  cacheFS = { clave, arr };
  return arr;
}
// Porcentaje del terreno en cada clase (inestable, crítico, moderado, estable) con la lluvia elegida
function cuadroLluvia(m) {
  const arr = fsLluvia(m);
  if (!arr || arr === capaLista(m.id, "fs_lluvia") && S.lluvia == null) return m.cuadro.map(c => c.lluvia);
  const n = [0, 0, 0, 0];
  for (let i = 0; i < arr.length; i++) { const f = arr[i]; if (isNaN(f)) continue; n[f < 1 ? 0 : f < 1.3 ? 1 : f < 1.5 ? 2 : 3]++; }
  return n.map(v => 100 * v / arr.length);
}
// El escenario que se ve en el mapa (lluvia y nivel del agua elegidos)
function escenario(m) {
  const nivel = nivelActual(m);
  return { lluvia: lluviaActual(m), inestable: cuadroLluvia(m)[0], nivel, inund: pctInundado(m, nivel),
           propio: S.lluvia != null || S.nivel != null };
}
// Colores de riesgo con trama, para que se distingan también sin ver bien los colores
const estiloFS = i => `background-color:${rgb(FS[i].color)};` + (i === 0
  ? "background-image:repeating-linear-gradient(45deg,rgba(0,0,0,.4) 0 2px,transparent 2px 6px);"
  : i === 1 ? "background-image:radial-gradient(rgba(0,0,0,.38) 1.2px,transparent 1.6px);background-size:5px 5px;" : "");

const cachePct = new Map();
function pctInundado(m, nivel) {
  const k = `${m.id}:${nivel.toFixed(3)}`;
  if (cachePct.has(k)) return cachePct.get(k);
  const h = capaLista(m.id, "hand"), e = capaLista(m.id, "encharcamiento");
  if (!h || !e) return interpCurva(m, nivel);
  let c = 0; for (let i = 0; i < h.length; i++) if (h[i] < nivel || e[i] > 0) c++;
  const v = 100 * c / h.length;
  if (cachePct.size > 400) cachePct.clear();
  cachePct.set(k, v); return v;
}
function limpiarCache() {
  // conserva solo las 3 capturas más recientes que se han visto
  const ids = [...new Set([...S.capas.keys()].map(k => +k.split(":")[0]))];
  const guardar = new Set([S.actual, S.compararCon, ...ids.slice(-3)]);
  for (const k of [...S.capas.keys()]) if (!guardar.has(+k.split(":")[0])) S.capas.delete(k);
  for (const k of [...S.imagenes.keys()]) if (!guardar.has(+k.split(":")[0])) S.imagenes.delete(k);
}

// ============================== ESTADO DE CONEXIÓN ==========================
function ponerEstado(tipo, texto) {
  const e = $("#estado");
  e.dataset.tipo = tipo;
  $("#estado-texto").textContent = texto;
}
function estadoNormal() {
  if (!S.conectado) return ponerEstado("caido", t("Sin conexión · reintentando", "Offline · retrying"));
  if (S.fuente === "demo") return ponerEstado("vivo", t("Demostración", "Demo"));
  if (!S.capturas.length) return ponerEstado("vivo", t("Esperando captura", "Waiting for capture"));
  ponerEstado("vivo", t("En vivo", "Live"));
}

// ============================== HISTORIAL ===================================
async function refrescarLista() {
  const d = await getJSON("/api/estado");
  S.capturas = d.capturas; S.urls = d.urls; S.local = d.local; S.fuente = d.fuente; S.version = d.version || 0;
  pintarHistorial();
  $("#vacio").hidden = S.capturas.length > 0;
  $("#panel").hidden = S.capturas.length === 0;
  $("#portada").hidden = S.capturas.length === 0;
  estadoNormal();
  return d;
}

function pintarHistorial(nuevoId) {
  const ol = $("#historial");
  ol.innerHTML = "";
  for (const c of S.capturas) {
    const li = document.createElement("li");
    li.className = "cap" + (c.id === S.actual ? " activa" : "") + (c.id === nuevoId ? " entrando" : "");
    li.tabIndex = 0;
    li.dataset.id = c.id;
    const r = c.resumen;
    const chips = [];
    if (c.id === S.capturas[0].id) chips.push(`<span class="chip nuevo">${t("Última", "Latest")}</span>`);
    if (r && r.deslaves) chips.push(`<span class="chip rojo">${r.deslaves} ${t(pl(r.deslaves, "deslave", "deslaves"), pl(r.deslaves, "landslide", "landslides"))}</span>`);
    if (r) chips.push(`<span class="chip" title="${t("Terreno inestable con lluvia", "Terrain unstable with rain")}">${t("Riesgo", "Risk")} ${nf(r.inestable_lluvia)}%</span>`);
    if (c.id === S.compararCon && c.id !== S.actual) chips.push(`<span class="chip base">${t("Base de comparación", "Comparison base")}</span>`);
    li.innerHTML = `
      <img src="/api/captura/${c.id}/miniatura.png?v=2&a=${S.version || 0}&h=${encodeURIComponent(c.hora)}" alt="" loading="lazy">
      <div>
        <div class="cap-titulo"><span>#${c.id}</span><span class="cap-hora">${horaDe(c.hora)}</span></div>
        <div class="cap-rel" data-rel="${c.hora}">${relativo(c.hora)}</div>
        <div class="cap-chips">${chips.join("")}</div>
      </div>`;
    li.onclick = () => { if (c.id !== S.capturas[0].id) ponerSeguir(false); seleccionar(c.id); };
    li.onkeydown = e => { if (e.key === "Enter") li.click(); };
    ol.appendChild(li);
  }
}
function esqueletoHistorial() {
  if ($(".cap-esqueleto")) return;
  const li = document.createElement("li");
  li.className = "cap cap-esqueleto";
  li.innerHTML = `<div class="mini-vacia"></div><div><div class="linea" style="width:70%"></div><div class="linea" style="width:45%"></div></div>`;
  $("#historial").prepend(li);
}
function ponerSeguir(v) { S.seguir = v; $("#seguir").checked = v; }

// ============================== SELECCIÓN ===================================
async function seleccionar(id) {
  const tok = ++S.token;
  const cambioDeCaptura = S.actual !== id;
  S.actual = id;
  history.replaceState(null, "", `?captura=${id}`);
  document.querySelectorAll(".cap").forEach(li => li.classList.toggle("activa", +li.dataset.id === id));
  $("#cargando-mapa").classList.remove("oculto");

  let m = S.meta.get(id);
  if (!m) {
    try { m = await getJSON(`/api/captura/${id}`); } catch { aviso(t("No se pudo cargar la captura.", "Couldn’t load the capture.")); return; }
    if (tok !== S.token) return;
    m.rutas = rutasCurvas(m.curvas);
    S.meta.set(id, m);
  }
  if (cambioDeCaptura) { S.compararCon = m.anterior; S.nivel = null; S.lluvia = null; S.perfilFijo = null; }
  if (!S.linea || S.linea.dims !== `${m.filas}x${m.cols}`) S.linea = lineaOriginal(m);

  pintarCabecera(m);
  pintarKpis(m);
  pintarTabs();
  pintarLeyenda();
  graficaPerfil(m);
  graficaInundacion(m);
  pintarEstabilidad(m);
  pintarCuencas(m);
  pintarSelectorComparar();
  pintarPie(m);
  const dl = $("#btn-descargar");
  dl.href = `/api/captura/${id}/descargar`;
  dl.setAttribute("aria-disabled", "false");

  try {
    await Promise.all(["sombreado", "elevacion", ...capaActual().datos].map(n => capaDatos(id, n)));
  } catch { aviso(t("No se pudo cargar el mapa.", "Couldn’t load the map.")); return; }
  if (tok !== S.token) return;
  const dims = `${m.filas}x${m.cols}`;
  if (!S.vista.ajustada || S.vista.dims !== dims) { ajustarVista(); S.vista.dims = dims; }
  pedirDibujo();
  $("#cargando-mapa").classList.add("oculto");

  cargarComparacion();
  Promise.all(TODAS_LAS_CAPAS.map(n => capaDatos(id, n))).then(() => { if (tok === S.token) { actualizarInspector(); graficaInundacion(m); programarGraficas(); actualizarControlNivel(m); pintarKpis(m); } }).catch(() => {});
  limpiarCache();
}

// ============================== CABECERA Y KPIs =============================
function pintarCabecera(m) {
  $("#cab-meta").textContent = `${fechaLarga(m.hora)} · ${relativo(m.hora)} · ${fuenteTxt(m.fuente)}`;
  $("#cab-titulo").textContent = `${t("Captura", "Capture")} #${m.id}`;
  pintarAlertas();
}
function pintarAlertas() {
  const m = S.meta.get(S.actual); if (!m) return;
  const c = S.compararCon ? S.comp.get(`${S.compararCon}-${S.actual}`) : null;
  const a = [];
  const ico = `<svg viewBox="0 0 24 24"><path d="M12 3l10 18H2zM12 10v5M12 18v.5"/></svg>`;
  if (c && c.eventos && c.eventos.length)
    a.push(`<div class="alerta">${ico}${c.eventos.length} ${t(pl(c.eventos.length, "deslave detectado", "deslaves detectados"), pl(c.eventos.length, "landslide detected", "landslides detected"))} <button data-ir="cambios">${t("Ver en el mapa", "Show on map")}</button></div>`);
  const esc = escenario(m);
  if (esc.inestable >= 1)
    a.push(`<div class="alerta">${ico}${nf(esc.inestable, 1)}% ${t("sería inestable con lluvia", "would be unstable with rain")} <button data-ir="riesgo_lluvia">${t("Ver en el mapa", "Show on map")}</button></div>`);
  if (!a.length) a.push(`<div class="alerta ok"><svg viewBox="0 0 24 24"><path d="M5 12l4 4 10-10"/></svg>${t("Sin alertas", "No alerts")}</div>`);
  $("#alertas").innerHTML = a.join("");
  $("#alertas").querySelectorAll("[data-ir]").forEach(b => b.onclick = () => {
    if (b.dataset.ir === "cambios") { const ev = c.eventos[0]; verEvento(ev); } else { elegirCapa(b.dataset.ir); irAlMapa(); }
  });
}
function pintarKpis(m) {
  const k = m.kpis;
  const idx = S.capturas.findIndex(c => c.id === m.id);
  const prev = S.capturas[idx + 1] && S.capturas[idx + 1].id === m.anterior ? S.capturas[idx + 1].resumen : null;
  const delta = (v, p) => {
    if (p == null) return "";
    const d = v - p; if (Math.abs(d) < .05) return "";
    return `<span class="kpi-delta ${d > 0 ? "sube" : "baja"}">${d > 0 ? "▲" : "▼"} ${nf(Math.abs(d), 1)}</span>`;
  };
  const c = S.compararCon ? S.comp.get(`${S.compararCon}-${S.actual}`) : null;
  const nDes = c && c.eventos ? c.eventos.length : null;
  const esc = escenario(m);
  const tarjetas = [
    [t("Área del terreno", "Terrain area"), fmtArea(k.area), t(`celda de ${nf(k.celda, 2)} m`, `${nf(k.celda, 2)} m cells`), null],
    [t("Elevación máxima", "Highest point"), `${nf(k.zmax)}<small>m</small>`, t(`mínima ${nf(k.zmin)} m · desnivel ${nf(k.zmax - k.zmin)} m`, `lowest ${nf(k.zmin)} m · relief ${nf(k.zmax - k.zmin)} m`), null],
    [t("Pendiente media", "Average slope"), `${nf(k.pend_media, 1)}<small>°</small>`, t(`${nf(k.pend30_pct, 1)}% arriba de 30°`, `${nf(k.pend30_pct, 1)}% steeper than 30°`), null],
    [t("Inestable con lluvia", "Unstable with rain"), `${nf(esc.inestable, 1)}<small>%</small>${S.lluvia == null ? delta(k.inestable_sat_pct, prev && prev.inestable_lluvia) : ""}`,
      S.lluvia == null ? t(`en seco: ${nf(k.inestable_seco_pct, 1)}%`, `when dry: ${nf(k.inestable_seco_pct, 1)}%`) : t(`suelo ${nf(esc.lluvia * 100)}% mojado (elegido)`, `soil ${nf(esc.lluvia * 100)}% wet (chosen)`), "var(--riesgo)"],
    [t("Área inundable", "Floodable area"), `${nf(esc.inund, 1)}<small>%</small>${S.nivel == null ? delta(k.inund_pct, prev && prev.inundable) : ""}`,
      t(`ríos crecidos +${nf(esc.nivel, 1)} m`, `rivers up +${nf(esc.nivel, 1)} m`) + (S.nivel == null ? "" : t(" (elegido)", " (chosen)")), "var(--agua)"],
    [t("Deslaves detectados", "Landslides detected"), nDes == null ? "—" : nf(nDes),
      S.compararCon ? t(`desde la captura #${S.compararCon}`, `since capture #${S.compararCon}`) : t("se necesita otra captura", "needs another capture"), nDes ? "var(--riesgo)" : null],
  ];
  pintarFrase(m, nDes);
  $("#kpis").innerHTML = tarjetas.map(([et, val, sub, col]) => `
    <div class="kpi"><div class="kpi-et">${col ? `<i style="background:${col}"></i>` : ""}${et}</div>
    <div class="kpi-val">${val}</div><div class="kpi-sub">${sub}</div></div>`).join("");
}

// Resumen en una frase sencilla, arriba de los números.
function pintarFrase(m, nDes) {
  const k = m.kpis, esc = escenario(m), p = [];
  if (EN) {
    const cuando = S.lluvia == null ? "With rain" : `With the soil ${nf(esc.lluvia * 100)}% wet`;
    if (esc.inestable >= 0.1)
      p.push(`${cuando}, <em class="r">${nf(esc.inestable, 1)}%</em> of the terrain would become unstable`
        + (k.inestable_seco_pct < esc.inestable ? `; when dry, only ${nf(k.inestable_seco_pct, 1)}%.` : "."));
    else p.push(S.lluvia == null ? "The slopes look stable, even with rain." : `${cuando}, the slopes look stable.`);
    if (nDes > 0) p.push(`<em class="r">${nDes} ${pl(nDes, "landslide was", "landslides were")}</em> detected since capture #${S.compararCon}.`);
    else if (nDes === 0) p.push(`No landslides since capture #${S.compararCon}.`);
    p.push(`If the rivers rise ${nf(esc.nivel, 1)} m, <em class="a">${nf(esc.inund, 1)}%</em> would flood.`);
    $("#frase").innerHTML = p.join(" ");
    return;
  }
  const cuando = S.lluvia == null ? "Con lluvia" : `Con el suelo ${nf(esc.lluvia * 100)}% mojado`;
  if (esc.inestable >= 0.1)
    p.push(`${cuando}, el <em class="r">${nf(esc.inestable, 1)}%</em> del terreno se volvería inestable`
      + (k.inestable_seco_pct < esc.inestable ? `; en seco, solo el ${nf(k.inestable_seco_pct, 1)}%.` : "."));
  else p.push(S.lluvia == null ? "Las laderas se ven estables, incluso con lluvia." : `${cuando}, las laderas se ven estables.`);
  if (nDes > 0) p.push(`Se detect${nDes > 1 ? "aron" : "ó"} <em class="r">${nDes} deslave${nDes > 1 ? "s" : ""}</em> desde la captura #${S.compararCon}.`);
  else if (nDes === 0) p.push(`Sin deslaves desde la captura #${S.compararCon}.`);
  p.push(`Si los ríos crecen ${nf(esc.nivel, 1)} m, se inundaría el <em class="a">${nf(esc.inund, 1)}%</em>.`);
  $("#frase").innerHTML = p.join(" ");
}

// ============================== TABS Y LEYENDA ==============================
const capaActual = () => CAPAS.find(c => c.id === S.capa);
function pintarTabs() {
  const c = S.compararCon ? S.comp.get(`${S.compararCon}-${S.actual}`) : null;
  $("#capas").innerHTML = CAPAS.map(cp => {
    const des = cp.comp && !S.compararCon;
    const badge = cp.comp && c && c.eventos && c.eventos.length ? `<span class="tab-badge">${c.eventos.length}</span>` : "";
    return `<button class="tab" role="tab" data-capa="${cp.id}" aria-selected="${cp.id === S.capa}" ${des ? `disabled title="${t("Se necesita otra captura para comparar", "Needs another capture to compare")}"` : ""}>
      <i style="background:${cp.icono}"></i>${cp.nombre}${badge}</button>`;
  }).join("");
  $("#capas").querySelectorAll(".tab").forEach(b => b.onclick = () => elegirCapa(b.dataset.capa));
}
async function elegirCapa(id) {
  if (id === "cambios" && !S.compararCon) return;
  S.capa = id;
  pintarTabs();
  pintarLeyenda();
  const cp = capaActual();
  if (cp.datos.some(n => !capaLista(S.actual, n)) || (cp.comp && !S.compCapa.has(`${S.compararCon}-${S.actual}`))) {
    $("#cargando-mapa").classList.remove("oculto");
    try {
      await Promise.all(cp.datos.map(n => capaDatos(S.actual, n)));
      if (cp.comp) await cargarComparacion();
    } catch { aviso(t("No se pudo cargar la capa.", "Couldn’t load the layer.")); }
    $("#cargando-mapa").classList.add("oculto");
  }
  pedirDibujo();
}
function pintarLeyenda() {
  const m = S.meta.get(S.actual); if (!m) return;
  const k = m.kpis, sat = Math.round(m.parametros.saturacion * 100);
  const cuadro = Object.fromEntries(m.cuadro.map((c, i) => [i, c]));
  const cl = cuadroLluvia(m);
  const clases = (col) => `<div class="leyenda-clases">${FS.map((c, i) =>
    `<div><i style="${estiloFS(i)}"></i><span><b>${c.nombre}</b> · ${c.rango}</span><span class="lc-pct" data-clase="${col}-${i}">${nf(col === "lluvia" ? cl[i] : cuadro[i][col], 1)}%</span></div>`).join("")}</div>`;
  const grad = (lut, a, b) => `<div class="leyenda-grad" style="background:${lutCss(lut)}"></div><div class="leyenda-ext"><span>${a}</span><span>${b}</span></div>`;
  const comp = S.compararCon ? S.comp.get(`${S.compararCon}-${S.actual}`) : null;
  const info = {
    relieve: [t("Relieve", "Relief"), t(`Altura del terreno. Las líneas son curvas de nivel cada ${nf(m.curvas.intervalo)} m; las gruesas, cada ${nf(m.curvas.intervalo * 5)} m.`,
      `Height of the terrain. The lines are contour lines every ${nf(m.curvas.intervalo)} m; the thick ones every ${nf(m.curvas.intervalo * 5)} m.`),
      grad(RAMPA.relieve, `${nf(k.zmin)} m`, `${nf(k.zmax)} m`) + `
      <div class="perfil-mini">
        <div class="perfil-mini-cab"><b>${t("Perfil de A a B", "Profile from A to B")}</b><button class="btn-link" id="linea-reset" ${S.linea && S.linea.propia ? "" : "hidden"}>${t("Volver a la línea original", "Back to the original line")}</button></div>
        <div class="grafica" id="g-perfil-mini"></div>
        <p class="ayuda">${t("Arrastra los puntos <b>A</b> y <b>B</b> en el mapa para cambiar el corte. Toca la gráfica para marcar un punto.", "Drag points <b>A</b> and <b>B</b> on the map to change the cut. Tap the chart to mark a point.")}</p>
      </div>`],
    pendiente: [t("Pendiente", "Slope"), t("Qué tan inclinada es cada ladera. Arriba de unos 30–35° la arena seca ya no se sostiene.", "How steep each slope is. Above about 30–35° dry sand no longer holds."),
      grad(RAMPA.pendiente, "0°", t("45° o más", "45° or more"))],
    riesgo_seco: [t("Riesgo de deslave en seco", "Landslide risk when dry"), t("Factor de seguridad (FS): compara lo que sostiene al suelo contra lo que lo jala ladera abajo. Con FS menor a 1, la ladera falla.", "Factor of safety (FS): compares what holds the soil in place against what pulls it downhill. With FS below 1, the slope fails."),
      clases("seco")],
    riesgo_lluvia: [t("Riesgo de deslave con lluvia", "Landslide risk with rain"), t("El mismo cálculo con el suelo mojado. El agua le quita resistencia al suelo, por eso con más lluvia aparecen más zonas en riesgo.", "The same calculation with wet soil. Water weakens the soil, so more rain means more areas at risk."),
      controlLluvia(m) + clases("lluvia")],
    drenaje: [t("Drenaje y cuencas", "Drainage and watersheds"), t("Hacia dónde escurre el agua de lluvia. Cada color es una cuenca (el área que drena a un mismo río); las líneas azules son los ríos.", "Where rainwater flows. Each color is a watershed (the area that drains to the same river); the blue lines are rivers."),
      `<div class="leyenda-clases">${m.cuencas.slice(0, 4).map((c, i) => `<div><i style="background:${CUENCAS[i]}"></i>${t("Cuenca", "Watershed")} ${c.n}<span class="lc-pct">${fmtArea(c.area)}</span></div>`).join("")}
       <div><i style="background:#0b4f9c"></i>${t("Ríos", "Rivers")}<span class="lc-pct">${fmtLen(k.long_rios)}</span></div></div>`],
    inundacion: [t("Zonas inundables", "Flood zones"), t("Zonas que quedan bajo el agua si los ríos suben, más el agua que se estanca en hundimientos (método HAND).", "Areas under water if the rivers rise, plus water that pools in hollows (HAND method)."),
      controlNivel(m) + grad(RAMPA.agua, t("poca agua", "shallow"), t("más profundo", "deeper"))],
    cambios: [t("Cambios entre capturas", "Changes between captures"), comp && !comp.error ? t(`Diferencia contra la captura #${S.compararCon}. Rojo: se perdió arena. Azul: se acumuló. Las flechas marcan los deslaves detectados.`, `Difference against capture #${S.compararCon}. Red: sand was lost. Blue: sand piled up. Arrows mark detected landslides.`) : t("Se necesita otra captura para comparar.", "Needs another capture to compare."),
      comp && !comp.error ? grad(RAMPA.cambios, `−${nf(comp.max_abs, 1)} m`, `+${nf(comp.max_abs, 1)} m`) : ""],
  }[S.capa];
  $("#capa-titulo").textContent = info[0];
  $("#capa-desc").textContent = info[1];
  $("#leyenda").innerHTML = info[2];
  const sll = $("#lluvia");
  if (sll) {
    sll.oninput = e => ponerLluvia(+e.target.value / 100);
    $("#lluvia-reset").onclick = () => ponerLluvia(null);
  }
  const sl = $("#nivel");
  if (sl) {
    sl.oninput = e => ponerNivel(+e.target.value);
    $("#nivel-reset").onclick = () => ponerNivel(null);
  }
  const mini = $("#g-perfil-mini");
  if (mini) {
    graficaPerfil(m, mini, true);
    $("#linea-reset").onclick = () => { S.linea = lineaOriginal(m); S.perfilFijo = null; $("#linea-reset").hidden = true; pedirDibujo(); programarGraficas(); };
  }
}

// Control para subir o bajar el agua, junto al mapa de inundación
function controlNivel(m) {
  const hmax = m.curva.nivel[m.curva.nivel.length - 1] || 1, nv = nivelActual(m);
  return `<div class="control-nivel">
    <label for="nivel">${t("Nivel del agua sobre los ríos", "Water level above the rivers")}</label>
    <div class="control-nivel-fila"><input type="range" id="nivel" min="0" max="${hmax.toFixed(1)}" step="0.1" value="${nv.toFixed(1)}"><b id="nivel-val">${nf(nv, 1)} m</b></div>
    <div class="control-nivel-res"><b id="nivel-pct">${nf(pctInundado(m, nv), 1)}%</b> ${t("del terreno queda bajo el agua", "of the terrain is under water")}</div>
    <button class="btn-link" id="nivel-reset" ${S.nivel == null ? "hidden" : ""}>${t("Volver al escenario original", "Back to the original scenario")} (${nf(m.kpis.nivel, 1)} m)</button>
  </div>`;
}
// Control de lluvia, junto al mapa de riesgo con lluvia
function controlLluvia(m) {
  const v = lluviaActual(m) * 100;
  return `<div class="control-nivel control-lluvia">
    <label for="lluvia">${t("¿Qué tan mojado está el suelo?", "How wet is the soil?")}</label>
    <div class="control-nivel-fila"><span class="sutil">${t("seco", "dry")}</span><input type="range" id="lluvia" min="0" max="100" step="5" value="${Math.round(v)}"><span class="sutil">${t("empapado", "soaked")}</span></div>
    <div class="control-nivel-res"><b id="lluvia-val">${nf(v)}%</b> ${t("mojado", "wet")} · <b id="lluvia-pct" class="r">${nf(cuadroLluvia(m)[0], 1)}%</b> ${t("del terreno inestable", "of the terrain unstable")}</div>
    <button class="btn-link" id="lluvia-reset" ${S.lluvia == null ? "hidden" : ""}>${t("Volver al escenario original", "Back to the original scenario")} (${nf(m.parametros.saturacion * 100)}%)</button>
  </div>`;
}
function ponerLluvia(v) {
  const m = S.meta.get(S.actual); if (!m) return;
  const nuevo = v == null ? null : Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;
  if (nuevo === S.lluvia) return;
  S.lluvia = nuevo;
  for (const k of [...S.imagenes.keys()]) if (k.startsWith(`${S.actual}:riesgo_lluvia:`)) S.imagenes.delete(k);
  pedirDibujo(); actualizarInspector();
  const cl = cuadroLluvia(m), sl = $("#lluvia");
  if (sl) {
    if (document.activeElement !== sl) sl.value = Math.round(lluviaActual(m) * 100);
    $("#lluvia-val").textContent = `${nf(lluviaActual(m) * 100)}%`;
    $("#lluvia-pct").textContent = `${nf(cl[0], 1)}%`;
    $("#lluvia-reset").hidden = S.lluvia == null;
    cl.forEach((v, i) => { const e = document.querySelector(`[data-clase="lluvia-${i}"]`); if (e) e.textContent = `${nf(v, 1)}%`; });
  }
  pintarKpis(m); pintarAlertas(); pintarEstabilidad(m); programarGraficas();
}
function actualizarControlNivel(m) {
  const sl = $("#nivel"); if (!sl || !m) return;
  const nv = nivelActual(m);
  if (document.activeElement !== sl) sl.value = nv.toFixed(1);
  $("#nivel-val").textContent = `${nf(nv, 1)} m`;
  $("#nivel-pct").textContent = `${nf(pctInundado(m, nv), 1)}%`;
  $("#nivel-reset").hidden = S.nivel == null;
}
function ponerNivel(v) {
  const m = S.meta.get(S.actual); if (!m) return;
  const nuevo = v == null ? null : Math.round(Math.max(0, v) * 10) / 10;
  if (nuevo === S.nivel) return;
  S.nivel = nuevo;
  for (const k of [...S.imagenes.keys()]) if (k.startsWith(`${S.actual}:inundacion:`)) S.imagenes.delete(k);
  pedirDibujo(); actualizarInspector(); actualizarControlNivel(m);
  const g = $("#g-inund"); if (g._marcar) g._marcar(nivelActual(m));
  pintarKpis(m); programarGraficas();
}
const lineaOriginal = m => ({ a: [...m.perfil.a], b: [...m.perfil.b], dims: `${m.filas}x${m.cols}` });
let graficasPendientes = false;
function programarGraficas() {
  if (graficasPendientes) return;
  graficasPendientes = true;
  requestAnimationFrame(() => {
    graficasPendientes = false;
    const m = S.meta.get(S.actual); if (!m) return;
    graficaPerfil(m);
    const mini = $("#g-perfil-mini"); if (mini) graficaPerfil(m, mini, true);
  });
}
const mapaVisible = () => { const r = $("#lienzo-cont").getBoundingClientRect(); return r.bottom > 120 && r.top < innerHeight - 120; };

// ============================== MAPA: IMAGEN ================================
function construirImagen() {
  const id = S.actual, m = S.meta.get(id);
  const clave = `${id}:${S.capa}:${S.capa === "cambios" ? S.compararCon : S.capa === "inundacion" ? nivelActual(m).toFixed(3) : S.capa === "riesgo_lluvia" ? lluviaActual(m).toFixed(3) : ""}`;
  if (S.imagenes.has(clave)) return S.imagenes.get(clave);
  const W = m.cols, H = m.filas, n = W * H;
  const sh = capaLista(id, "sombreado");
  if (!sh) return null;
  const cp = capaActual();
  const datos = cp.datos.map(nm => capaLista(id, nm));
  if (datos.some(d => !d)) return null;
  let dif = null;
  if (cp.comp) { dif = S.compCapa.get(`${S.compararCon}-${id}`); if (!dif) return null; }

  const img = new ImageData(W, H), d = img.data;
  const k = m.kpis, rango = (k.zmax - k.zmin) || 1;
  const comp = cp.comp ? S.comp.get(`${S.compararCon}-${id}`) : null;
  let maxProf = 0;
  const fsL = S.capa === "riesgo_lluvia" ? fsLluvia(m) : null;
  let prof = null;
  if (S.capa === "inundacion") {
    const nv = nivelActual(m); prof = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = Math.max(datos[0][i] < nv ? nv - datos[0][i] : 0, datos[1][i] > 0 ? datos[1][i] : 0);
      prof[i] = p; if (p > maxProf) maxProf = p;
    }
  }
  const rios = S.capa === "drenaje" ? datos[1] : null;
  const cuRgb = CUENCAS.map(hex2rgb);

  for (let i = 0; i < n; i++) {
    const s = isNaN(sh[i]) ? .5 : sh[i];
    const gris = 60 + 185 * s;
    let r = gris, g = gris, b = gris, a = 0, c = null;
    const luz = .62 + .48 * s;
    switch (S.capa) {
      case "relieve": {
        const z = datos[0][i];
        if (!isNaN(z)) {
          const t = Math.max(0, Math.min(255, ((z - k.zmin) / rango * 255) | 0)) * 3;
          const f = .5 + .62 * s;
          r = RAMPA.relieve[t] * f; g = RAMPA.relieve[t + 1] * f; b = RAMPA.relieve[t + 2] * f;
        }
        break;
      }
      case "pendiente": {
        const t = Math.min(255, (datos[0][i] / 45 * 255) | 0) * 3;
        c = [RAMPA.pendiente[t], RAMPA.pendiente[t + 1], RAMPA.pendiente[t + 2]]; a = .8;
        break;
      }
      case "riesgo_seco": case "riesgo_lluvia": {
        const f = fsL ? fsL[i] : datos[0][i], cl = claseFS(f); c = cl.color; a = cl.a;
        // trama: rayas en lo inestable y puntos en lo crítico (se distingue sin depender del color)
        const x = i % W, y = (i / W) | 0;
        if (f < 1 && (x + y) % 5 < 2) c = c.map(v => v * .5);
        else if (f >= 1 && f < 1.3 && x % 3 === 0 && y % 3 === 0) c = c.map(v => v * .55);
        break;
      }
      case "drenaje": {
        const cu = datos[0][i];
        if (cu > 0) { c = cuRgb[(cu - 1) % 8]; a = .48; }
        if (rios[i] > 0 || (i % W && rios[i - 1] > 0) || (i >= W && rios[i - W] > 0)) { c = [11, 79, 156]; a = 1; }
        break;
      }
      case "inundacion": {
        const p = prof[i];
        if (p > 0) { const t = Math.min(255, (Math.pow(p / (maxProf || 1), .6) * 255) | 0) * 3; c = [RAMPA.agua[t], RAMPA.agua[t + 1], RAMPA.agua[t + 2]]; a = .9; }
        break;
      }
      case "cambios": {
        const v = dif[i];
        if (!isNaN(v)) { const t = Math.max(0, Math.min(255, ((.5 + v / (2 * (comp.max_abs || 1))) * 255) | 0)) * 3; c = [RAMPA.cambios[t], RAMPA.cambios[t + 1], RAMPA.cambios[t + 2]]; a = .92; }
        break;
      }
    }
    if (c) { r = r * (1 - a) + c[0] * luz * a; g = g * (1 - a) + c[1] * luz * a; b = b * (1 - a) + c[2] * luz * a; }
    const j = i * 4;
    d[j] = r; d[j + 1] = g; d[j + 2] = b; d[j + 3] = 255;
  }
  const lienzo = document.createElement("canvas");
  lienzo.width = W; lienzo.height = H;
  lienzo.getContext("2d").putImageData(img, 0, 0);
  S.imagenes.set(clave, lienzo);
  return lienzo;
}

function rutasCurvas(cv) {
  const normal = new Path2D(), maestra = new Path2D();
  for (const l of cv.lineas) {
    const p = l.maestra ? maestra : normal, pts = l.pts;
    p.moveTo(pts[0] + .5, pts[1] + .5);
    for (let i = 2; i < pts.length; i += 2) p.lineTo(pts[i] + .5, pts[i + 1] + .5);
  }
  return { normal, maestra };
}

// ============================== MAPA: DIBUJO ================================
const lienzo = $("#lienzo");
let ctx = lienzo.getContext("2d");  // se cambia un momento al exportar la imagen
let dibujoPendiente = false;
function pedirDibujo() { if (!dibujoPendiente) { dibujoPendiente = true; requestAnimationFrame(dibujar); } }
function tamLienzo() {
  const r = $("#lienzo-cont").getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  if (lienzo.width !== Math.round(r.width * dpr) || lienzo.height !== Math.round(r.height * dpr)) {
    lienzo.width = Math.round(r.width * dpr); lienzo.height = Math.round(r.height * dpr);
  }
  return { w: r.width, h: r.height, dpr };
}
function ajustarVista() {
  const m = S.meta.get(S.actual); if (!m) return;
  const { w, h } = tamLienzo();
  const e = Math.min(w / m.cols, h / m.filas) * .94;
  S.vista = { ...S.vista, escala: e, base: e, ox: (w - m.cols * e) / 2, oy: (h - m.filas * e) / 2, ajustada: true };
  pedirDibujo();
}
function zoomEn(sx, sy, factor) {
  const v = S.vista;
  const nueva = Math.min(v.base * 20, Math.max(v.base * .7, v.escala * factor));
  v.ox = sx - (sx - v.ox) * (nueva / v.escala);
  v.oy = sy - (sy - v.oy) * (nueva / v.escala);
  v.escala = nueva;
  pedirDibujo();
}

function dibujar() {
  dibujoPendiente = false;
  const { w, h, dpr } = tamLienzo();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const m = S.meta.get(S.actual);
  if (!m) return;
  const img = construirImagen();
  if (!img) return;
  pintarMapa(m, img, S.vista.escala, S.vista.ox, S.vista.oy, true);
  barraEscala(m);
}
// Dibuja el mapa y lo que va encima (curvas, línea A–B, flechas) en "ctx".
function pintarMapa(m, img, e, ox, oy, enPantalla) {
  const categ = ["riesgo_seco", "riesgo_lluvia", "drenaje"].includes(S.capa);
  ctx.imageSmoothingEnabled = !(categ && e > 2.5);
  ctx.imageSmoothingQuality = "high";
  ctx.save();
  if (enPantalla) { ctx.shadowColor = "rgba(0,0,0,.18)"; ctx.shadowBlur = 14; }
  ctx.drawImage(img, ox, oy, m.cols * e, m.filas * e);
  ctx.restore();

  // En la imagen descargada (como el doble de ancha que la pantalla) las líneas, las letras A/B
  // y las flechas se dibujan al doble de grueso. "ek" solo cambia tamaños, no posiciones.
  const ek = enPantalla ? e : e / 2;
  ctx.save();
  ctx.translate(ox, oy); ctx.scale(e, e);
  // curvas de nivel
  if (S.curvas && m.rutas) {
    const oscuro = S.capa === "relieve" ? "rgba(40,30,20," : "rgba(25,25,25,";
    ctx.lineJoin = "round";
    ctx.strokeStyle = oscuro + (S.capa === "relieve" ? ".38)" : ".28)"); ctx.lineWidth = .8 / ek; ctx.stroke(m.rutas.normal);
    ctx.strokeStyle = oscuro + (S.capa === "relieve" ? ".7)" : ".5)"); ctx.lineWidth = 1.6 / ek; ctx.stroke(m.rutas.maestra);
  }
  // línea del perfil
  if (S.linea && (S.capa === "relieve" || S.perfilHover != null || S.perfilFijo != null)) {
    const [ax, ay] = S.linea.a, [bx, by] = S.linea.b;
    ctx.setLineDash([6 / ek, 4 / ek]);
    ctx.strokeStyle = "rgba(192,57,43,.9)"; ctx.lineWidth = 2 / ek;
    ctx.beginPath(); ctx.moveTo(ax + .5, ay + .5); ctx.lineTo(bx + .5, by + .5); ctx.stroke();
    ctx.setLineDash([]);
    etiquetaMapa("A", ax + .5, ay + .5, ek); etiquetaMapa("B", bx + .5, by + .5, ek);
    if (S.perfilHover != null) {
      const x = ax + (bx - ax) * S.perfilHover + .5, y = ay + (by - ay) * S.perfilHover + .5;
      punto(x, y, ek, "#c0392b");
    }
    if (S.perfilFijo != null) {
      const x = ax + (bx - ax) * S.perfilFijo + .5, y = ay + (by - ay) * S.perfilFijo + .5;
      punto(x, y, ek, "#2a6146", 8);
    }
  }
  // flechas de deslaves
  if (S.capa === "cambios") {
    const c = S.comp.get(`${S.compararCon}-${S.actual}`);
    (c && c.eventos || []).forEach((ev, i) => flecha(ev.centro[1] + .5, ev.centro[0] + .5, ev.destino[1] + .5, ev.destino[0] + .5, ek, i + 1));
  }
  // punto bajo el cursor
  if (enPantalla && S.hover) {
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5 / e;
    ctx.strokeRect(S.hover.c, S.hover.r, 1, 1);
    ctx.strokeStyle = "#111"; ctx.lineWidth = 1 / e;
    ctx.strokeRect(S.hover.c, S.hover.r, 1, 1);
    if (e < 6) { ctx.beginPath(); ctx.arc(S.hover.c + .5, S.hover.r + .5, 7 / e, 0, 7); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2 / e; ctx.stroke(); }
  }
  ctx.restore();
}
function etiquetaMapa(txt, x, y, e) {
  ctx.save(); ctx.translate(x, y); ctx.scale(1 / e, 1 / e);
  ctx.fillStyle = "#c0392b"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(0, 0, 12, 0, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#fff"; ctx.font = "800 12px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(txt, 0, 1); ctx.restore();
}
function punto(x, y, e, color, radio = 6) {
  ctx.save(); ctx.translate(x, y); ctx.scale(1 / e, 1 / e);
  ctx.fillStyle = color; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(0, 0, radio, 0, 7); ctx.fill(); ctx.stroke(); ctx.restore();
}
function flecha(x0, y0, x1, y1, e, n) {
  ctx.save(); ctx.scale(1 / e, 1 / e);
  const X0 = x0 * e, Y0 = y0 * e, X1 = x1 * e, Y1 = y1 * e, ang = Math.atan2(Y1 - Y0, X1 - X0);
  ctx.strokeStyle = "#111"; ctx.fillStyle = "#111"; ctx.lineWidth = 3; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(X0, Y0); ctx.lineTo(X1 - 9 * Math.cos(ang), Y1 - 9 * Math.sin(ang)); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(X1, Y1);
  ctx.lineTo(X1 - 14 * Math.cos(ang - .45), Y1 - 14 * Math.sin(ang - .45));
  ctx.lineTo(X1 - 14 * Math.cos(ang + .45), Y1 - 14 * Math.sin(ang + .45)); ctx.closePath(); ctx.fill();
  const txt = `${t("Deslave", "Landslide")} ${n}`;
  ctx.font = "700 12px system-ui, sans-serif";
  const ancho = ctx.measureText(txt).width + 14;
  ctx.fillStyle = "rgba(255,255,255,.95)"; ctx.strokeStyle = "rgba(0,0,0,.15)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(X0 - ancho / 2, Y0 - 32, ancho, 22, 6) : ctx.rect(X0 - ancho / 2, Y0 - 32, ancho, 22);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#b0281d"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(txt, X0, Y0 - 21);
  ctx.restore();
}
function barraEscala(m) {
  const mpp = m.celda / S.vista.escala;
  const objetivo = 110 * mpp, p = Math.pow(10, Math.floor(Math.log10(objetivo)));
  const largo = [1, 2, 5, 10].map(f => f * p).filter(v => v <= objetivo).pop() || p;
  const el = $("#escala-barra");
  el.querySelector("span").style.width = `${largo / mpp}px`;
  el.querySelector("b").textContent = fmtLen(largo);
}

// ============================== DESCARGAR IMAGEN DEL MAPA ===================
// Guarda en JPG el mapa completo de la capa que se está viendo, con título, leyenda,
// barra de escala y norte. Siempre en colores claros, para imprimir o pegar en un trabajo.
function leyendaExport(m) {
  const k = m.kpis, comp = S.compararCon ? S.comp.get(`${S.compararCon}-${S.actual}`) : null;
  const grad = (lut, a, b) => ({ grad: lut, a, b });
  const clasesFS = () => ({ items: FS.map(c => [rgb(c.color), c.nombre]) });
  switch (S.capa) {
    case "relieve": return grad(RAMPA.relieve, `${nf(k.zmin)} m`, `${nf(k.zmax)} m`);
    case "pendiente": return grad(RAMPA.pendiente, "0°", t("45° o más", "45° or more"));
    case "riesgo_seco": case "riesgo_lluvia": return clasesFS();
    case "drenaje": return { items: [...m.cuencas.slice(0, 4).map((c, i) => [CUENCAS[i], `${t("Cuenca", "Watershed")} ${c.n}`]), ["#0b4f9c", t("Ríos", "Rivers")]] };
    case "inundacion": return grad(RAMPA.agua, t("poca agua", "shallow"), t("más profundo", "deeper"));
    case "cambios": return comp ? grad(RAMPA.cambios, `−${nf(comp.max_abs, 1)} m`, `+${nf(comp.max_abs, 1)} m`) : {};
  }
  return {};
}
function detalleExport(m) {
  const esc = escenario(m);
  if (S.capa === "riesgo_lluvia") return t(`Suelo ${nf(esc.lluvia * 100)}% mojado · ${nf(esc.inestable, 1)}% del terreno inestable`, `Soil ${nf(esc.lluvia * 100)}% wet · ${nf(esc.inestable, 1)}% of terrain unstable`);
  if (S.capa === "riesgo_seco") return t(`Suelo seco · ${nf(m.cuadro[0].seco, 1)}% del terreno inestable`, `Dry soil · ${nf(m.cuadro[0].seco, 1)}% of terrain unstable`);
  if (S.capa === "inundacion") return t(`Ríos crecidos +${nf(esc.nivel, 1)} m · ${nf(esc.inund, 1)}% del terreno inundado`, `Rivers up +${nf(esc.nivel, 1)} m · ${nf(esc.inund, 1)}% of terrain flooded`);
  if (S.capa === "cambios") return t(`Comparado con la captura #${S.compararCon}`, `Compared with capture #${S.compararCon}`);
  if (S.capa === "relieve") return t(`Curvas de nivel cada ${nf(m.curvas.intervalo)} m`, `Contour lines every ${nf(m.curvas.intervalo)} m`);
  return "";
}
async function descargarImagenMapa() {
  const m = S.meta.get(S.actual), img = m && construirImagen();
  if (!img) { aviso(t("El mapa todavía se está cargando.", "The map is still loading.")); return; }
  const e = Math.max(1, 1600 / m.cols), MW = Math.round(m.cols * e), MH = Math.round(m.filas * e);
  const P = 32, CAB = 92, PIE = 96, W = MW + 2 * P, H = CAB + MH + PIE;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d");
  const TX = "#2e241c", TX2 = "#6a5a4e", FONDO = "#fdfaf5", fuente = "system-ui, -apple-system, 'Segoe UI', sans-serif";
  g.fillStyle = FONDO; g.fillRect(0, 0, W, H);
  // título
  const capa = capaActual();
  g.fillStyle = TX; g.textBaseline = "alphabetic"; g.textAlign = "left";
  g.font = `800 34px ${fuente}`; g.fillText(`${capa.nombre} · ${t("Captura", "Capture")} #${m.id}`, P, 46);
  g.font = `500 19px ${fuente}`; g.fillStyle = TX2;
  g.fillText([fechaLarga(m.hora), detalleExport(m)].filter(Boolean).join("  ·  "), P, 76);
  g.textAlign = "right"; g.font = `700 16px ${fuente}`; g.fillStyle = "#2a6146";
  g.fillText(t("Sandbox Terreno", "Sandbox Terrain"), W - P, 46);
  // mapa (se dibuja con las mismas funciones que la pantalla)
  const antes = ctx; ctx = g;
  try { g.save(); pintarMapa(m, img, e, P, CAB, false); g.restore(); } finally { ctx = antes; }
  g.strokeStyle = "rgba(0,0,0,.25)"; g.lineWidth = 1; g.strokeRect(P + .5, CAB + .5, MW - 1, MH - 1);
  // leyenda
  const y0 = CAB + MH + 26, ley = leyendaExport(m);
  g.textAlign = "left"; g.textBaseline = "middle"; g.font = `600 17px ${fuente}`; g.fillStyle = TX;
  if (ley.grad) {
    const gw = Math.min(420, MW * .4), gr = g.createLinearGradient(P, 0, P + gw, 0);
    for (let i = 0; i <= 8; i++) { const q = Math.round(i / 8 * 255) * 3; gr.addColorStop(i / 8, `rgb(${ley.grad[q]},${ley.grad[q + 1]},${ley.grad[q + 2]})`); }
    g.fillStyle = gr; g.fillRect(P, y0, gw, 16); g.strokeStyle = "rgba(0,0,0,.2)"; g.strokeRect(P + .5, y0 + .5, gw - 1, 15);
    g.fillStyle = TX2; g.textBaseline = "top"; g.fillText(ley.a, P, y0 + 24);
    g.textAlign = "right"; g.fillText(ley.b, P + gw, y0 + 24); g.textAlign = "left";
  } else if (ley.items) {
    let x = P;
    for (const [col, nom] of ley.items) {
      g.fillStyle = col; g.beginPath(); g.arc(x + 8, y0 + 10, 8, 0, 7); g.fill();
      g.fillStyle = TX; g.fillText(nom, x + 22, y0 + 10);
      x += 22 + g.measureText(nom).width + 26;
    }
  }
  // barra de escala y norte
  const mpp = m.celda / e, objetivo = 220 * mpp, pp = Math.pow(10, Math.floor(Math.log10(objetivo)));
  const largo = [1, 2, 5, 10].map(f => f * pp).filter(v => v <= objetivo).pop() || pp, lpx = largo / mpp;
  const xe = W - P - 70 - lpx;
  g.fillStyle = TX; g.fillRect(xe, y0 + 8, lpx, 5); g.fillRect(xe, y0 + 2, 2, 17); g.fillRect(xe + lpx - 2, y0 + 2, 2, 17);
  g.textAlign = "center"; g.textBaseline = "top"; g.font = `700 15px ${fuente}`; g.fillText(fmtLen(largo), xe + lpx / 2, y0 + 24);
  const xn = W - P - 20;
  g.beginPath(); g.moveTo(xn, y0 - 6); g.lineTo(xn + 11, y0 + 26); g.lineTo(xn, y0 + 18); g.lineTo(xn - 11, y0 + 26); g.closePath(); g.fill();
  g.font = `800 15px ${fuente}`; g.fillText("N", xn, y0 + 32);
  g.textAlign = "left"; g.textBaseline = "alphabetic"; g.font = `500 14px ${fuente}`; g.fillStyle = TX2;
  g.fillText(t(`Escala: 1 cm de arena = ${nf(m.parametros.metros_por_cm, 1)} m · Modelo educativo del AR Sandbox`,
               `Scale: 1 cm of sand = ${nf(m.parametros.metros_por_cm, 1)} m · Educational AR Sandbox model`), P, H - 16);
  // guardar
  const blob = await new Promise(r => c.toBlob(r, "image/jpeg", .92));
  if (!blob) { aviso(t("No se pudo crear la imagen.", "Couldn’t create the image.")); return; }
  const d = new Date(m.hora), dos = n => String(n).padStart(2, "0");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `sandbox_${t("captura", "capture")}${m.id}_${capa.nombre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}_${d.getFullYear()}${dos(d.getMonth() + 1)}${dos(d.getDate())}_${dos(d.getHours())}${dos(d.getMinutes())}.jpg`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
$("#t-imagen").onclick = descargarImagenMapa;

// ============================== MAPA: INTERACCIÓN ===========================
const punteros = new Map();
let arrastre = null, pinza = null, arrastreAB = null;
// ¿El cursor está sobre el punto A o B? (solo en la pestaña Relieve, donde se ve la línea)
function manijaCerca([x, y]) {
  if (S.capa !== "relieve" || !S.linea) return null;
  const v = S.vista, dist = q => Math.hypot(v.ox + (q[0] + .5) * v.escala - x, v.oy + (q[1] + .5) * v.escala - y);
  const da = dist(S.linea.a), db = dist(S.linea.b);
  if (Math.min(da, db) > 22) return null;
  return da <= db ? "a" : "b";
}
function moverManija(cual, [x, y]) {
  const m = S.meta.get(S.actual); if (!m) return;
  S.linea[cual] = [
    Math.max(0, Math.min(m.cols - 1, (x - S.vista.ox) / S.vista.escala - .5)),
    Math.max(0, Math.min(m.filas - 1, (y - S.vista.oy) / S.vista.escala - .5)),
  ];
  S.linea.propia = true; S.perfilFijo = null;
  const r = $("#linea-reset"); if (r) r.hidden = false;
  pedirDibujo(); programarGraficas();
}
const pos = ev => { const r = lienzo.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
lienzo.addEventListener("pointerdown", ev => {
  lienzo.setPointerCapture(ev.pointerId);
  const manija = punteros.size === 0 ? manijaCerca(pos(ev)) : null;
  punteros.set(ev.pointerId, pos(ev));
  if (manija) { arrastreAB = manija; arrastre = null; $("#lienzo-cont").classList.add("arrastrando"); return; }
  if (punteros.size === 1) arrastre = { inicio: pos(ev), ox: S.vista.ox, oy: S.vista.oy, movio: false };
  if (punteros.size === 2) {
    const [a, b] = [...punteros.values()];
    pinza = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), escala: S.vista.escala };
    arrastre = null;
  }
});
lienzo.addEventListener("pointermove", ev => {
  const p = pos(ev);
  if (punteros.has(ev.pointerId)) punteros.set(ev.pointerId, p);
  if (arrastreAB && punteros.has(ev.pointerId)) { moverManija(arrastreAB, p); return; }
  if (pinza && punteros.size === 2) {
    const [a, b] = [...punteros.values()];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    zoomEn((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (pinza.escala * d / pinza.d) / S.vista.escala);
    return;
  }
  if (arrastre) {
    const dx = p[0] - arrastre.inicio[0], dy = p[1] - arrastre.inicio[1];
    if (Math.hypot(dx, dy) > 4) arrastre.movio = true;
    if (arrastre.movio) {
      $("#lienzo-cont").classList.add("arrastrando");
      S.vista.ox = arrastre.ox + dx; S.vista.oy = arrastre.oy + dy; pedirDibujo();
      return;
    }
  }
  if (ev.pointerType === "mouse") { ponerHover(p); lienzo.style.cursor = manijaCerca(p) ? "grab" : ""; }
});
const soltar = ev => {
  const p = pos(ev);
  if (arrastre && !arrastre.movio) ponerHover(p);
  punteros.delete(ev.pointerId);
  if (punteros.size < 2) pinza = null;
  if (punteros.size === 0) { arrastre = null; arrastreAB = null; }
  $("#lienzo-cont").classList.remove("arrastrando");
};
lienzo.addEventListener("pointerup", soltar);
lienzo.addEventListener("pointercancel", soltar);
lienzo.addEventListener("pointerleave", ev => { if (ev.pointerType === "mouse" && !arrastre) { S.hover = null; actualizarInspector(); pedirDibujo(); } });
lienzo.addEventListener("wheel", ev => { ev.preventDefault(); const [x, y] = pos(ev); zoomEn(x, y, Math.exp(-ev.deltaY * .0016)); }, { passive: false });
lienzo.addEventListener("dblclick", ajustarVista);
function ponerHover([x, y]) {
  const m = S.meta.get(S.actual); if (!m) return;
  const c = Math.floor((x - S.vista.ox) / S.vista.escala), r = Math.floor((y - S.vista.oy) / S.vista.escala);
  const dentro = c >= 0 && r >= 0 && c < m.cols && r < m.filas;
  const nuevo = dentro ? { c, r } : null;
  if (JSON.stringify(nuevo) === JSON.stringify(S.hover)) return;
  S.hover = nuevo; actualizarInspector(); pedirDibujo();
}
$("#z-mas").onclick = () => { const { w, h } = tamLienzo(); zoomEn(w / 2, h / 2, 1.5); };
$("#z-menos").onclick = () => { const { w, h } = tamLienzo(); zoomEn(w / 2, h / 2, 1 / 1.5); };
$("#z-ajustar").onclick = ajustarVista;
$("#t-curvas").onclick = e => { S.curvas = !S.curvas; e.currentTarget.classList.toggle("activo", S.curvas); e.currentTarget.setAttribute("aria-pressed", S.curvas); pedirDibujo(); };
$("#t-pantalla").onclick = () => {
  const el = $("#lienzo-cont");
  if (document.fullscreenElement) document.exitFullscreen(); else el.requestFullscreen && el.requestFullscreen();
};
new ResizeObserver(() => { if (S.actual) ajustarVista(); }).observe($("#lienzo-cont"));
let anchoGraficas = 0, temporizadorGraficas = null;
new ResizeObserver(([e]) => {
  const w = Math.round(e.contentRect.width);
  if (Math.abs(w - anchoGraficas) < 8) return;
  anchoGraficas = w;
  clearTimeout(temporizadorGraficas);
  temporizadorGraficas = setTimeout(() => { const m = S.meta.get(S.actual); if (m) { graficaPerfil(m); graficaInundacion(m); } }, 120);
}).observe($("#g-perfil"));
function irAlMapa() { $(".mapa-tarjeta").scrollIntoView({ behavior: "smooth", block: "start" }); }

// ============================== INSPECTOR ===================================
function actualizarInspector() {
  const dl = $("#insp-datos"), vacio = $("#insp-vacio");
  const m = S.meta.get(S.actual);
  if (!S.hover || !m) { dl.hidden = true; vacio.hidden = false; return; }
  const { c, r } = S.hover, i = r * m.cols + c, id = S.actual;
  const v = n => { const a = capaLista(id, n); return a ? a[i] : undefined; };
  const x = m.origen[0] + (c + .5) * m.celda, y = m.origen[1] + (m.filas - r - .5) * m.celda;
  const fila = (dt, dd) => `<dt>${dt}</dt><dd>${dd}</dd>`;
  const fsTxt = f => { if (f === undefined) return "…"; const cl = claseFS(f); return `<i style="${estiloFS(FS.indexOf(cl))}"></i>${cl.nombre} <span class="sutil">FS ${nf(f, 2)}</span>`; };
  const pend = v("pendiente"), ori = cardinal(v("orientacion")), prof = profundidad(id, i, nivelActual(m)), cu = v("cuencas");
  let html = fila(t("Coordenadas", "Coordinates"), `<span class="sutil">X</span> ${nf(x)} <span class="sutil">Y</span> ${nf(y)}`)
    + fila(t("Elevación", "Elevation"), `${nf(v("elevacion"), 1)} m`)
    + fila(t("Pendiente", "Slope"), pend === undefined ? "…" : `${nf(pend, 1)}°${ori && pend > 1 ? ` <span class="sutil">${t("hacia el", "facing")} ${ori}</span>` : ""}`)
    + `<div class="sep"></div>`
    + fila(t("Estabilidad en seco", "Stability when dry"), fsTxt(v("fs_seco")))
    + fila(t(`Con lluvia (${nf(lluviaActual(m) * 100)}% mojado)`, `With rain (${nf(lluviaActual(m) * 100)}% wet)`), (() => { const a = fsLluvia(m); return fsTxt(a ? a[i] : undefined); })())
    + `<div class="sep"></div>`
    + fila(t("Inundación", "Flooding"), prof === undefined ? "…" : prof > 0 ? `<i style="background:var(--agua)"></i>${nf(prof, 1)} ${t("m de agua", "m of water")}` : t("No se inunda", "Doesn’t flood"))
    + fila(t("Cuenca", "Watershed"), cu === undefined ? "…" : cu > 0 ? `<i style="background:${CUENCAS[(cu - 1) % 8]}"></i>${t("Cuenca", "Watershed")} ${cu}` : t("Cuenca menor", "Minor watershed"));
  const dif = S.compararCon ? S.compCapa.get(`${S.compararCon}-${id}`) : null;
  if (dif) html += fila(`${t("Cambio vs", "Change vs")} #${S.compararCon}`, isNaN(dif[i]) ? t("Sin cambio", "No change") : `<span style="color:${dif[i] < 0 ? "var(--riesgo)" : "var(--agua)"}">${dif[i] > 0 ? "+" : ""}${nf(dif[i], 1)} m</span>`);
  dl.innerHTML = html; dl.hidden = false; vacio.hidden = true;
}

// ============================== GRÁFICAS ====================================
function marcas(min, max, n = 5) {
  const paso0 = (max - min) / n, p = Math.pow(10, Math.floor(Math.log10(paso0 || 1)));
  const paso = [1, 2, 2.5, 5, 10].map(f => f * p).find(s => s >= paso0) || p * 10;
  const r = []; for (let v = Math.ceil(min / paso) * paso; v <= max + 1e-9; v += paso) r.push(+v.toFixed(10));
  return r;
}
function el(tag, attrs = {}, padre) {
  const e = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (padre) padre.appendChild(e);
  return e;
}
function ejes(svg, W, H, M, X, Y, xt, yt, etqX, etqY, fx = nf, fy = nf) {
  const g = el("g", { class: "eje" }, svg);
  for (const t of yt) {
    el("line", { x1: M.l, x2: W - M.r, y1: Y(t), y2: Y(t) }, g);
    el("text", { x: M.l - 8, y: Y(t) + 4, "text-anchor": "end" }, g).textContent = fy(t);
  }
  for (const t of xt) el("text", { x: X(t), y: H - M.b + 16, "text-anchor": "middle" }, g).textContent = fx(t);
  el("text", { x: (M.l + W - M.r) / 2, y: H - 4, "text-anchor": "middle", class: "titulo-eje" }, svg).textContent = etqX;
  el("text", { x: 12, y: (M.t + H - M.b) / 2, "text-anchor": "middle", class: "titulo-eje", transform: `rotate(-90 12 ${(M.t + H - M.b) / 2})` }, svg).textContent = etqY;
}
function tooltip(cont) {
  let t = cont.querySelector(".grafica-tip");
  if (!t) { t = document.createElement("div"); t.className = "grafica-tip"; cont.appendChild(t); }
  return t;
}

// Perfil calculado en la página con la línea A–B actual (se puede mover en el mapa).
function calcPerfil(m) {
  const id = m.id, z = capaLista(id, "elevacion");
  if (!z || !S.linea) return null;
  const W = m.cols, H = m.filas, [ax, ay] = S.linea.a, [bx, by] = S.linea.b;
  const n = Math.max(2, Math.min(500, Math.round(Math.hypot(bx - ax, by - ay)) + 1));
  const fs = fsLluvia(m), nivel = nivelActual(m);
  const p = { dist: [], elev: [], agua: [], inestable: [] };
  let ult = NaN;
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1), x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
    const fx = x - x0, fy = y - y0, g = (c, r) => z[r * W + c];
    let v = g(x0, y0) * (1 - fx) * (1 - fy) + g(x1, y0) * fx * (1 - fy) + g(x0, y1) * (1 - fx) * fy + g(x1, y1) * fx * fy;
    const i = Math.round(y) * W + Math.round(x);
    if (isNaN(v)) v = z[i];
    if (isNaN(v)) v = isNaN(ult) ? m.kpis.zmin : ult;
    ult = v;
    p.dist.push(Math.hypot(x - ax, y - ay) * m.celda);
    p.elev.push(v);
    p.agua.push(v + (profundidad(id, i, nivel) || 0));
    p.inestable.push(fs ? fs[i] < 1 : false);
  }
  return p;
}

function fijarPuntoPerfil(frac, dist, avisar) {
  if (!S.linea) return;
  const [ax, ay] = S.linea.a, [bx, by] = S.linea.b;
  S.perfilFijo = frac;
  S.hover = { c: Math.round(ax + (bx - ax) * frac), r: Math.round(ay + (by - ay) * frac) };
  actualizarInspector(); pedirDibujo();
  if (avisar && !mapaVisible())
    aviso(t(`<b>Punto marcado en el mapa</b><small>A ${fmtLen(dist)} del punto A. Sus datos aparecen junto al mapa.</small>`,
      `<b>Point marked on the map</b><small>${fmtLen(dist)} from point A. Its data shows next to the map.</small>`), { boton: t("Ver en el mapa", "Show on map"), accion: irAlMapa });
}

function graficaPerfil(m, cont = $("#g-perfil"), mini = false) {
  cont.innerHTML = "";
  const p = calcPerfil(m) || m.perfil, n = p.dist.length;
  const zmin = Math.min(...p.elev), zmaxT = Math.max(...p.elev);
  if (!mini) $("#perfil-sub").textContent = `A → B · ${fmtLen(p.dist[n - 1])} · ${t("desnivel", "relief")} ${nf(zmaxT - zmin)} m`;
  const W = Math.max(mini ? 220 : 300, cont.clientWidth || 480), H = mini ? 150 : (W < 420 ? 240 : 230);
  const M = mini ? { l: 42, r: 8, t: 24, b: 22 } : { l: 66, r: 12, t: 30, b: 40 };
  const zmax = Math.max(...p.agua, zmaxT), marg = (zmax - zmin) * .08 || 1;
  const y0 = zmin - marg, y1 = zmax + marg, dmax = p.dist[n - 1] || 1;
  const X = d => M.l + d / dmax * (W - M.l - M.r), Y = z => H - M.b - (z - y0) / (y1 - y0) * (H - M.t - M.b);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": t("Perfil topográfico", "Topographic profile") }, cont);
  const idGr = mini ? "gArenaMini" : "gArena";
  const gr = el("linearGradient", { id: idGr, x1: 0, y1: 0, x2: 0, y2: 1 }, el("defs", {}, svg));
  el("stop", { offset: "0", "stop-color": "#d8b884" }, gr); el("stop", { offset: "1", "stop-color": "#a98557" }, gr);
  ejes(svg, W, H, M, X, Y, marcas(0, dmax, mini ? 3 : 6), marcas(y0, y1, mini ? 3 : 4), mini ? "" : t("Distancia (m)", "Distance (m)"), mini ? "" : t("Elevación (m)", "Elevation (m)"));
  const base = Y(y0);
  let dT = `M${X(0)},${base}`; p.elev.forEach((z, i) => dT += `L${X(p.dist[i]).toFixed(1)},${Y(z).toFixed(1)}`); dT += `L${X(dmax)},${base}Z`;
  let dA = ""; p.agua.forEach((z, i) => dA += `${i ? "L" : "M"}${X(p.dist[i]).toFixed(1)},${Y(z).toFixed(1)}`);
  for (let i = n - 1; i >= 0; i--) dA += `L${X(p.dist[i]).toFixed(1)},${Y(p.elev[i]).toFixed(1)}`;
  el("path", { d: dA + "Z", fill: "var(--agua)", opacity: .85 }, svg);
  el("path", { d: dT, fill: `url(#${idGr})` }, svg);
  let dL = ""; p.elev.forEach((z, i) => dL += `${i ? "L" : "M"}${X(p.dist[i]).toFixed(1)},${Y(z).toFixed(1)}`);
  el("path", { d: dL, fill: "none", stroke: "#5b4630", "stroke-width": 1.4 }, svg);
  let dR = "", abierto = false;
  p.elev.forEach((z, i) => { if (p.inestable[i]) { dR += `${abierto ? "L" : "M"}${X(p.dist[i]).toFixed(1)},${Y(z).toFixed(1)}`; abierto = true; } else abierto = false; });
  el("path", { d: dR, fill: "none", stroke: "var(--riesgo)", "stroke-width": mini ? 3 : 4, "stroke-linecap": "round" }, svg);
  for (const [txt, d] of [["A", 0], ["B", dmax]]) {
    el("circle", { cx: X(d), cy: 11, r: 9, fill: "#c0392b" }, svg);
    el("text", { x: X(d), y: 15, "text-anchor": "middle", fill: "#fff", "font-size": 11, "font-weight": 800 }, svg).textContent = txt;
  }
  // punto marcado (se queda fijo en el mapa)
  if (S.perfilFijo != null) {
    const i = Math.round(S.perfilFijo * (n - 1));
    el("line", { x1: X(p.dist[i]), x2: X(p.dist[i]), y1: M.t, y2: H - M.b, stroke: "#2a6146", "stroke-width": 1.5 }, svg);
    el("circle", { cx: X(p.dist[i]), cy: Y(p.elev[i]), r: 5.5, fill: "#2a6146", stroke: "#fff", "stroke-width": 2 }, svg);
  }
  const guia = el("line", { y1: M.t, y2: H - M.b, stroke: "var(--texto)", "stroke-width": 1, opacity: 0, "stroke-dasharray": "3 3" }, svg);
  const pt = el("circle", { r: 4.5, fill: "#c0392b", stroke: "#fff", "stroke-width": 2, opacity: 0 }, svg);
  const tip = tooltip(cont);
  const area = el("rect", { x: M.l, y: M.t, width: W - M.l - M.r, height: H - M.t - M.b, fill: "transparent", style: "cursor:pointer" }, svg);
  const indice = ev => {
    const r = svg.getBoundingClientRect(), fx = (ev.clientX - r.left) / r.width * W;
    const d = Math.max(0, Math.min(dmax, (fx - M.l) / (W - M.l - M.r) * dmax));
    let i = 0; while (i < n - 1 && p.dist[i] < d) i++;
    return i;
  };
  area.addEventListener("pointermove", ev => {
    const i = indice(ev), r = svg.getBoundingClientRect();
    guia.setAttribute("x1", X(p.dist[i])); guia.setAttribute("x2", X(p.dist[i])); guia.setAttribute("opacity", .5);
    pt.setAttribute("cx", X(p.dist[i])); pt.setAttribute("cy", Y(p.elev[i])); pt.setAttribute("opacity", 1);
    const agua = p.agua[i] - p.elev[i];
    tip.innerHTML = `${nf(p.dist[i])} m · ${nf(p.elev[i], 1)} m${agua > .05 ? ` · ${t("agua", "water")} ${nf(agua, 1)} m` : ""}${p.inestable[i] ? ` · ${t("inestable", "unstable")}` : ""}`;
    tip.style.left = `${X(p.dist[i]) / W * r.width}px`; tip.style.top = `${Y(p.elev[i]) / H * r.height}px`; tip.style.opacity = 1;
    S.perfilHover = p.dist[i] / dmax; pedirDibujo();
  });
  area.addEventListener("pointerleave", () => { guia.setAttribute("opacity", 0); pt.setAttribute("opacity", 0); tip.style.opacity = 0; S.perfilHover = null; pedirDibujo(); });
  area.addEventListener("click", ev => {
    const i = indice(ev);
    fijarPuntoPerfil(p.dist[i] / dmax, p.dist[i], !mini);
    programarGraficas();
  });
}

function graficaInundacion(m) {
  const cont = $("#g-inund"); cont.innerHTML = "";
  const h = m.curva.nivel, a = m.curva.area, n = h.length;
  const W = Math.max(300, cont.clientWidth || 480), H = W < 420 ? 240 : 230, M = { l: 60, r: 14, t: 30, b: 40 };
  const hmax = h[n - 1] || 1, amax = Math.min(100, Math.max(...a) * 1.12 || 1);
  const X = v => M.l + v / hmax * (W - M.l - M.r), Y = v => H - M.b - v / amax * (H - M.t - M.b);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": t("Curva de inundación", "Flood curve") }, cont);
  const gr = el("linearGradient", { id: "gAgua", x1: 0, y1: 0, x2: 0, y2: 1 }, el("defs", {}, svg));
  el("stop", { offset: "0", "stop-color": "var(--agua)", "stop-opacity": .35 }, gr); el("stop", { offset: "1", "stop-color": "var(--agua)", "stop-opacity": .03 }, gr);
  ejes(svg, W, H, M, X, Y, marcas(0, hmax, 6), marcas(0, amax, 4), t("Nivel del agua sobre los ríos (m)", "Water level above the rivers (m)"), t("Área inundada (%)", "Flooded area (%)"), v => nf(v), v => `${nf(v)}%`);
  let d = ""; h.forEach((v, i) => d += `${i ? "L" : "M"}${X(v).toFixed(1)},${Y(a[i]).toFixed(1)}`);
  el("path", { d: `${d}L${X(hmax)},${Y(0)}L${X(0)},${Y(0)}Z`, fill: "url(#gAgua)" }, svg);
  el("path", { d, fill: "none", stroke: "var(--agua)", "stroke-width": 2.5, "stroke-linejoin": "round" }, svg);
  // escenario original del análisis (referencia tenue)
  el("line", { x1: X(m.kpis.nivel), x2: X(m.kpis.nivel), y1: M.t, y2: H - M.b, stroke: "var(--texto-3)", "stroke-dasharray": "2 4", "stroke-width": 1 }, svg);
  // escenario que se ve en el mapa (se mueve)
  const marca = el("line", { y1: M.t, y2: H - M.b, stroke: "var(--riesgo)", "stroke-dasharray": "4 4", "stroke-width": 1.5 }, svg);
  const circ = el("circle", { r: 6, fill: "var(--riesgo)", stroke: "#fff", "stroke-width": 2 }, svg);
  const etq = el("text", { y: M.t - 10, "font-size": 12.5, "font-weight": 700, fill: "var(--riesgo)" }, svg);
  const marcar = nv => {
    const pct = pctInundado(m, nv), x = X(Math.min(nv, hmax)), der = x > W * .6;
    marca.setAttribute("x1", x); marca.setAttribute("x2", x);
    circ.setAttribute("cx", x); circ.setAttribute("cy", Y(pct));
    etq.setAttribute("x", x + (der ? -8 : 8)); etq.setAttribute("text-anchor", der ? "end" : "start");
    etq.textContent = `${t("En el mapa", "On the map")}: ${nf(nv, 1)} m → ${nf(pct, 1)}%`;
  };
  marcar(nivelActual(m));
  cont._marcar = marcar;
  const guia = el("line", { y1: M.t, y2: H - M.b, stroke: "var(--texto)", opacity: 0, "stroke-dasharray": "3 3" }, svg);
  const pt = el("circle", { r: 4.5, fill: "var(--agua)", stroke: "#fff", "stroke-width": 2, opacity: 0 }, svg);
  const tip = tooltip(cont);
  const area = el("rect", { x: M.l, y: M.t, width: W - M.l - M.r, height: H - M.t - M.b, fill: "transparent", style: "cursor:pointer;touch-action:pan-y" }, svg);
  const valor = ev => { const r = svg.getBoundingClientRect(), fx = (ev.clientX - r.left) / r.width * W; return Math.max(0, Math.min(hmax, (fx - M.l) / (W - M.l - M.r) * hmax)); };
  let arrastrando = false;
  area.addEventListener("pointerdown", ev => {
    arrastrando = true; area.setPointerCapture(ev.pointerId);
    if (S.capa !== "inundacion") elegirCapa("inundacion");
    ponerNivel(valor(ev));
  });
  area.addEventListener("pointermove", ev => {
    if (arrastrando) ponerNivel(valor(ev));
    const v = valor(ev), r = svg.getBoundingClientRect();
    let i = 0; while (i < n - 1 && h[i] < v) i++;
    guia.setAttribute("x1", X(h[i])); guia.setAttribute("x2", X(h[i])); guia.setAttribute("opacity", .5);
    pt.setAttribute("cx", X(h[i])); pt.setAttribute("cy", Y(a[i])); pt.setAttribute("opacity", 1);
    tip.textContent = t(`Si sube ${nf(h[i], 1)} m → ${nf(a[i], 1)}% inundado · toca para verlo en el mapa`, `If it rises ${nf(h[i], 1)} m → ${nf(a[i], 1)}% flooded · tap to see it on the map`);
    tip.style.left = `${X(h[i]) / W * r.width}px`; tip.style.top = `${Y(a[i]) / H * r.height}px`; tip.style.opacity = 1;
  });
  const terminar = () => {
    if (!arrastrando) return;
    arrastrando = false;
    if (!mapaVisible())
      aviso(t(`<b>Nivel del agua: ${nf(nivelActual(m), 1)} m</b><small>El mapa de inundación ya muestra este escenario.</small>`,
        `<b>Water level: ${nf(nivelActual(m), 1)} m</b><small>The flood map now shows this scenario.</small>`), { boton: t("Ver en el mapa", "Show on map"), accion: irAlMapa });
  };
  area.addEventListener("pointerup", terminar);
  area.addEventListener("pointercancel", () => { arrastrando = false; });
  area.addEventListener("pointerleave", () => { guia.setAttribute("opacity", 0); pt.setAttribute("opacity", 0); tip.style.opacity = 0; });
}

function pintarEstabilidad(m) {
  const sat = Math.round(lluviaActual(m) * 100);
  const fila = (titulo, pcts) => `<div class="barra-apilada"><div class="barra-apilada-et"><span>${titulo}</span><span>${nf(pcts[0], 1)}% ${t("inestable", "unstable")}</span></div>
      <div class="ba">${pcts.map((v, i) => `<div class="${i >= 2 ? "claro" : ""}" style="flex-grow:${Math.max(v, .0001)};${estiloFS(i)}" title="${FS[i].nombre}: ${nf(v, 1)}%">${v >= 7 ? `<span>${nf(v)}%</span>` : ""}</div>`).join("")}</div></div>`;
  $("#estabilidad").innerHTML = fila(t("Suelo seco", "Dry soil"), m.cuadro.map(c => c.seco))
    + fila(t(`Con lluvia · suelo ${sat}% mojado`, `With rain · soil ${sat}% wet`) + (S.lluvia == null ? "" : t(" (elegido)", " (chosen)")), cuadroLluvia(m))
    + `<div class="estab-ley">${FS.map((c, i) => `<span><i style="${estiloFS(i)}"></i><b>${c.nombre}</b> · ${c.rango}</span>`).join("")}</div>`;
}

function pintarCuencas(m) {
  $("#cuencas-sub").textContent = `${t("ríos", "rivers")}: ${fmtLen(m.kpis.long_rios)}`;
  const max = m.cuencas[0] ? m.cuencas[0].area : 1;
  $("#cuencas").innerHTML = m.cuencas.map((c, i) => `
    <div class="cuenca"><div class="cuenca-n" style="background:${CUENCAS[i]}">${c.n}</div>
      <div><div class="cuenca-nom">${t("Cuenca", "Watershed")} ${c.n}</div><div class="cuenca-barra"><div style="width:${c.area / max * 100}%;background:${CUENCAS[i]}"></div></div></div>
      <div class="cuenca-area">${fmtArea(c.area)}<small>${nf(c.area / m.kpis.area * 100, 1)}% ${t("del terreno", "of terrain")}</small></div></div>`).join("");
}

// ============================== CAMBIOS =====================================
function pintarSelectorComparar() {
  const sel = $("#comparar-con");
  const m = S.meta.get(S.actual);
  const otras = S.capturas.filter(c => c.id !== S.actual);
  sel.innerHTML = otras.length ? otras.map(c => `<option value="${c.id}" ${c.id === S.compararCon ? "selected" : ""}>#${c.id} · ${horaDe(c.hora)}${c.id === m.anterior ? t(" (anterior)", " (previous)") : ""}</option>`).join("")
    : `<option>${t("No hay otras capturas", "No other captures")}</option>`;
  sel.disabled = !otras.length;
}
$("#comparar-con").onchange = e => {
  S.compararCon = +e.target.value;
  pintarHistorial(); pintarTabs(); pintarLeyenda();
  cargarComparacion();
};
async function cargarComparacion() {
  const id = S.actual, b = S.compararCon, tok = S.token;
  if (!b) { pintarCambios(null); pintarKpis(S.meta.get(id)); return; }
  const k = `${b}-${id}`;
  $("#cambios").innerHTML = `<div class="vacio-mini"><span class="giro"></span>${t("Comparando con la captura", "Comparing with capture")} #${b}…</div>`;
  try {
    if (!S.comp.has(k)) S.comp.set(k, await getJSON(`/api/comparar/${b}/${id}`));
    const c = S.comp.get(k);
    if (!c.error && !S.compCapa.has(k)) {
      const buf = await (await fetch(`/api/comparar/${b}/${id}/capa`)).arrayBuffer();
      S.compCapa.set(k, new Float32Array(buf));
    }
  } catch { if (tok === S.token) $("#cambios").innerHTML = `<div class="vacio-mini">${t("No se pudo hacer la comparación.", "Couldn’t compare the captures.")}</div>`; return; }
  if (tok !== S.token || b !== S.compararCon) return;
  const m = S.meta.get(id);
  pintarCambios(S.comp.get(k)); pintarKpis(m); pintarTabs(); pintarAlertas(); pintarLeyenda(); actualizarInspector();
  if (S.capa === "cambios") pedirDibujo();
}
function pintarCambios(c) {
  const cont = $("#cambios");
  const icoInfo = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>`;
  if (!c) { cont.innerHTML = `<div class="vacio-mini">${icoInfo}<div>${t("<b>Aún no hay con qué comparar.</b><br>Mueve la arena y guarda otra captura en el SARndbox: aquí verás qué cambió y si hubo deslaves.", "<b>Nothing to compare yet.</b><br>Move the sand and save another capture in the SARndbox: you’ll see here what changed and whether there were landslides.")}</div></div>`; return; }
  if (c.error) { cont.innerHTML = `<div class="vacio-mini">${icoInfo}<div>${t(esc(c.error), "The captures have different sizes or don’t exist.")}</div></div>`; return; }
  const stats = `<div class="cambios-stats">
    <div class="mini-stat"><b style="color:var(--riesgo)">${fmtVol(c.vol_erosion)}</b><span>${t("Material perdido", "Material lost")}</span></div>
    <div class="mini-stat"><b style="color:var(--agua)">${fmtVol(c.vol_deposito)}</b><span>${t("Material acumulado", "Material piled up")}</span></div>
    <div class="mini-stat"><b>${fmtArea(c.area_cambio)}</b><span>${t("Área modificada", "Area changed")}</span></div></div>`;
  let cuerpo;
  if (!c.eventos.length) {
    cuerpo = `<div class="vacio-mini">${icoInfo}<div>${c.area_cambio > 0
      ? t("Hubo cambios en el terreno, pero ninguno con el patrón de un deslave (material que se pierde arriba y se acumula justo abajo).", "The terrain changed, but nothing with the pattern of a landslide (material lost uphill and piled up just below).")
      : t(`Sin cambios desde la captura #${c.a}.`, `No changes since capture #${c.a}.`)}</div></div>`;
  } else {
    cuerpo = `<div class="eventos">${c.eventos.map((ev, i) => `
      <div class="evento"><div class="evento-cab"><b>${t("Deslave", "Landslide")} ${i + 1}</b>
        <span class="chip ${ev.en_riesgo > .3 ? "rojo" : ""}">${ev.en_riesgo > .3 ? t("Zona ya marcada en riesgo", "Area already marked at risk") : t("Fuera de la zona marcada", "Outside the marked area")}</span></div>
        <dl><dt>${t("Volumen desplazado", "Volume moved")}</dt><dd>${fmtVol(ev.vol_perdido)}</dd>
          <dt>${t("Recorrido", "Distance traveled")}</dt><dd>${fmtLen(ev.desplazamiento)}</dd>
          <dt>${t("Desnivel", "Drop")}</dt><dd>${nf(ev.caida)} m</dd>
          <dt>${t("Pendiente de origen", "Starting slope")}</dt><dd>${nf(ev.pend_origen)}°</dd></dl>
        <button class="btn btn-sec btn-ch" data-ev="${i}">${t("Ver en el mapa", "Show on map")}</button></div>`).join("")}</div>`;
  }
  cont.innerHTML = stats + cuerpo;
  cont.querySelectorAll("[data-ev]").forEach(b => b.onclick = () => verEvento(c.eventos[+b.dataset.ev]));
}
async function verEvento(ev) {
  await elegirCapa("cambios");
  irAlMapa();
  const { w, h } = tamLienzo();
  const cx = (ev.centro[1] + ev.destino[1]) / 2 + .5, cy = (ev.centro[0] + ev.destino[0]) / 2 + .5;
  S.vista.escala = S.vista.base * 4;
  S.vista.ox = w / 2 - cx * S.vista.escala; S.vista.oy = h / 2 - cy * S.vista.escala;
  pedirDibujo();
}

function pintarPie(m) {
  const p = m.parametros;
  $("#pie").innerHTML = t(
    `Escala: 1 cm de arena = ${nf(p.metros_por_cm, 1)} m · exageración vertical ${nf(p.escala_vertical, 1)} · suelo: cohesión ${nf(p.cohesion_kpa, 1)} kPa, fricción ${nf(p.friccion_grados)}°, peso ${nf(p.peso_suelo_kn_m3)} kN/m³, espesor ${nf(p.espesor_suelo_m, 1)} m.<br>
    Modelo educativo: los resultados dependen de la escala y del tipo de suelo (se cambian en Configuración, el botón del engrane). Los datos descargados se abren en QGIS o ArcGIS.`,
    `Scale: 1 cm of sand = ${nf(p.metros_por_cm, 1)} m · vertical exaggeration ${nf(p.escala_vertical, 1)} · soil: cohesion ${nf(p.cohesion_kpa, 1)} kPa, friction ${nf(p.friccion_grados)}°, unit weight ${nf(p.peso_suelo_kn_m3)} kN/m³, thickness ${nf(p.espesor_suelo_m, 1)} m.<br>
    Educational model: results depend on the scale and soil type (change them in Settings, the gear button). Downloaded data opens in QGIS or ArcGIS.`);
}

// ============================== AVISOS Y MODAL ==============================
function aviso(html, { boton, accion, tipo, ms = 7000 } = {}) {
  const d = document.createElement("div");
  d.className = "aviso" + (tipo ? ` ${tipo}` : "");
  d.innerHTML = `<div>${html}</div>${boton ? `<button>${boton}</button>` : ""}`;
  if (boton) d.querySelector("button").onclick = () => { accion(); quitar(); };
  const quitar = () => { d.classList.add("saliendo"); setTimeout(() => d.remove(), 260); };
  $("#avisos").appendChild(d);
  setTimeout(quitar, ms);
}
function abrirModal() {
  const urls = S.urls.length ? S.urls : [S.local];
  $("#qr").src = `/api/qr.svg?t=${Date.now()}`;
  $("#url-principal").textContent = urls[0];
  $("#url-otras").innerHTML = urls.length > 1 ? `${t("También", "Also")}: ${urls.slice(1).map(u => `<code>${esc(u)}</code>`).join(", ")}` : "";
  $("#modal").hidden = false;
  $("#copiar").focus();
}
const cerrarModal = () => { $("#modal").hidden = true; };

// ============================== CONFIGURACIÓN ===============================
// Idioma (solo este dispositivo), escala y tipo de suelo (para todos: los guarda el servidor).
const TIPOS_SUELO = [
  { id: "tipico", es: "Suelo típico", en: "Typical soil", v: { cohesion_kpa: 5, friccion_grados: 32, peso_suelo_kn_m3: 19 } },
  { id: "arena", es: "Arena suelta", en: "Loose sand", v: { cohesion_kpa: 0, friccion_grados: 30, peso_suelo_kn_m3: 17 } },
  { id: "compacta", es: "Arena compacta", en: "Dense sand", v: { cohesion_kpa: 0, friccion_grados: 38, peso_suelo_kn_m3: 20 } },
  { id: "arcilla", es: "Arcilla", en: "Clay", v: { cohesion_kpa: 20, friccion_grados: 20, peso_suelo_kn_m3: 18 } },
  { id: "roca", es: "Roca alterada", en: "Weathered rock", v: { cohesion_kpa: 50, friccion_grados: 38, peso_suelo_kn_m3: 22 } },
];
const CAMPOS = ["metros_por_cm", "escala_vertical", "cohesion_kpa", "friccion_grados", "peso_suelo_kn_m3", "espesor_suelo_m"];
let AJ = null;  // lo que respondió el servidor: valores, base, límites, puede_editar
const campo = k => $(`#aj-${k}`);
const puedeEditar = () => !!(AJ && AJ.puede_editar);
const numTxt = v => String(+(+v).toFixed(4));
function leerFormulario() {
  const v = {};
  for (const k of CAMPOS) v[k] = campo(k).value.trim() === "" ? NaN : +campo(k).value;
  return v;
}
function etiquetaCampo(k) { const l = $(`label[for="aj-${k}"]`); return (l.querySelector("span") || l).textContent.trim(); }
function revisarFormulario() {
  if (!AJ) return null;
  const v = leerFormulario(); let error = null;
  for (const k of CAMPOS) {
    const [lo, hi] = AJ.limites[k], ok = isFinite(v[k]) && v[k] >= lo && v[k] <= hi;
    campo(k).setAttribute("aria-invalid", String(!ok));
    if (!ok && !error) error = t(`“${etiquetaCampo(k)}” debe ser un número entre ${nf(lo, lo % 1 ? 1 : 0)} y ${nf(hi)}.`,
                                 `“${etiquetaCampo(k)}” must be a number between ${nf(lo, lo % 1 ? 1 : 0)} and ${nf(hi)}.`);
  }
  pintarTipos(); ejemploEscala();
  return error;
}
function mostrarErrorAjustes(txt) { const e = $("#aj-error"); e.textContent = txt || ""; e.hidden = !txt; }
function pintarTipos() {
  const v = leerFormulario();
  $("#aj-tipos").innerHTML = TIPOS_SUELO.map(ts => {
    const activo = Object.entries(ts.v).every(([k, x]) => Math.abs(v[k] - x) < 1e-6);
    return `<button type="button" class="aj-tipo" data-tipo="${ts.id}" aria-pressed="${activo}" ${puedeEditar() ? "" : "disabled"}>${t(ts.es, ts.en)}</button>`;
  }).join("");
  $("#aj-tipos").querySelectorAll("[data-tipo]").forEach(b => b.onclick = () => {
    const ts = TIPOS_SUELO.find(x => x.id === b.dataset.tipo);
    for (const [k, x] of Object.entries(ts.v)) campo(k).value = x;
    if (!revisarFormulario()) mostrarErrorAjustes("");
  });
}
// Ejemplo en palabras de lo que significa la escala elegida
function ejemploEscala() {
  const v = leerFormulario(), m = S.meta.get(S.actual), el = $("#aj-ejemplo-escala");
  if (!(v.metros_por_cm > 0)) { el.textContent = ""; return; }
  const alto = 10 * v.metros_por_cm * (v.escala_vertical > 0 ? v.escala_vertical : 1);
  let txt = t(`Un montón de 10 cm de arena sería un cerro de ${fmtLen(alto)}.`, `A 10 cm pile of sand would be a ${fmtLen(alto)} hill.`);
  if (m) {
    const f = v.metros_por_cm / m.parametros.metros_por_cm;
    txt += " " + t(`Todo el sandbox mediría ${fmtLen(m.cols * m.celda * f)} × ${fmtLen(m.filas * m.celda * f)}.`,
                   `The whole sandbox would be ${fmtLen(m.cols * m.celda * f)} × ${fmtLen(m.filas * m.celda * f)}.`);
  }
  el.textContent = txt;
}
function llenarFormulario(valores) {
  for (const k of CAMPOS) campo(k).value = valores ? numTxt(valores[k]) : "";
  revisarFormulario();
}
async function abrirAjustes() {
  const md = $("#modal-ajustes");
  md.hidden = false;
  document.querySelector(`input[name="idioma"][value="${IDIOMA}"]`).checked = true;
  mostrarErrorAjustes("");
  try { AJ = await getJSON("/api/ajustes"); } catch { AJ = null; }
  const ok = puedeEditar();
  for (const k of CAMPOS) {
    campo(k).disabled = !ok;
    if (AJ) { campo(k).min = AJ.limites[k][0]; campo(k).max = AJ.limites[k][1]; }
  }
  llenarFormulario(AJ && AJ.valores);
  $("#aj-bloqueado").hidden = !AJ || ok;
  $("#aj-restablecer").hidden = !ok;
  if (!AJ) mostrarErrorAjustes(t("No se pudo leer la configuración del servidor. Solo puedes cambiar el idioma.", "Couldn’t read the settings from the server. You can only change the language."));
  document.querySelector(`input[name="idioma"]:checked`).focus();
}
$("#btn-ajustes").onclick = abrirAjustes;
CAMPOS.forEach(k => campo(k).addEventListener("input", () => { if (!revisarFormulario()) mostrarErrorAjustes(""); }));
$("#aj-restablecer").onclick = () => { if (AJ) { llenarFormulario(AJ.base); mostrarErrorAjustes(""); } };
$("#form-ajustes").onsubmit = async e => {
  e.preventDefault();
  const idioma = document.querySelector(`input[name="idioma"]:checked`).value;
  let cambio = false;
  if (puedeEditar()) {
    const error = revisarFormulario();
    if (error) { mostrarErrorAjustes(error); return; }
    const v = leerFormulario();
    cambio = CAMPOS.some(k => Math.abs(v[k] - AJ.valores[k]) > 1e-9);
    if (cambio) {
      const b = $("#aj-guardar"); b.disabled = true; b.textContent = t("Guardando…", "Saving…");
      try {
        const r = await fetch("/api/ajustes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ valores: v }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error === "solo_local" ? t("Solo se puede cambiar desde la computadora del sandbox.", "It can only be changed from the sandbox computer.") : (d.error || r.status));
      } catch (err) {
        mostrarErrorAjustes(t(`No se pudo guardar: ${err.message}`, `Couldn’t save: ${err.message}`));
        return;
      } finally { b.disabled = false; b.textContent = t("Guardar", "Save"); }
    }
  }
  if (idioma !== IDIOMA) {
    try { localStorage.setItem("idioma", idioma); } catch { }
    location.reload();
    return;
  }
  $("#modal-ajustes").hidden = true;
};
// Cuando alguien cambia la escala o el suelo, todo se vuelve a calcular
function ajustesCambiados() {
  S.meta.clear(); S.capas.clear(); S.imagenes.clear(); S.comp.clear(); S.compCapa.clear();
  cachePct.clear(); cacheFS = { clave: "", arr: null };
  S.nivel = null; S.lluvia = null; S.perfilFijo = null;  // estaban en metros de la escala anterior
  aviso(t("<b>Cambió la configuración</b><small>Volviendo a analizar las capturas con la nueva escala y suelo…</small>",
          "<b>Settings changed</b><small>Re-analyzing the captures with the new scale and soil…</small>"));
  refrescarLista().then(() => { if (S.actual && S.capturas.some(c => c.id === S.actual)) seleccionar(S.actual); }).catch(() => {});
}

$("#btn-conectar").onclick = abrirModal;
document.querySelectorAll(".modal").forEach(md => md.addEventListener("click", e => { if (e.target.closest("[data-cerrar]")) md.hidden = true; }));
const modalAbierto = () => [...document.querySelectorAll(".modal")].find(md => !md.hidden);
$("#copiar").onclick = async () => {
  const t = $("#url-principal").textContent;
  try { await navigator.clipboard.writeText(t); }
  catch {
    const r = document.createRange(); r.selectNodeContents($("#url-principal"));
    const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.execCommand("copy");
  }
  $("#copiar").textContent = t("¡Copiado!", "Copied!"); setTimeout(() => $("#copiar").textContent = t("Copiar", "Copy"), 1600);
};
document.addEventListener("keydown", e => {
  if (e.key === "Escape") { const md = modalAbierto(); if (md) md.hidden = true; }
  if (e.target.matches("input, select, textarea") || modalAbierto()) return;
  const i = S.capturas.findIndex(c => c.id === S.actual);
  if (e.key === "ArrowLeft" && S.capturas[i + 1]) { ponerSeguir(false); seleccionar(S.capturas[i + 1].id); }
  if (e.key === "ArrowRight" && i > 0) { seleccionar(S.capturas[i - 1].id); }
});
$("#seguir").onchange = e => { S.seguir = e.target.checked; if (S.seguir && S.capturas[0] && S.capturas[0].id !== S.actual) seleccionar(S.capturas[0].id); };

// ============================== EN VIVO =====================================
function conectarEventos() {
  const es = new EventSource("/api/eventos");
  es.addEventListener("hola", async () => {
    const reconexion = !S.conectado && S.capturas.length;
    S.conectado = true;
    const antes = S.capturas[0] && S.capturas[0].id;
    await refrescarLista();
    if (reconexion && S.seguir && S.capturas[0] && S.capturas[0].id !== antes) seleccionar(S.capturas[0].id);
  });
  es.addEventListener("analizando", () => { ponerEstado("analizando", t("Analizando captura…", "Analyzing capture…")); esqueletoHistorial(); });
  es.addEventListener("actualizado", () => refrescarLista());
  es.addEventListener("ajustes", ajustesCambiados);
  es.addEventListener("fallo", e => { estadoNormal(); aviso(`<b>${t("Atención", "Heads up")}</b>${t(esc(JSON.parse(e.data).mensaje), "Couldn’t read the latest SARndbox capture.")}`, { tipo: "rojo" }); refrescarLista(); });
  es.addEventListener("nueva_captura", async e => {
    const { id } = JSON.parse(e.data);
    await refrescarLista();
    pintarHistorial(id);
    const c = S.capturas.find(x => x.id === id);
    const des = c && c.resumen && c.resumen.deslaves;
    const texto = `<b>${t("Nueva captura", "New capture")} #${id}</b><small>${des ? `${des} ${t(pl(des, "deslave detectado", "deslaves detectados"), pl(des, "landslide detected", "landslides detected"))}` : t("Análisis listo", "Analysis ready")}</small>`;
    if (S.seguir || S.actual == null) { seleccionar(id); aviso(texto, { tipo: des ? "rojo" : "" }); }
    else aviso(texto, { boton: t("Ver", "View"), accion: () => { ponerSeguir(true); seleccionar(id); }, tipo: des ? "rojo" : "" });
  });
  es.onerror = () => { S.conectado = false; estadoNormal(); };
}

setInterval(() => {
  document.querySelectorAll("[data-rel]").forEach(e => e.textContent = relativo(e.dataset.rel));
  const m = S.meta.get(S.actual); if (m) $("#cab-meta").textContent = `${fechaLarga(m.hora)} · ${relativo(m.hora)} · ${fuenteTxt(m.fuente)}`;
}, 30000);

// ============================== INICIO ======================================
(async function iniciar() {
  try { await refrescarLista(); } catch { ponerEstado("caido", t("Sin conexión", "Offline")); }
  conectarEventos();
  const pedida = +new URLSearchParams(location.search).get("captura");
  if (pedida && S.capturas.some(c => c.id === pedida)) { if (pedida !== S.capturas[0].id) ponerSeguir(false); seleccionar(pedida); }
  else if (S.capturas.length) seleccionar(S.capturas[0].id);
})();
