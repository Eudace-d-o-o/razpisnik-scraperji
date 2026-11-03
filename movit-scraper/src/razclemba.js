/**
 * Razčlemba strani MOVIT »Prijavni roki« (brez omrežja in brez Apifyja, da jo preizkus požene na shranjeni strani).
 *
 * MOVIT je nacionalna agencija za Erasmus+ Mladina in Evropsko solidarnostno enoto. Vsak program ima svojo
 * stran s prijavnimi roki; vsak rok je kartica (datum, naslov ukrepa, seznam aktivnosti in začetek projekta).
 * Iz vsake kartice nastane EN zapis z enim rokom. Stran nima letnice: MOVIT kartice vsako leto zamenja, zato
 * leto vzamemo iz datuma roka, v oznako zapisa pa damo cel datum (»Ključni ukrep 1« ima dva roka na leto).
 */
const cheerio = require('cheerio');

const NAJVEC_ZNAKOV_VSEBINE = 2000;

const cist = (t) => String(t || '').replace(/\s+/g, ' ').trim();
const dvomestno = (n) => String(n).padStart(2, '0');
const vNiz = (d) => `${dvomestno(d.getDate())}.${dvomestno(d.getMonth() + 1)}.${d.getFullYear()}`;
// Datum v besedilu za bralca (»12. 2. 2026«); vNiz je oblika, ki jo portal shrani v polje roka.
const vBesedilo = (d) => `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;

/** »12. 2. 2026 do 12.00« -> Date; neobstoječ datum -> null. */
function datum(niz) {
    const m = String(niz || '').match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
    if (!m) return null;
    const [dan, mesec, leto] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
    const d = new Date(leto, mesec, dan);
    return d.getMonth() === mesec && d.getDate() === dan ? d : null;
}

function oznakaIzBesedila(besedilo) {
    return cist(besedilo).normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase().substring(0, 60);
}

/**
 * Zapisi ene strani s prijavnimi roki. `program` = { koda, ime, url }; `dan` je današnji datum (brez ure).
 * Vrne { zapisi, nerazclenjene } — nerazčlenjene so kartice brez berljivega roka ali naslova.
 */
function zapisiStrani(html, program, dan) {
    const $ = cheerio.load(html);
    const zapisi = [];
    const nerazclenjene = [];
    $('article.deadline-card').each((_, kartica) => {
        const $k = $(kartica);
        const besediloRoka = cist($k.find('.deadline-card__date').text());
        const naslov = cist($k.find('.deadline-card__title').text());
        const rok = datum(besediloRoka);
        if (!rok || !naslov) { nerazclenjene.push(besediloRoka || naslov || '(prazna kartica)'); return; }

        // Vsebina kartice: aktivnosti in začetek projekta, v vrstnem redu, kot sta na strani.
        const vrstice = [];
        $k.find('.deadline-card__content').children().each((__, el) => {
            if (el.tagName === 'ul') {
                const aktivnosti = $(el).find('li').map((___, li) => cist($(li).text())).get().filter(Boolean);
                if (aktivnosti.length) vrstice.push(`Aktivnosti: ${aktivnosti.join(', ')}.`);
            } else {
                const t = cist($(el).text());
                if (t) vrstice.push(t.endsWith('.') ? t : `${t}.`);
            }
        });

        const status = rok < dan ? 'Zaprt' : 'Odprt';
        const oznaka = `${rok.getFullYear()}-${dvomestno(rok.getMonth() + 1)}-${dvomestno(rok.getDate())}-${oznakaIzBesedila(naslov)}`;
        const deli = [`${program.ime}, decentralizirani ukrep, ki ga vodi nacionalna agencija MOVIT.`,
            `Ukrep: ${naslov}.`, `Rok: ${vBesedilo(rok)} ob 12.00.`, ...vrstice];

        zapisi.push({
            'Naziv razpisa': `${program.ime} ${rok.getFullYear()}: ${naslov}`,
            // Ena stran ima več rokov, URL pa je v portalu enoličen ključ zapisa — zato sidro po roku in ukrepu.
            'URL': `${program.url}#${oznaka.toLowerCase()}`,
            'Status': status,
            'Rok prijave': vNiz(rok),
            'Datum zaznave': vNiz(dan),
            'Datum objave': null,
            'Identifikator': `MOVIT-${program.koda}-${oznaka}`.substring(0, 150),
            'Programme': program.ime,
            'Tip financiranja': 'Nepovratna sredstva',
            'Sredstva': null,
            'Vsebina': deli.join(' ').substring(0, NAJVEC_ZNAKOV_VSEBINE),
            'Izdajatelj': 'MOVIT',
            'Izvorni URL': program.url,
            'Izvorna domena': 'movit.si',
        });
    });
    return { zapisi, nerazclenjene };
}

module.exports = { datum, zapisiStrani };
