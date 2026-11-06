// Notification channels (plan 5.10): email through Studio's SMTP settings and
// web requests for a generic signed webhook and the common push services.
// No new dependency; Apprise is reached as a server, not embedded.
import http from 'node:http';
import https from 'node:https';
import { createHmac, randomUUID } from 'node:crypto';
import { createMailer, mailMessages } from '../auth/mail.mjs';

const TIMEOUT_MS = 10000;
const RETRIES = [5000, 30000, 120000];

// One JSON or text request; no redirects followed (plan 5.10).
export function send(url, { method = 'POST', headers = {}, body = '', ca, timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'https:' ? https : target.protocol === 'http:' ? http : null;
    if (!transport) return reject(Object.assign(new Error('Only http and https addresses'), { code: 'BAD_ADDRESS' }));
    const payload = Buffer.from(body);
    const req = transport.request(target, { method, timeout: timeoutMs, agent: false, headers: { 'user-agent': 'HomepageStudio-Notify', 'content-length': payload.length, ...headers }, ...(ca && target.protocol === 'https:' ? { ca } : {}) }, res => {
      let size = 0;
      const chunks = [];
      res.on('data', chunk => { if (size < 4096) { chunks.push(chunk); size += chunk.length; } });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(res.statusCode);
        const reason = Buffer.concat(chunks).toString('utf8').replace(/\s+/g, ' ').slice(0, 160);
        reject(Object.assign(new Error(`HTTP ${res.statusCode}${reason ? ` · ${reason}` : ''}`), { code: 'HTTP_' + res.statusCode }));
      });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('No answer in time'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end(payload);
  });
}

const json = value => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
const join = (base, path) => base.replace(/\/+$/, '') + path;

// The request each channel type sends for one message.
export function requestFor(channel, message) {
  const text = `${message.title}\n${message.text}`;
  switch (channel.type) {
    case 'webhook': {
      const body = JSON.stringify({ title: message.title, message: message.text, ...message.data });
      const stamp = String(Math.floor(Date.now() / 1000));
      const headers = { 'content-type': 'application/json' };
      if (channel.secret) { headers['x-studio-timestamp'] = stamp; headers['x-studio-signature'] = 'sha256=' + createHmac('sha256', channel.secret).update(`${stamp}.${body}`).digest('hex'); }
      return { url: channel.url, headers, body };
    }
    case 'ntfy': return { url: channel.url, headers: { 'content-type': 'text/plain; charset=utf-8', title: encodeURIComponent(message.title).slice(0, 250), 'x-title': message.title.replace(/[^\x20-\x7e]/g, ' ').slice(0, 250), priority: String(message.urgent ? 5 : channel.topicPriority ?? 4), tags: message.urgent ? 'rotating_light' : 'white_check_mark', ...(channel.token ? { authorization: `Bearer ${channel.token}` } : {}) }, body: message.text };
    case 'gotify': return { url: join(channel.url, '/message'), ...json({ title: message.title, message: message.text, priority: message.urgent ? 8 : 5 }), headers: { 'content-type': 'application/json', 'x-gotify-key': channel.token } };
    case 'discord': return { url: channel.url, ...json({ username: 'Homepage Studio', content: text.slice(0, 1900) }) };
    case 'slack': return { url: channel.url, ...json({ text }) };
    case 'teams': return { url: channel.url, ...json({ type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: { $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4', body: [{ type: 'TextBlock', text: message.title, weight: 'Bolder', size: 'Medium', wrap: true }, { type: 'TextBlock', text: message.text, wrap: true }] } }] }) };
    case 'telegram': return { url: `https://api.telegram.org/bot${channel.token}/sendMessage`, ...json({ chat_id: channel.chat, text: text.slice(0, 4000), disable_web_page_preview: true }) };
    case 'pushover': return { url: 'https://api.pushover.net/1/messages.json', ...json({ token: channel.token, user: channel.user, title: message.title.slice(0, 250), message: message.text.slice(0, 1024), priority: message.urgent ? 1 : 0 }) };
    case 'matrix': return { method: 'PUT', url: join(channel.url, `/_matrix/client/v3/rooms/${encodeURIComponent(channel.room)}/send/m.room.message/${randomUUID()}`), ...json({ msgtype: 'm.text', body: text }), headers: { 'content-type': 'application/json', authorization: `Bearer ${channel.token}` } };
    case 'homeassistant': return { url: channel.url, ...json({ title: message.title, message: message.text, ...message.data }) };
    case 'apprise': return { url: channel.url, ...json({ title: message.title, body: message.text, type: message.urgent ? 'failure' : 'success' }) };
    default: throw Object.assign(new Error('Unknown channel type'), { code: 'BAD_CHANNEL' });
  }
}

// Delivery with retries, recorded in the database and the log.
export function createNotifier({ db, smtp = null, siteName = () => 'Homepage Studio', publicOrigin = null, ca = () => undefined, onEvent = () => {}, now = () => Date.now(), sendRequest = send, mailer: injectedMailer }) {
  const mailer = injectedMailer ?? (smtp ? createMailer(smtp, siteName) : null);
  const streaks = new Map();
  const link = path => (publicOrigin ? new URL(path, publicOrigin).href : null);

  async function deliverOnce(channel, message) {
    if (channel.type === 'email') {
      if (!mailer) throw Object.assign(new Error('Email isn\'t set up (STUDIO_SMTP_HOST)'), { code: 'SMTP_NOT_CONFIGURED' });
      const mail = mailMessages(siteName()).monitor({ title: message.title, lines: message.text.split('\n'), link: message.path ? link(message.path) : null });
      await mailer.send({ to: channel.to, ...mail });
      return;
    }
    const request = requestFor(channel, message);
    await sendRequest(request.url, { method: request.method ?? 'POST', headers: request.headers, body: request.body, ca: ca() });
  }

  function record(id, channel, message, status, attempts, error) {
    try { db.run('INSERT OR REPLACE INTO delivery (id, channel_id, ts, subject, status, attempts, error) VALUES (?, ?, ?, ?, ?, ?, ?)', id, channel.id, now(), message.title.slice(0, 200), status, attempts, error ?? null); } catch {}
  }

  // Sends now and retries in the background. Resolves after the first try.
  async function deliver(channel, message, { retry = true } = {}) {
    const id = randomUUID();
    let attempt = 0;
    const tryOnce = async () => {
      attempt++;
      try {
        await deliverOnce(channel, message);
        record(id, channel, message, 'sent', attempt);
        streaks.set(channel.id, 0);
        onEvent({ source_type: 'monitor', source_id: 'notifications', category: 'monitoring', severity: 6, event_type: 'notify.sent', resource: channel.name, scope: message.scope ?? 'studio', message: `Sent “${message.title}” to ${channel.name}`, fields: { channel: channel.id, attempt } });
        return { ok: true };
      } catch (error) {
        const reason = String(error.message ?? error.code ?? 'failed').slice(0, 300);
        const final = !retry || attempt > RETRIES.length;
        record(id, channel, message, final ? 'failed' : 'retrying', attempt, reason);
        onEvent({ source_type: 'monitor', source_id: 'notifications', category: 'monitoring', severity: final ? 3 : 4, event_type: final ? 'notify.failed' : 'notify.retrying', resource: channel.name, scope: 'studio', message: `Couldn't send “${message.title}” to ${channel.name}: ${reason}`, fields: { channel: channel.id, attempt } });
        if (final) {
          const streak = (streaks.get(channel.id) ?? 0) + 1;
          streaks.set(channel.id, streak);
        } else {
          const timer = setTimeout(tryOnce, RETRIES[attempt - 1]);
          timer.unref?.();
        }
        return { ok: false, error: reason };
      }
    };
    return tryOnce();
  }

  return {
    deliver,
    test: (channel) => deliver(channel, { title: 'Test from Homepage Studio', text: 'If you can read this, this channel works.', data: { test: true } }, { retry: false }),
    failing: () => [...streaks.entries()].filter(([, streak]) => streak >= 3).map(([id]) => id),
    get emailReady() { return Boolean(mailer); },
  };
}
