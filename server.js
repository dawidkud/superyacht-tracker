"use strict";

/* Dependency-free Node server for the superyacht tracker.
 * - Serves static files
 * - /api/vessel?imo=NNN  -> fetches the VesselFinder details page, parses it
 *                           into clean JSON, downloads + caches the photo
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");

const ROOT = __dirname;
const PORT = process.env.PORT || 8123;
const HOST = process.env.PORT ? "0.0.0.0" : "127.0.0.1";
const PHOTO_DIR = path.join(ROOT, "photos");

/* ---------------- env (.env file, if present) ---------------- */

try {
  const envFile = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
  for (const line of envFile.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined)
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch (_) {}

const AIS_KEY = process.env.AIS_STREAM_KEY || "";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".ico": "image/x-icon",
};

const cache = new Map(); // imo -> { data, at }
const CACHE_TTL = 10 * 60 * 1000; // 10 min

/* ---------------- HTTP helpers ---------------- */

function requestBuffer(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": UA,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(requestBuffer(new URL(res.headers.location, url).toString()));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error("HTTP " + res.statusCode));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const enc = res.headers["content-encoding"];
          if (enc === "gzip") return resolve(zlib.gunzipSync(buf));
          if (enc === "deflate") return resolve(zlib.inflateSync(buf));
          if (enc === "br") return resolve(zlib.brotliDecompressSync(buf));
          resolve(buf);
        });
        res.on("error", reject);
      }
    );
    req.on("error", reject);
  });
}

const requestText = (url) => requestBuffer(url).then((b) => b.toString("utf8"));

/* ---------------- HTML parsing ---------------- */

function decodeEntities(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseVessel(html) {
  const m = (re) => {
    const x = html.match(re);
    return x ? x[1] : null;
  };

  const name = m(/<h1 class="title">([^<]+)<\/h1>/);
  if (!name) return null; // not a vessel details page

  const imo = m(/var vu_imo=(\d{7})/) || m(/IMO\s+(\d{7})/);
  const type = m(/<h2 class="vst">([^,]+),\s*IMO/);
  const mmsi = m(/var MMSI=(\d+)/);
  const callsign = m(/<td class="n3">Callsign<\/td><td class="v3">([^<]*)<\/td>/);

  const flagMatch = html.match(
    /title-flag-icon flag-icon" style="background-image:url\([^)]*flags\/4x3\/([a-z0-9]+)\.svg\)" title="([^"]+)"/
  );
  const flagCode = flagMatch ? flagMatch[1] : null;
  const flag = flagMatch ? flagMatch[2] : null;

  const photo = m(
    /src="(https:\/\/static\.vesselfinder\.net\/ship-photo\/[^"]+)" class="main-photo"/
  );

  let pos = { lat: null, lon: null, sog: null, cog: null };
  const djson = m(/id="djson" data-json='(\{.*?\})'\s*>/);
  if (djson) {
    try {
      const d = JSON.parse(djson.replace(/&quot;/g, '"'));
      pos = {
        lat: d.ship_lat,
        lon: d.ship_lon,
        sog: d.ship_sog,
        cog: d.ship_cog,
      };
    } catch (_) {}
  }

  const region = m(/is\s+at\s+([^<]{2,80}?)\s+reported/);
  const navStatus = m(/data-title="([^"]+)"/);
  const lastSeen = m(
    /data-title="([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}\s+\d{2}:\d{2}\s+UTC)"/
  );

  let destination = null;
  const dm = html.match(
    /vilabel">Destination<\/div>[\s\S]*?(?:<a class="_npNa"[^>]*>([^<]+)<\/a>|<div class="_3-Yih"[^>]*>([^<]+)<\/div>)/
  );
  if (dm) destination = decodeEntities((dm[1] || dm[2] || "").replace(/^=+/, ""));

  const eta = m(/ETA:\s*([^<]+?)\s*<\/span>/);
  const draught = m(
    /<td class="n3">Current draught<\/td><td class="v3">([^<]*)<\/td>/
  );
  const lastPort = m(
    /Last Port<\/div>[\s\S]*?<a class="_npNa"[^>]*>([^<]+)<\/a>/
  );
  const atd = m(/ATD:\s*([^<]+?)\s*<span/);

  const particulars = {};
  const rowRe =
    /<tr><td class="tpc1">([\s\S]*?)<\/td><td class="tpc2">([\s\S]*?)<\/td><\/tr>/g;
  let r;
  while ((r = rowRe.exec(html)) !== null) {
    const label = decodeEntities(r[1].replace(/<small>.*?<\/small>/g, ""));
    const rawVal = r[2];
    const val = /<i/.test(rawVal) ? "" : decodeEntities(rawVal);
    if (label && !(label in particulars)) particulars[label] = val;
  }

  return {
    imo,
    name: decodeEntities(name),
    type: type ? decodeEntities(type) : null,
    flag,
    flagCode,
    mmsi,
    callsign: callsign ? decodeEntities(callsign) : null,
    photo,
    position: pos,
    region: region ? decodeEntities(region) : null,
    navStatus: navStatus ? decodeEntities(navStatus) : null,
    destination,
    eta: eta ? decodeEntities(eta) : null,
    draught: draught ? decodeEntities(draught) : null,
    lastPort: lastPort ? decodeEntities(lastPort) : null,
    lastPortAtd: atd ? decodeEntities(atd) : null,
    lastSeen,
    particulars,
    source: "https://www.vesselfinder.com/vessels/details/" + imo,
  };
}

/* ================================================================
 * aisstream.io real-time AIS feed (optional, needs AIS_STREAM_KEY)
 * A minimal RFC 6455 WebSocket client — no npm dependencies.
 * ================================================================ */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad2 = (n) => String(n).padStart(2, "0");
const trimAis = (s) => String(s == null ? "" : s).replace(/@+$/g, "").trim();
const NAV_TEXT = [
  "Under way using engine", "At anchor", "Not under command", "Restricted manoeuvrability",
  "Constrained by her draught", "Moored", "Aground", "Engaged in fishing", "Under way sailing",
  "", "", "", "", "", "", "Undefined",
];

/* Minimal WebSocket (client) frame layer */
class WS {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.onText = null;
    this.onClose = null;
    socket.on("data", (d) => this.ingest(d));
    socket.on("close", () => this.onClose && this.onClose());
    socket.on("error", () => {});
  }
  ingest(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    this.drain();
  }
  drain() {
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const opcode = b[0] & 0x0f;
      const masked = b[1] & 0x80;
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        len = Number(b.readBigUInt64BE(2));
        off = 10;
      }
      let maskKey = null;
      if (masked) {
        if (b.length < off + 4) return;
        maskKey = b.slice(off, off + 4);
        off += 4;
      }
      if (b.length < off + len) return;
      const pay = b.slice(off, off + len);
      this.buf = b.slice(off + len);
      if (maskKey) {
        for (let i = 0; i < pay.length; i++) pay[i] ^= maskKey[i & 3];
      }
      if (opcode === 0x1 || opcode === 0x2) {
        if (this.onText) this.onText(pay.toString("utf8"));
      } else if (opcode === 0x9) {
        this.sendFrame(0xa, pay); // respond to ping
      } else if (opcode === 0x8) {
        try { this.sendFrame(0x8, pay); } catch (_) {}
        this.socket.end();
        return;
      }
    }
  }
  sendFrame(opcode, payload) {
    const mask = crypto.randomBytes(4);
    const len = payload.length;
    let ext;
    if (len < 126) {
      ext = Buffer.from([0x80 | len]);
    } else if (len < 65536) {
      ext = Buffer.alloc(3);
      ext[0] = 0x80 | 126;
      ext.writeUInt16BE(len, 1);
    } else {
      ext = Buffer.alloc(9);
      ext[0] = 0x80 | 127;
      ext.writeBigUInt64BE(BigInt(len), 1);
    }
    const body = Buffer.from(payload);
    for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3];
    this.socket.write(Buffer.concat([Buffer.from([0x80 | opcode]), ext, mask, body]));
  }
  sendText(s) { this.sendFrame(0x1, Buffer.from(s, "utf8")); }
  sendPing() { this.sendFrame(0x9, Buffer.alloc(0)); }
}

const AIS_URL = "wss://stream.aisstream.io/v0/stream";
const AIS_BOX_MARGIN = 2; // degrees around each vessel's last-known position
const AIS_DEFAULT_BOX = [[38.5, 7.5], [42.5, 19.0]]; // fallback: central Mediterranean

/* Feed controller */
const ais = {
  key: AIS_KEY,
  on: !!AIS_KEY,
  status: "off",
  ws: null,
  cache: new Map(), // mmsi -> latest datum
  fleet: new Map(), // mmsi -> { imo, lat, lon } (desired)
  boxes: [AIS_DEFAULT_BOX],
  backoff: 0,
  lastSend: 0,
  pingTimer: null,
  subTimer: null,
  reconnectTimer: null,
};

function aisBoxes() {
  const boxes = [];
  for (const v of ais.fleet.values()) {
    if (v.lat == null || v.lon == null) continue;
    const lat1 = Math.max(-90, Math.min(90, v.lat - AIS_BOX_MARGIN));
    const lat2 = Math.max(-90, Math.min(90, v.lat + AIS_BOX_MARGIN));
    boxes.push([[lat1, v.lon - AIS_BOX_MARGIN], [lat2, v.lon + AIS_BOX_MARGIN]]);
  }
  return boxes.length ? boxes : [AIS_DEFAULT_BOX];
}

/* NOTE: aisstream's FiltersShipMMSI filter is currently broken (see
 * aisstream/issues #197, #108) — it silently drops every message when set.
 * So we subscribe to bounding boxes around each tracked vessel's last-known
 * position and filter by MMSI on our side instead. */
function aisSubJson() {
  return JSON.stringify({
    APIKey: ais.key,
    BoundingBoxes: ais.boxes,
    FilterMessageTypes: [
      "PositionReport",
      "ExtendedClassBPositionReport",
      "StandardClassBPositionReport",
      "ShipStaticData",
    ],
  });
}

function aisResubscribe() {
  if (!ais.on || !ais.ws) return;
  const now = Date.now();
  if (now - ais.lastSend < 10000) return; // aisstream limits to ~1 subscription update/sec
  ais.lastSend = now;
  try { ais.ws.sendText(aisSubJson()); } catch (_) {}
}

function aisSetFleet(list) {
  ais.fleet = new Map();
  for (const x of list) {
    if (x && x.imo && x.mmsi) {
      ais.fleet.set(String(x.mmsi), {
        imo: String(x.imo),
        lat: x.lat != null ? +x.lat : null,
        lon: x.lon != null ? +x.lon : null,
      });
    }
  }
  ais.boxes = aisBoxes();
  ais.lastSend = 0; // force a fresh subscription with the new filter
  aisResubscribe();
}

function aisIngest(msg) {
  if (!msg || typeof msg !== "object") return;
  const meta = msg.MetaData || {};
  const mmsi = meta.MMSI != null ? String(meta.MMSI) : null;
  if (!mmsi || !ais.fleet.has(mmsi)) return; // only keep vessels we track
  const rec = ais.cache.get(mmsi) || { mmsi, ts: 0 };
  rec.ts = Date.now();
  if (meta.latitude != null) rec.lat = +meta.latitude;
  if (meta.longitude != null) rec.lon = +meta.longitude;
  if (meta.ShipName) rec.name = trimAis(meta.ShipName);

  const M = msg.Message || {};
  const pick = (p) => {
    if (!p) return;
    if (p.Latitude != null) rec.lat = +p.Latitude;
    if (p.Longitude != null) rec.lon = +p.Longitude;
    if (p.Sog != null) rec.sog = +p.Sog;
    if (p.Cog != null) rec.cog = +p.Cog;
    if (p.TrueHeading != null) rec.heading = +p.TrueHeading;
    if (p.NavigationalStatus != null) rec.navStatus = +p.NavigationalStatus;
  };
  if (msg.MessageType === "PositionReport") pick(M.PositionReport);
  else if (msg.MessageType === "ExtendedClassBPositionReport") pick(M.ExtendedClassBPositionReport);
  else if (msg.MessageType === "StandardClassBPositionReport") pick(M.StandardClassBPositionReport);
  else if (msg.MessageType === "ShipStaticData") {
    const s = M.ShipStaticData;
    if (s) {
      if (s.Name) rec.name = trimAis(s.Name);
      if (s.Destination != null) rec.destination = trimAis(s.Destination);
      if (s.ImoNumber != null) rec.imo = String(s.ImoNumber);
      if (s.MaximumStaticDraught != null) rec.draught = +s.MaximumStaticDraught;
      if (s.Eta) {
        const e = s.Eta;
        if (e.Hour != null && e.Minute != null) {
          const hm = pad2(e.Hour) + ":" + pad2(e.Minute);
          if (e.Month > 0 && e.Day > 0)
            rec.eta = MONTHS[e.Month - 1] + " " + e.Day + " " + hm;
          else if (e.Day > 0) rec.eta = e.Day + " " + hm;
        }
      }
    }
  }
  ais.cache.set(mmsi, rec);
}

function aisScheduleReconnect() {
  if (!ais.on || ais.reconnectTimer) return;
  const delay = Math.min(60000, 5000 * Math.pow(2, ais.backoff++));
  ais.reconnectTimer = setTimeout(() => {
    ais.reconnectTimer = null;
    aisConnect();
  }, delay);
}

function aisConnect() {
  if (!ais.on) return;
  ais.status = "connecting";
  const wsKey = crypto.randomBytes(16).toString("base64");
  const req = https.request({
    hostname: "stream.aisstream.io",
    port: 443,
    path: "/v0/stream",
    method: "GET",
    headers: {
      Host: "stream.aisstream.io",
      Upgrade: "websocket",
      Connection: "Upgrade",
      "Sec-WebSocket-Key": wsKey,
      "Sec-WebSocket-Version": "13",
      "User-Agent": UA,
      Origin: "http://127.0.0.1:8123",
    },
  });
  req.on("upgrade", (res, socket, head) => {
    ais.backoff = 0;
    ais.status = "connected";
    const ws = new WS(socket);
    ais.ws = ws;
    ws.onText = (text) => {
      try { aisIngest(JSON.parse(text)); } catch (_) {}
    };
    ws.onClose = () => {
      ais.ws = null;
      ais.status = "disconnected";
      aisScheduleReconnect();
    };
    if (head && head.length) ws.ingest(head);
    aisResubscribe();
    clearInterval(ais.pingTimer);
    clearInterval(ais.subTimer);
    ais.pingTimer = setInterval(() => { if (ais.ws) ais.ws.sendPing(); }, 30000);
    ais.subTimer = setInterval(aisResubscribe, 60000);
    console.log("aisstream: connected (tracking " + ais.fleet.size + " vessel(s))");
  });
  req.on("response", (res) => { res.resume(); });
  req.on("error", (err) => {
    ais.status = "error";
    aisScheduleReconnect();
    if (ais.backoff === 1) console.error("aisstream: connect failed (" + err.message + ") — will retry");
  });
  req.end();
}

function aisStart() {
  if (ais.on) aisConnect();
}

const AIS_FRESH_MS = 20 * 60000; // treat data older than 20 min as stale

/* Merge the freshest live AIS observation into a VesselFinder vessel object */
function applyLive(vessel) {
  if (!ais.on || !vessel || !vessel.mmsi) return;
  const r = ais.cache.get(String(vessel.mmsi));
  if (!r || r.lat == null || r.lon == null) return;
  vessel.position = vessel.position || {};
  vessel.position.lat = r.lat;
  vessel.position.lon = r.lon;
  if (r.sog != null) vessel.position.sog = r.sog;
  if (r.cog != null) vessel.position.cog = r.cog;
  if (r.heading != null) vessel.position.heading = r.heading;
  if (r.navStatus != null && NAV_TEXT[r.navStatus]) vessel.navStatus = NAV_TEXT[r.navStatus];
  if (r.destination) vessel.destination = r.destination;
  if (r.eta) vessel.eta = r.eta;
  vessel.live = Date.now() - r.ts < AIS_FRESH_MS;
}

/* ---------------- Vessel lookup ---------------- */

function ensurePhotoDir() {
  if (!fs.existsSync(PHOTO_DIR)) fs.mkdirSync(PHOTO_DIR, { recursive: true });
}

async function localPhoto(vessel) {
  if (!vessel.photo) return null;
  ensurePhotoDir();
  const file = path.join(PHOTO_DIR, vessel.imo + ".jpg");
  if (!fs.existsSync(file)) {
    try {
      const buf = await requestBuffer(vessel.photo);
      if (buf.length < 1024) throw new Error("tiny payload");
      fs.writeFileSync(file, buf);
    } catch (err) {
      return vessel.photo; // fall back to hotlinking the remote image
    }
  }
  return "/photos/" + vessel.imo + ".jpg";
}

async function lookupVessel(imo) {
  const hit = cache.get(imo);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.data;

  let html;
  try {
    html = await requestText(
      "https://www.vesselfinder.com/vessels/details/" + imo
    );
  } catch (err) {
    throw new Error("Could not reach vessel data source: " + err.message);
  }

  const vessel = parseVessel(html);
  if (!vessel) throw new Error("No vessel found for IMO " + imo);

  vessel.photo = await localPhoto(vessel);
  cache.set(imo, { data: vessel, at: Date.now() });
  return vessel;
}

/* ---------------- Static file serving ---------------- */

function serveStatic(req, res, pathname) {
  let filePath = pathname === "/" ? path.join(ROOT, "index.html") : path.join(ROOT, pathname);
  filePath = path.normalize(filePath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": pathname.startsWith("/photos/")
        ? "public, max-age=86400"
        : "no-cache",
    });
    res.end(data);
  });
}

function sendJson(res, code, obj) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/* ================================================================
 * Visitor tracking — hidden dashboard at /whosthere
 * Logs the real client IP, user agent and request counts, and looks
 * up country/city/ISP via ip-api.com (free, no key) with caching and
 * a rate-limited queue (45 lookups/min max).
 * ================================================================ */

const GEO_FIELDS = "status,country,countryCode,city,isp,query";
const ONLINE_MS = 10 * 60000;
const visitors = new Map(); // ip -> visitor record
const geoCache = new Map(); // ip -> { country, countryCode, city, isp }
let geoQueue = [];
let geoTimer = null;

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) {
    const first = String(fwd).split(",")[0].trim();
    if (first) return first;
  }
  return (req.socket && req.socket.remoteAddress) || "?";
}

function httpText(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error("HTTP " + res.statusCode));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

function flushGeo() {
  geoTimer = null;
  if (!geoQueue.length) return;
  const ip = geoQueue.shift();
  if (!ip) {
    geoQueue = [];
    return;
  }
  httpText("http://ip-api.com/json/" + encodeURIComponent(ip) + "?fields=" + GEO_FIELDS)
    .then((txt) => {
      try {
        const d = JSON.parse(txt);
        if (d && d.status === "success") {
          geoCache.set(ip, {
            country: d.country,
            countryCode: d.countryCode,
            city: d.city,
            isp: d.isp,
          });
          const v = visitors.get(ip);
          if (v) {
            v.country = d.country;
            v.countryCode = d.countryCode;
            v.city = d.city;
            v.isp = d.isp;
          }
        }
      } catch (_) {}
    })
    .catch(() => {})
    .finally(() => {
      if (geoQueue.length) geoTimer = setTimeout(flushGeo, 1400); // stay under 45 req/min
    });
}

function trackVisit(req, pathname) {
  const ip = clientIp(req);
  const now = Date.now();
  let v = visitors.get(ip);
  if (!v) {
    v = {
      ip,
      firstSeen: now,
      lastSeen: now,
      count: 0,
      ua: String(req.headers["user-agent"] || "").slice(0, 160),
      paths: new Map(), // pathname -> lastHit
      country: null,
      countryCode: null,
      city: null,
      isp: null,
    };
    visitors.set(ip, v);
  }
  v.lastSeen = now;
  v.ua = String(req.headers["user-agent"] || "").slice(0, 160);
  if (now - (v.paths.get(pathname) || 0) > 60000) {
    v.paths.set(pathname, now);
    v.count++;
  }
  if (!geoCache.has(ip) && !v.country && !geoQueue.includes(ip)) {
    geoQueue.push(ip);
    if (!geoTimer) geoTimer = setTimeout(flushGeo, 500);
  }
  if (visitors.size > 400) {
    for (const [k, x] of visitors) {
      if (now - x.lastSeen > 86400000) visitors.delete(k);
    }
  }
}

function whosthereHtml() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Who's there</title>
<style>
:root{--bg:#0b0f17;--card:#111826;--line:#1f2b3d;--text:#e7edf5;--dim:#7c8aa0;--accent:#19d3a5;}
*{box-sizing:border-box;margin:0;padding:0}
body{font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--text);padding:28px}
h1{font-size:20px;letter-spacing:1px;font-weight:700}
.stats{display:flex;gap:14px;margin:18px 0}
.chip{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 16px}
.chip b{font-size:18px;color:var(--accent);display:block}
.chip span{font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:1px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);font-variant-numeric:tabular-nums}
th{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--dim);background:#0d1420}
td.ip{font-family:ui-monospace,Menlo,monospace;font-size:13px}
.online-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 8px var(--accent);margin-right:8px}
.offline{opacity:.55}
.empty{color:var(--dim);padding:24px;text-align:center}
#last{color:var(--dim);font-size:12px;margin-top:12px}
</style></head><body>
<h1>WHO'S THERE</h1>
<div class="stats">
  <div class="chip"><b id="s-online">0</b><span>Online now</span></div>
  <div class="chip"><b id="s-total">0</b><span>Unique visitors</span></div>
</div>
<table><thead><tr>
<th>Status</th><th>IP</th><th>Country</th><th>City</th><th>ISP</th><th>Requests</th><th>Last seen</th><th>User agent</th>
</tr></thead><tbody id="rows"><tr><td class="empty" colspan="8">Waiting for data…</td></tr></tbody></table>
<div id="last"></div>
<script>
async function refresh(){
  try{
    const r = await fetch("/api/whosthere"); if(!r.ok) throw 0;
    const d = await r.json();
    document.getElementById("s-online").textContent = d.online;
    document.getElementById("s-total").textContent = d.total;
    const flag = (cc) => cc && /^[A-Z]{2}$/.test(cc)
      ? cc.toUpperCase().replace(/./g, c => String.fromCodePoint(127397 + c.charCodeAt(0))) : "";
    const ago = (t) => { const s = Math.max(0, (d.now - t) / 1000); if (s < 60) return Math.floor(s) + "s"; if (s < 3600) return Math.floor(s/60) + "m"; return Math.floor(s/3600) + "h"; };
    document.getElementById("rows").innerHTML = d.visitors.map(v =>
      '<tr class="' + (v.online ? "" : "offline") + '">' +
      '<td><span class="online-dot"></span>' + (v.online ? "now" : ago(v.lastSeen) + " ago") + '</td>' +
      '<td class="ip">' + v.ip.replace("::ffff:", "") + '</td>' +
      '<td>' + flag(v.countryCode) + " " + (v.country || "?") + '</td>' +
      '<td>' + (v.city || "—") + '</td>' +
      '<td>' + (v.isp || "—") + '</td>' +
      '<td>' + v.count + '</td>' +
      '<td>first ' + ago(v.firstSeen) + '</td>' +
      '<td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (v.ua || "—") + '</td>' +
      '</tr>').join("") || '<tr><td class="empty" colspan="8">No visitors yet.</td></tr>';
    document.getElementById("last").textContent = "refreshed " + new Date().toLocaleTimeString();
  } catch(_){}
}
setInterval(refresh, 5000);
refresh();
</script>
</body></html>`;
}

/* ---------------- Server ---------------- */

http
  .createServer((req, res) => {
    const u = new URL(req.url, "http://" + req.headers.host);
    const pathname = decodeURIComponent(u.pathname);

    trackVisit(req, pathname);

    if (pathname === "/whosthere") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(whosthereHtml());
    }

    if (pathname === "/api/whosthere") {
      const now = Date.now();
      const list = Array.from(visitors.values())
        .map((v) => ({
          ip: v.ip,
          firstSeen: v.firstSeen,
          lastSeen: v.lastSeen,
          online: now - v.lastSeen < ONLINE_MS,
          count: v.count,
          ua: v.ua,
          country: v.country,
          countryCode: v.countryCode,
          city: v.city,
          isp: v.isp,
          paths: Array.from(v.paths.keys()),
        }))
        .sort((a, b) => b.lastSeen - a.lastSeen);
      return sendJson(res, 200, {
        ok: true,
        now,
        total: list.length,
        online: list.filter((x) => x.online).length,
        visitors: list,
      });
    }

    if (pathname === "/api/vessel") {
      const imo = (u.searchParams.get("imo") || "").replace(/\D/g, "");
      if (!/^\d{7}$/.test(imo)) {
        return sendJson(res, 400, { ok: false, error: "IMO must be a 7-digit number" });
      }
      lookupVessel(imo)
        .then((vessel) => {
          applyLive(vessel);
          return sendJson(res, 200, { ok: true, vessel });
        })
        .catch((err) => sendJson(res, 404, { ok: false, error: err.message }));
      return;
    }

    if (pathname === "/api/live") {
      const now = Date.now();
      const data = [];
      for (const [mmsi, f] of ais.fleet) {
        const r = ais.cache.get(mmsi);
        if (!r || r.lat == null || r.lon == null) continue;
        if (now - r.ts > AIS_FRESH_MS) continue;
        data.push({
          imo: f.imo,
          mmsi,
          lat: r.lat,
          lon: r.lon,
          sog: r.sog != null ? r.sog : null,
          cog: r.cog != null ? r.cog : null,
          heading: r.heading != null ? r.heading : null,
          navStatus: r.navStatus != null ? NAV_TEXT[r.navStatus] : null,
          destination: r.destination || null,
          eta: r.eta || null,
          ts: r.ts,
        });
      }
      return sendJson(res, 200, { ok: true, live: ais.on ? ais.status : "off", data });
    }

    if (pathname === "/api/fleet" && req.method === "POST") {
      return readBody(req)
        .then((body) => {
          try {
            const obj = JSON.parse(body);
            const list = Array.isArray(obj.vessels) ? obj.vessels : [];
            aisSetFleet(list);
            sendJson(res, 200, { ok: true, live: ais.on ? ais.status : "off" });
          } catch (_) {
            sendJson(res, 400, { ok: false, error: "Bad JSON body" });
          }
        })
        .catch(() => sendJson(res, 400, { ok: false, error: "Bad body" }));
    }

    if (pathname === "/api/vessel" || pathname === "/api") {
      return sendJson(res, 400, { ok: false, error: "Missing ?imo=NNNNNNN" });
    }

    serveStatic(req, res, pathname);
  })
  .listen(PORT, HOST, () => {
    aisStart();
    console.log(
      "Superyacht Tracker running at http://" + HOST + ":" + PORT + " (Ctrl-C to stop)"
    );
    if (!ais.on) console.log("aisstream: AIS_STREAM_KEY not set — live feed disabled");
  });
