/**
 * Launcher Script - Extracts and runs MargoSzpont from cache
 * 
 * First run: Extracts bundled files to %AppData%\MargoSzpont
 * Subsequent runs: Launches directly from cache (instant start)
 */
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const zlib = require('zlib');

const APP_NAME = 'MargoSzpont';
const APP_VERSION = '2.2.0';
const CACHE_DIR = path.join(process.env.APPDATA || process.env.HOME, APP_NAME);
const VERSION_FILE = path.join(CACHE_DIR, '.version');
const MAIN_EXE = path.join(CACHE_DIR, 'MargoSzpont.exe');

// Check if cache is valid
function isCacheValid() {
    if (!fs.existsSync(VERSION_FILE)) return false;
    if (!fs.existsSync(MAIN_EXE)) return false;
    
    try {
        const cachedVersion = fs.readFileSync(VERSION_FILE, 'utf8').trim();
        return cachedVersion === APP_VERSION;
    } catch {
        return false;
    }
}

// Extract bundled data to cache
function extractToCache() {
    console.log('📦 Pierwsza instalacja - wypakowywanie...');
    
    // Clean old cache
    if (fs.existsSync(CACHE_DIR)) {
        fs.rmSync(CACHE_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    
    // Get embedded asset using SEA API
    let compressedData;
    try {
        // Node.js SEA provides embedded assets via sea.getAsset()
        const sea = require('node:sea');
        compressedData = sea.getAsset('bundle.tar.gz');
    } catch (e) {
        // Fallback for development (not running as SEA)
        const bundledDataPath = path.join(__dirname, 'bundle.tar.gz');
        if (!fs.existsSync(bundledDataPath)) {
            console.error('❌ Błąd: Brak pliku bundle.tar.gz');
            console.error('   Uruchom: npm run build');
            process.exit(1);
        }
        compressedData = fs.readFileSync(bundledDataPath);
    }
    
    // Decompress
    const tarData = zlib.gunzipSync(Buffer.from(compressedData));
    
    // Extract tar
    extractTar(tarData, CACHE_DIR);
    
    // Write version file
    fs.writeFileSync(VERSION_FILE, APP_VERSION);
    
    console.log('✅ Instalacja zakończona!');
}

// Simple tar extractor
function extractTar(tarBuffer, destDir) {
    let offset = 0;
    let extractedCount = 0;
    
    while (offset < tarBuffer.length - 512) {
        // Read header
        const header = tarBuffer.slice(offset, offset + 512);
        if (header[0] === 0) break; // End of archive
        
        const fileName = header.slice(0, 100).toString('utf8').replace(/\0/g, '');
        const fileSizeOctal = header.slice(124, 136).toString('utf8').replace(/\0/g, '');
        const fileSize = parseInt(fileSizeOctal, 8) || 0;
        const typeFlag = header[156];
        
        offset += 512;
        
        if (fileName && fileName !== '.' && fileName !== '..') {
            // Check if it's a directory:
            // 1. Type flag is 53 ('5') or 0x35
            // 2. Filename ends with '/'
            const isDirectory = typeFlag === 53 || typeFlag === 0x35 || fileName.endsWith('/');
            
            const fullPath = path.join(destDir, fileName.replace(/\/$/, '')); // Remove trailing slash
            
            if (isDirectory) {
                // Create directory
                if (!fs.existsSync(fullPath)) {
                    fs.mkdirSync(fullPath, { recursive: true });
                }
            } else if (fileSize > 0) {
                // Create parent dirs if needed
                const dir = path.dirname(fullPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                
                // Write file
                const fileData = tarBuffer.slice(offset, offset + fileSize);
                fs.writeFileSync(fullPath, fileData);
                extractedCount++;
            }
        }
        
        // Move to next file (512-byte aligned)
        offset += Math.ceil(fileSize / 512) * 512;
    }
    
    console.log(`   Extracted ${extractedCount} files`);
}

// Launch the main application
function launchApp(isFirstRun = false) {
    if (isFirstRun) {
        console.log('🚀 Uruchamianie MargoSzpont...\n');
        // First run - keep console visible, user needs to see what's happening
        const child = spawn(MAIN_EXE, [], {
            cwd: CACHE_DIR,
            stdio: 'inherit',
            detached: false
        });
        
        child.on('error', (err) => {
            console.error('❌ Błąd uruchamiania:', err.message);
            process.exit(1);
        });
        
        child.on('exit', (code) => {
            process.exit(code || 0);
        });
    } else {
        // Subsequent runs - hide console, run silently
        const child = spawn(MAIN_EXE, [], {
            cwd: CACHE_DIR,
            stdio: 'ignore',
            detached: true,
            windowsHide: true
        });
        
        // Detach from parent - let it run independently
        child.unref();
        
        // Exit launcher immediately - app runs in background
        process.exit(0);
    }
}

// Main
async function main() {
    const needsExtraction = !isCacheValid();
    
    // Always show banner
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║               😼 MargoSzpont Launcher v' + APP_VERSION + '                 ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');
    
    if (needsExtraction) {
        extractToCache();
    }
    
    launchApp(needsExtraction);
}

// Helper to wait for keypress before exiting
function waitForKeyAndExit(code) {
    console.log('\nNaciśnij dowolny klawisz aby zamknąć...');
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.once('data', () => process.exit(code));
    } else {
        // Fallback if no TTY
        setTimeout(() => process.exit(code), 30000);
    }
}

main().catch(err => {
    console.error('❌ Błąd krytyczny:', err.message);
    console.error('\nStack trace:');
    console.error(err.stack);
    waitForKeyAndExit(1);
});
