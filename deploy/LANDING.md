# Landing page — knotkitchen.com

The public marketing site (landing + legal pages) is plain static HTML/CSS in
`deploy/landing/`, served directly by Caddy on the apex hostname. No build step,
no container. `home.js` only adds motion: with JavaScript off, or with reduced motion requested, the page reads the same, just still.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Landing page (hero, features, how it works, platform, FAQ, contact) |
| `terms.html` | Terms & Conditions |
| `privacy.html` | Privacy Policy |
| `refund.html` | Refund & Cancellation Policy |
| `return.html` | Return Policy |
| `shipping.html` | Shipping Policy |
| `style.css` | Shared stylesheet (light-only — see below) |
| `home.css`, `home.js` | Landing page only: the animated hero, feature grid, pricing cards and scroll reveals |
| `robots.txt`, `sitemap.xml` | Crawler hints |
| `assets/` | Brand artwork — see below |

### Brand assets (`deploy/landing/assets/`)

Derived from the masters in `D:\Knotkitchen\` (`LOGO.png`, `LOGO2.png`,
`APP LOGO.png`, `BACKGROUND.png`, `BACKGROUND2.png`): white background keyed to
transparency, trimmed, resized and re-encoded. Whole set is ~540 KB.

| Asset | Source | Used on |
| --- | --- | --- |
| `logo-horizontal.webp` | `LOGO2.png`, recomposed | Header brand lockup |
| `logo-stacked.webp` | `LOGO2.png` | Footer brand lockup |
| `hero-bg.webp` | `BACKGROUND2.png` | Hero background |
| `cta-bg.webp` | `BACKGROUND.png` | Contact block background |
| `og-image.png` | `APP LOGO.png` on navy | Social preview (1200x630) |
| `favicon-32.png`, `icon-180.png` | `LOGO.png` | Browser tab / home-screen icon |

The header lockup is composed from `LOGO2.png`: the stacked artwork is split at
its blank band into mark and wordmark, then reassembled side by side (mark at
1.55x the wordmark height, 0.30x gap).

Three rules, all learned the hard way:

1. **Never re-type "KnotKitchen" in a UI font next to the mark.** The wordmark
   is a specific face and is always artwork.
2. **Never recolour the artwork.** An earlier attempt derived a "reversed"
   variant by lifting the navy to white; it left a dark wedge where the knot
   crosses the K and muddied the K's lower leg.
3. **The site is deliberately light-only.** The lockup is navy + orange: on the
   cream header it measures 16.5:1, on a dark header 1.04:1 — i.e. invisible.
   With recolouring ruled out and a white plate behind the logo rejected, the
   remaining fix is to keep every surface the logo touches light. `style.css`
   declares `color-scheme:light` and carries no `prefers-color-scheme` block, so
   a visitor in dark mode sees the same light page.

The hero and contact block still use the dark brand artwork as backgrounds —
that is fine, because no lockup sits on them. **If a lockup is ever added to a
dark surface, it will disappear.** The contact block originally had one and it
was removed for exactly this reason.

If an official reversed/white lockup ever exists, dark mode can be reinstated —
but derive nothing.

The site palette (`style.css` `:root`) is sampled from the logo: orange
`#f4620a`, navy `#0a1b45`.

All policies carry the effective date **1st September, 2026** and point at
`support@knotkitchen.com`.

## How it is wired

`deploy/Caddyfile` — the `{$BASE_DOMAIN}` (apex) block now serves
`/srv/landing` with `file_server`, and falls back to `customer-web` on 404 so the
apex storefront routes keep working:

```
{$BASE_DOMAIN} {
	import security_headers
	encode zstd gzip
	root * /srv/landing
	file_server
	handle_errors {
		@notfound expression {err.status_code} == 404
		handle @notfound {
			reverse_proxy customer-web:80 { header_up Host {host} }
		}
	}
}
```

`deploy/docker-compose.yml` — the `caddy` service bind-mounts the directory
read-only:

```
- ./landing:/srv/landing:ro
```

`csd.`, `business.`, `onboard.`, `api.`, `admin-api.`, `agreement.` and the
`*.knotkitchen.com` wildcard are untouched.

## Responsive behaviour

The layout is **fluid, not breakpoint-driven**. Spacing, type and gutters are
`clamp()` tokens on `:root` (`--gutter`, `--section-y`, `--card-pad`,
`--grid-gap`), and `.wrap` is `width:min(var(--max),100% - var(--gutter)*2)`, so
the page adapts continuously rather than snapping at a few widths.

Grids use `auto-fit` + `minmax` with a column cap:

```
.g3{grid-template-columns:repeat(auto-fit,
    minmax(min(100%, max(268px,(100% - 2*var(--grid-gap))/3)), 1fr))}
```

The inner `max()` floors each track at 1/N of the row, which caps the count at N
— without it six feature cards sit 4+2 on a wide monitor. The outer `min(100%,…)`
stops a track overflowing a screen narrower than that floor. Features cap at 3,
steps at 4, footer at 3, hero at 2.

Media queries are now reserved for things `clamp()` cannot express:

| Query | Why |
| --- | --- |
| `min-width:861px` | Nav switches between disclosure menu and desktop bar |
| `max-width:700px` | Hero CTAs go full-width; footer lockup slims |
| `max-width:360px` | Folded/small phones — CTAs stack, logo and chips shrink |
| `max-height:560px` + landscape | Header un-sticks, hero padding cut — a sticky bar eats a short screen |
| `min-width:1600 / 2200px` | `--max` grows to 1240/1360px so content is not stranded on a large monitor |
| `prefers-reduced-motion` | Transitions and smooth scroll disabled |

The nav is one piece of markup for both layouts. `<details class="menu">` gives a
working disclosure menu with **no JavaScript**; at `min-width:861px` the
`<details>` and its UA `::details-content` box are both flattened with
`display:contents`. Two gotchas if you touch it:

* Chrome wraps `<details>` children in a UA `::details-content` box, so
  `display:contents` on the `<details>` alone does not flatten all the way. The
  header aligns with `justify-content:space-between` on `.nav` rather than an
  auto margin, which works whichever element ends up being the flex item.
* `summary` needs `list-style:none`, `::-webkit-details-marker{display:none}`
  **and** `::marker{content:"";display:none}` — without the last the disclosure
  triangle draws over the custom hamburger.

Tap targets are >= 44px (nav rows 56px, menu button 44px, brand 44px, legal-nav
pills 44px on phones). Inline links inside prose stay at text size.

**Verified:** all 6 pages x 9 widths from 280px to 2560px — 54 combinations,
zero horizontal overflow — plus landscape 812x375.

## Deploy

DNS already points `knotkitchen.com` (and `www`) at the VPS `93.127.194.80`,
so nothing to change there. On the VPS:

```bash
cd /srv/knot && git pull && docker compose -f deploy/docker-compose.yml exec caddy caddy validate --config /etc/caddy/Caddyfile && docker compose -f deploy/docker-compose.yml up -d caddy
```

`up -d caddy` recreates the container so the new bind mount is picked up. If the
Caddyfile is the only change, `docker compose exec caddy caddy reload --config
/etc/caddy/Caddyfile` is enough.

## Updating copy later

Edit the HTML in `deploy/landing/`, commit, `git pull` on the VPS. The mount is
read straight off disk — no container rebuild, no cache purge. `docker compose
restart caddy` only if a file does not appear.

## Local preview

```bash
python -m http.server 4321 --directory deploy/landing
```
