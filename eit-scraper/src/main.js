/**
 * EIT (Evropski inštitut za inovacije in tehnologijo) in skupnosti KIC — scraper priložnosti (Apify actor).
 *
 * Stran eit.europa.eu/our-activities/opportunities je strežniško izrisan seznam z nazivom, datumom
 * začetka in konca ter skupnostjo (EIT, EIT Food, EIT Health …). Seznam vsebuje samo trenutno odprte
 * priložnosti, zato vsaka stran razpisa prebere še opis.
 *
 * Med priložnostmi so tudi tečaji, nagrade za učitelje in podobno, kar ni financiranje projektov;
 * izločimo jih po nazivu (NI_FINANCIRANJE). Del razpisov KIC objavlja tudi portal EU; portal take
 * ob uvozu izloči (lib/zajem-agregator.js, primerjava z virom EU).
 *
 * robots.txt (13. 10. 2026) zapira samo administracijo, iskanje in uporabniške poti.
 *
 * Izhod (pogodba polj za razpisi.js genericniMapper): Naziv razpisa, URL, Status, Rok prijave,
 * Datum zaznave, Datum objave, Vsebina, Programme, Izdajatelj, Izvorna domena.
 */
const { Actor } = require('apify');
const cheerio = require('cheerio');
const { datumiIzBesedila, vNiz, danes } = require('./datumi-en');

const BAZA = 'https://eit.europa.eu';
const SEZNAM = '/our-activities/opportunities';
const NAJVEC_STRANI = 5;            // seznam ima 13. 10. 2026 eno stran (13 priložnosti)
const ZAMIK_MS = 400;
const NAJVEC_ZNAKOV_VSEBINE = 2000;
const UA = 'Mozilla/5.0 (razpisnik-portal scraper)';

// Kar ni financiranje projekta ali podjetja: tečaji, usposabljanja, nagrade za učitelje, dogodki.
const NI_FINANCIRANJE = /\bcourses?\b|training|teacher|webinar|summer school|bootcamp|masterclass|workshop|conference|\bjobs?\b|vacanc/i;

const cist = (t) => String(t || '').replace(/\s+/g, ' ').trim();
const pocakaj = (ms) => new Promise((r) => setTimeout(r, ms));

async function preberi(url) {
    const r = await fetch(url, { headers: { Accept: 'text/html', 'User-Agent': UA } });
    if (!r.ok) throw new Error(`HTTP ${r.status} pri ${url}`);
    return r.text();
}

// Seznam skupnost označi s kratko oznako (»Mobility«, »Food«); na portalu potrebujemo polno ime.
const SKUPNOSTI = {
    'mobility': 'EIT Urban Mobility', 'materials': 'EIT RawMaterials', 'food': 'EIT Food', 'health': 'EIT Health',
    'digital': 'EIT Digital', 'climate': 'EIT Climate-KIC', 'innoenergy': 'EIT InnoEnergy',
    'manufacturing': 'EIT Manufacturing', 'culture & creativity': 'EIT Culture & Creativity', 'water': 'EIT Water',
    'eit community': 'EIT Community', 'eit': 'EIT',
};
const imeSkupnosti = (oznaka) => SKUPNOSTI[oznaka.toLowerCase()] || (oznaka ? `EIT ${oznaka}` : 'EIT');

// »02/09/2026<span>10.00 - CET</span>«: ura v podelementu bi se zlepila z letnico, zato beremo samo
// besedilo elementa brez podelementov.
function datumNaSeznamu($, el) {
    const besedilo = el.clone().children().remove().end().text();
    return datumiIzBesedila(besedilo)[0]?.datum || null;
}

/** Postavke seznama: naziv, povezava, začetek, konec, skupnost. */
function postavkeSeznama(html) {
    const $ = cheerio.load(html);
    const postavke = [];
    $('.views-row').each((_, vrstica) => {
        const a = $(vrstica).find('.teaser-title a[href]').first();
        const pot = a.attr('href');
        const naziv = cist(a.text());
        if (!pot || !naziv) return;
        postavke.push({
            url: pot.startsWith('http') ? pot : `${BAZA}${pot}`,
            naziv,
            zacetek: datumNaSeznamu($, $(vrstica).find('.start-date').first()),
            konec: datumNaSeznamu($, $(vrstica).find('.end-date').first()),
            skupnost: imeSkupnosti(cist($(vrstica).find('.teaser-kics').text())),
        });
    });
    const naslednja = $('a[rel="next"], .pager__item--next a').attr('href') || null;
    return { postavke, naslednja };
}

/** Opis s strani priložnosti (glavni del vsebine, brez menijev). */
function opisStrani(html) {
    const $ = cheerio.load(html);
    const telo = $('main .field--name-body, main article, main').first();
    return cist(telo.find('p, li').map((_, el) => $(el).text()).get().join(' '));
}

Actor.main(async () => {
    const dan = danes();
    const vse = [];
    let naslov = `${BAZA}${SEZNAM}`;
    for (let i = 0; naslov && i < NAJVEC_STRANI; i++) {
        const { postavke, naslednja } = postavkeSeznama(await preberi(naslov));
        vse.push(...postavke);
        naslov = naslednja ? (naslednja.startsWith('http') ? naslednja : `${BAZA}${SEZNAM}${naslednja.startsWith('?') ? naslednja : ''}`) : null;
        await pocakaj(ZAMIK_MS);
    }
    if (!vse.length) console.error('[EIT] SEZNAM BREZ PRILOŽNOSTI — poglej izbirnike .views-row / .teaser-title');
    const financiranje = vse.filter((p) => !NI_FINANCIRANJE.test(p.naziv));
    console.log(`[EIT] priložnosti na seznamu: ${vse.length}, od tega izločenih (ni financiranje): ${vse.length - financiranje.length}`
        + (vse.length - financiranje.length ? ` — ${vse.filter((p) => NI_FINANCIRANJE.test(p.naziv)).map((p) => p.naziv).join(' | ')}` : ''));

    const rezultati = [];
    let napak = 0;
    for (const p of financiranje) {
        let opis = '';
        try {
            opis = opisStrani(await preberi(p.url));
        } catch (e) {
            // Brez opisa zapis še vedno ima naziv, rok in povezavo; napako zabeležimo.
            napak++;
            console.error(`[EIT] NAPAKA pri ${p.url}: ${e.message}`);
        }
        await pocakaj(ZAMIK_MS);
        const status = p.konec && p.konec < dan ? 'Zaprt' : (p.zacetek && p.zacetek > dan ? 'Napovedan' : 'Odprt');
        const deli = [`Skupnost: ${p.skupnost}`];
        if (p.zacetek) deli.push(`Odprtje: ${vNiz(p.zacetek)}`);
        if (p.konec) deli.push(`Rok: ${vNiz(p.konec)}`);
        if (opis) deli.push(opis);
        rezultati.push({
            'Naziv razpisa': p.naziv,
            'URL': p.url,
            'Status': status,
            'Rok prijave': p.konec ? vNiz(p.konec) : null,
            'Datum zaznave': vNiz(dan),
            'Datum objave': p.zacetek ? vNiz(p.zacetek) : null,
            'Programme': p.skupnost,
            'Tip financiranja': null,
            'Sredstva': null,
            'Vsebina': deli.join(' · ').substring(0, NAJVEC_ZNAKOV_VSEBINE),
            'Izdajatelj': p.skupnost,
            'Izvorna domena': 'eit.europa.eu',
        });
    }

    console.log(`[EIT] zajetih ${rezultati.length}, brez roka ${rezultati.filter((r) => !r['Rok prijave']).length}, napak ${napak}`);
    if (rezultati.length) await Actor.pushData(rezultati);
});
