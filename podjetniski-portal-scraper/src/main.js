/**
 * Podjetniški portal (podjetniski-portal.si, SPIRIT Slovenija) — scraper razpisov (Apify actor).
 *
 * Stran je strežniško izrisana -> plain fetch + cheerio (brez brskalnika). Programskega vmesnika
 * nima (pot, ki jo ima spiritslovenia.si, tu vrne »stran ne obstaja«, izmerjeno 6. 10. 2026).
 *
 * Portal je ZBIRNIK: razpise prepisuje od skladov, agencij, ministrstev in občin. Zato ga beremo iz
 * dveh delov strani:
 *   /razpisi                         — seznam razpisov (po letih, 20 na stran)
 *   /moj-spletni-prirocnik/clanki    — tedenski priročnik; beremo SAMO razdelek »Finančne spodbude«,
 *                                      kjer izidejo napovedi, ki jih na seznamu razpisov še ni
 *                                      (primer: IF26 SME Call, napoved 6. 10. 2026)
 *
 * Kdo je razpis objavil, scraper zapiše v polji Izdajatelj in Izvorna domena. Na tej podlagi portal
 * ob uvozu izloči razpise, ki jih že zajemamo neposredno pri izdajatelju (lib/zajem-agregator.js) —
 * zbirnik naj doda samo tisto, česar drugje nimamo.
 *
 * Izhod (pogodba polj za razpisi.js genericniMapper): Naziv razpisa, URL, Status, Rok prijave,
 * Datum zaznave, Sredstva, Vsebina, Tip financiranja, Programme.
 */
const { Actor } = require('apify');
const cheerio = require('cheerio');

const BAZA = 'https://www.podjetniski-portal.si';
const SEZNAM = '/razpisi';
const PRIROCNIK = '/moj-spletni-prirocnik/clanki';
const NAJVEC_STRANI_NA_LETO = 15;   // varovalka pred neskončnim listanjem (leto ima ~4 strani)
const STAROST_DNI = 400;            // starejših objav ne beremo: tudi najdaljši razpisi se zaprejo prej
const ZAMIK_MS = 300;               // vljuden razmik med zahtevki na isti strežnik
const HKRATI = 3;                   // največ toliko hkratnih zahtevkov na isti strežnik
const NAJVEC_ZNAKOV_VSEBINE = 2000;

const cist = (t) => String(t || '').replace(/\s+/g, ' ').trim();
const pocakaj = (ms) => new Promise((r) => setTimeout(r, ms));
const dvomestno = (n) => String(n).padStart(2, '0');
const vNiz = (d) => `${dvomestno(d.getDate())}.${dvomestno(d.getMonth() + 1)}.${d.getFullYear()}`;

function danes() {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

async function preberi(url) {
    const r = await fetch(url, {
        headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (razpisnik-portal scraper)' },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} pri ${url}`);
    return r.text();
}

// Meseci z besedo, kot jih pišejo občine: »15. julij 2026«, »12. avgusta 2026«, »29. maj 2026«.
// Primerjamo prve tri črke, ker se končnica sklanja (julij/julija).
const MESECI = { jan: 1, feb: 2, mar: 3, apr: 4, maj: 5, jun: 6, jul: 7, avg: 8, sep: 9, okt: 10, nov: 11, dec: 12 };

/** Vsi datumi v besedilu, številski (»21. 9. 2026«) in z besedo (»12. avgusta 2026«), po vrsti. */
function datumiIzBesedila(besedilo) {
    const datumi = [];
    const vzorec = /(\d{1,2})\.\s*(?:(\d{1,2})\.|([a-zčšž]{3,})\s)\s*(\d{4})/gi;
    let z;
    while ((z = vzorec.exec(String(besedilo || ''))) !== null) {
        const dan = Number(z[1]);
        const mesec = z[2] ? Number(z[2]) : MESECI[z[3].slice(0, 3).toLowerCase()];
        const leto = Number(z[4]);
        if (!mesec || dan < 1 || dan > 31 || mesec > 12) continue;
        const datum = new Date(leto, mesec - 1, dan);
        // Neobstoječ datum (»31. 9. 2026«) bi se tiho prelil v 1. 10.; takega ne vzamemo.
        if (datum.getMonth() !== mesec - 1) continue;
        datumi.push(datum);
    }
    return datumi;
}

/**
 * Rok in status iz polja »Rok«, ki je prosto besedilo. Pravila (vsako izmerjeno na 38 razpisih
 * s seznama, 6. 10. 2026):
 * - Več datumov (presečni roki, »do porabe sredstev, skrajni rok 31. 3. 2028«): rok je ZADNJI.
 * - Besedilo pove samo začetek (»Prijava na razpis se začne 27. 7. 2026«, »možna od 4. 8. 2026«):
 *   to ni rok. Če začetek še prihaja, je razpis napovedan, sicer stanja ne poznamo — ne ugibamo,
 *   da je odprt.
 * - Brez datuma ali z rokom, štetim od objave (»30 dni od objave v Uradnem listu«): stanja ne poznamo.
 * - Datumi, ki niso rok (odpiranje vlog, poraba sredstev, objava), se ne upoštevajo — sicer bi
 *   »sredstva porabiti do 31. 10. 2027« postal rok (nasprotni pregled, 6. 10. 2026).
 */
function rokInStatus(besedilo, dan = danes()) {
    const t = String(besedilo || '').toLowerCase();
    if (/dni\s+(od|po)\s+(dneva\s+)?objav/.test(t)) return { rok: null, status: 'Ni razvidno' };
    const brezDrugihDatumov = t.replace(
        // Okno 30 znakov: »objave razpisa do dneva … najkasneje do 3. 9. 2027« je rok in ostane.
        /(odpiranj\w*|porabi\w*|objav\w*|z dne)[^;]{0,30}?\d{1,2}\.\s*(?:\d{1,2}\.|[a-zčšž]{3,}\s)\s*\d{4}/g, ' ');
    const datumi = datumiIzBesedila(brezDrugihDatumov);
    if (!datumi.length) return { rok: null, status: 'Ni razvidno' };
    // »do porabe sredstev« ni rok in ne pomeni, da besedilo pove konec.
    const brezPorabe = brezDrugihDatumov.replace(/do\s+porabe/g, ' ');
    const samoZacetek = datumi.length === 1
        && /(začne|od\s+\d|od\s+dneva|poteka od)/.test(brezPorabe)
        && !/(\bdo\b|najkasneje|skrajni|rok za oddajo|rok je|rok:)/.test(brezPorabe);
    if (samoZacetek) {
        return { rok: null, status: datumi[0] > dan ? 'Napovedan' : 'Ni razvidno' };
    }
    const zadnji = datumi.reduce((a, b) => (b > a ? b : a));
    return { rok: vNiz(zadnji), status: zadnji >= dan ? 'Odprt' : 'Zaprt' };
}

// »02. 10. 2026« -> Date
function datumObjave(niz) {
    const d = datumiIzBesedila(niz)[0];
    return d || null;
}

// Naziv odloča prvi (»Garancije in posojila« je garancija, tudi če opis omenja nepovratni del);
// šele brez oznake v nazivu pogledamo, ali predmet ali vrednost razpisa izrecno govorita o nepovratnih
// sredstvih (»Znesek razpisanih nepovratnih sredstev znaša …«).
function tipFinanciranja(naziv, polja) {
    if (/garancij/i.test(naziv)) return 'Garancija';
    if (/kredit|posojil/i.test(naziv)) return 'Kredit';
    const opis = [polja['Predmet razpisa'], polja['Namen razpisa'], polja['Vrednost razpisa']].filter(Boolean).join(' ');
    if (/nepovratn/i.test(opis) && !/kredit|posojil|garancij/i.test(opis)) return 'Nepovratna sredstva';
    return null;
}

/**
 * Stran posameznega razpisa ali članka. Polja so odstavki z odebeljeno oznako
 * (<p><b>Rok:</b> …</p>); ista oznaka se lahko ponovi (dvakrat »Predmet razpisa«), zato jih združimo.
 */
function razcleniPodrobnosti(html, url, jeClanek = false, dan = danes()) {
    const $ = cheerio.load(html);
    const telo = $('.newsDetail').first();
    if (!telo.length) return null;
    const naziv = cist($('h1.title').first().text()) || cist($('h1').last().text());
    if (!naziv) return null;

    const polja = {};
    const odstavki = [];
    let izvorniUrl = null;
    telo.find('p, li').each((_, el) => {
        const p = $(el);
        if (p.hasClass('date')) return;
        const besedilo = cist(p.text());
        if (!besedilo || besedilo === 'Nazaj') return;
        // Oznaka je odebeljen začetek, ki se konča z dvopičjem. Odebeljen odstavek brez dvopičja je
        // poudarjeno besedilo (uvod v članku priročnika) in spada v vsebino.
        const odebeljeno = cist(p.children('b').first().text());
        const oznaka = /:$/.test(odebeljeno) ? odebeljeno.replace(/:$/, '') : '';
        if (oznaka && besedilo.startsWith(oznaka)) {
            const vrednost = cist(besedilo.slice(oznaka.length).replace(/^:/, ''));
            polja[oznaka] = polja[oznaka] ? `${polja[oznaka]} ${vrednost}` : vrednost;
            // »Več: Več o javnem razpisu najdete tukaj« vodi na izdajateljevo stran razpisa.
            if (oznaka === 'Več') izvorniUrl = p.find('a[href]').first().attr('href') || izvorniUrl;
        } else {
            odstavki.push(besedilo);
        }
        // Brez oznake »Več« vzamemo prvo povezavo z besedilom »Več« (v članku: »Več informacij …«).
        if (!izvorniUrl) {
            const a = p.find('a[href]').filter((_, x) => /^več/i.test(cist($(x).text()))).first();
            if (a.length) izvorniUrl = a.attr('href');
        }
    });

    // »Objavljeno: Občina Hrastnik, 1. 6. 2026, www.hrastnik.si« — izdajatelj, datum, domena.
    const objavljeno = polja['Objavljeno'] || '';
    const deliObjave = objavljeno.split(',').map(cist).filter(Boolean);
    const domena = (deliObjave.find((d) => /\.[a-z]{2,}\/?$/i.test(d) && !/\s/.test(d)) || '')
        .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '').toLowerCase() || null;
    const izdajatelj = polja['Razpisnik'] || deliObjave[0] || null;

    const datum = datumObjave(cist(telo.find('p.date').first().text()));
    let { rok, status } = rokInStatus(polja['Rok'] || '', dan);
    // Članek v priročniku ima rok le izjemoma; napoved (»načrtuje objavo«, »predvidena«) je napovedan razpis.
    if (jeClanek && !polja['Rok'] && /načrtuje objavo|predviden|napoveduje|bo objavljen/i.test(odstavki.join(' '))) {
        status = 'Napovedan';
    }

    const deli = [];
    if (izdajatelj) deli.push(`Razpisnik: ${izdajatelj}`);
    for (const oznaka of ['Namen razpisa', 'Predmet razpisa', 'Cilj razpisa', 'Upravičeni stroški',
        'Pogoji za sodelovanje', 'Vrednost razpisa', 'Rok', 'Dodatne informacije']) {
        if (polja[oznaka]) deli.push(`${oznaka}: ${polja[oznaka]}`);
    }
    if (odstavki.length) deli.push(odstavki.join(' '));
    if (objavljeno) deli.push(`Objavljeno: ${objavljeno}`);
    if (izvorniUrl) deli.push(`Izvirna objava: ${izvorniUrl}`);

    return {
        'Naziv razpisa': naziv,
        'URL': url,
        'Status': status,
        // Tip zapišemo le, kadar ga potrjuje naziv ali opis sredstev; sicer ostane prazen (portal ne ugiba).
        'Tip financiranja': tipFinanciranja(naziv, polja),
        'Rok prijave': rok,
        'Datum zaznave': vNiz(dan),
        'Sredstva': polja['Vrednost razpisa'] || null,
        'Programme': izdajatelj,
        'Vsebina': deli.join(' · ').substring(0, NAJVEC_ZNAKOV_VSEBINE),
        // Spodnja polja portal ne prikazuje; po njih izloča razpise, ki jih zajemamo pri izdajatelju.
        'Izdajatelj': izdajatelj,
        'Izvorna domena': domena,
        'Izvorni URL': izvorniUrl,
        'Datum objave': datum ? vNiz(datum) : null,
        'Vrsta objave': jeClanek ? 'napoved v priročniku' : 'razpis',
    };
}

/** Ena stran seznama razpisov: povezava, naziv in datum objave vsake postavke. */
function postavkeSeznama(html) {
    const $ = cheerio.load(html);
    const postavke = [];
    $('#newsList .news a[href]').each((_, a) => {
        const pot = $(a).attr('href');
        const naziv = cist($(a).find('h3').text());
        if (!pot || !naziv) return;
        postavke.push({
            url: pot.startsWith('http') ? pot : `${BAZA}${pot}`,
            naziv,
            datum: datumObjave(cist($(a).find('p.date').text())),
        });
    });
    return postavke;
}

/**
 * Seznam razpisov za tekoče in preteklo leto. Seznam je razdeljen po letih; brez preteklega leta bi
 * januarja ostal skoraj prazen, čeprav so lanski razpisi še odprti. Starejše od STAROST_DNI izpustimo.
 */
async function povezaveRazpisov(dan = danes()) {
    const meja = new Date(dan.getTime() - STAROST_DNI * 86400000);
    const leto = dan.getFullYear();
    const povezave = [];
    const videne = new Set();
    for (const l of [leto, leto - 1]) {
        if (new Date(l, 11, 31) < meja) continue;
        for (let stran = 1; stran <= NAJVEC_STRANI_NA_LETO; stran++) {
            const postavke = postavkeSeznama(await preberi(`${BAZA}${SEZNAM}?year=${l}&page=${stran}`));
            let novih = 0;
            for (const p of postavke) {
                if (videne.has(p.url)) continue;
                videne.add(p.url);
                novih++;
                if (!p.datum || p.datum >= meja) povezave.push(p.url);
            }
            await pocakaj(ZAMIK_MS);
            // Konec leta: prazna stran ali ista stran znova (strežnik za stran čez konec vrne zadnjo).
            if (!novih) break;
            const najstarejsi = postavke.map((p) => p.datum).filter(Boolean).sort((a, b) => a - b)[0];
            if (najstarejsi && najstarejsi < meja) break;
        }
    }
    return povezave;
}

/** Članki tekoče številke priročnika iz razdelka »Finančne spodbude«. Ostali razdelki so dogodki in predpisi. */
async function povezaveClankov() {
    const $ = cheerio.load(await preberi(`${BAZA}${PRIROCNIK}`));
    const povezave = [];
    $('.mspArticles .area').each((_, obmocje) => {
        const naslov = cist($(obmocje).find('h3').first().text()).toLowerCase();
        if (!naslov.startsWith('finančne spodbude')) return;
        $(obmocje).find('.item a[href]').each((__, a) => {
            const pot = $(a).attr('href');
            if (pot) povezave.push(pot.startsWith('http') ? pot : `${BAZA}${pot}`);
        });
    });
    return { povezave, imaRazdelke: $('.mspArticles .area').length > 0 };
}

Actor.main(async () => {
    const razpisi = await povezaveRazpisov();
    if (!razpisi.length) console.error('[PODJPORTAL] SEZNAM RAZPISOV BREZ POVEZAV — poglej izbirnike seznama');
    console.log(`[PODJPORTAL] seznam razpisov: ${razpisi.length} povezav`);

    const { povezave: clanki, imaRazdelke } = await povezaveClankov();
    // Teden brez finančnih spodbud je mogoč; priročnik brez razdelkov pa pomeni spremenjeno stran.
    if (!imaRazdelke) console.error('[PODJPORTAL] PRIROČNIK BREZ RAZDELKOV — poglej izbirnike priročnika');
    console.log(`[PODJPORTAL] priročnik, finančne spodbude: ${clanki.length} člankov`);

    const rezultati = [];
    let napak = 0;
    const naloge = [...razpisi.map((url) => ({ url, jeClanek: false })), ...clanki.map((url) => ({ url, jeClanek: true }))];
    // Strani beremo po HKRATI naenkrat. Zaporedno je 110 strani trajalo 156 s (izmerjeno 6. 10. 2026),
    // nočni zajem portala pa na posamezen vir čaka največ 240 s.
    for (let i = 0; i < naloge.length; i += HKRATI) {
        await Promise.all(naloge.slice(i, i + HKRATI).map(async ({ url, jeClanek }) => {
            try {
                const zapis = razcleniPodrobnosti(await preberi(url), url, jeClanek);
                if (zapis) rezultati.push(zapis);
                else { napak++; console.error(`[PODJPORTAL] NERAZČLENJENO: ${url}`); }
            } catch (e) {
                napak++;
                console.error(`[PODJPORTAL] NAPAKA pri ${url}: ${e.message}`);
            }
        }));
        await pocakaj(ZAMIK_MS);
    }

    const poStanju = {};
    for (const r of rezultati) poStanju[r.Status] = (poStanju[r.Status] || 0) + 1;
    console.log(`[PODJPORTAL] zajetih ${rezultati.length}, po stanju ${JSON.stringify(poStanju)}, napak ${napak}`);
    if (rezultati.length) await Actor.pushData(rezultati);
});
