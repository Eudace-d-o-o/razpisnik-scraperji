<?php
/**
 * Plugin Name: Eudace — Razpisi tabela v1
 * Description: Shortcode [eudace_razpisi] — javna tabela razpisov (CPT "razpis") s filtri po kategoriji, iskanjem in lead obrazcem, povezano s portalom razpisnik. Server-side izris (SEO).
 * Version: 1.0
 * Author: Eudace
 */

if (!defined('ABSPATH')) exit;

/*
 * KONFIGURACIJA:
 * Portal, kamor gredo leadi in beleženje iskanj. Za TESTIRANJE pusti staging;
 * ob objavi na produkcijo zamenjaj v 'https://razpisnik.eu'.
 */
if (!defined('EUDACE_PORTAL_URL')) {
    define('EUDACE_PORTAL_URL', 'https://staging.razpisnik.eu');
}

/* ACF datum (Ymd / d.m.Y / ISO) -> "d.m.Y"; prazno vrne '' */
function eudace_razpis_datum($raw) {
    if (!$raw) return '';
    if (preg_match('/^(\d{4})(\d{2})(\d{2})$/', $raw, $m)) return "$m[3].$m[2].$m[1]";
    $ts = strtotime($raw);
    return $ts ? date('d.m.Y', $ts) : esc_html($raw);
}

function eudace_razpisi_shortcode($atts) {
    $atts = shortcode_atts(['stevilo' => 300], $atts, 'eudace_razpisi');

    $q = new WP_Query([
        'post_type'      => 'razpis',
        'post_status'    => 'publish',
        'posts_per_page' => intval($atts['stevilo']),
        'orderby'        => 'date',
        'order'          => 'DESC',
        'no_found_rows'  => true,
    ]);

    $kategorije = []; // slug => ime (za filter dropdown)
    $vrstice = '';

    while ($q->have_posts()) {
        $q->the_post();
        $id     = get_the_ID();
        $naslov = get_the_title();
        $url    = get_permalink();
        $opis   = function_exists('get_field') ? (string) get_field('kratek_opis', $id) : '';
        if ($opis === '') $opis = (string) get_field('izvlecek', $id);
        $opis   = wp_trim_words(wp_strip_all_tags($opis), 24, '…');
        $rok    = eudace_razpis_datum(function_exists('get_field') ? get_field('datum_oddaje', $id) : '');

        $terms = get_the_terms($id, 'kategorija');
        $katSlugs = [];
        $znacke = '';
        if ($terms && !is_wp_error($terms)) {
            foreach ($terms as $t) {
                $kategorije[$t->slug] = $t->name;
                $katSlugs[] = $t->slug;
                $jeKredit = (stripos($t->slug, 'kredit') !== false || stripos($t->slug, 'posojil') !== false);
                $znacke .= '<span class="er-badge ' . ($jeKredit ? 'er-b-kredit' : 'er-b-nepovratna') . '">' . esc_html($t->name) . '</span> ';
            }
        }

        $iskalno = mb_strtolower($naslov . ' ' . $opis, 'UTF-8');

        $vrstice .= '<tr data-kat="' . esc_attr(implode(' ', $katSlugs)) . '" data-txt="' . esc_attr($iskalno) . '">'
            . '<td class="er-c-naziv"><a class="er-naziv" href="' . esc_url($url) . '">' . esc_html($naslov) . '</a>'
            . ($opis ? '<div class="er-opis">' . esc_html($opis) . '</div>' : '') . '</td>'
            . '<td class="er-c-kat">' . $znacke . '</td>'
            . '<td class="er-c-rok">' . ($rok ? esc_html($rok) : '<span class="er-stalno">brez roka</span>') . '</td>'
            . '<td class="er-c-cta"><button type="button" class="er-cta" data-naziv="' . esc_attr($naslov) . '" data-url="' . esc_url($url) . '">Zanima me</button></td>'
            . '</tr>';
    }
    wp_reset_postdata();

    // filter dropdown možnosti
    asort($kategorije);
    $opcije = '<option value="">Vse kategorije</option>';
    foreach ($kategorije as $slug => $ime) {
        $opcije .= '<option value="' . esc_attr($slug) . '">' . esc_html($ime) . '</option>';
    }

    $portal = esc_js(EUDACE_PORTAL_URL);

    ob_start(); ?>
<div class="er-wrap">
  <style>
    .er-wrap{--er-modra:#1c5fa8;--er-navy:#16324f;--er-gumb:#f3b108;--er-gumb-h:#d99f06;--er-tint:#f3f8fd;--er-rob:#d7e4f3;--er-siva:#5b6f83;--er-zelena:#2f8f5b;--er-zelena-bg:#e7f4ec;--er-kredit:#1c5fa8;--er-kredit-bg:#e7f1fb;color:var(--er-navy);font-family:inherit}
    .er-filtri{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
    .er-filtri input,.er-filtri select{font:inherit;font-size:15px;padding:10px 12px;border:1px solid #bcd3ea;border-radius:8px;background:#fff;color:var(--er-navy)}
    .er-filtri input{flex:1;min-width:220px}
    .er-filtri input:focus,.er-filtri select:focus{outline:2px solid var(--er-modra);outline-offset:1px;border-color:var(--er-modra)}
    .er-count{font-size:13px;color:var(--er-siva);margin-left:auto}
    .er-scroll{overflow-x:auto;border:1px solid var(--er-rob);border-radius:12px}
    .er-tab{border-collapse:collapse;width:100%;font-size:15px}
    .er-tab thead th{background:var(--er-modra);color:#fff;text-align:left;font-weight:600;padding:12px 16px;white-space:nowrap;font-size:14px}
    .er-tab td{padding:13px 16px;border-top:1px solid var(--er-rob);vertical-align:middle}
    .er-tab tbody tr:nth-child(even) td{background:var(--er-tint)}
    .er-tab td.er-c-naziv{border-left:4px solid transparent}
    .er-tab tr[data-kat*="kredit"] td.er-c-naziv,.er-tab tr[data-kat*="posojil"] td.er-c-naziv{border-left-color:var(--er-kredit)}
    .er-tab tr:not([data-kat*="kredit"]) td.er-c-naziv{border-left-color:var(--er-zelena)}
    .er-naziv{font-weight:700;color:var(--er-modra);text-decoration:none}
    .er-naziv:hover{text-decoration:underline}
    .er-opis{color:var(--er-siva);font-size:13px;margin-top:3px}
    .er-badge{display:inline-block;font-size:12px;font-weight:700;padding:2px 9px;border-radius:20px;white-space:nowrap;margin:2px 0}
    .er-b-nepovratna{background:var(--er-zelena-bg);color:var(--er-zelena)}
    .er-b-kredit{background:var(--er-kredit-bg);color:var(--er-kredit)}
    .er-c-rok{white-space:nowrap;font-variant-numeric:tabular-nums}
    .er-stalno{color:var(--er-siva);font-style:italic;font-size:13px}
    .er-cta{background:var(--er-gumb);color:#fff;font-weight:700;font-size:14px;padding:9px 16px;border:none;border-radius:8px;cursor:pointer;white-space:nowrap}
    .er-cta:hover{background:var(--er-gumb-h)}
    .er-prazno{padding:24px;text-align:center;color:var(--er-siva)}
    .er-modal{position:fixed;inset:0;background:rgba(16,40,70,.55);display:none;align-items:center;justify-content:center;z-index:99999;padding:16px}
    .er-modal.odprt{display:flex}
    .er-box{background:#fff;border-radius:14px;max-width:460px;width:100%;padding:24px;max-height:90vh;overflow:auto}
    .er-box h3{margin:0 0 4px;font-size:20px;color:var(--er-navy)}
    .er-box .er-za{font-size:14px;color:var(--er-siva);margin:0 0 16px}
    .er-box label{display:block;font-size:13px;font-weight:600;margin:10px 0 4px;color:var(--er-navy)}
    .er-box input,.er-box textarea{width:100%;font:inherit;font-size:15px;padding:10px 12px;border:1px solid #bcd3ea;border-radius:8px;box-sizing:border-box}
    .er-box textarea{min-height:70px;resize:vertical}
    .er-soglasje{display:flex;gap:8px;align-items:flex-start;margin:14px 0 4px;font-size:13px;color:var(--er-siva)}
    .er-soglasje input{width:auto;margin-top:3px}
    .er-hp{position:absolute;left:-9999px}
    .er-akcije{display:flex;gap:10px;margin-top:16px}
    .er-poslji{background:var(--er-gumb);color:#fff;font-weight:700;font-size:15px;padding:11px 18px;border:none;border-radius:8px;cursor:pointer;flex:1}
    .er-poslji:hover{background:var(--er-gumb-h)}
    .er-poslji:disabled{opacity:.6;cursor:default}
    .er-preklic{background:#eef3f8;color:var(--er-navy);border:none;border-radius:8px;padding:11px 16px;cursor:pointer;font-size:15px}
    .er-msg{font-size:14px;margin-top:12px}
    .er-ok{color:var(--er-zelena)} .er-err{color:#c0392b}
    @media(max-width:600px){.er-cta{padding:8px 12px;font-size:13px}}
  </style>

  <div class="er-filtri">
    <input id="er-q" type="text" placeholder="Iščite razpis po nazivu ali opisu…" aria-label="Iskanje razpisov">
    <select id="er-kat" aria-label="Kategorija"><?php echo $opcije; ?></select>
    <span class="er-count" id="er-count"></span>
  </div>

  <div class="er-scroll">
    <table class="er-tab">
      <thead><tr><th>Razpis</th><th>Kategorija</th><th>Rok oddaje</th><th></th></tr></thead>
      <tbody id="er-body"><?php echo $vrstice; ?></tbody>
    </table>
  </div>
  <div class="er-prazno" id="er-prazno" style="display:none">Za izbrane pogoje ni razpisov. Poskusite drugačno iskanje ali kategorijo.</div>

  <div class="er-modal" id="er-modal" role="dialog" aria-modal="true" aria-labelledby="er-mnas">
    <div class="er-box">
      <h3 id="er-mnas">Zanima me ta razpis</h3>
      <p class="er-za" id="er-za"></p>
      <form id="er-form">
        <label for="er-ime">Ime in priimek</label>
        <input id="er-ime" name="ime" type="text" autocomplete="name">
        <label for="er-email">E-pošta *</label>
        <input id="er-email" name="email" type="email" autocomplete="email" required>
        <label for="er-tel">Telefon</label>
        <input id="er-tel" name="telefon" type="tel" autocomplete="tel">
        <label for="er-pod">Podjetje</label>
        <input id="er-pod" name="podjetje_naziv" type="text" autocomplete="organization">
        <label for="er-proj">Na kratko o vašem projektu</label>
        <textarea id="er-proj" name="projekt_opis" placeholder="Kaj načrtujete? (naložba, razvoj, zaposlitev …)"></textarea>
        <input class="er-hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
        <label class="er-soglasje"><input id="er-sog" type="checkbox"> Strinjam se, da me Eudace kontaktira glede financiranja mojega projekta.</label>
        <div class="er-akcije">
          <button type="submit" class="er-poslji" id="er-poslji">Pošlji povpraševanje</button>
          <button type="button" class="er-preklic" id="er-zapri">Prekliči</button>
        </div>
        <div class="er-msg" id="er-msg"></div>
      </form>
    </div>
  </div>

  <script>
  (function(){
    var PORTAL="<?php echo $portal; ?>";
    var q=document.getElementById('er-q'),kat=document.getElementById('er-kat'),
        body=document.getElementById('er-body'),cnt=document.getElementById('er-count'),
        prazno=document.getElementById('er-prazno'),vrstice=[].slice.call(body.querySelectorAll('tr'));
    var tBeacon=null;
    function filtriraj(){
      var s=q.value.toLowerCase().trim(),k=kat.value,vidnih=0;
      vrstice.forEach(function(r){
        var ok=(!s||r.getAttribute('data-txt').indexOf(s)>-1)&&(!k||(' '+r.getAttribute('data-kat')+' ').indexOf(' '+k+' ')>-1);
        r.style.display=ok?'':'none'; if(ok)vidnih++;
      });
      cnt.textContent=vidnih+' razpisov';
      prazno.style.display=vidnih?'none':'block';
      if(s.length>=3){ clearTimeout(tBeacon); tBeacon=setTimeout(function(){
        try{ fetch(PORTAL+'/api/javno/razpisi?search='+encodeURIComponent(s),{mode:'no-cors'}); }catch(e){}
      },900); }
    }
    q.addEventListener('input',filtriraj); kat.addEventListener('change',filtriraj); filtriraj();

    var modal=document.getElementById('er-modal'),za=document.getElementById('er-za'),
        form=document.getElementById('er-form'),msg=document.getElementById('er-msg'),
        poslji=document.getElementById('er-poslji');
    var trenutni={naziv:'',url:''};
    function odpri(n,u){ trenutni={naziv:n,url:u}; za.textContent=n; msg.textContent=''; modal.classList.add('odprt'); }
    function zapri(){ modal.classList.remove('odprt'); }
    body.addEventListener('click',function(e){ var b=e.target.closest('.er-cta'); if(b) odpri(b.getAttribute('data-naziv'),b.getAttribute('data-url')); });
    document.getElementById('er-zapri').addEventListener('click',zapri);
    modal.addEventListener('click',function(e){ if(e.target===modal) zapri(); });

    form.addEventListener('submit',function(e){
      e.preventDefault();
      if(!document.getElementById('er-sog').checked){ msg.className='er-msg er-err'; msg.textContent='Potrebujemo vaše soglasje za kontakt.'; return; }
      var fd=new FormData(form), payload={
        ime:fd.get('ime'), email:fd.get('email'), telefon:fd.get('telefon'),
        podjetje_naziv:fd.get('podjetje_naziv'), projekt_opis:fd.get('projekt_opis'),
        website:fd.get('website'), soglasje:true,
        razpis_interes_naziv:trenutni.naziv, razpis_interes_url:trenutni.url
      };
      poslji.disabled=true; msg.className='er-msg'; msg.textContent='Pošiljam…';
      fetch(PORTAL+'/api/javno/lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
        .then(function(r){return r.json();})
        .then(function(d){
          if(d && d.ok){ form.reset(); msg.className='er-msg er-ok'; msg.textContent='Hvala! Kmalu vas kontaktiramo.'; setTimeout(zapri,2200); }
          else { msg.className='er-msg er-err'; msg.textContent=(d&&d.error)||'Napaka pri pošiljanju. Poskusite znova.'; }
        })
        .catch(function(){ msg.className='er-msg er-err'; msg.textContent='Napaka pri povezavi. Poskusite znova.'; })
        .finally(function(){ poslji.disabled=false; });
    });
  })();
  </script>
</div>
    <?php
    return ob_get_clean();
}
add_shortcode('eudace_razpisi', 'eudace_razpisi_shortcode');
