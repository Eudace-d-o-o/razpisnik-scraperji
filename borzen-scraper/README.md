# Borzen scraper (pravne osebe)

Zajema javne pozive in razpise na borzen.si, ki so namenjeni **pravnim osebam** (podjetjem in
občinam). Sheme izključno za fizične osebe (sončne elektrarne za gospodinjstva, e-kolesa,
hranilniki za fizične osebe, lesni peleti) so namerno izpuščene.

## Kako deluje

Borzen nima enotne strani s seznamom vseh razpisov, zato je seznam vstopnih strani ročno
vzdrževan v `src/main.js` (`VSTOPNE_STRANI`). Vstopne strani sta dve vrsti:

- **stran poziva** — sama je razpis; z nje preberemo naziv, besedilo, rok, sredstva in priponke;
- **kazalo** (`kazalo: true`) — samo našteva povezave do posameznih javnih pozivov. Kazalo
  **ne postane zapis v portalu**; scraper z njega prebere povezave in odpre posamezne pozive.

Kazali sta trenutno dve:

- `/podpore-za-zelene-investicije/nepovratna-sredstva`
- `/podpore-za-zelene-investicije/subvencije-za-hranilnike-elektricne-energije`

Zajemamo **odprte** pozive. Povezav, ki so na kazalu izrecno označene kot zaključene, ne
odpiramo (sicer bi vlekli cel Borzenov arhiv). Strani iz `VSTOPNE_STRANI` obdelamo vedno; če je
poziv medtem zaprt, dobi status `Zaprt`.

### Dvojniki

Portal ima ključ po `url`, borzen.si pa isti poziv postreže z več naslovov in med njimi
preusmerja (npr. `.../subvencije-za-polnilne-parke-izven-omrezja-ten-t` preusmeri na
`.../subvencije-za-polnilno-infrastrukturo-izven-omrezja-ten-t`). Zato scraper zapiše **končni
naslov po preusmeritvi** in vsak naslov obdela samo enkrat.

## Vzdrževanje

- Če Borzen objavi nov javni poziv za pravne osebe na novi vstopni strani, dodaj vrstico v
  `VSTOPNE_STRANI`. Če se poziv pojavi kot povezava na že vpisanem kazalu, ročno posredovanje
  ni potrebno — scraper ga najde sam.
- Če se kazalo preoblikuje in scraper na njem ne najde nobene povezave, v dnevnik zapiše
  `KAZALO BREZ POVEZAV: ...` z ravnjo ERROR. To je znak, da je treba pogledati selektorje.
- Statusa, roka in zneska sredstev **ne ugibamo**: rok se zapiše samo, kadar datum stoji ob
  izrazu o oddaji vloge (in ne ob roku za zaključek naložbe ali obdobju upravičenosti
  stroškov), znesek pa samo, kadar mu neposredno predhodi navedba razpoložljivih sredstev.
  Kadar pogoj ni izpolnjen, ostane polje prazno.

## Objava na Apify

Apify ob objavi zgradi novo verzijo iz `version` v `package.json`. Če oznaka ni `latest`,
zagoni tečejo po stari kodi — po objavi vedno preveri, da je zgrajena verzija označena kot
`latest` in da je actor nastavljen, da uporablja to oznako.
