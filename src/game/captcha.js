const logger = require('../utils/logger');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function solveCaptcha(page) {
    // logger.info('🧩 Checking for CAPTCHA...'); // Too spammy using .style.display check every loop


    const captchaVisible = await page.evaluate(() => {
        const el = document.getElementById('captcha');
        if (!el || el.style.display === 'none') return false;
        
        // Additional check: Ensure it has content (text or buttons)
        const text = el.innerText.trim();
        const hasButtons = el.querySelectorAll('.btn').length > 0;
        
        // If empty text and no buttons, it's likely a hidden overlay container
        if (!text && !hasButtons) return false;
        
        return true;
    });

    if (!captchaVisible) {
        return false;
    }

    logger.warn('🚨 CAPTCHA DETECTED! Starting solver...');

    const captchaInfo = await page.evaluate(() => {
        const questionEl = document.querySelector('.captcha__question');
        const question = questionEl ? questionEl.innerText : '';
        const buttons = Array.from(document.querySelectorAll('.captcha__buttons .btn')).map((btn, index) => {
            const fontEl = btn.querySelector('.gfont');
            return {
                index: index,
                text: fontEl ? fontEl.getAttribute('name') : ''
            };
        });
        return { question, buttons };
    });

    logger.log(`❓ Question: "${captchaInfo.question}"`);
    logger.log(`🔠 Options: ${captchaInfo.buttons.map(b => b.text).join(', ')}`);

    const correctButtons = captchaInfo.buttons.filter(btn => btn.text.includes('*'));

    if (correctButtons.length === 0) {
        logger.warn('⚠️ No matches for pattern (*)!');
        return true; 
    }

    logger.success(`✅ Found ${correctButtons.length} correct answers.`);

    for (const btn of correctButtons) {
        const thinkTime = Math.floor(Math.random() * 1700) + 800;
        logger.log(`👆 Clicking: "${btn.text}" (in ${thinkTime}ms)`);
        await sleep(thinkTime);
        await page.click(`.captcha__buttons .btn:nth-child(${btn.index + 1})`);
    }

    const confirmDelay = Math.floor(Math.random() * 1500) + 1000;
    logger.log(`🆗 Confirming solution (in ${confirmDelay}ms)...`);
    await sleep(confirmDelay);

    try {
        await page.click('.captcha__confirm .btn');
    } catch (e) {
        logger.error('⚠️ Confirm click failed:', e.message);
    }
    
    await sleep(2000);
    
    const stillVisible = await page.evaluate(() => {
        const el = document.getElementById('captcha');
        return el && el.style.display !== 'none';
    });

    if (stillVisible) {
        logger.error('❌ CAPTCHA still visible. Retrying next loop...');
    } else {
        logger.success('🎉 CAPTCHA solved! Resuming game.');
    }

    return true;
}

module.exports = { solve: solveCaptcha };
