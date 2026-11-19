/**
 * Preizkus razčlembe brez omrežja: `node preizkus-razclemba.js` (potrebuje cheerio iz `npm install`).
 * Oblika strani Erasmus+ 2027 (18. 11. 2026): preglednica rokov, nato preglednice informativnih dni.
 */
const assert = require('node:assert');
const { zapisiLetneStrani, letneStrani } = require('./src/razclemba');

const stran = `<html><body><h1>Erasmus+ 2027</h1>
<script type="application/ld+json">{"datePublished":"2026-11-18T08:00:00+00:00"}</script>
<h2>Razpisni roki</h2>
<table><tbody>
<tr><td>Projekti mobilnosti posameznikov – KA1, (SCH, VET, HED, ADU)</td><td><strong>18. februar 2027 ob 12.00</strong></td></tr>
<tr><td>Projekti mobilnosti osebja – KA182 šport</td><td>11. februar 2027 ob 12.00</td></tr>
<tr><td>Partnerstva za sodelovanje – KA2<br>– sodelovalna partnerstva</td><td>9. marec 2027 ob 12.00</td></tr>
<tr><td>Partnerstva za sodelovanje – KA2<br>– manjša partnerstva</td><td>9. marec 2027 ob 12.00</td></tr>
<tr><td>Evropska partnerstva za razvoj šol – KA240</td><td>9. marec 2027 ob 12.00</td></tr>
</tbody></table>
<h3>Informativni dnevi SCH</h3>
<table><tbody>
<tr><td><strong>Datum in ura</strong></td><td><strong>Seminar</strong></td><td><strong>Prijava</strong></td></tr>
<tr><td>15. 12. 2026 ob 12:00<br>spletno</td><td>Promocija razpisa E+ 2027 KA220-SCH in KA240-SCH</td><td>do 14. 12. 2026</td></tr>
</tbody></table>
<table><tbody>
<tr><td>8. 12. 2026 ob 13:00<br>spletno</td><td>Informativni dan za VET področje (KA1 &amp; KA2)</td><td>do 7. 12. 2026</td></tr>
</tbody></table>
</body></html>`;

const dan = new Date(2026, 10, 19);
const { zapisi, nerazclenjene } = zapisiLetneStrani(stran, { leto: 2027, url: 'https://www.cmepius.si/objave/razpis/erasmus-2027/' }, dan);
assert.deepStrictEqual(nerazclenjene, [], 'informativni dnevi niso roki');
assert.strictEqual(zapisi.length, 5);
assert.ok(zapisi.every((z) => z.Status === 'Odprt'), JSON.stringify(zapisi.map((z) => z.Status)));
assert.strictEqual(zapisi[0]['Rok prijave'], '18.02.2027');
assert.strictEqual(zapisi[2]['Naziv razpisa'], 'Erasmus+ 2027: Partnerstva za sodelovanje – KA2 – sodelovalna partnerstva');

// Vrstica rokov brez datuma še vedno ustavi zagon (tiha izguba roka ni dovoljena).
const brez = zapisiLetneStrani('<table><tr><td>Akreditacija Erasmus</td><td>objavljeno naknadno</td></tr></table>',
    { leto: 2027, url: 'x' }, dan);
assert.deepStrictEqual(brez.nerazclenjene, ['Akreditacija Erasmus']);

const s = letneStrani('<a href="/objave/razpis/erasmus-2026/">2026</a><a href="https://www.cmepius.si/objave/razpis/erasmus-2027/">2027</a>', 'https://www.cmepius.si');
assert.deepStrictEqual(s.map((x) => x.leto), [2026, 2027]);
console.log('preizkus razčlembe CMEPIUS: v redu (5 rokov, informativni dnevi izpuščeni)');
