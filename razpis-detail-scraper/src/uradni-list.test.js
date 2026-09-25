// Ročni preizkus čistih funkcij iz uradni-list.js — brez ogrodja, samo node:assert.
// Poganjanje: node src/uradni-list.test.js
// pretvoriUradniListPdf (branje PDF-ja) tu NI testirana — zahteva binarne PDF datoteke
// Uradnega lista, ki niso del repozitorija. Preverjena je bila ROČNO na treh dejanskih
// številkah UL (73/2025, 110/2025, 5/2026) ob nastanku tega modula (25. 9. 2026): šumniki
// ohranjeni, vrstni red stolpcev pravilen, zneski/datumi identični ročno preverjeni "čisti"
// pretvorbi. izrezSpremembo/najdiSpremembeLinke spodaj testirava na ROČNO pripravljenem
// besedilu, ki natančno posnema strukturo dejanskega UL PDF-ja (glava/podnožje, deljaji,
// več objav v isti številki, znan primer napačno poimenovane objave).
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import { izrezSpremembo, najdiSpremembeLinke } from './uradni-list.js';

// Pomožna funkcija — sestavi besedilo, kakršno vrne pretvoriUradniListPdf (po odstranitvi
// glave/podnožja in deljajev), z več objavami v isti "številki UL".
function ul(...objave) {
    return objave.join('\n') + '\n';
}

// 1) Dve objavi v isti številki UL za DVA RAZLIČNA produkta (AGRO FI mladi in AGRO FI mikro)
// — posneto po dejanski strukturi UL, št. 73/2025. Ujemanje mora izbrati PRAVI odsek in
// vanj NE sme priti besedilo drugega produkta.
{
    const besedilo = ul(
        `Št. 3301-1/2024-SRRS-54 Ob-2586/25
Sprememba
Slovenski regionalno razvojni sklad objavlja spremembe Drugega javnega razpisa za finančni produkt
– AGRO FI mladi, št. 3301-1/2024-SRRS-23, objavljenega v Uradnem listu RS, št. 49/24 z dne 14. 6. 2024, in sicer kot sledi:
Skupni razpisani znesek finančnega produkta
AGRO FI mladi je:
Slovenski regionalno razvojni sklad 17.559.671,00 EUR razvojnih posojil
II. Ostalo besedilo javnega razpisa ostane nespremenjeno.
Slovenski regionalno razvojni sklad`,
        `Št. 3301-1/2024-SRRS-53 Ob-2587/25
Sprememba
Slovenski regionalno razvojni sklad objavlja spremembe Drugega javnega razpisa za finančni produkt
– AGRO FI mikro, št. 3301-1/2024-SRRS-22, objavljenega v Uradnem listu RS, št. 49/24 z dne 14. 6. 2024, in sicer kot sledi:
Skupni razpisani znesek finančnega produkta
AGRO FI mikro je 2.228.646,00 EUR.
II. Ostalo besedilo javnega razpisa ostane nespremenjeno.
Slovenski regionalno razvojni sklad`,
    );
    const mladi = izrezSpremembo(besedilo, 'AGRO FI Mladi');
    assert.ok(mladi, 'AGRO FI Mladi bi moral najti ujemajoč odsek');
    assert.ok(mladi.includes('17.559.671,00 EUR'), 'odsek za mladi mora vsebovati njegov znesek');
    assert.ok(!mladi.includes('AGRO FI mikro'), 'odsek za mladi NE SME vsebovati tujega produkta (mikro)');

    const mikro = izrezSpremembo(besedilo, 'AGRO FI Mikro');
    assert.ok(mikro, 'AGRO FI Mikro bi moral najti ujemajoč odsek');
    assert.ok(mikro.includes('2.228.646,00 EUR'), 'odsek za mikro mora vsebovati njegov znesek');
    assert.ok(!mikro.includes('17.559.671'), 'odsek za mikro NE SME vsebovati tujega produkta (mladi)');
    console.log('1) Dva razlicna produkta v isti stevilki UL: OK');
}

// 2) Znan izjemen primer (Uradni list, št. 108/2024, SRRS-41): uvodni stavek napačno
// poimenuje "AGRO FI mladi", telo pa govori o "AGRO FI mikro" — brez navzkrižne preverbe bi
// se mladi razpisu napačno pripisala vsebina mikra. Pravilen izid: NOBEN od njiju ne dobi
// tega odseka (raje nič kot tuja objava), poleg pravega odseka za mladi z drugje v isti
// številki (druga SRRS oznaka, brez neskladja).
{
    const besedilo = ul(
        `3301-1/2024-SRRS-41 Ob-3538/24
Sprememba
Slovenski regionalno razvojni sklad objavlja spremembe Drugega javnega razpisa za finančni produkt
– AGRO FI mladi, št. 3301-1/2024-SRRS-22, objavljenega v Uradnem listu RS, št. 49/24 z dne 14. 6. 2024, in sicer kot sledi:
Skupni razpisani znesek finančnega produkta
AGRO FI mikro iz vira Ministrstva za kmetijstvo je 4.153.646 EUR.
II. Ostalo besedilo javnega razpisa ostane nespremenjeno.
Slovenski regionalno razvojni sklad`,
        `Št. 3301-1/2024-SRRS-42 Ob-3538/25
Sprememba
Slovenski regionalno razvojni sklad objavlja spremembe Drugega javnega razpisa za finančni produkt
– AGRO FI mladi, št. 3301-1/2024-SRRS-23, objavljenega v Uradnem listu RS, št. 49/24 z dne 14. 6. 2024, in sicer kot sledi:
Skupni razpisani znesek finančnega produkta
AGRO FI mladi je 9.538.838,00 EUR.
II. Ostalo besedilo javnega razpisa ostane nespremenjeno.
Slovenski regionalno razvojni sklad`,
    );
    const mladi = izrezSpremembo(besedilo, 'AGRO FI Mladi');
    assert.ok(mladi, 'AGRO FI Mladi mora najti pravi (drugi) odsek');
    assert.ok(mladi.includes('9.538.838,00 EUR'), 'mora vsebovati znesek iz PRAVEGA odseka');
    assert.ok(!mladi.includes('4.153.646'), 'ne sme pobrati zneska iz napacno poimenovanega odseka');

    const mikro = izrezSpremembo(besedilo, 'AGRO FI Mikro');
    assert.equal(mikro, null, 'AGRO FI Mikro NE SME dobiti napacno poimenovanega odseka (raje nic kot tuja objava)');
    console.log('2) Znan primer napacno poimenovane objave (UL 108/2024, SRRS-41): OK');
}

// 3) Sprememba brez ujemanja naziva (drug produkt, nič skupnega) — mora vrniti null.
{
    const besedilo = ul(
        `Št. 3301-1/2024-SRRS-77 Ob-7777/25
Sprememba
Slovenski regionalno razvojni sklad objavlja spremembe javnega razpisa za finančni produkt – BIZI Krožno, št. 2222-1/2024-SRRS-2, objavljenega, in sicer kot sledi:
Skupni razpisani znesek finančnega produkta
BIZI Krožno je 500,00 EUR.
Slovenski regionalno razvojni sklad`,
    );
    assert.equal(izrezSpremembo(besedilo, 'AGRO FI Mladi'), null, 'brez ujemajocega naziva mora vrniti null');
    console.log('3) Brez ujemanja naziva: OK (null, ne napacna objava)');
}

// 4) Besedilo brez ijedne SRRS objave (npr. cela stran EKO sklada) — mora vrniti null, ne pasti.
{
    assert.equal(izrezSpremembo('Neka povsem druga vsebina brez SRRS oznak.', 'AGRO FI Mladi'), null);
    console.log('4) Brez SRRS objav v besedilu: OK (null, brez napake)');
}

// 5) najdiSpremembeLinke — najde SAMO povezave, katerih besedilo se zacne s "Sprememba" IN
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
    console.log('5) najdiSpremembeLinke — pravilno filtriranje: OK');
}

console.log('\nVsi preizkusi uradni-list.js uspešni.');
