/**
 * PHV — scraper mikroposojil za mala in srednja podjetja (Apify actor).
 *
 * PHV (Primorski hitri vlaki / financiranje) ponuja STALEN finančni produkt — mikroposojila —
 * enako kot SID banka svoje finančne instrumente (glej sid-scraper). Ni časovno omejenega
 * "razpisa": isti produkt je stalno na voljo, zato status "Odprt" brez roka prijave.
 * Uporabnik želi, da se PHV vodi kot scraper vir (kot SID banka), NE kot ročni vnos —
 * da lahko iz njega dela osnutke enako kot pri ostalih razpisih.
 *
 * Vir: https://phv.si/poslovno/kreditiranje/mikroposojila-za-mala-in-srednja-podjetja/
 *   (strežniško izrisano — plain fetch + cheerio). Ena produktna stran → en zapis.
 *
 * Izhod (pogodba polj za razpisi.js genericniMapper): Naziv razpisa, URL, Status, Rok prijave,
 * Datum zaznave, Vsebina.
 */
const { Actor } = require('apify');
const cheerio = require('cheerio');

const URL = 'https://phv.si/poslovno/kreditiranje/mikroposojila-za-mala-in-srednja-podjetja/';

function danes() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}
const cist = (t) => String(t || '').replace(/\s+/g, ' ').trim();

Actor.main(async () => {
    const r = await fetch(URL, { headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (razpisnik-portal scraper)' } });
    if (!r.ok) throw new Error(`PHV HTTP ${r.status}`);
    const html = await r.text();
    const $ = cheerio.load(html);

    // Naslov produkta: H1 strani; fallback na fiksni naziv, če se markup spremeni.
    const naziv = cist($('h1').first().text()) || 'Mikroposojila za mala in srednja podjetja';

    // Kratka vsebina: prvi vsebinski odstavek strani (za povzetek / osnutek). Poberemo prvi
    // dovolj dolg <p> znotraj glavne vsebine; sicer sestavimo splošen opis produkta.
    let opis = '';
    $('main p, article p, .entry-content p, .content p, p').each((_, el) => {
        if (opis) return;
        const t = cist($(el).text());
        if (t.length >= 60) opis = t;
    });
    const vsebina = opis
        ? `Stalni finančni produkt PHV (mikroposojilo za MSP). ${opis}`
        : 'Stalni finančni produkt PHV — mikroposojilo za mala in srednja podjetja (subvencioniran kredit).';

    const rezultat = {
        'Naziv razpisa': naziv,
        'URL': URL,
        'Status': 'Odprt',
        'Rok prijave': null, // stalni finančni produkt (brez roka)
        'Datum zaznave': danes(),
        'Vsebina': vsebina,
    };

    console.log(`[PHV] zajet produkt: ${naziv}`);
    await Actor.pushData([rezultat]);
});
