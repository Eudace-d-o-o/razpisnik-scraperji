/**
 * NATO Science for Peace and Security in NATO DIANA — scraper razpisov (Apify actor).
 *
 * Oba programa objavita le nekaj razpisov na leto, zato je zagon majhen (samo raw-http, brez brskalnika):
 *
 * - SPS: stran programa na nato.int povezuje na razpisni dokument (SPS-Call4proposals-<leto>-<krog>.pdf).
 *   Dokument preberemo in rok vzamemo iz razdelka »DEADLINE FOR APPLICATIONS«.
 * - DIANA: diana.nato.int je za samodejno branje zaprta s preverbo Cloudflare (»Just a moment…«,
 *   izmerjeno 13. 10. 2026, tudi zemljevid strani). Te zaščite ne obhajamo. Nove izzive DIANA nato.int
 *   objavi kot novico z rokom v opisu (»submit proposals … until 12:00 UTC on Friday 11 July 2025«),
 *   zato DIANA, in poleg nje tudi nove razpise SPS, beremo iz zemljevida strani nato.int.
 *
 * robots.txt nato.int (13. 10. 2026) zapira samo /newsletter/.
 *
 * Izhod (pogodba polj za razpisi.js genericniMapper): Naziv razpisa, URL, Status, Rok prijave,
 * Datum zaznave, Datum objave, Vsebina, Programme, Tip financiranja, Izdajatelj, Izvorna domena.
 */
const { Actor } = require('apify');
const cheerio = require('cheerio');
const { rokInStatus, vNiz, danes } = require('./datumi-en');

const BAZA = 'https://www.nato.int';
const SPS_STRAN = `${BAZA}/en/about-us/organization/nato-structure/science-for-peace-and-security-hub`;
const ZEMLJEVID = `${BAZA}/sitemap.xml`;
const STAROST_DNI = 400;
const ZAMIK_MS = 500;
const NAJVEC_ZNAKOV_VSEBINE = 2000;
const UA = 'Mozilla/5.0 (razpisnik-portal scraper)';

// Novica o novem razpisu: v poti je program in beseda razpisa ali izziva. Izločimo novice o izbranih
// projektih, prireditvah in drugih storitvah programa.
const NOVICA_PROGRAM = /diana|-sps-|science-for-peace/;
const NOVICA_RAZPIS = /challenge|call-for|new-call|open-call/;
const NOVICA_NI_RAZPIS = /selects|selected|winners|photo|magazine|demonstrat|rapid-adoption|kicking-off|connects/;

const cist = (t) => String(t || '').replace(/\s+/g, ' ').trim();
const pocakaj = (ms) => new Promise((r) => setTimeout(r, ms));

async function preberi(url) {
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error(`HTTP ${r.status} pri ${url}`);
    return r;
}

/** Razpisni dokumenti SPS, na katere povezuje stran programa. */
async function razpisiSps(dan) {
    const $ = cheerio.load(await (await preberi(SPS_STRAN)).text());
    const dokumenti = new Set();
    $('a[href]').each((_, a) => {
        const href = $(a).attr('href');
        if (/SPS-Call4proposals-\d{4}-\d+\.pdf$/i.test(href)) dokumenti.add(new URL(href, SPS_STRAN).href);
    });
    const { PDFParse } = require('pdf-parse');
    const razpisi = [];
    for (const url of dokumenti) {
        const krog = url.match(/Call4proposals-(\d{4}-\d+)\.pdf/i)[1];
        const parser = new PDFParse({ data: Buffer.from(await (await preberi(url)).arrayBuffer()) });
        const besedilo = cist((await parser.getText()).text);
        await parser.destroy();
        // Rok je v razdelku »DEADLINE FOR APPLICATIONS«; drugi datumi v dokumentu so roki dogodkov.
        const razdelek = besedilo.split(/DEADLINE FOR APPLICATIONS/i).pop();
        const { rok, status } = rokInStatus(razdelek, dan);
        razpisi.push({
            'Naziv razpisa': `NATO Science for Peace and Security Call for Proposals ${krog}`,
            'URL': url,
            'Status': status,
            'Rok prijave': rok,
            'Datum zaznave': vNiz(dan),
            'Datum objave': null,
            'Programme': 'NATO Science for Peace and Security',
            'Tip financiranja': 'Nepovratna sredstva',
            'Sredstva': null,
            'Vsebina': besedilo.substring(0, NAJVEC_ZNAKOV_VSEBINE),
            'Izdajatelj': 'NATO Science for Peace and Security Programme',
            'Izvorna domena': 'nato.int',
        });
        await pocakaj(ZAMIK_MS);
    }
    return razpisi;
}

/** Novice nato.int o novih izzivih DIANA in razpisih SPS v zadnjih STAROST_DNI dneh. */
async function razpisiIzNovic(dan) {
    const xml = await (await preberi(ZEMLJEVID)).text();
    const meja = new Date(dan.getTime() - STAROST_DNI * 86400000);
    const novice = [];
    for (const m of xml.matchAll(/<loc>([^<]*\/news-and-events\/articles\/news\/(\d{4})\/(\d{2})\/(\d{2})\/([^<]+))<\/loc>/g)) {
        const [, url, leto, mesec, danMeseca, pot] = m;
        if (new Date(Number(leto), Number(mesec) - 1, Number(danMeseca)) < meja) continue;
        if (!NOVICA_PROGRAM.test(pot) || !NOVICA_RAZPIS.test(pot) || NOVICA_NI_RAZPIS.test(pot)) continue;
        novice.push({ url, objava: new Date(Number(leto), Number(mesec) - 1, Number(danMeseca)), diana: /diana/.test(pot) });
    }
    const razpisi = [];
    for (const n of novice) {
        const $ = cheerio.load(await (await preberi(n.url)).text());
        const naslov = cist($('meta[property="og:title"]').attr('content') || $('title').text()).replace(/\s*\|\s*NATO News$/, '');
        const opis = cist($('meta[name="description"]').attr('content'));
        const { rok, status } = rokInStatus(opis, dan);
        razpisi.push({
            'Naziv razpisa': naslov,
            'URL': n.url,
            'Status': status,
            'Rok prijave': rok,
            'Datum zaznave': vNiz(dan),
            'Datum objave': vNiz(n.objava),
            'Programme': n.diana ? 'NATO DIANA' : 'NATO Science for Peace and Security',
            'Tip financiranja': 'Nepovratna sredstva',
            'Sredstva': null,
            'Vsebina': opis.substring(0, NAJVEC_ZNAKOV_VSEBINE),
            'Izdajatelj': n.diana ? 'NATO DIANA' : 'NATO Science for Peace and Security Programme',
            'Izvorna domena': 'nato.int',
        });
        await pocakaj(ZAMIK_MS);
    }
    return razpisi;
}

Actor.main(async () => {
    const dan = danes();
    const rezultati = [];
    let napak = 0;
    try {
        const sps = await razpisiSps(dan);
        // Stran programa ima vedno povezavo na zadnji razpis; brez nje se je stran spremenila.
        if (!sps.length) console.error('[NATO] STRAN SPS BREZ RAZPISNEGA DOKUMENTA — poglej povezave na strani programa');
        console.log(`[NATO] SPS razpisni dokumenti: ${sps.length}`);
        rezultati.push(...sps);
    } catch (e) {
        napak++;
        console.error(`[NATO] NAPAKA pri SPS: ${e.message}`);
    }
    try {
        const novice = await razpisiIzNovic(dan);
        console.log(`[NATO] novice o razpisih DIANA in SPS (zadnjih ${STAROST_DNI} dni): ${novice.length}`);
        rezultati.push(...novice);
    } catch (e) {
        napak++;
        console.error(`[NATO] NAPAKA pri novicah: ${e.message}`);
    }

    const poStanju = {};
    for (const r of rezultati) poStanju[r.Status] = (poStanju[r.Status] || 0) + 1;
    console.log(`[NATO] zajetih ${rezultati.length}, po stanju ${JSON.stringify(poStanju)}, napak ${napak}`);
    if (rezultati.length) await Actor.pushData(rezultati);
});
