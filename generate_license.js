#!/usr/bin/env node
/**
 * License Key Generator - MargoBot
 * Usage: node generate_license.js --user "NazwaUsera" --days 30
 */

const { generateLicense, deactivateLicense, reactivateLicense, listLicenses } = require('./src/license');

const args = process.argv.slice(2);

function showHelp() {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║           MargoBot - License Key Manager                   ║
╠════════════════════════════════════════════════════════════╣
║  Generowanie (dni):                                        ║
║    node generate_license.js --user "Nazwa" --days 30       ║
║                                                            ║
║  Generowanie (godziny):                                    ║
║    node generate_license.js --user "Nazwa" --hours 12      ║
║                                                            ║
║  Dezaktywacja:                                             ║
║    node generate_license.js --deactivate "MARGO-XXXX"      ║
║                                                            ║
║  Reaktywacja:                                              ║
║    node generate_license.js --reactivate "MARGO-XXXX"      ║
║                                                            ║
║  Lista wszystkich kluczy:                                  ║
║    node generate_license.js --list                         ║
╚════════════════════════════════════════════════════════════╝
`);
}

function parseArgs() {
    const result = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--user' || args[i] === '-u') {
            result.user = args[++i];
        } else if (args[i] === '--days' || args[i] === '-d') {
            result.days = parseInt(args[++i]);
        } else if (args[i] === '--hours' || args[i] === '-h') {
            result.hours = parseInt(args[++i]);
        } else if (args[i] === '--deactivate') {
            result.deactivate = args[++i];
        } else if (args[i] === '--reactivate') {
            result.reactivate = args[++i];
        } else if (args[i] === '--list' || args[i] === '-l') {
            result.list = true;
        } else if (args[i] === '--help') {
            result.help = true;
        }
    }
    return result;
}

function main() {
    const opts = parseArgs();
    
    if (opts.help || args.length === 0) {
        showHelp();
        return;
    }
    
    // List licenses
    if (opts.list) {
        const licenses = listLicenses();
        if (licenses.length === 0) {
            console.log('📋 Brak zarejestrowanych licencji.');
            return;
        }
        
        console.log('\n╔════════════════════════════════════════════════════════════════════════════╗');
        console.log('║                           LISTA LICENCJI                                   ║');
        console.log('╠════════════════════════════════════════════════════════════════════════════╣');
        
        licenses.forEach(lic => {
            const expires = new Date(lic.expiresAt).toLocaleDateString('pl-PL');
            const status = lic.active ? '✅ AKTYWNA' : '❌ DEZAKTYWOWANA';
            console.log(`║ ${lic.key.padEnd(20)} │ ${lic.user.padEnd(15)} │ ${expires.padEnd(12)} │ ${status.padEnd(15)} ║`);
        });
        
        console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');
        return;
    }
    
    // Deactivate
    if (opts.deactivate) {
        const success = deactivateLicense(opts.deactivate);
        if (success) {
            console.log(`✅ Licencja ${opts.deactivate} została DEZAKTYWOWANA.`);
        } else {
            console.log(`❌ Nie znaleziono licencji: ${opts.deactivate}`);
        }
        return;
    }
    
    // Reactivate
    if (opts.reactivate) {
        const success = reactivateLicense(opts.reactivate);
        if (success) {
            console.log(`✅ Licencja ${opts.reactivate} została REAKTYWOWANA.`);
        } else {
            console.log(`❌ Nie znaleziono licencji: ${opts.reactivate}`);
        }
        return;
    }
    
    // Generate new license
    if (!opts.user) {
        console.error('❌ Błąd: Podaj nazwę użytkownika (--user "Nazwa")');
        showHelp();
        return;
    }
    
    // Calculate total hours
    let totalHours;
    let displayDuration;
    
    if (opts.hours) {
        totalHours = opts.hours;
        displayDuration = `${opts.hours}h`;
    } else {
        const days = opts.days || 30;
        totalHours = days * 24;
        displayDuration = `${days} dni`;
    }
    
    const { key, expiresAt } = generateLicense(opts.user, totalHours);
    
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║           ✅ WYGENEROWANO NOWĄ LICENCJĘ                    ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║  Klucz:      ${key.padEnd(43)} ║`);
    console.log(`║  Użytkownik: ${opts.user.padEnd(43)} ║`);
    console.log(`║  Wygasa:     ${expiresAt.toLocaleString('pl-PL').padEnd(43)} ║`);
    console.log(`║  Czas:       ${displayDuration.padEnd(43)} ║`);
    console.log('╚════════════════════════════════════════════════════════════╝\n');
}

main();
