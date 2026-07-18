/**
 * SID banka — scraper finančnih instrumentov za podjetja (Apify actor).
 *
 * SID banka NIMA časovno omejenih "razpisov" — ponuja STALNE finančne instrumente (krediti,
 * posojila za podjetja). V backlogu označeno kot "SID banka — finančni instrumenti". Zato so vsi
 * zapisi status "Odprt" brez roka prijave (stalna ponudba, kot Eko sklad pozivi "do porabe").
 *
 * Vir: https://www.sid.si/financiranje/  (strežniško izrisano — plain fetch + cheerio).
 *   Produkt: <a href="/financiranje/<kategorija>/<slug>/">Naziv produkta</a>
 *   Kategorije: investicije, tekoce-poslovanje, tekoce-poslovanje-in-investicije,
 *               druge-oblike-financiranja.
 *
 * Izhod (pogodba polj za razpisi.js genericniMapper): Naziv razpisa, URL, Status, Rok prijave,
 * Datum zaznave, Vsebina.
 */
const { Actor } = require('apify');
const cheerio = require('cheerio');

const VIR = 'https://www.sid.si/financiranje/';
const BASE = 'https://www.sid.si';

const KAT_LABELE = {
    'investicije': 'Investicije',
    'tekoce-poslovanje': 'Tekoče poslovanje',
    'tekoce-poslovanje-in-investicije': 'Tekoče poslovanje in investicije',
    'druge-oblike-financiranja': 'Druge oblike financiranja',
};

function danes() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}
const cist = (t) => String(t || '').replace(/\s+/g, ' ').trim();

Actor.main(async () => {
    const r = await fetch(VIR, { headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (razpisnik-portal scraper)' } });
    if (!r.ok) throw new Error(`SID HTTP ${r.status}`);
    const html = await r.text();
    const $ = cheerio.load(html);

    const rezultati = [];
    const videni = new Set();

    $('a[href]').each((_, el) => {
        const href = ($(el).attr('href') || '').trim();
        // samo produktne strani: /financiranje/<kategorija>/<slug>/ (slug vsaj 5 znakov)
        const m = href.match(/^\/financiranje\/([a-z0-9-]+)\/([a-z0-9-]{5,})\/?$/);
        if (!m) return;
        const url = BASE + (href.endsWith('/') ? href : href + '/');
        if (videni.has(url)) return;

        const naziv = cist($(el).text());
        if (!naziv || naziv.length < 6) return;
        videni.add(url);

        const katLabel = KAT_LABELE[m[1]] || m[1];
        rezultati.push({
            'Naziv razpisa': naziv,
            'URL': url,
            'Status': 'Odprt',
            'Rok prijave': null, // stalni finančni instrument (brez roka)
            'Datum zaznave': danes(),
            'Vsebina': `${katLabel} · Stalni finančni instrument SID banke (kredit/posojilo za podjetja).`,
        });
    });

    console.log(`[SID] zajetih ${rezultati.length} finančnih instrumentov`);
    if (rezultati.length) await Actor.pushData(rezultati);
});
