/**
 * Interreg prek keep.eu (Interact) — scraper odprtih razpisov (Apify actor).
 *
 * ZAKAJ keep.eu in ne interreg.eu: pravno obvestilo interreg.eu prepoveduje kopiranje in razširjanje
 * vsebine v komercialne namene. Pogoji uporabe keep.eu (https://keep.eu/terms-of-use/) dovolijo
 * kopiranje in razširjanje za vsak zakonit namen, če keep.eu navedemo kot vir, dodamo povezavo nanj
 * in povemo, da je bila vsebina spremenjena. Zato ima vsak zapis polje »Pripis vira«, URL pa kaže
 * na stran programa na keep.eu. Portal pripis izpiše ob razpisu na razpis.eu in na Funding Bridge.
 *
 * Kaj beremo (vse brez prijave, kot jih vidi obiskovalec razdelka »Calls for projects«):
 *   1. seznam programov z odprtim razpisom — isti klic, ki ga naredi javna stran iskanja
 *      (keep.eu/programmes/?…#search, filter call = ongoing): POST /api/search/programmes/;
 *   2. javno stran vsakega programa (keep.eu/programmes/<id>/), kjer so odprti razpisi izpisani
 *      kot oranžni pasovi z nazivom, povezavo na stran programa in neobveznim opisom.
 * Uradni vmesnik keep.eu (open-data) zahteva ključ; zanj je zaprošeno posebej.
 *
 * keep.eu razpise posodablja v štirimesečnem ciklu (konec januarja, maja in septembra), programi pa
 * jih lahko dopolnijo vmes. Na seznamu so samo odprti razpisi; napovedanih javna stran ne kaže.
 *
 * robots.txt keep.eu (13. 10. 2026) zapira samo /wp-admin/.
 */
const { Actor } = require('apify');
const cheerio = require('cheerio');
const { rokInStatus, vNiz, danes } = require('./datumi-en');

const BAZA = 'https://keep.eu';
const ZAMIK_MS = 400;
const NAJVEC_STRANI_SEZNAMA = 10;
const NAJVEC_ZNAKOV_VSEBINE = 2000;
const UA = 'Mozilla/5.0 (razpisnik-portal scraper)';
const PRIPIS = 'Vir: keep.eu (Interact), prilagojeno';

const cist = (t) => String(t || '').replace(/\s+/g, ' ').trim();
const pocakaj = (ms) => new Promise((r) => setTimeout(r, ms));

/** Programi z odprtim razpisom (javni filter »call: ongoing«), po straneh. */
async function programiZOdprtimRazpisom() {
    const programi = [];
    let naslov = `${BAZA}/api/search/programmes/`;
    for (let i = 0; naslov && i < NAJVEC_STRANI_SEZNAMA; i++) {
        const r = await fetch(naslov, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
            body: JSON.stringify({ programmes: { type: [], period: [], nuts: [], call: 'ongoing' }, search: { list: [], type: null, rawSearchString: '' } }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status} pri seznamu programov`);
        const telo = await r.json();
        for (const p of telo.results || []) programi.push({ id: p.id, naziv: cist(p.title) });
        naslov = telo.next || null;
        await pocakaj(ZAMIK_MS);
    }
    return programi;
}

// »2021 - 2027 Interreg VI-A Slovenia-Austria« -> »Interreg VI-A Slovenia-Austria«
const kratkoIme = (naziv) => cist(String(naziv).replace(/^\d{4}\s*-\s*\d{4}\s*/, ''));

/** Odprti razpisi na javni strani programa. Pas razpisa ima ikono megafona; opis je v skritem bloku. */
function razpisiNaStrani(html, program, dan) {
    const $ = cheerio.load(html);
    const program_ = kratkoIme(program.naziv);
    const razpisi = [];
    $('i.fa-megaphone').each((_, ikona) => {
        const vrstica = $(ikona).parent();
        const nazivRazpisa = cist(vrstica.find('span').first().text());
        const izvorniUrl = vrstica.find('a[href]').first().attr('href') || null;
        // Blok z opisom sledi pasu: <div id="details-container-<id razpisa>">.
        const pas = vrstica.closest('div[style*="margin: 10px 0"]');
        const podrobnosti = pas.nextAll('div[id^="details-container-"]').first();
        const idRazpisa = (podrobnosti.attr('id') || '').replace('details-container-', '') || String(razpisi.length + 1);
        const opis = [];
        podrobnosti.find('h5').each((__, h) => {
            const oznaka = cist($(h).text());
            const besedilo = cist($(h).parent().text()).replace(oznaka, '').trim();
            if (besedilo) opis.push(`${oznaka}: ${besedilo}`);
        });
        if (!nazivRazpisa) return;

        // Naziv brez imena programa (»Continous call«) sam ne pove ničesar, zato ga vedno zapišemo kot
        // »<program>: <razpis>«. keep.eu ime programa včasih zlepi z nazivom (»(EURO MED)Call 8«) ali
        // mu spredaj pusti letnico (»2027 Interreg …«); oboje odstranimo.
        const brezLetnic = cist(nazivRazpisa.replace(/^(\d{4}\s*-?\s*)+/, ''));
        const ostanek = brezLetnic.toLowerCase().startsWith(program_.toLowerCase())
            ? cist(brezLetnic.slice(program_.length))
            : brezLetnic;
        const naziv = `${program_}: ${ostanek || 'call for projects'}`;
        const besedilo = `${nazivRazpisa}. ${opis.join(' ')}`;
        // Na seznamu so samo odprti razpisi; rok, če ga opis ali naziv navaja (»open until 30.11.2026«).
        // rokInStatus vrne »Zaprt«, kadar so vsi navedeni roki že mimo.
        const { rok, status } = rokInStatus(besedilo, dan);
        const zaprtPoRoku = status === 'Zaprt';
        const stalni = /continu|continous|always submit|permanent/i.test(nazivRazpisa);

        const deli = [`Program: ${program_}`];
        if (stalni) deli.push('Stalno odprt razpis (prijave ves čas, do porabe sredstev)');
        deli.push(...opis);
        if (izvorniUrl) deli.push(`Stran razpisa: ${izvorniUrl}`);
        deli.push(PRIPIS);

        razpisi.push({
            'Naziv razpisa': naziv,
            'URL': `${BAZA}/programmes/${program.id}/#razpis-${idRazpisa}`,
            // keep.eu ga uvršča med odprte; če naveden rok že poteče, je podatek pri viru zastarel.
            'Status': zaprtPoRoku ? 'Zaprt' : 'Odprt',
            'Rok prijave': rok,
            'Datum zaznave': vNiz(dan),
            'Datum objave': null,
            'Programme': program_,
            'Tip financiranja': 'Nepovratna sredstva',
            'Sredstva': null,
            'Vsebina': deli.join(' · ').substring(0, NAJVEC_ZNAKOV_VSEBINE),
            'Izdajatelj': program_,
            'Izvorna domena': izvorniUrl ? (() => { try { return new URL(izvorniUrl).hostname.replace(/^www\./, ''); } catch { return null; } })() : null,
            'Izvorni URL': izvorniUrl,
            'Pripis vira': PRIPIS,
        });
    });
    return razpisi;
}

Actor.main(async () => {
    const dan = danes();
    const programi = await programiZOdprtimRazpisom();
    if (!programi.length) console.error('[INTERREG] SEZNAM PROGRAMOV PRAZEN — poglej /api/search/programmes/ na keep.eu');
    console.log(`[INTERREG] programov z odprtim razpisom: ${programi.length}`);

    const rezultati = [];
    let napak = 0;
    for (const program of programi) {
        try {
            const r = await fetch(`${BAZA}/programmes/${program.id}/`, { headers: { Accept: 'text/html', 'User-Agent': UA } });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const razpisi = razpisiNaStrani(await r.text(), program, dan);
            // Program je na seznamu odprtih, a stran razpisa ne kaže: spremenjena stran, ne prazen program.
            if (!razpisi.length) { napak++; console.error(`[INTERREG] BREZ RAZPISA NA STRANI: ${program.id} ${program.naziv}`); }
            rezultati.push(...razpisi);
        } catch (e) {
            napak++;
            console.error(`[INTERREG] NAPAKA pri programu ${program.id}: ${e.message}`);
        }
        await pocakaj(ZAMIK_MS);
    }

    const zRokom = rezultati.filter((r) => r['Rok prijave']).length;
    const slovenskih = rezultati.filter((r) => /slovenia/i.test(r.Programme)).length;
    console.log(`[INTERREG] zajetih ${rezultati.length} razpisov iz ${programi.length} programov, z rokom ${zRokom}, s Slovenijo v imenu programa ${slovenskih}, napak ${napak}`);
    if (rezultati.length) await Actor.pushData(rezultati);
});
