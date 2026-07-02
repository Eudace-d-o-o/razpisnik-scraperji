// Borzen scraper — javni pozivi/subvencije SAMO za pravne osebe (podjetja).
// Borzen nima enotne "seznam vseh razpisov" strani, zato je seznam ciljnih strani
// hardcoded spodaj (ročno preverjeno, da so namenjene pravnim osebam — sheme izključno
// za fizične osebe/gospodinjstva NISO vključene). Ob vsakem zagonu preveri vsako stran
// znova (status/rok/vsebina se lahko spremenijo), zato seznam URL-jev občasno preveri
// in po potrebi dopolni (nove sheme, spremenjeni naslovi).

const { CheerioCrawler, Dataset } = require('crawlee');
const { Actor } = require('apify');

// Vsaka stran je en "razpis"/shema. `naziv` je fallback, če h1 na strani ni najden.
const CILJNE_STRANI = [
    { url: 'https://borzen.si/sl-si/podpore-za-zelene-investicije/spodbude-za-elektrointenzivna-podjetja', naziv: 'Spodbude za elektrointenzivna podjetja' },
    { url: 'https://borzen.si/sl-si/podpore-za-zelene-investicije/nepovratna-sredstva', naziv: 'Subvencije za investicije v OVE za pravne osebe' },
    { url: 'https://borzen.si/sl-si/podpore-za-zelene-investicije/subvencije-za-proizvodnjo-elektrike-iz-soncne-energije-in-hranilnike-jp-ove-05', naziv: 'JP-OVE-05 — samooskrbne sončne elektrarne do 1 MW' },
    { url: 'https://borzen.si/sl-si/podpore-za-zelene-investicije/subvencije-za-hranilnike-elektricne-energije', naziv: 'Subvencije za hranilnike električne energije' },
    { url: 'https://borzen.si/sl-si/podpore-za-zelene-investicije/subvencije-za-hranilnike-elektricne-energije/subvencije-za-hranilnike-elektricne-energije-2026', naziv: 'JP PS SUB-HEE-PO26 — hranilniki električne energije 2026' },
    { url: 'https://borzen.si/sl-si/podpore-za-mobilnost/subvencije-za-nakup-elektricnih-polnilnih-mest-za-ev-2026', naziv: 'Subvencije za EV polnilna mesta 2026' },
    { url: 'https://borzen.si/sl-si/podpore-za-mobilnost/subvencije-za-polnilne-parke-ob-omrezju-ten-t', naziv: 'Subvencije za polnilne parke ob omrežju TEN-T' },
    { url: 'https://borzen.si/sl-si/podpore-za-mobilnost/subvencije-za-polnilno-infrastrukturo-izven-omrezja-ten-t', naziv: 'Subvencije za polnilno infrastrukturo izven omrežja TEN-T' },
    { url: 'https://borzen.si/sl-si/podpore-za-mobilnost/subvencije-za-tovorni-promet/javni-razpis-zelena-tovorna-logistika', naziv: 'Javni razpis — Zelena tovorna logistika' },
    { url: 'https://borzen.si/sl-si/podpore-za-mobilnost/subvencije-za-tovorni-promet/subvencije-za-okolju-prijaznejse-prevoznistvo-2026', naziv: 'Subvencije za okolju prijaznejše prevozništvo 2026' },
    { url: 'https://borzen.si/sl-si/podpore-za-mobilnost/subvencije-za-okolju-prijaznejse-avtobuse', naziv: 'Subvencije za okolju prijaznejše avtobuse' },
];

// Ključne besede za grobo oceno statusa iz besedila strani (Borzen nima enotnega
// statusnega polja/badge-a kot SPS/ARIS) — pregleda prvih ~2000 znakov vidnega besedila.
function ocenaStatusa(besedilo) {
    const t = besedilo.toLowerCase();
    if (/zaprt|rok.{0,20}potekel|ni ve. mogo.e oddati/i.test(t)) return 'Zaprt';
    if (/(vloge?.{0,15}od|razpisan|odprt|sprejemamo vloge|objavljen)/i.test(t)) return 'Odprt';
    return 'Ni razvidno';
}

// Poišče rok oddaje — vzorci "do DD.MM.YYYY", "rok ... DD.MM.YYYY", ali samostojen datum
// v bližini besede "rok"/"do".
function najdiRok(besedilo) {
    const vzorci = [
        /rok[^.]{0,60}?(\d{1,2}\.\s?\d{1,2}\.\s?\d{4})/i,
        /do\s+(\d{1,2}\.\s?\d{1,2}\.\s?\d{4})/i,
    ];
    for (const v of vzorci) {
        const m = besedilo.match(v);
        if (m) return m[1].replace(/\s/g, '');
    }
    return null;
}

// Poišče znesek razpoložljivih sredstev (npr. "10 milijonov EUR", "30.000.000 EUR")
function najdiSredstva(besedilo) {
    const m = besedilo.match(/([\d.,]+\s*(?:milijon\w*|mio)?\s*EUR)/i);
    return m ? m[1].trim() : null;
}

Actor.main(async () => {
    const danes = new Date().toISOString().substring(0, 10);
    const rezultati = [];

    const crawler = new CheerioCrawler({
        maxRequestsPerCrawl: CILJNE_STRANI.length + 5,
        requestHandlerTimeoutSecs: 60,
        async requestHandler({ request, $, log }) {
            const meta = CILJNE_STRANI.find(s => s.url === request.url) || {};
            const naslov = ($('h1').first().text().trim()) || meta.naziv || 'Neznan naziv';
            // POMEMBNO: $('body').text() brez odstranitve <script>/<style> vključi vgrajene
            // ASP.NET globalizacijske JS bloke (__doPostBack, __cultureInfo...), ki so na vrhu
            // telesa na VSAKI Borzen strani — substring(0, 4000) je zato prej odrezal samo ta
            // identičen skript, še preden je prišel do dejanske vsebine strani (isti bug kot
            // je bil razlog, da je bila 'Vsebina' enaka na vseh razpisih ne glede na URL).
            $('script, style, noscript').remove();
            const besedilo = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 4000);

            const item = {
                'Naziv razpisa': naslov,
                'URL': request.url,
                'Status': ocenaStatusa(besedilo),
                'Rok prijave': najdiRok(besedilo),
                'Sredstva': najdiSredstva(besedilo),
                'Datum zaznave': danes,
                'Vsebina': besedilo.substring(0, 1500),
            };
            rezultati.push(item);
            log.info(`Zajeto: ${naslov} (${item['Status']})`);
        },
        failedRequestHandler({ request, log }) {
            log.warning(`Ni uspelo naložiti: ${request.url}`);
        },
    });

    await crawler.run(CILJNE_STRANI.map(s => s.url));

    if (rezultati.length) await Dataset.pushData(rezultati);
});
