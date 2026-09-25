// Ročni preizkus čiste funkcije razdeliDokumentniBudget — brez ogrodja, samo node:assert.
// Poganjanje: node src/deli-dokumentni-budget.test.js
import assert from 'node:assert/strict';
import { razdeliDokumentniBudget } from './deli-dokumentni-budget.js';

const BUDGET = 180000;

// 1) P7L 2026 — dejanske dolžine dokumentov, izmerjene 25. 9. 2026 (vrstni red prioritete:
// Razpisna dokumentacija, Javni razpis, Posebni pogoji, štirje krajši dokumenti).
{
    const dolzine = [151135, 48741, 40700, 10727, 3886, 3514, 1720];
    const meje = razdeliDokumentniBudget(dolzine, BUDGET);
    // Vseh šest krajših od Razpisne dokumentacije mora dobiti CELOTNO dolžino.
    assert.equal(meje[1], 48741, 'Javni razpis mora dobiti celotno dolžino');
    assert.equal(meje[2], 40700, 'Posebni pogoji morajo dobiti celotno dolžino');
    assert.equal(meje[3], 10727);
    assert.equal(meje[4], 3886);
    assert.equal(meje[5], 3514);
    assert.equal(meje[6], 1720);
    // Razpisna dokumentacija (najdaljša) dobi samo preostanek.
    const skupajKratki = 48741 + 40700 + 10727 + 3886 + 3514 + 1720;
    assert.equal(meje[0], BUDGET - skupajKratki, 'Razpisna dokumentacija dobi preostanek budgeta');
    assert.ok(meje[0] > 70000 && meje[0] < 71000, `RD naj bo ~70.800, je ${meje[0]}`);
    const skupaj = meje.reduce((a, b) => a + b, 0);
    assert.equal(skupaj, BUDGET, 'Vsota meja mora biti natanko enaka budgetu (noben znak ni izgubljen)');
    console.log('P7L 2026: OK — meje =', meje, '(vsota', skupaj, ')');
}

// 2) Vsi dokumenti kratki (skupaj precej pod budgetom) — noben ne sme biti odrezan.
{
    const dolzine = [500, 1200, 300, 2000, 900];
    const meje = razdeliDokumentniBudget(dolzine, BUDGET);
    for (let i = 0; i < dolzine.length; i++) {
        assert.equal(meje[i], dolzine[i], `dokument ${i} (kratek) se ne sme skrajšati`);
    }
    console.log('Vsi kratki: OK — meje =', meje);
}

// 3) En sam zelo dolg dokument — dobi cel budget (ne polovico, ne nič).
{
    const dolzine = [500000];
    const meje = razdeliDokumentniBudget(dolzine, BUDGET);
    assert.equal(meje[0], BUDGET, 'En sam dokument mora dobiti CEL budget, ne enakomeren "delež"');
    console.log('En sam dolg dokument: OK — meja =', meje[0]);
}

// 4) Dva dokumenta, oba dolga in približno enaka — vsak dobi polovico (kontrolni primer za
// prejšnji hrošč: to je EDINI primer, kjer je "budget / N" pravilen odgovor).
{
    const dolzine = [200000, 200000];
    const meje = razdeliDokumentniBudget(dolzine, BUDGET);
    assert.equal(meje[0], 90000);
    assert.equal(meje[1], 90000);
    console.log('Dva enako dolga:', meje);
}

console.log('\nVsi preizkusi uspešni.');
