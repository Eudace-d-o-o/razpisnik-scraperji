/**
 * Razčlemba strani CMEPIUS (brez omrežja in brez Apifyja, da jo preizkus požene na shranjeni strani).
 *
 * CMEPIUS za vsako leto objavi eno stran »Razpis Erasmus+ <leto>« (/objave/razpis/erasmus-<leto>/) s
 * preglednico rokov: v vsaki vrstici je ukrep (KA1, KA2 …) in rok, pri akreditaciji še opomba o omejitvi.
 * Iz vsake vrstice nastane EN zapis — en ukrep z enim rokom —, ker portal rok, stanje, obveščanje in
 * ujemanje vodi po zapisu. En zapis za cel razpis bi imel šest rokov in nobenega pravega.
 *
 * Centralizirani ukrepi (vodi jih izvajalska agencija EACEA) na tej strani niso; zajema jih vir EU.
 */
const cheerio = require('cheerio');

const MESECI = ['januar', 'februar', 'marec', 'april', 'maj', 'junij', 'julij', 'avgust', 'september', 'oktober', 'november', 'december'];
const NAJVEC_ZNAKOV_VSEBINE = 2000;

const cist = (t) => String(t || '').replace(/\s+/g, ' ').trim();
const dvomestno = (n) => String(n).padStart(2, '0');
const vNiz = (d) => `${dvomestno(d.getDate())}.${dvomestno(d.getMonth() + 1)}.${d.getFullYear()}`;
// Datum v besedilu za bralca (»19. 2. 2026«); vNiz je oblika, ki jo portal shrani v polje roka.
const vBesedilo = (d) => `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;

/** »19. februar 2026« ali »19. 2. 2026« -> Date; neobstoječ datum -> null. */
function datum(niz) {
    const besedno = String(niz || '').match(/(\d{1,2})\.\s*([a-zčšž]+)\s+(\d{4})/i);
    const stevilcno = String(niz || '').match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
    let dan; let mesec; let leto;
    if (besedno && MESECI.includes(besedno[2].toLowerCase())) {
        [dan, mesec, leto] = [Number(besedno[1]), MESECI.indexOf(besedno[2].toLowerCase()), Number(besedno[3])];
    } else if (stevilcno) {
        [dan, mesec, leto] = [Number(stevilcno[1]), Number(stevilcno[2]) - 1, Number(stevilcno[3])];
    } else return null;
    const d = new Date(leto, mesec, dan);
    return d.getMonth() === mesec && d.getDate() === dan ? d : null;
}

/** Oznaka za naslov: »Partnerstva za sodelovanje – KA2 – manjša partnerstva« -> PARTNERSTVA-ZA-SODELOVANJE-KA2-MANJSA-PARTNERSTVA. */
function oznakaIzBesedila(besedilo) {
    return cist(besedilo).normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase().substring(0, 80);
}

/** Povezave na letne strani razpisa s seznama /razpisi/: [{ leto, url }]. */
function letneStrani(html, baza) {
    const $ = cheerio.load(html);
    const strani = new Map();
    $('a[href]').each((_, a) => {
        const href = $(a).attr('href');
        const m = String(href).match(/\/objave\/razpis\/erasmus-(\d{4})\/?$/);
        if (!m) return;
        const url = href.startsWith('http') ? href : `${baza}${href}`;
        strani.set(Number(m[1]), url.endsWith('/') ? url : `${url}/`);
    });
    return [...strani].map(([leto, url]) => ({ leto, url })).sort((a, b) => a.leto - b.leto);
}

/** Datum objave strani iz podatkov za iskalnike (datePublished). */
function datumObjave(html) {
    const m = String(html).match(/"datePublished":"(\d{4})-(\d{2})-(\d{2})/);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/**
 * Zapisi ene letne strani. `dan` je današnji datum (brez ure); stanje se izračuna iz roka in datuma objave.
 * Vrne { zapisi, nerazclenjene } — nerazčlenjene so vrstice preglednice, v katerih ni bilo roka.
 */
function zapisiLetneStrani(html, { leto, url }, dan) {
    const $ = cheerio.load(html);
    // Brez tega se vrstice, ločene z <br>, zlepijo (»KA2– manjša partnerstva«).
    $('br').replaceWith(' ');
    const objava = datumObjave(html);
    const besediloStrani = cist($('body').text());
    // »Za Erasmus+ projekte 2026 je za Slovenijo na voljo okoli … EUR.« — skupna sredstva, kadar jih stran navaja.
    const sredstva = (besediloStrani.match(/Za Erasmus\+[^.]{0,80}na voljo okoli[^.]*\./i) || [])[0] || null;

    const zapisi = [];
    const nerazclenjene = [];
    $('table tr').each((_, tr) => {
        const celice = $(tr).find('td');
        if (celice.length < 2) return;
        const ukrep = cist($(celice[0]).text());
        const desno = cist($(celice[1]).text());
        const rok = datum(desno);
        if (!ukrep) return;
        if (!rok) { nerazclenjene.push(ukrep); return; }
        // Opomba za rokom (pri akreditaciji: koliko akreditacij se dodeli) — vse za »ob 12.00«.
        const opomba = cist(desno.replace(/^.*?\d{4}\s*(ob\s*\d{1,2}[.:]\d{2})?/i, ''));
        const oznaka = oznakaIzBesedila(ukrep);

        let status;
        if (rok < dan) status = 'Zaprt';
        else if (objava && objava > dan) status = 'Napovedan';
        else status = 'Odprt';

        const deli = [`Razpis Erasmus+ ${leto}, decentralizirani ukrep, ki ga vodi nacionalna agencija CMEPIUS.`,
            `Ukrep: ${ukrep}.`, `Rok: ${vBesedilo(rok)} ob 12.00 po bruseljskem času.`];
        if (opomba) deli.push(opomba);
        if (sredstva) deli.push(sredstva);

        zapisi.push({
            'Naziv razpisa': `Erasmus+ ${leto}: ${ukrep}`,
            // Ena stran ima več rokov, URL pa je v portalu enoličen ključ zapisa — zato sidro po ukrepu.
            'URL': `${url}#${oznaka.toLowerCase()}`,
            'Status': status,
            'Rok prijave': vNiz(rok),
            'Datum zaznave': vNiz(dan),
            'Datum objave': objava ? vNiz(objava) : null,
            'Identifikator': `CMEPIUS-${leto}-${oznaka}`.substring(0, 150),
            'Programme': 'Erasmus+',
            'Tip financiranja': 'Nepovratna sredstva',
            'Sredstva': null,
            'Vsebina': deli.join(' ').substring(0, NAJVEC_ZNAKOV_VSEBINE),
            'Izdajatelj': 'CMEPIUS',
            'Izvorni URL': url,
            'Izvorna domena': 'cmepius.si',
        });
    });
    return { zapisi, nerazclenjene };
}

module.exports = { datum, letneStrani, zapisiLetneStrani, oznakaIzBesedila };
