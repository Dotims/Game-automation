const logger = {
    log: (msg) => {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] ${msg}`);
    },
    error: (msg, err = '') => {
        const timestamp = new Date().toLocaleTimeString();
        console.error(`[${timestamp}] ❌ ERROR: ${msg}`, err);
    },
    warn: (msg) => {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] ⚠️ WARNING: ${msg}`);
    },
    info: (msg) => {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] ℹ️ ${msg}`);
    },
    success: (msg) => {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] ✅ ${msg}`);
    }
};

module.exports = logger;
