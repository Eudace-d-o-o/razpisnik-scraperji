/**
 * Gov.si — javne objave ministrstev (javni razpisi) — scraper (Apify actor).
 *
 * Vir: https://www.gov.si/zbirke/javne-objave/?status=*&titleref=&type=2&year=0&nrOfItems=100&start=N
 *   type=2 = javni razpisi (potrjeno na strani); status=* = vsi statusi. Stran je strežniško
 *   izrisana (plain fetch + cheerio, brez brskalnika). Paginacija prek 'start=' (0,100,200,...) —
 *   potrjeno 2026-07-22: ~13 strani (~1250 zadetkov). Samo DVA statusa obstajata na tej strani:
 *   "V teku" in "Zaključeno" (ni "Napovedano" — potrjeno z uporabnikom).
 *
 *   Vsaka vrstica (tr) v table.list-table.tender-list-table:
 *     td.td-id          -> Šifra (identifikator)
 *     td.td-title a     -> naziv + URL (relativen, dodaj https://www.gov.si)
 *     td.td-publisher   -> Institucija (ministrstvo) -> Programme
 *     td.td-published-date -> Datum objave
 *     td.td-due-date    -> Rok prijave
 *     td.td-status .label -> Status ("V teku" | "Zaključeno")
 *
 * Vsebina posameznega razpisa (pogoji, priloge) ostaja domena razpis-detail-scraper (kliče se
 * ločeno, ob generiranju povzetka/osnutka) — ta scraper samo pobere seznamsko vrstico, po
 * enakem vzorcu kot aris-scraper/srrs-scraper.
 *
 * Izhod (pogodba polj za razpisi.js genericniMapper): Naziv razpisa, URL, Status, Rok prijave,
 * Identifikator, Programme, Datum zaznave.
 */
const { Actor, log } = require('apify');
const cheerio = require('cheerio');

const BAZA = 'https://www.gov.si';
const KORAK = 100;
const MAX_STRANI = 30; // varovalka (dejansko ~13 strani / ~1250 zadetkov)

const STATUS_MAPA = { 'v teku': 'Odprt', 'zaključeno': 'Zaprt' };

function danes() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}
const cist = (t) => String(t || '').replace(/\s+/g, ' ').trim();

async function preberiStran(start) {
    const url = `${BAZA}/zbirke/javne-objave/?status=*&titleref=&type=2&year=0&nrOfItems=${KORAK}&start=${start}`;
    const r = await fetch(url, { headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (razpisnik-portal scraper)' } });
    if (!r.ok) throw new Error(`gov.si HTTP ${r.status} (start=${start})`);
    return cheerio.load(await r.text());
}

Actor.main(async () => {
    const rezultati = [];
    const videni = new Set();

    for (let stran = 0; stran < MAX_STRANI; stran++) {
        const start = stran * KORAK;
        const $ = await preberiStran(start);
        const vrstice = $('table.tender-list-table tbody tr');
        if (!vrstice.length) { log.info(`[gov.si] start=${start}: ni več vrstic — konec`); break; }

        vrstice.each((_, tr) => {
            const vrstica = $(tr);
            const a = vrstica.find('td.td-title a').first();
            const naziv = cist(a.text());
            const href = cist(a.attr('href'));
            if (!naziv || !href) return;
            const url = href.startsWith('http') ? href : `${BAZA}${href}`;
            if (videni.has(url)) return;
            videni.add(url);

            const sifra = cist(vrstica.find('td.td-id').text());
            const institucija = cist(vrstica.find('td.td-publisher').text());
            const rokPrijave = cist(vrstica.find('td.td-due-date').text());
            const statusRaw = cist(vrstica.find('td.td-status .label').text()).toLowerCase();
            const status = STATUS_MAPA[statusRaw] || 'Ni razvidno';

            rezultati.push({
                'Naziv razpisa': naziv,
                'URL': url,
                'Status': status,
                'Rok prijave': rokPrijave || null,
                'Identifikator': sifra || null,
                'Programme': institucija || null,
                'Datum zaznave': danes(),
            });
        });

        log.info(`[gov.si] stran ${stran + 1} (start=${start}): +${vrstice.length} vrstic, skupaj ${rezultati.length}`);
        // vljudnostni premor med stranmi
        await new Promise((res) => setTimeout(res, 300));
    }

    log.info(`[gov.si] zajetih ${rezultati.length} javnih razpisov ministrstev`);
    if (rezultati.length) await Actor.pushData(rezultati);
});
