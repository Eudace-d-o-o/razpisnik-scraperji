/**
 * Hrvaška — EU fondovi (natječaji/pozivi) — scraper odprtih pozivov (Apify actor).
 *
 * Osrednji hrvaški portal eufondovi.gov.hr/pozivi vgnezdi aplikacijo eu-pozivi.eufondovi.gov.hr,
 * ki podatke bere iz JAVNEGA JSON API-ja MIS (ekohezija.gov.hr/MISPublicApi). Zato brskalnik ni
 * potreben — samo fetch API-ja + razčlenitev (kot SPIRIT/SKP).
 *
 * API: https://ekohezija.gov.hr/MISPublicApi/poziv/browse/?status=Otvoren&top=N&skip=0&statusIds[]=Otvoren
 *   -> { TotalCount, Records: [ { Naziv, Oznaka, RokZaPodnosenjeProjektnihPrijava (ISO),
 *        InvesticijskiFondNaziv, OperativniProgramNaziv, UkupnaBespovratnaSredstva, Prijavitelji,
 *        Sazetak, VrstaPostupkaDodjeleNaziv, DatumObjavePoziva, ID, Status } ] }
 *
 * Detajlne per-poziv strani ni (SPA), zato URL kaže na seznam z unikatnim ?poziv=<Oznaka|ID>
 * (unikatnost za razpisi_scrapani.url). Vse podrobnosti gredo v Vsebino.
 *
 * Izhod (pogodba polj za razpisi.js genericniMapper): Naziv razpisa, URL, Status, Rok prijave,
 * Datum zaznave, Vsebina, Identifikator, Programme, Vrednost (EUR).
 */
const { Actor } = require('apify');
const { Agent } = require('undici');

const API = 'https://ekohezija.gov.hr/MISPublicApi/poziv/browse/?status=Otvoren&op=kk&top=1000&skip=0&fond=&vpd=&podrucje=&tijelo&statusIds[]=Otvoren';
const SEZNAM = 'https://eu-pozivi.eufondovi.gov.hr/calls/';

// gov strani včasih ne postrežejo popolne verige certifikatov -> preverjanje izklopimo SAMO za ta
// fetch (dispatcher velja lokalno, ne globalno). Daljši connect timeout (ekohezija je počasen iz
// tujih/DC omrežij — privzetih 10s ni dovolj).
const tlsAgent = new Agent({
    connect: { rejectUnauthorized: false, timeout: 30000 },
    headersTimeout: 60000,
    bodyTimeout: 60000,
});

// ISO "2026-11-30T16:00:00Z" -> "30.11.2026"
function isoVDatum(v) {
    if (!v) return null;
    const m = String(v).substring(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}
function danes() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}
const cist = (t) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
function evr(v) {
    const n = Number(v);
    if (!n || n <= 0) return null;
    return n.toLocaleString('hr-HR', { maximumFractionDigits: 0 }) + ' EUR';
}

Actor.main(async () => {
    const r = await fetch(API, {
        dispatcher: tlsAgent,
        headers: {
            Accept: 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
            // API je zaledje aplikacije eu-pozivi.eufondovi.gov.hr — pošljemo pričakovana headerja
            Referer: 'https://eu-pozivi.eufondovi.gov.hr/',
            Origin: 'https://eu-pozivi.eufondovi.gov.hr',
        },
    });
    if (!r.ok) throw new Error(`HR eufondovi API HTTP ${r.status}`);
    const j = await r.json();
    const zapisi = Array.isArray(j.Records) ? j.Records : [];

    const rezultati = [];
    for (const p of zapisi) {
        const naziv = cist(p.Naziv);
        if (!naziv) continue;
        const kljuc = cist(p.Oznaka) || cist(p.ID);
        const url = `${SEZNAM}?poziv=${encodeURIComponent(kljuc)}`;

        const sredstva = evr(p.UkupnaBespovratnaSredstva);
        const deli = [];
        if (p.Oznaka) deli.push(`Oznaka: ${cist(p.Oznaka)}`);
        if (p.VrstaPostupkaDodjeleNaziv) deli.push(cist(p.VrstaPostupkaDodjeleNaziv));
        if (p.InvesticijskiFondNaziv) deli.push(cist(p.InvesticijskiFondNaziv));
        if (p.OperativniProgramNaziv) deli.push(cist(p.OperativniProgramNaziv));
        if (sredstva) deli.push(`Sredstva: ${sredstva}`);
        if (p.Prijavitelji) deli.push(`Prijavitelji: ${cist(p.Prijavitelji)}`);
        if (p.Sazetak) deli.push(cist(p.Sazetak));

        rezultati.push({
            'Naziv razpisa': naziv,
            'URL': url,
            'Status': 'Odprt', // API filtriramo status=Otvoren
            'Rok prijave': isoVDatum(p.RokZaPodnosenjeProjektnihPrijava),
            'Datum zaznave': danes(),
            'Vsebina': deli.join(' · ').substring(0, 2000),
            'Identifikator': cist(p.Oznaka) || null,
            'Programme': cist(p.OperativniProgramNaziv) || cist(p.InvesticijskiFondNaziv) || null,
            'Vrednost (EUR)': sredstva,
        });
    }

    console.log(`[HR-EUFONDOVI] zajetih ${rezultati.length} odprtih pozivov (od TotalCount ${j.TotalCount})`);
    if (rezultati.length) await Actor.pushData(rezultati);
});
