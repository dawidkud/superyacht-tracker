# Superyacht Tracker — Features & Build Details

Web app that tracks vessels (starting with superyacht ANDROMEDA, IMO 9692545) by IMO number, showing live AIS position, photos, details, weather and unique insights.

**Location:** `~/superyacht-tracker`
**Run:** `cd ~/superyacht-tracker && node server.js` → `http://127.0.0.1:8123` (override port with `PORT`)
**Live:** https://superyacht-tracker.onrender.com
**Repo:** https://github.com/dawidkud/superyacht-tracker
**Current version:** v1.0.5 (SemVer tags + GitHub Releases; rollback via Render → Manual Deploy → specific commit/tag)

---

## Features

**Vessel tracking**
- Add any vessel by 7-digit IMO number (e.g. `9682875`, `9811000`)
- Tracked-fleet strip with photo cards — click to focus, `×` to remove
- Fleet, theme, language, activity log and per-vessel data persist in `localStorage`
- Data auto-refreshes every 5 min (and on add/select); positions refresh live
- Shareable fleet link: current fleet encoded in URL (`?fleet=…`), anyone opens the same fleet

**Maps & tracking**
- *Live track* — precise AIS position + 24 h track of the selected vessel (VesselFinder embed, reloads per vessel)
- *Fleet view* — Leaflet overview: heading-rotated boat markers, status-coloured, ~1° uncertainty circles, marker clustering
- *Base layers* — switch between **streets** and **satellite** (Esri) imagery, plus a **nautical-chart overlay** (OpenSeaMap), via the layer control on the fleet map
- *Speed track* — colour-codes each vessel's recorded trail by speed (green = slow → red = fast), with a legend; toggle on the fleet map
- *Measure tool* — click-to-measure great-circle distances on the fleet map (points, dashed line, running total in nm)
- *Ghost track* — projects each moving vessel's future position (6/12/24 h) as a dashed path on the fleet map
- *Track replay* — animated playback of recorded fleet positions (play/pause, 1×/3×/8× speed)

**Fleet-wide visualization**
- Summary stats bar: tracked count, under way, at anchor, avg SOG
- Fleet board: sortable table with status dots, thumbnails and **speed sparklines** (Trend column)
- **Fleet comparison**: pick two vessels → side-by-side overlay comparing 15 specs & live stats
- Activity timeline: records nav-status, speed (≥1 kn) and destination changes observed during refreshes
- **Fleet radar**: canvas command-center radar centred on selected vessel — pulsing status-coloured blips, rotating sweep, range rings in nm

**Per-vessel info panel**
- Hero: photo, name, type, flag, status pill, LOA/beam/gross-tons/built stats, SOG/COG, region, destination
- Voyage Intelligence: destination, ETA, live "arrives in…" countdown, on-course check (heading vs bearing to destination, geocoded), distance to destination, ATD→ETA progress bar
- Voyage history: journey log (last port → observed destination changes → current destination)
- Identification: name, IMO, MMSI, callsign, type, flag, approx. position, source link
- Particulars: dimensions, tonnage, general details (from public AIS registry)
- Behavioral Insights: % time at anchor/under way, distance covered, avg/top speed, longest anchor, arrivals/departures + **speed-history sparkline** — from this app's own observation history
- Aboard ambient: live local time at the vessel (from longitude) + NOAA sunrise/sunset at its position with "sunset in …" countdown
- Weather & sea state: air temp, wind, gusts, waves (height/period), sea temp, ocean current (Open-Meteo + Marine API)
- Nearby Ports & Marinas: the 3 nearest major ports (curated ~100-entry list) with distance, bearing and ETA at current speed, plus tracked vessels within 50 nm of the nearest port

**Alerts**
- Proximity alerts: browser notifications + timeline events when two tracked vessels come within X nm (5/10/25/50), with current-encounter chips

**Discovery & settings**
- Discover tab: rotating set (6 of 12 verified famous superyachts) every hour + Shuffle button; one-click tracking + fun facts
- 4 switchable colour themes (Midnight / Daylight / Emerald / Sunset), persisted
- Language switch: English / Polski / Italiano, persisted, full UI translation
- Help & Guide overlay covering all features (EN/PL/IT)

---

## Build details

| | |
|---|---|
| **Frontend** | `index.html`, `style.css`, `app.js` — vanilla JS, no frameworks (Inter font via Google Fonts) |
| **Backend** | `server.js` — Node.js, zero npm dependencies (built-in `http`/`https`) |
| **Vessel data** | Proxy parses VesselFinder's vessel-details page → clean JSON at `/api/vessel?imo=NNNNNNN` |
| **Photos** | Downloaded + cached to `photos/<imo>.jpg`, served locally |
| **Live map** | VesselFinder `aismap` iframe (IMO/MMSI + track params) |
| **Fleet map** | Leaflet 1.9.4 + markercluster from CDN + OpenStreetMap tiles (streets) · Esri World Imagery (satellite) · OpenSeaMap (charts overlay) |
| **Weather / marine** | Open-Meteo forecast + marine API (wind in knots, current m/s → kn) |
| **Geocoding** | OpenStreetMap Nominatim (cached in localStorage) |
| **Caching** | In-memory 10-min API cache + `localStorage` data cache + photo disk cache + recorded history/stats |
| **Port** | `127.0.0.1:8123` (override with `PORT`); binds `0.0.0.0` when `$PORT` set (Render) |

---

## Deployment & versioning

- **Render** (free tier, auto-deploys on push to `main`); sleeps after ~15 min idle, wakes on request
- **Build:** `yarn install && yarn run build` (no-op) · **Start:** `node server.js`
- **Versioning:** Semantic Versioning — git tags + GitHub Releases (v1.0.0…v1.0.4), version shown in app footer
- **Rollback:** Render → Manual Deploy → specific commit/tag, or `git revert` unwanted commits
- **Temporary public link:** `cloudflared tunnel --url http://127.0.0.1:8123`

**README** (EN/PL/IT): `README.md`, `README.pl.md`, `README.it.md` with a language switcher; screenshot `superyacht-tracker-02.png` at the bottom.

---

## Notes

- Free AIS feed reports positions rounded to ~1°, so fleet-view markers are approximate; use *Live track* for the precise position.
- Track replay, voyage history and behavioral insights build up over time as the app observes each vessel (recorded history in localStorage).
- VesselFinder blocks browser-side fetches (CORS), hence the local Node proxy.
- Built with HTML/CSS/JS + Node.js — **no Java**.
