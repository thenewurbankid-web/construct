Episode 1, part 1 of the "every episode is built in parts" series (docs/MEDIA.md): a static, presentational shop
page, adapted from a real, MIT-licensed template, with a wishlist heart and panel that render but do not yet do
anything — and how the Cockpit shows the missing link today. About two minutes, with captions. The video above is
silent; a narrated version and English subtitles are offered under it.

The narration is synthetic: a computer-generated voice, made with a free text-to-speech model from a recording the
project owner supplied of their own voice. It reads the captions below and is marked as synthetic; it is not a
recording of a person speaking.

![Video: episode 1 part 1, meet the page](@video/01a-meet-the-page)

## What you will see

1. Sign in and open the sample shop (the demo login, said on screen).
2. The catalog feature now has a shop page in it, adapted from a real Bootstrap template (Start Bootstrap "Shop
   Homepage"/"Shop Item", MIT), plus a wishlist heart button and panel. The page itself is declared **frozen** in
   `architecture.yml` — wrapped, not rebuilt — so it does not appear in the feature's own file list; the heart and
   panel are new, hand-authored components, so Construct documents them normally.
3. The page, running for real, full screen: a heart can be pressed, and nothing happens yet.
4. The Components screen's real props table already shows the heart button declares an `onToggle` callback —
   Construct does not yet cross-check whether any caller actually passes it (that gap is filed as a real ticket,
   [issue 473](https://github.com/thenewurbankid-web/construct/issues/473)); reading the page confirms `ShopHome` never
   does, which is why the heart does nothing.
5. The rules: no errors, one real warning (the wrapper controller is not exported from the feature's index yet).

## The captions

- Hi there! This is part one of a short series. First, let us meet a page that looks like a real product, but does
  not work yet.
- First, sign in. (This recording uses the demo login.)
- Open the sample shop.
- The catalog feature already has a shop page in it, adapted from a real template, plus a wishlist heart and panel.
- The page itself is frozen — wrapped, not rebuilt — so it does not even show up in this list.
- The heart and panel are new, hand-authored components, so Construct documents them normally.
- WishlistController: the wrapper. Right now it just forwards a fixed list of products.
- A new route, `/shop`, already points at it.
- One thing to look at: the wrapper is not exported from the feature yet.
- Here is that page in the Pages screen.
- Now let us open it, running for real, full screen.
- Try a heart. It renders, and it can be pressed. Nothing happens.
- Switch to Components and pick the heart button.
- Here is what it declares: `onToggle`, a callback. This table already exists today — Construct does not yet check
  whether any caller actually passes it.
- Reading the page confirms it: `ShopHome` never passes it. That gap is filed as a real ticket, number 473.
- Finally, the rules.
- No errors. One real warning: the wrapper is not exported from the feature yet.
- Next time, we wire it up. See you then.

## Vendored template

The shop page's layout is adapted from Start Bootstrap ["Shop Homepage"](https://github.com/StartBootstrap/startbootstrap-shop-homepage)
and ["Shop Item"](https://github.com/StartBootstrap/startbootstrap-shop-item) (MIT, verified 2026-09-22); the recording's
sample project vendors the license under `vendor/shop-template/`.

## Known gaps (not faked; the video stops before them)

Wiring the wishlist logic, and the object-level detection this video's evidence stands in for, are tracked separately:
[issue 473](https://github.com/thenewurbankid-web/construct/issues/473) (cross-checking a declared prop against every call
site) and [issue 478](https://github.com/thenewurbankid-web/construct/issues/478) (a frozen file is invisible to Construct's
own Components/Pages documentation, not only skipped by its layer rules — found while building this recording). The
series is paused after this part; see docs/MEDIA.md.
