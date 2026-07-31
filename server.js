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

const ROOT = __dirname;
const PORT = process.env.PORT || 8123;
const PHOTO_DIR = path.join(ROOT, "photos");
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

/* ---------------- Server ---------------- */

http
  .createServer((req, res) => {
    const u = new URL(req.url, "http://" + req.headers.host);
    const pathname = decodeURIComponent(u.pathname);

    if (pathname === "/api/vessel") {
      const imo = (u.searchParams.get("imo") || "").replace(/\D/g, "");
      if (!/^\d{7}$/.test(imo)) {
        return sendJson(res, 400, { ok: false, error: "IMO must be a 7-digit number" });
      }
      lookupVessel(imo)
        .then((vessel) => sendJson(res, 200, { ok: true, vessel }))
        .catch((err) => sendJson(res, 404, { ok: false, error: err.message }));
      return;
    }

    if (pathname === "/api/vessel" || pathname === "/api") {
      return sendJson(res, 400, { ok: false, error: "Missing ?imo=NNNNNNN" });
    }

    serveStatic(req, res, pathname);
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(
      "Superyacht Tracker running at http://127.0.0.1:" + PORT + " (Ctrl-C to stop)"
    );
  });
