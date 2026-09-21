# Media: user-guide videos (module 10)

Short, real, screen-recorded guides for the documentation website. Owned by the `media` agent
(`.claude/agents/media.md`). Every video is a real Playwright run; the script is the source of truth.

## The series (plan)

| # | Title | Length | Shows |
|---|---|---|---|
| 1 | **Your first project, with sign-up, login and a home page** | 60-90 s | Sign in, open a project, create the `signup`, `login` and `home` features, see the pages and the route flow, validate |
| 2 | Plan a change and approve it | 60 s | A Note, the plan, the impact, run, approve one file |
| 3 | Bring in an existing feature | 60 s | Import wizard, review the diff, validate |
| 4 | Clone a project | 45 s | Paste a link, clone, open |
| 5 | Review a branch and run a test | 60 s | Git screen findings, run a generated test |

Only episode 1 is built for now.

## Episode 1 storyboard (captions are the script)

1. Intro card: Line mark, "Your first project". (3 s)
2. Sign in: "Sign in with GitHub. Only accounts the owner allowed get in." (demo login on the recording server; say so.)
3. "Open a project": the workspace gate; create a new project in the workspace (Create a project / init) named `acme`.
4. Features screen: "Create a feature": `signup`, then `login`, then `home` (Create -> new feature). Each appears in the list.
5. Pages screen: the three pages exist; open `home`; the node tree shows.
6. Features screen, `login`: routes under it and layers.
7. "Check the rules": validate passes.
8. Outro card: "You have a project that follows its own rules. Next: plan a change."

## Recording protocol

- Spec in `ui/e2e/tests/media/<nn>-<slug>.spec.js`, own config `ui/e2e/playwright.media.config.js`
  (`video: 'on'`, 1280x720, own ports, workspace = a temp dir, no project preloaded).
- Helpers in `ui/e2e/tests/media/support.mjs`: `caption(page, text)`, `pause(page, ms)`, `card(page, title, subtitle)`.
- Output: `site/assets/video/<nn>-<slug>.webm` (+ `.mp4`, `.jpg` poster), and a page
  `site/content/user/videos/<slug>.md` with a native `<video controls poster>` and the storyboard as text.
- Run: `tools/dev/heavy.sh npx playwright test -c playwright.media.config.js --workers=1`.
