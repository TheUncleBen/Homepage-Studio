// Notification requests (observability plan 5.10): the signed webhook as
// documented, real delivery to a local receiver, and failures with a reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { requestFor, send } from './notify.mjs';

const message = { title: 'Plex is down', text: 'Connection refused', urgent: true, data: { monitor: 'm1' } };

test('a webhook with a secret is signed as sha256 HMAC of "timestamp.body"', () => {
  const request = requestFor({ type: 'webhook', url: 'https://hooks.example.test/x', secret: 's3cret' }, message);
  const stamp = request.headers['x-studio-timestamp'];
  assert.match(stamp, /^\d+$/);
  assert.equal(request.headers['x-studio-signature'], 'sha256=' + createHmac('sha256', 's3cret').update(`${stamp}.${request.body}`).digest('hex'));
  assert.deepEqual(JSON.parse(request.body), { title: 'Plex is down', message: 'Connection refused', monitor: 'm1' });
  const unsigned = requestFor({ type: 'webhook', url: 'https://hooks.example.test/x' }, message);
  assert.equal(unsigned.headers['x-studio-signature'], undefined);
});

test('send delivers the body and reports a refusal with its status', async t => {
  const received = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      received.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
      if (req.url === '/refuse') { res.writeHead(403); return res.end('nope'); }
      if (req.url === '/redirect') { res.writeHead(302, { location: '/ok' }); return res.end(); }
      res.writeHead(204); res.end();
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = requestFor({ type: 'webhook', url: base + '/ok' }, message);
  assert.equal(await send(request.url, request), 204);
  assert.equal(received[0].headers['content-type'], 'application/json');
  assert.equal(JSON.parse(received[0].body).title, 'Plex is down');
  await assert.rejects(send(base + '/refuse', { body: 'x' }), /HTTP 403 · nope/);
  // Redirects are not followed.
  await assert.rejects(send(base + '/redirect', { body: 'x' }), /HTTP 302/);
  assert.equal(received.filter(item => item.path === '/ok').length, 1);
  await assert.rejects(send('file:///etc/passwd'), { code: 'BAD_ADDRESS' });
});
