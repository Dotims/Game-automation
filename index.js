const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();

chromium.use(stealth);

(async () => {
  try {
    // Łączymy się do otwartej przeglądarki na porcie 9222
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    
    // Pobieramy domyślny kontekst (ten, w którym masz wtyczki)
    const context = browser.contexts()[0]; 
    
    // Otwieramy nową kartę w tym oknie
    const page = await context.newPage();

    console.log('--- Połączono z Twoją przeglądarką ---');

    // Funkcja bezpiecznego klikania (zachowaj ją)
    const humanClick = async (selector) => {
        const box = await page.locator(selector).boundingBox();
        if (box) {
            const x = box.x + box.width / 2 + (Math.random() * 10 - 5);
            const y = box.y + box.height / 2 + (Math.random() * 10 - 5);
            await page.mouse.move(x, y, { steps: 25 }); 
            await page.waitForTimeout(Math.random() * 200 + 50);
            await page.mouse.down();
            await page.waitForTimeout(Math.random() * 150 + 50);
            await page.mouse.up();
        }
    };

    // Wchodzimy do gry (korzystając z Twojego proxy z wtyczki)
    await page.goto('https://www.margonem.pl/');
    console.log('Jesteśmy w grze na Twojej karcie.');

    // Tutaj bot może działać na otwartej sesji
    // Uwaga: Nie zamykaj browser.close(), bo zamknie Ci przeglądarkę!
    
    // Aby skrypt nie zakończył się natychmiast:
    // await new Promise(() => {}); 

  } catch (error) {
    console.error('Błąd połączenia. Czy uruchomiłeś Brave z flagą --remote-debugging-port=9222?', error);
  }
})();