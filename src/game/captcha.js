const logger = require('../utils/logger');
const { sleep } = require('../utils/sleep');
const browserEvals = require('../core/browser_evals');

async function solveCaptcha(page) {
    // logger.info('🧩 Checking for CAPTCHA...'); // Too spammy using .style.display check every loop



    const captchaVisible = await browserEvals.isCaptchaVisible(page);

    if (!captchaVisible) {
        return false;
    }

    logger.warn('🚨 CAPTCHA DETECTED! Starting solver...');

    const captchaInfo = await browserEvals.getCaptchaButtons(page);

    logger.log(`❓ Question: "${captchaInfo.question}"`);
    logger.log(`🔠 Options: ${captchaInfo.buttons.map(b => b.text).join(', ')}`);

    const correctButtons = captchaInfo.buttons.filter(btn => btn.text.includes('*'));

    if (correctButtons.length === 0) {
        logger.warn('⚠️ No matches for pattern (*)!');
        return true; 
    }

    logger.success(`✅ Found ${correctButtons.length} correct answers.`);

    // Shuffle correct answers to click in random order (more human-like)
    for (let i = correctButtons.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [correctButtons[i], correctButtons[j]] = [correctButtons[j], correctButtons[i]];
    }

    for (const btn of correctButtons) {
        if (btn.isActive) {
            logger.log(`⏭️ Skipping "${btn.text}" (Already Selected)`);
            continue;
        }

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
    
    
    const stillVisible = await browserEvals.isCaptchaStillVisible(page);

    if (stillVisible) {
        logger.error('❌ CAPTCHA still visible. Retrying next loop...');
    } else {
        logger.success('🎉 CAPTCHA solved! Resuming game.');
    }

    return true;
}

module.exports = { solve: solveCaptcha };
