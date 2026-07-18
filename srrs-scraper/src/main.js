/**
 * SRRS — Slovenski regionalno razvojni sklad — scraper odprtih javnih razpisov (Apify actor).
 *
 * WordPress + FacetWP. Filter "?_sft_status-razpisa=odprto" je STREŽNIŠKI (vrne SAMO odprte
 * razpise), zato so vsi zajeti razpisi po definiciji odprti. Stran je strežniško izrisana ->
 * plain fetch + cheerio (brez brskalnika).
 *
 * Vir: https://www.srrs.si/javni-razpisi/?_sft_status-razpisa=odprto
 *   Razpisi so v tabelah (table.javni-razpisi-collapsible), grupiranih po kategoriji (h2).
 *   Vsak <tr> = en produkt/razpis s stolpci:
 *     td[0] a         -> naziv + URL
 *     td[1]           -> upravičeno območje
 *     td[2]           -> namen
 *     td.javni-razpis-number    -> št. javnega razpisa (identifikator)
 *     td[4]           -> oblika sredstev
 *     td.min-in-max-sredstev    -> min-max sredstev (v €)
 *     td.odplacilna-doba        -> odplačilna doba
 *     td.javni-razpisi-roki ul li -> razpisni roki (obdobja/datumi)
 *
 * Izhod (pogodba polj za razpisi.js genericniMapper): Naziv razpisa, URL, Status, Rok prijave,
 * Datum zaznave, Vsebina, Identifikator.
 */
const { Actor } = require('apify');
const cheerio = require('cheerio');

const VIR = 'https://www.srrs.si/javni-razpisi/?_sft_status-razpisa=odprto';

function danes() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}
// iz niza rokov ("09.07.2026-31.12.2027") vzemi ZADNJI datum (končni rok prijave)
function zadnjiDatum(besedilo) {
    const m = String(besedilo || '').match(/\d{2}\.\d{2}\.\d{4}/g);
    return m && m.length ? m[m.length - 1] : null;
}
const cist = (t) => String(t || '').replace(/\s+/g, ' ').trim();

Actor.main(async () => {
    const r = await fetch(VIR, { headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (razpisnik-portal scraper)' } });
    if (!r.ok) throw new Error(`SRRS HTTP ${r.status}`);
    const html = await r.text();
    const $ = cheerio.load(html);

    const rezultati = [];
    const videni = new Set();

    $('table.javni-razpisi-collapsible tbody tr').each((_, tr) => {
        const vrstica = $(tr);
        // tooltip-i (.tooltiptext) se sicer prilepijo na vidno besedilo celice -> odstrani jih
        vrstica.find('.tooltiptext').remove();
        const a = vrstica.find('td').first().find('a[href*="/javni-razpisi/"]').first();
        const naziv = cist(a.text());
        const url = cist(a.attr('href'));
        if (!naziv || !url || videni.has(url)) return;
        videni.add(url);

        const tds = vrstica.find('td');
        const obmocje = cist($(tds.get(1)).text());
        const namen = cist($(tds.get(2)).text());
        const stRazpisa = cist(vrstica.find('td.javni-razpis-number').text());
        const oblika = cist($(tds.get(4)).text());
        const sredstva = cist(vrstica.find('td.min-in-max-sredstev').text());
        const rokiRaw = cist(vrstica.find('td.javni-razpisi-roki').text());

        const deli = [];
        if (namen) deli.push(namen);
        if (oblika) deli.push(oblika);
        if (sredstva) deli.push(`${sredstva} €`);
        if (obmocje) deli.push(`Območje: ${obmocje}`);
        if (rokiRaw) deli.push(`Roki: ${rokiRaw}`);

        rezultati.push({
            'Naziv razpisa': naziv,
            'URL': url,
            'Status': 'Odprt',
            'Rok prijave': zadnjiDatum(rokiRaw),
            'Datum zaznave': danes(),
            'Vsebina': deli.join(' · ').substring(0, 2000),
            'Identifikator': stRazpisa || null,
        });
    });

    console.log(`[SRRS] zajetih ${rezultati.length} odprtih javnih razpisov`);
    if (rezultati.length) await Actor.pushData(rezultati);
});
