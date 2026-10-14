/**
 * EUREKA (eurekanetwork.org) — scraper razpisov (Apify actor).
 *
 * Eurostars, grozdi (ITEA, Celtic-Next, Xecs, SMART, Eurogia), mrežni projekti, Globalstars,
 * Innowwide in Fast Track to the EIC Accelerator. Strani so strežniško izrisane -> fetch + cheerio.
 *
 * Seznam razpisov vzamemo iz zemljevida strani programmes-sitemap.xml (ima datum zadnje spremembe),
 * ne s strani »Open calls«: zemljevid vsebuje tudi napovedane in nedavno zaprte razpise, iz katerih
 * portal ve, da je razpis zaprt. Razpis ima na svoji strani polji »Start Date« in »End Date« ter
 * seznam sodelujočih držav (Slovenija je pri večini).
 *
 * robots.txt (13. 10. 2026) ne zapira ničesar.
 *
 * Izhod (pogodba polj za razpisi.js genericniMapper): Naziv razpisa, URL, Status, Rok prijave,
 * Datum zaznave, Datum objave, Vsebina, Programme, Tip financiranja, Izdajatelj, Izvorna domena,
 * Upravičene države.
 */
const { Actor } = require('apify');
const cheerio = require('cheerio');
const { rokInStatus, datumiIzBesedila, vNiz, danes } = require('./datumi-en');

const ZEMLJEVID = 'https://www.eurekanetwork.org/programmes-sitemap.xml';
const PREDPONA = 'https://www.eurekanetwork.org/programmes-and-calls/';
const STAROST_DNI = 400;        // stran, ki se ni spremenila več kot leto, je razpis, ki je davno zaprt
const ZAMIK_MS = 300;           // vljuden razmik med zahtevki na isti strežnik
const HKRATI = 3;
const NAJVEC_ZNAKOV_VSEBINE = 2000;

// Programi, ki niso razpisi za financiranje projektov: srečanja z vlagatelji (Investment Readiness),
// knjižnice gradiv, iskanje partnerjev in vpis strokovnjakov.
const NI_RAZPIS = /investment-readiness|online-session|corporate-challenge|resource-library|-library\/|partner-search|become-a-eureka-expert/;

// Ime programa iz prve ravni poti; brez nje (razpis na prvi ravni) ga razberemo iz naziva.
const PROGRAMI = {
    'eurostars': 'Eurostars',
    'eureka-clusters': 'Eureka Clusters',
    'network-projects': 'Eureka Network Projects',
    'globalstars': 'Globalstars',
    'innowwide': 'Innowwide',
    'fast-track-to-the-eic-accelerator': 'Fast Track to the EIC Accelerator',
};

const cist = (t) => String(t || '').replace(/\s+/g, ' ').trim();
const pocakaj = (ms) => new Promise((r) => setTimeout(r, ms));

async function preberi(url) {
    const r = await fetch(url, { headers: { Accept: 'text/html,application/xml', 'User-Agent': 'Mozilla/5.0 (razpisnik-portal scraper)' } });
    if (!r.ok) throw new Error(`HTTP ${r.status} pri ${url}`);
    return r.text();
}

/** Strani razpisov iz zemljevida, spremenjene v zadnjih STAROST_DNI dneh. */
async function straniRazpisov(dan) {
    const xml = await preberi(ZEMLJEVID);
    const meja = new Date(dan.getTime() - STAROST_DNI * 86400000);
    const strani = [];
    for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)) {
        const url = m[1].trim();
        if (!url.startsWith(PREDPONA)) continue;
        const pot = url.slice(PREDPONA.length).replace(/\/$/, '');
        // Prazna pot je pregled vseh programov; ena raven brez razpisa je pregled programa (eurostars/).
        if (!pot || PROGRAMI[pot] || pot === 'investment-readiness' || pot === 'eureka-clusters') continue;
        if (NI_RAZPIS.test(url)) continue;
        if (new Date(m[2]) < meja) continue;
        strani.push(url);
    }
    return strani;
}

function razcleni(html, url, dan) {
    const $ = cheerio.load(html);
    const naziv = cist($('h1').first().text()) || cist($('title').text()).replace(/ - Eureka Network$/, '');
    if (!naziv) return null;

    // »Start Date: 17 December 2026, 12:00 AM CET« in »End Date: 4 March 2027, 2:00 PM CET«.
    const polje = (oznaka) => {
        const el = $('span').filter((_, s) => cist($(s).text()) === `${oznaka}:`).first();
        return el.length ? cist(el.parent().text()).replace(`${oznaka}:`, '').trim() : '';
    };
    const zacetek = datumiIzBesedila(polje('Start Date'))[0]?.datum || null;
    const konec = datumiIzBesedila(polje('End Date'))[0]?.datum || null;

    const vsebina = cist($('#about-this-call').text()).replace(/^About this call\s*/, '');
    let status;
    let rok = null;
    // Stalni razpis ima namesto roka nadomestni konec daleč v prihodnosti (»Open call for Network
    // Projects«: »End 1 January 2030«); portal bi ga izpisal kot rok »še 1.200 dni«. Takega štejemo za
    // odprtega brez roka.
    const stalni = konec && konec.getFullYear() > dan.getFullYear() + 2;
    if (stalni) {
        status = zacetek && zacetek > dan ? 'Napovedan' : 'Odprt';
    } else if (konec) {
        rok = vNiz(konec);
        status = konec < dan ? 'Zaprt' : (zacetek && zacetek > dan ? 'Napovedan' : 'Odprt');
    } else if (zacetek && zacetek > dan) {
        status = 'Napovedan';
    } else {
        // Brez polj na strani (stalni razpis, Network Projects »open call«) poskusimo z besedilom.
        ({ rok, status } = rokInStatus(vsebina, dan));
    }

    const drzave = [];
    $('[data-country-name]').each((_, el) => {
        const ime = cist($(el).find('span').first().clone().children().remove().end().text());
        if (ime) drzave.push(ime);
    });

    const pot = url.slice(PREDPONA.length).split('/');
    const program = PROGRAMI[pot[0]] || (/eurostars/i.test(naziv) ? 'Eurostars' : 'Eureka Network Projects');

    const deli = [];
    if (zacetek) deli.push(`Odprtje: ${vNiz(zacetek)}`);
    if (stalni) deli.push('Stalno odprt razpis (prijave ves čas)');
    else if (konec) deli.push(`Rok: ${vNiz(konec)}`);
    if (drzave.length) deli.push(`Sodelujoče države: ${drzave.join(', ')}`);
    if (vsebina) deli.push(vsebina);

    return {
        'Naziv razpisa': naziv,
        'URL': url,
        'Status': status,
        'Rok prijave': rok,
        'Datum zaznave': vNiz(dan),
        'Datum objave': zacetek ? vNiz(zacetek) : null,
        'Programme': program,
        // EUREKA financira nacionalni organ vsake države z nepovratnimi sredstvi (stran: »Available funding«).
        'Tip financiranja': 'Nepovratna sredstva',
        'Sredstva': null,
        'Vsebina': deli.join(' · ').substring(0, NAJVEC_ZNAKOV_VSEBINE),
        'Izdajatelj': 'Eureka Network',
        'Izvorna domena': 'eurekanetwork.org',
        'Upravičene države': drzave.length ? drzave.join(', ') : null,
    };
}

Actor.main(async () => {
    const dan = danes();
    const strani = await straniRazpisov(dan);
    if (!strani.length) console.error('[EUREKA] ZEMLJEVID BREZ RAZPISOV — poglej programmes-sitemap.xml');
    console.log(`[EUREKA] zemljevid: ${strani.length} strani razpisov`);

    const rezultati = [];
    let napak = 0;
    for (let i = 0; i < strani.length; i += HKRATI) {
        await Promise.all(strani.slice(i, i + HKRATI).map(async (url) => {
            try {
                const zapis = razcleni(await preberi(url), url, dan);
                if (zapis) rezultati.push(zapis);
                else { napak++; console.error(`[EUREKA] NERAZČLENJENO: ${url}`); }
            } catch (e) {
                napak++;
                console.error(`[EUREKA] NAPAKA pri ${url}: ${e.message}`);
            }
        }));
        await pocakaj(ZAMIK_MS);
    }

    const poStanju = {};
    for (const r of rezultati) poStanju[r.Status] = (poStanju[r.Status] || 0) + 1;
    const brezRoka = rezultati.filter((r) => !r['Rok prijave']).length;
    console.log(`[EUREKA] zajetih ${rezultati.length}, po stanju ${JSON.stringify(poStanju)}, brez roka ${brezRoka}, napak ${napak}`);
    if (rezultati.length) await Actor.pushData(rezultati);
});
