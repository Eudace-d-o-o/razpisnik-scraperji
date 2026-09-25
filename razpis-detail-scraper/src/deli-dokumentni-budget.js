// Pravična delitev skupnega dokumentnega budgeta med dokumente razpisa.
//
// NAPAKA POPRAVKA 27aff83 (izmerjena 25. 9. 2026 na P7L 2026, po prenosu na Apify kot 0.1.28):
// prejšnja različica je delež vsakega dokumenta izračunala VNAPREJ, samo iz števila dokumentov v
// vrsti (budget / N), ne iz njihove dejanske dolžine. Kratki dokumenti (npr. rokovnik, pogosta
// vprašanja) so zato "rezervirali" enak delež kot dolgi, čeprav ga niso porabili, in ta prihranek
// se ni prenesel naprej — trije glavni dokumenti P7L 2026 (Razpisna dokumentacija, Javni razpis,
// Posebni pogoji) so dobili po ~25.800 znakov namesto skupno ~180.000. "Javni razpis" je dobil
// POLOVICO MANJ kot pred katerimkoli popravkom.
//
// PRAVILEN POSTOPEK (»water filling«, kratki dobijo celoto, dolgi si enakomerno delijo preostanek):
// 1. Dokumente razvrsti po DOLŽINI naraščajoče.
// 2. Za vsakega (od najkrajšega do najdaljšega): meja = min(njegova dolžina, preostanek / število
//    dokumentov, ki še niso dobili meje — vključno z njim). Ker je najkrajši na vrsti prvi, skoraj
//    vedno dobi svojo celotno dolžino (ta je manjša od takratnega povprečja) in neporabljeni del
//    svojega deleža PRENESE naslednjim, daljšim dokumentom.
// 3. Rezultat vrni v PRVOTNEM vrstnem redu, ne v razvrščenem.
//
// Čista funkcija (brez branja/mreže) — testirana ločeno v deli-dokumentni-budget.test.js.
export function razdeliDokumentniBudget(dolzine, budget) {
    const zRazporedom = dolzine.map((dolzina, izvirniIndeks) => ({ dolzina, izvirniIndeks }));
    zRazporedom.sort((a, b) => a.dolzina - b.dolzina);

    let preostanek = budget;
    const mejePoIzvirnemIndeksu = new Array(dolzine.length);
    for (let i = 0; i < zRazporedom.length; i++) {
        const steviloSePreostalih = zRazporedom.length - i;
        const delez = Math.floor(preostanek / steviloSePreostalih);
        const meja = Math.min(zRazporedom[i].dolzina, delez);
        mejePoIzvirnemIndeksu[zRazporedom[i].izvirniIndeks] = meja;
        preostanek -= meja;
    }
    return mejePoIzvirnemIndeksu;
}
