// Operations: monitors, incidents, metrics and logs (observability plan and
// build addendum, 6 Nov 2026), plus Administration › Monitoring and logs.
// It uses app.js's building blocks (window.StudioUI), so it looks and behaves
// like the rest of Studio: grouped lists, rows, sheets, info buttons. Every
// value from the server is set as text, never parsed as HTML.
(() => {
  'use strict';
  const UI = window.StudioUI;
  if (!UI) return;
  const { h, put, render, notice, say, icon, group, row, value, toggle, segmented, navRow, actionRow, pill, badge, toolbar, dialogActions, failure, openDialog, confirmDialog, copyText, pageChrome, call, busy, when, ago, infoToggle } = UI;
  const OPS = '/studio/api/ops/';
  const ops = (path, body) => call(OPS + path, body);
  const qs = values => new URLSearchParams(Object.entries(values).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();

  // ---- Shared pieces ---------------------------------------------------------

  // Status in shape and words as well as colour (addendum 4): circle up,
  // triangle down, diamond warning or pending, square maintenance or paused.
  const STATES = {
    up: ['Up', 'circle'], down: ['Down', 'triangle'], unreachable: ['Can’t check', 'diamond'], pending: ['Failing', 'diamond'],
    maintenance: ['Maintenance', 'square'], paused: ['Paused', 'square'], unknown: ['Not checked yet', 'ring'],
  };
  function stateMark(state, { text = true } = {}) {
    const [label, shape] = STATES[state] ?? STATES.unknown;
    return h('span', { class: `ops-state ops-${state in STATES ? state : 'unknown'}`, role: text ? undefined : 'img', 'aria-label': text ? undefined : label, title: label },
      h('span', { class: `ops-shape ops-${shape}`, 'aria-hidden': 'true' }), text ? h('span', { text: label }) : null);
  }
  const SEVERITY = { 0: 'Critical', 1: 'Critical', 2: 'Critical', 3: 'Error', 4: 'Warning', 5: 'Notice', 6: 'Info', 7: 'Debug' };
  const severityBadge = n => badge(SEVERITY[n] ?? 'Info', n <= 3 ? 'danger' : n === 4 ? 'warn' : '');
  const percent = v => (v === null || v === undefined ? '—' : v <= 0 ? '0%' : `${(Math.floor(v * 10000) / 100).toFixed(v >= 0.9999 ? 0 : 2)}%`);
  // Availability ranges the monitor has history for; the first longer one
  // reads "Since <when>" and longer ones are left out (no 90-day claim for a
  // monitor added today).
  function availabilityRanges(a, first) {
    const today = new Date().setHours(0, 0, 0, 0);
    const ranges = [['24 hours', a.day, Date.now() - 86400e3], ['7 days', a.week, today - 6 * 86400e3], ['30 days', a.month, today - 29 * 86400e3], ['90 days', a.quarter, today - 89 * 86400e3]];
    if (!Number.isFinite(first)) return [ranges[0]];
    const out = [];
    for (const [label, v, start] of ranges) {
      if (first <= start + 3600e3) { out.push([label, v]); continue; }
      out.push([`Since ${first >= today ? new Date(first).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date(first).toLocaleDateString([], { day: 'numeric', month: 'short' })}`, v]);
      break;
    }
    return out;
  }
  const ms = v => (Number.isFinite(v) ? (v < 1 ? '<1 ms' : `${Math.round(v)} ms`) : '—');
  const bytes = n => (!Number.isFinite(n) ? '—' : n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${Math.round(n / 1048576)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const time = ts => (ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');
  const shortTime = ts => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const minutes = m => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`);
  // A sentence-long value goes under its label instead of squeezing it.
  const longRow = (label, text) => row(label, value(text), { className: String(text).length > 32 ? 'ops-long' : '' });
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const loading = () => h('p', { class: 'empty-row', text: 'Loading…' });
  const emptyRow = text => h('p', { class: 'empty-row', text });
  const svgNS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs = {}, ...children) {
    const node = document.createElementNS(svgNS, tag);
    for (const [key, val] of Object.entries(attrs)) if (val !== undefined && val !== null) node.setAttribute(key, String(val));
    node.append(...children.filter(Boolean));
    return node;
  }
  // A labelled input row, for dialogs.
  function inputRow(label, attrs = {}, options = {}) {
    const input = h('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', ...attrs });
    return { input, row: row(label, input, options) };
  }
  function selectRow(label, choices, current, options = {}) {
    const select = h('select', {}, choices.map(([val, text]) => h('option', { value: val, text, selected: val === current ? true : undefined })));
    return { select, row: row(label, select, options) };
  }
  // Status bars: one per hour (or day), up / down / maintenance, with words.
  // Every hour (or day) gets a slot, checked or not, so the bars read as time.
  function slots(rows, count, step, last) {
    const end = rows.length ? Math.max(rows.at(-1).start, last) : last;
    return Array.from({ length: count }, (_, index) => {
      const start = end - (count - 1 - index) * step;
      return rows.find(item => Math.abs(item.start - start) < step / 2) ?? { start, up: 0, down: 0, maint: 0 };
    });
  }
  function bars(rows, { label }) {
    const total = rows.length || 1;
    const width = 100 / total;
    const holder = svg('svg', { class: 'ops-bars', viewBox: '0 0 100 24', preserveAspectRatio: 'none', role: 'img', 'aria-label': label });
    rows.forEach((item, index) => {
      const known = item.up + item.down + item.maint;
      const kind = !known ? 'none' : item.down ? (item.down / known > 0.5 ? 'down' : 'partial') : item.maint ? 'maint' : 'up';
      holder.append(svg('rect', { x: index * width + 0.3, y: 0, width: Math.max(0.4, width - 0.6), height: 24, rx: 0.6, class: `ops-bar ops-bar-${kind}` }, svg('title', {}, document.createTextNode(`${shortTime(item.start)}: ${kind === 'none' ? 'not checked' : kind === 'up' ? 'up' : kind === 'maint' ? 'maintenance' : `down ${Math.round((item.down / known) * 100)}% of checks`}`))));
    });
    return holder;
  }
  // A line chart with min, average and max in words beside it.
  function lineChart(points, { label, format = v => String(Math.round(v)) }) {
    const values = points.map(point => point[1]).filter(Number.isFinite);
    if (values.length < 2) return emptyRow('Not enough data yet.');
    const t0 = points[0][0], t1 = points.at(-1)[0];
    const min = Math.min(...values), max = Math.max(...values), avg = values.reduce((a, b) => a + b, 0) / values.length;
    const span = max - min || 1;
    const x = ts => ((ts - t0) / (t1 - t0 || 1)) * 100;
    const y = v => 38 - ((v - min) / span) * 34;
    let d = '';
    let gap = true;
    const step = (t1 - t0) / Math.max(1, points.length - 1);
    points.forEach((point, index) => {
      if (!Number.isFinite(point[1])) { gap = true; return; }
      if (index && point[0] - points[index - 1][0] > step * 4) gap = true;
      d += `${gap ? 'M' : 'L'}${x(point[0]).toFixed(2)},${y(point[1]).toFixed(2)} `;
      gap = false;
    });
    const chart = svg('svg', { class: 'ops-line', viewBox: '0 0 100 40', preserveAspectRatio: 'none', role: 'img', 'aria-label': `${label}: average ${format(avg)}, lowest ${format(min)}, highest ${format(max)}` }, svg('path', { d, 'vector-effect': 'non-scaling-stroke' }));
    return h('div', { class: 'ops-chart' }, chart, h('p', { class: 'ops-chart-facts' }, h('span', { text: `Average ${format(avg)}` }), h('span', { text: `Lowest ${format(min)}` }), h('span', { text: `Highest ${format(max)}` })));
  }

  // ---- The Operations page ---------------------------------------------------

  async function operationsPage() {
    const state = await call('/studio/auth/state');
    const me = state.user;
    let access;
    try { access = await ops('access'); }
    catch (error) {
      render(...pageChrome('/studio/operations', me, h('h1', { class: 'admin-title', text: 'Operations' }), h('div', { class: 'notice', role: 'status', text: error.status === 403 ? 'Your account doesn’t have Monitoring or Logs on any dashboard. An administrator can turn them on in Administration › Dashboard access.' : error.message })));
      return;
    }
    const admin = access.admin;
    const names = new Map(access.dashboards.map(entry => [entry.id, entry.name]));
    names.set('studio', 'Studio');
    const scopeName = scope => names.get(scope) ?? 'Removed dashboard';
    // Sections the person can use.
    const tabs = [
      access.monitoring ? ['overview', 'Overview', 'pulse'] : null,
      access.monitoring ? ['monitors', 'Monitors', 'list'] : null,
      access.monitoring ? ['incidents', 'Incidents', 'alert'] : null,
      access.logs ? ['logs', 'Logs', 'search'] : null,
    ].filter(Boolean);
    const sectionOf = () => location.hash.slice(1).split('/')[0];
    const hashed = () => (tabs.some(([key]) => key === sectionOf()) ? sectionOf() : null);
    let tab = hashed() ?? tabs[0][0];
    const narrow = window.matchMedia('(max-width: 760px)');
    let listing = narrow.matches && !hashed();
    const panel = h('div', { class: 'stack', id: 'ops-panel' });
    const tabList = h('nav', { class: 'admin-sections', 'aria-label': 'Operations sections' });
    const sectionTitle = h('h2', { class: 'admin-section-title' });
    const back = h('button', { type: 'button', class: 'admin-back', onclick: () => showList() }, icon('back'), h('span', { text: 'Operations' }));
    const layout = h('div', { class: 'admin-layout' });
    const pageTitle = h('h1', { class: 'admin-title', text: 'Operations' });
    const message = notice();
    // One dashboard filter for every section; remembered in this browser.
    let filter = '';
    try { filter = localStorage.getItem('studio-ops-dashboard') ?? ''; } catch {}
    if (filter && !names.has(filter)) filter = '';
    const filterChoices = [['', admin ? 'Everything' : 'All my dashboards'], ...access.dashboards.map(entry => [entry.id, entry.name]), ...(admin ? [['studio', 'Studio only']] : [])];
    const filterSelect = filterChoices.length > 2 ? h('select', { class: 'ops-filter', 'aria-label': 'Show', onchange: event => { filter = event.target.value; try { localStorage.setItem('studio-ops-dashboard', filter); } catch {} drawPanel(); } }, filterChoices.map(([val, text]) => h('option', { value: val, text, selected: val === filter ? true : undefined }))) : null;
    let timer = null;
    let monitorsState = null; // a state chosen on Overview
    const refreshEvery = (fn, msInterval) => { clearInterval(timer); timer = setInterval(() => { if (!document.hidden) fn(); }, msInterval); };

    function drawTabs() {
      const showing = !(listing && narrow.matches);
      put(tabList, ...tabs.map(([key, label, iconName]) => h('button', { type: 'button', class: 'admin-section', 'aria-current': showing && key === tab ? 'page' : undefined, onclick: () => select(key, true) },
        h('span', { class: 'admin-section-icon' }, icon(iconName)), h('span', { class: 'admin-section-label', text: label }), icon('chevron', 15))));
      layout.classList.toggle('listing', listing);
      pageTitle.classList.toggle('in-section', !listing);
      sectionTitle.textContent = tabs.find(([key]) => key === tab)[1];
    }
    narrow.addEventListener('change', drawTabs);
    function select(key, fromList = false) {
      const opening = listing && narrow.matches && fromList;
      tab = key; listing = false;
      if (opening) history.pushState({ opsSection: key }, '', '#' + key); else history.replaceState(null, '', '#' + key);
      drawTabs(); drawPanel();
      if (opening) { window.scrollTo(0, 0); back.focus(); }
    }
    function showList() {
      if (history.state?.opsSection) { history.back(); return; }
      listing = true; history.replaceState(null, '', location.pathname); drawTabs(); window.scrollTo(0, 0);
    }
    // Detail views (#monitor/<id>, #incident/<id>) open inside their section.
    function open(path) { location.hash = path; }
    function route() {
      const [section, ...rest] = location.hash.slice(1).split('/');
      // A detail page has one Back, to its section (its own ‹ Monitors / ‹ Incidents).
      if (section === 'monitor' && rest[0]) { tab = 'monitors'; listing = false; drawTabs(); back.hidden = true; return monitorDetail(decodeURIComponent(rest.join('/'))); }
      if (section === 'incident' && rest[0]) { tab = 'incidents'; listing = false; drawTabs(); back.hidden = true; return incidentDetail(rest[0]); }
      if (section.startsWith('logs') && access.logs) { tab = 'logs'; listing = false; drawTabs(); return drawPanel(); }
      if (tabs.some(([key]) => key === section)) { if (section !== tab || listing) { tab = section; listing = false; drawTabs(); } return drawPanel(); }
      if (!section && narrow.matches) { listing = true; drawTabs(); }
    }
    window.addEventListener('hashchange', route);
    window.addEventListener('popstate', route);

    function drawPanel() {
      clearInterval(timer);
      back.hidden = false;
      say(message, '');
      const builders = { overview: overviewTab, monitors: monitorsTab, incidents: incidentsTab, logs: logsTab };
      put(panel, ...[].concat(builders[tab]()));
    }
    const withFilter = extra => qs({ dashboard: filter, ...extra });
    const filterBar = (...extra) => toolbar(filterSelect ? h('label', { class: 'toolbar-info' }, h('span', { text: 'Show' }), filterSelect) : null, ...extra);

    // ---- Overview ----
    function overviewTab() {
      const holder = h('div', { class: 'stack' }, loading());
      async function load() {
        try {
          const view = await ops('overview?' + withFilter({}));
          const counts = view.counts;
          const summary = group({ title: 'Monitors', aside: String(view.total) },
            view.total ? ['down', 'unreachable', 'pending', 'up', 'maintenance', 'paused', 'unknown'].filter(key => counts[key]).map(key => h('button', { type: 'button', class: 'nav-row', onclick: () => { monitorsState = key; select('monitors'); } }, h('span', { class: 'nav-text' }, stateMark(key)), h('span', { class: 'row-value ops-count', text: String(counts[key]) }), icon('chevron', 15)))
              : [emptyRow(admin ? 'No monitors yet. Cards with a status check are monitored by themselves; add others under Monitors.' : 'No monitors on your dashboards yet.')]);
          const incidents = group({ title: 'Down now', aside: String(view.incidents.length) },
            view.incidents.length ? view.incidents.map(item => navRow({ leading: stateMark(item.monitorState ?? 'down', { text: false }), title: item.name, badges: [item.ack_by ? badge('Acknowledged') : null], detail: `${scopeName(item.scope)} · down since ${shortTime(item.opened)}${item.cause ? ' · ' + item.cause : ''}`, onClick: () => open('incident/' + item.id) }))
              : [emptyRow('Nothing is down.')]);
          const attention = view.attention.length ? group({ title: 'Needs attention' }, view.attention.map(item => item.monitor
            ? navRow({ leading: stateMark('pending', { text: false }), title: item.name, detail: item.text, onClick: () => open('monitor/' + encodeURIComponent(item.monitor)) })
            : h('div', { class: 'item-row' }, stateMark('pending', { text: false }), h('span', { class: 'nav-text' }, h('span', { class: 'nav-title', text: item.name }), h('small', { text: item.text }))))) : null;
          const health = view.health ? group({ title: 'Studio', info: 'How Studio’s own monitoring and log storage is doing.' },
            row('Monitoring and logs', value(view.health.status === 'ok' ? 'Working' : view.health.reason ?? 'Needs attention')),
            row('Checks running now', value(String(view.health.running))),
            row('Waiting to be written', value(plural(view.health.queue, 'event', 'events'))),
            view.health.dropped ? row('Not kept (too many at once)', value(plural(view.health.dropped, 'event', 'events')), { info: 'Each source may send about 200 events a second, with bursts of 1000. Events over that are counted here and left out, least important first.' }) : null) : null;
          put(holder, summary, incidents, attention, health);
        } catch (error) { put(holder, h('div', { class: 'notice error', role: 'alert', text: error.message })); }
      }
      load();
      refreshEvery(load, 30000);
      return [filterBar(), holder];
    }

    // ---- Monitors ----
    function monitorsTab() {
      const holder = h('div', { class: 'stack' }, loading());
      // Opened from an Overview count: only monitors in that state, until cleared.
      let only = monitorsState;
      monitorsState = null;
      const onlyPill = only ? pill(`Only ${(STATES[only] ?? STATES.unknown)[0]}`, { iconName: 'close', 'aria-label': `Showing only ${(STATES[only] ?? STATES.unknown)[0]}. Show all`, onclick: () => { only = null; onlyPill.remove(); draw(); } }) : null;
      const search = h('input', { type: 'search', class: 'ops-search', placeholder: 'Find a monitor', 'aria-label': 'Find a monitor' });
      let list = [];
      function draw() {
        const words = search.value.trim().toLowerCase();
        const shown = list.filter(item => (!only || (item.paused ? 'paused' : item.state) === only) && (!words || `${item.name} ${item.target} ${(item.tags ?? []).join(' ')}`.toLowerCase().includes(words)));
        const scopes = [...new Set(shown.map(item => item.scope))].sort((a, b) => scopeName(a).localeCompare(scopeName(b)));
        const rank = item => ({ down: 0, unreachable: 1, pending: 2 })[item.state] ?? 3;
        put(holder, scopes.length ? scopes.map(scope => group({ title: scopeName(scope), aside: String(shown.filter(item => item.scope === scope).length) },
          shown.filter(item => item.scope === scope).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).map(item => navRow({
            leading: stateMark(item.paused ? 'paused' : item.state, { text: false }), title: item.name,
            badges: [item.card ? badge('Card') : null, item.paused ? badge('Paused') : null, item.warning ? badge('Warning', 'warn') : null],
            detail: [item.state === 'down' && item.message ? item.message : null, item.day !== null && item.day !== undefined ? `${percent(item.day)} today` : null, item.state === 'up' ? ms(item.ms) : null, item.card ? null : typeLabel(item.type)].filter(Boolean).join(' · '),
            onClick: () => open('monitor/' + encodeURIComponent(item.id)),
          })))) : [group({}, emptyRow(words ? 'No monitor matches.' : 'No monitors here yet.'))]);
      }
      search.addEventListener('input', draw);
      async function load() {
        try { list = (await ops('monitors?' + withFilter({}))).monitors; draw(); }
        catch (error) { put(holder, h('div', { class: 'notice error', role: 'alert', text: error.message })); }
      }
      load();
      refreshEvery(load, 30000);
      const add = admin ? pill('New monitor', { primary: true, iconName: 'plus', onclick: () => monitorEditor(null, { onSaved: load }) }) : null;
      const maintenance = admin ? pill('Maintenance', { iconName: 'wrench', onclick: () => maintenanceDialog(load) }) : null;
      return [filterBar(search, onlyPill, maintenance, add), holder];
    }

    async function monitorDetail(id) {
      clearInterval(timer);
      put(panel, loading());
      let detail;
      try { detail = await ops('monitors/' + encodeURIComponent(id)); }
      catch (error) { put(panel, backTo('monitors', 'Monitors'), h('div', { class: 'notice error', role: 'alert', text: error.status === 404 ? 'This monitor no longer exists, or isn’t on your dashboards.' : error.message })); return; }
      const m = detail.monitor;
      sectionTitle.textContent = m.name;
      const box = notice();
      const checkNow = pill('Check now', { iconName: 'refresh', onclick: () => busy(checkNow, 'Checking…', async () => { try { await ops(`monitors/${encodeURIComponent(id)}/check`, {}); setTimeout(() => monitorDetail(id), 2500); } catch (error) { failure(box, error); } }) });
      const edit = admin && detail.definition ? pill('Edit', { iconName: 'settings', onclick: () => monitorEditor(detail.definition, { onSaved: () => monitorDetail(id), onDeleted: () => open('monitors') }) }) : null;
      const cardSettings = admin && m.card ? pill('Notifications', { iconName: 'bell', onclick: () => cardMonitorDialog(m, detail.override, () => monitorDetail(id)) }) : null;
      const pause = admin && detail.definition ? pill(m.paused ? 'Resume' : 'Pause', { iconName: m.paused ? 'play' : 'pause', onclick: () => busy(pause, 'Saving…', async () => { try { await ops('config', { kind: 'monitor', action: m.paused ? 'resume' : 'pause', id }); monitorDetail(id); } catch (error) { failure(box, error); } }) }) : null;
      const a = detail.history.availability;
      const head = h('div', { class: 'ops-head' }, h('h2', { class: 'ops-name', text: m.name }), stateMark(m.paused ? 'paused' : m.state), h('span', { class: 'muted small', text: m.since ? `since ${shortTime(m.since)}` : '' }));
      const facts = group({ title: 'Now' },
        row('Dashboard', value(scopeName(m.scope))),
        row('Checks', value(m.card ? `This card’s ${m.type === 'ping' ? 'ping' : 'web'} check` : typeLabel(m.type))),
        m.target && !m.card ? row('Target', value(m.target, true)) : null,
        row('Last check', value(m.lastCheck ? `${ago(m.lastCheck)}${m.ms !== null ? ' · ' + ms(m.ms) : ''}${m.code ? ' · HTTP ' + m.code : ''}` : 'Not yet')),
        m.state !== 'up' && m.message ? longRow('Problem', m.message) : null,
        m.warning ? longRow('Warning', m.warning.message ?? String(m.warning)) : null,
        m.certExpires ? row('Certificate expires', value(new Date(m.certExpires).toLocaleDateString())) : null,
        row('Check every', value(`${m.interval} s`)));
      const avail = group({ title: 'Availability', info: 'Up time ÷ (up + down). Maintenance and time not checked are left out.' },
        h('div', { class: 'ops-avail', 'data-count': String(availabilityRanges(a, detail.history.first).length) }, ...availabilityRanges(a, detail.history.first).map(([label, v]) => h('div', {}, h('strong', { text: percent(v) }), h('small', { text: label })))));
      const hourly = group({ title: 'Last 24 hours' }, h('div', { class: 'ops-pad' }, bars(slots(detail.history.hourly, 24, 3600e3, Math.floor(Date.now() / 3600e3) * 3600e3), { label: 'Status each hour for the last 24 hours' })));
      const daily = detail.history.daily.length > 1 ? group({ title: 'Last 90 days' }, h('div', { class: 'ops-pad' }, bars(slots(detail.history.daily, 90, 86400e3, new Date().setHours(0, 0, 0, 0)), { label: 'Status each day for the last 90 days' }))) : null;
      const chartHolder = h('div', { class: 'ops-pad' }, loading());
      const response = group({ title: 'Response time', aside: rangePicker('24h', range => loadChart(range)) }, chartHolder);
      async function loadChart(range) {
        try {
          const data = await ops('metrics?' + qs({ scope: m.scope, resource: `monitor:${m.id}`, name: 'response_ms', range }));
          put(chartHolder, data.points.length ? lineChart(data.points.map(point => [point[0], point[1]]), { label: 'Response time', format: ms }) : emptyRow('No response times yet.'));
        } catch (error) { put(chartHolder, emptyRow(error.message)); }
      }
      loadChart('24h');
      const recent = detail.history.recent.slice(-15).reverse();
      const checks = group({ title: 'Recent checks' }, recent.length ? recent.map(item => h('div', { class: 'item-row' }, stateMark(item.state, { text: false }), h('span', { class: 'nav-text' }, h('span', { class: 'nav-title', text: item.state === 'up' ? `Up · ${ms(item.ms)}` : item.message ?? 'Failed' }), h('small', { text: shortTime(item.ts) + (item.code ? ` · HTTP ${item.code}` : '') })))) : [emptyRow('No checks yet.')]);
      const incidents = group({ title: 'Incidents' }, detail.incidents.length ? detail.incidents.map(item => navRow({ leading: stateMark(item.closed ? 'up' : 'down', { text: false }), title: item.closed ? `Down for ${minutes(Math.max(1, Math.round((item.closed - item.opened) / 60000)))}` : 'Down now', detail: `${shortTime(item.opened)}${item.cause ? ' · ' + item.cause : ''}`, onClick: () => open('incident/' + item.id) })) : [emptyRow('No incidents.')]);
      const container = m.type === 'docker' ? containerGroup(m) : null;
      put(panel, backTo('monitors', 'Monitors'), head, toolbar(checkNow, pause, cardSettings, edit), box, facts, avail, hourly, daily, response, container, checks, incidents);
    }
    function containerGroup(m) {
      const holder = h('div', {}, loading());
      ops('containers/' + encodeURIComponent(m.id)).then(data => {
        const d = data.result?.docker;
        if (!d) return put(holder, emptyRow(data.reason ?? data.result?.message ?? 'Container details aren’t available.'));
        const rows = d.kind === 'service'
          ? [row('Running tasks', value(`${d.running} of ${d.wanted}`)), d.recentFailures ? row('Failed in the last hour', value(String(d.recentFailures))) : null]
          : [row('State', value(d.status ?? '—')), d.health ? row('Health check', value(d.health)) : null, row('Restarts', value(String(d.restarts ?? 0))), d.image ? row('Image', value(d.image, true)) : null, d.startedAt ? row('Started', value(shortTime(d.startedAt))) : null,
            d.stats ? row('CPU', value(d.stats.cpu === null ? '—' : `${d.stats.cpu}%`)) : null, d.stats?.memory !== null && d.stats ? row('Memory', value(`${bytes(d.stats.memory)}${d.stats.memoryPercent !== null ? ` · ${d.stats.memoryPercent}% of its limit` : ''}`)) : null, d.oom ? row('Out of memory', value('Yes, it was stopped for memory')) : null];
        put(holder, ...rows.filter(Boolean));
      }).catch(error => put(holder, emptyRow(error.message)));
      return group({ title: 'Container' }, holder);
    }
    const backTo = (section, label) => h('button', { type: 'button', class: 'ops-back', onclick: () => open(section) }, icon('back', 16), h('span', { text: label }));
    function rangePicker(initial, onChange) {
      return segmented({ value: initial, label: 'Time range', options: [['24h', '24 h'], ['7d', '7 d'], ['30d', '30 d']], onChange });
    }

    // ---- Incidents ----
    function incidentsTab() {
      const holder = h('div', { class: 'stack' }, loading());
      let openOnly = false;
      const only = segmented({ value: 'all', label: 'Incidents to show', options: [['all', 'Recent'], ['open', 'Open']], onChange: option => { openOnly = option === 'open'; load(); } });
      async function load() {
        try {
          const { incidents } = await ops('incidents?' + withFilter({ open: openOnly ? 1 : undefined }));
          put(holder, group({ aside: String(incidents.length) }, incidents.length ? incidents.map(item => navRow({
            leading: stateMark(item.closed ? 'up' : 'down', { text: false }), title: item.name,
            badges: [item.closed ? null : badge('Open', 'danger'), item.ack_by && !item.closed ? badge('Acknowledged') : null],
            detail: `${scopeName(item.scope)} · ${shortTime(item.opened)}${item.closed ? ` · lasted ${minutes(Math.max(1, Math.round((item.closed - item.opened) / 60000)))}` : ''}${item.cause ? ' · ' + item.cause : ''}`,
            onClick: () => open('incident/' + item.id),
          })) : [emptyRow(openOnly ? 'Nothing is down.' : 'No incidents yet.')]));
        } catch (error) { put(holder, h('div', { class: 'notice error', role: 'alert', text: error.message })); }
      }
      load();
      refreshEvery(load, 30000);
      return [filterBar(only), holder];
    }
    async function incidentDetail(id) {
      clearInterval(timer);
      put(panel, loading());
      let detail;
      try { detail = await ops('incidents/' + id); }
      catch (error) { put(panel, backTo('incidents', 'Incidents'), h('div', { class: 'notice error', role: 'alert', text: error.status === 404 ? 'This incident isn’t on your dashboards.' : error.message })); return; }
      const incident = detail.incident;
      sectionTitle.textContent = incident.name;
      const box = notice();
      const ack = !incident.closed && !incident.ack_at ? pill('I’m on it', { primary: true, iconName: 'check', onclick: () => busy(ack, 'Saving…', async () => { try { await ops(`incidents/${id}/ack`, {}); incidentDetail(id); } catch (error) { failure(box, error); } }) }) : null;
      const note = h('textarea', { rows: 2, maxlength: 1000, placeholder: 'Add a note for the timeline', 'aria-label': 'Note' });
      const addNote = h('button', { type: 'button', class: 'primary small-button', text: 'Add note' });
      addNote.addEventListener('click', () => busy(addNote, 'Adding…', async () => { if (!note.value.trim()) return; try { await ops(`incidents/${id}/note`, { text: note.value }); incidentDetail(id); } catch (error) { failure(box, error); } }));
      const KIND_TEXT = { down: 'Down', up: 'Back up', closed: 'Ended', ack: 'Acknowledged', note: 'Note', notified: 'Notified' };
      // The entry's own words, without repeating its title.
      const entryText = item => { const title = KIND_TEXT[item.kind] ?? item.kind; const text = String(item.text ?? '').replace(new RegExp(`^${title} · `), ''); return text === title ? '' : text; };
      put(panel, backTo('incidents', 'Incidents'),
        h('div', { class: 'ops-head' }, h('h2', { class: 'ops-name', text: incident.name }), stateMark(incident.closed ? 'up' : 'down'), h('span', { class: 'muted small', text: incident.closed ? `lasted ${minutes(Math.max(1, Math.round((incident.closed - incident.opened) / 60000)))}` : `since ${shortTime(incident.opened)}` })),
        toolbar(detail.monitor ? pill('Open monitor', { iconName: 'pulse', onclick: () => open('monitor/' + encodeURIComponent(incident.monitor_id)) }) : null, access.logs ? pill('Logs around it', { iconName: 'search', onclick: () => { pendingLogs = { query: `dashboard:${incident.scope}`, from: incident.opened - 15 * 60e3, to: (incident.closed ?? Date.now()) + 5 * 60e3 }; open('logs'); } }) : null, ack),
        box,
        group({ title: 'What happened' }, row('Dashboard', value(scopeName(incident.scope))), incident.cause ? longRow('Problem', incident.cause) : null, incident.ack_by ? row('Acknowledged by', value(`${incident.ack_by}, ${ago(incident.ack_at)}`)) : null),
        group({ title: 'Timeline' }, detail.timeline.map(item => h('div', { class: 'item-row' }, h('span', { class: 'nav-text' }, h('span', { class: 'nav-title', text: `${KIND_TEXT[item.kind] ?? item.kind}${item.actor ? ' · ' + item.actor : ''}` }), entryText(item) ? h('small', { class: 'ops-wrap', text: entryText(item) }) : null), h('time', { class: 'row-value small', text: shortTime(item.ts) }))),
          h('div', { class: 'ops-note' }, note, addNote)));
    }

    // ---- Logs ----
    let pendingLogs = null;
    const RANGES = [['15m', '15 min'], ['1h', '1 h'], ['24h', '24 h'], ['7d', '7 d']];
    function logsTab() {
      const start = pendingLogs; pendingLogs = null;
      const hashQuery = new URLSearchParams(location.hash.split('?')[1] ?? '');
      const queryInput = h('input', { type: 'search', class: 'ops-query mono', placeholder: 'Search, for example: severity:error source:docker', 'aria-label': 'Search the logs', value: start?.query ?? hashQuery.get('q') ?? '' });
      let range = '1h';
      let window_ = start ? { from: start.from, to: start.to } : null;
      const rangeControl = segmented({ value: range, label: 'Time range', options: RANGES, onChange: option => { range = option; window_ = null; search(); } });
      const [helpButton, help] = infoToggle('search', [
        h('p', { text: 'Words find events that contain them; "quotes" find a phrase.' }),
        h('p', { text: 'Filters: severity:error (or warning, info), source:docker, resource:plex, type:container.*, class:timeout, dashboard:<name or id>, panel:<widget id>, actor:alice. Put - in front to leave matches out: -source:renderer.' }),
        h('p', { text: 'Times are this browser’s time zone. Secrets are masked when events are stored.' }),
      ]);
      const histogram = h('div', { class: 'ops-pad' });
      const results = h('div', {});
      const facets = h('div', { class: 'ops-facets' });
      const status = h('p', { class: 'muted small ops-status', role: 'status' });
      let grouped = false;
      const groupToggle = segmented({ value: 'events', label: 'Show', options: [['events', 'Events'], ['groups', 'Similar together']], onChange: option => { grouped = option === 'groups'; search(); } });
      let next = null, lastParams = null;
      const searchButton = h('button', { type: 'button', class: 'primary small-button', text: 'Search' });
      searchButton.addEventListener('click', () => { window_ = null; search(); });
      queryInput.addEventListener('keydown', event => { if (event.key === 'Enter') { window_ = null; search(); } });
      const params = () => ({ q: queryInput.value.trim(), ...(window_ ? { from: Math.round(window_.from), to: Math.round(window_.to) } : { range }), dashboard: filter });
      async function search() {
        lastParams = params();
        history.replaceState(history.state, '', '#logs' + (lastParams.q ? '?' + qs({ q: lastParams.q }) : ''));
        status.textContent = 'Searching…';
        put(results, loading());
        const p = qs(lastParams);
        try {
          const [hist, list, facetData] = await Promise.all([ops('logs/histogram?' + p), grouped ? ops('logs/groups?' + p) : ops('logs/search?' + p + '&limit=100'), ops('logs/facets?' + p)]);
          drawHistogram(hist);
          drawFacets(facetData);
          if (grouped) { drawGroups(list.groups); status.textContent = `${plural(list.groups.length, 'kind of event', 'kinds of event')}${list.partial ? ' (search stopped early; narrow it to see everything)' : ''}`; }
          else { next = list.next; drawEvents(list.events, false); status.textContent = `${plural(facetData.total, 'event', 'events')}${list.partial || facetData.partial ? ' (search stopped early; narrow it to see everything)' : ''}`; }
        } catch (error) { status.textContent = ''; put(results, h('div', { class: 'notice error', role: 'alert', text: error.message })); }
      }
      function drawHistogram(data) {
        const max = Math.max(1, ...data.bars.map(bar => bar.n));
        const width = 100 / Math.max(1, data.bars.length);
        const chart = svg('svg', { class: 'ops-histogram', viewBox: '0 0 100 30', preserveAspectRatio: 'none', role: 'img', 'aria-label': `Events over time: ${data.bars.reduce((a, b) => a + b.n, 0)} in total, ${data.bars.reduce((a, b) => a + b.errors, 0)} errors` });
        data.bars.forEach((bar, index) => {
          if (!bar.n) return;
          const height = (bar.n / max) * 30;
          const rect = svg('rect', { x: index * width + 0.15, y: 30 - height, width: Math.max(0.3, width - 0.3), height, class: bar.errors ? 'ops-hist-error' : bar.warnings ? 'ops-hist-warn' : 'ops-hist' }, svg('title', {}, document.createTextNode(`${shortTime(bar.start)}: ${bar.n} events${bar.errors ? `, ${bar.errors} errors` : ''}`)));
          // A bar narrows the search to its time.
          rect.addEventListener('click', () => { window_ = { from: bar.start, to: bar.start + data.step }; search(); });
          chart.append(rect);
        });
        put(histogram, chart, window_ ? h('button', { type: 'button', class: 'link-button small', text: `Showing ${shortTime(window_.from)} to ${time(window_.to)} · show the whole range`, onclick: () => { window_ = null; search(); } }) : null);
      }
      function addTerm(term) { const now = queryInput.value.trim(); if (!now.split(/\s+/).includes(term)) queryInput.value = (now ? now + ' ' : '') + term; search(); }
      const quote = text => (/[\s"]/.test(String(text)) ? `"${String(text).replace(/"/g, '')}"` : String(text));
      function drawFacets(data) {
        const sets = [['severity', 'Severity', item => SEVERITY[item.value] ?? item.value, item => `severity:${(SEVERITY[item.value] ?? 'info').toLowerCase()}`], ['source_type', 'Source', item => item.value, item => `source:${item.value}`], ['resource', 'Resource', item => item.value, item => `resource:${quote(item.value)}`], ['error_class', 'Problem', item => item.value, item => `class:${item.value}`]];
        put(facets, sets.filter(([key]) => data.facets?.[key]?.length).map(([key, label, text, term]) => h('div', { class: 'ops-facet' }, h('span', { class: 'ops-facet-label', text: label }),
          data.facets[key].slice(0, 6).map(item => h('button', { type: 'button', class: 'ops-chip', onclick: () => addTerm(term(item)) }, h('span', { text: text(item) }), h('small', { text: String(item.count) }))))));
      }
      function drawEvents(events, append) {
        const rows = events.map(event => eventRow(event));
        if (!append) put(results, group({}, rows.length ? rows : [emptyRow('No events match.')]));
        else results.querySelector('.group-body')?.append(...rows);
        results.querySelector('.ops-more')?.remove();
        if (next) {
          const more = h('button', { type: 'button', class: 'pill ops-more', text: 'Show older' });
          more.addEventListener('click', () => busy(more, 'Loading…', async () => {
            try { const page = await ops('logs/search?' + qs(lastParams) + '&limit=100&' + qs({ before: `${next.ts}:${next.id}` })); next = page.next; drawEvents(page.events, true); }
            catch (error) { say(message, error.message); }
          }));
          results.append(more);
        }
      }
      function eventRow(event) {
        const holder = h('div', { class: 'ops-event' });
        const summary = h('button', { type: 'button', class: 'ops-event-row', 'aria-expanded': 'false' },
          h('time', { class: 'ops-event-time mono', datetime: new Date(event.ts).toISOString(), title: new Date(event.ts).toLocaleString(), text: time(event.ts) }),
          severityBadge(event.severity),
          h('span', { class: 'ops-event-text' }, h('span', { class: 'ops-event-meta', text: [event.resource, scopeName(event.scope)].filter(Boolean).join(' · ') }), h('span', { class: 'ops-event-message mono', text: event.message })),
          event.repeat > 1 ? badge(`×${event.repeat}`) : null);
        let detail = null;
        summary.addEventListener('click', () => {
          const opening = !detail;
          summary.setAttribute('aria-expanded', String(opening));
          if (!opening) { detail.remove(); detail = null; return; }
          const fields = Object.entries(event.fields ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== '');
          detail = h('div', { class: 'ops-event-detail' },
            h('p', { class: 'mono ops-wrap', text: event.message }),
            h('dl', { class: 'facts small' },
              ...[['When', new Date(event.ts).toLocaleString()], ['Dashboard', scopeName(event.scope)], ['Source', `${event.source_type}${event.source_id ? ' · ' + event.source_id : ''}`], ['Type', event.event_type], event.error_class ? ['Problem', event.error_class] : null, event.actor ? ['By', event.actor] : null, event.repeat > 1 ? ['Repeated', `${event.repeat} times until ${time(event.last_ts ?? event.ts)}`] : null, ...fields.map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]), event.personal ? ['Person', [event.personal.username, event.personal.ip].filter(Boolean).join(' · ') || 'Masked after 30 days'] : null]
                .filter(Boolean).flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { class: 'ops-wrap', text: v })])),
            h('div', { class: 'row' },
              h('button', { type: 'button', class: 'small-button', text: 'Show surrounding', onclick: () => surrounding(event) }),
              h('button', { type: 'button', class: 'small-button', text: 'Find similar', onclick: () => { queryInput.value = `group:${event.fingerprint}`; search(); } }),
              h('button', { type: 'button', class: 'small-button', text: 'Copy', onclick: event2 => copyText(JSON.stringify(event, null, 2), message) })));
          holder.append(detail);
        });
        holder.append(summary);
        return holder;
      }
      async function surrounding(event) {
        openDialog('Around this event', close => {
          const body = h('div', { class: 'ops-context' }, loading());
          ops('logs/context?' + qs({ id: event.id, stream: event.stream, seq: event.seq })).then(data => {
            put(body, group({}, data.events.map(item => h('div', { class: 'item-row ops-context-row' + (item.id === event.id ? ' current' : '') }, h('time', { class: 'mono small', text: time(item.ts) }), severityBadge(item.severity), h('span', { class: 'mono small ops-wrap', text: item.message })))));
            body.querySelector('.current')?.scrollIntoView({ block: 'center' });
          }).catch(error => put(body, h('div', { class: 'notice error', text: error.message })));
          return [body, dialogActions(h('button', { type: 'button', onclick: close, text: 'Close' }))];
        });
      }
      function drawGroups(groups) {
        put(results, group({}, groups.length ? groups.map(item => navRow({
          leading: severityBadge(item.severity), title: item.event?.message ?? '(no words)',
          badges: [badge(`×${item.count}`)], detail: `${item.event?.resource ?? item.event?.source_type ?? ''} · last ${ago(item.last)}`,
          onClick: () => { queryInput.value = `group:${item.fingerprint}`; groupToggle.querySelector('[role=radio]')?.click(); },
        })) : [emptyRow('No events match.')]));
      }
      // Saved searches, shared between administrators.
      const views = h('select', { 'aria-label': 'Saved searches', class: 'ops-views', hidden: true, onchange: event => { const view = savedViews.find(item => item.id === event.target.value); if (view) { queryInput.value = view.query; range = view.range in Object.fromEntries(RANGES) ? view.range : '1h'; window_ = null; search(); } event.target.value = ''; } });
      let savedViews = [];
      if (admin) ops('views').then(data => { savedViews = data.views; put(views, h('option', { value: '', text: savedViews.length ? 'Saved searches' : 'No saved searches' }), savedViews.map(item => h('option', { value: item.id, text: item.name }))); views.hidden = !savedViews.length; }).catch(() => { views.hidden = true; });
      const saveView = admin ? h('button', { type: 'button', class: 'small-button', text: 'Save search', onclick: () => saveViewDialog() }) : null;
      function saveViewDialog() {
        openDialog('Save this search', close => {
          const box = notice();
          const name = inputRow('Name', { maxlength: 80, 'data-autofocus': true });
          const save = h('button', { type: 'button', class: 'primary', text: 'Save' });
          save.addEventListener('click', () => busy(save, 'Saving…', async () => { try { const result = await ops('config', { kind: 'view', action: 'save', item: { name: name.input.value, query: queryInput.value.trim(), range } }); savedViews.push(result.item); views.append(h('option', { value: result.item.id, text: result.item.name })); views.hidden = false; close(); } catch (error) { failure(box, error); } }));
          return [group({}, name.row), box, dialogActions(h('button', { type: 'button', onclick: close, text: 'Cancel' }), save)];
        });
      }
      const exportButton = admin ? pill('Export', { iconName: 'download', onclick: () => exportDialog() }) : null;
      function exportDialog() {
        openDialog('Export these events', close => {
          const box = notice();
          let format = 'csv';
          const formatControl = segmented({ value: format, label: 'Format', options: [['csv', 'CSV'], ['ndjson', 'JSON lines']], onChange: option => { format = option; } });
          const go = h('button', { type: 'button', class: 'primary', text: 'Download' });
          go.addEventListener('click', () => busy(go, 'Preparing…', async () => {
            try {
              const response = await fetch(OPS + 'logs/export?' + qs({ ...params(), format }), { credentials: 'same-origin', cache: 'no-store' });
              if (!response.ok) { const data = await response.json().catch(() => ({})); throw Object.assign(new Error(data.error ?? 'Export failed.'), { code: data.code, status: response.status }); }
              const blob = await response.blob();
              const link = h('a', { href: URL.createObjectURL(blob), download: /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? 'studio-logs' });
              document.body.append(link); link.click(); link.remove();
              setTimeout(() => URL.revokeObjectURL(link.href), 10000);
              close();
            } catch (error) { failure(box, error); }
          }));
          return [h('p', { class: 'muted small', text: 'Exports the events this search finds, up to 50,000, including sign-in events. Secrets were masked when the events were stored.' }), group({}, row('Format', formatControl)), box, dialogActions(h('button', { type: 'button', onclick: close, text: 'Cancel' }), go)];
        });
      }
      search();
      return [filterBar(views, saveView, exportButton),
        h('div', { class: 'ops-searchbar' }, h('div', { class: 'ops-query-row' }, queryInput, helpButton, searchButton), help, h('div', { class: 'spread' }, rangeControl, groupToggle)),
        histogram, facets, status, results];
    }

    // ---- Editors (administrators) ----
    let configCache = null;
    async function config() { configCache = await ops('config'); return configCache; }
    async function monitorEditor(existing, { onSaved, onDeleted }) {
      const cfg = await config();
      const types = [['http', 'Web address'], ['tcp', 'Port'], ['ping', 'Ping'], ['dns', 'DNS record'], ['tls', 'Certificate'], ['push', 'Push (heartbeat)'], ['docker', 'Docker container'], ['group', 'Group']];
      openDialog(existing ? `Edit ${existing.name}` : 'New monitor', close => {
        const box = notice();
        let type = existing?.type ?? 'http';
        const name = inputRow('Name', { maxlength: 80, value: existing?.name ?? '', 'data-autofocus': true });
        const scopes = [...cfg.dashboards.map(entry => [entry.id, entry.name]), ['studio', 'Studio only']];
        const scope = selectRow('Dashboard', scopes, existing?.scope ?? (filter && filter !== 'studio' ? filter : scopes[0][0]), { info: 'Who can see it: administrators, and people given Monitoring on this dashboard. Studio only: administrators.' });
        if (existing) scope.select.disabled = true;
        const typeSelect = selectRow('Type', types, type);
        if (existing) typeSelect.select.disabled = true;
        const settingsHolder = h('div', {});
        let read = () => ({});
        const before = existing?.[type] ?? {};
        function drawSettings() {
          const s = existing?.type === type ? existing[type] ?? {} : {};
          const rows = [];
          // Rows from here on are less common and sit under More options.
          let basic = Infinity;
          const field = (label, key, attrs = {}, options) => { const r = inputRow(label, { value: s[key] ?? attrs.value ?? '', ...attrs }, options); rows.push(r.row); return r.input; };
          if (type === 'http') {
            const url = field('Address', 'url', { type: 'url', placeholder: 'https://service.example/health' });
            const method = selectRow('Method', [['GET', 'GET'], ['HEAD', 'HEAD'], ['POST', 'POST']], s.method ?? 'GET'); rows.push(method.row);
            const accept = field('Up when it answers', 'accept', { value: '200-399', placeholder: '200-399' }, { info: 'Status codes that count as up, such as 200-399 or 200,204.' });
            basic = rows.length;
            const keyword = field('Must contain', 'keyword', { placeholder: 'optional' });
            const absent = toggle({ checked: Boolean(s.keywordAbsent), label: 'Down when the words appear instead' }); rows.push(row('Down when it appears instead', absent));
            const jsonPath = field('JSON value at', 'jsonPath', { placeholder: 'optional, such as status' });
            const jsonExpect = field('Equals', 'jsonExpect', { placeholder: 'optional, such as ok' });
            const maxMs = field('Down when slower than (ms)', 'maxMs', { type: 'number', min: 0, max: 120000, value: s.maxMs || '' , placeholder: 'off' });
            const verify = toggle({ checked: s.verifyTls !== false, label: 'Check the certificate' }); rows.push(row('Check the certificate', verify, { info: 'Off for a service with a self-signed certificate. Trusted certificates in Administration count as valid.' }));
            const redirects = toggle({ checked: s.followRedirects !== false, label: 'Follow redirects' }); rows.push(row('Follow redirects', redirects));
            const headers = h('textarea', { rows: 2, class: 'mono', placeholder: 'Authorization: Bearer …', 'aria-label': 'Headers' });
            const kept = (s.headers ?? []).map(item => item.name);
            rows.push(row('Headers', headers, { stacked: true, detail: kept.length ? `Saved: ${kept.join(', ')}. Values are hidden; leave a value out to keep it.` : 'One per line, such as Authorization: Bearer …. Saved values are never shown again.' }));
            const body = field('Body (POST)', 'body', { placeholder: 'optional' });
            read = () => {
              const typed = headers.value.split('\n').map(line => line.trim()).filter(Boolean).map(line => { const i = line.indexOf(':'); return i > 0 ? { name: line.slice(0, i).trim(), value: line.slice(i + 1).trim() } : { name: line, value: '' }; });
              const names = new Set(typed.map(item => item.name.toLowerCase()));
              const all = [...typed, ...kept.filter(n => !names.has(n.toLowerCase())).map(n => ({ name: n, value: '' }))];
              return { url: url.value.trim(), method: method.select.value, accept: accept.value.trim() || '200-399', keyword: keyword.value, keywordAbsent: absent.checked, jsonPath: jsonPath.value, jsonExpect: jsonExpect.value, maxMs: maxMs.value || 0, verifyTls: verify.checked, followRedirects: redirects.checked, headers: all, body: body.value };
            };
          } else if (type === 'tcp') {
            const host = field('Host', 'host', { placeholder: 'nas.lan' }); const port = field('Port', 'port', { type: 'number', min: 1, max: 65535 });
            read = () => ({ host: host.value.trim(), port: port.value });
          } else if (type === 'ping') {
            const host = field('Host', 'host', { placeholder: 'router.lan or 10.0.0.1' });
            read = () => ({ host: host.value.trim() });
          } else if (type === 'dns') {
            const record = field('Name', 'name', { placeholder: 'example.com' });
            const kind = selectRow('Record', ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'PTR', 'CAA', 'SOA'].map(t => [t, t]), s.recordType ?? 'A'); rows.push(kind.row);
            const resolver = field('Ask this server', 'resolver', { placeholder: 'optional, such as 1.1.1.1' });
            const expect = field('Answer must include', 'expect', { placeholder: 'optional' });
            read = () => ({ name: record.value.trim(), recordType: kind.select.value, resolver: resolver.value.trim(), expect: expect.value.trim() });
          } else if (type === 'tls') {
            const host = field('Host', 'host', { placeholder: 'service.example' }); const port = field('Port', 'port', { type: 'number', value: s.port ?? 443 });
            const warn = field('Warn when it expires within (days)', 'warnDays', { type: 'number', min: 1, max: 90, value: s.warnDays ?? 14 });
            read = () => ({ host: host.value.trim(), port: port.value, warnDays: warn.value });
          } else if (type === 'push') {
            const period = field('Expect a ping every (minutes)', 'period', { type: 'number', min: 1, value: Math.round((s.period ?? 3600) / 60) });
            const grace = field('Then wait (minutes)', 'grace', { type: 'number', min: 0, value: Math.round((s.grace ?? 300) / 60) });
            rows.push(h('p', { class: 'empty-row', text: existing ? 'Its address stays the same. If the old one leaked, use Make a new push address below.' : 'Its address is shown once, after saving.' }));
            read = () => ({ period: Number(period.value) * 60, grace: Number(grace.value) * 60 });
          } else if (type === 'docker') {
            const server = field('Docker server', 'server', { placeholder: 'as named in the dashboard’s docker.yaml' }, { info: 'A server from this dashboard’s docker.yaml. Studio only reads from Docker; a read-only socket proxy is recommended (see the monitoring guide).' });
            const container = field('Container or service', 'container', { placeholder: 'plex' });
            const logs = toggle({ checked: Boolean(s.collectLogs), label: 'Keep its logs' }); rows.push(row('Keep its logs', logs, { info: 'Its output goes to this dashboard’s logs, with secrets masked.' }));
            read = () => ({ server: server.value.trim(), container: container.value.trim(), collectLogs: logs.checked });
          } else if (type === 'group') {
            const mode = segmented({ value: s.mode ?? 'any', label: 'Down when', options: [['any', 'Any is down'], ['all', 'All are down']] }); rows.push(row('Down when', mode));
            const members = new Set(s.members ?? []);
            const candidates = cfg.monitors.filter(item => item.scope === scope.select.value && item.type !== 'group' && item.id !== existing?.id);
            rows.push(...(candidates.length ? candidates.map(item => row(item.name, toggle({ checked: members.has(item.id), label: item.name, onChange: on => { if (on) members.add(item.id); else members.delete(item.id); } }))) : [emptyRow('Add other monitors on this dashboard first.')]));
            read = () => ({ members: [...members], mode: mode.value });
          }
          const extra = rows.slice(basic);
          const changed = extra.length && (s.keyword || s.jsonPath || s.maxMs || s.verifyTls === false || s.followRedirects === false || s.headers?.length || s.body);
          put(settingsHolder, group({ title: typeLabel(type) }, rows.slice(0, basic)),
            extra.length ? h('details', { class: 'more-actions', open: changed ? true : undefined }, h('summary', { text: 'More options' }), group({}, extra)) : null);
        }
        typeSelect.select.addEventListener('change', () => { type = typeSelect.select.value; drawSettings(); });
        scope.select.addEventListener('change', () => { if (type === 'group') drawSettings(); });
        drawSettings();
        // Timing and notifications, tucked away until needed.
        const interval = inputRow('Check every (seconds)', { type: 'number', min: 20, max: 86400, value: existing?.interval ?? 60 });
        const timeout = inputRow('Give up after (seconds)', { type: 'number', min: 1, max: 120, value: existing?.timeout ?? 10 });
        const failures = inputRow('Failed checks before down', { type: 'number', min: 1, max: 10, value: existing?.failures ?? 2 }, { info: 'A failure first shows as Failing and is checked again sooner; the monitor goes down after this many in a row.' });
        const retry = inputRow('Check again after a failure (seconds)', { type: 'number', min: 5, max: 3600, value: existing?.retryInterval ?? 20 });
        const tags = inputRow('Tags', { value: (existing?.tags ?? []).join(', '), placeholder: 'optional, comma separated' }, { info: 'Maintenance windows can cover every monitor with a tag.' });
        const chosen = new Set(existing?.notify?.channels ?? []);
        const channelRows = cfg.channels.length ? cfg.channels.map(channel => row(channel.name, toggle({ checked: chosen.has(channel.id), label: `Notify ${channel.name}`, onChange: on => { if (on) chosen.add(channel.id); else chosen.delete(channel.id); } }), { detail: CHANNEL_LABELS[channel.type] })) : [emptyRow('Add notification channels in Administration › Monitoring and logs.')];
        const recovery = toggle({ checked: existing?.notify?.up !== false, label: 'Also when it’s back up' });
        const resend = inputRow('Remind every (minutes, 0 = off)', { type: 'number', min: 0, max: 1440, value: existing?.notify?.resendMinutes ?? 0 });
        const more = h('details', { class: 'more-actions' }, h('summary', { text: 'Timing and notifications' }),
          h('div', { class: 'stack' }, group({ title: 'Notify' }, channelRows, cfg.channels.length ? [row('Also when it’s back up', recovery), resend.row] : null), group({ title: 'Timing' }, interval.row, timeout.row, failures.row, retry.row, tags.row)));
        const result = h('div', {});
        const build = () => ({ name: name.input.value, scope: scope.select.value, type, interval: interval.input.value, timeout: timeout.input.value, failures: failures.input.value, retryInterval: retry.input.value, tags: tags.input.value.split(',').map(t => t.trim()).filter(Boolean), notify: { channels: [...chosen], up: recovery.checked, resendMinutes: resend.input.value }, [type]: read() });
        const test = h('button', { type: 'button', text: 'Test now', hidden: type === 'push' || type === 'group' });
        typeSelect.select.addEventListener('change', () => { test.hidden = type === 'push' || type === 'group'; });
        test.addEventListener('click', () => busy(test, 'Testing…', async () => {
          try {
            const answer = await ops('test', { id: existing?.id, monitor: build() });
            put(result, h('div', { class: 'notice ' + (answer.ok ? 'ok' : 'error'), role: 'status' }, answer.ok ? `Up${answer.ms !== null ? ' · ' + ms(answer.ms) : ''}${answer.code ? ' · HTTP ' + answer.code : ''}${answer.warning ? ' · ' + answer.warning : ''}` : answer.message ?? 'Down'));
          } catch (error) { failure(box, error); }
        }));
        const save = h('button', { type: 'button', class: 'primary', text: 'Save' });
        save.addEventListener('click', () => busy(save, 'Saving…', async () => {
          try {
            const saved = await ops('config', { kind: 'monitor', action: 'save', id: existing?.id, item: build() });
            close();
            if (saved.token) showPushAddress(saved.token);
            onSaved?.();
          } catch (error) { failure(box, error); }
        }));
        const remove = existing ? actionRow('Delete this monitor', { iconName: 'trash', danger: true, onClick: () => confirmDialog(`Delete ${existing.name}?`, 'Its history goes too.', 'Delete', async () => { await ops('config', { kind: 'monitor', action: 'delete', id: existing.id }); close(); onDeleted?.(); }) }) : null;
        const newToken = existing?.type === 'push' ? actionRow('Make a new push address', { iconName: 'refresh', onClick: () => confirmDialog('Make a new push address?', 'The old address stops working.', 'Make new', async () => { const r = await ops('config', { kind: 'monitor', action: 'token', id: existing.id }); close(); showPushAddress(r.token); }, { danger: false }) }) : null;
        return [group({}, name.row, scope.row, typeSelect.row), settingsHolder, more, result, box, remove || newToken ? group({}, newToken, remove) : null, dialogActions(h('button', { type: 'button', onclick: close, text: 'Cancel' }), test, save)];
      });
    }
    function showPushAddress(token) {
      const address = `${location.origin}/studio/push/${token}`;
      openDialog('Push address', close => {
        const box = notice();
        return [h('p', { text: 'Have the job open this address when it finishes (GET or POST). Add ?status=down to report a failure, and &msg=… to say why. This is the only time the address is shown.' }),
          h('div', { class: 'secret mono', text: address }),
          h('p', { class: 'muted small mono', text: `curl -fsS -m 10 --retry 3 ${address}` }),
          box, dialogActions(h('button', { type: 'button', onclick: () => copyText(address, box), text: 'Copy' }), h('button', { type: 'button', class: 'primary', onclick: close, text: 'Done' }))];
      });
    }
    async function cardMonitorDialog(m, override, onSaved) {
      const cfg = await config();
      openDialog(`${m.name}: notifications`, close => {
        const box = notice();
        const chosen = new Set(override?.notify?.channels ?? []);
        const paused = toggle({ checked: Boolean(override?.paused), label: 'Pause this card’s check' });
        const rows = cfg.channels.length ? cfg.channels.map(channel => row(channel.name, toggle({ checked: chosen.has(channel.id), label: `Notify ${channel.name}`, onChange: on => { if (on) chosen.add(channel.id); else chosen.delete(channel.id); } }), { detail: CHANNEL_LABELS[channel.type] })) : [emptyRow('Add notification channels in Administration › Monitoring and logs.')];
        const save = h('button', { type: 'button', class: 'primary', text: 'Save' });
        save.addEventListener('click', () => busy(save, 'Saving…', async () => { try { await ops('config', { kind: 'override', id: m.id, paused: paused.checked, notify: { channels: [...chosen] } }); close(); onSaved(); } catch (error) { failure(box, error); } }));
        return [h('p', { class: 'muted small', text: 'This card’s address and check come from the card itself. Here you choose who hears when it goes down.' }), group({ title: 'Notify' }, rows), group({}, row('Pause the check', paused)), box, dialogActions(h('button', { type: 'button', onclick: close, text: 'Cancel' }), save)];
      });
    }
    // Maintenance: the windows, each opening for editing (Delete inside,
    // confirmed), like channels and sources.
    async function maintenanceDialog(onChanged) {
      const cfg = await config();
      openDialog('Maintenance', close => {
        const reopen = () => { close(); onChanged?.(); maintenanceDialog(onChanged); };
        const list = group({ title: 'Windows' }, cfg.maintenance.length ? cfg.maintenance.map(item => navRow({ title: item.name, detail: `${scopeName(item.scope)} · ${windowText(item)}`, onClick: () => { close(); maintenanceEditor(cfg, item, reopen); } })) : [emptyRow('None yet.')]);
        const add = h('button', { type: 'button', class: 'primary', text: 'New window', onclick: () => { close(); maintenanceEditor(cfg, null, reopen); } });
        return [h('p', { class: 'muted small', text: 'Monitors in maintenance aren’t counted as down and send no notifications. Times are the server’s time zone.' }), list, dialogActions(h('button', { type: 'button', onclick: close, text: 'Close' }), add)];
      });
    }
    function maintenanceEditor(cfg, existing, onDone) {
      openDialog(existing ? existing.name : 'New maintenance window', close => {
        const box = notice();
        const name = inputRow('Name', { maxlength: 80, placeholder: 'Router update', value: existing?.name ?? '' });
        const scopes = cfg.dashboards.map(entry => [entry.id, entry.name]).concat([['studio', 'Studio only']]);
        const scope = selectRow('Dashboard', scopes, existing?.scope ?? (filter && filter !== 'studio' ? filter : scopes[0][0]));
        // A window that was "now" or one-off is edited as "now, for so many minutes from now".
        let kind = existing && ['daily', 'weekly'].includes(existing.kind) ? existing.kind : 'now';
        const when = segmented({ value: kind, label: 'When', options: [['now', 'Now'], ['daily', 'Every day'], ['weekly', 'Every week']], onChange: option => { kind = option; drawWhen(); } });
        const whenHolder = h('div', {});
        const remaining = existing?.end ? Math.max(5, Math.ceil((existing.end - Date.now()) / 60000)) : 60;
        const length = inputRow(existing ? 'For (minutes from now)' : 'For (minutes)', { type: 'number', min: 5, value: remaining });
        const from = inputRow('From', { type: 'time', value: existing?.from ?? '02:00' });
        const to = inputRow('To', { type: 'time', value: existing?.to ?? '03:00' });
        const days = new Set(existing?.days ?? [0]);
        const dayRow = row('Days', h('div', { class: 'ops-days' }, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, index) => { const b = h('button', { type: 'button', class: 'ops-chip', 'aria-pressed': String(days.has(index)), text: label }); b.addEventListener('click', () => { if (days.has(index)) days.delete(index); else days.add(index); b.setAttribute('aria-pressed', String(days.has(index))); }); return b; })), { stacked: true });
        function drawWhen() { put(whenHolder, kind === 'now' ? length.row : [from.row, to.row, kind === 'weekly' ? dayRow : null]); }
        drawWhen();
        const covered = new Set(existing?.monitors ?? []);
        const monitorsHolder = h('div', {});
        function drawMonitors() {
          const candidates = cfg.monitors.filter(item => item.scope === scope.select.value);
          put(monitorsHolder, candidates.length ? candidates.map(item => row(item.name, toggle({ checked: covered.has(item.id), label: item.name, onChange: on => { if (on) covered.add(item.id); else covered.delete(item.id); } }))) : emptyRow('No monitors on this dashboard to cover.'));
        }
        scope.select.addEventListener('change', () => { covered.clear(); drawMonitors(); });
        drawMonitors();
        const coverTags = inputRow('Monitors tagged', { placeholder: 'optional, comma separated', value: (existing?.tags ?? []).join(', ') }, { info: 'Also covers every monitor on this dashboard with one of these tags, including ones added later.' });
        const save = h('button', { type: 'button', class: 'primary', text: existing ? 'Save' : 'Add window' });
        save.addEventListener('click', () => busy(save, 'Saving…', async () => {
          try {
            await ops('config', { kind: 'maintenance', action: 'save', id: existing?.id, item: { name: name.input.value, scope: scope.select.value, kind, monitors: [...covered], tags: coverTags.input.value.split(',').map(t => t.trim()).filter(Boolean), minutes: length.input.value, from: from.input.value, to: to.input.value, days: [...days] } });
            close(); onDone();
          } catch (error) { failure(box, error); }
        }));
        const remove = existing ? group({}, actionRow('Delete this window', { iconName: 'trash', danger: true, onClick: () => confirmDialog(`Delete ${existing.name}?`, 'Its monitors are no longer paused for it.', 'Delete', async () => { await ops('config', { kind: 'maintenance', action: 'delete', id: existing.id }); close(); onDone(); }) })) : null;
        const cancel = h('button', { type: 'button', text: 'Cancel', onclick: () => { close(); onDone(); } });
        return [group({}, name.row, scope.row, row('When', when), whenHolder), group({ title: 'Covers' }, monitorsHolder, coverTags.row), remove, box, dialogActions(cancel, save)];
      });
    }

    drawTabs();
    put(layout, tabList, h('div', { class: 'admin-content' }, back, sectionTitle, message, panel));
    render(...pageChrome('/studio/operations', me, pageTitle, layout));
    route();
    if (!location.hash.slice(1) || !panel.childElementCount) drawPanel();
  }

  const TYPE_LABELS = { http: 'Web address', tcp: 'Port', ping: 'Ping', dns: 'DNS record', tls: 'Certificate', push: 'Push (heartbeat)', docker: 'Docker container', group: 'Group' };
  const typeLabel = type => TYPE_LABELS[type] ?? type;
  const CHANNEL_LABELS = { email: 'Email', webhook: 'Webhook', ntfy: 'ntfy', gotify: 'Gotify', discord: 'Discord', slack: 'Slack', teams: 'Microsoft Teams', telegram: 'Telegram', pushover: 'Pushover', matrix: 'Matrix', homeassistant: 'Home Assistant', apprise: 'Apprise' };
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function windowText(item) {
    if (item.kind === 'now' || item.kind === 'once') return `${new Date(item.start).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} to ${new Date(item.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    return `${item.kind === 'daily' ? 'Every day' : item.days.map(d => DAY_NAMES[d]).join(', ')} ${item.from}–${item.to}`;
  }

  // ---- Administration › Monitoring and logs ---------------------------------

  function adminPanel() {
    const holder = h('div', { class: 'stack' }, loading());
    const message = notice();
    async function load() {
      let cfg;
      try { cfg = await ops('config'); } catch (error) { put(holder, h('div', { class: 'notice error', role: 'alert', text: error.message })); return; }
      const scopeName = id => cfg.dashboards.find(entry => entry.id === id)?.name ?? (id === 'studio' ? 'Studio only' : 'Removed dashboard');
      const s = cfg.settings;
      const usage = cfg.storage?.usage;
      const health = cfg.storage?.health;
      // Storage and how long things are kept.
      const logDays = h('input', { type: 'number', min: 1, max: 365, value: s.logDays, 'aria-label': 'Keep logs for (days)' });
      const auditDays = h('input', { type: 'number', min: 30, max: 3650, value: s.auditDays, 'aria-label': 'Keep sign-in and audit events for (days)' });
      const metricDays = h('input', { type: 'number', min: 7, max: 365, value: s.metricDays, 'aria-label': 'Keep metrics for (days)' });
      const budget = h('input', { type: 'number', min: 100, max: 1048576, value: s.budgetMB, 'aria-label': 'Disk budget (MB)' });
      // Save shows once something changed, like the other settings pages.
      const saveStorage = pill('Save', { primary: true, hidden: true });
      for (const input of [logDays, auditDays, metricDays, budget]) input.addEventListener('input', () => { saveStorage.hidden = false; });
      saveStorage.addEventListener('click', () => busy(saveStorage, 'Saving…', async () => { try { await ops('config', { kind: 'settings', settings: { ...s, logDays: logDays.value, auditDays: auditDays.value, metricDays: metricDays.value, budgetMB: budget.value } }); say(message, 'Saved.', 'ok'); load(); } catch (error) { failure(message, error); } }));
      const storage = group({ title: 'Storage', aside: saveStorage, info: 'Monitoring history and logs live in the state volume under observability/. They aren’t part of backups. When the budget is reached the oldest log files go first.' },
        row('Status', value(health ? (health.storage === 'ok' ? (health.reason ? 'Working (slower mode)' : 'Working') : 'Paused: ' + (health.reason ?? 'unavailable')) : 'Starting'), { info: health?.reason ?? undefined }),
        usage ? row('Used', value(`${bytes(usage.total)} of ${s.budgetMB >= 1024 ? (s.budgetMB / 1024).toFixed(s.budgetMB % 1024 ? 1 : 0) + ' GB' : s.budgetMB + ' MB'}`)) : null,
        usage?.oldest ? row('Oldest event', value(new Date(usage.oldest).toLocaleDateString())) : null,
        row('Keep logs for (days)', logDays), row('Keep sign-in and audit events for (days)', auditDays), row('Keep metrics for (days)', metricDays), row('Disk budget (MB)', budget));
      // Notification channels.
      const channels = group({ title: 'Notification channels', aside: pill('Add', { iconName: 'plus', onclick: () => channelDialog(null) }), info: 'Where monitors and log alerts send their messages. Keys and addresses are never shown again after saving.' },
        cfg.channels.length ? cfg.channels.map(channel => navRow({ title: channel.name, detail: CHANNEL_LABELS[channel.type], onClick: () => channelDialog(channel) })) : [h('p', { class: 'empty-row', text: cfg.storage?.emailReady ? 'None yet.' : 'None yet. Email needs Studio’s email settings (STUDIO_SMTP_HOST).' })]);
      // Log alerts.
      const alerts = group({ title: 'Log alerts', aside: cfg.channels.length ? pill('Add', { iconName: 'plus', onclick: () => alertDialog(null) }) : null, info: 'Sends a notification when a search finds at least so many events within a time, then stays quiet for a while.' },
        cfg.alerts.length ? cfg.alerts.map(alert => navRow({ title: alert.name, detail: `${alert.threshold}+ in ${alert.minutes} min · ${alert.query}`, onClick: () => alertDialog(alert) })) : [h('p', { class: 'empty-row', text: cfg.channels.length ? 'None yet.' : 'Add a notification channel first.' })]);
      // Log sources.
      const httpsSources = cfg.sources.filter(item => item.kind === 'https');
      const syslogSources = cfg.sources.filter(item => item.kind === 'syslog');
      const intake = group({ title: 'Send logs to Studio', aside: pill('Add', { iconName: 'plus', onclick: () => sourceDialog('https', null) }), info: 'Other apps and scripts can send events over HTTPS with a token. Each source belongs to one dashboard, and only people with Logs on it see them.' },
        httpsSources.length ? httpsSources.map(item => navRow({ title: item.name, detail: scopeName(item.scope), onClick: () => sourceDialog('https', item) })) : [h('p', { class: 'empty-row', text: 'None yet.' })]);
      const syslogOn = toggle({ checked: s.syslog.enabled, label: 'Syslog' });
      const syslogPort = h('input', { type: 'number', min: 1024, max: 65535, value: s.syslog.port, 'aria-label': 'Port' });
      const udp = toggle({ checked: s.syslog.udp, label: 'UDP' });
      const tcp = toggle({ checked: s.syslog.tcp, label: 'TCP' });
      const syslogRows = h('div', {});
      const saveSyslog = pill('Save', { primary: true, hidden: true });
      const syslogChanged = () => { saveSyslog.hidden = false; drawSyslog(); };
      for (const control of [syslogOn, udp, tcp]) control.addEventListener('click', syslogChanged);
      syslogPort.addEventListener('input', () => { saveSyslog.hidden = false; });
      function drawSyslog() {
        put(syslogRows, syslogOn.checked ? [row('Port', syslogPort, { info: `Publish this port from the container (UDP and/or TCP). In Docker Swarm use mode: host so senders’ addresses reach Studio.` }), row('UDP', udp), row('TCP', tcp),
          ...syslogSources.map(item => navRow({ title: item.name, detail: `${item.address} · ${scopeName(item.scope)}`, onClick: () => sourceDialog('syslog', item) })),
          actionRow('Add a sender', { iconName: 'plus', onClick: () => sourceDialog('syslog', null) }),
          cfg.storage?.unknownSyslogSenders ? h('p', { class: 'empty-row', text: `${cfg.storage.unknownSyslogSenders} messages came from senders that aren’t listed, and were left out.` }) : null] : []);
      }
      drawSyslog();
      saveSyslog.addEventListener('click', () => busy(saveSyslog, 'Saving…', async () => { try { await ops('config', { kind: 'settings', settings: { ...s, syslog: { enabled: syslogOn.checked, port: syslogPort.value, udp: udp.checked, tcp: tcp.checked } } }); say(message, 'Saved.', 'ok'); load(); } catch (error) { failure(message, error); } }));
      const syslog = group({ title: 'Syslog', aside: saveSyslog, info: 'Routers, NAS boxes and other devices can send syslog (RFC 5424 or 3164). Only senders listed here are kept, each on one dashboard.' }, row('Receive syslog', syslogOn), syslogRows);
      const docker = group({ title: 'Docker', info: 'Docker monitors use the servers in each dashboard’s docker.yaml. Studio only reads from Docker; point it at a read-only socket proxy with CONTAINERS, EVENTS, INFO and VERSION allowed (SERVICES and TASKS for Swarm).' },
        h('p', { class: 'empty-row', text: 'Add a Docker container monitor in Operations › Monitors.' }));
      put(holder, message, storage, channels, alerts, intake, syslog, docker);

      function channelDialog(existing) {
        openDialog(existing ? existing.name : 'New channel', close => {
          const box = notice();
          let type = existing?.type ?? 'ntfy';
          const name = inputRow('Name', { maxlength: 80, value: existing?.name ?? '', 'data-autofocus': true });
          const kind = selectRow('Type', Object.entries(CHANNEL_LABELS), type);
          if (existing) kind.select.disabled = true;
          const fields = h('div', {});
          let read = () => ({});
          const secret = (label, key, attrs = {}) => inputRow(label, { type: key === 'url' ? 'url' : 'password', placeholder: existing?.[key + 'Set'] ? 'Saved · leave empty to keep' : attrs.placeholder ?? '', autocomplete: 'off', ...attrs });
          function draw() {
            const rows = [];
            const take = (label, key, attrs) => { const r = secret(label, key, attrs); rows.push(r.row); return r.input; };
            const plain = (label, key, attrs = {}) => { const r = inputRow(label, { value: existing?.[key] ?? '', ...attrs }); rows.push(r.row); return r.input; };
            if (type === 'email') { const to = plain('Send to', 'to', { placeholder: 'you@example.com, team@example.com' }); read = () => ({ to: to.value }); }
            else if (type === 'telegram') { const token = take('Bot token', 'token'); const chat = plain('Chat id', 'chat'); read = () => ({ token: token.value, chat: chat.value }); }
            else if (type === 'pushover') { const token = take('App token', 'token'); const user = plain('User key', 'user'); read = () => ({ token: token.value, user: user.value }); }
            else {
              const hints = { webhook: 'https://…', ntfy: 'https://ntfy.sh/your-topic', gotify: 'https://gotify.example', discord: 'Discord webhook URL', slack: 'Slack incoming webhook URL', teams: 'Teams workflow URL', matrix: 'https://matrix.example (homeserver)', homeassistant: 'Home Assistant webhook URL', apprise: 'https://apprise.example/notify/key' };
              const url = take(type === 'matrix' ? 'Homeserver' : 'Address', 'url', { placeholder: existing?.urlSet ? 'Saved · leave empty to keep' : hints[type] });
              const token = ['gotify', 'matrix', 'ntfy'].includes(type) ? take(type === 'ntfy' ? 'Access token (optional)' : type === 'gotify' ? 'App token' : 'Access token', 'token') : null;
              const room = type === 'matrix' ? plain('Room id', 'room', { placeholder: '!abc:matrix.example' }) : null;
              const signing = type === 'webhook' ? take('Signing secret (optional)', 'secret') : null;
              read = () => ({ url: url.value, ...(token ? { token: token.value } : {}), ...(room ? { room: room.value } : {}), ...(signing ? { secret: signing.value } : {}) });
              if (type === 'webhook') rows.push(h('p', { class: 'empty-row', text: 'Sends JSON. With a secret, x-studio-signature is sha256= HMAC of “timestamp.body”, with the timestamp in x-studio-timestamp.' }));
            }
            put(fields, group({}, rows));
          }
          kind.select.addEventListener('change', () => { type = kind.select.value; draw(); });
          draw();
          const save = h('button', { type: 'button', class: 'primary', text: 'Save' });
          const result = h('div', {});
          const test = existing ? h('button', { type: 'button', text: 'Send a test' }) : null;
          test?.addEventListener('click', () => busy(test, 'Sending…', async () => { try { const r = await ops('channels/test', { id: existing.id }); put(result, h('div', { class: 'notice ' + (r.ok ? 'ok' : 'error'), role: 'status', text: r.ok ? 'Sent. Check that it arrived.' : `Not sent: ${r.error}` })); } catch (error) { failure(box, error); } }));
          save.addEventListener('click', () => busy(save, 'Saving…', async () => { try { await ops('config', { kind: 'channel', action: 'save', id: existing?.id, item: { name: name.input.value, type, ...read() } }); close(); load(); } catch (error) { failure(box, error); } }));
          const remove = existing ? group({}, actionRow('Delete this channel', { iconName: 'trash', danger: true, onClick: () => confirmDialog(`Delete ${existing.name}?`, 'Monitors and alerts stop sending to it.', 'Delete', async () => { await ops('config', { kind: 'channel', action: 'delete', id: existing.id }); close(); load(); }) })) : null;
          return [group({}, name.row, kind.row), fields, result, box, remove, dialogActions(h('button', { type: 'button', onclick: close, text: 'Cancel' }), test, save)];
        });
      }
      function alertDialog(existing) {
        openDialog(existing ? existing.name : 'New log alert', close => {
          const box = notice();
          const name = inputRow('Name', { maxlength: 80, value: existing?.name ?? '', 'data-autofocus': true });
          const query = inputRow('Search', { class: 'mono', value: existing?.query ?? 'severity:error', maxlength: 1000 });
          const threshold = inputRow('At least (events)', { type: 'number', min: 1, value: existing?.threshold ?? 5 });
          const within = inputRow('Within (minutes)', { type: 'number', min: 1, max: 1440, value: existing?.minutes ?? 5 });
          const quiet = inputRow('Then stay quiet for (minutes)', { type: 'number', min: 1, max: 1440, value: existing?.quietMinutes ?? 30 });
          const chosen = new Set(existing?.channels ?? []);
          const rows = cfg.channels.map(channel => row(channel.name, toggle({ checked: chosen.has(channel.id), label: `Notify ${channel.name}`, onChange: on => { if (on) chosen.add(channel.id); else chosen.delete(channel.id); } })));
          const save = h('button', { type: 'button', class: 'primary', text: 'Save' });
          save.addEventListener('click', () => busy(save, 'Saving…', async () => { try { await ops('config', { kind: 'alert', action: 'save', id: existing?.id, item: { name: name.input.value, query: query.input.value, threshold: threshold.input.value, minutes: within.input.value, quietMinutes: quiet.input.value, channels: [...chosen] } }); close(); load(); } catch (error) { failure(box, error); } }));
          const remove = existing ? group({}, actionRow('Delete this alert', { iconName: 'trash', danger: true, onClick: () => confirmDialog(`Delete ${existing.name}?`, 'It stops sending.', 'Delete', async () => { await ops('config', { kind: 'alert', action: 'delete', id: existing.id }); close(); load(); }) })) : null;
          return [group({}, name.row, query.row, threshold.row, within.row, quiet.row), group({ title: 'Notify' }, rows), box, remove, dialogActions(h('button', { type: 'button', onclick: close, text: 'Cancel' }), save)];
        });
      }
      function sourceDialog(kind, existing) {
        openDialog(existing ? existing.name : kind === 'https' ? 'New log source' : 'New syslog sender', close => {
          const box = notice();
          const name = inputRow('Name', { maxlength: 80, value: existing?.name ?? '', 'data-autofocus': true });
          const scope = selectRow('Dashboard', cfg.dashboards.map(entry => [entry.id, entry.name]).concat([['studio', 'Studio only']]), existing?.scope ?? cfg.dashboards[0]?.id ?? 'studio', { info: 'Its events show on this dashboard’s logs only.' });
          const address = kind === 'syslog' ? inputRow('Sender address', { value: existing?.address ?? '', placeholder: '10.0.0.1' }, { info: 'The IP address the device sends from, as Studio sees it.' }) : null;
          const resource = inputRow('Shown as', { value: existing?.resource ?? '', placeholder: 'optional, such as Router' });
          const save = h('button', { type: 'button', class: 'primary', text: 'Save' });
          save.addEventListener('click', () => busy(save, 'Saving…', async () => {
            try {
              const r = await ops('config', { kind: 'source', action: 'save', id: existing?.id, item: { kind, name: name.input.value, scope: scope.select.value, resource: resource.input.value, ...(address ? { address: address.input.value } : {}) } });
              close(); load();
              if (r.token) showToken(r.token);
            } catch (error) { failure(box, error); }
          }));
          const actions = existing ? group({},
            kind === 'https' ? actionRow('Make a new token', { iconName: 'refresh', onClick: () => confirmDialog('Make a new token?', 'The old token stops working.', 'Make new', async () => { const r = await ops('config', { kind: 'source', action: 'token', id: existing.id }); close(); showToken(r.token); }, { danger: false }) }) : null,
            actionRow('Delete', { iconName: 'trash', danger: true, onClick: () => confirmDialog(`Delete ${existing.name}?`, 'Events it sent stay until they age out.', 'Delete', async () => { await ops('config', { kind: 'source', action: 'delete', id: existing.id }); close(); load(); }) })) : null;
          return [group({}, name.row, scope.row, address?.row, resource.row), box, actions, dialogActions(h('button', { type: 'button', onclick: close, text: 'Cancel' }), save)];
        });
      }
      function showToken(token) {
        const example = `curl -fsS ${location.origin}/studio/ingest/logs -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '{"level":"error","message":"Backup failed"}'`;
        openDialog('Source token', close => {
          const box = notice();
          return [h('p', { text: 'Send events with this token. It is shown only now; make a new one if it leaks.' }), h('div', { class: 'secret mono', text: token }), h('p', { class: 'muted small mono ops-wrap', text: example }),
            box, dialogActions(h('button', { type: 'button', onclick: () => copyText(token, box), text: 'Copy token' }), h('button', { type: 'button', class: 'primary', onclick: close, text: 'Done' }))];
        });
      }
    }
    load();
    return holder;
  }

  window.StudioOps = { adminPanel };
  UI.addPage('operations', operationsPage);
})();
