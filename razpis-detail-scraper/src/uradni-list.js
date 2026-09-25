// Uradni list: branje PDF-ja in izrez spremembe posameznega razpisa (25. 9. 2026, popravljeno
// po nasprotnem pregledu 25. 9. 2026 — glej opombe pri posameznih popravkih spodaj).
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
// funkcija je preizkušena ROČNO na dejanskih številkah UL (glej poročilo naloge in poročilo
// nasprotnega pregleda — 16 številk UL, brez napak), ker zahteva binarne PDF datoteke, ki niso
// del repozitorija.
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

function normaliziraj(t) {
    return (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Preveri, ali se "nazivL" v "nazivDel" pojavi kot CEL naziv, ne kot podniz DALJŠEGA imena —
// za njim mora slediti meja (konec niza, vejica, "ter"/"in" pred zadnjim naštetim produktom,
// ali "št."). BREZ tega bi iskanje "BIZI Krožno" pobralo spremembo za "BIZI Krožno Obmejna"
// (izmerjeno pri nasprotnem pregledu 25. 9. 2026 — .includes() je pravi podniz sprejel kot
// ujemanje). "ter"/"in" sta potrebna, ker SRRS eno spremembo pogosto objavi SKUPAJ za več
// produktov naenkrat ("AGRO PF, BIZI PF, LOKALNO PF ter NVO PF") — brez teh dveh besed kot
// veljavne meje bi zavrnili ravno predzadnji produkt v seznamu (izmerjeno: "LOKALNO PF (2024)"
// je bil edini od 16 strani s spremembami, ki ni dobil NITI ENE — vseh 5 njegovih sprememb je
// bilo objavljenih izključno v takih skupnih seznamih).
function celNazivUjema(nazivDel, nazivL) {
    if (!nazivL) return false;
    const i = nazivDel.indexOf(nazivL);
    if (i === -1) return false;
    const zaNjim = nazivDel.slice(i + nazivL.length);
    return zaNjim === '' || /^\s*(,|ter\b|in\b|št\.)/i.test(zaNjim);
}

// Poišče meje MED VSEMI objavami v tej številki UL (katerekoli agencije, ne le SRRS) — vsaka
// objava ima svojo zaporedno številko "Ob-<st>/<leto>".
//
// POPRAVEK (nasprotni pregled 25. 9. 2026): kadar prejšnja objava nima zaključnega stavka
// (samo tabela/kratek sklep brez podpisa), se njen zadnji del ZLEPI z glavo naslednje objave
// NA ISTO fizično vrstico PDF-ja (npr. "... znižanja do porabe sredstev Št. 3301-1/2023-SRRS-53
// Ob-3539/24" — potrjeno v Uradnem listu, št. 108/2024). Meja, ki bi bila na ZAČETKU cele
// vrstice, bi tedaj odrezala "znižanja do porabe sredstev" od prejšnje objave. Kadar glava
// vsebuje "Št. <oznaka> Ob-...", je meja zato na ZAČETKU "Št.", ne na začetku fizične vrstice.
// Glave BREZ "Št." (golo ime agencije ali sam "Ob-...") ostanejo vezane na začetek vrstice —
// v vseh doslej pregledanih primerih (16 številk UL) so bile taka vedno samostojna vrstica.
function najdiSplosneMeje(besedilo) {
    const meje = new Set();
    const ZGLAVJE_S_ST = /Št\.\s+\S+\s+Ob-\d+\/\d{2}\.?/g;
    let m;
    while ((m = ZGLAVJE_S_ST.exec(besedilo)) !== null) meje.add(m.index);

    const ZGLAVJE_BREZ_ST = /^([^\n]{0,100})(Ob-\d+\/\d{2}\.?)\s*$/gm;
    while ((m = ZGLAVJE_BREZ_ST.exec(besedilo)) !== null) {
        // Če vrstica že vsebuje natančnejši vzorec ZGLAVJE_S_ST, ta (zgoraj) že daje pravo
        // mejo — cela vrstica lahko vsebuje še rep PREJŠNJE objave pred glavo (glej opombo
        // zgoraj), zato se v tem primeru ne uporabi meja na začetku cele vrstice.
        if (/Št\./i.test(m[1])) continue;
        meje.add(m.index);
    }
    return [...meje].sort((a, b) => a - b);
}

// Čista funkcija — znotraj CELOTNE številke UL poišče SAMO odsek, ki se nanaša na TA razpis.
//
// PRIMARNO merilo (nasprotni pregled 25. 9. 2026): TOČNO ujemanje uradne oznake razpisa
// (`oznakaRazpisa`, npr. "3301-1/2024-SRRS-23"), izluščene iz že prebranega razpisnega
// dokumenta ali citata na strani (glej poisciOznakoRazpisa v main.js). Prejšnja različica je
// oznako izluščila, a je NI uporabila za ujemanje — samo naziv kot podniz, kar je "BIZI Krožno"
// pomotoma ujelo s spremembo za "BIZI Krožno Obmejna".
//
// REZERVA, kadar oznake ni bilo mogoče določiti: ujemanje SAMO po CELEM nazivu (glej
// celNazivUjema) — brez ujemanja niti oznake niti celega naziva se NIČ ne doda (raje nič kot
// tuja objava).
export function izrezSpremembo(besedilo, naziv, oznakaRazpisa) {
    const splosneMeje = najdiSplosneMeje(besedilo);

    // \s* pred "SRRS": oznaka je lahko prelomljena čez vrstico PDF-ja tik pred "SRRS-NN"
    // (npr. "3301-1/2024-\nSRRS-28", potrjeno v Uradnem listu, št. 39/2025) — brez tega bi
    // znak razred [\d.\/-] (ki \n ne vsebuje) prelom ustavil in cela objava ne bi bila najdena.
    const MEJA_SRRS = /(?:Št\.\s+)?[\d.\/-]+\s*SRRS-\d+\s+Ob-\d+\/\d+/g;
    const srrsMeje = [];
    let m;
    while ((m = MEJA_SRRS.exec(besedilo)) !== null) srrsMeje.push(m.index);
    if (srrsMeje.length === 0) return null;

    // Naslov strani ima lahko letnico v oklepaju ("NVO PF (2024)", "AGRO PF (2024)"), ki je v
    // Uradnem listu ni — odstrani pred primerjavo (nasprotni pregled 25. 9. 2026).
    const nazivBrezLeta = (naziv || '').replace(/\s*\(\d{4}\)\s*$/, '');
    const nazivL = normaliziraj(nazivBrezLeta);

    for (const zacetek of srrsMeje) {
        const konecSplosni = splosneMeje.find((idx) => idx > zacetek);
        const konec = konecSplosni !== undefined ? konecSplosni : besedilo.length;
        const odsek = besedilo.slice(zacetek, konec).trim();
        // Mora biti označena kot "Sprememba" (ne izvirna objava razpisa ali kaj drugega).
        if (!/^[^\n]*\n\s*Sprememb/i.test(odsek)) continue;

        // 's' (dotall): naziv produkta se lahko lomi čez vrstico PDF-ja ("– BIZI\nOPO Turizem
        // ter BIZI Turizem") — brez dotall "." ne bi segel čez prelom in ujemanja sploh ne bi bilo.
        const uvod = odsek.match(/produkt\w*\s*[–-]\s*(.+?),\s*št\.\s*([\d.\/-]+\s*SRRS-\d+)/is);
        if (!uvod) continue;
        // Odstrani morebiten presledek/prelom vrstice, ki ga je uvod dopustil ZNOTRAJ oznake
        // same (glej opombo pri MEJA_SRRS) — za primerjavo mora biti oznaka strnjena.
        const oznakaOdseka = uvod[2].replace(/\s+/g, '');

        if (oznakaRazpisa) {
            // Oznaka je formalna referenca, manj podvržena napakam kot prosto besedilo naziva
            // v uvodnem stavku — ko se ujema, ji zaupamo (naziv je le "dodatna preverba" in ne
            // more preglasiti pravilne oznake).
            if (oznakaOdseka !== oznakaRazpisa) continue;
        } else {
            const nazivDel = normaliziraj(uvod[1]);
            // Prelom naziva čez vrstico PDF-ja ("– BIZI\nOPO Turizem ter BIZI Turizem") je
            // normaliziraj() že pretvoril v presledek, zato primerjava deluje ne glede na prelom.
            if (!celNazivUjema(nazivDel, nazivL)) continue;

            // Navzkrižna preverba SAMO na rezervni poti (brez znane oznake): če odsek vsebuje
            // ŠE EN neodvisen zapis imena produkta (navadno v stavku "Skupni razpisani znesek
            // finančnega produkta <naziv> je/iz vira ..."), se mora ujemati z istim nazivom.
            // Uradni list, št. 108/2024 (SRRS-41) je znan izjemen primer, kjer uvodni stavek
            // napačno poimenuje "AGRO FI mladi", telo pa dejansko govori o "AGRO FI mikro" —
            // brez te preverbe bi na rezervni poti (brez oznake) napačnemu razpisu pripisali
            // tujo vsebino.
            // Vzorec MORA vsebovati "znesek finančnega produkt..." (ne katero koli drugo
            // pojavitev besede "produkt", npr. iz uvodnega stavka "... za finančni produkt –
            // <naziv>, št. ...") — sicer bi .match() vrnil PRVO pojavitev in zajel ves tekst
            // med njo in dejansko drugo omembo, kar je nekoč napačno vsebovalo OBA naziva
            // hkrati in preverbo naredilo neučinkovito.
            const drugiZapis = odsek.match(/znesek\s+finančnega\s+produkt\w*\s+(.+?)\s+(?:je\b|iz vira)/is);
            if (drugiZapis) {
                const drugiNazivL = normaliziraj(drugiZapis[1]);
                if (drugiNazivL !== nazivL && !celNazivUjema(drugiNazivL, nazivL)) continue;
            }
        }
        return odsek;
    }
    return null;
}

// Poišče URADNO OZNAKO tega razpisa (npr. "3301-1/2024-SRRS-23") med že prebranimi dokumenti
// strani — dokument "javni razpis"/"javni poziv" vedno v uvodu navede svojo lastno oznako.
// Brez dodatnega omrežnega klica (dokumenti so že prebrani za drug namen). Vrne null, če
// oznake ni bilo mogoče najti nikjer — takrat izrezSpremembo pade na rezervno pot (cel naziv).
export function poisciOznakoRazpisa(prebranaBesedila) {
    // \s* pred "SRRS": glej opombo pri MEJA_SRRS v izrezSpremembo — enak prelom vrstice se
    // lahko pojavi tudi v tem, ločeno prebranem dokumentu.
    const RE = /\d{2,4}[.\/-]\d{1,3}\/\d{4}-\s*SRRS-\d+/;
    const prioritetni = [];
    const ostali = [];
    for (const d of prebranaBesedila || []) {
        const oznacba = (d?.l?.klasifikacija || d?.l?.tekst || '');
        if (/javni.?razpis|javni.?poziv/i.test(oznacba)) prioritetni.push(d);
        else ostali.push(d);
    }
    for (const d of [...prioritetni, ...ostali]) {
        const m = (d.cisto || '').match(RE);
        if (m) return m[0].replace(/\s+/g, '');
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

// Prenese in izreže EN dokument spremembe za dani razpis — NIKOLI ne vrže naprej. Vsaka napaka
// (izpad omrežja, časovna omejitev, prevelika datoteka, neveljaven PDF, brez ujemanja) se
// ZABELEŽI kot rezultat (napaka: <opis>) in korak se PRESKOČI; zajem CELOTNEGA razpisa teče
// naprej z vsemi drugimi dokumenti.
//
// NAJHUJŠA NAPAKA, POPRAVLJENA PO NASPROTNEM PREGLEDU 25. 9. 2026: prenos (fetch/arrayBuffer)
// je bil PREJ zunaj try/catch — ob izpadu uradni-list.si je zajem CELOTNEGA razpisa padel (3
// ponovitve, "Ni rezultata"), čeprav bi zajem brez sprememb uspel. Dokazano s preizkusom
// uradni-list.test.js (nadomestek, ki vrže napako, in nadomestek, ki nikoli ne odgovori — glej
// spodaj `casovnaOmejitevMs`, privzeto 30 s prek AbortSignal.timeout).
export async function preberiSpremembo(s, naziv, oznakaRazpisa, opcije = {}) {
    const { fetchImpl = fetch, casovnaOmejitevMs = 30000, maxBajtov = 15 * 1024 * 1024 } = opcije;
    const nazivPovezave = (s.tekst || '').replace(/[.,]\s*$/, ''); // "Sprememba št. 6," -> "Sprememba št. 6"
    const oznakaUL = `${nazivPovezave} (Uradni list RS, št. ${s.stevilka}/${s.leto})`;
    try {
        const pdfR = await fetchImpl(s.url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(casovnaOmejitevMs),
        });
        if (!pdfR.ok) return { oznakaUL, napaka: `HTTP ${pdfR.status}` };
        const pdfBuffer = Buffer.from(await pdfR.arrayBuffer());
        if (pdfBuffer.length > maxBajtov) return { oznakaUL, napaka: `Preveliko (${pdfBuffer.length} B)` };
        const besedilo = await pretvoriUradniListPdf(pdfBuffer);
        const odsek = izrezSpremembo(besedilo, naziv, oznakaRazpisa);
        if (!odsek) return { oznakaUL, napaka: 'ujemajočega odseka ni (raje nič kot tuja objava)' };
        return { oznakaUL, odsek };
    } catch (e) {
        return { oznakaUL, napaka: e.message };
    }
}
