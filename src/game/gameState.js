const browserEvals = require('../core/browser_evals');

async function getGameState(page, config) {
    return await browserEvals.getGameState(page, config);
}

module.exports = { getGameState };
