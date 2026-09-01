// Lokalni preizkus razčlenjevanja BREZ Apify okolja — uporabi ISTE funkcije kot actor, da se
// testira to, kar dejansko teče.
//
//   node test-lokalno.js                 — vzorce prenese z jsmgg.si
//   node test-lokalno.js <mapa>          — razčleni shranjena vzorca aktualni.html in
//                                          zakljuceni.html iz podane mape (brez omrežja)
const cheerio = require('cheerio');
const fs = require('fs');

// main.js kliče Actor.main() ob uvozu, zato funkcije izluščimo z branjem datoteke — brez
// podvajanja logike v testu (podvojena logika se prej ali slej razide od prave).
const koda = fs.readFileSync(__dirname + '/src/main.js', 'utf8');
const telo = koda.slice(koda.indexOf('const BAZA'), koda.indexOf('Actor.main('));
const { datumiIzRokov, razcleniRazpis, statusIzOznak, BAZA } =
    new Function('cheerio', `${telo}; return { datumiIzRokov, razcleniRazpis, statusIzOznak, BAZA };`)(cheerio);

const mapa = process.argv[2] || null;

async function preberi(url) {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (razpisnik-portal scraper)' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
}

function povezaveIzSeznama(html) {
    const $ = cheerio.load(html);
    const napovedano = (cheerio.load(html)('.number-of-entries').text().match(/(\d+)/) || [])[1];
    const povezave = [];
    $('.view-razpisi .views-row').each((_, v) => {
        const pot = $(v).find('.views-field-title a[href]').first().attr('href');
        if (pot) povezave.push(pot.startsWith('http') ? pot : BAZA + pot);
    });
    return { povezave, napovedano: napovedano ? Number(napovedano) : null };
}

(async () => {
    console.log('— razčlemba prijavnih rokov —');
    const vzorecRokov = 'v letu 2026: 4. 9., 16. 10., 23. 11. - do 12.00 za vse navedene datume; '
        + 'v letu 2027: 8. 1., 12. 2., 19. 3., 23. 4., 21. 5., 3. 9. - do 12.00 za vse navedene datume oz. do porabe sredstev.';
    const datumi = datumiIzRokov(vzorecRokov);
    console.log(`  najdenih datumov: ${datumi.length} -> ${datumi.map((d) => d.niz).join(', ')}`);
    console.log(`  brez rokov: ${JSON.stringify(datumiIzRokov(''))}`);
    console.log(`  statusIzOznak(['Zaključen','Rezultati']) = ${statusIzOznak(['Zaključen', 'Rezultati'])}`
        + ` | (['Odprt']) = ${statusIzOznak(['Odprt'])} | ([]) = ${statusIzOznak([])}`);

    const seznami = mapa
        ? [['aktualni', fs.readFileSync(`${mapa}/aktualni.html`, 'utf8')],
           ['zaključeni', fs.readFileSync(`${mapa}/zakljuceni.html`, 'utf8')]]
        : [['aktualni', await preberi(`${BAZA}/aktualni-razpisi?page=0`)],
           ['zaključeni', await preberi(`${BAZA}/zakljuceni-razpisi?page=0`)]];

    const vsi = [];
    for (const [ime, html] of seznami) {
        const { povezave, napovedano } = povezaveIzSeznama(html);
        console.log(`\n— seznam ${ime}: stran napove ${napovedano ?? '?'} zapisov, na prvi strani ${povezave.length} povezav`);
        povezave.forEach((u) => console.log(`   ${u}`));
        vsi.push(...povezave);
    }

    if (mapa) {
        console.log('\n(razčlemba posameznih razpisov zahteva omrežje — poženi brez argumenta)');
        return;
    }

    console.log('\n— razčlemba posameznih razpisov —');
    for (const url of vsi) {
        const z = razcleniRazpis(await preberi(url), url);
        if (!z) { console.log(`  NERAZČLENJENO: ${url}`); continue; }
        console.log(`  ${z['Naziv razpisa'].slice(0, 55)}`);
        console.log(`     status: ${z.Status} | rok: ${z['Rok prijave'] || '—'} | sredstva: ${z.Sredstva || '—'}`
            + ` | tip: ${z['Tip financiranja'] || '—'} | vsebina: ${z.Vsebina.length} znakov`);
    }
})();
