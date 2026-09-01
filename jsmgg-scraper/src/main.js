/**
 * JSMGG — Javni sklad malega gospodarstva Goriške — scraper javnih razpisov (Apify actor).
 *
 * Drupal 10, stran je strežniško izrisana -> plain fetch + cheerio (brez brskalnika).
 *
 * Vira (isti Drupal pogled "razpisi", dva prikaza):
 *   https://jsmgg.si/aktualni-razpisi    — odprti razpisi
 *   https://jsmgg.si/zakljuceni-razpisi  — zaključeni razpisi (listanje po 5 na stran)
 *
 * Zaključene beremo namenoma: razpis ob zaprtju izgine z aktualne strani, portal pa zapisov
 * sam ne briše — brez zaključene strani bi v portalu za vedno ostal s statusom "Odprt".
 *
 * Seznam je samo vstopna točka (naziv + povezava). Vsa polja beremo s strani posameznega
 * razpisa, ker so tam popolna (razpoložljiva sredstva in priponke na seznamu manjkajo).
 *
 * Izhod (pogodba polj za razpisi.js genericniMapper): Naziv razpisa, URL, Status, Rok prijave,
 * Datum zaznave, Sredstva, Vsebina, Tip financiranja, Programme.
 */
const { Actor } = require('apify');
const cheerio = require('cheerio');

const BAZA = 'https://jsmgg.si';
const SEZNAMI = ['/aktualni-razpisi', '/zakljuceni-razpisi'];
const NAJVEC_STRANI = 20;      // varovalka pred neskončnim listanjem
const ZAMIK_MS = 300;          // vljuden razmik med zahtevki na isti strežnik
const NAJVEC_ZNAKOV_VSEBINE = 2000;

const cist = (t) => String(t || '').replace(/\s+/g, ' ').trim();
const pocakaj = (ms) => new Promise((r) => setTimeout(r, ms));

function danes() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

async function preberi(url) {
    const r = await fetch(url, {
        headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (razpisnik-portal scraper)' },
    });
    if (!r.ok) throw new Error(`JSMGG HTTP ${r.status} pri ${url}`);
    return r.text();
}

// Datum iz Drupalovega <time datetime="2026-07-01T12:00:00Z"> v slovensko obliko dd.mm.yyyy.
function vSlovenskiDatum(isoNiz) {
    const m = String(isoNiz || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

/**
 * Prijavni roki JSMGG niso en datum, ampak seznam presečnih datumov po letih, npr.:
 *   "v letu 2026: 4. 9., 16. 10., 23. 11. - do 12.00 za vse navedene datume;"
 *   "v letu 2027: 8. 1., 12. 2., 19. 3. - do 12.00 ... oz. do porabe sredstev."
 * Besedilo razrežemo po odsekih "v letu YYYY" in v vsakem poberemo pare "dan. mesec.".
 * Ure ("do 12.00") vzorec ne ujame, ker za drugim številom zahteva piko, ki je tam ni.
 */
function datumiIzRokov(besedilo) {
    const datumi = [];
    const odseki = String(besedilo || '').split(/(?=v\s+letu\s+\d{4})/i);
    for (const odsek of odseki) {
        const zadetekLeta = odsek.match(/v\s+letu\s+(\d{4})/i);
        if (!zadetekLeta) continue;
        const leto = Number(zadetekLeta[1]);
        const vzorec = /(\d{1,2})\.\s*(\d{1,2})\.(?!\d)/g;
        let zadetek;
        while ((zadetek = vzorec.exec(odsek)) !== null) {
            const dan = Number(zadetek[1]);
            const mesec = Number(zadetek[2]);
            if (dan < 1 || dan > 31 || mesec < 1 || mesec > 12) continue;
            datumi.push({
                niz: `${String(dan).padStart(2, '0')}.${String(mesec).padStart(2, '0')}.${leto}`,
                cas: new Date(leto, mesec - 1, dan).getTime(),
            });
        }
    }
    datumi.sort((a, b) => a.cas - b.cas);
    return datumi;
}

// Vir ima svoje oznake stanja ("Odprt", "Zaključen", ob zaključenih še "Rezultati"), portal pa
// pozna Odprt/Zaprt/Napovedan. Kar ni razpoznavno, pustimo neopredeljeno — ne ugibamo.
function statusIzOznak(oznake) {
    const zdruzeno = oznake.join(' ').toLowerCase();
    if (/zaklju/.test(zdruzeno)) return 'Zaprt';
    if (/odprt/.test(zdruzeno)) return 'Odprt';
    return 'Ni razvidno';
}

/**
 * Prebere eno seznamsko stran za drugo, dokler ne zbere toliko zapisov, kot jih stran sama
 * napove ("Število zapisov N"). Na pager se namenoma ne zanašamo — zadošča, da število
 * zbranih doseže napovedano; če ga ne doseže, to javimo kot napako in ne tiho zajamemo pol vira.
 */
async function povezaveSeznama(pot) {
    const povezave = [];
    const videne = new Set();
    let napovedano = null;

    for (let stran = 0; stran < NAJVEC_STRANI; stran++) {
        const $ = cheerio.load(await preberi(`${BAZA}${pot}?page=${stran}`));

        if (napovedano === null) {
            const zadetek = cist($('.number-of-entries').text()).match(/(\d+)/);
            napovedano = zadetek ? Number(zadetek[1]) : null;
        }

        const vrstice = $('.view-razpisi .views-row');
        if (!vrstice.length) break;

        let novihNaStrani = 0;
        vrstice.each((_, vrstica) => {
            const a = $(vrstica).find('.views-field-title a[href]').first();
            const pot = a.attr('href');
            if (!pot) return;
            const url = pot.startsWith('http') ? pot : `${BAZA}${pot}`;
            if (videne.has(url)) return;
            videne.add(url);
            povezave.push(url);
            novihNaStrani++;
        });
        if (!novihNaStrani) break;                       // ista stran znova — konec listanja
        if (napovedano !== null && povezave.length >= napovedano) break;

        await pocakaj(ZAMIK_MS);
    }

    return { povezave, napovedano };
}

// Priponke so razdeljene v skupine ("Dokumenti in obrazci", "Vloga za posojilo", ...), vsaka
// s tabelo datotek. Za portal je uporaben seznam naslov -> pot do datoteke.
function priponkeRazpisa($, clanek) {
    const skupine = [];
    clanek.find('.field--name-field-datoteke .paragraph').each((_, p) => {
        const skupina = $(p);
        const naslov = cist(skupina.find('.field--name-field-naslov-paragrafa .field__item').first().text());
        const datoteke = [];
        skupina.find('.field--name-field-priponke a[href]').each((_, a) => {
            const ime = cist($(a).attr('title') || $(a).text());
            const pot = $(a).attr('href');
            if (ime && pot) datoteke.push(`${ime} (${pot})`);
        });
        if (datoteke.length) skupine.push(`${naslov || 'Priponke'}: ${datoteke.join('; ')}`);
    });
    return skupine;
}

function razcleniRazpis(html, url) {
    const $ = cheerio.load(html);
    const clanek = $('article.node--type-razpisi').first();
    if (!clanek.length) return null;

    const naziv = cist(clanek.find('.field--name-title').first().text()) || cist($('h1').first().text());
    if (!naziv) return null;

    const podrocje = cist(clanek.find('.field--name-field-podrocje-razpisa .field__item').first().text());
    const oznakeStanja = clanek.find('.field--name-field-status-razpisa .field__item')
        .map((_, e) => cist($(e).text())).get();
    const datumObjave = vSlovenskiDatum(clanek.find('.field--name-field-datum-objave time').first().attr('datetime'));
    const datumZakljucka = vSlovenskiDatum(clanek.find('.field--name-field-zakljucen-dne time').first().attr('datetime'));
    const sredstva = cist(clanek.find('.field--name-field-razpolozljiva-sredstva .field__item').first().text());
    const roki = clanek.find('.field--name-field-prijavni-roki .field__item')
        .map((_, e) => cist($(e).text())).get().filter(Boolean);
    const informacije = cist(clanek.find('.field--name-field-informacije .field__item').first().text());

    const datumi = datumiIzRokov(roki.join(' '));
    const sedaj = Date.now();
    const naslednji = datumi.find((d) => d.cas >= sedaj);
    // Zadnji presečni datum je dan, do katerega je razpis odprt — to je rok, ki ga portal
    // prikazuje in po katerem filtrira. Posamezni presečni datumi ostanejo v Vsebini.
    const zadnji = datumi.length ? datumi[datumi.length - 1].niz : null;

    const deli = [];
    if (podrocje) deli.push(`Področje: ${podrocje}`);
    if (sredstva) deli.push(`Razpoložljiva sredstva: ${sredstva}`);
    if (roki.length) deli.push(`Prijavni roki: ${roki.join(' ')}`);
    if (naslednji) deli.push(`Naslednji prijavni rok: ${naslednji.niz}`);
    if (datumObjave) deli.push(`Datum objave: ${datumObjave}`);
    if (datumZakljucka) deli.push(`Datum zaključka razpisa: ${datumZakljucka}`);
    if (informacije) deli.push(`Informacije: ${informacije}`);
    deli.push(...priponkeRazpisa($, clanek));

    return {
        'Naziv razpisa': naziv,
        'URL': url,
        'Status': statusIzOznak(oznakeStanja),
        // JSMGG daje izključno brezobrestna posojila; tip zapišemo le, kadar to potrjuje naziv
        // razpisa, sicer ostane prazen (portal pozna Nepovratna sredstva/Kredit/Garancija).
        'Tip financiranja': /posojil/i.test(naziv) ? 'Kredit' : null,
        'Rok prijave': zadnji,
        'Datum zaznave': danes(),
        'Sredstva': sredstva || null,
        'Programme': podrocje || null,
        'Datum objave': datumObjave,
        'Vsebina': deli.join(' · ').substring(0, NAJVEC_ZNAKOV_VSEBINE),
    };
}

Actor.main(async () => {
    const vseUrl = [];
    for (const pot of SEZNAMI) {
        const { povezave, napovedano } = await povezaveSeznama(pot);
        if (!povezave.length) {
            console.error(`[JSMGG] SEZNAM BREZ POVEZAV: ${pot} — poglej selektorje seznama`);
        } else if (napovedano !== null && povezave.length < napovedano) {
            console.error(`[JSMGG] NEPOPOLN SEZNAM: ${pot} — stran napove ${napovedano}, zbranih ${povezave.length}`);
        }
        console.log(`[JSMGG] ${pot}: ${povezave.length} povezav (stran napove ${napovedano ?? '?'})`);
        for (const url of povezave) if (!vseUrl.includes(url)) vseUrl.push(url);
    }

    const rezultati = [];
    let napak = 0;
    for (const url of vseUrl) {
        try {
            const zapis = razcleniRazpis(await preberi(url), url);
            if (zapis) rezultati.push(zapis);
            else { napak++; console.error(`[JSMGG] NERAZČLENJENO: ${url}`); }
        } catch (e) {
            napak++;
            console.error(`[JSMGG] NAPAKA pri ${url}: ${e.message}`);
        }
        await pocakaj(ZAMIK_MS);
    }

    const odprtih = rezultati.filter((r) => r.Status === 'Odprt').length;
    const zaprtih = rezultati.filter((r) => r.Status === 'Zaprt').length;
    console.log(`[JSMGG] zajetih ${rezultati.length} razpisov (odprtih ${odprtih}, zaprtih ${zaprtih}), napak ${napak}`);
    if (rezultati.length) await Actor.pushData(rezultati);
});
