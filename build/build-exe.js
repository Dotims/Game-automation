/**
 * Build Script - Full Protected Build
 * Obfuscates code and packages to EXE
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIST_DIR = path.join(__dirname, '..', 'dist-obfuscated');
const OUTPUT_DIR = path.join(__dirname, '..', 'dist');

function run(cmd, options = {}) {
    console.log(`\n$ ${cmd}\n`);
    try {
        execSync(cmd, { 
            stdio: 'inherit', 
            cwd: options.cwd || path.join(__dirname, '..'),
            ...options 
        });
        return true;
    } catch (err) {
        console.error(`Command failed: ${cmd}`);
        return false;
    }
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

async function main() {
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║          🔒 MargoSzpont Protected Build                      ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');
    
    const startTime = Date.now();
    
    // Step 1: Obfuscate
    console.log('📦 Step 1: Obfuscating source code...');
    if (!run('node build/obfuscate.js')) {
        console.error('❌ Obfuscation failed!');
        process.exit(1);
    }
    
    // Step 2: Create package.json for dist-obfuscated
    console.log('\n📦 Step 2: Preparing package for pkg...');
    const originalPkg = require('../package.json');
    
    // Filter out playwright-extra and stealth plugin (causes dynamic import issues in pkg)
    // browser.js will fallback to plain playwright
    const filteredDeps = { ...originalPkg.dependencies };
    delete filteredDeps['playwright-extra'];
    delete filteredDeps['puppeteer-extra-plugin-stealth'];
    
    const distPkg = {
        name: originalPkg.name,
        version: originalPkg.version,
        main: 'start.js',
        bin: 'start.js',
        pkg: {
            assets: [
                'src/**/*',
                'licenses.json'
            ],
            targets: ['node18-win-x64'],
            outputPath: '../dist'
        },
        dependencies: filteredDeps
    };
    
    fs.writeFileSync(
        path.join(DIST_DIR, 'package.json'),
        JSON.stringify(distPkg, null, 2)
    );
    
    // Step 3: Install dependencies in dist-obfuscated
    console.log('\n📦 Step 3: Installing dependencies...');
    if (!run('npm install --production', { cwd: DIST_DIR })) {
        console.error('❌ npm install failed!');
        process.exit(1);
    }
    
    // Step 4: Package with pkg
    console.log('\n📦 Step 4: Creating EXE with pkg...');
    ensureDir(OUTPUT_DIR);
    
    // Use npx to run pkg
    if (!run(`npx pkg . --targets node18-win-x64 --output ../dist/MargoSzpont.exe --compress GZip`, { cwd: DIST_DIR })) {
        console.error('❌ pkg failed!');
        process.exit(1);
    }
    
    // Done!
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const exePath = path.join(OUTPUT_DIR, 'MargoSzpont.exe');
    
    if (fs.existsSync(exePath)) {
        const stats = fs.statSync(exePath);
        const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
        
        console.log('\n════════════════════════════════════════════════════════════════');
        console.log(`✅ BUILD SUCCESSFUL!`);
        console.log(`   📁 Output: ${exePath}`);
        console.log(`   📊 Size: ${sizeMB} MB`);
        console.log(`   ⏱️ Time: ${elapsed}s`);
        console.log('════════════════════════════════════════════════════════════════\n');
    } else {
        console.error('\n❌ EXE file not found!');
        process.exit(1);
    }
}

main();
