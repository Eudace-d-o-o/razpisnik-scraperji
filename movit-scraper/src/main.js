/**
 * MOVIT — nacionalna agencija za Erasmus+ Mladina in Evropsko solidarnostno enoto — scraper prijavnih rokov (Apify actor).
 *
 * Naročnik 3. 11. 2026: decentralizirani roki Erasmus+ v portal doslej niso prišli iz nobenega vira; vir EU vidi
 * samo centralizirane teme. Izmerjeno 3. 11. 2026: Erasmus+ Mladina je imel v letu 2026 štiri roke (12. 2., 5. 3.,
 * 29. 9., 1. 10.), Evropska solidarnostna enota tri (18. 2. dvakrat, 1. 10.).
 *
 * Bereta se dve strani »Prijavni roki«, po ena za program. Strani sta strežniško izrisani -> fetch + cheerio.
 *
 * robots.txt (3. 11. 2026) ne zapira ničesar.
 *
 * Izhod (pogodba polj za razpisi.js genericniMapper): Naziv razpisa, URL, Status, Rok prijave,
 * Datum zaznave, Vsebina, Identifikator, Programme, Izdajatelj, Izvorni URL.
 */
const { Actor } = require('apify');
const { zapisiStrani } = require('./razclemba');

const PROGRAMI = [
    { koda: 'EM', ime: 'Erasmus+ Mladina', url: 'https://www.movit.si/erasmus-mladina/prijava-projekta/prijavni-roki/' },
    { koda: 'ESE', ime: 'Evropska solidarnostna enota', url: 'https://www.movit.si/evropska-solidarnostna-enota/prijava-projekta/prijavni-roki/' },
];
const ZAMIK_MS = 300;
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
    const rezultati = [];
    for (const program of PROGRAMI) {
        await pocakaj(ZAMIK_MS);
        const { zapisi, nerazclenjene } = zapisiStrani(await preberi(program.url), program, dan);
        // Kartica brez berljivega roka ustavi zagon: tihi izpad enega roka bi bil izgubljen rok, ki ga nihče ne opazi.
        if (nerazclenjene.length) throw new Error(`[MOVIT] ${program.url}: kartice brez roka ali naslova: ${nerazclenjene.join('; ')}`);
        // Stran brez kartic je okvara razčlembe (spremenjena oblika strani), ne leto brez rokov: MOVIT stare
        // roke pusti na strani, dokler jih ne zamenja z novimi.
        if (!zapisi.length) throw new Error(`[MOVIT] ${program.url}: ni nobene kartice z rokom — poglej obliko strani`);
        rezultati.push(...zapisi);
    }

    const poStanju = {};
    for (const r of rezultati) poStanju[r.Status] = (poStanju[r.Status] || 0) + 1;
    console.log(`[MOVIT] zajetih ${rezultati.length}, po stanju ${JSON.stringify(poStanju)}`);
    await Actor.pushData(rezultati);
});
