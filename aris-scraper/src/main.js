/**
 * ARIS Scraper — javni razpisi in pozivi ARIS
 * Faza 1: Scrapa tabelo razpisov (seznam)
 * Faza 2: Za vsak razpis z URL-jem obišče stran in pobere vsebino
 */

import { Actor, KeyValueStore } from 'apify';
import { CheerioCrawler } from 'crawlee';

const STATE_KEY = 'ARIS_RAZPISI';
const STORE_NAME = 'aris-state';

function danes() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
}

function slugify(str) {
    return str.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').substring(0, 80);
}

function cisti(txt) {
    return (txt || '').replace(/\r?\n/g, ' ').replace(/\t/g, ' ').replace(/\s+/g, ' ').trim();
}

// Počisti Windows-1250 encoding artefakte
function cistiEncoding(txt) {
    return (txt || '')
        .replace(/�/g, '')  // replacement chars
        .replace(/[\x80-\x9F]/g, '') // kontrolni znaki
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizirajStatus(s) {
    if (!s) return 'Ni razvidno';
    const l = s.toLowerCase();
    if (l.includes('v teku') || l.includes('odprt')) return 'Odprt';
    if (l.includes('zaklju') || l.includes('zaprt')) return 'Zaprt';
    if (l.includes('na') && (l.includes('rtovan') || l.includes('načrtovan'))) return 'Načrtovan';
    if (l.includes('objava sledi')) return 'Načrtovan';
    if (l.includes('rezultat') || l.includes('delni')) return 'Zaključen';
    return s.substring(0, 30);
}

// Izvleče vsebino razpisne strani
function izvlecVsebino($) {
    // Poskusi različne selektorje za vsebino
    let vsebina = '';

    // Glavni content div
    const contentSelectors = [
        '.content-main', '#content', '.main-content',
        'td.vsebina', '.vsebina', '[class*="content"]',
        'table.razpis', '.razpis-vsebina'
    ];

    for (const sel of contentSelectors) {
        const el = $(sel);
        if (el.length && el.text().trim().length > 200) {
            vsebina = cisti(el.text());
            break;
        }
    }

    // Fallback: vzemi vso besedilo iz body brez navigacije
    if (!vsebina || vsebina.length < 100) {
        // Odstrani navigacijo, noge, glavo
        $('nav, header, footer, .nav, .menu, .footer, .header, script, style').remove();
        vsebina = cisti($('body').text());
    }

    // Omeji dolžino
    return vsebina.substring(0, 5000);
}

await Actor.init();

const store = await KeyValueStore.open(STORE_NAME);
const obstojeceStanje = (await store.getValue(STATE_KEY)) ?? {};
const novoStanje = { ...obstojeceStanje };
const najdeniRazpisi = [];

// ── FAZA 1: Scrapa tabelo razpisov ──────────────────────────────────────────
console.log('[ARIS] Faza 1: Scraping tabel razpisov...');

const tabelaCrawler = new CheerioCrawler({
    requestHandlerTimeoutSecs: 60,
    maxRequestRetries: 3,
    requestHandler: async ({ $, request }) => {
        const leto = request.userData?.leto || '2026';
        let najdenih = 0;

        $('table tr').each((_, row) => {
            const cells = $(row).find('td');
            if (cells.length < 3) return;

            const zapSt = cisti($(cells[0]).text());
            if (!zapSt || isNaN(parseInt(zapSt))) return;

            const datumObjave = cisti($(cells[1]).text());
            const nazivCell   = $(cells[2]);

            let naziv = cisti(nazivCell.text())
                .replace(/Sprememba\s+(Javnega|Pilotnega|javnega|pilotnega)[^(]*/g, '')
                .replace(/\s+/g, ' ').trim();

            if (!naziv || naziv.length < 5) return;

            const status     = normalizirajStatus(cells.length > 3 ? cisti($(cells[3]).text()) : '');
            const rokPrijave = cells.length > 4 ? cisti($(cells[4]).text()) : '';
            const datumRez   = cells.length > 5 ? cisti($(cells[5]).text()) : '';
            const vrednost   = cells.length > 6 ? cisti($(cells[6]).text()) : '';
            const sektor     = cells.length > 7 ? cisti($(cells[7]).text()) : '';

            let url = '';
            const href = nazivCell.find('a[href]').first().attr('href') || '';
            if (href) {
                try {
                    url = new URL(href, request.url).href;
                } catch {
                    url = href.startsWith('http') ? href
                        : href.startsWith('/') ? `https://www.aris-rs.si${href}`
                        : `https://www.aris-rs.si/sl/razpisi/${leto}/${href}`;
                }
            }
            if (!url) {
                url = `${request.url}#${parseInt(zapSt)}`;
            }

            const key = `aris-${leto}-${parseInt(zapSt)}-${slugify(naziv).substring(0, 40)}`;
            const datumZaznave = obstojeceStanje[key]?.datumZaznave || danes();
            const obstojecaVsebina = obstojeceStanje[key]?.vsebina || '';

            novoStanje[key] = {
                key, naziv, url, vir: 'ARIS', leto, status,
                datumObjave, rokPrijave, datumRez, vrednost, sektor,
                datumZaznave, zadnjaPosodobitev: danes(),
                vsebina: obstojecaVsebina, // ohrani obstoječo vsebino
                imaUrl: !url.includes('#'), // označimo razpise z dejanskim URL-jem
            };
            najdeniRazpisi.push(novoStanje[key]);
            najdenih++;
        });
        console.log(`[ARIS] Leto ${leto}: ${najdenih} razpisov najdenih`);
    },
});

await tabelaCrawler.run([
    { url: 'https://www.aris-rs.si/sl/razpisi/26/pregled-razpisov-26.asp', userData: { leto: '2026' } },
    { url: 'https://www.aris-rs.si/sl/razpisi/25/pregled-razpisov-25.asp', userData: { leto: '2025' } },
]);

// ── FAZA 2: Poberi vsebino za razpise z dejanskim URL-jem ───────────────────
console.log('[ARIS] Faza 2: Scraping vsebine posameznih razpisov...');

// Razpisi ki imajo dejanski URL (ne #anchor) in nimajo vsebine
const zaFetch = najdeniRazpisi.filter(r => r.imaUrl && !r.vsebina);
console.log(`[ARIS] Razpisov za fetch vsebine: ${zaFetch.length}`);

if (zaFetch.length > 0) {
    const vsebinaCrawler = new CheerioCrawler({
        requestHandlerTimeoutSecs: 60,
        maxRequestRetries: 2,
        maxConcurrency: 3,
        requestHandler: async ({ $, request }) => {
            const key = request.userData?.key;
            if (!key || !novoStanje[key]) return;

            const vsebina = izvlecVsebino($);
            if (vsebina && vsebina.length > 100) {
                novoStanje[key].vsebina = cistiEncoding(vsebina);
                console.log(`[ARIS] Vsebina: ${key.substring(0,50)} (${vsebina.length} znakov)`);
            }
        },
        failedRequestHandler: async ({ request }) => {
            console.log(`[ARIS] Napaka pri fetchanju: ${request.url}`);
        },
    });

    const requests = zaFetch.map(r => ({
        url: r.url,
        userData: { key: r.key },
    }));

    await vsebinaCrawler.run(requests);
}

// ── SHRANI ───────────────────────────────────────────────────────────────────
await store.setValue(STATE_KEY, novoStanje);

const dataset = await Actor.openDataset();
for (const r of najdeniRazpisi) {
    await dataset.pushData({
        'Naziv razpisa':      r.naziv,
        'URL':                r.url,
        'Vir':                'ARIS',
        'Status':             r.status,
        'Datum objave':       r.datumObjave,
        'Rok prijave':        r.rokPrijave,
        'Datum rezultatov':   r.datumRez,
        'Vrednost (EUR)':     r.vrednost,
        'Sektor':             r.sektor,
        'Leto':               r.leto,
        'Datum zaznave':      r.datumZaznave,
        'Zadnja posodobitev': r.zadnjaPosodobitev,
        'Vsebina':            r.vsebina || '',
    });
}

console.log(`[ARIS] Skupaj: ${najdeniRazpisi.length} | Novih: ${najdeniRazpisi.filter(r=>!obstojeceStanje[r.key]).length}`);
await Actor.exit();
