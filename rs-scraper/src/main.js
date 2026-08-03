/**
 * Srbija — javni pozivi (Apify actor) za razpisnik-portal.
 *
 * ZAKAJ EN SCRAPER ZA VEČ VIROV: Srbija nima osrednjega portala javnih pozivov, kakršen je
 * gov.si pri nas ali eufondovi.gov.hr na Hrvaškem. Objave so raztresene po institucijah, vsaka
 * pa jih ima le nekaj deset. Ločen scraper na institucijo bi pomenil desetino skoraj enakih
 * repozitorijev in desetino zagonov; en scraper z več viri je ceneje vzdrževati, portal pa jih
 * itak vidi kot EN vir (koda "RS"), kar ustreza tudi prikazu na strani.
 *
 * VIRA (preverjeno 3. 8. 2026):
 *  1) Ministarstvo privrede — https://www.privreda.gov.rs/usluge/javni-pozivi
 *     Drupal, strežniško izrisan seznam: <article class="node node--public-calls node--teaser">
 *     z <a class="link link--absolute"> (naslov + relativna povezava). Paginacija ?page=0..5
 *     (20 na stran, zadnja 12) — skupaj okoli 112 objav, vključno z arhivskimi.
 *     Podrobna stran ima .field--date (datum objave) in .field--text (besedilo poziva).
 *     To je GLAVNI vir za gospodarstvo (bespovratna sredstva, subvencije, programi podpore).
 *  2) Razvojna agencija Srbije (RAS) — https://ras.gov.rs/javni-pozivi
 *     Malo objav (praviloma nekaj hkrati), a gre za neposredne spodbude investicijam.
 *
 * ZAVESTNO IZPUŠČENO ZA ZDAJ (kandidati za širitev, glej README):
 *  - Fond za inovacionu delatnost (inovacionifond.rs) — programi so stalni (Innovation Vouchers,
 *    Matching Grants, Katapult...), ne klasični razpisi z rokom; smiselno jih je vpisati ročno
 *    kot produkte, podobno kot PHV mikroposojila pri nas.
 *  - Fond za razvoj RS in pokrajinski sekretariati AP Vojvodine — dodamo, ko se pokaže, da
 *    srbski trg sploh vlečemo naprej.
 *
 * PISAVA: srbske strani mešajo cirilico in latinico (ista objava obstaja na /usluge/... in
 * /lat/usluge/...). Beremo CIRILIČNO različico, ker je izvirna in je URL brez predpone /lat
 * stabilnejši; naslove pustimo take, kot so — pretvorbo v latinico prepustimo povzetku, da se
 * pri primerjavi z virom vidi natanko isto besedilo kot na strani.
 *
 * Izhod (pogodba polj za razpisi.js genericniMapper): Naziv razpisa, URL, Status, Rok prijave,
 * Datum objave, Datum zaznave, Vsebina, Programme.
 */
const { Actor, log } = require('apify');
const cheerio = require('cheerio');
const { ProxyAgent } = require('undici');

const MP_BAZA = 'https://www.privreda.gov.rs';
const MP_SEZNAM = `${MP_BAZA}/usluge/javni-pozivi`;
const MP_ZADNJA_STRAN = 8; // beremo do prazne strani, 8 je varovalka pred neskončno zanko
const RAS_BAZA = 'https://ras.gov.rs';
const RAS_SEZNAM = `${RAS_BAZA}/javni-pozivi`;

// Vsebina gre v razpisi_scrapani in je podlaga za povzetek — enaka meja kot pri hrvaškem viru.
const NAJVEC_VSEBINA = 12000;

function danes() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

// Srbske državne strani zavračajo promet iz Apifyjevih podatkovnih centrov (privreda.gov.rs je
// vrnil "fetch failed", ras.gov.rs je delal) — enaka težava kot pri hrvaškem viru. Promet zato
// teče prek Apify RESIDENTIAL proxyja s srbskim IP-jem. Dispatcher se nastavi ob zagonu.
let dispatcher = null;

async function preberi(url) {
    const r = await fetch(url, {
        dispatcher,
        headers: {
            // Brez tega nekatere srbske strani vrnejo 403 (preverjeno na ras.gov.rs).
            'User-Agent': 'Mozilla/5.0 (compatible; RazpisnikBot/1.0; +https://razpis.eu)',
            'Accept-Language': 'sr,sr-RS;q=0.9,en;q=0.6',
        },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} za ${url}`);
    return r.text();
}

// Datumi na srbskih straneh: "12.03.2026.", "12. март 2026." ali "2026-03-12" -> "12.03.2026"
// Ministrstvo izpisuje datum objave SKRAJŠANO ("12. мар 2026."), zato ujemamo po PRVIH TREH
// črkah imena meseca — s tem pokrijemo tako polno kot skrajšano obliko, cirilico in latinico
// (preverjeno na živih straneh 3. 8. 2026: polno ime ni bilo uporabljeno nikjer).
const MESECI = {
    јан: 1, феб: 2, мар: 3, апр: 4, мај: 5, јун: 6, јул: 7, авг: 8, сеп: 9, окт: 10, нов: 11, дец: 12,
    jan: 1, feb: 2, mar: 3, apr: 4, maj: 5, jun: 6, jul: 7, avg: 8, sep: 9, okt: 10, nov: 11, dec: 12,
};
function vDatum(besedilo) {
    const t = String(besedilo || '').trim();
    let m = t.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
    if (m) return `${m[1].padStart(2, '0')}.${m[2].padStart(2, '0')}.${m[3]}`;
    m = t.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}.${m[2]}.${m[1]}`;
    m = t.match(/(\d{1,2})\.?\s+([\p{L}]{3,})\.?\s+(\d{4})/u);
    if (m) {
        const mes = MESECI[m[2].toLowerCase().slice(0, 3)];
        if (mes) return `${m[1].padStart(2, '0')}.${String(mes).padStart(2, '0')}.${m[3]}`;
    }
    return null;
}

// Rok iz besedila poziva. Srbske objave ga zapišejo opisno ("Рок за подношење пријава је
// 30.09.2026. године", "конкурс је отворен до утрошка средстава"), zato ga iščemo po ključnih
// besedah in ne po fiksnem polju — polja z rokom te strani nimajo.
function najdiRok(besedilo) {
    const t = String(besedilo || '');
    // Datum je lahko številčen ("30.09.2026") ali z imenom meseca ("30. септембра 2026"), zato
    // isti vzorci lovijo obe obliki. Pri VEČINI objav roka v HTML sploh ni — zapisan je šele v
    // priloženem PDF-ju javnega poziva. To ni napaka scraperja: rok pozneje izlušči generiranje
    // povzetka iz dokumentov (razpis-detail-scraper), scraper pa raje pusti prazno, kot da ugiba.
    const DATUM = '(\\d{1,2}\\.\\s*\\d{1,2}\\.\\s*\\d{4}|\\d{1,2}\\.?\\s+[\\p{L}]{3,}\\.?\\s+\\d{4})';
    const kljucne = [
        'рок\\s+за\\s+подношење', 'rok\\s+za\\s+podnošenje',
        'рок\\s+за\\s+пријаву', 'rok\\s+za\\s+prijavu',
        '(?:пријаве|захтеви)\\s+се\\s+подносе', '(?:prijave|zahtevi)\\s+se\\s+podnose',
        'закључно\\s+са', 'zaključno\\s+sa',
        '(?:отворен|траје|подноси)\\s+до', '(?:otvoren|traje|podnosi)\\s+do',
        'najkasnije\\s+do', 'најкасније\\s+до',
    ];
    for (const k of kljucne) {
        const m = t.match(new RegExp(`${k}[^.]{0,120}?${DATUM}`, 'iu'));
        if (m) { const d = vDatum(m[1]); if (d) return d; }
    }
    // "do utroška sredstava" — rok kot besedilo, enako kot slovenski "do porabe sredstev".
    if (/до\s+утрошка\s+средстава|do\s+utroška\s+sredstava/iu.test(t)) return 'do porabe sredstev';
    return null;
}

// Status: če je rok v preteklosti, je poziv zaprt. Brez roka pustimo "Odprt" — o zaprtju odloči
// portal (nočna skripta zapiranja), scraper ne ugiba.
function status(rok) {
    if (!rok || rok === 'do porabe sredstev') return 'Odprt';
    const m = rok.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!m) return 'Odprt';
    const d = new Date(`${m[3]}-${m[2]}-${m[1]}T23:59:59`);
    return d < new Date() ? 'Zaprt' : 'Odprt';
}

async function ministarstvoPrivrede() {
    const zapisi = [];
    for (let stran = 0; stran <= MP_ZADNJA_STRAN; stran++) {
        const html = await preberi(`${MP_SEZNAM}?page=${stran}`);
        const $ = cheerio.load(html);
        const clanki = $('article.node--public-calls');
        if (!clanki.length) break; // konec paginacije
        clanki.each((_, el) => {
            const a = $(el).find('a.link--absolute').first();
            const pot = a.attr('href');
            const naziv = a.text().replace(/\s+/g, ' ').trim();
            if (!pot || !naziv) return;
            zapisi.push({ naziv, url: pot.startsWith('http') ? pot : `${MP_BAZA}${pot}` });
        });
        log.info(`Ministarstvo privrede, stran ${stran}: ${clanki.length} objav (skupaj ${zapisi.length})`);
    }
    return zapisi;
}

async function ras() {
    const html = await preberi(RAS_SEZNAM);
    const $ = cheerio.load(html);
    const zapisi = [];
    // RAS nima razreda za seznam — javni pozivi so povezave, katerih pot se začne z "javni-poziv".
    $('a[href^="/javni-poziv"]').each((_, el) => {
        const pot = $(el).attr('href');
        const naziv = $(el).text().replace(/\s+/g, ' ').trim();
        if (!pot || pot === '/javni-pozivi' || naziv.length < 15) return;
        const url = `${RAS_BAZA}${pot}`;
        if (zapisi.some((z) => z.url === url)) return;
        zapisi.push({ naziv, url });
    });
    log.info(`RAS: ${zapisi.length} javnih pozivov`);
    return zapisi;
}

// Podrobna stran — besedilo poziva in datum objave. Brez tega bi imel povzetek na voljo samo
// naslov (enaka napaka kot pri hrvaškem viru, glej opombo tam).
async function podrobnosti(url) {
    try {
        const html = await preberi(url);
        const $ = cheerio.load(html);
        $('script, style, nav, header, footer').remove();
        const polja = $('.field--text').text() || $('main').text() || $('body').text();
        const vsebina = polja.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
        const datumObjave = vDatum($('.field--date').first().text());
        // Povezave do razpisne dokumentacije (PDF/DOC) — dobrodošle pri poznejši generaciji povzetka.
        const priloge = [];
        $('a[href$=".pdf"], a[href$=".doc"], a[href$=".docx"], a[href$=".xls"], a[href$=".xlsx"]').each((_, el) => {
            const h = $(el).attr('href');
            if (h) priloge.push(h.startsWith('http') ? h : new URL(h, url).href);
        });
        return {
            vsebina: vsebina.slice(0, NAJVEC_VSEBINA),
            datumObjave,
            priloge: [...new Set(priloge)].slice(0, 20),
        };
    } catch (e) {
        log.warning(`Podrobnosti niso dosegljive (${url}): ${e.message}`);
        return { vsebina: '', datumObjave: null, priloge: [] };
    }
}

Actor.main(async () => {
    // Srbski IP: privreda.gov.rs iz Apifyjevega podatkovnega centra vrne "fetch failed"
    // (preverjeno ob prvem zagonu 3. 8. 2026), z domačega omrežja pa stran normalno odgovori.
    try {
        const proxy = await Actor.createProxyConfiguration({ groups: ['RESIDENTIAL'], countryCode: 'RS' });
        dispatcher = new ProxyAgent({
            uri: await proxy.newUrl(),
            requestTls: { rejectUnauthorized: false }, // nepopolne verige certifikatov na .gov.rs
            headersTimeout: 60000,
            bodyTimeout: 60000,
        });
        log.info('Promet teče prek Apify RESIDENTIAL proxyja (RS).');
    } catch (e) {
        // Brez proxyja poskusimo neposredno — RAS je dosegljiv tudi tako, ministrstvo pa bo
        // padlo z jasno napako v dnevniku, ne tiho.
        log.warning(`Proxyja ni bilo mogoče nastaviti (${e.message}) — poskušam neposredno.`);
    }

    const zaznano = danes();
    const seznam = [];

    for (const [ime, fn] of [['Ministarstvo privrede', ministarstvoPrivrede], ['RAS', ras]]) {
        try {
            const del = await fn();
            for (const z of del) seznam.push({ ...z, institucija: ime });
        } catch (e) {
            // En nedosegljiv vir ne sme podreti celega zagona — portal ima varovalko, ki ob
            // nenadnem upadu števila zapisov sinhronizacijo ustavi, zato je delen izid varen.
            log.error(`Vir ${ime} ni bil zajet: ${e.message}`);
        }
    }

    log.info(`Skupaj najdenih objav: ${seznam.length} — berem podrobnosti.`);

    const izhod = [];
    for (const z of seznam) {
        const d = await podrobnosti(z.url);
        const rok = najdiRok(d.vsebina);
        izhod.push({
            'Naziv razpisa': z.naziv,
            URL: z.url,
            Status: status(rok),
            'Rok prijave': rok,
            'Datum objave': d.datumObjave,
            'Datum zaznave': zaznano,
            Vsebina: d.vsebina,
            Programme: z.institucija,
            Priloge: d.priloge,
        });
    }

    log.info(`Zapisujem ${izhod.length} zapisov (odprtih: ${izhod.filter((r) => r.Status === 'Odprt').length}).`);
    await Actor.pushData(izhod);
});
