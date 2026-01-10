/**
 * Build Script - Node SEA + Bytenode + esbuild
 * 
 * Flow:
 * 1. esbuild bundles all files into one bundle.js
 * 2. bytenode compiles to bundle.jsc (optional - can cause issues)
 * 3. Node SEA creates single executable
 * 4. (Manual) Enigma Virtual Box for extra protection
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const bytenode = require('bytenode');

// Files to SKIP compilation (browser context use)
const SKIP_COMPILATION = [
    'index.js',
    'actions.js',
    'movement.js',
    'gameState.js',
    'shopping.js',
    'ui.js',
    'captcha.js',
    'browser.js'
];

const BUILD_DIR = path.join(__dirname, '..', 'build-sea');
const DIST_DIR = path.join(__dirname, '..', 'dist');

function run(cmd, options = {}) {
    console.log(`$ ${cmd}`);
    try {
        execSync(cmd, { 
            stdio: 'inherit', 
            cwd: options.cwd || path.join(__dirname, '..'),
            ...options 
        });
        return true;
    } catch (err) {
        console.error(`Command failed`);
        return false;
    }
}

function ensureDir(dir) {
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true });
    }
    fs.mkdirSync(dir, { recursive: true });
}

async function main() {
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║     🔒 MargoSzpont Node SEA Build                            ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');
    
    const startTime = Date.now();
    
    // Step 1: Prepare directories
    console.log('📦 Step 1: Preparing build directory...');
    ensureDir(BUILD_DIR);
    ensureDir(DIST_DIR);
    console.log('   ✅ Directories ready\n');
    
    // Step 2: Bundle with esbuild
    console.log('📦 Step 2: Bundling with esbuild...');
    const entryPoint = path.join(__dirname, '..', 'start.js');
    const bundlePath = path.join(BUILD_DIR, 'bundle.js');
    
    // esbuild bundles everything into one file
    if (!run(`npx esbuild "${entryPoint}" --bundle --platform=node --outfile="${bundlePath}" --external:playwright --external:playwright-core`)) {
        console.error('❌ esbuild failed');
        process.exit(1);
    }
    
    const bundleSize = (fs.statSync(bundlePath).size / 1024).toFixed(1);
    console.log(`   ✅ Bundle created: ${bundleSize} KB\n`);
    
    // Step 3: Create SEA config
    console.log('📦 Step 3: Creating SEA configuration...');
    
    const seaConfig = {
        main: 'bundle.js',
        output: 'sea-prep.blob',
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: true
    };
    
    fs.writeFileSync(
        path.join(BUILD_DIR, 'sea-config.json'),
        JSON.stringify(seaConfig, null, 2)
    );
    console.log('   ✅ SEA config created\n');
    
    // Step 4: Generate SEA blob
    console.log('📦 Step 4: Generating SEA blob...');
    if (!run(`node --experimental-sea-config sea-config.json`, { cwd: BUILD_DIR })) {
        console.error('❌ Failed to generate SEA blob');
        process.exit(1);
    }
    
    const blobPath = path.join(BUILD_DIR, 'sea-prep.blob');
    const blobSize = (fs.statSync(blobPath).size / 1024).toFixed(1);
    console.log(`   ✅ SEA blob created: ${blobSize} KB\n`);
    
    // Step 5: Copy Node.js executable
    console.log('📦 Step 5: Copying Node.js executable...');
    const nodeExe = process.execPath;
    const outputExe = path.join(DIST_DIR, 'MargoSzpont.exe');
    
    fs.copyFileSync(nodeExe, outputExe);
    console.log(`   ✅ Copied: ${outputExe}\n`);
    
    // Step 6: Inject SEA blob using postject
    console.log('📦 Step 6: Injecting SEA blob...');
    
    // First, try to remove signature (Windows) - suppress error if missing
    try {
        execSync(`npx signtool remove /s "${outputExe}"`, { stdio: 'ignore' });
    } catch (e) {
        // Ignore signtool error - injection works anyway (invalidates signature)
    }
    
    if (!run(`npx postject "${outputExe}" NODE_SEA_BLOB "${blobPath}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`)) {
        console.log('   ⚠️ postject failed, trying with --overwrite...');
        if (!run(`npx postject "${outputExe}" NODE_SEA_BLOB "${blobPath}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --overwrite`)) {
            console.error('❌ Failed to inject SEA blob');
            process.exit(1);
        }
    }
    console.log('   ✅ SEA blob injected\n');
    
    // Step 7: Copy required files to dist
    console.log('📦 Step 7: Copying required files...');
    const rootDir = path.join(__dirname, '..');
    
    // Copy src folder
    function copyDirRecursive(src, dest) {
        fs.mkdirSync(dest, { recursive: true });
        const entries = fs.readdirSync(src, { withFileTypes: true });
        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules') continue;
                copyDirRecursive(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }
    
    copyDirRecursive(path.join(rootDir, 'src'), path.join(DIST_DIR, 'src'));
    console.log('   ✅ src/ copied');
    
    // Copy data files
    const dataFiles = ['przejscia_na_mapach.txt', 'licenses.json'];
    for (const file of dataFiles) {
        const srcPath = path.join(rootDir, file);
        if (fs.existsSync(srcPath)) {
            fs.copyFileSync(srcPath, path.join(DIST_DIR, file));
            console.log(`   ✅ ${file} copied`);
        }
    }
    
    // Copy playwright-core
    const playwrightSrc = path.join(rootDir, 'node_modules', 'playwright-core');
    const playwrightDest = path.join(DIST_DIR, 'node_modules', 'playwright-core');
    if (fs.existsSync(playwrightSrc) && !fs.existsSync(playwrightDest)) {
        console.log('   📦 Copying playwright-core (this may take a moment)...');
        copyDirRecursive(playwrightSrc, playwrightDest);
        console.log('   ✅ playwright-core copied');
    }
    console.log('');

    // Step 8: Apply Bytenode protection
    console.log('🔒 Step 7.5: Applying Bytenode protection...');
    
    async function protectDirectory(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules') continue;
                await protectDirectory(fullPath);
            } else if (entry.name.endsWith('.js')) {
                // Check skip list
                if (SKIP_COMPILATION.includes(entry.name)) {
                    console.log(`   ⏭️ Skipped (browser): ${entry.name}`);
                    continue;
                }
                
                // Compile
                try {
                    const jscFile = fullPath.replace('.js', '.jsc');
                    await bytenode.compileFile({ filename: fullPath, output: jscFile });
                    
                    // Create loader
                    const loaderCode = `require('bytenode');\nmodule.exports = require('./${entry.name.replace('.js', '.jsc')}');`;
                    fs.writeFileSync(fullPath, loaderCode);
                    console.log(`   ✅ Compiled: ${entry.name}`);
                } catch (e) {
                    // Fallback to simpler signature if object not supported
                     try {
                        const jscFile = fullPath.replace('.js', '.jsc');
                        await bytenode.compileFile(fullPath, jscFile);
                        const loaderCode = `require('bytenode');\nmodule.exports = require('./${entry.name.replace('.js', '.jsc')}');`;
                        fs.writeFileSync(fullPath, loaderCode);
                        console.log(`   ✅ Compiled (v2): ${entry.name}`);
                     } catch (e2) {
                        console.warn(`   ⚠️ Failed to compile ${entry.name}: ${e.message}`);
                     }
                }
            }
        }
    }
    
    await protectDirectory(path.join(DIST_DIR, 'src'));
    
    // Copy bytenode package
    const bytenodeSrc = path.join(rootDir, 'node_modules', 'bytenode');
    const bytenodeDest = path.join(DIST_DIR, 'node_modules', 'bytenode');
    if (fs.existsSync(bytenodeSrc)) {
        console.log('   📦 Copying bytenode runtime...');
        copyDirRecursive(bytenodeSrc, bytenodeDest);
    }

    
    // Done!
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    
    if (fs.existsSync(outputExe)) {
        const stats = fs.statSync(outputExe);
        const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
        
        console.log('════════════════════════════════════════════════════════════════');
        console.log(`✅ BUILD SUCCESSFUL!`);
        console.log(`   📁 Output: ${outputExe}`);
        console.log(`   📊 Size: ${sizeMB} MB`);
        console.log(`   ⏱️ Time: ${elapsed}s`);
        console.log(`   🔒 Protection: Node SEA (bundled)`);
        console.log('');
        console.log('   ⚠️ WAŻNE: SEA EXE wymaga node_modules obok siebie!');
        console.log('      Skopiuj node_modules\\playwright-core do dist\\');
        console.log('');
        console.log('   💡 Opcjonalnie: Użyj Enigma Virtual Box do spakowania');
        console.log('      wszystkiego w jeden plik EXE');
        console.log('════════════════════════════════════════════════════════════════\n');
    } else {
        console.error('\n❌ EXE file not found!');
        process.exit(1);
    }
}

main().catch(console.error);
