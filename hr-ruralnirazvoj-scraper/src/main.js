/**
 * Hrvaška — Ruralni razvoj (kmetijski natječaji, EAFRD/ZPP) — scraper odprtih natječajev.
 *
 * ruralnirazvoj.hr/natjecaji je strežniško izrisan (article.tender__item v surovem HTML) -> plain
 * fetch + cheerio. Stran prikaže odprte IN zaprte -> filtriramo odprte (status "Otvoren" / razred
 * "opened"). Preko Apify RESIDENTIAL proxy (HR), ker hrvaške gov strani blokirajo ne-regionalne IP.
 *
 * Kartica:
 *   <article class="tender__item">
 *     <h2 class="tender-title"><a href="...">Naziv</a></h2>
 *     ... <span class="btn ... opened|closed">Otvoren|Zatvoren</span>
 *     <span class="tender-date"><strong>Datum prijave:</strong> 20. 7. 2026</span>
 *     <span class="tender-date"><strong>Kraj prijave:</strong> 31. 12. 2026</span>  (= rok)
 *
 * Izhod (pogodba polj za razpisi.js genericniMapper): Naziv razpisa, URL, Status, Rok prijave,
 * Datum zaznave, Vsebina.
 */
const { Actor } = require('apify');
const { ProxyAgent } = require('undici');
const cheerio = require('cheerio');

const VIR = 'https://ruralnirazvoj.hr/natjecaji/';

// "31. 12. 2026" -> "31.12.2026"
function ociste(datum) {
    const m = String(datum || '').match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
    return m ? `${m[1].padStart(2, '0')}.${m[2].padStart(2, '0')}.${m[3]}` : null;
}
function danes() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}
const cist = (t) => String(t || '').replace(/\s+/g, ' ').trim();

Actor.main(async () => {
    const proxyConfig = await Actor.createProxyConfiguration({ groups: ['RESIDENTIAL'], countryCode: 'HR' });
    const proxyUrl = await proxyConfig.newUrl();
    const dispatcher = new ProxyAgent({ uri: proxyUrl, requestTls: { rejectUnauthorized: false }, headersTimeout: 60000, bodyTimeout: 60000 });

    const r = await fetch(VIR, {
        dispatcher,
        headers: {
            Accept: 'text/html',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        },
    });
    if (!r.ok) throw new Error(`Ruralni razvoj HTTP ${r.status}`);
    const html = await r.text();
    const $ = cheerio.load(html);

    const rezultati = [];
    const videni = new Set();

    $('article.tender__item').each((_, el) => {
        const card = $(el);
        // status: samo odprti (razred "opened" ali besedilo "Otvoren")
        const statusEl = card.find('.status').nextAll('span').first();
        const statusTxt = cist(card.find('span.btn').first().text());
        const jeOdprt = card.find('span.btn.opened').length > 0 || /otvoren/i.test(statusTxt);
        if (!jeOdprt) return;

        const a = card.find('h2.tender-title a').first();
        const naziv = cist(a.text());
        const url = cist(a.attr('href'));
        if (!naziv || !url || videni.has(url)) return;
        videni.add(url);

        // datumi: poišči .tender-date z oznako "Kraj prijave" (rok) in "Datum prijave" (začetek)
        let rok = null, zacetek = null;
        card.find('.tender-date').each((__, d) => {
            const t = cist($(d).text());
            if (/kraj prijave/i.test(t)) rok = ociste(t);
            else if (/datum prijave/i.test(t)) zacetek = ociste(t);
        });

        const deli = ['Kmetijstvo / ruralni razvoj (ZPP)'];
        if (zacetek) deli.push(`Datum prijave: ${zacetek}`);
        if (rok) deli.push(`Kraj prijave: ${rok}`);

        rezultati.push({
            'Naziv razpisa': naziv,
            'URL': url,
            'Status': 'Odprt',
            'Rok prijave': rok,
            'Datum zaznave': danes(),
            'Vsebina': deli.join(' · '),
        });
    });

    console.log(`[HR-RURALNI] zajetih ${rezultati.length} odprtih natječajev`);
    if (rezultati.length) await Actor.pushData(rezultati);
});
