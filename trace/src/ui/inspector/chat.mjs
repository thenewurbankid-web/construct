// The Part inspector's chat panel: a streaming conversation about ONE part, with pause, stop and a queue like the email
// composer's. Refactor debt: this is a small copy of the composer's approach (src/ui/index.html, mailRun), because that code
// lives inline in the studio page and lifting it out would touch that file heavily; when the studio's script is split into
// modules, both should share one panel.
//   createChat({ root, url, context, onPropose, labels })  ->  { reset(), stop(), ask(text) }
// context() gives the request's fixed part ({ example, id }); onPropose(n) selects option n in the form (never applies it).
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const QUICK = ["Why is this open?", "Which option would you pick?", "What does the code do?"];

export function createChat({ root, url = "/api/part-chat", context, onPropose, options = () => [] }) {
  const st = { msgs: [], queue: [], busy: false, paused: false, hold: false, ctl: null, resume: null, seq: 0 };
  root.classList.add("pc");
  root.innerHTML = `<div class="pc-head"><b>Ask about this part</b><small>It only knows the facts on this screen for it.</small></div>
    <div class="pc-list" id="pcList" role="log" aria-live="polite" aria-label="Chat about this part"></div>
    <div class="pc-queue" id="pcQueue"></div>
    <div class="pc-quick" id="pcQuick"></div>
    <form class="pc-form" id="pcForm"><textarea id="pcInput" rows="2" placeholder="Ask a question about this part" aria-label="Your question"></textarea><div class="pc-btns" id="pcBtns"></div></form>`;
  const $ = (s) => root.querySelector(s);

  const paintList = (stick) => {
    const list = $("#pcList");
    const near = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    list.innerHTML = st.msgs.length ? st.msgs.map(msgHtml).join("") : `<p class="pc-empty">Ask why it is open, what the options do, or what the generated code does. Answers are checked against this part's facts, and nothing is applied until you press Apply.</p>`;
    if (stick || near) list.scrollTop = list.scrollHeight;
  };
  const msgHtml = (m) => {
    if (m.role === "user") return `<div class="pc-m u"><span>${esc(m.text)}</span></div>`;
    const live = ["waiting", "thinking", "writing", "paused"].includes(m.state);
    const label = { waiting: "Thinking…", thinking: "Thinking…", writing: "Writing…", paused: "Paused", stopped: "Stopped", error: "" }[m.state] ?? "";
    const think = m.think ? `<details class="pc-think"><summary>Thoughts</summary><pre>${esc(m.think)}</pre></details>` : "";
    const opt = m.proposed ? options()[m.proposed - 1] : null;
    const check = m.done && !m.refused && m.done.check ? (m.done.check.ok ? `<p class="pc-chk ok">Everything in this reply is in this part's facts.</p>` : `<p class="pc-chk warn">Not in this part's facts: <b>${esc(m.done.check.flagged.slice(0, 8).join(", "))}</b>. Treat it with care.</p>`) : "";
    return `<div class="pc-m a${m.refused ? " refused" : ""}">${label ? `<div class="pc-who">${live && m.state !== "paused" ? `<span class="pc-dots"><i></i><i></i><i></i></span>` : ""}${label}</div>` : ""}${think}${m.text || m.done?.text ? `<p>${esc(m.done?.text ?? m.text)}</p>` : ""}${m.error ? `<p class="pc-err">${esc(m.error)}</p>` : ""}${check}${opt ? `<div class="pc-prop"><span>Proposed: <b>${esc(opt.label)}</b></span><button type="button" class="btn sm" data-pc-select="${m.proposed}">Select it</button><small>Selecting shows a preview. Nothing is applied until you press Apply.</small></div>` : ""}</div>`;
  };
  const paintControls = () => {
    $("#pcQuick").innerHTML = st.msgs.length ? "" : QUICK.map((q, i) => `<button type="button" class="pc-chip" data-pc-quick="${i}">${esc(q)}</button>`).join("");
    $("#pcBtns").innerHTML = st.busy
      ? `<button type="button" class="btn sm" data-pc-pause>${st.paused ? "Resume" : "Pause"}</button><button type="button" class="btn sm" data-pc-stop>Stop</button><button type="button" class="btn sm primary" data-pc-send title="Add to the queue. It runs after this one.">Queue</button>`
      : `<button type="button" class="btn sm primary" data-pc-send>Ask</button>`;
    $("#pcQueue").innerHTML = st.queue.length ? `<div class="pc-qh">${st.hold ? "Queue on hold" : "Up next"} · ${st.queue.length}${st.hold ? `<button type="button" class="btn sm ghost" data-pc-run>Run queue</button>` : ""}<button type="button" class="btn sm ghost" data-pc-clear>Clear</button></div>${st.queue.map((t, i) => `<div class="pc-qi"><b>${i + 1}</b><span>${esc(t)}</span><button type="button" class="btn sm ghost icon-only" data-pc-rm="${i}" aria-label="Remove from the queue">×</button></div>`).join("")}` : "";
  };

  async function run(text) {
    const a = { id: ++st.seq, role: "assistant", text: "", think: "", state: "waiting", done: null, proposed: null, refused: false };
    const history = st.msgs.filter((m) => m.role === "user" || (m.role === "assistant" && m.state === "done" && !m.refused)).map((m) => ({ role: m.role, content: m.role === "user" ? m.text : (m.done?.text ?? m.text) }));
    st.msgs.push({ id: ++st.seq, role: "user", text }, a);
    st.busy = true; st.paused = false; st.hold = false; st.ctl = new AbortController();
    paintList(true); paintControls();
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, signal: st.ctl.signal, body: JSON.stringify({ ...context(), question: text, history }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `The server answered ${res.status}`);
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = "";
      for (;;) {
        while (st.paused && !st.ctl.signal.aborted) { a.state = "paused"; paintList(); await new Promise((r) => (st.resume = r)); if (a.state === "paused") a.state = a.text ? "writing" : "waiting"; }
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 2);
          if (!line.startsWith("data:")) continue;
          const ev = JSON.parse(line.slice(5));
          if (ev.type === "thinking") { a.think += ev.delta; a.state = "thinking"; }
          else if (ev.type === "text") { a.text += ev.delta; a.state = "writing"; }
          else if (ev.type === "error") { a.state = "error"; a.error = ev.message; }
          else if (ev.type === "done") { a.state = "done"; a.done = ev; a.refused = !!ev.refused; a.proposed = ev.proposed; }
        }
        paintList();
      }
      if (!["done", "error"].includes(a.state)) { a.state = "error"; a.error = "The connection closed before the reply was finished."; }
    } catch (err) {
      if (st.ctl.signal.aborted) a.state = "stopped";
      else { a.state = "error"; a.error = /Failed to fetch|NetworkError/.test(err.message) ? "The server is not reachable." : err.message; }
    }
    st.busy = false; st.paused = false; st.ctl = null;
    paintList(); paintControls();
    if (st.queue.length && !st.hold) run(st.queue.shift());
  }
  const send = (text) => { text = String(text ?? "").trim(); if (!text) return; if (st.busy) st.queue.push(text); else run(text); paintControls(); };
  const stop = () => { if (!st.busy) return; st.hold = st.queue.length > 0; st.ctl.abort(); st.resume?.(); paintControls(); };

  root.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.matches("[data-pc-send]")) { const inp = $("#pcInput"); const v = inp.value; inp.value = ""; return send(v); }
    if (t.matches("[data-pc-quick]")) return send(QUICK[Number(t.dataset.pcQuick)]);
    if (t.matches("[data-pc-pause]")) { st.paused = !st.paused; if (!st.paused) st.resume?.(); return paintControls(); }
    if (t.matches("[data-pc-stop]")) return stop();
    if (t.matches("[data-pc-rm]")) { st.queue.splice(Number(t.dataset.pcRm), 1); return paintControls(); }
    if (t.matches("[data-pc-clear]")) { st.queue = []; st.hold = false; return paintControls(); }
    if (t.matches("[data-pc-run]")) { st.hold = false; if (!st.busy && st.queue.length) run(st.queue.shift()); return paintControls(); }
    if (t.matches("[data-pc-select]")) return onPropose?.(Number(t.dataset.pcSelect));
  });
  $("#pcInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); const v = e.target.value; e.target.value = ""; send(v); }
    if (e.key !== "Escape" && e.key !== "Tab") e.stopPropagation(); // typing here must not trigger the inspector's number-key and arrow shortcuts
  });
  paintList(); paintControls();
  return { reset() { stop(); st.msgs = []; st.queue = []; paintList(); paintControls(); }, stop, ask: send, repaint: paintList };
}
