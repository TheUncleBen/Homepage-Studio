// Optional email through SMTP (owner decision D2, 23 Oct 2026): invitations,
// account recovery, security alerts and, when an administrator turns it on,
// a one-time sign-in code. Messages are plain text and never contain secrets
// other than the single-use link or code they exist to deliver.
import nodemailer from 'nodemailer';

export function createMailer(smtp) {
  if (!smtp) return null;
  const transport = smtp.transport ?? nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.secure,
    // Require TLS for STARTTLS ports as well; credentials never cross in clear text.
    requireTLS: !smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password ?? '' } : undefined,
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
  });
  return {
    async send({ to, subject, text }) {
      await transport.sendMail({ from: smtp.from, to, subject, text });
    },
  };
}

// What went wrong, in words an administrator can act on: the error code and
// the mail server's own answer (for example a refused, unverified sender).
// Never includes credentials; trimmed and kept to one line.
export function describeMailError(error) {
  const parts = [error?.code, error?.responseCode ? String(error.responseCode) : null].filter(Boolean).join(' ');
  const answer = String(error?.response ?? error?.message ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 200);
  return [parts, answer].filter(Boolean).join(': ') || 'unknown error';
}

const sign = 'Homepage Studio';
export const messages = {
  invite: ({ name, link, hours }) => ({
    subject: 'You have been invited to Homepage Studio',
    text: `Hello ${name},\n\nAn administrator created a Homepage Studio account for you. Open this link to choose your password and set up a second sign-in step:\n\n${link}\n\nThe link works once and expires in ${hours} hours. If you weren't expecting this, you can ignore it.\n\n${sign}\n`,
  }),
  recovery: ({ name, link, minutes }) => ({
    subject: 'Reset your Homepage Studio password',
    text: `Hello ${name},\n\nSomeone asked to reset the password for your Homepage Studio account. Open this link to choose a new one:\n\n${link}\n\nYou will still need your authenticator app, passkey or a backup code. The link works once and expires in ${minutes} minutes. If this wasn't you, ignore this email; your password has not changed.\n\n${sign}\n`,
  }),
  code: ({ name, code, minutes }) => ({
    subject: `Your Homepage Studio sign-in code: ${code}`,
    text: `Hello ${name},\n\nYour sign-in code is ${code}. It expires in ${minutes} minutes.\n\nIf you didn't just try to sign in, change your password.\n\n${sign}\n`,
  }),
  alert: ({ name, event }) => ({
    subject: 'Security change on your Homepage Studio account',
    text: `Hello ${name},\n\n${event}\n\nIf this wasn't you, contact your Homepage Studio administrator straight away.\n\n${sign}\n`,
  }),
};
