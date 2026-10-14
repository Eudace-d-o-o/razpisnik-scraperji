// Preverba razbiranja roka iz angleških besedil. Primeri so dobesedni izseki s strani virov,
// prebranih 13. 10. 2026. Poženi: node _skupno/preizkus-datumi-en.js (izhod 1 ob napaki).
const { rokInStatus } = require('./datumi-en');

const dan = new Date(2026, 9, 13);
const primeri = [
    ['DUT 2026', 'DUT Call 2026 opened on 1 September 2026. The first stage opens on 1 September and closes on 17 November 2026 (13:00 CET). Stage 2 opens for full proposal submission in February 2027 and closes on 15 April 2027 13:00 (CEST)', '17.11.2026 Odprt'],
    ['CETP 2026', 'Joint Call 2026 launch event 26 May 2026 Opening for pre-proposal submission (Stage 1) 8 June 2026 14:00 (CEST) See more Joint Call 2026 Q&A Session 9 September 2026 10:00 (CEST) Deadline for pre-proposal submission (Stage 1) 8 October 2026 14:00 (CEST) Opening for full proposal submission (Stage 2) 8 January 2027 14:00 (CET) Deadline for full proposal submission 11 March 2027 14:00 (CET) Funding decision communicated 28 June 2027', '08.10.2026 Zaprt'],
    ['M-ERA.NET 2026', 'resulting in 116 research groups who are invited to submit a full-proposal by 18 November 2026. The M-ERA.NET Call 2026 has been launched on 4 March 2026', 'null Zaprt'],
    ['Biodiversa+', 'Pre-proposal deadline: 10 November 2026 , 12:00 (noon) CET. Full-proposal deadline: 16 April 2027 , 12:00', '10.11.2026 Odprt'],
    ['Water4All', 'Tentative timeline Call opening: 8 September 2026 Submission deadline of preproposals : 18 November 2026, 15:00 CET Selection of preproposals: Early February 2027 Submission deadline of full proposals: 6 April 2027', '18.11.2026 Odprt'],
    ['napovedan', 'The call opens on 17 December 2026 and the deadline is 4 March 2027.', '04.03.2027 Napovedan'],
    ['brez roka', 'More news 13 October 2026', 'null Ni razvidno'],
    ['DIANA', 'Innovators will be able to submit proposals to the challenges until 12:00 UTC on Friday 11 July 2025.', '11.07.2025 Zaprt'],
    ['SPS', 'Full proposals must be submitted 15 November 2026 (23:59 CET) via the SPS grant platform.', '15.11.2026 Odprt'],
    ['enofazni full', 'Deadline for full proposals: 3 December 2026', '03.12.2026 Odprt'],
    ['neobstoječ', 'Deadline: 31 September 2026', 'null Ni razvidno'],
];

let napak = 0;
for (const [ime, besedilo, pricakovano] of primeri) {
    const r = rokInStatus(besedilo, dan);
    const dobljeno = `${r.rok} ${r.status}`;
    const ok = dobljeno === pricakovano;
    if (!ok) napak++;
    console.log(`${ok ? 'OK    ' : 'NAPAKA'} ${ime}: ${dobljeno}${ok ? '' : ` (pričakovano ${pricakovano})`}${r.faza ? ` — ${r.faza}` : ''}`);
}
console.log(napak ? `${napak} napak` : 'vse preverbe uspešne');
process.exit(napak ? 1 : 0);
