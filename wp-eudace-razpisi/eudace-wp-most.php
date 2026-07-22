<?php
/**
 * Plugin Name: Eudace — WP most (urejanje prek portala)
 * Description: Most med portalom Razpisnik in razpis.eu: (1) izpostavi CPT "razpis" v WP REST API, da se povzetki razpisov lahko urejajo programsko; (2) generični meta endpoint za branje/urejanje ACF/meta polj; (3) enoten CTA blok "povpraševanje" na dnu vsakega povzetka razpisa (nastavljiv prek REST settings, brez urejanja teme).
 * Version: 1.0
 * Author: Eudace d.o.o.
 */

if (!defined('ABSPATH')) exit;

/* ── 1) CPT "razpis" v REST ─────────────────────────────────────────────────
 * Tema registrira CPT brez show_in_rest, zato je bil /wp-json/wp/v2/razpis 404
 * in povzetkov ni bilo mogoče urejati prek REST. Filter argumente dopolni ob
 * registraciji — brez posega v temo. Branje je javno (vsebina je itak javna),
 * pisanje gre skozi standardne WP capability preverbe (application password). */
add_filter('register_post_type_args', function ($args, $post_type) {
    if ($post_type === 'razpis') {
        $args['show_in_rest'] = true;
        $args['rest_base'] = 'razpis';
    }
    return $args;
}, 10, 2);

// Tudi taksonomije CPT-ja (kategorije razpisov) v REST, da se lahko filtrira/ureja.
add_filter('register_taxonomy_args', function ($args, $taxonomy, $object_type) {
    $object_type = (array) $object_type;
    if (in_array('razpis', $object_type, true)) {
        $args['show_in_rest'] = true;
    }
    return $args;
}, 10, 3);

/* ── 2) Meta/ACF endpoint ───────────────────────────────────────────────────
 * ACF polja (datum_oddaje ipd.) niso samodejno v REST. Generični endpoint za
 * branje in pisanje meta polj posamezne objave — SAMO za prijavljene z
 * manage_options (admin application password), nikoli javno. */
add_action('rest_api_init', function () {
    register_rest_route('eudace-most/v1', '/meta/(?P<id>\d+)', [
        [
            'methods' => 'GET',
            'permission_callback' => function () { return current_user_can('manage_options'); },
            'callback' => function ($req) {
                $id = (int) $req['id'];
                if (!get_post($id)) return new WP_Error('ni_objave', 'Objava ne obstaja', ['status' => 404]);
                $meta = get_post_meta($id);
                // Vrni poenostavljeno (prvi element vsakega ključa), da je JSON pregleden.
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

/* ── 3) CTA blok na povzetkih razpisov ──────────────────────────────────────
 * Enoten blok "pošljite povpraševanje" na dnu VSAKEGA posameznega razpisa —
 * centralno (the_content filter), brez urejanja 140 objav posebej. Besedilo/URL
 * nastavljiva prek REST (wp/v2/settings), da se da prilagajati brez nove verzije
 * plugina. Inline slogi namenoma (neodvisno od teme/Elementorja). */
add_action('init', function () {
    $polja = [
        'eudace_most_cta_vklop' => ['type' => 'string', 'default' => '1'],
        'eudace_most_cta_naslov' => ['type' => 'string', 'default' => 'Vas zanima ta razpis?'],
        'eudace_most_cta_besedilo' => ['type' => 'string', 'default' => 'Brezplačno preverimo, ali vaše podjetje izpolnjuje pogoje, in svetujemo pri pripravi vloge. Odgovorimo v enem delovnem dnevu.'],
        'eudace_most_cta_gumb' => ['type' => 'string', 'default' => 'Pošljite povpraševanje →'],
        'eudace_most_cta_url' => ['type' => 'string', 'default' => '/kontakt/'],
    ];
    foreach ($polja as $ime => $def) {
        register_setting('general', $ime, [
            'type' => $def['type'],
            'default' => $def['default'],
            'show_in_rest' => true,
            'sanitize_callback' => 'sanitize_text_field',
        ]);
    }
});

add_filter('the_content', function ($content) {
    if (!is_singular('razpis') || !in_the_loop() || !is_main_query()) return $content;
    if (get_option('eudace_most_cta_vklop', '1') !== '1') return $content;

    $naslov = esc_html(get_option('eudace_most_cta_naslov'));
    $besedilo = esc_html(get_option('eudace_most_cta_besedilo'));
    $gumb = esc_html(get_option('eudace_most_cta_gumb'));
    $url = esc_url(get_option('eudace_most_cta_url', '/kontakt/'));

    $cta = '<div class="eudace-cta" style="margin:36px 0 8px;padding:26px 28px;border-radius:12px;background:#123a63;background:linear-gradient(135deg,#123a63,#1d5087);color:#fff;">'
         . '<div style="font-size:21px;font-weight:700;margin-bottom:8px;color:#fff;">' . $naslov . '</div>'
         . '<div style="font-size:15px;line-height:1.55;color:#dbe6f2;margin-bottom:18px;">' . $besedilo . '</div>'
         . '<a href="' . $url . '" style="display:inline-block;background:#F0912A;color:#fff;font-weight:700;font-size:15px;padding:12px 26px;border-radius:8px;text-decoration:none;">' . $gumb . '</a>'
         . '</div>';

    return $content . $cta;
});
