"use strict";

/* ------------------------------------------------------------------
 * Multi-vessel tracker for ANDROMEDA & co.
 * Vessel data served by local proxy server.js (/api/vessel?imo=)
 * ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);

const VERSION = "1.0.1";

const state = {
  vessels: [], // [{ imo, ...vessel }]
  selectedImo: null,
  fleetMap: null,
  fleetLayers: [],
  weatherToken: 0,
  sortKey: null,
  sortDir: 1,
  ghostOn: localStorage.getItem("tracker_ghost") === "1",
  settings: loadSettings(),
  proxAlerted: {},
};

/* ---------------- theme switcher ---------------- */

const THEMES = ["midnight", "daylight", "emerald", "sunset"];
const THEME_KEY = "tracker_theme";

function applyTheme(id) {
  if (!THEMES.includes(id)) id = "midnight";
  document.documentElement.setAttribute("data-theme", id);
  localStorage.setItem(THEME_KEY, id);
  const sel = $("theme-select");
  if (sel) sel.value = id;
}
{
  const sel = $("theme-select");
  if (sel) {
    sel.addEventListener("change", () => applyTheme(sel.value));
    applyTheme(localStorage.getItem(THEME_KEY));
  }
}

/* ---------------- persistence ---------------- */

const K_IMOS = "tracker_imos";
const K_SELECTED = "tracker_selected";
const dataKey = (imo) => "tracker_data_" + imo;

function loadIMOs() {
  try {
    const arr = JSON.parse(localStorage.getItem(K_IMOS));
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}
function saveIMOs() {
  localStorage.setItem(K_IMOS, JSON.stringify(state.vessels.map((v) => v.imo)));
}
function loadData(imo) {
  try {
    return JSON.parse(localStorage.getItem(dataKey(imo)));
  } catch (_) {
    return null;
  }
}
function saveData(v) {
  localStorage.setItem(dataKey(v.imo), JSON.stringify(v));
}
function loadSelected() {
  return localStorage.getItem(K_SELECTED);
}

/* ---------------- small helpers ---------------- */

function fillText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}
function fillHtml(id, html) {
  const el = $(id);
  if (el) el.innerHTML = html;
}
function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function flagEmoji(code) {
  if (!code || code.length !== 2) return "🏴";
  return code
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}
function fmtNum(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function relativeTime(d) {
  if (!d) return "—";
  const diff = Math.max(0, Date.now() - d.getTime());
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t("just now");
  if (mins < 60) return mins + " " + t("min ago");
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + " " + t("h ago");
  const days = Math.floor(hrs / 24);
  return days + " " + t("d ago");
}
function lastSeenDate(v) {
  if (!v || !v.lastSeen) return null;
  const d = new Date(v.lastSeen);
  return isNaN(d) ? null : d;
}
function compass(deg) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}
function spec(v, label) {
  const p = (v && v.particulars) || {};
  const raw = p[label];
  return raw && raw !== "-" && raw !== "" ? raw : null;
}
function fmtLatLon(v) {
  const p = (v && v.position) || {};
  if (p.lat == null || p.lon == null) return "—";
  const lat = p.lat.toFixed(1) + "°" + (p.lat >= 0 ? "N" : "S");
  const lon = p.lon.toFixed(1) + "°" + (p.lon >= 0 ? "E" : "W");
  return lat + "  " + lon;
}

/* ---------------- fleet-wide helpers ---------------- */

function statusCategory(s) {
  s = String(s || "").toLowerCase();
  if (/under way|sailing|navigat|making way|engine/.test(s)) return "underway";
  if (/anchor|moored|alongside|berthed/.test(s)) return "rest";
  return "other";
}

const DOT_CLASS = { underway: "green", rest: "amber", other: "blue" };
const DOT_COLOR = { underway: "#19d3a5", rest: "#f0b429", other: "#2fa8ff" };

/* ---------------- navigation & time utilities ---------------- */

const R_NM = 3440.065;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

function haversine(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.sqrt(a));
}

function initialBearing(lat1, lon1, lat2, lon2) {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function destinationPoint(lat, lon, bearingDeg, distNm) {
  const d = distNm / R_NM;
  const t = toRad(bearingDeg);
  const p1 = toRad(lat);
  const l1 = toRad(lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [toDeg(p2), ((toDeg(l2) + 540) % 360) - 180];
}

function deadReckon(v, hours) {
  const p = v.position;
  if (!p || p.lat == null || p.lon == null || p.sog == null || p.sog < 1) return null;
  return destinationPoint(p.lat, p.lon, p.cog != null ? p.cog : 0, p.sog * hours);
}

function sunTimes(lat, lon, date = new Date()) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = Math.round(jd - 2451545.0 + 0.0008);
  const jStar = 2451545.0 + 0.0009 + n;
  const M = (357.5291 + 0.98560028 * (jStar - 2451545.0)) % 360;
  const C = 1.9148 * Math.sin(toRad(M)) + 0.02 * Math.sin(toRad(2 * M)) + 0.0003 * Math.sin(toRad(3 * M));
  const L = (M + C + 180 + 102.9372) % 360;
  const jT = jStar + 0.0053 * Math.sin(toRad(M)) - 0.0069 * Math.sin(toRad(2 * L));
  const sinD = Math.sin(toRad(L)) * Math.sin(toRad(23.4397));
  const cosD = Math.sqrt(1 - sinD * sinD);
  const cosH = (Math.sin(toRad(-0.83)) - Math.sin(toRad(lat)) * sinD) / (Math.cos(toRad(lat)) * cosD);
  if (Math.abs(cosH) > 1) return null; // polar day/night
  const H = toDeg(Math.acos(cosH));
  const toDate = (j) => new Date((j - 2440587.5) * 86400000);
  return { sunrise: toDate(jT - H / 360), sunset: toDate(jT + H / 360) };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseMdhms(str) {
  if (!str) return null;
  const m = String(str).match(/([A-Za-z]{3,4})\s+(\d{1,2}),?\s*(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const mn = MONTHS.indexOf(m[1].slice(0, 3));
  if (mn < 0) return null;
  let y = new Date().getUTCFullYear();
  let d = new Date(Date.UTC(y, mn, +m[2], +m[3], +m[4]));
  if (d.getTime() > Date.now() + 180 * 86400000) d = new Date(Date.UTC(y - 1, mn, +m[2], +m[3], +m[4]));
  if (d.getTime() < Date.now() - 180 * 86400000) d = new Date(Date.UTC(y + 1, mn, +m[2], +m[3], +m[4]));
  return d;
}

function fmtDur(ms) {
  if (ms == null) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + " s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + " min";
  const h = Math.floor(m / 60);
  if (h < 24) return h + " h";
  const d = Math.floor(h / 24);
  return d + " d" + (h % 24 ? " " + (h % 24) + " h" : "");
}
function fmtHm(d) {
  const p = (n) => String(n).padStart(2, "0");
  return p(d.getUTCHours()) + ":" + p(d.getUTCMinutes());
}
function fmtClock(d) {
  const p = (n) => String(n).padStart(2, "0");
  return p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
}
function fmtLatLonPair(lat, lon) {
  return (
    Math.abs(lat).toFixed(1) + "°" + (lat >= 0 ? "N" : "S") + "  " +
    Math.abs(lon).toFixed(1) + "°" + (lon >= 0 ? "E" : "W")
  );
}
function localOf(v, utcDate) {
  const off = v.position && v.position.lon != null ? v.position.lon / 15 : 0;
  return new Date(utcDate.getTime() + off * 3600000);
}

/* ---------------- activity log (localStorage) ---------------- */

const K_EVENTS = "tracker_events";
const MAX_EVENTS = 60;

function loadEvents() {
  try {
    const a = JSON.parse(localStorage.getItem(K_EVENTS));
    return Array.isArray(a) ? a : [];
  } catch (_) {
    return [];
  }
}
function saveEvents(a) {
  localStorage.setItem(K_EVENTS, JSON.stringify(a.slice(0, MAX_EVENTS)));
}
function logEvent(imo, name, text) {
  const evs = loadEvents();
  evs.unshift({ t: Date.now(), imo, name, text });
  saveEvents(evs);
  renderTimeline();
}
function logChanges(prev, v) {
  if (!prev) return;
  if (prev.navStatus !== v.navStatus && v.navStatus) {
    logEvent(v.imo, v.name, t("Nav status:") + " " + trStatus(prev.navStatus) + " → " + trStatus(v.navStatus));
  }
  const ps = prev.position && prev.position.sog;
  const ns = v.position && v.position.sog;
  if (ns != null && ps != null && Math.abs(ns - ps) >= 1) {
    logEvent(v.imo, v.name, t("Speed:") + " " + ps.toFixed(1) + " → " + ns.toFixed(1) + " kn");
  }
  if (prev.destination !== v.destination && v.destination) {
    logEvent(v.imo, v.name, t("Destination:") + " " + (prev.destination || "—") + " → " + v.destination);
  }
}
function renderTimeline() {
  const el = $("timeline");
  const evs = loadEvents();
  if (!evs.length) {
    el.innerHTML =
      '<p class="tl-empty">' + t("No activity recorded yet — events appear as vessels update (status, speed or destination changes).") + "</p>";
    return;
  }
  el.innerHTML = evs
    .slice(0, 40)
    .map((e) => {
      const name =
        '<span class="tl-name" data-imo="' + e.imo + '">' + escapeHtml(e.name) + "</span>";
      return (
        '<div class="tl-item"><span class="tl-time">' + relativeTime(new Date(e.t)) +
        '</span><span class="tl-body">' + name + " — " + escapeHtml(e.text) + "</span></div>"
      );
    })
    .join("");
}
$("timeline").addEventListener("click", (e) => {
  const name = e.target.closest(".tl-name");
  if (name) selectVessel(name.getAttribute("data-imo"));
});
$("timeline-clear").addEventListener("click", () => {
  saveEvents([]);
  renderTimeline();
});

/* ---------------- fleet stats bar ---------------- */

function renderStats() {
  const vs = state.vessels;
  const bar = $("stats-bar");
  if (!vs.length) {
    bar.innerHTML = "";
    return;
  }
  const total = vs.length;
  const u = vs.filter((v) => statusCategory(v.navStatus) === "underway").length;
  const r = vs.filter((v) => statusCategory(v.navStatus) === "rest").length;
  const moving = vs.filter((v) => v.position && v.position.sog != null);
  const avg = moving.length ? (moving.reduce((s, v) => s + v.position.sog, 0) / moving.length).toFixed(1) : "—";
  const chips = [
    { label: t("Tracked"), value: total, dot: "blue" },
    { label: t("Under way"), value: u, dot: "green" },
    { label: t("At anchor"), value: r, dot: "amber" },
    { label: t("Avg SOG"), value: avg, dot: "blue" },
  ];
  bar.innerHTML = chips
    .map(
      (c) =>
        '<div class="stat-chip"><span class="dot ' + c.dot + '"></span>' +
        "<b>" + c.value + "</b><span class=\"chip-label\">" + c.label + "</span></div>"
    )
    .join("");
}

/* ---------------- fleet board table ---------------- */

const SORT_KEYS = {
  name: (v) => (v.name || "").toLowerCase(),
  type: (v) => (v.type || "").toLowerCase(),
  status: (v) => statusCategory(v.navStatus),
  sog: (v) => (v.position && v.position.sog != null ? v.position.sog : -999),
  cog: (v) => (v.position && v.position.cog != null ? v.position.cog : -999),
  destination: (v) => (v.destination || "").toLowerCase(),
  eta: (v) => v.eta || "",
  lastSeen: (v) => (v.lastSeen ? new Date(v.lastSeen).getTime() : 0),
};

function renderBoard() {
  const tbody = $("board-body");
  if (!tbody) return;
  const key = state.sortKey || "name";
  const dir = state.sortDir || 1;
  const list = state.vessels.slice().sort((a, b) => {
    const x = SORT_KEYS[key](a);
    const y = SORT_KEYS[key](b);
    if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
    return String(x).localeCompare(String(y)) * dir;
  });

  document.querySelectorAll(".board th").forEach((th) => {
    const arrow = th.querySelector(".arrow");
    if (arrow) arrow.remove();
    if (th.dataset.sort === key) {
      th.insertAdjacentHTML("beforeend", '<span class="arrow">' + (dir === 1 ? "▲" : "▼") + "</span>");
    }
  });

  tbody.innerHTML = list
    .map((v) => {
      const active = v.imo === state.selectedImo ? " active" : "";
      const cat = statusCategory(v.navStatus);
      const sog = v.position && v.position.sog != null ? v.position.sog.toFixed(1) : "—";
      const cog = v.position && v.position.cog != null ? Math.round(v.position.cog) : "—";
      return (
        '<tr class="' + active + '" data-imo="' + v.imo + '">' +
        '<td><div class="vcell"><img class="thumb" src="' + (v.photo || photoFallback()) + '" alt="">' +
        '<div><span class="vname">' + escapeHtml(v.name) + '</span><span class="vimo">IMO ' + v.imo + "</span></div></div></td>" +
        "<td>" + escapeHtml(v.type || t("Vessel")) + "</td>" +
        '<td><span class="status-cell"><span class="dot ' + DOT_CLASS[cat] + '"></span>' + escapeHtml(trStatus(v.navStatus)) + "</span></td>" +
        '<td class="tnum">' + sog + "</td>" +
        '<td class="tnum">' + cog + "°</td>" +
        "<td>" + escapeHtml(v.destination || "—") + "</td>" +
        "<td>" + escapeHtml(v.eta || "—") + "</td>" +
        "<td>" + relativeTime(lastSeenDate(v)) + "</td>" +
        "</tr>"
      );
    })
    .join("");

  fillText("board-count", nVessels(list.length));
}
$("board-body").addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-imo]");
  if (tr) selectVessel(tr.getAttribute("data-imo"));
});
document.querySelectorAll(".board th[data-sort]").forEach((th) => {
  th.addEventListener("click", () => {
    const k = th.dataset.sort;
    if (state.sortKey === k) state.sortDir *= -1;
    else {
      state.sortKey = k;
      state.sortDir = 1;
    }
    renderBoard();
  });
});

/* ---------------- geocoder (Nominatim, cached) ---------------- */

const geoCache = new Map();
async function geocode(text) {
  if (!text) return null;
  const key = String(text).toLowerCase().replace(/[>=]/g, "").trim();
  if (geoCache.has(key)) return geoCache.get(key);
  try {
    const c = JSON.parse(localStorage.getItem("tracker_geo_" + key));
    if (c && c.lat != null) {
      geoCache.set(key, c);
      return c;
    }
  } catch (_) {}
  try {
    const res = await fetch(
      "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
        encodeURIComponent(key),
      { headers: { "Accept-Language": "en" } }
    );
    if (!res.ok) throw new Error("geocode failed");
    const arr = await res.json();
    const c = arr && arr[0] ? { lat: +arr[0].lat, lon: +arr[0].lon } : null;
    geoCache.set(key, c);
    try {
      localStorage.setItem("tracker_geo_" + key, JSON.stringify(c));
    } catch (_) {}
    return c;
  } catch (_) {
    return null;
  }
}

/* ---------------- behavioral insights ---------------- */

const statsKey = (imo) => "tracker_stats_" + imo;

function loadStats(imo) {
  try {
    return JSON.parse(localStorage.getItem(statsKey(imo))) || null;
  } catch (_) {
    return null;
  }
}
function saveStats(s) {
  try {
    localStorage.setItem(statsKey(s.imo), JSON.stringify(s));
  } catch (_) {}
}

const GAP_MS = 45 * 60000;
const histKey = (imo) => "tracker_hist_" + imo;
const HIST_MAX = 300;

function loadHist(imo) {
  try {
    const a = JSON.parse(localStorage.getItem(histKey(imo)));
    return Array.isArray(a) ? a : [];
  } catch (_) {
    return [];
  }
}
function saveHist(imo, arr) {
  try {
    localStorage.setItem(histKey(imo), JSON.stringify(arr.slice(-HIST_MAX)));
  } catch (_) {}
}
function recordSample(v, now) {
  const p = v.position;
  if (!p || p.lat == null || p.lon == null) return;
  const h = loadHist(v.imo);
  const last = h[h.length - 1];
  if (!last || last.lat !== p.lat || last.lon !== p.lon || last.sog !== p.sog || last.cog !== p.cog) {
    h.push({ t: now, lat: p.lat, lon: p.lon, sog: p.sog, cog: p.cog });
    saveHist(v.imo, h);
  }
}

function updateStats(v) {
  if (!v || !v.position) return;
  const now = Date.now();
  const st = loadStats(v.imo) || {
    imo: v.imo, firstSeen: now, lastSeen: now,
    observedMs: 0, anchoredMs: 0, underwayMs: 0, otherMs: 0,
    distanceNm: 0, sogSum: 0, sogN: 0, maxSog: 0,
    prevStatus: null, prevPos: null, prevAt: null,
    anchorRunStart: null, longestAnchorMs: 0,
    arrivals: 0, departures: 0,
  };
  const cat = statusCategory(v.navStatus);
  if (st.prevStatus && st.prevAt != null && now - st.prevAt < GAP_MS) {
    const dt = Math.max(0, now - st.prevAt);
    st.observedMs += dt;
    if (st.prevStatus === "underway") st.underwayMs += dt;
    else if (st.prevStatus === "rest") st.anchoredMs += dt;
    else st.otherMs += dt;
  }
  const p = v.position;
  if (p.lat != null && p.lon != null && st.prevPos) {
    st.distanceNm += haversine(st.prevPos.lat, st.prevPos.lon, p.lat, p.lon);
  }
  recordSample(v, now);
  if (p.sog != null) {
    st.sogSum += p.sog;
    st.sogN++;
    st.maxSog = Math.max(st.maxSog, p.sog);
  }
  if (cat === "rest") {
    if (!st.anchorRunStart) st.anchorRunStart = now;
  } else if (st.anchorRunStart) {
    const dur = now - st.anchorRunStart;
    if (dur > st.longestAnchorMs) st.longestAnchorMs = dur;
    st.anchorRunStart = null;
  }
  if (st.prevStatus && st.prevStatus !== cat) {
    if (st.prevStatus === "underway" && cat === "rest") st.arrivals++;
    if (st.prevStatus === "rest" && cat === "underway") st.departures++;
  }
  st.prevStatus = cat;
  st.prevPos = p.lat != null && p.lon != null ? { lat: p.lat, lon: p.lon } : st.prevPos;
  st.prevAt = now;
  st.lastSeen = now;
  saveStats(st);
}

function insCell(k, v) {
  return '<div class="ins-cell"><span>' + k + "</span><b>" + v + "</b></div>";
}

function renderInsights(v) {
  const body = $("insights-body");
  const seen = $("insights-seen");
  if (!body) return;
  const st = v ? loadStats(v.imo) : null;
  if (!st || st.observedMs < 10 * 60000) {
    if (seen) seen.textContent = st ? t("just started watching") : "";
    body.innerHTML =
      '<p class="tl-empty">' + t("Insights build up as this app watches the vessel (status & speed sampled every ~5 min). Check back after a while.") + "</p>";
    return;
  }
  const tot = st.observedMs || 1;
  const ap = (st.anchoredMs / tot) * 100;
  const up = (st.underwayMs / tot) * 100;
  if (seen) seen.textContent = t("tracked for") + " " + fmtDur(Date.now() - st.firstSeen);
  body.innerHTML =
    '<div class="ins-bar"><span class="ib-label">' + t("At anchor") + '</span><div class="ib-track"><div class="ib-fill amber" style="width:' + ap.toFixed(0) + '%"></div></div><b>' + ap.toFixed(0) + "%</b></div>" +
    '<div class="ins-bar"><span class="ib-label">' + t("Under way") + '</span><div class="ib-track"><div class="ib-fill green" style="width:' + up.toFixed(0) + '%"></div></div><b>' + up.toFixed(0) + "%</b></div>" +
    '<div class="ins-grid">' +
    insCell(t("Distance covered"), Math.round(st.distanceNm).toLocaleString() + " nm") +
    insCell(t("Avg speed"), (st.sogN ? (st.sogSum / st.sogN).toFixed(1) : "—") + " kn") +
    insCell(t("Top speed"), st.maxSog ? st.maxSog.toFixed(1) + " kn" : "—") +
    insCell(t("Longest anchor"), fmtDur(st.longestAnchorMs)) +
    insCell(t("Arrivals"), st.arrivals) +
    insCell(t("Departures"), st.departures) +
    "</div>";
}

/* ---------------- voyage intelligence ---------------- */

let voyageToken = 0;

async function renderVoyageIntelligence(v) {
  const token = ++voyageToken;
  updateEtaCountdown(v);
  updateVoyageProgress(v);
  const destEl = $("v-dist");
  const ocEl = $("v-oncourse");
  if (!v || !v.destination || !v.position || v.position.lat == null || v.position.lon == null) {
    if (destEl) destEl.textContent = "—";
    if (ocEl) ocEl.textContent = "—";
    return;
  }
  const dest = await geocode(v.destination);
  if (token !== voyageToken) return;
  if (dest && v.position.lat != null) {
    const bear = initialBearing(v.position.lat, v.position.lon, dest.lat, dest.lon);
    const dist = haversine(v.position.lat, v.position.lon, dest.lat, dest.lon);
    if (destEl) destEl.textContent = "≈ " + Math.round(dist).toLocaleString() + " nm";
    if (v.position.sog != null && v.position.sog >= 1) {
      const cog = v.position.cog != null ? v.position.cog : bear;
      const delta = Math.abs(((cog - bear + 540) % 360) - 180);
      const ok = delta <= 15;
      const bad = delta > 40;
      if (ocEl) {
        ocEl.textContent = (ok ? t("On course") : t("Off course")) + " · Δ " + Math.round(delta) + "° (→" + Math.round(bear) + "°)";
        ocEl.className = ok ? "oc-ok" : bad ? "oc-bad" : "oc-amber";
      }
    } else if (ocEl) {
      ocEl.textContent = t("Anchored / not moving");
      ocEl.className = "";
    }
  } else {
    if (destEl) destEl.textContent = "—";
    if (ocEl) {
      ocEl.textContent = "—";
      ocEl.className = "";
    }
  }
}

function updateEtaCountdown(v) {
  const el = $("v-eta-count");
  if (!el) return;
  const eta = parseMdhms(v && v.eta);
  if (!eta) {
    el.textContent = "—";
    el.className = "";
    return;
  }
  const diff = eta.getTime() - Date.now();
  if (diff <= 0) {
    el.textContent = t("Now (arrived / overdue)");
    el.className = "oc-amber";
    return;
  }
  el.textContent = tF("in {x}", { x: fmtDur(diff) });
  el.className = "";
}

function updateVoyageProgress(v) {
  const bar = $("voyage-progress");
  if (!bar) return;
  const atd = parseMdhms(v && v.lastPortAtd);
  const eta = parseMdhms(v && v.eta);
  if (!atd || !eta || eta.getTime() <= atd.getTime()) {
    bar.style.display = "none";
    return;
  }
  bar.style.display = "block";
  const now = Date.now();
  const pct = Math.min(100, Math.max(0, ((now - atd.getTime()) / (eta.getTime() - atd.getTime())) * 100));
  const atdEl = $("vp-atd");
  const etaEl = $("vp-eta");
  const fill = $("vp-fill");
  const nowEl = $("vp-now");
  if (atdEl) atdEl.textContent = "ATD " + fmtHm(localOf(v, atd));
  if (etaEl) etaEl.textContent = "ETA " + fmtHm(localOf(v, eta));
  if (fill) fill.style.width = pct + "%";
  if (nowEl) nowEl.style.left = pct + "%";
}

/* ---------------- aboard (local time + sun) ---------------- */

function renderAboard(v) {
  const nameEl = $("aboard-name");
  if (nameEl) nameEl.textContent = v ? " " + v.name : "";
  updateAboard(v);
}

function updateAboard(v) {
  const clockEl = $("aboard-clock");
  const scEl = $("sunset-count");
  if (!v || !v.position || v.position.lat == null) {
    if (clockEl) clockEl.textContent = "--:--:--";
    if (scEl) scEl.textContent = "—";
    return;
  }
  const now = new Date();
  const local = localOf(v, now);
  if (clockEl) clockEl.textContent = fmtClock(local);
  const dtEl = $("aboard-date");
  if (dtEl) dtEl.textContent = local.getUTCDate() + " " + MONTHS[local.getUTCMonth()] + " " + local.getUTCFullYear();
  const today = sunTimes(v.position.lat, v.position.lon, now);
  if (!today) {
    if (scEl) scEl.textContent = t("Polar day/night — no sunrise or sunset");
    return;
  }
  const srEl = $("aboard-sunrise");
  const ssEl = $("aboard-sunset");
  const dlEl = $("aboard-daylight");
  if (srEl) srEl.textContent = fmtHm(localOf(v, today.sunrise));
  if (ssEl) ssEl.textContent = fmtHm(localOf(v, today.sunset));
  if (dlEl) dlEl.textContent = fmtDur(today.sunset.getTime() - today.sunrise.getTime());
  const utcNow = now.getTime();
  let next = null;
  let label = "";
  if (utcNow < today.sunrise.getTime()) {
    next = today.sunrise.getTime();
    label = t("Sunrise in");
  } else if (utcNow < today.sunset.getTime()) {
    next = today.sunset.getTime();
    label = t("Sunset in");
  } else {
    const tmw = sunTimes(v.position.lat, v.position.lon, new Date(now.getTime() + 86400000));
    if (tmw) {
      next = tmw.sunrise.getTime();
      label = t("Sunrise in (tomorrow)");
    }
  }
  if (scEl) scEl.textContent = next ? label + " " + fmtDur(next - utcNow) : "—";
}

/* ---------------- proximity alerts ---------------- */

const SETTINGS_KEY = "tracker_settings";
const PROX_ALERT_KEY = "tracker_prox_alerts";

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || { notifOn: false, threshold: 10 };
  } catch (_) {
    return { notifOn: false, threshold: 10 };
  }
}
function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}
function renderAlertsUI() {
  const b = $("notif-toggle");
  if (!b) return;
  b.textContent = state.settings.notifOn ? t("🔔 Alerts on") : t("🔕 Alerts off");
  b.classList.toggle("on", state.settings.notifOn);
  const sel = $("prox-threshold");
  if (sel) sel.value = String(state.settings.threshold);
}

function notify(body) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    try {
      new Notification("Superyacht Tracker", { body });
    } catch (_) {}
  } else if (Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function checkProximity() {
  const vs = state.vessels.filter((v) => v.position && v.position.lat != null && v.position.lon != null);
  const th = state.settings.threshold || 10;
  const enc = [];
  for (let i = 0; i < vs.length; i++) {
    for (let j = i + 1; j < vs.length; j++) {
      const a = vs[i].position;
      const b = vs[j].position;
      const d = haversine(a.lat, a.lon, b.lat, b.lon);
      if (d <= th) {
        enc.push({ a: vs[i], b: vs[j], d });
        const key = [vs[i].imo, vs[j].imo].sort().join("-");
        const last = (state.proxAlerted && state.proxAlerted[key]) || 0;
        if (Date.now() - last > 3600000) {
          if (!state.proxAlerted) state.proxAlerted = {};
          state.proxAlerted[key] = Date.now();
          const text = tF("closeApproach", { a: vs[i].name, b: vs[j].name, d: d.toFixed(1), th });
          logEvent(vs[i].imo, vs[i].name, text);
          if (state.settings.notifOn) notify(text);
        }
      }
    }
  }
  const el = $("encounters");
  if (!el) return;
  el.innerHTML = enc
    .map((e) => '<span class="enc-chip">' + e.a.name + " &amp; " + e.b.name + " · " + e.d.toFixed(1) + " nm</span>")
    .join("");
}

/* ---------------- ghost track ---------------- */

function renderGhostToggle() {
  const t = $("ghost-toggle");
  if (t) t.checked = state.ghostOn;
}
$("ghost-toggle").addEventListener("change", (e) => {
  state.ghostOn = e.target.checked;
  localStorage.setItem("tracker_ghost", state.ghostOn ? "1" : "0");
  renderFleetMap();
});
$("notif-toggle").addEventListener("click", () => {
  state.settings.notifOn = !state.settings.notifOn;
  if (state.settings.notifOn && "Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
  saveSettings();
  renderAlertsUI();
});
$("prox-threshold").addEventListener("change", (e) => {
  state.settings.threshold = +e.target.value;
  saveSettings();
  checkProximity();
});
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".discover-add");
  if (btn) addVessel(btn.getAttribute("data-imo"));
});

/* ---------------- discovery ---------------- */

const DISCOVER = [
  { imo: "9693367", name: "Azzam", tag: "181 m · 2013", fact: "The longest private motor yacht ever built (180.6 m), launched for a member of the Abu Dhabi royal family." },
  { imo: "1009613", name: "Eclipse", tag: "162.5 m · 2010", fact: "One of the largest yachts ever built — famed for missile-detection systems and an on-board submarine." },
  { imo: "9661792", name: "Dilbar", tag: "156 m · 2016", fact: "The world's largest yacht by internal volume (15,917 GT); its swimming pool set a Guinness World Record." },
  { imo: "9692545", name: "Andromeda", tag: "107 m · 2015", fact: "The yacht that started this tracker — a 107 m German-built superyacht." },
  { imo: "9384552", name: "Maltese Falcon", tag: "87 m · 2006", fact: "Iconic DynaRig sailing yacht with self-standing carbon masts and about 2,800 m² of sail." },
  { imo: "9785108", name: "Crescent", tag: "135.6 m · 2018", fact: "A 135.6 m superyacht built by Lürssen in 2018 — one of the largest yachts in the world." },
  { imo: "8977273", name: "Pelorus", tag: "115 m · 2003", fact: "A 115 m classic built by Blohm+Voss in 2003 — for years linked to Roman Abramovich." },
  { imo: "1013030", name: "Bold", tag: "85 m · 2019", fact: "An 85 m aluminium explorer by Silver Yachts, built 2019 — designed for research and adventure." },
  { imo: "1009912", name: "Victorious", tag: "77 m · 2021", fact: "A 77 m explorer-style superyacht built by Kleven in 2021." },
  { imo: "9679830", name: "Illusion", tag: "65 m · 2013", fact: "A 65 m yacht built by Nobiskrug in 2013." },
  { imo: "1013054", name: "Laurentia", tag: "55 m · 2017", fact: "A 55 m Feadship expedition-style motor yacht launched in 2017." },
  { imo: "6618823", name: "Sherakhan", tag: "64 m · 1966", fact: "A 64 m motor yacht built in 1966 — one of the world's oldest large yachts still cruising." },
];

const DISCOVER_N = 6;
let shuffleSeed = null;

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededPick(arr, n, seed) {
  const a = arr.slice();
  const rand = mulberry32(seed >>> 0);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}
function rotationBucket() {
  return Math.floor(Date.now() / 3600000);
}

function renderDiscover() {
  const grid = $("discover-grid");
  if (!grid) return;
  const seed = shuffleSeed !== null ? shuffleSeed : rotationBucket();
  const picked = seededPick(DISCOVER, DISCOVER_N, seed);
  grid.innerHTML = picked
    .map(
      (d) =>
        '<div class="discover-card">' +
        '<div class="dc-name">' + d.name + '</div>' +
        '<div class="dc-tag">' + t(d.tag) + "</div>" +
        '<p class="dc-fact">' + t(d.fact) + "</p>" +
        (state.vessels.some((v) => v.imo === d.imo)
          ? '<button class="mini-btn" disabled>' + t("Tracking ✓") + "</button>"
          : '<button class="mini-btn discover-add" data-imo="' + d.imo + '">' + t("Track") + "</button>") +
        "</div>"
    )
    .join("");
  const note = $("discover-note");
  if (note) {
    if (shuffleSeed !== null) {
      note.textContent = t("Shuffled — refresh to reset");
    } else {
      const mins = 60 - new Date().getMinutes();
      note.textContent = t("New yachts every hour") + " · " + tF("Next rotation in {t}", { t: fmtDur(mins * 60000) });
    }
  }
}
$("shuffle-btn").addEventListener("click", () => {
  shuffleSeed = Math.floor(Math.random() * 1e9);
  renderDiscover();
});

/* ---------------- language / i18n ---------------- */

const LANG_KEY = "tracker_lang";
let LANG = (() => {
  const v = localStorage.getItem(LANG_KEY);
  return v === "pl" || v === "it" ? v : "en";
})();

const I18N = {
  pl: {
    "Map": "Mapa", "Fleet": "Flota", "Activity": "Aktywność", "Discover": "Odkryj",
    "🌙 Midnight": "🌙 Północ", "☀️ Daylight": "☀️ Dzień", "🌿 Emerald": "🌿 Szmaragd", "🌇 Sunset": "🌇 Zachód słońca",
    "Add vessel by IMO… e.g. 9692545": "Dodaj jednostkę po IMO… np. 9692545",
    "+ Track": "+ Śledź",
    "No vessels tracked yet — add one by IMO number above.": "Brak śledzonych jednostek — dodaj jedną po numerze IMO powyżej.",
    "Tracked": "Śledzone", "Under way": "W drodze", "At anchor": "Na kotwicy", "Avg SOG": "Śr. prędkość",
    "🔕 Alerts off": "🔕 Alerty wył.", "🔔 Alerts on": "🔔 Alerty wł.", "within": "w promieniu",
    "Length": "Długość", "Beam": "Szerokość", "Gross Tons": "Pojemność GT", "Built": "Rok budowy",
    "Navigation status": "Status nawigacji", "Region": "Region",
    "Speed / Course": "Prędkość / Kurs", "Destination": "Przeznaczenie",
    "Live track": "Śledzenie na żywo", "Fleet view": "Widok floty",
    "👻 Ghost track": "👻 Trasa przewidywana",
    "Position & Tracking": "Pozycja i śledzenie",
    "Live AIS position and 24 h track of the selected vessel via VesselFinder · Map data © OpenStreetMap contributors": "Pozycja AIS na żywo i 24-godzinna trasa wybranej jednostki (VesselFinder) · Dane mapy © OpenStreetMap",
    "Fleet overview — boat markers are rotated to heading and colour-coded by status; circles show the ~1° position uncertainty of the free AIS feed. Use Live track for the precise track of a selected vessel.": "Przegląd floty — znaczniki obrócone zgodnie z kursem i pokolorowane wg statusu; koła pokazują niepewność pozycji (~1°) darmowego kanału AIS. Użyj „Śledzenia na żywo” dla dokładnej trasy.",
    "Select or add a vessel to see its live position and track.": "Wybierz lub dodaj jednostkę, aby zobaczyć jej pozycję i trasę.",
    "Could not load the fleet map (Leaflet CDN unreachable).": "Nie można załadować mapy floty (CDN Leaflet niedostępny).",
    "Voyage Intelligence": "Inteligencja rejsu", "ETA": "ETA", "Arrives in": "Przybędzie za",
    "On course": "Zgodny z kursem", "Off course": "Poza kursem", "Anchored / not moving": "Na kotwicy / bez ruchu",
    "To destination": "Do celu", "Speed over ground": "Prędkość nad dnem",
    "Course over ground": "Kurs nad dnem", "Current draught": "Aktualne zanurzenie",
    "Position received": "Pozycja odebrana", "Last port": "Ostatni port", "ATD": "ATD", "ETA_": "ETA",
    "On course: heading vs the bearing to destination (geocoded via OpenStreetMap).": "„Zgodny z kursem” porównuje kurs jednostki z namiarem na cel (geokodowany przez OpenStreetMap).",
    "Identification": "Identyfikacja", "Vessel name": "Nazwa jednostki", "IMO number": "Numer IMO",
    "MMSI": "MMSI", "Callsign": "Znak wywoławczy", "Ship type": "Typ jednostki",
    "Flag state": "Państwo bandery", "Approx. position": "Przybliżona pozycja", "Data source": "Źródło danych",
    "Vessel Particulars": "Dane techniczne", "Dimensions": "Wymiary", "Tonnage": "Tonaż", "General": "Ogólne",
    "Length overall": "Długość całkowita", "Draught": "Zanurzenie", "Draft from voyage": "Zanurzenie (rejs)",
    "Gross tonnage": "Pojemność brutto", "Net tonnage": "Pojemność netto", "Deadweight": "Nośność",
    "Year of build": "Rok budowy",
    "Particulars from public AIS registries (VesselFinder). Some fields may be blank for vessels with limited registry data.": "Dane z publicznych rejestrów AIS (VesselFinder). Niektóre pola mogą być puste.",
    "Behavioral Insights": "Analiza zachowania", "just started watching": "dopiero rozpoczęto obserwację",
    "Insights build up as this app watches the vessel (status & speed sampled every ~5 min). Check back after a while.": "Analiza rośnie, gdy aplikacja obserwuje jednostkę (status i prędkość próbkowane co ~5 min). Zajrzyj później.",
    "tracked for": "śledzona przez", "Distance covered": "Przebyty dystans",
    "Avg speed": "Śr. prędkość", "Top speed": "Maks. prędkość", "Longest anchor": "Najdłuższa kotwica",
    "Arrivals": "Przybycia", "Departures": "Odejścia",
    "Aboard": "Na pokładzie", "Local date": "Lokalna data", "Sunrise": "Wschód słońca",
    "Sunset": "Zachód słońca", "Daylight": "Długość dnia",
    "Sunrise in": "Wschód słońca za", "Sunset in": "Zachód słońca za", "Sunrise in (tomorrow)": "Wschód słońca za (jutro)",
    "Polar day/night — no sunrise or sunset": "Dzień/noc polarna — brak wschodu i zachodu słońca",
    "Weather at Position": "Pogoda na pozycji", "Air temp": "Temperatura", "Wind speed": "Wiatr",
    "Wind dir": "Kierunek wiatru", "Wind gusts": "Porywy",
    "Weather from Open-Meteo for the vessel's reported area. Updates periodically.": "Pogoda z Open-Meteo dla rejonu jednostki. Odświeżanie okresowe.",
    "Vessel": "Jednostka", "Type": "Typ", "Status": "Status", "Last update": "Ostatnia aktualizacja",
    "Click a row to focus the vessel · Click column headers to sort.": "Kliknij wiersz, aby skupić się na jednostce · Kliknij nagłówki kolumn, aby sortować.",
    "Fleet Board": "Tabela floty", "Fleet Activity": "Aktywność floty", "Clear": "Wyczyść",
    "Events are recorded as this app observes each vessel during refreshes (status, speed and destination changes).": "Zdarzenia są rejestrowane podczas odświeżeń (zmiany statusu, prędkości lub celu).",
    "No activity recorded yet — events appear as vessels update (status, speed or destination changes).": "Brak zarejestrowanej aktywności — zdarzenia pojawiają się przy aktualizacjach (zmiany statusu, prędkości lub celu).",
    "Nav status:": "Status nawigacji:", "Speed:": "Prędkość:", "Destination:": "Przeznaczenie:",
    "Added to fleet": "Dodano do floty",
    "Discover famous superyachts": "Odkryj słynne superjachty", "Tracking ✓": "Śledzona ✓", "Track": "Śledź",
    "No photo available": "Brak zdjęcia",
    "Weather unavailable ({msg})": "Pogoda niedostępna ({msg})", "No position data": "Brak danych o pozycji",
    "Enter a valid 7-digit IMO number": "Podaj poprawny 7-cyfrowy numer IMO",
    "Could not add vessel: {msg}": "Nie można dodać jednostki: {msg}",
    "No vessel selected": "Nie wybrano jednostki",
    "Live AIS map of {name}": "Mapa AIS na żywo: {name}",
    "Projected position in 24 h": "Przewidywana pozycja za 24 h", "Show live track": "Pokaż trasę na żywo",
    "Updated {t}": "Zaktualizowano {t}",
    "in {x}": "za {x}", "Now (arrived / overdue)": "Teraz (przybył / po terminie)",
    "nVesselsOne": "1 jednostka",
    "Tracking {name} ({imo})": "Śledzenie: {name} ({imo})",
    "closeApproach": "{a} i {b} są oddalone o {d} nm (próg {th} nm)",
    "just now": "teraz", "min ago": "min temu", "h ago": "godz. temu", "d ago": "dni temu",
    "181 m · 2013 · World's longest motor yacht": "181 m · 2013 · Najdłuższy jacht motorowy świata",
    "The longest private motor yacht ever built (180.6 m), launched for a member of the Abu Dhabi royal family.": "Najdłuższy prywatny jacht motorowy świata (180,6 m), zwodowany dla członka rodziny królewskiej Abu Zabi.",
    "162.5 m · 2010": "162,5 m · 2010",
    "One of the largest yachts ever built — famed for missile-detection systems and an on-board submarine.": "Jeden z największych jachtów świata — słynny z systemów wykrywania rakiet i pokładowego okrętu podwodnego.",
    "156 m · 2016 · Largest by volume": "156 m · 2016 · Największy objętościowo",
    "The world's largest yacht by internal volume (15,917 GT); its swimming pool set a Guinness World Record.": "Największy jacht świata pod względem pojemności (15 917 GT); jego basen ustanowił rekord Guinnessa.",
    "The yacht that started this tracker — a 107 m German-built superyacht.": "Jacht, od którego zaczął się ten tracker — 107-metrowy superjacht zbudowany w Niemczech.",
    "Iconic DynaRig sailing yacht with self-standing carbon masts and about 2,800 m² of sail.": "Kultowy żaglowiec DynaRig z samonośnymi masztami z włókna węglowego i ok. 2800 m² żagli.",
    "Wave height": "Wysokość fali", "Wave period": "Okres fali", "Sea temp": "Temp. morza", "Current": "Prąd",
    "Weather and sea state from Open-Meteo for the vessel's reported area. Updates periodically.": "Pogoda i stan morza z Open-Meteo dla rejonu jednostki. Odświeżanie okresowe.",
    "Fleet Radar": "Radar floty",
    "Radar centred on the selected vessel — blips show the bearing and distance of every tracked vessel. Approximate AIS positions.": "Radar wyśrodkowany na wybranej jednostce — punkty pokazują namiar i odległość każdej śledzonej jednostki. Przybliżone pozycje AIS.",
    "Track Replay": "Odtwarzanie trasy",
    "Playback of positions recorded by this app since it started watching the fleet.": "Odtwarzanie pozycji zarejestrowanych przez aplikację od początku obserwacji floty.",
    "No recorded positions yet — keep the app open while the fleet is watched.": "Brak zarejestrowanych pozycji — trzymaj aplikację otwartą, aby obserwować flotę.",
    "Voyage history": "Historia rejsu", "No voyage history recorded yet.": "Brak historii rejsu.",
    "🔗 Share fleet": "🔗 Udostępnij flotę", "Fleet link copied to clipboard": "Skopiowano link do floty",
    "▶ Replay": "▶ Odtwórz", "Centre: {name}": "Środek: {name}",
    "Shuffle": "Losuj", "New yachts every hour": "Nowe jachty co godzinę",
    "Next rotation in {t}": "Następna rotacja za {t}", "Shuffled — refresh to reset": "Wylosowano — odśwież, aby zresetować",
    "A 135.6 m superyacht built by Lürssen in 2018 — one of the largest yachts in the world.": "135,6-metrowy superjacht zbudowany przez Lürssen w 2018 r. — jeden z największych jachtów świata.",
    "A 115 m classic built by Blohm+Voss in 2003 — for years linked to Roman Abramovich.": "115-metrowa klasyka z Blohm+Voss z 2003 r. — przez lata związana z Romanem Abramowiczem.",
    "An 85 m aluminium explorer by Silver Yachts, built 2019 — designed for research and adventure.": "85-metrowy aluminiowy explorer firmy Silver Yachts z 2019 r. — zaprojektowany do badań i przygód.",
    "A 77 m explorer-style superyacht built by Kleven in 2021.": "77-metrowy superjacht w stylu ekspedycyjnym zbudowany przez Kleven w 2021 r.",
    "A 65 m yacht built by Nobiskrug in 2013.": "65-metrowy jacht zbudowany przez Nobiskrug w 2013 r.",
    "A 55 m Feadship expedition-style motor yacht launched in 2017.": "55-metrowy jacht motorowy Feadship w stylu ekspedycyjnym, zwodowany w 2017 r.",
    "A 64 m motor yacht built in 1966 — one of the world's oldest large yachts still cruising.": "64-metrowy jacht motorowy z 1966 r. — jeden z najstarszych dużych jachtów świata wciąż pływających.",
    "Help & Guide": "Pomoc i przewodnik",
    "Getting started": "Pierwsze kroki",
    "Add any vessel with its 7-digit IMO number in the top bar and press + Track.": "Dodaj dowolną jednostkę, wpisując jej 7-cyfrowy numer IMO w górnym pasku i klikając + Śledź.",
    "Examples: 9692545 (Andromeda), 1009613 (Eclipse), 9811000 (Ever Given).": "Przykłady: 9692545 (Andromeda), 1009613 (Eclipse), 9811000 (Ever Given).",
    "Your fleet is saved in this browser and restored on your next visit.": "Twoja flota jest zapisywana w tej przeglądarce i przywracana przy następnej wizycie.",
    "Share your whole fleet with one click using the Share fleet button — the link encodes your vessels.": "Udostępnij całą flotę jednym kliknięciem przycisku „Udostępnij flotę” — link zawiera Twoje jednostki.",
    "Maps & tracking": "Mapy i śledzenie",
    "Live track shows the precise AIS position and 24 h track of the selected vessel.": "„Śledzenie na żywo” pokazuje dokładną pozycję AIS i 24-godzinną trasę wybranej jednostki.",
    "Fleet view shows every tracked vessel on one map — markers point along their heading.": "„Widok floty” pokazuje wszystkie śledzone jednostki na jednej mapie — znaczniki wskazują kierunek ruchu.",
    "Ghost track projects where each moving vessel will be in 6 / 12 / 24 h.": "„Trasa przewidywana” pokazuje, gdzie każda poruszająca się jednostka będzie za 6 / 12 / 24 godz.",
    "Replay plays back the positions this app has recorded since you started watching.": "„Odtwarzanie” odtwarza pozycje zarejestrowane przez aplikację od początku obserwacji.",
    "Click a vessel on the map to open its live track.": "Kliknij jednostkę na mapie, aby otworzyć jej trasę na żywo.",
    "Fleet management": "Zarządzanie flotą",
    "The fleet strip and Fleet Board show every vessel; click one to focus it.": "Pasek floty i „Tabela floty” pokazują wszystkie jednostki; kliknij, aby ją zaznaczyć.",
    "Sort the Fleet Board by any column — speed, destination, ETA, last update.": "Sortuj tabelę floty po dowolnej kolumnie — prędkość, cel, ETA, ostatnia aktualizacja.",
    "The stats bar summarises your fleet: under way, at anchor, average speed.": "Pasek statystyk podsumowuje flotę: w drodze, na kotwicy, średnia prędkość.",
    "Remove a vessel with the × button on its card.": "Usuń jednostkę przyciskiem × na jej karcie.",
    "Voyage intelligence": "Inteligencja rejsu",
    "Arrives in shows a live countdown to the reported ETA.": "„Przybędzie za” pokazuje odliczanie do podanego ETA.",
    "On course compares the vessel's heading with the bearing to its destination.": "„Zgodny z kursem” porównuje kurs jednostki z namiarem na cel.",
    "The progress bar tracks the voyage between the last port (ATD) and destination (ETA).": "Pasek postępu pokazuje rejs między ostatnim portem (ATD) a celem (ETA).",
    "Voyage history lists the journey observed by this app: last port → destination changes → current destination.": "„Historia rejsu” pokazuje podróż obserwowaną przez aplikację: ostatni port → zmiany celu → obecny cel.",
    "Insights & ambient": "Analiza i atmosfera na pokładzie",
    "Behavioral Insights summarise time at anchor vs under way, distance, speeds, arrivals and departures.": "„Analiza zachowania” podsumowuje czas na kotwicy vs w drodze, dystans, prędkości, przybycia i odejścia.",
    "Aboard shows the local time at the vessel, plus sunrise, sunset and daylight hours at its position.": "„Na pokładzie” pokazuje lokalny czas jednostki oraz wschód, zachód słońca i długość dnia na jej pozycji.",
    "Weather and sea state show air temperature, wind, waves, sea temperature and currents near the vessel.": "„Pogoda” pokazuje temperaturę powietrza, wiatr, fale, temperaturę morza i prądy w pobliżu jednostki.",
    "Alerts & radar": "Alerty i radar",
    "Enable Alerts and set a distance to get notified when two tracked vessels come close.": "Włącz „Alerty” i ustaw dystans, aby otrzymać powiadomienie, gdy dwie jednostki się zbliżą.",
    "The Fleet Radar shows every vessel as a blip — bearing and distance from the selected vessel.": "„Radar floty” pokazuje każdą jednostkę jako punkt — namiar i odległość od wybranej jednostki.",
    "Discovery & settings": "Odkrywanie i ustawienia",
    "Discover introduces a new set of famous superyachts every hour — or shuffle them yourself.": "„Odkryj” co godzinę pokazuje nowy zestaw słynnych superjachtów — możesz też je losować.",
    "Switch colour themes and language from the top bar; your choices are remembered.": "Zmieniaj motywy kolorystyczne i język w górnym pasku — wybór jest zapamiętywany.",
    "Positions come from free AIS and are rounded to ~1° — use Live track for a precise position.": "Pozycje pochodzą z darmowego AIS i są zaokrąglane do ~1° — dla dokładnej pozycji użyj „Śledzenia na żywo”.",
  },
  it: {
    "Map": "Mappa", "Fleet": "Flotta", "Activity": "Attività", "Discover": "Scopri",
    "🌙 Midnight": "🌙 Mezzanotte", "☀️ Daylight": "☀️ Giorno", "🌿 Emerald": "🌿 Smeraldo", "🌇 Sunset": "🌇 Tramonto",
    "Add vessel by IMO… e.g. 9692545": "Aggiungi nave per IMO… es. 9692545",
    "+ Track": "+ Traccia",
    "No vessels tracked yet — add one by IMO number above.": "Nessuna nave tracciata — aggiungine una tramite il numero IMO qui sopra.",
    "Tracked": "Tracciate", "Under way": "In navigazione", "At anchor": "All'ancora", "Avg SOG": "Vel. media",
    "🔕 Alerts off": "🔕 Avvisi off", "🔔 Alerts on": "🔔 Avvisi on", "within": "entro",
    "Length": "Lunghezza", "Beam": "Larghezza", "Gross Tons": "Stazza GT", "Built": "Anno",
    "Navigation status": "Stato di navigazione", "Region": "Regione",
    "Speed / Course": "Velocità / Rotta", "Destination": "Destinazione",
    "Live track": "Traccia live", "Fleet view": "Vista flotta",
    "👻 Ghost track": "👻 Traccia fantasma",
    "Position & Tracking": "Posizione e tracciamento",
    "Live AIS position and 24 h track of the selected vessel via VesselFinder · Map data © OpenStreetMap contributors": "Posizione AIS live e rotta 24 h della nave selezionata (VesselFinder) · Dati mappa © OpenStreetMap",
    "Fleet overview — boat markers are rotated to heading and colour-coded by status; circles show the ~1° position uncertainty of the free AIS feed. Use Live track for the precise track of a selected vessel.": "Panoramica flotta — i markeri seguono la rotta e il colore lo stato; i cerchi mostrano l'incertezza (~1°) del feed AIS gratuito. Usa „Traccia live” per la rotta precisa.",
    "Select or add a vessel to see its live position and track.": "Seleziona o aggiungi una nave per vedere posizione e rotta.",
    "Could not load the fleet map (Leaflet CDN unreachable).": "Impossibile caricare la mappa della flotta (CDN Leaflet non raggiungibile).",
    "Voyage Intelligence": "Intelligenza di viaggio", "ETA": "ETA", "Arrives in": "Arrivo tra",
    "On course": "In rotta", "Off course": "Fuori rotta", "Anchored / not moving": "All'ancora / ferma",
    "To destination": "Alla destinazione", "Speed over ground": "Velocità sul fondo",
    "Course over ground": "Rotta sul fondo", "Current draught": "Pescaggio attuale",
    "Position received": "Posizione ricevuta", "Last port": "Ultimo porto", "ATD": "ATD", "ETA_": "ETA",
    "On course: heading vs the bearing to destination (geocoded via OpenStreetMap).": "\"In rotta\" confronta la rotta della nave con la direzione verso la destinazione (geocodificata via OpenStreetMap).",
    "Identification": "Identificazione", "Vessel name": "Nome nave", "IMO number": "Numero IMO",
    "MMSI": "MMSI", "Callsign": "Nominativo", "Ship type": "Tipo di nave",
    "Flag state": "Bandiera", "Approx. position": "Posizione approssimativa", "Data source": "Fonte dati",
    "Vessel Particulars": "Particolari della nave", "Dimensions": "Dimensioni", "Tonnage": "Stazza", "General": "Generali",
    "Length overall": "Lunghezza fuori tutto", "Draught": "Pescaggio", "Draft from voyage": "Pescaggio (viaggio)",
    "Gross tonnage": "Stazza lorda", "Net tonnage": "Stazza netta", "Deadweight": "Portata",
    "Year of build": "Anno di costruzione",
    "Particulars from public AIS registries (VesselFinder). Some fields may be blank for vessels with limited registry data.": "Particolari da registri AIS pubblici (VesselFinder). Alcuni campi possono essere vuoti.",
    "Behavioral Insights": "Analisi comportamentale", "just started watching": "monitoraggio appena iniziato",
    "Insights build up as this app watches the vessel (status & speed sampled every ~5 min). Check back after a while.": "L'analisi cresce mentre l'app osserva la nave (stato e velocità campionati ogni ~5 min). Riprova più tardi.",
    "tracked for": "tracciata da", "Distance covered": "Distanza percorsa",
    "Avg speed": "Vel. media", "Top speed": "Vel. massima", "Longest anchor": "Ancora più lunga",
    "Arrivals": "Arrivi", "Departures": "Partenze",
    "Aboard": "A bordo", "Local date": "Data locale", "Sunrise": "Alba",
    "Sunset": "Tramonto", "Daylight": "Ore di luce",
    "Sunrise in": "Alba tra", "Sunset in": "Tramonto tra", "Sunrise in (tomorrow)": "Alba tra (domani)",
    "Polar day/night — no sunrise or sunset": "Giorno/notte polare — nessuna alba né tramonto",
    "Weather at Position": "Meteo in posizione", "Air temp": "Temperatura", "Wind speed": "Vento",
    "Wind dir": "Direzione vento", "Wind gusts": "Raffiche",
    "Weather from Open-Meteo for the vessel's reported area. Updates periodically.": "Meteo da Open-Meteo per l'area della nave. Aggiornamenti periodici.",
    "Vessel": "Nave", "Type": "Tipo", "Status": "Stato", "Last update": "Ultimo aggiornamento",
    "Click a row to focus the vessel · Click column headers to sort.": "Clicca una riga per selezionare la nave · Clicca le intestazioni per ordinare.",
    "Fleet Board": "Tabella flotta", "Fleet Activity": "Attività flotta", "Clear": "Pulisci",
    "Events are recorded as this app observes each vessel during refreshes (status, speed and destination changes).": "Gli eventi sono registrati durante gli aggiornamenti (variazioni di stato, velocità o destinazione).",
    "No activity recorded yet — events appear as vessels update (status, speed or destination changes).": "Nessuna attività registrata — gli eventi compaiono con gli aggiornamenti (variazioni di stato, velocità o destinazione).",
    "Nav status:": "Stato di navigazione:", "Speed:": "Velocità:", "Destination:": "Destinazione:",
    "Added to fleet": "Aggiunta alla flotta",
    "Discover famous superyachts": "Scopri famosi superyacht", "Tracking ✓": "Tracciata ✓", "Track": "Traccia",
    "No photo available": "Nessuna foto",
    "Weather unavailable ({msg})": "Meteo non disponibile ({msg})", "No position data": "Nessun dato di posizione",
    "Enter a valid 7-digit IMO number": "Inserisci un numero IMO valido a 7 cifre",
    "Could not add vessel: {msg}": "Impossibile aggiungere la nave: {msg}",
    "No vessel selected": "Nessuna nave selezionata",
    "Live AIS map of {name}": "Mappa AIS live di {name}",
    "Projected position in 24 h": "Posizione prevista tra 24 h", "Show live track": "Mostra traccia live",
    "Updated {t}": "Aggiornato {t}",
    "in {x}": "tra {x}", "Now (arrived / overdue)": "Ora (arrivato / in ritardo)",
    "nVesselsOne": "1 nave",
    "Tracking {name} ({imo})": "Tracciamento: {name} ({imo})",
    "closeApproach": "{a} e {b} distano {d} nm (soglia {th} nm)",
    "just now": "proprio ora", "min ago": "min fa", "h ago": "ore fa", "d ago": "giorni fa",
    "181 m · 2013 · World's longest motor yacht": "181 m · 2013 · Lo yacht a motore più lungo del mondo",
    "The longest private motor yacht ever built (180.6 m), launched for a member of the Abu Dhabi royal family.": "Il più lungo yacht a motore privato mai costruito (180,6 m), varato per un membro della famiglia reale di Abu Dhabi.",
    "162.5 m · 2010": "162,5 m · 2010",
    "One of the largest yachts ever built — famed for missile-detection systems and an on-board submarine.": "Uno dei più grandi yacht mai costruiti — famoso per i sistemi di rilevamento missili e un sottomarino a bordo.",
    "156 m · 2016 · Largest by volume": "156 m · 2016 · Il più grande per volume",
    "The world's largest yacht by internal volume (15,917 GT); its swimming pool set a Guinness World Record.": "Il più grande yacht al mondo per volume interno (15.917 GT); la sua piscina ha stabilito un Guinness World Record.",
    "The yacht that started this tracker — a 107 m German-built superyacht.": "Lo yacht da cui è nato questo tracker — un superyacht tedesco di 107 m.",
    "Iconic DynaRig sailing yacht with self-standing carbon masts and about 2,800 m² of sail.": "Iconico yacht a vela DynaRig con alberi in carbonio autoportanti e circa 2.800 m² di vela.",
    "Wave height": "Altezza onda", "Wave period": "Periodo onda", "Sea temp": "Temp. mare", "Current": "Corrente",
    "Weather and sea state from Open-Meteo for the vessel's reported area. Updates periodically.": "Meteo e stato del mare da Open-Meteo per l'area della nave. Aggiornamenti periodici.",
    "Fleet Radar": "Radar flotta",
    "Radar centred on the selected vessel — blips show the bearing and distance of every tracked vessel. Approximate AIS positions.": "Radar centrato sulla nave selezionata — i blip mostrano rilevamento e distanza di ogni nave tracciata. Posizioni AIS approssimative.",
    "Track Replay": "Riproduzione rotta",
    "Playback of positions recorded by this app since it started watching the fleet.": "Riproduzione delle posizioni registrate dall'app dall'inizio del monitoraggio della flotta.",
    "No recorded positions yet — keep the app open while the fleet is watched.": "Nessuna posizione registrata — tieni l'app aperta mentre la flotta viene monitorata.",
    "Voyage history": "Cronologia viaggio", "No voyage history recorded yet.": "Nessuna cronologia di viaggio registrata.",
    "🔗 Share fleet": "🔗 Condividi flotta", "Fleet link copied to clipboard": "Link flotta copiato negli appunti",
    "▶ Replay": "▶ Riproduci", "Centre: {name}": "Centro: {name}",
    "Shuffle": "Mescola", "New yachts every hour": "Nuovi yacht ogni ora",
    "Next rotation in {t}": "Prossima rotazione tra {t}", "Shuffled — refresh to reset": "Miscelato — aggiorna per azzerare",
    "A 135.6 m superyacht built by Lürssen in 2018 — one of the largest yachts in the world.": "Un superyacht di 135,6 m costruito da Lürssen nel 2018 — uno dei più grandi yacht al mondo.",
    "A 115 m classic built by Blohm+Voss in 2003 — for years linked to Roman Abramovich.": "Un classico di 115 m costruito da Blohm+Voss nel 2003 — a lungo legato a Roman Abramovich.",
    "An 85 m aluminium explorer by Silver Yachts, built 2019 — designed for research and adventure.": "Un explorer in alluminio di 85 m di Silver Yachts, costruito nel 2019 — progettato per ricerca e avventura.",
    "A 77 m explorer-style superyacht built by Kleven in 2021.": "Un superyacht da 77 m in stile explorer costruito da Kleven nel 2021.",
    "A 65 m yacht built by Nobiskrug in 2013.": "Uno yacht di 65 m costruito da Nobiskrug nel 2013.",
    "A 55 m Feadship expedition-style motor yacht launched in 2017.": "Uno yacht a motore Feadship da 55 m in stile expedition, varato nel 2017.",
    "A 64 m motor yacht built in 1966 — one of the world's oldest large yachts still cruising.": "Uno yacht a motore di 64 m costruito nel 1966 — uno dei più antichi grandi yacht del mondo ancora in navigazione.",
    "Help & Guide": "Aiuto e guida",
    "Getting started": "Per iniziare",
    "Add any vessel with its 7-digit IMO number in the top bar and press + Track.": "Aggiungi una nave inserendo il suo numero IMO a 7 cifre nella barra in alto e premendo + Traccia.",
    "Examples: 9692545 (Andromeda), 1009613 (Eclipse), 9811000 (Ever Given).": "Esempi: 9692545 (Andromeda), 1009613 (Eclipse), 9811000 (Ever Given).",
    "Your fleet is saved in this browser and restored on your next visit.": "La tua flotta è salvata in questo browser e viene ripristinata alla prossima visita.",
    "Share your whole fleet with one click using the Share fleet button — the link encodes your vessels.": "Condividi l'intera flotta con un clic usando il pulsante „Condividi flotta” — il link contiene le tue navi.",
    "Maps & tracking": "Mappe e tracciamento",
    "Live track shows the precise AIS position and 24 h track of the selected vessel.": "„Traccia live” mostra la posizione AIS precisa e la rotta di 24 h della nave selezionata.",
    "Fleet view shows every tracked vessel on one map — markers point along their heading.": "„Vista flotta” mostra tutte le navi tracciate su una mappa — i markeri indicano la rotta.",
    "Ghost track projects where each moving vessel will be in 6 / 12 / 24 h.": "„Traccia fantasma” proietta dove sarà ogni nave in movimento tra 6 / 12 / 24 ore.",
    "Replay plays back the positions this app has recorded since you started watching.": "„Riproduzione” riproduce le posizioni registrate dall'app dall'inizio del monitoraggio.",
    "Click a vessel on the map to open its live track.": "Clicca una nave sulla mappa per aprirne la traccia live.",
    "Fleet management": "Gestione flotta",
    "The fleet strip and Fleet Board show every vessel; click one to focus it.": "La striscia flotta e la „Tabella flotta” mostrano ogni nave; clicca per selezionarla.",
    "Sort the Fleet Board by any column — speed, destination, ETA, last update.": "Ordina la tabella flotta per qualsiasi colonna — velocità, destinazione, ETA, ultimo aggiornamento.",
    "The stats bar summarises your fleet: under way, at anchor, average speed.": "La barra statistiche riassume la flotta: in navigazione, all'ancora, velocità media.",
    "Remove a vessel with the × button on its card.": "Rimuovi una nave con il pulsante × sulla sua scheda.",
    "Voyage intelligence": "Intelligenza di viaggio",
    "Arrives in shows a live countdown to the reported ETA.": "„Arrivo tra” mostra un conto alla rovescia per l'ETA dichiarato.",
    "On course compares the vessel's heading with the bearing to its destination.": "„In rotta” confronta la rotta della nave con la direzione verso la destinazione.",
    "The progress bar tracks the voyage between the last port (ATD) and destination (ETA).": "La barra di avanzamento traccia il viaggio tra l'ultimo porto (ATD) e la destinazione (ETA).",
    "Voyage history lists the journey observed by this app: last port → destination changes → current destination.": "La „Cronologia viaggio” elenca il percorso osservato dall'app: ultimo porto → cambi di destinazione → destinazione attuale.",
    "Insights & ambient": "Analisi e ambiente",
    "Behavioral Insights summarise time at anchor vs under way, distance, speeds, arrivals and departures.": "L'analisi comportamentale riassume tempo all'ancora vs in navigazione, distanza, velocità, arrivi e partenze.",
    "Aboard shows the local time at the vessel, plus sunrise, sunset and daylight hours at its position.": "„A bordo” mostra l'ora locale della nave, oltre ad alba, tramonto e ore di luce nella sua posizione.",
    "Weather and sea state show air temperature, wind, waves, sea temperature and currents near the vessel.": "Meteo e stato del mare mostrano temperatura dell'aria, vento, onde, temperatura del mare e correnti vicino alla nave.",
    "Alerts & radar": "Avvisi e radar",
    "Enable Alerts and set a distance to get notified when two tracked vessels come close.": "Attiva gli „Avvisi” e imposta una distanza per essere avvisato quando due navi si avvicinano.",
    "The Fleet Radar shows every vessel as a blip — bearing and distance from the selected vessel.": "Il „Radar flotta” mostra ogni nave come un blip — rilevamento e distanza dalla nave selezionata.",
    "Discovery & settings": "Scoperta e impostazioni",
    "Discover introduces a new set of famous superyachts every hour — or shuffle them yourself.": "„Scopri” presenta un nuovo set di famosi superyacht ogni ora — oppure mescolali tu stesso.",
    "Switch colour themes and language from the top bar; your choices are remembered.": "Cambia temi colore e lingua dalla barra in alto; le tue scelte vengono ricordate.",
    "Positions come from free AIS and are rounded to ~1° — use Live track for a precise position.": "Le posizioni provengono dall'AIS gratuito e sono arrotondate a ~1° — usa „Traccia live” per una posizione precisa.",
  },
};

const NAV_STATUS_PL = {
  "At anchor": "Na kotwicy",
  "Under way using engine": "W drodze (napęd mechaniczny)",
  "Under way": "W drodze",
  "Moored": "Zacumowany",
  "Alongside": "Przy nabrzeżu",
  "Berthed": "Przy kei",
  "Sailing": "Pod żaglami",
  "Not under command": "Nie sterowany",
  "Restricted maneuverability": "Ograniczona manewrowość",
  "Constrained by her draught": "Ograniczony zanurzeniem",
  "Engaged in fishing": "Prowadzi połowy",
};
const NAV_STATUS_IT = {
  "At anchor": "All'ancora",
  "Under way using engine": "In navigazione (motore)",
  "Under way": "In navigazione",
  "Moored": "Ormeggiato",
  "Alongside": "Accosto",
  "Berthed": "In banchina",
  "Sailing": "A vela",
  "Not under command": "Non governabile",
  "Restricted maneuverability": "Manovrabilità limitata",
  "Constrained by her draught": "Limitato dal pescaggio",
  "Engaged in fishing": "Attività di pesca",
};

function t(key) {
  const dict = I18N[LANG];
  return (dict && dict[key]) || key;
}
function tF(key, params) {
  let s = t(key);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.split("{" + k + "}").join(v);
    }
  }
  return s;
}
function trStatus(status) {
  if (LANG === "en" || !status) return status || "—";
  const map = LANG === "pl" ? NAV_STATUS_PL : NAV_STATUS_IT;
  return map[status] || status;
}
function nVessels(n) {
  if (n === 1) return LANG === "en" ? "1 vessel" : t("nVesselsOne");
  const base = t("Vessel");
  if (LANG === "pl") return n + " " + (n < 5 ? "jednostki" : "jednostek");
  return n + " " + (LANG === "it" ? "navi" : "vessels");
}
function photoFallback() {
  return (
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="520">' +
        '<rect width="100%" height="100%" fill="#131e31"/>' +
        '<text x="50%" y="50%" font-size="130" text-anchor="middle" dominant-baseline="middle">⚓</text>' +
        '<text x="50%" y="62%" font-size="26" fill="#8fa2bd" text-anchor="middle">' + t("No photo available") + "</text>" +
        "</svg>"
    )
  );
}

function setLang(l) {
  LANG = l === "pl" || l === "it" ? l : "en";
  localStorage.setItem(LANG_KEY, LANG);
  document.documentElement.lang = LANG;
  const sel = $("lang-select");
  if (sel) sel.value = LANG;
  applyLang();
}

function applyLang() {
  document.documentElement.lang = LANG;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
  const v = selected();
  renderFleetStrip();
  renderBoard();
  renderStats();
  renderTimeline();
  renderDiscover();
  renderAlertsUI();
  renderSelected();
  if (!$("help-overlay").classList.contains("hidden")) renderHelp();
}

/* ---------------- language switcher ---------------- */
{
  const sel = $("lang-select");
  if (sel) {
    sel.value = LANG;
    sel.addEventListener("change", (e) => setLang(e.target.value));
  }
  applyLang();
}

/* ---------------- topbar scroll shadow ---------------- */
window.addEventListener(
  "scroll",
  () => {
    const tb = document.querySelector(".topbar");
    if (tb) tb.classList.toggle("scrolled", window.scrollY > 8);
  },
  { passive: true }
);

/* ---------------- voyage log ---------------- */

function renderVoyageLog(v) {
  const body = $("voyage-log-body");
  if (!body) return;
  if (!v) {
    body.innerHTML = '<p class="tl-empty">—</p>';
    return;
  }
  const evs = loadEvents()
    .filter((e) => e.imo === v.imo && /^Destination:/.test(e.text || ""))
    .slice(0, 4)
    .reverse();
  let html = "";
  if (v.lastPort) {
    html += vlLeg(
      relativeTime(parseMdhms(v.lastPortAtd)),
      "⚓ " + v.lastPort + (v.lastPortAtd ? ' <span class="dim">(' + t("ATD") + " " + v.lastPortAtd + ")</span>" : "")
    );
  }
  evs.forEach((e) => {
    html += vlLeg(relativeTime(new Date(e.t)), "→ " + e.text.replace(/^Destination:\s*/, ""));
  });
  if (v.destination) {
    html += vlLeg(
      relativeTime(parseMdhms(v.eta)),
      '📍 <span class="vl-cur">' + escapeHtml(v.destination) + "</span>" +
        (v.eta ? ' <span class="dim">(' + t("ETA") + " " + v.eta + ")</span>" : "")
    );
  }
  body.innerHTML = html || '<p class="tl-empty">' + t("No voyage history recorded yet.") + "</p>";
}
function vlLeg(time, text) {
  return '<div class="vl-leg"><span class="vl-time">' + time + '</span><span class="vl-dot"></span><span class="vl-text">' + text + "</span></div>";
}

/* ---------------- shareable fleet link ---------------- */

function updateShareUrl() {
  try {
    const u = new URL(location.href);
    if (state.vessels.length) u.searchParams.set("fleet", state.vessels.map((v) => v.imo).join(","));
    else u.searchParams.delete("fleet");
    history.replaceState(null, "", u.toString());
  } catch (_) {}
}
$("share-btn").addEventListener("click", async () => {
  const u = new URL(location.href);
  u.searchParams.set("fleet", state.vessels.map((v) => v.imo).join(","));
  const url = u.origin + u.pathname + "?" + u.searchParams.toString();
  try {
    await navigator.clipboard.writeText(url);
    flash(t("Fleet link copied to clipboard"));
  } catch (_) {
    prompt("Superyacht Tracker", url);
  }
});

/* ---------------- track replay ---------------- */

const REPLAY = {
  map: null,
  interval: null,
  playing: false,
  data: [],
  t: 0,
  t0: 0,
  t1: 1,
  speed: 3,
  markers: {},
  trails: {},
  idx: {},
};

function openReplay() {
  const data = state.vessels
    .map((v) => ({ v, hist: loadHist(v.imo) }))
    .filter((x) => x.hist.length >= 2);
  if (!data.length) {
    flash(t("No recorded positions yet — keep the app open while the fleet is watched."));
    return;
  }
  $("replay-overlay").classList.remove("hidden");
  if (!REPLAY.map) {
    REPLAY.map = L.map("replay-map").setView([30, 0], 3);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap" }).addTo(REPLAY.map);
  }
  const bounds = [];
  const colors = ["#2fa8ff", "#19d3a5", "#f0b429", "#f87171", "#a78bfa", "#f9a8d4", "#fb923c", "#4ade80"];
  let t0 = Infinity;
  let t1 = -Infinity;
  REPLAY.data = data;
  data.forEach((d, i) => {
    const c = colors[i % colors.length];
    if (!REPLAY.markers[d.v.imo]) {
      REPLAY.markers[d.v.imo] = L.marker([d.hist[0].lat, d.hist[0].lon], {
        icon: L.divIcon({
          className: "",
          html: '<div style="width:11px;height:11px;border-radius:50%;background:' + c + ';box-shadow:0 0 8px ' + c + '"></div>',
          iconSize: [11, 11],
          iconAnchor: [5, 5],
        }),
      }).addTo(REPLAY.map);
      REPLAY.trails[d.v.imo] = L.polyline([], { color: c, weight: 2, opacity: 0.85 }).addTo(REPLAY.map);
      REPLAY.idx[d.v.imo] = 0;
    }
    d.hist.forEach((s) => {
      t0 = Math.min(t0, s.t);
      t1 = Math.max(t1, s.t);
      bounds.push([s.lat, s.lon]);
    });
  });
  if (bounds.length) REPLAY.map.fitBounds(bounds, { padding: [30, 30] });
  REPLAY.t0 = t0;
  REPLAY.t1 = Math.max(t1, t0 + 60000);
  REPLAY.t = t0;
  REPLAY.playing = true;
  REPLAY.speed = +$("replay-speed").value;
  $("replay-play").textContent = "⏸";
  $("replay-fill").style.width = "0%";
  fillText("replay-t0", new Date(REPLAY.t0).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  fillText("replay-t1", new Date(REPLAY.t1).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  clearInterval(REPLAY.interval);
  REPLAY.interval = setInterval(replayTick, 250);
}

function replayTick() {
  if (!REPLAY.playing) return;
  const span = REPLAY.t1 - REPLAY.t0;
  REPLAY.t += span * 0.004 * REPLAY.speed;
  if (REPLAY.t >= REPLAY.t1) {
    REPLAY.t = REPLAY.t1;
    REPLAY.playing = false;
    $("replay-play").textContent = "▶";
  }
  $("replay-fill").style.width = ((REPLAY.t - REPLAY.t0) / span) * 100 + "%";
  REPLAY.data.forEach((d) => {
    const h = d.hist;
    let i = REPLAY.idx[d.v.imo] || 0;
    while (i < h.length - 1 && h[i + 1].t <= REPLAY.t) i++;
    REPLAY.idx[d.v.imo] = i;
    REPLAY.markers[d.v.imo].setLatLng([h[i].lat, h[i].lon]);
    REPLAY.trails[d.v.imo].setLatLngs(h.slice(0, i + 1).map((s) => [s.lat, s.lon]));
  });
}

function closeReplay() {
  clearInterval(REPLAY.interval);
  REPLAY.playing = false;
  $("replay-overlay").classList.add("hidden");
}
$("replay-btn").addEventListener("click", () => ensureLeaflet(openReplay));
$("replay-close").addEventListener("click", closeReplay);
$("replay-play").addEventListener("click", () => {
  if (!REPLAY.playing && REPLAY.t >= REPLAY.t1) REPLAY.t = REPLAY.t0;
  REPLAY.playing = !REPLAY.playing;
  $("replay-play").textContent = REPLAY.playing ? "⏸" : "▶";
});
$("replay-speed").addEventListener("change", (e) => {
  REPLAY.speed = +e.target.value;
});
$("replay-overlay").addEventListener("click", (e) => {
  if (e.target === $("replay-overlay")) closeReplay();
});

/* ---------------- radar view ---------------- */

let radarRAF = null;
let radarAngle = 0;

function updateRadarCenter() {
  const v = selected();
  fillText("radar-center", v ? tF("Centre: {name}", { name: v.name }) : "");
}
function startRadar() {
  if (radarRAF) return;
  const loop = () => {
    radarTick();
    radarRAF = requestAnimationFrame(loop);
  };
  loop();
}
function radarTick() {
  const c = $("radar-canvas");
  if (!c) return;
  const ctx = c.getContext("2d");
  const W = c.width;
  const H = c.height;
  const cx = W / 2;
  const cy = H / 2;
  const ref = selected();
  const refPos = ref && ref.position && ref.position.lat != null ? ref.position : null;
  const vessels = state.vessels.filter(
    (v) => v.position && v.position.lat != null && v.position.lon != null && v.imo !== (ref && ref.imo)
  );
  let maxD = 80;
  if (refPos) {
    for (const v of vessels) {
      const d = haversine(refPos.lat, refPos.lon, v.position.lat, v.position.lon);
      if (d > maxD) maxD = d;
    }
    maxD = Math.max(maxD, 30);
  }
  const R = W / 2 - 18;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#050a12";
  ctx.fillRect(0, 0, W, H);
  for (let r = 1; r <= 5; r++) {
    ctx.beginPath();
    ctx.arc(cx, cy, R * (r / 5), 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(47,168,255,.16)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(47,168,255,.10)";
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, H);
  ctx.moveTo(0, cy);
  ctx.lineTo(W, cy);
  ctx.stroke();
  ctx.fillStyle = "#8fa2bd";
  ctx.font = "10px sans-serif";
  ctx.fillText(maxD + " nm", cx + 5, 13);
  ctx.fillText(Math.round(maxD / 2) + " nm", cx + 5, cy + 4);
  ctx.fillText("N", cx - 4, 13);
  radarAngle = (radarAngle + 1.2) % 360;
  const rad = ((radarAngle - 90) * Math.PI) / 180;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, R, rad - 0.5, rad);
  ctx.closePath();
  ctx.fillStyle = "rgba(47,168,255,.09)";
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(rad) * R, cy + Math.sin(rad) * R);
  ctx.strokeStyle = "rgba(47,168,255,.55)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  if (refPos) {
    for (const v of vessels) {
      const d = haversine(refPos.lat, refPos.lon, v.position.lat, v.position.lon);
      const bear = initialBearing(refPos.lat, refPos.lon, v.position.lat, v.position.lon);
      const rr = (d / maxD) * R;
      const a = ((bear - 90) * Math.PI) / 180;
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      const color = DOT_COLOR[statusCategory(v.navStatus)];
      const ping = (Date.now() / 500) % 1;
      ctx.beginPath();
      ctx.arc(x, y, 4 + ping * 10, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.5 * (1 - ping);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.fillStyle = "#e8eef7";
      ctx.font = "11px sans-serif";
      ctx.fillText(v.name, x + 9, y + 4);
    }
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.fillStyle = "#f0b429";
    ctx.fill();
    ctx.fillStyle = "#e8eef7";
    ctx.font = "12px sans-serif";
    ctx.fillText(ref.name, cx + 12, cy + 5);
  }
}

/* ---------------- help & guide ---------------- */

const HELP = [
  {
    title: "Getting started",
    items: [
      "Add any vessel with its 7-digit IMO number in the top bar and press + Track.",
      "Examples: 9692545 (Andromeda), 1009613 (Eclipse), 9811000 (Ever Given).",
      "Your fleet is saved in this browser and restored on your next visit.",
      "Share your whole fleet with one click using the Share fleet button — the link encodes your vessels.",
    ],
  },
  {
    title: "Maps & tracking",
    items: [
      "Live track shows the precise AIS position and 24 h track of the selected vessel.",
      "Fleet view shows every tracked vessel on one map — markers point along their heading.",
      "Ghost track projects where each moving vessel will be in 6 / 12 / 24 h.",
      "Replay plays back the positions this app has recorded since you started watching.",
      "Click a vessel on the map to open its live track.",
    ],
  },
  {
    title: "Fleet management",
    items: [
      "The fleet strip and Fleet Board show every vessel; click one to focus it.",
      "Sort the Fleet Board by any column — speed, destination, ETA, last update.",
      "The stats bar summarises your fleet: under way, at anchor, average speed.",
      "Remove a vessel with the × button on its card.",
    ],
  },
  {
    title: "Voyage intelligence",
    items: [
      "Arrives in shows a live countdown to the reported ETA.",
      "On course compares the vessel's heading with the bearing to its destination.",
      "The progress bar tracks the voyage between the last port (ATD) and destination (ETA).",
      "Voyage history lists the journey observed by this app: last port → destination changes → current destination.",
    ],
  },
  {
    title: "Insights & ambient",
    items: [
      "Behavioral Insights summarise time at anchor vs under way, distance, speeds, arrivals and departures.",
      "Aboard shows the local time at the vessel, plus sunrise, sunset and daylight hours at its position.",
      "Weather and sea state show air temperature, wind, waves, sea temperature and currents near the vessel.",
    ],
  },
  {
    title: "Alerts & radar",
    items: [
      "Enable Alerts and set a distance to get notified when two tracked vessels come close.",
      "The Fleet Radar shows every vessel as a blip — bearing and distance from the selected vessel.",
    ],
  },
  {
    title: "Discovery & settings",
    items: [
      "Discover introduces a new set of famous superyachts every hour — or shuffle them yourself.",
      "Switch colour themes and language from the top bar; your choices are remembered.",
      "Positions come from free AIS and are rounded to ~1° — use Live track for a precise position.",
    ],
  },
];

function renderHelp() {
  const body = $("help-body");
  if (!body) return;
  body.innerHTML = HELP.map(
    (sec) =>
      '<section class="help-section"><h3>' + t(sec.title) + "</h3><ul>" +
      sec.items.map((it) => "<li>" + t(it) + "</li>").join("") +
      "</ul></section>"
  ).join("");
}
$("help-btn").addEventListener("click", () => {
  renderHelp();
  $("help-overlay").classList.remove("hidden");
});
$("help-close").addEventListener("click", () => {
  $("help-overlay").classList.add("hidden");
});
$("help-overlay").addEventListener("click", (e) => {
  if (e.target === $("help-overlay")) $("help-overlay").classList.add("hidden");
});

/* ---------------- fetching ---------------- */

async function fetchVessel(imo) {
  const res = await fetch("/api/vessel?imo=" + imo);
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error((data && data.error) || "Vessel not found");
  return data.vessel;
}

async function refreshVessel(imo) {
  try {
    const v = await fetchVessel(imo);
    const i = state.vessels.findIndex((x) => x.imo === imo);
    const prev = i >= 0 ? state.vessels[i] : null;
    if (i >= 0) state.vessels[i] = v;
    saveData(v);
    logChanges(prev, v);
    updateStats(v);
    renderFleetStrip();
    renderBoard();
    renderStats();
    if (state.selectedImo === imo) renderSelected();
  } catch (_) {
    /* keep cached data */
  }
}

async function refreshAll() {
  const imos = state.vessels.map((v) => v.imo);
  await Promise.allSettled(imos.map((imo) => refreshVessel(imo)));
  checkProximity();
}

/* ---------------- add / remove / select ---------------- */

async function addVessel(imo) {
  imo = String(imo || "").replace(/\D/g, "");
  if (!/^\d{7}$/.test(imo)) {
    flash(t("Enter a valid 7-digit IMO number"));
    return;
  }
  if (state.vessels.some((v) => v.imo === imo)) {
    selectVessel(imo);
    return;
  }
  const btn = $("add-btn");
  btn.disabled = true;
  btn.textContent = "…";
  try {
    const v = await fetchVessel(imo);
    state.vessels.push(v);
    saveData(v);
    saveIMOs();
    updateShareUrl();
    logEvent(v.imo, v.name, t("Added to fleet"));
    renderFleetStrip();
    renderBoard();
    renderStats();
    renderDiscover();
    checkProximity();
    selectVessel(imo);
    flash(tF("Tracking {name} ({imo})", { name: v.name, imo }));
  } catch (err) {
    flash(tF("Could not add vessel: {msg}", { msg: err.message }));
  } finally {
    btn.disabled = false;
    btn.textContent = "+ Track";
  }
}

function removeVessel(imo) {
  state.vessels = state.vessels.filter((v) => v.imo !== imo);
  localStorage.removeItem(dataKey(imo));
  saveIMOs();
  updateShareUrl();
  renderFleetStrip();
  renderBoard();
  renderStats();
  renderDiscover();
  checkProximity();
  if (state.selectedImo === imo) {
    const next = state.vessels[0];
    if (next) selectVessel(next.imo);
    else {
      state.selectedImo = null;
      localStorage.removeItem(K_SELECTED);
      renderSelected();
    }
  }
}

function selectVessel(imo) {
  if (!state.vessels.some((v) => v.imo === imo)) return;
  state.selectedImo = imo;
  localStorage.setItem(K_SELECTED, imo);
  renderFleetStrip();
  renderBoard();
  renderSelected();
  switchTab("live");
}

/* ---------------- fleet strip ---------------- */

function renderFleetStrip() {
  const scroll = $("fleet-scroll");
  const hint = $("fleet-hint");
  if (!state.vessels.length) {
    scroll.innerHTML = "";
    hint.style.display = "block";
    return;
  }
  hint.style.display = "none";
  scroll.innerHTML = state.vessels
    .map((v) => {
      const active = v.imo === state.selectedImo ? " active" : "";
      const pos = fmtLatLon(v);
      return (
        '<button class="fleet-card' + active + '" data-imo="' + v.imo + '">' +
        '<img src="' + (v.photo || photoFallback()) + '" alt="">' +
        '<span class="fc-info">' +
        '<span class="fc-name">' + escapeHtml(v.name) + "</span>" +
        '<span class="fc-meta">' + escapeHtml(v.type || t("Vessel")) + " · IMO " + v.imo + "</span>" +
        '<span class="fc-status">' + escapeHtml(trStatus(v.navStatus)) + " · " + pos + "</span>" +
        "</span>" +
        '<span class="fc-remove" data-remove="' + v.imo + '" title="Remove">&times;</span>' +
        "</button>"
      );
    })
    .join("");
}

$("fleet-scroll").addEventListener("click", (e) => {
  const remove = e.target.closest("[data-remove]");
  if (remove) {
    e.preventDefault();
    e.stopPropagation();
    removeVessel(remove.getAttribute("data-remove"));
    return;
  }
  const card = e.target.closest(".fleet-card");
  if (card) selectVessel(card.getAttribute("data-imo"));
});

/* ---------------- selected vessel rendering ---------------- */

function selected() {
  return state.vessels.find((v) => v.imo === state.selectedImo) || null;
}

function setStatusPill(status) {
  const pill = $("nav-status-pill");
  if (!pill) return;
  const s = String(status || "").toLowerCase();
  const underway = /under way|sailing|navigat|making way|engine/.test(s);
  const anchored = /anchor|moored|alongside|berthed/.test(s);
  pill.textContent = trStatus(status);
  pill.classList.toggle("warn", underway);
  pill.classList.toggle("warn", !anchored && !underway && !!status);
}

function renderSelected() {
  const v = selected();
  document.title = "Superyacht Tracker";

  fillText("vessel-name", v ? v.name : t("No vessel selected"));
  fillText("vessel-type", v ? (v.type || t("Vessel")) : "—");
  fillText(
    "vessel-sub",
    v
      ? "IMO " + v.imo + " · MMSI " + (v.mmsi || "—") + " · " + t("Callsign") + " " + (v.callsign || "—")
      : "—"
  );
  fillText("flag-badge", v ? flagEmoji(v.flagCode) : "🏴");

  $("vessel-photo").src = v && v.photo ? v.photo : photoFallback();
  setStatusPill(v ? v.navStatus : null);

  fillHtml("stat-loa", v ? (spec(v, "Length Overall") || "—") + "<em> m</em>" : "—");
  fillHtml("stat-beam", v ? (spec(v, "Beam") || "—") + "<em> m</em>" : "—");
  fillText("stat-gt", v ? fmtNum(spec(v, "Gross Tonnage") || "—") : "—");
  fillText("stat-built", v ? (spec(v, "Year of Build") || "—") : "—");

  fillText("nav-status", v ? trStatus(v.navStatus) : "—");
  fillText("region", v ? (v.region || "—") : "—");
  const sog = v && v.position && v.position.sog != null ? v.position.sog.toFixed(1) : "—";
  const cog = v && v.position && v.position.cog != null ? v.position.cog : "—";
  fillText("sog", sog);
  fillText("cog", cog);
  fillText("destination", v ? (v.destination || "—") : "—");

  /* Voyage */
  fillText("v-dest", v ? (v.destination || "—") : "—");
  fillText("v-eta", v ? (v.eta || "—") : "—");
  fillText("v-status", v ? trStatus(v.navStatus) : "—");
  fillText("v-sog", sog);
  fillText("v-cog", cog);
  fillText("v-draught", v ? (v.draught || "—") : "—");
  fillText("v-lastrep", relativeTime(lastSeenDate(v)));
  fillText(
    "v-lastport",
    v ? (v.lastPort || "—") + (v.lastPortAtd ? ' <span class="dim">(' + t("ATD") + " " + v.lastPortAtd + ")</span>" : "") : "—"
  );

  /* Identification */
  fillText("i-name", v ? v.name : "—");
  fillText("i-imo", v ? v.imo : "—");
  fillText("i-mmsi", v ? (v.mmsi || "—") : "—");
  fillText("i-callsign", v ? (v.callsign || "—") : "—");
  fillText("i-type", v ? (v.type || "—") : "—");
  fillText("i-flag", v ? (v.flag || "—") : "—");
  fillText("i-pos", v ? fmtLatLon(v) : "—");
  fillHtml(
    "i-source",
    v
      ? '<a href="' + v.source + '" target="_blank" rel="noopener">VesselFinder</a>'
      : "—"
  );

  /* Particulars */
  fillText("s-loa", v ? (spec(v, "Length Overall") ? spec(v, "Length Overall") + " m" : "—") : "—");
  fillText("s-beam", v ? (spec(v, "Beam") ? spec(v, "Beam") + " m" : "—") : "—");
  fillText("s-draught", v ? (spec(v, "Draught") ? spec(v, "Draught") + " m" : "—") : "—");
  fillText("s-draught-cur", v ? (v.draught || "—") : "—");
  fillText("s-gt", v ? (spec(v, "Gross Tonnage") ? fmtNum(spec(v, "Gross Tonnage")) : "—") : "—");
  fillText("s-net", v ? (spec(v, "Net Tonnage") || "—") : "—");
  fillText("s-dwt", v ? (spec(v, "Deadweight") ? spec(v, "Deadweight") + " t" : "—") : "—");
  fillText("s-type", v ? (spec(v, "Ship Type") || v.type || "—") : "—");
  fillText("s-flag", v ? (v.flag || "—") : "—");
  fillText("s-built", v ? (spec(v, "Year of Build") || "—") : "—");
  fillText("s-region", v ? (v.region || "—") : "—");

  renderLiveMap();
  renderVoyageIntelligence(v);
  renderVoyageLog(v);
  renderInsights(v);
  renderAboard(v);
  updateRadarCenter();
  loadWeather(v);
}

/* ---------------- maps ---------------- */

function renderLiveMap() {
  const v = selected();
  const holder = $("vfmap");
  if (!v) {
    holder.innerHTML = '<div class="map-fallback">' + t("Select or add a vessel to see its live position and track.") + "</div>";
    return;
  }
  const p = v.position || {};
  const lat = p.lat != null ? p.lat : 30;
  const lon = p.lon != null ? p.lon : 0;
  const url =
    "https://www.vesselfinder.com/aismap?zoom=6&lat=" + lat + "&lon=" + lon +
    "&width=100%25&height=520&names=true&imo=" + v.imo +
    "&track=true&fleet=false&fleet_name=false&clicktoact=false&store_pos=true" +
    "&ra=" + encodeURIComponent(location.origin);
  holder.innerHTML =
    '<iframe src="' + url +
    '" frameborder="0" width="100%" height="520" allowfullscreen title="' +
    tF("Live AIS map of {name}", { name: v.name }) + '"></iframe>';
}

function ensureLeaflet(cb) {
  if (window.L) return cb();
  if (document.getElementById("leaflet-js")) {
    const tryL = setInterval(() => {
      if (window.L) {
        clearInterval(tryL);
        cb();
      }
    }, 150);
    return;
  }
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
  document.head.appendChild(link);
  const script = document.createElement("script");
  script.id = "leaflet-js";
  script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
  script.onload = cb;
  script.onerror = () => {
    $("fleetmap").innerHTML =
      '<div class="map-fallback">' + t("Could not load the fleet map (Leaflet CDN unreachable).") + "</div>";
  };
  document.head.appendChild(script);
}

function ensureCluster(cb) {
  if (!window.L) return;
  if (L.markerClusterGroup) return cb();
  if (document.getElementById("leaflet-cluster-js")) return setTimeout(() => ensureCluster(cb), 200);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css";
  document.head.appendChild(link);
  const link2 = document.createElement("link");
  link2.rel = "stylesheet";
  link2.href = "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css";
  document.head.appendChild(link2);
  const script = document.createElement("script");
  script.id = "leaflet-cluster-js";
  script.src = "https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js";
  script.onload = cb;
  script.onerror = cb; /* fall back to plain markers */
  document.head.appendChild(script);
}

function renderFleetMap() {
  ensureLeaflet(() => {
    if (!state.fleetMap) {
      state.fleetMap = L.map("fleetmap").setView([30, 0], 3);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(state.fleetMap);
    }
    if (state.fleetLayers) state.fleetLayers.forEach((l) => state.fleetMap.removeLayer(l));
    state.fleetLayers = [];

    ensureCluster(() => {
      const group = window.L.markerClusterGroup ? L.markerClusterGroup() : null;
      const add = (l) => {
        if (group) group.addLayer(l);
        else {
          l.addTo(state.fleetMap);
          state.fleetLayers.push(l);
        }
      };
      const bounds = [];

      for (const v of state.vessels) {
        const p = v.position;
        if (!p || p.lat == null || p.lon == null) continue;
        const cat = statusCategory(v.navStatus);
        const color = DOT_COLOR[cat];
        const cog = p.cog != null ? p.cog : 0;

        add(
          L.circle([p.lat, p.lon], {
            radius: 60000,
            color,
            weight: 1,
            opacity: 0.4,
            fillColor: color,
            fillOpacity: 0.06,
            interactive: false,
          })
        );
        add(
          L.marker([p.lat, p.lon], {
            icon: L.divIcon({
              className: "",
              iconSize: [24, 24],
              iconAnchor: [12, 12],
              html:
                '<div class="boat-marker" style="--rot:' + cog + 'deg">' +
                '<svg viewBox="0 0 24 24" width="24" height="24">' +
                '<path fill="' + color + '" d="M12 2 L20 21 L12 17 L4 21 Z"/></svg></div>',
            }),
          }).bindPopup(
            "<strong>" + escapeHtml(v.name) + "</strong><br>" +
              (v.navStatus ? escapeHtml(trStatus(v.navStatus)) + "<br>" : "") +
              (p.sog != null ? p.sog.toFixed(1) + " kn · " : "") +
              (p.cog != null ? Math.round(p.cog) + "°<br>" : "") +
              "≈ " + fmtLatLon(v) +
              (v.destination ? "<br>→ " + escapeHtml(v.destination) : "") +
              '<br><button class="leaflet-select" data-imo="' + v.imo + '">' + t("Show live track") + "</button>"
          )
        );
        bounds.push([p.lat, p.lon]);
      }

      if (state.ghostOn) {
        for (const v of state.vessels) {
          const pts = [0, 6, 12, 24].map((h) => deadReckon(v, h));
          if (!pts[0] || !pts[1]) continue;
          add(
            L.polyline(pts, {
              color: "#a78bfa",
              weight: 2,
              dashArray: "6 8",
              opacity: 0.85,
            })
          );
          const end = pts[pts.length - 1];
          add(
            L.marker(end, {
              icon: L.divIcon({
                className: "",
                iconSize: [12, 12],
                iconAnchor: [6, 6],
                html: '<div class="ghost-end"></div>',
              }),
            }).bindPopup(
              "<strong>" + escapeHtml(v.name) + "</strong><br>" +
                t("Projected position in 24 h") + "<br>≈ " +
                fmtLatLonPair(end[0], end[1])
            )
          );
          bounds.push(end);
        }
      }

      if (group) {
        group.addTo(state.fleetMap);
        state.fleetLayers.push(group);
      }
      if (bounds.length) state.fleetMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 7 });
      else state.fleetMap.setView([30, 0], 3);
      state.fleetMap.invalidateSize();
    });
  });
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".leaflet-select");
  if (btn) selectVessel(btn.getAttribute("data-imo"));
});

/* ---------------- tabs ---------------- */

function switchTab(name) {
  $("tab-live").classList.toggle("active", name === "live");
  $("tab-fleet").classList.toggle("active", name === "fleet");
  $("map-live").classList.toggle("hidden", name !== "live");
  $("map-fleet").classList.toggle("hidden", name !== "fleet");
  if (name === "fleet") renderFleetMap();
}
$("tab-live").addEventListener("click", () => switchTab("live"));
$("tab-fleet").addEventListener("click", () => switchTab("fleet"));

/* ---------------- weather ---------------- */

async function loadWeather(v) {
  const token = ++state.weatherToken;
  const p = (v && v.position) || {};
  const reset = () => {
    fillHtml("w-temp", "—");
    fillHtml("w-wind", "—");
    fillHtml("w-wdir", "—");
    fillHtml("w-gust", "—");
    fillText("weather-updated", v ? t("No position data") : "");
  };
  if (p.lat == null || p.lon == null) return reset();
  const grid = $("weather-grid");
  grid.querySelectorAll(".w-error").forEach((n) => n.remove());
  const airUrl =
    "https://api.open-meteo.com/v1/forecast?latitude=" + p.lat + "&longitude=" + p.lon +
    "&current=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kn";
  const seaUrl =
    "https://marine-api.open-meteo.com/v1/marine?latitude=" + p.lat + "&longitude=" + p.lon +
    "&current=wave_height,wave_direction,wave_period,sea_surface_temperature,ocean_current_velocity,ocean_current_direction";
  try {
    const [airRes, seaRes] = await Promise.all([fetch(airUrl), fetch(seaUrl)]);
    if (!airRes.ok || !seaRes.ok) throw new Error("weather request failed");
    const [air, sea] = await Promise.all([airRes.json(), seaRes.json()]);
    if (token !== state.weatherToken) return;
    const a = air.current;
    const s = sea.current || {};
    fillHtml("w-temp", Math.round(a.temperature_2m) + "<small>°C</small>");
    fillHtml("w-wind", Math.round(a.wind_speed_10m) + "<small> kn</small>");
    fillHtml("w-wdir", a.wind_direction_10m + "° <small>" + compass(a.wind_direction_10m) + "</small>");
    fillHtml("w-gust", Math.round(a.wind_gusts_10m) + "<small> kn</small>");
    fillHtml("w-wave", (s.wave_height != null ? s.wave_height.toFixed(1) : "—") + "<small> m</small>");
    fillHtml("w-wperiod", (s.wave_period != null ? s.wave_period.toFixed(1) : "—") + "<small> s</small>");
    fillHtml("w-sst", (s.sea_surface_temperature != null ? Math.round(s.sea_surface_temperature) : "—") + "<small>°C</small>");
    fillHtml(
      "w-current",
      (s.ocean_current_velocity != null ? (s.ocean_current_velocity * 1.94384).toFixed(1) : "—") +
        "<small> kn" + (s.ocean_current_direction != null ? " " + compass(s.ocean_current_direction) : "") + "</small>"
    );
    fillText("weather-updated", tF("Updated {t}", { t: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }));
  } catch (err) {
    if (token !== state.weatherToken) return;
    $("weather-grid").insertAdjacentHTML(
      "beforeend",
      '<p class="w-error" style="grid-column:1/-1;color:#8fa2bd;font-size:13px">' +
        tF("Weather unavailable ({msg})", { msg: err.message }) + ".</p>"
    );
  }
}

/* ---------------- flash message ---------------- */

let flashTimer = null;
function flash(msg) {
  let el = $("flash");
  if (!el) {
    el = document.createElement("div");
    el.id = "flash";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

/* ---------------- boot ---------------- */

$("add-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("imo-input");
  addVessel(input.value);
  input.value = "";
  input.focus();
});

function updateLastReport() {
  const v = selected();
  if (v) fillText("v-lastrep", relativeTime(lastSeenDate(v)));
}

async function init() {
  fillText("app-version", "v" + VERSION);
  let imos = loadIMOs();
  const fleetParam = new URLSearchParams(location.search).get("fleet");
  if (fleetParam) {
    const parsed = fleetParam
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^\d{7}$/.test(s));
    if (parsed.length) imos = parsed;
  }
  if (!imos.length) imos = ["9692545"];
  for (const imo of imos) {
    const cached = loadData(imo);
    if (cached) state.vessels.push(cached);
  }
  if (state.vessels.length < imos.length) {
    /* some entries had no cached data — refresh everything */
    for (const imo of imos) {
      if (!state.vessels.some((v) => v.imo === imo)) {
        try {
          state.vessels.push(await fetchVessel(imo));
        } catch (_) {}
      }
    }
    saveIMOs();
  }
  const sel = loadSelected() || (state.vessels[0] && state.vessels[0].imo);
  state.selectedImo = state.vessels.some((v) => v.imo === sel) ? sel : (state.vessels[0] && state.vessels[0].imo);
  renderFleetStrip();
  renderBoard();
  renderStats();
  renderTimeline();
  renderAlertsUI();
  renderGhostToggle();
  renderDiscover();
  checkProximity();
  updateShareUrl();
  startRadar();
  renderSelected();
  refreshAll();
  setInterval(updateLastReport, 30000);
  setInterval(() => {
    const v = selected();
    if (v) {
      updateEtaCountdown(v);
      updateAboard(v);
    }
  }, 1000);
  setInterval(() => {
    if (document.visibilityState === "visible") refreshAll();
  }, 5 * 60 * 1000);
  setInterval(renderDiscover, 60000);
}

init();
