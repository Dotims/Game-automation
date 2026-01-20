/**
 * Margonem Captcha Solver
 * Automatycznie rozwiązuje captche "zaznacz odpowiedzi z gwiazdką"
 */

(function() {
    'use strict';

    const CaptchaSolver = {
        config: {
            checkInterval: 1000,     // Jak często sprawdzać czy captcha się pojawiła
            clickDelayMin: 800,      // Minimalny czas między kliknięciami (ms)
            clickDelayMax: 2500,     // Maksymalny czas między kliknięciami (ms)
            confirmDelayMin: 1200,   // Minimalny czas przed "Potwierdzam"
            confirmDelayMax: 3000,   // Maksymalny czas przed "Potwierdzam"
            enabled: true,
            debug: true
        },

        state: {
            isMonitoring: false,
            isSolving: false,        // LOCK - zapobiega wielokrotnym próbom
            lastSolveTime: 0,
            solveCount: 0
        },

        log(message, type = 'info') {
            if (!this.config.debug) return;
            const prefix = '[CaptchaSolver]';
            const timestamp = new Date().toLocaleTimeString();
            switch (type) {
                case 'error': console.error(`${prefix} ${timestamp} - ${message}`); break;
                case 'warning': console.warn(`${prefix} ${timestamp} - ${message}`); break;
                case 'success': console.log(`%c${prefix} ${timestamp} - ${message}`, 'color: #4CAF50'); break;
                default: console.log(`${prefix} ${timestamp} - ${message}`);
            }
        },

        /**
         * Kliknięcie elementu przez Debugger API (wymaga background script)
         * Generuje prawdziwe zdarzenie isTrusted: true
         */
        async clickElement(element) {
            if (!element) return false;
            try {
                // Wybierz element docelowy
                const target = element.querySelector('.background') || element;
                const rect = target.getBoundingClientRect();
                
                // Oblicz środek elementu (względem viewportu)
                const x = Math.round(rect.left + rect.width / 2);
                const y = Math.round(rect.top + rect.height / 2);
                
                this.log(`Wysyłanie trustedClick na (${x}, ${y})`, 'info');
                
                // Wyślij żądanie do background scriptu
                return new Promise((resolve) => {
                    chrome.runtime.sendMessage({ 
                        action: 'trustedClick', 
                        x: x, 
                        y: y 
                    }, (response) => {
                        if (chrome.runtime.lastError) {
                            this.log(`Błąd komunikacji: ${chrome.runtime.lastError.message}`, 'error');
                            resolve(false);
                            return;
                        }
                        
                        if (response && response.success) {
                            // visual feedback (zielona ramka na chwilę)
                            const originalOutline = target.style.outline;
                            target.style.outline = '2px solid #00ff00';
                            setTimeout(() => target.style.outline = originalOutline, 200);
                            resolve(true);
                        } else {
                            this.log(`Błąd kliknięcia backgroundu: ${response?.error}`, 'error');
                            resolve(false);
                        }
                    });
                });

            } catch (e) {
                this.log(`Błąd obliczania pozycji: ${e.message}`, 'error');
                return false;
            }
        },

        /**
         * Wykrywa czy captcha jest widoczna I ma zawartość
         */
        isCaptchaVisible() {
            const captchaLayer = document.querySelector('.captcha-layer');
            if (!captchaLayer) return false;
            
            const style = window.getComputedStyle(captchaLayer);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            
            // Sprawdź czy captcha ma faktyczną zawartość (pytanie)
            const question = captchaLayer.querySelector('.captcha__question');
            return question !== null && question.textContent.trim().length > 0;
        },

        /**
         * Parsuje pytanie i określa jaki wzorzec szukać
         */
        parseQuestion(questionText) {
            const lowerQ = questionText.toLowerCase();
            
            if (lowerQ.includes('gwiazdką') || lowerQ.includes('gwiazdka')) {
                return { type: 'asterisk', pattern: /^\*.*\*$/ };
            }
            if (lowerQ.includes('dolarami') || lowerQ.includes('dolar')) {
                return { type: 'dollar', pattern: /^\$.*\$$/ };
            }
            if (lowerQ.includes('daszkiem') || lowerQ.includes('daszek')) {
                return { type: 'caret', pattern: /^\^.*\^$/ };
            }
            if (lowerQ.includes('procentami') || lowerQ.includes('procent')) {
                return { type: 'percent', pattern: /^%.*%$/ };
            }
            if (lowerQ.includes('wykrzyknikami') || lowerQ.includes('wykrzyknik')) {
                return { type: 'exclaim', pattern: /^!.*!$/ };
            }
            if (lowerQ.includes('ampersand') || lowerQ.includes('&')) {
                return { type: 'ampersand', pattern: /^&.*&$/ };
            }
            if (lowerQ.includes('bez symboli') || lowerQ.includes('bez znaku')) {
                return { type: 'plain', pattern: /^[a-zA-Z0-9]+$/ };
            }
            
            // Domyślnie szukaj gwiazdek
            return { type: 'asterisk', pattern: /^\*.*\*$/ };
        },

        /**
         * Znajduje przyciski do kliknięcia na podstawie wzorca
         */
        findButtonsToClick(pattern) {
            const buttons = document.querySelectorAll('.captcha__buttons .button');
            const toClick = [];
            
            buttons.forEach(btn => {
                const label = btn.querySelector('.label');
                if (label) {
                    const text = label.textContent.trim();
                    if (pattern.test(text)) {
                        toClick.push({ element: btn, text: text });
                    }
                }
            });
            
            return toClick;
        },

        /**
         * Miesza tablicę w losowej kolejności (Fisher-Yates)
         */
        shuffleArray(array) {
            const shuffled = [...array];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            return shuffled;
        },

        /**
         * Losowe opóźnienie
         */
        randomDelay(min, max) {
            return min + Math.random() * (max - min);
        },

        sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        },

        /**
         * Główna funkcja rozwiązująca captchę
         */
        async solveCaptcha() {
            // LOCK - jeśli już rozwiązujemy, nie startuj ponownie
            if (this.state.isSolving) {
                return false;
            }
            
            if (!this.isCaptchaVisible()) {
                return false;
            }

            // Ustaw lock
            this.state.isSolving = true;

            try {
                const questionEl = document.querySelector('.captcha__question');
                if (!questionEl) {
                    // Nie powinno się zdarzyć bo isCaptchaVisible sprawdza pytanie
                    return false;
                }

                const questionText = questionEl.textContent.trim();
                this.log('Rozpoczynam rozwiązywanie captchy...');
                this.log(`Pytanie: "${questionText}"`);

                const { type, pattern } = this.parseQuestion(questionText);
                this.log(`Wykryto wzorzec: ${type}`);

                const buttonsToClick = this.findButtonsToClick(pattern);
                
                if (buttonsToClick.length === 0) {
                    this.log('Nie znaleziono pasujących odpowiedzi!', 'warning');
                    return false;
                }

                // Mieszaj w losowej kolejności
                const shuffled = this.shuffleArray(buttonsToClick);
                this.log(`Znaleziono ${shuffled.length} odpowiedzi: ${shuffled.map(b => b.text).join(', ')}`);

                // Klikaj przyciski z losowym opóźnieniem
                for (let i = 0; i < shuffled.length; i++) {
                    // Sprawdź czy captcha nadal widoczna
                    if (!this.isCaptchaVisible()) {
                        this.log('Captcha zniknęła w trakcie rozwiązywania', 'warning');
                        return false;
                    }

                    const delay = this.randomDelay(this.config.clickDelayMin, this.config.clickDelayMax);
                    this.log(`Czekam ${Math.round(delay)}ms...`);
                    await this.sleep(delay);
                    
                    await this.clickElement(shuffled[i].element);
                    this.log(`Kliknięto: "${shuffled[i].text}"`);
                }

                // Poczekaj przed potwierdzeniem
                const confirmDelay = this.randomDelay(this.config.confirmDelayMin, this.config.confirmDelayMax);
                this.log(`Czekam ${Math.round(confirmDelay)}ms przed potwierdzeniem...`);
                await this.sleep(confirmDelay);
                
                // Kliknij "Potwierdzam"
                const confirmBtn = document.querySelector('.captcha__confirm .button');
                if (confirmBtn && this.isCaptchaVisible()) {
                    await this.clickElement(confirmBtn);
                    this.log('Kliknięto "Potwierdzam"', 'success');
                    this.state.solveCount++;
                    this.state.lastSolveTime = Date.now();
                    
                    // Poczekaj chwilę po rozwiązaniu
                    await this.sleep(1000);
                    return true;
                } else {
                    this.log('Nie znaleziono przycisku potwierdzenia lub captcha zniknęła', 'warning');
                    return false;
                }
            } catch (e) {
                this.log(`Błąd podczas rozwiązywania: ${e.message}`, 'error');
                return false;
            } finally {
                // Zawsze zdejmij lock
                this.state.isSolving = false;
            }
        },

        /**
         * Rozpoczyna monitorowanie captchy
         */
        startMonitoring() {
            if (this.state.isMonitoring) return;
            
            this.state.isMonitoring = true;
            this.log('Rozpoczęto monitorowanie captchy');

            const checkCaptcha = async () => {
                if (!this.config.enabled) return;
                if (this.state.isSolving) return; // Nie sprawdzaj jeśli już rozwiązujemy
                
                if (this.isCaptchaVisible()) {
                    // Dodatkowe losowe opóźnienie przed rozpoczęciem (0.5-1s)
                    const initialDelay = 500 + Math.random() * 500;
                    await this.sleep(initialDelay);
                    
                    if (this.isCaptchaVisible() && !this.state.isSolving) {
                        const solved = await this.solveCaptcha();
                        if (solved) {
                            this.log(`Captcha rozwiązana! (łącznie: ${this.state.solveCount})`, 'success');
                        }
                    }
                }
            };

            this.monitorInterval = setInterval(checkCaptcha, this.config.checkInterval);
        },

        /**
         * Zatrzymuje monitorowanie
         */
        stopMonitoring() {
            if (this.monitorInterval) {
                clearInterval(this.monitorInterval);
                this.monitorInterval = null;
            }
            this.state.isMonitoring = false;
            this.state.isSolving = false;
            this.log('Zatrzymano monitorowanie captchy');
        },

        /**
         * Włącza/wyłącza solver
         */
        toggle(enabled) {
            this.config.enabled = enabled;
            this.log(`Solver ${enabled ? 'włączony' : 'wyłączony'}`);
        },

        /**
         * Ręczne rozwiązanie (do testowania)
         */
        async solveNow() {
            this.state.isSolving = false; // Reset lock
            return await this.solveCaptcha();
        },

        /**
         * Inicjalizacja
         */
        init() {
            this.log('Inicjalizacja solvera captchy');
            this.startMonitoring();
            
            // Eksportuj do window dla debugowania
            window.CaptchaSolver = this;
            
            // Dodaj do MargonemAPI jeśli istnieje
            if (window.MargonemAPI) {
                window.MargonemAPI.captchaSolver = this;
            }
        }
    };

    // Uruchom po załadowaniu
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => CaptchaSolver.init());
    } else {
        CaptchaSolver.init();
    }

})();
