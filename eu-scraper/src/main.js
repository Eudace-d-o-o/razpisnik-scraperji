/**
 * EU Razpisi Actor — direktni API klic
 * Razpisi z več roki se shranijo z ločenimi stolpci Rok 1, Rok 2...
 */

import { Actor, KeyValueStore, Dataset } from 'apify';
import { log } from 'crawlee';

const API_BASE = 'https://api.tech.ec.europa.eu/search-api/prod/rest/search';
const PORTAL_BASE = 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/';
const MAX_ROKI = 6;

const PROGRAMME_NAMES = {
    '43108390': 'Horizon Europe',
    '43252476': 'COSME / SMP',
    '43251589': 'Citizens, Equality, Rights and Values',
    '43152860': 'Digital Europe',
    '43045329': 'Connecting Europe Facility',
    '43332642': 'LIFE',
    '43047030': 'Erasmus+',
    '43043891': 'European Social Fund+',
    '43151589': 'InvestEU',
    '43045643': 'Creative Europe',
};

function danes() { return new Date().toISOString().split('T')[0]; }

function slugify(str) {
    return str.replace(/https?:\/\//, '').replace(/\/$/, '').toLowerCase();
}

function formatDatum(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    if (isNaN(d)) return isoStr.substring(0,10);
    return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
}

async function fetchStran(pageNumber, pageSize = 100) {
    const query = JSON.stringify({
        bool: {
            must: [
                { terms: { type: ['1','2','3','8'] } },
                { terms: { status: ['31094501','31094502'] } }
            ]
        }
    });
    const fd = new FormData();
    fd.append('query', new Blob([query], { type: 'application/json' }));
    fd.append('languages', new Blob([JSON.stringify(['en'])], { type: 'application/json' }));
    fd.append('displayLanguage', 'en');

    const url = `${API_BASE}?apiKey=SEDIA&text=***&pageNumber=${pageNumber}&pageSize=${pageSize}&sortBy=deadlineDate&order=ASC`;
    const r = await fetch(url, { method: 'POST', body: fd });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

await Actor.init();

const input = await Actor.getInput() ?? {};
const stateKey = input.stateKeyName ?? 'EU_RAZPISI_STATE';
const pageSize = 100;

const store = await KeyValueStore.open('eu-razpisi-state');

// 1. Preberi obstoječe stanje
const obstojeceStanjeRaw = (await store.getValue(stateKey)) ?? {};

// MIGRACIJA FORMATA KLJUČA (POPRAVEK — PROBLEM 1): prejšnja verzija je ključala po
// "identifier__deadline", kar je NAPAČNO razbijalo en topic (en identifikator, npr.
// HORIZON-CL6-2024-FARM2FORK-01-11) v VEČ ločenih zapisov — po enega za vsak prihodnji rok.
// To je povzročalo fantomske podvojene zapise (npr. pravi rok 22.02.2024 + izmišljen/zastarel
// rok iz drugega API zapisa istega topica). Prejšnji komentar je trdil, da je identifier-only
// ključ "napačno združeval ~500 razpisov" — dejanski vzrok manjkajočih zapisov je bil
// pagination/retry (glej retry logiko nižje), ne ključanje. Zato se vračamo na PRAVILEN
// format: en zapis na identifikator (baseKey), vsi roki se zbirajo v `roki`.
// Migracija: stare zapise s formatom "identifier__deadline" konsolidiramo nazaj v en
// zapis na identifikator — združimo roke (unija), obdržimo najzgodnejši datumZaznave in
// "najbolj odprt" status, da ne izgubimo zgodovine ob prehodu na nov format ključa.
const obstojeceStanje = {};
let migriranihKljucev = 0;
const vrstniRedStatusov = { 'Odprt': 0, 'Napovedan': 1, 'Ni razvidno': 2, 'Zaprt': 3 };
for (const [k, v] of Object.entries(obstojeceStanjeRaw)) {
    const baseK = k.split('__')[0];
    if (baseK !== k) migriranihKljucev++;
    if (!obstojeceStanje[baseK]) {
        obstojeceStanje[baseK] = { ...v, roki: Array.isArray(v.roki) ? [...v.roki] : [] };
    } else {
        const obstojeci = obstojeceStanje[baseK];
        const zdruzeniRoki = new Set([...(obstojeci.roki || []), ...(v.roki || [])]);
        const boljsiStatus = (vrstniRedStatusov[obstojeci.status] ?? 9) <= (vrstniRedStatusov[v.status] ?? 9)
            ? obstojeci.status : v.status;
        obstojeceStanje[baseK] = {
            ...obstojeci,
            datumZaznave: [obstojeci.datumZaznave, v.datumZaznave].filter(Boolean).sort()[0] || obstojeci.datumZaznave,
            status: boljsiStatus,
            roki: [...zdruzeniRoki].sort(),
        };
    }
}
if (migriranihKljucev > 0) {
    log.warning(`[EU] MIGRACIJA: ${migriranihKljucev} zapisov s starim formatom ključa "identifier__deadline" konsolidiranih nazaj v ${Object.keys(obstojeceStanje).length} zapisov po identifikatorju (Problem 1 popravek).`);
}
const obstojeciOdprtiKeys = new Set(
    Object.entries(obstojeceStanje)
        .filter(([, r]) => r.status !== 'Zaprt')
        .map(([k]) => k)
);
log.info(`[EU] Obstoječe stanje: ${Object.keys(obstojeceStanje).length} razpisov (${obstojeciOdprtiKeys.size} odprtih/napovedanih)`);

// 2. Zberi VSE aktualne odprte/napovedane razpise z API-ja
const groups = new Map();

const prvaSt = await fetchStran(1, pageSize);
const skupaj = prvaSt.totalResults;
const steviloStrani = Math.ceil(skupaj / pageSize);
log.info(`[EU] API vrnil: ${skupaj} zapisov | Strani: ${steviloStrani} | Results na str 1: ${prvaSt.results?.length || 0}`);
log.info(`[EU] API response keys: ${Object.keys(prvaSt).join(', ')}`);

// Diagnostika — sledi natanko zakaj je končno število manjše od apiTotalResults:
// koliko surovih API zapisov je bilo skupaj obdelanih, koliko zavrženih (prekratek naziv),
// in koliko jih je bilo DUPLIKAT istega ključa (že obstoječ razpis na drugi strani).
let skupajObdelanih = 0;
let zavrzenihKratekNaziv = 0;
let duplikatovKljuca = 0;

function procesirajStran(data) {
    for (const item of (data.results || [])) {
        skupajObdelanih++;
        const meta = item.metadata || {};
        const identifier = (meta.identifier?.[0] || meta.callIdentifier?.[0] || meta.topicIdentifier?.[0] || '').toUpperCase();
        const naziv = meta.title?.[0] || meta.callTitle?.[0] || '';
        const deadline = meta.deadlineDate?.[0] || '';
        const startDate = meta.startDate?.[0] || '';
        // POPRAVEK — PROBLEM 2: statusKoda iz EU API-ja (meta.status) se NE uporablja več za
        // določanje statusa razpisa — EU search-API vrne topic kot "Open" tudi po preteku roka
        // (potrjeno na HORIZON-CL6-2024-FARM2FORK-01-11, rok 22.02.2024, oznaka ostala Open).
        // Status se zdaj izpelje iz DEJANSKIH datumov v post-processing koraku po zbiranju vseh
        // strani (glej blok "PROBLEM 2 popravek" nižje, po `procesirajStran` zanki).
        const progId = meta.frameworkProgramme?.[0] || meta.programmeDivision?.[0] || '';

        // Surovi URL iz meta (uporabimo ga SAMO za izvleček identifierja, če meta identifier manjka —
        // pogosto je format "competitive-calls-cs/<številka>", ki ni kanonična topic stran)
        const rawUrl = meta.url?.[0] || meta.esST_URL?.[0] || item.url || '';
        const urlIdMatch = rawUrl.match(/topic-details\/([^/?#]+)/i);
        const urlId = urlIdMatch ? urlIdMatch[1].toUpperCase() : '';
        const finalIdentifier = identifier || urlId;

        // POPRAVEK — PROBLEM 3: meta.url (rawUrl) pogosto vodi na napačno/splošno stran
        // (format "competitive-calls-cs/<številka>", ne "topic-details/<identifier>").
        // Kadar imamo finalIdentifier, VEDNO zgradimo kanonični topic-details URL, ki dejansko
        // vrne HTTP 200 in vodi na pravi topic. rawUrl uporabimo le kot zadnji fallback,
        // če identifikatorja sploh ni mogoče ugotoviti.
        const finalUrl = finalIdentifier ? (PORTAL_BASE + finalIdentifier.toLowerCase()) : rawUrl;

        // Debug: log metadata keys za prvi item
        if (groups.size === 0) {
            log.info(`[EU DEBUG] Meta keys: ${Object.keys(meta).join(', ')}`);
            log.info(`[EU DEBUG] identifier="${identifier}", urlId="${urlId}", progId="${progId}"`);
            log.info(`[EU DEBUG] item.url="${item.url || ''}", rawUrl="${rawUrl}"`);
        }

        if (!naziv || naziv.length < 5) { zavrzenihKratekNaziv++; continue; }

        // POPRAVEK — PROBLEM 1: ključ je SAMO identifikator (baseKey), en zapis na topic.
        // En EU Horizon topic (isti identifikator) je ena priložnost, tudi če ima več
        // cut-off rokov oddaje (multi-stage) — vsi roki se zbirajo v `roki` spodaj, ne
        // razbijamo topica v več zapisov po roku (to je povzročalo fantomske podvojene
        // zapise, npr. HORIZON-CL6-2024-FARM2FORK-01-11 s pravim rokom 22.02.2024 IN
        // izmišljenim/zastarelim rokom iz drugega API zapisa istega topica).
        const baseKey = finalIdentifier || slugify(naziv);
        const key = baseKey;
        if (groups.has(key)) duplikatovKljuca++; // pričakovano: isti topic ima lahko več API zapisov (npr. več cut-off stopenj)

        if (!groups.has(key)) {
            groups.set(key, {
                naziv,
                identifier:   finalIdentifier,
                programme:    PROGRAMME_NAMES[progId] || progId || '',
                razpisovalec: `Evropska komisija${PROGRAMME_NAMES[progId] ? ' – ' + PROGRAMME_NAMES[progId] : ''}`,
                datumObjave: formatDatum(startDate) || danes(),
                datumZaznave: obstojeceStanje[key]?.datumZaznave || danes(),
                tip: 'Nepovratna sredstva',
                url: finalUrl,
                zadnjaPosodobitev: danes(),
                roki: new Set(),
                // najzgodnejši znan startDate (odprtje razpisa) med vsemi sub-zapisi tega ključa —
                // rabimo ga v post-processing koraku za določanje statusa "Napovedan" (PROBLEM 2)
                startDateISO: startDate || '',
            });
        } else if (startDate) {
            const obstojeciZapis = groups.get(key);
            if (!obstojeciZapis.startDateISO || startDate < obstojeciZapis.startDateISO) {
                obstojeciZapis.startDateISO = startDate;
            }
        }

        if (deadline) groups.get(key).roki.add(deadline);
    }
}

procesirajStran(prvaSt);
const padleStrani = [];
for (let p = 2; p <= steviloStrani; p++) {
    try {
        const data = await fetchStran(p, pageSize);
        procesirajStran(data);
        log.info(`[EU] Stran ${p}/${steviloStrani}: ${groups.size} unikatnih`);
        await new Promise(r => setTimeout(r, 150));
    } catch (e) {
        log.error(`[EU] Napaka stran ${p}: ${e.message} — dodajam na seznam za ponovni poskus`);
        padleStrani.push(p);
    }
}

// Ponovi padle strani do 3x — EU API občasno vrne napako/timeout na posamezni strani,
// kar je glavni vzrok zakaj je prejšnja verzija (brez retry) vračala NESTABILNO število
// rezultatov med zagoni (enkrat manjkajo razpisi s strani 7, drugič s strani 23 itd.).
// Brez tega popravka se izgubljeni razpisi nikoli ne zaznajo, ker se padla stran preprosto
// izpusti namesto da bi se poskusila znova.
for (let poskus = 1; poskus <= 3 && padleStrani.length > 0; poskus++) {
    const seZaPoskus = [...padleStrani];
    padleStrani.length = 0;
    log.info(`[EU] Ponovni poskus #${poskus} za ${seZaPoskus.length} padlih strani: ${seZaPoskus.join(', ')}`);
    for (const p of seZaPoskus) {
        try {
            await new Promise(r => setTimeout(r, 500 * poskus)); // daljši premor pred retry-em
            const data = await fetchStran(p, pageSize);
            procesirajStran(data);
            log.info(`[EU] Stran ${p} uspešna po ponovnem poskusu #${poskus}`);
        } catch (e) {
            log.error(`[EU] Stran ${p} znova padla (poskus #${poskus}): ${e.message}`);
            padleStrani.push(p);
        }
    }
}
if (padleStrani.length > 0) {
    log.warning(`[EU] OPOZORILO: ${padleStrani.length} strani po 3 poskusih še vedno ni bilo mogoče pridobiti: ${padleStrani.join(', ')}. Razpisi s teh strani manjkajo v tem zagonu.`);
}

log.info(`[EU] Svežih razpisov z API: ${groups.size}`);
log.info(`[EU DIAGNOSTIKA] Skupaj obdelanih surovih zapisov: ${skupajObdelanih} | Zavrženih (prekratek naziv): ${zavrzenihKratekNaziv} | Podvojenih zapisov istega ključa (npr. več cut-off stopenj istega topica): ${duplikatovKljuca} | Unikatnih topicov: ${groups.size}`);

// PROBLEM 2 popravek: status razpisa izpeljemo iz DEJANSKIH datumov, ne iz EU API oznake
// (`meta.status`), ki po potrjenih primerih ostane "Open" tudi davno po preteku roka.
// Za vsak razpis (skupina/topic) poiščemo najzgodnejši PRIHODNJI rok med vsemi zbranimi
// roki (iz vseh strani/sub-zapisov istega identifikatorja):
//   - če prihodnjega roka ni (vsi roki so pretekli) → status "Zaprt" (spodaj tak zapis
//     izpade iz končnega seznama — glej filter `status !== 'Zaprt'`, kar je namerno: topic
//     brez enega samega prihodnjega roka dejansko ni več aktivna priložnost);
//   - če ima prihodnji rok, a razpis (startDate) še ni odprt → "Napovedan";
//   - sicer → "Odprt".
// Za izhod (stolpci Rok 1..N) najprej razvrstimo prihodnje roke (naraščajoče, Rok 1 = najzgodnejši
// prihodnji), nato pretekle roke (zgodovina cut-off stopenj) — namesto golega naraščajočega sorta
// čez vse roke, ki bi lahko za Rok 1 postavil davno pretekel datum.
const danesIsoZaStatus = new Date().toISOString().substring(0, 10);
for (const g of groups.values()) {
    const vsiRoki = [...g.roki].sort();
    const prihodnjiRoki = vsiRoki.filter(r => r.substring(0, 10) >= danesIsoZaStatus);
    const pretekliRoki = vsiRoki.filter(r => r.substring(0, 10) < danesIsoZaStatus);
    if (prihodnjiRoki.length === 0) {
        g.status = 'Zaprt';
    } else if (g.startDateISO && g.startDateISO.substring(0, 10) > danesIsoZaStatus) {
        g.status = 'Napovedan';
    } else {
        g.status = 'Odprt';
    }
    g.rokiZaIzhod = [...prihodnjiRoki, ...pretekliRoki];
}

// 3. Združi staro stanje z novim
//    - Novi razpisi: dodaj
//    - Obstoječi odprti: posodobi status in roke
//    - Razpisi ki so bili odprti ampak jih API NI vrnil: označi kot Zaprt
const novoStanje = { ...obstojeceStanje };
let noviCount = 0, posodobljeniCount = 0, zaprtCount = 0;

// Dodaj/posodobi razpise ki so v novem API odgovoru
for (const [key, g] of groups) {
    const razpis = {
        naziv:        g.naziv,
        identifier:   g.identifier || '',
        programme:    g.programme || '',
        razpisovalec: g.razpisovalec,
        datumObjave:  novoStanje[key]?.datumObjave || g.datumObjave,
        datumZaznave: novoStanje[key]?.datumZaznave || g.datumZaznave || danes(),
        tip:          g.tip,
        status:       g.status,
        url:          g.url,
        zadnjaPosodobitev: danes(),
        // vrstni red: najprej prihodnji roki (Rok 1 = najzgodnejši prihodnji), nato pretekli (zgodovina)
        roki: g.rokiZaIzhod,
    };

    if (!novoStanje[key]) {
        novoStanje[key] = razpis;
        noviCount++;
    } else {
        novoStanje[key] = razpis;
        posodobljeniCount++;
    }
}

// Označi kot Zaprt razpise ki so bili odprti ampak jih API ni vrnil
for (const key of obstojeciOdprtiKeys) {
    if (!groups.has(key)) {
        novoStanje[key] = {
            ...novoStanje[key],
            status: 'Zaprt',
            zadnjaPosodobitev: danes(),
        };
        zaprtCount++;
        log.info(`[EU] Zaprt (ni več v API): ${novoStanje[key].naziv?.substring(0,60)}`);
    }
}

log.info(`[EU] Novi: ${noviCount} | Posodobljeni: ${posodobljeniCount} | Zaprti: ${zaprtCount}`);

// 4. Shrani posodobljeno stanje (brez zaprtih — ne rabimo jih več scrapat)
const filtriranoStanje = Object.fromEntries(
    Object.entries(novoStanje).filter(([, r]) => r.status !== 'Zaprt')
);
await store.setValue(stateKey, filtriranoStanje);

// 5. Dataset
const dataset = await Dataset.open();
const vrstice = Object.values(filtriranoStanje)
    .sort((a, b) => {
        const red = { 'Odprt': 0, 'Napovedan': 1, 'Ni razvidno': 2 };
        return (red[a.status] ?? 3) - (red[b.status] ?? 3);
    })
    .map(r => {
        // r.roki je že urejen: najprej prihodnji roki (naraščajoče, Rok 1 = najzgodnejši
        // prihodnji), nato pretekli — NE sortiramo ponovno (glej PROBLEM 2 popravek zgoraj),
        // sicer bi golo naraščajoče sortiranje lahko za Rok 1 postavilo pretekel datum.
        const sortiraniRoki = r.roki || [];
        const vrstica = {
            'Naziv razpisa':      r.naziv,
            'Identifikator':      r.identifier || r.url?.match(/topic-details\/([^/?#]+)/i)?.[1]?.toUpperCase() || '',
            'Program':            r.programme || (r.identifier ? r.identifier.split('-')[0] : '') || (r.url?.match(/topic-details\/([^/?#]+)/i)?.[1]?.split('-')[0]?.toUpperCase() || ''),
            'Razpisovalec':       r.razpisovalec,
            'Datum objave':       r.datumObjave,
            'Datum zaznave':      r.datumZaznave || r.datumObjave || '',
            'Tip razpisa':        r.tip,
            'Status':             r.status,
            'URL':                r.url,
            'Zadnja posodobitev': r.zadnjaPosodobitev,
        };
        for (let i = 0; i < MAX_ROKI; i++) {
            vrstica[`Rok ${i + 1}`] = sortiraniRoki[i] ? formatDatum(sortiraniRoki[i]) : '';
        }
        return vrstica;
    });

for (const v of vrstice) {
    await dataset.pushData(v);
}

const odprti   = Object.values(filtriranoStanje).filter(r => r.status === 'Odprt').length;
const napovedi = Object.values(filtriranoStanje).filter(r => r.status === 'Napovedan').length;

log.info('═══════════════════════════════════════');
log.info(`Skupaj v bazi:  ${Object.keys(filtriranoStanje).length}`);
log.info(`Odprti:         ${odprti}`);
log.info(`Napovedani:     ${napovedi}`);
log.info(`Novo zaprtih:   ${zaprtCount}`);
log.info('═══════════════════════════════════════');

await Actor.setValue('SUMMARY', {
    skupaj: Object.keys(filtriranoStanje).length,
    odprti, napovedi, noviCount, zaprtCount, datum: danes(),
    apiTotalResults: skupaj,
    steviloStrani,
    padleStraniNaKoncu: padleStrani.length,
    skupajObdelanih, zavrzenihKratekNaziv, duplikatovKljuca,
});

await Actor.exit();
