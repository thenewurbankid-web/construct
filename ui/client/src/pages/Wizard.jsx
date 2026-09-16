import { useEffect, useRef, useState } from 'react';
import { wizardSocketUrl } from '../api.js';
import { AttributionBadge } from '../components/AttributionBadge.jsx';

const ATTRIBUTION_RE = /^\[tool: (.*)\] \[llm: (.*)\]$/;

let nextId = 1;

/** The import route wizard as a chat: connects to the backend's
 * /ws/wizard endpoint (see ui/server/src/wizardSocket.mjs), which drives
 * the unmodified `importRouteWizard` from src/cli.mjs through the new
 * `runImportRouteWizardEventDriven` adapter. Every progress line the
 * wizard prints arrives as its own message the instant it happens (not
 * batched at the end), and each of its prompts arrives as a distinct
 * "question" the user answers by typing — this is what makes it a running
 * conversation rather than a single blocking request. */
export function Wizard() {
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState('connecting'); // connecting | idle | running | done
  const [awaitingAnswer, setAwaitingAnswer] = useState(false);
  const [input, setInput] = useState('');
  const [seedRoute, setSeedRoute] = useState('');
  const wsRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    const ws = new WebSocket(wizardSocketUrl());
    wsRef.current = ws;

    ws.onopen = () => setStatus('idle');
    ws.onclose = () => setStatus((s) => (s === 'done' ? s : 'closed'));
    ws.onerror = () => pushMessage({ role: 'error', text: 'WebSocket error — is the backend running?' });
    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === 'question') {
        pushMessage({ role: 'question', text: msg.text });
        setAwaitingAnswer(true);
        setStatus('running');
      } else if (msg.type === 'log') {
        pushMessage({ role: msg.kind === 'error' ? 'error' : 'log', text: msg.text });
      } else if (msg.type === 'done') {
        pushMessage({ role: 'system', text: 'Session finished.' });
        setAwaitingAnswer(false);
        setStatus('done');
      }
    };

    return () => ws.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function pushMessage(m) {
    setMessages((prev) => [...prev, { id: nextId++, ...m }]);
  }

  function start() {
    setMessages([]);
    setStatus('running');
    wsRef.current?.send(JSON.stringify({ type: 'start', seedRoute: seedRoute || undefined }));
  }

  function sendAnswer(e) {
    e.preventDefault();
    if (!awaitingAnswer) return;
    pushMessage({ role: 'answer', text: input });
    wsRef.current?.send(JSON.stringify({ type: 'answer', text: input }));
    setInput('');
    setAwaitingAnswer(false);
  }

  return (
    <div className="page">
      <h1>Import Route Wizard</h1>
      <p className="hint">
        Guides a whole-feature import: traces a route&apos;s real import graph, proposes a plan with
        one combined LLM call, and only writes anything once you approve it. Only one session may
        run at a time on this backend.
      </p>

      {(status === 'idle' || status === 'done') && (
        <div className="wizard-start">
          <label className="field">
            <span>Seed route (optional — a URL like /v2/home, or a route folder path)</span>
            <input value={seedRoute} onChange={(e) => setSeedRoute(e.target.value)} placeholder="/v2/home" />
          </label>
          <button onClick={start}>Start wizard session</button>
        </div>
      )}

      <div className="chat">
        {messages.map((m) => (
          <ChatMessage key={m.id} message={m} />
        ))}
        <div ref={bottomRef} />
      </div>

      {awaitingAnswer && (
        <form className="chat-input" onSubmit={sendAnswer}>
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your answer…"
          />
          <button type="submit">Send</button>
        </form>
      )}

      {status === 'closed' && <p className="status-error">Disconnected from the backend.</p>}
    </div>
  );
}

function ChatMessage({ message }) {
  if (message.role === 'log') {
    const m = message.text.match(ATTRIBUTION_RE);
    if (m) {
      return (
        <div className="chat-message chat-log">
          <AttributionBadge attribution={{ tool: m[1], llm: m[2] }} />
        </div>
      );
    }
    if (!message.text.trim()) return null;
    return <div className="chat-message chat-log">{message.text}</div>;
  }
  if (message.role === 'question') {
    return <div className="chat-message chat-question">{message.text}</div>;
  }
  if (message.role === 'answer') {
    return <div className="chat-message chat-answer">{message.text}</div>;
  }
  if (message.role === 'error') {
    return <div className="chat-message chat-error">{message.text}</div>;
  }
  return <div className="chat-message chat-system">{message.text}</div>;
}
