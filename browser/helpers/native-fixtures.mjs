import { seedNative, playback } from './engineering.mjs';

// Synthetic payloads use the pinned native Calendar iCal and Glances response
// formats. The actual native React components consume them through their usual
// useWidgetAPI fetch. This qualifies rendering/state, not provider connectivity.
export async function installDenseResponses(page) {
  const calls = [];
  let cpuSamples = 0;
  const calendar = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Homepage Studio test//EN',
    ...Array.from({ length: 8 }, (_, index) => [
      'BEGIN:VEVENT', `UID:fixture-${index}@example.test`,
      'DTSTAMP:20261020T000000Z', 'DTSTART;VALUE=DATE:20261020',
      'DTEND;VALUE=DATE:20261021', `SUMMARY:Calendar fixture event ${index + 1}`,
      'END:VEVENT',
    ]).flat(),
    'END:VCALENDAR', '',
  ].join('\r\n');
  await page.route('**/api/services/proxy?**', async route => {
    const url = new URL(route.request().url());
    const service = url.searchParams.get('service');
    const endpoint = url.searchParams.get('endpoint');
    let body;
    if (service === 'Calendar fixture' && endpoint === 'Fixture calendar') body = { data: calendar };
    else if (service === 'Metrics fixture' && endpoint === '4/cpu') body = { total: 30 + (++cpuSamples % 6) * 7 };
    else if (service === 'Metrics fixture' && endpoint === '4/quicklook') body = { cpu_name: 'Synthetic native CPU' };
    else if (service === 'Metrics fixture' && endpoint === '4/processlist') body = Array.from({ length: 5 }, (_, index) => ({ pid: index + 1, name: `native-process-${index + 1}`, status: 'R', cpu_percent: 10 + index, memory_info: { rss: (index + 1) * 1024 * 1024 } }));
    else return route.fallback();
    calls.push({ service, endpoint, index: url.searchParams.get('index') });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return { calls, get cpuSamples() { return cpuSamples; } };
}

export async function seedDenseContent(request) {
  return seedNative(request, {
    servicesYaml: JSON.stringify([{ Fixtures: [
      { 'Calendar fixture': { widget: { type: 'calendar', view: 'monthly', maxEvents: 10, timezone: 'UTC', integrations: [{ type: 'ical', name: 'Fixture calendar', url: 'https://calendar.example.test/fixture.ics' }] } } },
      { 'Metrics fixture': { widgets: [
        { type: 'glances', url: 'https://metrics.example.test', version: 4, metric: 'cpu', chart: true, refreshInterval: 1000, pointsLimit: 5 },
        { type: 'glances', url: 'https://metrics.example.test', version: 4, metric: 'process', chart: true, refreshInterval: 1000 },
      ] } },
    ] }]),
  }, board => {
    for (const panel of board.panels) {
      panel.rect = panel.nativeLocator.type === 'calendar'
        ? { x: 0, y: 0, w: 6, h: 5 }
        : { x: 6, y: panel.nativeLocator.sourceIndex * 4, w: 4, h: 4 };
    }
  });
}

export async function installEmbeddedDocument(page) {
  let loads = 0;
  await page.route('https://embed.example.test/native-state.html', route => {
    loads += 1;
    return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{font:14px sans-serif;margin:12px;color:#222;background:#fff}label{display:block}input{box-sizing:border-box;width:100%;margin:8px 0}button{padding:8px}#drag{padding:18px;background:#ddd;margin-top:12px;touch-action:none;user-select:none}
</style></head><body><label>Embedded note<input aria-label="Embedded note"></label><button id="counter">Count 0</button><div id="drag" role="slider" tabindex="0" aria-label="Embedded drag" aria-valuenow="0">Drag inside the embedded page</div><script>
window.fixtureLoadId=crypto.randomUUID();window.fixtureCount=0;
document.getElementById('counter').onclick=event=>{event.target.textContent='Count '+(++window.fixtureCount)};
const drag=document.getElementById('drag');let start;
drag.onpointerdown=event=>{start=event.clientX;drag.setPointerCapture(event.pointerId)};
drag.onpointermove=event=>{if(start!==undefined)drag.setAttribute('aria-valuenow',String(Math.round(event.clientX-start)))};
drag.onpointerup=()=>{start=undefined};
</script></body></html>` });
  });
  return { get loads() { return loads; } };
}

export async function seedEmbeddedContent(request, stacked = false) {
  return seedNative(request, {
    servicesYaml: JSON.stringify([{ Fixtures: [
      { 'Embedded fixture': { widget: { type: 'iframe', src: 'https://embed.example.test/native-state.html', name: 'Native embedded state', allowScrolling: 'yes', loadingStrategy: 'eager' } } },
      { 'Stack companion': { href: 'https://example.test/companion' } },
    ] }]),
  }, board => {
    board.panels.forEach((panel, index) => { panel.rect = { x: index * 6, y: 0, w: 6, h: 6 }; });
    if (stacked) board.stacks = [{ id: 'embedded-stack', panelIds: [...board.panels].sort((a, b) => (a.kind === 'serviceWidget' ? -1 : 1) - (b.kind === 'serviceWidget' ? -1 : 1)).map(panel => panel.id), rect: { x: 0, y: 0, w: 6, h: 6 }, playback: playback() }];
  });
}
