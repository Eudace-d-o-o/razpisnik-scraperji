<?php
/**
 * Plugin Name: Eudace — Razpisi tabela v2
 * Description: Shortcode [eudace_razpisi] — javna tabela razpisov, V CELOTI iz portala razpisnik (osnutki, kuriranje na portalu). Filtri, iskalnik po projektu, lead obrazec. Povezave na razpis.eu podstrani po naslovu.
 * Version: 2.2
 * Author: Eudace
 */

if (!defined('ABSPATH')) exit;

/* Portal = backend (odločitev 2026-07-20). Za TEST staging; ob objavi zamenjaj v 'https://razpisnik.eu'. */
if (!defined('EUDACE_PORTAL_URL')) define('EUDACE_PORTAL_URL', 'https://staging.razpisnik.eu');

function eudace_norm($s) {
    $s = function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : strtolower($s);
    $s = strtr($s, ['č'=>'c','ć'=>'c','š'=>'s','ž'=>'z','đ'=>'d']);
    $s = preg_replace('/[^a-z0-9]+/', ' ', $s);
    return trim($s);
}

/* podatki tabele iz portala (kurirani osnutki), keš 10 min */
function eudace_tabela_podatki() {
    $c = get_transient('eudace_tabela_v2');
    if ($c !== false) return $c;
    $out = [];
    $r = wp_remote_get(EUDACE_PORTAL_URL . '/api/javno/tabela', ['timeout' => 12]);
    if (!is_wp_error($r) && wp_remote_retrieve_response_code($r) == 200) {
        $j = json_decode(wp_remote_retrieve_body($r), true);
        if (!empty($j['ok']) && !empty($j['razpisi'])) $out = $j['razpisi'];
    }
    set_transient('eudace_tabela_v2', $out, 10 * MINUTE_IN_SECONDS);
    return $out;
}

/* povezave na razpis.eu podstrani: norm(naslov) -> permalink objavljenih "razpis" CPT */
function eudace_wp_povezave() {
    $c = get_transient('eudace_tabela_povezave');
    if ($c !== false) return $c;
    $map = [];
    $q = new WP_Query(['post_type' => 'razpis', 'post_status' => 'publish', 'posts_per_page' => 500, 'no_found_rows' => true, 'fields' => 'ids']);
    foreach ($q->posts as $pid) {
        $map[eudace_norm(get_the_title($pid))] = get_permalink($pid);
    }
    set_transient('eudace_tabela_povezave', $map, 10 * MINUTE_IN_SECONDS);
    return $map;
}
add_action('save_post_razpis', function(){ delete_transient('eudace_tabela_povezave'); delete_transient('eudace_tabela_v2'); });

function eudace_razpisi_shortcode($atts) {
    $podatki = eudace_tabela_podatki();
    $povezave = eudace_wp_povezave();

    $razpisovalci = []; $zbrani = [];
    $zdaj = time();

    foreach ($podatki as $p) {
        $naslov = isset($p['naslov']) ? $p['naslov'] : '';
        if ($naslov === '') continue;
        $status = isset($p['status']) ? $p['status'] : 'odprt';
        $tip = (isset($p['tip']) && $p['tip'] === 'kredit') ? 'kredit' : 'nepovratna';
        $tipLabel = $tip === 'kredit' ? 'Ugodni kredit' : 'Nepovratna sredstva';
        $razpisovalec = isset($p['razpisovalec']) ? (string) $p['razpisovalec'] : '';
        if ($razpisovalec) $razpisovalci[$razpisovalec] = true;
        $opis = isset($p['opis']) ? (string) $p['opis'] : '';

        $rokPrikaz = isset($p['rok']) ? (string) $p['rok'] : '';
        $rokTs = 0;
        if (!empty($p['rok_iso'])) { $t = strtotime($p['rok_iso']); if ($t) $rokTs = $t; }

        // povezava na razpis.eu podstran (če objavljena); sicer naslov brez povezave
        $kljuc = isset($p['kljuc']) ? $p['kljuc'] : eudace_norm($naslov);
        $url = isset($povezave[$kljuc]) ? $povezave[$kljuc] : '';

        $statusMap = ['odprt'=>'Odprt','zaprt'=>'Zaprt','napovedan'=>'Napovedan'];
        $statusLabel = isset($statusMap[$status]) ? $statusMap[$status] : 'Odprt';

        $dniHtml = '';
        if ($status === 'odprt' && $rokTs > $zdaj) {
            $dni = (int) ceil(($rokTs - $zdaj) / 86400);
            if ($dni <= 30) $dniHtml = '<span class="er-dni' . ($dni <= 7 ? ' er-dni-r' : '') . '">še ' . $dni . ' dni</span>';
        }

        if ($status === 'odprt') {
            $ctaHtml = '<button type="button" class="er-cta" data-intent="povprasevanje" data-naziv="' . esc_attr($naslov) . '" data-url="' . esc_url($url) . '">Preveri upravičenost</button>';
        } else {
            $ctaHtml = '<button type="button" class="er-cta er-cta-o" data-intent="obvesti" data-naziv="' . esc_attr($naslov) . '" data-url="' . esc_url($url) . '">Obvesti me</button>';
        }

        $nazivHtml = $url
            ? '<a class="er-naziv" href="' . esc_url($url) . '">' . esc_html($naslov) . '</a>'
            : '<span class="er-naziv er-naziv-nl">' . esc_html($naslov) . '</span>';

        $iskalno = mb_substr(eudace_norm($naslov . ' ' . $opis . ' ' . $razpisovalec . ' ' . $tipLabel), 0, 500);

        $html = '<tr data-tip="' . $tip . '" data-status="' . $status . '" data-razpisovalec="' . esc_attr($razpisovalec) . '"'
            . ' data-rokts="' . $rokTs . '" data-txt="' . esc_attr($iskalno) . '">'
            . '<td class="er-c-naziv er-' . $tip . '">' . $nazivHtml
            . ($opis ? '<div class="er-kat">' . esc_html($opis) . '</div>' : '') . '</td>'
            . '<td><span class="er-badge er-b-' . $tip . '">' . $tipLabel . '</span></td>'
            . '<td class="er-c-razp">' . ($razpisovalec ? esc_html($razpisovalec) : '—') . '</td>'
            . '<td class="er-c-rok">' . ($rokPrikaz ? esc_html($rokPrikaz) : '<span class="er-nd">—</span>') . $dniHtml . '</td>'
            . '<td><span class="er-st er-st-' . $status . '">' . $statusLabel . '</span></td>'
            . '<td class="er-c-cta">' . $ctaHtml . '</td>'
            . '</tr>';

        $statusRed = ($status === 'zaprt') ? 2 : (($status === 'napovedan') ? 1 : 0);
        $zbrani[] = ['red' => $statusRed, 'rok' => $rokTs ? $rokTs : PHP_INT_MAX, 'html' => $html];
    }

    usort($zbrani, function($a, $b) {
        if ($a['red'] !== $b['red']) return $a['red'] - $b['red'];
        return $a['rok'] <=> $b['rok'];
    });
    $vrstice = implode('', array_column($zbrani, 'html'));

    ksort($razpisovalci);
    $razpOpt = '<option value="">Vsi razpisovalci</option>';
    foreach (array_keys($razpisovalci) as $rz) $razpOpt .= '<option value="' . esc_attr($rz) . '">' . esc_html($rz) . '</option>';

    $portal = esc_js(EUDACE_PORTAL_URL);
    ob_start(); ?>
<div class="er-wrap">
<style>
.er-wrap{--m:#1c5fa8;--md:#144a86;--navy:#16324f;--g:#f3b108;--gh:#d99f06;--tint:#f3f8fd;--rob:#d7e4f3;--siva:#5b6f83;--zel:#2f8f5b;--zelbg:#e7f4ec;--krbg:#e7f1fb;--amber:#a9741a;--amberbg:#fbf1dc;--sivbg:#eef1f5;color:var(--navy);font-family:inherit}
.er-wrap .er-finder{background:linear-gradient(180deg,#eaf3fc,#f6f9fd);border:1px solid var(--rob);border-radius:12px;padding:16px 18px;margin:0 0 16px}
.er-f-nas{font-size:16px;font-weight:800;color:var(--md);margin-bottom:10px}
.er-wrap .er-finder textarea{width:100%!important;font:inherit!important;font-size:14.5px!important;padding:10px 12px!important;border:1px solid #cddcee!important;border-radius:8px!important;background:#fff!important;color:var(--navy)!important;box-sizing:border-box!important;resize:vertical;min-height:56px}
.er-wrap .er-finder textarea:focus{outline:2px solid var(--m)!important;outline-offset:1px}
.er-f-akc{display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap}
.er-f-res{font-size:14px;font-weight:700;color:var(--md)}
.er-f-cta{margin-top:12px;padding:12px 14px;background:#fff;border:1px solid var(--rob);border-radius:10px;font-size:14.5px;color:var(--navy);display:flex;gap:12px;align-items:center;flex-wrap:wrap}
tr.er-zadetek td.er-c-naziv{border-left-color:var(--g)!important}
.er-oc{display:inline-block;margin-left:8px;font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:20px;background:#fdf3d7;color:#8a6508;white-space:nowrap}
.er-wrap .er-filtri{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:0 0 18px;background:#f6f9fd;border:1px solid var(--rob);border-radius:12px;padding:12px 14px}
.er-wrap .er-filtri input,.er-wrap .er-filtri select{font:inherit!important;font-size:14.5px!important;height:44px!important;padding:0 14px!important;border:1px solid #cddcee!important;border-radius:8px!important;background:#fff!important;color:var(--navy)!important;margin:0!important;box-shadow:none!important;max-width:none!important;line-height:1.2!important}
.er-wrap .er-filtri input{flex:1 1 240px!important;min-width:200px!important}
.er-wrap .er-filtri select{flex:0 0 auto!important;width:auto!important;min-width:150px!important;cursor:pointer}
.er-wrap .er-filtri input:focus,.er-wrap .er-filtri select:focus{outline:2px solid var(--m)!important;outline-offset:1px;border-color:var(--m)!important}
.er-count{font-size:13px;color:var(--siva);margin-left:auto;white-space:nowrap;font-weight:600}
.er-scroll{overflow-x:auto;border:1px solid var(--rob);border-radius:12px}
.er-tab{border-collapse:collapse;width:100%;font-size:14.5px;min-width:760px}
.er-tab thead th{background:var(--m);color:#fff;text-align:left;font-weight:600;padding:12px 14px;white-space:nowrap;font-size:13.5px}
.er-tab thead th.er-sortable{cursor:pointer;user-select:none}
.er-tab thead th.er-sortable:hover{background:var(--md)}
.er-tab td{padding:14px 16px;border-top:1px solid var(--rob);vertical-align:middle}
.er-tab tbody tr:nth-child(even) td{background:var(--tint)}
.er-tab tbody tr:hover td{background:#e7f1fb}
.er-c-naziv{border-left:4px solid var(--zel)}
.er-c-naziv.er-kredit{border-left-color:var(--m)}
.er-naziv{font-weight:700;color:var(--m);text-decoration:none}
a.er-naziv:hover{text-decoration:underline}
.er-naziv-nl{color:var(--navy)}
.er-kat{color:var(--siva);font-size:12.5px;margin-top:3px}
.er-badge{display:inline-block;font-size:12px;font-weight:700;padding:2px 9px;border-radius:20px;white-space:nowrap}
.er-b-nepovratna{background:var(--zelbg);color:var(--zel)} .er-b-kredit{background:var(--krbg);color:var(--m)}
.er-c-razp{color:var(--navy);font-size:13.5px}
.er-c-rok{white-space:nowrap;font-variant-numeric:tabular-nums} .er-nd{color:var(--siva)}
.er-st{display:inline-block;font-size:12px;font-weight:700;padding:2px 9px;border-radius:20px;white-space:nowrap}
.er-st-odprt{background:var(--zelbg);color:var(--zel)} .er-st-zaprt{background:var(--sivbg);color:var(--siva)} .er-st-napovedan{background:var(--amberbg);color:var(--amber)}
.er-cta{background:var(--g);color:#fff;font-weight:700;font-size:14px;padding:9px 15px;border:none;border-radius:8px;cursor:pointer;white-space:nowrap}
.er-cta:hover{background:var(--gh)}
.er-cta-o{background:#fff;color:var(--m);border:2px solid var(--m);padding:7px 13px}
.er-cta-o:hover{background:var(--krbg)}
.er-dni{display:inline-block;margin-left:8px;font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:20px;background:var(--amberbg);color:var(--amber);white-space:nowrap}
.er-dni-r{background:#fdecea;color:#c0392b}
.er-pokazi{margin-top:10px;background:var(--m);color:#fff;border:none;border-radius:8px;padding:9px 16px;cursor:pointer;font-size:14px;font-weight:700}
.er-prazno{padding:24px;text-align:center;color:var(--siva);display:none}
.er-modal{position:fixed;inset:0;background:rgba(16,40,70,.55);display:none;align-items:center;justify-content:center;z-index:99999;padding:16px}
.er-modal.on{display:flex}
.er-box{background:#fff;border-radius:14px;max-width:460px;width:100%;padding:24px;max-height:90vh;overflow:auto}
.er-box h3{margin:0 0 4px;font-size:20px} .er-za{font-size:14px;color:var(--siva);margin:0 0 8px}
.er-box label{display:block;font-size:13px;font-weight:600;margin:10px 0 4px}
.er-box input,.er-box textarea{width:100%;font:inherit;font-size:15px;padding:10px 12px;border:1px solid #bcd3ea;border-radius:8px;box-sizing:border-box}
.er-box textarea{min-height:66px}
.er-sog{display:flex;gap:8px;align-items:flex-start;margin:14px 0 4px;font-size:13px;color:var(--siva)} .er-sog input{width:auto;margin-top:3px}
.er-hp{position:absolute;left:-9999px}
.er-akc{display:flex;gap:10px;margin-top:16px}
.er-poslji{background:var(--g);color:#fff;font-weight:700;font-size:15px;padding:11px 18px;border:none;border-radius:8px;cursor:pointer;flex:1}
.er-preklic{background:#eef3f8;color:var(--navy);border:none;border-radius:8px;padding:11px 16px;cursor:pointer;font-size:15px}
.er-msg{font-size:14px;margin-top:12px}
@media(max-width:600px){.er-cta{padding:8px 12px;font-size:13px}}
</style>

<div class="er-finder">
  <style>@keyframes er-spin{to{transform:rotate(360deg)}}.er-spin{display:inline-block;width:16px;height:16px;border:2px solid #e2b06a;border-top-color:transparent;border-radius:50%;animation:er-spin .7s linear infinite;flex:0 0 auto}</style>
  <div class="er-f-nas">🎯 Poiščite razpise za vašo naložbo</div>
  <div style="font-size:13px;color:#4a5568;margin:2px 0 8px">Vnesite davčno številko in osnovne podatke o naložbi — samodejno preverimo, kateri razpisi so za vas primerni (upoštevamo velikost, regijo in dejavnost podjetja).</div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
    <input id="erdav" type="text" inputmode="numeric" maxlength="8" placeholder="Davčna številka (8 mest) *" style="flex:1 1 180px;padding:9px 11px;border:1px solid #cfd6e0;border-radius:8px;font-size:14px">
    <select id="ertipinv" style="flex:1 1 200px;padding:9px 11px;border:1px solid #cfd6e0;border-radius:8px;font-size:14px">
      <option value="">Tip investicije… *</option>
      <option>Gradnja / nepremičnina</option>
      <option>Nakup stroja / opreme</option>
      <option>RRI / razvoj</option>
      <option>Digitalizacija</option>
      <option>Zaposlovanje</option>
      <option>Obratna sredstva</option>
      <option>Zeleni prehod / URE</option>
    </select>
    <input id="ervis" type="text" placeholder="Višina investicije (npr. 200.000 €)" style="flex:1 1 180px;padding:9px 11px;border:1px solid #cfd6e0;border-radius:8px;font-size:14px">
  </div>
  <textarea id="eropis" rows="2" placeholder="Neobvezno: na kratko o naložbi (kaj kupujete/gradite)"></textarea>
  <div class="er-f-akc">
    <button type="button" id="erfind" class="er-cta">Poišči primerne razpise</button>
    <button type="button" id="erfreset" class="er-preklic" style="display:none">Ponastavi</button>
    <span class="er-f-res" id="erfres"></span>
  </div>
  <div id="ervodrez" style="margin-top:10px"></div>
  <div class="er-f-cta" id="erfcta" style="display:none">
    Želite, da svetovalec <b>brezplačno preveri upravičenost</b> in pomaga pri prijavi?
    <button type="button" class="er-cta" id="erflead">Pustite kontakt</button>
  </div>
</div>

<div class="er-filtri">
  <input id="erq" type="text" placeholder="Iščite razpis…">
  <select id="ertip"><option value="">Vsi tipi</option><option value="nepovratna">Nepovratna sredstva</option><option value="kredit">Ugodni krediti</option></select>
  <select id="erstat"><option value="odprt" selected>Odprti razpisi</option><option value="napovedan">Napovedani</option><option value="zaprt">Zaprti</option><option value="">Vsi statusi</option></select>
  <select id="errazp"><?php echo $razpOpt; ?></select>
  <span class="er-count" id="erc"></span>
</div>

<div class="er-scroll">
<table class="er-tab">
<thead><tr><th>Razpis</th><th>Tip sredstev</th><th>Razpisovalec</th><th class="er-sortable" id="ersort">Rok oddaje ↕</th><th>Status</th><th></th></tr></thead>
<tbody id="erb"><?php echo $vrstice; ?></tbody>
</table>
</div>
<div class="er-prazno" id="erp">Za izbrane pogoje ni razpisov.<br><button type="button" class="er-pokazi" id="ervse">Pokaži vse razpise</button></div>

<div class="er-modal" id="erm" role="dialog" aria-modal="true">
<div class="er-box"><h3 id="ernaslov">Preverimo vašo upravičenost — brezplačno</h3><p class="er-za" id="erza"></p><p class="er-za" id="erpod"></p>
<form id="erf">
<label>Ime in priimek</label><input name="ime" type="text">
<label>E-pošta *</label><input name="email" type="email" required>
<label>Telefon</label><input name="telefon" type="tel">
<label>Podjetje</label><input name="podjetje_naziv" type="text">
<label>Na kratko o vašem projektu</label><textarea name="projekt_opis" placeholder="Kaj načrtujete? (naložba, razvoj, zaposlitev …)"></textarea>
<input class="er-hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
<label class="er-sog"><input id="ersog" type="checkbox"> Strinjam se, da me Eudace kontaktira glede financiranja mojega projekta.</label>
<div class="er-akc"><button type="submit" class="er-poslji" id="ers">Pošlji povpraševanje</button><button type="button" class="er-preklic" id="erx">Prekliči</button></div>
<div class="er-msg" id="ermsg"></div></form></div></div>

<script>
(function(){
var PORTAL="<?php echo $portal; ?>";
var q=document.getElementById('erq'),tip=document.getElementById('ertip'),stat=document.getElementById('erstat'),
razp=document.getElementById('errazp'),b=document.getElementById('erb'),c=document.getElementById('erc'),
p=document.getElementById('erp'),rows=[].slice.call(b.querySelectorAll('tr')),tb=null,sortDir=0;
function f(){var s=q.value.toLowerCase().trim(),t=tip.value,st=stat.value,rz=razp.value,v=0;
rows.forEach(function(r){var ok=(!s||r.getAttribute('data-txt').indexOf(s)>-1)&&(!t||r.getAttribute('data-tip')===t)&&(!st||r.getAttribute('data-status')===st)&&(!rz||r.getAttribute('data-razpisovalec')===rz);
r.style.display=ok?'':'none';if(ok)v++;});c.textContent=v+' razpisov';p.style.display=v?'none':'block';
if(s.length>=3){clearTimeout(tb);tb=setTimeout(function(){try{fetch(PORTAL+'/api/javno/razpisi?search='+encodeURIComponent(s),{mode:'no-cors'});}catch(e){}},900);}}
[q,tip,stat,razp].forEach(function(e){e.addEventListener('input',f);});f();
document.getElementById('ersort').addEventListener('click',function(){sortDir=sortDir===1?-1:1;
var arr=rows.slice().sort(function(a,bb){var x=+a.getAttribute('data-rokts')||0,y=+bb.getAttribute('data-rokts')||0;
if(x===0)return 1;if(y===0)return -1;return sortDir*(x-y);});arr.forEach(function(r){b.appendChild(r);});
this.textContent='Rok oddaje '+(sortDir===1?'↑':'↓');});
document.getElementById('ervse').addEventListener('click',function(){q.value='';tip.value='';stat.value='';razp.value='';f();});

var fin=document.getElementById('erfind'),fres=document.getElementById('erfres'),
frst=document.getElementById('erfreset'),fcta=document.getElementById('erfcta'),
edav=document.getElementById('erdav'),etip=document.getElementById('ertipinv'),
evis=document.getElementById('ervis'),eop=document.getElementById('eropis'),
vodrez=document.getElementById('ervodrez'),zadnjiOpis='',topZadetki=[];
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch];});}
function poisci(){
  var d=(edav.value||'').replace(/\D/g,'');
  if(d.length!==8){fres.style.color='#c0392b';fres.textContent='Vnesite veljavno 8-mestno davčno številko.';return;}
  if(!etip.value){fres.style.color='#c0392b';fres.textContent='Izberite tip investicije.';return;}
  fres.style.color='#4a5568';fres.textContent='';fin.disabled=true;fin.textContent='⏳ Iščem…';fcta.style.display='none';
  vodrez.innerHTML='<div style="display:flex;align-items:center;gap:10px;padding:14px 16px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;color:#4a5568;font-size:14px"><span class="er-spin"></span> Iščem primerne razpise za vašo naložbo… (nekaj sekund)</div>';
  zadnjiOpis=(etip.value+' '+(evis.value||'')+' '+(eop.value||'')).trim();
  fetch(PORTAL+'/api/javno/ujemanje-vodeno',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({dav:d,tip_investicije:etip.value,visina_investicije:evis.value,opis:eop.value})})
  .then(function(r){return r.json().then(function(x){return {status:r.status,body:x};});})
  .then(function(o){
    fin.disabled=false;fin.textContent='Poišči primerne razpise';frst.style.display='';
    if(o.status===429){vodrez.innerHTML='';fres.style.color='#c0392b';fres.textContent=(o.body&&o.body.error)||'Preveč zahtev — počakajte minuto.';return;}
    var x=o.body;
    if(!x||!x.ok){vodrez.innerHTML='';fres.style.color='#c0392b';fres.textContent=(x&&x.error)||'Napaka pri iskanju.';return;}
    var glava=x.podjetje?('Za '+esc(x.podjetje.naziv)+' ('+esc(x.podjetje.velikost)+(x.podjetje.kohezija?', '+esc(x.podjetje.kohezija):'')+')'):'Za vaše podjetje';
    if(!x.razpisi||!x.razpisi.length){
      vodrez.innerHTML='';fres.style.color='#8a6428';fres.textContent=glava+' med objavljenimi razpisi trenutno ni neposrednega ujemanja — pustite kontakt in svetovalec preveri možnosti.';
      topZadetki=[];fcta.style.display='flex';return;
    }
    topZadetki=x.razpisi.slice(0,5).map(function(rz){return rz.naziv;});
    fres.style.color='#2f8f5b';fres.textContent='✓ '+glava+' smo našli '+x.razpisi.length+' primernih razpisov:';
    var html='';
    x.razpisi.forEach(function(rz){
      html+='<div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;margin-bottom:8px;background:#fff">'
        +'<div style="font-weight:600;color:#1a3a5c">'+esc(rz.naziv)+(rz.ocena?' <span style="font-size:12px;color:#2f8f5b">'+rz.ocena+'%</span>':'')+'</div>'
        +(rz.obrazlozitev?'<div style="font-size:13px;color:#4a5568;margin-top:3px">'+esc(rz.obrazlozitev)+'</div>':'')
        +(rz.rok?'<div style="font-size:12px;color:#8a94a6;margin-top:3px">Rok oddaje: '+esc(rz.rok)+'</div>':'')
        +'</div>';
    });
    vodrez.innerHTML=html;fcta.style.display='flex';
  }).catch(function(){fin.disabled=false;fin.textContent='Poišči primerne razpise';vodrez.innerHTML='';fres.style.color='#c0392b';fres.textContent='Napaka pri povezavi.';});
}
fin.addEventListener('click',poisci);
frst.addEventListener('click',function(){edav.value='';etip.value='';evis.value='';eop.value='';fres.textContent='';vodrez.innerHTML='';fcta.style.display='none';frst.style.display='none';zadnjiOpis='';topZadetki=[];});

var m=document.getElementById('erm'),za=document.getElementById('erza'),fo=document.getElementById('erf'),
msg=document.getElementById('ermsg'),ss=document.getElementById('ers'),nasl=document.getElementById('ernaslov'),
pod=document.getElementById('erpod'),cur={n:'',u:'',i:'povprasevanje'};
b.addEventListener('click',function(e){var t=e.target.closest('.er-cta');if(t){
cur={n:t.getAttribute('data-naziv'),u:t.getAttribute('data-url'),i:t.getAttribute('data-intent')||'povprasevanje'};
za.textContent=cur.n;msg.textContent='';
if(cur.i==='obvesti'){nasl.textContent='Obvestite me, ko bo razpis odprt';pod.textContent='Sporočimo vam ob (ponovnem) odprtju in brezplačno preverimo, ali vaše podjetje izpolnjuje pogoje.';}
else{nasl.textContent='Preverimo vašo upravičenost — brezplačno';pod.textContent='Naši svetovalci preverijo, ali vaše podjetje izpolnjuje pogoje razpisa, in vam svetujejo pri prijavi. Brez obveznosti.';}
m.classList.add('on');}});
document.getElementById('erflead').addEventListener('click',function(){
  cur={n:topZadetki[0]||'',u:'',i:'projekt'};
  za.textContent=topZadetki.length?('Primerni razpisi: '+topZadetki.slice(0,3).join(' · ')):'';
  nasl.textContent='Brezplačna preverba upravičenosti za vaš projekt';
  pod.textContent='Svetovalec pregleda vaš projekt in vam predlaga najprimernejše razpise ter pogoje. Brez obveznosti.';
  fo.querySelector('[name=projekt_opis]').value=zadnjiOpis;
  msg.textContent='';m.classList.add('on');});
document.getElementById('erx').addEventListener('click',function(){m.classList.remove('on');});
m.addEventListener('click',function(e){if(e.target===m)m.classList.remove('on');});
fo.addEventListener('submit',function(e){e.preventDefault();
if(!document.getElementById('ersog').checked){msg.style.color='#c0392b';msg.textContent='Potrebujemo vaše soglasje za kontakt.';return;}
var d=new FormData(fo),op=d.get('projekt_opis')||'';
if(cur.i==='obvesti')op='[ČAKALNA LISTA — obvesti ob odprtju] '+op;
var pl={ime:d.get('ime'),email:d.get('email'),telefon:d.get('telefon'),podjetje_naziv:d.get('podjetje_naziv'),projekt_opis:op,website:d.get('website'),soglasje:true,razpis_interes_naziv:cur.n,razpis_interes_url:cur.u,iskani_pojmi:zadnjiOpis||'',ujemanje:(topZadetki&&topZadetki.length)?topZadetki:null};
ss.disabled=true;msg.style.color='';msg.textContent='Pošiljam…';
fetch(PORTAL+'/api/javno/lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pl)}).then(function(r){return r.json();}).then(function(x){
if(x&&x.ok){fo.reset();msg.style.color='#2f8f5b';msg.textContent=cur.i==='obvesti'?'Hvala! Obvestimo vas ob odprtju razpisa.':'Hvala! Odzovemo se v enem delovnem dnevu.';setTimeout(function(){m.classList.remove('on');},2500);}
else{msg.style.color='#c0392b';msg.textContent=(x&&x.error)||'Napaka pri pošiljanju.';}}).catch(function(){msg.style.color='#c0392b';msg.textContent='Napaka pri povezavi.';}).finally(function(){ss.disabled=false;});});
})();
</script>
</div>
    <?php
    return ob_get_clean();
}
add_shortcode('eudace_razpisi', 'eudace_razpisi_shortcode');
