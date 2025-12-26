const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function solveCaptcha(page) {
    console.log('🧩 Sprawdzam obecność CAPTCHA...');

    // 1. Sprawdź czy CAPTCHA jest widoczna
    const captchaVisible = await page.evaluate(() => {
        const el = document.getElementById('captcha');
        return el && el.style.display !== 'none';
    });

    if (!captchaVisible) {
        return false;
    }

    console.log('🚨 CAPTCHA WYKRYTA! Rozpoczynam rozwiązywanie...');

    // 2. Pobierz treść pytania (dla logów/debugu) i przyciski
    const captchaInfo = await page.evaluate(() => {
        const questionEl = document.querySelector('.captcha__question');
        const question = questionEl ? questionEl.innerText : '';
        
        // Pobierz wszystkie przyciski odpowiedzi
        const buttons = Array.from(document.querySelectorAll('.captcha__buttons .btn')).map((btn, index) => {
            const fontEl = btn.querySelector('.gfont');
            return {
                index: index,
                text: fontEl ? fontEl.getAttribute('name') : '' // 'name' attribute holds the text like *a*
            };
        });

        return { question, buttons };
    });

    console.log(`❓ Pytanie: "${captchaInfo.question}"`);
    console.log(`🔠 Dostępne odpowiedzi:`, captchaInfo.buttons.map(b => b.text));

    // 3. Logika rozwiązywania: "Zaznacz odpowiedzi zawierające gwiazdkę"
    // Szukamy przycisków, które mają znaki '*' w tekście
    const correctButtons = captchaInfo.buttons.filter(btn => btn.text.includes('*'));

    if (correctButtons.length === 0) {
        console.log('⚠️ Nie znaleziono odpowiedzi pasujących do wzorca (*)! Może inna zagadka?');
        return true; // Zwracamy true żeby zatrzymać bota (żeby nie klikał losowo)
    }

    console.log(`✅ Znaleziono ${correctButtons.length} poprawne odpowiedzi:`, correctButtons.map(b => b.text));

    // 4. Klikanie w odpowiedzi (po ludzku, z opóźnieniem)
    for (const btn of correctButtons) {
        // Losowe opóźnienie 800ms - 2500ms między kliknięciami
        const thinkTime = Math.floor(Math.random() * 1700) + 800;
        console.log(`👆 Klikam: "${btn.text}" (zajmie ${thinkTime}ms)`);
        await sleep(thinkTime);

        // Klikamy w przycisk (Index buttona w DOM)
        // nth-child jest 1-indexed, więc index+1
        await page.click(`.captcha__buttons .btn:nth-child(${btn.index + 1})`);
    }

    // 5. Potwierdzenie
    const confirmDelay = Math.floor(Math.random() * 1500) + 1000;
    console.log(`🆗 Potwierdzam rozwiązanie (za ${confirmDelay}ms)...`);
    await sleep(confirmDelay);

    try {
        await page.click('.captcha__confirm .btn');
    } catch (e) {
        console.log('⚠️ Błąd kliknięcia potwierdzenia (może już zniknęło?):', e.message);
    }
    
    // Czekamy chwilę na zniknięcie
    await sleep(2000);
    
    // Sprawdzenie wyniku
    const stillVisible = await page.evaluate(() => {
        const el = document.getElementById('captcha');
        return el && el.style.display !== 'none';
    });

    if (stillVisible) {
        console.log('❌ CAPTCHA nadal widoczna - chyba się nie udał. Próbuję ponownie w następnej pętli...');
    } else {
        console.log('🎉 CAPTCHA rozwiązana (nie widoczna)! Wracam do gry.');
    }

    return true; // Captcha była obsłużona
}

module.exports = { solve: solveCaptcha };
