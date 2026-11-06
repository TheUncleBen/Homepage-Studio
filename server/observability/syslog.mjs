// Syslog intake (owner decision D4, 6 Nov 2026): RFC 5424 and RFC 3164 over
// UDP and TCP, off until an administrator turns it on. Only senders an
// administrator registered (by address) are accepted.
import dgram from 'node:dgram';
import net from 'node:net';

const MAX_MESSAGE = 8192;
const MAX_CONNECTIONS = 50;
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

export function parseSyslog(raw, now = Date.now()) {
  const text = String(raw).replace(/\r?\n$/, '').slice(0, MAX_MESSAGE);
  const pri = /^<(\d{1,3})>/.exec(text);
  if (!pri || Number(pri[1]) > 191) return { severity: 6, facility: null, ts: now, host: null, app: null, message: text };
  const value = Number(pri[1]);
  const severity = value % 8, facility = Math.floor(value / 8);
  let rest = text.slice(pri[0].length);
  // RFC 5424: <PRI>1 TIMESTAMP HOST APP PROCID MSGID [SD] MSG
  const modern = /^1 (\S+) (\S+) (\S+) (\S+) (\S+) (-|(?:\[(?:[^\]\\]|\\.)*\])+) ?([\s\S]*)$/.exec(rest);
  if (modern) {
    const ts = modern[1] === '-' ? now : Date.parse(modern[1]);
    return { severity, facility, ts: Number.isFinite(ts) ? ts : now, host: modern[2] === '-' ? null : modern[2], app: modern[3] === '-' ? null : modern[3], message: modern[7].replace(/^﻿/, '') };
  }
  // RFC 3164: <PRI>Mmm dd hh:mm:ss HOST TAG: MSG
  const legacy = /^([A-Z][a-z]{2}) +(\d{1,2}) (\d\d):(\d\d):(\d\d) (\S+) ([\s\S]*)$/.exec(rest);
  if (legacy && legacy[1] in MONTHS) {
    const d = new Date(now);
    let ts = new Date(d.getFullYear(), MONTHS[legacy[1]], Number(legacy[2]), Number(legacy[3]), Number(legacy[4]), Number(legacy[5])).getTime();
    if (ts - now > 86400e3) ts = new Date(d.getFullYear() - 1, MONTHS[legacy[1]], Number(legacy[2]), Number(legacy[3]), Number(legacy[4]), Number(legacy[5])).getTime();
    const tag = /^([^:\[\s]{1,48})(?:\[\d+\])?: ?([\s\S]*)$/.exec(legacy[7]);
    return { severity, facility, ts, host: legacy[6], app: tag ? tag[1] : null, message: tag ? tag[2] : legacy[7] };
  }
  return { severity, facility, ts: now, host: null, app: null, message: rest };
}

// The listener. onMessage(parsed, senderAddress) is called for each message.
// allow(address) is asked before anything is read: datagrams and TCP
// connections from other addresses are dropped at once, and onRefused counts
// them, so an unlisted host can't hold the connection slots.
export function createSyslogServer({ port, udp = true, tcp = true, host = '0.0.0.0', allow = () => true, onRefused = () => {}, onMessage, onError = () => {} }) {
  const sockets = [];
  const clean = address => String(address).replace(/^::ffff:/, '');
  if (udp) {
    let socket = null;
    const onDatagram = (buffer, info) => {
      const address = clean(info.address);
      if (!allow(address)) return onRefused(address);
      if (buffer.length <= MAX_MESSAGE * 2) onMessage(parseSyslog(buffer.toString('utf8')), address);
    };
    // Both address families on one socket where the host has IPv6; IPv4 only
    // where it doesn't (many containers).
    const bind = (type, address) => {
      socket = dgram.createSocket(type === 'udp6' ? { type, ipv6Only: false } : type);
      socket.on('message', onDatagram);
      socket.once('error', error => {
        if (type === 'udp6' && error.code === 'EAFNOSUPPORT') { socket.close(); return bind('udp4', '0.0.0.0'); }
        onError(error);
      });
      socket.once('listening', () => { socket.removeAllListeners('error'); socket.on('error', onError); });
      socket.bind(port, address);
    };
    if (host === '0.0.0.0') bind('udp6', '::'); else bind(net.isIPv6(host) ? 'udp6' : 'udp4', host);
    sockets.push({ close: () => new Promise(resolve => { try { socket.close(() => resolve()); } catch { resolve(); } }) });
  }
  if (tcp) {
    const open = new Set();
    const server = net.createServer({ allowHalfOpen: false }, connection => {
      const address = clean(connection.remoteAddress);
      if (!allow(address)) { onRefused(address); return connection.destroy(); }
      if (open.size >= MAX_CONNECTIONS) return connection.destroy();
      open.add(connection);
      connection.on('close', () => open.delete(connection));
      connection.setTimeout(300000, () => connection.destroy());
      let buffer = Buffer.alloc(0);
      connection.on('data', chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        for (;;) {
          // Octet counting ("123 <34>1 …") or newline framing.
          const counted = /^(\d{1,5}) /.exec(buffer.subarray(0, 8).toString('latin1'));
          if (counted) {
            const length = Number(counted[1]);
            if (length > MAX_MESSAGE * 2) return connection.destroy();
            const start = counted[0].length;
            if (buffer.length < start + length) break;
            onMessage(parseSyslog(buffer.subarray(start, start + length).toString('utf8')), address);
            buffer = buffer.subarray(start + length);
            continue;
          }
          const index = buffer.indexOf(10);
          if (index < 0) { if (buffer.length > MAX_MESSAGE * 2) return connection.destroy(); break; }
          const line = buffer.subarray(0, index).toString('utf8');
          buffer = buffer.subarray(index + 1);
          if (line.trim()) onMessage(parseSyslog(line), address);
        }
      });
      connection.on('error', () => {});
    });
    server.on('error', onError);
    server.listen(port, host === '0.0.0.0' ? undefined : host);
    sockets.push({ close: () => new Promise(resolve => { server.close(() => resolve()); for (const s of open) s.destroy(); }) });
  }
  return { close: () => Promise.all(sockets.map(socket => socket.close())) };
}
