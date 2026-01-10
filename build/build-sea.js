/**
 * Build Script - Node SEA + Bytenode + Obfuscator + esbuild
 * 
 * Flow:
 * 1. esbuild bundles all files into one bundle.js (for SEA bootstrapping)
 * 2. Obfuscate source files (String Encryption)
 * 3. Bytenode compiles obfuscated sources to .jsc
 * 4. Node SEA creates single executable
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const bytenode = require('bytenode');
const JavaScriptObfuscator = require('javascript-obfuscator');

// Files to SKIP compilation AND Obfuscation (if any necessary)
// browser_evals.js MUST be skipped from Bytenode (browser context)
// BUT we will Obfuscate it (Text -> Obfuscated Text)
const SKIP_COMPILATION = [
    'browser_evals.js' 
];

const BUILD_DIR = path.join(__dirname, '..', 'build-sea');
const DIST_DIR = path.join(__dirname, '..', 'dist');

const OBFUSCATION_OPTIONS = {
    compact: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    debugProtection: false,
    disableConsoleOutput: false,
    identifierNamesGenerator: 'hexadecimal',
    log: false,
    numbersToExpressions: true,
    renameGlobals: false,
    selfDefending: false,
    simplify: true,
    splitStrings: true,
    stringArray: true,
    stringArrayCallsTransform: true,
    stringArrayEncoding: ['rc4'],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 1,
    stringArrayWrappersChainedCalls: true,
    stringArrayWrappersParametersMaxCount: 2,
    stringArrayWrappersType: 'variable',
    stringArrayThreshold: 0.75,
    unicodeEscapeSequence: false
};

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

function obfuscateContent(code) {
    try {
        return JavaScriptObfuscator.obfuscate(code, OBFUSCATION_OPTIONS).getObfuscatedCode();
    } catch (e) {
        console.warn('   ⚠️ Obfuscation warning:', e.message);
        return code; // Fallback to original
    }
}

async function main() {
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║     🔒 MargoSzpont Ultimate Build (SEA + Bytecode + Obf)     ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');
    
    const startTime = Date.now();
    
    // Step 1: Prepare directories
    console.log('📦 Step 1: Preparing build directory...');
    ensureDir(BUILD_DIR);
    ensureDir(DIST_DIR);
    console.log('   ✅ Directories ready\n');
    
    // Step 2: Bundle with esbuild (Bootstrapper)
    // We bundle start.js to create the EXE entry point.
    // NOTE: start.js will spawn 'node src/index.js'.
    // Since src/index.js will be compiled, this works.
    console.log('📦 Step 2: Bundling with esbuild...');
    const entryPoint = path.join(__dirname, '..', 'start.js');
    const bundlePath = path.join(BUILD_DIR, 'bundle.js');
    
    if (!run(`npx esbuild "${entryPoint}" --bundle --platform=node --outfile="${bundlePath}" --external:playwright --external:playwright-core`)) {
        console.error('❌ esbuild failed');
        process.exit(1);
    }
    
    console.log(`   ✅ Bundle created\n`);
    
    // Step 3: Create SEA config
    console.log('📦 Step 3: Creating SEA configuration...');
    const seaConfig = {
        main: 'bundle.js',
        output: 'sea-prep.blob',
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: true
    };
    fs.writeFileSync(path.join(BUILD_DIR, 'sea-config.json'), JSON.stringify(seaConfig, null, 2));
    console.log('   ✅ SEA config created\n');
    
    // Step 4: Generate SEA blob
    console.log('📦 Step 4: Generating SEA blob...');
    if (!run(`node --experimental-sea-config sea-config.json`, { cwd: BUILD_DIR })) {
        process.exit(1);
    }
    console.log(`   ✅ SEA blob created\n`);
    
    // Step 5: Copy Node.js executable
    console.log('📦 Step 5: Copying Node.js executable...');
    const nodeExe = process.execPath;
    const outputExe = path.join(DIST_DIR, 'MargoSzpont.exe');
    fs.copyFileSync(nodeExe, outputExe);
    console.log(`   ✅ Copied executable\n`);
    
    // Step 6: Inject SEA blob
    console.log('📦 Step 6: Injecting SEA blob...');
    try { execSync(`npx signtool remove /s "${outputExe}"`, { stdio: 'ignore' }); } catch (e) {}
    if (!run(`npx postject "${outputExe}" NODE_SEA_BLOB "${path.join(BUILD_DIR, 'sea-prep.blob')}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --overwrite`)) {
        process.exit(1);
    }
    console.log('   ✅ SEA blob injected\n');
    
    // Step 7: Copy and Protect Source Files
    console.log('📦 Step 7: Protecting Source Files (Obfuscation + Bytenode)...');
    
    const rootDir = path.join(__dirname, '..');
    
    // Copy clean src first
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
    
    // Protect files in place
    async function protectDirectory(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await protectDirectory(fullPath);
            } else if (entry.name.endsWith('.js')) {
                const isSkipped = SKIP_COMPILATION.includes(entry.name);
                const originalCode = fs.readFileSync(fullPath, 'utf8');
                
                if (isSkipped) {
                    // DO NOT OBFUSCATE browser_evals.js
                    // The obfuscator places decoding functions in the global scope.
                    // When page.evaluate sends code to browser, these functions are lost, causing ReferenceError.
                    fs.writeFileSync(fullPath, originalCode);
                    console.log(`   ⏭️ Skipped Obfuscation (Browser Context Safe): ${entry.name}`);
                } else {
                    // 1. OBFUSCATE (String Encryption)
                    const obfuscatedCode = obfuscateContent(originalCode);
                    
                    // 2. COMPILE TO BYTENODE
                    // Write temp obfuscated file
                    const tempFile = fullPath + '.temp.js';
                    fs.writeFileSync(tempFile, obfuscatedCode);
                    
                    try {
                        const jscFile = fullPath.replace('.js', '.jsc');
                        await bytenode.compileFile({ filename: tempFile, output: jscFile });
                        
                        // Loader
                        const relativeJsc = './' + entry.name.replace('.js', '.jsc');
                        const loaderCode = `require('bytenode');\nmodule.exports = require('${relativeJsc}');`;
                        fs.writeFileSync(fullPath, loaderCode);
                        
                        console.log(`   ✅ Compiled (Obfuscated -> Bytecode): ${entry.name}`);
                    } catch(e) {
                         console.error(`   ❌ Compilation failed for ${entry.name}:`, e.message);
                         // Fallback: Leave as obfuscated js
                         fs.writeFileSync(fullPath, obfuscatedCode);
                    } finally {
                        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
                    }
                }
            }
        }
    }
    
    await protectDirectory(path.join(DIST_DIR, 'src'));
    
    // Copy other assets
    ['przejscia_na_mapach.txt', 'licenses.json'].forEach(f => {
        if(fs.existsSync(path.join(rootDir, f))) fs.copyFileSync(path.join(rootDir, f), path.join(DIST_DIR, f));
    });
    
    // Copy node_modules
    console.log('   📦 Copying dependencies...');
    const deps = ['playwright-core', 'bytenode'];
    deps.forEach(dep => {
        const src = path.join(rootDir, 'node_modules', dep);
        const dest = path.join(DIST_DIR, 'node_modules', dep);
        if(fs.existsSync(src)) copyDirRecursive(src, dest);
    });
    
    // Done
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const sizeMB = (fs.statSync(outputExe).size / (1024 * 1024)).toFixed(1);
    
    console.log('════════════════════════════════════════════════════════════════');
    console.log(`✅ BUILD COMPLETE (WITH ENCRYPTION)!`);
    console.log(`   📁 Output: ${outputExe}`);
    console.log(`   📊 Size: ${sizeMB} MB`);
    console.log(`   Time: ${elapsed}s`);
    console.log(`   Protection: SEA + Obfuscator (Strings) + Bytenode (Logic)`);
    console.log('════════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
