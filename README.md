# razpisnik-scraperji

Skupni repozitorij za Apify scraperje, ki napajajo razpisnik-portal z razpisi/subvencijami.
Vsak scraper je v svoji podmapi in se v Apify Console poveže kot ločen Actor z ustrezno
nastavljeno "Base directory" (Git integration → Base directory = ime podmape).

## Scraperji

- **`borzen-scraper/`** — javni pozivi/subvencije Borzen (samo pravne osebe). Glej README v podmapi.
- SPS, ARIS, EU scraperji trenutno obstajajo samo kot že objavljeni Apify actorji
  (`enviable_motivation/sps-scraper`, `enviable_motivation/aris-scraper`,
  `enviable_motivation/eu-razpisi-scraper`) — njihova izvorna koda (še) ni v tem repoju.
  Če se doda, gre v ločeno podmapo po istem vzorcu kot `borzen-scraper/`.

## Povezava z Apify

V Apify Console pri ustvarjanju/urejanju Actorja izberi vir "Git repository", vnesi URL
tega repozitorija, in pod "Advanced" nastavi **Base directory** na ime ustrezne podmape
(npr. `borzen-scraper`). Apify bo ob vsakem pushu na `main` samodejno zgradil Actor iz te podmape.

## Mednarodni in dodatni viri (13. 10. 2026)

Vsak je samostojen actor v svoji podmapi, gradi se iz GitHuba (Base directory = ime podmape):
`eureka-scraper`, `interreg-keep-scraper` (javne strani keep.eu, s pripisom vira),
`evropskasredstva-scraper` (zbirnik, portal izloči že zajete), `eit-scraper`,
`partnerstva-obzorja-scraper` (DUT, Water4All, Biodiversa+, CETPartnership, M-ERA.NET), `jak-scraper`,
`nato-scraper` (SPS in DIANA; diana.nato.int je zaprt s preverbo Cloudflare, zato prek nato.int).
Angleški actorji si delijo `src/datumi-en.js`; izvirnik in preverba sta v `_skupno/`
(`node _skupno/preizkus-datumi-en.js`). Ob popravku popravi vse kopije.
