'use client';

// NEXT_PUBLIC_ variables are inlined at build time and are fine in the browser.
const api = process.env.NEXT_PUBLIC_API_URL;
const key = process.env.STRIPE_SECRET;

export function Secrets() {
  return <p>{api}{key}</p>;
}
