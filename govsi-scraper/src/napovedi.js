/**
 * VLADNA SPOROČILA ZA JAVNOST → NAPOVEDANI RAZPISI (20. 8. 2026).
 *
 * ═══ ZAKAJ TA VEJA OBSTAJA ═══════════════════════════════════════════════════════════════════
 * Naročnik je 20. 8. 2026 pokazal tuje glasilo, ki je oglaševalo razpis „Les KG – poslovni
 * modeli" (15,72 mio EUR za lesnopredelovalna podjetja). Pri nas ga ni bilo.
 *
 * Izmerjeno tistega dne: od 3.370 zapisov z gov.si jih ima status „Napovedan" NIČ. Z gov.si
 * jemljemo samo OBJAVLJENE razpise (zbirka javnih objav), napovedi pa ne. Tudi Načrt razvojnih
 * spodbud 2026 (dokument s 4. 2. 2026) tega ukrepa ne vsebuje — je novejši od načrta.
 *
 * Informacija je obstajala samo kot VLADNO SPOROČILO ZA JAVNOST, objavljeno 10. 8. 2026 na
 * gov.si/novice. Konkurenca ni imela boljšega zajema — imela je drug vir.
 *
 * Komercialno je to najdragocenejši trenutek: dokler razpis ni objavljen, se prodaja priprava.
 *
 * ═══ ZAKAJ ZAZNAVA NE UGIBA ══════════════════════════════════════════════════════════════════
 * Vlada uporablja stalno formulo. Sporočilo o odobritvi se glasi:
 *   „Ministrstvo za ... je odobrilo evropska sredstva za »Javni razpis za ... (Les KG – poslovni
 *    modeli)«. Evropski sklad za regionalni razvoj bo prispeval več kot 13,3 milijona evrov."
 *
 * Formuli sta DVE (obe izmerjeni, glej vzorce nižje) in vsaka zahteva znesek. Poleg tega
 * veljata dva izločitvena pogoja: odobritev PROJEKTA ni razpis, in že objavljen razpis pride
 * po običajni poti. Raje spustimo napoved, kot da v seznam razpisov spustimo novico o
 * prerezanem traku.
 *
 * ═══ KAJ TAK ZAPIS SME IN ČESA NE SME TRDITI ═════════════════════════════════════════════════
 * Enako kot pri ARIS: napoved je napoved. Zapis dobi status „Napovedan", NIMA roka in NIMA
 * razpisne šifre — teh podatkov v sporočilu za javnost ni in izmišljati si jih ne smemo.
 * O pogojih upravičenosti tak zapis ne trdi ničesar; to pride šele iz razpisne dokumentacije.
 *
 * ═══ PAST, KI JO JE TREBA IMETI V MISLIH ═════════════════════════════════════════════════════
 * Ko bo razpis res objavljen, bo prišel po običajni poti (zbirka javnih objav) in v bazi bosta
 * DVA zapisa o isti stvari — napoved in razpis. Ime iz narekovajev je zato zajeto v celoti in
 * neokrnjeno: prav po njem se bosta zapisa povezala. To je ista past, ki je 20. 8. 2026 pokvarila
 * EU razpise (kaskadni pozivi z identifikatorjem matične teme).
 */
const cheerio = require('cheerio');

const BAZA = 'https://www.gov.si';

// Koliko novic pregledamo. 300 pokrije približno mesec dni objav vseh ministrstev — dovolj, da
// napovedi ne zamudimo, in dovolj malo, da tek ostane kratek.
const NOVIC_NA_STRAN = 100;
const STRANI = 3;

// ═══ DVE FORMULI, OBE IZMERJENI NA 299 NOVICAH (20. 8. 2026) ═════════════════════════════════
//
// FORMULA A — kohezijsko ministrstvo odobri sredstva za razpis, ki bo šele objavljen:
//   „...je odobrilo evropska sredstva za »Javni razpis za ... (Les KG – poslovni modeli)«."
//   Ime razpisa stoji v narekovajih in ga vzamemo od tam.
const IME_RAZPISA = /[»"„]\s*(Javni (?:razpis|poziv)[^«"”]{10,300}?)\s*[«"”]/i;
const ODOBRENA_SREDSTVA = /odobril[oa]?\s+(?:evropsk\w+\s+)?sredstv|še\s+ni\s+objavljen|v\s+pripravi\s+je|predvidoma\s+bo/i;

// FORMULA B — napovedan datum objave, ime razpisa NI v narekovajih:
//   „...bo 14. septembra 2026 objavilo četrti skupni transnacionalni razpis ... 37 milijonov evrov."
// To formulo je prvotno merilo spregledalo. Odkrita je bila z BRANJEM 53 naslovov, ne z vzorcem —
// zato je tu zapisana: kdor bo meril naslednjič, naj ve, da en zadetek od 299 ni bil dokaz, da je
// merilo dobro, ampak znak, da je preozko.
// POZOR NA PIKO: prvi zapis tega vzorca je uporabljal [^.], zato ni mogel prek besedne zveze
// "bo 14. septembra 2026 objavilo" — datum vsebuje piko in vzorec se je ustavil pred njo.
// Napaka je bila tiha: zaznava je vrnila nič in to je bilo videti kot "ni česa najti".
const BO_OBJAVLJEN = /\bbo\b.{0,90}?\bobjavil[oa]?\b.{0,140}?\b(razpis|poziv)/i;

// ═══ NASPROTNI DOKAZI — kaj NI napoved razpisa ═══════════════════════════════════════════════
//
// 1) ODOBRITEV PROJEKTA, ne razpisa. Isto ministrstvo z isto formulo objavlja tudi odobritve
//    posameznih projektov: „je odobrilo evropska sredstva za projekt GIGA NMR" (21. 7. 2026),
//    „za projekt Vzpostavitev nacionalne infrastrukture za Slovenski genom" (14. 8. 2026).
//    Denar je odobren, razpisa ni. Brez tega izločitvenega pravila bi v seznam razpisov spustili
//    novico o kolesarski poti.
const JE_PROJEKT = /odobril[oa]?\s+(?:evropsk\w+\s+)?sredstv\w*\s+za\s+projekt/i;

// 2) RAZPIS JE ŽE OBJAVLJEN — pride po običajni poti (zbirka javnih objav) in ga tu ne podvajamo.
//    Primer: „Ministrstvo ... je objavilo javni razpis za sofinanciranje nastopov ... na sejmih"
//    (15. 7. 2026).
const ZE_OBJAVLJEN = /^\s*objavljen[a-z]*\s+(?:je\s+)?javn|je\s+bil\s+objavljen|smo\s+objavili/i;
const ZE_OBJAVIL = /\bje\s+objavil[oa]?\b[^.]{0,60}?\b(javni\s+razpis|javni\s+poziv)/i;

// 3) ZNESEK. Brez njega gre skoraj vedno za novico o dogodku, ne o denarju.
const ZNESEK = /([\d.,]+)\s*(milijon\w*|mio\.?|EUR|evrov)/i;

// Predviden datum objave, kadar ga sporočilo pove („bo 14. septembra 2026 objavilo").
const DATUM_OBJAVE = /\bbo\s+(\d{1,2}\.\s*[a-zčšž]+\s*\d{4})\s+objavil/i;

const cist = (t) => String(t || '').replace(/\s+/g, ' ').trim();

function danes() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

/** Besedilo članka brez oznak — model in vzorci berejo besedilo, ne postavitve. */
function besedilo(html) {
    return cist(String(html || '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"'));
}

/** Seznam novic: [{ datum, naslov, url }] */
async function preberiSeznam(log) {
    const najdene = [];
    const videni = new Set();
    for (let s = 0; s < STRANI; s++) {
        const url = `${BAZA}/novice/?nrOfItems=${NOVIC_NA_STRAN}&start=${s * NOVIC_NA_STRAN}`;
        const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (razpisnik-portal scraper)' } });
        if (!r.ok) { log.warning(`[gov.si/novice] HTTP ${r.status} (start=${s * NOVIC_NA_STRAN}) — nadaljujem`); continue; }
        const $ = cheerio.load(await r.text());
        $('a[href^="/novice/"]').each((_, a) => {
            const href = cist($(a).attr('href'));
            const m = href.match(/^\/novice\/(\d{4}-\d{2}-\d{2})-[^/]+\/?$/);
            if (!m || videni.has(href)) return;
            const naslov = cist($(a).text());
            if (!naslov) return;
            videni.add(href);
            najdene.push({ datum: m[1], naslov, url: `${BAZA}${href}` });
        });
        await new Promise((res) => setTimeout(res, 300));
    }
    return najdene;
}

/**
 * Presoja enega članka. Vrne zapis ali null.
 *
 * Zavrnitev je pravilo, ne izjema: od približno 300 novic jih napoved razpisa nosi peščica.
 */
function presodi(clanek, telo, log) {
    // Najprej NASPROTNI DOKAZI — cenejši so in odstranijo največ.
    if (JE_PROJEKT.test(telo)) return null;
    if (ZE_OBJAVLJEN.test(clanek.naslov) || ZE_OBJAVIL.test(telo)) return null;

    // FORMULA A: ime v narekovajih. FORMULA B: napovedan datum objave, ime vzamemo iz naslova
    // novice — drugega vira zanj ni, in izmišljati si ga ne smemo.
    const vNarekovajih = telo.match(IME_RAZPISA);
    let ime = null, formula = null;
    if (vNarekovajih && ODOBRENA_SREDSTVA.test(telo)) { ime = cist(vNarekovajih[1]); formula = 'A'; }
    else if (BO_OBJAVLJEN.test(telo)) { ime = cist(clanek.naslov); formula = 'B'; }
    if (!ime) return null;

    const znesek = telo.match(ZNESEK);
    if (!znesek) {
        log.info(`[gov.si/novice] "${clanek.naslov.slice(0, 70)}" — napoved je, zneska ni; ne zapišem.`);
        return null;
    }
    // Institucija stoji pod datumom; kadar je ni, pustimo prazno in ne ugibamo.
    const inst = telo.match(/(Ministrstvo za [^.]{5,90}?)(?:\s+Ministrstvo za|\s+[A-ZČŠŽ][a-zčšž]+ za [a-z]|\s{2,}|\s+je\s)/);
    const predviden = telo.match(DATUM_OBJAVE);
    return {
        'Naziv razpisa': ime,
        'URL': clanek.url,
        'Status': 'Napovedan',
        'Rok prijave': null,           // v sporočilu za javnost ga ni in ga ne izmišljamo
        'Identifikator': null,         // razpisne šifre pred objavo ni
        'Programme': inst ? cist(inst[1]) : null,
        'Datum zaznave': danes(),
        'Vir napovedi': 'sporočilo za javnost',
        'Datum napovedi': clanek.datum,
        'Napovedana sredstva': cist(znesek[0]),
        'Predviden datum objave': predviden ? cist(predviden[1]) : null,
        'Formula zaznave': formula,
    };
}

/** Glavna pot: vrne seznam napovedanih razpisov iz vladnih sporočil. */
async function zajemiNapovedi(log) {
    const clanki = await preberiSeznam(log);
    log.info(`[gov.si/novice] Pregledujem ${clanki.length} novic.`);
    const zapisi = [];
    for (const c of clanki) {
        // Prvo sito je NASLOV — brez tega bi po nepotrebnem prenesli 300 člankov.
        if (!/razpis|poziv|sredstv|sofinancir|milijon|spodbud/i.test(c.naslov)) continue;
        try {
            const r = await fetch(c.url, { headers: { 'User-Agent': 'Mozilla/5.0 (razpisnik-portal scraper)' } });
            if (!r.ok) { log.warning(`[gov.si/novice] ${c.url} → HTTP ${r.status}`); continue; }
            const zapis = presodi(c, besedilo(await r.text()), log);
            if (zapis) {
                zapisi.push(zapis);
                log.info(`[gov.si/novice] NAPOVED (${c.datum}): ${zapis['Naziv razpisa'].slice(0, 90)} — ${zapis['Napovedana sredstva']}`);
            }
            await new Promise((res) => setTimeout(res, 200));
        } catch (e) {
            log.warning(`[gov.si/novice] ${c.url}: ${e.message}`);
        }
    }
    log.info(`[gov.si/novice] Napovedanih razpisov: ${zapisi.length}.`);
    return zapisi;
}

module.exports = { zajemiNapovedi, presodi, besedilo };
