/**
 * Hrvaška — EU fondovi (natječaji/pozivi) — scraper odprtih pozivov (Apify actor).
 *
 * Osrednji hrvaški portal eufondovi.gov.hr/pozivi vgnezdi aplikacijo eu-pozivi.eufondovi.gov.hr,
 * ki podatke bere iz JAVNEGA JSON API-ja MIS (ekohezija.gov.hr/MISPublicApi). Zato brskalnik ni
 * potreben — samo fetch API-ja + razčlenitev (kot SPIRIT/SKP).
 *
 * ZAKAJ JE VSEBINA TAKO PODROBNA (predelava 2026-07-28):
 * Detajlne per-poziv strani NI — URL kaže na SPA seznam z ?poziv=<Oznaka>. Ta naslov v brskalniku
 * deluje, pri strojnem branju pa vrne prazno ogrodje Next.js aplikacije z naslovom "Create Next
 * App". Dva povzetka na portalu sta zato dobila prav ta naslov in prazno vsebino, ker je poznejši
 * korak (generiranje povzetka, polnjenje izvirnika) ta naslov prebral kot spletno stran.
 *
 * Popravek ni v menjavi naslova — ta je za obiskovalca pravilen in je hkrati unikatni ključ v
 * `razpisi_scrapani.url`, zato bi ga menjava podvojila (enako se je zgodilo pri ARIS prenovi.)
 * Popravek je v tem, da scraper zajame VSE, kar API ponuja, tako da naslova nikoli ni treba
 * ponovno brati. Poleg seznama (`poziv/browse`) zato beremo še podroben zapis (`poziv/{ID}`).
 *
 * API: https://ekohezija.gov.hr/MISPublicApi/poziv/browse/?status=Otvoren&top=N&skip=0&statusIds[]=Otvoren
 *   -> { TotalCount, Records: [ { ID, Naziv, Oznaka, Status, Sazetak, CiljPoziva, Predmet,
 *        SvrhaPoziva, PrihvatljiviPrijavitelji, Prijavitelji, Podrucja, NadleznoTijeloNaziv,
 *        InvesticijskiFondNaziv, OperativniProgramNaziv, VrstaPostupkaDodjeleNaziv,
 *        DatumObjavePoziva, DatumPocetkaZaprimanjaProjektnihPrijava,
 *        RokZaPodnosenjeProjektnihPrijava, VrijednostPoziva, UkupnaBespovratnaSredstva,
 *        NajnizaVrijednostPotpore, NajvisaVrijednostPotpore, Prilozi, UputeZaPrijavitelje } ] }
 * Podrobno: https://ekohezija.gov.hr/MISPublicApi/poziv/{ID}   (ne "poziv/get?id=" — ta vrne 404)
 *
 * Izhod (pogodba polj za razpisi.js genericniMapper): Naziv razpisa, URL, Status, Rok prijave,
 * Datum zaznave, Vsebina, Identifikator, Programme, Vrednost (EUR).
 */
const { Actor } = require('apify');
const { ProxyAgent } = require('undici');

const OSNOVA = 'https://ekohezija.gov.hr/MISPublicApi';
const API = `${OSNOVA}/poziv/browse/?status=Otvoren&op=kk&top=1000&skip=0&fond=&vpd=&podrucje=&tijelo&statusIds[]=Otvoren`;
const SEZNAM = 'https://eu-pozivi.eufondovi.gov.hr/calls/';

// Vsebina gre v `razpisi_scrapani` in je podlaga za povzetek — zato jo režemo šele pri meji, ki
// je preživi cela. Prejšnjih 2000 znakov je odrezalo že sam Sažetak (ta ima do ~3000 znakov).
const NAJVEC_VSEBINA = 12000;

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

// Polja API-ja ponekod vsebujejo HTML (odstavki, seznami) — za shranjeno besedilo ga odstranimo,
// sicer bi oznake pristale v povzetku.
function cist(t) {
    if (t == null) return '';
    if (Array.isArray(t)) return t.map(cist).filter(Boolean).join('; ');
    if (typeof t === 'object') return cist(t.Naziv || t.Name || t.Opis || '');
    return String(t)
        .replace(/<\s*(br|\/p|\/li|\/div)\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
        .replace(/\s+/g, ' ')
        .trim();
}

function evr(v) {
    const n = Number(v);
    if (!n || n <= 0) return null;
    return n.toLocaleString('hr-HR', { maximumFractionDigits: 0 }) + ' EUR';
}

// Iz priponk poberemo imena in povezave — pri preverjanju točnosti je koristno vedeti, da
// dokumentacija obstaja, tudi ko je njena vsebina v PDF-ju.
function priponke(p) {
    const vse = [];
    for (const kljuc of ['Prilozi', 'UputeZaPrijavitelje', 'Obrasci', 'DokumentacijaZaIzravnuDodjelu']) {
        for (const d of Array.isArray(p[kljuc]) ? p[kljuc] : []) {
            const ime = cist(d.Naziv || d.NazivDatoteke || d.Name);
            if (ime) vse.push(ime);
        }
    }
    return vse;
}

async function podrobno(id, dispatcher, glave) {
    if (!id) return null;
    try {
        const r = await fetch(`${OSNOVA}/poziv/${encodeURIComponent(id)}`, { dispatcher, headers: glave });
        if (!r.ok) return null;
        return await r.json();
    } catch (e) {
        return null;
    }
}

Actor.main(async () => {
    // ekohezija.gov.hr blokira ne-regionalne IP-je (Apify DC IP -> Connect Timeout; VPS/SI IP dela).
    // Zato fetch usmerimo preko Apify RESIDENTIAL proxyja s hrvaškim IP-jem.
    const proxyConfig = await Actor.createProxyConfiguration({ groups: ['RESIDENTIAL'], countryCode: 'HR' });
    const proxyUrl = await proxyConfig.newUrl();
    const dispatcher = new ProxyAgent({
        uri: proxyUrl,
        requestTls: { rejectUnauthorized: false }, // za primer nepopolne verige certifikatov
        headersTimeout: 60000,
        bodyTimeout: 60000,
    });
    const glave = {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        // API je zaledje aplikacije eu-pozivi.eufondovi.gov.hr — pošljemo pričakovana headerja
        Referer: 'https://eu-pozivi.eufondovi.gov.hr/',
        Origin: 'https://eu-pozivi.eufondovi.gov.hr',
    };

    const r = await fetch(API, { dispatcher, headers: glave });
    if (!r.ok) throw new Error(`HR eufondovi API HTTP ${r.status}`);
    const j = await r.json();
    const zapisi = Array.isArray(j.Records) ? j.Records : [];

    const rezultati = [];
    let sPodrobnim = 0;
    for (const osnovni of zapisi) {
        const naziv = cist(osnovni.Naziv);
        if (!naziv) continue;

        // Podroben zapis je nadmnožica seznamskega; če ga ni, delamo s seznamskim.
        const d = await podrobno(osnovni.ID, dispatcher, glave);
        if (d) sPodrobnim++;
        const p = { ...osnovni, ...(d || {}) };

        const kljuc = cist(p.Oznaka) || cist(p.ID);
        const url = `${SEZNAM}?poziv=${encodeURIComponent(kljuc)}`;
        const sredstva = evr(p.UkupnaBespovratnaSredstva) || evr(p.VrijednostPoziva);

        // Vsebino zapišemo z oznakami polj, ne kot zlepljen niz — tako je iz nje pozneje mogoče
        // dokazati posamezen podatek (znesek, rok, upravičence) pri preverjanju točnosti.
        const deli = [];
        const dodaj = (oznaka, vrednost) => { const v = cist(vrednost); if (v) deli.push(`${oznaka}: ${v}`); };
        dodaj('Oznaka', p.Oznaka);
        dodaj('Status', p.Status || p.MisStatus);
        dodaj('Nadležno tijelo', p.NadleznoTijeloNaziv);
        dodaj('Vrsta postupka', p.VrstaPostupkaDodjeleNaziv);
        dodaj('Fond', p.InvesticijskiFondNaziv);
        dodaj('Operativni program', p.OperativniProgramNaziv);
        dodaj('Područja', p.Podrucja);
        dodaj('Datum objave', isoVDatum(p.DatumObjavePoziva));
        dodaj('Početak zaprimanja prijava', isoVDatum(p.DatumPocetkaZaprimanjaProjektnihPrijava));
        dodaj('Rok za podnošenje prijava', isoVDatum(p.RokZaPodnosenjeProjektnihPrijava));
        dodaj('Ukupna bespovratna sredstva', evr(p.UkupnaBespovratnaSredstva));
        dodaj('Vrijednost poziva', evr(p.VrijednostPoziva));
        dodaj('Najniža vrijednost potpore', evr(p.NajnizaVrijednostPotpore));
        dodaj('Najviša vrijednost potpore', evr(p.NajvisaVrijednostPotpore));
        dodaj('Prijavitelji', p.Prijavitelji);
        dodaj('Prihvatljivi prijavitelji', p.PrihvatljiviPrijavitelji);
        dodaj('Cilj poziva', p.CiljPoziva);
        dodaj('Svrha poziva', p.SvrhaPoziva);
        dodaj('Predmet', p.Predmet);
        dodaj('Sažetak', p.Sazetak);
        const dok = priponke(p);
        if (dok.length) dodaj('Dokumentacija', dok.join('; '));

        rezultati.push({
            'Naziv razpisa': naziv,
            'URL': url,
            'Status': 'Odprt', // API filtriramo status=Otvoren
            'Rok prijave': isoVDatum(p.RokZaPodnosenjeProjektnihPrijava),
            'Datum zaznave': danes(),
            'Vsebina': deli.join('\n').substring(0, NAJVEC_VSEBINA),
            'Identifikator': cist(p.Oznaka) || null,
            'Programme': cist(p.OperativniProgramNaziv) || cist(p.InvesticijskiFondNaziv) || null,
            'Vrednost (EUR)': sredstva,
        });
    }

    const povprecna = rezultati.length
        ? Math.round(rezultati.reduce((v, x) => v + x.Vsebina.length, 0) / rezultati.length) : 0;
    console.log(`[HR-EUFONDOVI] zajetih ${rezultati.length} odprtih pozivov (od TotalCount ${j.TotalCount}), `
        + `podroben zapis pridobljen za ${sPodrobnim}, povprečna dolžina vsebine ${povprecna} znakov`);
    if (rezultati.length) await Actor.pushData(rezultati);
});
