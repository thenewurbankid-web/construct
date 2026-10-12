// Mission Control "Context / jev" view, client side (#899). Loaded by index.html (<script src="/ctx/view.js">);
// index.html's renderDetail calls window.ctxView.decorate(el, d) at its end. Adds a "context / jev" toggle to the bench
// row detail; when on, shows the run summary and, for the selected row's turn, each context line with its static
// score, jev's shadow score, the rank under each, and KEPT/DROPPED under the cap. Data: /ctx/api?run= (context-view.mjs).
'use strict';
(() => {
  const st = { on: false, run: undefined, at: 0, data: null, err: null, loading: null };
  const e = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const css = document.createElement('style');
  css.textContent = `
.ctxv { border-top: 1px solid var(--line2); padding: 6px 8px; font: 11px/1.4 var(--mono); }
.ctxv .sum { display: flex; flex-wrap: wrap; gap: 4px 14px; color: var(--dim); margin-bottom: 6px; }
.ctxv .sum b { color: #e8f1fa; font-weight: 600; }
.ctxv h5 { margin: 8px 0 3px; font: 600 11px var(--mono); color: #9fb3c8; }
.ctxv .tag { padding: 0 5px; border-radius: 3px; border: 1px solid var(--line2); margin-left: 6px; font-size: 10px; }
.ctxv .tag.rec { border-color: var(--amber); color: var(--amber); }
.ctxv .tag.log { border-color: var(--blue); color: var(--blue); }
.ctxv table { table-layout: auto; margin: 2px 0 4px; }
.ctxv td, .ctxv th { padding: 1px 6px; border-bottom: 1px solid var(--line); vertical-align: top; white-space: normal; position: static; }
.ctxv td.n { text-align: right; white-space: nowrap; }
.ctxv .K { color: var(--green); font-weight: 700; } .ctxv .D { color: var(--faint); }
.ctxv tr.dis td { background: #3a2a05; } .ctxv tr.dis td.t::before { content: "\\2260 "; color: var(--amber); font-weight: 700; }
.ctxv tr.drop td.t { color: var(--dim); }
.ctxv .fx { color: var(--dim); white-space: pre-wrap; margin: 2px 0; }`;
  document.head.appendChild(css);

  async function load(run) {
    if (st.data && st.run === run && Date.now() - st.at < 3000) return st.data;
    if (st.loading) return st.loading;
    st.loading = (async () => {
      try {
        const r = await fetch(`/ctx/api${run ? `?run=${encodeURIComponent(run)}` : ''}`);
        const j = await r.json();
        st.data = r.ok ? j : null; st.err = r.ok ? null : j.error ?? `HTTP ${r.status}`;
      } catch (x) { st.data = null; st.err = x.message; }
      st.run = run; st.at = Date.now(); st.loading = null;
      return st.data;
    })();
    return st.loading;
  }

  const pct = (v) => (v == null ? '—' : `${v}%`);
  const num = (v) => (typeof v === 'number' ? v.toFixed(2) : '—');
  function summaryHtml(s, hintState) {
    return `<div class="sum"><span>refusals <b>${s.refusals}</b> (logged ${s.logged}, reconstructed ${s.reconstructed})</span>`
      + `<span>lines shown <b>${s.shown}</b> of ${s.candidates}</span><span>kept <b>${pct(s.keptPct)}</b></span>`
      + `<span>static vs jev disagree <b>${pct(s.disagreePct)}</b> (${s.disagree}/${s.jevLines} lines jev scored)</span>`
      + `<span>jev logged ${s.jevLogged}, unreachable ${s.jevUnreachable}</span><span>hint-state.json ${hintState ? 'read' : 'absent'}</span>`
      + `${s.drift ? `<span style="color:var(--amber)">${s.drift} logged keeps differ from today's static scorer</span>` : ''}</div>`;
  }
  function entryHtml(x) {
    const head = `<h5>${e(x.rowId)} · turn ${x.turn ?? '—'} · ${e(x.tool ?? x.cmd)} ${e(x.code ?? '')}`
      + `<span class="tag ${x.source === 'reconstructed' ? 'rec' : 'log'}">${x.source}</span>`
      + `<span class="tag">picked by ${e(x.via)}</span><span class="tag">cap ${x.cap} (${e(x.capSource)}${x.repeat ? `, repeat ${x.repeat}` : ''})</span>`
      + `<span class="tag">jev ${x.jev}${x.jevMs != null ? ` ${x.jevMs} ms` : ''}</span></h5>`;
    const fixes = (x.fixes || []).map((f) => `<div class="fx">[${e(f.ref)}]${f.recommended ? ' (recommended)' : ''} ${e(f.sentence)}${f.why ? `\n  why: ${e(f.why)}` : ''}${f.effect ? `\n  effect: ${e(f.effect)}` : ''}${f.context?.length ? `\n  context: ${e([].concat(f.context).join(' | '))}` : ''}</div>`).join('');
    const extra = [x.card ? `<div class="fx">rules card: ${e(x.card.tool)}${x.card.layer ? ` (${e(x.card.layer)})` : ''}: ${e((x.card.rules || []).join(', '))}</div>` : '',
      x.spec ? `<div class="fx">spec slice: ${e(typeof x.spec === 'string' ? x.spec.slice(0, 300) : JSON.stringify(x.spec).slice(0, 300))}</div>` : ''].join('');
    const rows = x.lines.map((l) => {
      const cls = [l.disagree ? 'dis' : '', l.shown ? '' : 'drop'].join(' ');
      const kd = (k) => (k == null ? '<span class="D">—</span>' : k ? '<span class="K">KEPT</span>' : '<span class="D">DROPPED</span>');
      return `<tr class="${cls}" title="${l.disagree ? 'static and jev disagree on kept/dropped' : ''}"><td class="n">${num(l.static)}</td><td class="n">#${l.staticRank}</td><td>${kd(l.keptStatic)}</td>`
        + `<td class="n">${num(l.jev)}</td><td class="n">${l.jevRank ? `#${l.jevRank}` : '—'}</td><td>${kd(l.keptJev)}</td>`
        + `<td class="n">${l.shown ? 'shown' : ''}</td><td>${e(l.kind)}${l.ref ? ` [${e(l.ref)}]` : ''}</td><td class="t">${e(l.text)}</td></tr>`;
    }).join('');
    return `${head}${fixes}${extra}<table><thead><tr><th>static</th><th>rank</th><th>cap</th><th>jev</th><th>rank</th><th>cap</th><th></th><th>kind</th><th>line</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  async function paint(box, d) {
    const run = (typeof S !== 'undefined' && S.run) || '';
    const data = await load(run);
    if (!box.isConnected) return;
    if (!data) { box.innerHTML = `<div class="muted">context view failed: ${e(st.err)}</div>`; return; }
    const mine = data.entries.filter((x) => (d.row.turn != null ? x.turn === d.row.turn : x.idx === d.row.idx));
    box.innerHTML = `<h4>Context / jev</h4>${summaryHtml(data.summary, data.hintState)}`
      + (mine.length ? mine.map(entryHtml).join('') : `<div class="muted">No refusal in ${d.row.turn != null ? `turn ${d.row.turn}` : 'this call'}: context lines are picked for refusals only.</div>`);
  }

  window.ctxView = {
    decorate(el, d) {
      const tools = el.querySelector('.tools');
      if (!tools || !d?.row) return;
      const b = document.createElement('button');
      b.className = `btn${st.on ? ' on' : ''}`; b.id = 'detCtx'; b.textContent = 'context / jev';
      b.setAttribute('aria-pressed', String(st.on));
      b.title = 'Context lines of this turn: static and jev scores, ranks, kept/dropped under the cap';
      tools.insertBefore(b, tools.querySelector('.muted'));
      const box = document.createElement('div');
      box.className = 'ctxv wide';
      if (st.on) { el.insertBefore(box, tools.nextSibling); box.textContent = 'loading…'; paint(box, d); }
      b.addEventListener('click', () => { st.on = !st.on; if (typeof renderDetail === 'function') renderDetail(d); });
    },
  };
})();
