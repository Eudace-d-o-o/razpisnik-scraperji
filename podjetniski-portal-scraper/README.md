# Podjetniški portal scraper

Zajema razpise s **Podjetniškega portala** (podjetniski-portal.si), ki ga vodi SPIRIT Slovenija.
Portal je **zbirnik**: razpise prepisuje od skladov, agencij, ministrstev in občin. Vreden je zaradi
izdajateljev, ki jih drugače ne zajemamo (občine, regionalni razvojni centri, Zavod za
zaposlovanje), in zaradi napovedi v tedenskem priročniku.

## Kaj bere

1. **Seznam razpisov** `/razpisi?year=<leto>&page=<n>` za tekoče in preteklo leto. Preteklo leto
   zato, ker bi bil seznam januarja sicer skoraj prazen, lanski razpisi pa so še odprti. Objav,
   starejših od 400 dni, ne beremo.
2. **Tedenski priročnik** `/moj-spletni-prirocnik/clanki`, samo razdelek **Finančne spodbude**.
   Ostali razdelki so dogodki, predpisi in novice. Tu izidejo napovedi, ki jih na seznamu razpisov
   še ni (primer 6. 10. 2026: IF26 SME Call Sklada za inovacije, objava predvidena decembra).

Vsa polja beremo s strani posameznega razpisa. Polja so odstavki z odebeljeno oznako
(`<p><b>Rok:</b> …</p>`).

## Rok in stanje

Polje »Rok« je prosto besedilo. Pravila, izmerjena na 38 razpisih s seznama (6. 10. 2026):

- več datumov (presečni roki, »do porabe sredstev, skrajni rok …«): rok je **zadnji**;
- besedilo pove samo začetek (»Prijava se začne 27. 7. 2026«): to ni rok; razpis je napovedan, če
  začetek še prihaja, sicer stanja ne poznamo (`Ni razvidno`) in ne ugibamo, da je odprt;
- brez datuma: `Ni razvidno`;
- članek priročnika brez roka, ki napoveduje objavo: `Napovedan`.

## Izhodna polja

Generična pogodba portala (`genericniMapper` v `pages/api/razpisi.js`): `Naziv razpisa`, `URL`,
`Status`, `Rok prijave`, `Datum zaznave`, `Sredstva`, `Vsebina`, `Tip financiranja`, `Programme`
(izdajatelj).

Dodatno: `Izdajatelj`, `Izvorna domena`, `Izvorni URL`, `Datum objave`, `Vrsta objave`. Po
`Izvorni domeni` in nazivu portal ob uvozu **izloči razpise, ki jih že zajemamo neposredno pri
izdajatelju** (`lib/zajem-agregator.js` v portalu). Meritev 6. 10. 2026: od 40 razpisov na seznamu
(april–oktober 2026) jih je 20 že bilo v bazi iz drugih virov.

## Preizkus

`node test-lokalno.js` razčleni shranjene vzorce v mapi `vzorci/` (zajeti prek Apify, brez
omrežja) z istimi funkcijami, kot teče actor.
