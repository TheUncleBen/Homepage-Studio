// SPDX-License-Identifier: AGPL-3.0-or-later
// One line per integration for the Add a widget list: what the app is, then
// what the widget shows (owner request, 4 Nov 2026: no shared, repetitive
// description). The values come from the widget itself (its documented field
// choices, else the labels its component draws) in Homepage's English text,
// so they cannot drift from what a card shows. The kind of app is reviewed
// by hand; an app left out here gets only its values rather than a guess.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export const CATEGORIES = {
  adguard: 'DNS ad blocker', apcups: 'UPS monitoring', arcane: 'Docker management', argocd: 'GitOps deployments',
  atsumeru: 'Manga and comics server', audiobookshelf: 'Audiobook and podcast server', authentik: 'Identity provider',
  autobrr: 'Release automation', azuredevops: 'Pipelines and pull requests', backrest: 'Restic backups', bazarr: 'Subtitle manager',
  beszel: 'Server monitoring', booklore: 'Book library', caddy: 'Web server and reverse proxy', calendar: 'Calendar',
  calibreweb: 'E-book library', changedetectionio: 'Website change monitoring', channelsdvrserver: 'TV DVR',
  checkmk: 'Infrastructure monitoring', cloudflared: 'Cloudflare tunnels', coinmarketcap: 'Cryptocurrency prices',
  crowdsec: 'Security engine', customapi: 'Any JSON API', deluge: 'Torrent client', develancacheui: 'Game download cache',
  dispatcharr: 'IPTV stream manager', docker: 'Docker container', dockhand: 'Docker management', duplicati: 'Backups',
  emby: 'Media server', esphome: 'Smart home devices', evcc: 'EV charging', feed: 'RSS or Atom feed', filebrowser: 'File manager',
  fileflows: 'File processing', firefly: 'Personal finance', flood: 'Torrent client', freshrss: 'RSS reader', frigate: 'Camera NVR',
  fritzbox: 'Router', gamedig: 'Game server status', gatus: 'Health checks', ghostfolio: 'Wealth tracking', gitea: 'Git hosting',
  gitlab: 'Git hosting', glances: 'System monitoring', gluetun: 'VPN client', gotify: 'Notifications', grafana: 'Dashboards and alerts',
  hdhomerun: 'TV tuner', headscale: 'Tailscale control server', healthchecks: 'Cron job monitoring', hoarder: 'Bookmark manager',
  homeassistant: 'Smart home', homebox: 'Home inventory', homebridge: 'Smart home bridge', iframe: 'Embedded web page',
  immich: 'Photo library', jackett: 'Torrent indexers', jdownloader: 'Download manager', jellyfin: 'Media server',
  jellyseerr: 'Media requests', jellystat: 'Jellyfin statistics', karakeep: 'Bookmark manager', kavita: 'Comics and books server',
  komga: 'Comics server', komodo: 'Server and container management', kopia: 'Backups', kubernetes: 'Kubernetes',
  lidarr: 'Music manager', linkwarden: 'Bookmark manager', lubelogger: 'Vehicle maintenance', mailcow: 'Mail server',
  maintainerr: 'Media library clean-up', mastodon: 'Social network', mealie: 'Recipes', medusa: 'TV show manager',
  mikrotik: 'Router', minecraft: 'Minecraft server', miniflux: 'RSS reader', mjpeg: 'Camera stream', moonraker: '3D printer (Klipper)',
  mylar: 'Comics manager', myspeed: 'Internet speed history', navidrome: 'Music server', netalertx: 'Network device scanner',
  netbird: 'Mesh VPN', netdata: 'System monitoring', nextcloud: 'File sync and collaboration', nextdns: 'DNS filtering',
  npm: 'Reverse proxy', ntfy: 'Notifications', nzbget: 'Usenet downloader', octoprint: '3D printer', omada: 'Network controller',
  ombi: 'Media requests', opendtu: 'Solar inverter monitoring', openmediavault: 'NAS', openwrt: 'Router', opnsense: 'Firewall',
  overseerr: 'Media requests', pangolin: 'Tunnelled reverse proxy', paperlessngx: 'Document archive', peanut: 'UPS monitoring',
  pfsense: 'Firewall', photoprism: 'Photo library', pihole: 'DNS ad blocker', pialert: 'Network device scanner',
  plantit: 'Plant care', plex: 'Media server', portainer: 'Docker management', prometheus: 'Monitoring',
  prometheusmetric: 'Prometheus queries', prowlarr: 'Indexer manager', proxmox: 'Virtualisation',
  proxmoxbackupserver: 'Backups', pterodactyl: 'Game server panel', pulse: 'Proxmox monitoring', pyload: 'Download manager',
  qbittorrent: 'Torrent client', qnap: 'NAS', qui: 'qBittorrent web interface', radarr: 'Movie manager', readarr: 'Book manager',
  romm: 'Game ROM library', rutorrent: 'Torrent client', sabnzbd: 'Usenet downloader', scrutiny: 'Disk health',
  seerr: 'Media requests', slskd: 'Soulseek client', sonarr: 'TV show manager', sparkyfitness: 'Fitness and nutrition',
  speedtest: 'Internet speed history', spoolman: '3D printer filament', sportarr: 'Sports media manager', stash: 'Media organiser',
  stocks: 'Stock prices', suwayomi: 'Manga server', swagdashboard: 'Reverse proxy', syncthing: 'File sync',
  strelaysrv: 'Syncthing relay', diskstation: 'NAS', downloadstation: 'Download manager', tailscale: 'Mesh VPN', tandoor: 'Recipes',
  tautulli: 'Plex monitoring', tdarr: 'Transcoding', technitium: 'DNS server', tracearr: 'Stream monitoring',
  traefik: 'Reverse proxy', transmission: 'Torrent client', trilium: 'Notes', truenas: 'NAS', tubearchivist: 'YouTube archive',
  unifi: 'Network controller', unifi_drive: 'Network storage', unmanic: 'Media library optimiser', unraid: 'NAS',
  uptimekuma: 'Uptime monitoring', uptimerobot: 'Uptime monitoring', urbackup: 'Backups', vikunja: 'Tasks',
  wallos: 'Subscription tracker', watchtower: 'Container updates', wgeasy: 'WireGuard VPN', whatsupdocker: 'Container updates',
  xteve: 'IPTV proxy', yourspotify: 'Spotify statistics', zabbix: 'Infrastructure monitoring',
};

// Information widgets stand on their own; each says what it shows.
export const INFO = {
  customapi: 'Values from any JSON API, on their own.',
  datetime: 'The date and time, in the format you choose.',
  glances: 'CPU, memory, disks and more from a Glances server.',
  greeting: 'A line of text, such as a welcome.',
  kubernetes: 'Cluster and node CPU and memory.',
  logo: 'An image or logo.',
  longhorn: 'Longhorn storage use, in total or per node.',
  openmeteo: 'Current weather from Open-Meteo, no key needed.',
  openweathermap: 'Current weather from OpenWeatherMap.',
  resources: 'CPU, memory, disk and more where Studio runs.',
  search: 'A search box for the web search engine you choose.',
  stocks: 'Stock prices and the day’s change.',
  unifi_console: 'Connectivity status from a UniFi Network controller.',
  weatherapi: 'Current weather from WeatherAPI.',
};

// Widgets whose values are named at run time (lists, streams, queries).
export const VALUES = {
  argocd: 'Apps, synced, out of sync, healthy and more',
  calendar: 'Upcoming events from your calendars and media apps',
  coinmarketcap: 'The prices of the coins you choose',
  customapi: 'The values you map from its response',
  feed: 'The latest items',
  glances: 'CPU, memory, disks, network, sensors and more',
  homeassistant: 'People home, lights and switches on, or your own queries',
  iframe: 'A page from another site',
  mjpeg: 'A live camera picture',
  navidrome: 'What is playing now',
  openmediavault: 'Services, S.M.A.R.T. and update status',
  prometheusmetric: 'The results of the queries you write',
  stocks: 'The prices of the symbols you choose',
  spoolman: 'The filament left on each spool',
  suwayomi: 'Downloaded, read and unread chapters',
  tautulli: 'What is playing now, with transcoding and bitrate',
};

const MAX_LISTED = 6;
const humanize = (key) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (char) => char.toUpperCase());
const lookup = (strings, key) => key.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), strings);

async function componentText(source, path) {
  const folder = join(source, 'src/widgets', path.replace(/^\.\//, '').replace(/\/component$/, ''));
  let names = [];
  try { names = (await readdir(folder, { recursive: true })).filter(name => /\.jsx$/.test(name) && !/\.test\./.test(name)).sort(); }
  catch { return ''; }
  const parts = await Promise.all(names.map(name => readFile(join(folder, name), 'utf8')));
  return parts.join('\n');
}

function listed(labels) {
  const unique = [...new Set(labels.filter(Boolean).map(label => label.trim()))];
  if (!unique.length) return '';
  const shown = unique.slice(0, MAX_LISTED);
  const rest = unique.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(', ');
}

// Adds `description` to every catalog entry.
export async function describeCatalog(source, byType, serviceRegistry) {
  const strings = JSON.parse(await readFile(join(source, 'public/locales/en/common.json'), 'utf8'));
  const paths = Object.fromEntries([...serviceRegistry.matchAll(/^\s+"?([a-z0-9_]+)"?:\s*dynamic\(\(\) => import\("([^"]+)"\)\)/gm)].map(match => [match[1], match[2]]));
  for (const item of byType.service.values()) {
    const choices = item.fields.find(field => field.key === 'fields');
    const choiceList = choices?.choices || choices?.optionGroups?.[0]?.choices || [];
    let values = VALUES[item.type];
    const prefix = (paths[item.type] || '').replace(/^\.\//, '').split('/')[0] || item.type;
    if (!values && choiceList.length) values = listed(choiceList.map(choice => [choice.includes('.') ? choice : null, `${prefix}.${choice}`, `${item.type}.${choice}`].map(key => key && lookup(strings, key)).find(text => typeof text === 'string') || humanize(choice)));
    if (!values && paths[item.type]) {
      const text = await componentText(source, paths[item.type]);
      values = listed([...text.matchAll(/label="([a-z0-9_]+\.[A-Za-z0-9_]+)"/g)].map(match => lookup(strings, match[1])).filter(value => typeof value === 'string'));
    }
    const category = CATEGORIES[item.type];
    item.description = [category, values].filter(Boolean).map(part => `${part}.`).join(' ') || `${item.name}.`;
  }
  for (const item of byType.info.values()) item.description = INFO[item.type] || `${item.name}.`;
}

// Setup guides name the exact Docker secret and reference for each secret a
// widget takes (owner request, 4 Nov 2026), e.g. pfSense's password:
// secret homepage_pfsense_password, variable HOMEPAGE_FILE_PFSENSE_PASSWORD,
// and {{HOMEPAGE_FILE_PFSENSE_PASSWORD}} in the widget's settings.
export function secretNames(type, key) {
  const part = (text) => text.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toUpperCase();
  const variable = `HOMEPAGE_FILE_${part(type)}_${part(key)}`;
  return { variable, secret: variable.replace(/^HOMEPAGE_FILE_/, 'homepage_').toLowerCase(), reference: `{{${variable}}}` };
}

export function describeSecrets(byType) {
  for (const kind of ['service', 'info']) {
    for (const item of byType[kind].values()) {
      const secrets = item.fields.filter(field => field.sensitive).map(field => ({ key: field.key, label: field.label, ...secretNames(item.type, field.key) }));
      if (secrets.length) item.secrets = secrets;
    }
  }
}
