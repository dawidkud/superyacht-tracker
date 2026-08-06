# 🛥️ Superyacht Tracker <img width="40" height="40" alt="image" src="https://github.com/user-attachments/assets/145a43f1-0de5-4070-a60f-6a2f55993402" />

**English** · [Polski](README.pl.md) · [Italiano](README.it.md)

<p align="left">
  <span style="color:#2fa8ff;font-weight:600">🛰️ Live AIS</span>&nbsp;·&nbsp;
  <span style="color:#19d3a5;font-weight:600">🗺️ Fleet maps</span>&nbsp;·&nbsp;
  <span style="color:#f0b429;font-weight:600">🌬️ Flow layer</span>&nbsp;·&nbsp;
  <span style="color:#ff5d5d;font-weight:600">🔔 Zones &amp; dark-fleet alerts</span>
</p>

Vibe coded in OpenCode

Live AIS vessel tracking by **IMO number** — add any ship, watch your whole fleet, and get insights no other tracker offers for free.

Live demo: **https://superyacht-tracker.onrender.com**

---

## Features

### 🔵 Vessel tracking
- 🚢 Add any vessel by its 7-digit IMO number (e.g. `9682875`, `9811000`)
- 🗂️ Tracked-fleet strip with photo cards — click to focus, remove with one click
- 💾 Fleet, theme, activity log and per-vessel data persist in `localStorage`
- 🔄 Auto-refreshes every 5 minutes; positions refresh live

### 🗺️ Maps
- 📍 <span style="color:#2fa8ff">**Live track**</span> — precise AIS position and 24-hour track of the selected vessel
- 🧭 <span style="color:#2fa8ff">**Fleet view**</span> — all tracked vessels on one map:
  - 🚤 boat markers rotated to **heading** and colour-coded by status
  - ⭕ circles showing the ~1° position uncertainty of the free AIS feed
  - 📦 marker clustering for large fleets
  - 🗃️ switch between **street** and **satellite** (Esri) base layers, or overlay **nautical charts** (OpenSeaMap), with the layer control on the map
  - 📈 <span style="color:#19d3a5">**Speed track**</span> — colour-codes each vessel's recorded trail by speed (green = slow → red = fast)
  - 📏 <span style="color:#19d3a5">**Measure tool**</span> — click-to-measure great-circle distances in nautical miles
  - 💨 <span style="color:#2fa8ff">**Flow layer**</span> — animated wind or sea-current particle overlay fed from an Open-Meteo grid over the current map view
  - 🟥 <span style="color:#ff5d5d">**Alert zones**</span> — draw a geofenced circle on the map; get notified and logged when a tracked vessel enters it
- 👻 <span style="color:#f0b429">**Ghost track**</span> — toggle to project each moving vessel's future position (6/12/24 h) from its course and speed, drawn as a dashed path with the projected 24 h position marked

### 📊 Fleet-wide visualization
- 📋 **Stats bar** — tracked count, under way, at anchor, average speed
- 🧮 **Fleet board** — sortable table (name, type, status, SOG, COG, destination, ETA, last update) with status dots, thumbnails and **speed sparklines** (Trend column); click a row to focus
- ⚖️ **Fleet comparison** — pick two vessels and compare 15 specs & live stats side by side
- 🕒 **Activity timeline** — records nav-status, speed and destination changes as the app watches each vessel

### ✨ Unique features
- 🧭 <span style="color:#2fa8ff">**Voyage intelligence**</span> — live "arrives in …" countdown, on-course check (heading vs bearing to destination), distance to destination, and an ATD→ETA voyage progress bar
- 🌊 <span style="color:#2fa8ff">**Sea-state panel**</span> — waves (height/period/direction), sea temperature and ocean current via Open-Meteo Marine API
- 📈 <span style="color:#19d3a5">**Behavioral insights**</span> — per-vessel % time at anchor vs under way, distance covered, average/top speed, longest anchor, arrivals/departures — computed from this app's own observation history
- 🎞️ **Track replay** — animated playback of the fleet's recorded positions on a map, with play/pause and speed controls
- 🧳 **Voyage history** — per-vessel journey log (last port → observed destination changes → current destination)
- 🔔 <span style="color:#f0b429">**Proximity alerts**</span> — browser notifications and timeline events when two tracked vessels come within a set distance (5/10/25/50 nm), with live encounter chips
- 🌘 <span style="color:#ff5d5d">**Dark-fleet detection**</span> — flags vessels whose AIS report goes quiet (>1 h) or dark (>24 h); logs and notifies on silence and when they report again, with a red/amber "Dark" stat chip, board tag and fleet-card badge
- 🛏️ **Aboard ambient** — live local time at the vessel, sunrise/sunset at its position (NOAA solar calc), and a "sunset in …" countdown
- 📍 **Nearby Ports & Marinas** — the closest major superyacht ports to the selected vessel, with distance, bearing and ETA, plus tracked vessels near the nearest port
- 🌡️ **Weather at position** — live temperature, wind and gusts via Open-Meteo

### 📤 Sharing & command center
- 🔗 **Shareable fleet link** — the current fleet is encoded in the URL (`?fleet=…`), so anyone can open the same fleet with one click
- 📡 <span style="color:#19d3a5">**Fleet radar**</span> — a command-center radar view centred on the selected vessel, with pulsing, status-coloured blips and rotating sweep

### 🎨 Themes & languages
Four switchable colour themes (Midnight, Daylight, Emerald, Sunset) via the top-bar dropdown, plus a language switch for **English, Polski and Italiano** — both persisted between visits.

---

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | Vanilla HTML/CSS/JS — no frameworks |
| Backend | Node.js — zero npm dependencies (built-in `http`/`https`) |
| Vessel data | Local proxy parses VesselFinder's vessel pages → clean JSON |
| Photos | Downloaded and cached locally per vessel |
| Fleet map | Leaflet + OpenStreetMap tiles (streets) + Esri World Imagery (satellite) + OpenSeaMap (charts overlay) + marker clustering |
| Live track | VesselFinder AIS embed |
| **Real-time positions (optional)** | [aisstream.io](https://aisstream.io/) WebSocket feed — precise, live AIS when an `AIS_STREAM_KEY` is set |
| Weather | Open-Meteo (current + Marine API) |
| Flow layer | Open-Meteo grid API (multi-location wind / sea-current) |
| Geocoding | OpenStreetMap Nominatim |

---

## Run locally

```bash
cd superyacht-tracker
# optional — enables the real-time aisstream.io AIS feed (precise live positions)
# get a free key at https://aisstream.io/ and save it in a .env file:
echo "AIS_STREAM_KEY=your-key" > .env
node server.js
# open http://127.0.0.1:8123
```

Override the port with the `PORT` environment variable. The `.env` file is gitignored — on Render set `AIS_STREAM_KEY` as a service environment variable instead.

> Why a backend? VesselFinder blocks browser-side requests (CORS), so a small local proxy fetches and caches the vessel data instead. Likewise, aisstream.io forbids browser connections (and its key must not be exposed), so the WebSocket feed runs on the server and is relayed to the app.

---

## Deployment

Deployed on [Render](https://render.com) (free tier) — public at
**https://superyacht-tracker.onrender.com**.

- **Build command:** `yarn install && yarn run build` (build is a no-op)
- **Start command:** `node server.js`
- Auto-deploys on every push to `main`
- Free tier sleeps after ~15 min of inactivity and wakes on the next request

For an instant temporary public link, run:

```bash
cloudflared tunnel --url http://127.0.0.1:8123
```

---

## Versioning

The project follows **Semantic Versioning** with git tags and [GitHub Releases](https://github.com/dawidkud/superyacht-tracker/releases).

- Each stable milestone is tagged `vX.Y.Z` (`v1.0.0`, `v1.1.0`, …) and published as a Release with a changelog.
- The current release is shown in the app footer.
- **Rolling back:**
  1. **Fast:** in Render → your service → *Manual Deploy → Deploy a specific commit* and paste the tagged commit's hash.
  2. **Permanent:** `git revert` the unwanted commits on `main` and push (keeps history linear and deployable), or point a temporary branch at an older tag.

```bash
git tag -a v1.1.0 -m "v1.1.0 — release notes"
git push origin main --tags
gh release create v1.1.0 --title "v1.1.0" --notes "…"
```

---

## Notes

- Free AIS feeds report positions rounded to ~1°, so fleet-map markers are approximate; use *Live track* for the precise position. When the aisstream.io feed is enabled, positions for tracked vessels are replaced with real-time, precise AIS data (shown by a pulsing "LIVE AIS" chip in the stats bar).
- "On course" and "distance to destination" depend on the destination resolving via OpenStreetMap geocoding.
- Behavioral insights and the activity timeline build up over time as the app observes each vessel.
- For informational purposes only — always verify with official AIS providers before navigation decisions.

---

## License

MIT

---

## Screenshot

![Superyacht Tracker — app overview](superyacht-tracker-02.png)
