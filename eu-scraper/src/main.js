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

function normalizirajStatus(koda) {
    if (koda === '31094501') return 'Odprt';
    if (koda === '31094502') return 'Napovedan';
    return 'Ni razvidno';
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

// MIGRACIJA FORMATA KLJUČA: prejšnja verzija je uporabljala samo "identifier" kot ključ,
// kar je NAPAČNO združevalo razpise z istim identifikatorjem ampak razlicnim rokom oddaje
// (pravi vzrok manjkajočih ~500 razpisov). Nov format je "identifier__deadline". Brez te
// migracije bi PRVI zagon z novo kodo vse stare zapise (stari format ključa) napačno
// označil kot "Zaprt", ker jih `groups.has(key)` ne bi prepoznal z novim formatom ključa.
// Prepoznamo star format po odsotnosti "__" ločila in ga preprosto preskočimo pri primerjavi
// "kateri razpisi niso več v API odgovoru" — izgubimo le zgodovino datumZaznave za te
// zapise (ne kritično), ne pa napačno zaprtje aktivnih razpisov.
const obstojeceStanje = {};
let staroFormatnihKljucev = 0;
for (const [k, v] of Object.entries(obstojeceStanjeRaw)) {
    if (k.includes('__')) {
        obstojeceStanje[k] = v;
    } else {
        staroFormatnihKljucev++;
    }
}
if (staroFormatnihKljucev > 0) {
    log.warning(`[EU] MIGRACIJA: ${staroFormatnihKljucev} zapisov s starim formatom ključa (brez roka) — preskočenih pri primerjavi, ne bodo napačno oznaceni kot Zaprt.`);
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
        const statusKoda = meta.status?.[0] || '';
        const progId = meta.frameworkProgramme?.[0] || meta.programmeDivision?.[0] || '';

        // URL — iz meta.url ali item.url, fallback iz identifikatorja
        const rawUrl = meta.url?.[0] || meta.esST_URL?.[0] || item.url || '';
        const finalUrl = rawUrl || (identifier ? PORTAL_BASE + identifier.toLowerCase() : '');

        // Izvleček identifierja iz URL-ja samo če meta identifier manjka
        const urlIdMatch = finalUrl.match(/topic-details\/([^/?#]+)/i);
        const urlId = urlIdMatch ? urlIdMatch[1].toUpperCase() : '';
        const finalIdentifier = identifier || urlId;

        // Debug: log metadata keys za prvi item
        if (groups.size === 0) {
            log.info(`[EU DEBUG] Meta keys: ${Object.keys(meta).join(', ')}`);
            log.info(`[EU DEBUG] identifier="${identifier}", urlId="${urlId}", progId="${progId}"`);
            log.info(`[EU DEBUG] item.url="${item.url || ''}", rawUrl="${rawUrl}"`);
        }

        if (!naziv || naziv.length < 5) { zavrzenihKratekNaziv++; continue; }

        // KLJUČNO: ključ vključuje rok oddaje SAMO če je ta rok še v prihodnosti (ali danes).
        // Pretekli roki (npr. 17.1.2024) so del ZGODOVINE istega razpisa, ki ima tudi
        // prihajajoče roke (EU API status ostane "Open"/"Forthcoming" za razpis kot celoto) —
        // ne smejo postati svoj ločen zapis, sicer štejemo zaprte, davno minele priložnosti
        // kot če bi bile aktivne. Brez datuma (deadline manjka) ključ ostane samo identifikator.
        const danesISO = new Date().toISOString().substring(0, 10);
        const rokVPreteklosti = deadline && deadline.substring(0, 10) < danesISO;

        const baseKey = finalIdentifier || slugify(naziv);
        const key = (deadline && !rokVPreteklosti) ? `${baseKey}__${deadline}` : baseKey;
        if (groups.has(key)) duplikatovKljuca++;

        if (!groups.has(key)) {
            groups.set(key, {
                naziv,
                identifier:   finalIdentifier,
                programme:    PROGRAMME_NAMES[progId] || progId || '',
                razpisovalec: `Evropska komisija${PROGRAMME_NAMES[progId] ? ' – ' + PROGRAMME_NAMES[progId] : ''}`,
                datumObjave: formatDatum(startDate) || danes(),
                datumZaznave: obstojeceStanje[key]?.datumZaznave || danes(),
                tip: 'Nepovratna sredstva',
                status: normalizirajStatus(statusKoda),
                url: finalUrl || (finalIdentifier ? PORTAL_BASE + finalIdentifier.toLowerCase() : ''),
                zadnjaPosodobitev: danes(),
                roki: new Set(),
            });
        }

        if (deadline) groups.get(key).roki.add(deadline);
        if (statusKoda === '31094501') groups.get(key).status = 'Odprt';
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
log.info(`[EU DIAGNOSTIKA] Skupaj obdelanih surovih zapisov: ${skupajObdelanih} | Zavrženih (prekratek naziv): ${zavrzenihKratekNaziv} | Duplikatov ključa: ${duplikatovKljuca} | Unikatnih: ${groups.size}`);

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
        roki: [...g.roki].sort(),
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
        const sortiraniRoki = [...r.roki].sort();
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
