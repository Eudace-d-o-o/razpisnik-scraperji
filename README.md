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
