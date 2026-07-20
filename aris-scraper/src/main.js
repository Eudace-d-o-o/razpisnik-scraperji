/**
 * ARIS Scraper — javni razpisi in pozivi ARIS
 *
 * ARIS je poleti 2026 preuredil spletno stran: stari URL-ji
 * (pregled-razpisov-26.asp ipd.) ne obstajajo več, seznam razpisov je zdaj na dveh
 * ločenih straneh:
 *   - Odprti:     https://www.aris-rs.si/objave/razpisi/odprti
 *   - Načrtovani: https://www.aris-rs.si/objave/nacrtovani-razpisi  (Datum objave = PREDVIDEN,
 *                 se lahko spremeni)
 *
 * Seznam je JS-driven (paginacija prek gumba "Naslednja stran" — data-aris-page-next —
 * ne preprost ?page= parameter, poskušeno in potrjeno 2026-07-03), zato uporabljamo
 * PlaywrightCrawler namesto CheerioCrawler: naložimo stran, preberemo trenutne kartice,
 * kliknemo "naprej" in ponovimo za vse strani (data-page-count na [data-aris-listing]).
 *
 * Vsebina posameznega razpisa (pogoji, sektor, rokovnik) ostaja domena
 * razpis-detail-scraper (kliče se ločeno, ob generiranju povzetka) — ta scraper samo
 * pobere seznamsko kartico (naziv, URL, status, rok/datum objave, vrednost).
 */

import { Actor, log } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import * as cheerio from 'cheerio';

const STRANI = [
    { url: 'https://www.aris-rs.si/objave/razpisi/odprti', tip: 'odprt' },
    { url: 'https://www.aris-rs.si/objave/nacrtovani-razpisi', tip: 'nacrtovan' },
    // Zaključeni (zaprti) razpisi — večstranski arhiv (~60+ strani). Uporabnik želi videti
    // tudi zaprte razpise (glej pogovor 2026-07-20). Status vedno "Zaprt" (glej razcleniKartice).
    { url: 'https://www.aris-rs.si/objave/razpisi/zakljuceni', tip: 'zakljucen' },
];

function danes() {
    return new Date().toISOString().substring(0, 10);
}

// "24. 7. 2026 (14:00)" ali "1. 9. 2026" → "24.07.2026" (zero-padded, brez ure —
// razpisi.js normalizirajDatumZaZapis/rok_oddaje pričakuje "DD.MM.YYYY").
function normalizirajDatum(besedilo) {
    if (!besedilo) return null;
    const m = besedilo.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
    if (!m) return null;
    return `${m[1].padStart(2, '0')}.${m[2].padStart(2, '0')}.${m[3]}`;
}

// Razčleni HTML fragment strani v kartice razpisov (glej dejansko markup na
// aris-rs.si — potrjeno 2026-07-03: .razpis-card--kartica, header .tags[1] .tag = status,
// h4 a = naziv+URL, footer <p><span>Rok:/Datum objave:/Razpisana vrednost:</span><strong>...).
function razcleniKartice(html, tip) {
    const $ = cheerio.load(html);
    const rezultati = [];

    $('.razpis-card--kartica').each((_, el) => {
        const $card = $(el);
        const $a = $card.find('h4 a').first();
        const naziv = $a.text().replace(/\s+/g, ' ').trim();
        const href = $a.attr('href');
        if (!naziv || !href) return;
        const url = href.startsWith('http') ? href : `https://www.aris-rs.si${href}`;

        // Status tag je DRUGI ".tags" blok v headerju (prvi je kategorija) — "ODPRT"/"NAČRTOVAN".
        const statusTag = $card.find('header .tags').eq(1).find('.tag').first().text().trim();
        const status = tip === 'zakljucen' ? 'Zaprt'
            : /odprt/i.test(statusTag) ? 'Odprt' : /na.rtovan/i.test(statusTag) ? 'Načrtovan' : (tip === 'odprt' ? 'Odprt' : 'Načrtovan');

        let rokPrijave = null, datumObjave = null, vrednost = null;
        $card.find('.razpisi-kartica__meta p').each((_, p) => {
            const label = $(p).find('span').first().text().trim();
            const vrednostBesedilo = $(p).find('strong').first().text().trim();
            if (/^Rok:?$/i.test(label)) rokPrijave = normalizirajDatum(vrednostBesedilo);
            else if (/^Datum objave:?$/i.test(label)) datumObjave = normalizirajDatum(vrednostBesedilo);
            else if (/^Razpisana vrednost:?$/i.test(label)) vrednost = vrednostBesedilo;
        });

        rezultati.push({
            'Naziv razpisa': naziv,
            'URL': url,
            'Status': status,
            'Rok prijave': rokPrijave,
            'Datum objave': datumObjave,
            'Vrednost (EUR)': vrednost,
            'Datum zaznave': danes(),
        });
    });

    return rezultati;
}

await Actor.init();

const vsiRezultati = [];
const videniUrl = new Set();

const crawler = new PlaywrightCrawler({
    // Zaključeni razpisi imajo ~60+ strani — paginacija (klik "naprej" × N) traja dlje,
    // zato večji timeout na zahtevo (privzetih 120s ni dovolj za cel arhiv).
    requestHandlerTimeoutSecs: 600,
    maxRequestsPerCrawl: STRANI.length,
    async requestHandler({ page, request }) {
        const tip = request.userData.tip;
        log.info(`[ARIS] Nalagam: ${request.url} (${tip})`);

        await page.waitForSelector('.razpis-card--kartica', { timeout: 30000 }).catch(() => {
            log.warning(`[ARIS] Ni najdenih kartic na ${request.url} (mogoče spremenjena stran?)`);
        });

        // Piškotni modal (#cookie-modal) je ob prvem obisku VEDNO odprt in prekriva celo
        // stran (intercepts pointer events) — brez zapiranja klik na "Naslednja stran" vedno
        // odpove s timeoutom (ugotovljeno 2026-07-03, glej log). "Izberi vse in zapri" je
        // edini gumb, ki modal dejansko zapre (ne le skrije enega taba nastavitev).
        const cookieGumb = await page.$('#cookieCommitAll');
        if (cookieGumb) {
            await cookieGumb.click().catch(() => {});
            await page.waitForSelector('#cookie-modal', { state: 'hidden', timeout: 5000 }).catch(() => {});
        }

        const pageCountAttr = await page.getAttribute('[data-aris-listing]', 'data-page-count').catch(() => null);
        const steviloStrani = Math.max(1, parseInt(pageCountAttr, 10) || 1);
        log.info(`[ARIS] ${tip}: zaznanih ${steviloStrani} strani rezultatov`);

        for (let stran = 1; stran <= steviloStrani; stran++) {
            const html = await page.content();
            const kartice = razcleniKartice(html, tip);

            let novih = 0;
            for (const k of kartice) {
                if (!videniUrl.has(k['URL'])) {
                    videniUrl.add(k['URL']);
                    vsiRezultati.push(k);
                    novih++;
                }
            }
            log.info(`[ARIS] ${tip} stran ${stran}/${steviloStrani}: ${kartice.length} kartic, ${novih} novih`);

            if (stran < steviloStrani) {
                const prvaPovezavaPred = kartice[0]?.['URL'];
                const gumb = await page.$('[data-aris-page-next]');
                if (!gumb) { log.warning(`[ARIS] Gumb "Naslednja stran" ni najden — ustavljam pri strani ${stran}`); break; }
                await gumb.click();
                // Počakaj da se prva kartica dejansko spremeni (potrdi da je nova stran naložena),
                // varnostna omejitev 15s (na voljo pade nazaj na trenutno stanje, ne ustavi actorja).
                await page.waitForFunction(
                    (prejsnjaPovezava) => {
                        const prva = document.querySelector('.razpis-card--kartica h4 a');
                        return prva && prva.getAttribute('href') !== prejsnjaPovezava;
                    },
                    prvaPovezavaPred?.replace('https://www.aris-rs.si', ''),
                    { timeout: 15000 }
                ).catch(() => log.warning(`[ARIS] Stran ${stran + 1} se morda ni pravilno naložila (timeout čakanja na spremembo)`));
                await page.waitForTimeout(400);
            }
        }
    },
    failedRequestHandler({ request }) {
        log.error(`[ARIS] Ni uspelo naložiti: ${request.url}`);
    },
});

await crawler.run(STRANI.map(s => ({ url: s.url, userData: { tip: s.tip } })));

log.info(`[ARIS] Skupaj zaznanih razpisov: ${vsiRezultati.length}`);
if (vsiRezultati.length) await Actor.pushData(vsiRezultati);

await Actor.exit();
