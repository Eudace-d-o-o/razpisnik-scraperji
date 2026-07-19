<?php
/**
 * Plugin Name: Eudace — Razpisi tabela v1
 * Description: Shortcode [eudace_razpisi] — javna tabela razpisov (CPT "razpis") s filtri (tip, status, razpisovalec, rok), iskanjem in lead obrazcem. Strukturne podatke vleče iz portala (osnutki), tip/status iz kategorije. Server-side izris (SEO).
 * Version: 1.6
 * Author: Eudace
 */

if (!defined('ABSPATH')) exit;

/* Portal (leadi + metapodatki). Za TEST staging; ob objavi zamenjaj v 'https://razpisnik.eu'. */
if (!defined('EUDACE_PORTAL_URL')) define('EUDACE_PORTAL_URL', 'https://staging.razpisnik.eu');

/* normalizacija naziva (enaka kot portal osnutki-meta) */
function eudace_norm($s) {
    $s = function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : strtolower($s);
    $s = strtr($s, ['č'=>'c','ć'=>'c','š'=>'s','ž'=>'z','đ'=>'d']);
    $s = preg_replace('/[^a-z0-9]+/', ' ', $s);
    return trim($s);
}

/* ACF/portal datum -> "d.m.Y" + timestamp; vrne [prikaz, ts] */
function eudace_datum($raw) {
    if (!$raw) return ['', 0];
    if (preg_match('/^(\d{1,2})\.(\d{1,2})\.(\d{4})/', $raw, $m)) {
        return [sprintf('%02d.%02d.%04d', $m[1], $m[2], $m[3]), mktime(0,0,0,$m[2],$m[1],$m[3])];
    }
    if (preg_match('/^(\d{4})(\d{2})(\d{2})$/', $raw, $m)) return ["$m[3].$m[2].$m[1]", mktime(0,0,0,$m[2],$m[3],$m[1])];
    $ts = strtotime($raw);
    return $ts ? [date('d.m.Y', $ts), $ts] : [esc_html($raw), 0];
}

/* metapodatki iz portala (razpisovalec/rok/status/sredstva), keširano 30 min, ključ = norm(naziv) */
function eudace_portal_meta() {
    $c = get_transient('eudace_razpisi_meta');
    if ($c !== false) return $c;
    $map = [];
    $r = wp_remote_get(EUDACE_PORTAL_URL . '/api/javno/osnutki-meta', ['timeout' => 12]);
    if (!is_wp_error($r) && wp_remote_retrieve_response_code($r) == 200) {
        $j = json_decode(wp_remote_retrieve_body($r), true);
        if (!empty($j['meta'])) foreach ($j['meta'] as $m) {
            if (!empty($m['kljuci'])) foreach ($m['kljuci'] as $k) { if (!isset($map[$k])) $map[$k] = $m; }
        }
    }
    set_transient('eudace_razpisi_meta', $map, 30 * MINUTE_IN_SECONDS);
    return $map;
}

function eudace_razpisi_shortcode($atts) {
    $atts = shortcode_atts(['stevilo' => 400], $atts, 'eudace_razpisi');
    $meta = eudace_portal_meta();

    $q = new WP_Query([
        'post_type' => 'razpis', 'post_status' => 'publish',
        'posts_per_page' => intval($atts['stevilo']), 'orderby' => 'date', 'order' => 'DESC', 'no_found_rows' => true,
    ]);

    $razpisovalci = []; $zbrani = [];

    while ($q->have_posts()) {
        $q->the_post();
        $id = get_the_ID(); $naslov = get_the_title(); $url = get_permalink();

        // tip + status iz kategorij — beri VSE taksonomije razpisa (ime taksonomije ni nujno 'kategorija')
        $terms = [];
        foreach (get_object_taxonomies('razpis') as $tx) {
            if ($tx === 'post_tag') continue;
            $tt = get_the_terms($id, $tx);
            if ($tt && !is_wp_error($tt)) $terms = array_merge($terms, $tt);
        }
        $katImena = []; $jeKredit = false; $status = '';
        foreach ($terms as $t) {
            $katImena[] = $t->name;
            $s = $t->slug . ' ' . $t->name;
            if (stripos($s, 'kredit') !== false || stripos($s, 'posojil') !== false) $jeKredit = true;
            if (stripos($s, 'arhiv') !== false || stripos($s, 'zaprt') !== false) $status = 'zaprt';
            elseif (stripos($s, 'prihaj') !== false || stripos($s, 'napoved') !== false) $status = 'napovedan';
        }
        // tip ZANESLJIVO iz naziva (kredit/mikrokredit/posojilo) — kategorija le dodaten namig
        if (preg_match('/kredit|posojil/iu', $naslov)) $jeKredit = true;
        $tip = $jeKredit ? 'kredit' : 'nepovratna';
        $tipLabel = $jeKredit ? 'Ugodni kredit' : 'Nepovratna sredstva';

        // metapodatki iz portala
        $m = isset($meta[eudace_norm($naslov)]) ? $meta[eudace_norm($naslov)] : null;
        $razpisovalec = $m && $m['razpisovalec'] ? $m['razpisovalec'] : '';
        if ($razpisovalec) $razpisovalci[$razpisovalec] = true;
        // rok: primarno iz ACF datum_oddaje razpisa (vsak ga ima), sicer iz portala
        $rokAcf = function_exists('get_field') ? get_field('datum_oddaje', $id) : '';
        list($rokPrikaz, $rokTs) = eudace_datum($rokAcf ? $rokAcf : ($m ? $m['rok'] : ''));
        // portalski status (odprt/zaprt) prevlada nad kategorijo, če obstaja
        if ($m && $m['status']) {
            $ps = mb_strtolower($m['status'], 'UTF-8');
            if (strpos($ps,'zaprt')!==false) $status='zaprt';
            elseif (strpos($ps,'napoved')!==false || strpos($ps,'nacrtovan')!==false) $status='napovedan';
            elseif (strpos($ps,'odprt')!==false) $status='odprt';
        }
        // če status še neznan, izpelji iz roka: pretekli -> zaprt, prihodnji -> odprt
        if ($status === '' && $rokTs) $status = ($rokTs < time()) ? 'zaprt' : 'odprt';
        $statusMap = ['odprt'=>'Odprt','zaprt'=>'Zaprt','napovedan'=>'Napovedan'];
        $statusLabel = isset($statusMap[$status]) ? $statusMap[$status] : '—';
        $statusCls = $status !== '' ? $status : 'nd';

        // iskalno besedilo vključuje tudi ACF opis/izvleček -> boljše ujemanje projektov
        $opisTxt = '';
        if (function_exists('get_field')) {
            $opisTxt = wp_strip_all_tags((string) get_field('kratek_opis', $id) . ' ' . (string) get_field('izvlecek', $id));
        }
        $iskalno = mb_substr(eudace_norm($naslov . ' ' . implode(' ', $katImena) . ' ' . $razpisovalec . ' ' . $opisTxt), 0, 500);

        // NUJNOST: odprti razpisi z bližnjim rokom dobijo "še X dni" oznako (spodbuja akcijo)
        $dniHtml = '';
        if ($status === 'odprt' && $rokTs > time()) {
            $dni = (int) ceil(($rokTs - time()) / 86400);
            if ($dni <= 30) $dniHtml = '<span class="er-dni' . ($dni <= 7 ? ' er-dni-r' : '') . '">še ' . $dni . ' dni</span>';
        }

        // CTA glede na status: odprt -> preveri upravičenost (bonbonček); zaprt/napovedan -> čakalna lista
        if ($status === 'odprt' || $status === '') {
            $ctaHtml = '<button type="button" class="er-cta" data-intent="povprasevanje" data-naziv="' . esc_attr($naslov) . '" data-url="' . esc_url($url) . '">Preveri upravičenost</button>';
        } else {
            $ctaHtml = '<button type="button" class="er-cta er-cta-o" data-intent="obvesti" data-naziv="' . esc_attr($naslov) . '" data-url="' . esc_url($url) . '">Obvesti me</button>';
        }

        $html = '<tr data-tip="' . $tip . '" data-status="' . $status . '" data-razpisovalec="' . esc_attr($razpisovalec) . '"'
            . ' data-rokts="' . $rokTs . '" data-txt="' . esc_attr($iskalno) . '">'
            . '<td class="er-c-naziv er-' . $tip . '"><a class="er-naziv" href="' . esc_url($url) . '">' . esc_html($naslov) . '</a>'
            . (!empty($katImena) ? '<div class="er-kat">' . esc_html(implode(' · ', array_slice($katImena,0,2))) . '</div>' : '') . '</td>'
            . '<td><span class="er-badge er-b-' . $tip . '">' . $tipLabel . '</span></td>'
            . '<td class="er-c-razp">' . ($razpisovalec ? esc_html($razpisovalec) : '—') . '</td>'
            . '<td class="er-c-rok">' . ($rokPrikaz ? esc_html($rokPrikaz) : '<span class="er-nd">—</span>') . $dniHtml . '</td>'
            . '<td><span class="er-st er-st-' . $statusCls . '">' . $statusLabel . '</span></td>'
            . '<td class="er-c-cta">' . $ctaHtml . '</td>'
            . '</tr>';

        // razvrstitev: odprti (po roku naraščajoče, brez roka zadnji) -> napovedani -> zaprti
        $statusRed = ($status === 'zaprt') ? 2 : (($status === 'napovedan') ? 1 : 0);
        $zbrani[] = ['red' => $statusRed, 'rok' => $rokTs ? $rokTs : PHP_INT_MAX, 'html' => $html];
    }
    wp_reset_postdata();

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
.er-naziv:hover{text-decoration:underline}
.er-kat{color:var(--siva);font-size:12px;margin-top:3px}
.er-badge{display:inline-block;font-size:12px;font-weight:700;padding:2px 9px;border-radius:20px;white-space:nowrap}
.er-b-nepovratna{background:var(--zelbg);color:var(--zel)} .er-b-kredit{background:var(--krbg);color:var(--m)}
.er-c-razp{color:var(--navy);font-size:13.5px}
.er-c-rok{white-space:nowrap;font-variant-numeric:tabular-nums} .er-nd{color:var(--siva)}
.er-st{display:inline-block;font-size:12px;font-weight:700;padding:2px 9px;border-radius:20px;white-space:nowrap}
.er-st-odprt{background:var(--zelbg);color:var(--zel)} .er-st-zaprt{background:var(--sivbg);color:var(--siva)} .er-st-napovedan{background:var(--amberbg);color:var(--amber)} .er-st-nd{background:var(--sivbg);color:var(--siva)}
.er-cta{background:var(--g);color:#fff;font-weight:700;font-size:14px;padding:9px 15px;border:none;border-radius:8px;cursor:pointer;white-space:nowrap}
.er-cta:hover{background:var(--gh)}
.er-cta-o{background:#fff;color:var(--m);border:2px solid var(--m);padding:7px 13px}
.er-cta-o:hover{background:var(--krbg)}
.er-dni{display:inline-block;margin-left:8px;font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:20px;background:var(--amberbg);color:var(--amber);white-space:nowrap}
.er-dni-r{background:#fdecea;color:#c0392b}
.er-pokazi{margin-top:10px;background:var(--m);color:#fff;border:none;border-radius:8px;padding:9px 16px;cursor:pointer;font-size:14px;font-weight:700}
.er-wrap .er-finder{background:linear-gradient(180deg,#eaf3fc,#f6f9fd);border:1px solid var(--rob);border-radius:12px;padding:16px 18px;margin:0 0 16px}
.er-f-nas{font-size:16px;font-weight:800;color:var(--md);margin-bottom:10px}
.er-wrap .er-finder textarea{width:100%!important;font:inherit!important;font-size:14.5px!important;padding:10px 12px!important;border:1px solid #cddcee!important;border-radius:8px!important;background:#fff!important;color:var(--navy)!important;box-sizing:border-box!important;resize:vertical;min-height:56px}
.er-wrap .er-finder textarea:focus{outline:2px solid var(--m)!important;outline-offset:1px}
.er-f-akc{display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap}
.er-f-res{font-size:14px;font-weight:700;color:var(--md)}
.er-f-cta{margin-top:12px;padding:12px 14px;background:#fff;border:1px solid var(--rob);border-radius:10px;font-size:14.5px;color:var(--navy);display:flex;gap:12px;align-items:center;flex-wrap:wrap}
tr.er-zadetek td.er-c-naziv{border-left-color:var(--g)!important}
.er-oc{display:inline-block;margin-left:8px;font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:20px;background:#fdf3d7;color:#8a6508;white-space:nowrap}
.er-prazno{padding:24px;text-align:center;color:var(--siva);display:none}
.er-modal{position:fixed;inset:0;background:rgba(16,40,70,.55);display:none;align-items:center;justify-content:center;z-index:99999;padding:16px}
.er-modal.on{display:flex}
.er-box{background:#fff;border-radius:14px;max-width:460px;width:100%;padding:24px;max-height:90vh;overflow:auto}
.er-box h3{margin:0 0 4px;font-size:20px} .er-za{font-size:14px;color:var(--siva);margin:0 0 14px}
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
  <div class="er-f-nas">🔎 Opišite svoj projekt — poiščemo primerne razpise</div>
  <textarea id="erproj" rows="2" placeholder="Npr.: Kupujemo nov CNC stroj za širitev proizvodnje, 15 zaposlenih, naložba okoli 200.000 €"></textarea>
  <div class="er-f-akc">
    <button type="button" id="erfind" class="er-cta">Najdi primerne razpise</button>
    <button type="button" id="erfreset" class="er-preklic" style="display:none">Ponastavi</button>
    <span class="er-f-res" id="erfres"></span>
  </div>
  <div class="er-f-cta" id="erfcta" style="display:none">
    Želite, da svetovalec <b>brezplačno preveri upravičenost</b> za te razpise?
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

/* ISKALNIK PO PROJEKTU: opis -> tockovanje po prefiksih -> prerazporedi zadetke na vrh */
var fin=document.getElementById('erfind'),fres=document.getElementById('erfres'),
frst=document.getElementById('erfreset'),fcta=document.getElementById('erfcta'),
fproj=document.getElementById('erproj'),zadnjiOpis='',topZadetki=[];
var STOP={in:1,ali:1,za:1,na:1,je:1,se:1,so:1,bo:1,bi:1,da:1,ki:1,od:1,do:1,po:1,pri:1,pod:1,nad:1,iz:1,ter:1,nas:1,nam:1,smo:1,ima:1,imamo:1,zelimo:1,okoli:1,eur:1,evrov:1,podjetje:1,projekt:1,razpis:1,sredstva:1,nakup:1,novo:1,nov:1,nova:1};
function normJs(s){return s.toLowerCase().replace(/[čć]/g,'c').replace(/š/g,'s').replace(/ž/g,'z').replace(/đ/g,'d').replace(/[^a-z0-9]+/g,' ').trim();}
function najdi(){
  var opis=fproj.value.trim();
  if(opis.length<10){fres.textContent='Vpišite vsaj nekaj besed o projektu.';return;}
  zadnjiOpis=opis;
  var toks=normJs(opis).split(' ').filter(function(t){return t.length>=4&&!STOP[t];});
  var pref=toks.map(function(t){return t.slice(0,Math.min(t.length,6));});
  pref=pref.filter(function(v,i){return pref.indexOf(v)===i;});
  if(!pref.length){fres.textContent='Opišite projekt bolj konkretno.';return;}
  q.value='';tip.value='';stat.value='';razp.value='';
  var ocenjeni=[];
  rows.forEach(function(r){var txt=' '+r.getAttribute('data-txt')+' ',z=0;
    pref.forEach(function(p){if(txt.indexOf(p)>-1)z++;});
    r.querySelectorAll('.er-oc').forEach(function(x){x.remove();});
    r.classList.remove('er-zadetek');
    ocenjeni.push({r:r,z:z});});
  var zadetki=ocenjeni.filter(function(o){return o.z>0;}).sort(function(a,b){return b.z-a.z;});
  topZadetki=zadetki.slice(0,5).map(function(o){return o.r.querySelector('.er-naziv').textContent;});
  if(!zadetki.length){rows.forEach(function(r){r.style.display='none';});c.textContent='0 razpisov';p.style.display='block';fres.textContent='Ni neposrednih zadetkov — pustite kontakt in svetovalec poišče možnosti za vas.';fcta.style.display='flex';frst.style.display='';return;}
  zadetki.forEach(function(o){o.r.classList.add('er-zadetek');
    var ocEl=document.createElement('span');ocEl.className='er-oc';ocEl.textContent='ujemanje';
    o.r.querySelector('.er-c-naziv').appendChild(ocEl);
    b.appendChild(o.r);o.r.style.display='';});
  ocenjeni.filter(function(o){return o.z===0;}).forEach(function(o){o.r.style.display='none';});
  /* zadetki na vrh v pravem vrstnem redu */
  zadetki.slice().reverse().forEach(function(o){b.insertBefore(o.r,b.firstChild);});
  c.textContent=zadetki.length+' primernih razpisov';p.style.display='none';
  fres.textContent='✓ Našli smo '+zadetki.length+' primernih razpisov (označeni zgoraj).';
  fcta.style.display='flex';frst.style.display='';
  try{fetch(PORTAL+'/api/javno/ujemanje',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({opis:opis}),mode:'no-cors'});}catch(e){}
}
fin.addEventListener('click',najdi);
frst.addEventListener('click',function(){fproj.value='';fres.textContent='';fcta.style.display='none';frst.style.display='none';zadnjiOpis='';topZadetki=[];
  rows.forEach(function(r){r.classList.remove('er-zadetek');r.querySelectorAll('.er-oc').forEach(function(x){x.remove();});});stat.value='odprt';f();});
document.getElementById('erflead').addEventListener('click',function(){
  cur={n:topZadetki[0]||'',u:'',i:'projekt'};
  za.textContent=topZadetki.length?('Primerni razpisi: '+topZadetki.slice(0,3).join(' · ')):'';
  nasl.textContent='Brezplačna preverba upravičenosti za vaš projekt';
  pod.textContent='Svetovalec pregleda vaš projekt in vam predlaga najprimernejše razpise ter pogoje. Brez obveznosti.';
  fo.querySelector('[name=projekt_opis]').value=zadnjiOpis;
  msg.textContent='';m.classList.add('on');});
var m=document.getElementById('erm'),za=document.getElementById('erza'),fo=document.getElementById('erf'),
msg=document.getElementById('ermsg'),ss=document.getElementById('ers'),nasl=document.getElementById('ernaslov'),
pod=document.getElementById('erpod'),cur={n:'',u:'',i:'povprasevanje'};
b.addEventListener('click',function(e){var t=e.target.closest('.er-cta');if(t){
cur={n:t.getAttribute('data-naziv'),u:t.getAttribute('data-url'),i:t.getAttribute('data-intent')||'povprasevanje'};
za.textContent=cur.n;msg.textContent='';
if(cur.i==='obvesti'){nasl.textContent='Obvestite me, ko bo razpis odprt';pod.textContent='Sporočimo vam ob (ponovnem) odprtju in brezplačno preverimo, ali vaše podjetje izpolnjuje pogoje.';}
else{nasl.textContent='Preverimo vašo upravičenost — brezplačno';pod.textContent='Naši svetovalci preverijo, ali vaše podjetje izpolnjuje pogoje razpisa, in vam svetujejo pri prijavi. Brez obveznosti.';}
m.classList.add('on');}});
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

/* ob shranjevanju razpisa počisti keš metapodatkov */
add_action('save_post_razpis', function(){ delete_transient('eudace_razpisi_meta'); });
