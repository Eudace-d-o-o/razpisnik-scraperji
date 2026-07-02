/**
 * SPS Scraper (popravljena verzija — vključuje tudi Plan objav)
 *
 * SPS je stran "Javni razpisi in pozivi" preuredil na dinamično WordPress AJAX
 * tabelo — vsebina se NE naloži ob osnovnem GET klicu strani (ta vrne samo
 * "Nalaganje…" placeholder), ampak šele prek POST klica na
 * /wp-admin/admin-ajax.php z action=sps_razpisi_live_search.
 *
 * Prejšnja verzija (CheerioCrawler na statični strani) zato ni zaznala NOBENEGA
 * razpisa iz te dinamične tabele — namesto njih je zajela navigacijske/kontaktne
 * linke iz drugih delov strani.
 *
 * Ta verzija kliče AJAX endpoint direktno (brez potrebe po headless brskalniku,
 * ker je to navaden HTTP POST) in z infinite-scroll mehanizmom (page=1,2,3...,
 * has_more) pridobi VSE strani rezultatov.
 *
 * DODATNO: v istem zagonu pridobi tudi "Plan objav razpisov in pozivov" stran
 * (letni plan vseh razpisov, vključno z že objavljenimi) — ta stran JE statična
 * (vsebina je že v osnovnem HTML-ju), zato uporabljamo navadno fetch+parse brez
 * potrebe po AJAX. Plan-vnosi gredo v ISTI dataset, oznaceni z je_plan_objav=true,
 * da ni potreben ločen Actor/gumb za scraping — vse gre skupaj v eno sinhronizacijo.
 */

import { Actor, log } from 'apify';
import * as cheerio from 'cheerio';

await Actor.init();

const AJAX_URL = 'https://www.podjetniskisklad.si/wp-admin/admin-ajax.php';
const PLAN_OBJAV_URL = 'https://www.podjetniskisklad.si/javni-razpisi-pozivi-programi/plan-objav-razpisov-in-pozivov/';
const MAX_STRANI = 15; // varnostna omejitev — SPS trenutno ima precej manj strani rezultatov

async function pokliciStran(page) {
    const body = new URLSearchParams();
    body.append('action', 'sps_razpisi_live_search');
    body.append('term', '');
    body.append('status[]', '__all__');
    body.append('razpis__poziv[]', '__all__');
    body.append('page', String(page));

    const r = await fetch(AJAX_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        body: body.toString(),
    });

    if (!r.ok) throw new Error(`AJAX HTTP ${r.status}`);
    const data = await r.json();
    if (!data.success || !data.data || typeof data.data.html === 'undefined') {
        throw new Error('Nepričakovan AJAX odgovor: ' + JSON.stringify(data).substring(0, 300));
    }
    return { html: data.data.html, hasMore: !!data.data.has_more };
}

// Razčleni HTML fragment ene strani rezultatov v strukturirane razpise.
// Selektorji preverjeni na živi strani (27.6.2026): vsaka kartica je "li.post-card",
// naziv je v "h3.fusion-title-heading" (čist, brez podvajanja), status v
// "span.sps-status__text", tip financiranja je prvi <p> v kartici, rok oddaje
// zadnji <p> z datumom. Besedilo celotne kartice se podvoji (verjetno
// desktop/mobile prikaz), zato CILJANI selektorji namesto regex na vsem besedilu.
function razcleniRazpise(html) {
    const $ = cheerio.load(html);
    const rezultati = [];

    $('li.post-card').each((_, el) => {
        const $card = $(el);
        const $a = $card.find('a[href*="podjetniskisklad.si"]').first();
        const href = $a.attr('href');
        if (!href || href.startsWith('mailto:')) return;

        const naziv = $card.find('h3.fusion-title-heading').first().text().replace(/\s+/g, ' ').trim();
        if (!naziv || naziv.length < 3) return;

        const status = $card.find('span.sps-status__text').first().text().trim() || 'Ni razvidno';
        const statusNormaliziran = /odprto/i.test(status) ? 'Odprt' : /zaprto/i.test(status) ? 'Zaprt' : /na.rtovano|napovedano/i.test(status) ? 'Načrtovan' : status;

        // Vsi <p> elementi v kartici brez vnorenih elementov drugih razredov — prvi
        // je tip financiranja, kasnejši (z datumsko obliko) je rok oddaje.
        const odstavki = $card.find('p').map((i, p) => $(p).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean);
        const tipFinanciranja = odstavki.find(t => /^(Subvencija|Kredit|Krediti|Garancija|Garancije|Vavčer|Lastniško financiranje|Mentorstvo|Vsebinska podpora|Kombinirano|Kombinacija.*)$/i.test(t)) || '';
        const rokOdstavek = odstavki.find(t => /\d{1,2}\.\s?\d{1,2}\.\s?\d{4}/.test(t));
        let rokOddaje = '';
        if (rokOdstavek) {
            const m = rokOdstavek.match(/(\d{1,2}\.\s?\d{1,2}\.\s?\d{4})/);
            if (m) rokOddaje = m[1].replace(/\s+/g, '');
        }

        rezultati.push({
            'Naziv razpisa': naziv,
            'URL': href,
            'Vir': 'SPS',
            'Tip financiranja': tipFinanciranja,
            'Status': statusNormaliziran,
            'Rok oddaje': rokOddaje,
            'Datum zaznave': new Date().toISOString().substring(0, 10),
            'JePlanObjav': false,
        });
    });

    return rezultati;
}

// Plan objav stran je STATIČNA (vsebina že v osnovnem HTML-ju), ampak uporablja
// Fusion Builder (Avada tema) grid z generiranimi, nestabilnimi CSS razredi —
// zato parsiramo besedilo strani po ZAPOREDJU labelov, ki se dosledno ponavlja:
// Oznaka razpisa → Naziv razpisa → Plan razpisanih sredstev →
// Predviden termin objave → Oblika financiranja → Namen ukrepa
const PLAN_LABELI = [
    'Oznaka razpisa', 'Naziv razpisa', 'Plan razpisanih sredstev',
    'Predviden termin objave', 'Oblika financiranja', 'Namen ukrepa',
];

function parsirajPlanObjav(html) {
    // POMEMBNO: uporabljamo cheerio (pravi DOM parser) za odstranitev nav/header/footer,
    // NE regex na surovem HTML-ju. Regex `<nav[\s\S]*?<\/nav>` je "lazy" in se ustavi na
    // PRVEM </nav>, kar pri gnezdenih <nav> elementih (SPS stran ima 16 nav tagov, gnezdenih)
    // pusti del menijske vsebine nedotaknjen — to je bil pravi vzrok zakaj so se menijski
    // linki (npr. "Pospeševalnik ZDA") prej pomotoma pojavljali kot razpisi.
    const $ = cheerio.load(html);
    $('nav, header, footer, script, style').remove();
    // Vstavi prelom vrstice za vsakim blok-elementom PRED pridobitvijo besedila — cheerio
    // .text() (drugače kot brskalnikov innerText) ne ohranja vizualnih prelomov sam od sebe.
    $('p, div, h1, h2, h3, h4, h5, h6, li, tr, br').after('\n');
    const besedilo = $('body').text()
        .split('\n')
        .map(v => v.replace(/\s+/g, ' ').trim())
        .filter(Boolean);

    const rezultati = [];
    let i = 0;
    while (i < besedilo.length) {
        if (besedilo[i] === PLAN_LABELI[0]) {
            const podatki = {};
            let ok = true;
            let j = i;
            for (const label of PLAN_LABELI) {
                if (besedilo[j] !== label) { ok = false; break; }
                let vrednostVrstice = [];
                let k = j + 1;
                while (k < besedilo.length && !PLAN_LABELI.includes(besedilo[k])) {
                    vrednostVrstice.push(besedilo[k]);
                    k++;
                }
                podatki[label] = vrednostVrstice.join(' ').trim();
                j = k;
            }
            if (ok && podatki['Oznaka razpisa'] && podatki['Naziv razpisa']) {
                // Stroga validacija: "Oznaka razpisa" mora ustrezati tipičnemu SPS vzorcu
                // (kratka koda z vsaj eno številko/letnico, npr. "P4L blending 2026", "V10",
                // "P1-2 plus 2026") — to izloči morebitne napačno ujemajoče se odlomke iz
                // skritih navigacijskih/menijskih elementov, ki bi sicer po naključju sledili
                // istemu zaporedju labelov.
                const oznaka = podatki['Oznaka razpisa'].trim();
                const oznakaVeljavna = oznaka.length <= 40 && /\d/.test(oznaka) && !/[.!?]$/.test(oznaka);
                if (!oznakaVeljavna) { i = j; continue; }

                // Odreži morebiten "prilepljen" naslov naslednje sekcije (npr. "2. KREDITI...")
                let namenUkrepa = podatki['Namen ukrepa'] || '';
                const mSekcija = namenUkrepa.match(/^(.*?)\s+\d\.\s+[A-ZČŠŽ]{3,}/);
                if (mSekcija) namenUkrepa = mSekcija[1].trim();

                rezultati.push({
                    'Naziv razpisa': `${oznaka} | ${podatki['Naziv razpisa']}`,
                    'URL': `${PLAN_OBJAV_URL}#${encodeURIComponent(oznaka)}`,
                    'Vir': 'SPS',
                    'Tip financiranja': podatki['Oblika financiranja'] || '',
                    'Status': 'Načrtovan',
                    'Rok oddaje': '',
                    'Datum zaznave': new Date().toISOString().substring(0, 10),
                    'JePlanObjav': true,
                    'PlanOznaka': oznaka,
                    'PlanSredstva': podatki['Plan razpisanih sredstev'] || '',
                    'PlanTermin': podatki['Predviden termin objave'] || '',
                    'PlanNamen': namenUkrepa,
                });
                i = j;
                continue;
            }
        }
        i++;
    }
    return rezultati;
}

const vsiRezultati = [];
const videniUrlGlobalno = new Set();

try {
    // 1) Glavni seznam razpisov (dinamična AJAX tabela)
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= MAX_STRANI) {
        log.info(`[SPS] Pridobivam stran ${page}...`);
        const { html, hasMore: more } = await pokliciStran(page);
        const razpisi = razcleniRazpise(html);

        let novihNaStrani = 0;
        for (const r of razpisi) {
            if (!videniUrlGlobalno.has(r['URL'])) {
                videniUrlGlobalno.add(r['URL']);
                vsiRezultati.push(r);
                novihNaStrani++;
            }
        }

        log.info(`[SPS] Stran ${page}: najdenih ${razpisi.length}, novih ${novihNaStrani}, has_more=${more}`);

        // Če stran ne vrne nobenega novega razpisa, ustavi (varovalka pred neskončno zanko
        // če bi se infinite-scroll mehanizem kdaj ujel v zanko ponavljajočih se rezultatov).
        if (novihNaStrani === 0 && page > 1) break;

        hasMore = more;
        page++;
    }

    log.info(`[SPS] Glavni seznam: ${vsiRezultati.length} razpisov`);

    // 2) Plan objav (statična stran, ločen fetch — tudi če pade, glavni seznam ostane veljaven)
    try {
        log.info('[SPS] Pridobivam Plan objav...');
        const planR = await fetch(PLAN_OBJAV_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (planR.ok) {
            const planHtml = await planR.text();
            const planRezultati = parsirajPlanObjav(planHtml);
            log.info(`[SPS] Plan objav: ${planRezultati.length} vnosov`);
            vsiRezultati.push(...planRezultati);
        } else {
            log.warning(`[SPS] Plan objav HTTP ${planR.status} — preskočeno, glavni seznam ostane veljaven`);
        }
    } catch (e) {
        log.warning('[SPS] Plan objav napaka: ' + e.message + ' — preskočeno, glavni seznam ostane veljaven');
    }

    log.info(`[SPS] Skupaj (glavni seznam + plan objav): ${vsiRezultati.length}`);
    await Actor.pushData(vsiRezultati);

} catch (e) {
    log.error('[SPS] Napaka: ' + e.message);
    throw e;
}

await Actor.exit();
