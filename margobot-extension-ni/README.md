# MargoSzpont NI - Bot dla Nowego Interfejsu

Bot do gry Margonem.pl przeznaczony dla **Nowego Interfejsu (NI)**.

## Struktura rozszerzenia

```
margobot-extension-ni/
├── manifest.json          # Manifest rozszerzenia Chrome
├── assets/                # Ikony rozszerzenia
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── background/
│   └── service-worker.js  # Background script
├── content/
│   ├── injector.js        # Wstrzykuje skrypty do strony
│   ├── logic.js           # Logika bota (MargonemAPI)
│   └── bot.js             # Panel UI w grze
├── lib/                   # Biblioteki (opcjonalne)
└── popup/
    ├── popup.html         # Popup rozszerzenia
    ├── popup.css          # Style popup
    └── popup.js           # Logika popup (licencja, aktywacja)
```

## Instalacja

1. Otwórz Chrome i przejdź do `chrome://extensions/`
2. Włącz "Tryb programisty" (Developer mode)
3. Kliknij "Załaduj rozpakowane" (Load unpacked)
4. Wybierz folder `margobot-extension-ni`

## Różnice NI vs SI

| Cecha | SI (Stary Interfejs) | NI (Nowy Interfejs) |
|-------|---------------------|---------------------|
| Główny obiekt | `g`, `hero`, `map` | `window.Engine` |
| Dane bohatera | `hero.x`, `hero.hp` | `Engine.hero.d.x`, `Engine.hero.d.warrior_stats.hp` |
| NPC | `g.npc` | `Engine.npcs.getList()` |
| Mapa | `map.name` | `Engine.map.d.name` |
| Walka | `g.battle` | `Engine.battle.active` |

## Użycie

1. Zaloguj się do gry Margonem (nowy interfejs)
2. Kliknij ikonę rozszerzenia w pasku Chrome
3. Wprowadź klucz licencji i aktywuj
4. Kliknij "Uruchom Bota"
5. Panel konfiguracji pojawi się w grze

## Funkcje

- **EXP Mode** - automatyczne walki z mobami w wybranym zakresie poziomów
- **Transport Mode** - automatyczne przechodzenie przez bramy
- **E2 Mode** - polowanie na konkretne potwory (E2)
- **Auto Heal** - automatyczne leczenie
- **Captcha Solver** - automatyczne rozwiązywanie captcha
- **Persistent State** - zapamiętywanie ustawień po odświeżeniu
