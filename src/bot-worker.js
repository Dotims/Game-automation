const { workerData, parentPort } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const { createRequire } = require('module');

// Fix module resolution for packaged environment (Caxa/SEA)
// Look for node_modules in the root of the extract directory
const nmPath1 = path.join(__dirname, '..', 'node_modules');
const nmPath2 = path.join(path.dirname(process.execPath), 'node_modules');

module.paths.unshift(nmPath1);
module.paths.unshift(nmPath2);

// Create external require for runtime module loading
let externalRequire = require;
if (fs.existsSync(nmPath2)) {
    externalRequire = createRequire(path.join(nmPath2, 'package.json'));
} else if (fs.existsSync(nmPath1)) {
    externalRequire = createRequire(path.join(nmPath1, 'package.json'));
}
global.externalRequire = externalRequire;

// Set environment variables from workerData
process.env.CDP_PORT = workerData.cdpPort.toString();
process.env.PROFILE_ID = workerData.profileId;

// Override console.log to send messages to parent
const originalLog = console.log;
const originalError = console.error;

console.log = function(...args) {
    const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    parentPort.postMessage({ type: 'log', message });
    originalLog.apply(console, args);
};

console.error = function(...args) {
    const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    parentPort.postMessage({ type: 'error', message });
    originalError.apply(console, args);
};

// Track if we should keep running
let shouldRun = true;

// Handle termination signal from parent
parentPort.on('message', (msg) => {
    if (msg === 'terminate') {
        console.log('Bot received terminate signal');
        shouldRun = false;
        process.exit(0);
    }
});

// Global error handling - catch all uncaught errors and keep worker alive
process.on('uncaughtException', (err) => {
    const msg = err.message || '';
    // Ignore navigation/disconnect errors - these are handled by retry loop
    const ignorable = ['Target page', 'Session closed', 'context was destroyed', 'Navigating frame'];
    if (ignorable.some(e => msg.includes(e))) {
        console.log(`⚠️ Recoverable error (will retry): ${msg.substring(0, 100)}`);
    } else {
        console.error(`❌ Uncaught error: ${msg}`);
    }
    // Don't exit - let the retry loop handle it
});

process.on('unhandledRejection', (err) => {
    // Silently ignore promise rejections (usually navigation related)
});

// Auto-restart loop - keeps trying to run the bot
async function runBotWithRetry() {
    while (shouldRun) {
        try {
            console.log('🔄 Starting bot instance...');
            
            // Clear module cache to allow fresh start
            const indexPath = require.resolve('./index.js');
            delete require.cache[indexPath];
            
            // Run the bot - call the exported main() and wait for it
            const main = require('./index.js');
            await main();
            
            // If we get here, bot finished cleanly
            if (!shouldRun) break;
            
            console.log('ℹ️ Bot loop ended. Restarting in 3 seconds...');
            await new Promise(r => setTimeout(r, 3000));
            
        } catch (err) {
            const msg = err.message || '';
            console.log(`⚠️ Bot error: ${msg.substring(0, 100)}`);
            
            if (!shouldRun) break;
            
            console.log('🔄 Restarting bot in 3 seconds...');
            await new Promise(r => setTimeout(r, 3000));
        }
    }
}

// Start the retry loop
runBotWithRetry().catch(err => {
    console.error('Fatal worker error:', err.message);
    process.exit(1);
});
