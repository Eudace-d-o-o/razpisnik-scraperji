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
 *
 * Popravki po nasprotnem pregledu (14. 10. 2026):
 * - Naslov strani vsebuje stanje (/razpisi/napovedan/… se ob objavi preseli na /razpisi/aktualen/…).
 *   Kot URL zato zapišemo stalni naslov ?post_type=tender&p=<id>, ki preusmeri na trenutno stran;
 *   sicer bi ob vsaki spremembi stanja nastal nov zapis, stari pa bi obtičal v starem stanju.
 * - Zaključene razpise (spremenjene v zadnjih 400 dneh) vrnemo kot »Zaprt« brez branja strani, da
 *   se razpis, ki smo ga uvozili kot odprtega, ob zaključku pri viru zapre tudi pri nas.
 * - Napovedi, ki jim je predvideni čas objave minil, izpustimo: stanja ne poznamo, portal pa bi
 *   razpis brez roka pokazal kot odprtega.
 * - Isti naziv pod dvema naslovoma (»…/slug/« in »…/slug-2/«) vrnemo enkrat, novejšega.
 * - Interreg Slovenija–Avstrija, –Hrvaška in –Madžarska izpustimo: pokriva jih vir INTERREG (keep.eu).
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

/**
 * »17.11.2023«, »17. 11. 2023« ali »2025-01-27« -> Date; neobstoječ datum -> null. Vir uporablja oba
 * zapisa (izmerjeno 14. 10. 2026: 7 razpisov z »2024-06-07 - 2025-01-27«).
 */
function datum(niz) {
    const t = String(niz || '');
    const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/);
    const slo = t.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
    const [leto, mesec, dan] = iso ? [iso[1], iso[2], iso[3]] : slo ? [slo[3], slo[2], slo[1]] : [];
    if (!leto) return null;
    const d = new Date(Number(leto), Number(mesec) - 1, Number(dan));
    return d.getMonth() === Number(mesec) - 1 ? d : null;
}

// Programi Interreg, ki jih zajema vir INTERREG s keep.eu; tu bi bili dvojniki.
const POKRIVA_INTERREG = /interreg[\s\S]*slovenij\w*\s*[-–]\s*(avstrij|hrvaš|madžar)/i;
const DOMENE_INTERREG = new Set(['si-at.eu', 'si-hr.eu', 'si-hu.eu']);

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

/** Vsi razpisi iz vmesnika: napovedani, aktualni in nedavno zaključeni. */
async function razpisiIzVmesnika(dan) {
    const razpisi = [];
    const meja = new Date(dan.getTime() - 400 * 86400000);
    for (let stran = 1; stran <= NAJVEC_STRANI; stran++) {
        const r = await preberi(`${BAZA}/wp-json/wp/v2/tender?per_page=100&page=${stran}&_fields=id,link,title,class_list,date,modified`, 'application/json');
        const vrstice = await r.json();
        for (const v of vrstice) {
            const oznaka = (v.class_list || []).find((c) => c.startsWith('application_status_computed-'));
            const stanje = oznaka ? oznaka.replace('application_status_computed-', '') : null;
            if (!['napovedan', 'aktualen', 'zakljucen'].includes(stanje)) continue;
            if (stanje === 'zakljucen' && new Date(v.modified) < meja) continue;
            razpisi.push({
                id: v.id,
                stran: v.link,
                url: `${BAZA}/?post_type=tender&p=${v.id}`,
                naziv: cist(cheerio.load(v.title?.rendered || '').text()),
                stanje,
            });
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
    if (doDatum && doDatum < dan) {
        status = 'Zaprt';
    } else if (osnova.stanje === 'napovedan') {
        // Stanja ne poznamo; brez roka bi ga portal pokazal kot odprtega, zato ga ne vrnemo (null).
        if ((nacrtovano && nacrtovano < zacetekMeseca) || nazivJeStar) return { izpuscen: 'napoved s preteklim časom objave' };
        status = 'Napovedan';
    } else if (od && od > dan) {
        status = 'Napovedan';
    } else if (!doDatum && nazivJeStar) {
        return { izpuscen: 'aktualen brez roka, naziv za preteklo leto' };
    } else {
        status = 'Odprt';
    }

    const besedilo = cist($('.fair_employment_article').text());
    const izvorniUrl = polja['Povezava do strani']?.povezava || null;
    const program = polja['Operativni program']?.besedilo || null;

    let domena = null;
    try { domena = izvorniUrl ? new URL(izvorniUrl).hostname.replace(/^www\./, '') : null; } catch { /* neveljavna povezava */ }
    if (domena && DOMENE_INTERREG.has(domena)) return { izpuscen: 'Interreg, pokriva vir INTERREG' };

    const deli = [];
    if (program) deli.push(`Program: ${program}`);
    // »Prispevek EU« je samo delež EU, ne razpisana sredstva; zato ga ne zapišemo v polje Sredstva.
    if (polja['Prispevek EU']) deli.push(`Prispevek EU (delež EU, ne celotna razpisana sredstva): ${polja['Prispevek EU'].besedilo}`);
    if (veljavno) deli.push(`Veljavno: ${veljavno}${doDatum ? '' : ' (konec ni naveden)'}`);
    if (polja['Št. uradnega lista']) deli.push(`Objava: ${polja['Št. uradnega lista'].besedilo}`);
    if (besedilo) deli.push(besedilo);
    if (izvorniUrl) deli.push(`Izvirna objava: ${izvorniUrl}`);

    return {
        'Naziv razpisa': naziv,
        'URL': osnova.url,
        'Status': status,
        'Rok prijave': doDatum ? vNiz(doDatum) : null,
        'Datum zaznave': vNiz(dan),
        'Datum objave': datum(polja['Datum objave']?.besedilo) ? vNiz(datum(polja['Datum objave'].besedilo)) : null,
        'Sredstva': null,
        'Programme': program,
        'Tip financiranja': null,
        'Vsebina': deli.join(' · ').substring(0, NAJVEC_ZNAKOV_VSEBINE),
        // Izdajatelja stran ne navaja; po izvorni domeni portal izloči razpise, ki jih zajemamo pri izdajatelju.
        'Izdajatelj': null,
        'Izvorna domena': domena,
        'Izvorni URL': izvorniUrl,
    };
}

/** Zaključen razpis: brez branja strani, samo da se pri nas zapre, če smo ga uvozili kot odprtega. */
function zakljucen(osnova, dan) {
    return {
        'Naziv razpisa': osnova.naziv,
        'URL': osnova.url,
        'Status': 'Zaprt',
        'Rok prijave': null,
        'Datum zaznave': vNiz(dan),
        'Datum objave': null,
        'Sredstva': null,
        'Programme': null,
        'Tip financiranja': null,
        'Vsebina': 'Vir razpis vodi kot zaključen.',
        'Izdajatelj': null,
        'Izvorna domena': null,
        'Izvorni URL': null,
    };
}

const kljucNaziva = (n) => cist(n).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

Actor.main(async () => {
    const dan = danes();
    const vsi = await razpisiIzVmesnika(dan);
    if (!vsi.length) console.error('[EVROPSKASREDSTVA] VMESNIK BREZ RAZPISOV — poglej /wp-json/wp/v2/tender');

    // Isti naziv pod dvema naslovoma (»…/slug/« in »…/slug-2/«, 14. 10. 2026 sedem parov): novejši (višji id).
    const poNazivu = new Map();
    for (const r of vsi) {
        const k = kljucNaziva(r.naziv);
        if (!poNazivu.has(k) || r.id > poNazivu.get(k).id) poNazivu.set(k, r);
    }
    const izpusceni = {};
    const izpusti = (razlog) => { izpusceni[razlog] = (izpusceni[razlog] || 0) + 1; };
    if (vsi.length - poNazivu.size) izpusceni['dvojnik naziva pri viru'] = vsi.length - poNazivu.size;
    const razpisi = [...poNazivu.values()].filter((r) => {
        if (POKRIVA_INTERREG.test(r.naziv)) { izpusti('Interreg, pokriva vir INTERREG'); return false; }
        return true;
    });
    const poStanjuVira = {};
    for (const r of razpisi) poStanjuVira[r.stanje] = (poStanjuVira[r.stanje] || 0) + 1;
    console.log(`[EVROPSKASREDSTVA] razpisov v vmesniku (napovedani, aktualni, zaključeni v 400 dneh): ${vsi.length}, po stanju vira ${JSON.stringify(poStanjuVira)}`);

    const rezultati = [];
    let napak = 0;
    for (const r of razpisi.filter((x) => x.stanje === 'zakljucen')) rezultati.push(zakljucen(r, dan));
    const zaBranje = razpisi.filter((x) => x.stanje !== 'zakljucen');
    for (let i = 0; i < zaBranje.length; i += HKRATI) {
        await Promise.all(zaBranje.slice(i, i + HKRATI).map(async (r) => {
            try {
                const zapis = razcleni(await (await preberi(r.stran)).text(), r, dan);
                if (!zapis) { napak++; console.error(`[EVROPSKASREDSTVA] NERAZČLENJENO: ${r.stran}`); } else if (zapis.izpuscen) izpusti(zapis.izpuscen);
                else rezultati.push(zapis);
            } catch (e) {
                napak++;
                console.error(`[EVROPSKASREDSTVA] NAPAKA pri ${r.stran}: ${e.message}`);
            }
        }));
        await pocakaj(ZAMIK_MS);
    }

    const poStanju = {};
    for (const r of rezultati) poStanju[r.Status] = (poStanju[r.Status] || 0) + 1;
    console.log(`[EVROPSKASREDSTVA] zajetih ${rezultati.length}, po stanju ${JSON.stringify(poStanju)}, izpuščenih ${JSON.stringify(izpusceni)}, napak ${napak}`);
    if (rezultati.length) await Actor.pushData(rezultati);
});
