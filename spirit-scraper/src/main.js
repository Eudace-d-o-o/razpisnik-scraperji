/**
 * SPIRIT Slovenija scraper — Apify actor.
 *
 * SPIRIT ima ČIST JSON API za razpise, zato brskalnik (Playwright/Crawlee) NI potreben — samo
 * fetch API-ja + razčlenitev. Kljub temu teče kot Apify actor, da je enoten sistem z ostalimi viri
 * (SPS/ARIS/EU/Borzen) — isti sync pipeline, urnik, zgodovina zagonov (glej pogovor 2026-07-18).
 *
 * API: /api/v1/backend/tender/paginatedlist -> { data: { items: [...] } }
 *   items[].title, .link (slug), .externalUrl, .status, .validity, .validTo (ISO), .publishDate, .subtitle, .deadline
 *
 * Izhod (pogodba polj za razpisi.js genericniMapper): Naziv razpisa, URL, Status, Rok prijave,
 * Datum zaznave, Vsebina.
 */
const { Actor } = require('apify');

const API = 'https://www.spiritslovenia.si/api/v1/backend/tender/paginatedlist'
    + '?limit=200&offset=0&sortBy=PUBLISH_DATE&sort=DESC&queryString=&status=ACTIVE&validity=ACTIVE&queryFullContent=true&language=SL';

// ISO "2026-07-28" -> "28.07.2026"; sicer vrni neobdelano.
function isoVSlo(v) {
    if (!v) return null;
    const m = String(v).substring(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : v;
}
function danes() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

// CommonJS actor -> ovij v Actor.main (top-level await ni dovoljen v CommonJS).
Actor.main(async () => {
    const r = await fetch(API, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`SPIRIT API HTTP ${r.status}`);
    const j = await r.json();
    const items = (j && j.data && j.data.items) || [];

    const rezultati = [];
    for (const t of items) {
        if (!t.title || !t.link) continue;
        const url = (t.externalUrl && t.externalUrl.trim())
            ? t.externalUrl.trim()
            : `https://www.spiritslovenia.si/razpisi/${t.link}`;
        rezultati.push({
            'Naziv razpisa': String(t.title).trim(),
            'URL': url,
            'Status': 'Odprt', // API vračamo samo status=ACTIVE&validity=ACTIVE (odprti)
            'Rok prijave': isoVSlo(t.validTo),
            'Datum zaznave': danes(),
            'Vsebina': [t.subtitle, t.deadline].filter(Boolean).join(' — ').substring(0, 2000),
        });
    }

    console.log(`[SPIRIT] zajetih ${rezultati.length} odprtih razpisov`);
    if (rezultati.length) await Actor.pushData(rezultati);
});
