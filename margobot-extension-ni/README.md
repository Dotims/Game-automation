# 🤖 MargoSzpont NI - Bot Extension

Rozbudowany bot do gry **Margonem.pl** zaprojektowany wyłącznie pod **Nowy Interfejs (NI)**. Działa w formie rozszerzenia do przeglądarek obsługujących standard Manifest V3, wstrzykując zaawansowane skrypty kontrolne bezpośrednio do obiektu okna gry.

## ✨ Główne Funkcje

- ⚔️ **Auto-Walka (Combat)** - Błyskawiczne inicjowanie i rozwiązywanie walk z potworami (Auto-Fight).
- 🏃‍♂️ **Nawigacja i Pathfinding** - Inteligentne wyszukiwanie drogi na mapie z omijaniem przeszkód (w oparciu o siatkę kolizji) i przechodzenie między mapami (algorytm BFS).
- 💊 **Auto-Leczenie (Healing)** - Automatyczne odnawianie punktów życia z możliwością konfiguracji używania mikstur (pełne leczenie oraz na %).
- 🦇 **Tryb EXP (Exping)** - W pełni zautomatyzowane zdobywanie doświadczenia: bicie mobów, powrót na expowisko po śmierci, omijanie czarnej listy graczy.
- 👹 **Tryb E2 (Elity II)** - Moduł radaru, który automatycznie przerywa bieg/skrypt, aby zaatakować wykryte bossy typu E2.
- 🗺️ **Statyczny Crawler Map** - Wbudowany "cichy" map crawler, pozwalający na skanowanie przejść (gateways) i kolizji map do bazy lokalnej (API integracyjne dostępne z poziomu kodu).
- ⚙️ **Modularne UI (Zarządzanie)** - Przeciągany (`draggable`) i w pełni dynamiczny panel sterujący z widgetami pozwalający na łatwe i wielofunkcyjne zarządzanie pracą bota (panele: *Control Panel, Available Gateways, Navigation, Expowiska, Auto Heal, License Panel*).

## 📁 Struktura Projektu

```text
margobot-extension-ni/
├── manifest.json           # Konfiguracja rozszerzenia (Chrome MV3)
├── background/
│   └── service-worker.js   # Service Worker działający w tle
├── popup/
│   ├── popup.html          # Panel popup w pasku przeglądarki
│   └── popup.js            # Skrypt logiki dla popup'a
├── content/
│   ├── injector.js         # Główny wektor wstrzykiwania kodu (kontekst MAIN do gry)
│   └── captcha_solver.js   # Izolowany skrypt próbujący rozwiązywać instancje captchy
├── src/                    # Główny silnik bota (Modular Engine v5)
│   ├── logic.js            # Mechanika główna gry i stan globalny bota (State)
│   ├── core/               # Konfiguracja systemowa (config.js)
│   ├── data/               # Lokalne paczki danych (map_data.js - siatki/przejścia, e2_data.js)
│   ├── navigation/         # Przemieszczanie się i automatyczne szukanie trasy (algorytmy grafowe)
│   ├── combat/             # Agresja i rozwiązywanie starć
│   ├── healing/            # Zautomatyzowane leczenie postaci
│   ├── exping/             # Zautomatyzowane pozyskiwanie PD i "bocenie" na mapach
│   ├── e2/                 # Moduł dedykowany e2_data i controller.js do wyłapywania bossów
│   ├── utils/              # Potions / Helpers (użytki i skróty wspomagające API gry)
│   └── ui/                 # Złożone, modularne komponenty DOM do panelu wewnątrz gry
├── assets/                 # Ikony rozszerzenia rozmiarów: 16x16, 48x48, 128x128
└── lib/                    # Zależności biblioteczne zewnętrzne (jeśli przewidziano)
```

## 🚀 Instalacja w Chrome / Edge / Brave

1. Pobierz repozytorium na dysk komputera.
2. Otwórz przeglądarkę bazującą na Chromium i wejdź pod adres: `chrome://extensions/`
3. Włącz przełącznik **"Tryb programisty"** (Developer mode) w prawym górnym rogu.
4. Kliknij **"Załaduj rozpakowane"** (Load unpacked) i wskaż rozpakowany katalog główny `margobot-extension-ni`.
5. Wejdź na Margonem.pl (wersja NI - Nowy Interfejs). Bot wstrzyknie kody sekwencyjnie. U dołu / w rogu ekranu z interfejsem gry pojawią się przyciski zarządzania (ikonki radaru/koła).

## 🔧 Konfiguracja bota (Zaawansowane)

Ustawienia zachowania na zablokowanych mapach (omijanie zatorów na poszczególnych poziomach gry) można łatwo konfigurować poprzez modyfikację predefiniowanych zasad w `src/core/config.js`:
```javascript
window.BotConfig.BLOCKED_MAPS = {
    "Zawiły Bór": { minLevel: 100 },
    // Dodaj więcej tutaj...
};
```

## ⚠️ Nota (Disclaimer)

*Skrypt jest narzędziem trzeciej strony. Modyfikuje pamięć podręczną silnika `window.Engine` podczas uruchomienia. Autorzy nie ponoszą odpowiedzialności za błędy logiki prowadzące do ewentualnych konsekwencji wewnątrz gry ze strony administratorów!*
