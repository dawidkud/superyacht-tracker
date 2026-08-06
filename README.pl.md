# 🛥️ Superyacht Tracker

[English](README.md) · **Polski** · [Italiano](README.it.md)

<p align="left">
  <span style="color:#2fa8ff;font-weight:600">🛰️ AIS na żywo</span>&nbsp;·&nbsp;
  <span style="color:#19d3a5;font-weight:600">🗺️ Mapy floty</span>&nbsp;·&nbsp;
  <span style="color:#f0b429;font-weight:600">🌬️ Warstwa przepływu</span>&nbsp;·&nbsp;
  <span style="color:#ff5d5d;font-weight:600">🔔 Strefy i alerty „ciemnej floty”</span>
</p>

Wykodowane na vibie w OpenCode

Śledzenie jednostek pływających na żywo za pomocą **numeru IMO** — dodaj dowolną jednostkę, obserwuj całą flotę i korzystaj z funkcji, których żaden inny tracker nie oferuje za darmo.

Wersja demonstracyjna: **https://superyacht-tracker.onrender.com**

---

## Funkcje

### 🚢 Śledzenie jednostek
- 🚢 Dodaj dowolną jednostkę po 7-cyfrowym numerze IMO (np. `9682875`, `9811000`)
- 🗂️ Pasek floty z kartami ze zdjęciami — kliknij, aby zaznaczyć, usuń jednym kliknięciem
- 💾 Flota, motyw, dziennik aktywności i dane jednostek zapisywane w `localStorage`
- 🔄 Automatyczne odświeżanie co 5 minut; pozycje odświeżane na żywo

### 🗺️ Mapy
- 📍 <span style="color:#2fa8ff">**Śledzenie na żywo**</span> — dokładna pozycja AIS i 24-godzinna trasa wybranej jednostki
- 🧭 <span style="color:#2fa8ff">**Widok floty**</span> — wszystkie śledzone jednostki na jednej mapie:
  - 🚤 znaczniki obrócone zgodnie z **kursem** i pokolorowane wg statusu
  - ⭕ koła pokazujące niepewność pozycji (~1°) darmowego kanału AIS
  - 📦 grupowanie znaczników (clustering) dla dużych flot
  - 🗃️ przełączanie między warstwami bazowymi **ulice** i **satelita** (Esri) lub nałożenie **map nawigacyjnych** (OpenSeaMap) — kontrolka warstw na mapie
  - 📈 <span style="color:#19d3a5">**Trasa prędkości**</span> — koloruje zarejestrowaną trasę każdej jednostki wg prędkości (zielony = wolno → czerwony = szybko)
  - 📏 <span style="color:#19d3a5">**Narzędzie pomiaru**</span> — klikaj, aby zmierzyć odległości ortodromiczne w milach morskich
  - 💨 <span style="color:#2fa8ff">**Warstwa przepływu**</span> — animowane cząsteczki wiatru lub prądu morskiego z siatki Open-Meteo dla bieżącego widoku mapy
  - 🟥 <span style="color:#ff5d5d">**Strefy alertów**</span> — narysuj strefę na mapie; otrzymasz powiadomienie i wpis na osi czasu, gdy śledzona jednostka do niej wpłynie
- 👻 <span style="color:#f0b429">**Trasa przewidywana**</span> — przełącznik pokazujący przewidywaną pozycję poruszających się jednostek (6/12/24 h) na podstawie kursu i prędkości, rysowany jako linia przerywana z zaznaczoną pozycją po 24 h

### 📊 Wizualizacja floty
- 📋 **Pasek statystyk** — liczba śledzonych, w drodze, na kotwicy, średnia prędkość
- 🧮 **Tabela floty** — sortowalna tabela (nazwa, typ, status, SOG, COG, cel, ETA, ostatnia aktualizacja) z kropkami statusu, miniaturami i **wykresami prędkości** (kolumna Trend); kliknij wiersz, aby zaznaczyć
- ⚖️ **Porównanie floty** — wybierz dwie jednostki i porównaj 15 parametrów oraz statystyki na żywo obok siebie
- 🕒 **Oś czasu aktywności** — rejestruje zmiany statusu nawigacji, prędkości i celu obserwowane przez aplikację

### ✨ Unikalne funkcje
- 🧭 <span style="color:#2fa8ff">**Inteligencja rejsu**</span> — odliczanie do ETA na żywo, kontrola zgodności z kursem (kurs vs namiar na cel), odległość do celu i pasek postępu rejsu ATD→ETA
- 🌊 <span style="color:#2fa8ff">**Stan morza**</span> — fale (wysokość/okres/kierunek), temperatura morza i prądy oceaniczne z Open-Meteo Marine API
- 📈 <span style="color:#19d3a5">**Analiza zachowania**</span> — % czasu na kotwicy vs w drodze, przebyty dystans, średnia/maks. prędkość, najdłuższa kotwica, przybycia/odejścia — obliczane z historii obserwacji tej aplikacji
- 🎞️ **Odtwarzanie trasy** — animowane odtwarzanie zarejestrowanych pozycji floty na mapie z kontrolą odtwarzania i prędkości
- 🧳 **Historia rejsu** — dziennik podróży jednostki (ostatni port → obserwowane zmiany celu → obecny cel)
- 🔔 <span style="color:#f0b429">**Alerty zbliżeń**</span> — powiadomienia przeglądarki i zdarzenia na osi czasu, gdy dwie śledzone jednostki zbliżą się na zadaną odległość (5/10/25/50 nm), z chipami bieżących spotkań
- 🌘 <span style="color:#ff5d5d">**Wykrywanie „ciemnej floty”**</span> — oznacza jednostki, których raport AIS ucichnie (>1 h) lub zniknie (>24 h); loguje i powiadamia o ciszy oraz o powrocie sygnału, z czerwoną/bursztynową statystyką „Ciemna”, znacznikiem w tabeli i odznaką na karcie
- 🛏️ **Atmosfera na pokładzie** — lokalny czas jednostki, wschód/zachód słońca na jej pozycji (obliczenia NOAA) i odliczanie „zachód za …"
- 📍 **Pobliskie porty i mariny** — najbliższe duże porty superjachtów dla wybranej jednostki, z odległością, namiarem i ETA przy obecnej prędkości, plus śledzone jednostki w pobliżu najbliższego portu
- 🌡️ **Pogoda na pozycji** — temperatura, wiatr i porywy na żywo z Open-Meteo

### 📤 Udostępnianie i centrum dowodzenia
- 🔗 **Link udostępniania floty** — bieżąca flota zakodowana w adresie URL (`?fleet=…`), więc każdy może otworzyć tę samą flotę jednym kliknięciem
- 📡 <span style="color:#19d3a5">**Radar floty**</span> — widok radarowy w stylu centrum dowodzenia, wyśrodkowany na wybranej jednostce, z pulsującymi punktami w kolorach statusu i obracającym się promieniem

### 🎨 Motywy i języki
Cztery przełączalne motywy kolorystyczne (Midnight, Daylight, Emerald, Sunset) z menu w górnym pasku, plus przełącznik języka **English, Polski i Italiano** — oba wybory zapamiętywane między wizytami.

---

## Stos technologiczny

| Warstwa | Technologia |
| --- | --- |
| Frontend | Vanilla HTML/CSS/JS — bez frameworków |
| Backend | Node.js — zero zależności npm (wbudowane `http`/`https`) |
| Dane jednostek | Lokalny proxy parsuje strony VesselFinder → czysty JSON |
| Zdjęcia | Pobierane i zapisywane lokalnie dla każdej jednostki |
| Mapa floty | Leaflet + kafelki OpenStreetMap (ulice) + Esri World Imagery (satelita) + OpenSeaMap (mapy nawigacyjne) + grupowanie znaczników |
| Śledzenie na żywo | Osadzone AIS VesselFinder |
| **Pozycje w czasie rzeczywistym (opcjonalnie)** | Kanał WebSocket [aisstream.io](https://aisstream.io/) — precyzyjne AIS na żywo, gdy ustawione `AIS_STREAM_KEY` |
| Pogoda | Open-Meteo |
| Geokodowanie | OpenStreetMap Nominatim |

---

## Uruchomienie lokalne

```bash
cd superyacht-tracker
# opcjonalnie — włącza kanał AIS aisstream.io w czasie rzeczywistym (precyzyjne pozycje na żywo)
# bezpłatny klucz: https://aisstream.io/ — zapisz go w pliku .env:
echo "AIS_STREAM_KEY=twoj-klucz" > .env
node server.js
# otwórz http://127.0.0.1:8123
```

Port można zmienić zmienną środowiskową `PORT`. Plik `.env` jest ignorowany przez gita — na Render ustaw `AIS_STREAM_KEY` jako zmienną środowiskową usługi zamiast tego.

> Dlaczego backend? VesselFinder blokuje żądania z przeglądarki (CORS), więc mały lokalny proxy pobiera i zapisuje w pamięci podręcznej dane jednostek. Podobnie aisstream.io zabrania połączeń z przeglądarki (i nie wolno ujawniać jego klucza), więc kanał WebSocket działa po stronie serwera i jest przekazywany do aplikacji.

---

## Wdrożenie

Wdrożone na [Render](https://render.com) (darmowy plan) — publicznie pod
**https://superyacht-tracker.onrender.com**.

- **Polecenie budowania:** `yarn install && yarn run build` (build jest no-op)
- **Polecenie startu:** `node server.js`
- Automatyczne wdrażanie po każdym pushu do `main`
- Darmowy plan przechodzi w stan uśpienia po ~15 min bezczynności i budzi się przy następnym żądaniu

Aby uzyskać chwilowy publiczny link, uruchom:

```bash
cloudflared tunnel --url http://127.0.0.1:8123
```

---

## Wersjonowanie

Projekt stosuje **Semantic Versioning** z tagami git i [GitHub Releases](https://github.com/dawidkud/superyacht-tracker/releases).

- Każdy stabilny etap jest oznaczany `vX.Y.Z` (`v1.0.0`, `v1.1.0`, …) i publikowany jako Release z dziennikiem zmian.
- Bieżąca wersja jest pokazywana w stopce aplikacji.
- **Wracanie do poprzedniej wersji:**
  1. **Szybko:** w Render → Twoja usługa → *Manual Deploy → Deploy a specific commit* i wklej hash commitów z taga.
  2. **Na stałe:** `git revert` niechcianych commitów na `main` i push (zachowuje liniową i wdrażalną historię) albo wskaż tymczasową gałąź na starszy tag.

```bash
git tag -a v1.1.0 -m "v1.1.0 — release notes"
git push origin main --tags
gh release create v1.1.0 --title "v1.1.0" --notes "…"
```

---

## Uwagi

- Darmowe kanały AIS podają pozycje zaokrąglone do ~1°, więc znaczniki na mapie floty są przybliżone; dla dokładnej pozycji użyj *Śledzenia na żywo*. Gdy kanał aisstream.io jest włączony, pozycje śledzonych jednostek są zastępowane precyzyjnymi danymi AIS w czasie rzeczywistym (pokazuje to pulsujący znacznik „AIS NA ŻYWO" na pasku statystyk).
- Funkcje „Zgodny z kursem" i „odległość do celu" zależą od poprawnego geokodowania celu przez OpenStreetMap.
- Analiza zachowania i oś czasu aktywności budują się z czasem, gdy aplikacja obserwuje jednostki.
- Informacje mają charakter wyłącznie orientacyjny — przed decyzjami nawigacyjnymi zawsze weryfikuj je u oficjalnych dostawców AIS.

---

## Licencja

MIT

---

## Zrzut ekranu

![Superyacht Tracker — podgląd aplikacji](superyacht-tracker-02.png)
