# 🛥️ Superyacht Tracker

[English](README.md) · [Polski](README.pl.md) · **Italiano**

<p align="left">
  <span style="color:#2fa8ff;font-weight:600">🛰️ AIS live</span>&nbsp;·&nbsp;
  <span style="color:#19d3a5;font-weight:600">🗺️ Mappe flotta</span>&nbsp;·&nbsp;
  <span style="color:#f0b429;font-weight:600">🌬️ Livello di flusso</span>&nbsp;·&nbsp;
  <span style="color:#ff5d5d;font-weight:600">🔔 Zone e avvisi flotta buia</span>
</p>

Codificato a vibe in OpenCode

Tracciamento navale in tempo reale tramite **numero IMO** — aggiungi qualsiasi nave, osserva l'intera flotta e ottieni approfondimenti che nessun altro tracker offre gratuitamente.

Demo live: **https://superyacht-tracker.onrender.com**

---

## Funzionalità

### 🚢 Tracciamento navi
- 🚢 Aggiungi qualsiasi nave con il numero IMO a 7 cifre (es. `9682875`, `9811000`)
- 🗂️ Striscia flotta con schede foto — clicca per selezionare, rimuovi con un clic
- 💾 Flotta, tema, registro attività e dati per nave salvati in `localStorage`
- 🔄 Aggiornamento automatico ogni 5 minuti; posizioni aggiornate in tempo reale

### 🗺️ Mappe
- 📍 <span style="color:#2fa8ff">**Traccia live**</span> — posizione AIS precisa e rotta di 24 ore della nave selezionata
- 🧭 <span style="color:#2fa8ff">**Vista flotta**</span> — tutte le navi tracciate su una mappa:
  - 🚤 markeri orientati secondo la **rotta** e colorati in base allo stato
  - ⭕ cerchi che mostrano l'incertezza di posizione (~1°) del feed AIS gratuito
  - 📦 clustering dei markeri per flotte numerose
  - 🗃️ passaggio tra i livelli base **strade** e **satellite** (Esri), oppure sovrapposizione di **carte nautiche** (OpenSeaMap) tramite il controllo dei livelli sulla mappa
  - 📈 <span style="color:#19d3a5">**Traccia velocità**</span> — colora il percorso registrato di ogni nave in base alla velocità (verde = lenta → rossa = veloce)
  - 📏 <span style="color:#19d3a5">**Strumento Misura**</span> — clicca per misurare distanze ortodromiche in miglia nautiche
  - 💨 <span style="color:#2fa8ff">**Livello di flusso**</span> — particelle animate di vento o corrente marina da una griglia Open-Meteo sull'area della mappa
  - 🟥 <span style="color:#ff5d5d">**Zone di avviso**</span> — disegna un cerchio geofenced sulla mappa; ricevi una notifica e un evento quando una nave tracciata vi entra
- 👻 <span style="color:#f0b429">**Traccia fantasma**</span> — attiva la proiezione della posizione futura di ogni nave in movimento (6/12/24 h) da rotta e velocità, disegnata come linea tratteggiata con la posizione prevista dopo 24 h

### 📊 Visualizzazione flotta
- 📋 **Barra statistiche** — numero tracciato, in navigazione, all'ancora, velocità media
- 🧮 **Tabella flotta** — tabella ordinabile (nome, tipo, stato, SOG, COG, destinazione, ETA, ultimo aggiornamento) con pallini di stato, miniature e **grafici di velocità** (colonna Andamento); clicca una riga per selezionare
- ⚖️ **Confronto flotta** — scegli due navi e confronta 15 parametri e statistiche live affiancate
- 🕒 **Cronologia attività** — registra le variazioni di stato di navigazione, velocità e destinazione osservate dall'app

### ✨ Funzionalità uniche
- 🧭 <span style="color:#2fa8ff">**Intelligenza di viaggio**</span> — conto alla rovescia live per l'ETA, verifica della rotta (rotta vs direzione verso la destinazione), distanza dalla destinazione e barra di avanzamento ATD→ETA
- 🌊 <span style="color:#2fa8ff">**Stato del mare**</span> — onde (altezza/periodo/direzione), temperatura del mare e correnti via Open-Meteo Marine API
- 📈 <span style="color:#19d3a5">**Analisi comportamentale**</span> — % di tempo all'ancora vs in navigazione, distanza percorsa, velocità media/massima, ancora più lunga, arrivi/partenze — calcolata dalla cronologia delle osservazioni di questa app
- 🎞️ **Riproduzione rotta** — riproduzione animata delle posizioni registrate della flotta su una mappa, con comandi play/pausa e velocità
- 🧳 **Cronologia viaggio** — diario di viaggio per nave (ultimo porto → cambi di destinazione osservati → destinazione attuale)
- 🔔 <span style="color:#f0b429">**Avvisi di prossimità**</span> — notifiche del browser ed eventi nella cronologia quando due navi tracciate si avvicinano entro una distanza impostata (5/10/25/50 nm), con chip degli incontri in corso
- 🌘 <span style="color:#ff5d5d">**Rilevamento flotta buia**</span> — segnala le navi il cui report AIS tace (>1 h) o scompare (>24 h); registra e notifica il silenzio e la ripresa del segnale, con statistiche rosso/ambra „Buio", tag nella tabella e badge nella scheda
- 🛏️ **Ambiente a bordo** — ora locale della nave, alba/tramonto nella sua posizione (calcolo NOAA) e conto alla rovescia „tramonto tra …"
- 📍 **Porti e marine vicine** — i porti principali per superyacht più vicini alla nave selezionata, con distanza, rilevamento ed ETA alla velocità attuale, oltre alle navi tracciate vicino al porto più vicino
- 🌡️ **Meteo in posizione** — temperatura, vento e raffiche live via Open-Meteo

### 📤 Condivisione e centro di comando
- 🔗 **Link flotta condivisibile** — la flotta corrente è codificata nell'URL (`?fleet=…`), così chiunque apre la stessa flotta con un clic
- 📡 <span style="color:#19d3a5">**Radar flotta**</span> — vista radar stile centro di comando centrata sulla nave selezionata, con blip pulsanti colorati per stato e sweep rotante

### 🎨 Tema e lingue
Quattro temi colore commutabili (Midnight, Daylight, Emerald, Sunset) dal menu nella barra in alto, più un selettore di lingua **English, Polski e Italiano** — entrambe le scelte vengono ricordate tra le visite.

---

## Stack tecnologico

| Livello | Tecnologia |
| --- | --- |
| Frontend | Vanilla HTML/CSS/JS — nessun framework |
| Backend | Node.js — zero dipendenze npm (`http`/`https` integrati) |
| Dati navi | Proxy locale che analizza le pagine VesselFinder → JSON pulito |
| Foto | Scaricate e memorizzate in locale per ogni nave |
| Mappa flotta | Leaflet + tile OpenStreetMap (strade) + Esri World Imagery (satellite) + OpenSeaMap (carte nautiche) + clustering markeri |
| Traccia live | Embed AIS VesselFinder |
| **Posizioni in tempo reale (opzionale)** | Feed WebSocket [aisstream.io](https://aisstream.io/) — AIS preciso e live quando è impostata `AIS_STREAM_KEY` |
| Meteo | Open-Meteo |
| Geocodifica | OpenStreetMap Nominatim |

---

## Esecuzione locale

```bash
cd superyacht-tracker
# opzionale — abilita il feed AIS in tempo reale di aisstream.io (posizioni precise e live)
# chiave gratuita: https://aisstream.io/ — salvala in un file .env:
echo "AIS_STREAM_KEY=tua-chiave" > .env
node server.js
# apri http://127.0.0.1:8123
```

Puoi cambiare la porta con la variabile d'ambiente `PORT`. Il file `.env` è ignorato da git — su Render imposta `AIS_STREAM_KEY` come variabile d'ambiente del servizio.

> Perché un backend? VesselFinder blocca le richieste dal browser (CORS), quindi un piccolo proxy locale recupera e memorizza i dati delle navi. Allo stesso modo, aisstream.io vieta le connessioni dal browser (e la sua chiave non deve essere esposta), quindi il feed WebSocket gira sul server e viene inoltrato all'app.

---

## Deployment

Distribuito su [Render](https://render.com) (piano gratuito) — pubblico su
**https://superyacht-tracker.onrender.com**.

- **Comando di build:** `yarn install && yarn run build` (build è un no-op)
- **Comando di avvio:** `node server.js`
- Auto-deploy a ogni push su `main`
- Il piano gratuito va in sleep dopo ~15 min di inattività e si riattiva alla richiesta successiva

Per un link pubblico temporaneo immediato:

```bash
cloudflared tunnel --url http://127.0.0.1:8123
```

---

## Versioning

Il progetto segue il **Semantic Versioning** con tag git e [GitHub Releases](https://github.com/dawidkud/superyacht-tracker/releases).

- Ogni traguardo stabile è taggato `vX.Y.Z` (`v1.0.0`, `v1.1.0`, …) e pubblicato come Release con changelog.
- La release corrente è mostrata nel footer dell'app.
- **Rollback:**
  1. **Veloce:** su Render → il tuo servizio → *Manual Deploy → Deploy a specific commit* e incolla l'hash del commit taggato.
  2. **Permanente:** `git revert` dei commit indesiderati su `main` e push (storia lineare e deployabile), oppure punta un ramo temporaneo a un tag più vecchio.

```bash
git tag -a v1.1.0 -m "v1.1.0 — release notes"
git push origin main --tags
gh release create v1.1.0 --title "v1.1.0" --notes "…"
```

---

## Note

- I feed AIS gratuiti riportano posizioni arrotondate a ~1°, quindi i markeri della mappa flotta sono approssimativi; usa *Traccia live* per la posizione precisa. Quando il feed aisstream.io è abilitato, le posizioni delle navi tracciate vengono sostituite con dati AIS precisi in tempo reale (lo segnala il chip pulsante "AIS IN DIRETTA" nella barra delle statistiche).
- „In rotta" e „distanza dalla destinazione" dipendono dalla geocodifica della destinazione via OpenStreetMap.
- L'analisi comportamentale e la cronologia attività crescono nel tempo mentre l'app osserva ogni nave.
- Solo a scopo informativo — verifica sempre con i fornitori AIS ufficiali prima di decisioni di navigazione.

---

## Licenza

MIT

---

## Screenshot

![Superyacht Tracker — panoramica app](superyacht-tracker-02.png)
