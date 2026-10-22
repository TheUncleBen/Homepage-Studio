import { isAbsolute, resolve } from 'node:path';

// This function is serialized for `docker exec node -e`, so it deliberately
// uses only its arguments and built-in modules available in the runtime image.
function inspectRendererProcesses({ parentPid, rendererRoot }) {
  const fs = require('node:fs');
  const records = [];
  const vanished = error => ['ENOENT', 'ESRCH'].includes(error.code);
  for (const pid of fs.readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
    try {
      const base = '/proc/' + pid;
      const status = fs.readFileSync(base + '/status', 'utf8');
      const parent = Number(status.match(/^PPid:\s+(\d+)/m)?.[1]);
      if (parent !== parentPid) continue;
      const env = Object.fromEntries(fs.readFileSync(base + '/environ', 'utf8').split('\0').filter(Boolean).map(value => {
        const split = value.indexOf('=');
        return [value.slice(0, split), value.slice(split + 1)];
      }));
      // Next changes process.title and Linux cmdline. The controller supplies
      // these stable markers and cwd before launching each direct child.
      if (!env.STUDIO_DASHBOARD_ID || !env.STUDIO_RENDERER_INSTANCE) continue;
      if (fs.readlinkSync(base + '/cwd') !== rendererRoot) continue;
      const uid = Number(status.match(/^Uid:\s+(\d+)/m)?.[1]);
      const port = Number(env.PORT);
      if (!Number.isInteger(uid) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid renderer process metadata for PID ' + pid);
      const inodes = new Set();
      for (const fd of fs.readdirSync(base + '/fd')) {
        try {
          const inode = fs.readlinkSync(base + '/fd/' + fd).match(/^socket:\[(\d+)\]$/)?.[1];
          if (inode) inodes.add(inode);
        } catch (error) { if (!vanished(error)) throw error; }
      }
      const listeners = [];
      for (const family of ['tcp', 'tcp6']) {
        let table;
        try { table = fs.readFileSync(base + '/net/' + family, 'utf8'); }
        catch (error) { if (family === 'tcp6' && error.code === 'ENOENT') continue; throw error; }
        for (const line of table.trim().split('\n').slice(1)) {
          const fields = line.trim().split(/\s+/);
          if (fields[3] !== '0A' || !inodes.has(fields[9])) continue;
          const [address, hexPort] = fields[1].split(':');
          listeners.push({ family, address, port: parseInt(hexPort, 16) });
        }
      }
      records.push({ pid: Number(pid), parentPid: parent, id: env.STUDIO_DASHBOARD_ID, instance: env.STUDIO_RENDERER_INSTANCE,
        configDir: env.HOMEPAGE_CONFIG_DIR, hostname: env.HOSTNAME, mcpWrite: env.HOMEPAGE_MCP_ALLOW_WRITE,
        uid, port, listeners, addresses: listeners.map(listener => listener.address) });
    } catch (error) { if (!vanished(error)) throw error; }
  }
  return records.sort((left, right) => left.pid - right.pid);
}

export function rendererProcessProbe({ parentPid = 1, rendererRoot = '/app/homepage' } = {}) {
  if (!Number.isSafeInteger(parentPid) || parentPid < 1) throw new Error('Renderer probe requires a positive controller PID.');
  if (typeof rendererRoot !== 'string' || !isAbsolute(rendererRoot)) throw new Error('Renderer probe requires an absolute renderer directory.');
  return `console.log(JSON.stringify((${inspectRendererProcesses.toString()})(${JSON.stringify({ parentPid, rendererRoot: resolve(rendererRoot) })})));`;
}
