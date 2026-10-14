/**
 * JAK — Javna agencija za knjigo RS (jakrs.si) — scraper javnih razpisov in pozivov (Apify actor).
 *
 * Beremo seznam »Javni razpisi in pozivi → Razpisi in pozivi« za tekoče in preteklo leto, nato stran
 * vsakega razpisa, ki ima polja »Datum objave«, »Datum poteka« in »Status«. Vir RSS (jakrs.si/rss)
 * NI primeren: izmerjeno 13. 10. 2026 vsebuje samo novice in najave razpisov, brez roka in brez
 * povezave na stran razpisa.
 *
 * Preteklo leto beremo zato, da januarja seznam ni prazen, čeprav so lanski večletni razpisi še
 * odprti. Strani so strežniško izrisane -> fetch + cheerio.
 *
 * robots.txt (13. 10. 2026) zapira samo /manager/.
 *
 * Izhod (pogodba polj za razpisi.js genericniMapper): Naziv razpisa, URL, Status, Rok prijave,
 * Datum zaznave, Datum objave, Vsebina, Identifikator, Programme, Izdajatelj, Izvorna domena.
 */
const { Actor } = require('apify');
const cheerio = require('cheerio');

const BAZA = 'https://www.jakrs.si';
const SEZNAM = '/javni-razpisi-in-pozivi/razpisi-in-pozivi';
const NAJVEC_STRANI_NA_LETO = 6;
const ZAMIK_MS = 300;
const HKRATI = 3;
const NAJVEC_ZNAKOV_VSEBINE = 2000;
const UA = 'Mozilla/5.0 (razpisnik-portal scraper)';

const cist = (t) => String(t || '').replace(/\s+/g, ' ').trim();
const pocakaj = (ms) => new Promise((r) => setTimeout(r, ms));
const dvomestno = (n) => String(n).padStart(2, '0');
const vNiz = (d) => `${dvomestno(d.getDate())}.${dvomestno(d.getMonth() + 1)}.${d.getFullYear()}`;

function danes() {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** »24. 8. 2026« -> Date; neobstoječ datum -> null. */
function datum(niz) {
    const m = String(niz || '').match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
    if (!m) return null;
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return d.getMonth() === Number(m[2]) - 1 ? d : null;
}

async function preberi(url) {
    const r = await fetch(url, { headers: { Accept: 'text/html', 'User-Agent': UA } });
    if (!r.ok) throw new Error(`HTTP ${r.status} pri ${url}`);
    return r.text();
}

const absolutno = (pot) => (pot.startsWith('http') ? pot : `${BAZA}/${pot.replace(/^\//, '')}`);

/** Povezave na strani razpisov in pozivov za dano leto (seznam je razdeljen na strani). */
async function povezaveLeta(leto) {
    const povezave = new Map();
    for (let stran = 1; stran <= NAJVEC_STRANI_NA_LETO; stran++) {
        const naslov = `${BAZA}${SEZNAM}?year=${leto}${stran > 1 ? `&page=${stran}` : ''}`;
        const $ = cheerio.load(await preberi(naslov));
        let novih = 0;
        $('#results a[href]').each((_, a) => {
            const pot = $(a).attr('href');
            if (!/javni-razpisi-in-pozivi\/(razpisi|pozivi)/.test(pot)) return;
            const url = absolutno(pot);
            if (!povezave.has(url)) { povezave.set(url, true); novih++; }
        });
        await pocakaj(ZAMIK_MS);
        // Konec seznama: stran brez novih povezav (strežnik za stran čez konec vrne zadnjo).
        if (!novih) break;
    }
    return [...povezave.keys()];
}

function razcleni(html, url, dan) {
    const $ = cheerio.load(html);
    // Bloki strani nimajo presledka med seboj; brez tega bi se odstavki zlepili v eno besedo.
    $('p, div, li, h1, h2, h3, h4, br, td').append(' ');
    const besedilo = cist($('main, #mainContent, body').first().text());
    // Oznaka razpisa (JP2-SKS-2026) je zadnji del poti; naslov strani je ime agencije.
    const oznaka = decodeURIComponent(url.replace(/\/$/, '').split('/').pop() || '').toUpperCase() || null;
    const objava = datum((besedilo.match(/Datum objave:\s*([\d.\s]+\d{4})/) || [])[1]);
    const potek = datum((besedilo.match(/Datum poteka:\s*([\d.\s]+\d{4})/) || [])[1]);
    const statusVira = (besedilo.match(/Status:\s*(Odprt|Zaprt|V pripravi|Napovedan)/i) || [])[1] || null;
    // Polni naziv je odstavek za besedo »objavlja« (»… objavlja Javni poziv za sofinanciranje …«).
    // »objavlja« se lahko pojavi že prej (novice ob strani), zato iščemo tistega, ki mu sledi naziv razpisa.
    // Odstavka se v besedilu strani lahko stakneta brez presledka (»objavljaJavni razpis«).
    const poObjavi = (besedilo.match(/\bobjavlja\s*((?:javn|ciljn)[\s\S]*)/i) || [])[1] || '';
    // Naziv se konča z oklepajem z oznako (»(v nadaljevanju: …)«, »(oznaka …)«, »(z oznako: …)«) ali z
    // naslovom prvega razdelka; razpisi JAK oboje pišejo različno.
    const naziv = cist((poObjavi.match(/^\s*((?:javn|ciljn)[\s\S]{10,400}?)(?=\s*\((?:v nadaljevanju|z oznako|oznaka)|\s+(?:Ime oziroma|Naziv in sedež|Predmet))/i) || [])[1])
        || oznaka;
    if (!naziv) return null;

    let status;
    if (potek) status = potek < dan ? 'Zaprt' : (objava && objava > dan ? 'Napovedan' : 'Odprt');
    else if (statusVira) status = /odprt/i.test(statusVira) ? 'Odprt' : /zaprt/i.test(statusVira) ? 'Zaprt' : 'Napovedan';
    else status = 'Ni razvidno';

    const vsebina = cist(poObjavi.slice(0, NAJVEC_ZNAKOV_VSEBINE + 200));
    const deli = [];
    if (objava) deli.push(`Objava: ${vNiz(objava)}`);
    if (potek) deli.push(`Rok: ${vNiz(potek)}`);
    if (vsebina) deli.push(vsebina);

    return {
        'Naziv razpisa': oznaka && !naziv.includes(oznaka) ? `${naziv} (${oznaka})` : naziv,
        'URL': url,
        'Status': status,
        'Rok prijave': potek ? vNiz(potek) : null,
        'Datum zaznave': vNiz(dan),
        'Datum objave': objava ? vNiz(objava) : null,
        'Identifikator': oznaka,
        'Programme': 'Javna agencija za knjigo RS',
        'Tip financiranja': 'Nepovratna sredstva',
        'Sredstva': null,
        'Vsebina': deli.join(' · ').substring(0, NAJVEC_ZNAKOV_VSEBINE),
        'Izdajatelj': 'Javna agencija za knjigo RS',
        'Izvorna domena': 'jakrs.si',
    };
}

Actor.main(async () => {
    const dan = danes();
    const povezave = [];
    for (const leto of [dan.getFullYear(), dan.getFullYear() - 1]) povezave.push(...await povezaveLeta(leto));
    if (!povezave.length) console.error('[JAK] SEZNAM BREZ RAZPISOV — poglej izbirnik #results');
    console.log(`[JAK] razpisov in pozivov (tekoče in preteklo leto): ${povezave.length}`);

    const rezultati = [];
    let napak = 0;
    for (let i = 0; i < povezave.length; i += HKRATI) {
        await Promise.all(povezave.slice(i, i + HKRATI).map(async (url) => {
            try {
                const zapis = razcleni(await preberi(url), url, dan);
                if (zapis) rezultati.push(zapis);
                else { napak++; console.error(`[JAK] NERAZČLENJENO: ${url}`); }
            } catch (e) {
                napak++;
                console.error(`[JAK] NAPAKA pri ${url}: ${e.message}`);
            }
        }));
        await pocakaj(ZAMIK_MS);
    }

    const poStanju = {};
    for (const r of rezultati) poStanju[r.Status] = (poStanju[r.Status] || 0) + 1;
    console.log(`[JAK] zajetih ${rezultati.length}, po stanju ${JSON.stringify(poStanju)}, brez roka ${rezultati.filter((r) => !r['Rok prijave']).length}, napak ${napak}`);
    if (rezultati.length) await Actor.pushData(rezultati);
});
