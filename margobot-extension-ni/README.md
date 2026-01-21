# MargoSzpont NI - Bot Extension

Bot do gry Margonem.pl dla Nowego Interfejsu (NI).

## 📁 Struktura Projektu

```
margobot-extension-ni/
├── manifest.json           # Konfiguracja rozszerzenia Chrome MV3
├── background/
│   └── service-worker.js   # Service worker
├── popup/
│   ├── popup.html          # Popup rozszerzenia
│   └── popup.js
├── content/
│   ├── injector.js         # Entry point - wstrzykuje src/ do gry
│   └── captcha_solver.js   # Content script - solver captchy
├── src/                    # Kod wstrzykiwany do gry (MAIN world)
│   ├── logic.js            # Główna logika (walka, exp, healing, E2)
│   ├── core/
│   │   └── config.js       # Konfiguracja (BLOCKED_MAPS, ustawienia)
│   ├── data/
│   │   ├── e2_data.js      # Dane bossów E2 i expowisk
│   │   └── map_data.js     # Graf map do pathfindingu
│   ├── navigation/
│   │   └── movement.js     # Nawigacja, pathfinding (BFS)
│   └── ui/
│       └── bot.js          # Interfejs użytkownika (panele EXP, E2)
├── assets/
│   └── icons/              # Ikony rozszerzenia
└── lib/                    # Biblioteki zewnętrzne
```

## 🔧 Kolejność Ładowania Skryptów

```
1. src/data/e2_data.js      → Dane E2
2. src/data/map_data.js     → Dane map
3. src/core/config.js       → Konfiguracja
4. src/logic.js             → Główna logika
5. src/navigation/movement.js → Nawigacja
6. src/ui/bot.js            → UI
```

## 🎮 Tryby

- **EXP Mode** - Automatyczne zdobywanie doświadczenia na expowiskach
- **E2 Mode** - Polowanie na bossy E2

## ⚙️ Konfiguracja

### Blokowane Mapy (`src/core/config.js`)
Mapy, przez które bot nie będzie przechodził jeśli postać ma za niski poziom:
```javascript
window.BotConfig.BLOCKED_MAPS = {
    "Nazwa Mapy": { minLevel: 200 },
    // ...
};
```

## 🛠️ Rozwój

1. Edytuj odpowiedni plik w `src/`
2. Przeładuj rozszerzenie w Chrome (chrome://extensions/ → 🔄)
3. Odśwież stronę gry

## 📝 Notatki

- Rozszerzenie wymaga Chrome Manifest V3
- Wszystkie pliki w `src/` są wstrzykiwane do kontekstu MAIN strony gry
- `content/` zawiera content scripts działające w izolowanym kontekście
