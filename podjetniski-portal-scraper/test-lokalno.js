// Lokalni preizkus razčlenjevanja BREZ Apify okolja in brez omrežja — uporabi ISTE funkcije kot
// actor, da se testira to, kar dejansko teče. Vzorci strani so v mapi vzorci/ (zajeti prek Apify
// 6. 10. 2026; strani vira se ne odpira neposredno).
//
//   node test-lokalno.js
const cheerio = require('cheerio');
const fs = require('fs');
const assert = require('assert');

// main.js kliče Actor.main() ob uvozu, zato funkcije izluščimo z branjem datoteke — brez
// podvajanja logike v testu (podvojena logika se prej ali slej razide od prave).
const koda = fs.readFileSync(__dirname + '/src/main.js', 'utf8');
const telo = koda.slice(koda.indexOf('const BAZA'), koda.indexOf('Actor.main('));
const f = new Function('cheerio', `${telo}; return { datumiIzBesedila, rokInStatus, razcleniPodrobnosti, postavkeSeznama };`)(cheerio);

const vzorec = (ime) => fs.readFileSync(`${__dirname}/vzorci/${ime}.html`, 'utf8');
const DAN = new Date(2026, 9, 6); // dan zajema vzorcev

console.log('— roki iz prostega besedila (dejanska besedila s strani) —');
const primeri = [
    ['Rok za oddajo vlog je do vključno 21. 9. 2026, do 14.00 ure.', '21.09.2026', 'Zaprt'],
    ['Razpis je odprt do 12. avgusta 2026.', '12.08.2026', 'Zaprt'],
    ['Rok za prijavo: petek, 29. maj 2026', '29.05.2026', 'Zaprt'],
    ['Vloge je mogoče oddati izključno elektronsko. Rok za oddajo vlog je 15. julij 2026', '15.07.2026', 'Zaprt'],
    ['Javni poziv bo odprt do porabe sredstev. Skrajni rok za oddajo vlog je 31. 3. 2028', '31.03.2028', 'Odprt'],
    ['Rok za prijavo je odprt od dneva objave razpisa do dneva skupne odobritve sredstev oziroma najkasneje do vključno 3. 9. 2027', '03.09.2027', 'Odprt'],
    ['Roki za oddajo vlog na javni razpis: 1. rok: 10. 6. 2026, 2. rok: 9. 9. 2026, 3. rok: 11. 11. 2026', '11.11.2026', 'Odprt'],
    ['Prijava na razpis se začne 27. 7. 2026', null, 'Ni razvidno'],
    ['Oddaja vloge je možna preko spletne aplikacije družbe Borzen od 4. 8. 2026', null, 'Ni razvidno'],
    ['Prijava na razpis se začne 27. 11. 2026', null, 'Napovedan'],
    ['Do porabe sredstev.', null, 'Ni razvidno'],
    ['', null, 'Ni razvidno'],
];
for (const [besedilo, rok, status] of primeri) {
    const izid = f.rokInStatus(besedilo, DAN);
    console.log(`  ${JSON.stringify(izid)}  <- ${besedilo.slice(0, 70)}`);
    assert.deepStrictEqual(izid, { rok, status }, besedilo);
}

console.log('\n— seznam razpisov —');
const postavke = f.postavkeSeznama(vzorec('seznam'));
postavke.slice(0, 3).forEach((p) => console.log(`  ${p.datum && p.datum.toISOString().slice(0, 10)}  ${p.naziv.slice(0, 60)}  ${p.url.slice(0, 60)}`));
console.log(`  skupaj ${postavke.length} postavk v vzorcu`);
assert.ok(postavke.length >= 15, 'seznam mora vrniti postavke');
assert.strictEqual(postavke[0].naziv, 'MP7L 2026 - Krediti za likvidnost in manjše investicije');
assert.ok(postavke[0].url.startsWith('https://www.podjetniski-portal.si/razpisi/'));
assert.strictEqual(postavke[0].datum.getTime(), new Date(2026, 9, 2).getTime());

console.log('\n— stran razpisa (Hrastnik) —');
const razpis = f.razcleniPodrobnosti(vzorec('razpis-hrastnik'), 'https://www.podjetniski-portal.si/razpisi/x', false, DAN);
console.log(JSON.stringify({ ...razpis, Vsebina: razpis.Vsebina.slice(0, 160) + '…' }, null, 2));
assert.strictEqual(razpis.Status, 'Zaprt');
assert.strictEqual(razpis['Rok prijave'], '12.08.2026');
assert.strictEqual(razpis.Izdajatelj, 'Občina Hrastnik');
assert.strictEqual(razpis['Izvorna domena'], 'hrastnik.si');
assert.ok(/hrastnik\.si\/obcinska-uprava\/javni-razpisi/.test(razpis['Izvorni URL']), 'izvorni URL je stran razpisa pri občini');
assert.ok(/48\.825,00/.test(razpis.Sredstva));
assert.strictEqual(razpis['Datum objave'], '01.06.2026');

console.log('\n— članek v priročniku (IF26) —');
const clanek = f.razcleniPodrobnosti(vzorec('clanek-if26'), 'https://www.podjetniski-portal.si/moj-spletni-prirocnik/clanki/75756', true, DAN);
console.log(JSON.stringify({ ...clanek, Vsebina: clanek.Vsebina.slice(0, 160) + '…' }, null, 2));
assert.strictEqual(clanek.Status, 'Napovedan');
assert.strictEqual(clanek['Rok prijave'], null);
assert.strictEqual(clanek.Izdajatelj, 'Sklad za inovacije (Innovation Fund)');
assert.strictEqual(clanek['Izvorna domena'], 'izvoznookno.si');
assert.ok(/if26-sme-call/.test(clanek['Izvorni URL']));

console.log('\n— priročnik: samo razdelek »Finančne spodbude« —');
const $ = cheerio.load(vzorec('prirocnik'));
const v = [];
$('.mspArticles .area').each((_, o) => {
    if (cist($(o).find('h3').first().text()).toLowerCase().startsWith('finančne spodbude')) {
        $(o).find('.item a[href]').each((__, a) => v.push($(a).attr('href')));
    }
});
function cist(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }
console.log(`  ${v.length} člankov: ${v.join(', ')}`);
assert.deepStrictEqual(v, ['/moj-spletni-prirocnik/clanki/75756-razpis-sklada-za-inovacije-if26-sme-call']);

console.log('\nVSI PREIZKUSI USPELI');
