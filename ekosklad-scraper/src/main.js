/**
 * Eko sklad — scraper odprtih javnih pozivov za GOSPODARSTVO (Apify actor).
 *
 * Eko sklad NIMA JSON API-ja, a je stran STREŽNIŠKO IZRISANA (podatki so v surovem HTML),
 * zato zadošča plain fetch + cheerio (brez brskalnika/Playwright). Teče kot Apify actor zaradi
 * enotnega sistema z ostalimi viri (glej pogovor 2026-07-18).
 *
 * Vir: https://www.ekosklad.si/gospodarstvo/pridobite-spodbudo/objava
 *   Kartica: div[data-component="card-investment"]
 *     - status:  span.tw-text-xs.tw-font-semibold  -> "Poziv je odprt" / "Poziv je zaprt"
 *     - naslov:  p.tw-mb-4.tw-font-semibold
 *     - datum:   .description -> "Datum objave" -> <strong>DD. MM. YYYY</strong>
 *     - povezava: a.btn ("Preberi več")
 *
 * Eko sklad pozivi nimajo fiksnega roka prijave (tečejo do porabe sredstev), zato je "Rok prijave"
 * prazen, status pa "Odprt" (zajemamo SAMO odprte pozive).
 *
 * Izhod (pogodba polj za razpisi.js genericniMapper): Naziv razpisa, URL, Status, Rok prijave,
 * Datum zaznave, Vsebina.
 */
const { Actor } = require('apify');
const cheerio = require('cheerio');
const { Agent } = require('undici');

const VIR = 'https://www.ekosklad.si/gospodarstvo/pridobite-spodbudo/objava';

// ekosklad.si ne postreze popolne verige certifikatov (manjka vmesni cert) -> Node fetch
// zavrne "unable to verify the first certificate". Preverjanje izklopimo SAMO za ta en fetch
// (dispatcher velja lokalno, ne globalno), ker actor bere le to javno stran.
const tlsAgent = new Agent({ connect: { rejectUnauthorized: false } });

// "10. 06. 2026" (s presledki) -> "10.06.2026"
function ociste(datum) {
    if (!datum) return null;
    const m = String(datum).match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
    if (!m) return null;
    return `${m[1].padStart(2, '0')}.${m[2].padStart(2, '0')}.${m[3]}`;
}
function danes() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

Actor.main(async () => {
    const r = await fetch(VIR, {
        dispatcher: tlsAgent,
        headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (razpisnik-portal scraper)' },
    });
    if (!r.ok) throw new Error(`Eko sklad HTTP ${r.status}`);
    const html = await r.text();
    const $ = cheerio.load(html);

    const rezultati = [];
    $('div[data-component="card-investment"]').each((_, el) => {
        const card = $(el);
        const status = card.find('span.tw-text-xs.tw-font-semibold').first().text().trim();
        // zajemi SAMO odprte pozive
        if (!/odprt/i.test(status)) return;

        const naziv = card.find('p.tw-mb-4.tw-font-semibold').first().text().trim();
        const url = (card.find('a.btn').first().attr('href') || '').trim();
        if (!naziv || !url) return;

        // datum objave: v .description poišči odstavek "Datum objave" in vzemi naslednji <strong>
        let datumObjave = null;
        card.find('.description p').each((i, p) => {
            if (/Datum objave/i.test($(p).text())) {
                datumObjave = ociste($(p).next('p').find('strong').first().text() || $(p).next('p').text());
            }
        });

        const vsebina = datumObjave
            ? `Datum objave: ${datumObjave}. Poziv je odprt do porabe sredstev.`
            : 'Poziv je odprt do porabe sredstev.';

        rezultati.push({
            'Naziv razpisa': naziv,
            'URL': url,
            'Status': 'Odprt',
            'Rok prijave': null, // Eko sklad: brez fiksnega roka (do porabe sredstev)
            'Datum zaznave': danes(),
            'Vsebina': vsebina,
        });
    });

    console.log(`[EKOSKLAD] zajetih ${rezultati.length} odprtih javnih pozivov (gospodarstvo)`);
    if (rezultati.length) await Actor.pushData(rezultati);
});
