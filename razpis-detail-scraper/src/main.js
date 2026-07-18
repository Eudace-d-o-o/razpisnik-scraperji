/**
 * Razpis Detail Scraper
 * Input: { url, vir }
 * Output: { url, naziv, vsebina, meta } v datasetu
 *
 * Razpisni pogoji (velikost podjetja, kohezijska regija, izključeni stroški...)
 * so pri SPS in ARIS skoraj vedno v priloženih PDF dokumentih (razpisna dokumentacija,
 * posebni pogoji), ne na sami HTML strani. Scraper zato poišče vse PDF linke na strani,
 * jih prenese in izvleče besedilo, ter ga združi z HTML vsebino.
 */

import { Actor } from 'apify';
import { CheerioCrawler, log } from 'crawlee';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import * as cheerio from 'cheerio';

await Actor.init();

const input = await Actor.getInput();
const url = input?.url;
const vir = input?.vir || 'SPS';
// Hitri način "samo spletna stran" — brez prenosa/branja PDF/Word dokumentov. Uporablja
// ga portal za ciljano dopolnjevanje manjkajočih polj (npr. rok oddaje), ko je uporabnik
// že ročno naložil razpisno dokumentacijo in dodatno branje istih/drugih dokumentov ni
// potrebno — samo pospeši scraping in zmanjša količino besedila poslanega Claude-u.
const preskociPdf = !!input?.preskociPdf;

if (!url) {
    log.error('Manjka URL v inputu');
    await Actor.exit();
}

log.info(`[Detail] Scraping: ${url} (${vir})`);

let rezultat = null;

// ─── Pomožna funkcija: prenesi in razčleni PDF ali Word dokument ──────────────
async function prebrDokument(docUrl) {
    try {
        const r = await fetch(docUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!r.ok) { log.warning(`[Dokument] HTTP ${r.status} za ${docUrl}`); return ''; }
        const ct = (r.headers.get('content-type') || '').toLowerCase();
        const lower = docUrl.toLowerCase();
        const jePdf = ct.includes('pdf') || lower.endsWith('.pdf');
        const jeDocx = ct.includes('officedocument.wordprocessingml') || lower.endsWith('.docx');
        const jeDoc = ct.includes('msword') || lower.endsWith('.doc');
        if (!jePdf && !jeDocx && !jeDoc) return '';

        const buffer = Buffer.from(await r.arrayBuffer());
        if (buffer.length > 15 * 1024 * 1024) { log.warning(`[Dokument] Preveliko (${buffer.length} B): ${docUrl}`); return ''; }

        if (jePdf) {
            // pdf-parse v2 API: razred PDFParse, ne funkcija (v1 je bila funkcija, v2 ni).
            const parser = new PDFParse({ data: buffer });
            const data = await parser.getText();
            await parser.destroy();
            log.info(`[PDF] OK ${docUrl} — ${data.text.length} znakov`);
            return data.text || '';
        }
        if (jeDocx) {
            const result = await mammoth.extractRawText({ buffer });
            log.info(`[DOCX] OK ${docUrl} — ${result.value.length} znakov`);
            return result.value || '';
        }
        // Staro .doc binarno ni podprto z mammoth — preskoči
        log.warning(`[Dokument] .doc format ni podprt (samo .docx): ${docUrl}`);
        return '';
    } catch (e) {
        log.warning(`[Dokument] Napaka pri ${docUrl}: ${e.message}`);
        return '';
    }
}


// Preprosta pravilna klasifikacija po besedilu povezave — glej pogovor z uporabnikom
// 2026-07-16: "vzameš naslov povezave, npr. če je Javni razpis daš klasifikacijo javni razpis,
// če je zavarovanje daš zavarovanje itd." Znane vzorce prepoznamo, sicer klasifikacija = počiščeno
// besedilo same povezave (vedno nekaj vrnemo, nikoli null).
function klasificirajPovezavo(tekst) {
    const t = (tekst || '').toLowerCase();
    if (/pojasnil/.test(t)) return 'pojasnila';
    if (/razpisna.?dokumentacij/.test(t)) return 'razpisna dokumentacija';
    if (/\bannex\b/.test(t)) return 'annex';
    if (/javni.?razpis/.test(t)) return 'javni razpis';
    if (/tock|meril.{0,15}ocenj/.test(t)) return 'točkovnik';
    if (/zavarovanj/.test(t)) return 'zavarovanje';
    if (/pogodb/.test(t)) return 'pogodba';
    if (/obrazec/.test(t)) return 'obrazec';
    if (/izjav[ae]/.test(t)) return 'izjava';
    if (/prijavni.?list|^vloga\b/.test(t)) return 'prijavni obrazec';
    if (/navodil/.test(t)) return 'navodila';
    if (/posebni.?pogoj|^pogoj/.test(t)) return 'posebni pogoji';
    const ocisceno = (tekst || '').trim().substring(0, 100);
    return ocisceno || 'dokument';
}

// Poišče VSE PDF/Word povezave na strani (brez izločanja/omejitve na top N) — vsaka dobi
// besedilo povezave, prioriteto (za izbiro katere globinsko prebrati v tem koraku) in
// klasifikacijo (za kasnejše katalogiziranje v dokumentnem sistemu portala, glej
// pages/api/razpisi-dokumenti-shrani.js). Prej so bili obrazci/izjave/soglasja tiho izločeni —
// zdaj jih vedno vrnemo (samo z nizko prioriteto za globinsko branje), da jih portal lahko
// katalogizira. Glej pogovor z uporabnikom 2026-07-16.
function najdiDokumentLinke($, baseUrl) {
    const linki = [];
    $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href) return;
        const hrefLower = href.toLowerCase();
        const jeDokument = hrefLower.includes('.pdf') || hrefLower.includes('.docx') || hrefLower.includes('.doc');
        if (!jeDokument) return;
        let absUrl;
        try { absUrl = new URL(href, baseUrl).toString(); } catch { return; }
        const tekst = ($(el).text() || '').trim();
        const skupno = (tekst + ' ' + absUrl).toLowerCase();

        let prioriteta = 1;
        // "Pojasnila" / "razpisna dokumentacija" / "javni razpis" / "annex" (EU razpisi) dokumenti
        // vsebujejo dejanske pogoje, zneske in metodologijo sofinanciranja — najvišja prioriteta.
        if (/pojasnil/i.test(skupno)) prioriteta = 4;
        else if (/razpisna.?dokumentacij/i.test(skupno)) prioriteta = 4;
        else if (/\bannex\b/i.test(skupno)) prioriteta = 4;
        else if (/javni.?razpis/i.test(skupno)) prioriteta = 3;
        else if (/posebni.?pogoj/i.test(tekst) || /^pogoj/i.test(tekst)) prioriteta = 2;
        // Obrazci/izjave/vzorci pogodb ipd. NE vsebujejo formalnih pogojev — nizka prioriteta za
        // GLOBINSKO branje (spodaj), a jih VSEENO katalogiziramo (glej vsiDokumenti v rezultatu).
        if (/obrazec|izjav[ae]|vzorec.?pogodb|navodil.{0,15}(e-?)?podpis|prijavni.?list|soglasj/i.test(skupno)) prioriteta = 0;

        linki.push({ url: absUrl, tekst, prioriteta, klasifikacija: klasificirajPovezavo(tekst) });
    });
    const unikatni = Array.from(new Map(linki.map(l => [l.url, l])).values());
    unikatni.sort((a, b) => b.prioriteta - a.prioriteta);
    return unikatni;
}

// ─── EU: JSON API ──────────────────────────────────────────────────────────────
if (vir === 'EU' || url.includes('europa.eu')) {
    const m = url.match(/topic-details\/([^/?#]+)/i);
    if (m) {
        const identifier = m[1].toUpperCase();
        const apiUrl = `https://ec.europa.eu/info/funding-tenders/opportunities/data/topicDetails/${identifier}.json`;
        log.info(`[EU Detail] JSON API: ${apiUrl}`);
        try {
            const r = await fetch(apiUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            if (r.ok) {
                const d = await r.json();
                const vsebina = [
                    d.objective ? `Cilj:\n${d.objective}` : '',
                    d.targetGroup ? `Upravičenci:\n${d.targetGroup}` : '',
                    d.eligibility ? `Pogoji:\n${d.eligibility}` : '',
                    d.additionalInfo ? `Dodatne informacije:\n${d.additionalInfo}` : '',
                ].filter(Boolean).join('\n\n');

                rezultat = {
                    url,
                    naziv: d.title || d.callTitle || identifier,
                    metaOpis: (d.objective || '').substring(0, 300),
                    vsebina: vsebina.substring(0, 5000),
                    vir: 'EU',
                    programme: d.programmeDivision || d.frameworkProgramme || 'Horizon Europe',
                    budget: d.budget || '',
                    deadline: d.deadlineDates?.[0] || '',
                    pdfViri: [],
                };
                log.info(`[EU Detail] OK: ${rezultat.naziv.substring(0, 60)}`);
            } else {
                log.warning(`[EU Detail] API ${r.status} — poskušam scraping`);
            }
        } catch(e) {
            log.warning(`[EU Detail] API napaka: ${e.message}`);
        }
    }
}

// ─── SPS / ARIS / ostalo: CheerioCrawler + PDF branje ─────────────────────────
if (!rezultat) {
    const crawler = new CheerioCrawler({
        maxConcurrency: 1,
        requestHandlerTimeoutSecs: 120,

        async requestHandler({ request, $ }) {
            const naslov = $('h1.entry-title, span.entry-title, h1').first().text().trim()
                || $('title').text().replace(/\s*[-–]\s*SPS\s*$/i, '').replace(/^ARIS\s*[-–]\s*/i, '').trim();

            const metaOpis = $('meta[name="description"]').attr('content')
                || $('meta[property="og:description"]').attr('content') || '';

            let vsebina = '';
            if (vir === 'SPS' || url.includes('podjetniskisklad')) {
                vsebina = $('.entry-content, .post-content, article .fusion-post-content').first().text().trim();
            } else if (vir === 'ARIS' || url.includes('aris-rs')) {
                // ARIS je poleti 2026 preuredil stran (glej aris-scraper main.js). Prvi poskus
                // (2026-07-03) je ciljal "#content.content" — a ta blok vsebuje TUDI stransko
                // vrstico (<aside class="col-lg-4"> s poljubnimi povezanimi razpisi/"razpisi-
                // related" widgetom), zato je vsebina še vedno bila ~165.000 znakov (potrjeno
                // testom istega dne — ostal je zgolj drugačen šum, ne dejanske vsebine razpisa).
                // Pravi kontejner SAMO glavnega besedila (brez stranske vrstice) je
                // ".razpisDetail-content" (potrjeno v surovem HTML-ju iste strani). Ohranimo
                // "objavlja" fallback SAMO če ciljni selektor ne obstaja (odpornost na
                // morebitno prihodnjo spremembo strani).
                const $vsebinskiBlok = $('.razpisDetail-content').first();
                if ($vsebinskiBlok.length) {
                    vsebina = $vsebinskiBlok.text();
                } else {
                    const telo = $('body').text();
                    const zacetek = telo.indexOf('objavlja');
                    vsebina = zacetek > 0 ? telo.substring(zacetek) : telo.substring(300);
                }
            } else {
                vsebina = $('article, main, .content, #content').first().text().trim();
            }

            if (!vsebina || vsebina.length < 100) {
                vsebina = $('body').text().substring(200);
            }

            vsebina = vsebina.replace(/\s+/g, ' ').trim();

            let dokVsebina = '';
            const dokViri = [];
            let vsiDokumenti = [];
            if (!preskociPdf) {
                const dokLinki = najdiDokumentLinke($, request.url);
                vsiDokumenti = dokLinki.map(l => ({ url: l.url, tekst: l.tekst, klasifikacija: l.klasifikacija }));
                // Globinsko (celo besedilo prebrano v vsebina spodaj) beremo samo prioritetne
                // dokumente (prioriteta > 0, top 8) — obrazci/izjave se KATALOGIZIRAJO (vsiDokumenti
                // zgoraj, gre v rezultat), a jih ne beremo v celoti tukaj (nepotreben strošek/čas za
                // dokumente brez formalnih pogojev). Portal jih lahko kadarkoli naknadno prenese
                // prek dokumentnega sistema, če jih Claude/uporabnik oceni za relevantne. Glej
                // pogovor z uporabnikom 2026-07-16.
                const zaGlobinskoBranje = dokLinki.filter(l => l.prioriteta > 0).slice(0, 8);
                log.info(`[Detail] Najdenih dokumentnih linkov (PDF/Word): ${dokLinki.length}, za globinsko branje: ${zaGlobinskoBranje.length}`);
                for (const l of zaGlobinskoBranje) {
                    const txt = await prebrDokument(l.url);
                    if (txt && txt.length > 50) {
                        const cisto = txt.replace(/\s+/g, ' ').trim();
                        // Razpisni dokumenti so lahko obsežni (100+ strani) — beremo CELOTNO vsebino,
                        // ne omejujemo z znakovnim limitom tukaj. Claude ima dovolj velik context window
                        // da prebere celoten dokument in temeljito poišče zahtevane podatke (zneski,
                        // pogoji, roki...), namesto da zanesljive podatke izgubimo z vnaprejšnjim rezanjem.
                        dokVsebina += `\n\n=== DOKUMENT: ${l.tekst || l.url} ===\n${cisto}`;
                        dokViri.push(l.url);
                    }
                }
            } else {
                log.info('[Detail] preskociPdf=true — dokumenti se ne berejo (samo HTML vsebina strani).');
            }

            const t = vsebina.toLowerCase();
            let status = 'Ni razvidno';

            // Prioritetno: poišči rok za oddajo vlog (najbolj zanesljiv indikator).
            // Iskanje keywordov po celotnem dolgem besedilu je nezanesljivo, ker dolge strani
            // (npr. ARIS) lahko vsebujejo nasprotujoče si fraze v različnih kontekstih (npr. v Q&A).
            let rokDatum = null;
            const reRok = /rok\s+za\s+oddajo\s+vlog[^.]{0,60}?(\d{1,2})\.\s*(\d{1,2})\.\s*(20\d{2})/i;
            const mRok = vsebina.match(reRok);
            if (mRok) {
                const d = new Date(`${mRok[3]}-${mRok[2].padStart(2,'0')}-${mRok[1].padStart(2,'0')}`);
                if (!isNaN(d.getTime())) rokDatum = d;
            }

            if (rokDatum) {
                const zdaj = new Date(); zdaj.setHours(0,0,0,0);
                status = rokDatum >= zdaj ? 'Odprt' : 'Zaprt';
            } else if (t.includes('razpis je zaprt') || t.includes('razpis je zaključen') ||
                t.includes('začasno zaustavljeno')) status = 'Zaprt';
            else if (t.includes('v pripravi') || t.includes('predvidena objava razpisa')) status = 'Napovedan';
            else if (t.includes('razpis je odprt') || t.includes('prijave sprejemamo')) status = 'Odprt';
            else {
                const zdaj = new Date();
                zdaj.setHours(0,0,0,0);
                const datumi = [];
                const reDatum = /(\d{1,2})\.\s*(\d{1,2})\.\s*(20\d{2})/g;
                let dm;
                while ((dm = reDatum.exec(vsebina)) !== null) {
                    const d = new Date(`${dm[3]}-${dm[2].padStart(2,'0')}-${dm[1].padStart(2,'0')}`);
                    if (!isNaN(d)) datumi.push(d);
                }
                if (datumi.length > 0) {
                    const maxDatum = new Date(Math.max(...datumi));
                    status = maxDatum >= zdaj ? 'Odprt' : 'Zaprt';
                }
            }

            // OPOMBA (2026-07-03): "?Rokovnik=Da" je bil poseben query parameter STARE ARIS
            // strani (ukinjena poleti 2026, glej aris-scraper main.js) — na NOVI strani ta
            // parameter ne obstaja, zato je fetch vračal generično/napačno vsebino (potrjeno:
            // vseboval je surov <script> Google Maps loader, ne datume) prek $$('body').text()
            // brez čiščenja — isti razred bug-a kot je bil pri borzen-scraperju. Ker nova
            // ".razpisDetail-content" ekstrakcija (glej zgoraj) že zajame "Rok:"/"Datum objave:"
            // če je na strani, ta posebna ARIS Rokovnik-logika ni več potrebna — onemogočena.
            let rokovnikVsebina = '';

            // Združi dokument (PDF/Word) + rokovnik + HTML vsebino. Razpisni dokumenti so lahko
            // obsežni (100+ strani) — ne režemo na vsiljen kratek limit, pošljemo Claude-u polno
            // vsebino za temeljito iskanje zahtevanih podatkov. Varnostni zgornji limit (200.000
            // znakov, ~50.000 besed) je samo da preprečimo ekstremne izjeme, ne praktična omejitev.
            // ROKOVNIK gre PRVI (je majhen a kritičen — natančen rok oddaje), da ga varnostni limit
            // nikoli ne odreže tudi če so dokumenti/stran skupaj zelo obsežni.
            const VARNOSTNI_LIMIT = 200000;
            const rokovnikDel = rokovnikVsebina ? `=== ROKOVNIK (natančni datumi — NAJZANESLJIVEJŠI VIR za rok oddaje) ===\n${rokovnikVsebina}\n\n` : '';
            const koncnaVsebina = rokovnikDel + (dokVsebina ? dokVsebina + '\n\n=== STRAN ===\n' : '') + vsebina;

            rezultat = {
                url: request.url,
                naziv: naslov,
                metaOpis: metaOpis.substring(0, 500),
                vsebina: koncnaVsebina.substring(0, VARNOSTNI_LIMIT),
                status,
                vir,
                pdfViri: dokViri,
                // VSI najdeni dokumentni linki na strani (ne samo tisti globinsko prebrani zgoraj)
                // — portal (pages/api/razpisi-dokumenti-shrani.js) jih prenese in katalogizira v
                // dokumentni sistem, vsakega s svojo klasifikacijo. Glej pogovor z uporabnikom
                // 2026-07-16.
                vsiDokumenti,
            };

            log.info(`[Detail] Naziv: ${naslov.substring(0, 60)}`);
            log.info(`[Detail] HTML: ${vsebina.length} znakov, Dokumenti: ${dokVsebina.length} znakov, Rokovnik: ${rokovnikVsebina.length} znakov, dokumentov prebranih: ${dokViri.length}`);
        },

        failedRequestHandler({ request, error }) {
            log.error(`[Detail] Napaka: ${request.url} — ${error.message}`);
        },
    });

    await crawler.run([{ url }]);
}

if (rezultat) {
    await Actor.pushData(rezultat);
    await Actor.setValue('REZULTAT', rezultat);
    log.info('[Detail] Shranjeno.');
} else {
    log.error('[Detail] Ni rezultata.');
}

await Actor.exit();
