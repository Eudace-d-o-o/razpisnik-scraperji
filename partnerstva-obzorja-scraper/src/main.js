/**
 * Evropska partnerstva Obzorja s skupnimi razpisi — scraper (Apify actor).
 *
 * Partnerstva (DUT, Water4All, Biodiversa+, CETPartnership, M-ERA.NET) objavljajo skupne
 * transnacionalne razpise na svojih straneh; portal EU jih ne prinaša, ker se prijave oddajo na
 * platformah partnerstev. Skupnega vira ni, zato ima vsako partnerstvo svoj vnos v PARTNERSTVA:
 * stran s seznamom razpisov in vzorec povezave na stran razpisa (Biodiversa+ razpise objavlja kot
 * novice, zato jih beremo iz vmesnika WordPress po nazivu).
 *
 * Rok in stanje razberemo iz besedila strani (datumi-en.js): dvofazni razpis, ki mu je prva faza
 * potekla, je za nove prijavitelje zaprt. Razbiranje je hevristično, zato ima vir v portalu
 * status_zanesljiv = 0 in povzetek nastane šele po branju razpisa.
 *
 * robots.txt vseh petih strani (13. 10. 2026) branja razpisov ne zapira.
 *
 * Izhod (pogodba polj za razpisi.js genericniMapper): Naziv razpisa, URL, Status, Rok prijave,
 * Datum zaznave, Vsebina, Programme, Tip financiranja, Izdajatelj, Izvorna domena.
 */
const { Actor } = require('apify');
const cheerio = require('cheerio');
const { rokInStatus, vNiz, danes } = require('./datumi-en');

const ZAMIK_MS = 500;
const NAJVEC_ZNAKOV_VSEBINE = 2000;
const UA = 'Mozilla/5.0 (razpisnik-portal scraper)';

// Ko partnerstvo doda nov razpis, ga najdemo na isti strani seznama; nova partnerstva se dodajo sem.
const PARTNERSTVA = [
    {
        ime: 'Driving Urban Transitions (DUT)', kratko: 'DUT', domena: 'dutpartnership.eu',
        seznami: ['https://dutpartnership.eu/dut-calls'],
        vzorec: /\/calls\/dut-call-(20\d\d)\/?$/,
    },
    {
        ime: 'Water4All', kratko: 'Water4All', domena: 'water4all-partnership.eu',
        seznami: ['https://www.water4all-partnership.eu/joint-activities/open-calls',
            'https://www.water4all-partnership.eu/joint-activities/upcoming-calls'],
        vzorec: /\/joint-activities\/water4all-[a-z0-9-]*call[a-z0-9-]*\/?$/,
    },
    {
        ime: 'Clean Energy Transition Partnership (CETPartnership)', kratko: 'CETPartnership', domena: 'cetpartnership.eu',
        seznami: ['https://cetpartnership.eu/calls/'],
        vzorec: /\/calls\/joint-call-(20\d\d)\/?$/,
    },
    {
        ime: 'M-ERA.NET', kratko: 'M-ERA.NET', domena: 'm-era.net',
        seznami: ['https://www.m-era.net/joint-calls'],
        vzorec: /\/joint-calls\/joint-call-(20\d\d)\/?$/,
        // Naslov strani pove fazo (»The Call 2026 is currently in its full-proposal submission phase«), ne imena.
        naziv: (leto) => `M-ERA.NET Joint Call ${leto}`,
    },
    {
        ime: 'Biodiversa+', kratko: 'Biodiversa+', domena: 'biodiversa.eu',
        // Razpise objavlja kot novice (»BiodivFuture call now open«); stran s seznamom razpisov nima.
        novice: 'https://www.biodiversa.eu/wp-json/wp/v2/posts',
        nazivNovice: /(joint call|call (is )?now open|call (is )?open|call launch|new call|call announcement|upcoming call)/i,
        niRazpis: /tender|abstract|experts?\b|photo|survey|consultation|prize/i,
    },
];

const cist = (t) => String(t || '').replace(/\s+/g, ' ').trim();
const pocakaj = (ms) => new Promise((r) => setTimeout(r, ms));

async function preberi(url, accept = 'text/html') {
    const r = await fetch(url, { headers: { Accept: accept, 'User-Agent': UA } });
    if (!r.ok) throw new Error(`HTTP ${r.status} pri ${url}`);
    return r;
}

/** Strani razpisov partnerstva iz strani s seznamom; samo tekoče in preteklo leto (starejši so zaprti). */
async function straniRazpisov(p, dan) {
    const strani = new Map();
    if (p.novice) {
        const od = new Date(dan.getTime() - 400 * 86400000).toISOString().slice(0, 19);
        const r = await preberi(`${p.novice}?search=call&per_page=50&after=${od}&_fields=link,title,date`, 'application/json');
        // Isti razpis ima več novic (napoved junija, odprtje septembra); obdržimo najnovejšo, ki ga
        // imenuje z istim imenom (»BiodivFuture«), sicer bi bil v portalu dvakrat.
        const poImenu = new Map();
        for (const n of await r.json()) {
            const naslov = cheerio.load(n.title?.rendered || '').text();
            if (!p.nazivNovice.test(naslov) || p.niRazpis.test(naslov)) continue;
            const ime = (naslov.match(/\bBiodiv[A-Za-z]+/) || [naslov])[0];
            const prejsnja = poImenu.get(ime);
            if (!prejsnja || n.date > prejsnja.date) poImenu.set(ime, n);
        }
        for (const n of poImenu.values()) strani.set(n.link, { leto: Number(n.date.slice(0, 4)) });
        return strani;
    }
    for (const seznam of p.seznami) {
        const $ = cheerio.load(await (await preberi(seznam)).text());
        $('a[href]').each((_, a) => {
            const url = new URL($(a).attr('href'), seznam).href.replace(/#.*$/, '');
            const m = url.match(p.vzorec);
            if (!m) return;
            const leto = m[1] ? Number(m[1]) : null;
            if (leto && leto < dan.getFullYear() - 1) return;
            // Ista stran je dosegljiva z /index.php/ in brez; obdržimo krajšo obliko.
            strani.set(url.replace('/index.php/', '/'), { leto, napovedan: /upcoming/.test(seznam) });
        });
        await pocakaj(ZAMIK_MS);
    }
    return strani;
}

/** Besedilo glavnega dela strani, brez menijev, glave in noge. */
function razcleni(html, url, p, leto, dan) {
    const $ = cheerio.load(html);
    $('script, style, nav, header, footer, aside, form, .menu, .breadcrumb, [role="navigation"]').remove();
    $('p, div, li, h1, h2, h3, h4, h5, br, td, tr').append(' ');
    const og = cist($('meta[property="og:title"]').attr('content'));
    const h1 = cist($('h1').first().text());
    let naziv = p.naziv && leto ? p.naziv(leto) : (og || h1);
    // »Joint Call 2026: Clean Energy Funding - CETPartnership« -> brez imena strani na koncu.
    naziv = cist(naziv.replace(/\s+[-|–]\s+[^-|–]+$/, (konec) => (konec.toLowerCase().includes('call') ? konec : '')));
    if (!naziv) return null;
    if (!naziv.toLowerCase().includes(p.kratko.toLowerCase())) naziv = `${p.kratko}: ${naziv}`;

    const telo = cist(($('main').length ? $('main') : $('body')).text());
    const { rok, status, faza } = rokInStatus(telo, dan);
    const deli = [`Partnerstvo: ${p.ime}`];
    if (faza) deli.push(`Stanje: ${faza}`);
    deli.push(telo);

    return {
        'Naziv razpisa': naziv,
        'URL': url,
        'Status': status,
        'Rok prijave': rok,
        'Datum zaznave': vNiz(dan),
        'Datum objave': null,
        'Programme': p.ime,
        // Skupne razpise financirajo nacionalni organi z nepovratnimi sredstvi.
        'Tip financiranja': 'Nepovratna sredstva',
        'Sredstva': null,
        'Vsebina': deli.join(' · ').substring(0, NAJVEC_ZNAKOV_VSEBINE),
        'Izdajatelj': p.ime,
        'Izvorna domena': p.domena,
    };
}

Actor.main(async () => {
    const dan = danes();
    const rezultati = [];
    let napak = 0;
    for (const p of PARTNERSTVA) {
        let strani;
        try {
            strani = await straniRazpisov(p, dan);
        } catch (e) {
            napak++;
            console.error(`[PARTNERSTVA] ${p.kratko}: NAPAKA pri seznamu: ${e.message}`);
            continue;
        }
        // Partnerstvo brez razpisa v zadnjem letu je mogoče, a ga javimo, da spremenjene strani ne spregledamo.
        if (!strani.size) console.error(`[PARTNERSTVA] ${p.kratko}: BREZ STRANI RAZPISOV — poglej seznam ali vzorec povezave`);
        for (const [url, { leto, napovedan }] of strani) {
            try {
                const zapis = razcleni(await (await preberi(url)).text(), url, p, leto, dan);
                // Razpis s strani prihajajočih razpisov brez datumov je napovedan, ne neznan.
                if (zapis && napovedan && zapis.Status === 'Ni razvidno') zapis.Status = 'Napovedan';
                if (zapis) rezultati.push(zapis);
                else { napak++; console.error(`[PARTNERSTVA] NERAZČLENJENO: ${url}`); }
            } catch (e) {
                napak++;
                console.error(`[PARTNERSTVA] NAPAKA pri ${url}: ${e.message}`);
            }
            await pocakaj(ZAMIK_MS);
        }
        console.log(`[PARTNERSTVA] ${p.kratko}: ${strani.size} strani razpisov`);
    }

    const poStanju = {};
    for (const r of rezultati) poStanju[r.Status] = (poStanju[r.Status] || 0) + 1;
    console.log(`[PARTNERSTVA] zajetih ${rezultati.length}, po stanju ${JSON.stringify(poStanju)}, napak ${napak}`);
    if (rezultati.length) await Actor.pushData(rezultati);
});
