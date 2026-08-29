# Brand masters

The original 2000×2000 artwork. Everything the apps ship is derived from these
and is smaller — regenerate from here, never upscale a derivative.

They were loose in the parent working folder, existing only on one laptop.
They are here so they survive that laptop.

## What each file is

| File | Content |
| --- | --- |
| `knotkitchen-lockup-tagline-2000.png` | Mark + "KnotKitchen" wordmark + "Smart POS for Every Kitchen" tagline and feature icons. The full lockup. |
| `knotkitchen-lockup-2000.png` | Mark + wordmark, **no tagline**. |
| `knotkitchen-mark-2000.png` | The infinity-K mark alone, no words. |
| `auth-background-darker-2000.png` | Login background, the darker of the two. |
| `auth-background-lighter-2000.png` | Login background, the lighter of the two. |

**The first three are easy to confuse and have been confused before.** Picking
the lockup where the bare mark was wanted rendered the wordmark twice on the
POS login screen — once as the image, once as HTML text. It was only caught by
looking at the page. If you are choosing between them, open them; the
filenames alone have misled once already.

## What ships in the apps

Derivatives live in `pos-frontend/src/assets/images/brand/`:

| Shipped file | Size | From |
| --- | --- | --- |
| `knotkitchen-lockup.png` | 720×507 | the tagline lockup |
| `knotkitchen-logo.png` | 720×400 | the plain lockup |
| `knotkitchen-mark.png` | 512×297 | the mark |
| `auth-bg.webp`, `auth-bg-dark.webp` | — | the two backgrounds |

PWA icons and favicons are generated from the mark.

Both `auth-bg` files are noticeably darker than either source (measured mean
brightness 67 and 21, against 99 and 130), so the processing darkened them for
text contrast. The pairing above follows from that ordering — darker source to
darker output — but it was inferred, not recorded at the time. Check before
relying on it.

## Regenerating

Work from the 2000px files at their native size and downscale once. An earlier
pass produced a soft icon by scaling the mark down to 400px and then back up to
481px; everything was regenerated from these masters to fix it.
