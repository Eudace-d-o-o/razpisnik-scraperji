# JSMGG scraper

Zajema javne razpise **Javnega sklada malega gospodarstva Goriške** (jsmgg.si) — brezobrestna
posojila za gospodarstvo in kmetijstvo v goriških občinah.

## Kako deluje

Stran teče na Drupalu in je strežniško izrisana, zato zadošča `fetch` + `cheerio` (brez
brskalnika). Zajem ima dva koraka:

1. **Seznamski strani** — `/aktualni-razpisi` in `/zakljuceni-razpisi`. Obe sta isti Drupal
   pogled, le v dveh prikazih. Z njiju vzamemo samo povezave do posameznih razpisov.
2. **Stran posameznega razpisa** — od tod preberemo vsa polja. Na seznamu razpoložljivih
   sredstev in priponk ni.

**Zaključene razpise beremo namenoma.** Ko se razpis zapre, izgine z aktualne strani, portal pa
zapisov sam ne briše — brez zaključene strani bi tak razpis v portalu za vedno ostal s statusom
»Odprt«.

### Listanje

Zaključeni razpisi so razdeljeni na strani po 5. Namesto na gumbe za listanje se zanašamo na
število, ki ga stran sama napove (»Število zapisov N«): beremo `?page=0,1,2…`, dokler ne zberemo
napovedanega števila. Če ga ne dosežemo, gre v dnevnik `NEPOPOLN SEZNAM: …` z ravnjo ERROR — to
je znak, da se je postavitev strani spremenila. Tiho zajeti pol vira je hujše od napake.

### Prijavni roki

JSMGG nima enega roka, ampak seznam presečnih datumov po letih:

> v letu 2026: 4. 9., 16. 10., 23. 11. - do 12.00 za vse navedene datume;
> v letu 2027: 8. 1., 12. 2., 19. 3., 23. 4., 21. 5., 3. 9. — oz. do porabe sredstev.

V polje `Rok prijave` gre **zadnji** presečni datum, torej dan, do katerega je razpis odprt; to
je rok, ki ga portal prikazuje in po katerem filtrira. Celotno besedilo rokov in prvi še
neiztekli rok (`Naslednji prijavni rok`) sta v polju `Vsebina`, da se pri delu s stranko vidita
oba podatka. Kadar iz besedila ni razvidnega nobenega datuma, ostane `Rok prijave` prazen —
roka ne ugibamo.

### Status in tip financiranja

Vir pozna oznake »Odprt«, »Zaključen« in »Rezultati«, portal pa Odprt/Zaprt/Napovedan. »Zaključen«
preslikamo v `Zaprt`, »Odprt« v `Odprt`, vse drugo ostane `Ni razvidno`.

`Tip financiranja` zapišemo kot `Kredit` samo takrat, kadar naziv razpisa vsebuje »posojil«.
JSMGG res daje izključno brezobrestna posojila, a če bi sklad kdaj objavil kaj drugega, tip ne
sme biti privzeto napačen.

## Izhodna polja

Sledijo generični pogodbi polj portala (`genericniMapper` v `pages/api/razpisi.js`):
`Naziv razpisa`, `URL`, `Status`, `Rok prijave`, `Datum zaznave`, `Sredstva`, `Vsebina`,
`Tip financiranja`, `Programme` (področje: Gospodarstvo/Kmetijstvo). Dodatno je v naboru še
`Datum objave` — za sledljivost, portal ga ne bere.

`Vsebina` je omejena na 2000 znakov in vsebuje področje, razpoložljiva sredstva, prijavne roke,
datum objave, datum zaključka, kontaktne informacije in seznam priponk (naslov in pot do
datoteke). Besedila razpisa na spletni strani ni — ta je samo v priloženih dokumentih.

## Preizkus

```
node test-lokalno.js            # prenese vzorce z jsmgg.si in razčleni vse razpise
node test-lokalno.js <mapa>     # razčleni shranjena aktualni.html in zakljuceni.html, brez omrežja
```

## Vzdrževanje

- Če scraper na seznamski strani ne najde nobene povezave, v dnevnik zapiše
  `SEZNAM BREZ POVEZAV: …` z ravnjo ERROR — takrat poglej selektorje (`.view-razpisi .views-row`,
  `.views-field-title a`).
- Če se spremeni ime polj na strani razpisa (`field--name-field-razpolozljiva-sredstva`,
  `field--name-field-prijavni-roki`, `field--name-field-status-razpisa`), zapisi ostanejo, a
  brez teh podatkov — zato po vsaki spremembi strani preveri izpis `zajetih N razpisov`.

## Objava na Apify

Actor se gradi iz tega repozitorija (Git repository, Base directory `jsmgg-scraper`). Po objavi
preveri, da je zgrajena verzija označena kot `latest` in da actor uporablja to oznako — sicer
zagoni tiho tečejo po stari kodi.
