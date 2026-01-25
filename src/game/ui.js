const browserEvals = require('../core/browser_evals');

async function injectUI(page, defaultConfig, huntingSpots, allMapNames, allMonsters, licenseInfo = null) {
    return await browserEvals.injectUI(page, defaultConfig, huntingSpots, allMapNames, allMonsters, licenseInfo);
}

module.exports = { injectUI };
