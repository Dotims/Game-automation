/**
 * WinRAR SFX Packaging Script
 * Packs dist_new into a Self-Extracting Executable
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist_new');
const OUTPUT_EXE = path.join(ROOT_DIR, 'MargoSzpont_SFX.exe');
const WINRAR_PATH = 'C:\\Program Files\\WinRAR\\WinRAR.exe';

console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║           📦 MargoSzpont - Packaging (WinRAR SFX)           ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

try {
    if (!fs.existsSync(DIST_DIR)) {
        throw new Error('dist_new directory not found! Run npm run build:sea first.');
    }

    if (!fs.existsSync(WINRAR_PATH)) {
        throw new Error('WinRAR not found at default location!');
    }

    if (fs.existsSync(OUTPUT_EXE)) {
        console.log('   🗑️ Removing old SFX...');
        try { fs.unlinkSync(OUTPUT_EXE); } catch (e) {
            console.error('   ⚠️ Could not remove file:', e.message);
        }
    }

    console.log('   📦 Creating SFX Archive...');
    
    // SFX Config
    const sfxComment = [
        'Path=MargoSzpont_v2',
        'SavePath',
        'Setup=MargoSzpont.exe',
        'Silent=1',
        'Overwrite=1',
        'Title=MargoSzpont Installer'
    ].join('\n');
    
    const commentFile = path.join(ROOT_DIR, 'sfx_config.txt');
    fs.writeFileSync(commentFile, sfxComment);

    // WinRAR Command:
    // a = add to archive
    // -sfx = create SFX
    // -z<file> = read archive comment from file
    // -ep1 = exclude base directory from names
    // -r = recursive
    
    const cmd = `"${WINRAR_PATH}" a -sfx -z"${commentFile}" -ep1 -r "${OUTPUT_EXE}" "${DIST_DIR}\\*"`;
    
    execSync(cmd, { stdio: 'inherit' });
    
    // Cleanup
    fs.unlinkSync(commentFile);

    console.log('\n   ✅ Packaging Success!');
    console.log(`   🚀 Created: ${OUTPUT_EXE}`);
    const stats = fs.statSync(OUTPUT_EXE);
    console.log(`   📊 Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

} catch (e) {
    console.error('\n❌ Build Failed:', e.message);
    process.exit(1);
}
