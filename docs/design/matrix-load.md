# Matrix load: the UI is code first, then becomes real

Owner idea, 2026-10-17, for the Smith chat viewer (Oracle prototype, `localhost:8787`). Built by the session that owns
the viewer; this note is the record so the idea survives any one session.

## In the owner's words

- "we want our whole ui to start as matrix code and slowly render into real ui"
- "first starts as matrix code rain and blocks start appearing as outline in matrix code and screen keeps turning into
  real html output, like matrix is loading"
- "even the whole page transitions / loader matrix style"
- "for images and dom content in chat, first show a placeholder with loader when loading inline content, make it seem
  like the matrix code transforms into dom, just like in matrix"
- "show matrix rain as loading animation only" / "no need of background as matrix"

## The load, in three stages that overlap

1. **Rain.** The screen is only falling Matrix code.
2. **Outlines.** The app's blocks (sidebar, header, chat column, message bubbles, composer, buttons) appear as
   outlines drawn in code inside the rain: glyphs gather along each block's edges and inner structure (a text line
   becomes a row of dots, a button a rounded outline). Brightest where content is densest. The outlines come from the
   real layout (`getBoundingClientRect` of the main elements), so the wireframe matches what appears next.
3. **Real.** Block by block, the outlined areas fill in and turn into the real HTML; rain keeps falling over what is
   not real yet, until the whole screen is the live UI.

## Where the same effect is used

| Where | What happens |
|---|---|
| First load | The three stages above. |
| Every transition in the app ("all transitions on app like this please"): switching chats; opening Plan, Chat, Summaries, a session; the settings sheet, dialogs and popovers opening and closing; the sidebar collapsing; groups expanding; a new message, card or step appearing; a panel swapping content | What leaves dissolves into code; what arrives resolves out of code. Small elements get a small, quick version (about 200–300 ms); full views about 400–700 ms. No plain CSS fades or slides left anywhere except under reduced motion. |
| Inline content (web page snippets, images, visuals) | A placeholder at the expected size with rain inside; when ready, the code resolves into the content. |
| Anything else loading (a step pending, a model replying) | Rain while it loads, nothing when it is done. |
| Idle | No rain. There is no ambient Matrix background. |

## Images and text turning real

- **Images and visuals** pass through an ASCII-art stage: sample the loaded image's brightness per cell and draw a
  glyph by density (heavy `M # $ W` for bright, light `` ` ' . _ `` for dark) in Matrix green, then sharpen cell by
  cell into the real image.
- **Text** resolves from scrambled glyphs into the real characters.
- On error the placeholder becomes one plain line ("could not load", with the link), never an endless loader.

## References the owner sent

- Matrix trilogy opening titles (YouTube `uX5vCG6gdsk`): code gathered into a city grid seen from above, then at an
  angle with perspective depth fading into darkness. Brightness is depth: near is bright, far is dim.
- "I Am Not The Glitch" short (YouTube `LpJRkdUbV50`), two frames:
  - a cat made of glowing green dots and glyphs: contours and fur lines traced in code, brightest at the edges and the
    near side, sparser inside, a glowing reflection below. The model for stage 2;
  - the same subject as green ASCII art, the image visible through character density. The model for images turning
    real.

## Limits

- Canvas 2D only, one shared `requestAnimationFrame` loop for every effect on screen, frame rate capped; no WebGL, no
  new dependencies, no build step. Reuse the viewer's `matrixRain()` (`scripts/ascii-background.js`).
- Short: transitions never block input longer than they run.
- `prefers-reduced-motion`: a plain fade, no rain.
- Paused offscreen and while the tab is hidden; no cost when nothing is loading.
- Matrix green belongs to the effect only (rain, outlines, ASCII stage). Controls and text never use it (owner,
  2026-10-17: "no matrix green for controls and text please"): buttons, toggles, sliders, links, selection and focus
  rings take neutral greys and the normal ink colours, so the app reads as professional once it is real. The light
  theme must still read.
- Checked by DOM render and module tests, not Playwright (owner rule for local dev).
