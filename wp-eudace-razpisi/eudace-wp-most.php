<?php
/**
 * Plugin Name: Eudace — WP most (urejanje prek portala)
 * Description: Most med portalom Razpisnik in razpis.eu: (1) CPT "razpis" v REST za programsko urejanje; (2) meta endpoint za ACF/meta polja; (3) CTA blok na povzetkih; (4) statusna oznaka Odprt/Zaključen iz roka oddaje; (5) FAQ sekcija + FAQPage schema.org iz meta polja eudace_faq; (6) nastavitev promoviranih razpisov. Vse nastavljivo prek REST, brez urejanja teme.
 * Version: 1.1
 * Author: Eudace d.o.o.
 */

if (!defined('ABSPATH')) exit;

/* ── 1) CPT "razpis" v REST ─────────────────────────────────────────────────
 * Tema registrira CPT brez show_in_rest → /wp-json/wp/v2/razpis je bil 404 in
 * povzetkov ni bilo mogoče urejati programsko. Branje je javno (vsebina je itak
 * javna), pisanje gre skozi standardne WP capability preverbe (app password). */
add_filter('register_post_type_args', function ($args, $post_type) {
    if ($post_type === 'razpis') {
        $args['show_in_rest'] = true;
        $args['rest_base'] = 'razpis';
    }
    return $args;
}, 10, 2);

add_filter('register_taxonomy_args', function ($args, $taxonomy, $object_type) {
    $object_type = (array) $object_type;
    if (in_array('razpis', $object_type, true)) {
        $args['show_in_rest'] = true;
    }
    return $args;
}, 10, 3);

/* ── 2) Meta/ACF endpoint (samo admin) ──────────────────────────────────────
 * ACF polja niso samodejno v REST; portal prek tega endpointa bere in piše
 * short_description/key_points/end_date/advisor/suggested_posts (+ _field ref
 * pare), Rank Math meta in eudace_faq. */
add_action('rest_api_init', function () {
    register_rest_route('eudace-most/v1', '/meta/(?P<id>\d+)', [
        [
            'methods' => 'GET',
            'permission_callback' => function () { return current_user_can('manage_options'); },
            'callback' => function ($req) {
                $id = (int) $req['id'];
                if (!get_post($id)) return new WP_Error('ni_objave', 'Objava ne obstaja', ['status' => 404]);
                $meta = get_post_meta($id);
                $out = [];
                foreach ($meta as $k => $v) $out[$k] = maybe_unserialize($v[0]);
                return ['id' => $id, 'meta' => $out];
            },
        ],
        [
            'methods' => 'POST',
            'permission_callback' => function () { return current_user_can('manage_options'); },
            'callback' => function ($req) {
                $id = (int) $req['id'];
                if (!get_post($id)) return new WP_Error('ni_objave', 'Objava ne obstaja', ['status' => 404]);
                $telo = $req->get_json_params();
                if (!is_array($telo) || empty($telo['meta']) || !is_array($telo['meta'])) {
                    return new WP_Error('manjka_meta', 'Pričakujem {"meta": {"kljuc": "vrednost", ...}}', ['status' => 400]);
                }
                $posodobljeni = [];
                foreach ($telo['meta'] as $k => $v) {
                    update_post_meta($id, sanitize_key($k), $v);
                    $posodobljeni[] = $k;
                }
                return ['ok' => true, 'id' => $id, 'posodobljeni' => $posodobljeni];
            },
        ],
    ]);
});

/* ── 3) Nastavitve (REST wp/v2/settings) ────────────────────────────────────
 * CTA besedila + seznam promoviranih razpisov (post ID-ji, ločeni z vejico) —
 * portal jih bere pri pripravi objav (suggested_posts), tukaj ni izrisa. */
add_action('init', function () {
    $polja = [
        'eudace_most_cta_vklop' => '1',
        'eudace_most_cta_naslov' => 'Vas zanima ta razpis?',
        'eudace_most_cta_besedilo' => 'Brezplačno preverimo, ali vaše podjetje izpolnjuje pogoje, in svetujemo pri pripravi vloge. Odgovorimo v enem delovnem dnevu.',
        'eudace_most_cta_gumb' => 'Pošljite povpraševanje →',
        'eudace_most_cta_url' => '/kontakt/',
        'eudace_most_promovirani' => '',
    ];
    foreach ($polja as $ime => $privzeto) {
        register_setting('general', $ime, [
            'type' => 'string',
            'default' => $privzeto,
            'show_in_rest' => true,
            'sanitize_callback' => 'sanitize_text_field',
        ]);
    }
});

/* ── Pomožno: rok oddaje iz ACF end_date (YYYYMMDD) ────────────────────────── */
function eudace_most_rok($post_id) {
    $raw = get_post_meta($post_id, 'end_date', true);
    if (!preg_match('/^\d{8}$/', (string) $raw)) return null;
    return [
        'ymd' => $raw,
        'prikaz' => (int) substr($raw, 6, 2) . '. ' . (int) substr($raw, 4, 2) . '. ' . substr($raw, 0, 4),
        'odprt' => $raw >= current_time('Ymd'),
    ];
}

/* ── 4) Statusna oznaka na vrhu vsebine ─────────────────────────────────────
 * "Odprt · rok" (zelena) / "Zaključen + poglejte aktualne" (siva) — iz ACF
 * end_date. Zaključene strani s tem obdržijo SEO vrednost (jasen signal +
 * usmeritev na aktualne), ne brišemo jih. Priority 9 = pred FAQ/CTA (11). */
add_filter('the_content', function ($content) {
    if (!is_singular('razpis') || !in_the_loop() || !is_main_query()) return $content;
    $rok = eudace_most_rok(get_the_ID());
    if (!$rok) return $content;

    if ($rok['odprt']) {
        $oznaka = '<div class="eudace-status" style="margin:0 0 22px;padding:11px 16px;border-radius:8px;background:#e8f6ee;border:1px solid #bfe3cd;color:#14713d;font-size:15px;font-weight:600;">'
                . '🟢 Razpis je odprt — rok oddaje: ' . esc_html($rok['prikaz']) . '</div>';
    } else {
        $alt_url = home_url('/');
        $termi = get_the_terms(get_the_ID(), 'category-razpis');
        if ($termi && !is_wp_error($termi)) {
            $povezava = get_term_link($termi[0]);
            if (!is_wp_error($povezava)) $alt_url = $povezava;
        }
        $oznaka = '<div class="eudace-status" style="margin:0 0 22px;padding:11px 16px;border-radius:8px;background:#f3f4f6;border:1px solid #d8dbe0;color:#4b5563;font-size:15px;">'
                . '⏹ <b>Ta razpis je zaključen</b> (rok je potekel ' . esc_html($rok['prikaz']) . '). '
                . '<a href="' . esc_url($alt_url) . '" style="color:#1d5087;font-weight:600;">Poglejte aktualne razpise →</a></div>';
    }
    return $oznaka . $content;
}, 9);

/* ── 5) FAQ sekcija + 6) CTA blok (na dnu vsebine) ──────────────────────────
 * FAQ iz meta 'eudace_faq' (JSON [{"q":"...","a":"..."}] — polni ga portal ob
 * pripravi objave). En filter za oboje, da je vrstni red zanesljiv: vsebina →
 * FAQ → CTA. FAQPage JSON-LD se izpiše v futru (glej spodaj). */
add_filter('the_content', function ($content) {
    if (!is_singular('razpis') || !in_the_loop() || !is_main_query()) return $content;

    // FAQ
    $faq_meta = get_post_meta(get_the_ID(), 'eudace_faq', true);
    $faq = $faq_meta ? json_decode((string) $faq_meta, true) : null;
    if (is_array($faq) && count($faq)) {
        $content .= '<h2>Pogosta vprašanja</h2>';
        foreach ($faq as $par) {
            if (empty($par['q']) || empty($par['a'])) continue;
            $content .= '<details style="margin:0 0 10px;border:1px solid #e3e6ea;border-radius:8px;padding:12px 16px;">'
                      . '<summary style="font-weight:600;cursor:pointer;">' . esc_html($par['q']) . '</summary>'
                      . '<div style="margin-top:8px;line-height:1.6;">' . wp_kses_post($par['a']) . '</div></details>';
        }
    }

    // CTA
    if (get_option('eudace_most_cta_vklop', '1') === '1') {
        $naslov = esc_html(get_option('eudace_most_cta_naslov'));
        $besedilo = esc_html(get_option('eudace_most_cta_besedilo'));
        $gumb = esc_html(get_option('eudace_most_cta_gumb'));
        $url = esc_url(get_option('eudace_most_cta_url', '/kontakt/'));
        $content .= '<div class="eudace-cta" style="margin:36px 0 8px;padding:26px 28px;border-radius:12px;background:#123a63;background:linear-gradient(135deg,#123a63,#1d5087);color:#fff;">'
                  . '<div style="font-size:21px;font-weight:700;margin-bottom:8px;color:#fff;">' . $naslov . '</div>'
                  . '<div style="font-size:15px;line-height:1.55;color:#dbe6f2;margin-bottom:18px;">' . $besedilo . '</div>'
                  . '<a href="' . $url . '" style="display:inline-block;background:#F0912A;color:#fff;font-weight:700;font-size:15px;padding:12px 26px;border-radius:8px;text-decoration:none;">' . $gumb . '</a>'
                  . '</div>';
    }
    return $content;
}, 11);

/* ── FAQPage schema.org (JSON-LD) ───────────────────────────────────────────
 * Samo kadar objava ima eudace_faq — Rank Math že pokriva Article/breadcrumbs,
 * zato dodajamo IZKLJUČNO FAQPage (brez podvajanja tipov). */
add_action('wp_footer', function () {
    if (!is_singular('razpis')) return;
    $faq_meta = get_post_meta(get_the_ID(), 'eudace_faq', true);
    $faq = $faq_meta ? json_decode((string) $faq_meta, true) : null;
    if (!is_array($faq) || !count($faq)) return;
    $entitete = [];
    foreach ($faq as $par) {
        if (empty($par['q']) || empty($par['a'])) continue;
        $entitete[] = [
            '@type' => 'Question',
            'name' => wp_strip_all_tags($par['q']),
            'acceptedAnswer' => ['@type' => 'Answer', 'text' => wp_strip_all_tags($par['a'])],
        ];
    }
    if (!$entitete) return;
    $schema = ['@context' => 'https://schema.org', '@type' => 'FAQPage', 'mainEntity' => $entitete];
    echo '<script type="application/ld+json">' . wp_json_encode($schema, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . '</script>' . "\n";
});
