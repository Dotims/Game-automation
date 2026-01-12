/**
 * Caxa Packaging Script
 * Packages the dist_new folder into a single executable
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist_new');
const OUTPUT_EXE = path.join(ROOT_DIR, 'MargoSzpont.exe');

console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║           📦 MargoSzpont - Packaging (Caxa)                 ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

try {
    // 1. Verify dist_new exists (Assuming build:sea ran before)
    if (!fs.existsSync(DIST_DIR)) {
        console.error(`❌ Error: ${DIST_DIR} not found!`);
        console.error('   Please run "npm run build:sea" first.');
        process.exit(1);
    }

    // 2. Remove old output
    if (fs.existsSync(OUTPUT_EXE)) {
        console.log('   🗑️ Removing old executable...');
        try {
            fs.unlinkSync(OUTPUT_EXE);
        } catch (e) {
            console.error('   ⚠️ Could not remove file (is it open?):', e.message);
        }
    }

    // 3. Run Caxa
    console.log('   📦 Packaging dist_new into single .exe...');
    console.log('      Input:  ' + DIST_DIR);
    console.log('      Output: ' + OUTPUT_EXE);
    
    // We point to MargoSzpont.exe inside dist_new because it's the Node SEA executable
    const cmd = `npx caxa --input "${DIST_DIR}" --output "${OUTPUT_EXE}" -- "{{caxa}}/MargoSzpont.exe"`;
    
    execSync(cmd, { cwd: ROOT_DIR, stdio: 'inherit' });
    
    console.log('\n   ✅ Packaging Success!');
    console.log(`   🚀 Created: ${OUTPUT_EXE}`);
    
    const stats = fs.statSync(OUTPUT_EXE);
    console.log(`   📊 Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

} catch (e) {
    console.error('\n❌ Build Failed:', e.message);
    process.exit(1);
}
