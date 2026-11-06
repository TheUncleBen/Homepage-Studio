// Syslog intake: both formats parse, and unlisted senders are dropped before
// anything is read (security review L4, 6 Nov 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import net from 'node:net';
import { createSyslogServer, parseSyslog } from './syslog.mjs';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

test('RFC 5424 and RFC 3164 messages parse', () => {
  const modern = parseSyslog('<34>1 2026-11-06T10:00:00Z nas backup 12 - - Backup failed');
  assert.equal(modern.severity, 2);
  assert.equal(modern.facility, 4);
  assert.equal(modern.host, 'nas');
  assert.equal(modern.app, 'backup');
  assert.equal(modern.message, 'Backup failed');
  const legacy = parseSyslog('<13>Nov  6 10:00:00 router dnsmasq[42]: query refused');
  assert.equal(legacy.severity, 5);
  assert.equal(legacy.host, 'router');
  assert.equal(legacy.app, 'dnsmasq');
  assert.equal(legacy.message, 'query refused');
});

for (const allowed of [true, false]) {
  test(`a sender that is ${allowed ? '' : 'not '}listed ${allowed ? 'is read' : 'is dropped at once, over TCP and UDP'}`, async t => {
    const port = await freePort();
    const messages = [], refused = [];
    const server = createSyslogServer({ port, allow: address => allowed && address === '127.0.0.1', onRefused: address => refused.push(address), onMessage: (parsed, address) => messages.push({ ...parsed, address }) });
    t.after(() => server.close());
    await wait(100);

    // TCP: an unlisted sender's connection is closed before it can send.
    const socket = net.connect(port, '127.0.0.1');
    const closed = new Promise(resolve => socket.on('close', resolve));
    socket.on('error', () => {});
    await new Promise(resolve => socket.on('connect', resolve));
    socket.write('<11>1 - host app - - - over tcp\n');
    if (allowed) { await wait(100); socket.end(); }
    await closed;

    // UDP.
    const client = dgram.createSocket('udp4');
    await new Promise(resolve => client.send('<11>1 - host app - - - over udp', port, '127.0.0.1', resolve));
    client.close();
    await wait(150);

    if (allowed) {
      assert.deepEqual(messages.map(item => [item.message, item.address]).sort(), [['over tcp', '127.0.0.1'], ['over udp', '127.0.0.1']]);
      assert.deepEqual(refused, []);
    } else {
      assert.deepEqual(messages, []);
      assert.deepEqual(refused, ['127.0.0.1', '127.0.0.1']);
    }
  });
}
