/**
 * Borzen — javni pozivi/razpisi za PRAVNE OSEBE (podjetja, občine) — scraper (Apify actor).
 *
 * Borzen nima enotne "seznam vseh razpisov" strani, zato je seznam vstopnih strani ročno
 * vzdrževan spodaj (`VSTOPNE_STRANI`). Vstopne strani sta DVE VRSTI:
 *
 *   1) STRAN POZIVA (`kazalo: false`) — sama je razpis; z nje preberemo naziv, besedilo,
 *      rok, sredstva in priponke.
 *   2) KAZALO (`kazalo: true`) — NI razpis, ampak samo našteva povezave do posameznih javnih
 *      pozivov (npr. /nepovratna-sredstva in /subvencije-za-hranilnike-elektricne-energije).
 *      Kazalo samo po sebi NE postane zapis v portalu — z njega preberemo povezave in zajamemo
 *      POSAMEZNE pozive.
 *
 * ZAKAJ (izmerjeno 17.–18. 8. 2026): prejšnja različica je obiskala samo trdo vpisane naslove
 * in NIKOLI ni sledila povezavam. Kazalo /nepovratna-sredstva ima 1.415 znakov splošnega opisa
 * družbe, posamezni pozivi pa 11.000+ znakov z vsebino poziva — portal je zato za osnutek
 * "vir=BORZEN, id 67" dobil samo uvodni odstavek in je bil povzetek pomanjkljiv.
 *
 * VZOREC SLEDENJA POVEZAVAM je prevzet po `rs-scraper` (edini v tem repozitoriju, ki dela
 * seznam → podrobne strani): najprej preberi seznamske strani in zberi povezave (z odstranjenimi
 * dvojniki), nato po vrsti odpri vsako podrobno stran in z nje potegni besedilo + priponke.
 * Crawlee/CheerioCrawler ni več potreben — plain fetch + cheerio je isti vzorec kot pri
 * rs-scraper, govsi-scraper in ekosklad-scraper (ena odvisnost manj).
 *
 * DVOJNIKI (portal ima ključ po `url`): borzen.si isti poziv postreže z več naslovov in med
 * njimi PREUSMERJA — npr. /podpore-za-mobilnost/subvencije-za-polnilne-parke-izven-omrezja-ten-t
 * preusmeri na /podpore-za-mobilnost/subvencije-za-polnilno-infrastrukturo-izven-omrezja-ten-t
 * (preverjeno 18. 8. 2026). Zato kot naslov zapisa VEDNO vpišemo KONČNI naslov po preusmeritvi
 * (`response.url`), ne naslova iz povezave, in vsak naslov obdelamo samo enkrat.
 *
 * OBSEG: zajemamo ODPRTE pozive. Povezav, ki so na kazalu izrecno označene kot zaključene
 * (arhiv), NE odpiramo — sicer bi vlekli cel Borzenov arhiv. Strani iz `VSTOPNE_STRANI` pa
 * obdelamo vedno; če je poziv medtem zaprt, dobi status "Zaprt" (in ne napačno "Odprt").
 * Sheme izključno za FIZIČNE OSEBE (e-kolesa, sončne elektrarne za gospodinjstva, hranilniki
 * za fizične osebe) so namenoma izpuščene — ta vir je v portalu vir za podjetja.
 *
 * Izhod (pogodba polj za razpisi.js genericniMapper): Naziv razpisa, URL, Status, Rok prijave,
 * Identifikator, Sredstva, Datum zaznave, Vsebina, Priloge.
 */
const { Actor, log } = require('apify');
const cheerio = require('cheerio');

const BAZA = 'https://borzen.si';

// Vsebina gre v razpisi_scrapani.aris_vsebina in je podlaga za povzetek — enaka meja kot pri
// rs-scraper (prej 1.500 znakov, kar je odrezalo predmet poziva in pogoje).
const NAJVEC_VSEBINA = 12000;

const VSTOPNE_STRANI = [
    // ── Zelene investicije ────────────────────────────────────────────────────
    { url: `${BAZA}/sl-si/podpore-za-zelene-investicije/spodbude-za-elektrointenzivna-podjetja`, naziv: 'Spodbude za elektrointenzivna podjetja' },
    // KAZALO: našteva JP-OVE-05 (odprt) in arhiv JP PS SUB-HEE-PO26, JP REPWR SUB-HEE-PO25,
    // JP-OVE-01/02/03/04. Ne postane zapis.
    { url: `${BAZA}/sl-si/podpore-za-zelene-investicije/nepovratna-sredstva`, naziv: 'Subvencije za investicije v OVE za pravne osebe', kazalo: true },
    { url: `${BAZA}/sl-si/podpore-za-zelene-investicije/subvencije-za-proizvodnjo-elektrike-iz-soncne-energije-in-hranilnike-jp-ove-05`, naziv: 'JP-OVE-05 — samooskrbne sončne elektrarne do 1 MW' },
    // KAZALO: našteva tri pozive (fizične osebe + dva zaključena za pravne osebe). Ne postane zapis.
    { url: `${BAZA}/sl-si/podpore-za-zelene-investicije/subvencije-za-hranilnike-elektricne-energije`, naziv: 'Subvencije za hranilnike električne energije', kazalo: true },
    { url: `${BAZA}/sl-si/podpore-za-zelene-investicije/subvencije-za-hranilnike-elektricne-energije/subvencije-za-hranilnike-elektricne-energije-2026`, naziv: 'JP PS SUB-HEE-PO26 — hranilniki električne energije 2026' },
    { url: `${BAZA}/sl-si/podpore-za-zelene-investicije/subvencije-za-hranilnike-elektricne-energije/subvencije-za-hranilnike-elektricne-energije-za-pravne-osebe`, naziv: 'JP REPWR SUB-HEE-PO25 — hranilniki električne energije za pravne osebe' },
    // ── Mobilnost ─────────────────────────────────────────────────────────────
    { url: `${BAZA}/sl-si/podpore-za-mobilnost/subvencije-za-nakup-elektricnih-polnilnih-mest-za-ev-2026`, naziv: 'Subvencije za EV polnilna mesta 2026' },
    { url: `${BAZA}/sl-si/podpore-za-mobilnost/subvencije-za-polnilne-parke-ob-omrezju-ten-t`, naziv: 'Subvencije za polnilne parke ob omrežju TEN-T' },
    { url: `${BAZA}/sl-si/podpore-za-mobilnost/subvencije-za-polnilno-infrastrukturo-izven-omrezja-ten-t`, naziv: 'Subvencije za polnilno infrastrukturo izven omrežja TEN-T' },
    { url: `${BAZA}/sl-si/podpore-za-mobilnost/subvencije-za-tovorni-promet/javni-razpis-zelena-tovorna-logistika`, naziv: 'Javni razpis — Zelena tovorna logistika' },
    { url: `${BAZA}/sl-si/podpore-za-mobilnost/subvencije-za-tovorni-promet/subvencije-za-okolju-prijaznejse-prevoznistvo-2026`, naziv: 'Subvencije za okolju prijaznejše prevozništvo 2026' },
    { url: `${BAZA}/sl-si/podpore-za-mobilnost/subvencije-za-okolju-prijaznejse-avtobuse`, naziv: 'Subvencije za okolju prijaznejše avtobuse' },
];

// ─── Pomožne funkcije ────────────────────────────────────────────────────────

const cist = (t) => String(t || '').replace(/\s+/g, ' ').trim();

function danes() {
    return new Date().toISOString().substring(0, 10);
}

// Isti poziv se pojavi pod naslovom z/brez končne poševnice, s sidrom ali z velikimi črkami v
// gostitelju. Za primerjavo (in za zapis v portal) uporabimo eno samo obliko.
function normalizirajUrl(u) {
    try {
        const url = new URL(u);
        url.hash = '';
        url.hostname = url.hostname.toLowerCase();
        url.pathname = url.pathname.replace(/\/+$/, '') || '/';
        return url.href;
    } catch {
        return String(u || '').trim();
    }
}

async function preberi(url) {
    const r = await fetch(url, {
        // Brez User-Agenta borzen.si občasno vrne strojno stran; enak vzorec kot ostali scraperji.
        headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (compatible; RazpisnikBot/1.0; +https://razpis.eu)' },
    });
    if (!r.ok) throw new Error(`Borzen HTTP ${r.status} za ${url}`);
    const html = await r.text();
    // r.url = KONČNI naslov po preusmeritvi — to je naslov, pod katerim zapis vpišemo v portal.
    return { $: cheerio.load(html), koncniUrl: normalizirajUrl(r.url || url) };
}

// Zaključek poziva Borzen zapiše kot obvestilo v besedilu ("Oddaja vlog od 19. 5. 2026 ni več
// mogoča", "Javni razpis je zaključen", "javni poziv je ZAKLJUČEN") — enotnega statusnega polja
// stran nima. Vzorci so preverjeni na vseh 12 straneh 18. 8. 2026.
// POZOR: "Po zaključku zbiranja vlog sledi formalni preizkus" stoji tudi na zaprtih straneh in
// se namenoma NE uporablja kot znak — lovimo samo eksplicitne oblike spodaj.
const VZORCI_ZAPRT = [
    /ni\s+ve[čc]\s+mogo[čc]/i,                                  // "oddaja vlog ... ni več mogoča"
    /javni\s+(poziv|razpis)\s+(?:je\s+)?zaklju[čc]en/i,          // "javni poziv je ZAKLJUČEN"
    /javni\s+(poziv|razpis)[^.]{0,80}\sje\s+zaklju[čc]en/i,      // "Javni razpis za ... je zaključen"
    /(poziv|razpis)\s+se\s+je[^.]{0,40}zaklju[čc]il/i,           // "Javni razpis se je 14. 8. 2026 zaključil"
    /obvestilo\s+o\s+zaklju[čc]ku\s+javnega/i,                   // "Obvestilo o zaključku javnega poziva"
    /rok[^.]{0,40}\s(je\s+)?potekel/i,
];

function jeZaprt(besedilo) {
    return VZORCI_ZAPRT.some((v) => v.test(besedilo));
}

// ── Rok oddaje ───────────────────────────────────────────────────────────────
// Besedilo poziva je polno datumov, ki NISO rok za oddajo vloge (rok za zaključek naložbe,
// obdobje upravičenosti stroškov, datum ODPRTJA vlog). Prosto iskanje "do <datum>" je zato
// vračalo napačne roke (izmerjeno 18. 8. 2026: TEN-T je dobil 30. 10. 2027 = rok za zaključek
// projekta, avtobusi 15. 11. 2028 = rok za zaključek naložbe). Zato veljajo TRIJE pogoji hkrati:
//   1) datum mora stati za predlogom "do" (ne "od" — "od 10. 4. 2026" je datum odprtja),
//   2) v 220 znakih pred njim mora biti izraz o ODDAJI VLOGE (SIDRO_ROK),
//   3) v istem oknu ne sme biti izraza o stroških/zaključku naložbe (PROTISIDRO_ROK).
// Če pogoji niso izpolnjeni, pustimo prazno — narobe zapisan rok je slabši od praznega.
const SIDRO_ROK = /(rok\s+za\s+(?:oddajo|predlo[žz]itev|prejem)\s+vlog|vlog\w*\s+(?:se\s+lahko\s+(?:vlo[žz]i|odda)|lahko\s+vlo[žz]ijo)|oddaja\s+vlog\w*\s+(?:je|bo)?\s*(?:mogo[čc]a|mo[žz]na)|vlog\w*[^.]{0,60}?\s(?:je|bo)\s+mogo[čc]e\s+oddati|vloge?\s+sprejemamo)/i;
const PROTISIDRO_ROK = /(stro[šs]k|izdatk|upravi[čc]en|zaklju[čc]|nalo[žz]b|izpla[čc]il|obratovanj|priklop|projekt\s+mora)/i;
// Borzenovi pozivi brez fiksnega roka tečejo "do porabe sredstev" oziroma "do dneva objave
// zaključka javnega poziva" — obojе pomeni isto in se zapiše kot besedilo, ne kot datum.
const DO_PORABE = /do\s+porabe\s+(?:razpolo[žz]ljivih\s+)?sredstev|do\s+dneva\s+objave\s+zaklju[čc]ka\s+javnega\s+poziva/i;

// Konkreten datum roka za oddajo vloge; null, če ga na strani ni (ali ni zanesljivo določljiv).
function najdiRokDatum(besedilo) {
    for (const m of besedilo.matchAll(/\bdo\s+(?:vklju[čc]no\s+)?(\d{1,2}\.\s?\d{1,2}\.\s?\d{4})/g)) {
        const okno = besedilo.slice(Math.max(0, m.index - 220), m.index);
        if (SIDRO_ROK.test(okno) && !PROTISIDRO_ROK.test(okno)) return m[1].replace(/\s/g, '');
    }
    return null;
}

// "15.7.2026" -> je rok že mimo?
function rokJeMimo(rok) {
    const m = String(rok || '').match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (!m) return false;
    return new Date(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T23:59:59`) < new Date();
}

// ── Razpoložljiva sredstva ───────────────────────────────────────────────────
// Prvi znesek na strani je skoraj vedno NAPAČEN (izmerjeno 18. 8. 2026: pri JP-OVE-05 je to
// meja de minimis 300.000 EUR, pri TEN-T najvišji znesek NA VLOGO 2.000.000 EUR, pri zeleni
// logistiki 10.000 EUR na polnilno mesto). Zato vzamemo samo znesek, pred katerim je v 200
// znakih izrecna navedba razpoložljivih sredstev; sicer pustimo prazno. (Okno 280 znakov je
// izmerjeno: pri 200 je izpadel podatek za Zeleno tovorno logistiko, pri 350 ni bilo več
// nobenega novega zadetka, napačnih pa tudi ne.)
const SIDRO_SREDSTVA = /(razpolo[žz]ljiv\w*\s+sredstv|sredstev,?\s+ki\s+(?:so|je|jih)\s+(?:na\s+razpolago|na\s+voljo)|skupn\w*\s+(?:vi[šs]ina|znesek)\s+(?:razpisanih\s+)?sredstev|vi[šs]ina\s+razpisanih\s+sredstev|okvirn\w*\s+vi[šs]ina\s+sredstev)/i;
const ZNESEK = /([\d.]{4,}(?:,\d+)?|\d+(?:[.,]\d+)?\s*(?:milijon\w*|mio))\s*(?:EUR|€|evrov|evra)/gi;

function najdiSredstva(besedilo) {
    for (const m of besedilo.matchAll(ZNESEK)) {
        const okno = besedilo.slice(Math.max(0, m.index - 280), m.index);
        if (SIDRO_SREDSTVA.test(okno)) return cist(m[0]);
    }
    return null;
}

// Oznaka poziva — Borzen jo na strani poziva vedno zapiše v oklepaju: "(oznaka: JP-OVE-05)".
function najdiOznako(besedilo) {
    const m = besedilo.match(/oznaka:?\s*([A-ZČŠŽ][A-ZČŠŽ0-9][A-ZČŠŽ0-9 \-\/.]{1,30}?)\s*\)/);
    return m ? cist(m[1]) : null;
}

// Vsebinsko območje strani. Borzen teče na DNN — vsebina je v #dnn_ContentPane, VSE ostalo
// (glavna navigacija, stranski meni, orodna vrstica za dostopnost, noga) je na vsaki strani
// ENAKO in bi v besedilu prekrilo dejansko vsebino poziva.
function vsebinskiDel($) {
    const cp = $('#dnn_ContentPane');
    if (cp.length && cist(cp.text()).length > 100) return cp;
    const main = $('main');
    if (main.length) return main;
    return $('body');
}

// ─── Kazalo: povezave do posameznih javnih pozivov ───────────────────────────

// Povezave, ki niso javni poziv (seznami prejemnikov, vloge, prijavni portali, dokumenti).
const NI_POZIV = /seznam-prejemnikov|javni-pozivi-in-razpisi|\/sl-?si\/?$|\.(pdf|docx?|xlsx?|zip)(\?|$)/i;
// Sheme izključno za fizične osebe — ta vir je v portalu namenjen podjetjem.
const FIZICNE_OSEBE = /fizi[čc]n\w*\s+oseb|gospodinjstv|e-koles|elektri[čc]n\w*\s+koles/i;

/**
 * Prebere kazalo in vrne povezave do posameznih pozivov.
 * Status povezave se izpelje iz DVEH mest, ker ju Borzen uporablja izmenično:
 *   a) naslova nad seznamom ("Oddaja vlog ... je trenutno možna na naslednje javne pozive:" /
 *      "Javni pozivi, na katere oddaja vlog zaradi porabe sredstev ni več mogoča:"),
 *   b) pripisa ob sami povezavi ("... - javni poziv je ZAKLJUČEN").
 */
function povezaveIzKazala($, izvorniUrl) {
    const najdene = [];
    let statusSklopa = null; // status, ki velja za seznam pod zadnjim prebranim naslovom

    vsebinskiDel($).find('h2, h3, h4, h5, h6, li').each((_, el) => {
        const $el = $(el);
        const tag = String(el.tagName || '').toLowerCase();
        const besedilo = cist($el.text());

        if (tag !== 'li') {
            // Naslov sklopa — nastavi privzeti status za povezave, ki sledijo.
            if (jeZaprt(besedilo) || /porab\w*\s+sredstev/i.test(besedilo)) statusSklopa = 'Zaprt';
            else if (/mogo[čc]|odprt|aktualn/i.test(besedilo)) statusSklopa = 'Odprt';
            return;
        }

        const a = $el.find('a[href]').first();
        const href = cist(a.attr('href'));
        if (!href || /^(tel:|mailto:|#|javascript:)/i.test(href)) return;

        let absolutni;
        try {
            absolutni = normalizirajUrl(new URL(href, izvorniUrl).href);
        } catch {
            return;
        }
        // Ostanemo znotraj Borzena (ove.borzen.si ipd. je še vedno Borzen, tuje domene ne).
        if (!/(^|\.)borzen\.si$/i.test(new URL(absolutni).hostname)) return;
        if (NI_POZIV.test(absolutni)) return;
        if (absolutni === normalizirajUrl(izvorniUrl)) return;

        const nazivPovezave = cist(a.text());
        if (FIZICNE_OSEBE.test(nazivPovezave) || FIZICNE_OSEBE.test(besedilo) || /-za-fizicne-osebe/i.test(absolutni)) {
            log.info(`  [kazalo] preskočeno (fizične osebe): ${nazivPovezave}`);
            return;
        }

        // Pripis ob povezavi prevlada nad statusom sklopa.
        const status = jeZaprt(besedilo) ? 'Zaprt' : (statusSklopa || 'Odprt');
        najdene.push({ url: absolutni, naziv: nazivPovezave, status });
    });

    return najdene;
}

// ─── Podrobna stran posameznega poziva ───────────────────────────────────────

function podrobnosti($, url, namigStatusa) {
    const del = vsebinskiDel($);
    del.find('script, style, noscript').remove();

    const naziv = cist($('h1').first().text()) || cist(del.find('h2').first().text());
    const besedilo = cist(del.text());

    const priloge = [];
    del.find('a[href]').each((_, el) => {
        const h = cist($(el).attr('href'));
        if (!h || !/\.(pdf|docx?|xlsx?)(\?|$)/i.test(h)) return;
        try {
            priloge.push(new URL(h, url).href);
        } catch { /* neveljaven naslov priponke — preskoči */ }
    });

    // Status: eksplicitno obvestilo o zaključku na strani prevlada, nato namig s kazala, nato
    // pretekli rok oddaje. Borzen namreč obvestila o zaključku ne objavi vedno — JP EI 2026 je
    // 18. 8. 2026 še vedno izgledal odprt, čeprav je bil rok za oddajo vlog 15. 7. 2026.
    const rokDatum = najdiRokDatum(besedilo);
    let status = jeZaprt(besedilo) || namigStatusa === 'Zaprt' ? 'Zaprt' : 'Odprt';
    if (status === 'Odprt' && rokJeMimo(rokDatum)) status = 'Zaprt';

    // "do porabe sredstev" zapišemo SAMO pri odprtih — pri zaprtem pozivu bi bila taka navedba
    // zavajajoča (pravilo o roku po virih).
    const rok = rokDatum || (status === 'Odprt' && DO_PORABE.test(besedilo) ? 'do porabe sredstev' : null);

    return {
        naziv,
        status,
        besedilo,
        rok,
        sredstva: najdiSredstva(besedilo),
        oznaka: najdiOznako(besedilo),
        priloge: [...new Set(priloge)].slice(0, 20),
    };
}

// ─── Zagon ───────────────────────────────────────────────────────────────────

Actor.main(async () => {
    const zaznano = danes();

    // 1) Sestavi seznam strani, ki jih je treba odpreti kot POZIV.
    //    Vstopne strani, ki niso kazalo, gredo vanj neposredno; s kazal preberemo povezave.
    const zaObdelavo = new Map(); // normaliziran url -> { url, naziv, status }
    const dodaj = (z) => { if (!zaObdelavo.has(z.url)) zaObdelavo.set(z.url, z); };

    for (const s of VSTOPNE_STRANI) {
        if (!s.kazalo) { dodaj({ url: normalizirajUrl(s.url), naziv: s.naziv, status: null }); continue; }

        try {
            const { $, koncniUrl } = await preberi(s.url);
            const povezave = povezaveIzKazala($, koncniUrl);
            // Samopreverba (pravilo "merilo mora najti znani zadetek"): kazalo BREZ povezav pomeni,
            // da se je struktura strani spremenila — to mora biti glasno, ne tiho nič.
            if (!povezave.length) {
                log.error(`KAZALO BREZ POVEZAV: ${s.url} — struktura strani se je verjetno spremenila, poglej scraper.`);
            }
            for (const p of povezave) {
                if (p.status === 'Zaprt') {
                    // Arhiv namenoma ne odpiramo — zajemamo odprte pozive.
                    log.info(`  [kazalo] preskočen zaključen poziv: ${p.naziv} (${p.url})`);
                    continue;
                }
                log.info(`  [kazalo] najden poziv: ${p.naziv} (${p.url})`);
                dodaj(p);
            }
            log.info(`Kazalo ${s.url}: ${povezave.length} povezav (odprtih ${povezave.filter((p) => p.status !== 'Zaprt').length}).`);
        } catch (e) {
            // Eno nedosegljivo kazalo ne sme podreti celega zagona — portal ima varovalko pred
            // nenadnim upadom števila zapisov, zato je delen izid varen.
            log.error(`Kazala ni bilo mogoče prebrati (${s.url}): ${e.message}`);
        }
        await new Promise((res) => setTimeout(res, 300));
    }

    // 2) Odpri vsako stran poziva in preberi vsebino.
    const izhod = [];
    const obdelani = new Set(); // končni naslovi po preusmeritvi — varovalka pred dvojniki
    for (const z of zaObdelavo.values()) {
        try {
            const { $, koncniUrl } = await preberi(z.url);
            if (obdelani.has(koncniUrl)) {
                log.info(`Preskočen dvojnik (preusmeritev na že zajeti naslov): ${z.url} -> ${koncniUrl}`);
                continue;
            }
            obdelani.add(koncniUrl);

            const d = podrobnosti($, koncniUrl, z.status);
            izhod.push({
                'Naziv razpisa': d.naziv || z.naziv || 'Neznan naziv',
                URL: koncniUrl,
                Status: d.status,
                'Rok prijave': d.rok,
                Identifikator: d.oznaka,
                Sredstva: d.sredstva,
                'Datum zaznave': zaznano,
                Vsebina: d.besedilo.substring(0, NAJVEC_VSEBINA),
                Priloge: d.priloge,
            });
            log.info(`Zajeto: ${d.naziv} — ${d.status} (${d.besedilo.length} znakov, ${d.priloge.length} priponk)`);
        } catch (e) {
            log.error(`Strani ni bilo mogoče prebrati (${z.url}): ${e.message}`);
        }
        await new Promise((res) => setTimeout(res, 300));
    }

    const odprtih = izhod.filter((r) => r.Status === 'Odprt').length;
    log.info(`Zapisujem ${izhod.length} zapisov (odprtih ${odprtih}, zaprtih ${izhod.length - odprtih}).`);
    if (izhod.length) await Actor.pushData(izhod);
});
