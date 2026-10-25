import http from 'node:http';

// A new deployment's main dashboard has no address until an administrator
// picks one. HTTP fixtures that run with sign-in off give it /home first,
// the way the first person to open Studio would.
export async function addressMainDashboard({ port, host, origin, slug = 'home' }) {
  const call = (method, body) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/studio/api/dashboards', method, agent: false, headers: { host, origin, 'content-type': 'application/json', 'x-studio-request': '1' } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) return reject(new Error(`Addressing the main dashboard failed: ${res.statusCode} ${text}`));
        resolve(JSON.parse(text));
      });
    });
    req.on('error', reject);
    req.end(body && JSON.stringify(body));
  });
  const { revision } = await call('GET');
  return call('POST', { revision, action: 'update', id: 'default', name: 'Main dashboard', slug });
}

// For fixtures that start with a broken main configuration: the registry is
// written before Studio starts, with the main dashboard at /home.
export async function seedMainAddress(configDir, slug = 'home') {
  const { writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { randomUUID } = await import('node:crypto');
  await writeFile(join(configDir, 'studio-dashboards.json'), JSON.stringify({ version: 1, revision: randomUUID(), dashboards: [{ id: 'default', slug, name: 'Main dashboard', archived: false }] }));
}
