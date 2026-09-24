'use client';

import nodemailer from 'nodemailer';
import 'server-only';

export function Mailer() {
  const load = () => import('acme-billing');
  return <button onClick={() => { void nodemailer; void load(); }}>Send</button>;
}
