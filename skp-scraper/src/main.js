/**
 * SKP / ARSKTRP — Skupna kmetijska politika — scraper odprtih javnih razpisov (Apify actor).
 *
 * skp.si ima jQuery DataTables, ki se polni prek admin-ajax.php JSON endpointa:
 *   https://skp.si/wp-admin/admin-ajax.php?action=aktualni   -> odprti razpisi (privzeto)
 *   ...?action=pretekli                                      -> pretekli (za test parserja)
 * Vrne DataTables JSON: { data: [ {row}, ... ], recordsTotal }.
 *
 * Struktura vrstice:
 *   sifra_ukrepa: ["SN 2023-2027"]                (programski dokument)
 *   ukrep: ["IRP32 Izmenjava znanja ..."]         (ukrep/intervencija; koda je vodilni token)
 *   naziv_razpisa: { naziv_razpisa: ["Javni razpis ..."], url: "https://skp.si/..." }
 *   datum_objave: "17.10.2025"
 *   rok_za_prejem_vlog: ["13. 11. 2025"]
 *   razpisana_sredstva: ["148.600 EUR"]
 *
 * OPOMBA: v času izdelave je bil "aktualni" prazen (kmetijski razpisi se odpirajo v valovih) —
 * scraper samodejno zajame razpise, ko se odprejo.
 *
 * Izhod (pogodba polj za razpisi.js genericniMapper): Naziv razpisa, URL, Status, Rok prijave,
 * Datum zaznave, Vsebina, Identifikator, Programme.
 */
const { Actor } = require('apify');

function danes() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}
// vrednosti so pogosto zaviti v array — vzemi prvo ne-prazno vrednost kot niz
function prvi(v) {
    if (Array.isArray(v)) return prvi(v.find(x => x != null && String(x).trim() !== ''));
    return v == null ? '' : String(v).trim();
}
// "13. 11. 2025" -> "13.11.2025"
function ocistiDatum(v) {
    const s = prvi(v);
    const m = s.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
    return m ? `${m[1].padStart(2, '0')}.${m[2].padStart(2, '0')}.${m[3]}` : (s || null);
}

Actor.main(async () => {
    const input = (await Actor.getInput()) || {};
    const action = input.action === 'pretekli' ? 'pretekli' : 'aktualni';
    const URL = `https://skp.si/wp-admin/admin-ajax.php?action=${action}`;

    const r = await fetch(URL, { headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } });
    if (!r.ok) throw new Error(`SKP HTTP ${r.status}`);
    const j = await r.json();
    const vrstice = Array.isArray(j.data) ? j.data : [];

    const rezultati = [];
    for (const row of vrstice) {
        const nazivObj = row.naziv_razpisa || {};
        const naziv = prvi(nazivObj.naziv_razpisa);
        const url = prvi(nazivObj.url);
        if (!naziv || !url) continue;

        const sifra = prvi(row.sifra_ukrepa);           // npr. "SN 2023-2027"
        const ukrep = prvi(row.ukrep);                  // npr. "IRP32 Izmenjava znanja ..."
        const sredstva = prvi(row.razpisana_sredstva);
        const datumObjave = prvi(row.datum_objave);
        const rok = ocistiDatum(row.rok_za_prejem_vlog);
        const kodaUkrepa = (ukrep.match(/^([A-ZČŠŽ]+\d+[A-Za-z0-9.\-]*)/) || [])[1] || null;

        const deli = [];
        if (ukrep) deli.push(ukrep);
        if (sredstva) deli.push(`Sredstva: ${sredstva}`);
        if (datumObjave) deli.push(`Objavljeno: ${datumObjave}`);

        rezultati.push({
            'Naziv razpisa': naziv,
            'URL': url,
            'Status': 'Odprt',
            'Rok prijave': rok,
            'Datum zaznave': danes(),
            'Vsebina': deli.join(' · ').substring(0, 2000),
            'Identifikator': kodaUkrepa,
            'Programme': sifra || null,
        });
    }

    console.log(`[SKP] action=${action}, zajetih ${rezultati.length} razpisov`);
    if (rezultati.length) await Actor.pushData(rezultati);
});
