// Mission Control "full input / raw output" toggle, client side (#913). Loaded by index.html
// (<script src="/turn-io/view.js">, after the main script: that one line is the whole hook) and wraps the page's global
// renderDetail so window.turnIo.decorate(el, d) runs after it. The toggle shows only when the row's turns.jsonl record
// points at turn-input/turn-output files; the HTML comes from /turn-io/api (turn-io.mjs).
'use strict';
(() => {
  const st = { on: false, cache: new Map() };
  async function paint(box, run, turn) {
    const key = `${run}|${turn}`;
    let html = st.cache.get(key);
    if (html == null) {
      try {
        const r = await fetch(`/turn-io/api?turn=${turn}${run ? `&run=${encodeURIComponent(run)}` : ''}`);
        const j = await r.json();
        html = r.ok ? j.html : `<pre>${String(j.error ?? r.status)}</pre>`;
        if (r.ok) st.cache.set(key, html);
      } catch (x) { html = `<pre>turn input/output failed: ${String(x.message)}</pre>`; }
    }
    box.innerHTML = html;
  }
  window.turnIo = {
    get on() { return st.on; },
    decorate(el, d) {
      const tools = el.querySelector('.tools');
      const t = d?.turn;
      if (!tools || !t || !(t.inputFile || t.outputFile)) return;
      const b = document.createElement('button');
      b.className = `btn${st.on ? ' on' : ''}`; b.id = 'detTurnIo'; b.textContent = 'full input / raw output';
      b.setAttribute('aria-pressed', String(st.on));
      b.title = `Turn ${t.turn}: the exact request sent to the model (${t.inputBytes ?? '?'} bytes) and its raw response (${t.outputBytes ?? '?'} bytes)`;
      tools.insertBefore(b, tools.querySelector('.muted'));
      if (st.on) {
        const box = document.createElement('div');
        box.className = 'wide turnio'; box.textContent = 'loading…';
        el.insertBefore(box, tools.nextSibling);
        paint(box, (typeof S !== 'undefined' && S.run) || '', t.turn);
      }
      b.addEventListener('click', () => { st.on = !st.on; if (typeof window.renderDetail === 'function') window.renderDetail(d); });
    },
  };
  const base = window.renderDetail;
  if (typeof base === 'function') {
    window.renderDetail = function renderDetailWithTurnIo(d) { base(d); const el = document.getElementById('det'); if (el && d) window.turnIo.decorate(el, d); };
  }
})();
