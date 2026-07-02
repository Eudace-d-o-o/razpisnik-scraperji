# Borzen scraper (pravne osebe)

Zajema javne pozive/subvencije na borzen.si, ki so namenjeni **pravnim osebam** (podjetjem).
Sheme izključno za fizične osebe (npr. sončne elektrarne za gospodinjstva, e-kolesa,
lesni peleti) so namerno izpuščene — seznam ciljnih strani v `src/main.js` (`CILJNE_STRANI`)
je ročno pregledan in vsebuje samo sheme za pravne osebe.

## Namestitev / zagon (Apify Console)

1. Pojdi na [Apify Console](https://console.apify.com/) → **Actors** → **Create new** → **Upload ZIP**.
2. Naloži ta zip.
3. Actor se zgradi (build) samodejno — počakaj, da build uspe (zeleno "Ready").
4. Zaženi ga enkrat ročno ("Start"), preveri rezultate v **Dataset** (Storage → Dataset).
5. Sporoči Claude-u actor ID (npr. `tvoje-uporabnisko-ime/borzen-scraper`), da ga poveže s portalom.

## Vzdrževanje

Borzen nima enotne "seznam vseh razpisov" strani — seznam ciljnih URL-jev v
`CILJNE_STRANI` je treba občasno ročno preveriti (nove sheme, spremenjeni naslovi
strani). Če Borzen doda novo shemo za pravne osebe, dodaj vrstico v ta seznam.
