/**
 * Build Launcher - Creates self-extracting launcher executable
 * 
 * This script:
 * 1. Takes the built app from dist_new
 * 2. Creates a bundle.tar.gz containing all files
 * 3. Bundles launcher.js with the tarball embedded
 * 4. Creates a SEA executable that extracts and runs the app
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const zlib = require('zlib');

const DIST_DIR = path.join(__dirname, '..', 'dist_new');
const BUILD_DIR = path.join(__dirname, '..', 'build-launcher');
const LAUNCHER_SRC = path.join(__dirname, 'launcher.js');

// Get version from package.json
const pkg = require('../package.json');
const APP_VERSION = pkg.version;

function run(cmd) {
    console.log(`$ ${cmd}`);
    try {
        execSync(cmd, { stdio: 'inherit', cwd: BUILD_DIR });
        return true;
    } catch (e) {
        console.error(`Command failed: ${cmd}`);
        return false;
    }
}

async function main() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║           📦 MargoSzpont Launcher Builder                    ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');
    
    // Step 1: Check dist_new exists
    console.log('📦 Step 1: Checking dist_new...');
    if (!fs.existsSync(DIST_DIR)) {
        console.error('❌ dist_new not found! Run npm run build:sea first.');
        process.exit(1);
    }
    console.log('   ✅ Found dist_new\n');
    
    // Step 2: Prepare build directory
    console.log('📦 Step 2: Preparing build directory...');
    if (fs.existsSync(BUILD_DIR)) {
        fs.rmSync(BUILD_DIR, { recursive: true });
    }
    fs.mkdirSync(BUILD_DIR, { recursive: true });
    console.log('   ✅ Ready\n');
    
    // Step 3: Create bundle.tar.gz
    console.log('📦 Step 3: Creating bundle.tar.gz...');
    const tar = require('tar');
    const bundlePath = path.join(BUILD_DIR, 'bundle.tar.gz');
    
    await tar.c(
        {
            gzip: true,
            file: bundlePath,
            cwd: DIST_DIR
        },
        fs.readdirSync(DIST_DIR)
    );
    
    const bundleSize = (fs.statSync(bundlePath).size / (1024 * 1024)).toFixed(1);
    console.log(`   ✅ Created (${bundleSize} MB)\n`);
    
    // Step 4: Copy and update launcher.js with version
    console.log('📦 Step 4: Preparing launcher...');
    let launcherCode = fs.readFileSync(LAUNCHER_SRC, 'utf8');
    // Inject version
    launcherCode = launcherCode.replace(/const APP_VERSION = ['"][^'"]+['"]/, `const APP_VERSION = '${APP_VERSION}'`);
    fs.writeFileSync(path.join(BUILD_DIR, 'launcher.js'), launcherCode);
    console.log('   ✅ Launcher ready\n');
    
    // Step 5: Create SEA config
    console.log('📦 Step 5: Creating SEA configuration...');
    const seaConfig = {
        main: 'launcher.js',
        output: 'sea-prep.blob',
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: true,
        assets: {
            'bundle.tar.gz': 'bundle.tar.gz'
        }
    };
    fs.writeFileSync(path.join(BUILD_DIR, 'sea-config.json'), JSON.stringify(seaConfig, null, 2));
    console.log('   ✅ Config created\n');
    
    // Step 6: Generate SEA blob
    console.log('📦 Step 6: Generating SEA blob...');
    if (!run('node --experimental-sea-config sea-config.json')) {
        process.exit(1);
    }
    console.log('   ✅ SEA blob created\n');
    
    // Step 7: Copy Node.js executable
    console.log('📦 Step 7: Copying Node.js executable...');
    const nodeExe = process.execPath;
    const outputExe = path.join(BUILD_DIR, 'MargoSzpont.exe');
    fs.copyFileSync(nodeExe, outputExe);
    console.log('   ✅ Copied\n');
    
    // Step 8: Inject SEA blob
    console.log('📦 Step 8: Injecting SEA blob...');
    if (!run(`npx postject "${outputExe}" NODE_SEA_BLOB "${path.join(BUILD_DIR, 'sea-prep.blob')}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --overwrite`)) {
        process.exit(1);
    }
    console.log('   ✅ Injected\n');
    
    // Icon step removed - rcedit hangs on large files
    // Use Resource Hacker manually to set icon
    
    // Done
    const finalSize = (fs.statSync(outputExe).size / (1024 * 1024)).toFixed(1);
    console.log('════════════════════════════════════════════════════════════════');
    console.log('✅ LAUNCHER BUILD COMPLETE!');
    console.log(`   📁 Output: ${outputExe}`);
    console.log(`   📊 Size: ${finalSize} MB`);
    console.log(`   📦 Contains: Launcher + Compressed App Bundle`);
    console.log(`   ⚡ Next runs: Instant start from cache!`);
    console.log('════════════════════════════════════════════════════════════════\n');
}

main().catch(err => {
    console.error('❌ Build failed:', err.message);
    process.exit(1);
});
