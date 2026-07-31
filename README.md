# Superyacht Tracker

Live AIS vessel tracking by **IMO number** — add any ship, watch your whole fleet, and get insights no other tracker offers for free.

Live demo: **https://superyacht-tracker.onrender.com**

---

## Features

### Vessel tracking
- Add any vessel by its 7-digit IMO number (e.g. `9682875`, `9811000`)
- Tracked-fleet strip with photo cards — click to focus, remove with one click
- Fleet, theme, activity log and per-vessel data persist in `localStorage`
- Auto-refreshes every 5 minutes; positions refresh live

### Maps
- **Live track** — precise AIS position and 24-hour track of the selected vessel
- **Fleet view** — all tracked vessels on one map:
  - boat markers rotated to **heading** and colour-coded by status
  - circles showing the ~1° position uncertainty of the free AIS feed
  - marker clustering for large fleets
- **Ghost track** — toggle to project each moving vessel's future position (6/12/24 h) from its course and speed, drawn as a dashed path with the projected 24 h position marked

### Fleet-wide visualization
- **Stats bar** — tracked count, under way, at anchor, average speed
- **Fleet board** — sortable table (name, type, status, SOG, COG, destination, ETA, last update) with status dots and thumbnails; click a row to focus
- **Activity timeline** — records nav-status, speed and destination changes as the app watches each vessel

### Unique features
- **Voyage intelligence** — live "arrives in …" countdown, on-course check (heading vs bearing to destination), distance to destination, and an ATD→ETA voyage progress bar
- **Behavioral insights** — per-vessel % time at anchor vs under way, distance covered, average/top speed, longest anchor, arrivals/departures — computed from this app's own observation history
- **Proximity alerts** — browser notifications and timeline events when two tracked vessels come within a set distance (5/10/25/50 nm), with live encounter chips
- **Aboard ambient** — live local time at the vessel, sunrise/sunset at its position (NOAA solar calc), and a "sunset in …" countdown
- **Weather at position** — live temperature, wind and gusts via Open-Meteo

### Themes
Four switchable colour themes (Midnight, Daylight, Emerald, Sunset) via the top-bar dropdown, persisted between visits.

---

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | Vanilla HTML/CSS/JS — no frameworks |
| Backend | Node.js — zero npm dependencies (built-in `http`/`https`) |
| Vessel data | Local proxy parses VesselFinder's vessel pages → clean JSON |
| Photos | Downloaded and cached locally per vessel |
| Fleet map | Leaflet + OpenStreetMap tiles + marker clustering |
| Live track | VesselFinder AIS embed |
| Weather | Open-Meteo |
| Geocoding | OpenStreetMap Nominatim |

---

## Run locally

```bash
cd superyacht-tracker
node server.js
# open http://127.0.0.1:8123
```

Override the port with the `PORT` environment variable.

> Why a backend? VesselFinder blocks browser-side requests (CORS), so a small local proxy fetches and caches the vessel data instead.

---

## Deployment

Deployed on [Render](https://render.com) (free tier) — public at
**https://superyacht-tracker.onrender.com**.

- **Build command:** `yarn install && yarn run build` (build is a no-op)
- **Start command:** `node server.js`
- Auto-deploys on every push to `main`
- Free tier sleeps after ~15 min of inactivity and wakes on the next request

## Screnshot



---

## Notes

- Free AIS feeds report positions rounded to ~1°, so fleet-map markers are approximate; use *Live track* for the precise position.
- "On course" and "distance to destination" depend on the destination resolving via OpenStreetMap geocoding.
- Behavioral insights and the activity timeline build up over time as the app observes each vessel.
- For informational purposes only — always verify with official AIS providers before navigation decisions.

---

## License

MIT
