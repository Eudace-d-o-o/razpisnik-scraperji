/**
 * CMEPIUS — nacionalna agencija za Erasmus+ (izobraževanje, usposabljanje, šport) — scraper rokov (Apify actor).
 *
 * Naročnik 3. 11. 2026: decentralizirani roki Erasmus+ (KA1, KA2, KA240, akreditacije) v portal doslej niso
 * prišli iz nobenega vira; vir EU vidi samo centralizirane teme. Izmerjeno 26. 10. 2026: roki 2026 so bili
 * 12. 2.–29. 9. 2026, v bazi ni bilo nobenega.
 *
 * Beremo seznam /razpisi/, iz njega povezave na letne strani »Razpis Erasmus+ <leto>« od 2025 naprej (PRVO_LETO).
 * Strani so strežniško izrisane -> fetch + cheerio.
 *
 * robots.txt (3. 11. 2026) zapira samo /wp-content/uploads/dokumenti; seznama in letnih strani ne.
 *
 * Izhod (pogodba polj za razpisi.js genericniMapper): Naziv razpisa, URL, Status, Rok prijave,
 * Datum zaznave, Datum objave, Vsebina, Identifikator, Programme, Izdajatelj, Izvorni URL.
 */
const { Actor } = require('apify');
const { letneStrani, zapisiLetneStrani } = require('./razclemba');

const BAZA = 'https://www.cmepius.si';
const SEZNAM = '/razpisi/';
const ZAMIK_MS = 300;
const PRVO_LETO = 2025;
const UA = 'Mozilla/5.0 (razpisnik-portal scraper)';

const pocakaj = (ms) => new Promise((r) => setTimeout(r, ms));

function danes() {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

async function preberi(url) {
    const r = await fetch(url, { headers: { Accept: 'text/html', 'User-Agent': UA } });
    if (!r.ok) throw new Error(`HTTP ${r.status} pri ${url}`);
    return r.text();
}

Actor.main(async () => {
    const dan = danes();
    // Vse letne strani od 2025 naprej, ne »letos in lani«: ob prehodu leta bi drsno okno odvrglo celo leto zapisov,
    // nočni nadzor pa padec števila zapisov pri tem viru šteje za izgubo podatkov (veriga-nadzor.sql, preverba 10b).
    const strani = letneStrani(await preberi(`${BAZA}${SEZNAM}`), BAZA)
        .filter((s) => s.leto >= PRVO_LETO);
    // Prazen seznam pomeni, da se je stran /razpisi/ spremenila, ne da CMEPIUS nima razpisa: lanska stran obstaja vedno.
    if (!strani.length) throw new Error('[CMEPIUS] na seznamu /razpisi/ ni nobene letne strani razpisa Erasmus+ — poglej povezave');
    console.log(`[CMEPIUS] letne strani: ${strani.map((s) => s.leto).join(', ')}`);

    const rezultati = [];
    for (const stran of strani) {
        await pocakaj(ZAMIK_MS);
        const { zapisi, nerazclenjene } = zapisiLetneStrani(await preberi(stran.url), stran, dan);
        // Vrstica brez berljivega roka ustavi zagon: tihi izpad enega ukrepa bi bil izgubljen rok, ki ga nihče ne opazi.
        // Zajem portala ob padlem zagonu javi napako, stari zapisi ostanejo.
        if (nerazclenjene.length) throw new Error(`[CMEPIUS] ${stran.url}: vrstice brez berljivega roka: ${nerazclenjene.join('; ')}`);
        // Letna stran brez rokov je okvara razčlembe, ne prazen razpis: vsaka objavljena stran ima preglednico rokov.
        if (!zapisi.length) throw new Error(`[CMEPIUS] ${stran.url}: v preglednici ni nobenega roka — poglej obliko strani`);
        rezultati.push(...zapisi);
    }

    const poStanju = {};
    for (const r of rezultati) poStanju[r.Status] = (poStanju[r.Status] || 0) + 1;
    console.log(`[CMEPIUS] zajetih ${rezultati.length}, po stanju ${JSON.stringify(poStanju)}`);
    await Actor.pushData(rezultati);
});
