/**
 * evropskasredstva.si (ministrstvo za kohezijo) — scraper razpisov (Apify actor).
 *
 * Stran zbira razpise, ki se financirajo iz evropske kohezijske politike, ESS+, Interreg, SKP,
 * načrta za okrevanje in drugih skladov. Razpise objavljajo ministrstva in skladi, zato je vir
 * ZBIRNIK: portal ob uvozu izloči razpise, ki jih že imamo pri drugem viru (lib/zajem-agregator.js).
 *
 * Seznam vzamemo iz vmesnika WordPress (/wp-json/wp/v2/tender), ki ga stran ponuja javno. Stanje
 * je v class_list (application_status_computed-napovedan | aktualen | zakljucen). Oznaki »aktualen«
 * ne verjamemo na slepo: izmerjeno 13. 10. 2026 je med aktualnimi tudi razpis, ki mu je rok potekel,
 * zato stanje izpeljemo iz roka na strani razpisa (»Veljavno (Od - Do)«), kadar je rok naveden.
 * Zaključenih razpisov ne beremo: za portal ne prinesejo ničesar, kar bi rabil.
 *
 * robots.txt (13. 10. 2026) zapira samo administracijo WordPressa.
 *
 * Izhod (pogodba polj za razpisi.js genericniMapper): Naziv razpisa, URL, Status, Rok prijave,
 * Datum zaznave, Datum objave, Sredstva, Vsebina, Programme, Izdajatelj, Izvorna domena, Izvorni URL.
 */
const { Actor } = require('apify');
const cheerio = require('cheerio');

const BAZA = 'https://evropskasredstva.si';
const NAJVEC_STRANI = 10;          // 100 razpisov na stran; 13. 10. 2026 jih je bilo 246 (3 strani)
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

/** »17.11.2023« ali »17. 11. 2023« -> Date; neobstoječ datum -> null. */
function datum(niz) {
    const m = String(niz || '').match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
    if (!m) return null;
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return d.getMonth() === Number(m[2]) - 1 ? d : null;
}

const MESECI = { jan: 1, feb: 2, mar: 3, apr: 4, maj: 5, jun: 6, jul: 7, avg: 8, sep: 9, okt: 10, nov: 11, dec: 12 };

/**
 * Najkasnejši datum v predvidenem času objave napovedi: »2025-05-31«, »Avgust 2026 - September 2026«,
 * »jesen 2026«. Mesec brez dneva šteje do konca meseca, letni čas ali samo leto do konca leta.
 */
function zadnjiNacrtovaniDatum(besedilo) {
    const t = String(besedilo || '').toLowerCase();
    const datumi = [];
    for (const m of t.matchAll(/(20\d\d)-(\d{2})-(\d{2})/g)) datumi.push(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    for (const m of t.matchAll(/([a-zčšž]{3,})\s+(20\d\d)/g)) {
        const mesec = MESECI[m[1].slice(0, 3)];
        datumi.push(mesec ? new Date(Number(m[2]), mesec, 0) : new Date(Number(m[2]), 11, 31));
    }
    for (const m of t.matchAll(/\b(\d{1,2})\.\s*(\d{1,2})\.\s*(20\d\d)/g)) datumi.push(new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
    return datumi.length ? datumi.reduce((a, b) => (b > a ? b : a)) : null;
}

async function preberi(url, accept = 'text/html') {
    const r = await fetch(url, { headers: { Accept: accept, 'User-Agent': UA } });
    if (!r.ok) throw new Error(`HTTP ${r.status} pri ${url}`);
    return r;
}

/** Vsi razpisi iz vmesnika, samo napovedani in aktualni. */
async function razpisiIzVmesnika() {
    const razpisi = [];
    for (let stran = 1; stran <= NAJVEC_STRANI; stran++) {
        const r = await preberi(`${BAZA}/wp-json/wp/v2/tender?per_page=100&page=${stran}&_fields=id,link,title,class_list,date`, 'application/json');
        const vrstice = await r.json();
        for (const v of vrstice) {
            const oznaka = (v.class_list || []).find((c) => c.startsWith('application_status_computed-'));
            const stanje = oznaka ? oznaka.replace('application_status_computed-', '') : null;
            if (stanje !== 'napovedan' && stanje !== 'aktualen') continue;
            razpisi.push({ url: v.link, naziv: cheerio.load(v.title?.rendered || '').text(), stanje });
        }
        const vsehStrani = Number(r.headers.get('x-wp-totalpages') || 1);
        if (stran >= vsehStrani) break;
        await pocakaj(ZAMIK_MS);
    }
    return razpisi;
}

/** Stran razpisa: polja v vrsticah »oznaka | vrednost« in besedilo razpisa. */
function razcleni(html, osnova, dan) {
    const $ = cheerio.load(html);
    const polja = {};
    $('.single_fair_colum').each((_, vrstica) => {
        const oznaka = cist($(vrstica).find('.fair_employment_left').text());
        const el = $(vrstica).find('.fair_employment_right');
        if (oznaka) polja[oznaka] = { besedilo: cist(el.text()), povezava: el.find('a[href]').first().attr('href') || null };
    });
    const naziv = cist(osnova.naziv) || cist($('h1').first().text());
    if (!naziv) return null;

    // »Veljavno (Od - Do)«: »17.11.2023 - « (brez konca = do porabe sredstev) ali »1.9.2026 - 30.11.2026«.
    const veljavno = polja['Veljavno (Od - Do)']?.besedilo || '';
    const [odNiz, doNiz] = veljavno.split(' - ');
    const od = datum(odNiz);
    const doDatum = datum(doNiz);

    // Oznake vira so zastarele tudi pri napovedih: 13. 10. 2026 je bilo med 70 »napovedanimi«
    // 11 takih, ki jim je predvideni čas objave že minil (»2025-02-28«, »Avgust 2026 - September
    // 2026«), in razpisi »za programsko leto 2025«. Takim stanja ne poznamo in ga ne ugibamo.
    const zacetekMeseca = new Date(dan.getFullYear(), dan.getMonth(), 1);
    const nacrtovano = zadnjiNacrtovaniDatum(veljavno);
    const letaVNazivu = (naziv.match(/\b20\d\d\b/g) || []).map(Number);
    const nazivJeStar = letaVNazivu.length > 0 && Math.max(...letaVNazivu) < dan.getFullYear();
    let status;
    let opomba = null;
    if (doDatum && doDatum < dan) {
        status = 'Zaprt';
    } else if (osnova.stanje === 'napovedan') {
        if ((nacrtovano && nacrtovano < zacetekMeseca) || nazivJeStar) {
            status = 'Ni razvidno';
            opomba = 'Vir ga vodi kot napovedanega, a predvideni čas objave je že minil.';
        } else {
            status = 'Napovedan';
        }
    } else if (od && od > dan) {
        status = 'Napovedan';
    } else if (!doDatum && nazivJeStar) {
        status = 'Ni razvidno';
        opomba = 'Vir ga vodi kot aktualnega, a naziv se nanaša na preteklo leto in rok ni naveden.';
    } else {
        status = 'Odprt';
    }

    const besedilo = cist($('.fair_employment_article').text());
    const izvorniUrl = polja['Povezava do strani']?.povezava || null;
    const program = polja['Operativni program']?.besedilo || null;

    const deli = [];
    if (opomba) deli.push(opomba);
    if (program) deli.push(`Program: ${program}`);
    if (polja['Prispevek EU']) deli.push(`Prispevek EU: ${polja['Prispevek EU'].besedilo}`);
    if (veljavno) deli.push(`Veljavno: ${veljavno}${doDatum ? '' : ' (konec ni naveden)'}`);
    if (polja['Št. uradnega lista']) deli.push(`Objava: ${polja['Št. uradnega lista'].besedilo}`);
    if (besedilo) deli.push(besedilo);
    if (izvorniUrl) deli.push(`Izvirna objava: ${izvorniUrl}`);

    let domena = null;
    try { domena = izvorniUrl ? new URL(izvorniUrl).hostname.replace(/^www\./, '') : null; } catch { /* neveljavna povezava */ }

    return {
        'Naziv razpisa': naziv,
        'URL': osnova.url,
        'Status': status,
        'Rok prijave': doDatum ? vNiz(doDatum) : null,
        'Datum zaznave': vNiz(dan),
        'Datum objave': datum(polja['Datum objave']?.besedilo) ? vNiz(datum(polja['Datum objave'].besedilo)) : null,
        'Sredstva': polja['Prispevek EU']?.besedilo || null,
        'Programme': program,
        'Tip financiranja': null,
        'Vsebina': deli.join(' · ').substring(0, NAJVEC_ZNAKOV_VSEBINE),
        // Izdajatelja stran ne navaja; po izvorni domeni portal izloči razpise, ki jih zajemamo pri izdajatelju.
        'Izdajatelj': null,
        'Izvorna domena': domena,
        'Izvorni URL': izvorniUrl,
    };
}

Actor.main(async () => {
    const dan = danes();
    const razpisi = await razpisiIzVmesnika();
    if (!razpisi.length) console.error('[EVROPSKASREDSTVA] VMESNIK BREZ NAPOVEDANIH IN AKTUALNIH RAZPISOV — poglej /wp-json/wp/v2/tender');
    console.log(`[EVROPSKASREDSTVA] napovedanih in aktualnih: ${razpisi.length}`);

    const rezultati = [];
    let napak = 0;
    for (let i = 0; i < razpisi.length; i += HKRATI) {
        await Promise.all(razpisi.slice(i, i + HKRATI).map(async (r) => {
            try {
                const zapis = razcleni(await (await preberi(r.url)).text(), r, dan);
                if (zapis) rezultati.push(zapis);
                else { napak++; console.error(`[EVROPSKASREDSTVA] NERAZČLENJENO: ${r.url}`); }
            } catch (e) {
                napak++;
                console.error(`[EVROPSKASREDSTVA] NAPAKA pri ${r.url}: ${e.message}`);
            }
        }));
        await pocakaj(ZAMIK_MS);
    }

    const poStanju = {};
    for (const r of rezultati) poStanju[r.Status] = (poStanju[r.Status] || 0) + 1;
    const aktualniZaprti = rezultati.filter((r) => r.Status === 'Zaprt').length;
    console.log(`[EVROPSKASREDSTVA] zajetih ${rezultati.length}, po stanju ${JSON.stringify(poStanju)}, »aktualnih« s preteklim rokom ${aktualniZaprti}, napak ${napak}`);
    if (rezultati.length) await Actor.pushData(rezultati);
});
