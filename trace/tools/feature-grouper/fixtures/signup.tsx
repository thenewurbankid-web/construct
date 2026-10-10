import React, { useState } from "react";

export default function SignupPage({ onSubmit }: { onSubmit: (v: Record<string, string>) => void }) {
  const [agreed, setAgreed] = useState(false);
  return (
    <div className="page">
      <header className="masthead">
        <h1>Create your account</h1>
        <p>It takes a minute</p>
        <a href="/login">Already registered?</a>
      </header>

      <form className="signup" onSubmit={(e) => { e.preventDefault(); onSubmit({}); }}>
        <fieldset>
          <legend>About you</legend>
          <label>
            First name
            <input name="first" required />
          </label>
          <label>
            Last name
            <input name="last" required />
          </label>
        </fieldset>
        <fieldset>
          <legend>Sign in details</legend>
          <label>
            Email
            <input name="email" type="email" required />
          </label>
          <label>
            Password
            <input name="password" type="password" required />
          </label>
        </fieldset>
        <label className="terms">
          <input type="checkbox" checked={agreed} onChange={() => setAgreed(!agreed)} />
          I agree to the terms
        </label>
        <button type="submit" disabled={!agreed}>Sign up</button>
      </form>

      <footer className="footer">
        <div className="col">
          <h4>Product</h4>
          <ul>
            <li><a href="/features">Features</a></li>
            <li><a href="/pricing">Pricing</a></li>
          </ul>
        </div>
        <div className="col">
          <h4>Company</h4>
          <ul>
            <li><a href="/about">About</a></li>
            <li><a href="/jobs">Jobs</a></li>
          </ul>
        </div>
        <div className="col">
          <h4>Help</h4>
          <ul>
            <li><a href="/docs">Docs</a></li>
            <li><a href="/contact">Contact</a></li>
          </ul>
        </div>
      </footer>
    </div>
  );
}
