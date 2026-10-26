// Optional email through SMTP (owner decision D2, 23 Oct 2026): invitations,
// account recovery, security alerts and, when an administrator turns it on,
// a one-time sign-in code. Each message is an HTML email in Studio's look
// with a plain-text copy, and never contains secrets other than the
// single-use link or code it exists to deliver.
import { readFileSync } from 'node:fs';
import nodemailer from 'nodemailer';
import { DEFAULT_PLATFORM } from '../platform.mjs';

// The Studio logo travels inside the email (an inline attachment), so it
// shows without the mail app loading anything from the deployment.
const LOGO = readFileSync(new URL('../brand/apple-touch-icon.png', import.meta.url));
const LOGO_CID = 'studio-logo@homepage-studio';

export function createMailer(smtp, siteName, accent = async () => DEFAULT_ACCENT) {
  if (!smtp) return null;
  const transport = smtp.transport ?? nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.secure,
    // Require TLS for STARTTLS ports as well; credentials never cross in clear text.
    requireTLS: !smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password ?? '' } : undefined,
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
  });
  return {
    async send({ to, subject, text, html }) {
      const colour = await accent().catch(() => DEFAULT_ACCENT);
      await transport.sendMail({
        from: { name: smtp.from.name ?? siteName(), address: smtp.from.address }, to, subject, text,
        html: html?.(colour),
        attachments: html ? [{ filename: 'logo.png', content: LOGO, contentType: 'image/png', cid: LOGO_CID, contentDisposition: 'inline' }] : undefined,
      });
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

const DEFAULT_ACCENT = DEFAULT_PLATFORM.accent;
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
// Text on the button: dark on a light accent, white on a dark one.
function onAccent(hex) {
  const [r, g, b] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.3 ? '#16151a' : '#ffffff';
}
// Title case for subjects: every word capitalised except short joining
// words; words that already have capitals (names) stay as written.
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'per', 'the', 'to', 'via']);
export const titleCase = text => text.split(' ').map((word, index) => (/[A-Z]/.test(word) || (index && SMALL_WORDS.has(word)) ? word : word.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('-'))).join(' ');
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// One layout for every message: the logo and deployment name, a title, the
// message, at most one button (with the link written out underneath for
// mail apps that block buttons) or a code, and a short footer. Tables and
// inline styles, because that is what mail apps reliably draw.
function layout({ site, preview, title, paragraphs = [], button, code, after = [], footer }) {
  return accent => {
    const p = text => `<p style="margin:0 0 16px;font:16px/1.55 ${FONT};color:#3a3940;">${text}</p>`;
    const action = button ? `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr><td style="border-radius:10px;background:${accent};">
<a href="${escape(button.href)}" style="display:inline-block;padding:13px 26px;border-radius:10px;font:600 16px/1.2 ${FONT};color:${onAccent(accent)};text-decoration:none;">${escape(button.label)}</a>
</td></tr></table>` : '';
    const codeBox = code ? `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr><td style="padding:14px 22px;border-radius:10px;background:#f2f1f5;border:1px solid #e3e1e8;font:600 30px/1 'SF Mono',Menlo,Consolas,monospace;letter-spacing:6px;color:#16151a;">${escape(code)}</td></tr></table>` : '';
    const fallback = button ? `<p style="margin:0 0 16px;font:13px/1.5 ${FONT};color:#77757f;">Button not working? Copy this link into your browser:<br><a href="${escape(button.href)}" style="color:#5b4f66;word-break:break-all;">${escape(button.href)}</a></p>` : '';
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escape(title)}</title><style>@media (max-width:480px){.card{padding:24px 20px !important;}}</style></head>
<body style="margin:0;padding:0;background:#f4f3f7;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escape(preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f3f7;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr><td style="padding:0 4px 18px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="vertical-align:middle;"><img src="cid:${LOGO_CID}" width="36" height="36" alt="" style="display:block;border:0;border-radius:9px;"></td>
<td style="vertical-align:middle;padding-left:10px;font:600 16px/1.2 ${FONT};color:#16151a;">${escape(site)}</td>
</tr></table></td></tr>
<tr><td class="card" style="background:#ffffff;border:1px solid #e6e4eb;border-radius:14px;padding:32px;">
<h1 style="margin:0 0 20px;font:700 22px/1.3 ${FONT};color:#16151a;">${escape(title)}</h1>
${paragraphs.map(p).join('\n')}${action}${codeBox}
${after.map(p).join('\n')}${fallback}
</td></tr>
<tr><td style="padding:18px 4px 0;font:12px/1.5 ${FONT};color:#8a8892;">${footer}</td></tr>
</table></td></tr></table>
</body></html>
`;
  };
}

// Messages name the deployment (STUDIO_DEPLOYMENT_NAME). Subjects are in
// title case; the deployment's name is used as written.
export const mailMessages = site => {
  const footer = `You received this email because you have an account on ${escape(site)}.`;
  return {
    invite: ({ name, link, hours }) => ({
      subject: `You’re Invited to ${site}`,
      text: `Hello ${name},\n\nAn administrator created a ${site} account for you. Open this link to choose your password and set up a second sign-in step:\n\n${link}\n\nThe link works once and expires in ${hours} hours. If you weren't expecting this, you can ignore it.\n\n${site}\n`,
      html: layout({
        site, footer: `An administrator of ${escape(site)} invited you. If you weren’t expecting this, you can ignore it.`,
        preview: `Choose your password to start using ${site}.`,
        title: `You’re invited to ${site}`,
        paragraphs: [`Hello ${escape(name)},`, `An administrator created a ${escape(site)} account for you. Choose your password and set up a second sign-in step to get started.`],
        button: { href: link, label: 'Set up my account' },
        after: [`The link works once and expires in ${hours} hours.`],
      }),
    }),
    recovery: ({ name, link, minutes }) => ({
      subject: `Reset Your ${site} Password`,
      text: `Hello ${name},\n\nSomeone asked to reset the password for your ${site} account. Open this link to choose a new one:\n\n${link}\n\nYou will still need your authenticator app, passkey or a backup code. The link works once and expires in ${minutes} minutes. If this wasn't you, ignore this email; your password has not changed.\n\n${site}\n`,
      html: layout({
        site, footer,
        preview: `Choose a new password. The link expires in ${minutes} minutes.`,
        title: 'Reset your password',
        paragraphs: [`Hello ${escape(name)},`, `Someone asked to reset the password for your ${escape(site)} account. If it was you, choose a new one.`],
        button: { href: link, label: 'Choose a new password' },
        after: [`You’ll still need your authenticator app, passkey or a backup code. The link works once and expires in ${minutes} minutes.`, `<strong>Didn’t ask for this?</strong> Ignore this email. Your password hasn’t changed.`],
      }),
    }),
    code: ({ name, code, minutes }) => ({
      subject: `Your ${site} Sign-In Code: ${code}`,
      text: `Hello ${name},\n\nYour sign-in code is ${code}. It expires in ${minutes} minutes.\n\nIf you didn't just try to sign in, change your password.\n\n${site}\n`,
      html: layout({
        site, footer,
        preview: `It expires in ${minutes} minutes.`,
        title: 'Your sign-in code',
        paragraphs: [`Hello ${escape(name)},`, `Enter this code to finish signing in to ${escape(site)}:`],
        code,
        after: [`It expires in ${minutes} minutes. <strong>Didn’t just try to sign in?</strong> Change your password.`],
      }),
    }),
    alert: ({ name, title, event, link }) => ({
      subject: `Security Alert: ${titleCase(title)}`,
      text: `Hello ${name},\n\n${event}\n\n${link ? `Review your account: ${link}\n\n` : ''}If this wasn't you, contact your ${site} administrator straight away.\n\n${site}\n`,
      html: layout({
        site, footer,
        preview: event,
        title,
        paragraphs: [`Hello ${escape(name)},`, escape(event)],
        button: link ? { href: link, label: 'Review my account' } : undefined,
        after: [`<strong>Wasn’t you?</strong> Contact your ${escape(site)} administrator straight away.`],
      }),
    }),
  };
};
