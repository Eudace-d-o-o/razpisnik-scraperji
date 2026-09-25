// Uradni list: branje PDF-ja in izrez spremembe posameznega razpisa (25. 9. 2026).
//
// ZAKAJ TA MODUL SPLOH OBSTAJA: SRRS in EKO sklad spremembe svojih razpisov pogosto objavijo
// IZKLJUČNO v Uradnem listu, ne na lastni strani (izmerjeno 25. 9. 2026: 7 od 28 odprtih
// razpisov SRRS/EKO sklad ima na strani vira spremembe v UL, ki jih zajem ni zajel). Cela
// številka UL se NIKOLI ne bere v celoti (glej opombo pri prioriteta=0 v main.js) — tu beremo
// SAMO tisto, kar stran vira sama označi kot spremembo (povezava z besedilom "Sprememba...") in
// znotraj cele številke UL izrežemo SAMO odsek, ki se nanaša na TA razpis.
//
// pdf-parse.getText() za dokumente Uradnega lista POKVARI dva stolpca strani (pomeša ju) in
// izgubi šumnike (izmerjeno 25. 9. 2026 na treh številkah UL — "financni" namesto "finančni",
// zneski/tabele pomešani med stolpcema). Uradni list ima besedilo v PDF-ju zapisano ZAPOREDNO po
// stolpcih (najprej cel levi stolpec, nato desni) — pdfjs-dist (na katerem sloni pdf-parse,
// node_modules/pdf-parse/dist/pdf-parse/esm/PDFParse.js) vrne postavke besedila v TEM istem
// vrstnem redu, če jih beremo NEPOSREDNO (brez pdf-parse-ove poravnave po vrsticah/celicah, ki
// stolpca zmeša). pdfjs-dist zato NI nova odvisnost — je knjižnica, na kateri pdf-parse že sloni.
import { log } from 'crawlee';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// Čista funkcija (brez mreže) — pretvori buffer PDF-ja Uradnega lista v besedilo. Testirana
// ločeno v uradni-list.test.js (izrezSpremembo) na ročno pripravljenih odsekih besedila; ta
// funkcija je preizkušena ROČNO na treh dejanskih številkah UL (glej poročilo naloge), ker
// zahteva binarne PDF datoteke, ki niso del repozitorija.
export async function pretvoriUradniListPdf(buffer) {
    const data = new Uint8Array(buffer);
    const doc = await pdfjsLib.getDocument({ data, verbosity: 0 }).promise;
    let besedilo = '';
    let vrstica = '';
    for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const tc = await page.getTextContent();
        for (const item of tc.items) {
            vrstica += item.str;
            if (item.hasEOL) {
                // Uradni list deli besede na koncu vrstice z deljajem ("spre-" + "membe").
                // Deljaj se odstrani, besedi pa združita BREZ presledka — sicer bi nastale
                // polovične besede ("upo- rabnik" namesto "uporabnik").
                if (/[A-Za-zČŠŽĆĐčšžćđ]-$/.test(vrstica)) besedilo += vrstica.slice(0, -1);
                else besedilo += vrstica + '\n';
                vrstica = '';
            }
        }
    }
    if (vrstica) besedilo += vrstica + '\n';
    await doc.destroy();
    // Ponavljajoča se glava/podnožje vsake strani UL ("Uradni list Republike Slovenije -
    // Razglasni del" + "Št. N / datum / Stran M", v obeh vrstnih redih) je pogosto vrinjena
    // SREDI odstavka (na meji strani) — odstrani se z regexom nad celotnim besedilom, ne po
    // vrsticah, da se ne izgubi besedilo, ki si z glavo deli isto vrstico.
    besedilo = besedilo
        .replace(/\s*Stran\s+\d+\s*\/\s*Št\.\s*\d+[a-zA-ZšŠ]?\s*\/\s*\d{1,2}\.\s*\d{1,2}\.\s*\d{4}\s+Uradni list Republike Slovenije\s*[–-]\s*Razglasni del\s*/g, ' ')
        .replace(/\s*Uradni list Republike Slovenije\s*[–-]\s*Razglasni del\s+Št\.\s*\d+[a-zA-ZšŠ]?\s*\/\s*\d{1,2}\.\s*\d{1,2}\.\s*\d{4}\s*\/\s*Stran\s+\d+\s*/g, ' ');
    return besedilo;
}

// Čista funkcija — znotraj CELOTNE številke UL poišče SAMO odsek, ki se nanaša na TA razpis:
// ujemanje po nazivu produkta IN uradni oznaki razpisa, obe navedeni SKUPAJ v uvodnem stavku
// vsake SRRS objave ("... za finančni produkt - <naziv>, št. <oznaka razpisa>, objavljenega
// v..."). Meje med posameznimi objavami v isti številki UL so zaporedne številke objave
// ("Ob-<zap>/<leto>", v svoji lastni vrstici) — splošna meja (katera koli agencija) omejuje
// odsek na koncu, ozka SRRS meja ("...-SRRS-NN Ob-...") ga najde na začetku. Vrne besedilo
// odseka ali null, če ujemajočega odseka ni (raje nič kot tuja objava).
export function izrezSpremembo(besedilo, naziv) {
    const SPLOSNA_MEJA = /^[^\n]{0,100}Ob-\d+\/\d{2}\.?\s*$/gm;
    const splosneMeje = [];
    let sm;
    while ((sm = SPLOSNA_MEJA.exec(besedilo)) !== null) splosneMeje.push(sm.index);

    const MEJA_SRRS = /(?:Št\.\s+)?[\d.\/-]+SRRS-\d+\s+Ob-\d+\/\d+/g;
    const srrsMeje = [];
    let m;
    while ((m = MEJA_SRRS.exec(besedilo)) !== null) srrsMeje.push(m.index);
    if (srrsMeje.length === 0) return null;

    const nazivL = (naziv || '').replace(/\s+/g, ' ').toLowerCase().trim();
    for (const zacetek of srrsMeje) {
        const konecSplosni = splosneMeje.find((idx) => idx > zacetek);
        const konec = konecSplosni !== undefined ? konecSplosni : besedilo.length;
        const odsek = besedilo.slice(zacetek, konec).trim();
        // Mora biti označena kot "Sprememba" (ne izvirna objava razpisa ali kaj drugega).
        if (!/^[^\n]*\n\s*Sprememb/i.test(odsek)) continue;

        const uvod = odsek.match(/produkt\w*\s*[–-]\s*(.+?),\s*št\.\s*([\d.\/-]+SRRS-\d+)/i);
        if (!uvod) continue;
        const nazivDel = uvod[1].replace(/\s+/g, ' ').toLowerCase();
        if (!nazivDel.includes(nazivL)) continue;

        // Navzkrižna preverba: če odsek vsebuje ŠE EN neodvisen zapis imena produkta (običajno
        // v stavku "Skupni razpisani znesek finančnega produkta <naziv> je/iz vira ..."), se
        // mora ujemati z istim nazivom. Uradni list, št. 108/2024 (SRRS-41) je znan izjemen
        // primer, kjer uvodni stavek napačno poimenuje "AGRO FI mladi", telo pa dejansko
        // govori o "AGRO FI mikro" — brez te preverbe bi napačnemu razpisu pripisali tujo
        // vsebino. V takem primeru odsek raje izpustimo (nadaljuj iskanje/vrni null), kot da
        // napačno pripišemo vsebino drugega produkta.
        const drugiZapis = odsek.match(/produkt\w*\s+(.+?)\s+(?:je|iz vira)[:\s]/i);
        if (drugiZapis) {
            const drugiNazivL = drugiZapis[1].replace(/\s+/g, ' ').toLowerCase();
            if (!drugiNazivL.includes(nazivL)) continue;
        }
        return odsek;
    }
    return null;
}

// Poišče povezave, katerih besedilo se ZAČNE z "Sprememba" (in oblike "Spremembe", "sprememba
// in dopolnitev" ipd. — enako preverjeno na vseh testnih straneh SRRS 25. 9. 2026) in vodijo na
// uradni-list.si. Ime datoteke UL PDF-jev je r<leto><3-mestna številka UL>.pdf.
export function najdiSpremembeLinke($, baseUrl) {
    const najdeno = [];
    $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href) return;
        let absUrl;
        try { absUrl = new URL(href, baseUrl).toString(); } catch { return; }
        if (!/uradni-list\.si/i.test(absUrl)) return;
        const tekst = ($(el).text() || '').trim();
        if (!/^sprememb/i.test(tekst)) return;
        const m = absUrl.match(/\/(\d{4})\/Ra\/r\d{4}(\d{3})\.pdf/i);
        if (!m) {
            log.warning(`[UL] Povezava "${tekst}" se začne s "Sprememba", a URL ni v pričakovani obliki UL PDF-ja: ${absUrl}`);
            return;
        }
        najdeno.push({ url: absUrl, tekst, leto: m[1], stevilka: String(parseInt(m[2], 10)) });
    });
    return najdeno;
}
