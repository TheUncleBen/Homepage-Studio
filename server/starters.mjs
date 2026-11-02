// Starter templates for a new dashboard (owner choice, 1 Nov 2026: "Link
// tiles plus clock and weather"). Each is an ordinary dashboard: plain links
// at placeholder home.arpa addresses (RFC 8375, reserved for home networks)
// that people change to their own, a clock and a weather card. Nothing needs
// a key, so nothing shows an error. Search is the top bar's, which every
// dashboard has, so no search box widget is added.
import YAML from 'yaml';

const link = (name, icon, host, description) => ({ [name]: { href: `https://${host}.home.arpa`, icon: `${icon}.webp`, description } });
const group = (name, items) => ({ [name]: items });

const STARTERS = {
  homelab: {
    name: 'Home lab',
    services: [
      group('Infrastructure', [
        link('Proxmox', 'proxmox', 'proxmox', 'Virtual machines'),
        link('TrueNAS', 'truenas', 'nas', 'Storage'),
        link('Portainer', 'portainer', 'portainer', 'Containers'),
        link('Home Assistant', 'home-assistant', 'homeassistant', 'Home automation'),
      ]),
      group('Network', [
        link('OPNsense', 'opnsense', 'firewall', 'Firewall'),
        link('Pi-hole', 'pi-hole', 'pihole', 'DNS and ad blocking'),
        link('UniFi', 'ubiquiti-unifi', 'unifi', 'Wi-Fi and switches'),
        link('Traefik', 'traefik', 'traefik', 'Reverse proxy'),
      ]),
      group('Tools', [
        link('Uptime Kuma', 'uptime-kuma', 'status', 'Status'),
        link('Grafana', 'grafana', 'grafana', 'Metrics'),
        link('Vaultwarden', 'vaultwarden', 'vault', 'Passwords'),
        link('Gitea', 'gitea', 'git', 'Code'),
      ]),
    ],
  },
  media: {
    name: 'Media',
    services: [
      group('Watch', [
        link('Jellyfin', 'jellyfin', 'jellyfin', 'Films and TV'),
        link('Plex', 'plex', 'plex', 'Films and TV'),
        link('Jellyseerr', 'jellyseerr', 'requests', 'Requests'),
        link('Tautulli', 'tautulli', 'tautulli', 'Plex activity'),
      ]),
      group('Downloads', [
        link('Sonarr', 'sonarr', 'sonarr', 'TV'),
        link('Radarr', 'radarr', 'radarr', 'Films'),
        link('Prowlarr', 'prowlarr', 'prowlarr', 'Indexers'),
        link('qBittorrent', 'qbittorrent', 'qbittorrent', 'Downloads'),
      ]),
      group('Listen', [
        link('Navidrome', 'navidrome', 'music', 'Music'),
        link('Audiobookshelf', 'audiobookshelf', 'audiobooks', 'Audiobooks and podcasts'),
      ]),
    ],
  },
  family: {
    name: 'Family',
    services: [
      group('Family', [
        link('Photos', 'immich', 'photos', 'Immich'),
        link('Files', 'nextcloud', 'files', 'Nextcloud'),
        link('Films and TV', 'jellyfin', 'tv', 'Jellyfin'),
        link('Audiobooks', 'audiobookshelf', 'audiobooks', 'Audiobookshelf'),
      ]),
      group('Home', [
        link('Home Assistant', 'home-assistant', 'homeassistant', 'Lights and heating'),
        link('Documents', 'paperless-ngx', 'documents', 'Paperless'),
        link('Recipes', 'mealie', 'recipes', 'Mealie'),
        link('Passwords', 'vaultwarden', 'vault', 'Vaultwarden'),
      ]),
    ],
  },
};

export const STARTER_IDS = Object.freeze(Object.keys(STARTERS));
export const starterChoices = () => STARTER_IDS.map(id => ({ id, name: STARTERS[id].name }));

// The native files a starter writes into a new, empty dashboard. The weather
// card has no location: it offers "use my location" until one is set.
export function starterFiles(id) {
  const starter = Object.hasOwn(STARTERS, id) ? STARTERS[id] : null;
  if (!starter) return null;
  const widgets = [
    { datetime: { text_size: 'xl', format: { timeStyle: 'short', dateStyle: 'full' } } },
    { openmeteo: { label: 'Weather', cache: 5 } },
  ];
  return { servicesYaml: YAML.stringify(starter.services), widgetsYaml: YAML.stringify(widgets) };
}

// Puts a new starter's clock and weather side by side across the top and
// moves the links, as placed, below them. The links' status check starts off,
// since their placeholder addresses can't answer; it's one switch in each
// tile's Behaviour once the address is real.
export function starterLayout(board) {
  const top = board.panels.filter(panel => panel.kind === 'informationWidget');
  const width = top.length ? Math.floor(board.columns / top.length) : 0;
  const height = top.length ? 2 : 0;
  const panels = board.panels.map(panel => {
    const index = top.indexOf(panel);
    if (index >= 0) return { ...panel, rect: { x: index * width, y: 0, w: width, h: height } };
    const moved = { ...panel, rect: { ...panel.rect, y: panel.rect.y + height } };
    if (panel.kind === 'service') moved.behaviour = { ...panel.behaviour, status: 'off' };
    return moved;
  });
  return { ...board, panels };
}
