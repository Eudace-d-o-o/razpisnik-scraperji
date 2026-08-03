// Lokalni preizkus razčlenjevanja BREZ Apify okolja — uporabi ISTE funkcije kot actor, da se
// testira to, kar dejansko teče. Poženi z: node test-lokalno.js
const cheerio = require('cheerio');
const fs = require('fs');

// main.js kliče Actor.main() ob uvozu, zato funkcije izluščimo z branjem datoteke — brez
// podvajanja logike v testu (podvojena logika se prej ali slej razide od prave).
const koda = fs.readFileSync(__dirname + '/src/main.js', 'utf8');
const telo = koda.slice(koda.indexOf('const MESECI'), koda.indexOf('async function ministarstvoPrivrede'));
const { vDatum, najdiRok, status } = new Function(`${telo}; return { vDatum, najdiRok, status };`)();

const BAZA = 'https://www.privreda.gov.rs';
async function preberi(url) {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RazpisnikBot/1.0)' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
}

(async () => {
    console.log('vDatum("12. мар 2026.") =', vDatum('12. мар 2026.'));
    console.log('vDatum("30.09.2026") =', vDatum('30.09.2026'));
    console.log('najdiRok("Рок за подношење пријава је 30.09.2026. године") =',
        najdiRok('Рок за подношење пријава је 30.09.2026. године'));
    console.log('najdiRok("Захтеви се подносе закључно са 15. децембар 2026.") =',
        najdiRok('Захтеви се подносе закључно са 15. децембар 2026.'));
    console.log('status("30.09.2026") =', status('30.09.2026'), '| status("01.01.2020") =', status('01.01.2020'));
    console.log('');

    const vsi = [];
    for (let s = 0; s <= 8; s++) {
        const $ = cheerio.load(await preberi(`${BAZA}/usluge/javni-pozivi?page=${s}`));
        const c = $('article.node--public-calls');
        if (!c.length) break;
        c.each((_, el) => {
            const a = $(el).find('a.link--absolute').first();
            const pot = a.attr('href'); const naziv = a.text().replace(/\s+/g, ' ').trim();
            if (pot && naziv) vsi.push({ naziv, url: `${BAZA}${pot}` });
        });
    }
    console.log(`SKUPAJ objav: ${vsi.length}\n`);

    let zRokom = 0, zDatumom = 0;
    for (const z of vsi.slice(0, 12)) {
        const $ = cheerio.load(await preberi(z.url));
        $('script, style, nav, header, footer').remove();
        const vsebina = ($('.field--text').text() || $('main').text()).replace(/\s+/g, ' ').trim();
        const datum = vDatum($('.field--date').first().text());
        const rok = najdiRok(vsebina);
        if (rok) zRokom++;
        if (datum) zDatumom++;
        console.log(`— ${z.naziv.slice(0, 60)}\n   objava: ${datum || '—'} | rok: ${rok || '—'} | status: ${status(rok)} | ${vsebina.length} znakov`);
    }
    console.log(`\nOd 12 pregledanih: datum objave pri ${zDatumom}, rok pri ${zRokom}.`);
})();
