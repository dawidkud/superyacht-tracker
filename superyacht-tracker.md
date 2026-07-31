# Superyacht Tracker — Features & Build Details

Web app that tracks vessels (starting with superyacht ANDROMEDA, IMO 9692545) by IMO number, showing live AIS position, photos, details and weather.

**Location:** `~/superyacht-tracker`
**Run:** `cd ~/superyacht-tracker && node server.js` → `http://127.0.0.1:8123` (override port with `PORT`)

---

## Features

**Vessel tracking**
- Add any vessel by 7-digit IMO number (e.g. `9682875`, `9811000`)
- Tracked-fleet strip with photo cards — click to focus, `×` to remove
- Fleet persisted in `localStorage` (survives reload/restart)
- Data auto-refreshes every 5 min (and on add/select); last-position timestamp updates every 30 s

**Maps (2 views, tabbed)**
- *Live track* — precise AIS position + 24 h track of the selected vessel (VesselFinder embed, reloads per vessel)
- *Fleet view* — Leaflet overview of all tracked vessels; click a marker → jump to live track

**Per-vessel info panel**
- Hero: photo, name, type, flag, status pill, LOA/beam/gross-tons/built stats, SOG/COG, region, destination
- Voyage table: destination, ETA, nav status, speed/course, draught, position received, last port + ATD
- Identification: name, IMO, MMSI, callsign, type, flag, approx. position, source link
- Particulars: dimensions, tonnage, general details (from public AIS registry)
- Live weather at position via Open-Meteo (temp, wind, gusts, direction)

**Fleet-wide visualization**
- Summary stats bar: tracked count, under way, at anchor, avg SOG
- Fleet board: sortable table (name/type/status/SOG/COG/destination/ETA/last update) with status dots and thumbnails; click row to focus
- Upgraded fleet map: heading-rotated boat markers, colour-coded by status, position-uncertainty circles, marker clustering
- Activity timeline: records nav-status, speed (≥1 kn) and destination changes observed during refreshes

**Themes**
- 4 switchable colour themes (Midnight / Daylight / Emerald / Sunset) via CSS custom properties + topbar dropdown, persisted in localStorage

---

## Build details

| | |
|---|---|
| **Frontend** | `index.html`, `style.css`, `app.js` — vanilla JS, no frameworks |
| **Backend** | `server.js` — Node.js, zero npm dependencies (built-in `http`/`https`) |
| **Vessel data** | Proxy parses VesselFinder's vessel-details page → clean JSON at `/api/vessel?imo=NNNNNNN` |
| **Photos** | Downloaded + cached to `photos/<imo>.jpg`, served locally |
| **Live map** | VesselFinder `aismap` iframe (IMO/MMSI + track params) |
| **Fleet map** | Leaflet 1.9.4 from CDN + OpenStreetMap tiles |
| **Weather** | Open-Meteo API (`current=...`, wind in knots) |
| **Caching** | In-memory 10-min API cache + `localStorage` data cache + photo disk cache |
| **Port** | `127.0.0.1:8123` (override with `PORT`) |

---

## Notes

- Free AIS feed reports positions rounded to ~1°, so fleet-view markers are approximate; use *Live track* for the precise position.
- VesselFinder blocks browser-side fetches (CORS), hence the local Node proxy.
- Built with HTML/CSS/JS + Node.js — **no Java**.
