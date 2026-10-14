/**
 * Datumi v angleških besedilih razpisov in razvrstitev na rok in odprtje.
 *
 * Datoteka je ENAKA v vseh actorjih z angleškimi viri (eureka, interreg-keep, eit,
 * partnerstva-obzorja, nato). Actor se gradi samo iz svoje podmape, zato skupne datoteke ne more
 * uvoziti iz druge mape; ob popravku popravi vse kopije (izvirnik: _skupno/datumi-en.js,
 * preverba: node _skupno/preizkus-datumi-en.js).
 */

const MESECI = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
    september: 9, october: 10, november: 11, december: 12,
    jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const IME_MESECA = '(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\\.?';

const dvomestno = (n) => String(n).padStart(2, '0');
const vNiz = (d) => (d ? `${dvomestno(d.getDate())}.${dvomestno(d.getMonth() + 1)}.${d.getFullYear()}` : null);

function danes() {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function sestavi(leto, mesec, dan) {
    if (!mesec || dan < 1 || dan > 31 || mesec > 12) return null;
    const datum = new Date(leto, mesec - 1, dan);
    // Neobstoječ datum (31 September) bi se tiho prelil v naslednji mesec; takega ne vzamemo.
    return datum.getMonth() === mesec - 1 ? datum : null;
}

/**
 * Vsi datumi z letnico v besedilu, po vrsti: »17 December 2026«, »17th December 2026«,
 * »December 17, 2026«, »17/12/2026«, »17.12.2026«, »2026-12-17«. Datum brez letnice ali samo mesec
 * z letnico (»Feb 2027«) ne šteje, ker dneva ne poznamo.
 */
function datumiIzBesedila(besedilo) {
    const t = String(besedilo || '');
    const najdeni = [];
    const vzorci = [
        [new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${IME_MESECA}\\s*,?\\s+(20\\d\\d)\\b`, 'gi'),
            (m) => sestavi(Number(m[3]), MESECI[m[2].toLowerCase()], Number(m[1]))],
        [new RegExp(`\\b${IME_MESECA}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s+(20\\d\\d)\\b`, 'gi'),
            (m) => sestavi(Number(m[3]), MESECI[m[1].toLowerCase()], Number(m[2]))],
        // Evropski zapis dan/mesec/leto; ameriškega zapisa (mesec/dan) viri, ki jih beremo, ne uporabljajo.
        [/\b(\d{1,2})[./](\d{1,2})[./](20\d\d)\b/g, (m) => sestavi(Number(m[3]), Number(m[2]), Number(m[1]))],
        [/\b(20\d\d)-(\d{2})-(\d{2})\b/g, (m) => sestavi(Number(m[1]), Number(m[2]), Number(m[3]))],
    ];
    for (const [vzorec, vDatum] of vzorci) {
        let m;
        while ((m = vzorec.exec(t)) !== null) {
            const datum = vDatum(m);
            if (datum) najdeni.push({ datum, indeks: m.index });
        }
    }
    return najdeni.sort((a, b) => a.indeks - b.indeks);
}

// Besede pred datumom, ki povedo, da je datum rok ali začetek. Šteje zadnja beseda pred datumom
// (»opens on 1 September and closes on 17 November 2026« je rok).
const VZOREC_ROK = /deadline|closes|closing|close on|closed on|end date|until|due|cut-?off|submi\w*[^.]{0,40}\b(by|before)\b|must be submitted|no later than|apply by/g;
const VZOREC_ODPRTJE = /opens|opening|opened|open on|start date|launch\w*|publication|published|starts/g;
// Besede za datumi, ki niso rok prijave (rezultati, odločitev, začetek in konec projekta).
const VZOREC_NI_ROK = /results?|decision|notification|announce\w*|project start|start of (the )?project|selection|evaluation|signature|grant agreement/g;
// »Projects may run until …«, »project end date …«: trajanje projekta, ne rok.
const VZOREC_TRAJANJE = /projects? (may |will |must |can )?(run|last|end|be completed|duration)|project end|end of (the )?project|implementation period/;
// Druga faza dvofaznega razpisa: rok zanjo velja samo za povabljene iz prve faze.
const VZOREC_DRUGA_FAZA = /full[- ]?proposal|stage 2|second stage|step 2|invited/;
const VZOREC_PRVA_FAZA = /pre-?proposal|stage 1|first stage|step 1|expression of interest/;

function zadnjiZadetek(besedilo, vzorec) {
    let zadnji = -1;
    vzorec.lastIndex = 0;
    let m;
    while ((m = vzorec.exec(besedilo)) !== null) zadnji = m.index;
    return zadnji;
}

/**
 * Rok in stanje razpisa iz prostega angleškega besedila.
 *
 * - Rok je najzgodnejši PRIHODNJI rok prve faze (ali enofaznega razpisa).
 * - Dvofazni razpis, katerega prva faza je že potekla, je za nove prijavitelje zaprt, tudi če rok
 *   druge faze (samo za povabljene) še prihaja.
 * - Če so vsi roki pretekli, je razpis zaprt in rok je zadnji.
 * - Brez roka: prihodnje odprtje pomeni napovedan razpis, sicer stanja ne poznamo (ne ugibamo).
 */
function rokInStatus(besedilo, dan = danes()) {
    const t = String(besedilo || '').replace(/\s+/g, ' ');
    const roki = [];
    const odprtja = [];
    // Faze ločujemo samo, kadar razpis prvo fazo res omenja; sicer je »full proposal deadline« edini rok.
    const imaFaze = VZOREC_PRVA_FAZA.test(t.toLowerCase()) || /invited/.test(t.toLowerCase());
    for (const { datum, indeks } of datumiIzBesedila(t)) {
        // Okno pred datumom ne seže čez konec prejšnjega stavka (». «) ali postavke (» · «): sicer
        // »Deadline: 3 December 2026. Results announced 15 March 2027« da rok 15. 3. 2027.
        let pred = t.slice(Math.max(0, indeks - 140), indeks).toLowerCase();
        const konecStavka = Math.max(pred.lastIndexOf('. '), pred.lastIndexOf(' · '), pred.lastIndexOf('; '));
        if (konecStavka >= 0) pred = pred.slice(konecStavka + 2);
        const kRok = zadnjiZadetek(pred, VZOREC_ROK);
        const kOdprtje = zadnjiZadetek(pred, VZOREC_ODPRTJE);
        if (kRok < 0 && kOdprtje < 0) continue;
        // Datumi rezultatov, odločitve in trajanja projekta niso rok, tudi če pred njimi stoji »until«.
        if (zadnjiZadetek(pred, VZOREC_NI_ROK) > Math.max(kRok, kOdprtje)) continue;
        if (VZOREC_TRAJANJE.test(pred)) continue;
        if (kRok > kOdprtje) {
            // Fazo presodimo po besedilu tik pred ključno besedo in med njo ter datumom.
            const okolica = pred.slice(Math.max(0, kRok - 60));
            const druga = imaFaze && VZOREC_DRUGA_FAZA.test(okolica) && !VZOREC_PRVA_FAZA.test(okolica);
            roki.push({ datum, druga });
        } else {
            odprtja.push(datum);
        }
    }

    const prihodnjiPrve = roki.filter((r) => !r.druga && r.datum >= dan).map((r) => r.datum).sort((a, b) => a - b);
    const preteklePrve = roki.filter((r) => !r.druga && r.datum < dan).map((r) => r.datum).sort((a, b) => a - b);
    const prihodnjiDruge = roki.filter((r) => r.druga && r.datum >= dan);
    const opisDruge = 'prva faza zaključena, druga faza samo za povabljene';

    if (prihodnjiPrve.length) {
        const zacetekPrihaja = odprtja.length > 0 && odprtja.every((d) => d > dan);
        return { rok: vNiz(prihodnjiPrve[0]), status: zacetekPrihaja ? 'Napovedan' : 'Odprt', faza: null };
    }
    if (preteklePrve.length) {
        const zadnji = preteklePrve[preteklePrve.length - 1];
        return { rok: vNiz(zadnji), status: 'Zaprt', faza: prihodnjiDruge.length ? opisDruge : null };
    }
    // Znan je samo rok druge faze (»invited to submit a full proposal by …«): prva je mimo.
    if (prihodnjiDruge.length) return { rok: null, status: 'Zaprt', faza: opisDruge };
    if (odprtja.some((d) => d > dan)) return { rok: null, status: 'Napovedan', faza: null };
    return { rok: null, status: 'Ni razvidno', faza: null };
}

module.exports = { datumiIzBesedila, rokInStatus, vNiz, danes, sestavi, MESECI };
