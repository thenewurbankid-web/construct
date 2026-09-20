// Generates the popover/menu concept mocks (#297). Output HTML is committed.
// Usage: node docs/design/mocks/build-popover.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { page as basePage, tree, shell } from './parts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const page = (t, b) => basePage(t, b).replace('href="mock.css">', 'href="mock.css"><link rel="stylesheet" href="popover.css">');

const PROJECT_ID = 'sh-project-popover', USER_ID = 'sh-user-menu';

const projectBtn = (open, ring, pop = '') => `<div class="pop-anchor"><button class="chip-btn ${ring ? 'focus-ring' : ''}" aria-haspopup="dialog" aria-expanded="${open}" aria-controls="${PROJECT_ID}">storefront <span class="sub">main</span> ▾</button>${pop}</div>`;
const acctBtn = (open, ring, pop = '') => `<div class="pop-anchor"><button class="acct ${ring ? 'focus-ring' : ''}" aria-haspopup="true" aria-expanded="${open}" aria-controls="${USER_ID}" aria-label="Signed in as Sam P."><span class="av" aria-hidden="true">S</span>Sam P.</button>${pop}</div>`;

/** Swap parts.mjs's static chip and avatar for real triggers, and add Review to the modes. */
const withTriggers = (html, { project = '', acct = '' }) => html
  .replace(/<button class="chip-btn" aria-haspopup="listbox">.*?<\/button>/, () => project)
  .replace('<span class="avatar">SP</span>', () => acct)
  .replace(/(<button class="[^"]*" role="radio" aria-checked="false">Build<\/button>)/, '$1<button class="" role="radio" aria-checked="false">Review</button>');

const panelBody = `
<div id="${PROJECT_ID}" role="dialog" aria-label="Switch project" class="popover panel start">
  <p class="hint">Pick a local folder to work on. Everything in Cockpit then uses that project.</p>
  <div class="crumb">~ / Desktop / repos / <b>storefront</b></div>
  <button class="pi focus-ring">▸ &nbsp;<b>..</b><span class="r">up one folder</span></button>
  <button class="pi">▸ &nbsp;checkout-service<span class="r">git repo</span></button>
  <button class="pi hl">▸ &nbsp;storefront<span class="r">git repo · architecture.yml</span></button>
  <button class="pi">▸ &nbsp;design-tokens<span class="r">folder</span></button>
  <div class="foot-actions"><button class="btn">Cancel</button><button class="btn primary">Use this folder</button></div>
</div>`;

const discBody = `
<div id="${USER_ID}" class="popover disc end">
  <div class="plain"><b>Sam P.</b>sam-p · signed in with GitHub</div>
  <button class="pi danger focus-ring">Sign out</button>
</div>`;

const card = (title, items, style) => `<div class="spec" style="${style}"><h3>${title}</h3>${items}</div>`;
const midStub = (specs) => `<div style="position:relative;flex:1">${specs}</div>`;
const rightStub = `<div class="sect">Inspector</div><div class="row muted">Nothing selected</div>`;
const drawerStub = `<div class="tabs" role="tablist"><button role="tab" class="on">Diagnostics</button><button role="tab">Logs</button><button role="tab">Processes</button></div><div class="body"></div>`;
const topbarSwap = (html, opts) => html.replace(/<header class="topbar">[\s\S]*?<\/header>/, (m) => withTriggers(m, opts));

// 1 - panel variant (project switcher)
writeFileSync(join(here, 'popover-panel.html'), page('Popover - panel variant (project switcher)', topbarSwap(shell({
  left: tree('features'),
  mid: midStub(card('Panel: open, focus in, Escape out', `<ol style="width:720px">
    <li><b>Open</b>: Enter, Space or click on the trigger. Focus moves to the first control inside (here the ".." row); it never stays on the trigger.</li>
    <li><b>Tab / Shift+Tab</b> walk the panel in visual order and <b>leave it at either end</b>: focus goes on to the next page control and the panel closes (focus-out).</li>
    <li><b>Escape</b> closes and puts focus back on the trigger.</li>
    <li><b>Click outside</b> closes; focus stays where the click landed.</li>
    <li>The page behind stays live and undimmed. <span class="no">This is not a focus trap</span> and there is no scrim. Modals (the command palette) trap; popovers never do.</li>
  </ol>`, 'left:24px;top:270px') + card('Trigger and surface ARIA', `<div class="aria" style="margin:0">trigger  aria-haspopup="dialog"
         aria-expanded="true|false"
         aria-controls="sh-project-popover"
surface  role="dialog" aria-label="Switch project"
         (no aria-modal: it does not block the page)</div>`, 'left:24px;top:500px')),
  right: rightStub, drawer: drawerStub, drawerH: 96,
}), { project: projectBtn(true, false, panelBody), acct: acctBtn(false, false) })));

// 2 - disclosure (account chip) + when to use a true menu
writeFileSync(join(here, 'popover-disclosure.html'), page('Popover - disclosure (account chip)', topbarSwap(shell({
  left: tree('features'),
  mid: midStub(card('Disclosure or menu? Decide by the keyboard you build', `<ul style="width:600px">
    <li><b>Disclosure</b> (default): a button that shows or hides content. Items are ordinary buttons or links reached with <code>Tab</code>. Plain text (the login line) is allowed inside. Use for up to 4 actions.</li>
    <li><b>Menu</b> (<code>role="menu"</code>) only when the primitive ships roving focus (<code>ArrowUp/Down</code>, one tab stop), <code>Home</code>/<code>End</code>, type-ahead, and every child is a <code>menuitem</code>, <code>group</code> or <code>separator</code>. Use from 5 actions, or for commands on one object (a process row: Pause, Resume, Cancel, View log, Copy command).</li>
    <li><span class="no">Never</span> put <code>role="menu"</code> on a surface whose keys do not behave like a menu: it promises a contract that a screen-reader user then finds broken.</li>
    <li>The account chip stays a disclosure: two items today (login line, Sign out).</li>
  </ul>`, 'left:24px;top:24px') + card('Account chip (disclosure) ARIA', `<div class="aria" style="margin:0">trigger  aria-haspopup="true"  aria-expanded  aria-controls="sh-user-menu"
         aria-label="Signed in as Sam P."
surface  id="sh-user-menu"   (plain group, no role="menu")
         login line = text · Sign out = &lt;button&gt;
Tab order: trigger -> Sign out -> next top-bar control</div>`, 'left:24px;top:330px')),
  right: rightStub, drawer: drawerStub, drawerH: 96,
}), { project: projectBtn(false, false), acct: acctBtn(true, false, discBody) })));

// 3 - states + true menu
const loading = `<div class="popover panel" role="dialog" aria-label="Switch project" aria-busy="true">
  <p class="hint" role="status">Looking for projects on this computer…</p>
  ${[70, 55, 62].map((w) => `<div class="skel-row"><span class="skel"></span><span class="skel" style="width:${w}%"></span></div>`).join('')}
  <div class="foot-actions"><button class="btn focus-ring">Cancel</button><button class="btn primary" aria-disabled="true" style="opacity:.6">Use this folder</button></div></div>`;
const empty = `<div class="popover panel" role="dialog" aria-label="Switch project">
  <div class="empty"><div class="ico">▤</div><b>No recent projects</b><p>Cockpit has not opened a project on this computer yet. Choose the folder that holds your app.</p><button class="btn primary focus-ring">Choose a folder…</button></div></div>`;
const error = `<div class="popover panel" role="dialog" aria-label="Switch project">
  <div class="err" role="alert"><span aria-hidden="true">⚠</span><div><b>Cannot read this folder</b><small>Permission denied: ~/Desktop/repos/private. Nothing was changed.</small></div></div>
  <div class="crumb">~ / Desktop / repos / <b>private</b></div>
  <div class="foot-actions"><button class="btn focus-ring">Try again</button><button class="btn">Choose another folder</button></div></div>`;
const menu = `<div class="popover disc" style="width:260px">
  <div role="menu" aria-label="Process actions: dev server">
    <button class="pi hl focus-ring" role="menuitem" tabindex="0">Pause<span class="r">P</span></button>
    <button class="pi" role="menuitem" tabindex="-1">Resume<span class="r">R</span></button>
    <button class="pi" role="menuitem" tabindex="-1">View log<span class="r">L</span></button>
    <button class="pi" role="menuitem" tabindex="-1">Copy command<span class="r">C</span></button>
    <div role="separator" style="height:1px;background:var(--border-subtle);margin:4px 0"></div>
    <button class="pi danger" role="menuitem" tabindex="-1">Cancel process<span class="r">Del</span></button>
  </div></div>`;
const cell = (cap, aria, inner) => `<div class="cell"><p class="cap">${cap}</p><div class="frame">${inner}</div><div class="aria">${aria}</div></div>`;
writeFileSync(join(here, 'popover-states.html'), page('Popover - states and the true menu', `
<div class="grid2">
  ${cell('<b>Loading</b> (panel): the surface opens at once and says what is happening; never a bare spinner.', 'aria-busy="true" on the dialog; hint is role="status"\nfocus: first enabled control (Cancel)', loading)}
  ${cell('<b>Empty</b>: no recent projects. One clear next action, focused first.', 'focus lands on "Choose a folder…"\nEscape still closes; focus returns to the trigger', empty)}
  ${cell('<b>Error</b>: says what failed and that nothing changed; offers a way out.', 'role="alert" announces once; focus goes to "Try again"\nplain-language message: no stack trace, no bare error code', error)}
  ${cell('<b>True menu</b> (5 actions, roving focus): valid only because all of this is built.', 'role="menu" > role="menuitem" · one tab stop (tabindex=-1 on the rest)\nArrowUp/Down move · Home/End jump · type a letter to jump · Enter runs\nEscape closes and returns focus · Tab closes and moves on (never traps)', menu)}
</div>`));

// 4 - placement, collision, narrow
const stripTb = (acct, project) => `<div class="tb"><div class="brand"><i></i>Cockpit</div>${project}<span class="spacer"></span><span class="pill ok"><span class="dot"></span>Local model ready</span>${acct}</div>`;
const sheetBody = `<h6 style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--text-faint)">Switch project</h6><p class="hint" style="margin:0 0 8px;color:var(--text-muted)">Pick a local folder to work on.</p>
  <div class="crumb">~ / Desktop / repos / <b>storefront</b></div>
  <button class="pi focus-ring">▸ &nbsp;..</button><button class="pi">▸ &nbsp;checkout-service</button><button class="pi hl">▸ &nbsp;storefront</button>
  <div class="foot-actions"><button class="btn">Cancel</button><button class="btn primary">Use this folder</button></div>`;
const acctPop = `<div id="${USER_ID}" class="popover disc end"><div class="plain"><b>Sam P.</b>sam-p · signed in with GitHub</div><button class="pi danger">Sign out</button></div>`;
writeFileSync(join(here, 'popover-placement.html'), page('Popover - placement, collision, narrow', `
<div style="padding:34px 24px 0;position:relative">
  <div class="strip" style="width:1280px;height:210px">
    <span class="edge-label" style="left:0">1280px viewport</span>
    ${stripTb(acctBtn(true, false, acctPop), projectBtn(false, false))}
    <div class="body" style="padding-right:320px">The account chip sits at the right edge, so its popover is <b style="color:var(--text)">end-aligned</b> (right edge = trigger right edge) and never crosses the viewport. The project switcher is <b style="color:var(--text)">start-aligned</b>; its 520px fits. Rule: prefer start, flip to end if it would overflow, then cap the width at viewport - 16px. Opens below the bar only, never upward; height capped at 70vh and scrolls inside.</div>
  </div>
  <div style="display:flex;gap:24px;margin-top:40px;align-items:flex-start">
    <div style="position:relative">
      <span class="edge-label" style="left:0">899px and narrower: full-width sheet under the bar, both variants</span>
      <div class="strip" style="width:899px;height:440px">
        ${stripTb('<span class="acct"><span class="av">S</span>Sam P.</span>', `<button class="chip-btn" aria-haspopup="dialog" aria-expanded="true" aria-controls="${PROJECT_ID}">storefront ▾</button>`)}
        <div class="sheet-pop" id="${PROJECT_ID}" role="dialog" aria-label="Switch project">${sheetBody}</div>
        <div style="position:absolute;left:0;right:0;bottom:0;height:96px;padding:16px 20px;color:var(--text-muted)"><b style="color:var(--text)">Sheet rules</b> · left/right 8px, top = bar height + 4px · max-height = 100dvh - bar - 8px, scrolls inside · no scrim (still not a modal) · Escape and outside tap close · same surface tokens as desktop.</div>
      </div>
    </div>
    <div>
      <p class="cap" style="margin:0 0 8px">390px phone</p>
      <div class="phone">
        <div class="tb"><div class="brand"><i></i></div><span class="chip-btn" style="max-width:112px">storefront ▾</span><span class="spacer"></span><span class="acct" style="padding:0 3px"><span class="av">S</span></span></div>
        <div class="sheet-pop"><div class="plain"><b>Sam P.</b>sam-p · signed in with GitHub</div><button class="pi danger focus-ring" style="min-height:44px">Sign out</button></div>
        <div class="tabbar"><div>Browser</div><div>Preview</div><div>Tools</div></div>
      </div>
      <p class="cap" style="margin:8px 0 0;max-width:390px">On a phone the account chip shows only its avatar; the sheet gives targets 44px tall.</p>
    </div>
  </div>
</div>`));
console.log('built popover mocks');
