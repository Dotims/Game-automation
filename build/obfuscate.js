const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');
const OUT_DIR = path.join(__dirname, '..', 'dist-obfuscated', 'src');
const ROOT_FILES = ['start.js'];

// Files that use page.evaluate() - MUST NOT be obfuscated
// Obfuscated code breaks when run in browser context
const SKIP_OBFUSCATION = [
    'index.js',
    'actions.js',
    'gameState.js',
    'movement.js',
    'map_navigation.js',
    'shopping.js',
    'ui.js',
    'captcha.js',
    'browser.js'
];

// LIGHT obfuscation - stable for pkg EXE
// Previous settings caused V8 "invalid size error" crash
const obfuscatorConfig = {
    compact: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    debugProtection: false,        // Disabled - causes issues in pkg
    disableConsoleOutput: false,
    identifierNamesGenerator: 'hexadecimal',
    log: false,
    numbersToExpressions: false,   // Disabled - reduces size
    renameGlobals: false,
    selfDefending: false,          // Disabled - causes V8 crash in pkg
    simplify: true,
    splitStrings: false,           // Disabled - reduces complexity
    stringArray: true,
    stringArrayCallsTransform: false,
    stringArrayEncoding: [],       // No encoding - much lighter
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 1,
    stringArrayWrappersChainedCalls: false,
    stringArrayWrappersParametersMaxCount: 2,
    stringArrayWrappersType: 'variable',
    stringArrayThreshold: 0.5,     // Reduced from 0.75
    transformObjectKeys: false,
    unicodeEscapeSequence: false
};

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function obfuscateFile(inputPath, outputPath) {
    const code = fs.readFileSync(inputPath, 'utf8');
    
    try {
        const result = JavaScriptObfuscator.obfuscate(code, obfuscatorConfig);
        ensureDir(path.dirname(outputPath));
        fs.writeFileSync(outputPath, result.getObfuscatedCode());
        return true;
    } catch (err) {
        console.error(`❌ Error obfuscating ${inputPath}:`, err.message);
        // Copy original if obfuscation fails
        ensureDir(path.dirname(outputPath));
        fs.copyFileSync(inputPath, outputPath);
        return false;
    }
}

function copyFile(inputPath, outputPath) {
    ensureDir(path.dirname(outputPath));
    fs.copyFileSync(inputPath, outputPath);
}

function processDirectory(srcDir, outDir, relativePath = '') {
    const items = fs.readdirSync(srcDir);
    let obfuscated = 0;
    let copied = 0;
    let errors = 0;
    
    for (const item of items) {
        const srcPath = path.join(srcDir, item);
        const outPath = path.join(outDir, item);
        const stat = fs.statSync(srcPath);
        
        if (stat.isDirectory()) {
            if (item === 'node_modules') continue; // Skip
            const result = processDirectory(srcPath, outPath, path.join(relativePath, item));
            obfuscated += result.obfuscated;
            copied += result.copied;
            errors += result.errors;
        } else if (item.endsWith('.js')) {
            const relPath = path.join(relativePath, item);
            process.stdout.write(`  📦 ${relPath}... `);
            
            // Check if file should skip obfuscation (uses page.evaluate)
            if (SKIP_OBFUSCATION.includes(item)) {
                copyFile(srcPath, outPath);
                console.log('⏭️ (skipped - uses page.evaluate)');
                copied++;
            } else if (obfuscateFile(srcPath, outPath)) {
                console.log('✅');
                obfuscated++;
            } else {
                console.log('⚠️ (copied raw)');
                errors++;
            }
        } else {
            // Copy non-JS files as-is (JSON, etc.)
            copyFile(srcPath, outPath);
            copied++;
        }
    }
    
    return { obfuscated, copied, errors };
}

function main() {
    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║     🔒 MargoSzpont Code Obfuscator       ║');
    console.log('╚══════════════════════════════════════════╝\n');
    
    const distRoot = path.join(__dirname, '..', 'dist-obfuscated');
    
    // Clean output directory
    if (fs.existsSync(distRoot)) {
        fs.rmSync(distRoot, { recursive: true });
    }
    ensureDir(distRoot);
    
    // Process src directory
    console.log('📁 Processing src/ directory:');
    const result = processDirectory(SRC_DIR, OUT_DIR);
    
    // Process root JS files
    console.log('\n📁 Processing root files:');
    for (const file of ROOT_FILES) {
        const srcPath = path.join(__dirname, '..', file);
        const outPath = path.join(distRoot, file);
        
        if (fs.existsSync(srcPath)) {
            process.stdout.write(`  📦 ${file}... `);
            if (obfuscateFile(srcPath, outPath)) {
                console.log('✅');
                result.obfuscated++;
            } else {
                console.log('⚠️');
                result.errors++;
            }
        }
    }
    
    // Copy package.json
    copyFile(
        path.join(__dirname, '..', 'package.json'),
        path.join(distRoot, 'package.json')
    );
    
    // Copy licenses.json if exists
    const licensesPath = path.join(__dirname, '..', 'licenses.json');
    if (fs.existsSync(licensesPath)) {
        copyFile(licensesPath, path.join(distRoot, 'licenses.json'));
    }
    
    console.log('\n════════════════════════════════════════════');
    console.log(`✅ Obfuscated: ${result.obfuscated} files`);
    console.log(`📋 Copied: ${result.copied} files`);
    if (result.errors > 0) {
        console.log(`⚠️ Errors: ${result.errors} files`);
    }
    console.log(`📂 Output: ${distRoot}`);
    console.log('════════════════════════════════════════════\n');
}

main();
