# Demoing Trace

Trace is the demo front door of this tool (`/`). It takes a designed page and an API contract, wires the screen, and tells each team what doesn't fit. Everything you show goes through a small pattern language; the fine-grain studio stays one click away under **Details** and is never needed.

## The sentence to say once

> Trace finds the seams. Each is a **Fit**, a **Gap** or a **Tie**. Gaps and Ties become **Asks**, which you answer or **Suggest** answers. Answers go in the **Ledger**, so a **Replay** gives the same result. Each team gets a **Handoff**.

Until you answer, a part is **Waiting**, not failed: amber, with a clock. It only turns into a red **Gap** when someone settles it as having nothing behind it (you answer "Not in the API yet", or no question is possible). Say: "Amber is a question waiting for a person. Red is a confirmed hole."

(A "seam" is a place where design, API and product meet and may not fit. In plain speech, say "mismatch".)

| Word | Means |
|---|---|
| Fit | a part the contract reproduces exactly |
| Waiting | a part whose Ask is still open: waiting for your answer, nothing is wrong yet |
| Gap | a part with nothing behind it, confirmed |
| Tie | two explanations fit equally well |
| Ask | a Gap or a Tie turned into a question with concrete options (the part waits, amber, until it is answered) |
| Stub | an honest, marked stand-in for something that doesn't exist yet |
| Suggest | the AI proposes an answer that rules check |
| Ledger | every decision, with who or what made it |
| Replay | run again from scratch, same output |
| Handoff | what a team must do, plus the ready email |
| Fit report | the summary of the run |

## Before you go on stage (2 minutes)

1. `npm run demo:check`. It must end with **READY**. It runs all three scenarios end to end in a scratch copy and fails loudly if a file is missing or a scenario no longer gives the numbers below. Warnings are fine:
   - *Suggest helper not running*: fine, see "If Ollama isn't running" below.
   - *Ledger has decisions / prepared fix already applied*: left over from an earlier take. Press **Reset demo** for a clean take.
2. `npm run demo` (runs the check, starts the server and opens `http://localhost:4177/`, or the next free port if that one is busy; the server prints the address).
3. Press **Reset demo** (top right) and confirm. Optional: press **Present** (or open `/?present=1`) to enlarge the type and slow the reveal a little so an audience can follow. Presenter mode also hides Details and Reset. On the first screen **Wire it** and the Suggest switch stay pinned to the bottom edge (in both modes, at any window height and with any number of endpoints in the Contract card), so the button never needs a scroll.
4. Keyboard, if you present without a mouse: `1`-`3` pick a screen, **Space** wires and continues, `1`-`9` answer an Ask, `S` skips it, **Shift S** skips the rest, `R` replays, `T` replays the trace, `M` shows the Map, **Esc** goes back.

Every take below runs with **Suggest off** and never needs a model. Total time per scenario is about 60 seconds of clicking, 2 minutes with talking.

## Scenario 1: Portfolio Health (a real page)

*Screenshot: `docs/demo/portfolio-1-drop.png` (light theme; the first screen with the design picture, the Contract card, the 3D mark and the three steps).*

| Do | Say |
|---|---|
| Pick **Portfolio Health**. Point at the small picture of the page (**Design**) and the **Contract** panel. | "This is a real page from our design tool, against the real draft contract for Category Health." |
| Point at the three steps under the button. | "Wire it, answer the Asks, hand off. That is the whole tool." |
| Press **Wire it**. | "Trace reads the page and matches every part against the API, with fixed rules. It never guesses." (The mark pulses for a third of a second before the screen changes.) |
| The page fills with amber. Point at the ring. | "**8 of 29** parts fit. The other 21 are **waiting for you**: each is a question, not a failure." |
| The first Ask is *Rank*. Press `S` six times until **Ask 7 of 21: Maturity** appears. | "Here is a real mismatch." |
| Read the card. | "The design shows 2.0, 1.8, 2.1. The API has `maturity_score: 58`. One is a 1 to 5 scale, the other 0 to 100. Nothing in the API gives it, so Trace asks instead of guessing." |
| Optional: press `1` (Not in the API yet). | "Now it is settled. That part turns from amber to red: a confirmed **Gap**." |
| Press **Skip the rest** (Shift S). | "I'll leave the others for the teams." |
| Press **See the Handoffs** (Space). | "Nobody has to hunt for this. **Backend gets 19 things**, Product gets 2." Each open item is marked **Ask** (a clock icon), because it is waiting for an answer. |
| Press **Copy** on Backend (or open the email with **Open in mail app**). | "Each team gets a ready email: what we saw, what the design shows, what the API returns today." |

**Expected numbers** (clean state, every Ask skipped): **8 of 29 parts fit · 21 waiting for you · 0 gaps**; Backend 19, Product 2, Design 0, Frontend 0. Ledger: nothing recorded if you skip everything. If you answer Maturity "Not in the API yet" and skip the rest: 8 fit, 20 waiting for you, 1 gap.

Note: the page has two buttons with the same action name ("suggest"). The Product card lists them once, as **The “suggest” button … ×2**, and the trace list says **The suggest button ×2**; the trace draws one line for the pair, and the total is still 29 parts (see "How the numbers add up").

## Scenario 2: Invoices (lots of Asks)

*Screenshot: `docs/demo/invoices-2-fit.png` (dark theme; the fit screen with waiting, Tie, Gap and Stub parts).*

| Do | Say |
|---|---|
| Pick **Invoices**, press **Wire it**. | "One screen, six things the contract can't settle on its own." |
| Ask 1, a **Tie**: *Which field is Requested by?* Point at the two candidate fields and their sample values. | "Two fields look the same in the sample data. Trace won't pick one for us." Press `1` (requester). |
| Ask 2, a **Waiting** part: *Nothing in the API gives Status.* Press `1` (Not in the API yet). | "The design has a column the API doesn't have. It was waiting, amber. Answered, it is a confirmed **Gap**, red." |
| Asks 3 to 5: press `1` each time. | "Every Ask has concrete options, taken from the data." |
| Ask 6, the *archive* button: press the last option, **Something else, name my own handler (a Stub)**, then Enter to accept the name. | "A button nobody defined. We make it an honest Stub: marked, named, nobody has to guess." |
| **See the Handoffs**. | "**16 of 19** fit. Two Gaps go to Backend, the Stub goes to Frontend." |
| Open the **Ledger** (below the cards). | "Every decision is recorded, with who made it." |
| Press **Replay** (`R`). | "Run it again from scratch." It goes straight through with no Asks and shows **Same result as the last run**. "Same answers, same result. That's the Ledger." |

**Expected numbers** (answering `1` on Asks 1 to 5 and the Stub on Ask 6): 16 of 19 parts fit, 2 Gaps and 1 Stub, nothing waiting; Backend 2, Frontend 1, Product 0, Design 0; Ledger 6 decisions, all "by you". Skipping every Ask instead gives **13 of 19 · 3 waiting for you · 3 ties** (no gaps yet). Answering `1` on every Ask, including archive, gives 17 of 19 with 2 Gaps.

## Scenario 3: Orders (fix the API, Replay closes everything)

*Screenshot: `docs/demo/orders-3-handoffs.png` (light theme; the Handoffs, with Ask items and Gap items). Only three screenshots are kept in the repository.*

| Do | Say |
|---|---|
| Pick **Orders**, press **Wire it**. | "Here the design is ahead of the API." |
| Ask 1: *Nothing in the API gives Status.* Press `1`. Then **Skip the rest**. | "Status isn't in the API: that is a confirmed Gap. Delete and Save need endpoints that don't exist yet: those two buttons are still waiting for someone to say what they should do." |
| **See the Handoffs**. | "**11 of 15** fit, 2 waiting for you, 2 gaps. Backend gets two things, Product two." |
| Press **Backend ships the fix** (the banner above the cards). | "Now imagine Backend does what the email asked: adds the field and the endpoints." |
| Press **Replay** (`R`). | "Run it again from scratch." |
| The Fit report now reads **All 15 parts fit** and the chip **4 → 0 need a human**. | "Every Gap closed at once, and nothing needed asking again." |
| Press **Replay** once more. | "**Same result as the last run.** It is deterministic." |

**Expected numbers**: with Status answered `1` and the rest skipped, 11 of 15 parts fit · 2 waiting for you (Delete, Save) · 2 gaps (Status, the Notes input) (Backend 2, Product 2); with every Ask skipped, the first screen after Wire it reads 11 fit, 3 waiting, 1 gap. After the fix and one Replay, All 15 parts fit and every card shows 0.

## The first screen (Drop in)

Three columns at desktop width: **Pick a screen to wire**, **Design** and **Contract**, with the 3D mark under the Contract card and, under the **Wire it** button, three small steps: *Wire it, Answer the Asks, Hand off*.

- **Design** is a small live picture of the selected screen's designed page (about 320 by 200), so the audience sees what is about to be wired. It is the same page the fit screen draws (`GET /api/preview`, no new route), shown in a sandboxed frame that cannot run scripts and cannot be clicked (`sandbox=""`, `pointer-events: none`, `aria-hidden`); the caption under it is the text version. It follows the theme, changes when you pick another screen, and its box has a fixed shape, so nothing moves. It is hidden below 1000 px, together with the 3D mark. Code: `src/ui/thumb.mjs`.
- **Wire it** holds the first screen for about a third of a second (`WIRE_DELAY_MS` = 350 ms in `src/ui/wire-delay.mjs`, tested) so the mark's pulse is seen before the fit screen takes over. There is no wait with reduced motion, and none from the Space shortcut (which never plays the pulse). Say nothing, just let it pulse.

## Reading the fit screen: colours and counts

| State | Colour | Not by colour alone | Means |
|---|---|---|---|
| **Fit** | green | thin solid edge, a check | the contract reproduces it exactly |
| **Waiting** | amber | solid edge, a clock, the word "waiting for you" | an Ask is open. Nothing is wrong yet |
| **Gap** | red | dashed edge, a slashed circle | settled: nothing behind it |
| **Tie** | amber, split | double edge, half-filled swatch and a striped ring segment, an equals sign | two fields fit equally |
| **Stub** | violet | dotted edge, a dashed square | an honest, marked stand-in |

Every colour holds at least 3:1 against the page, card and quiet surfaces in both themes (a test checks it). The ring, the legend, the headline and the Handoff cards all use these five, in this order: Fit, Waiting, Gap, Tie, Stub. The headline reads like **8 of 29 parts fit · 21 waiting for you** (then gaps, ties and stubs when there are any); with nothing open it reads **All N parts fit**. A part is **Waiting** while its Ask is open, including one you skipped; it becomes a **Gap** only when it is settled. In the Handoffs, an open item is an **Ask** (clock icon), a settled one is a **Gap**.

**How the numbers add up.** Every count is a count of parts of the design. Two buttons with the same name are two parts: the ring and the legend count both, the trace list and the Map show them once as **×2**, and the trace draws one line for the pair. So the trace list total ("29 parts" on Portfolio) always equals the ring's total, and the rail chips count parts too.

## 3D hero (Drop in screen)

Under the Contract card sits the Trace mark as a slowly turning 3D object: an outline-only glowing capsule (a thin tube, no fill) in the mark's own blue gradient, taking its colours from the theme so it also holds on the light paper. It nudges toward the pointer, and gives one brief brighter pulse while **Wire it** is pressed. It is decoration only (`aria-hidden`, no focus stops, nothing is said by it alone).

- **What loads:** Three.js is vendored (no CDN) and bundled with esbuild into `src/ui/hero3d/hero.bundle.mjs` (about 523 KB raw, 135 KB gzip, 112 KB brotli). It is fetched lazily, only when the Drop in screen is showing and WebGL exists. Rebuild it after touching `src/ui/hero3d/scene.mjs` or `geometry.mjs` with `npm run build:hero` (`three` and `esbuild` are dev dependencies: only that command needs them; the built bundle is in the repository and a deployed build does not carry them).
- **Fallbacks (always the static mark, sized the same, never an error):** no WebGL, reduced motion is on (one still 3D frame, no loop; without WebGL, the static mark), Data Saver on, battery at 20 percent or less and not charging, or the module fails to load. Windows 1000 px wide or narrower hide the hero (the screen stacks there).
- **Turn it off:** open `/?hero=off` (nothing shown, the layout is as before). `/?hero=svg` forces the static mark, handy for checking the fallback.
- **Behaviour:** the loop runs only while the tab is visible and the hero is on screen, at most 60 fps; leaving the Drop in screen disposes the renderer, geometries and listeners. A lost WebGL context switches back to the static mark and returns to 3D when the browser restores it.
- For debugging on a dev checkout only (never on a deployed build): open the page with `?canvasdebug` and `__traceHero` in the console shows the mode and why, the listener count and the renderer's stats (`window.__trace` for the canvas layer, the same way).

## Canvas visuals (The fit screen)



**What the audience sees.** A **Contract** rail now sits on the right of the designed page, with one chip per endpoint. As each part resolves, a thin blue pulse runs from that part to the endpoint it comes from: a **Fit** arrives, the chip lights up for a moment and the line settles as a faint path; a **Waiting** part runs a short dashed amber line and pauses at an open ring near the part, breathing twice: nothing is settled, so nothing is cut off and there is no red mark; a **Gap** (settled) runs and breaks at a small red mark before it reaches the contract; a **Tie** splits in two, amber, to two candidate fields; a **Stub** is a dashed violet line to a marked stand-in at the bottom of the rail. A part the design just keeps (a fixed label, "edit") has nothing to trace to and only gets a soft ring. Say: "Trace follows each part back to where it came from. Where it can't get there, it stops."

**Replay.** Press **Replay the trace** (or `T`) to run the animation again over the result on screen. Nothing is sent to the server and nothing changes. Only parts you can see animate; the rest are already drawn.

**Map.** The **Map** button (or `M`) swaps the page for a map: parts on the left, contract endpoints and fields on the right, one curve per part in its colour. Drag to move, scroll or pinch to zoom, click a part to select it; **Show on the page** takes you back to it, marked. The same facts are a plain list beside the map (and, under the page, in **The trace, as a list**), so a keyboard or screen reader gets everything. Esc leaves the Map.

**Reduced motion.** With the system setting "reduce motion" on, nothing travels: the settled paths are just drawn, there is no glow, and the Replay button is disabled (its tooltip says why). **Present** makes the pulses slower and the strokes bigger. A hidden tab does no drawing work and comes back settled.

The canvases only draw what is already on the page; they never change a result, an answer or any generated file.

## Fixing a part: the inspector (optional, 60 seconds)

After a run, every part that needs a human shows a small badge on the page (Gap, Tie, Stub, No endpoint), on the "Needs a human" list and on the Handoff items. Click any of them to open the **Part inspector**. Each option carries a small tag: **Rule default** marks the first option in the rules' fixed order (cheapest first, then alphabetical). It is a default, not a recommendation and not evidence that it is right.

| Do | Say |
|---|---|
| In **Invoices**, press **Wire it**, **Skip the rest**, then click the **Tie** badge on *Requested by*. | "Every problem names its kind. This one is a Tie: two fields give the same four names." |
| Point at the two option cards. | "Each option shows what it produces on the design's own examples, where it comes from in the API, and the code that is generated today. Both give Lena, Mia, Prerna, Arjun." |
| Press `2` (or click **The field requester**). | "Before anything is written, it shows the effect: **13 of 19 becomes 14 of 19**, and the three generated files that would change." |
| Press **Suggest** (optional, needs Ollama). | "One small, checked AI call for this part only. It can only pick one of these options and must cite a fact. Applying is still my click." |
| Press **Apply**. | "It is written to the Ledger with who did it, and the screen replays: the Fit report and the Handoffs update." |
| Press **Undo**. | "Back to how it was, also recorded." |

Keys inside the inspector: `1`-`9` or the arrows choose an option, **Enter** applies, **Esc** closes. **Fix all similar** appears in **Portfolio Health** (choose "Not in the API yet" on any row field: nine others share it). The chat on the right only answers about the part on screen and says "I only know about this part." to anything else.

If Ollama isn't running, Suggest says so in one line and everything else works. Undo history is in `answers.history.jsonl` and is cleared by **Reset demo**.

## What not to claim

- **No "saves X hours".** Time saved is not measured. Say **"finds what doesn't line up before anyone codes it."**
- Do not say Suggest is accurate. It is a small local model whose answers are checked by rules; it is a first pass, and in the one Invoices run we recorded it answered every Ask with a Stub. Answers you give yourself always win.
- Do not say it works on any page. The page needs three small markers (`data-dyn`, `data-list`, `data-action`) and one list and one form per page; the API comes from a hand-written file. Three of the example pages are real designs from a design tool, against a draft contract.
- Do not say it "generates the whole app". It writes layered code for the parts that fit and marks everything else.
- The Contract card takes an uploaded Swagger/OpenAPI file (.json, .yaml, .yml); the file is checked and a bad one is refused with the reason. Only what the matcher reads is used (examples and the shape of a missing example); do not claim it understands auth, error responses or required fields. **Reset demo** puts the original contract back.

## If Ollama isn't running

Nothing breaks. Suggest is an optional extra: with it off, every scenario runs end to end and every Ask is answered with a click, exactly as above. When the helper isn't reachable, the switch **Let Suggest answer what it can** is disabled and says, in one line, "Suggest isn't available right now, so you answer the Asks yourself. Everything else works the same." The **Edit and rewrite with AI** link on a Handoff opens the editor, where hand editing works and only the rewrite needs the helper.

To use Suggest: start Ollama (`ollama serve`, model `qwen2.5-coder:1.5b`), then reload; `npm run demo:check` shows PASS for it.

## Resetting between takes

- **Reset demo** (top right, a confirm first) clears the saved answers of all three scenarios and restores the original contracts (also one you uploaded). It also frees any run a closed tab left waiting on an Ask.
- From a terminal: `npm run reset` (every example) or `npm run reset -- orders`.
- Skipped Asks are not recorded, so they are asked again on the next Wire it; answered Asks are in the Ledger and are not asked again until you reset.

## If something goes wrong on stage

| Symptom | Do |
|---|---|
| "Trace's server isn't answering" | The terminal running `npm run demo` was closed. Start it again and press **Try again**. |
| "The connection dropped" | Press **Reconnect**; the server keeps every event of the run. |
| A run fails | Press **Try again**; if it persists, **Reset demo** and start over. Your design and contract are never modified by a run (except the Orders fix you asked for). |
| Reset says a run is still finishing | Wait a few seconds and press it again. |
| Port busy | `node src/server.mjs --port 4200` and open that address. |

## Known rough edges (for you, not the audience)

- The studio's email text prints "Candidates: undefined" for a part answered "not in the API yet". The demo hides those lines; the studio composer still shows them.
- The team emails are fixed text from the pipeline, so an email still says a waiting part "has nothing behind it in the API"; the shell words the same item as "waiting for an answer". The email text is deliberately unchanged.
- The Ask order is fixed by the tool (Maturity is the 7th Ask on Portfolio); there is no way to jump to it.
