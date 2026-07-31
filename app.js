"use strict";

/* ------------------------------------------------------------------
 * Multi-vessel tracker for ANDROMEDA & co.
 * Vessel data served by local proxy server.js (/api/vessel?imo=)
 * ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);

const PHOTO_FALLBACK =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="520">' +
      '<rect width="100%" height="100%" fill="#131e31"/>' +
      '<text x="50%" y="50%" font-size="130" text-anchor="middle" dominant-baseline="middle">⚓</text>' +
      '<text x="50%" y="62%" font-size="26" fill="#8fa2bd" text-anchor="middle">No photo available</text>' +
      "</svg>"
  );

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
  if (mins < 1) return "just now";
  if (mins < 60) return mins + " min ago";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + " h ago";
  const days = Math.floor(hrs / 24);
  return days + " day" + (days > 1 ? "s" : "") + " ago";
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
    logEvent(v.imo, v.name, "Nav status: " + (prev.navStatus || "—") + " → " + v.navStatus);
  }
  const ps = prev.position && prev.position.sog;
  const ns = v.position && v.position.sog;
  if (ns != null && ps != null && Math.abs(ns - ps) >= 1) {
    logEvent(v.imo, v.name, "Speed: " + ps.toFixed(1) + " → " + ns.toFixed(1) + " kn");
  }
  if (prev.destination !== v.destination && v.destination) {
    logEvent(v.imo, v.name, "Destination: " + (prev.destination || "—") + " → " + v.destination);
  }
}
function renderTimeline() {
  const el = $("timeline");
  const evs = loadEvents();
  if (!evs.length) {
    el.innerHTML =
      '<p class="tl-empty">No activity recorded yet — events appear as vessels update (status, speed or destination changes).</p>';
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
    { label: "Tracked", value: total, dot: "blue" },
    { label: "Under way", value: u, dot: "green" },
    { label: "At anchor", value: r, dot: "amber" },
    { label: "Avg SOG", value: avg, dot: "blue" },
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
        '<td><div class="vcell"><img class="thumb" src="' + (v.photo || PHOTO_FALLBACK) + '" alt="">' +
        '<div><span class="vname">' + escapeHtml(v.name) + '</span><span class="vimo">IMO ' + v.imo + "</span></div></div></td>" +
        "<td>" + escapeHtml(v.type || "—") + "</td>" +
        '<td><span class="status-cell"><span class="dot ' + DOT_CLASS[cat] + '"></span>' + escapeHtml(v.navStatus || "—") + "</span></td>" +
        '<td class="tnum">' + sog + "</td>" +
        '<td class="tnum">' + cog + "°</td>" +
        "<td>" + escapeHtml(v.destination || "—") + "</td>" +
        "<td>" + escapeHtml(v.eta || "—") + "</td>" +
        "<td>" + relativeTime(lastSeenDate(v)) + "</td>" +
        "</tr>"
      );
    })
    .join("");

  fillText("board-count", list.length + " vessel" + (list.length === 1 ? "" : "s"));
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
    if (seen) seen.textContent = st ? "just started watching" : "";
    body.innerHTML =
      '<p class="tl-empty">Insights build up as this app watches the vessel (status &amp; speed sampled every ~5 min). Check back after a while.</p>';
    return;
  }
  const tot = st.observedMs || 1;
  const ap = (st.anchoredMs / tot) * 100;
  const up = (st.underwayMs / tot) * 100;
  if (seen) seen.textContent = "tracked for " + fmtDur(Date.now() - st.firstSeen);
  body.innerHTML =
    '<div class="ins-bar"><span class="ib-label">At anchor</span><div class="ib-track"><div class="ib-fill amber" style="width:' + ap.toFixed(0) + '%"></div></div><b>' + ap.toFixed(0) + "%</b></div>" +
    '<div class="ins-bar"><span class="ib-label">Under way</span><div class="ib-track"><div class="ib-fill green" style="width:' + up.toFixed(0) + '%"></div></div><b>' + up.toFixed(0) + "%</b></div>" +
    '<div class="ins-grid">' +
    insCell("Distance covered", Math.round(st.distanceNm).toLocaleString() + " nm") +
    insCell("Avg speed", (st.sogN ? (st.sogSum / st.sogN).toFixed(1) : "—") + " kn") +
    insCell("Top speed", st.maxSog ? st.maxSog.toFixed(1) + " kn" : "—") +
    insCell("Longest anchor", fmtDur(st.longestAnchorMs)) +
    insCell("Arrivals", st.arrivals) +
    insCell("Departures", st.departures) +
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
        ocEl.textContent = (ok ? "On course" : "Off course") + " · Δ " + Math.round(delta) + "° (→" + Math.round(bear) + "°)";
        ocEl.className = ok ? "oc-ok" : bad ? "oc-bad" : "oc-amber";
      }
    } else if (ocEl) {
      ocEl.textContent = "Anchored / not moving";
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
    el.textContent = "Now (arrived / overdue)";
    el.className = "oc-amber";
    return;
  }
  el.textContent = "in " + fmtDur(diff);
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
    if (scEl) scEl.textContent = "Polar day/night — no sunrise or sunset";
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
    label = "Sunrise in";
  } else if (utcNow < today.sunset.getTime()) {
    next = today.sunset.getTime();
    label = "Sunset in";
  } else {
    const tmw = sunTimes(v.position.lat, v.position.lon, new Date(now.getTime() + 86400000));
    if (tmw) {
      next = tmw.sunrise.getTime();
      label = "Sunrise in (tomorrow)";
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
  b.textContent = state.settings.notifOn ? "🔔 Alerts on" : "🔕 Alerts off";
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
          const text = vs[i].name + " and " + vs[j].name + " are " + d.toFixed(1) + " nm apart (threshold " + th + " nm)";
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
  { imo: "9693367", name: "Azzam", tag: "181 m · 2013 · World's longest motor yacht", fact: "The longest private motor yacht ever built (180.6 m), launched for a member of the Abu Dhabi royal family." },
  { imo: "1009613", name: "Eclipse", tag: "162.5 m · 2010", fact: "One of the largest yachts ever built — famed for missile-detection systems and an on-board submarine." },
  { imo: "9661792", name: "Dilbar", tag: "156 m · 2016 · Largest by volume", fact: "The world's largest yacht by internal volume (15,917 GT); its swimming pool set a Guinness World Record." },
  { imo: "9692545", name: "Andromeda", tag: "107 m · 2015", fact: "The yacht that started this tracker — a 107 m German-built superyacht." },
  { imo: "9384552", name: "Maltese Falcon", tag: "87 m · 2006 · DynaRig", fact: "Iconic DynaRig sailing yacht with self-standing carbon masts and about 2,800 m² of sail." },
];

function renderDiscover() {
  const grid = $("discover-grid");
  if (!grid) return;
  grid.innerHTML = DISCOVER.map(
    (d) =>
      '<div class="discover-card">' +
      '<div class="dc-name">' + d.name + '</div>' +
      '<div class="dc-tag">' + d.tag + "</div>" +
      '<p class="dc-fact">' + d.fact + "</p>" +
      (state.vessels.some((v) => v.imo === d.imo)
        ? '<button class="mini-btn" disabled>Tracking ✓</button>'
        : '<button class="mini-btn discover-add" data-imo="' + d.imo + '">+ Track</button>') +
      "</div>"
  ).join("");
}

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
    flash("Enter a valid 7-digit IMO number");
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
    logEvent(v.imo, v.name, "Added to fleet");
    renderFleetStrip();
    renderBoard();
    renderStats();
    renderDiscover();
    checkProximity();
    selectVessel(imo);
    flash("Tracking " + v.name + " (" + imo + ")");
  } catch (err) {
    flash("Could not add vessel: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "+ Track";
  }
}

function removeVessel(imo) {
  state.vessels = state.vessels.filter((v) => v.imo !== imo);
  localStorage.removeItem(dataKey(imo));
  saveIMOs();
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
        '<img src="' + (v.photo || PHOTO_FALLBACK) + '" alt="">' +
        '<span class="fc-info">' +
        '<span class="fc-name">' + escapeHtml(v.name) + "</span>" +
        '<span class="fc-meta">' + escapeHtml(v.type || "Vessel") + " · IMO " + v.imo + "</span>" +
        '<span class="fc-status">' + escapeHtml(v.navStatus || "—") + " · " + pos + "</span>" +
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
  pill.textContent = status || "—";
  pill.classList.toggle("warn", underway);
  pill.classList.toggle("warn", !anchored && !underway && !!status);
}

function renderSelected() {
  const v = selected();
  document.title = v ? v.name + " — Superyacht Tracker" : "Superyacht Tracker";

  fillText("vessel-name", v ? v.name : "No vessel selected");
  fillText("vessel-type", v ? (v.type || "Vessel") : "—");
  fillText("vessel-sub", v ? "IMO " + v.imo + " · MMSI " + (v.mmsi || "—") + " · Callsign " + (v.callsign || "—") : "—");
  fillText("flag-badge", v ? flagEmoji(v.flagCode) : "🏴");

  $("vessel-photo").src = v && v.photo ? v.photo : PHOTO_FALLBACK;
  setStatusPill(v ? v.navStatus : null);

  fillHtml("stat-loa", v ? (spec(v, "Length Overall") || "—") + "<em> m</em>" : "—");
  fillHtml("stat-beam", v ? (spec(v, "Beam") || "—") + "<em> m</em>" : "—");
  fillText("stat-gt", v ? fmtNum(spec(v, "Gross Tonnage") || "—") : "—");
  fillText("stat-built", v ? (spec(v, "Year of Build") || "—") : "—");

  fillText("nav-status", v ? (v.navStatus || "—") : "—");
  fillText("region", v ? (v.region || "—") : "—");
  const sog = v && v.position && v.position.sog != null ? v.position.sog.toFixed(1) : "—";
  const cog = v && v.position && v.position.cog != null ? v.position.cog : "—";
  fillText("sog", sog);
  fillText("cog", cog);
  fillText("destination", v ? (v.destination || "—") : "—");

  /* Voyage */
  fillText("v-dest", v ? (v.destination || "—") : "—");
  fillText("v-eta", v ? (v.eta || "—") : "—");
  fillText("v-status", v ? (v.navStatus || "—") : "—");
  fillText("v-sog", sog);
  fillText("v-cog", cog);
  fillText("v-draught", v ? (v.draught || "—") : "—");
  fillText("v-lastrep", relativeTime(lastSeenDate(v)));
  fillText(
    "v-lastport",
    v ? (v.lastPort || "—") + (v.lastPortAtd ? ' <span class="dim">(ATD ' + v.lastPortAtd + ")</span>" : "") : "—"
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
  renderInsights(v);
  renderAboard(v);
  loadWeather(v);
}

/* ---------------- maps ---------------- */

function renderLiveMap() {
  const v = selected();
  const holder = $("vfmap");
  if (!v) {
    holder.innerHTML =
      '<div class="map-fallback">Select or add a vessel to see its live position and track.</div>';
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
    '" frameborder="0" width="100%" height="520" allowfullscreen title="Live AIS map of ' +
    escapeHtml(v.name) + '"></iframe>';
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
      '<div class="map-fallback">Could not load the fleet map (Leaflet CDN unreachable).</div>';
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
              (v.navStatus ? escapeHtml(v.navStatus) + "<br>" : "") +
              (p.sog != null ? p.sog.toFixed(1) + " kn · " : "") +
              (p.cog != null ? Math.round(p.cog) + "°<br>" : "") +
              "≈ " + fmtLatLon(v) +
              (v.destination ? "<br>→ " + escapeHtml(v.destination) : "") +
              '<br><button class="leaflet-select" data-imo="' + v.imo + '">Show live track</button>'
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
              "<strong>" + escapeHtml(v.name) + "</strong><br>Projected position in 24 h<br>≈ " +
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
    fillText("weather-updated", v ? "No position data" : "");
  };
  if (p.lat == null || p.lon == null) return reset();
  const grid = $("weather-grid");
  grid.querySelectorAll(".w-error").forEach((n) => n.remove());
  const url =
    "https://api.open-meteo.com/v1/forecast?latitude=" + p.lat + "&longitude=" + p.lon +
    "&current=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kn";
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("weather request failed");
    const data = await res.json();
    if (token !== state.weatherToken) return;
    const c = data.current;
    fillHtml("w-temp", Math.round(c.temperature_2m) + "<small>°C</small>");
    fillHtml("w-wind", Math.round(c.wind_speed_10m) + "<small> kn</small>");
    fillHtml("w-wdir", c.wind_direction_10m + "° <small>" + compass(c.wind_direction_10m) + "</small>");
    fillHtml("w-gust", Math.round(c.wind_gusts_10m) + "<small> kn</small>");
    fillText("weather-updated", "Updated " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  } catch (err) {
    if (token !== state.weatherToken) return;
    $("weather-grid").insertAdjacentHTML(
      "beforeend",
      '<p class="w-error" style="grid-column:1/-1;color:#8fa2bd;font-size:13px">Weather unavailable (' + err.message + ").</p>"
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
  let imos = loadIMOs();
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
}

init();
