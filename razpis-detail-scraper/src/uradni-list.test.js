// Ročni preizkus čistih funkcij iz uradni-list.js — brez ogrodja, samo node:assert.
// Poganjanje: node src/uradni-list.test.js
// pretvoriUradniListPdf (branje PDF-ja) tu NI testirana — zahteva binarne PDF datoteke
// Uradnega lista, ki niso del repozitorija. Preverjena je bila ROČNO na dejanskih številkah UL
// (glej poročilo naloge in poročilo nasprotnega pregleda 25. 9. 2026 — 16 številk UL, brez
// napak). izrezSpremembo/poisciOznakoRazpisa/najdiSpremembeLinke/preberiSpremembo spodaj
// testiramo na ROČNO pripravljenem besedilu, ki natančno posnema strukturo dejanskega UL
// PDF-ja (glava/podnožje, deljaji, več objav v isti številki, glava zlepljena sredi vrstice).
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import { izrezSpremembo, najdiSpremembeLinke, poisciOznakoRazpisa, preberiSpremembo } from './uradni-list.js';

// Pomožna funkcija — sestavi besedilo, kakršno vrne pretvoriUradniListPdf (po odstranitvi
// glave/podnožja in deljajev), z več objavami v isti "številki UL".
function ul(...objave) {
    return objave.join('\n') + '\n';
}

// 1) POPRAVEK NASPROTNEGA PREGLEDA (25. 9. 2026, TOČKA 2): "BIZI Krožno" je bil PODNIZ
// "BIZI Krožno Obmejna" — .includes() ju je pomešal. Brez uradne oznake (rezervna pot) mora
// ujemanje po CELEM nazivu ju pravilno ločiti.
{
    const besedilo = ul(
        `Št. 3021-1/2025-SRRS-10 Ob-1000/25
Sprememba
Slovenski regionalno razvojni sklad objavlja spremembe Javnega razpisa za finančni produkt – BIZI Krožno, št. 3021-1/2024-SRRS-1, objavljenega, in sicer kot sledi:
Skupni razpisani znesek finančnega produkta
BIZI Krožno je 1.111.111,00 EUR.
Slovenski regionalno razvojni sklad`,
        `Št. 3021-1/2025-SRRS-11 Ob-1001/25
Sprememba
Slovenski regionalno razvojni sklad objavlja spremembe Javnega razpisa za finančni produkt – BIZI Krožno Obmejna, št. 3021-1/2024-SRRS-2, objavljenega, in sicer kot sledi:
Skupni razpisani znesek finančnega produkta
BIZI Krožno Obmejna je 2.222.222,00 EUR.
Slovenski regionalno razvojni sklad`,
    );
    const krozno = izrezSpremembo(besedilo, 'BIZI Krožno', null);
    assert.ok(krozno, '"BIZI Krožno" bi moral najti svoj odsek (brez oznake, rezervna pot)');
    assert.ok(krozno.includes('1.111.111,00 EUR'), 'mora vsebovati svoj znesek');
    assert.ok(!krozno.includes('2.222.222,00 EUR'), 'NE SME pobrati zneska od "BIZI Krožno Obmejna"');

    const obmejna = izrezSpremembo(besedilo, 'BIZI Krožno Obmejna', null);
    assert.ok(obmejna, '"BIZI Krožno Obmejna" bi moral najti svoj odsek');
    assert.ok(obmejna.includes('2.222.222,00 EUR'), 'mora vsebovati svoj znesek');

    // Prazen/kratek/preozek naziv ne sme nič ujeti (degenerirani vnosi).
    for (const slabNaziv of ['', 'AGRO FI', 'PF']) {
        assert.equal(izrezSpremembo(besedilo, slabNaziv, null), null, `naziv "${slabNaziv}" ne sme nič ujeti`);
    }
    console.log('1) Cel naziv namesto podniza (BIZI Krožno / Obmejna) + degenerirani vnosi: OK');
}

// 2) PRIMARNO MERILO: uradna oznaka razpisa. Ko je znana, MORA odločati — tudi če besedilo v
// uvodnem stavku po pomoti navaja drug naziv (znan primer, Uradni list št. 108/2024, SRRS-41:
// uvod pravi "AGRO FI mladi", a njegova oznaka je dejansko oznaka od "AGRO FI mikro").
{
    const besedilo = ul(
        `3301-1/2024-SRRS-41 Ob-3538/24
Sprememba
Slovenski regionalno razvojni sklad objavlja spremembe Drugega javnega razpisa za finančni produkt
– AGRO FI mladi, št. 3301-1/2024-SRRS-22, objavljenega, in sicer kot sledi:
Skupni razpisani znesek finančnega produkta
AGRO FI mikro iz vira Ministrstva za kmetijstvo je 4.153.646 EUR.
Slovenski regionalno razvojni sklad`,
        `Št. 3301-1/2024-SRRS-42 Ob-3539/25
Sprememba
Slovenski regionalno razvojni sklad objavlja spremembe Drugega javnega razpisa za finančni produkt
– AGRO FI mladi, št. 3301-1/2024-SRRS-23, objavljenega, in sicer kot sledi:
Skupni razpisani znesek finančnega produkta
AGRO FI mladi je 9.538.838,00 EUR.
Slovenski regionalno razvojni sklad`,
    );
    // Z znano PRAVO oznako za "AGRO FI Mladi" (-23) odsek z NAPAČNO oznako (-22) NE SME priti
    // v poštev, čeprav njegov uvod pravilno navaja "AGRO FI mladi".
    const mladi = izrezSpremembo(besedilo, 'AGRO FI Mladi', '3301-1/2024-SRRS-23');
    assert.ok(mladi, 'z oznako "-23" mora najti PRAVI odsek');
    assert.ok(mladi.includes('9.538.838,00 EUR'), 'mora vsebovati znesek iz odseka s pravo oznako');
    assert.ok(!mladi.includes('4.153.646'), 'ne sme pobrati zneska iz odseka z NAPAČNO oznako');

    // Oznaka, ki je v besedilu ni (izmišljena), ne sme dobiti nič.
    assert.equal(izrezSpremembo(besedilo, 'AGRO FI Mladi', '9999-9/2099-SRRS-99'), null, 'neznana oznaka ne sme nič ujeti');

    // REZERVNA pot (oznaka ni znana) — navzkrižna preverba drugega zapisa naziva mora
    // SAMOSTOJNO preprečiti isto napako. Uporabimo VEČVRSTIČNO obliko (naziv na svoji vrstici,
    // "iz vira" na naslednji) — natanko taka, kot je v dejanskem Uradnem listu, št. 108/2024, in
    // ki je prvotni (preohlapni) regex za drugi zapis zgrešil (zajel je ves tekst od PRVE
    // pojavitve besede "produkt" v uvodnem stavku do "iz vira", s čimer je pomotoma vseboval
    // OBA naziva hkrati in preverbo naredil neučinkovito).
    const besediloVecvrsticno = ul(
        `3301-1/2024-SRRS-41 Ob-3538/24
Sprememba
Slovenski regionalno razvojni sklad objavlja spremembe Drugega javnega razpisa za finančni produkt
– AGRO FI mladi, št. 3301-1/2024-SRRS-22, objavljenega, in sicer kot sledi:
Skupni razpisani znesek finančnega produkta
AGRO FI mikro iz vira Ministrstva za kmetijstvo je 4.153.646 EUR.
Slovenski regionalno razvojni sklad`,
        `Št. 3301-1/2024-SRRS-42 Ob-3539/25
Sprememba
Slovenski regionalno razvojni sklad objavlja spremembe Drugega javnega razpisa za finančni produkt
– AGRO FI mladi, št. 3301-1/2024-SRRS-23, objavljenega, in sicer kot sledi:
Skupni razpisani znesek finančnega produkta
AGRO FI mladi je 9.538.838,00 EUR.
Slovenski regionalno razvojni sklad`,
    );
    const mladiRezerva = izrezSpremembo(besediloVecvrsticno, 'AGRO FI Mladi', null);
    assert.ok(mladiRezerva, 'brez oznake (rezerva) mora navzkrižna preverba kljub temu najti PRAVI odsek');
    assert.ok(mladiRezerva.includes('9.538.838,00 EUR'), 'rezervna pot mora vsebovati znesek iz PRAVEGA odseka');
    assert.ok(!mladiRezerva.includes('4.153.646'), 'rezervna pot NE SME pobrati zneska iz napačno poimenovanega odseka');
    console.log('2) Primarno merilo je oznaka; rezervna pot z navzkrižno preverbo (znan primer SRRS-41, UL 108/2024): OK');
}

// 3) POPRAVEK (TOČKA 4): glava naslednje objave, zlepljena SREDI vrstice s koncem prejšnje
// ("... znižanja do porabe sredstev Št. 3301-1/2023-SRRS-53 Ob-3539/24"), NE SME odrezati
// konca prejšnjega odseka niti prilepiti nase začetek naslednjega.
{
    const besedilo =
        `Št. 3301-1/2024-SRRS-42 Ob-3540/24
Sprememba
Slovenski regionalno razvojni sklad objavlja spremembe Javnega razpisa za finančni produkt – AGRO FI mladi, št. 3301-1/2024-SRRS-23, objavljenega, in sicer kot sledi:
Skupni razpisani znesek finančnega produkta
AGRO FI mladi je 9.538.838,00 EUR razvojnih posojil ter kapitalska
znižanja do porabe sredstev Št. 3301-1/2023-SRRS-53 Ob-3539/24
Sprememba
Slovenski regionalno razvojni sklad objavlja spremembe Javnega razpisa za finančni produkt – AGRO ZEMLJA, št. 3301-1/2023-SRRS-7, objavljenega, in sicer kot sledi:
Skupni razpisani znesek finančnega produkta
AGRO ZEMLJA je 500,00 EUR.
Slovenski regionalno razvojni sklad
`;
    const mladi = izrezSpremembo(besedilo, 'AGRO FI Mladi', '3301-1/2024-SRRS-23');
    assert.ok(mladi, 'mora najti odsek');
    assert.ok(mladi.includes('znižanja do porabe sredstev'), 'konec odseka se NE SME odrezati zaradi zlepljene glave naslednje objave');
    assert.ok(!mladi.includes('Št. 3301-1/2023-SRRS-53'), 'glava naslednje objave NE SME ostati prilepljena na ta odsek');
    assert.ok(!mladi.includes('AGRO ZEMLJA'), 'vsebina naslednje objave ne sme priti v ta odsek');
    console.log('3) Glava, zlepljena sredi vrstice, ne odreže konca odseka: OK');
}

// 4) Naslov strani z letnico v oklepaju ("NVO PF (2024)") — letnica se odstrani pred primerjavo.
{
    const besedilo = ul(
        `Št. 0301-1/2024-SRRS-5 Ob-4000/25
Sprememba
Slovenski regionalno razvojni sklad objavlja spremembe Javnega razpisa za finančni produkt – NVO PF, št. 0301-1/2024-SRRS-1, objavljenega, in sicer kot sledi:
Skupni razpisani znesek finančnega produkta
NVO PF je 700,00 EUR.
Slovenski regionalno razvojni sklad`,
    );
    const odsek = izrezSpremembo(besedilo, 'NVO PF (2024)', null);
    assert.ok(odsek, 'letnica v oklepaju ne sme preprečiti ujemanja');
    assert.ok(odsek.includes('700,00 EUR'));
    console.log('4) Letnica v oklepaju v naslovu strani: OK');
}

// 5) Prelom naziva čez vrstico PDF-ja ("– BIZI\nOPO Turizem ter BIZI Turizem") — normalizacija
// presledkov/prelomov mora ujemanje kljub temu najti.
{
    const besedilo = ul(
        `Št. 3021-1/2025-SRRS-29 Ob-3069/25
Sprememba
Slovenski regionalno razvojni sklad objavlja spremembe Javnega razpisa za finančna produkta – BIZI
OPO Turizem ter BIZI Turizem, št. 3021-1/2025-SRRS-6, objavljenega, in sicer kot sledi:
Skupni razpisani znesek
BIZI Turizem je 300,00 EUR.
Slovenski regionalno razvojni sklad`,
    );
    const odsek = izrezSpremembo(besedilo, 'BIZI Turizem', null);
    assert.ok(odsek, 'prelom naziva čez vrstico ne sme preprečiti ujemanja');
    console.log('5) Prelom naziva čez vrstico PDF-ja: OK');
}

// 6) Besedilo brez ijedne SRRS objave — mora vrniti null, ne pasti.
{
    assert.equal(izrezSpremembo('Neka povsem druga vsebina brez SRRS oznak.', 'AGRO FI Mladi', null), null);
    console.log('6) Brez SRRS objav v besedilu: OK (null, brez napake)');
}

// 7) poisciOznakoRazpisa — najde oznako v dokumentu, klasificiranem kot "javni razpis"
// (prednostno), sicer v katerem koli že prebranem dokumentu; brez zadetka vrne null.
{
    const prebrana = [
        { l: { tekst: 'Obrazec za prijavo', klasifikacija: 'obrazec' }, cisto: 'nekaj besedila brez oznake' },
        { l: { tekst: 'Javni razpis', klasifikacija: 'javni razpis' }, cisto: 'Slovenski regionalno razvojni sklad objavlja Drugi javni razpis za finančni produkt – AGRO FI mladi, št. 3301-1/2024-SRRS-23, in sicer...' },
    ];
    assert.equal(poisciOznakoRazpisa(prebrana), '3301-1/2024-SRRS-23');
    assert.equal(poisciOznakoRazpisa([{ l: { tekst: 'x' }, cisto: 'brez oznake tukaj' }]), null);
    assert.equal(poisciOznakoRazpisa([]), null);
    console.log('7) poisciOznakoRazpisa — prednost dokumentu "javni razpis", null brez zadetka: OK');
}

// 8) najdiSpremembeLinke — najde SAMO povezave, katerih besedilo se zacne s "Sprememba" IN
// vodijo na uradni-list.si; EKO skladov vzorec (golo "41/2025" znotraj stavka, brez besede
// "Sprememba") se NE SME ujeti (izmerjeno 25. 9. 2026 na dejanski strani EKO sklada).
{
    const html = `
        <a href="https://www.uradni-list.si/_pdf/2025/Ra/r2025073.pdf">Sprememba št. 4</a>
        <a href="https://www.uradni-list.si/_pdf/2026/Ra/r2026005.pdf">Sprememba št. 6,</a>
        <a href="https://www.uradni-list.si/_pdf/2025/Ra/r2025041.pdf">41/2025</a>
        <a href="https://ekosklad.si/uploads/x/Sprememba-JP.pdf">Spletna stran Eko sklada (Objava spremembe)</a>
    `;
    const $ = cheerio.load(html);
    const linki = najdiSpremembeLinke($, 'https://www.srrs.si/javni-razpisi/agro-fi-mladi-2/');
    assert.equal(linki.length, 2, 'najti mora natanko 2 povezavi, ki se zacneta s "Sprememba" IN vodita na uradni-list.si');
    assert.equal(linki[0].leto, '2025');
    assert.equal(linki[0].stevilka, '73');
    assert.equal(linki[1].stevilka, '5', '"r2026005.pdf" -> številka UL je 5 (leto 2026), ne glede na besedilo povezave');
    console.log('8) najdiSpremembeLinke — pravilno filtriranje: OK');
}

// 9) POPRAVEK NASPROTNEGA PREGLEDA (TOČKA 1, NAJHUJŠE): preberiSpremembo NIKOLI ne sme vreči
// napake naprej — niti ko fetch vrže napako, niti ko fetch NIKOLI ne odgovori. V obeh primerih
// mora vrniti { napaka }, ne prekiniti klicatelja.
{
    const povezava = { tekst: 'Sprememba št. 1', url: 'https://www.uradni-list.si/_pdf/2025/Ra/r2025999.pdf', leto: '2025', stevilka: '999' };

    // 9a) fetch vrže napako (npr. izpad omrežja/DNS).
    const fetchVrzeNapako = async () => { throw new Error('getaddrinfo ENOTFOUND www.uradni-list.si'); };
    const r1 = await preberiSpremembo(povezava, 'Test Naziv', null, { fetchImpl: fetchVrzeNapako });
    assert.ok(r1.napaka, 'napaka omrežja mora vrniti { napaka }, ne vreči naprej');
    assert.ok(!r1.odsek);
    assert.ok(r1.napaka.includes('ENOTFOUND'));

    // 9b) fetch NIKOLI ne odgovori (obesi se) — mora se prekiniti po časovni omejitvi, ne
    // čakati v neskončnost. Kratka omejitev (200 ms) za hiter preizkus.
    // Opomba: "keepAlive" spodaj drži Node-ov dogodkovni zanko dejavno med čakanjem na
    // AbortSignal.timeout — v resničnem zajemu to počnejo že drugi dejavni procesi (crawlee,
    // omrežje), tu pa je izolirana skripta brez njih in bi jo Node sicer (napačno) prepoznal
    // kot "nič ne čaka" ter jo takoj končal, še preden se časovna omejitev sploh sproži.
    const fetchSeObesi = (url, { signal } = {}) => new Promise((_, reject) => {
        if (signal) signal.addEventListener('abort', () => reject(new Error('AbortError: signal timed out')));
    });
    const t0 = Date.now();
    const keepAlive = setInterval(() => {}, 50);
    const r2 = await preberiSpremembo(povezava, 'Test Naziv', null, { fetchImpl: fetchSeObesi, casovnaOmejitevMs: 200 });
    clearInterval(keepAlive);
    const trajanje = Date.now() - t0;
    assert.ok(r2.napaka, 'fetch, ki se nikoli ne odzove, mora vrniti { napaka } po časovni omejitvi');
    assert.ok(!r2.odsek);
    assert.ok(trajanje < 5000, `preberiSpremembo se ne sme obesiti (trajalo ${trajanje} ms)`);

    // 9c) HTTP napaka (stran vrne 404/500) — prav tako se zabeleži, ne vrže naprej.
    const fetchVrne404 = async () => ({ ok: false, status: 404 });
    const r3 = await preberiSpremembo(povezava, 'Test Naziv', null, { fetchImpl: fetchVrne404 });
    assert.ok(r3.napaka?.includes('404'));

    console.log(`9) preberiSpremembo se nikoli ne obesi/vrže napake naprej (izpad ${trajanje} ms): OK`);
}

// 10) POPRAVEK (najden pri celotnem pregledu 39 strani SRRS, 25. 9. 2026): SRRS eno spremembo
// pogosto objavi SKUPAJ za več produktov naenkrat ("AGRO PF, BIZI PF, LOKALNO PF ter NVO PF") —
// predzadnji produkt v takem seznamu (pred besedo "ter") mora biti prepoznan kot CEL naziv.
// Poleg tega se lahko URADNA OZNAKA sama prelomi čez vrstico PDF-ja tik pred "SRRS-NN"
// (npr. "3301-1/2024-\nSRRS-28", potrjeno v Uradnem listu, št. 39/2025) — brez popravka bi to
// pomenilo, da odseka sploh ni bilo mogoče prepoznati (ne glede na naziv ali oznako).
{
    const besedilo = ul(
        `Št. 3301-1/2024-SRRS-50 Ob-2040/25
Sprememba
Slovenski regionalno razvojni sklad objavlja spremembe Drugega javnega razpisa za finančne produkte – AGRO
PF, BIZI PF, LOKALNO PF ter NVO PF, št. 3301-1/2024-
SRRS-28, objavljenega v Uradnem listu RS, št. 60/24, in sicer kot sledi:
I. V javnem razpisu se v poglavju 3. »Višina in vir sredstev« znesek spremeni na 100,00 EUR.
Slovenski regionalno razvojni sklad`,
    );
    for (const naziv of ['AGRO PF', 'BIZI PF', 'LOKALNO PF', 'NVO PF']) {
        const rezerva = izrezSpremembo(besedilo, naziv, null);
        assert.ok(rezerva, `"${naziv}" (rezervna pot) mora najti odsek v skupnem seznamu produktov`);
    }
    const zOznako = izrezSpremembo(besedilo, 'LOKALNO PF', '3301-1/2024-SRRS-28');
    assert.ok(zOznako, 'oznaka, prelomljena čez vrstico tik pred "SRRS-NN", mora biti kljub temu prepoznana');
    console.log('10) Skupni seznam produktov ("... ter NVO PF") + oznaka, prelomljena tik pred "SRRS-NN": OK');
}

console.log('\nVsi preizkusi uradni-list.js uspešni.');
